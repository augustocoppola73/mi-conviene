/** #22: i volantini (prima in prima pagina), ora da "Altro". Si aprono sul sito ufficiale della catena. */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, Flyer } from '@/api';
import { EmptyState, Icon, StoreDot } from '@/components/ui';
import { useStore } from '@/store';
import { makeStyles, radius, spacing, useTheme } from '@/theme';

export default function VolantiniScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const { prefs } = useStore();
  const [flyers, setFlyers] = useState<Flyer[] | null>(null);
  useEffect(() => {
    api.flyers(prefs.location?.lat, prefs.location?.lon).then(setFlyers).catch(() => setFlyers([]));
  }, [prefs.location]);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/altro'));

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Pressable onPress={back} hitSlop={10} accessibilityLabel="Indietro">
          <Icon name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={s.title}>📰 Volantini di oggi</Text>
      </View>
      <ScrollView contentContainerStyle={s.content}>
        {flyers === null ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        ) : flyers.length === 0 ? (
          <EmptyState icon="newspaper-outline" text="Nessun volantino disponibile ora. Riprova più tardi." />
        ) : (
          flyers.map((f) => (
            <Pressable key={f.store_id} accessibilityRole="link" accessibilityLabel={`Apri il volantino ${f.store_name}`}
              onPress={() => Linking.openURL(f.url)} style={({ pressed }) => [s.card, pressed && { opacity: 0.7 }]}>
              <StoreDot storeId={f.store_id} size={22} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.name} numberOfLines={1}>{f.store_name}</Text>
                <Text style={s.muted} numberOfLines={2}>
                  {f.branch_name
                    ? `${f.branch_name}${f.address ? `, ${f.address}` : ''}${f.distance_km != null ? ` · ${f.distance_km.toLocaleString('it-IT')} km` : ''}`
                    : 'Volantino nazionale'}
                </Text>
                <Text style={s.link}>{f.store_page ? 'Volantino di zona' : 'Volantino nazionale'}</Text>
              </View>
              <Icon name="open-outline" size={20} color={colors.primary} />
            </Pressable>
          ))
        )}
        <Text style={s.note}>Si apre il sito ufficiale della catena. Le offerte dei volantini non sono ancora nei calcoli.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((c) => ({
  safe: { flex: 1, backgroundColor: c.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  title: { color: c.text, fontSize: 20, fontWeight: '800' },
  content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: 48, maxWidth: 720, width: '100%', alignSelf: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, minHeight: 64 },
  name: { color: c.text, fontSize: 16, fontWeight: '700' },
  muted: { color: c.textSecondary, fontSize: 13 },
  link: { color: c.primary, fontSize: 13, fontWeight: '700', marginTop: 2 },
  note: { color: c.textSecondary, fontSize: 12, marginTop: spacing.md },
}));
