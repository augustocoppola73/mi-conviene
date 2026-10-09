/**
 * Spesa divisa in due negozi (issue #2). Niente AI: si provano le coppie tra i negozi migliori e si manda ogni
 * prodotto dove costa meno, contando il giro vero (casa → A → B → casa: km, carburante, tempo, fermata in più).
 *
 * È il primo uso del "piano a tappe" che serve anche a "Ti do una mano" (#4) e alle liste con amici (#3):
 * un piano è un elenco di tappe, ogni tappa ha un negozio e i suoi prodotti.
 */
import { C } from './data';
import type { FuelInfo } from './core';
import { haversineKm, pyRound } from './util';

/** fermata in più: parcheggio, cassa, rimettersi in macchina */
export const STOP_EXTRA_MIN = 10;
/** una tappa deve valere qualcosa: almeno 3 prodotti o 5 € */
export const MIN_STOP_ITEMS = 3;
export const MIN_STOP_EURO = 5;
/** quante catene si provano (le migliori della classifica): 8 → 28 coppie */
export const SPLIT_CANDIDATES = 8;

export interface SplitLine { product_id: string; name: string; quantity: number; unit: string; line_price: number; category_id?: string | null }
export interface SplitStop {
  store_id: string; store_name: string; branch: any | null;
  lines: SplitLine[]; subtotal: number; distance_km: number;
  /** prodotti messi qui da una tua regola ("la carne sempre da Eurospin") */
  by_rule: number;
}
export interface SplitPlan {
  stops: SplitStop[];
  items_total: number; total_cost: number;
  travel: { distance_km: number; time_min: number; fuel_cost: number; time_cost: number };
  /** rispetto al consigliato in un solo negozio */
  vs: { store_id: string; store_name: string; total_cost: number; time_min: number };
  saving: number; extra_min: number;
  /** quanto costano le tue regole rispetto a dividere senza regole (0 se nessuna) */
  rules_cost: number;
  reasoning: string;
}
/** categoria → catena, es. { carne: 'eurospin' } */
export type CategoryRules = Record<string, string>;

const euro = (x: number) => `€${pyRound(x, 2).toFixed(2)}`.replace('.', ',');

interface Cand { store_id: string; store_name: string; branch: any; distance_km: number; prices: Map<string, SplitLine> }

function candidate(r: any): Cand | null {
  const b = r.branch;
  if (!b || b.lat == null || b.lon == null) return null;  // senza coordinate non so quanto dista l'altro negozio
  const prices = new Map<string, SplitLine>();
  for (const l of r.receipt.lines) prices.set(l.product_id, { product_id: l.product_id, name: l.name, quantity: l.quantity, unit: l.unit, line_price: l.line_price });
  return { store_id: r.store_id, store_name: r.store_name, branch: b, distance_km: r.travel.distance_km, prices };
}

function tryPair(a: Cand, b: Cand, items: { product_id: string; category_id?: string | null }[], rules: CategoryRules,
  transport: string, fuel: FuelInfo, maxUnknown: number) {
  const stops = [a, b].map((c) => ({ c, lines: [] as SplitLine[], subtotal: 0, by_rule: 0 }));
  let unknown = 0;
  for (const it of items) {
    if (it.product_id.startsWith('custom:')) continue;  // senza prezzo: li sistemo dopo
    const pa = a.prices.get(it.product_id), pb = b.prices.get(it.product_id);
    if (!pa && !pb) { unknown++; continue; }
    const rule = it.category_id ? rules[it.category_id] : undefined;
    let k: 0 | 1;
    let byRule = false;
    if (rule === a.store_id && pa) { k = 0; byRule = true; }
    else if (rule === b.store_id && pb) { k = 1; byRule = true; }
    else if (!pb) k = 0;
    else if (!pa) k = 1;
    else k = pb.line_price < pa.line_price - 0.004 ? 1 : 0;  // a parità resta nel negozio migliore in classifica
    const line = { ...(k === 0 ? pa! : pb!), category_id: it.category_id ?? null };
    stops[k].lines.push(line);
    stops[k].subtotal += line.line_price;
    if (byRule) stops[k].by_rule++;
  }
  if (unknown > maxUnknown) return null;  // dividere non deve far sparire prodotti che un negozio solo avrebbe
  for (const s of stops) {
    if (s.lines.length < MIN_STOP_ITEMS && s.subtotal < MIN_STOP_EURO) return null;  // tappa che non vale il viaggio
  }
  // giro: casa → il più vicino → l'altro → casa
  const [n, f] = a.distance_km <= b.distance_km ? [stops[0], stops[1]] : [stops[1], stops[0]];
  const between = haversineKm(a.branch.lat, a.branch.lon, b.branch.lat, b.branch.lon) * C.road_factor;
  const tour = n.c.distance_km + between + f.c.distance_km;
  const timeMin = (tour / C.transport_speed[transport]) * 60 + STOP_EXTRA_MIN;
  const fuelCost = transport === 'car' ? tour * (C.fuel_consumption_l_100km / 100) * fuel.price_per_liter : 0;
  const timeCost = (timeMin / 60) * C.time_value;
  const itemsTotal = pyRound(n.subtotal + f.subtotal, 2);
  const total = pyRound(itemsTotal + fuelCost, 2);
  return {
    ordered: [n, f], between, itemsTotal, total, score: total + C.time_weight * timeCost,
    travel: { distance_km: pyRound(tour, 1), time_min: Math.round(timeMin), fuel_cost: pyRound(fuelCost, 2), time_cost: pyRound(timeCost, 2) },
  };
}

function bestPair(cands: Cand[], items: any[], rules: CategoryRules, transport: string, fuel: FuelInfo, maxUnknown: number) {
  // con delle regole, le catene richieste devono stare nel giro
  const needed = new Set(items.map((i) => (i.category_id ? rules[i.category_id] : undefined)).filter(Boolean) as string[]);
  let best: ReturnType<typeof tryPair> = null;
  for (let i = 0; i < cands.length; i++) {
    for (let j = i + 1; j < cands.length; j++) {
      const ids = [cands[i].store_id, cands[j].store_id];
      if ([...needed].slice(0, 2).some((n) => !ids.includes(n))) continue;
      const p = tryPair(cands[i], cands[j], items, rules, transport, fuel, maxUnknown);
      if (p && (!best || p.score < best.score)) best = p;
    }
  }
  return best;
}

/**
 * ranked: la classifica dei negozi (già ordinata), recommended: la scelta in un negozio solo.
 * Restituisce il piano in due tappe se conviene davvero (risparmio ≥ soglia), altrimenti una nota sul perché no.
 */
export function splitPlan(ranked: any[], recommended: any, items: { product_id: string; category_id?: string | null }[],
  opts: { transport: string; fuel: FuelInfo; min_savings_threshold: number; rules?: CategoryRules | null })
  : { split: SplitPlan | null; split_note: string | null } {
  const rules = opts.rules || {};
  const cands = ranked.map(candidate).filter(Boolean).slice(0, SPLIT_CANDIDATES) as Cand[];
  if (cands.length < 2 || items.length < 2) return { split: null, split_note: null };
  const singleUnknown = recommended.receipt.unknown_products?.length ?? 0;
  const found = bestPair(cands, items, rules, opts.transport, opts.fuel, singleUnknown);
  if (!found) return { split: null, split_note: null };
  // confronto alla pari: i prodotti che il negozio unico non ha (e che il giro in due invece prende) li conto al prezzo del giro
  const missingAtSingle = new Set<string>(recommended.receipt.unknown_products ?? []);
  const extra = found.ordered.flatMap((s) => s.lines).filter((l) => missingAtSingle.has(l.product_id)).reduce((t, l) => t + l.line_price, 0);
  const singleTotal = recommended.total_cost + extra;
  const singleScore = singleTotal + C.time_weight * recommended.travel.time_cost;
  const saving = pyRound(singleTotal - found.total, 2);
  const extraMin = Math.max(0, found.travel.time_min - recommended.travel.time_min);
  const [n, f] = found.ordered;
  const names = `${n.c.store_name} e ${f.c.store_name}`;
  if (found.score >= singleScore || saving < opts.min_savings_threshold) {
    const note = saving > 0.05
      ? `Dividere tra ${names} ti farebbe risparmiare solo ${euro(saving)}${extraMin ? ` con ${extraMin} minuti in più` : ''}: resta da ${recommended.store_name}.`
      : null;
    return { split: null, split_note: note };
  }
  // quanto costano le regole: stessa ricerca senza regole
  let rulesCost = 0;
  if (Object.keys(rules).length) {
    const free = bestPair(cands, items, {}, opts.transport, opts.fuel, singleUnknown);
    if (free) rulesCost = Math.max(0, pyRound(found.total - free.total, 2));
  }
  // i prodotti scritti a mano (senza prezzo) vanno nella tappa più grande
  const custom = items.filter((i) => i.product_id.startsWith('custom:'));
  const big = n.lines.length >= f.lines.length ? n : f;
  for (const c of custom as any[]) big.lines.push({ product_id: c.product_id, name: c.name || c.product_id.slice(7), quantity: c.quantity ?? 1, unit: c.unit || 'pz', line_price: 0, category_id: c.category_id ?? null });
  const stops: SplitStop[] = found.ordered.map((s, i) => ({
    store_id: s.c.store_id, store_name: s.c.store_name, branch: s.c.branch, lines: s.lines,
    subtotal: pyRound(s.subtotal, 2), distance_km: pyRound(i === 0 ? s.c.distance_km : found.between, 1), by_rule: s.by_rule,
  }));
  return {
    split: {
      stops, items_total: found.itemsTotal, total_cost: found.total, travel: found.travel,
      vs: { store_id: recommended.store_id, store_name: recommended.store_name, total_cost: recommended.total_cost, time_min: recommended.travel.time_min },
      saving, extra_min: extraMin, rules_cost: rulesCost,
      reasoning: `Dividendo tra ${names} risparmi ${euro(saving)} rispetto a ${recommended.store_name}, viaggio incluso`
        + (extraMin ? ` (${extraMin} minuti in più).` : '.'),
    },
    split_note: null,
  };
}

// ------------------------------------------------------------------ "Ti do una mano" (#4)
/** Una proposta per chi aiuta: un negozio vicino a lui e i prodotti che lì costano uguale o meno. */
export interface HelpOption {
  store_id: string; store_name: string; branch: any | null; distance_km: number;
  /** dal più conveniente al meno: i primi "suggested" sono già spuntati (la spesa si divide, non si sposta tutta) */
  lines: (SplitLine & { key: string; was: number | null })[];
  suggested: number;
  /** quanto si risparmia con i prodotti suggeriti rispetto a farli prendere dove sono ora */
  gain: number; fuel_cost: number; time_min: number;
  reasoning: string;
}

/**
 * La spesa di un familiare è in corso; tu sei altrove. Per ogni catena vicino a te prendo i prodotti ancora da
 * prendere che lì costano uguale o meno, e tengo le proposte che valgono il viaggio (almeno 3 prodotti o 5 €).
 * Ordine: risparmio meno carburante e tempo (il tempo pesa la metà: stai aiutando, e lei finisce prima).
 * price(storeId, productId, quantity) → prezzo della riga in quel negozio (null se non c'è).
 */
export function helpOptions(
  todo: { key: string; product_id: string; name: string; quantity: number; unit: string; category_id?: string | null; price: number | null }[],
  stores: { id: string; name: string; distance_km: number; branch?: any }[],
  price: (storeId: string, productId: string, quantity: number) => number | null,
  opts: { transport: string; fuel: FuelInfo; max?: number },
): HelpOption[] {
  const out: (HelpOption & { score: number })[] = [];
  for (const st of stores) {
    const lines: HelpOption['lines'] = [];
    let gain = 0;
    for (const it of todo) {
      if (it.product_id.startsWith('custom:')) continue;
      const p = price(st.id, it.product_id, it.quantity);
      if (p == null) continue;
      const was = it.price;
      if (was != null && p > was + 0.005) continue;  // qui costa di più: resta a chi fa la spesa
      lines.push({ key: it.key, product_id: it.product_id, name: it.name, quantity: it.quantity, unit: it.unit, line_price: p, category_id: it.category_id ?? null, was });
      gain += was != null ? was - p : 0;
    }
    const value = lines.reduce((t, l) => t + l.line_price, 0);
    if (lines.length < MIN_STOP_ITEMS && value < MIN_STOP_EURO) continue;
    // si divide la fatica: di base circa metà di quello che resta, partendo da ciò che lì conviene di più
    lines.sort((x, y) => ((y.was ?? y.line_price) - y.line_price) - ((x.was ?? x.line_price) - x.line_price));
    const suggested = Math.min(lines.length, Math.max(MIN_STOP_ITEMS, Math.ceil(todo.length / 2)));
    gain = lines.slice(0, suggested).reduce((t, l) => t + (l.was != null ? l.was - l.line_price : 0), 0);
    const km = st.distance_km * 2;
    const timeMin = (km / C.transport_speed[opts.transport]) * 60 + STOP_EXTRA_MIN;
    const fuelCost = opts.transport === 'car' ? km * (C.fuel_consumption_l_100km / 100) * opts.fuel.price_per_liter : 0;
    const timeCost = (timeMin / 60) * C.time_value;
    const g = pyRound(gain, 2);
    out.push({
      store_id: st.id, store_name: st.name, branch: st.branch ?? null, distance_km: st.distance_km, lines, suggested,
      gain: g, fuel_cost: pyRound(fuelCost, 2), time_min: Math.round(timeMin),
      score: g - fuelCost - 0.5 * C.time_weight * timeCost,
      reasoning: g >= 0.05
        ? `Da ${st.name}, a ${String(st.distance_km).replace('.', ',')} km da te: ${suggested} prodotti, ${euro(g)} in meno.`
        : `Da ${st.name}, a ${String(st.distance_km).replace('.', ',')} km da te: ${suggested} prodotti allo stesso prezzo, e la spesa finisce prima.`,
    });
  }
  out.sort((a, b) => b.score - a.score || a.distance_km - b.distance_km);
  return out.slice(0, opts.max ?? 3).map(({ score: _s, ...o }) => o);
}
