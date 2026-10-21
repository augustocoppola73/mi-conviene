/**
 * Versione online dell'app: stessa interfaccia di `api` (src/api.ts), ma il calcolo gira nel telefono
 * (src/engine) e i dati stanno su Supabase. Nessun server nostro.
 * #89: divisa per parti: prices (listino), data (letture comuni), shop (spesa in corso), savings (Salvadanaio), family (famiglia e inviti).
 */
import type * as T from '../api';
import { splitPlan } from '../engine/split';
import { fuelInfo, FuelStation, lastSimilarShop, optimizeList } from '../engine/core';
import { classify } from '../engine/classify';
import { C, CATEGORIES, PRODUCT_INDEX, PRODUCTS, STORE_INDEX, STORES } from '../engine/data';
import { aisleOrder, menuPlan, planRecipe, proposeMenu, rankByPrice, Recipe, recipeSummaryPriced, suggest } from '../engine/kitchen';
import { flyers, fuelNearby, geocode, NEAR_ME_MAX_KM, nearestPerChain, parkingFor, parkingsAround, RADIUS_M, storesAround, storesFor, supermarketsAround } from '../engine/places';
import { search } from '../engine/recipes';
import { haversineKm, median, pyRound } from '../engine/util';
import { homeRank, isQuick, isRegion, REGIONS } from '../recipeTaste';
import { check, IS_CLOUD, sb, uid } from './client';
import { BUDGET_HISTORY_LIMIT, COLLECTION, DISTANCE_LIMIT_KM, HABITUAL_SAME_STORE_KM, LICENSE, nowIso } from './common';
import { communityProducts, customPrices, fuelObservedAt, kv, priceBook, priceCustom, resetCommunityCache, stationsNear, withParking } from './prices';
import { cleanLines, findRecipe, historyRows, myRecipes } from './data';
import { shopApi } from './shop';
import { savingsApi } from './savings';
import { familyApi } from './family';

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

  /** #24: ordine dei reparti imparato in quel negozio (mio o della famiglia); null se non c'è ancora */
  aisleOrderFor: async (storeId: string): Promise<{ order: string[]; learned: number } | null> => {
    const me = await uid();
    const fam = (check(await sb().from('profiles').select('family_id').eq('id', me).maybeSingle()) as any)?.family_id ?? null;
    const { data } = await sb().from('aisles').select('ranks').eq('owner_id', fam || me).eq('store_id', storeId).maybeSingle();
    const ranks = (data?.ranks ?? null) as Record<string, { avg: number; n: number }> | null;
    const learned = ranks ? Object.values(ranks).filter((r) => r.n >= 1).length : 0;
    return learned >= 2 ? { order: aisleOrder(ranks), learned } : null;
  },

  /** #27: prodotti scritti a mano da tutti (cercabili come gli altri) */
  communityProducts: async (fresh = false): Promise<T.CommunityProduct[]> => { if (fresh) resetCommunityCache(); return communityProducts(); },
  /** #27: un prodotto scritto a mano entra nel catalogo di tutti (nome e reparto) */
  rememberCustom: async (key: string, name: string, categoryId: string | null, unit: string | null): Promise<void> => {
    await sb().rpc('register_custom_product', { p_key: key, p_name: name, p_category: categoryId, p_unit: unit });
    resetCommunityCache();
  },

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

  recipes: async (q: string, _user_id?: string | null, sort: T.RecipeSort = 'rilevanza', region?: string | null) => {
    const limit = 40;
    const mine = await myRecipes();
    let found: Recipe[];
    const book = await priceBook();
    if (sort === 'prezzo') {
      const pool = q ? [...search(mine, q, 10000), ...search(COLLECTION, q, 10000)] : [...mine, ...COLLECTION];
      found = rankByPrice(book, pool, true, limit);
    } else if (sort === 'veloci' || sort === 'regione') {
      const keep = sort === 'veloci' ? isQuick : isRegion(region || 'Toscana');
      found = [...search(mine, q, limit), ...search(COLLECTION.filter(keep), q, 10000)].slice(0, limit);
    } else if (!q) {
      // #100: senza ricerca prima i piatti di casa di tutti i giorni con il prezzo, poi il resto, la cucina straniera in fondo
      const priced = COLLECTION.map((r) => ({ r, s: recipeSummaryPriced(book, r) }));
      const pr = (x: (typeof priced)[number]) => (x.s.cheapest && x.s.cheapest.portion > 0 && x.s.cheapest.portion < 15 ? (x.s.cheapest.complete ? 0 : 1) : 2);   // oltre 15 € a persona di solito è un ingrediente letto male
      priced.sort((a, b) => homeRank(a.r) - homeRank(b.r) || pr(a) - pr(b) || (a.r.name < b.r.name ? -1 : a.r.name > b.r.name ? 1 : 0));
      return { recipes: [...mine.map((r) => recipeSummaryPriced(book, r)), ...priced.map((x) => x.s)].slice(0, limit) as T.RecipeSummary[],
        total_collection: COLLECTION.length, license: LICENSE };
    } else {
      found = [...search(mine, q, limit), ...search(COLLECTION, q, limit)].slice(0, limit);
    }
    return { recipes: found.map((r) => recipeSummaryPriced(book, r)) as T.RecipeSummary[], total_collection: COLLECTION.length, license: LICENSE };
  },

  /** quante ricette ha ogni regione nella raccolta */
  recipeRegions: async (): Promise<{ region: string; count: number }[]> =>
    REGIONS.map((r) => ({ region: r as string, count: COLLECTION.filter(isRegion(r)).length })),

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

  ...savingsApi,
  ...shopApi,
  ...familyApi,
};

// solo per le prove automatiche (build con EXPO_PUBLIC_E2E=1)
if (IS_CLOUD && process.env.EXPO_PUBLIC_E2E === '1') (globalThis as any).__mc = cloudApi;
