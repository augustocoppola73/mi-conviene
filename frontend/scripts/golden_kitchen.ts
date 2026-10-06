import { readFileSync } from 'node:fs';
import { buildPriceBook } from '../src/engine/core';
import { STORES } from '../src/engine/data';
import {
  aisleOrder, buyCosts, learnAisles, menuPlan, planRecipe, portionCost, proposeMenu, rankByPrice, Recipe, recipeCore,
  recipeSummaryPriced, shopItem, suggest,
} from '../src/engine/kitchen';
import { search } from '../src/engine/recipes';

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const G = read('../src/engine/__golden__/kitchen_golden.json');
const CG = read('../src/engine/__golden__/core_golden.json');
const COLL: Recipe[] = read('../src/engine/data/recipes_wikibooks.json').recipes;

const close = (a: any, b: any, path = ''): string | null => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6 ? null : `${path}: ${a} != ${b}`;
  if (a === null || b === null || a === undefined || b === undefined) return (a ?? null) === (b ?? null) ? null : `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return `${path}: lunghezza ${a?.length} != ${b?.length}`;
    for (let i = 0; i < a.length; i++) { const r = close(a[i], b[i], `${path}[${i}]`); if (r) return r; }
    return null;
  }
  if (typeof a === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (k === 'checked_by_id') continue;
      const r = close(a[k], b[k], `${path}.${k}`); if (r) return r;
    }
    return null;
  }
  return a === b ? null : `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
};
let fails = 0;
const check = (name: string, exp: any, got: any) => { const d = close(exp, got); if (d) { fails += 1; if (fails < 25) console.log(`✗ ${name} → ${d}`); } };

const book = buildPriceBook(CG.open_prices, CG.user_prices, CG.today);
const mine: Recipe[] = G.my_recipes;
const all = [...mine, ...COLL];
const byId = Object.fromEntries(all.map((r) => [r.id, r]));

for (const p of G.priced) {
  const r = byId[p.id];
  check(`ricetta ${p.id}`, p.summary, recipeSummaryPriced(book, r));
  check(`costi ${p.id}`, p.costs, buyCosts(book, recipeCore(r).rows));
  check(`porzioni ${p.id}`, p.portions, Object.fromEntries(STORES.map((s) => [s.id, portionCost(book, recipeCore(r), s.id)])));
}
G.plans.forEach((p: any, i: number) => check(`piano #${i}`, p.out, planRecipe(book, p.lines, p.base, p.servings)));
G.menus.forEach((m: any, i: number) => check(`menu #${i}`, m.out,
  menuPlan(book, m.entries.map((e: any) => ({ recipe: byId[e.recipe_id], servings: e.servings })))));
for (const r of G.ranks) {
  const pool = r.q ? [...search(mine, r.q, 10000), ...search(COLL, r.q, 10000)] : all;
  check(`classifica ${r.q}/${r.main}`, r.ids, rankByPrice(book, pool, r.main, 30).map((x) => x.id));
}
G.suggests.forEach((s: any, i: number) => check(`suggerimenti #${i}`, s.out,
  suggest(book, s.body, s.body.user_id ? all : COLL, s.body.user_id ? G.history : null)));
G.proposes.forEach((s: any, i: number) => check(`menu proposto #${i}`, s.out,
  proposeMenu(book, s.body, s.body.user_id ? all : COLL, s.body.user_id ? G.history : null)));
G.shop_items.forEach((s: any, i: number) => check(`riga spesa #${i}`, s.out, shopItem(book, s.item, s.store_id, s.store_id === 'lidl')));
let ranks: any = null;
G.aisles.forEach((a: any, i: number) => {
  const next = learnAisles(a.items, ranks);
  if (next) ranks = next;
  check(`reparti #${i}`, a.after ?? null, ranks);
  check(`ordine reparti #${i}`, a.order, aisleOrder(ranks));
});
console.log(fails ? `DIFFERENZE: ${fails}` : `TUTTO UGUALE AL PYTHON ✓ (${G.priced.length} ricette, ${G.plans.length} piani, ${G.menus.length} menu, ${G.suggests.length} suggerimenti, ${G.proposes.length} menu proposti, reparti)`);
process.exit(fails ? 1 : 0);
