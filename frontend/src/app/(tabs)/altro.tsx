/**
 * #22: "Altro" (tre puntini nel menu in basso): le funzioni che non servono ogni volta.
 * Per aggiungerne una nuova basta una riga in VOCI.
 */
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, IconName } from '@/components/ui';
import { makeStyles, radius, spacing, useTheme } from '@/theme';

const VOCI: { emoji: string; title: string; sub: string; to: '/profilo' | '/volantini' }[] = [
  { emoji: '👤', title: 'Profilo', sub: 'Tu e account, famiglia, gruppi, preferiti, notifiche', to: '/profilo' },
  { emoji: '📰', title: 'Volantini di oggi', sub: 'Le offerte delle catene vicino a te, sul loro sito', to: '/volantini' },
];

export default function AltroScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.title}>Altro</Text>
        {VOCI.map((v) => (
          <Pressable key={v.to} onPress={() => router.push(v.to)} style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
            accessibilityRole="button" accessibilityLabel={v.title}>
            <Text style={s.emoji}>{v.emoji}</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.name}>{v.title}</Text>
              <Text style={s.sub}>{v.sub}</Text>
            </View>
            <Icon name={'chevron-forward' as IconName} size={20} color={colors.textSecondary} />
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((c) => ({
  safe: { flex: 1, backgroundColor: c.background },
  content: { padding: spacing.lg, gap: spacing.sm, maxWidth: 720, width: '100%', alignSelf: 'center' },
  title: { color: c.text, fontSize: 28, fontWeight: '800', marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.md,
    borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, minHeight: 72 },
  emoji: { fontSize: 28 },
  name: { color: c.text, fontSize: 17, fontWeight: '700' },
  sub: { color: c.textSecondary, fontSize: 13, marginTop: 2 },
}));
