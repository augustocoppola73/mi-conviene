import { Alert, Platform } from 'react-native';

/** #71: errori spiegati a una persona (non «Failed to fetch» o «OpenStreetMap non raggiungibile»). */
export const isNetworkError = (e: unknown) =>
  /fetch|network|timeout|connessione|Load failed|aborted|non raggiungibile|ERR_/i.test(String((e as Error)?.message ?? e));

export function friendlyError(e: unknown, what = 'salvare'): string {
  if (isNetworkError(e)) return `Non riesco a ${what}: sei senza rete o la connessione è lenta. Riprova tra poco.`;
  const m = String((e as Error)?.message ?? e ?? '').trim();
  return m ? m : `Non sono riuscito a ${what}: riprova.`;
}

/** messaggio a schermo (web: alert; telefono: riquadro) */
export function showError(title: string, e: unknown, what?: string) {
  const msg = friendlyError(e, what);
  if (Platform.OS === 'web') globalThis.alert?.(`${title}\n\n${msg}`); else Alert.alert(title, msg);
}
