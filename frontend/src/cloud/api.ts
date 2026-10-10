/**
 * Versione online dell'app: stessa interfaccia di `api` (src/api.ts), ma il calcolo gira nel telefono
 * (src/engine) e i dati stanno su Supabase. Nessun server nostro.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type * as T from '../api';
import { REQUEST_WAIT_MIN } from '../shopRules';
import { helpOptions, splitPlan } from '../engine/split';
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
import { haversineKm, median, pyRound } from '../engine/util';
import WIKIBOOKS from '../engine/data/recipes_wikibooks.json';
import RECIPE_CORES from '../engine/data/recipe_cores.json';
import { check, IS_CLOUD, sb, uid } from './client';

const COLLECTION = (WIKIBOOKS as { recipes: Recipe[] }).recipes;
const LICENSE = (WIKIBOOKS as { license: string }).license;
const BUDGET_HISTORY_LIMIT = 50;
const HABITUAL_SAME_STORE_KM = 1.0;   // entro 1 km è lo stesso punto vendita
/** #19: a piedi e in bici non si consigliano negozi lontani (km di strada, solo andata) */
const DISTANCE_LIMIT_KM: Partial<Record<string, number>> = { walk: 1.2, bike: 5 };
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

// ------------------------------------------------------------------ prezzi dei prodotti scritti a mano (#26)
// Della famiglia (o della persona): "idropulsore da Lidl 49,99 €, visto il 10/10". Prezzo per unità (pz o kg).
type CustomPrice = { unit_price: number; seen_on: string; name: string };
let customCache: { at: number; map: Map<string, CustomPrice> } | null = null;
async function customPrices(): Promise<Map<string, CustomPrice>> {
  if (customCache && Date.now() - customCache.at < 10 * 60 * 1000) return customCache.map;
  const map = new Map<string, CustomPrice>();
  try {
    const { data } = await sb().from('custom_prices').select('store_id,key,name,unit_price,seen_on');
    for (const r of data ?? []) map.set(`${r.store_id}|${r.key}`, { unit_price: Number(r.unit_price), seen_on: r.seen_on, name: r.name });
  } catch { /* senza rete: niente prezzi a mano */ }
  customCache = { at: Date.now(), map };
  return map;
}
async function saveCustomPrice(storeId: string, key: string, name: string | null, unit: string | null, unitPrice: number) {
  if (!key.startsWith('custom:') || !(unitPrice > 0)) return false;
  check(await sb().rpc('save_custom_price', { p_store: storeId, p_key: key, p_name: name ?? key.slice(7), p_unit: unit ?? 'pz', p_unit_price: r2(unitPrice) }));
  customCache = null;
  return true;
}
/** scontrino calcolato: i prodotti scritti a mano col prezzo che conosco in quel negozio (fuori dal confronto tra negozi) */
function priceCustom(receipt: any, storeId: string, cp: Map<string, CustomPrice>) {
  let tot = 0;
  for (const c of receipt.custom_items ?? []) {
    const k = cp.get(`${storeId}|${c.product_id}`);
    c.price = k ? r2(k.unit_price * c.quantity) : null;
    c.seen_on = k?.seen_on ?? null;
    if (c.price != null) tot += c.price;
  }
  receipt.custom_total = r2(tot);
}
/** prezzo iniziale nella spesa in corso di un prodotto scritto a mano */
function withCustomPrice(item: any, storeId: string, cp: Map<string, CustomPrice>) {
  if (!item.product_id?.startsWith('custom:') || item.price != null) return item;
  const k = cp.get(`${storeId}|${item.product_id}`);
  return k ? { ...item, price: r2(k.unit_price * item.quantity), price_seen_on: k.seen_on } : item;
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
  const me = p.id;
  return { id: fam.id, code: fam.code ?? fam.id.slice(0, 6).toUpperCase(), created_at: fam.created_at,
    my_role: members.find((m) => m.user_id === me)?.role ?? 'membro',
    members: members.map((m) => ({ user_id: m.user_id, display_name: m.display_name || 'Senza nome', notifications: m.notifications ?? null,
      role: m.role ?? 'membro' })) };
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
    const res = check(await sb().from('shops').update({ items: row.items, taken_by: row.taken_by ?? null, stops: row.stops ?? null, updated_at: stamp })
      .eq('id', id).eq('updated_at', row.updated_at).select('*')) as any[];
    if (res.length) return res[0];
  }
  throw new Error('La spesa è stata modificata da un altro: riprova');
}

/**
 * Spesa presa in carico da un altro: si guarda soltanto (a meno di aiutare o prenderla).
 * "Ti do una mano": i prodotti di una tappa con un proprietario ("by") li smarca solo lui, e lui solo quelli.
 */
function guardAct(shop: any, me: string, item?: any) {
  const owner = item && item.stop != null ? shop.stops?.[item.stop]?.by : null;
  if (owner) {
    if (owner.user_id !== me) throw new Error(`Questo lo prende ${owner.name || 'un familiare'} da ${shop.stops[item.stop].store_name}`);
    return;
  }
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
// #21: i prodotti per i gruppi seguono la spesa (anche se spunta o chiude un familiare): lo fa il database
async function shopGroupSync(shopId: string, finish: boolean): Promise<T.GroupReceipt[]> {
  const { data, error } = await sb().rpc('shop_group_sync', { p_shop: shopId, p_finish: finish });
  if (error) throw new Error(error.message);
  return (data ?? []) as T.GroupReceipt[];
}

async function finalizeSaving(shop: any) {
  if (!shop.saving_id) return;
  const row = await savingRow(shop.saving_id);
  const data = { ...(row.data || {}) };
  // #21: nel Salvadanaio solo la parte mia / della famiglia (quella per i gruppi va nei conti del gruppo)
  const mineQty = (i: T.ShopItem) => Math.round((i.quantity - (i.groups ?? []).reduce((t, g) => t + g.quantity, 0)) * 1000) / 1000;
  const bought: T.ShopItem[] = shop.items.filter((i: T.ShopItem) => i.checked && mineQty(i) > 0);
  const listItems = bought.map((i) => ({ product_id: i.product_id, quantity: mineQty(i), name: i.name, category_id: i.category_id, unit: i.unit }));
  bookCache = null;  // i prezzi segnati in negozio valgono subito
  const receipt: any = shopReceipt(await priceBook(), shop, listItems, (i) => bought[i].stop ?? 0);
  // #26: i prodotti scritti a mano col prezzo (segnato in negozio o ricordato) diventano righe vere e contano nel totale
  const left: any[] = [];
  for (const c of receipt.custom_items ?? []) {
    const it = bought.find((b) => b.product_id === c.product_id);
    const full = it ? (it.seen?.price ?? it.price ?? null) : null;
    const price = full != null && it!.quantity > 0 ? r2(full * c.quantity / it!.quantity) : null;
    if (price == null) { left.push(c); continue; }
    receipt.lines.push({ product_id: c.product_id, name: c.name, quantity: c.quantity, unit: c.unit, unit_price: r2(price / (c.quantity || 1)),
      normal_price: price, line_price: price, in_promo: false, loyalty_required: false, confidence: 'green',
      source: 'scontrino', observed_at: today(), location_name: it!.seen ? 'segnato da te in negozio' : 'visto da te',
      sample_product: null, proof_url: null, custom: true });
    receipt.total = r2(receipt.total + price);
    receipt.normal_total = r2(receipt.normal_total + price);
  }
  receipt.custom_items = left;
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
    // preferiti (#19): dalla richiesta nuova, oppure dal vecchio "abituale"
    const favs: T.FavoriteStore[] = (req.favorites ?? (req.habitual_store_id && req.habitual_branch
      ? [{ store_id: req.habitual_store_id, branch: { name: req.habitual_branch.name ?? '', address: null, lat: req.habitual_branch.lat, lon: req.habitual_branch.lon } }]
      : [])).filter((f) => STORE_INDEX[f.store_id] && f.branch);
    const favName = (f: T.FavoriteStore) => `${STORE_INDEX[f.store_id].name}${f.branch.name && f.branch.name !== STORE_INDEX[f.store_id].name ? ` (${f.branch.name})` : ''}`;
    let stores: any[]; let location: any;
    let favHere: string[] = [];
    const favFar: string[] = [];
    if (hasPos) {
      try {
        const all = await storesAround(req.lat!, req.lon!, kv);
        const near = nearestPerChain(all, req.lat!, req.lon!);
        // il preferito è un punto vendita preciso: se è in zona prende il posto del più vicino della sua catena
        for (const f of favs) {
          const m = all.filter((x) => x.chain === f.store_id)
            .map((x) => ({ x, d: haversineKm(f.branch.lat, f.branch.lon, x.lat, x.lon) }))
            .sort((p, q) => p.d - q.d)[0];
          if (!m || m.d > HABITUAL_SAME_STORE_KM) { favFar.push(favName(f)); continue; }
          const dist = pyRound(Math.max(haversineKm(req.lat!, req.lon!, m.x.lat, m.x.lon) * C.road_factor, 0.1), 1);
          const cur = near[f.store_id];
          if (!favHere.includes(f.store_id) || (cur && dist < cur.distance_km)) near[f.store_id] = { ...m.x, distance_km: dist };
          if (!favHere.includes(f.store_id)) favHere.push(f.store_id);
        }
        [stores, location] = storesFor(near);
      } catch {
        [stores, location] = storesFor(null, 'OpenStreetMap non raggiungibile');
      }
    } else {
      [stores, location] = storesFor(null);
    }
    if (location.mode !== 'reale') favHere = favs.map((f) => f.store_id);   // distanze di esempio: valgono le catene
    // a piedi / in bici: niente negozi oltre il limite (se non ce n'è nessuno entro, li tengo e lo dico)
    const limit = location.mode === 'reale' ? DISTANCE_LIMIT_KM[req.transport] : undefined;
    let beyond: any[] = [];
    const allStores = stores;
    if (limit) {
      const within = stores.filter((x) => x.distance_km <= limit);
      beyond = stores.filter((x) => x.distance_km > limit);
      if (within.length) {
        stores = within;
        location.distance_limit = { km: limit, transport: req.transport, excluded: beyond.map((x) => `${x.name} (${String(x.distance_km).replace('.', ',')} km)`) };
        for (const x of beyond) if (favHere.includes(x.id)) { favHere = favHere.filter((id) => id !== x.id); favFar.push(`${x.name}, a ${String(x.distance_km).replace('.', ',')} km`); }
      } else {
        location.distance_limit = { km: limit, transport: req.transport, excluded: [], none_within: true };
        beyond = [];
      }
    }
    location.favorites_here = favHere;
    if (favFar.length) location.favorites_far = favFar;
    const fuelType = req.fuel_type || 'benzina';
    const fuel = fuelInfo(fuelType, stations, req.lat, req.lon, date);
    const result: any = optimizeList(book, { ...req, habitual_store_id: null, favorite_store_ids: favHere, fuel_type: fuelType }, stores, fuel, stations);
    result.location = location;
    // a piedi / in bici: se in auto un negozio più lontano conviene anche pagando il carburante, lo dico (non cambio la scelta)
    result.car_hint = null;
    if (beyond.length) {
      const car: any = optimizeList(book, { ...req, transport: 'car', refuel: false, habitual_store_id: null, favorite_store_ids: [], fuel_type: fuelType },
        allStores, fuel, stations);
      const far = car.ranked.filter((r: any) => beyond.some((x) => x.id === r.store_id))
        .sort((p: any, q: any) => p.effective_cost - q.effective_cost)[0];
      const gain = far ? pyRound(result.recommended.total_cost - far.effective_cost, 2) : 0;
      if (far && gain >= Math.max(req.min_savings_threshold, 0.5)) {
        result.car_hint = { store_id: far.store_id, store_name: far.store_name, distance_km: far.travel.distance_km, saving: gain, fuel_cost: far.travel.fuel_cost };
      }
    }
    if (parkings) {
      for (const r of result.ranked) if (r.branch) r.branch.parking = parkingFor({ lat: r.branch.lat, lon: r.branch.lon, chain: r.store_id }, parkings);
    }
    // #2: anche in due negozi, se conviene davvero (solo con la posizione vera: serve la distanza tra i due)
    if ((req.max_stores ?? 1) >= 2 && location.mode === 'reale') {
      const withCat = req.items.map((i) => ({ ...i, category_id: i.category_id ?? PRODUCT_INDEX[i.product_id]?.category_id ?? null }));
      Object.assign(result, splitPlan(result.ranked, result.recommended, withCat, {
        transport: req.transport, fuel, min_savings_threshold: req.min_savings_threshold, rules: req.category_rules ?? null,
        favorites: favHere,
      }));
    }
    if (req.items.some((i) => i.product_id.startsWith('custom:'))) {
      const cp = await customPrices();
      for (const r of result.ranked) priceCustom(r.receipt, r.store_id, cp);
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
    let saved = await saveObserved(body.lines as ObservedLine[], body.store_id, date, branch);
    // #26: righe dei prodotti scritti a mano: il prezzo vero resta per la prossima volta
    for (const l of body.lines as any[]) {
      if (!l.product_id?.startsWith('custom:') || l.kind === 'variante') continue;
      const q = l.weight_kg ?? l.quantity ?? 1;
      if (await saveCustomPrice(body.store_id, l.product_id, l.text, l.weight_kg ? 'kg' : null, l.net_price / (q || 1)).catch(() => false)) saved += 1;
    }
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
    const [book, cp] = await Promise.all([priceBook(), customPrices()]);
    const seen = new Set<string>();
    const items: any[] = [];
    const stops = body.stops && body.stops.length > 1 ? body.stops : null;
    for (const it of body.items) {
      if (seen.has(it.product_id)) continue;
      seen.add(it.product_id);
      const groups = it.groups?.length ? { groups: it.groups } : {};   // #21: la parte per i gruppi
      if (!stops) { items.push({ ...withCustomPrice(shopItem(book, it, body.store_id), body.store_id, cp), ...groups }); continue; }
      // spesa in più tappe: ogni prodotto col prezzo del negozio dove lo prendi
      const k = Math.min(Math.max(it.stop ?? 0, 0), stops.length - 1);
      items.push({ ...withCustomPrice(shopItem(book, it, stops[k].store_id), stops[k].store_id, cp), stop: k, store_id: stops[k].store_id, ...groups });
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
      guardAct(shop, me, shop.items.find((i: any) => i.key === key));
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
    // #21: un prodotto preso anche per un gruppo risulta preso nel gruppo (gli altri lo vedono subito)
    const it = (row.items as T.ShopItem[]).find((i) => i.key === key);
    if (it?.groups?.length) shopGroupSync(id, false).catch(() => {});
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
    const [book, cp] = await Promise.all([priceBook(), customPrices()]);
    const row = await updateShop(id, (shop) => {
      if (shop.status !== 'active') throw new Error('Questa spesa è già chiusa');
      guardAct(shop, me);
      const existing = shop.items.find((i: any) => i.key === item.product_id);
      if (existing) existing.quantity = pyRound(existing.quantity + item.quantity, 3);
      else if (shop.stops?.length > 1) {
        const k = Math.min(Math.max(item.stop ?? 0, 0), shop.stops.length - 1);
        const sid = shop.stops[k].store_id;
        shop.items.push({ ...withCustomPrice(shopItem(book, item, sid, true), sid, cp), stop: k, store_id: sid, checked: true, checked_at: nowIso(), checked_by: null, checked_by_id: me });
      } else shop.items.push({ ...withCustomPrice(shopItem(book, item, shop.store_id, true), shop.store_id, cp), checked: true, checked_at: nowIso(), checked_by: null, checked_by_id: me });
    });
    return shopOut(row, me);
  },

  shopPrice: async (id: string, body: { user_id: string; key: string; price: number; kind: T.PriceKind; note?: string | null; display_name?: string | null; promo_until?: string | null }): Promise<T.Shop> => {
    const me = await uid();
    const current = await shopRow(id);
    const item = current.items.find((i: any) => i.key === body.key);
    if (!item) throw new Error('Prodotto non trovato');
    guardAct(current, me, item);
    if (!item.product_id.startsWith('custom:')) {
      const kg = item.unit === 'kg';
      await saveObserved([{ product_id: item.product_id, text: item.name, net_price: body.price,
        quantity: kg ? 1 : item.quantity, weight_kg: kg ? item.quantity : null, kind: body.kind,
        promo_until: body.promo_until ?? null, note: body.note ?? null }], item.store_id ?? current.store_id, today(),
        (item.stop != null && current.stops?.[item.stop]?.branch) || current.branch || null);
    } else if (body.kind !== 'variante' && item.quantity > 0) {
      // #26: scritto a mano: il prezzo resta per la prossima volta in questo negozio
      await saveCustomPrice(item.store_id ?? current.store_id, item.product_id, item.name, item.unit, body.price / item.quantity).catch(() => {});
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

  /** "Ti do una mano" (#4): proposte di negozi vicino a te per una parte della spesa in corso di un familiare. */
  shopHelpPlan: async (id: string, lat: number, lon: number, transport: T.Transport, fuelType: T.FuelType): Promise<T.HelpOption[]> => {
    const me = await uid();
    const shop = await shopRow(id);
    if (shop.status !== 'active') throw new Error('Questa spesa è già chiusa');
    if (shop.taken_by?.user_id === me) throw new Error('Questa spesa la stai già facendo tu');
    const book = await priceBook();
    const todo = shop.items.filter((i: any) => !i.checked && !(i.stop != null && shop.stops?.[i.stop]?.by));
    if (!todo.length) throw new Error('Non resta niente da prendere');
    let near;
    try { near = nearestPerChain(await storesAround(lat, lon, kv), lat, lon); } catch { throw new Error('OpenStreetMap non raggiungibile: riprova tra poco'); }
    const [stores, loc] = storesFor(near);
    if (loc.mode !== 'reale') throw new Error('Nessun supermercato vicino a te');
    const [stations, parkings] = await Promise.all([stationsNear(lat, lon).catch(() => [] as FuelStation[]), parkingsAround(lat, lon, kv).catch(() => null)]);
    const fuel = fuelInfo(fuelType || 'benzina', stations, lat, lon);
    if (parkings) withParking(stores.map((st) => (st.branch ? Object.assign(st.branch, { chain: st.id }) : null)), parkings);
    return helpOptions(todo, stores, (sid, pid, q) => shopItem(book, { product_id: pid, quantity: q }, sid).price, { transport, fuel }) as T.HelpOption[];
  },

  /**
   * #15 "Cosa conviene prendere a me": tra i prodotti liberi del gruppo, quelli che costano meno nei negozi vicino a me
   * (rispetto al prezzo tipico in zona). Stesso motore di "Ti do una mano".
   */
  groupHelpPlan: async (items: { id: string; product_id: string; name: string; quantity: number; unit: string; category_id: string | null }[],
    lat: number, lon: number, transport: T.Transport, fuelType: T.FuelType): Promise<T.HelpOption[]> => {
    const book = await priceBook();
    let near;
    try { near = nearestPerChain(await storesAround(lat, lon, kv), lat, lon); } catch { throw new Error('OpenStreetMap non raggiungibile: riprova tra poco'); }
    const [stores, loc] = storesFor(near);
    if (loc.mode !== 'reale') throw new Error('Nessun supermercato vicino a te');
    const priceAt = (sid: string, pid: string, q: number) => shopItem(book, { product_id: pid, quantity: q }, sid).price;
    // prezzo "tipico": mediana dei negozi vicini (così "conviene" vuol dire meno di quanto si spenderebbe di solito)
    const todo = items.filter((i) => !i.product_id.startsWith('custom:')).map((i) => {
      const ps = stores.map((st) => priceAt(st.id, i.product_id, i.quantity)).filter((p): p is number => p != null);
      return { key: i.id, product_id: i.product_id, name: i.name, quantity: i.quantity, unit: i.unit, category_id: i.category_id, price: ps.length ? r2(median(ps)) : null };
    });
    if (!todo.length) throw new Error('Non ci sono prodotti del catalogo liberi da prendere');
    const [stations, parkings] = await Promise.all([stationsNear(lat, lon).catch(() => [] as FuelStation[]), parkingsAround(lat, lon, kv).catch(() => null)]);
    const fuel = fuelInfo(fuelType || 'benzina', stations, lat, lon);
    if (parkings) withParking(stores.map((st) => (st.branch ? Object.assign(st.branch, { chain: st.id }) : null)), parkings);
    return helpOptions(todo, stores, priceAt, { transport, fuel }) as T.HelpOption[];
  },

  /** prendo io questi prodotti da quel negozio: diventano una tappa mia, spariscono dalla lista di chi fa la spesa */
  shopHelpTake: async (id: string, opt: { store_id: string; store_name: string; branch?: any }, keys: string[], display_name?: string | null): Promise<T.Shop> => {
    const me = await uid();
    const name = display_name || (await myProfile().catch(() => null as any))?.display_name || null;
    const book = await priceBook();
    const row = await updateShop(id, (shop) => {
      if (shop.status !== 'active') throw new Error('Questa spesa è già chiusa');
      if (!shop.taken_by || shop.taken_by.user_id === me) throw new Error('Puoi dare una mano a una spesa che sta facendo un altro');
      if (shop.stops?.some((st: any) => st.by?.user_id === me)) throw new Error('Hai già una parte di questa spesa');
      if (!shop.stops?.length) {
        shop.stops = [{ store_id: shop.store_id, store_name: shop.store_name, branch: shop.branch ?? null, lat: null, lon: null }];
      }
      const k = shop.stops.length;
      const b = opt.branch;
      shop.stops.push({ store_id: opt.store_id, store_name: opt.store_name,
        branch: b ? [b.name, b.address].filter(Boolean).join(' · ') : null, lat: b?.lat ?? null, lon: b?.lon ?? null,
        parking: b?.parking ?? null, by: { user_id: me, name, at: nowIso() } });
      let moved = 0;
      for (const it of shop.items) {
        if (!keys.includes(it.key) || it.checked) continue;
        const from = it.stop ?? 0;
        if (shop.stops[from]?.by) continue;  // già di qualcun altro
        it.helped_from = { stop: from, store_id: it.store_id ?? shop.store_id, price: it.price };
        it.stop = k;
        it.store_id = opt.store_id;
        it.price = shopItem(book, it, opt.store_id).price;
        moved++;
      }
      if (!moved) throw new Error('Questi prodotti li ha già presi qualcuno');
    });
    return shopOut(row, me);
  },

  /** lascio la mia parte: quello che non ho ancora preso torna a chi fa la spesa */
  shopHelpRelease: async (id: string): Promise<T.Shop> => {
    const me = await uid();
    const row = await updateShop(id, (shop) => {
      const k = shop.stops?.findIndex((st: any) => st.by?.user_id === me) ?? -1;
      if (k < 0) return;
      let kept = 0;
      for (const it of shop.items) {
        if ((it.stop ?? 0) !== k) continue;
        if (it.checked) { kept++; continue; }
        const f = it.helped_from || { stop: 0, store_id: shop.store_id, price: it.price };
        Object.assign(it, { stop: f.stop, store_id: f.store_id, price: f.price });
        delete it.helped_from;
      }
      if (kept) shop.stops[k].released = true;  // quello che ho già preso resta registrato
      else {
        shop.stops.splice(k, 1);
        for (const it of shop.items) if ((it.stop ?? 0) > k) it.stop -= 1;
      }
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
    const group_receipts = items.some((i) => i.groups?.length) ? await shopGroupSync(id, true).catch(() => []) : [];
    return { missing: items.filter((i) => !i.checked), saving_id: shop.saving_id ?? null, store_name: shop.store_name as string,
      cart: r2(items.filter((i) => i.checked).reduce((s, i) => s + (i.price || 0), 0)), group_receipts };
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
    // il codice famiglia fisso non vale più (#13): si entra solo con un invito
    const r = check(await sb().rpc('join_with_invite', { c: code, p_name: display_name || null })) as T.JoinResult;
    if (r.status === 'invalid') throw new Error(r.reason || 'Invito non valido');
    if (r.status === 'pending') throw new Error('Richiesta inviata: aspetta che un familiare ti accetti');
    if (r.group_id) await moveMyThings(r.group_id);
    return (await familyOut()) as T.Family;
  },

  familyLeave: async (_user_id: string) => {
    await moveMyThings(null);
    check(await sb().rpc('leave_family'));
    return { ok: true };
  },

  familyByUser: async (_userId: string) => familyOut(),

  // ------------------------------------------------ inviti e approvazioni (#13)
  inviteCreate: async (group: string) => {
    const r = check(await sb().rpc('create_invite', { g: group })) as any;
    return { code: r.code as string, expires_at: r.expires_at as string };
  },
  invitesOpen: async (group: string) => (check(await sb().rpc('group_open_invites', { g: group })) ?? []) as T.OpenInvite[],
  inviteRevoke: async (code: string) => { check(await sb().rpc('revoke_invite', { c: code })); },
  invitePreview: async (code: string) => check(await sb().rpc('invite_preview', { c: code })) as T.InvitePreview,
  inviteJoin: async (code: string, name?: string) => {
    const r = check(await sb().rpc('join_with_invite', { c: code, p_name: name?.trim() || null })) as T.JoinResult;
    if (r.status === 'joined' && r.kind === 'famiglia' && r.group_id) await moveMyThings(r.group_id).catch(() => {});
    return r;
  },
  inviteRejoin: async (code: string, old: string) => check(await sb().rpc('rejoin_as', { c: code, old })) as T.JoinResult,
  joinRequests: async (group: string) => (check(await sb().rpc('group_pending_requests', { g: group })) ?? []) as T.JoinRequest[],
  joinDecide: async (group: string, user: string, accept: boolean) => {
    check(await sb().rpc('decide_join_request', { g: group, u: user, accept }));
  },
  myJoinRequest: async () => {
    const rows = check(await sb().rpc('my_join_request')) as T.MyJoinRequest[] | null;
    return rows?.[0] ?? null;
  },
  memberRemove: async (group: string, user: string) => { check(await sb().rpc('remove_member', { g: group, u: user })); },

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
