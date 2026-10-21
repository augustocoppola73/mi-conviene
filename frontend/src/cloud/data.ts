/** Dati personali (storico, salvadanaio, ricette) e famiglia: letture usate da più parti dell'API. */
import type * as T from '../api';
import { HistoryShop } from '../engine/core';
import { Recipe } from '../engine/kitchen';
import { check, sb, uid } from './client';
import { COLLECTION, nowIso } from './common';

// ------------------------------------------------------------------ dati personali
export async function historyRows(limit: number, onlyWithCost = false): Promise<HistoryShop[]> {
  let q = sb().from('history').select('items,store_id,total_cost,created_at').order('created_at', { ascending: false }).limit(limit);
  if (onlyWithCost) q = q.gt('total_cost', 0);
  return (check(await q) as any[]).map((h) => ({ ...h, total_cost: h.total_cost == null ? null : Number(h.total_cost) }));
}

export const savingOut = (row: any): T.SavingEntry => ({
  ...(row.data || {}), id: row.id, user_id: row.user_id, store_id: row.store_id, verified: row.verified, created_at: row.created_at,
});

export async function savingRow(id: string): Promise<any> {
  const row = check(await sb().from('savings').select('*').eq('id', id).maybeSingle());
  if (!row) throw new Error('Voce non trovata');
  return row;
}

export async function myRecipes(): Promise<Recipe[]> {
  const rows = check(await sb().from('recipes').select('*').order('updated_at', { ascending: false }).limit(500)) as any[];
  return rows.map((r) => ({ ...r, categories: r.categories ?? null }));
}

export async function findRecipe(id: string): Promise<Recipe | null> {
  if (id.startsWith('wb:')) return COLLECTION.find((r) => r.id === id) ?? null;
  return (check(await sb().from('recipes').select('*').eq('id', id).maybeSingle()) as Recipe | null) ?? null;
}

export const cleanLines = (lines: string[]) => lines.map((l) => l.trim()).filter(Boolean);

// ------------------------------------------------------------------ famiglia
export async function myProfile(): Promise<{ id: string; display_name: string | null; family_id: string | null }> {
  const me = await uid();
  return check(await sb().from('profiles').select('id,display_name,family_id').eq('id', me).single()) as any;
}

export async function setDisplayName(name?: string | null) {
  const n = (name || '').trim();
  if (n) await sb().from('profiles').update({ display_name: n.slice(0, 40), updated_at: nowIso() }).eq('id', await uid());
}

/** Ricette e spesa in corso seguono la famiglia: entrando le vedono tutti, uscendo tornano solo tue. */
export async function moveMyThings(familyId: string | null) {
  const me = await uid();
  await sb().from('recipes').update({ family_id: familyId }).eq('user_id', me);
  await sb().from('shops').update({ family_id: familyId }).eq('user_id', me).eq('status', 'active');
}

export async function familyOut(): Promise<T.Family | Record<string, never>> {
  const p = await myProfile();
  if (!p.family_id) return {};
  const fam = check(await sb().from('families').select('*').eq('id', p.family_id).maybeSingle()) as any;
  if (!fam) return {};
  const members = check(await sb().rpc('family_members')) as any[];
  const me = p.id;
  return { id: fam.id, code: fam.code ?? fam.id.slice(0, 6).toUpperCase(), created_at: fam.created_at,
    my_role: members.find((m) => m.user_id === me)?.role ?? 'membro',
    members: members.map((m) => ({ user_id: m.user_id, display_name: m.display_name || 'Senza nome', notifications: m.notifications ?? null,
      role: m.role ?? 'membro' })) };
}
