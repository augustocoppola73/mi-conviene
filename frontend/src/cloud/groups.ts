/** Gruppi evento (#14): solo versione online. Lista del gruppo una riga per prodotto, in tempo reale. */
import { check, sb, uid } from './client';

export interface Group {
  id: string; name: string; emoji: string | null; event_date: string | null;
  role: 'proprietario' | 'membro'; members: number; todo: number; muted: boolean; list_id: string | null;
  /** chi aggiunge alla lista: tutti, o solo il proprietario (gli altri propongono) */
  add_policy: AddPolicy; proposals: number;
}
export type AddPolicy = 'tutti' | 'proprietario';
/** un prodotto che prendo io per un gruppo: compare nella mia lista di casa (#21) */
export interface MyGroupItem {
  id: string; group_id: string; group_name: string; group_emoji: string | null;
  product_id: string; name: string | null; quantity: number; unit: string | null; category_id: string | null;
}
export interface GroupMember { user_id: string; display_name: string | null; role: 'proprietario' | 'membro'; joined_at: string }
export type ItemStatus = 'proposto' | 'da_prendere' | 'preso' | 'mancava';
export interface GroupItem {
  id: string; list_id: string; product_id: string; name: string | null; quantity: number; unit: string | null;
  category_id: string | null; added_by: string | null; assigned_to: string | null; status: ItemStatus;
  created_at: string; updated_at: string;
}

const msg = (e: { message: string } | null, fallback?: string) => {
  if (!e) return null;
  if (e.message.includes('group_list_items_unico') || e.message.includes('duplicate key')) return new Error('C\'è già nella lista del gruppo');
  return new Error(e.message.includes('row-level security') ? (fallback || 'Non hai il permesso') : e.message);
};

export async function myGroups(): Promise<Group[]> {
  return (check(await sb().rpc('my_groups')) ?? []) as Group[];
}

export async function groupInfo(id: string): Promise<Group | null> {
  return (await myGroups()).find((g) => g.id === id) ?? null;
}

export async function createGroup(name: string, emoji: string | null, date: string | null, policy: AddPolicy = 'tutti'): Promise<string> {
  const r = check(await sb().rpc('create_group', { p_name: name, p_emoji: emoji, p_date: date, p_policy: policy })) as any;
  return r.id as string;
}

export async function updateGroup(id: string, name: string, emoji: string | null, date: string | null, policy?: AddPolicy): Promise<void> {
  check(await sb().rpc('update_group', { g: id, p_name: name, p_emoji: emoji, p_date: date, p_policy: policy ?? null }));
}

/** i prodotti che prendo io nei miei gruppi, ancora da comprare */
export async function myGroupItems(): Promise<MyGroupItem[]> {
  return ((check(await sb().rpc('my_group_items')) ?? []) as MyGroupItem[]).map((i) => ({ ...i, quantity: Number(i.quantity) }));
}

/** dopo la spesa: la parte del gruppo diventa una spesa pagata da me (per i conti, #16) */
export async function addGroupExpense(groupId: string, amount: number, note: string): Promise<void> {
  const me = await uid();
  const { error } = await sb().from('group_expenses').insert({ group_id: groupId, paid_by: me, amount: Math.round(amount * 100) / 100, note: note.slice(0, 120) });
  const e = msg(error); if (e) throw e;
}

/** nome "uguale" per i prodotti scritti a mano: "Coca" ~ "coca cola" */
export function similarName(a: string, b: string): boolean {
  const n = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const x = n(a), y = n(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.length >= 3 && (l.startsWith(s) || l.split(' ').includes(s));
}

export async function leaveGroup(id: string): Promise<void> {
  check(await sb().rpc('leave_group', { g: id }));
}

export async function setMuted(id: string, muted: boolean): Promise<void> {
  const me = await uid();
  check(await sb().from('group_members').update({ muted }).eq('group_id', id).eq('user_id', me));
}

export async function groupMembers(id: string): Promise<GroupMember[]> {
  return (check(await sb().from('group_members').select('user_id, display_name, role, joined_at').eq('group_id', id).order('joined_at')) ?? []) as GroupMember[];
}

export async function groupItems(listId: string): Promise<GroupItem[]> {
  return (check(await sb().from('group_list_items').select('*').eq('list_id', listId).order('created_at')) ?? []) as GroupItem[];
}

export async function addGroupItem(listId: string, it: { product_id: string; name: string; quantity: number; unit: string | null; category_id: string | null }) {
  const me = await uid();
  const { error } = await sb().from('group_list_items').insert({ list_id: listId, added_by: me, ...it });
  const e = msg(error); if (e) throw e;
}

export async function updateGroupItem(id: string, patch: Partial<Pick<GroupItem, 'quantity' | 'assigned_to' | 'status'>>) {
  const { error } = await sb().from('group_list_items').update(patch).eq('id', id);
  const e = msg(error); if (e) throw e;
}

export async function removeGroupItem(id: string): Promise<boolean> {
  const { data, error } = await sb().from('group_list_items').delete().eq('id', id).select('id');
  const e = msg(error); if (e) throw e;
  return !!data?.length;   // false = non potevi toglierlo (preso da qualcuno o aggiunto da un altro)
}

/** Ascolta i cambi della lista (tutti i telefoni del gruppo). Restituisce la funzione per smettere. */
export function watchList(listId: string, onChange: () => void): () => void {
  const ch = sb().channel(`gl-${listId}-${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_list_items', filter: `list_id=eq.${listId}` }, () => onChange())
    .subscribe();
  return () => { sb().removeChannel(ch); };
}

export async function isAnonymous(): Promise<boolean> {
  const { data } = await sb().auth.getUser();
  return !!data.user?.is_anonymous && !data.user.email;
}

/** "sabato 11 ottobre" / "oggi" / "domani" */
export function eventLabel(date: string | null): string {
  if (!date) return 'gruppo fisso';
  const d = new Date(`${date}T12:00:00`);
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return 'oggi';
  if (days === 1) return 'domani';
  return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
}

// solo per le prove automatiche (build con EXPO_PUBLIC_E2E=1)
if (process.env.EXPO_PUBLIC_E2E === '1') {
  (globalThis as any).__mcg = { myGroups, groupInfo, createGroup, updateGroup, leaveGroup, setMuted, groupMembers, groupItems, addGroupItem, updateGroupItem, removeGroupItem, myGroupItems, addGroupExpense };
}
