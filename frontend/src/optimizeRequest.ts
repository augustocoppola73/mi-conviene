/** La richiesta "Trova la spesa migliore", uguale dalla Lista e dai Risultati (es. "ricalcola in auto"). */
import type { ListItem, OptimizeRequest, Transport } from './api';
import type { GeoPoint } from './location';
import type { Prefs } from './store';

export function optimizeRequest(userId: string, items: ListItem[], prefs: Prefs, loc: GeoPoint | null, transport?: Transport): OptimizeRequest {
  const t = transport ?? prefs.transport;
  const first = prefs.favorites[0] ?? null;
  return {
    user_id: userId,
    items,
    budget: prefs.budget,
    transport: t,
    // la versione sul computer conosce un solo abituale: le passo il primo preferito
    habitual_store_id: first?.store_id ?? null,
    habitual_branch: first?.branch ?? null,
    favorites: prefs.favorites,
    min_savings_threshold: prefs.minSavingsThreshold,
    fuel_type: prefs.fuelType,
    ...(loc ? { lat: loc.lat, lon: loc.lon } : {}),
    refuel: t === 'car' && prefs.refuel,
    refuel_liters: prefs.refuelLiters,
    max_stores: 2, // l'app prova anche due negozi e lo propone solo se conviene davvero
    category_rules: prefs.categoryRules,
  };
}
