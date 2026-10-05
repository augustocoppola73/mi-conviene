import * as Location from 'expo-location';

export interface GeoPoint { lat: number; lon: number; updatedAt: string }

/** Chiede il permesso (solo quando l'utente tocca il pulsante) e legge la posizione. */
export async function getCurrentPosition(): Promise<GeoPoint> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Permesso negato: puoi attivarlo dalle impostazioni del browser o del telefono.');
  }
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return {
    lat: Math.round(pos.coords.latitude * 1e4) / 1e4, // ~10 m: basta per trovare i negozi vicini
    lon: Math.round(pos.coords.longitude * 1e4) / 1e4,
    updatedAt: new Date().toISOString(),
  };
}
