import * as Location from 'expo-location';

export interface GeoPoint { lat: number; lon: number; updatedAt: string; /** indirizzo scritto a mano (modalità indirizzo) */ label?: string }

const round = (x: number) => Math.round(x * 1e4) / 1e4; // ~10 m: basta per trovare i negozi vicini

/** Chiede il permesso (solo la prima volta) e legge la posizione. */
export async function getCurrentPosition(): Promise<GeoPoint> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Permesso negato: puoi attivarlo dalle impostazioni del browser o del telefono.');
  }
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { lat: round(pos.coords.latitude), lon: round(pos.coords.longitude), updatedAt: new Date().toISOString() };
}

/** Posizione senza disturbare: niente richiesta di permesso (se non c'è, null); prima l'ultima nota, poi quella attuale. */
export async function quietPosition(timeoutMs = 8000): Promise<GeoPoint | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') return null;
    const fresh = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), timeoutMs));
    const pos = (await Promise.race([fresh, timeout])) ?? (await Location.getLastKnownPositionAsync().catch(() => null));
    if (!pos) return null;
    return { lat: round(pos.coords.latitude), lon: round(pos.coords.longitude), updatedAt: new Date().toISOString() };
  } catch {
    return null;
  }
}

/** Distanza in metri (basta l'approssimazione piana per poche centinaia di metri). */
export function metersBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const k = 111_320;
  return Math.hypot((a.lat - b.lat) * k, (a.lon - b.lon) * k * Math.cos((a.lat * Math.PI) / 180));
}
