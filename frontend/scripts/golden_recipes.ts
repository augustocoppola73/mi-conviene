// Confronta il motore TypeScript con il backend Python sugli stessi input (test "golden").
import { readFileSync } from 'node:fs';
import { classify } from '../src/engine/classify';
import { PRODUCT_INDEX } from '../src/engine/data';
import { matchProduct, parseIngredient, plan } from '../src/engine/recipes';

const G = JSON.parse(readFileSync(new URL('../src/engine/__golden__/recipes_golden.json', import.meta.url), 'utf8'));
const coll = JSON.parse(readFileSync(new URL('../src/engine/data/recipes_wikibooks.json', import.meta.url), 'utf8')).recipes;
const byId = Object.fromEntries(coll.map((r: any) => [r.id, r]));

const close = (a: any, b: any): boolean => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
  if (a === null || b === null || a === undefined || b === undefined) return (a ?? null) === (b ?? null);
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => close(x, b[i]));
  if (typeof a === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((k) => close(a[k], b[k]));
  }
  return a === b;
};
let fails = 0;
const report = (what: string, exp: any, got: any) => {
  fails += 1;
  if (fails <= 15) console.log(`✗ ${what}\n   python: ${JSON.stringify(exp)}\n   ts:     ${JSON.stringify(got)}`);
};
for (const c of G.parsed) {
  const ing = parseIngredient(c.line);
  if (!close(c.ing, ing)) report(`parse ${c.line}`, c.ing, ing);
  const m = matchProduct(ing.name, PRODUCT_INDEX);
  if (!close(c.match, m)) report(`match ${c.line}`, c.match, m);
}
let planFails = 0;
for (const p of G.plans) {
  const r = byId[p.id];
  const rows = plan(r.ingredients, r.servings, p.servings, PRODUCT_INDEX);
  if (!close(p.rows, rows)) { planFails += 1; report(`plan ${p.id} x${p.servings}`, p.rows, rows); }
}
for (const c of G.classify) {
  const out = classify(c.text);
  if (!close(c.out, out)) report(`classify ${c.text}`, c.out, out);
}
console.log(`\nparse/match: ${G.parsed.length} righe · piani: ${G.plans.length} (${planFails} diversi) · classify: ${G.classify.length}`);
console.log(fails ? `DIFFERENZE: ${fails}` : 'TUTTO UGUALE AL PYTHON ✓');
process.exit(fails ? 1 : 0);
