/**
 * − quantità + per un prodotto della lista. Scendendo sotto il primo passo il prodotto viene tolto.
 */
import { Pressable, Text, View } from 'react-native';

import { formatQty } from '../format';
import { makeStyles, radius, spacing } from '../theme';
import { Icon } from './ui';

export function QtyStepper({ quantity, unit, step, onChange, compact }: {
  quantity: number;
  unit: string;
  step: number;
  onChange: (q: number) => void;
  compact?: boolean;
}) {
  const s = useStyles();
  const set = (q: number) => onChange(Math.round(q * 1000) / 1000);
  return (
    <View style={s.row}>
      <Pressable accessibilityLabel="Diminuisci" hitSlop={4} style={[s.btn, compact && s.small]} onPress={() => set(quantity - step)}>
        <Icon name={quantity - step <= 0 ? 'trash-outline' : 'remove'} size={compact ? 16 : 18} />
      </Pressable>
      <Text style={[s.qty, compact && { minWidth: 44, fontSize: 13 }]} numberOfLines={1}>{formatQty(quantity, unit)}</Text>
      <Pressable accessibilityLabel="Aumenta" hitSlop={4} style={[s.btn, compact && s.small]} onPress={() => set(quantity + step)}>
        <Icon name="add" size={compact ? 16 : 18} />
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  btn: { width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceMuted },
  small: { width: 30, height: 30 },
  qty: { minWidth: 52, textAlign: 'center', color: c.text, fontSize: 14, fontWeight: '700' },
}));
