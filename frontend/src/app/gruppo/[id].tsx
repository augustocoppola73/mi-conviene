/**
 * Gruppo evento (#14): lista condivisa in tempo reale, una riga per prodotto.
 * Ognuno aggiunge; su ogni riga "Lo prendo io" (con l'iniziale di chi lo prende); preso · mancava · da prendere.
 */
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/api';
import { uid } from '@/cloud/client';
import {
  addGroupItem, eventLabel, Group, GroupItem, groupInfo, groupItems, GroupMember, groupMembers, leaveGroup,
  removeGroupItem, setMuted, updateGroupItem, watchList,
} from '@/cloud/groups';
import { GroupSheet } from '@/components/GroupSheet';
import { QtyStepper } from '@/components/QtyStepper';
import { Icon, PrimaryButton } from '@/components/ui';
import { formatQty, qtyStep } from '@/format';
import { shareInvite } from '@/invite';
import { useStore } from '@/store';
import { makeStyles, radius, spacing, useTheme } from '@/theme';

const PALETTE = ['#4F6B4A', '#B5652B', '#3E6C8F', '#8A4F7D', '#A0812A', '#5E5BA6', '#2F7F73', '#A24848'];
const colorOf = (id: string | null) => PALETTE[id ? [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % PALETTE.length : 0];

function tell(m: string) { if (Platform.OS === 'web') globalThis.alert?.(m); else Alert.alert('Gruppo', m); }
function ask(m: string, ok: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm?.(m) ?? true);
  return new Promise((res) => Alert.alert('Gruppo', m, [{ text: 'Annulla', style: 'cancel', onPress: () => res(false) }, { text: ok, onPress: () => res(true) }]));
}

export default function GruppoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const s = useStyles();
  const { colors } = useTheme();
  const { catalog, prefs } = useStore();
  const [me, setMe] = useState<string | null>(null);
  const [group, setGroup] = useState<Group | null | undefined>(undefined);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [items, setItems] = useState<GroupItem[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [menu, setMenu] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [g, m] = await Promise.all([groupInfo(id), groupMembers(id).catch(() => [])]);
      setGroup(g); setMembers(m);
      if (g?.list_id) setItems(await groupItems(g.list_id));
    } catch { setGroup((x) => (x === undefined ? null : x)); }
  }, [id]);

  useEffect(() => { uid().then(setMe).catch(() => {}); }, []);
  useFocusEffect(useCallback(() => {
    load();
    const t = setInterval(load, 30_000);   // se il tempo reale non arriva (rete), almeno ogni 30 secondi
    return () => clearInterval(t);
  }, [load]));
  const listId = group?.list_id ?? null;
  useEffect(() => (listId ? watchList(listId, () => { groupItems(listId).then(setItems).catch(() => {}); }) : undefined), [listId]);

  const nameOf = (u: string | null) => members.find((m) => m.user_id === u)?.display_name || 'Qualcuno';
  const initial = (u: string | null) => (nameOf(u).trim()[0] || '?').toUpperCase();
  const owner = group?.role === 'proprietario';

  // suggerimenti dal catalogo mentre scrivi
  const q = text.trim().toLowerCase();
  const sugg = useMemo(() => (q.length < 2 || !catalog ? [] : catalog.products.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6)), [q, catalog]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); } catch (e) { tell((e as Error).message); } finally {
      setBusy(null);
      if (listId) groupItems(listId).then(setItems).catch(() => {});
    }
  };
  const add = (p: { id: string; name: string; category_id: string; default_qty: number; unit: string } | null) => listId && run('add', async () => {
    if (p) await addGroupItem(listId, { product_id: p.id, name: p.name, quantity: p.default_qty || 1, unit: p.unit, category_id: p.category_id });
    else await addGroupItem(listId, { product_id: `custom:${q}`, name: text.trim(), quantity: 1, unit: 'pz', category_id: null });
    setText('');
  });

  if (group === undefined) return <SafeAreaView style={s.screen}><ActivityIndicator style={{ marginTop: 80 }} color={colors.primary} /></SafeAreaView>;
  if (!group) {
    return (
      <SafeAreaView style={s.screen}>
        <View style={s.content}>
          <Text style={s.title}>Gruppo non trovato</Text>
          <Text style={s.help}>Forse sei uscito o il gruppo è stato chiuso.</Text>
          <PrimaryButton label="Torna alla lista" onPress={() => router.replace('/')} style={{ marginTop: spacing.lg }} />
        </View>
      </SafeAreaView>
    );
  }

  const todo = items.filter((i) => i.status === 'da_prendere');
  const done = items.filter((i) => i.status === 'preso');
  const missing = items.filter((i) => i.status === 'mancava');
  const mine = todo.filter((i) => i.assigned_to === me).length;

  const invite = () => run('inv', async () => {
    const inv = await api.inviteCreate(group.id);
    const r = await shareInvite(inv.code, prefs.displayName, 'evento', `${group.emoji ? `${group.emoji} ` : ''}${group.name}`);
    if (r === 'copied') tell("Messaggio d'invito copiato: incollalo su WhatsApp o SMS.");
  });
  const leave = async () => {
    const last = members.length <= 1;
    if (!(await ask(last ? 'Sei l\'ultimo: uscendo il gruppo e la sua lista spariscono. Esci?' : 'Esci dal gruppo? Quello che avevi preso e non comprato torna libero.', 'Esci'))) return;
    await run('leave', () => leaveGroup(group.id));
    router.replace('/');
  };

  const Row = ({ it }: { it: GroupItem }) => {
    const p = catalog?.products.find((x) => x.id === it.product_id);
    const unit = it.unit || p?.unit || 'pz';
    const isMine = it.assigned_to === me;
    const free = !it.assigned_to;
    const canTick = free || isMine || owner;
    const canRemove = free && it.status === 'da_prendere' && (it.added_by === me || owner);
    const key = it.id;
    return (
      <View style={[s.row, it.status !== 'da_prendere' && { opacity: 0.6 }]}>
        <Pressable disabled={!canTick || !!busy} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{ checked: it.status === 'preso' }}
          onPress={() => run(key, () => updateGroupItem(it.id, { status: it.status === 'preso' ? 'da_prendere' : 'preso' }))}>
          <Icon name={it.status === 'preso' ? 'checkmark-circle' : it.status === 'mancava' ? 'close-circle' : 'ellipse-outline'} size={24}
            color={it.status === 'preso' ? colors.success : it.status === 'mancava' ? colors.danger : canTick ? colors.primary : colors.border} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[s.itemName, it.status === 'preso' && s.strike]} numberOfLines={2}>{it.name || p?.name || it.product_id}</Text>
          <Text style={s.meta}>
            {formatQty(Number(it.quantity), unit)}
            {it.status === 'mancava' ? ` · mancava${it.assigned_to ? ` (${nameOf(it.assigned_to)})` : ''}` : ''}
            {it.status === 'preso' && it.assigned_to ? ` · preso da ${it.assigned_to === me ? 'te' : nameOf(it.assigned_to)}` : ''}
            {it.added_by && it.added_by !== me && it.status === 'da_prendere' ? ` · aggiunto da ${nameOf(it.added_by)}` : ''}
          </Text>
        </View>
        {it.status === 'da_prendere' && free && (
          <>
            {it.added_by === me && (
              <QtyStepper compact quantity={Number(it.quantity)} unit={unit} step={qtyStep(p?.default_qty ?? 1, unit)}
                onChange={(n) => (n <= 0 ? canRemove && run(key, () => removeGroupItem(it.id)) : run(key, () => updateGroupItem(it.id, { quantity: n })))} />
            )}
            <Pressable onPress={() => me && run(key, () => updateGroupItem(it.id, { assigned_to: me }))} disabled={!!busy} style={s.take} accessibilityRole="button">
              <Text style={s.takeText}>Lo prendo io</Text>
            </Pressable>
          </>
        )}
        {it.status === 'da_prendere' && isMine && (
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <View style={[s.badge, { backgroundColor: colorOf(me) }]}><Text style={s.badgeText}>Io</Text></View>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Text onPress={() => run(key, () => updateGroupItem(it.id, { status: 'mancava' }))} style={s.link}>Mancava</Text>
              <Text onPress={() => run(key, () => updateGroupItem(it.id, { assigned_to: null }))} style={s.link}>Lascia</Text>
            </View>
          </View>
        )}
        {it.status === 'da_prendere' && !free && !isMine && (
          <Pressable disabled={!owner} onPress={async () => { if (await ask(`Liberare "${it.name}" (lo prende ${nameOf(it.assigned_to)})?`, 'Libera')) run(key, () => updateGroupItem(it.id, { assigned_to: null })); }}
            style={[s.badge, { backgroundColor: colorOf(it.assigned_to) }]} accessibilityLabel={`Lo prende ${nameOf(it.assigned_to)}`}>
            <Text style={s.badgeText}>{initial(it.assigned_to)}</Text>
          </Pressable>
        )}
        {it.status !== 'da_prendere' && (isMine || owner) && (
          <Text onPress={() => run(key, () => updateGroupItem(it.id, { status: 'da_prendere' }))} style={s.link}>Annulla</Text>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.head}>
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={10} accessibilityLabel="Indietro">
            <Icon name="chevron-back" size={26} color={colors.text} />
          </Pressable>
          <Text style={s.bigEmoji}>{group.emoji || '🛒'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>{group.name}</Text>
            <Text style={s.help}>{eventLabel(group.event_date)} · {members.length} {members.length === 1 ? 'persona' : 'persone'}</Text>
          </View>
          <Pressable onPress={() => setMenu(!menu)} hitSlop={10} accessibilityLabel="Opzioni del gruppo">
            <Icon name="ellipsis-vertical" size={22} color={colors.text} />
          </Pressable>
        </View>

        <View style={s.members}>
          {members.map((m) => (
            <View key={m.user_id} style={s.member}>
              <View style={[s.badge, { backgroundColor: colorOf(m.user_id) }]}><Text style={s.badgeText}>{(m.display_name || '?').trim()[0]?.toUpperCase()}</Text></View>
              <Text style={s.memberName} numberOfLines={1}>{m.user_id === me ? 'Tu' : m.display_name || 'Senza nome'}{m.role === 'proprietario' ? ' ★' : ''}</Text>
            </View>
          ))}
          {owner && (
            <Pressable onPress={invite} style={s.inviteBtn} accessibilityRole="button" disabled={!!busy}>
              <Icon name="person-add-outline" size={16} color={colors.primary} />
              <Text style={s.link}>{busy === 'inv' ? 'Un attimo…' : 'Invita'}</Text>
            </Pressable>
          )}
        </View>

        {menu && (
          <View style={s.menu}>
            <View style={s.menuRow}>
              <Text style={[s.itemName, { flex: 1 }]}>Avvisi di questo gruppo</Text>
              <Switch value={!group.muted} onValueChange={(v) => run('mute', async () => { await setMuted(group.id, !v); await load(); })}
                trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff" />
            </View>
            {owner && <Text onPress={() => { setMenu(false); setEditOpen(true); }} style={s.menuItem}>✏️ Cambia nome, emoji o data</Text>}
            <Text onPress={leave} style={[s.menuItem, { color: colors.danger }]}>Esci dal gruppo</Text>
          </View>
        )}

        <View style={s.addBox}>
          <TextInput value={text} onChangeText={setText} placeholder="Aggiungi un prodotto…" placeholderTextColor={colors.textSecondary}
            style={s.input} returnKeyType="done" onSubmitEditing={() => q && add(sugg[0] && sugg[0].name.toLowerCase() === q ? sugg[0] : null)} />
          {q.length > 0 && (
            <View style={s.sugg}>
              {sugg.map((p) => (
                <Pressable key={p.id} onPress={() => add(p)} style={s.suggRow}>
                  <Text style={s.itemName}>{catalog?.categories.find((c) => c.id === p.category_id)?.emoji} {p.name}</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => add(null)} style={s.suggRow}><Text style={s.link}>+ Aggiungi «{text.trim()}»</Text></Pressable>
            </View>
          )}
        </View>

        <Text style={s.section}>Da prendere · {todo.length}{mine ? ` · ${mine === 1 ? '1 lo prendi tu' : `${mine} li prendi tu`}` : ''}</Text>
        {!todo.length && <Text style={s.help}>Niente da prendere. Aggiungi qui sopra: lo vedono subito tutti.</Text>}
        {[...todo.filter((i) => !i.assigned_to), ...todo.filter((i) => i.assigned_to === me), ...todo.filter((i) => i.assigned_to && i.assigned_to !== me)]
          .map((it) => <Row key={it.id} it={it} />)}
        {done.length > 0 && <Text style={s.section}>Presi · {done.length}</Text>}
        {done.map((it) => <Row key={it.id} it={it} />)}
        {missing.length > 0 && <Text style={s.section}>Mancavano · {missing.length}</Text>}
        {missing.map((it) => <Row key={it.id} it={it} />)}
      </ScrollView>
      <GroupSheet visible={editOpen} onClose={() => setEditOpen(false)} edit={group} onSaved={() => load()} />
    </SafeAreaView>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.background },
  content: { width: '100%', maxWidth: 640, alignSelf: 'center', padding: spacing.lg, paddingBottom: 80, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  bigEmoji: { fontSize: 34 },
  title: { color: c.text, fontSize: 24, fontWeight: '800' },
  help: { color: c.textSecondary, fontSize: 13, lineHeight: 18 },
  members: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center', marginTop: spacing.sm },
  member: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 140 },
  memberName: { color: c.text, fontSize: 13 },
  inviteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: c.primary },
  badge: { minWidth: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  menu: { backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.md, gap: spacing.sm },
  menuRow: { flexDirection: 'row', alignItems: 'center' },
  menuItem: { color: c.text, fontSize: 15, paddingVertical: 4 },
  addBox: { marginTop: spacing.md },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: spacing.md, color: c.text, backgroundColor: c.surface, fontSize: 16 },
  sugg: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, marginTop: 4 },
  suggRow: { paddingHorizontal: spacing.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border },
  section: { color: c.text, fontSize: 15, fontWeight: '800', marginTop: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: c.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.md, paddingVertical: 10 },
  itemName: { color: c.text, fontSize: 15 },
  strike: { textDecorationLine: 'line-through' },
  meta: { color: c.textSecondary, fontSize: 12, marginTop: 2 },
  take: { backgroundColor: c.primary, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  takeText: { color: c.primaryText, fontWeight: '700', fontSize: 13 },
  link: { color: c.primary, fontWeight: '700', fontSize: 13 },
}));
