/**
 * #40: l'aspetto del widget (si apre da ⚙ sul widget o da Altro › Widget).
 * Tema scuro / chiaro / come il telefono e quanto è trasparente il fondo; si vede subito un'anteprima.
 */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui';
import { makeStyles, radius, spacing, useTheme } from '@/theme';
import { refreshWidgets } from '@/widget';
import { DEFAULT_STYLE, loadWidgetStyle, palette, saveWidgetStyle, TRANSPARENCY_STEPS, WidgetStyle, WidgetTheme } from '@/widget/style';

const THEMES: { id: WidgetTheme; label: string }[] = [
  { id: 'scuro', label: 'Scuro' },
  { id: 'chiaro', label: 'Chiaro' },
  { id: 'auto', label: 'Come il telefono' },
];

export default function WidgetScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const scheme = useColorScheme();
  const [st, setSt] = useState<WidgetStyle>(DEFAULT_STYLE);
  useEffect(() => { loadWidgetStyle().then(setSt); }, []);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/altro'));

  const change = (next: WidgetStyle) => {
    setSt(next);
    saveWidgetStyle(next).then(() => refreshWidgets(300)).catch(() => {});
  };
  const dark = st.theme === 'auto' ? scheme === 'dark' : st.theme === 'scuro';
  const p = palette(dark, st.transparency);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Pressable onPress={back} hitSlop={10} accessibilityLabel="Indietro">
          <Icon name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={s.title}>Widget</Text>
      </View>
      <ScrollView contentContainerStyle={s.content}>
        {Platform.OS !== 'android' && <Text style={s.note}>Il widget c'è solo su Android.</Text>}

        {/* anteprima sopra uno «sfondo» colorato, per vedere la trasparenza */}
        <View style={s.wall} accessibilityLabel="Anteprima del widget">
          <View style={[s.wallBand, { backgroundColor: '#E9A23B', top: 0 }]} />
          <View style={[s.wallBand, { backgroundColor: '#3B7EA1', top: 60 }]} />
          <View style={[s.wallBand, { backgroundColor: '#6E4C9E', top: 120 }]} />
          <View style={[s.mock, { backgroundColor: p.bg }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ flex: 1, color: p.text, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>
                🧺 Lista di casa <Text style={{ color: p.primary }}>3</Text>
              </Text>
              <Text style={{ color: p.muted, fontSize: 18, marginRight: 8 }}>⚙</Text>
              <View style={[s.plus, { backgroundColor: p.primary }]}>
                <Text style={{ color: p.onPrimary, fontSize: 22, fontWeight: '700', lineHeight: 26 }}>+</Text>
              </View>
            </View>
            <View style={[s.mockShop, { backgroundColor: p.soft }]}>
              <Text style={{ color: p.text, fontSize: 13, fontWeight: '600' }}>🛒 Moira è da Conad: 4 di 9</Text>
            </View>
            {['🥛 Latte  2 l', '🍎 Mele  1 kg', '🍝 Spaghetti  ×2'].map((t) => (
              <Text key={t} style={{ color: p.text, fontSize: 14, marginTop: 4 }}>{t}</Text>
            ))}
          </View>
        </View>

        <Text style={s.label}>Tema</Text>
        <View style={s.chips}>
          {THEMES.map((t) => {
            const on = st.theme === t.id;
            return (
              <Pressable key={t.id} onPress={() => change({ ...st, theme: t.id })} accessibilityRole="radio" accessibilityState={{ selected: on }}
                style={[s.chip, on && s.chipOn]}>
                <Text style={[s.chipText, on && s.chipTextOn]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={s.label}>Trasparenza dello sfondo</Text>
        <View style={s.chips}>
          {TRANSPARENCY_STEPS.map((v) => {
            const on = st.transparency === v;
            return (
              <Pressable key={v} onPress={() => change({ ...st, transparency: v })} accessibilityRole="radio" accessibilityState={{ selected: on }}
                accessibilityLabel={v === 0 ? 'Nessuna trasparenza' : `Trasparenza ${v} per cento`} style={[s.chip, on && s.chipOn]}>
                <Text style={[s.chipText, on && s.chipTextOn]}>{v === 0 ? 'Pieno' : `${v}%`}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={s.note}>Il widget sulla home si aggiorna da solo in pochi secondi.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((c) => ({
  safe: { flex: 1, backgroundColor: c.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  title: { color: c.text, fontSize: 22, fontWeight: '800' },
  content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: 48, maxWidth: 720, width: '100%', alignSelf: 'center' },
  wall: { height: 180, borderRadius: radius.lg, overflow: 'hidden', justifyContent: 'center', padding: spacing.md },
  wallBand: { position: 'absolute', left: 0, right: 0, height: 60 },
  mock: { borderRadius: 22, padding: 12 },
  plus: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  mockShop: { marginTop: 6, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  label: { color: c.text, fontSize: 15, fontWeight: '700', marginTop: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, minHeight: 40, justifyContent: 'center' },
  chipOn: { backgroundColor: c.primary, borderColor: c.primary },
  chipText: { color: c.text, fontSize: 14, fontWeight: '600' },
  chipTextOn: { color: c.primaryText },
  note: { color: c.textSecondary, fontSize: 12, marginTop: spacing.md },
}));
