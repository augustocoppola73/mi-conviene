import { Pressable, Text, View } from 'react-native';

import type { PriceKind } from '../api';
import { makeStyles, radius } from '../theme';

const LABELS: Record<PriceKind, string> = { normale: 'Normale', offerta: 'In offerta', variante: 'Altra marca' };
export const KIND_HELP: Record<PriceKind, string> = {
  normale: 'diventa il prezzo di questo prodotto in questo negozio',
  offerta: 'vale solo per i prossimi 7 giorni, poi torna il prezzo normale',
  variante: 'non cambia il prezzo del prodotto: lo ricordo come alternativa',
};

/** Che prezzo è? Normale / in offerta / di un'altra marca o formato. */
export function PriceKindPicker({ value, onChange, compact }: { value: PriceKind; onChange: (k: PriceKind) => void; compact?: boolean }) {
  const s = useStyles();
  return (
    <View style={s.row}>
      {(Object.keys(LABELS) as PriceKind[]).map((k) => (
        <Pressable key={k} onPress={() => onChange(k)} style={[s.chip, compact && s.small, value === k && s.on]}
          accessibilityRole="radio" accessibilityState={{ selected: value === k }}>
          <Text style={[s.text, compact && s.smallText, value === k && s.textOn]}>{LABELS[k]}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border },
  small: { paddingHorizontal: 8, paddingVertical: 3 },
  on: { backgroundColor: c.primary, borderColor: c.primary },
  text: { color: c.text, fontSize: 13 },
  smallText: { fontSize: 11 },
  textOn: { color: c.primaryText },
}));
