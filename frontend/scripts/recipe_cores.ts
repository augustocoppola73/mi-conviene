/** Rigenera src/engine/data/recipe_cores.json: le ricette di Wikibooks già abbinate ai prodotti del catalogo.
 *  Da rilanciare quando cambiano ricette, catalogo o regole di abbinamento:  npx tsx scripts/recipe_cores.ts */
import fs from 'node:fs';
import WIKIBOOKS from '../src/engine/data/recipes_wikibooks.json';
import { recipeCore, Recipe } from '../src/engine/kitchen';

const out: Record<string, unknown> = {};
// righe compatte: senza i campi vuoti (null/false), che primeCores rimette
const EMPTY = new Set(['amount', 'kind', 'measure', 'from', 'product_id', 'product_name', 'pantry', 'approx']);
for (const r of (WIKIBOOKS as { recipes: Recipe[] }).recipes) {
  out[r.id] = recipeCore(r).rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k, v]) => !(EMPTY.has(k) && (v === null || v === false)))));
}
fs.writeFileSync('src/engine/data/recipe_cores.json', JSON.stringify(out));
console.log('ricette abbinate:', Object.keys(out).length, '· byte:', fs.statSync('src/engine/data/recipe_cores.json').size);
