import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { IS_CLOUD } from '@/cloud/client';
import { AuthGate } from '@/components/AuthGate';
import { StoreProvider, useStore } from '@/store';
import { useTheme } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});
if (IS_CLOUD) setTimeout(() => SplashScreen.hideAsync().catch(() => {}), 300); // la schermata di accesso deve vedersi

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
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
          </StoreProvider>
        </AuthGate>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
