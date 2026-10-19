/**
 * #91: la lista di casa della famiglia, in diretta (una riga per prodotto, tabella home_list_items).
 * #75: le preferenze dell'app sul profilo online (le ritrovi su ogni telefono).
 */
import type { ListItem } from '../api';
import { check, sb } from './client';

export interface AppProfile { display_name: string | null; family_id: string | null; app: { at: number; data: Record<string, unknown> } | null }

export async function myAppProfile(): Promise<AppProfile | null> {
  const { data, error } = await sb().rpc('my_app_profile');
  if (error) return null;
  return (data as AppProfile) ?? null;
}

export async function saveAppPrefs(at: number, data: Record<string, unknown>): Promise<void> {
  check(await sb().rpc('set_app_prefs', { p: { at, data } }));
}

export async function saveDisplayName(userId: string, name: string): Promise<void> {
  const n = name.trim().slice(0, 40);
  if (n) check(await sb().from('profiles').update({ display_name: n }).eq('id', userId));
}

export interface HomeRow extends ListItem { added_by: string | null }

export async function homeList(familyId: string): Promise<HomeRow[]> {
  const rows = (check(await sb().from('home_list_items').select('product_id,quantity,name,category_id,unit,added_by').eq('family_id', familyId)) ?? []) as any[];
  return rows.map((r) => ({
    product_id: r.product_id, quantity: Number(r.quantity), added_by: r.added_by,
    ...(r.product_id.startsWith('custom:') || r.name ? { name: r.name ?? undefined, category_id: r.category_id ?? undefined, unit: r.unit ?? undefined } : {}),
  }));
}

export async function homeUpsert(familyId: string, items: ListItem[]): Promise<void> {
  if (!items.length) return;
  check(await sb().from('home_list_items').upsert(items.map((i) => ({
    family_id: familyId, product_id: i.product_id, quantity: i.quantity,
    name: i.name ?? null, category_id: i.category_id ?? null, unit: i.unit ?? null,
  })), { onConflict: 'family_id,product_id' }));
}

export async function homeDelete(familyId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  check(await sb().from('home_list_items').delete().eq('family_id', familyId).in('product_id', ids));
}

/** ascolta i cambi della lista di casa (gli altri telefoni della famiglia) */
export function watchHome(familyId: string, onChange: () => void): () => void {
  const ch = sb().channel(`home-${familyId}-${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'home_list_items', filter: `family_id=eq.${familyId}` }, () => onChange())
    .subscribe();
  return () => { sb().removeChannel(ch); };
}

/** le differenze tra due liste: cosa scrivere e cosa togliere */
export function diffLists(next: ListItem[], prev: ListItem[]): { upsert: ListItem[]; remove: string[] } {
  const p = new Map(prev.map((i) => [i.product_id, i]));
  const n = new Map(next.map((i) => [i.product_id, i]));
  const upsert = next.filter((i) => {
    const o = p.get(i.product_id);
    return !o || o.quantity !== i.quantity || (o.name ?? null) !== (i.name ?? null) || (o.category_id ?? null) !== (i.category_id ?? null) || (o.unit ?? null) !== (i.unit ?? null);
  });
  const remove = prev.filter((i) => !n.has(i.product_id)).map((i) => i.product_id);
  return { upsert, remove };
}
