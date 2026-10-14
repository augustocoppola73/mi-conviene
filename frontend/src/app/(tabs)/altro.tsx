/**
 * #22: "Altro" (tre puntini nel menu in basso): le funzioni che non servono ogni volta.
 * Per aggiungerne una nuova basta una riga in VOCI.
 */
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, IconName } from '@/components/ui';
import { can, Feature, showLocked } from '@/features';
import { useStore } from '@/store';
import { makeStyles, radius, spacing, useTheme } from '@/theme';

const VOCI: { emoji: string; title: string; sub: string; to: '/profilo' | '/volantini'; feature?: Feature }[] = [
  { emoji: '👤', title: 'Profilo', sub: 'Tu e account, famiglia, gruppi, preferiti, notifiche', to: '/profilo' },
  { emoji: '📰', title: 'Volantini di oggi', sub: 'Le offerte delle catene vicino a te, sul loro sito', to: '/volantini', feature: 'volantini' },
];

export default function AltroScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const { prefs } = useStore();
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.title}>Altro</Text>
        {prefs.participant && (
          <Pressable onPress={() => showLocked('tutte')} style={[s.row, s.full]} accessibilityRole="button">
            <Text style={s.emoji}>⭐</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.name}>Scopri l'app completa</Text>
              <Text style={s.sub}>Sei nel gruppo come ospite: con l'app completa anche Salvadanaio, Vicino a me, carburante…</Text>
            </View>
            <Icon name={'chevron-forward' as IconName} size={20} color={colors.textSecondary} />
          </Pressable>
        )}
        {VOCI.map((v) => {
          const off = !!v.feature && !can(prefs, v.feature);
          return (
          <Pressable key={v.to} onPress={() => (off ? showLocked(v.feature!) : router.push(v.to))}
            style={({ pressed }) => [s.row, off && { opacity: 0.45 }, pressed && { opacity: 0.7 }]}
            accessibilityRole="button" accessibilityLabel={off ? `${v.title}, nell'app completa` : v.title}>
            <Text style={s.emoji}>{v.emoji}</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.name}>{v.title}</Text>
              <Text style={s.sub}>{v.sub}</Text>
            </View>
            <Icon name={(off ? 'lock-closed' : 'chevron-forward') as IconName} size={20} color={colors.textSecondary} />
          </Pressable>
          );
        })}
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
  full: { borderColor: c.primary, backgroundColor: c.primarySoft },
  name: { color: c.text, fontSize: 17, fontWeight: '700' },
  sub: { color: c.textSecondary, fontSize: 13, marginTop: 2 },
}));
