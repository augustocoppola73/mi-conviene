/**
 * Motore di convenienza (porting fedele di backend/server.py): catalogo prezzi, scontrino virtuale,
 * viaggio, distributore sulla strada, scelta del negozio, risparmio, abitudini, budget.
 */
import { C, ESTIMATES, PRODUCT_INDEX, STORE_INDEX, STORES } from './data';
import { haversineKm, jaccard, median, pyRound } from './util';

// ------------------------------------------------------------------ catalogo prezzi
export interface PriceEntry {
  normal_price: number; promo_price: number | null; final_price: number; loyalty_required: boolean;
  confidence: 'green' | 'yellow' | 'red'; source: string; observed_at: string | null;
  location_name: string | null; sample_product: string | null; proof_url: string | null;
  promo_until?: string | null; promo_source?: string;
}
export type Catalog = Record<string, Record<string, PriceEntry>>;

export interface RealPrice {
  normal_price: number; promo_price?: number | null; source: string; confidence: 'green' | 'yellow' | 'red';
  observed_at?: string | null; location_name?: string | null; sample_product?: string | null; proof_url?: string | null;
}
/** riga della tabella user_prices (prezzi visti dagli utenti) */
export interface UserPrice {
  store_id: string; product_id: string; kind: 'normale' | 'offerta' | 'variante'; ref_price: number; paid?: number | null;
  receipt_text?: string | null; note?: string | null; location_name?: string | null; date: string; promo_until?: string | null;
}
export interface Variant { price: number; ref_price: number; text: string | null; observed_at: string; note?: string | null }

const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

export function receiptEntry(doc: UserPrice, now = today()): RealPrice {
  const age = daysBetween(doc.date, now);
  return {
    normal_price: Number(doc.ref_price), promo_price: null, source: 'scontrino', observed_at: doc.date,
    confidence: age <= 60 ? 'green' : age <= 365 ? 'yellow' : 'red',
    location_name: doc.location_name || STORE_INDEX[doc.store_id]?.name || doc.store_id,
    sample_product: doc.receipt_text ?? null, proof_url: null,
  };
}

export interface PriceBook {
  catalog: Catalog;
  variants: Record<string, Variant>; // "store|product"
}

/** Stime < Open Prices < prezzi visti dagli utenti; poi le offerte viste ancora valide. */
export function buildPriceBook(openPrices: Record<string, RealPrice>, userPrices: UserPrice[], now = today()): PriceBook {
  const receiptPrices: Record<string, RealPrice> = {};
  const promos: Record<string, { promo_price: number; until: string | null }> = {};
  const variants: Record<string, Variant> = {};
  for (const d of [...userPrices].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    if (!STORE_INDEX[d.store_id] || !PRODUCT_INDEX[d.product_id]) continue;
    const key = `${d.store_id}|${d.product_id}`;
    if (d.kind === 'offerta') promos[key] = { promo_price: Number(d.ref_price), until: d.promo_until ?? null };
    else if (d.kind === 'variante') {
      variants[key] = { price: Number(d.paid ?? d.ref_price), ref_price: Number(d.ref_price), text: d.receipt_text ?? null,
        observed_at: d.date, note: d.note ?? null };
    } else receiptPrices[key] = receiptEntry(d, now);
  }
  const real = { ...openPrices, ...receiptPrices };
  const catalog: Catalog = {};
  for (const store of STORES) {
    const sid = store.id;
    catalog[sid] = {};
    for (const [pid, normal] of Object.entries(ESTIMATES[sid])) {
      const e: PriceEntry = {
        normal_price: normal, promo_price: null, final_price: normal, loyalty_required: false, confidence: 'red',
        source: 'stima', observed_at: null, location_name: null, sample_product: null, proof_url: null,
      };
      const r = real[`${sid}|${pid}`];
      if (r) {
        Object.assign(e, {
          normal_price: r.normal_price, promo_price: r.promo_price ?? null,
          final_price: r.promo_price ? r.promo_price : r.normal_price, loyalty_required: false,
          confidence: r.confidence, source: r.source, observed_at: r.observed_at ?? null,
          location_name: r.location_name ?? null, sample_product: r.sample_product ?? null, proof_url: r.proof_url ?? null,
        });
      }
      catalog[sid][pid] = e;
    }
  }
  for (const [key, promo] of Object.entries(promos)) {
    if ((promo.until ?? '') < now) continue;
    const [sid, pid] = key.split('|');
    const e = catalog[sid]?.[pid];
    if (e && promo.promo_price < e.normal_price) {
      Object.assign(e, { promo_price: promo.promo_price, final_price: promo.promo_price, promo_until: promo.until, promo_source: 'scontrino' });
    }
  }
  return { catalog, variants };
}

// ------------------------------------------------------------------ scontrino virtuale
export interface ListItem { product_id: string; quantity: number; name?: string | null; category_id?: string | null; unit?: string | null }

export function computeVirtualReceipt(book: PriceBook, storeId: string, items: ListItem[]) {
  const lines: any[] = [];
  const unknown: string[] = [];
  const custom: any[] = [];
  let total = 0;
  let normalTotal = 0;
  for (const it of items) {
    if (it.product_id.startsWith('custom:')) {
      custom.push({ product_id: it.product_id, name: it.name || it.product_id.slice(7), quantity: it.quantity,
        unit: it.unit || 'pz', category_id: it.category_id ?? null });
      continue;
    }
    const product = PRODUCT_INDEX[it.product_id];
    const info = book.catalog[storeId]?.[it.product_id];
    if (!product || !info) { unknown.push(it.product_id); continue; }
    const ratio = it.quantity / product.default_qty;
    const linePrice = pyRound(info.final_price * ratio, 2);
    const lineNormal = pyRound(info.normal_price * ratio, 2);
    total += linePrice;
    normalTotal += lineNormal;
    lines.push({
      product_id: it.product_id, name: product.name, quantity: it.quantity, unit: product.unit,
      unit_price: info.final_price, normal_price: lineNormal, line_price: linePrice,
      in_promo: info.promo_price !== null, promo_until: info.promo_until ?? null,
      variant: book.variants[`${storeId}|${it.product_id}`] ?? null,
      loyalty_required: info.loyalty_required, confidence: info.confidence, source: info.source,
      observed_at: info.observed_at, location_name: info.location_name, sample_product: info.sample_product,
      proof_url: info.proof_url,
    });
  }
  const realLines = lines.filter((l) => l.source !== 'stima').length;
  return {
    lines, unknown_products: unknown, custom_items: custom, real_lines: realLines,
    total: pyRound(total, 2), normal_total: pyRound(normalTotal, 2), savings_vs_normal: pyRound(normalTotal - total, 2),
  };
}

// ------------------------------------------------------------------ carburante e viaggio
export interface FuelStation { id: string; brand: string; name?: string; address: string; city: string; lat: number; lon: number;
  prices: Record<string, { self?: number; servito?: number }>; updated?: string | null }
export interface FuelInfo { fuel_type: string; price_per_liter: number; source: 'mimit' | 'stima'; observed_at: string | null; stations: number }

/** Mediana del prezzo self entro 10 km (come fuel.median_price), altrimenti il valore fisso. */
export function fuelInfo(fuelType: string, stations: FuelStation[], lat?: number | null, lon?: number | null,
  observedAt: string | null = null, radiusKm = 10): FuelInfo {
  if (lat != null && lon != null) {
    const prices = stations
      .filter((s) => haversineKm(lat, lon, s.lat, s.lon) <= radiusKm)
      .map((s) => s.prices[fuelType]?.self)
      .filter((p): p is number => p != null && p > 0.5 && p < 4);
    if (prices.length) {
      return { fuel_type: fuelType, price_per_liter: pyRound(median(prices), 3), source: 'mimit', observed_at: observedAt, stations: prices.length };
    }
  }
  return { fuel_type: fuelType, price_per_liter: C.fallback_fuel_price, source: 'stima', observed_at: null, stations: 0 };
}

export function computeTravel(store: { distance_km: number }, transport: string, fuel: FuelInfo) {
  const distance = store.distance_km;
  const timeMin = (distance * 2 / C.transport_speed[transport]) * 60;
  const costPerKm = C.fuel_consumption_l_100km / 100 * fuel.price_per_liter;
  const fuelCost = transport === 'car' ? distance * 2 * costPerKm : 0;
  const timeCost = (timeMin / 60) * C.time_value;
  return { distance_km: distance, time_min: pyRound(timeMin), fuel_cost: pyRound(fuelCost, 2), time_cost: pyRound(timeCost, 2) };
}

const mapsUrl = (lat: number, lon: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;

export function bestFuelStop(home: [number, number], storePt: [number, number], stations: FuelStation[],
  fuelType: string, liters: number, med: number | null) {
  if (!med) return null;
  const direct = haversineKm(home[0], home[1], storePt[0], storePt[1]);
  const cands: any[] = [];
  for (const st of stations) {
    const price = st.prices[fuelType]?.self;
    if (price == null) continue;
    let detour = (haversineKm(home[0], home[1], st.lat, st.lon) + haversineKm(st.lat, st.lon, storePt[0], storePt[1]) - direct) * C.road_factor;
    detour = Math.max(detour, 0);
    if (detour > C.max_detour_km) continue;
    const detourFuel = detour * C.fuel_consumption_l_100km / 100 * price;
    const detourMin = detour / C.transport_speed.car * 60;
    const cost = price * liters + detourFuel;
    const rank = cost + C.time_weight * detourMin / 60 * C.time_value;
    cands.push({ _rank: rank, _cost: cost, station_id: st.id, brand: st.brand, address: st.address, city: st.city,
      lat: st.lat, lon: st.lon, price, detour_km: pyRound(detour, 1), detour_min: pyRound(detourMin),
      detour_cost: pyRound(detourFuel, 2), liters, median: med, fill_cost: pyRound(price * liters, 2),
      saving: pyRound(med * liters - cost, 2), updated: st.updated ?? null, maps_url: mapsUrl(st.lat, st.lon) });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => a._rank - b._rank);
  const best = cands[0];
  best.alternatives = cands.slice(1, 4).map((c) => ({
    brand: c.brand, address: c.address, city: c.city, price: c.price, detour_km: c.detour_km, maps_url: c.maps_url,
    updated: c.updated, extra_cost: pyRound(c._cost - best._cost, 2),
  }));
  for (const c of cands) { delete c._rank; delete c._cost; }
  return best;
}

// ------------------------------------------------------------------ scelta del negozio
export const euro = (x: number) => `€${pyRound(x, 2).toFixed(2)}`.replace('.', ',');
// Python f"{x:.2f}" arrotonda il valore binario esatto come toFixed

function storeConfidence(receipt: { lines: unknown[]; real_lines: number }) {
  const n = receipt.lines.length || 1;
  const share = receipt.real_lines / n;
  return share >= 0.7 ? 'green' : share >= 0.3 ? 'yellow' : 'red';
}

export function computeSavings(ranked: any[], recommended: any, habitual: any | null) {
  let referenceCost: number;
  let reference: any;
  if (habitual) {
    referenceCost = habitual.total_cost;
    reference = { type: 'habitual', label: `rispetto a ${habitual.store_name}, il tuo abituale`, store_id: habitual.store_id };
  } else {
    referenceCost = median(ranked.map((r) => r.total_cost));
    reference = { type: 'median', label: 'rispetto alla spesa tipica in zona (mediana delle catene)', store_id: null };
  }
  const amount = pyRound(Math.max(0, referenceCost - recommended.total_cost), 2);
  const lines = recommended.receipt.lines;
  const real = recommended.receipt.real_lines;
  const basis = lines.length && real === lines.length ? 'reale' : real ? 'misto' : 'stima';
  return { amount, reference_cost: pyRound(referenceCost, 2), reference, price_basis: basis,
    promo_savings: recommended.receipt.savings_vs_normal, fuel_saving: recommended.fuel_stop?.saving ?? 0 };
}

export interface OptimizeRequest {
  items: ListItem[]; budget?: number | null; transport: string; habitual_store_id?: string | null;
  min_savings_threshold: number; fuel_type: string; lat?: number | null; lon?: number | null;
  refuel?: boolean; refuel_liters?: number | null;
}
export interface StoreChoice { id: string; name: string; distance_km: number; lat?: number; lng?: number; branch?: any }

export function optimizeList(book: PriceBook, req: OptimizeRequest, stores: StoreChoice[], fuel: FuelInfo, stations: FuelStation[]) {
  const ranked: any[] = [];
  const liters = req.refuel_liters || C.default_refuel_liters;
  const canRefuel = !!req.refuel && req.transport === 'car' && req.lat != null && req.lon != null;
  for (const store of stores) {
    const receipt = computeVirtualReceipt(book, store.id, req.items);
    const travel = computeTravel(store, req.transport, fuel);
    const totalCost = pyRound(receipt.total + travel.fuel_cost, 2);
    let score = pyRound(totalCost + C.time_weight * travel.time_cost, 2);
    let stop: any = null;
    if (canRefuel) {
      const b = store.branch || {};
      const pt: [number, number] = [b.lat ?? store.lat, b.lon ?? store.lng];
      stop = bestFuelStop([req.lat!, req.lon!], pt, stations, req.fuel_type, liters, fuel.source === 'mimit' ? fuel.price_per_liter : null);
      if (stop && stop.saving > 0) score = pyRound(score - stop.saving + C.time_weight * stop.detour_min / 60 * C.time_value, 2);
      else if (stop) stop = null;
    }
    ranked.push({ fuel_stop: stop, store_id: store.id, store_name: store.name, branch: store.branch ?? null,
      confidence: storeConfidence(receipt), receipt, travel, total_cost: totalCost, score });
  }
  for (const r of ranked) r.effective_cost = pyRound(r.total_cost - (r.fuel_stop ? r.fuel_stop.saving : 0), 2);
  ranked.sort((a, b) => a.score - b.score);
  const best = ranked[0];
  let recommended = best;
  const habitual = ranked.find((r) => r.store_id === req.habitual_store_id) ?? null;
  let reasoning: string;
  if (habitual && habitual !== best) {
    const delta = pyRound(habitual.effective_cost - best.effective_cost, 2);
    if (delta < req.min_savings_threshold) {
      recommended = habitual;
      reasoning = `Resta da ${habitual.store_name}: andando da ${best.store_name} risparmieresti solo ${euro(Math.max(delta, 0))}, sotto la tua soglia di ${euro(req.min_savings_threshold)}.`;
    } else {
      reasoning = `Ti conviene ${best.store_name}: risparmi ${euro(delta)} rispetto a ${habitual.store_name}, viaggio incluso.`;
    }
  } else if (habitual) {
    reasoning = `Il tuo ${habitual.store_name} è già la scelta migliore per questa lista.`;
  } else {
    const second = ranked.length > 1 ? ranked[1] : null;
    const diff = second ? pyRound(second.effective_cost - best.effective_cost, 2) : 0;
    if (second && diff < 0) {
      reasoning = `${best.store_name} è la scelta migliore: ${second.store_name} costerebbe ${euro(-diff)} in meno, ma è più lontano e non vale il tempo in più.`;
    } else {
      reasoning = `${best.store_name} è il più conveniente: ${euro(best.total_cost)} viaggio incluso` + (second ? `, ${euro(diff)} in meno di ${second.store_name}.` : '.');
    }
  }
  const stop = recommended.fuel_stop;
  if (stop) {
    reasoning += ` Sulla strada fai ${req.fuel_type} da ${stop.brand} a ${pyRound(stop.price, 3).toFixed(3)} €/l`.replace(/\./g, ',') + `: risparmi ${euro(stop.saving)} sul pieno.`;
  } else if (canRefuel) {
    reasoning += ' Nessun distributore sulla strada costa meno della media in zona.';
  }
  let budgetStatus: any = null;
  if (req.budget != null && req.budget > 0) {
    const spend = recommended.total_cost;
    const diff = pyRound(req.budget - spend, 2);
    budgetStatus = { budget: req.budget, spend, diff, status: diff >= 0 ? 'ok' : 'over', alternative: null };
    if (diff < 0) {
      const fits = ranked.filter((r) => r.total_cost <= req.budget!).sort((a, b) => a.total_cost - b.total_cost);
      if (fits.length) budgetStatus.alternative = { store_id: fits[0].store_id, store_name: fits[0].store_name, total_cost: fits[0].total_cost };
    }
  }
  return {
    ranked, recommended, reasoning, budget_status: budgetStatus, savings: computeSavings(ranked, recommended, habitual), fuel,
    price_coverage: { real_lines: recommended.receipt.real_lines, total_lines: recommended.receipt.lines.length },
  };
}

// ------------------------------------------------------------------ abitudini, budget, storico
export interface HistoryShop { items: ListItem[]; store_id?: string | null; total_cost?: number | null; created_at: string }

export function shoppingOccasions(shops: HistoryShop[]) {
  const occ: { date: number | null; items: Map<string, number> }[] = [];
  for (const shop of shops) {
    const items = new Map<string, number>();
    for (const it of shop.items || []) {
      if (PRODUCT_INDEX[it.product_id]) items.set(it.product_id, Math.max(items.get(it.product_id) ?? 0, Number(it.quantity)));
    }
    if (!items.size) continue;
    const t = Date.parse(shop.created_at);
    const when = Number.isFinite(t) ? t : null;
    let dup = null;
    for (const o of occ.slice(-3)) {
      // (o.date - when).days in Python: giorni interi, troncati verso il basso
      const close = when === null || o.date === null || Math.abs(Math.floor((o.date - when) / 86400000)) <= 3;
      if (close && jaccard(new Set(items.keys()), new Set(o.items.keys())) >= 0.7) { dup = o; break; }
    }
    if (dup) items.forEach((q, pid) => dup!.items.set(pid, Math.max(dup!.items.get(pid) ?? 0, q)));
    else occ.push({ date: when, items });
  }
  return occ;
}

export function habitualFromHistory(shops: HistoryShop[]) {
  const occ = shoppingOccasions(shops);
  if (occ.length < 3) return { items: [] as any[], occasions: occ.length, needed: 3 };
  const weights = occ.map((_, i) => 0.9 ** i);
  const totalW = weights.reduce((a, b) => a + b, 0);
  const agg = new Map<string, { count: number; w: number; qty: number[] }>();
  occ.forEach((o, i) => o.items.forEach((q, pid) => {
    const a = agg.get(pid) ?? { count: 0, w: 0, qty: [] };
    a.count += 1; a.w += weights[i]; a.qty.push(q);
    agg.set(pid, a);
  }));
  const result: any[] = [];
  agg.forEach((a, pid) => {
    const share = a.w / totalW;
    if (a.count >= 2 && share >= 0.4) {
      result.push({ product_id: pid, name: PRODUCT_INDEX[pid].name, count: a.count, share: pyRound(share, 2),
        quantity: pyRound(median(a.qty), 3) });
    }
  });
  result.sort((x, y) => y.share - x.share || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  return { items: result, occasions: occ.length, needed: 3 };
}

const cartSize = (n: number) => (n <= 5 ? 'piccola' : n <= 15 ? 'media' : 'grande');

export function suggestBudget(productIds: string[], shops0: HistoryShop[]) {
  const current = new Set(productIds);
  if (!current.size) return { suggested: null, reason: 'lista vuota' };
  const shops = shops0.filter((s) => s.total_cost);
  const ids = (s: HistoryShop) => new Set((s.items || []).map((i) => i.product_id));
  const similar = shops.filter((s) => jaccard(current, ids(s)) >= 0.5);
  let basis = similar;
  let label = 'spese simili';
  if (similar.length < 2) {
    const size = cartSize(current.size);
    basis = shops.filter((s) => cartSize(ids(s).size) === size);
    label = `spese di taglia ${size}`;
  }
  if (basis.length < 2) return { suggested: null, reason: 'storico insufficiente', history_count: shops.length };
  const typical = median(basis.map((s) => Number(s.total_cost)));
  const suggested = Math.ceil(typical * 1.1);
  return { suggested, typical: pyRound(typical, 2), margin_pct: 10, based_on: basis.length, basis: label,
    reason: `mediana di ${basis.length} ${label} (${euro(typical)}) + 10%` };
}

export function lastSimilarShop(productIds: string[], shops: HistoryShop[]) {
  const current = new Set(productIds);
  for (const shop of shops) {
    const sid = shop.store_id;
    if (!sid || !STORE_INDEX[sid]) continue;
    const sim = jaccard(current, new Set((shop.items || []).map((i) => i.product_id)));
    if (sim >= 0.5) {
      return { store_id: sid, store_name: STORE_INDEX[sid].name, date: shop.created_at, total_cost: shop.total_cost ?? null,
        similarity: pyRound(sim, 2) };
    }
  }
  return null;
}

// ------------------------------------------------------------------ salvadanaio
export function verifiedFuelSaving(entry: any, refueled?: boolean | null, fuelPrice?: number | null): number {
  const est = entry.fuel_saving || 0;
  if (!est && fuelPrice == null) return 0;
  if (refueled === false) return 0;
  if (fuelPrice != null && entry.fuel_median && entry.fuel_liters) {
    return pyRound((entry.fuel_median - fuelPrice) * entry.fuel_liters - (entry.fuel_detour_cost || 0), 2);
  }
  return pyRound(est, 2);
}

export function verifiedSaving(entry: any, paid: number): number {
  const expected = entry.estimated_spend;
  const shop = entry.amount - (entry.fuel_saving || 0);
  if (expected == null) return pyRound(shop, 2);
  return pyRound(shop + expected - paid, 2);
}

export const savingValue = (e: any) => (e.verified ? e.verified_amount : e.amount);
