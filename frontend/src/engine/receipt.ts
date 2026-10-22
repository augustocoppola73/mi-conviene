/**
 * #32: lettura dello scontrino nel telefono (porting di backend/receipts.py, senza l'OCR).
 * Il testo lo legge il lettore del telefono (ML Kit) e arriva qui come riquadri con le coordinate:
 * 1. ricostruzione delle righe (foto storta compresa);
 * 2. più foto dello stesso scontrino unite togliendo le righe ripetute nella parte sovrapposta;
 * 3. interpretazione a regole del «documento commerciale» italiano: articoli, quantità, pesi, sconti, totale, data, negozio;
 * 4. abbinamento righe ↔ prodotti (prima quelli della spesa, poi il catalogo).
 * Nessuna AI: regole e somiglianza di testo, tutto ispezionabile. La foto non lascia il telefono.
 */
import { tokens } from './classify';
import { chainOf } from './places';
import { escapeRe, median, normalize, pyRe, pyRound, seqRatio } from './util';

/** un pezzo di testo letto, con i 4 angoli (alto-sinistra, alto-destra, basso-destra, basso-sinistra) */
export type OcrBox = { box: [number, number][]; text: string };

const PRICE = String.raw`-?\d{1,4}[,.]\d{2}`;
const PRICE_G = () => new RegExp(PRICE, 'g');
const SKIP = pyRe(String.raw`\b(sub\s*totale|totale|iva|contant|resto|pagament|bancomat|carta|elettronic|importo|documento|commerciale|p\.?\s*iva|c\.?f\.?|cassa|cassiere|scontrino|n\.?\s*doc|doc\.?\s*n|articoli|pezzi|reso|vendita|prestazione|descrizione|prezzo|euro|tel\.?|www|grazie|arrivederci|punti|saldo|ricevuta|rt\b|matricola|operatore|non fiscale)`, 'i');
const TOTAL = pyRe(String.raw`\b(totale\s*complessivo|totale\s*euro|totale\s*eur|importo\s*pagato|totale)\b`, 'i');
const DISCOUNT = pyRe(String.raw`\b(sconto|sc\.|promo|offerta|risparmio|buono)\b`, 'i');
const QTY_LINE = new RegExp(String.raw`^\s*(\d+(?:[,.]\d+)?)\s*(?:pz|n\.?)?\s*[x×*]?\s+(` + PRICE + String.raw`)\s*$`, 'i');
const WEIGHT = pyRe(String.raw`\bkg\s*(\d+[,.]\d{1,3})\s*[x×*]?\s*(?:€\s*)?(\d+[,.]\d{2})?`, 'i');
const DATE = /(?<!\d)(\d{2})[-/.](\d{2})[-/.](\d{2,4})(?!\d)/;
const VAT_G = () => pyRe(String.raw`\b\d{1,2}\s?%|\b(?:vi|v\.i\.|esente|es)\b`, 'gi');
const PACK = pyRe(String.raw`(\d+(?:[,.]\d+)?)\s*(kg|g|gr|l|lt|ml|cl)\b`, 'i');

// abbreviazioni comuni sugli scontrini -> parola intera
const ABBR: Record<string, string> = {
  extrav: 'extravergine', ev: 'extravergine', regg: 'reggiano', parm: 'parmigiano', pom: 'pomodoro', pomod: 'pomodoro',
  mozz: 'mozzarella', prosc: 'prosciutto', biol: 'biologico', integr: 'integrale', fr: 'fresco', uht: 'latte', pz: '', conf: '',
  gr: '', bott: 'bottiglia', nat: 'naturale', friz: 'frizzante', verd: 'verdura', detersiv: 'detersivo', lav: 'lavatrice',
  spagh: 'spaghetti', 'carta ig': 'carta igienica', zucch: 'zucchine', insal: 'insalata', yog: 'yogurt',
};

const num = (s: string) => Number(s.replace(',', '.'));
const prices = (t: string) => t.match(PRICE_G()) ?? [];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// ---------------------------------------------------------------- righe
/** Raggruppa i pezzi di testo per riga, compensando la rotazione della foto. */
export function groupRows(boxes: OcrBox[]): string[] {
  if (!boxes.length) return [];
  const slopes: number[] = [];
  const heights: number[] = [];
  for (const { box } of boxes) {
    const [[x0, y0], [x1, y1]] = box;
    if (x1 - x0 > 40) slopes.push((y1 - y0) / (x1 - x0));
    heights.push(Math.abs(box[3][1] - box[0][1]) || 10);
  }
  const slope = slopes.length ? median(slopes) : 0;
  const h = median(heights);
  const items = boxes.map(({ box, text }) => {
    const cx = box.reduce((t, p) => t + p[0], 0) / 4;
    const cy = box.reduce((t, p) => t + p[1], 0) / 4;
    return { y: cy - slope * cx, x: cx, text };   // y «raddrizzata»
  }).sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: typeof items[] = [];
  for (const it of items) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(it.y - mean(last.map((r) => r.y))) < h * 0.6) last.push(it);
    else rows.push([it]);
  }
  return rows.map((r) => [...r].sort((a, b) => a.x - b.x).map((z) => z.text).join(' '));
}

const rowKey = (row: string) => normalize(row.replace(/,/g, '.')).replace(/\s+/g, ' ');
function rowSim(a: string, b: string): number {
  const ka = rowKey(a);
  const kb = rowKey(b);
  if (!ka || !kb) return 0;
  const pa = ka.match(/\d+\.\d{2}/g) ?? [];
  const pb = kb.match(/\d+\.\d{2}/g) ?? [];
  if (pa.length && pb.length && pa[pa.length - 1] !== pb[pb.length - 1]) return 0;   // stesso testo ma prezzo diverso: righe diverse
  return seqRatio(ka, kb);
}

/**
 * Unisce le righe di più foto dello stesso scontrino (fatte dall'alto in basso).
 * Le righe in comune tra la fine di una foto e l'inizio della successiva si tengono una volta sola.
 * Restituisce le righe unite e, per ogni foto dopo la prima, quante righe ripetute sono state tolte.
 */
export function mergeRows(parts: string[][], maxOverlap = 15): { rows: string[]; removed: number[] } {
  const merged: string[] = [];
  const removed: number[] = [];
  parts.forEach((raw, i) => {
    const rows = raw.filter((r) => r.trim());
    if (i === 0 || !merged.length) { merged.push(...rows); return; }
    let best = 0;
    for (let k = Math.min(maxOverlap, merged.length, rows.length); k > 0; k--) {
      const sims = merged.slice(-k).map((a, j) => rowSim(a, rows[j]));
      // tutte le coppie devono somigliarsi; una riga sola deve essere «robusta» (testo + prezzo)
      if (Math.min(...sims) >= 0.75 && mean(sims) >= 0.85 && (k > 1 || (rowKey(rows[0]).length >= 8 && new RegExp(PRICE).test(rows[0])))) { best = k; break; }
    }
    if (best === 0) {
      // l'inizio della foto potrebbe ripetere righe più in alto (foto sovrapposte «a salti»)
      outer: for (let j = 0; j < Math.min(4, rows.length); j++) {
        for (let k = Math.min(maxOverlap, merged.length, rows.length - j); k > 1; k--) {
          const sims = merged.slice(-k).map((a, t) => rowSim(a, rows[j + t]));
          if (Math.min(...sims) >= 0.75 && mean(sims) >= 0.85) { best = j + k; break outer; }
        }
      }
    }
    removed.push(best);
    merged.push(...rows.slice(best));
  });
  return { rows: merged, removed };
}

// ---------------------------------------------------------------- interpretazione
export interface ParsedLine {
  text: string; price: number; quantity: number; weight_kg: number | null; discount: number; net_price: number;
}
export interface ParsedReceipt {
  store_id: string | null; date: string | null; total: number | null; lines: ParsedLine[]; lines_sum: number; total_matches: boolean;
}

type Work = Partial<ParsedLine> & { _weight?: number; _unit_price?: number | null };

function attachQty(lines: Work[], qty: number, unit: number): boolean {
  const target = pyRound(qty * unit, 2);
  const prev = [...lines].reverse().find((l) => l.price != null);
  if (prev && Math.abs(prev.price! - target) < 0.02) { prev.quantity = qty; return true; }
  return false;
}

export function parseRows(rows: string[]): ParsedReceipt {
  const lines: Work[] = [];
  let pendingQty: [number, number] | null = null;   // «2 x 0,79» letto prima del suo articolo
  let total: number | null = null;
  let date: string | null = null;
  let store: string | null = null;
  for (const raw of rows) {
    const text = raw.trim();
    if (!text) continue;
    if (!store) store = chainOf({ osm_name: text });
    const m = DATE.exec(text);
    if (m && !date) {
      const [, d, mo, y0] = m;
      const y = y0.length === 2 ? `20${y0}` : y0;
      date = `${y}-${mo}-${d}`;
    }
    const ps = prices(text);
    if (TOTAL.test(text) && !/sub\s*totale|di cui|iva/i.test(text) && ps.length) { total = num(ps[ps.length - 1]); continue; }
    const q = QTY_LINE.exec(text.replace(VAT_G(), ' '));
    if (q) {
      const qty = num(q[1]); const unit = num(q[2]);
      if (!attachQty(lines, qty, unit)) pendingQty = [qty, unit];
      continue;
    }
    const w = WEIGHT.exec(text);
    if (w && !new RegExp(`[a-z]{3,}.*${PRICE}\\s*$`, 'i').test(text.replace(WEIGHT, ''))) {
      lines.push({ _weight: num(w[1]), _unit_price: w[2] ? num(w[2]) : null });
      continue;
    }
    if (DISCOUNT.test(text) && ps.length && lines.length) {
      const d = Math.abs(num(ps[ps.length - 1]));
      const prev = [...lines].reverse().find((l) => l.price != null);
      if (prev) prev.discount = pyRound((prev.discount ?? 0) + d, 2);
      continue;
    }
    if (SKIP.test(text) || !ps.length) continue;
    const desc = text.replace(VAT_G(), ' ').replace(new RegExp(`${PRICE}\\s*€?\\s*$`), '').trim().replace(/^[ .\-*€]+|[ .\-*€]+$/g, '');
    if (desc.replace(/[^a-zA-Z]/g, '').length < 3) continue;
    const line: Work = { text: desc, price: num(ps[ps.length - 1]), quantity: 1, weight_kg: null };
    const last = lines[lines.length - 1];
    if (last && last._weight != null) { lines.pop(); line.weight_kg = last._weight; }   // «BANANE KG 1,120 x 1,59» sopra
    if (pendingQty && Math.abs(pendingQty[0] * pendingQty[1] - line.price!) < 0.02) line.quantity = pendingQty[0];
    pendingQty = null;
    lines.push(line);
  }
  const items: ParsedLine[] = lines.filter((l) => l.price != null).map((l) => ({
    text: l.text!, price: l.price!, quantity: l.quantity ?? 1, weight_kg: l.weight_kg ?? null,
    discount: l.discount ?? 0, net_price: pyRound(l.price! - (l.discount ?? 0), 2),
  }));
  const linesSum = pyRound(items.reduce((t, l) => t + l.net_price, 0), 2);
  return { store_id: store, date, total, lines: items, lines_sum: linesSum, total_matches: total != null && Math.abs(total - linesSum) < 0.02 };
}

// ---------------------------------------------------------------- abbinamento
function expand(text: string): string {
  let t = ` ${normalize(text)} `;
  for (const [k, v] of Object.entries(ABBR)) t = t.replace(new RegExp(`(?<![a-z])${escapeRe(k)}(?![a-z])`, 'g'), ` ${v} `);
  return t.replace(/\s+/g, ' ').trim();
}

export function matchScore(receiptText: string, productName: string): number {
  const a = expand(receiptText);
  const b = normalize(productName);
  const at = tokens(a).filter((w) => w.length >= 3);
  const bt = tokens(b);
  if (!at.length || !bt.length) return 0;
  const hit = at.filter((w) => bt.some((x) => x.startsWith(w.slice(0, Math.max(3, Math.min(w.length, 5)))) || w.startsWith(x.slice(0, 5)))).length;
  const cover = hit / at.length;
  const back = bt.filter((x) => at.some((w) => x.startsWith(w.slice(0, 4)) || w.startsWith(x.slice(0, 4)))).length / bt.length;
  return pyRound(0.45 * cover + 0.35 * back + 0.2 * seqRatio(a, b), 3);
}

export interface Matched { product_id: string | null; product_name: string | null; match_score: number; expected: boolean }

export function matchLines<P extends { id: string; name: string }>(parsed: ParsedReceipt, products: Record<string, P>, expectedIds: string[]) {
  const used = new Set<string>();
  const order = [...new Set(expectedIds), ...Object.keys(products)];
  const lines = parsed.lines.map((line) => {
    let best: string | null = null;
    let bestS = 0;
    for (const pid of order) {
      const p = products[pid];
      if (!p) continue;
      const sc = matchScore(line.text, p.name) + (expectedIds.includes(pid) ? 0.12 : 0) - (used.has(pid) ? 0.2 : 0);
      if (sc > bestS) { best = pid; bestS = sc; }
    }
    const ok = bestS >= 0.45;
    if (ok) used.add(best!);
    return { ...line, product_id: ok ? best : null, product_name: ok ? products[best!].name : null, match_score: pyRound(bestS, 2),
      expected: ok && expectedIds.includes(best!) };
  });
  return { ...parsed, lines, missing_expected: expectedIds.filter((pid) => !used.has(pid)) };
}
