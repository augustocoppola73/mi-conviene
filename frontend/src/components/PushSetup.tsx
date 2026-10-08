/** Dopo l'accesso: registra il telefono per le notifiche (chiede il permesso una volta) e gestisce i tocchi. */
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { listenNotificationTaps, PUSH_SUPPORTED, registerPush } from '../push';

export function PushSetup() {
  useEffect(() => {
    if (!PUSH_SUPPORTED) return;
    const stop = listenNotificationTaps();
    registerPush(true).catch(() => {});
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') registerPush(false).catch(() => {}); });
    return () => { stop(); sub.remove(); };
  }, []);
  return null;
}
