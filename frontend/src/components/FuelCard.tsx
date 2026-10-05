import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';

import { api, FuelNearby, FuelType } from '../api';
import { euro } from '../format';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { Chip, Icon } from './ui';

const FUEL_LABEL: Record<FuelType, string> = { benzina: 'Benzina', gasolio: 'Gasolio', gpl: 'GPL', metano: 'Metano' };
const perLiter = (n: number) => `${n.toLocaleString('it-IT', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} €/l`;

/** Dove fare carburante: il distributore che conviene davvero (prezzo + strada per arrivarci). */
export function FuelCard({ fuel, onFuelChange, lat, lon }: {
  fuel: FuelType; onFuelChange: (f: FuelType) => void; lat?: number; lon?: number;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const [data, setData] = useState<FuelNearby | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setData(null);
    setError(false);
    api.fuelNearby(fuel, lat, lon).then(setData).catch(() => setError(true));
  }, [fuel, lat, lon]);

  const best = data?.best;
  return (
    <View style={s.card}>
      <View style={s.head}>
        <Text style={s.title}>⛽ Dove fare {FUEL_LABEL[fuel].toLowerCase()}</Text>
      </View>
      {(lat == null || lon == null) && (
        <Text style={s.muted}>Zona di esempio (Milano): attiva la posizione per i distributori vicino a te.</Text>
      )}
      <View style={s.chips}>
        {(['benzina', 'gasolio', 'gpl', 'metano'] as FuelType[]).map((f) => (
          <Chip key={f} label={FUEL_LABEL[f]} selected={f === fuel} onPress={() => onFuelChange(f)} />
        ))}
      </View>

      {error ? (
        <Text style={s.muted}>Prezzi dei distributori non disponibili in questo momento.</Text>
      ) : !data ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
      ) : !best ? (
        <Text style={s.muted}>Nessun distributore con {FUEL_LABEL[fuel].toLowerCase()} self entro {5} km.</Text>
      ) : (
        <>
          <Pressable onPress={() => Linking.openURL(best.maps_url)} style={s.best}>
            <View style={{ flex: 1 }}>
              <Text style={s.brand}>{best.brand}</Text>
              <Text style={s.muted} numberOfLines={1}>{best.address}{best.city ? `, ${best.city}` : ''}</Text>
              <Text style={s.muted}>circa {best.distance_km.toLocaleString('it-IT')} km · self</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.price}>{perLiter(best.price)}</Text>
              <View style={s.go}>
                <Icon name="navigate-outline" size={14} color={colors.primary} />
                <Text style={s.goText}>Portami lì</Text>
              </View>
            </View>
          </Pressable>
          <Text style={s.summary}>
            Pieno da {data.liters} l: {euro(best.fill_cost)}
            {best.saving_vs_median != null && best.saving_vs_median > 0.05
              ? ` · risparmi ${euro(best.saving_vs_median)} rispetto alla media in zona (${perLiter(data.median!)}), strada inclusa`
              : data.median ? ` · in linea con la media in zona (${perLiter(data.median)})` : ''}
          </Text>
          {data.stations.length > 1 && (
            <Pressable onPress={() => setOpen(!open)} hitSlop={6} style={s.more}>
              <Text style={s.goText}>{open ? 'Nascondi' : `Altri ${data.stations.length - 1} distributori`}</Text>
              <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.primary} />
            </Pressable>
          )}
          {open && data.stations.slice(1).map((st) => (
            <Pressable key={st.id} onPress={() => Linking.openURL(st.maps_url)} style={s.row}>
              <Text style={[s.rowText, { flex: 1 }]} numberOfLines={1}>
                {st.brand} · {st.address} · {st.distance_km.toLocaleString('it-IT')} km
              </Text>
              <Text style={s.rowText}>{perLiter(st.price)}</Text>
            </Pressable>
          ))}
          <Text style={s.source}>
            Prezzi comunicati dai distributori al MIMIT{data.observed_at ? ` (${new Date(data.observed_at).toLocaleDateString('it-IT')})` : ''}.
            Ordine per costo effettivo: pieno + carburante per andare e tornare.
          </Text>
        </>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  card: { borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, padding: spacing.lg, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center' },
  title: { color: c.text, fontSize: 16, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  best: {
    flexDirection: 'row', gap: spacing.md, alignItems: 'center', padding: spacing.md,
    borderRadius: radius.md, backgroundColor: c.primarySoft, marginTop: spacing.xs,
  },
  brand: { color: c.text, fontSize: 15, fontWeight: '700' },
  price: { color: c.primary, fontSize: 18, fontWeight: '800' },
  go: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  goText: { color: c.primary, fontSize: 13, fontWeight: '700' },
  summary: { color: c.text, fontSize: 13, lineHeight: 18 },
  more: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  row: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 6, borderTopWidth: 1, borderTopColor: c.border },
  rowText: { color: c.textSecondary, fontSize: 12 },
  muted: { color: c.textSecondary, fontSize: 13 },
  source: { color: c.textSecondary, fontSize: 11, lineHeight: 15 },
}));
