/**
 * #47 Cassa comune: budget dell'evento ("150 € in tutto" o "10 € a testa"), la barra che si riempie con gli scontrini
 * confermati, quanto viene a testa finora e quanto costerà circa la lista. Avviso se uno scontrino fa sforare.
 */
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '../api';
import { budgetTotal, Group, GroupExpense, GroupItem, groupExpenses, myGroups, setGroupBudget, watchAccounts } from '../cloud/groups';
import { euro, parseEuro } from '../format';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { PrimaryButton } from './ui';

/** budget e speso di un gruppo, aggiornati quando arrivano scontrini */
export function useGroupMoney(groupId: string | null) {
  const [expenses, setExpenses] = useState<GroupExpense[]>([]);
  const [group, setGroup] = useState<Group | null>(null);
  const load = useCallback(async () => {
    if (!groupId) return;
    const [g, e] = await Promise.all([myGroups().catch(() => []), groupExpenses(groupId).catch(() => [])]);
    setGroup(g.find((x) => x.id === groupId) ?? null); setExpenses(e);
  }, [groupId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => (groupId ? watchAccounts(groupId, load) : undefined), [groupId, load]);
  const spent = Math.round(expenses.filter((e) => e.status === 'confermata').reduce((t, e) => t + e.amount, 0) * 100) / 100;
  return { group, expenses, spent, total: group ? budgetTotal(group) : null, reload: load };
}

/** nel riquadro dello scontrino da confermare: "con questo scontrino arrivate a 162 € (budget 150 €)" */
export function BudgetWarning({ groupId, amount }: { groupId: string; amount: number | null }) {
  const { colors } = useTheme();
  const { total, spent } = useGroupMoney(groupId);
  if (total == null || !amount || spent + amount <= total) return null;
  return (
    <Text style={{ color: colors.danger, fontSize: 13, lineHeight: 18, fontWeight: '600' }}>
      ⚠️ Con questo scontrino arrivate a {euro(spent + amount)}: il budget è {euro(total)}.
    </Text>
  );
}

export function BudgetCard({ group, items, owner, spent, onChanged }: {
  group: Group; items: GroupItem[]; owner: boolean; spent: number; onChanged: () => void;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const [editing, setEditing] = useState(false);
  const [est, setEst] = useState<{ total: number; priced: number; missing: number } | null>(null);
  const toBuy = items.filter((i) => i.kind !== 'porta' && (i.status === 'da_prendere' || i.status === 'proposto'));
  const key = toBuy.map((i) => `${i.product_id}:${i.quantity}`).join(',');
  useEffect(() => {
    if (!toBuy.length) { setEst(null); return; }
    api.estimateList(toBuy.map((i) => ({ product_id: i.product_id, quantity: Number(i.quantity) }))).then(setEst).catch(() => setEst(null));
  }, [key]);
  const total = budgetTotal(group);
  const n = Math.max(1, group.members);
  const estLine = est && est.priced > 0
    ? `🧾 Quello che resta da comprare costerà circa ${euro(est.total)}${est.missing ? ` (+ ${est.missing} senza prezzo)` : ''}`
    : null;

  if (total == null) {
    if (!owner && !estLine) return null;
    return (
      <>
        <Pressable disabled={!owner} onPress={() => setEditing(true)} style={s.empty} accessibilityRole="button">
          {owner && <Text style={s.text}>💰 <Text style={{ fontWeight: '800' }}>Cassa comune</Text>: fissa un budget («150 € in tutto» o «10 € a persona»)</Text>}
          {spent > 0 && <Text style={s.muted}>Speso finora {euro(spent)} · {euro(spent / n)} a persona</Text>}
          {estLine && <Text style={s.muted}>{estLine}</Text>}
        </Pressable>
        <BudgetSheet visible={editing} group={group} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged(); }} />
      </>
    );
  }
  const pct = Math.max(0, Math.min(1, spent / total));
  const over = spent > total;
  const willOver = !over && est && est.priced > 0 && spent + est.total > total;
  return (
    <>
      <View style={[s.card, over && { borderColor: colors.danger }]}>
        <View style={s.head}>
          <Text style={s.title}>💰 Cassa comune</Text>
          {owner && <Pressable onPress={() => setEditing(true)} hitSlop={8} style={{ paddingVertical: 8, paddingHorizontal: 6 }} accessibilityRole="button" accessibilityLabel="Modifica il budget"><Text style={s.link}>Modifica</Text></Pressable>}
        </View>
        <Text style={s.big}>Speso {euro(spent)} <Text style={s.of}>di {euro(total)}</Text></Text>
        <View style={s.track}><View style={[s.fill, { width: `${Math.max(2, pct * 100)}%` }, over && { backgroundColor: colors.danger }]} /></View>
        <Text style={s.muted}>
          {euro(spent / n)} a persona finora{group.budget_per_head ? ` · budget ${euro(group.budget!)} a persona × ${n}` : ` · ${euro(total / n)} a persona in tutto`}
          {over ? ` · sforato di ${euro(spent - total)}` : ` · restano ${euro(total - spent)}`}
        </Text>
        {estLine && <Text style={[s.muted, willOver && { color: colors.danger, fontWeight: '600' }]}>{estLine}{willOver ? ': si sfora' : ''}</Text>}
      </View>
      <BudgetSheet visible={editing} group={group} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged(); }} />
    </>
  );
}

function BudgetSheet({ visible, group, onClose, onSaved }: { visible: boolean; group: Group; onClose: () => void; onSaved: () => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [amount, setAmount] = useState('');
  const [perHead, setPerHead] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setAmount(group.budget != null ? String(group.budget).replace('.', ',') : ''); setPerHead(group.budget_per_head); setErr(null);
  }, [visible]);
  const v = parseEuro(amount);
  const save = async (value: number | null) => {
    if (value != null && !(value > 0)) { setErr('Scrivi quanto'); return; }
    setBusy(true); setErr(null);
    try { await setGroupBudget(group.id, value, perHead); onSaved(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.bg} onPress={onClose}>
        <Pressable style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + spacing.md }]} onPress={() => {}}>
          <Text style={s.sheetTitle}>💰 Budget dell'evento</Text>
          <View style={s.row}>
            {[false, true].map((ph) => (
              <Pressable key={String(ph)} onPress={() => setPerHead(ph)} style={[s.chip, perHead === ph && s.on]}>
                <Text style={s.text}>{ph ? 'A persona' : 'In tutto'}</Text>
              </Pressable>
            ))}
          </View>
          <View style={s.row}>
            <Text style={s.title}>€</Text>
            <TextInput value={amount} onChangeText={(t) => setAmount(t.replace(/[^0-9.,]/g, ''))} keyboardType="decimal-pad" inputMode="decimal"
              placeholder={perHead ? '10' : '150'} placeholderTextColor={colors.textSecondary} style={s.input} />
          </View>
          {perHead && Number.isFinite(v) && v > 0 && (
            <Text style={s.muted}>Con {group.members} {group.members === 1 ? 'persona' : 'persone'} nel gruppo fa {euro(v * group.members)} in tutto (cresce se entra qualcuno).</Text>
          )}
          {err && <Text style={{ color: colors.danger }}>{err}</Text>}
          <PrimaryButton label="Salva" icon="wallet-outline" onPress={() => save(Number.isFinite(v) ? v : NaN)} loading={busy} style={{ marginTop: spacing.sm }} />
          {group.budget != null && (
            <Pressable onPress={() => save(null)} style={{ alignSelf: 'center', padding: spacing.md }}><Text style={{ color: colors.danger }}>Togli il budget</Text></Pressable>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  card: { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: spacing.md, gap: 6 },
  empty: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.primary, backgroundColor: c.surface, gap: 4 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: c.text, fontSize: 16, fontWeight: '800' },
  text: { color: c.text, fontSize: 14, lineHeight: 20 },
  big: { color: c.text, fontSize: 20, fontWeight: '800' },
  of: { color: c.textSecondary, fontSize: 14, fontWeight: '600' },
  track: { height: 12, borderRadius: 6, backgroundColor: c.surfaceMuted, overflow: 'hidden' },
  fill: { height: 12, borderRadius: 6, backgroundColor: c.primary },
  muted: { color: c.textSecondary, fontSize: 12.5, lineHeight: 18 },
  link: { color: c.primary, fontWeight: '700', fontSize: 13 },
  bg: { flex: 1, backgroundColor: c.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, gap: spacing.sm,
    width: '100%', maxWidth: 640, alignSelf: 'center' },
  sheetTitle: { color: c.text, fontSize: 20, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border },
  on: { backgroundColor: c.primarySoft, borderColor: c.primary },
  input: { flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: spacing.md, color: c.text, backgroundColor: c.background, fontSize: 16 },
}));
