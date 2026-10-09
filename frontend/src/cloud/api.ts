/**
 * Versione online dell'app: stessa interfaccia di `api` (src/api.ts), ma il calcolo gira nel telefono
 * (src/engine) e i dati stanno su Supabase. Nessun server nostro.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type * as T from '../api';
import { REQUEST_WAIT_MIN } from '../shopRules';
import { splitPlan } from '../engine/split';
import {
  buildPriceBook, computeVirtualReceipt, fuelInfo, FuelStation, HistoryShop, habitualFromHistory, lastSimilarShop, optimizeList, PriceBook,
  RealPrice, savingValue, suggestBudget, UserPrice, verifiedFuelSaving, verifiedSaving,
} from '../engine/core';
import { classify } from '../engine/classify';
import { C, CATEGORIES, PRODUCT_INDEX, PRODUCTS, STORE_INDEX, STORES } from '../engine/data';
import {
  aisleOrder, learnAisles, menuPlan, planRecipe, proposeMenu, rankByPrice, Recipe, recipeSummaryPriced,
  shopItem, suggest, primeCores,
} from '../engine/kitchen';
import { observedRows, ObservedLine } from '../engine/observed';
import { flyers, fuelNearby, geocode, KV, NEAR_ME_MAX_KM, nearestPerChain, OsmParking, parkingFor, parkingsAround, RADIUS_M, storesAround, storesFor, supermarketsAround } from '../engine/places';
import { search } from '../engine/recipes';
import { haversineKm, pyRound } from '../engine/util';
import WIKIBOOKS from '../engine/data/recipes_wikibooks.json';
import RECIPE_CORES from '../engine/data/recipe_cores.json';
import { check, IS_CLOUD, sb, uid } from './client';

const COLLECTION = (WIKIBOOKS as { recipes: Recipe[] }).recipes;
const LICENSE = (WIKIBOOKS as { license: string }).license;
const BUDGET_HISTORY_LIMIT = 50;
const HABITUAL_SAME_STORE_KM = 1.0;   // entro 1 km è lo stesso punto vendita
const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const r2 = (x: number) => pyRound(x, 2);

// le ricette della raccolta si preparano subito, a piccoli blocchi
primeCores(COLLECTION, RECIPE_CORES as any); // ricette già abbinate ai prodotti: niente calcoli pesanti sul telefono

const kv: KV = {
  get: (k) => AsyncStorage.getItem(k),
  set: (k, v) => AsyncStorage.setItem(k, v),
};

/** Supabase restituisce al massimo 1000 righe per volta: si leggono a pagine. */
async function fetchAll<R>(page: (from: number, to: number) => PromiseLike<{ data: R[] | null; error: any }>, max = 30000): Promise<R[]> {
  const out: R[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// ------------------------------------------------------------------ prezzi (cache di 10 minuti)
let bookCache: { at: number; book: PriceBook } | null = null;
let bookLoading: Promise<PriceBook> | null = null;

async function priceBook(): Promise<PriceBook> {
  if (bookCache && Date.now() - bookCache.at < 10 * 60 * 1000) return bookCache.book;
  if (bookLoading) return bookLoading;
  bookLoading = (async () => {
    const [open, seen] = await Promise.all([
      fetchAll<any>((a, b) => sb().from('product_prices').select('*').range(a, b)),
      fetchAll<any>((a, b) => sb().from('user_prices')
        .select('store_id,product_id,kind,ref_price,paid,receipt_text,note,location_name,date,promo_until,created_at')
        .order('created_at').range(a, b)),
    ]);
    const openPrices: Record<string, RealPrice> = {};
    for (const p of open) {
      openPrices[`${p.store_id}|${p.product_id}`] = {
        normal_price: Number(p.normal_price), promo_price: p.promo_price == null ? null : Number(p.promo_price),
        source: p.source, confidence: p.confidence || 'yellow', observed_at: p.observed_at, location_name: p.location_name,
        sample_product: p.sample_product, proof_url: p.proof_url,
      };
    }
    const userPrices: UserPrice[] = seen.map((d) => ({ ...d, ref_price: Number(d.ref_price), paid: d.paid == null ? null : Number(d.paid) }));
    const book = buildPriceBook(openPrices, userPrices, today());
    bookCache = { at: Date.now(), book };
    return book;
  })();
  try { return await bookLoading; } finally { bookLoading = null; }
}

async function saveObserved(lines: ObservedLine[], storeId: string, date: string, location: string | null): Promise<number> {
  const { rows, saved } = observedRows(lines, storeId, date, location);
  if (rows.length) {
    check(await sb().from('user_prices').insert(rows));
    bookCache = null; // i prezzi nuovi valgono subito
  }
  return saved;
}

// ------------------------------------------------------------------ carburante (cache di un'ora per zona)
let fuelDate: { at: number; date: string | null } | null = null;
const stationCache = new Map<string, { at: number; stations: FuelStation[] }>();

async function fuelObservedAt(): Promise<string | null> {
  if (fuelDate && Date.now() - fuelDate.at < 3600 * 1000) return fuelDate.date;
  const { data } = await sb().from('meta').select('value').eq('key', 'prices_status').maybeSingle();
  fuelDate = { at: Date.now(), date: (data?.value as any)?.fuel_date ?? null };
  return fuelDate.date;
}

/** Aggiunge il parcheggio (dati OSM) a ogni punto vendita che ha catena e coordinate. */
function withParking(branches: any[], parkings: OsmParking[]) {
  for (const b of branches) {
    if (!b || b.lat == null) continue;
    if (b.chain) b.parking = parkingFor({ lat: b.lat, lon: b.lon, chain: b.chain, name: b.name }, parkings);
  }
}

async function stationsNear(lat: number, lon: number, boxKm = 15): Promise<FuelStation[]> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${boxKm}`;
  const hit = stationCache.get(key);
  if (hit && Date.now() - hit.at < 3600 * 1000) return hit.stations;
  const stations = check(await sb().rpc('fuel_near', { p_lat: lat, p_lon: lon, p_km: boxKm })) as FuelStation[];
  stationCache.set(key, { at: Date.now(), stations });
  return stations;
}

// ------------------------------------------------------------------ dati personali
async function historyRows(limit: number, onlyWithCost = false): Promise<HistoryShop[]> {
  let q = sb().from('history').select('items,store_id,total_cost,created_at').order('created_at', { ascending: false }).limit(limit);
  if (onlyWithCost) q = q.gt('total_cost', 0);
  return (check(await q) as any[]).map((h) => ({ ...h, total_cost: h.total_cost == null ? null : Number(h.total_cost) }));
}

const savingOut = (row: any): T.SavingEntry => ({
  ...(row.data || {}), id: row.id, user_id: row.user_id, store_id: row.store_id, verified: row.verified, created_at: row.created_at,
});

async function savingRow(id: string): Promise<any> {
  const row = check(await sb().from('savings').select('*').eq('id', id).maybeSingle());
  if (!row) throw new Error('Voce non trovata');
  return row;
}

async function myRecipes(): Promise<Recipe[]> {
  const rows = check(await sb().from('recipes').select('*').order('updated_at', { ascending: false }).limit(500)) as any[];
  return rows.map((r) => ({ ...r, categories: r.categories ?? null }));
}

async function findRecipe(id: string): Promise<Recipe | null> {
  if (id.startsWith('wb:')) return COLLECTION.find((r) => r.id === id) ?? null;
  return (check(await sb().from('recipes').select('*').eq('id', id).maybeSingle()) as Recipe | null) ?? null;
}

const cleanLines = (lines: string[]) => lines.map((l) => l.trim()).filter(Boolean);

// ------------------------------------------------------------------ famiglia
async function myProfile(): Promise<{ id: string; display_name: string | null; family_id: string | null }> {
  const me = await uid();
  return check(await sb().from('profiles').select('id,display_name,family_id').eq('id', me).single()) as any;
}

async function setDisplayName(name?: string | null) {
  const n = (name || '').trim();
  if (n) await sb().from('profiles').update({ display_name: n.slice(0, 40), updated_at: nowIso() }).eq('id', await uid());
}

/** Ricette e spesa in corso seguono la famiglia: entrando le vedono tutti, uscendo tornano solo tue. */
async function moveMyThings(familyId: string | null) {
  const me = await uid();
  await sb().from('recipes').update({ family_id: familyId }).eq('user_id', me);
  await sb().from('shops').update({ family_id: familyId }).eq('user_id', me).eq('status', 'active');
}

async function familyOut(): Promise<T.Family | Record<string, never>> {
  const p = await myProfile();
  if (!p.family_id) return {};
  const fam = check(await sb().from('families').select('*').eq('id', p.family_id).maybeSingle()) as any;
  if (!fam) return {};
  const members = check(await sb().rpc('family_members')) as any[];
  return { code: fam.code, created_at: fam.created_at,
    members: members.map((m) => ({ user_id: m.user_id, display_name: m.display_name || 'Senza nome', notifications: m.notifications ?? null })) };
}

// ------------------------------------------------------------------ spesa in corso
async function shopOut(row: any, me: string): Promise<T.Shop> {
  const owner = row.family_id || row.user_id;
  const { data } = await sb().from('aisles').select('ranks').eq('owner_id', owner).eq('store_id', row.store_id).maybeSingle();
  const items: T.ShopItem[] = row.items;
  const done = items.filter((i) => i.checked);
  return { ...row, aisles: aisleOrder(data?.ranks),
    progress: { checked: done.length, total: items.length, cart: r2(done.reduce((s, i) => s + (i.price || 0), 0)),
      estimated: r2(items.reduce((s, i) => s + (i.price || 0), 0)) },
    mine: row.user_id === me };
}

async function shopRow(id: string): Promise<any> {
  const row = check(await sb().from('shops').select('*').eq('id', id).maybeSingle());
  if (!row) throw new Error('Spesa non trovata');
  return row;
}

/** Modifica della spesa senza perdere le spunte degli altri: se nel frattempo è cambiata, si rilegge e si riprova. */
async function updateShop(id: string, change: (row: any) => void): Promise<any> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await shopRow(id);
    change(row);
    const stamp = nowIso();
    const res = check(await sb().from('shops').update({ items: row.items, taken_by: row.taken_by ?? null, updated_at: stamp })
      .eq('id', id).eq('updated_at', row.updated_at).select('*')) as any[];
    if (res.length) return res[0];
  }
  throw new Error('La spesa è stata modificata da un altro: riprova');
}

/** Spesa presa in carico da un altro: si guarda soltanto (a meno di aiutare o prenderla). */
function guardAct(shop: any, me: string) {
  const t = shop.taken_by;
  if (t && t.user_id !== me && !(t.helpers || []).some((h: any) => h.user_id === me)) {
    throw new Error(`La sta facendo ${t.name || 'un familiare'}: chiedi di aiutare per smarcare anche tu`);
  }
}

async function learnFromShop(row: any) {
  const owner = row.family_id || row.user_id;
  // spesa in più tappe: l'ordine dei reparti si impara negozio per negozio
  const parts: { store_id: string; items: any[] }[] = row.stops?.length > 1
    ? row.stops.map((st: any, k: number) => ({ store_id: st.store_id, items: row.items.filter((i: any) => (i.stop ?? 0) === k) }))
    : [{ store_id: row.store_id, items: row.items }];
  for (const part of parts) {
    const { data } = await sb().from('aisles').select('ranks').eq('owner_id', owner).eq('store_id', part.store_id).maybeSingle();
    const ranks = learnAisles(part.items, data?.ranks);
    if (ranks) await sb().from('aisles').upsert({ owner_id: owner, store_id: part.store_id, ranks, updated_at: nowIso() });
  }
}

/** scontrino calcolato di una spesa, anche in più tappe (ogni prodotto col prezzo del suo negozio) */
function shopReceipt(book: any, shop: any, listItems: any[], stopOf: (i: number) => number): any {
  if (!(shop.stops?.length > 1)) return computeVirtualReceipt(book, shop.store_id, listItems);
  const parts = shop.stops.map((st: any, k: number) => computeVirtualReceipt(book, st.store_id, listItems.filter((_: any, i: number) => stopOf(i) === k)));
  const sum = (f: (r: any) => number) => r2(parts.reduce((t: number, r: any) => t + f(r), 0));
  return { lines: parts.flatMap((r: any) => r.lines), unknown_products: parts.flatMap((r: any) => r.unknown_products),
    custom_items: parts.flatMap((r: any) => r.custom_items), real_lines: parts.reduce((t: number, r: any) => t + r.real_lines, 0),
    total: sum((r) => r.total), normal_total: sum((r) => r.normal_total), savings_vs_normal: sum((r) => r.savings_vs_normal) };
}

/**
 * Fine spesa: lo scontrino calcolato diventa quello di ciò che è finito davvero nel carrello
 * (comprese le cose aggiunte in negozio, senza quelle non prese), con i prezzi visti in negozio.
 * Così la verifica con lo scontrino vero confronta cose uguali.
 */
async function finalizeSaving(shop: any) {
  if (!shop.saving_id) return;
  const row = await savingRow(shop.saving_id);
  const data = { ...(row.data || {}) };
  const bought: T.ShopItem[] = shop.items.filter((i: T.ShopItem) => i.checked);
  const listItems = bought.map((i) => ({ product_id: i.product_id, quantity: i.quantity, name: i.name, category_id: i.category_id, unit: i.unit }));
  bookCache = null;  // i prezzi segnati in negozio valgono subito
  const receipt: any = shopReceipt(await priceBook(), shop, listItems, (i) => bought[i].stop ?? 0);
  const snap = data.snapshot ? { ...data.snapshot } : null;
  if (snap) {
    const fuel = snap.travel?.fuel_cost ?? 0;
    snap.receipt = receipt;
    snap.total_cost = r2(receipt.total + fuel);
    snap.effective_cost = r2(snap.total_cost - (snap.fuel_stop?.saving ?? 0));
    data.snapshot = snap;
  }
  const travel = (data.estimated_total ?? 0) - (data.estimated_spend ?? 0);
  data.planned_spend = data.planned_spend ?? data.estimated_spend ?? null;   // quello previsto alla conferma
  data.estimated_spend = receipt.total;
  data.estimated_total = r2(receipt.total + Math.max(travel, 0));
  data.added_in_store = bought.filter((i) => i.added_in_store).map((i) => i.name);
  data.not_bought = shop.items.filter((i: T.ShopItem) => !i.checked).map((i: T.ShopItem) => i.name);
  data.bought_by = shop.taken_by?.name ?? shop.display_name ?? null;
  check(await sb().from('savings').update({ data }).eq('id', row.id));
  // lo storico (abitudini, budget) registra quello che è stato comprato davvero
  if (data.history_id) await sb().from('history').update({ items: listItems }).eq('id', data.history_id);
}

// ------------------------------------------------------------------ API
export const cloudApi = {
  /** All'avvio: il catalogo è già nell'app, i prezzi no. Li scarico qui, così la schermata di caricamento resta
   *  finché non sono pronti (offerte e "Trova la spesa migliore" poi sono immediati). Se la rete non va, si entra lo stesso. */
  bootstrap: async (): Promise<T.Bootstrap> => {
    // rete bloccata: dopo 20 s si entra comunque e i prezzi continuano ad arrivare in sottofondo
    await Promise.race([priceBook().catch(() => null), new Promise((r) => setTimeout(r, 20000))]);
    return {
      categories: CATEGORIES, products: PRODUCTS,
      stores: STORES.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng, distance_km: s.distance_km })),
    };
  },

  optimize: async (req: T.OptimizeRequest): Promise<T.OptimizeResult> => {
    if (req.habitual_store_id && !STORE_INDEX[req.habitual_store_id]) throw new Error('Supermercato abituale sconosciuto');
    const hasPos = req.lat != null && req.lon != null;
    const [book, shops, stations, date, parkings] = await Promise.all([
      priceBook(), historyRows(BUDGET_HISTORY_LIMIT),
      hasPos ? stationsNear(req.lat!, req.lon!).catch(() => [] as FuelStation[]) : Promise.resolve([] as FuelStation[]),
      fuelObservedAt().catch(() => null),
      hasPos ? parkingsAround(req.lat!, req.lon!, kv).catch(() => null) : Promise.resolve(null),
    ]);
    let stores; let location: any;
    if (hasPos) {
      try {
        [stores, location] = storesFor(nearestPerChain(await storesAround(req.lat!, req.lon!, kv), req.lat!, req.lon!));
      } catch {
        [stores, location] = storesFor(null, 'OpenStreetMap non raggiungibile');
      }
    } else {
      [stores, location] = storesFor(null);
    }
    if (req.habitual_store_id && !stores.some((s) => s.id === req.habitual_store_id)) {
      location.habitual_missing = STORE_INDEX[req.habitual_store_id].name;
    }
    // l'abituale è un punto vendita preciso: se qui la stessa catena è un altro negozio, non vale come abituale
    let habitualId = req.habitual_store_id ?? null;
    const hb = req.habitual_branch;
    const here = habitualId ? stores.find((s) => s.id === habitualId) : undefined;
    if (hb && here?.branch && haversineKm(hb.lat, hb.lon, here.branch.lat, here.branch.lon) > HABITUAL_SAME_STORE_KM) {
      location.habitual_far = `${STORE_INDEX[habitualId!].name}${hb.name ? ` (${hb.name})` : ''}`;
      habitualId = null;
    }
    const fuelType = req.fuel_type || 'benzina';
    const fuel = fuelInfo(fuelType, stations, req.lat, req.lon, date);
    const result: any = optimizeList(book, { ...req, habitual_store_id: habitualId, fuel_type: fuelType }, stores, fuel, stations);
    result.location = location;
    if (parkings) {
      for (const r of result.ranked) if (r.branch) r.branch.parking = parkingFor({ lat: r.branch.lat, lon: r.branch.lon, chain: r.store_id }, parkings);
    }
    // #2: anche in due negozi, se conviene davvero (solo con la posizione vera: serve la distanza tra i due)
    if ((req.max_stores ?? 1) >= 2 && location.mode === 'reale') {
      const withCat = req.items.map((i) => ({ ...i, category_id: i.category_id ?? PRODUCT_INDEX[i.product_id]?.category_id ?? null }));
      Object.assign(result, splitPlan(result.ranked, result.recommended, withCat, {
        transport: req.transport, fuel, min_savings_threshold: req.min_savings_threshold, rules: req.category_rules ?? null,
      }));
    }
    const last: any = lastSimilarShop(req.items.map((i) => i.product_id), shops);
    if (last) last.same_as_recommended = last.store_id === result.recommended.store_id;
    result.last_similar = last;
    return result;
  },

  offers: async (): Promise<T.Offer[]> => {
    const book = await priceBook();
    const out: T.Offer[] = [];
    for (const [sid, products] of Object.entries(book.catalog)) {
      for (const [pid, info] of Object.entries(products)) {
        if (info.promo_price == null) continue;
        out.push({ store_id: sid, store_name: STORE_INDEX[sid].name, product_id: pid, product_name: PRODUCT_INDEX[pid].name,
          normal_price: info.normal_price, promo_price: info.promo_price,
          discount_pct: pyRound((1 - info.promo_price / info.normal_price) * 100), loyalty_required: info.loyalty_required,
          source: info.source as T.PriceSource, observed_at: info.observed_at });
      }
    }
    out.sort((a, b) => Number(a.source === 'stima') - Number(b.source === 'stima') || b.discount_pct - a.discount_pct);
    return out;
  },

  classify: async (text: string): Promise<T.ClassifyResult> => classify(text) as T.ClassifyResult,

  fuelNearby: async (fuel: T.FuelType, lat?: number, lon?: number, liters = 40): Promise<T.FuelNearby> => {
    if (lat == null || lon == null) return { fuel, median: null, liters, observed_at: null, best: null, stations: [] };
    const [stations, date] = await Promise.all([stationsNear(lat, lon), fuelObservedAt().catch(() => null)]);
    return fuelNearby(stations, fuelInfo(fuel, stations, lat, lon, date), lat, lon, liters, 5) as T.FuelNearby;
  },

  flyers: async (lat?: number, lon?: number): Promise<T.Flyer[]> => {
    let all: any[] = [];
    if (lat != null && lon != null) {
      try { all = await storesAround(lat, lon, kv); } catch { all = []; }
    }
    return flyers(all, lat, lon);
  },

  /** radiusKm: fino a 6 km la zona solita (in cache), oltre si scarica la zona di 20 km. */
  nearMe: async (lat: number, lon: number, fuel: T.FuelType, radiusKm = RADIUS_M / 1000): Promise<T.NearMe> => {
    const zoneKm = radiusKm <= RADIUS_M / 1000 ? RADIUS_M / 1000 : NEAR_ME_MAX_KM;
    const zoneM = zoneKm * 1000;
    const [osm, stations, parkings] = await Promise.all([
      supermarketsAround(lat, lon, kv, fetch, zoneM).catch(() => { throw new Error('OpenStreetMap non raggiungibile'); }),
      stationsNear(lat, lon, Math.max(15, zoneKm)).catch(() => [] as FuelStation[]),
      parkingsAround(lat, lon, kv, fetch, zoneM).catch(() => null),
    ]);
    const km = (la: number, lo: number) => pyRound(Math.max(haversineKm(lat, lon, la, lo) * C.road_factor, 0.1), 1);
    const stores = osm.map((s) => ({ ...s, distance_km: km(s.lat, s.lon) }))
      .filter((s) => s.distance_km <= zoneKm).sort((a, b) => a.distance_km - b.distance_km);
    if (parkings) withParking(stores, parkings);
    const fuelStations = stations.map((s) => ({ id: s.id, brand: s.brand, name: s.name ?? s.brand, address: s.address, city: s.city,
      lat: s.lat, lon: s.lon, price: s.prices[fuel]?.self ?? null, distance_km: km(s.lat, s.lon) }))
      .filter((s) => s.distance_km <= zoneKm).sort((a, b) => a.distance_km - b.distance_km);
    return { radius_km: zoneKm, stores: stores as T.NearbyStore[], stations: fuelStations, fuel, parking_missing: !parkings };
  },

  storesNearby: async (lat: number, lon: number) => {
    let near;
    try { near = nearestPerChain(await storesAround(lat, lon, kv), lat, lon); } catch { throw new Error('OpenStreetMap non raggiungibile'); }
    return { radius_km: RADIUS_M / 1000, stores: Object.values(near).sort((a, b) => a.distance_km - b.distance_km) as T.NearbyStore[],
      missing_chains: STORES.filter((s) => !near[s.id]).map((s) => s.name) };
  },

  addSaving: async (body: Parameters<typeof import('../api').localApi.addSaving>[0]): Promise<T.SavingEntry> => {
    const { user_id: _u, store_id, ...rest } = body;
    const data = { fuel_saving: 0, ...rest, verified_amount: null, paid: null,
      store_name: rest.store_name ?? STORE_INDEX[store_id]?.name ?? store_id };
    const row = check(await sb().from('savings').insert({ store_id, data }).select('*').single());
    return savingOut(row);
  },

  savings: async (_userId: string): Promise<T.SavingsSummary> => {
    const me = await uid();
    const rows = check(await sb().from('savings').select('*').order('created_at', { ascending: false }).limit(500)) as any[];
    // salvadanaio di famiglia: le spese degli altri con il loro nome
    const names = new Map<string, string>();
    if (rows.some((r) => r.user_id !== me)) {
      const { data } = await sb().rpc('family_members');
      for (const m of (data as any[]) || []) names.set(m.user_id, m.display_name || 'un familiare');
    }
    const entries = rows.map((r) => ({ ...savingOut(r), mine: r.user_id === me, by: r.user_id === me ? null : names.get(r.user_id) ?? 'un familiare' }));
    return {
      entries,
      total: r2(entries.reduce((s, e) => s + savingValue(e), 0)),
      total_verified: r2(entries.filter((e) => e.verified).reduce((s, e) => s + (e.verified_amount || 0), 0)),
      total_estimated: r2(entries.filter((e) => !e.verified).reduce((s, e) => s + e.amount, 0)),
      to_verify: entries.filter((e) => !e.verified).length,
    };
  },

  deleteSaving: async (id: string) => {
    const rows = check(await sb().from('savings').delete().eq('id', id).select('id')) as any[];
    if (!rows.length) throw new Error('Voce non trovata');
    return { deleted: 1 };
  },

  scanReceipt: async (_images: string[], _saving_id?: string): Promise<T.ScanResult> => {
    throw new Error('Nella versione online i prezzi dello scontrino si inseriscono a mano');
  },

  applyReceipt: async (body: Parameters<typeof import('../api').localApi.applyReceipt>[0]) => {
    if (!STORE_INDEX[body.store_id]) throw new Error('Negozio sconosciuto');
    const date = body.date && !Number.isNaN(Date.parse(body.date)) ? body.date.slice(0, 10) : today();
    const row = body.saving_id ? await savingRow(body.saving_id).catch(() => null) : null;
    const branch = row?.data?.snapshot?.branch?.name ?? null;
    const saved = await saveObserved(body.lines as ObservedLine[], body.store_id, date, branch);
    const out: { prices_saved: number; verified?: T.SavingEntry } = { prices_saved: saved };
    if (row) {
      const data = { ...row.data, real_receipt: { store_id: body.store_id, date, total: body.total ?? null, lines: body.lines } };
      check(await sb().from('savings').update({ data }).eq('id', row.id));
      if (body.total) out.verified = await cloudApi.verifySaving(row.id, body.total, body.refueled, body.fuel_price);
    }
    return out;
  },

  verifySaving: async (id: string, paid: number, refueled?: boolean, fuel_price?: number): Promise<T.SavingEntry> => {
    const row = await savingRow(id);
    const entry = { ...row.data };
    const shop = verifiedSaving(entry, paid);
    const fuelPart = verifiedFuelSaving(entry, refueled ?? null, fuel_price ?? null);
    const update = { verified: true, verified_amount: r2(shop + fuelPart), verified_fuel: fuelPart, paid: r2(paid),
      fuel_price_paid: fuel_price ?? null, refueled: refueled ?? null, verified_at: nowIso() };
    const saved = check(await sb().from('savings').update({ verified: true, data: { ...entry, ...update } }).eq('id', id).select('*').single());
    if (entry.history_id) {
      const travel = (entry.estimated_total || 0) - (entry.estimated_spend || 0);
      await sb().from('history').update({ total_cost: r2(paid + Math.max(travel, 0)) }).eq('id', entry.history_id);
    }
    return savingOut(saved);
  },

  unverifySaving: async (id: string) => {
    const row = await savingRow(id);
    check(await sb().from('savings').update({ verified: false, data: { ...row.data, verified: false, verified_amount: null, paid: null } }).eq('id', id));
    return { ok: true };
  },

  addHistory: async (body: { user_id: string; items: T.ListItem[]; store_id?: string; total_cost?: number }) => {
    const row = check(await sb().from('history').insert({ items: body.items, store_id: body.store_id ?? null,
      total_cost: body.total_cost ?? null }).select('id').single()) as any;
    return { id: row.id as string };
  },

  budgetSuggest: async (_user_id: string, items: T.ListItem[]): Promise<T.BudgetSuggestion> => {
    const shops = await historyRows(BUDGET_HISTORY_LIMIT, true);
    const ids = items.map((i) => i.product_id);
    return { ...(suggestBudget(ids, shops) as any), last_similar: lastSimilarShop(ids, shops) };
  },

  habitual: async (_userId: string) => {
    const shops = await historyRows(40);
    return { ...(habitualFromHistory(shops) as any), based_on: shops.length };
  },

  recipes: async (q: string, _user_id?: string | null, sort: 'rilevanza' | 'prezzo' = 'rilevanza') => {
    const limit = 40;
    const mine = await myRecipes();
    let found: Recipe[];
    const book = await priceBook();
    if (sort === 'prezzo') {
      const pool = q ? [...search(mine, q, 10000), ...search(COLLECTION, q, 10000)] : [...mine, ...COLLECTION];
      found = rankByPrice(book, pool, true, limit);
    } else {
      found = [...search(mine, q, limit), ...search(COLLECTION, q, limit)].slice(0, limit);
    }
    return { recipes: found.map((r) => recipeSummaryPriced(book, r)) as T.RecipeSummary[], total_collection: COLLECTION.length, license: LICENSE };
  },

  suggest: async (body: { user_id?: string | null; items: T.ListItem[]; store_id?: string; budget?: number | null; spent?: number | null; servings?: number }) => {
    const [book, mine, shops] = await Promise.all([priceBook(), myRecipes(), historyRows(40)]);
    return suggest(book, body, [...mine, ...COLLECTION], shops) as unknown as T.Suggestions;
  },

  recipeMenu: async (_user_id: string | null, entries: { recipe_id: string; servings: number }[]): Promise<T.MenuPlan> => {
    const book = await priceBook();
    const found: { recipe: Recipe; servings: number }[] = [];
    for (const e of entries) {
      const r = await findRecipe(e.recipe_id);
      if (r) found.push({ recipe: r, servings: e.servings });
    }
    return menuPlan(book, found) as unknown as T.MenuPlan;
  },

  recipePropose: async (body: { user_id?: string | null; count: number; servings: number; budget?: number | null; store_id?: string; exclude?: string[]; items?: T.ListItem[] }) => {
    const [book, mine, shops] = await Promise.all([priceBook(), myRecipes(), historyRows(40)]);
    return proposeMenu(book, body, [...mine, ...COLLECTION], shops) as unknown as { recipes: T.ProposedRecipe[]; total: number; servings: number; budget: number | null };
  },

  recipe: async (id: string, _user_id?: string | null): Promise<T.Recipe> => {
    const r = await findRecipe(id);
    if (!r) throw new Error('Ricetta non trovata');
    return r as T.Recipe;
  },

  recipePlan: async (body: { servings: number; recipe_id?: string; user_id?: string | null; ingredients?: string[]; recipe_servings?: number | null }): Promise<T.RecipePlan> => {
    let lines: string[]; let base: number | null | undefined;
    if (body.recipe_id) {
      const r = await findRecipe(body.recipe_id);
      if (!r) throw new Error('Ricetta non trovata');
      lines = r.ingredients; base = r.servings;
    } else if (body.ingredients?.length) {
      lines = body.ingredients; base = body.recipe_servings;
    } else throw new Error('Indica la ricetta');
    return planRecipe(await priceBook(), lines, base, body.servings, body.recipe_id || 'inline') as unknown as T.RecipePlan;
  },

  recipeImport: async (_url: string): Promise<T.Recipe> => {
    throw new Error('Nella versione online non si possono ancora importare ricette da un link: copia gli ingredienti in una ricetta tua');
  },

  recipeCreate: async (body: T.RecipeIn): Promise<T.Recipe> => {
    const row = check(await sb().from('recipes').insert({
      name: body.name, servings: body.servings, ingredients: cleanLines(body.ingredients), notes: body.notes ?? null,
      url: body.url ?? null, source: body.source || 'mia',
    }).select('*').single());
    return row as T.Recipe;
  },

  recipeUpdate: async (id: string, body: T.RecipeIn): Promise<T.Recipe> => {
    const old = await findRecipe(id);
    if (!old) throw new Error('Ricetta non trovata');
    const rows = check(await sb().from('recipes').update({
      name: body.name, servings: body.servings, ingredients: cleanLines(body.ingredients), notes: body.notes ?? null,
      url: body.url ?? null, source: body.source || old.source || 'mia', updated_at: nowIso(),
    }).eq('id', id).select('*')) as any[];
    if (!rows.length) throw new Error('Ricetta non trovata');
    return rows[0];
  },

  recipeDelete: async (id: string, _user_id: string) => {
    const rows = check(await sb().from('recipes').delete().eq('id', id).select('id')) as any[];
    if (!rows.length) throw new Error('Ricetta non trovata');
    return { ok: true };
  },

  geocode: async (q: string) => geocode(q),

  shopCreate: async (body: { user_id: string; store_id: string; saving_id?: string; branch?: string | null; items: T.ShopItemIn[]; display_name?: string | null; stops?: T.ShopStop[] | null }): Promise<T.Shop> => {
    if (!STORE_INDEX[body.store_id]) throw new Error('Negozio sconosciuto');
    const me = await uid();
    const book = await priceBook();
    const seen = new Set<string>();
    const items: any[] = [];
    const stops = body.stops && body.stops.length > 1 ? body.stops : null;
    for (const it of body.items) {
      if (seen.has(it.product_id)) continue;
      seen.add(it.product_id);
      if (!stops) { items.push(shopItem(book, it, body.store_id)); continue; }
      // spesa in più tappe: ogni prodotto col prezzo del negozio dove lo prendi
      const k = Math.min(Math.max(it.stop ?? 0, 0), stops.length - 1);
      items.push({ ...shopItem(book, it, stops[k].store_id), stop: k, store_id: stops[k].store_id });
    }
    const row = check(await sb().from('shops').insert({
      display_name: body.display_name ?? null, store_id: body.store_id,
      store_name: stops ? stops.map((st) => STORE_INDEX[st.store_id]?.name ?? st.store_name).join(' e ') : STORE_INDEX[body.store_id].name,
      branch: body.branch ?? null, saving_id: body.saving_id ?? null, items,
      ...(stops ? { stops } : {}),
    }).select('*').single());
    return shopOut(row, me);
  },

  shopActive: async (_user_id: string): Promise<{ shop: T.Shop | null; others?: number }> => {
    const me = await uid();
    const shops = check(await sb().from('shops').select('*').eq('status', 'active').order('created_at', { ascending: false }).limit(5)) as any[];
    if (!shops.length) return { shop: null };
    const mine = shops.find((s) => s.user_id === me);
    return { shop: await shopOut(mine ?? shops[0], me), others: shops.length - 1 };
  },

  shopCheck: async (id: string, _user_id: string, key: string, checked: boolean, display_name?: string | null): Promise<T.Shop> => {
    const me = await uid();
    const row = await updateShop(id, (shop) => {
      if (shop.status !== 'active') throw new Error('Questa spesa è già chiusa');
      guardAct(shop, me);
      let found = false;
      for (const i of shop.items) {
        if (i.key === key) {
          Object.assign(i, { checked, checked_by: checked ? display_name || null : null, checked_by_id: checked ? me : null,
            checked_at: checked ? nowIso() : null });
          found = true;
        }
      }
      if (!found) throw new Error('Prodotto non trovato');
      // spesa libera: smarcare vuol dire prenderla (l'app chiede conferma prima)
      if (checked && !shop.taken_by) shop.taken_by = { user_id: me, name: display_name || null, at: nowIso(), helpers: [] };
    });
    return shopOut(row, me);
  },

  /**
   * Chi fa la spesa: una persona sola, presa solo con un gesto esplicito. Chi vuole prenderla (o aiutare) chiede,
   * chi la fa risponde; dopo un "no" niente nuova richiesta per REQUEST_WAIT_MIN minuti; senza risposta per
   * REQUEST_WAIT_MIN minuti chi ha chiesto può prenderla comunque.
   */
  shopTake: async (id: string, _user_id: string, display_name?: string | null, mode: T.TakeMode = 'take'): Promise<T.Shop> => {
    const me = await uid();
    // il nome lo vedono gli altri ("La sta facendo Moira"): se sul telefono non c'è, quello del profilo
    const name = display_name || (await myProfile().catch(() => null as any))?.display_name || null;
    const waitMs = REQUEST_WAIT_MIN * 60_000;
    const row = await updateShop(id, (shop) => {
      if (shop.status !== 'active') throw new Error('Questa spesa è già chiusa');
      const t = shop.taken_by;
      const who = t?.name || 'un familiare';
      const fresh = (u: string) => ({ user_id: u, name, at: nowIso(), helpers: [] });
      switch (mode) {
        case 'take': {
          if (!t || t.user_id === me) { shop.taken_by = t?.user_id === me ? t : fresh(me); break; }
          const r = t.request;
          if (r?.user_id === me && Date.now() - new Date(r.at).getTime() >= waitMs) { shop.taken_by = fresh(me); break; }
          throw new Error(`La sta facendo ${who}: chiedi di prenderla`);
        }
        case 'request': case 'request_help': case 'help': {
          if (!t) { shop.taken_by = fresh(me); break; }               // libera: la prendo e basta
          if (t.user_id === me || (t.helpers || []).some((h: any) => h.user_id === me)) break;
          if (t.request && t.request.user_id !== me) throw new Error(`${t.request.name || 'Un familiare'} ha già chiesto a ${who}: aspetta la risposta`);
          if (t.declined?.user_id === me && new Date(t.declined.until).getTime() > Date.now()) {
            const at = new Date(t.declined.until).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
            throw new Error(`${who} la sta facendo: potrai chiedere di nuovo dalle ${at}`);
          }
          t.request = { user_id: me, name, mode: mode === 'request' ? 'take' : 'help', at: nowIso() };
          break;
        }
        case 'cancel':
          if (t?.request?.user_id === me) t.request = null;
          break;
        case 'accept': case 'decline': {
          if (!t || t.user_id !== me) throw new Error('Solo chi fa la spesa può rispondere');
          const r = t.request;
          if (!r) break;
          if (mode === 'decline') { t.request = null; t.declined = { user_id: r.user_id, until: new Date(Date.now() + waitMs).toISOString() }; break; }
          if (r.mode === 'help') { t.helpers = [...(t.helpers || []).filter((h: any) => h.user_id !== r.user_id), { user_id: r.user_id, name: r.name }]; t.request = null; t.declined = null; }
          else shop.taken_by = { user_id: r.user_id, name: r.name, at: nowIso(), helpers: [] };
          break;
        }
        case 'release':
          if (!t) break;
          if (t.user_id === me) shop.taken_by = null;
          else t.helpers = (t.helpers || []).filter((h: any) => h.user_id !== me);
          break;
      }
    });
    return shopOut(row, me);
  },

  shopAdd: async (id: string, _user_id: string, item: T.ShopItemIn): Promise<T.Shop> => {
    const me = await uid();
    const book = await priceBook();
    const row = await updateShop(id, (shop) => {
      if (shop.status !== 'active') throw new Error('Questa spesa è già chiusa');
      guardAct(shop, me);
      const existing = shop.items.find((i: any) => i.key === item.product_id);
      if (existing) existing.quantity = pyRound(existing.quantity + item.quantity, 3);
      else if (shop.stops?.length > 1) {
        const k = Math.min(Math.max(item.stop ?? 0, 0), shop.stops.length - 1);
        const sid = shop.stops[k].store_id;
        shop.items.push({ ...shopItem(book, item, sid, true), stop: k, store_id: sid, checked: true, checked_at: nowIso(), checked_by: null, checked_by_id: me });
      } else shop.items.push({ ...shopItem(book, item, shop.store_id, true), checked: true, checked_at: nowIso(), checked_by: null, checked_by_id: me });
    });
    return shopOut(row, me);
  },

  shopPrice: async (id: string, body: { user_id: string; key: string; price: number; kind: T.PriceKind; note?: string | null; display_name?: string | null; promo_until?: string | null }): Promise<T.Shop> => {
    const me = await uid();
    const current = await shopRow(id);
    guardAct(current, me);
    const item = current.items.find((i: any) => i.key === body.key);
    if (!item) throw new Error('Prodotto non trovato');
    if (!item.product_id.startsWith('custom:')) {
      const kg = item.unit === 'kg';
      await saveObserved([{ product_id: item.product_id, text: item.name, net_price: body.price,
        quantity: kg ? 1 : item.quantity, weight_kg: kg ? item.quantity : null, kind: body.kind,
        promo_until: body.promo_until ?? null, note: body.note ?? null }], item.store_id ?? current.store_id, today(),
        (item.stop != null && current.stops?.[item.stop]?.branch) || current.branch || null);
    }
    const row = await updateShop(id, (shop) => {
      const it = shop.items.find((i: any) => i.key === body.key);
      if (!it) throw new Error('Prodotto non trovato');
      Object.assign(it, { seen: { price: body.price, kind: body.kind, note: body.note ?? null }, checked: true,
        checked_at: it.checked_at || nowIso(), checked_by: body.display_name ?? null, checked_by_id: me });
      if (body.kind !== 'variante') it.price = body.price;
    });
    return shopOut(row, me);
  },

  shopFinish: async (id: string, _user_id: string) => {
    const shop = await shopRow(id);
    guardAct(shop, await uid());
    await learnFromShop(shop).catch(() => {});
    check(await sb().from('shops').update({ status: 'done', finished_at: nowIso() }).eq('id', id));
    await finalizeSaving(shop).catch(() => {});
    const items: T.ShopItem[] = shop.items;
    return { missing: items.filter((i) => !i.checked), saving_id: shop.saving_id ?? null, store_name: shop.store_name as string,
      cart: r2(items.filter((i) => i.checked).reduce((s, i) => s + (i.price || 0), 0)) };
  },

  shopCancel: async (id: string, _user_id: string) => {
    const shop = await shopRow(id);
    check(await sb().from('shops').update({ status: 'cancelled' }).eq('id', id));
    return { items: shop.items as T.ShopItem[] };
  },

  familyCreate: async (_user_id: string, display_name: string): Promise<T.Family> => {
    await setDisplayName(display_name);
    const fam = check(await sb().rpc('create_family')) as any;
    await moveMyThings(fam.id);
    return (await familyOut()) as T.Family;
  },

  familyJoin: async (_user_id: string, display_name: string, code: string): Promise<T.Family> => {
    await setDisplayName(display_name);
    const { data, error } = await sb().rpc('join_family', { join_code: code });
    if (error) throw new Error(error.message.includes('non trovato') ? 'Codice famiglia non trovato' : error.message);
    await moveMyThings((data as any).id);
    return (await familyOut()) as T.Family;
  },

  familyLeave: async (_user_id: string) => {
    await moveMyThings(null);
    check(await sb().rpc('leave_family'));
    return { ok: true };
  },

  familyByUser: async (_userId: string) => familyOut(),

  familyPushList: async (code: string, _user_id: string, items: T.ListItem[]): Promise<T.FamilyList> => {
    const p = await myProfile();
    if (!p.family_id) throw new Error('Non fai parte di questa famiglia');
    const doc = { family_id: p.family_id, items, updated_by: p.id, updated_at: nowIso() };
    check(await sb().from('family_lists').upsert(doc));
    return { code, items, updated_by: p.id, updated_at: doc.updated_at };
  },

  familyPullList: async (code: string): Promise<T.FamilyList> => {
    const p = await myProfile();
    if (!p.family_id) return { code, items: [] };
    const row = check(await sb().from('family_lists').select('*').eq('family_id', p.family_id).maybeSingle()) as any;
    return row ? { code, items: row.items, updated_by: row.updated_by, updated_at: row.updated_at } : { code, items: [] };
  },
};

// solo per le prove automatiche (build con EXPO_PUBLIC_E2E=1)
if (IS_CLOUD && process.env.EXPO_PUBLIC_E2E === '1') (globalThis as any).__mc = cloudApi;
