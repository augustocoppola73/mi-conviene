/**
 * #16: Conti del gruppo. Gli scontrini confermati di tutti, chi deve dare e chi deve avere (una famiglia = un conto),
 * chi dà a chi con il minimo di passaggi e "Segna come saldato". Si aggiorna a ogni conferma.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import {
  addGroupExpense, Balance, deleteExpense, GroupExpense, groupBalances, groupExpenses, GroupMember, setExcluded, settle, transfers, watchAccounts,
} from '../cloud/groups';
import { euro } from '../format';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { ask, tell } from './GroupList';
import { GroupReceiptEditor } from './GroupReceipt';
import { PrimaryButton } from './ui';

export function GroupAccounts({ groupId, me, owner, members }: { groupId: string; me: string | null; owner: boolean; members: GroupMember[] }) {
  const s = useStyles();
  const { colors } = useTheme();
  const [bal, setBal] = useState<Balance[]>([]);
  const [exp, setExp] = useState<GroupExpense[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [b, e] = await Promise.all([groupBalances(groupId).catch(() => []), groupExpenses(groupId).catch(() => [])]);
    setBal(b); setExp(e);
  }, [groupId]);
  useFocusEffect(useCallback(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]));
  useEffect(() => watchAccounts(groupId, load), [groupId, load]);

  const nameOf = (u: string | null) => (u === me ? 'tu' : members.find((m) => m.user_id === u)?.display_name || 'qualcuno');
  const mine = bal.find((b) => me && b.members.includes(me));
  const pending = exp.filter((e) => e.status === 'da_confermare');
  const confirmed = exp.filter((e) => e.status === 'confermata');
  const total = confirmed.reduce((t, e) => t + e.amount, 0);
  const moves = transfers(bal);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); } catch (e) { tell((e as Error).message); } finally { setBusy(false); load(); }
  };
  const addManual = () => {
    const v = parseFloat(amount.replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0) return tell('Scrivi quanto hai speso');
    run(async () => { await addGroupExpense(groupId, v, note.trim() || 'Spesa'); setNote(''); setAmount(''); });
  };
  const status = (b: Balance) => (Math.abs(b.balance) < 0.005 ? 'in pari' : b.balance > 0 ? `avere ${euro(b.balance)}` : `dare ${euro(-b.balance)}`);

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={s.card}>
        <Text style={s.title}>💶 Conti</Text>
        <Text style={s.help}>
          Speso in tutto {euro(total)}{bal.filter((b) => !b.excluded).length ? ` · ${euro(bal.find((b) => !b.excluded)?.share ?? 0)} a testa` : ''} · una famiglia è un conto solo.
        </Text>
        {mine && (
          <Text style={[s.me, { color: mine.balance < -0.005 ? colors.danger : mine.balance > 0.005 ? colors.success : colors.text }]}>
            {mine.members.length > 1 ? `${mine.label}: ` : 'Tu: '}{status(mine)}
          </Text>
        )}
        {bal.map((b) => (
          <View key={b.account} style={s.row}>
            <Text style={[s.text, { flex: 1 }]} numberOfLines={1}>{b.label}{b.excluded ? ' (escluso)' : ''}</Text>
            <Text style={s.small}>speso {euro(b.spent)}</Text>
            <Text style={[s.text, { fontWeight: '800', minWidth: 104, textAlign: 'right' },
              { color: b.balance < -0.005 ? colors.danger : b.balance > 0.005 ? colors.success : colors.textSecondary }]}>{status(b)}</Text>
            {owner && (
              <Text onPress={() => run(async () => { for (const u of b.members) await setExcluded(groupId, u, !b.excluded); })} style={s.link}>
                {b.excluded ? 'Includi' : 'Escludi'}
              </Text>
            )}
          </View>
        ))}
      </View>

      {moves.length > 0 && (
        <View style={s.card}>
          <Text style={s.title}>Chi dà a chi</Text>
          {moves.map((m, k) => (
            <View key={k} style={s.row}>
              <Text style={[s.text, { flex: 1 }]}><Text style={{ fontWeight: '700' }}>{m.from.label}</Text> → {m.to.label}: <Text style={{ fontWeight: '800' }}>{euro(m.amount)}</Text></Text>
              <Text onPress={async () => {
                if (await ask(`${m.from.label} ha dato ${euro(m.amount)} a ${m.to.label}?`, 'Sì, saldato')) run(() => settle(groupId, m.from.members[0], m.to.members[0], m.amount));
              }} style={s.link}>Segna come saldato</Text>
            </View>
          ))}
          <Text style={s.small}>I soldi non passano dall'app: vi date i soldi di persona e lo segnate qui.</Text>
        </View>
      )}

      {pending.map((e) => (
        <GroupReceiptEditor key={e.id} expenseId={e.id} title={`Da confermare: ${e.store_name || e.note || 'spesa'} (${nameOf(e.paid_by)})`}
          lines={e.lines ?? []} amount={e.amount} onDone={() => load()} />
      ))}

      <View style={s.card}>
        <Text style={s.title}>Scontrini · {confirmed.length}</Text>
        {!confirmed.length && <Text style={s.help}>Ancora nessuno. Arrivano quando chi ha fatto la spesa conferma il suo scontrino.</Text>}
        {confirmed.map((e) => (
          <View key={e.id}>
            <Pressable onPress={() => setOpen(open === e.id ? null : e.id)} style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.text} numberOfLines={1}>{e.note || e.store_name || 'Spesa'}</Text>
                <Text style={s.small}>{nameOf(e.paid_by)} · {new Date(e.created_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}{e.lines?.length ? ` · ${e.lines.length} prodotti` : ''}</Text>
              </View>
              <Text style={[s.text, { fontWeight: '800' }]}>{euro(e.amount)}</Text>
            </Pressable>
            {open === e.id && (
              <View style={s.detail}>
                {(e.lines ?? []).map((l, k) => (
                  <View key={k} style={s.row}>
                    <Text style={[s.small, { flex: 1 }]}>{l.name}{l.quantity ? ` · ${l.quantity}${l.unit ? ` ${l.unit}` : ''}` : ''}</Text>
                    <Text style={s.small}>{euro(Number(l.price) || 0)}</Text>
                  </View>
                ))}
                {(e.paid_by === me || owner) && (
                  <Text onPress={async () => { if (await ask(`Togliere «${e.note || e.store_name}» (${euro(e.amount)}) dai conti?`, 'Togli')) run(() => deleteExpense(e.id)); }}
                    style={[s.link, { color: colors.danger }]}>Togli dai conti</Text>
                )}
              </View>
            )}
          </View>
        ))}
      </View>

      <View style={s.card}>
        <Text style={s.title}>+ Aggiungi una spesa</Text>
        <Text style={s.help}>Una spesa per il gruppo fatta fuori dall'app (ghiaccio, carbonella, il pane del forno…).</Text>
        <View style={s.row}>
          <TextInput value={note} onChangeText={setNote} placeholder="Cosa" placeholderTextColor={colors.textSecondary} style={[s.input, { flex: 1, minWidth: 0 }]} maxLength={60} />
          <TextInput value={amount} onChangeText={(t) => setAmount(t.replace(/[^0-9.,]/g, ''))} placeholder="€" placeholderTextColor={colors.textSecondary}
            keyboardType="decimal-pad" inputMode="decimal" style={[s.input, { width: 80, textAlign: 'right' }]} />
        </View>
        <PrimaryButton label="Aggiungi ai conti (pagata da me)" icon="add-outline" variant="secondary" onPress={addManual} loading={busy} disabled={!amount} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  card: { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: spacing.md, gap: spacing.sm },
  title: { color: c.text, fontSize: 16, fontWeight: '800' },
  me: { fontSize: 18, fontWeight: '800' },
  help: { color: c.textSecondary, fontSize: 13, lineHeight: 18 },
  text: { color: c.text, fontSize: 14 },
  small: { color: c.textSecondary, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4 },
  detail: { paddingLeft: spacing.md, paddingBottom: spacing.sm, gap: 2 },
  link: { color: c.primary, fontWeight: '700', fontSize: 13 },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, color: c.text, backgroundColor: c.background, fontSize: 15 },
}));
