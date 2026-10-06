/** Ricette -> lista della spesa (porting fedele di backend/recipes.py). */
import { tokens } from './classify';
import { Product, RECIPES_CONST as R } from './data';
import { escapeRe, normalize, pyRe, pyRound, strip } from './util';

const UNITS = R.units;
const HOUSEHOLD = R.household;
const DESCRIPTORS = new Set(R.descriptors);

const decodeEntities = (s: string) => s
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));

const isLiquid = (name: string) => {
  const n = normalize(name);
  return R.liquids.some((l) => pyRe('\\b' + escapeRe(l)).test(n));
};
const density = (name: string) => {
  const n = normalize(name);
  for (const [k, d] of Object.entries(R.density)) if (pyRe('\\b' + k).test(n)) return d;
  return 0.7;
};

const QB_SRC = "\\b(q\\.?\\s?b\\.?|quanto basta|a piacere|qualche|un po'?|q\\.?\\s?s\\.?)\\b";
const QB = pyRe(QB_SRC, 'i');
const QB_G = pyRe(QB_SRC, 'gi');

function num(tok0: string): number | null {
  const tok = tok0.trim().toLowerCase();
  if (tok in R.fractions) return R.fractions[tok];
  if (tok in R.num_words) return R.num_words[tok];
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(tok);
  if (m && Number(m[2])) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return b <= 16 && a < b ? a / b : a;
  }
  const f = Number(tok.replace(',', '.'));
  return tok !== '' && Number.isFinite(f) && /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(tok.replace(',', '.')) ? f : null;
}

const NUMBER = '(\\d+(?:[.,]\\d+)?(?:\\s*/\\s*\\d+)?|[½¼¾⅓⅔]|un|uno|una|mezzo|mezza|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|dodici)';
const UNIT_RE = Object.keys(UNITS).map(escapeRe).sort((a, b) => b.length - a.length).join('|');
const QTY_FIRST = pyRe(`^\\s*${NUMBER}(?:\\s*[-–]\\s*\\d+)?\\s*(?:(?:di\\s+)?(${UNIT_RE})\\b\\.?)?\\s*(?:di\\s+|d['’]\\s*)?(.*)$`, 'is');
const QTY_LAST = pyRe(`^(.*?)[\\s:,(]+${NUMBER}\\s*(?:(${UNIT_RE})\\b\\.?)?\\s*\\)?\\s*$`, 'is');

export interface Measure { count: number | null; one: string; many: string }
export interface Ingredient {
  text: string; name: string; amount: number | null; kind: string | null; qb: boolean; measure: Measure | null; from?: string;
}

export function parseIngredient(line: string): Ingredient {
  let text = strip(decodeEntities(line.replace(/\s+/g, ' ')), ' -•*·.;');
  text = text.replace(/\([^)]*\)/g, (m) => (/\d/.test(m) ? m : ' '));
  let qb = QB.test(text);
  const textNoqb = strip(text.replace(QB_G, ' '), ' ,:');
  let amount: number | null = null;
  let kind: string | null = null;
  let name = textNoqb;
  let unit = '';
  let m = QTY_FIRST.exec(textNoqb);
  if (m && m[3].trim()) {
    amount = num(m[1]); unit = (m[2] ?? '').toLowerCase(); name = m[3];
    kind = unit in UNITS ? UNITS[unit][0] : 'pz';
    if (unit in UNITS) amount = UNITS[unit][1] ? (amount ?? 0) * UNITS[unit][1] : null;
  } else {
    m = QTY_LAST.exec(textNoqb);
    if (m && m[1].trim()) {
      name = m[1]; amount = num(m[2]); unit = (m[3] ?? '').toLowerCase();
      kind = unit in UNITS ? UNITS[unit][0] : 'pz';
      if (unit in UNITS) amount = UNITS[unit][1] ? (amount ?? 0) * UNITS[unit][1] : null;
    }
  }
  let measure: Measure | null = null;
  if (kind === 'qb') {
    amount = null; kind = null; qb = true;
  } else if (m && unit in HOUSEHOLD && amount !== null) {
    const count = UNITS[unit][1] ? amount / UNITS[unit][1] : null;
    measure = { count, one: HOUSEHOLD[unit][0], many: HOUSEHOLD[unit][1] };
    if (kind === 'ml' && !isLiquid(name)) { amount = amount * density(name); kind = 'g'; }
  } else if (kind === 'ml' && amount !== null && pyRe('\\b(farin|zuccher|pangratt|cacao|semol|fecol|amido)').test(normalize(name))) {
    amount = amount * density(name); kind = 'g';
  }
  name = name.replace(/\([^)]*\)/g, ' ');
  name = name.split(pyRe('\\s+(?:o|oppure|per|tagliat\\w*|a cubetti|a fette)\\s+'))[0];
  name = strip(name.replace(/\s+/g, ' '), ' ,.:;-');
  name = name.replace(pyRe("^(?:rasi|raso|rasa|colmi|colmo|colma|scarso|scarsi|abbondanti?|generos[oi])\\s+(?:di\\s+|d['’]\\s*)?", 'i'), '');
  return { text, name, amount, kind, qb, measure };
}

// ---------------------------------------------------------------- abbinamento al catalogo
const coreWords = (name: string) => tokens(normalize(name)).filter((w) => !DESCRIPTORS.has(w) && w.length >= 3);
const stemCache = new Map<string, string>();
function stem(w: string): string {
  let s = stemCache.get(w);
  if (s === undefined) { s = w.replace(/[aeiou]+$/, '') || w; stemCache.set(w, s); }
  return s;
}
const sameCache = new Map<string, boolean>();
function same(a: string, b: string): boolean {
  const key = a + '|' + b;
  let r = sameCache.get(key);
  if (r === undefined) {
    const sa = stem(a);
    const sb = stem(b);
    if (sa === sb) r = true;
    else {
      const [short, long] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
      r = short.length >= 4 && long.startsWith(short) && long.length - short.length <= 2;
    }
    sameCache.set(key, r);
  }
  return r;
}
const productWords = (p: Product) =>
  tokens(normalize(p.name)).filter((w) => !/^(\d+\w*|x\d+)$/.test(w) && !DESCRIPTORS.has(w));

type ProductMap = Record<string, Product>;
const PW = new WeakMap<ProductMap, [string, string[]][]>();
const HEADS = new WeakMap<ProductMap, Set<string>>();
const MATCH = new WeakMap<ProductMap, Map<string, [string | null, number]>>();

export function matchProduct(name: string, products: ProductMap): [string | null, number] {
  let cache = MATCH.get(products);
  if (!cache) { cache = new Map(); MATCH.set(products, cache); }
  const key = name.toLowerCase();
  let hit = cache.get(key);
  if (!hit) { hit = matchProductRaw(name, products); cache.set(key, hit); }
  return hit;
}

function matchProductRaw(name: string, products: ProductMap): [string | null, number] {
  let heads = HEADS.get(products);
  if (!heads) {
    heads = new Set(Object.values(products).flatMap((p) => productWords(p).filter((w) => w.length >= 4).map(stem)));
    HEADS.set(products, heads);
  }
  let pws = PW.get(products);
  if (!pws) { pws = Object.entries(products).map(([pid, p]) => [pid, productWords(p)]); PW.set(products, pws); }
  const words = coreWords(name);
  if (!words.length) return [null, 0];
  const w0 = words[0];
  if (w0 in R.aliases && R.aliases[w0] in products) return [R.aliases[w0], 0.95];
  let best: string | null = null;
  let bestS = 0;
  for (const [pid, pw] of pws) {
    if (!pw.length) continue;
    const hit = words.filter((w) => pw.some((x) => same(w, x)));
    if (!hit.length) continue;
    const first = same(pw[0], words[0]) ? 0.25 : 0;
    const cover = hit.length / words.length;
    const back = pw.filter((x) => words.some((w) => same(x, w))).length / pw.length;
    let s = 0.45 * cover + 0.3 * back + first;
    const missIng = words.filter((w) => !hit.includes(w) && heads.has(stem(w)));
    const missProd = pw.filter((x) => !words.some((w) => same(x, w)) && heads.has(stem(x)));
    if (missIng.length && missProd.length) s -= 0.3;
    if (s > bestS) { best = pid; bestS = s; }
  }
  return bestS >= 0.55 ? [best, pyRound(bestS, 2)] : [null, pyRound(bestS, 2)];
}

const PACK = /(\d+(?:[.,]\d+)?)\s*(kg|g|gr|ml|cl|l)(?![\p{L}\p{N}_])|x\s*(\d+)(?![\p{L}\p{N}_])/iu;

export function packOf(product: Product): [string, number] | null {
  const m = PACK.exec(product.name);
  if (!m) return null;
  if (m[3]) return ['pz', Number(m[3])];
  const v = Number(m[1].replace(',', '.'));
  const u = m[2].toLowerCase();
  return ({ kg: ['g', v * 1000], g: ['g', v], gr: ['g', v], l: ['ml', v * 1000], cl: ['ml', v * 10], ml: ['ml', v] } as Record<string, [string, number]>)[u];
}

function pieceGrams(name: string): number | null {
  const n = normalize(name);
  for (const [k, g] of Object.entries(R.piece_g)) if (pyRe('\\b' + k).test(n)) return g;
  return null;
}

/** Quanto prodotto serve davvero (unità del prodotto, senza arrotondare) e se è una stima. */
export function needed(ing: Ingredient, product: Product): [number | null, boolean] {
  const unit = product.unit;
  const ref = product.default_qty;
  const { amount, kind } = ing;
  if (amount === null || amount === undefined) return [null, true];
  let grams: number | null = null;
  if (kind === 'g' || kind === 'ml') grams = amount;
  else if (kind === 'spicchio') grams = amount * 5;
  else if (kind === 'pz' || kind === 'fetta' || kind === 'foglia') {
    const pg = pieceGrams(ing.name) || pieceGrams(product.name);
    grams = pg ? amount * pg : null;
  }
  const pack = packOf(product);
  if (unit === 'kg' || unit === 'L') {
    if (grams === null) return [ref, true];
    return [grams / 1000, !(kind === 'g' || kind === 'ml')];
  }
  if (pack && pack[0] === 'pz') return [((kind === 'pz' || kind === null) ? amount : 1) / pack[1], false];
  if (pack && grams !== null) return [grams / pack[1], false];
  if ((kind === 'pz' || kind === null) && amount) return [amount, false];
  return [1.0, true];
}

/** Da quanto serve a quanto si compra: confezioni intere, kg arrotondati ai 50 g. */
export function buyFromUsed(used: number | null, product: Product): number {
  const unit = product.unit;
  if (used === null || used === undefined) return product.default_qty;
  const pack = packOf(product);
  if (unit === 'kg') {
    if (pack && pack[0] === 'g') return pyRound(Math.max(1, Math.ceil((used * 1000) / pack[1] - 1e-9)) * pack[1] / 1000, 3);
    return pyRound(Math.max(0.05, Math.ceil(used / 0.05 - 1e-9) * 0.05), 2);
  }
  if (unit === 'L') {
    const step = pack && pack[0] === 'ml' ? pack[1] / 1000 : 0.25;
    return pyRound(Math.max(step, Math.ceil(used / step - 1e-9) * step), 3);
  }
  return Math.max(1, Math.ceil(used - 1e-9));
}

export function isPantry(name: string): boolean {
  const n = normalize(name);
  return R.pantry.some((p) => pyRe('\\b' + p).test(n));
}

const FROM_FRUIT = pyRe("^(succo|spremuta|scorza|scorzetta|buccia|zest[a-z]*|la scorza|il succo)\\s+"
  + '(?:(?:grattugiat\\w*|grattuggiat\\w*|grattat\\w*|fresc\\w*|spremut\\w*|filtrat\\w*|intera|sottile)\\s+)*'
  + "(?:di|d['’]|del|della|dello)\\s*(?:(\\d+|un|uno|una|mezzo|mezza|due|tre|quattro)\\s+)?(.+)$", 'is');

export function fromFruit(ing: Ingredient): Ingredient {
  const m = FROM_FRUIT.exec(ing.name.trim());
  if (!m) return ing;
  const part = m[1].toLowerCase();
  const nInline = m[2];
  const fruit = m[3];
  const key = Object.keys(R.fruit_juice_ml).find((k) => pyRe('\\b' + k).test(normalize(fruit)));
  if (!key) return ing;
  const [label, mlEach] = R.fruit_juice_ml[key];
  let pieces: number | null = null;
  if (nInline) pieces = num(nInline);
  else if (part.includes('succo') || part.includes('spremuta')) {
    if (ing.kind === 'ml' && ing.amount) pieces = ing.amount / mlEach;
    else if ((ing.kind === 'pz' || ing.kind === null) && ing.amount) pieces = ing.amount;
  } else {
    pieces = (ing.kind === 'pz' || ing.kind === null) && ing.amount ? ing.amount : null;
  }
  pieces = Math.max(1, Math.ceil((pieces || 1) - 1e-9));
  return { ...ing, name: label, amount: pieces, kind: 'pz', qb: false, measure: null,
    from: `${part} di ${fruit}`.toLowerCase().replace(/^(il|la) /, '') };
}

export interface PlanRow {
  text: string; name: string; amount: number | null; kind: string | null; measure: Measure | null; from?: string | null;
  product_id: string | null; match_score: number; pantry: boolean; product_name: string | null; unit: string;
  quantity: number; used?: number | null; approx: boolean; category_id?: string; recipe?: string; recipes?: string[];
}

export function plan(ingredients: string[], recipeServings: number | null | undefined, servings: number, products: ProductMap): PlanRow[] {
  const base = recipeServings || 4;
  const factor = servings / base;
  const out: PlanRow[] = [];
  for (const line of ingredients) {
    let ing = parseIngredient(line);
    if (!ing.name || R.skip.some((s) => normalize(ing.name).startsWith(s))) continue;
    if (ing.amount !== null) ing.amount = ing.amount * factor;
    if (ing.measure && ing.measure.count !== null) ing.measure = { ...ing.measure, count: pyRound(ing.measure.count * factor, 2) };
    ing = fromFruit(ing);
    const [pid, score] = matchProduct(ing.name, products);
    const row: PlanRow = {
      text: ing.text, name: ing.name, amount: ing.amount ? pyRound(ing.amount, 1) : null, kind: ing.kind,
      measure: ing.measure, from: ing.from ?? null, product_id: pid, match_score: score,
      pantry: isPantry(ing.name) || ing.qb, product_name: null, unit: 'pz', quantity: 1, approx: true,
    };
    if (pid) {
      const p = products[pid];
      const [used, approx] = needed(ing, p);
      Object.assign(row, { product_name: p.name, unit: p.unit, quantity: pyRound(buyFromUsed(used, p), 3),
        used: used !== null ? pyRound(used, 4) : null, approx });
    }
    out.push(row);
  }
  const merged = new Map<string, PlanRow>();
  const result: PlanRow[] = [];
  for (const r of out) {
    const k = r.product_id;
    if (k && merged.has(k)) {
      const m = merged.get(k)!;
      if (m.from && r.from) {
        m.quantity = Math.max(m.quantity, r.quantity);
        m.used = Math.max(m.used || 0, r.used || 0) || null;
        m.amount = Math.max(m.amount || 0, r.amount || 0);
        m.from = m.from + ' e ' + r.from.split(' di ')[0];
      } else if (m.used != null && r.used != null) {
        m.used = pyRound(m.used + r.used, 4);
        m.quantity = pyRound(buyFromUsed(m.used, products[k]), 3);
      } else {
        m.quantity = Math.max(m.quantity, r.quantity);
      }
      m.text += ' + ' + r.text;
      m.pantry = m.pantry && r.pantry;
      continue;
    }
    if (k) merged.set(k, r);
    result.push(r);
  }
  return result;
}

/** Più ricette in un'unica lista: si somma quanto serve, poi si arrotonda una volta sola. */
export function mergeRows(groups: PlanRow[][], products: ProductMap): PlanRow[] {
  const out = new Map<string, PlanRow>();
  const order: string[] = [];
  for (const rows of groups) {
    for (const r of rows) {
      const key = r.product_id || 'new:' + normalize(r.name);
      if (!out.has(key)) {
        out.set(key, { ...r, recipes: r.recipe ? [r.recipe] : [] });
        order.push(key);
        continue;
      }
      const m = out.get(key)!;
      if (r.recipe && !m.recipes!.includes(r.recipe)) m.recipes!.push(r.recipe);
      m.pantry = m.pantry && r.pantry;
      m.text = m.text + ' + ' + r.text;
      if (r.product_id) {
        if (m.used != null && r.used != null) {
          m.used = pyRound(m.used + r.used, 4);
          m.quantity = pyRound(buyFromUsed(m.used, products[r.product_id]), 3);
        } else m.quantity = Math.max(m.quantity, r.quantity);
      }
    }
  }
  return order.map((k) => out.get(k)!);
}

export function substitutes(pid: string): Set<string> {
  for (const g of R.substitutes) if (g.includes(pid)) return new Set(g);
  return new Set([pid]);
}

export interface RecipeLike { id?: string; name: string; ingredients: string[]; servings?: number | null; categories?: string[] | null }

export function search<T extends RecipeLike>(items: T[], q: string, limit = 40): T[] {
  const nq = normalize(q);
  if (!nq) return items.slice(0, limit);
  const words = nq.split(/\s+/);
  const scored: [number, string, T][] = [];
  for (const r of items) {
    const n = normalize(r.name);
    const ing = normalize((r.ingredients || []).join(' '));
    let s = 0;
    if (n.startsWith(nq)) s += 5;
    s += words.filter((w) => n.includes(w)).length * 2 + words.filter((w) => ing.includes(w)).length;
    if (words.every((w) => n.includes(w) || ing.includes(w)) && s) scored.push([-s, r.name.toLowerCase(), r]);
  }
  scored.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return scored.slice(0, limit).map((x) => x[2]);
}
