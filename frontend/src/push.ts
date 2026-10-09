/**
 * Notifiche push (solo app Android): permesso, registrazione del telefono su Supabase (push_tokens),
 * apertura della schermata giusta quando tocchi la notifica. Le manda la funzione "notifica" (Firebase).
 */
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { IS_CLOUD, sb } from './cloud/client';

export const PUSH_SUPPORTED = Platform.OS === 'android' && IS_CLOUD;
export const NOTIFY_KINDS = [
  { id: 'lista', label: 'Lista condivisa con la famiglia' },
  { id: 'spesa', label: 'Spesa preparata da un familiare' },
  { id: 'presa', label: 'Qualcuno prende o lascia la spesa' },
  { id: 'finita', label: 'Spesa finita (con il totale)' },
] as const;

if (PUSH_SUPPORTED) {
  // con l'app aperta la notifica si vede lo stesso
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
  });
}

/** Chiede il permesso (se serve) e registra questo telefono. ask=false: solo se il permesso c'è già. */
export async function registerPush(ask: boolean): Promise<'ok' | 'denied' | 'unsupported'> {
  if (!PUSH_SUPPORTED) return 'unsupported';
  await Notifications.setNotificationChannelAsync('famiglia', {
    name: 'Famiglia', importance: Notifications.AndroidImportance.HIGH, lightColor: '#4F6B4A',
  });
  let perm = await Notifications.getPermissionsAsync();
  if (perm.status !== 'granted' && ask && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
  if (perm.status !== 'granted') return 'denied';
  const { data: token } = await Notifications.getDevicePushTokenAsync();
  const { data } = await sb().auth.getSession();
  if (!data.session) return 'denied';
  await sb().from('push_tokens').upsert({ token, user_id: data.session.user.id, platform: 'android', updated_at: new Date().toISOString() });
  return 'ok';
}

/** Tocchi la notifica → si apre la schermata giusta (anche ad app chiusa). */
export function listenNotificationTaps(): () => void {
  if (!PUSH_SUPPORTED) return () => {};
  const open = (r: Notifications.NotificationResponse | null) => {
    const url = r?.notification.request.content.data?.url;
    if (typeof url === 'string' && url.startsWith('/')) setTimeout(() => router.push(url as any), 300);
    Notifications.setBadgeCountAsync(0).catch(() => {});
  };
  Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener(open);
  return () => sub.remove();
}

export async function sendTestNotification() {
  const { error } = await sb().rpc('test_my_notification');
  if (error) throw new Error(error.message);
}
