/**
 * Aggiornamenti dell'app Android (sul web non serve: la pagina è sempre l'ultima).
 *  1) codice dell'app "via etere" (expo-updates, server su Cloudflare): scaricato in silenzio (compresso, ~1-2 MB).
 *     Si applica da solo alla prossima apertura, o quando torni nell'app dopo almeno un minuto fuori;
 *     intanto una riga discreta in fondo con "Ora" per chi lo vuole subito;
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
const CHECK_EVERY_MS = 2 * 60 * 1000; // al massimo un controllo ogni 2 minuti (apertura o ritorno nell'app)
const APPLY_AFTER_AWAY_MS = 60 * 1000; // fuori dall'app da almeno un minuto: al ritorno applico l'aggiornamento

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
  const awaySince = useRef<number | null>(null);
  const pending = useRef(false);
  pending.current = isUpdatePending;

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
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        const away = awaySince.current ? Date.now() - awaySince.current : 0;
        awaySince.current = null;
        // tornato dopo un po': è come riaprire l'app, applico l'aggiornamento senza chiedere
        if (pending.current && away >= APPLY_AFTER_AWAY_MS) { Updates.reloadAsync().catch(() => {}); return; }
        check();
      } else if (st === 'background' && awaySince.current == null) awaySince.current = Date.now();
    });
    return () => sub.remove();
  }, []);

  if (hidden || (!apk && !isUpdatePending)) return null;
  if (!apk) {
    // aggiornamento del codice: riga discreta in fondo, si applica comunque da solo
    return (
      <View style={[s.pill, { bottom: insets.bottom + 64 }]} pointerEvents="box-none">
        <View style={s.pillInner}>
          <Icon name="sparkles-outline" size={16} color={colors.primary} />
          <Text style={s.pillText}>Novità pronte: arrivano alla prossima apertura</Text>
          <Pressable onPress={() => Updates.reloadAsync()} hitSlop={8} accessibilityRole="button"><Text style={s.pillBtn}>Ora</Text></Pressable>
          <Pressable onPress={() => setHidden(true)} hitSlop={10} accessibilityLabel="Chiudi"><Icon name="close" size={16} color={colors.textSecondary} /></Pressable>
        </View>
      </View>
    );
  }
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
  bar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50, elevation: 6,
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: c.primary,
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  text: { flex: 1, color: c.primaryText, fontSize: 14, fontWeight: '600' },
  btn: { backgroundColor: c.primaryText, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 6 },
  btnText: { color: c.primary, fontWeight: '700', fontSize: 14 },
  pill: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 50 },
  pillInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: c.surface, borderRadius: radius.pill,
    borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.md, paddingVertical: 8, maxWidth: 420,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  pillText: { color: c.text, fontSize: 13, flexShrink: 1 },
  pillBtn: { color: c.primary, fontWeight: '700', fontSize: 14 },
}));
