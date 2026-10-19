/**
 * #30: "Come faccio la spesa" in una riga sola sopra "Trova la spesa migliore"
 * (🚗 In auto · ⛽ niente pieno · 📍 Livorno · 💶 nessun limite ›): un tocco apre il pannello con
 * come vai, carburante, dove sei e budget. Prima erano quattro sezioni in fondo alla Lista.
 */
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { BudgetSuggestion, FuelType } from '../api';
import { can, showLocked } from '../features';
import { euro, formatDate, parseEuro, TRANSPORTS, plain } from '../format';
import { useStore } from '../store';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { FuelCard } from './FuelCard';
import { LocationControl } from './LocationControl';
import { Chip, Icon, PrimaryButton } from './ui';

const FUEL: Record<FuelType, string> = { benzina: 'benzina', gasolio: 'gasolio', gpl: 'GPL', metano: 'metano' };
const TRANSPORT_ICON: Record<string, string> = { car: '🚗', walk: '🚶', bike: '🚲', transit: '🚌' };

/** La riga riassuntiva (sta sopra il pulsante "Trova la spesa migliore"). */
export function TripSummary({ onPress }: { onPress: () => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const { prefs } = useStore();
  const t = TRANSPORTS.find((x) => x.id === prefs.transport);
  const car = prefs.transport === 'car';
  const where = prefs.location
    ? (prefs.locationMode === 'address' && prefs.location.label ? prefs.location.label.split(',')[0] : 'dove sei')
    : null;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.summary, pressed && { opacity: 0.8 }]} accessibilityRole="button"
      accessibilityLabel="Come faccio la spesa: trasporto, carburante, posizione e budget" accessibilityHint="Tocca per cambiare">
      {/* #94: una riga sola, a parole («In auto da Via Roma · col pieno · cambia») */}
      <Text style={s.summaryText} numberOfLines={1}>
        {TRANSPORT_ICON[prefs.transport] ?? '🚗'} {t?.id === 'car' ? 'In auto' : t?.id === 'walk' ? 'A piedi' : t?.id === 'bike' ? 'In bici' : t?.id === 'transit' ? 'Con i mezzi' : t?.label ?? 'In auto'}
        {where ? ` da ${where}` : ''}
        {car && can(prefs, 'carburante') && prefs.refuel ? ' · col pieno' : ''}
        {prefs.budget != null ? ` · max ${euro(prefs.budget)}` : ''}
        {!where && <Text style={{ color: colors.warning, fontWeight: '800' }}> · da dove parti?</Text>}
        <Text style={{ color: colors.primary, fontWeight: '700' }}>  cambia</Text>
      </Text>
      <Icon name="chevron-forward" size={18} color={colors.textSecondary} />
    </Pressable>
  );
}

/** Il pannello: come vai, carburante, dove sei, budget. */
export function TripSheet({ visible, onClose, suggestion }: {
  visible: boolean; onClose: () => void; suggestion: BudgetSuggestion | null;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { prefs, setPrefs } = useStore();
  const [budgetText, setBudgetText] = useState(prefs.budget != null ? String(prefs.budget) : '');
  useEffect(() => { setBudgetText(prefs.budget != null ? String(prefs.budget) : ''); }, [prefs.budget, visible]);
  const onBudgetChange = (t: string) => {
    const clean = t.replace(/[^0-9.,]/g, '');
    setBudgetText(clean);
    const n = parseEuro(clean);   // #81: «1.200» = 1200 €
    setPrefs({ budget: Number.isFinite(n) ? n : null });
  };
  const car = prefs.transport === 'car';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.bg} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <View style={s.head}>
            <Text style={s.title}>Come faccio la spesa</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Chiudi"><Icon name="close" size={26} color={colors.textSecondary} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + spacing.md, gap: spacing.sm }}>
            <Text style={s.label}>Come vai?</Text>
            <View style={s.wrap}>
              {TRANSPORTS.map((t) => (
                <Chip key={t.id} label={t.label} icon={t.icon as never} selected={prefs.transport === t.id} onPress={() => setPrefs({ transport: t.id })} />
              ))}
            </View>

            {car && (can(prefs, 'carburante') ? (
              <>
                <Text style={s.label}>Carburante</Text>
                <FuelCard fuel={prefs.fuelType} onFuelChange={(f) => setPrefs({ fuelType: f })} lat={prefs.location?.lat} lon={prefs.location?.lon} />
                <Pressable accessibilityRole="switch" accessibilityState={{ checked: prefs.refuel }} onPress={() => setPrefs({ refuel: !prefs.refuel })}
                  style={[s.row, prefs.refuel && s.rowOn]}>
                  <Icon name={prefs.refuel ? 'checkbox' : 'square-outline'} size={22} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.name}>Devo anche fare il pieno</Text>
                    <Text style={s.muted}>
                      {prefs.location ? 'Cerco il distributore più conveniente sulla strada di ogni supermercato e lo metto nel confronto.'
                        : 'Attiva la posizione qui sotto: serve per sapere qual è la tua strada.'}
                    </Text>
                  </View>
                </Pressable>
                {prefs.refuel && (
                  <View style={s.litersRow}>
                    <Text style={s.muted}>Litri (facoltativo)</Text>
                    <TextInput value={prefs.refuelLiters != null ? String(prefs.refuelLiters) : ''} keyboardType="decimal-pad"
                      onChangeText={(t) => { const n = parseFloat(t.replace(',', '.')); setPrefs({ refuelLiters: Number.isFinite(n) && n > 0 ? Math.min(n, 200) : null }); }}
                      placeholder="40 (pieno medio)" placeholderTextColor={colors.textSecondary} style={s.input} />
                  </View>
                )}
              </>
            ) : (
              <Pressable onPress={() => showLocked('carburante')} style={[s.row, { opacity: 0.5 }]} accessibilityRole="button">
                <Icon name="lock-closed" size={20} color={colors.textSecondary} />
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>⛽ Risparmio carburante</Text>
                  <Text style={s.muted}>Il distributore più conveniente sulla strada: nell'app completa.</Text>
                </View>
              </Pressable>
            ))}

            <Text style={s.label}>Dove sei?</Text>
            <LocationControl />

            <Text style={s.label}>Budget per questa spesa</Text>
            <View style={s.budgetBox}>
              <Text style={s.euro}>€</Text>
              <TextInput value={budgetText} onChangeText={onBudgetChange} keyboardType="decimal-pad" placeholder="Nessun limite"
                placeholderTextColor={colors.textSecondary} style={s.budgetInput} />
              {prefs.budget != null && (
                <Pressable onPress={() => setPrefs({ budget: null })} hitSlop={8}><Text style={s.link}>Togli</Text></Pressable>
              )}
            </View>
            {suggestion?.suggested != null && suggestion.suggested !== prefs.budget && (
              <Pressable style={s.suggest} onPress={() => setPrefs({ budget: suggestion.suggested })}>
                <Icon name="bulb-outline" size={16} color={colors.primary} />
                <Text style={s.suggestText}>Ti propongo <Text style={{ fontWeight: '700' }}>{euro(suggestion.suggested)}</Text> · {plain(suggestion.reason)}</Text>
                <Text style={s.link}>Usa</Text>
              </Pressable>
            )}
            {suggestion?.last_similar && (
              <Text style={s.muted}>
                🕒 L'ultima volta, per una spesa simile, sei andato da <Text style={{ fontWeight: '700', color: colors.text }}>{suggestion.last_similar.store_name}</Text>
                {' '}({formatDate(suggestion.last_similar.date)}{suggestion.last_similar.total_cost ? ` · ${euro(suggestion.last_similar.total_cost)}` : ''})
              </Text>
            )}
            <PrimaryButton label="Fatto" icon="checkmark-outline" onPress={onClose} style={{ marginTop: spacing.md }} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, width: '100%', maxWidth: 608, marginBottom: spacing.sm,
    paddingVertical: 10, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  summaryText: { flex: 1, color: c.text, fontSize: 13.5, lineHeight: 18 },
  bg: { flex: 1, backgroundColor: c.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, paddingBottom: 0,
    maxHeight: '90%', width: '100%', maxWidth: 640, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  title: { color: c.text, fontSize: 20, fontWeight: '800', flex: 1 },
  label: { color: c.text, fontSize: 15, fontWeight: '800', marginTop: spacing.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1,
    borderColor: c.border, backgroundColor: c.surface },
  rowOn: { borderColor: c.primary, backgroundColor: c.primarySoft },
  name: { color: c.text, fontSize: 15, fontWeight: '600' },
  muted: { color: c.textSecondary, fontSize: 13, lineHeight: 18 },
  litersRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xs },
  input: { flex: 1, minWidth: 0, color: c.text, fontSize: 16, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.md,
    borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  budgetBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.md,
    borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  euro: { color: c.text, fontSize: 20, fontWeight: '700' },
  budgetInput: { flex: 1, minWidth: 0, color: c.text, fontSize: 20, paddingVertical: 12 },
  suggest: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: c.primarySoft },
  suggestText: { flex: 1, color: c.text, fontSize: 13, lineHeight: 18 },
  link: { color: c.primary, fontWeight: '700', fontSize: 14 },
}));
