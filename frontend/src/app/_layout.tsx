import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { ReactNode, useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { IS_CLOUD } from '@/cloud/client';
import { AppUpdates } from '@/components/AppUpdates';
import { AutoLocation } from '@/components/AutoLocation';
import { PushSetup } from '@/components/PushSetup';
import { AuthGate } from '@/components/AuthGate';
import { BootLoader } from '@/components/BootLoader';
import { InviteHandler } from '@/components/InviteHandler';
import { rememberInviteFromUrl } from '@/invite';
import { StoreProvider, useStore } from '@/store';
import { useTheme } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});
rememberInviteFromUrl(); // ?famiglia=CODICE: lo ricordo prima dell'accesso
if (IS_CLOUD) setTimeout(() => SplashScreen.hideAsync().catch(() => {}), 300); // la schermata di accesso deve vedersi

/** Finché preferenze e prezzi non sono pronti si vede il caricamento (niente tempi fissi: si aspettano i dati). */
function ReadyGate({ children }: { children: ReactNode }) {
  const { hydrated, catalog, catalogError } = useStore();
  if (!hydrated) return <BootLoader text="Preparo l'app…" />;
  if (!catalog && !catalogError) return <BootLoader text="Carico i prezzi…" />;
  return <>{children}</>;
}

function HideSplashWhenReady() {
  const { hydrated } = useStore();
  useEffect(() => {
    if (hydrated) SplashScreen.hideAsync().catch(() => {});
  }, [hydrated]);
  return null;
}

export default function RootLayout() {
  const { colors, isDark } = useTheme();
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <AuthGate>
          <StoreProvider>
            <HideSplashWhenReady />
            <ReadyGate>
              <InviteHandler />
              <AutoLocation />
              <PushSetup />
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
            </ReadyGate>
          </StoreProvider>
        </AuthGate>
        {/* dopo il resto: la riga "Novità pronte" sta sopra le schermate */}
        <AppUpdates />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
