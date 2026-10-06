/** Classificazione dei prodotti scritti a mano (porting di backend/classify.py). */
import { CATEGORIES, CLASSIFY, PRODUCTS } from './data';
import { escapeRe, normalize, pyRound, seqRatio } from './util';

const STOPWORDS = new Set(CLASSIFY.stopwords);
const GENERIC = new Set(CLASSIFY.generic);

export function tokens(text: string): string[] {
  return normalize(text).replace(/'/g, ' ').split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w) && !/^\d+$/.test(w) && w.length > 1);
}

const stem = (w: string) => (w.length > 4 && 'aeio'.includes(w[w.length - 1]) ? w.slice(0, -1) : w);

const NORM_NAMES: Record<string, string> = Object.fromEntries(PRODUCTS.map((p) => [p.id, normalize(p.name)]));
const CATALOG_WORDS = new Map<string, Map<string, number>>();
for (const p of PRODUCTS) {
  for (const w of tokens(p.name)) {
    const k = stem(w);
    const m = CATALOG_WORDS.get(k) ?? new Map<string, number>();
    m.set(p.category_id, (m.get(p.category_id) ?? 0) + 1);
    CATALOG_WORDS.set(k, m);
  }
}
const KEY_RES: [string, string, RegExp][] = [];
for (const [cat, keys] of Object.entries(CLASSIFY.keywords)) {
  for (const k0 of keys) {
    const k = normalize(k0);
    if (k) KEY_RES.push([cat, k, new RegExp('(?<![a-z])' + escapeRe(k))]);
  }
}
const CAT_INDEX = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

export function categoryOf(text: string): [string | null, number] {
  const norm = ' ' + normalize(text) + ' ';
  const scores = new Map<string, number>();
  for (const [cat, k, re] of KEY_RES) {
    if (re.test(norm)) scores.set(cat, (scores.get(cat) ?? 0) + 2 + k.length / 10);
  }
  for (const w of tokens(text)) {
    const m = CATALOG_WORDS.get(stem(w));
    if (m) m.forEach((n, cat) => scores.set(cat, (scores.get(cat) ?? 0) + Math.min(n, 3) * 0.5));
  }
  if (!scores.size) return [null, 0];
  let best: [string, number] | null = null;
  scores.forEach((v, k) => { if (!best || v > best[1]) best = [k, v]; });
  return [best![0], pyRound(best![1], 2)];
}

export interface Similar { product_id: string; name: string; category_id: string; score: number }

export function similarProducts(text: string, limit = 3): Similar[] {
  const norm = normalize(text);
  const qt = new Set(tokens(text).filter((w) => !GENERIC.has(w) && !GENERIC.has(stem(w))).map(stem));
  const out: Similar[] = [];
  for (const p of PRODUCTS) {
    const name = NORM_NAMES[p.id];
    const ratio = seqRatio(norm, name);
    const pt = new Set(tokens(p.name).filter((w) => !GENERIC.has(w) && !GENERIC.has(stem(w))).map(stem));
    let inter = 0;
    qt.forEach((q) => { if (pt.has(q)) inter += 1; });
    const overlap = qt.size ? inter / qt.size : 0;
    let prefix = 0;
    for (const q of qt) {
      for (const n of pt) {
        if ((n.startsWith(q.slice(0, 5)) || q.startsWith(n.slice(0, 5))) && q.length >= 6 && n.length >= 6
          && (n.startsWith(q.slice(0, 6)) || q.startsWith(n.slice(0, 6)))) prefix = 1;
      }
    }
    if (!overlap && !prefix && ratio < 0.85) continue;
    const score = Math.max(ratio, 0.55 * overlap + 0.45 * ratio, 0.6 * prefix + 0.4 * ratio);
    if (score >= 0.7) out.push({ product_id: p.id, name: p.name, category_id: p.category_id, score: pyRound(score, 2) });
  }
  // sort stabile per punteggio decrescente, come Python
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

export function classify(text: string) {
  let [cat, conf] = categoryOf(text);
  const similar = similarProducts(text);
  if (similar.length && (!cat || similar[0].score >= 0.85)) cat = similar[0].category_id;
  cat = cat ?? 'altro';
  const c = CAT_INDEX[cat] ?? { id: 'altro', name: 'Altro', emoji: '🛒' };
  return {
    text: text.trim(), category_id: c.id, category_name: c.name, emoji: c.emoji, confidence: conf, similar,
    exact: similar.find((s) => s.score >= 0.92) ?? null,
  };
}
