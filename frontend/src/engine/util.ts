/**
 * Funzioni di base del motore (porting fedele del backend Python).
 * Attenzione agli arrotondamenti: Python usa l'arrotondamento "al pari" sui pareggi esatti.
 */

/** round(x, n) come in Python (pareggi esatti al numero pari, il resto come toFixed). */
export function pyRound(x: number, n = 0): number {
  if (!Number.isFinite(x)) return x;
  // espansione decimale esatta del numero binario: pareggio solo se dopo la cifra n c'è esattamente "5000…"
  const exact = Math.abs(x).toFixed(100);
  const dot = exact.indexOf('.');
  const rest = exact.slice(dot + 1 + n);
  if (/^50*$/.test(rest)) {
    const p = 10 ** n;
    const f = Math.floor(Math.abs(x) * p);
    const r = (f % 2 === 0 ? f : f + 1) / p;
    return x < 0 ? -r : r;
  }
  const r = parseFloat(x.toFixed(n));
  return r === 0 ? 0 : r;
}

/** statistics.median */
export function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  if (!n) throw new Error('median of empty');
  return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
}

export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  a.forEach((x) => { if (b.has(x)) inter += 1; });
  return inter / (a.size + b.size - inter);
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dlat = rad(lat2 - lat1);
  const dlon = rad(lon2 - lon1);
  const a = Math.sin(dlat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dlon / 2) ** 2;
  return 2 * 6371.0 * Math.asin(Math.sqrt(a));
}

/** str.strip(chars) di Python */
export function strip(s: string, chars = ' \t\n\r\f\v'): string {
  let a = 0;
  let b = s.length;
  while (a < b && chars.includes(s[a])) a += 1;
  while (b > a && chars.includes(s[b - 1])) b -= 1;
  return s.slice(a, b);
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// \b di Python sulle stringhe è Unicode: in JS lo ricostruiamo con le lettere Unicode
const W = '[\\p{L}\\p{N}_]';
export const B_START = `(?<!${W})(?=${W})`; // \b davanti a una parola
export const B_END = `(?<=${W})(?!${W})`; // \b dopo una parola
/** Converte \b e \w (sintassi Python) in equivalenti Unicode per RegExp con flag "u". */
export function pyRe(src: string, flags = ''): RegExp {
  // \b dopo un pezzo di parola (lettera, gruppo chiuso, quantificatore) = fine parola, altrimenti inizio
  const out = src
    .replace(/\\b/g, (_m, offset: number, whole: string) => {
      const prev = whole[offset - 1];
      return prev && /[\p{L}\p{N}_)\]*+?}]/u.test(prev) ? B_END : B_START;
    })
    .replace(/\\w/g, W);
  return new RegExp(out, flags.includes('u') ? flags : flags + 'u');
}

/** unicodedata NFKD + rimozione dei segni diacritici + minuscole, come classify.normalize */
export function normalize(text: string): string {
  const t = text.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
  return t.replace(/[^a-z0-9' ]+/g, ' ').trim();
}

// ------------------------------------------------------------------ difflib.SequenceMatcher(None, a, b).ratio()
export function seqRatio(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (!la && !lb) return 1;
  // b2j: posizioni dei caratteri di b (senza "junk"; autojunk vale solo con len(b) >= 200)
  const b2j = new Map<string, number[]>();
  for (let j = 0; j < lb; j++) {
    const c = b[j];
    const arr = b2j.get(c);
    if (arr) arr.push(j); else b2j.set(c, [j]);
  }
  if (lb >= 200) {
    const ntest = Math.floor(lb / 100) + 1;
    for (const [c, idx] of [...b2j.entries()]) if (idx.length > ntest) b2j.delete(c);
  }
  const findLongest = (alo: number, ahi: number, blo: number, bhi: number): [number, number, number] => {
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map<number, number>();
      const js = b2j.get(a[i]) ?? [];
      for (const j of js) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
      }
      j2len = newj2len;
    }
    // (nessun junk: le estensioni sui junk di difflib non servono qui)
    return [besti, bestj, bestsize];
  };
  let matches = 0;
  const queue: [number, number, number, number][] = [[0, la, 0, lb]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const [i, j, k] = findLongest(alo, ahi, blo, bhi);
    if (k) {
      matches += k;
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  return (2 * matches) / (la + lb);
}
