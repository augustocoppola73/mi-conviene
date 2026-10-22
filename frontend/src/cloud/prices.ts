/** Prezzi: listino (Open Prices + prezzi visti), prezzi dei prodotti scritti a mano, prodotti della comunità, carburanti. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type * as T from '../api';
import { buildPriceBook, FuelStation, PriceBook, RealPrice, UserPrice } from '../engine/core';
import { observedRows, ObservedLine } from '../engine/observed';
import { KV, OsmParking, parkingFor } from '../engine/places';
import { check, sb } from './client';
import { r2, today } from './common';

export const kv: KV = {
  get: (k) => AsyncStorage.getItem(k),
  set: (k, v) => AsyncStorage.setItem(k, v),
};

/** Supabase restituisce al massimo 1000 righe per volta: si leggono a pagine. */
export async function fetchAll<R>(page: (from: number, to: number) => PromiseLike<{ data: R[] | null; error: any }>, max = 30000): Promise<R[]> {
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
export let bookCache: { at: number; book: PriceBook } | null = null;
export let bookLoading: Promise<PriceBook> | null = null;

/**
 * #84: il listino non si scarica più tutto a ogni avvio. Resta sul telefono (AsyncStorage) e:
 * - i prezzi Open Prices (aggiornati di notte) si riscaricano solo se è cambiata la loro «firma» (righe + ultimo aggiornamento);
 * - dei prezzi visti dagli utenti arrivano solo quelli nuovi (dopo l'ultimo che ho), tenendo i 3 più recenti per prezzo.
 */
export const BOOK_KEY = 'mc_pricebook_v1';
/** #104: segno sul luogo dei prezzi visti da me o dalla famiglia (lo legge priceInfo.ts) */
export const OURS_MARK = 'visto da ';
export const SEEN_COLS = 'store_id,product_id,kind,ref_price,paid,receipt_text,note,location_name,date,promo_until,created_at';
type BookStore = { ppSig: string; open: any[]; seen: any[]; seenMax: string | null };
export let bookStore: BookStore | null = null;

export function trimSeen(rows: any[]): any[] {
  const limit = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
  const by = new Map<string, any[]>();
  for (const r of rows) {
    if ((r.date ?? '') < limit) continue;
    const k = `${r.store_id}|${r.product_id}|${r.kind}`;
    const l = by.get(k) ?? []; l.push(r); by.set(k, l);
  }
  const out: any[] = [];
  for (const l of by.values()) out.push(...l.sort((x, y) => (x.created_at < y.created_at ? 1 : -1)).slice(0, 3));
  return out.sort((x, y) => (x.created_at < y.created_at ? -1 : 1));
}

export async function loadBookStore(): Promise<BookStore> {
  if (!bookStore) {
    try { const raw = await AsyncStorage.getItem(BOOK_KEY); bookStore = raw ? JSON.parse(raw) : null; } catch { bookStore = null; }
  }
  const st: BookStore = bookStore ?? { ppSig: '', open: [], seen: [], seenMax: null };
  const { data: sig } = await sb().rpc('price_book_sig');
  const [open, fresh] = await Promise.all([
    sig && sig === st.ppSig ? Promise.resolve(st.open) : fetchAll<any>((a, b) => sb().from('product_prices').select('*').range(a, b)),
    st.seenMax
      ? fetchAll<any>((a, b) => sb().from('user_prices').select(SEEN_COLS).gt('created_at', st.seenMax!).order('created_at').range(a, b))
      : fetchAll<any>((a, b) => sb().from('user_prices').select(SEEN_COLS)
          .gte('date', new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10))
          .order('created_at', { ascending: false }).range(a, b)),
  ]);
  const seen = trimSeen([...st.seen, ...fresh]);
  const seenMax = seen.reduce((m: string | null, r: any) => (!m || r.created_at > m ? r.created_at : m), st.seenMax);
  bookStore = { ppSig: (sig as string) ?? '', open, seen, seenMax };
  AsyncStorage.setItem(BOOK_KEY, JSON.stringify(bookStore)).catch(() => {});
  return bookStore;
}

export async function priceBook(): Promise<PriceBook> {
  if (bookCache && Date.now() - bookCache.at < 10 * 60 * 1000) return bookCache.book;
  if (bookLoading) return bookLoading;
  bookLoading = (async () => {
    const { open, seen } = await loadBookStore();
    const openPrices: Record<string, RealPrice> = {};
    for (const p of open) {
      openPrices[`${p.store_id}|${p.product_id}`] = {
        normal_price: Number(p.normal_price), promo_price: p.promo_price == null ? null : Number(p.promo_price),
        source: p.source, confidence: p.confidence || 'yellow', observed_at: p.observed_at, location_name: p.location_name,
        sample_product: p.sample_product, proof_url: p.proof_url,
      };
    }
    // #104: dove io o la mia famiglia abbiamo visto il prezzo, vale il nostro (quello del nostro negozio), non quello degli altri
    // (solo se recente: un nostro prezzo di 6 mesi fa non copre quello visto ieri da un altro)
    const fresh = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
    const ours = (((await sb().rpc('family_prices')).data ?? []) as any[]).filter((d) => d.date >= fresh);
    const ourKeys = new Set(ours.map((d) => `${d.store_id}|${d.product_id}|${d.kind}`));
    const rows = [
      ...seen.filter((d) => !ourKeys.has(`${d.store_id}|${d.product_id}|${d.kind}`)),
      ...ours.map((d) => ({ ...d, location_name: `${OURS_MARK}${d.mine ? 'te' : 'voi'}${d.location_name ? ` · ${d.location_name}` : ''}` })),
    ];
    const userPrices: UserPrice[] = rows.map((d) => ({ ...d, ref_price: Number(d.ref_price), paid: d.paid == null ? null : Number(d.paid) }));
    const book = buildPriceBook(openPrices, userPrices, today());
    bookCache = { at: Date.now(), book };
    return book;
  })();
  try { return await bookLoading; } finally { bookLoading = null; }
}

export async function saveObserved(lines: ObservedLine[], storeId: string, date: string, location: string | null): Promise<number> {
  const { rows, saved } = observedRows(lines, storeId, date, location);
  if (!rows.length) return 0;
  // il database scarta in silenzio i prezzi fuori scala: conto quelli entrati davvero (#45)
  const got = (check(await sb().from('user_prices').insert(rows).select('product_id')) as { product_id: string }[] | null) ?? [];
  bookCache = null; // i prezzi nuovi valgono subito
  return new Set(got.map((x) => x.product_id)).size;
}

// ------------------------------------------------------------------ prezzi dei prodotti scritti a mano (#26)
// Della famiglia (o della persona): "idropulsore da Lidl 49,99 €, visto il 10/10". Prezzo per unità (pz o kg).
type CustomPrice = { unit_price: number; seen_on: string; mine: boolean };
export let customCache: { at: number; map: Map<string, CustomPrice> } | null = null;
export async function customPrices(): Promise<Map<string, CustomPrice>> {
  if (customCache && Date.now() - customCache.at < 10 * 60 * 1000) return customCache.map;
  const map = new Map<string, CustomPrice>();
  try {
    // #27: i prezzi li vedono tutti (l'ultimo per negozio); "mine" = visto da me o dalla mia famiglia
    const { data } = await sb().rpc('custom_prices_all');
    for (const r of (data ?? []) as any[]) map.set(`${r.store_id}|${r.key}`, { unit_price: Number(r.unit_price), seen_on: r.seen_on, mine: !!r.mine });
  } catch { /* senza rete: niente prezzi a mano */ }
  customCache = { at: Date.now(), map };
  return map;
}
export async function saveCustomPrice(storeId: string, key: string, name: string | null, unit: string | null, unitPrice: number) {
  if (!key.startsWith('custom:') || !(unitPrice > 0)) return false;
  check(await sb().rpc('save_custom_price', { p_store: storeId, p_key: key, p_name: name ?? key.slice(7), p_unit: unit ?? 'pz', p_unit_price: r2(unitPrice) }));
  customCache = null;
  return true;
}
/** scontrino calcolato: i prodotti scritti a mano col prezzo che conosco in quel negozio (fuori dal confronto tra negozi) */
export function priceCustom(receipt: any, storeId: string, cp: Map<string, CustomPrice>) {
  let tot = 0;
  for (const c of receipt.custom_items ?? []) {
    const k = cp.get(`${storeId}|${c.product_id}`);
    c.price = k ? r2(k.unit_price * c.quantity) : null;
    c.seen_on = k?.seen_on ?? null;
    c.seen_mine = k ? k.mine : null;
    if (c.price != null) tot += c.price;
  }
  receipt.custom_total = r2(tot);
}
/**
 * #26: i prezzi veri dei prodotti scritti a mano entrano nel previsto della spesa. Non erano stimati (l'app non li conosceva):
 * senza questo il pagato sembra più alto del previsto e il risparmio verificato scende per niente.
 */
export function foldCustomPrices(data: any, lines: any[]) {
  const rc = data.snapshot?.receipt;
  if (!rc) return;
  let delta = 0;
  for (const l of lines) {
    if (!l.product_id?.startsWith('custom:') || !(l.net_price > 0) || l.kind === 'variante') continue;
    const price = r2(l.net_price);
    const k = (rc.custom_items ?? []).findIndex((c: any) => c.product_id === l.product_id);
    if (k >= 0) {
      const c = rc.custom_items[k];
      rc.custom_items.splice(k, 1);
      rc.lines.push({ product_id: c.product_id, name: c.name, quantity: c.quantity, unit: c.unit, unit_price: r2(price / (c.quantity || 1)),
        normal_price: price, line_price: price, in_promo: false, loyalty_required: false, confidence: 'green', source: 'scontrino',
        observed_at: today(), location_name: 'scontrino vero', sample_product: null, proof_url: null, custom: true });
      delta += price;
      continue;
    }
    const line = rc.lines.find((x: any) => x.product_id === l.product_id && x.custom);
    if (line && line.line_price !== price) {
      delta += price - line.line_price;
      Object.assign(line, { line_price: price, normal_price: price, unit_price: r2(price / (line.quantity || 1)) });
    }
  }
  if (!delta) return;
  rc.total = r2(rc.total + delta);
  rc.normal_total = r2((rc.normal_total ?? 0) + delta);
  if (data.snapshot.total_cost != null) data.snapshot.total_cost = r2(data.snapshot.total_cost + delta);
  if (data.snapshot.effective_cost != null) data.snapshot.effective_cost = r2(data.snapshot.effective_cost + delta);
  if (data.estimated_spend != null) data.estimated_spend = r2(data.estimated_spend + delta);
  if (data.estimated_total != null) data.estimated_total = r2(data.estimated_total + delta);
}

/** prezzo iniziale nella spesa in corso di un prodotto scritto a mano */
export function withCustomPrice(item: any, storeId: string, cp: Map<string, CustomPrice>) {
  if (!item.product_id?.startsWith('custom:') || item.price != null) return item;
  const k = cp.get(`${storeId}|${item.product_id}`);
  return k ? { ...item, price: r2(k.unit_price * item.quantity), price_seen_on: k.seen_on } : item;
}

// ------------------------------------------------------------------ prodotti della comunità (#27)
export let communityCache: { at: number; list: T.CommunityProduct[] } | null = null;
export async function communityProducts(): Promise<T.CommunityProduct[]> {
  if (communityCache && Date.now() - communityCache.at < 10 * 60 * 1000) return communityCache.list;
  const { data, error } = await sb().from('community_products').select('key,name,category_id,unit,uses').order('uses', { ascending: false }).limit(2000);
  if (error) return communityCache?.list ?? [];
  communityCache = { at: Date.now(), list: (data ?? []) as T.CommunityProduct[] };
  return communityCache.list;
}

// ------------------------------------------------------------------ carburante (cache di un'ora per zona)
export let fuelDate: { at: number; date: string | null } | null = null;
export const stationCache = new Map<string, { at: number; stations: FuelStation[] }>();

export async function fuelObservedAt(): Promise<string | null> {
  if (fuelDate && Date.now() - fuelDate.at < 3600 * 1000) return fuelDate.date;
  const { data } = await sb().from('meta').select('value').eq('key', 'prices_status').maybeSingle();
  fuelDate = { at: Date.now(), date: (data?.value as any)?.fuel_date ?? null };
  return fuelDate.date;
}

/** Aggiunge il parcheggio (dati OSM) a ogni punto vendita che ha catena e coordinate. */
export function withParking(branches: any[], parkings: OsmParking[]) {
  for (const b of branches) {
    if (!b || b.lat == null) continue;
    if (b.chain) b.parking = parkingFor({ lat: b.lat, lon: b.lon, chain: b.chain, name: b.name }, parkings);
  }
}

export async function stationsNear(lat: number, lon: number, boxKm = 15): Promise<FuelStation[]> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${boxKm}`;
  const hit = stationCache.get(key);
  if (hit && Date.now() - hit.at < 3600 * 1000) return hit.stations;
  const stations = check(await sb().rpc('fuel_near', { p_lat: lat, p_lon: lon, p_km: boxKm })) as FuelStation[];
  stationCache.set(key, { at: Date.now(), stations });
  return stations;
}


/** dopo un prezzo segnato o un prodotto nuovo: si rilegge subito */
export function resetBookCache() { bookCache = null; }
export function resetCommunityCache() { communityCache = null; }
