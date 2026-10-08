/** Riga "🅿️ Parcheggio privato del negozio (120 posti, gratuito)" sotto un supermercato. Senza dati non mostra nulla. */
import { Text } from 'react-native';

import { Parking } from '../api';
import { parkingLabel } from '../engine/places';
import { useTheme } from '../theme';

export function ParkingLine({ parking, size = 13 }: { parking?: Parking | null; size?: number }) {
  const { colors } = useTheme();
  const label = parkingLabel(parking);
  if (!label) return null;
  const good = parking!.kind === 'clienti';
  return (
    <Text style={{ fontSize: size, color: good ? colors.primary : colors.textSecondary, fontWeight: good ? '600' : '400' }}>
      🅿️ {label}
    </Text>
  );
}
