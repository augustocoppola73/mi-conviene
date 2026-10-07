/**
 * Ricette x lista x prezzi x abitudini (porting di backend/server.py): costo a porzione,
 * suggerimenti, menu proposto, menu unito, ordine dei reparti, righe della spesa in corso.
 */
import { classify } from './classify';
import { HistoryShop, ListItem, PriceBook, habitualFromHistory } from './core';
import { CATEGORIES, PRODUCT_INDEX, STORE_INDEX, STORES } from './data';
import { buyFromUsed, matchProduct, mergeRows, plan, PlanRow, substitutes } from './recipes';
import { normalize, pyRound } from './util';

export interface Recipe {
  id: string; name: string; servings?: number | null; ingredients: string[]; source?: string | null; url?: string | null;
  categories?: string[] | null; user_id?: string | null; notes?: string | null; image?: string | null;
}
export interface Core { servings: number; rows: PlanRow[]; needs: PlanRow[]; unknown: string[] }

export const MAIN_DISH = ['Primi piatti', 'Secondi piatti', 'Piatti unici', 'Risotti', 'Torte salate', 'Pizza'];

export function recipeSummary(r: Recipe) {
  return { id: r.id, name: r.name, servings: r.servings ?? null, source: r.source ?? null, url: r.url ?? null,
    categories: r.categories ?? null, user_id: r.user_id ?? null, n_ingredients: (r.ingredients || []).length,
    mine: r.source !== 'Wikibooks' };
}

const CORES = new Map<string, Core>();
const coreKey = (r: Recipe) => `${r.id}|${r.servings}|${(r.ingredients || []).join('\u0001')}`;
const coreOf = (base: number, rows: PlanRow[]): Core => ({ servings: base, rows, needs: rows.filter((x) => x.product_id && !x.pantry),
  unknown: rows.filter((x) => !x.product_id && !x.pantry).map((x) => x.name) });

export function recipeCore(r: Recipe): Core {
  const key = coreKey(r);
  let core = CORES.get(key);
  if (!core) {
    const base = r.servings || 4;
    core = coreOf(base, plan(r.ingredients || [], base, base, PRODUCT_INDEX));
    CORES.set(key, core);
  }
  return core;
}

/** Le ricette della raccolta abbinate ai prodotti già "in fabbrica" (scripts/recipe_cores.ts): abbinarle sul telefono
 *  bloccava l'app per secondi dopo l'avvio. Righe con prodotti che non esistono più vengono ricalcolate al bisogno. */
export function primeCores(all: Recipe[], rowsById: Record<string, Partial<PlanRow>[]>) {
  for (const r of all) {
    const rows = rowsById[r.id]?.map((x) => ({ amount: null, kind: null, measure: null, from: null, product_id: null, product_name: null,
      pantry: false, approx: false, ...x })) as PlanRow[] | undefined;
    if (!rows || rows.some((x) => x.product_id && !PRODUCT_INDEX[x.product_id])) continue;
    CORES.set(coreKey(r), coreOf(r.servings || 4, rows));
  }
}

function rowCost(book: PriceBook, storeId: string, pid: string, qty: number): number | null {
  const info = book.catalog[storeId]?.[pid];
  const p = PRODUCT_INDEX[pid];
  if (!info || !p) return null;
  return (info.final_price * qty) / p.default_qty;
}

export function portionCost(book: PriceBook, core: Core, storeId: string): number | null {
  let tot = 0;
  for (const row of core.needs) {
    const p = PRODUCT_INDEX[row.product_id!];
    const used = row.used != null ? row.used : p.default_qty * 0.25;
    const c = rowCost(book, storeId, row.product_id!, used);
    if (c === null) return null;
    tot += c;
  }
  return pyRound(tot / core.servings, 2);
}

export function bestPortion(book: PriceBook, core: Core) {
  let best: { store_id: string; store_name: string; portion: number; complete?: boolean } | null = null;
  for (const st of STORES) {
    const c = portionCost(book, core, st.id);
    if (c !== null && (best === null || c < best.portion)) best = { store_id: st.id, store_name: st.name, portion: c };
  }
  if (best) best.complete = !core.unknown.length;
  return best;
}

export function buyCosts(book: PriceBook, rows: PlanRow[]) {
  const out: { store_id: string; store_name: string; total: number }[] = [];
  for (const st of STORES) {
    let tot = 0;
    let ok = true;
    for (const r of rows) {
      if (!r.product_id || r.pantry) continue;
      const c = rowCost(book, st.id, r.product_id, r.quantity);
      if (c === null) { ok = false; break; }
      tot += c;
    }
    if (ok) out.push({ store_id: st.id, store_name: st.name, total: pyRound(tot, 2) });
  }
  return out.sort((a, b) => a.total - b.total);
}

export function recipeSummaryPriced(book: PriceBook, r: Recipe) {
  return { ...recipeSummary(r), cheapest: bestPortion(book, recipeCore(r)) };
}

/** Piano di una ricetta per N persone, con i costi per catena (come /recipes/plan). */
export function planRecipe(book: PriceBook, lines: string[], base: number | null | undefined, servings: number, id = 'inline') {
  const rows = plan(lines, base, servings, PRODUCT_INDEX);
  for (const row of rows) if (!row.product_id) row.category_id = classify(row.name).category_id;
  const core = recipeCore({ id, servings: base ?? null, ingredients: lines, name: '' });
  return { servings, recipe_servings: base || 4, assumed_servings: base == null, items: rows,
    costs: buyCosts(book, rows), cheapest: bestPortion(book, core) };
}

export function menuPlan(book: PriceBook, entries: { recipe: Recipe; servings: number }[]) {
  const groups: PlanRow[][] = [];
  const names: string[] = [];
  for (const { recipe: r, servings } of entries) {
    const rows = plan(r.ingredients, r.servings, servings, PRODUCT_INDEX);
    for (const row of rows) {
      row.recipe = r.name;
      if (!row.product_id) row.category_id = classify(row.name).category_id;
    }
    groups.push(rows);
    names.push(r.name);
  }
  const items = mergeRows(groups, PRODUCT_INDEX);
  return { recipes: names, items, costs: buyCosts(book, items) };
}

function missingCost(book: PriceBook, rows: { product_id: string; quantity: number }[], storeId?: string | null): [number | null, string | null] {
  const stores = storeId && STORE_INDEX[storeId] ? [storeId] : STORES.map((s) => s.id);
  let best: [number, string] | null = null;
  for (const sid of stores) {
    let tot: number | null = 0;
    for (const r of rows) {
      const c = rowCost(book, sid, r.product_id, r.quantity);
      if (c === null) { tot = null; break; }
      tot += c;
    }
    if (tot !== null && (best === null || tot < best[0])) best = [pyRound(tot, 2), sid];
  }
  return best ?? [null, null];
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface SuggestInput {
  items: ListItem[]; store_id?: string | null; budget?: number | null; spent?: number | null; servings?: number;
}

export function suggest(book: PriceBook, body: SuggestInput, allRecipes: Recipe[], history: HistoryShop[] | null) {
  const servings = body.servings ?? 2;
  const inList = new Set(body.items.filter((i) => !i.product_id.startsWith('custom:')).map((i) => i.product_id));
  const customNames = new Set(body.items.filter((i) => i.product_id.startsWith('custom:'))
    .map((i) => normalize(i.name || i.product_id.slice(7))));
  for (const i of body.items) {
    if (i.product_id.startsWith('custom:')) {
      const [pid] = matchProduct(i.name || i.product_id.slice(7), PRODUCT_INDEX);
      if (pid) inList.add(pid);
    }
  }
  const haveIds = new Set<string>();
  inList.forEach((p) => substitutes(p).forEach((x) => haveIds.add(x)));
  const customHas = (name: string) => {
    const n = normalize(name);
    for (const c of customNames) if (c.length >= 4 && (n === c || c.includes(n) || n.includes(c))) return true;
    return false;
  };
  const remaining = body.budget != null && body.spent != null ? pyRound(body.budget - body.spent, 2) : null;
  const ready: any[] = [];
  const almost: any[] = [];
  for (const r of allRecipes) {
    const core = recipeCore(r);
    const needs = core.needs;
    if (needs.length + core.unknown.length < 2) continue;
    const have = needs.filter((x) => haveIds.has(x.product_id!));
    const miss = needs.filter((x) => !haveIds.has(x.product_id!));
    const unkHave = core.unknown.filter(customHas);
    const unkMiss = core.unknown.filter((n) => !customHas(n));
    const nHave = have.length + unkHave.length;
    const nMiss = miss.length + unkMiss.length;
    const total = nHave + nMiss;
    if (nHave === 0 || nMiss > 3 || nHave < Math.max(1, nMiss - 1) || (nMiss === 0 && nHave < 2)) continue;
    const info: any = { ...recipeSummary(r), uses: [...have.map((x) => x.product_name), ...unkHave], coverage: pyRound(nHave / total, 2) };
    if (nMiss === 0) ready.push(info);
    else {
      const scale = servings / core.servings;
      const buy = miss.map((x) => {
        const p = PRODUCT_INDEX[x.product_id!];
        const used = x.used != null ? x.used * scale : null;
        return { ...x, quantity: buyFromUsed(used, p) };
      });
      const [cost, sid] = buy.length ? missingCost(book, buy as any, body.store_id) : [null, null];
      Object.assign(info, {
        missing: buy.map((x) => ({ product_id: x.product_id, name: x.product_name, quantity: x.quantity, unit: PRODUCT_INDEX[x.product_id!].unit })),
        missing_new: unkMiss, missing_cost: cost, missing_store: sid ? STORE_INDEX[sid].name : null,
        fits_budget: remaining !== null && cost !== null && cost <= remaining && !unkMiss.length,
      });
      almost.push(info);
    }
  }
  ready.sort((a, b) => b.uses.length - a.uses.length || cmpStr(a.name, b.name));
  almost.sort((a, b) => b.uses.length - a.uses.length
    || (a.missing.length + a.missing_new.length) - (b.missing.length + b.missing_new.length)
    || (a.missing_cost ?? 99) - (b.missing_cost ?? 99) || cmpStr(a.name, b.name));
  const extras: any[] = [];
  if (history) {
    const hab = habitualFromHistory(history);
    let left = remaining;
    for (const h of hab.items) {
      if (inList.has(h.product_id)) continue;
      const [cost] = missingCost(book, [{ product_id: h.product_id, quantity: h.quantity }], body.store_id);
      if (cost === null) continue;
      const fits = left !== null && cost <= left;
      if (fits) left = pyRound(left! - cost, 2);
      extras.push({ product_id: h.product_id, name: h.name, quantity: h.quantity, unit: PRODUCT_INDEX[h.product_id].unit,
        count: h.count, occasions: hab.occasions, cost, fits_budget: fits });
    }
  }
  return { ready: ready.slice(0, 6), almost: almost.slice(0, 6), habitual_missing: extras.slice(0, 8), remaining, list_size: body.items.length };
}

export interface ProposeInput { count: number; servings: number; budget?: number | null; store_id?: string | null; exclude?: string[]; items?: ListItem[] }

export function proposeMenu(book: PriceBook, body: ProposeInput, allRecipes: Recipe[], history: HistoryShop[] | null) {
  const inList = new Set((body.items ?? []).map((i) => i.product_id));
  const habitual = new Set(history ? habitualFromHistory(history).items.map((h: any) => h.product_id) : []);
  const exclude = new Set(body.exclude ?? []);
  const cands: [number, number, string, string, Recipe][] = [];
  for (const r of allRecipes) {
    if (exclude.has(r.id)) continue;
    const cats = r.categories || [];
    if (r.source === 'Wikibooks' && !cats.some((c) => MAIN_DISH.some((m) => c.startsWith(m)))) continue;
    const core = recipeCore(r);
    if (core.unknown.length || core.needs.length < 3) continue;
    const sid = body.store_id && STORE_INDEX[body.store_id] ? body.store_id : null;
    const portion = sid ? portionCost(book, core, sid) : bestPortion(book, core)?.portion ?? null;
    if (portion === null || portion <= 0) continue;
    const bonus = 0.25 * core.needs.filter((x) => inList.has(x.product_id!) || habitual.has(x.product_id!)).length;
    const kind = cats.some((c) => c.startsWith('Primi') || c.startsWith('Risotti')) ? 'primo' : 'secondo';
    cands.push([portion - bonus, portion, kind, core.needs[0].product_id!, r]);
  }
  cands.sort((a, b) => a[0] - b[0] || cmpStr(a[4].name, b[4].name));
  const picks: any[] = [];
  const mains = new Set<string>();
  let total = 0;
  let want = 'primo';
  const pool = [...cands];
  while (pool.length && picks.length < body.count) {
    const choice = pool.find((c) => c[2] === want && !mains.has(c[3])) ?? pool.find((c) => !mains.has(c[3]));
    if (!choice) break;
    pool.splice(pool.indexOf(choice), 1);
    const cost = pyRound(choice[1] * body.servings, 2);
    if (body.budget != null && total + cost > body.budget) continue;
    total = pyRound(total + cost, 2);
    mains.add(choice[3]);
    picks.push({ ...recipeSummary(choice[4]), portion: choice[1], cost, kind: choice[2] });
    want = want === 'primo' ? 'secondo' : 'primo';
  }
  return { recipes: picks, total, servings: body.servings, budget: body.budget ?? null };
}

/** Lista ricette, eventualmente ordinata per costo a persona (solo piatti con tutto a prezzo). */
export function rankByPrice(book: PriceBook, pool: Recipe[], main: boolean, limit: number): Recipe[] {
  const priced: [number, Recipe][] = [];
  for (const r of pool) {
    const core = recipeCore(r);
    const cats = r.categories || [];
    if (core.unknown.length || core.needs.length < 2 || cats.some((c) => c.startsWith('Bevande'))) continue;
    if (main && r.source === 'Wikibooks' && !cats.some((c) => MAIN_DISH.some((m) => c.startsWith(m)))) continue;
    const b = bestPortion(book, core);
    if (b) priced.push([b.portion, r]);
  }
  priced.sort((a, b) => a[0] - b[0]);
  return priced.slice(0, limit).map((x) => x[1]);
}

// ------------------------------------------------------------------ spesa in corso
export interface ShopItemIn { product_id: string; quantity: number; name?: string | null; category_id?: string | null; unit?: string | null }

export function shopItem(book: PriceBook, it: ShopItemIn, storeId: string, inStore = false) {
  const p = PRODUCT_INDEX[it.product_id];
  const info = book.catalog[storeId]?.[it.product_id];
  const price = p && info ? pyRound((info.final_price * it.quantity) / p.default_qty, 2) : null;
  return {
    key: it.product_id, product_id: it.product_id, name: p ? p.name : (it.name || it.product_id.slice(7)),
    quantity: it.quantity, unit: p ? p.unit : (it.unit || 'pz'), category_id: p ? p.category_id : (it.category_id || 'altro'),
    price, checked: false, checked_by: null as string | null, checked_by_id: null as string | null, checked_at: null as string | null,
    added_in_store: inStore, in_promo: info ? info.promo_price !== null : false, promo_until: info?.promo_until ?? null,
    variant: book.variants[`${storeId}|${it.product_id}`] ?? null, seen: null as any,
  };
}

/** Ordine dei reparti: quelli imparati prima (dal primo smarcato), poi l'ordine standard. */
export function aisleOrder(ranks: Record<string, { avg: number; n: number }> | null | undefined): string[] {
  const learned = Object.entries(ranks || {}).sort((a, b) => a[1].avg - b[1].avg);
  const base = CATEGORIES.map((c) => c.id);
  const seen = learned.map(([c]) => c).filter((c) => base.includes(c));
  return [...seen, ...base.filter((c) => !seen.includes(c))];
}

export function learnAisles(items: { checked: boolean; checked_at: string | null; category_id: string }[],
  ranks0: Record<string, { avg: number; n: number }> | null | undefined) {
  const checks = items.filter((i) => i.checked && i.checked_at).sort((a, b) => cmpStr(a.checked_at!, b.checked_at!));
  const order: string[] = [];
  for (const i of checks) if (!order.includes(i.category_id)) order.push(i.category_id);
  if (order.length < 2) return null;
  const ranks = { ...(ranks0 || {}) };
  order.forEach((cat, pos) => {
    const rel = pos / (order.length - 1);
    const r = ranks[cat] ? { ...ranks[cat] } : { avg: rel, n: 0 };
    r.avg = pyRound((r.avg * r.n + rel) / (r.n + 1), 3);
    r.n = Math.min(r.n + 1, 20);
    ranks[cat] = r;
  });
  return ranks;
}

/** Prepara i piani delle ricette a piccoli blocchi (non blocca l'app all'avvio, come la cache del server). */
export function warmRecipes(all: Recipe[], chunk = 40): Promise<void> {
  return new Promise((resolve) => {
    let i = 0;
    const step = () => {
      const end = Math.min(i + chunk, all.length);
      for (; i < end; i++) recipeCore(all[i]);
      if (i < all.length) setTimeout(step, 0); else resolve();
    };
    step();
  });
}
