/** Dati statici esportati dal backend Python (scripts/esporta_dati_app.py). */
import STATIC from './data/static.json';

export interface Category { id: string; name: string; emoji: string }
export interface Product { id: string; name: string; category_id: string; default_qty: number; unit: string }
export interface StoreDef { id: string; name: string; lat: number; lng: number; distance_km: number; price_level: number }

export const CATEGORIES = STATIC.categories as Category[];
export const PRODUCTS = STATIC.products as Product[];
export const PRODUCT_INDEX: Record<string, Product> = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));
export const STORES = STATIC.stores as StoreDef[];
export const STORE_INDEX: Record<string, StoreDef> = Object.fromEntries(STORES.map((s) => [s.id, s]));
export const ESTIMATES = STATIC.estimates as Record<string, Record<string, number>>;
export const CHAIN_FLYERS = STATIC.chain_flyers as Record<string, string>;
export const OFFICIAL_DOMAINS = STATIC.official_domains as Record<string, string[]>;
export const CLASSIFY = STATIC.classify as { keywords: Record<string, string[]>; stopwords: string[]; generic: string[] };
export const RECIPES_CONST = STATIC.recipes as unknown as {
  num_words: Record<string, number>; fractions: Record<string, number>;
  units: Record<string, [string, number]>; household: Record<string, [string, string]>;
  liquids: string[]; density: Record<string, number>; descriptors: string[]; aliases: Record<string, string>;
  piece_g: Record<string, number>; pantry: string[]; skip: string[];
  fruit_juice_ml: Record<string, [string, number]>; substitutes: string[][];
};
export const C = STATIC.constants as {
  fuel_consumption_l_100km: number; fallback_fuel_price: number; transport_speed: Record<string, number>;
  time_value: number; time_weight: number; default_refuel_liters: number; max_detour_km: number;
  road_factor: number; promo_default_days: number;
};
