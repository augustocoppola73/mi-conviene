/**
 * Negozi veri (OpenStreetMap Overpass), volantini, distributori vicini, ricerca indirizzi (Nominatim).
 * Porting di backend/stores.py, prices/chains.py, prices/fuel.cheapest e degli endpoint relativi.
 * Le chiamate di rete partono dal telefono: niente server in mezzo.
 */
import { C, CHAIN_FLYERS, OFFICIAL_DOMAINS, STORES } from './data';
import { FuelInfo, FuelStation, StoreChoice } from './core';
import { haversineKm, pyRe, pyRound } from './util';

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
export const RADIUS_M = 6000;
/** Vicino a me: raggio massimo del cursore (oltre i 6 km si scarica una zona più grande). */
export const NEAR_ME_MAX_KM = 20;
const BRANDS = 'Esselunga|Conad|Coop|Ipercoop|Lidl|Carrefour|Pam|Panorama|Eurospin|Aldi|MD|Penny|Ekom|Dpiù|Dpiu|Tuodì|Tuodi|Prix';
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
const BRANDS_TAG = [...BRANDS].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);
/** Overpass e Nominatim rifiutano (406) le app senza un User-Agent riconoscibile; il browser invece lo mette da sé
 *  e non lascia cambiarlo, quindi lo aggiungiamo solo nell'app Android/iOS. */
const IS_NATIVE = typeof navigator !== 'undefined' && (navigator as any).product === 'ReactNative';
const APP_HEADERS: Record<string, string> = IS_NATIVE
  ? { 'User-Agent': 'MiConviene/1.0 (Android; +https://mi-conviene.augustocoppola.workers.dev)' } : {};

const CHAIN_PATTERNS: [string, RegExp][] = [
  ['esselunga', pyRe('\\besselunga\\b', 'i')],
  ['conad', pyRe('\\bconad\\b', 'i')],
  ['coop', pyRe('\\b(coop|ipercoop|incoop|novacoop)\\b', 'i')],
  ['lidl', pyRe('\\blidl\\b', 'i')],
  ['carrefour', pyRe('\\bcarrefour\\b', 'i')],
  ['pam', pyRe('\\b(pam|pam local|pam panorama|panorama)\\b', 'i')],
  ['eurospin', pyRe('\\beuro\\s?spin\\b', 'i')],
  ['aldi', pyRe('\\baldi\\b', 'i')],
  ['md', pyRe('\\bmd\\b', 'i')],
  ['penny', pyRe('\\bpenny\\b', 'i')],
  ['ekom', pyRe('\\bekom\\b', 'i')],
  ['dpiu', pyRe('\\bd\\s?pi[uù]\\b', 'i')],
  ['tuodi', pyRe('\\btuod[iì]\\b', 'i')],
  ['prix', pyRe('\\bprix\\b', 'i')],
];

export function chainOf(loc: { osm_brand?: string | null; osm_name?: string | null } | null): string | null {
  if (!loc) return null;
  for (const text of [loc.osm_brand, loc.osm_name]) {
    if (!text) continue;
    for (const [chain, re] of CHAIN_PATTERNS) if (re.test(text)) return chain;
  }
  return null;
}

export function overpassQuery(lat: number, lon: number, radiusM: number, includeConvenience = false): string {
  const shops = includeConvenience ? 'supermarket|convenience' : 'supermarket';
  return `[out:json][timeout:25];nwr["shop"~"^(${shops})$"]["brand"~"${BRANDS}",i](around:${radiusM},${lat},${lon});out center tags;`;
}

export interface OsmStore {
  chain: string; name: string; address: string | null; lat: number; lon: number; osm_id: string;
  opening_hours: string | null; website: string | null;
}

export function parseElements(elements: any[]): OsmStore[] {
  const out: OsmStore[] = [];
  for (const e of elements) {
    const tags = e.tags || {};
    const chain = chainOf({ osm_brand: tags.brand, osm_name: tags.name });
    const lat = e.lat || (e.center || {}).lat;
    const lon = e.lon || (e.center || {}).lon;
    if (!chain || lat == null || lon == null) continue;
    const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ').trim();
    out.push({
      chain, name: tags.name || tags.brand || chain,
      address: [street, tags['addr:city']].filter(Boolean).join(', ') || null,
      lat: Number(lat), lon: Number(lon), osm_id: `${e.type}/${e.id}`,
      opening_hours: tags.opening_hours ?? null, website: tags.website || tags['contact:website'] || null,
    });
  }
  return out;
}

export type Near = Record<string, OsmStore & { distance_km: number }>;

export function nearestPerChain(stores: OsmStore[], lat: number, lon: number): Near {
  const best: Near = {};
  for (const s of stores) {
    const d = haversineKm(lat, lon, s.lat, s.lon) * C.road_factor;
    if (!best[s.chain] || d < best[s.chain].distance_km) best[s.chain] = { ...s, distance_km: pyRound(Math.max(d, 0.1), 1) };
  }
  return best;
}

/** Catene da confrontare: il punto vendita reale più vicino di ognuna, oppure le distanze di esempio. */
export function storesFor(near: Near | null, error?: string): [StoreChoice[], any] {
  if (!near) return [STORES as any, { mode: 'esempio', missing_chains: [], ...(error ? { error } : {}) }];
  const chosen: StoreChoice[] = [];
  for (const s of STORES) {
    const b = near[s.id];
    if (b) {
      chosen.push({ ...(s as any), distance_km: b.distance_km,
        branch: { name: b.name, address: b.address, lat: b.lat, lon: b.lon, osm_id: b.osm_id, opening_hours: b.opening_hours } });
    }
  }
  const missing = STORES.filter((s) => !near[s.id]).map((s) => s.name);
  if (!chosen.length) return [STORES as any, { mode: 'esempio', missing_chains: missing, error: 'nessun punto vendita nel raggio' }];
  return [chosen, { mode: 'reale', missing_chains: missing, radius_km: RADIUS_M / 1000 }];
}

export function flyerUrl(chain: string, website?: string | null): [string, boolean] {
  if (website && website.startsWith('http')) {
    const host = website.split('/')[2] ?? '';
    if (OFFICIAL_DOMAINS[chain].some((d: string) => host.includes(d))) return [website, true];
  }
  return [CHAIN_FLYERS[chain], false];
}

export function flyers(allStores: OsmStore[], lat?: number | null, lon?: number | null) {
  const out: any[] = [];
  for (const s of STORES) {
    const mine = allStores.filter((x) => x.chain === s.id)
      .map((x) => ({ ...x, _d: pyRound(Math.max(haversineKm(lat!, lon!, x.lat, x.lon) * C.road_factor, 0.1), 1) }));
    if (allStores.length && !mine.length) continue;
    mine.sort((a, b) => a._d - b._d);
    const withPage = mine.filter((x) => flyerUrl(s.id, x.website)[1]);
    const pick = withPage[0] ?? mine[0] ?? null;
    const [url, storePage] = flyerUrl(s.id, pick?.website);
    out.push({ store_id: s.id, store_name: s.name, url, store_page: storePage, branch_name: pick?.name ?? null,
      address: pick?.address ?? null, distance_km: pick?._d ?? null, nearest_km: mine.length ? mine[0]._d : null });
  }
  out.sort((a, b) => Number(a.distance_km === null) - Number(b.distance_km === null) || (a.nearest_km || 0) - (b.nearest_km || 0));
  return out;
}

// ------------------------------------------------------------------ distributori
export function cheapestFuel(stations: FuelStation[], lat: number, lon: number, fuel: string, radiusKm = 5, limit = 5) {
  const out: any[] = [];
  for (const s of stations) {
    const p = s.prices[fuel]?.self;
    if (p == null) continue;
    const d = haversineKm(lat, lon, s.lat, s.lon) * C.road_factor;
    if (d <= radiusKm) {
      out.push({ id: s.id, brand: s.brand, name: s.name, address: s.address, city: s.city, lat: s.lat, lon: s.lon,
        price: p, price_servito: s.prices[fuel]?.servito ?? null, distance_km: pyRound(Math.max(d, 0.1), 1), updated: s.updated ?? null });
    }
  }
  out.sort((a, b) => a.price - b.price || a.distance_km - b.distance_km);
  return out.slice(0, limit);
}

/** Dove fare carburante: ordinati per costo effettivo (pieno + andata e ritorno). */
export function fuelNearby(stations: FuelStation[], fuel: FuelInfo, lat: number, lon: number, liters = 40, radiusKm = 5) {
  const median = fuel.source === 'mimit' ? fuel.price_per_liter : null;
  const cands = cheapestFuel(stations, lat, lon, fuel.fuel_type, radiusKm, 50);
  if (!cands.length) return { fuel: fuel.fuel_type, median, stations: [], best: null, liters, observed_at: fuel.observed_at };
  for (const c of cands) {
    const trip = c.distance_km * 2 * C.fuel_consumption_l_100km / 100 * c.price;
    c.trip_cost = pyRound(trip, 2);
    c.fill_cost = pyRound(c.price * liters, 2);
    c.effective_cost = pyRound(c.fill_cost + trip, 2);
    c.saving_vs_median = median ? pyRound((median - c.price) * liters - trip, 2) : null;
    c.maps_url = `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lon}`;
  }
  cands.sort((a, b) => a.effective_cost - b.effective_cost);
  return { fuel: fuel.fuel_type, median, liters, radius_km: radiusKm, observed_at: fuel.observed_at, best: cands[0], stations: cands.slice(0, 5) };
}

// ------------------------------------------------------------------ rete (dal telefono)
export interface KV { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> }
const memory = new Map<string, string>();
const memKV: KV = { get: async (k) => memory.get(k) ?? null, set: async (k, v) => { memory.set(k, v); } };

/** Negozi delle catene nel raggio, con cache di 7 giorni per zona (~1 km). */
export async function storesAround(lat: number, lon: number, kv: KV = memKV, fetchFn: typeof fetch = fetch): Promise<OsmStore[]> {
  // la chiave cambia quando cambiano le insegne cercate: niente risultati vecchi senza le catene nuove
  const key = `mc_osm_${BRANDS_TAG}_${pyRound(lat, 2)},${pyRound(lon, 2)}`;
  try {
    const hit = JSON.parse((await kv.get(key)) || 'null');
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.stores;
  } catch { /* cache rovinata: si rifà */ }
  const r = await fetchFn(OVERPASS_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...APP_HEADERS },
    body: 'data=' + encodeURIComponent(overpassQuery(lat, lon, RADIUS_M)),
  });
  if (!r.ok) throw new Error(`OpenStreetMap ${r.status}`);
  const stores = parseElements((await r.json()).elements || []);
  try { await kv.set(key, JSON.stringify({ at: Date.now(), stores })); } catch { /* pazienza */ }
  return stores;
}

export async function geocode(q: string, fetchFn: typeof fetch = fetch) {
  const params = new URLSearchParams({ q, format: 'json', limit: '5', countrycodes: 'it', 'accept-language': 'it' });
  const r = await fetchFn(`${NOMINATIM_URL}?${params}`, { headers: APP_HEADERS });
  if (!r.ok) throw new Error('Ricerca indirizzi non disponibile in questo momento');
  const data = await r.json();
  return data.map((x: any) => ({ lat: pyRound(Number(x.lat), 4), lon: pyRound(Number(x.lon), 4), label: x.display_name || '' }));
}

// ------------------------------------------------------------------ parcheggi (OpenStreetMap)
/** Parcheggio di un punto vendita: dai dati OSM vicini al negozio (non c'è una fonte affidabile sulla "difficoltà"). */
export interface Parking {
  /** clienti = del supermercato o riservato ai clienti; pubblico = parcheggio aperto a tutti a due passi; nessuno = niente di segnato */
  kind: 'clienti' | 'pubblico' | 'nessuno';
  capacity: number | null; fee: boolean | null; covered: boolean;
}
export interface OsmParking { lat: number; lon: number; access: string | null; capacity: number | null; fee: boolean | null;
  name: string | null; operator: string | null; type: string | null }

export const PARKING_NEAR_M = 150;

/** Solo i parcheggi a meno di 150 m dai supermercati (query leggera). */
const overpassTimeout = (radiusM: number) => (radiusM > RADIUS_M ? 60 : 25);
export function parkingQuery(lat: number, lon: number, radiusM: number): string {
  return `[out:json][timeout:${overpassTimeout(radiusM)}];nwr["shop"="supermarket"](around:${radiusM},${lat},${lon})->.s;` +
    `nwr["amenity"="parking"](around.s:${PARKING_NEAR_M});out center tags;`;
}

// ------------------------------------------------------------------ tutti i supermercati (Vicino a me)
/** Anche le insegne di cui non abbiamo ancora i prezzi (Ekom, Despar, Sigma, Crai…): chain = "altro". */
export function allSupermarketsQuery(lat: number, lon: number, radiusM: number): string {
  return `[out:json][timeout:${overpassTimeout(radiusM)}];nwr["shop"="supermarket"](around:${radiusM},${lat},${lon});out center tags;`;
}
export function parseAllSupermarkets(elements: any[]): (OsmStore & { brand: string | null })[] {
  const out: (OsmStore & { brand: string | null })[] = [];
  for (const e of elements) {
    const tags = e.tags || {};
    const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    if (tags.amenity || lat == null || lon == null) continue; // la query chiede solo supermercati
    const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ').trim();
    out.push({
      chain: chainOf({ osm_brand: tags.brand, osm_name: tags.name }) ?? 'altro',
      name: tags.name || tags.brand || 'Supermercato', brand: tags.brand || null,
      address: [street, tags['addr:city']].filter(Boolean).join(', ') || null,
      lat: Number(lat), lon: Number(lon), osm_id: `${e.type}/${e.id}`,
      opening_hours: tags.opening_hours ?? null, website: tags.website || tags['contact:website'] || null,
    });
  }
  return out;
}
export async function supermarketsAround(lat: number, lon: number, kv: KV = memKV, fetchFn: typeof fetch = fetch, radiusM = RADIUS_M) {
  const key = `mc_osm_all_${radiusM === RADIUS_M ? '' : `${radiusM}_`}${pyRound(lat, 2)},${pyRound(lon, 2)}`;
  try {
    const hit = JSON.parse((await kv.get(key)) || 'null');
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.stores as ReturnType<typeof parseAllSupermarkets>;
  } catch { /* cache rovinata: si rifà */ }
  const r = await fetchFn(OVERPASS_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...APP_HEADERS },
    body: 'data=' + encodeURIComponent(allSupermarketsQuery(lat, lon, radiusM)),
  });
  if (!r.ok) throw new Error(`OpenStreetMap ${r.status}`);
  const stores = parseAllSupermarkets((await r.json()).elements || []);
  try { await kv.set(key, JSON.stringify({ at: Date.now(), stores })); } catch { /* pazienza */ }
  return stores;
}

export function parseParkings(elements: any[]): OsmParking[] {
  const out: OsmParking[] = [];
  for (const e of elements) {
    const t = e.tags || {};
    const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    if (t.amenity !== 'parking' || lat == null || lon == null) continue;
    const cap = parseInt(t.capacity, 10);
    out.push({ lat: Number(lat), lon: Number(lon), access: t.access ?? null, capacity: Number.isFinite(cap) && cap > 0 ? cap : null,
      fee: t.fee === 'yes' ? true : t.fee === 'no' ? false : null, name: t.name ?? null, operator: t.operator ?? null, type: t.parking ?? null });
  }
  return out;
}

/** Il parcheggio migliore vicino al negozio: prima quello dei clienti (o della stessa catena), poi uno pubblico. */
export function parkingFor(store: { lat: number; lon: number; chain: string; name?: string }, parkings: OsmParking[]): Parking {
  const own = (store.name || '').toLowerCase().split(/\s+/)[0];
  let best: { p: OsmParking; rank: number; d: number } | null = null;
  for (const p of parkings) {
    const d = haversineKm(store.lat, store.lon, p.lat, p.lon) * 1000;
    if (d > PARKING_NEAR_M) continue;
    if (p.capacity != null && p.capacity < 5) continue; // 2-4 posti: di solito stalli per disabili o di servizio
    const sameChain = store.chain !== 'altro'
      ? chainOf({ osm_brand: p.operator, osm_name: p.name }) === store.chain
      : own.length >= 3 && `${p.name ?? ''} ${p.operator ?? ''}`.toLowerCase().includes(own);
    const access = (p.access || '').toLowerCase();
    let rank: number;
    if (sameChain || access === 'customers' || access === 'permissive') rank = 2;
    else if (access === 'private' || access === 'no' || access === 'delivery') continue;
    else rank = 1;
    if (!best || rank > best.rank || (rank === best.rank && d < best.d)) best = { p, rank, d };
  }
  if (!best) return { kind: 'nessuno', capacity: null, fee: null, covered: false };
  const covered = best.p.type === 'underground' || best.p.type === 'multi-storey';
  return { kind: best.rank === 2 ? 'clienti' : 'pubblico', capacity: best.p.capacity, fee: best.p.fee, covered };
}

/** Parcheggi vicino ai supermercati della zona, con cache di 7 giorni come i negozi. */
export async function parkingsAround(lat: number, lon: number, kv: KV = memKV, fetchFn: typeof fetch = fetch, radiusM = RADIUS_M): Promise<OsmParking[]> {
  const key = `mc_osm_park2_${radiusM === RADIUS_M ? '' : `${radiusM}_`}${pyRound(lat, 2)},${pyRound(lon, 2)}`;
  try {
    const hit = JSON.parse((await kv.get(key)) || 'null');
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.parkings;
  } catch { /* cache rovinata: si rifà */ }
  const r = await fetchFn(OVERPASS_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...APP_HEADERS },
    body: 'data=' + encodeURIComponent(parkingQuery(lat, lon, radiusM)),
  });
  if (!r.ok) throw new Error(`OpenStreetMap ${r.status}`);
  const parkings = parseParkings((await r.json()).elements || []);
  try { await kv.set(key, JSON.stringify({ at: Date.now(), parkings })); } catch { /* pazienza */ }
  return parkings;
}

/** Testo breve per l'interfaccia. */
export function parkingLabel(p: Parking | null | undefined): string | null {
  if (!p) return null;
  if (p.kind === 'nessuno') return 'Nessun parcheggio segnato sulla mappa';
  const extra = [p.capacity ? `${p.capacity} posti` : null, p.covered ? 'coperto' : null, p.fee ? 'a pagamento' : p.fee === false ? 'gratuito' : null]
    .filter(Boolean).join(', ');
  return `${p.kind === 'clienti' ? 'Parcheggio clienti' : 'Parcheggio pubblico vicino'}${extra ? ` (${extra})` : ''}`;
}
