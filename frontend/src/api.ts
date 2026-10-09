import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { cloudApi } from './cloud/api';
import { IS_CLOUD } from './cloud/client';

// URL del backend: EXPO_PUBLIC_BACKEND_URL se impostato, altrimenti lo stesso
// host del dev server Expo (così funziona anche da telefono in rete locale).
function resolveBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_BACKEND_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const hostUri = Constants.expoConfig?.hostUri; // es. "192.168.1.10:8081"
  if (hostUri && Platform.OS !== 'web') return `http://${hostUri.split(':')[0]}:8001`;
  // Web app servita dal backend (http://localhost:8001): stessa origine.
  // Durante lo sviluppo con `expo start` (porta 8081) il backend resta sulla 8001.
  const loc = typeof window !== 'undefined' ? window.location : undefined;
  if (Platform.OS === 'web' && loc && loc.port !== '8081') return loc.origin;
  return 'http://localhost:8001';
}

export const BASE_URL = resolveBaseUrl();

export type Transport = 'walk' | 'bike' | 'car' | 'transit';
export type Confidence = 'green' | 'yellow' | 'red';
export type PriceSource = 'stima' | 'openprices';
export type FuelType = 'benzina' | 'gasolio' | 'gpl' | 'metano';

export interface Category { id: string; name: string; emoji: string }
export interface Product { id: string; name: string; category_id: string; default_qty: number; unit: string }
export interface Store { id: string; name: string; lat: number; lng: number; distance_km: number }
export interface Bootstrap { categories: Category[]; products: Product[]; stores: Store[] }

export interface ListItem {
  product_id: string; quantity: number;
  /** solo per i prodotti scritti a mano (product_id "custom:...") */
  name?: string; category_id?: string; unit?: string;
}
export interface ClassifyResult {
  text: string; category_id: string; category_name: string; emoji: string; confidence: number;
  similar: { product_id: string; name: string; category_id: string; score: number }[];
  exact: { product_id: string; name: string; category_id: string; score: number } | null;
}
export type PriceKind = 'normale' | 'offerta' | 'variante';
export interface VariantHint { price: number; ref_price: number; text: string | null; observed_at: string; note?: string | null }
export interface ScannedLine {
  text: string; price: number; discount: number; net_price: number; quantity: number; weight_kg: number | null;
  product_id: string | null; product_name: string | null; match_score: number; expected: boolean;
  calculated_price: number | null; ref_price: number | null;
}
export interface ScanResult {
  store_id: string | null; date: string | null; total: number | null; lines: ScannedLine[]; lines_sum: number;
  total_matches: boolean; missing_expected: string[]; rows: string[];
  photos?: number; overlaps?: number[]; missing_amount?: number;
}
export interface CustomLine { product_id: string; name: string; quantity: number; unit: string; category_id: string | null }

export interface ReceiptLine {
  product_id: string; name: string; quantity: number; unit: string;
  unit_price: number; normal_price: number; line_price: number;
  in_promo: boolean; loyalty_required: boolean; confidence: Confidence;
  source: PriceSource; observed_at: string | null; location_name: string | null;
  sample_product: string | null; proof_url: string | null;
  promo_until?: string | null; variant?: VariantHint | null;
}
export interface Receipt {
  lines: ReceiptLine[]; unknown_products: string[]; real_lines: number; custom_items: CustomLine[];
  total: number; normal_total: number; savings_vs_normal: number;
}
export interface Travel { distance_km: number; time_min: number; fuel_cost: number; time_cost: number }
export interface FuelStation {
  id: string; brand: string; name: string; address: string; city: string; lat: number; lon: number;
  price: number; price_servito: number | null; distance_km: number; updated: string | null;
  trip_cost: number; fill_cost: number; effective_cost: number; saving_vs_median: number | null; maps_url: string;
}
export interface FuelNearby {
  fuel: FuelType; median: number | null; liters: number; observed_at: string | null;
  best: FuelStation | null; stations: FuelStation[];
}
export interface Flyer {
  store_id: string; store_name: string; url: string; store_page: boolean;
  branch_name: string | null; address: string | null; distance_km: number | null; nearest_km: number | null;
}
export interface Parking { kind: 'clienti' | 'pubblico' | 'nessuno'; capacity: number | null; fee: boolean | null; covered: boolean }
export interface Branch {
  name: string; address: string | null; lat: number; lon: number; osm_id: string; opening_hours: string | null;
  /** dai dati di OpenStreetMap (solo versione online); assente = non verificato */
  parking?: Parking | null;
}
export interface NearbyStore extends Branch { chain: string; distance_km: number; website?: string | null }
/** "Vicino a me": tutti i punti vendita delle catene e i distributori intorno a un punto */
export interface NearMe {
  radius_km: number;
  stores: NearbyStore[];
  stations: { id: string; brand: string; name: string; address: string; city: string; lat: number; lon: number;
    price: number | null; distance_km: number }[];
  fuel: FuelType;
  /** OpenStreetMap non ha risposto per i parcheggi: l'app riprova dopo un po' */
  parking_missing?: boolean;
}
export interface LocationInfo {
  mode: 'reale' | 'esempio'; missing_chains: string[]; radius_km?: number; error?: string; habitual_missing?: string;
  /** sei lontano dal tuo punto vendita abituale: qui la stessa catena è un altro negozio */
  habitual_far?: string;
}
export interface FuelStop {
  station_id: string; brand: string; address: string; city: string; lat: number; lon: number; price: number;
  detour_km: number; detour_min: number; detour_cost: number; liters: number; median: number;
  fill_cost: number; saving: number; maps_url: string; updated?: string | null;
  /** altri distributori sulla strada, con quanto costerebbero in più */
  alternatives?: { brand: string; address: string; city: string; price: number; detour_km: number; maps_url: string; updated?: string | null; extra_cost: number }[];
}
export interface RankedStore {
  store_id: string; store_name: string; confidence: Confidence; branch: Branch | null;
  fuel_stop: FuelStop | null; effective_cost: number;
  receipt: Receipt; travel: Travel; total_cost: number; score: number;
}
export interface BudgetStatus {
  budget: number; spend: number; diff: number; status: 'ok' | 'over';
  alternative: { store_id: string; store_name: string; total_cost: number } | null;
}
export type PriceBasis = 'reale' | 'misto' | 'stima';
export interface Savings {
  amount: number; reference_cost: number; price_basis: PriceBasis; promo_savings: number; fuel_saving: number;
  reference: { type: 'habitual' | 'median'; label: string; store_id: string | null };
}
export interface OptimizeResult {
  ranked: RankedStore[]; recommended: RankedStore; reasoning: string;
  budget_status: BudgetStatus | null; savings: Savings; last_similar: LastSimilar | null;
  location: LocationInfo;
  fuel: FuelInfo; price_coverage: { real_lines: number; total_lines: number };
}
export interface FuelInfo {
  fuel_type: FuelType; price_per_liter: number; source: 'mimit' | 'stima';
  observed_at: string | null; stations: number;
}
export interface OptimizeRequest {
  user_id: string; items: ListItem[]; budget?: number | null; transport: Transport;
  habitual_store_id?: string | null; min_savings_threshold: number; fuel_type?: FuelType;
  /** dov'è il punto vendita abituale: se il negozio di quella catena qui vicino è un altro, non vale come abituale */
  habitual_branch?: { lat: number; lon: number; name?: string | null } | null;
  lat?: number; lon?: number; refuel?: boolean; refuel_liters?: number | null;
}

export interface Offer {
  store_id: string; store_name: string; product_id: string; product_name: string;
  normal_price: number; promo_price: number; discount_pct: number; loyalty_required: boolean;
  source: PriceSource; observed_at: string | null;
}
export interface SavingEntry {
  id: string; user_id: string; store_id: string; store_name: string;
  amount: number; verified: boolean; note?: string | null; created_at: string;
  verified_amount: number | null; paid: number | null;
  estimated_spend: number | null; estimated_total: number | null; history_id: string | null;
  price_basis?: PriceBasis | null; reference_type?: 'habitual' | 'median' | null;
  fuel_saving?: number; fuel_liters?: number | null; fuel_median?: number | null; fuel_detour_cost?: number | null;
  fuel_station?: string | null; verified_fuel?: number | null; refueled?: boolean | null; fuel_price_paid?: number | null;
  snapshot?: RankedStore | null;
  /** salvadanaio di famiglia: è tua? altrimenti chi l'ha fatta */
  mine?: boolean; by?: string | null;
  /** a fine spesa: cosa è cambiato rispetto alla lista */
  added_in_store?: string[]; not_bought?: string[]; planned_spend?: number | null;
  real_receipt?: { store_id: string; date: string; total: number; lines: { product_id: string | null; text: string; net_price: number }[] } | null;
}
export interface SavingsSummary {
  entries: SavingEntry[]; total: number; total_estimated: number; total_verified: number; to_verify: number;
}
export interface LastSimilar {
  store_id: string; store_name: string; date: string; total_cost: number | null; similarity: number;
  same_as_recommended?: boolean;
}
export interface BudgetSuggestion {
  last_similar: LastSimilar | null;
  suggested: number | null; typical?: number; margin_pct?: number; based_on?: number; basis?: string; reason: string;
}
export interface HabitualItem { product_id: string; name: string; count: number; quantity: number }
export interface RecipeSummary {
  id: string; name: string; servings: number | null; source: string; url: string | null; categories?: string[] | null;
  user_id?: string; n_ingredients: number; mine: boolean; cheapest?: Cheapest | null;
}
export interface Recipe {
  id?: string; user_id?: string; name: string; servings: number | null; ingredients: string[]; notes?: string | null;
  url?: string | null; source?: string | null; categories?: string[]; image?: string | null;
}
export interface PlanRow {
  text: string; name: string; amount: number | null; kind: string | null; product_id: string | null;
  measure?: { count: number | null; one: string; many: string } | null;
  from?: string | null;  // "succo di limone" -> si comprano i limoni
  product_name: string | null; unit: string; quantity: number; approx: boolean; pantry: boolean; category_id?: string;
}
export interface RecipePlan { servings: number; recipe_servings: number; assumed_servings: boolean; items: PlanRow[]; costs: StoreCost[]; cheapest: Cheapest | null }
export interface RecipeIn { user_id: string; name: string; servings: number | null; ingredients: string[]; notes?: string | null; url?: string | null; source?: string | null }
export interface Cheapest { store_id: string; store_name: string; portion: number; complete: boolean }
export interface StoreCost { store_id: string; store_name: string; total: number }
export interface SuggestRecipe extends RecipeSummary {
  uses: string[]; coverage: number;
  missing?: { product_id: string; name: string; quantity: number; unit: string }[];
  missing_new?: string[]; missing_cost?: number | null; missing_store?: string | null; fits_budget?: boolean;
}
export interface HabitualMissing {
  product_id: string; name: string; quantity: number; unit: string; count: number; occasions: number; cost: number; fits_budget: boolean;
}
export interface Suggestions { ready: SuggestRecipe[]; almost: SuggestRecipe[]; habitual_missing: HabitualMissing[]; remaining: number | null }
export interface MenuEntry { recipe_id: string; name: string; servings: number }
export interface MenuPlan { recipes: string[]; items: (PlanRow & { recipes: string[] })[]; costs: StoreCost[] }
export interface ProposedRecipe extends RecipeSummary { portion: number; cost: number; kind: string }
export interface ShopItem {
  key: string; product_id: string; name: string; quantity: number; unit: string; category_id: string;
  price: number | null; checked: boolean; checked_by: string | null; checked_by_id?: string | null; checked_at: string | null; added_in_store: boolean;
  in_promo?: boolean; promo_until?: string | null; variant?: VariantHint | null; seen?: { price: number; kind: PriceKind; note?: string | null } | null;
}
export interface Shop {
  id: string; user_id: string; display_name?: string | null; store_id: string; store_name: string; branch?: string | null;
  saving_id?: string | null; items: ShopItem[]; status: string; created_at: string; aisles: string[]; mine: boolean;
  /** chi sta facendo la spesa (l'ha presa in carico) */
  taken_by?: {
    user_id: string; name: string | null; at: string; helpers?: { user_id: string; name: string | null }[];
    /** richiesta in attesa di risposta: un familiare vuole prenderla (take) o aiutare (help) */
    request?: { user_id: string; name: string | null; mode: 'take' | 'help'; at: string } | null;
    /** l'ultima richiesta rifiutata: quella persona non può richiedere fino a "until" (niente ping pong) */
    declined?: { user_id: string; until: string } | null;
  } | null;
  progress: { checked: number; total: number; cart: number; estimated: number };
}
/**
 * take = la prendo io (solo se è libera, o se la richiesta è senza risposta da REQUEST_WAIT_MIN) · release = la lascio / smetto di aiutare
 * request / request_help = chiedo a chi la fa di lasciarmela / di aiutarlo · accept / decline = risposta di chi la fa · cancel = ritiro la richiesta
 */
export type TakeMode = 'take' | 'help' | 'release' | 'request' | 'request_help' | 'accept' | 'decline' | 'cancel';
export { REQUEST_WAIT_MIN } from './shopRules';
/** chi può smarcare: nessuno l'ha presa, l'hai presa tu, o aiuti chi la fa */
export function canActOn(shop: Shop, userId: string | null): boolean {
  const t = shop.taken_by;
  return !t || t.user_id === userId || !!t.helpers?.some((h) => h.user_id === userId);
}
export interface ShopItemIn { product_id: string; quantity: number; name?: string | null; category_id?: string | null; unit?: string | null }
export interface FamilyMember { user_id: string; display_name: string; /** riceve le notifiche (solo versione online) */ notifications?: boolean | null }
export interface Family { code: string; created_at: string; members: FamilyMember[] }
export interface FamilyList { code: string; items: ListItem[]; updated_by?: string; updated_at?: string }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = `Errore ${res.status}`;
    try { detail = (await res.json()).detail ?? detail; } catch {}
    throw new Error(typeof detail === 'string' ? detail : `Errore ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const localApi = {
  bootstrap: () => request<Bootstrap>('/bootstrap'),
  optimize: (body: OptimizeRequest) => post<OptimizeResult>('/optimize', body),
  offers: () => request<Offer[]>('/offers'),
  classify: (text: string) => post<ClassifyResult>('/products/classify', { text }),
  fuelNearby: (fuel: FuelType, lat?: number, lon?: number, liters = 40) =>
    request<FuelNearby>(`/fuel/nearby?fuel=${fuel}&liters=${liters}` + (lat != null && lon != null ? `&lat=${lat}&lon=${lon}` : '')),
  flyers: (lat?: number, lon?: number) =>
    request<Flyer[]>(lat != null && lon != null ? `/flyers?lat=${lat}&lon=${lon}` : '/flyers'),
  /** versione locale: il server Python dà solo il più vicino per catena e i distributori migliori */
  nearMe: async (lat: number, lon: number, fuel: FuelType, _radiusKm?: number): Promise<NearMe> => {
    const [st, fu] = await Promise.all([localApi.storesNearby(lat, lon), localApi.fuelNearby(fuel, lat, lon)]);
    return { radius_km: st.radius_km, stores: st.stores, fuel,
      stations: fu.stations.map((s) => ({ id: s.id, brand: s.brand, name: s.name, address: s.address, city: s.city, lat: s.lat, lon: s.lon, price: s.price, distance_km: s.distance_km })) };
  },
  storesNearby: (lat: number, lon: number) =>
    request<{ radius_km: number; stores: NearbyStore[]; missing_chains: string[] }>(`/stores/nearby?lat=${lat}&lon=${lon}`),

  addSaving: (body: {
    user_id: string; store_id: string; amount: number; note?: string;
    reference_type?: 'habitual' | 'median'; price_basis?: PriceBasis;
    history_id?: string; estimated_spend?: number; estimated_total?: number;
    fuel_saving?: number; fuel_liters?: number; fuel_median?: number; fuel_detour_cost?: number; fuel_station?: string;
    snapshot?: RankedStore;
  }) =>
    post<SavingEntry>('/savings', body),
  savings: (userId: string) => request<SavingsSummary>(`/savings/${userId}`),
  deleteSaving: (id: string) => request<{ deleted: number }>(`/savings/${id}`, { method: 'DELETE' }),
  /** una o più foto dello stesso scontrino, dall'alto in basso */
  scanReceipt: (images: string[], saving_id?: string) => post<ScanResult>('/receipts/scan', { images, saving_id }),
  applyReceipt: (body: {
    saving_id?: string; user_id: string; store_id: string; date?: string | null; total?: number | null;
    lines: { product_id: string | null; text: string; net_price: number; quantity: number; weight_kg: number | null;
      kind?: PriceKind; gross_price?: number | null; promo_until?: string | null; note?: string | null }[];
    refueled?: boolean; fuel_price?: number;
  }) => post<{ prices_saved: number; verified?: SavingEntry }>('/receipts/apply', body),
  verifySaving: (id: string, paid: number, refueled?: boolean, fuel_price?: number) =>
    post<SavingEntry>(`/savings/${id}/verify`, { paid, refueled, fuel_price }),
  unverifySaving: (id: string) => post(`/savings/${id}/unverify`, {}),

  addHistory: (body: { user_id: string; items: ListItem[]; store_id?: string; total_cost?: number }) =>
    post<{ id: string }>('/history', body),
  budgetSuggest: (user_id: string, items: ListItem[]) => post<BudgetSuggestion>('/budget/suggest', { user_id, items }),
  habitual: (userId: string) =>
    request<{ items: HabitualItem[]; occasions: number; needed: number; based_on: number }>(`/habitual/${userId}`),

  recipes: (q: string, user_id?: string | null, sort: 'rilevanza' | 'prezzo' = 'rilevanza') =>
    request<{ recipes: RecipeSummary[]; total_collection: number; license: string }>(
      `/recipes?q=${encodeURIComponent(q)}${user_id ? `&user_id=${user_id}` : ''}&sort=${sort}${sort === 'prezzo' ? '&main=true' : ''}`),
  suggest: (body: { user_id?: string | null; items: ListItem[]; store_id?: string; budget?: number | null; spent?: number | null; servings?: number }) =>
    post<Suggestions>('/suggest', body),
  recipeMenu: (user_id: string | null, entries: { recipe_id: string; servings: number }[]) =>
    post<MenuPlan>('/recipes/menu', { user_id, entries }),
  recipePropose: (body: { user_id?: string | null; count: number; servings: number; budget?: number | null; store_id?: string; exclude?: string[]; items?: ListItem[] }) =>
    post<{ recipes: ProposedRecipe[]; total: number; servings: number; budget: number | null }>('/recipes/propose', body),
  recipe: (id: string, user_id?: string | null) => request<Recipe>(`/recipes/${encodeURIComponent(id)}${user_id ? `?user_id=${user_id}` : ''}`),
  recipePlan: (body: { servings: number; recipe_id?: string; user_id?: string | null; ingredients?: string[]; recipe_servings?: number | null }) =>
    post<RecipePlan>('/recipes/plan', body),
  recipeImport: (url: string) => post<Recipe>('/recipes/import', { url }),
  recipeCreate: (body: RecipeIn) => post<Recipe>('/recipes', body),
  recipeUpdate: (id: string, body: RecipeIn) => request<Recipe>(`/recipes/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
  recipeDelete: (id: string, user_id: string) => request<{ ok: boolean }>(`/recipes/${encodeURIComponent(id)}?user_id=${user_id}`, { method: 'DELETE' }),
  geocode: (q: string) => request<{ lat: number; lon: number; label: string }[]>(`/geocode?q=${encodeURIComponent(q)}`),
  shopCreate: (body: { user_id: string; store_id: string; saving_id?: string; branch?: string | null; items: ShopItemIn[]; display_name?: string | null }) =>
    post<Shop>('/shops', body),
  shopActive: (user_id: string) => request<{ shop: Shop | null; others?: number }>(`/shops/active?user_id=${user_id}`),
  shopCheck: (id: string, user_id: string, key: string, checked: boolean, display_name?: string | null) =>
    post<Shop>(`/shops/${id}/check`, { user_id, key, checked, display_name }),
  /** take = la faccio io, help = vi aiuto (smarco anch'io), release = la lascio / smetto di aiutare */
  // versione locale (un solo telefono): niente richieste, chiedere = prendere / aiutare
  shopTake: (id: string, user_id: string, display_name?: string | null, mode: TakeMode = 'take') =>
    post<Shop>(`/shops/${id}/take`, { user_id, display_name,
      mode: mode === 'request' ? 'take' : mode === 'request_help' ? 'help' : mode === 'release' || mode === 'help' ? mode : 'take' }),
  shopAdd: (id: string, user_id: string, item: ShopItemIn) => post<Shop>(`/shops/${id}/add`, { user_id, item }),
  shopPrice: (id: string, body: { user_id: string; key: string; price: number; kind: PriceKind; note?: string | null; display_name?: string | null }) =>
    post<Shop>(`/shops/${id}/price`, body),
  shopFinish: (id: string, user_id: string) =>
    post<{ missing: ShopItem[]; saving_id: string | null; store_name: string; cart: number }>(`/shops/${id}/finish`, { user_id }),
  shopCancel: (id: string, user_id: string) => post<{ items: ShopItem[] }>(`/shops/${id}/cancel`, { user_id }),
  familyCreate: (user_id: string, display_name: string) => post<Family>('/family/create', { user_id, display_name }),
  familyJoin: (user_id: string, display_name: string, code: string) =>
    post<Family>('/family/join', { user_id, display_name, code }),
  familyLeave: (user_id: string) => post('/family/leave', { user_id }),
  familyByUser: (userId: string) => request<Family | Record<string, never>>(`/family/by-user/${userId}`),
  familyPushList: (code: string, user_id: string, items: ListItem[]) =>
    post<FamilyList>('/family/list', { code, user_id, items }),
  familyPullList: (code: string) => request<FamilyList>(`/family/list/${code}`),
};

/** Online (Supabase + calcolo nel telefono) oppure il server locale sul PC. */
export const api: typeof localApi = IS_CLOUD ? (cloudApi as unknown as typeof localApi) : localApi;

// controllo in compilazione: la versione online ha tutte le funzioni, con gli stessi parametri
const _sameShape: { [K in keyof typeof localApi]: (...a: Parameters<(typeof localApi)[K]>) => Promise<unknown> } = cloudApi;
void _sameShape;
