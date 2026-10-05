import Constants from 'expo-constants';
import { Platform } from 'react-native';

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

export interface ListItem { product_id: string; quantity: number }

export interface ReceiptLine {
  product_id: string; name: string; quantity: number; unit: string;
  unit_price: number; normal_price: number; line_price: number;
  in_promo: boolean; loyalty_required: boolean; confidence: Confidence;
  source: PriceSource; observed_at: string | null; location_name: string | null;
  sample_product: string | null; proof_url: string | null;
}
export interface Receipt {
  lines: ReceiptLine[]; unknown_products: string[]; real_lines: number;
  total: number; normal_total: number; savings_vs_normal: number;
}
export interface Travel { distance_km: number; time_min: number; fuel_cost: number; time_cost: number }
export interface Flyer {
  store_id: string; store_name: string; url: string; store_page: boolean;
  branch_name: string | null; address: string | null; distance_km: number | null;
}
export interface Branch {
  name: string; address: string | null; lat: number; lon: number; osm_id: string; opening_hours: string | null;
}
export interface NearbyStore extends Branch { chain: string; distance_km: number }
export interface LocationInfo {
  mode: 'reale' | 'esempio'; missing_chains: string[]; radius_km?: number; error?: string; habitual_missing?: string;
}
export interface RankedStore {
  store_id: string; store_name: string; confidence: Confidence; branch: Branch | null;
  receipt: Receipt; travel: Travel; total_cost: number; score: number;
}
export interface BudgetStatus {
  budget: number; spend: number; diff: number; status: 'ok' | 'over';
  alternative: { store_id: string; store_name: string; total_cost: number } | null;
}
export type PriceBasis = 'reale' | 'misto' | 'stima';
export interface Savings {
  amount: number; reference_cost: number; price_basis: PriceBasis; promo_savings: number;
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
  lat?: number; lon?: number;
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
export interface FamilyMember { user_id: string; display_name: string }
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

export const api = {
  bootstrap: () => request<Bootstrap>('/bootstrap'),
  optimize: (body: OptimizeRequest) => post<OptimizeResult>('/optimize', body),
  offers: () => request<Offer[]>('/offers'),
  flyers: (lat?: number, lon?: number) =>
    request<Flyer[]>(lat != null && lon != null ? `/flyers?lat=${lat}&lon=${lon}` : '/flyers'),
  storesNearby: (lat: number, lon: number) =>
    request<{ radius_km: number; stores: NearbyStore[]; missing_chains: string[] }>(`/stores/nearby?lat=${lat}&lon=${lon}`),

  addSaving: (body: {
    user_id: string; store_id: string; amount: number; note?: string;
    reference_type?: 'habitual' | 'median'; price_basis?: PriceBasis;
    history_id?: string; estimated_spend?: number; estimated_total?: number;
  }) =>
    post<SavingEntry>('/savings', body),
  savings: (userId: string) => request<SavingsSummary>(`/savings/${userId}`),
  deleteSaving: (id: string) => request<{ deleted: number }>(`/savings/${id}`, { method: 'DELETE' }),
  verifySaving: (id: string, paid: number) => post<SavingEntry>(`/savings/${id}/verify`, { paid }),
  unverifySaving: (id: string) => post(`/savings/${id}/unverify`, {}),

  addHistory: (body: { user_id: string; items: ListItem[]; store_id?: string; total_cost?: number }) =>
    post<{ id: string }>('/history', body),
  budgetSuggest: (user_id: string, items: ListItem[]) => post<BudgetSuggestion>('/budget/suggest', { user_id, items }),
  habitual: (userId: string) => request<{ items: HabitualItem[]; based_on: number }>(`/habitual/${userId}`),

  familyCreate: (user_id: string, display_name: string) => post<Family>('/family/create', { user_id, display_name }),
  familyJoin: (user_id: string, display_name: string, code: string) =>
    post<Family>('/family/join', { user_id, display_name, code }),
  familyLeave: (user_id: string) => post('/family/leave', { user_id }),
  familyByUser: (userId: string) => request<Family | Record<string, never>>(`/family/by-user/${userId}`),
  familyPushList: (code: string, user_id: string, items: ListItem[]) =>
    post<FamilyList>('/family/list', { code, user_id, items }),
  familyPullList: (code: string) => request<FamilyList>(`/family/list/${code}`),
};
