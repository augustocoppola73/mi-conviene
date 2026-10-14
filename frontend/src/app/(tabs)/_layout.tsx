import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Tabs } from 'expo-router';

import { View } from 'react-native';

import { LockedSheet } from '@/components/LockedSheet';
import { can, Feature, showLocked } from '@/features';
import { useStore } from '@/store';
import { useTheme } from '@/theme';

type IconName = keyof typeof Ionicons.glyphMap;

const TABS: { name: string; title: string; icon: IconName; iconActive: IconName }[] = [
  { name: 'index', title: 'Lista', icon: 'list-outline', iconActive: 'list' },
  { name: 'vicino', title: 'Vicino a me', icon: 'map-outline', iconActive: 'map' },
  { name: 'salvadanaio', title: 'Salvadanaio', icon: 'wallet-outline', iconActive: 'wallet' },
  // #22: profilo e funzioni secondarie (volantini…) stanno in "Altro"
  { name: 'altro', title: 'Altro', icon: 'ellipsis-horizontal', iconActive: 'ellipsis-horizontal' },
];

export default function TabsLayout() {
  const { colors } = useTheme();
  const { prefs } = useStore();
  // #23: in modalità partecipante Vicino a me e Salvadanaio restano visibili ma ingrigiti
  const locked = (name: string) => (name === 'vicino' || name === 'salvadanaio') && !can(prefs, name as Feature);
  return (
    <>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 11 },
        sceneStyle: { backgroundColor: colors.background },
      }}>
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          listeners={{ tabPress: (e) => { if (locked(t.name)) { e.preventDefault(); showLocked(t.name as Feature); } } }}
          options={{
            title: t.title,
            tabBarLabelStyle: locked(t.name) ? { fontSize: 11, opacity: 0.45 } : undefined,
            tabBarIcon: ({ color, focused, size }) => (
              <View style={locked(t.name) ? { opacity: 0.4 } : undefined}>
                {t.name === 'salvadanaio'
                  // il maialino del salvadanaio (Ionicons non ce l'ha)
                  ? <MaterialCommunityIcons name={focused ? 'piggy-bank' : 'piggy-bank-outline'} size={size + 2} color={color} />
                  : <Ionicons name={focused ? t.iconActive : t.icon} size={size} color={color} />}
                {locked(t.name) && <Ionicons name="lock-closed" size={11} color={color} style={{ position: 'absolute', right: -6, top: -2 }} />}
              </View>
            ),
          }}
        />
      ))}
      {/* i Risultati si aprono dalla Lista ("Trova la spesa migliore" o "Ultimo risultato"), non dal menu */}
      <Tabs.Screen name="risultati" options={{ href: null, title: 'Risultati' }} />
      {/* #22: il Profilo si apre da "Altro" (resta raggiungibile dai link dell'app) */}
      <Tabs.Screen name="profilo" options={{ href: null, title: 'Profilo' }} />
    </Tabs>
    <LockedSheet />
    </>
  );
}
