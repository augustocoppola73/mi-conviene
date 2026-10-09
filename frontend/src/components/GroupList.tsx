/**
 * #21: la lista di un gruppo dentro la scheda Lista. Si aggiunge con la ricerca e le categorie di sempre;
 * qui sotto le righe del gruppo con "Lo prendo io", le proposte e chi c'è.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { api, HelpOption, ListItem } from '../api';
import { IS_CLOUD, uid } from '../cloud/client';
import {
  addGroupItem, eventLabel, Group, GroupItem, groupItems, GroupMember, groupMembers, myGroups, removeGroupItem, similarName,
  updateGroupItem, watchList,
} from '../cloud/groups';
import { euro, formatQty, qtyStep } from '../format';
import { shareInvite } from '../invite';
import { customId, useStore } from '../store';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { QtyStepper } from './QtyStepper';
import { Icon, PrimaryButton } from './ui';

const PALETTE = ['#4F6B4A', '#B5652B', '#3E6C8F', '#8A4F7D', '#A0812A', '#5E5BA6', '#2F7F73', '#A24848'];
export const colorOf = (id: string | null) => PALETTE[id ? [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % PALETTE.length : 0];

export function tell(m: string) { if (Platform.OS === 'web') globalThis.alert?.(m); else Alert.alert('Gruppo', m); }
export function ask(m: string, ok: string, no = 'Annulla'): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm?.(m) ?? false);
  return new Promise((res) => Alert.alert('Gruppo', m, [{ text: no, style: 'cancel', onPress: () => res(false) }, { text: ok, onPress: () => res(true) }]));
}

const active = (i: GroupItem) => i.status === 'da_prendere' || i.status === 'proposto';

/** Stato della lista di un gruppo + le azioni che usa la scheda Lista (aggiungi, togli, quantità). */
export function useGroupList(groupId: string | null) {
  const { productById, reloadGroupMine } = useStore();
  const [me, setMe] = useState<string | null>(null);
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [items, setItems] = useState<GroupItem[]>([]);
  const [missing, setMissing] = useState(false);

  const reload = useCallback(async () => {
    if (!groupId || !IS_CLOUD) return;
    const g = (await myGroups().catch(() => [])).find((x) => x.id === groupId) ?? null;
    if (!g) { setMissing(true); return; }
    setGroup(g);
    const [m, its] = await Promise.all([groupMembers(groupId).catch(() => []), g.list_id ? groupItems(g.list_id).catch(() => []) : []]);
    setMembers(m); setItems(its);
  }, [groupId]);

  useEffect(() => { uid().then(setMe).catch(() => {}); }, []);
  useEffect(() => {
    setGroup(null); setItems([]); setMembers([]); setMissing(false);
    if (!groupId) return;
    reload();
    const t = setInterval(reload, 30_000);
    return () => clearInterval(t);
  }, [groupId, reload]);
  const listId = group?.list_id ?? null;
  useEffect(() => (listId ? watchList(listId, () => { groupItems(listId).then(setItems).catch(() => {}); }) : undefined), [listId]);

  const owner = group?.role === 'proprietario';
  const nameOf = (u: string | null) => (u === me ? 'tu' : members.find((m) => m.user_id === u)?.display_name || 'qualcuno');
  const rowOf = (pid: string) => items.find((i) => i.product_id === pid && active(i));

  const after = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { tell((e as Error).message); }
    if (listId) setItems(await groupItems(listId).catch(() => items));
    reloadGroupMine();
  };

  const add = (pid: string, quantity: number, extra?: { name: string; category_id: string; unit: string }) => after(async () => {
    if (!listId) return;
    const p = productById(pid);
    await addGroupItem(listId, {
      product_id: pid, name: p?.name ?? extra?.name ?? pid.slice(7), quantity,
      unit: p?.unit ?? extra?.unit ?? 'pz', category_id: p?.category_id ?? extra?.category_id ?? null,
    });
  });

  /** il prodotto c'è già: proponi di aumentare la quantità invece di una seconda riga */
  const offerMore = async (row: GroupItem, step: number) => {
    const unit = row.unit || 'pz';
    if (row.assigned_to && row.assigned_to !== me && !owner) {
      tell(`«${row.name}» c'è già e lo prende ${nameOf(row.assigned_to)} (${formatQty(Number(row.quantity), unit)}). Se ne serve di più, diglielo.`);
      return;
    }
    const next = Math.round((Number(row.quantity) + step) * 1000) / 1000;
    if (await ask(`«${row.name}» c'è già (${row.added_by === me ? 'l\'hai aggiunto tu' : `l'ha aggiunto ${nameOf(row.added_by)}`}, ${formatQty(Number(row.quantity), unit)}). Aumento a ${formatQty(next, unit)}?`, `Aumenta a ${formatQty(next, unit)}`, 'Lascia così')) {
      await after(() => updateGroupItem(row.id, { quantity: next }));
    }
  };

  const canRemove = (r: GroupItem) => active(r) && !r.assigned_to && (r.added_by === me || owner);

  const facade = {
    itemFor: (pid: string): ListItem | undefined => {
      const r = rowOf(pid);
      return r ? { product_id: pid, quantity: Number(r.quantity) } : undefined;
    },
    has: (pid: string) => !!rowOf(pid),
    toggle: async (pid: string) => {
      const r = rowOf(pid);
      const p = productById(pid);
      if (!r) return add(pid, p?.default_qty ?? 1);
      if (canRemove(r) && r.added_by === me) return after(async () => { await removeGroupItem(r.id); });
      return offerMore(r, qtyStep(p?.default_qty ?? 1, p?.unit ?? 'pz'));
    },
    addCustom: async (name: string, category_id: string, quantity = 1, unit = 'pz') => {
      const clean = name.trim();
      if (!clean) return;
      const same = items.find((i) => active(i) && similarName(i.name || '', clean));
      if (same) {
        if (await ask(`C'è già «${same.name}» (${nameOf(same.added_by)}, ${formatQty(Number(same.quantity), same.unit || 'pz')}). È la stessa cosa?`, 'Sì, aumento', 'No, è un\'altra')) {
          return offerMore(same, 1);
        }
      }
      return add(customId(clean), quantity, { name: clean, category_id, unit });
    },
    updateQty: (pid: string, q: number) => {
      const r = rowOf(pid);
      if (!r) return;
      if (q <= 0) { if (canRemove(r)) after(async () => { await removeGroupItem(r.id); }); return; }
      after(() => updateGroupItem(r.id, { quantity: q }));
    },
  };

  return { me, group, members, items, missing, owner, nameOf, reload, after, canRemove, facade };
}

export type GroupListState = ReturnType<typeof useGroupList>;

/** Una riga della lista del gruppo. */
export function GroupItemRow({ it, gl }: { it: GroupItem; gl: GroupListState }) {
  const s = useStyles();
  const { colors } = useTheme();
  const { productById } = useStore();
  const { me, owner, nameOf, after, canRemove } = gl;
  const p = productById(it.product_id);
  const unit = it.unit || p?.unit || 'pz';
  const isMine = !!me && it.assigned_to === me;
  const free = !it.assigned_to;
  const canTick = it.status !== 'proposto' && (free || isMine || owner);
  const initial = (u: string | null) => (nameOf(u).trim()[0] || '?').toUpperCase();

  if (it.status === 'proposto') {
    return (
      <View style={[s.row, s.proposed]}>
        <Text style={{ fontSize: 18 }}>🙋</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.name} numberOfLines={2}>{it.name || p?.name || it.product_id}</Text>
          <Text style={s.meta}>{formatQty(Number(it.quantity), unit)} · proposto da {nameOf(it.added_by)}{owner ? '' : ' · aspetta chi ha creato il gruppo'}</Text>
        </View>
        {owner && <Text onPress={() => after(() => updateGroupItem(it.id, { status: 'da_prendere' }))} style={s.link}>Aggiungi</Text>}
        {canRemove(it) && <Text onPress={() => after(() => removeGroupItem(it.id))} style={[s.link, { color: colors.danger }]}>{it.added_by === me ? 'Ritira' : 'No'}</Text>}
      </View>
    );
  }
  return (
    <View style={[s.row, it.status !== 'da_prendere' && { opacity: 0.6 }]}>
      <Pressable disabled={!canTick} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{ checked: it.status === 'preso' }}
        onPress={() => after(() => updateGroupItem(it.id, { status: it.status === 'preso' ? 'da_prendere' : 'preso' }))}>
        <Icon name={it.status === 'preso' ? 'checkmark-circle' : it.status === 'mancava' ? 'close-circle' : 'ellipse-outline'} size={24}
          color={it.status === 'preso' ? colors.success : it.status === 'mancava' ? colors.danger : canTick ? colors.primary : colors.border} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={[s.name, it.status === 'preso' && s.strike]} numberOfLines={2}>{it.name || p?.name || it.product_id}</Text>
        <Text style={s.meta}>
          {formatQty(Number(it.quantity), unit)}
          {it.status === 'mancava' ? ` · mancava (${nameOf(it.assigned_to)})` : ''}
          {it.status === 'preso' && it.assigned_to ? ` · preso da ${nameOf(it.assigned_to)}` : ''}
          {it.status === 'da_prendere' && it.added_by && it.added_by !== me ? ` · aggiunto da ${nameOf(it.added_by)}` : ''}
        </Text>
      </View>
      {it.status === 'da_prendere' && (free || isMine) && (
        <QtyStepper compact quantity={Number(it.quantity)} unit={unit} step={qtyStep(p?.default_qty ?? 1, unit)}
          onChange={(n) => (n <= 0 ? canRemove(it) && after(() => removeGroupItem(it.id)) : after(() => updateGroupItem(it.id, { quantity: n })))} />
      )}
      {it.status === 'da_prendere' && free && (
        <Pressable onPress={() => me && after(() => updateGroupItem(it.id, { assigned_to: me }))} style={s.take} accessibilityRole="button">
          <Text style={s.takeText}>Lo prendo io</Text>
        </Pressable>
      )}
      {it.status === 'da_prendere' && isMine && (
        <Pressable onPress={() => after(() => updateGroupItem(it.id, { assigned_to: null }))} style={[s.badge, { backgroundColor: colorOf(me) }]}
          accessibilityLabel="Lo prendi tu: tocca per lasciarlo">
          <Text style={s.badgeText}>Io</Text>
        </Pressable>
      )}
      {it.status === 'da_prendere' && !free && !isMine && (
        <Pressable disabled={!owner} onPress={async () => { if (await ask(`Liberare «${it.name}» (lo prende ${nameOf(it.assigned_to)})?`, 'Libera')) after(() => updateGroupItem(it.id, { assigned_to: null })); }}
          style={[s.badge, { backgroundColor: colorOf(it.assigned_to) }]} accessibilityLabel={`Lo prende ${nameOf(it.assigned_to)}`}>
          <Text style={s.badgeText}>{initial(it.assigned_to)}</Text>
        </Pressable>
      )}
      {it.status !== 'da_prendere' && (isMine || owner) && (
        <Text onPress={() => after(() => updateGroupItem(it.id, { status: 'da_prendere' }))} style={s.link}>Annulla</Text>
      )}
    </View>
  );
}

/** La parte "lista" della scheda quando è scelto un gruppo. */
export function GroupListPanel({ gl }: { gl: GroupListState }) {
  const s = useStyles();
  const { colors } = useTheme();
  const { prefs, setPrefs } = useStore();
  const { group, members, items, me, owner, after } = gl;
  const [showDone, setShowDone] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  if (gl.missing) {
    return (
      <View style={s.card}>
        <Text style={s.name}>Questo gruppo non c'è più (o ne sei uscito).</Text>
        <Text onPress={() => setPrefs({ activeList: null })} style={s.link}>Torna alla mia lista</Text>
      </View>
    );
  }
  if (!group) return <Text style={s.meta}>Carico il gruppo…</Text>;
  const proposals = items.filter((i) => i.status === 'proposto');
  const todo = items.filter((i) => i.status === 'da_prendere');
  const done = items.filter((i) => i.status === 'preso' || i.status === 'mancava');
  const freeOnes = todo.filter((i) => !i.assigned_to);
  const mine = todo.filter((i) => i.assigned_to === me).length;
  const invite = () => after(async () => {
    const inv = await api.inviteCreate(group.id);
    const r = await shareInvite(inv.code, prefs.displayName, 'evento', `${group.emoji ? `${group.emoji} ` : ''}${group.name}`);
    if (r === 'copied') tell("Messaggio d'invito copiato: incollalo su WhatsApp o SMS.");
  });
  const takeAll = async () => {
    if (!me || !freeOnes.length) return;
    if (!(await ask(`Prendi tu tutti i ${freeOnes.length} prodotti liberi?`, 'Li prendo io'))) return;
    await after(async () => { for (const i of freeOnes) await updateGroupItem(i.id, { assigned_to: me }).catch(() => {}); });
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={s.card}>
        <View style={s.headRow}>
          <Text style={{ fontSize: 28 }}>{group.emoji || '🛒'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>{group.name}</Text>
            <Text style={s.meta}>{eventLabel(group.event_date)} · {group.add_policy === 'proprietario' ? (owner ? 'aggiungi tu, gli altri propongono' : 'proponi, decide chi l\'ha creato') : 'tutti aggiungono'}</Text>
          </View>
          <Pressable onPress={() => router.push(`/gruppo/${group.id}?tab=conti`)} hitSlop={8} accessibilityLabel="Conti del gruppo" style={s.contiBtn}>
            <Text style={s.link}>💶 Conti</Text>
          </Pressable>
          <Pressable onPress={() => router.push(`/gruppo/${group.id}`)} hitSlop={8} accessibilityLabel="Impostazioni del gruppo">
            <Icon name="settings-outline" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>
        <View style={s.members}>
          {members.map((m) => (
            <View key={m.user_id} style={s.member}>
              <View style={[s.badge, { backgroundColor: colorOf(m.user_id) }]}><Text style={s.badgeText}>{(m.display_name || '?').trim()[0]?.toUpperCase()}</Text></View>
              <Text style={s.meta} numberOfLines={1}>{m.user_id === me ? 'Tu' : m.display_name || 'Senza nome'}{m.role === 'proprietario' ? ' ★' : ''}</Text>
            </View>
          ))}
          {owner && (
            <Pressable onPress={invite} style={s.inviteBtn} accessibilityRole="button">
              <Icon name="person-add-outline" size={16} color={colors.primary} />
              <Text style={s.link}>Invita</Text>
            </Pressable>
          )}
        </View>
      </View>

      {proposals.length > 0 && (
        <>
          <Text style={s.section}>{owner ? `Proposte da decidere · ${proposals.length}` : `Proposte in attesa · ${proposals.length}`}</Text>
          {proposals.map((it) => <GroupItemRow key={it.id} it={it} gl={gl} />)}
        </>
      )}

      {freeOnes.length > 0 && (
        <Pressable onPress={() => setHelpOpen(true)} style={s.helpBtn} accessibilityRole="button">
          <Text style={{ fontSize: 18 }}>💡</Text>
          <View style={{ flex: 1 }}>
            <Text style={[s.name, { fontWeight: '700' }]}>Cosa conviene prendere a me?</Text>
            <Text style={s.meta}>Guardo i negozi vicino a te: ti propongo i prodotti liberi che lì costano meno.</Text>
          </View>
          <Icon name="chevron-forward" size={18} color={colors.primary} />
        </Pressable>
      )}
      <GroupHelpSheet visible={helpOpen} onClose={() => setHelpOpen(false)} gl={gl} />

      <View style={s.sectionRow}>
        <Text style={[s.section, { flex: 1 }]}>Da prendere · {todo.length}{mine ? ` · ${mine === 1 ? '1 lo prendi tu' : `${mine} li prendi tu`}` : ''}</Text>
        {freeOnes.length > 1 && <Text onPress={takeAll} style={s.link}>Prendo tutti i liberi</Text>}
      </View>
      {!todo.length && <Text style={s.meta}>Niente da prendere. Cerca o tocca una categoria qui sopra: lo vedono subito tutti.</Text>}
      {[...freeOnes, ...todo.filter((i) => i.assigned_to === me), ...todo.filter((i) => i.assigned_to && i.assigned_to !== me)]
        .map((it) => <GroupItemRow key={it.id} it={it} gl={gl} />)}
      {done.length > 0 && (
        <Text onPress={() => setShowDone(!showDone)} style={[s.link, { marginTop: spacing.sm }]}>
          {showDone ? 'Nascondi' : 'Mostra'} presi e mancati ({done.length})
        </Text>
      )}
      {showDone && done.map((it) => <GroupItemRow key={it.id} it={it} gl={gl} />)}
    </View>
  );
}

/** #15: "Cosa conviene prendere a me" — negozio vicino a me e prodotti liberi che lì costano meno; "Li prendo io". */
function GroupHelpSheet({ visible, onClose, gl }: { visible: boolean; onClose: () => void; gl: GroupListState }) {
  const s = useStyles();
  const { colors } = useTheme();
  const { prefs } = useStore();
  const [opts, setOpts] = useState<HelpOption[] | null>(null);
  const [k, setK] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loc = prefs.location;

  useEffect(() => {
    if (!visible) return;
    setOpts(null); setErr(null); setK(0);
    if (!loc) { setErr('Attiva la posizione (Profilo › Negozi): mi serve per sapere quali negozi hai vicino.'); return; }
    const free = gl.items.filter((i) => i.status === 'da_prendere' && !i.assigned_to)
      .map((i) => ({ id: i.id, product_id: i.product_id, name: i.name || i.product_id, quantity: Number(i.quantity), unit: i.unit || 'pz', category_id: i.category_id }));
    api.groupHelpPlan(free, loc.lat, loc.lon, prefs.transport, prefs.fuelType)
      .then((o) => { setOpts(o); if (o[0]) setSel(new Set(o[0].lines.slice(0, o[0].suggested).map((l) => l.key))); })
      .catch((e) => setErr((e as Error).message));
  }, [visible]);

  const pick = (i: number) => { setK(i); const o = opts![i]; setSel(new Set(o.lines.slice(0, o.suggested).map((l) => l.key))); };
  const take = async () => {
    if (!gl.me || !sel.size) return;
    setBusy(true);
    await gl.after(async () => { for (const id of sel) await updateGroupItem(id, { assigned_to: gl.me }).catch(() => {}); });
    setBusy(false); onClose();
    tell(`Fatto: ${sel.size} ${sel.size === 1 ? 'prodotto è tuo' : 'prodotti sono tuoi'}. Li trovi nella tua lista, con l'etichetta del gruppo.`);
  };
  const o = opts?.[k];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.headRow}>
            <Text style={[s.title, { flex: 1 }]}>💡 Cosa conviene prendere a me</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Chiudi"><Icon name="close" size={24} color={colors.textSecondary} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.xl }}>
            {err && <Text style={[s.name, { color: colors.danger }]}>{err}</Text>}
            {!err && !opts && <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.xl }} />}
            {opts && !opts.length && <Text style={s.name}>Vicino a te nessun negozio conviene per i prodotti liberi: prendili dove fai la spesa di solito.</Text>}
            {opts && opts.length > 1 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {opts.map((x, i) => (
                  <Pressable key={x.store_id} onPress={() => pick(i)} style={[s.chip, i === k && s.chipOn]}>
                    <Text style={[s.meta, { marginTop: 0 }, i === k && { color: colors.primaryText, fontWeight: '700' }]}>{x.store_name} · {String(x.distance_km).replace('.', ',')} km</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {o && (
              <>
                <Text style={s.name}>{o.reasoning}</Text>
                {o.lines.map((l) => {
                  const on = sel.has(l.key);
                  return (
                    <Pressable key={l.key} onPress={() => setSel((p) => { const n = new Set(p); if (n.has(l.key)) n.delete(l.key); else n.add(l.key); return n; })} style={s.row}>
                      <Icon name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.primary : colors.textSecondary} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.name} numberOfLines={1}>{l.name}</Text>
                        <Text style={s.meta}>{formatQty(l.quantity, l.unit)} · {euro(l.line_price)}{l.was != null && l.was - l.line_price > 0.04 ? ` invece di ${euro(l.was)}` : ''}</Text>
                      </View>
                    </Pressable>
                  );
                })}
                <PrimaryButton label={`Li prendo io (${sel.size})`} icon="hand-right-outline" onPress={take} loading={busy} disabled={!sel.size} />
                <Text style={s.meta}>Ti propongo circa metà di quello che resta: il resto lo prende qualcun altro. Puoi spuntare o togliere.</Text>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  helpBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: c.primarySoft },
  backdrop: { flex: 1, backgroundColor: c.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg,
    maxHeight: '85%', width: '100%', maxWidth: 640, alignSelf: 'center', paddingBottom: spacing.xl + 24 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border },
  chipOn: { backgroundColor: c.primary, borderColor: c.primary },
  card: { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: spacing.md, gap: spacing.sm },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { color: c.text, fontSize: 18, fontWeight: '800' },
  members: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  member: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 140 },
  inviteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: c.primary },
  section: { color: c.text, fontSize: 15, fontWeight: '800', marginTop: spacing.md },
  sectionRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: c.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.md, paddingVertical: 10 },
  proposed: { borderStyle: 'dashed', backgroundColor: c.surfaceMuted },
  name: { color: c.text, fontSize: 15 },
  strike: { textDecorationLine: 'line-through' },
  meta: { color: c.textSecondary, fontSize: 12, marginTop: 2 },
  take: { backgroundColor: c.primary, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  takeText: { color: c.primaryText, fontWeight: '700', fontSize: 13 },
  badge: { minWidth: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  link: { color: c.primary, fontWeight: '700', fontSize: 13 },
  contiBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: c.primary },
}));
