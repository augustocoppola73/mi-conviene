import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, RankedStore } from '@/api';
import { PaperReceipt } from '@/components/PaperReceipt';
import { Card, EmptyState, Icon, PrimaryButton, SectionTitle, StoreDot } from '@/components/ui';
import { euro, km } from '@/format';
import { useStore } from '@/store';
import { makeStyles, radius, spacing, useTheme } from '@/theme';

function shortDate(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: '2-digit' });
}

export default function RisultatiScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const { lastResult, userId, items } = useStore();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ogni nuova ricerca è una nuova spesa da confermare
  useEffect(() => {
    setConfirmed(null);
    setExpanded(null);
  }, [lastResult]);

  if (!lastResult) {
    return (
      <SafeAreaView style={s.screen}>
        <View style={s.content}>
          <Text style={s.title}>Risultati</Text>
          <View style={{ marginTop: spacing.xl }}>
            <EmptyState icon="trophy-outline" text="Prepara la lista e tocca “Trova la spesa migliore”: qui vedrai dove ti conviene andare." />
          </View>
          <PrimaryButton label="Vai alla lista" variant="secondary" onPress={() => router.navigate('/')} style={{ marginTop: spacing.lg }} />
        </View>
      </SafeAreaView>
    );
  }

  const { recommended, ranked, reasoning, budget_status, fuel, price_coverage, savings, last_similar, location } = lastResult;
  const lastToday = last_similar ? ranked.find((r) => r.store_id === last_similar.store_id) : undefined;
  const others = ranked.filter((r) => r.store_id !== recommended.store_id);

  // Il risparmio lo calcola il backend contro un riferimento oggettivo (abituale o
  // spesa tipica in zona). Il budget non entra mai nel conto.
  const estimatedSaving = savings.amount;

  const confirm = async () => {
    if (!userId) return;
    setSaving(true);
    try {
      const h = await api.addHistory({ user_id: userId, items, store_id: recommended.store_id, total_cost: recommended.total_cost });
      // la voce va nel Salvadanaio anche a risparmio zero: la potrai verificare con lo scontrino vero
      await api.addSaving({
        user_id: userId,
        store_id: recommended.store_id,
        amount: Math.round(estimatedSaving * 100) / 100,
        note: savings.reference.label,
        reference_type: savings.reference.type,
        price_basis: savings.price_basis,
        history_id: h.id,
        estimated_spend: recommended.receipt.total,
        estimated_total: recommended.total_cost,
      });
      setConfirmed(recommended.store_id);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.kicker}>Ti conviene andare da</Text>
        <View style={s.heroRow}>
          <StoreDot storeId={recommended.store_id} size={20} />
          <Text style={s.title}>{recommended.store_name}</Text>
        </View>

        {recommended.branch && (
          <Text style={s.branch}>
            {recommended.branch.name}{recommended.branch.address ? ` · ${recommended.branch.address}` : ''}
          </Text>
        )}
        {location.mode === 'esempio' && (
          <View style={s.locNote}>
            <Icon name="location-outline" size={15} color={colors.warning} />
            <Text style={s.locNoteText}>
              {location.error ? `Punti vendita non disponibili (${location.error}): ` : ''}distanze di esempio. Attiva la posizione nella Lista per usare i negozi veri vicino a te.
            </Text>
          </View>
        )}

        <Card style={s.hero}>
          <Text style={s.heroTotal}>{euro(recommended.total_cost)}</Text>
          <Text style={s.heroSub}>
            spesa {euro(recommended.receipt.total)}
            {recommended.travel.fuel_cost > 0 ? ` + carburante ${euro(recommended.travel.fuel_cost)}` : ''}
            {` · ${location.mode === 'reale' ? 'circa ' : ''}${km(recommended.travel.distance_km)} · ${recommended.travel.time_min} min`}
          </Text>
          <View style={s.sourceRow}>
            <Icon name={price_coverage.real_lines > 0 ? 'checkmark-done-outline' : 'information-circle-outline'} size={15} color={colors.textSecondary} />
            <Text style={s.sourceText}>
              Prezzi reali: {price_coverage.real_lines} su {price_coverage.total_lines}
              {price_coverage.real_lines < price_coverage.total_lines ? ' · il resto è stimato' : ''}
            </Text>
          </View>
          {recommended.travel.fuel_cost > 0 && (
            <View style={s.sourceRow}>
              <Icon name="speedometer-outline" size={15} color={colors.textSecondary} />
              <Text style={s.sourceText}>
                {fuel.fuel_type[0].toUpperCase() + fuel.fuel_type.slice(1)} {fuel.price_per_liter.toLocaleString('it-IT', { minimumFractionDigits: 3 })} €/l
                {fuel.source === 'mimit' ? ` · media di ${fuel.stations} distributori, MIMIT ${shortDate(fuel.observed_at)}` : ' · valore stimato'}
              </Text>
            </View>
          )}
          <View style={s.reasonBox}>
            <Icon name="bulb-outline" size={18} color={colors.primary} />
            <Text style={s.reason}>{reasoning}</Text>
          </View>
          {last_similar && (
            <View style={s.savingBox}>
              <Icon name="time-outline" size={16} color={colors.textSecondary} />
              <Text style={s.lastText}>
                {last_similar.same_as_recommended
                  ? `Come l'ultima volta per una spesa simile: anche allora avevi scelto ${last_similar.store_name}.`
                  : `L'ultima volta, per una spesa simile, avevi scelto ${last_similar.store_name}`
                    + (!lastToday
                      ? '.'
                      : lastToday.total_cost - recommended.total_cost > 0.005
                        ? `: oggi lì spenderesti ${euro(lastToday.total_cost)}, ${euro(lastToday.total_cost - recommended.total_cost)} in più.`
                        : `: oggi lì spenderesti ${euro(lastToday.total_cost)}, ma tra viaggio e tempo non conviene.`)}
              </Text>
            </View>
          )}
          <View style={s.savingBox}>
            <Icon name="wallet-outline" size={16} color={estimatedSaving > 0 ? colors.success : colors.textSecondary} />
            <Text style={[s.savingText, estimatedSaving > 0 && { color: colors.success }]}>
              {estimatedSaving > 0
                ? `Risparmi ${euro(estimatedSaving)} ${savings.reference.label}`
                : savings.reference.type === 'habitual'
                  ? 'Resti nel tuo supermercato abituale: nessun risparmio da aggiungere'
                  : 'Nessun risparmio rispetto alla spesa tipica in zona'}
              {estimatedSaving > 0 && savings.price_basis !== 'reale' ? ' · stima, da verificare con lo scontrino' : ''}
            </Text>
          </View>
          {savings.promo_savings > 0 && (
            <Text style={s.promoNote}>
              Le promozioni ti fanno risparmiare {euro(savings.promo_savings)} sul prezzo pieno (non conteggiate nel Salvadanaio)
            </Text>
          )}
          {budget_status && (
            <View style={[s.budgetBadge, { backgroundColor: budget_status.status === 'ok' ? colors.primarySoft : colors.danger + '22' }]}>
              <Icon
                name={budget_status.status === 'ok' ? 'checkmark-circle' : 'alert-circle'}
                size={16}
                color={budget_status.status === 'ok' ? colors.success : colors.danger}
              />
              <Text style={[s.budgetText, { color: budget_status.status === 'ok' ? colors.success : colors.danger }]}>
                {budget_status.status === 'ok'
                  ? `Dentro il budget: avanzano ${euro(budget_status.diff)}`
                  : `Sopra il budget di ${euro(-budget_status.diff)}`}
              </Text>
            </View>
          )}
          {budget_status?.status === 'over' && (
            <Text style={s.promoNote}>
              {budget_status.alternative
                ? `Per stare nel budget: ${budget_status.alternative.store_name} a ${euro(budget_status.alternative.total_cost)}`
                : 'Nessun supermercato rientra nel budget con questa lista: prova a togliere qualcosa.'}
            </Text>
          )}
          <ReceiptToggle store={recommended} expanded={expanded === recommended.store_id} onToggle={() => setExpanded(expanded === recommended.store_id ? null : recommended.store_id)} />
        </Card>

        <PrimaryButton
          label={confirmed === recommended.store_id ? 'Spesa confermata' : 'Confermo questa spesa'}
          icon={confirmed === recommended.store_id ? 'checkmark-circle' : 'cart-outline'}
          onPress={confirm}
          loading={saving}
          disabled={confirmed === recommended.store_id}
          style={{ marginTop: spacing.lg }}
        />
        {confirmed === recommended.store_id && (
          <Text style={s.confirmNote}>
            {estimatedSaving > 0 ? `Aggiunti ${euro(estimatedSaving)} al Salvadanaio 🐷` : 'Spesa registrata nel Salvadanaio'}
            {'\n'}Dopo la spesa, verificala lì con il totale dello scontrino.
          </Text>
        )}

        <SectionTitle>Le alternative</SectionTitle>
        <View style={{ gap: spacing.sm }}>
          {others.map((r) => (
            <Card key={r.store_id} style={{ padding: spacing.md }}>
              <View style={s.altRow}>
                <StoreDot storeId={r.store_id} size={14} />
                <Text style={s.altName}>{r.store_name}</Text>
                <Text style={s.altTotal}>{euro(r.total_cost)}</Text>
              </View>
              {r.branch && <Text style={s.altMeta}>{r.branch.name}{r.branch.address ? ` · ${r.branch.address}` : ''}</Text>}
              <Text style={s.altMeta}>
                spesa {euro(r.receipt.total)} · carburante {euro(r.travel.fuel_cost)} · {km(r.travel.distance_km)} · {r.travel.time_min} min
              </Text>
              <DeltaBadge delta={r.total_cost - recommended.total_cost} />
              <ReceiptToggle store={r} expanded={expanded === r.store_id} onToggle={() => setExpanded(expanded === r.store_id ? null : r.store_id)} />
            </Card>
          ))}
        </View>
        {location.mode === 'reale' && (location.missing_chains.length > 0 || location.habitual_missing) && (
          <Text style={s.missing}>
            {location.missing_chains.length > 0
              ? `Nessun punto vendita ${location.missing_chains.join(', ')} entro ${location.radius_km ?? 6} km: esclusi dal confronto.`
              : ''}
            {location.habitual_missing ? ` Il tuo abituale (${location.habitual_missing}) non è vicino: non l'ho usato come riferimento.` : ''}
          </Text>
        )}
        {location.mode === 'reale' && (
          <Text style={s.missing}>Punti vendita © OpenStreetMap. Distanze in linea d'aria × 1,3 (stima del percorso stradale).</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function DeltaBadge({ delta }: { delta: number }) {
  const s = useStyles();
  const { colors } = useTheme();
  const cheaper = delta < -0.005;
  return (
    <Text style={[s.delta, { color: cheaper ? colors.success : colors.textSecondary }]}>
      {cheaper ? `${euro(-delta)} in meno, ma non vale il cambio` : `${euro(Math.max(0, delta))} in più`}
    </Text>
  );
}

function ReceiptToggle({ store, expanded, onToggle }: { store: RankedStore; expanded: boolean; onToggle: () => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <View style={{ marginTop: spacing.sm }}>
      <Pressable onPress={onToggle} style={s.toggle} hitSlop={6}>
        <Icon name="receipt-outline" size={16} color={colors.primary} />
        <Text style={s.toggleText}>{expanded ? 'Nascondi scontrino' : 'Vedi scontrino virtuale'}</Text>
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.primary} />
      </Pressable>
      {expanded && <PaperReceipt store={store} />}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.background },
  content: { width: '100%', maxWidth: 640, alignSelf: 'center', padding: spacing.lg, paddingBottom: spacing.xxl },
  kicker: { color: c.textSecondary, fontSize: 14 },
  title: { color: c.text, fontSize: 28, fontWeight: '800' },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  hero: { marginTop: spacing.lg, backgroundColor: c.surfaceSecondary, borderColor: c.surfaceSecondary },
  heroTotal: { color: c.text, fontSize: 36, fontWeight: '800' },
  heroSub: { color: c.textSecondary, fontSize: 13, marginTop: 2 },
  reasonBox: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, backgroundColor: c.surface, padding: spacing.md, borderRadius: radius.md },
  reason: { flex: 1, color: c.text, fontSize: 14, lineHeight: 20 },
  budgetBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill },
  budgetText: { fontSize: 13, fontWeight: '600' },
  confirmNote: { color: c.success, textAlign: 'center', marginTop: spacing.sm, fontSize: 14 },
  altRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  altName: { flex: 1, color: c.text, fontSize: 16, fontWeight: '600' },
  altTotal: { color: c.text, fontSize: 16, fontWeight: '700' },
  altMeta: { color: c.textSecondary, fontSize: 12, marginTop: 4 },
  delta: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toggleText: { color: c.primary, fontSize: 13, fontWeight: '600' },
  receipt: { marginTop: spacing.sm, gap: spacing.sm, borderTopWidth: 1, borderTopColor: c.border, paddingTop: spacing.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  confDot: { width: 8, height: 8, borderRadius: 4 },
  lineName: { color: c.text, fontSize: 14 },
  lineMeta: { color: c.textSecondary, fontSize: 12 },
  lineStrike: { color: c.textSecondary, fontSize: 12, textDecorationLine: 'line-through' },
  linePrice: { color: c.text, fontSize: 14, fontWeight: '600', minWidth: 60, textAlign: 'right' },
  receiptTotal: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: c.border, paddingTop: spacing.sm },
  savingBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: spacing.md },
  savingText: { flex: 1, color: c.textSecondary, fontSize: 13, fontWeight: '600' },
  branch: { color: c.textSecondary, fontSize: 13, marginTop: 2 },
  locNote: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: spacing.sm },
  locNoteText: { flex: 1, color: c.warning, fontSize: 12, lineHeight: 17 },
  missing: { color: c.textSecondary, fontSize: 12, marginTop: spacing.md, lineHeight: 17 },
  lastText: { flex: 1, color: c.textSecondary, fontSize: 13, lineHeight: 18 },
  promoNote: { color: c.textSecondary, fontSize: 12, marginTop: 6 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  sourceText: { flex: 1, color: c.textSecondary, fontSize: 12 },
  estimate: { color: c.textSecondary, fontSize: 11, fontStyle: 'italic' },
  real: { color: c.success, fontSize: 11, fontWeight: '600' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
}));
