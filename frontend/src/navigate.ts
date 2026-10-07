/** "Portami lì": apre il navigatore del telefono con il percorso dalla posizione attuale al negozio. */
import { Linking, Platform } from 'react-native';

export async function openNavigation(lat: number, lon: number, label?: string): Promise<void> {
  const web = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;
  const tries: string[] = [];
  if (Platform.OS === 'android') tries.push(`google.navigation:q=${lat},${lon}`, `geo:0,0?q=${lat},${lon}(${encodeURIComponent(label || 'Supermercato')})`);
  if (Platform.OS === 'ios') tries.push(`maps://?daddr=${lat},${lon}&dirflg=d`);
  if (Platform.OS === 'web') {
    window.open(web, '_blank');
    return;
  }
  for (const url of [...tries, web]) {
    try { await Linking.openURL(url); return; } catch { /* prossimo */ }
  }
}
