/** Prezzi visti (scontrino a mano, in negozio): riga → prezzo di riferimento e righe da salvare. */
import { C, PRODUCT_INDEX, Product } from './data';
import { pyRe, pyRound } from './util';

const PACK = pyRe('(\\d+(?:[,.]\\d+)?)\\s*(kg|g|gr|l|lt|ml|cl)\\b', 'i');
const num = (s: string) => parseFloat(s.replace(',', '.'));

export interface ObservedLine {
  product_id?: string | null; text: string; net_price: number; quantity?: number; weight_kg?: number | null;
  kind?: 'normale' | 'offerta' | 'variante'; gross_price?: number | null; promo_until?: string | null; note?: string | null;
}

/** Prezzo della riga riportato alla quantità di riferimento del catalogo (receipts.reference_price). */
export function referencePrice(line: ObservedLine, product: Product): number | null {
  const price = line.net_price;
  const qty = line.quantity ?? 1;
  const unit = product.unit;
  const ref = product.default_qty;
  if (unit === 'kg') {
    let kg = line.weight_kg || null;
    if (!kg) {
      const m = PACK.exec(line.text);
      if (m) {
        const v = num(m[1]);
        const u = m[2].toLowerCase();
        kg = u === 'g' || u === 'gr' ? v / 1000 : u === 'kg' ? v : null;
      }
    }
    if (kg) {
      kg *= qty;
      return kg > 0 ? pyRound((price / kg) * ref, 2) : null;
    }
    return ref === 1 ? pyRound(price / Math.max(qty, 1), 2) : null;
  }
  if (unit === 'L') {
    const m = PACK.exec(line.text);
    if (m && ['l', 'lt', 'ml', 'cl'].includes(m[2].toLowerCase())) {
      const v = num(m[1]);
      const u = m[2].toLowerCase();
      let liters = u === 'ml' ? v / 1000 : u === 'cl' ? v / 100 : v;
      liters *= qty;
      return liters > 0 ? pyRound((price / liters) * ref, 2) : null;
    }
  }
  return pyRound((price / Math.max(qty, 1)) * ref, 2);
}

const addDays = (iso: string, days: number) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const validDate = (s?: string | null) => !!s && /^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(Date.parse(s));

/** Righe per la tabella user_prices (come save_observed_prices). Restituisce [righe, quante righe di scontrino valide]. */
export function observedRows(lines: ObservedLine[], storeId: string, date: string, locationName: string | null) {
  const rows: any[] = [];
  let saved = 0;
  for (const l of lines) {
    const p = PRODUCT_INDEX[l.product_id || ''];
    if (!p) continue;
    const ref = referencePrice(l, p);
    if (!ref || ref <= 0) continue;
    const base = { store_id: storeId, product_id: p.id, quantity: l.quantity ?? 1, weight_kg: l.weight_kg ?? null,
      receipt_text: l.text, date, location_name: locationName, note: l.note ?? null };
    const kind = l.kind ?? 'normale';
    if (kind === 'offerta') {
      const until = validDate(l.promo_until) ? l.promo_until!.slice(0, 10) : addDays(date, C.promo_default_days);
      rows.push({ ...base, kind: 'offerta', ref_price: ref, paid: l.net_price, promo_until: until });
      if (l.gross_price && l.gross_price > l.net_price) {
        const gross = referencePrice({ ...l, net_price: l.gross_price }, p);
        if (gross) rows.push({ ...base, kind: 'normale', ref_price: gross, paid: l.gross_price });
      }
    } else {
      rows.push({ ...base, kind, ref_price: ref, paid: l.net_price });
    }
    saved += 1;
  }
  return { rows, saved };
}
