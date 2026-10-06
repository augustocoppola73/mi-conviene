import { readFileSync } from 'node:fs';
import { buildPriceBook, habitualFromHistory, lastSimilarShop, optimizeList, suggestBudget, verifiedFuelSaving, verifiedSaving } from '../src/engine/core';

const G = JSON.parse(readFileSync(new URL('../src/engine/__golden__/core_golden.json', import.meta.url), 'utf8'));
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
      if (k === 'retrieved_at') continue;
      const r = close(a[k], b[k], `${path}.${k}`); if (r) return r;
    }
    return null;
  }
  return a === b ? null : `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
};
let fails = 0;
const check = (name: string, exp: any, got: any) => { const d = close(exp, got); if (d) { fails += 1; console.log(`✗ ${name} → ${d}`); } };

const book = buildPriceBook(G.open_prices, G.user_prices, G.today);
check('catalogo', G.catalog, book.catalog);
G.cases.forEach((c: any, i: number) => {
  const out = optimizeList(book, c.req, c.stores, c.fuel, G.stations);
  check(`ottimizza #${i}`, c.out, out);
});
check('abitudini', G.habitual, habitualFromHistory(G.history));
G.budgets.forEach((b: any, i: number) => {
  check(`budget #${i}`, b.out, suggestBudget(b.ids, G.history));
  check(`ultima simile #${i}`, b.last, lastSimilarShop(b.ids, G.history));
});
G.verify.forEach((v: any, i: number) => {
  check(`verifica spesa #${i}`, v.shop, verifiedSaving(v.e, v.paid));
  check(`verifica pieno #${i}`, v.fuel, verifiedFuelSaving(v.e, v.refueled, v.fp));
});
console.log(fails ? `DIFFERENZE: ${fails}` : `TUTTO UGUALE AL PYTHON ✓ (${G.cases.length} spese ottimizzate, abitudini, budget, salvadanaio)`);
process.exit(fails ? 1 : 0);
