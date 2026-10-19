/**
 * #39: obiettivo di risparmio della famiglia ("200 € entro Natale"): la barra si riempie con i risparmi di tutti
 * dalla data in cui è stato fissato (verificati se c'è lo scontrino, altrimenti stimati).
 */
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, SavingEntry, SavingGoal } from '../api';
import { confirmAsk } from '../confirm';
import { euro, parseEuro } from '../format';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { DatePicker } from './DatePicker';
import { Card, PrimaryButton } from './ui';

const value = (e: SavingEntry) => (e.verified ? e.verified_amount ?? 0 : e.amount);
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });

export function SavingGoalCard({ entries, inFamily }: { entries: SavingEntry[]; inFamily: boolean }) {
  const s = useStyles();
  const { colors } = useTheme();
  const [goal, setGoal] = useState<SavingGoal | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const load = useCallback(() => { api.savingGoal().then(setGoal).catch(() => setGoal(null)); }, []);
  useEffect(load, [load]);
  if (goal === undefined) return null;

  if (!goal) {
    return (
      <>
        <Pressable onPress={() => setEditing(true)} style={s.empty} accessibilityRole="button">
          <Text style={s.emptyText}>🎯 <Text style={{ fontWeight: '800' }}>Fissa un obiettivo</Text>{inFamily ? ' per la famiglia' : ''}: "200 € entro Natale"</Text>
        </Pressable>
        <GoalSheet visible={editing} goal={null} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />
      </>
    );
  }

  const since = goal.start_date;
  const saved = Math.round(entries.filter((e) => e.created_at.slice(0, 10) >= since).reduce((t, e) => t + value(e), 0) * 100) / 100;
  const pct = Math.max(0, Math.min(1, saved / goal.amount));
  const done = saved >= goal.amount;
  const today = new Date().toISOString().slice(0, 10);
  const daysLeft = goal.deadline ? Math.round((Date.parse(goal.deadline) - Date.parse(today)) / 86_400_000) : null;
  const missing = Math.max(0, goal.amount - saved);

  return (
    <>
      <Card style={[s.card, done && { borderColor: colors.success, borderWidth: 2 }]}>
        <View style={s.head}>
          <Text style={s.title} numberOfLines={1}>{done ? '🎉' : '🎯'} {goal.title}</Text>
          <Pressable onPress={() => setEditing(true)} hitSlop={8}><Text style={s.link}>Modifica</Text></Pressable>
        </View>
        <Text style={s.big}>{euro(Math.max(0, saved))} <Text style={s.of}>di {euro(goal.amount)}</Text></Text>
        <View style={s.track}><View style={[s.fill, { width: `${Math.max(2, pct * 100)}%` }, done && { backgroundColor: colors.success }]} /></View>
        <Text style={s.muted}>
          {done ? `Obiettivo raggiunto! Brav${inFamily ? 'i' : 'o'} 🐷`
            : `Mancano ${euro(missing)}${daysLeft != null ? (daysLeft >= 0 ? ` · ${daysLeft === 0 ? 'scade oggi' : `${daysLeft} giorni al ${dayLabel(goal.deadline!)}`}` : ' · scadenza passata') : ''}`}
          {' '}· dal {dayLabel(since)}{inFamily ? ' · conta la spesa di tutti' : ''}
        </Text>
      </Card>
      <GoalSheet visible={editing} goal={goal} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />
    </>
  );
}

function GoalSheet({ visible, goal, onClose, onSaved }: { visible: boolean; goal: SavingGoal | null; onClose: () => void; onSaved: () => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [deadline, setDeadline] = useState<string | null>(null);
  const [pick, setPick] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setTitle(goal?.title ?? ''); setAmount(goal ? String(goal.amount).replace('.', ',') : ''); setDeadline(goal?.deadline ?? null); setPick(false); setErr(null);
  }, [visible]);
  const save = async (restart = false) => {
    const n = parseEuro(amount);
    if (!Number.isFinite(n) || n <= 0) { setErr('Scrivi quanto vuoi risparmiare'); return; }
    setBusy(true); setErr(null);
    try { await api.setSavingGoal(title.trim() || 'Il nostro obiettivo', n, deadline, restart || !goal); onSaved(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await confirmAsk('Togliere l\'obiettivo?', 'Sparisce per tutta la famiglia. Puoi fissarne uno nuovo quando vuoi.', 'Togli'))) return;
    setBusy(true); try { await api.deleteSavingGoal(); onSaved(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.bg} onPress={onClose}>
        <Pressable style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + spacing.md }]} onPress={() => {}}>
          <Text style={s.sheetTitle}>🎯 Obiettivo di risparmio</Text>
          <Text style={s.label}>Per cosa?</Text>
          <TextInput value={title} onChangeText={setTitle} placeholder="Regali di Natale, vacanze…" placeholderTextColor={colors.textSecondary} style={s.input} maxLength={60} />
          <Text style={s.label}>Quanto?</Text>
          <View style={s.amountRow}>
            <Text style={s.euro}>€</Text>
            <TextInput value={amount} onChangeText={(t) => setAmount(t.replace(/[^0-9.,]/g, ''))} keyboardType="decimal-pad" placeholder="200"
              placeholderTextColor={colors.textSecondary} style={[s.input, { flex: 1 }]} />
          </View>
          <Text style={s.label}>Entro quando? (facoltativo)</Text>
          <View style={s.row}>
            <Pressable onPress={() => { setDeadline(null); setPick(false); }} style={[s.chip, !deadline && s.on]}><Text style={s.chipText}>Senza data</Text></Pressable>
            <Pressable onPress={() => { setPick(true); if (!deadline) setDeadline(`${new Date().getFullYear()}-12-24`); }} style={[s.chip, !!deadline && s.on]}>
              <Text style={s.chipText}>📅 {deadline ? dayLabel(deadline) : 'Scegli il giorno'}</Text>
            </Pressable>
          </View>
          {pick && deadline && <DatePicker value={deadline} onChange={setDeadline} />}
          {err && <Text style={{ color: colors.danger }}>{err}</Text>}
          <PrimaryButton label={goal ? 'Salva' : 'Fissa l\'obiettivo'} icon="flag-outline" onPress={() => save(false)} loading={busy} style={{ marginTop: spacing.md }} />
          {goal && <PrimaryButton label="Ricomincia da oggi" variant="secondary" onPress={() => save(true)} disabled={busy} style={{ marginTop: spacing.sm }} />}
          {goal && (
            <Pressable onPress={remove} style={{ alignSelf: 'center', padding: spacing.md }}><Text style={{ color: colors.danger }}>Togli l'obiettivo</Text></Pressable>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  card: { padding: spacing.lg, gap: spacing.sm, marginTop: spacing.md },
  empty: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.primary, backgroundColor: c.surface },
  emptyText: { color: c.text, fontSize: 14, lineHeight: 20 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  title: { flex: 1, color: c.text, fontSize: 16, fontWeight: '800' },
  link: { color: c.primary, fontWeight: '700', fontSize: 14 },
  big: { color: c.text, fontSize: 24, fontWeight: '800' },
  of: { color: c.textSecondary, fontSize: 15, fontWeight: '600' },
  track: { height: 14, borderRadius: 7, backgroundColor: c.surfaceMuted, overflow: 'hidden' },
  fill: { height: 14, borderRadius: 7, backgroundColor: c.primary },
  muted: { color: c.textSecondary, fontSize: 13, lineHeight: 18 },
  bg: { flex: 1, backgroundColor: c.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, gap: spacing.sm,
    width: '100%', maxWidth: 640, alignSelf: 'center' },
  sheetTitle: { color: c.text, fontSize: 20, fontWeight: '800' },
  label: { color: c.text, fontSize: 14, fontWeight: '700', marginTop: spacing.sm },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: spacing.md, color: c.text, backgroundColor: c.background, fontSize: 16 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  euro: { color: c.text, fontSize: 20, fontWeight: '700' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border },
  on: { backgroundColor: c.primarySoft, borderColor: c.primary },
  chipText: { color: c.text, fontSize: 14 },
}));
