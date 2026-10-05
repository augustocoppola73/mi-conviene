import Ionicons from '@expo/vector-icons/Ionicons';
import { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleProp, Text, View, ViewStyle } from 'react-native';

import { makeStyles, radius, spacing, storeColors, useTheme } from '../theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color?: string }) {
  const { colors } = useTheme();
  return <Ionicons name={name} size={size} color={color ?? colors.text} />;
}

export function StoreDot({ storeId, size = 12 }: { storeId: string; size?: number }) {
  return (
    <View
      style={{ width: size, height: size, borderRadius: 3, backgroundColor: storeColors[storeId] ?? '#999' }}
    />
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const s = useStyles();
  return (
    <View style={s.sectionRow}>
      <Text style={s.sectionTitle}>{children}</Text>
      {right}
    </View>
  );
}

export function Chip({
  label,
  icon,
  selected,
  onPress,
  leading,
}: {
  label: string;
  icon?: IconName;
  selected?: boolean;
  onPress?: () => void;
  leading?: ReactNode;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [s.chip, selected && s.chipSelected, pressed && { opacity: 0.7 }]}>
      {leading}
      {icon && <Icon name={icon} size={18} color={selected ? colors.primaryText : colors.text} />}
      <Text style={[s.chipLabel, selected && { color: colors.primaryText }]}>{label}</Text>
    </Pressable>
  );
}

export function PrimaryButton({
  label,
  icon,
  onPress,
  loading,
  disabled,
  style,
  variant = 'primary',
}: {
  label: string;
  icon?: IconName;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const fg = variant === 'primary' ? colors.primaryText : variant === 'danger' ? colors.danger : colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.button,
        variant !== 'primary' && s.buttonSecondary,
        (disabled || loading) && { opacity: 0.5 },
        pressed && { opacity: 0.85 },
        style,
      ]}>
      {loading ? <ActivityIndicator color={fg} /> : icon && <Icon name={icon} size={20} color={fg} />}
      <Text style={[s.buttonLabel, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <View style={s.empty}>
      <Icon name="cloud-offline-outline" size={36} color={colors.textSecondary} />
      <Text style={s.emptyText}>Non riesco a contattare il server.{'\n'}{message}</Text>
      {onRetry && <PrimaryButton label="Riprova" variant="secondary" onPress={onRetry} />}
    </View>
  );
}

export function EmptyState({ icon, text }: { icon: IconName; text: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <View style={s.emptyBox}>
      <Icon name={icon} size={40} color={colors.textSecondary} />
      <Text style={s.emptyText}>{text}</Text>
    </View>
  );
}

export const Card = ({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) => {
  const s = useStyles();
  return <View style={[s.card, style]}>{children}</View>;
};

const useStyles = makeStyles((c) => ({
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: c.text },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  chipSelected: { backgroundColor: c.primary, borderColor: c.primary },
  chipLabel: { fontSize: 14, color: c.text, fontWeight: '500' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: c.primary,
    paddingVertical: 16,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
  },
  buttonSecondary: { backgroundColor: c.primarySoft },
  buttonLabel: { fontSize: 16, fontWeight: '700' },
  empty: { alignItems: 'center', gap: spacing.md, padding: spacing.xxl },
  emptyBox: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: c.border,
  },
  emptyText: { textAlign: 'center', color: c.textSecondary, fontSize: 14, lineHeight: 20 },
  card: {
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.lg,
  },
}));
