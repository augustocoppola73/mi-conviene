/**
 * Aggiornamenti dell'app Android (sul web non serve: la pagina è sempre l'ultima).
 *  1) codice dell'app "via etere" (expo-updates, server su Cloudflare): scaricato in silenzio, si applica riaprendo
 *     l'app oppure subito con "Riavvia";
 *  2) nuova versione dell'APK (cambi nativi, rari): avviso con "Scarica", poi si conferma l'installazione.
 */
import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { makeStyles, radius, spacing, useTheme } from '../theme';
import { Icon } from './ui';

const SITE = 'https://mi-conviene.augustocoppola.workers.dev';
const CHECK_EVERY_MS = 30 * 60 * 1000;

interface LatestApk { versionCode: number; versionName: string; url: string; notes?: string }

export function AppUpdates() {
  if (Platform.OS === 'web') return null;
  return <NativeUpdates />;
}

function NativeUpdates() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { isUpdatePending } = Updates.useUpdates();
  const [apk, setApk] = useState<LatestApk | null>(null);
  const [hidden, setHidden] = useState(false);
  const lastCheck = useRef(0);

  useEffect(() => {
    const check = async () => {
      if (Date.now() - lastCheck.current < CHECK_EVERY_MS) return;
      lastCheck.current = Date.now();
      // codice nuovo: si scarica in background
      if (Updates.isEnabled && !__DEV__) {
        try {
          const r = await Updates.checkForUpdateAsync();
          if (r.isAvailable) await Updates.fetchUpdateAsync();
        } catch { /* niente rete o server: si riprova più tardi */ }
      }
      // APK nuovo
      try {
        const res = await fetch(`${SITE}/android-latest.json?t=${Date.now()}`);
        const latest: LatestApk = await res.json();
        const mine = Number(Application.nativeBuildVersion || 0);
        setApk(latest.versionCode > mine ? latest : null);
      } catch { /* pazienza */ }
    };
    check();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') check(); });
    return () => sub.remove();
  }, []);

  if (hidden || (!apk && !isUpdatePending)) return null;
  return (
    <View style={[s.bar, { paddingTop: insets.top + spacing.sm }]}>
      <Icon name={apk ? 'download-outline' : 'refresh'} size={20} color={colors.primaryText} />
      <Text style={s.text}>
        {apk ? `Nuova versione dell'app (${apk.versionName})${apk.notes ? `: ${apk.notes}` : ''}` : 'Aggiornamento pronto'}
      </Text>
      <Pressable
        onPress={() => (apk ? Linking.openURL(apk.url) : Updates.reloadAsync())}
        style={s.btn} accessibilityRole="button">
        <Text style={s.btnText}>{apk ? 'Scarica' : 'Riavvia'}</Text>
      </Pressable>
      <Pressable onPress={() => setHidden(true)} hitSlop={10} accessibilityLabel="Chiudi">
        <Icon name="close" size={20} color={colors.primaryText} />
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: c.primary,
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  text: { flex: 1, color: c.primaryText, fontSize: 14, fontWeight: '600' },
  btn: { backgroundColor: c.primaryText, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 6 },
  btnText: { color: c.primary, fontWeight: '700', fontSize: 14 },
}));
