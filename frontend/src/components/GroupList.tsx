/**
 * #21: la lista di un gruppo dentro la scheda Lista. Si aggiunge con la ricerca e le categorie di sempre;
 * qui sotto le righe del gruppo con "Lo prendo io", le proposte e chi c'è.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Pressable, Text, View } from 'react-native';

import { api, ListItem } from '../api';
import { IS_CLOUD, uid } from '../cloud/client';
import {
  addGroupItem, eventLabel, Group, GroupItem, groupItems, GroupMember, groupMembers, myGroups, removeGroupItem, similarName,
  updateGroupItem, watchList,
} from '../cloud/groups';
import { formatQty, qtyStep } from '../format';
import { shareInvite } from '../invite';
import { customId, useStore } from '../store';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { QtyStepper } from './QtyStepper';
import { Icon } from './ui';

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

const useStyles = makeStyles((c) => ({
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
}));
