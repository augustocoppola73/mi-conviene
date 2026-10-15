/**
 * #46 "Organizza la festa": tipo di evento + quante persone → lista con le quantità, da correggere, poi nella lista del gruppo.
 * Se la rifai (es. cambiano le persone) le quantità dei prodotti già in lista e non ancora presi si aggiornano.
 * Funziona nella lista di un gruppo (gl) e nella lista personale (senza gl: un rinfresco a casa tua).
 */
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { addGroupItem, updateGroupItem } from '../cloud/groups';
import { EVENT_TYPES, planEvent, PlanRow } from '../engine/eventPlan';
import { formatQty } from '../format';
import { useStore } from '../store';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import type { GroupListState } from './GroupList';
import { ProductIcon } from './ProductIcon';
import { Icon, PrimaryButton } from './ui';

function Counter({ label, value, onChange, min = 0 }: { label: string; value: number; onChange: (n: number) => void; min?: number }) {
  const s = useStyles();
  return (
    <View style={s.counter}>
      <Text style={s.counterLabel}>{label}</Text>
      <View style={s.counterRow}>
        <Pressable onPress={() => onChange(Math.max(min, value - 1))} style={s.cBtn} hitSlop={6} accessibilityLabel={`Meno ${label}`}><Icon name="remove" size={20} /></Pressable>
        <Text style={s.cValue}>{value}</Text>
        <Pressable onPress={() => onChange(Math.min(200, value + 1))} style={s.cBtn} hitSlop={6} accessibilityLabel={`Più ${label}`}><Icon name="add" size={20} /></Pressable>
      </View>
    </View>
  );
}

const step = (unit: string) => (unit === 'kg' ? 0.1 : unit === 'L' ? 0.5 : 1);

export function EventPlanner({ visible, onClose, gl }: { visible: boolean; onClose: () => void; gl?: GroupListState }) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { prefs, setPrefs, catalog, items, addItem, addCustom, updateQty } = useStore();
  const gid = gl ? gl.group?.id ?? '' : 'mine';
  const saved = prefs.eventPlans?.[gid];
  const [type, setType] = useState(saved?.type ?? (gl ? 'grigliata' : 'rinfresco'));
  const [adults, setAdults] = useState(saved?.adults ?? Math.max(6, gl?.members.length ?? 0));   // #67: un numero da festa, non 2
  const [kids, setKids] = useState(saved?.kids ?? 0);
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { if (visible) { setMsg(null); setRows(planEvent(type, adults, kids)); } }, [visible, type, adults, kids]);
  const catEmoji = useMemo(() => new Map((catalog?.categories ?? []).map((c) => [c.id, c.emoji])), [catalog]);
  const t = EVENT_TYPES.find((x) => x.id === type)!;
  const active = (st: string) => st === 'da_prendere' || st === 'proposto';
  /** cosa c'è già in lista per quel prodotto (gruppo: solo se non mancava; personale: sempre ancora da prendere) */
  const existing = (pid: string): { quantity: number; taken: boolean } | undefined => {
    if (!gl) { const i = items.find((x) => x.product_id === pid); return i && { quantity: i.quantity, taken: false }; }
    const i = gl.items.find((x) => x.product_id === pid && x.status !== 'mancava' && x.kind !== 'porta');
    return i && { quantity: Number(i.quantity), taken: !active(i.status) };
  };

  const applyMine = () => {
    // #67: nella lista personale la festa si AGGIUNGE a quello che hai già (la spesa della settimana resta);
    // se la rifai, tolgo quello che aveva messo la volta prima e metto il nuovo
    const prev = saved?.added ?? {};
    const nowAdded: Record<string, number> = {};
    let added = 0, updated = 0;
    const round = (x: number) => Math.round(x * 1000) / 1000;
    for (const r of rows) {
      const ex = existing(r.product_id);
      nowAdded[r.product_id] = r.quantity;
      if (ex) {
        const base = Math.max(0, ex.quantity - (prev[r.product_id] ?? 0));
        const next = round(base + r.quantity);
        if (next !== ex.quantity) { updateQty(r.product_id, next); updated++; }
      } else if (r.product_id.startsWith('custom:')) { addCustom(r.name, r.category_id, r.quantity, r.unit); added++; }
      else { addItem(r.product_id, r.quantity); added++; }
    }
    // prodotti della festa di prima che ora non ci sono più: tolgo la parte della festa
    for (const [pid, q] of Object.entries(prev)) {
      if (nowAdded[pid] != null) continue;
      const ex = existing(pid);
      if (ex) { updateQty(pid, round(Math.max(0, ex.quantity - q))); updated++; }
    }
    const skipped = 0;
    setPrefs({ eventPlans: { ...(prefs.eventPlans ?? {}), [gid]: { type, adults, kids, added: nowAdded } } });
    onClose();
    globalThis.alert?.(`${t.emoji} Lista pronta: ${added} aggiunti${updated ? `, ${updated} quantità aggiornate` : ''}${skipped ? `, ${skipped} già a posto` : ''}.`);
  };

  const apply = async () => {
    if (!gl) { applyMine(); return; }
    if (!gl.group) return;
    const listId = gl.group.list_id;
    if (!listId) { setMsg('Lista del gruppo non trovata'); return; }
    setBusy(true); setMsg(null);
    let added = 0, updated = 0, skipped = 0;
    const notes: string[] = [];
    const round = (x: number) => Math.round(x * 1000) / 1000;
    for (const r of rows) {
      // #67: quello che c'è già (da prendere, proposto o già preso) conta; l'attivo si porta alla quantità che manca
      const rowsP = gl.items.filter((i) => i.product_id === r.product_id && i.status !== 'mancava' && i.kind !== 'porta');
      const act = rowsP.find((i) => active(i.status));
      const taken = rowsP.filter((i) => i.status === 'preso').reduce((t, i) => t + Number(i.quantity), 0);
      const want = round(Math.max(0, r.quantity - taken));
      try {
        if (act) {
          const mineOrFree = !act.assigned_to || act.assigned_to === gl.me || gl.owner;
          if (Number(act.quantity) === want || want <= 0) skipped++;
          else if (mineOrFree) { await updateGroupItem(act.id, { quantity: want }); updated++; }
          else { notes.push(`${r.name}: lo prende ${gl.nameOf(act.assigned_to)}, digli che ne servono ${formatQty(want, r.unit)}`); skipped++; }
        } else if (want > 0) {
          await addGroupItem(listId, { product_id: r.product_id, name: r.name, quantity: want, unit: r.unit, category_id: r.category_id });
          added++;
          if (taken > 0) notes.push(`${r.name}: già presi ${formatQty(taken, r.unit)}, ne ho aggiunti ${formatQty(want, r.unit)}`);
        } else skipped++;
      } catch (e) { notes.push(`${r.name}: ${(e as Error).message}`); }
    }
    setPrefs({ eventPlans: { ...(prefs.eventPlans ?? {}), [gid]: { type, adults, kids } } });
    await gl.reload();
    setBusy(false);
    onClose();
    globalThis.alert?.(`${t.emoji} Lista pronta: ${added} aggiunti${updated ? `, ${updated} quantità aggiornate` : ''}${skipped ? `, ${skipped} già a posto` : ''}.` +
      (notes.length ? `\n\n${notes.join('\n')}` : '') +
      (gl.group.add_policy === 'proprietario' && !gl.owner ? '\nSono proposte: decide chi ha creato il gruppo.' : ''));
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.bg}>
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + spacing.md }]}>
          <View style={s.head}>
            <Text style={s.title}>✨ Organizza la festa</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Chiudi"><Icon name="close" size={26} color={colors.textSecondary} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }}>
            <Text style={s.label}>Che festa è?</Text>
            <View style={s.types}>
              {EVENT_TYPES.map((e) => (
                <Pressable key={e.id} onPress={() => setType(e.id)} style={[s.type, type === e.id && s.typeOn]} accessibilityRole="button" accessibilityState={{ selected: type === e.id }}>
                  <Text style={{ fontSize: 26 }}>{e.emoji}</Text>
                  <Text style={[s.typeText, type === e.id && { fontWeight: '800' }]} numberOfLines={2}>{e.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={s.hint}>{t.hint}</Text>
            <Text style={s.label}>Quante persone?</Text>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <Counter label="Adulti" value={adults} onChange={setAdults} min={1} />
              <Counter label="Bambini" value={kids} onChange={setKids} />
            </View>
            <Text style={s.hint}>I bambini contano mezza porzione e niente alcolici. Puoi correggere tutto qui sotto.</Text>
            <Text style={s.label}>La lista ({rows.length})</Text>
            {rows.map((r, k) => {
              const ex = existing(r.product_id);
              return (
                <View key={r.product_id} style={s.row}>
                  <ProductIcon name={r.name} productId={r.product_id} categoryEmoji={catEmoji.get(r.category_id)} size={34} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.name} numberOfLines={1}>{r.name}</Text>
                    {ex && <Text style={s.hint}>già in lista: {formatQty(ex.quantity, r.unit)}{ex.taken ? ' (preso)' : ''}</Text>}
                  </View>
                  <Pressable onPress={() => setRows(rows.map((x, j) => (j === k ? { ...x, quantity: Math.max(step(x.unit), Math.round((x.quantity - step(x.unit)) * 10) / 10) } : x)))} style={s.qBtn} hitSlop={4} accessibilityLabel={`Meno ${r.name}`}>
                    <Icon name="remove" size={16} />
                  </Pressable>
                  <Text style={s.qty}>{formatQty(r.quantity, r.unit)}</Text>
                  <Pressable onPress={() => setRows(rows.map((x, j) => (j === k ? { ...x, quantity: Math.round((x.quantity + step(x.unit)) * 10) / 10 } : x)))} style={s.qBtn} hitSlop={4} accessibilityLabel={`Più ${r.name}`}>
                    <Icon name="add" size={16} />
                  </Pressable>
                  <Pressable onPress={() => setRows(rows.filter((_, j) => j !== k))} hitSlop={8} accessibilityLabel={`Togli ${r.name}`}>
                    <Icon name="close" size={18} color={colors.textSecondary} />
                  </Pressable>
                </View>
              );
            })}
            {msg && <Text style={{ color: colors.danger }}>{msg}</Text>}
          </ScrollView>
          {busy ? <ActivityIndicator color={colors.primary} /> : (
            <PrimaryButton label={`Metti in lista ${rows.length} prodotti`} icon="sparkles" onPress={apply} disabled={!rows.length} />
          )}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  bg: { flex: 1, backgroundColor: c.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, paddingBottom: 0,
    maxHeight: '92%', width: '100%', maxWidth: 640, alignSelf: 'center', gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: c.text, fontSize: 20, fontWeight: '800' },
  label: { color: c.text, fontSize: 15, fontWeight: '800', marginTop: spacing.sm },
  hint: { color: c.textSecondary, fontSize: 12.5, lineHeight: 17 },
  types: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  type: { width: '23%', minWidth: 74, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 2, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, gap: 2 },
  typeOn: { borderColor: c.primary, backgroundColor: c.primarySoft, borderWidth: 2 },
  typeText: { color: c.text, fontSize: 11.5, textAlign: 'center' },
  counter: { flex: 1, padding: spacing.sm, borderRadius: radius.md, backgroundColor: c.surfaceMuted, alignItems: 'center', gap: 4 },
  counterLabel: { color: c.textSecondary, fontSize: 13, fontWeight: '600' },
  counterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface },
  cValue: { color: c.text, fontSize: 22, fontWeight: '800', minWidth: 36, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: c.border },
  name: { color: c.text, fontSize: 14, fontWeight: '600' },
  qty: { color: c.text, fontSize: 13, fontWeight: '700', minWidth: 52, textAlign: 'center' },
  qBtn: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceMuted },
}));
