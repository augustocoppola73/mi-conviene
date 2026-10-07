/** Schermata di caricamento all'avvio: si vede subito e resta finché i dati indispensabili non sono pronti. */
import { ActivityIndicator, Text, View } from 'react-native';

import { radius, spacing, useTheme } from '../theme';
import { Icon } from './ui';

export function BootLoader({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: colors.background }}>
      <View style={{ width: 72, height: 72, borderRadius: radius.lg, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="pricetag" size={38} color={colors.primaryText} />
      </View>
      <Text style={{ fontSize: 24, fontWeight: '700', color: colors.text }}>Mi Conviene</Text>
      <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: spacing.sm }} />
      <Text style={{ fontSize: 14, color: colors.textSecondary }}>{text}</Text>
    </View>
  );
}
