/** Salvadanaio, storico, budget e abitudini. */
import type * as T from '../api';
import { habitualFromHistory, lastSimilarShop, savingValue, suggestBudget, verifiedFuelSaving, verifiedSaving } from '../engine/core';
import { STORE_INDEX, STORES } from '../engine/data';
import { shopItem } from '../engine/kitchen';
import { ObservedLine } from '../engine/observed';
import { usualAndDue } from '../engine/restock';
import { median } from '../engine/util';
import { check, sb, uid } from './client';
import { BUDGET_HISTORY_LIMIT, nowIso, r2, today } from './common';
import { customPrices, foldCustomPrices, priceBook, saveCustomPrice, saveObserved } from './prices';
import { historyRows, savingOut, savingRow } from './data';

export const savingsApi = {
  addSaving: async (body: Parameters<typeof import('../api').localApi.addSaving>[0]): Promise<T.SavingEntry> => {
    const { user_id: _u, store_id, ...rest } = body;
    const data = { fuel_saving: 0, ...rest, verified_amount: null, paid: null,
      store_name: rest.store_name ?? STORE_INDEX[store_id]?.name ?? store_id };
    const row = check(await sb().from('savings').insert({ store_id, data }).select('*').single());
    return savingOut(row);
  },

  savings: async (_userId: string): Promise<T.SavingsSummary> => {
    const me = await uid();
    const rows = check(await sb().from('savings').select('*').order('created_at', { ascending: false }).limit(500)) as any[];
    // salvadanaio di famiglia: le spese degli altri con il loro nome
    const names = new Map<string, string>();
    if (rows.some((r) => r.user_id !== me)) {
      const { data } = await sb().rpc('family_members');
      for (const m of (data as any[]) || []) names.set(m.user_id, m.display_name || 'un familiare');
    }
    const entries = rows.map((r) => ({ ...savingOut(r), mine: r.user_id === me, by: r.user_id === me ? null : names.get(r.user_id) ?? 'un familiare' }));
    return {
      entries,
      total: r2(entries.reduce((s, e) => s + savingValue(e), 0)),
      total_verified: r2(entries.filter((e) => e.verified).reduce((s, e) => s + (e.verified_amount || 0), 0)),
      total_estimated: r2(entries.filter((e) => !e.verified).reduce((s, e) => s + e.amount, 0)),
      to_verify: entries.filter((e) => !e.verified && !e.cancelled).length,
    };
  },

  /** #39: obiettivo di risparmio della famiglia (o mio se non ho famiglia) */
  savingGoal: async (): Promise<T.SavingGoal | null> => {
    const { data, error } = await sb().from('saving_goals').select('title,amount,start_date,deadline,updated_at').maybeSingle();
    if (error || !data) return null;
    return { ...(data as any), amount: Number((data as any).amount) };
  },
  setSavingGoal: async (title: string, amount: number, deadline: string | null, restart = false): Promise<void> => {
    check(await sb().rpc('set_saving_goal', { p_title: title, p_amount: amount, p_deadline: deadline, p_restart: restart }));
  },
  deleteSavingGoal: async (): Promise<void> => {
    check(await sb().from('saving_goals').delete().not('owner_id', 'is', null));
  },

  deleteSaving: async (id: string) => {
    const rows = check(await sb().from('savings').delete().eq('id', id).select('id')) as any[];
    if (!rows.length) throw new Error('Voce non trovata');
    return { deleted: 1 };
  },

  scanReceipt: async (_images: string[], _saving_id?: string): Promise<T.ScanResult> => {
    throw new Error('Nella versione online i prezzi dello scontrino si inseriscono a mano');
  },

  applyReceipt: async (body: Parameters<typeof import('../api').localApi.applyReceipt>[0]) => {
    if (!STORE_INDEX[body.store_id]) throw new Error('Negozio sconosciuto');
    const date = body.date && !Number.isNaN(Date.parse(body.date)) ? body.date.slice(0, 10) : today();
    const row = body.saving_id ? await savingRow(body.saving_id).catch(() => null) : null;
    const branch = row?.data?.snapshot?.branch?.name ?? null;
    let saved = await saveObserved(body.lines as ObservedLine[], body.store_id, date, branch);
    // #26: righe dei prodotti scritti a mano: il prezzo vero resta per la prossima volta
    for (const l of body.lines as any[]) {
      if (!l.product_id?.startsWith('custom:') || l.kind === 'variante') continue;
      const q = l.weight_kg ?? l.quantity ?? 1;
      if (await saveCustomPrice(body.store_id, l.product_id, l.text, l.weight_kg ? 'kg' : null, l.net_price / (q || 1)).catch(() => false)) saved += 1;
    }
    const out: { prices_saved: number; verified?: T.SavingEntry } = { prices_saved: saved };
    if (row) {
      const data = { ...row.data, real_receipt: { store_id: body.store_id, date, total: body.total ?? null, lines: body.lines } };
      foldCustomPrices(data, body.lines as any[]);
      check(await sb().from('savings').update({ data }).eq('id', row.id));
      if (body.total) out.verified = await savingsApi.verifySaving(row.id, body.total, body.refueled, body.fuel_price);
      // già verificata col solo totale: rifaccio il conto con il previsto corretto
      else if (row.data?.verified && row.data?.paid != null) {
        out.verified = await savingsApi.verifySaving(row.id, Number(row.data.paid), row.data.refueled ?? undefined, row.data.fuel_price_paid ?? undefined);
      }
    }
    return out;
  },

  verifySaving: async (id: string, paid: number, refueled?: boolean, fuel_price?: number): Promise<T.SavingEntry> => {
    const row = await savingRow(id);
    const entry = { ...row.data };
    const shop = verifiedSaving(entry, paid);
    const fuelPart = verifiedFuelSaving(entry, refueled ?? null, fuel_price ?? null);
    const update = { verified: true, verified_amount: r2(shop + fuelPart), verified_fuel: fuelPart, paid: r2(paid),
      fuel_price_paid: fuel_price ?? null, refueled: refueled ?? null, verified_at: nowIso() };
    const saved = check(await sb().from('savings').update({ verified: true, data: { ...entry, ...update } }).eq('id', id).select('*').single());
    if (entry.history_id) {
      const travel = (entry.estimated_total || 0) - (entry.estimated_spend || 0);
      await sb().from('history').update({ total_cost: r2(paid + Math.max(travel, 0)) }).eq('id', entry.history_id);
    }
    return savingOut(saved);
  },

  unverifySaving: async (id: string) => {
    const row = await savingRow(id);
    check(await sb().from('savings').update({ verified: false, data: { ...row.data, verified: false, verified_amount: null, paid: null } }).eq('id', id));
    return { ok: true };
  },

  addHistory: async (body: { user_id: string; items: T.ListItem[]; store_id?: string; total_cost?: number }) => {
    const row = check(await sb().from('history').insert({ items: body.items, store_id: body.store_id ?? null,
      total_cost: body.total_cost ?? null }).select('id').single()) as any;
    return { id: row.id as string };
  },

  budgetSuggest: async (_user_id: string, items: T.ListItem[]): Promise<T.BudgetSuggestion> => {
    const shops = await historyRows(BUDGET_HISTORY_LIMIT, true);
    const ids = items.map((i) => i.product_id);
    return { ...(suggestBudget(ids, shops) as any), last_similar: lastSimilarShop(ids, shops) };
  },

  /** #47: quanto costerà circa una lista (mediana dei prezzi che conosciamo nei negozi); i prodotti senza prezzo si contano a parte */
  estimateList: async (items: { product_id: string; quantity: number }[]): Promise<{ total: number; priced: number; missing: number }> => {
    const [book, cp] = await Promise.all([priceBook(), customPrices()]);
    let total = 0, priced = 0, missing = 0;
    for (const it of items) {
      let ps: number[];
      if (it.product_id.startsWith('custom:')) {
        ps = [...cp.entries()].filter(([k]) => k.endsWith(`|${it.product_id}`)).map(([, v]) => v.unit_price * it.quantity);
      } else {
        ps = STORES.map((st) => shopItem(book, it, st.id).price).filter((x): x is number => x != null);
      }
      if (ps.length) { total += median(ps); priced++; } else missing++;
    }
    return { total: r2(total), priced, missing };
  },

  /** #44/#35: "Di solito compri" e "Di solito lo ricompri" (dallo storico, mio e della famiglia) */
  usualAndDue: async () => usualAndDue(await historyRows(60)),

  habitual: async (_userId: string) => {
    const shops = await historyRows(40);
    return { ...(habitualFromHistory(shops) as any), based_on: shops.length };
  },

};
