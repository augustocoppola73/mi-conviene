import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, RankedStore } from '@/api';
import { SmartSuggestions } from '@/components/SmartSuggestions';
import { PaperReceipt } from '@/components/PaperReceipt';
import { Card, EmptyState, Icon, PrimaryButton, SectionTitle, StoreDot } from '@/components/ui';
import { euro, km } from '@/format';
import { useStore } from '@/store';
import { optimizeRequest } from '@/optimizeRequest';
import { groupSpend, mergeShopping } from '@/groupShare';
import { openNavigation } from '@/navigate';
import { metersBetween, quietPosition } from '@/location';
import { ParkingLine } from '@/components/ParkingLine';
import { BrandLogo, fuelDomain } from '@/components/BrandLogo';
import { makeStyles, radius, spacing, useTheme } from '@/theme';

function shortDate(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: '2-digit' });
}

export default function RisultatiScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const { lastResult, setLastResult, userId, items, prefs, setPrefs, catalog, clearItems, groupMine, reloadGroupMine } = useStore();
  const [ruleMsg, setRuleMsg] = useState<string | null>(null);
  const [carBusy, setCarBusy] = useState(false);
  const [shopError, setShopError] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [refStore, setRefStore] = useState<string | null>(null); // negozio di confronto scelto alla conferma
  const [addedAmount, setAddedAmount] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // #25: decido io dove fare la spesa (di base il consigliato)
  const [chosenId, setChosenId] = useState<string | null>(null);
  // #25: sono già dentro un supermercato della classifica?
  const [hereId, setHereId] = useState<string | null>(null);

  // ogni nuova ricerca è una nuova spesa da confermare
  useEffect(() => {
    setConfirmed(null);
    setRuleMsg(null);
    setExpanded(null);
    setAddedAmount(null);
    setAskOpen(false);
    setChosenId(null);
    setHereId(null);
    if (!lastResult) return;
    let alive = true;
    quietPosition(6000).then((pos) => {
      if (!alive || !pos) return;
      const near = lastResult.ranked
        .filter((r) => r.branch && metersBetween(pos, r.branch) <= 120)
        .sort((a, b) => metersBetween(pos, a.branch!) - metersBetween(pos, b.branch!))[0];
      if (near) setHereId(near.store_id);
    });
    return () => { alive = false; };
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

  const { recommended, ranked, reasoning, budget_status, fuel, price_coverage, savings, last_similar, location, split, split_note, car_hint } = lastResult;
  // preferiti validi qui (#19); la versione sul computer conosce solo l'abituale
  const favIds: string[] = location.favorites_here
    ?? (location.habitual_far || !prefs.favorites[0] ? [] : [prefs.favorites[0].store_id]);
  const isFav = (id: string) => favIds.includes(id);
  const lim = location.distance_limit;
  const how = lim?.transport === 'walk' ? 'a piedi' : 'in bici';
  const kmTxt = (x: number) => `${String(x).replace('.', ',')} km`;
  // regole per reparto create da qui (#20): "📌 Sempre qui"
  const rules = prefs.categoryRules ?? {};
  const catOf = (id: string) => catalog?.categories.find((c) => c.id === id);
  const toggleRule = (cat: string, store: string, storeName: string) => {
    const next = { ...rules };
    const name = catOf(cat)?.name ?? cat;
    if (next[cat] === store) { delete next[cat]; setRuleMsg(`Regola tolta: ${name} di nuovo dove conviene.`); }
    else { next[cat] = store; setRuleMsg(`📌 ${name} sempre da ${storeName}: vale dalla prossima ricerca.`); }
    setPrefs({ categoryRules: next });
  };
  const usedRules = split ? Object.entries(rules).filter(([, st]) => split.stops.some((x) => x.store_id === st)) : [];
  const dropUsedRules = () => {
    const next = { ...rules };
    for (const [c] of usedRules) delete next[c];
    setPrefs({ categoryRules: next });
    setRuleMsg('Regole tolte: dalla prossima ricerca divido dove conviene.');
  };
  const tryCar = async () => {
    if (!userId) return;
    setCarBusy(true);
    try { setLastResult(await api.optimize(optimizeRequest(userId, mergeShopping(items, groupMine), prefs, prefs.location, 'car'))); }
    catch (e) { globalThis.alert?.((e as Error).message); }
    finally { setCarBusy(false); }
  };
  const lastToday = last_similar ? ranked.find((r) => r.store_id === last_similar.store_id) : undefined;
  const others = ranked.filter((r) => r.store_id !== recommended.store_id);
  // parcheggio: se il consigliato non ha il parcheggio clienti e un'alternativa quasi uguale sì, lo segnalo (scegli tu)
  const recPark = recommended.branch?.parking;
  const parkAlt = recPark && recPark.kind !== 'clienti'
    ? others.find((r) => r.branch?.parking?.kind === 'clienti' && r.total_cost - recommended.total_cost <= Math.max(3, prefs.minSavingsThreshold))
    : undefined;
  const parkingHint = parkAlt
    ? `${parkAlt.store_name} costa ${euro(parkAlt.total_cost - recommended.total_cost)} in più ma ha il parcheggio clienti; ` +
      `${recommended.store_name} ${recPark!.kind === 'pubblico' ? 'ha solo un parcheggio pubblico vicino' : 'non ha parcheggi segnati sulla mappa'}. Scegli tu.`
    : null;

  // Il risparmio lo calcola il backend contro un riferimento oggettivo (abituale o
  // spesa tipica in zona). Il budget non entra mai nel conto.
  const chosen = (chosenId && ranked.find((r) => r.store_id === chosenId)) || recommended;
  const isRec = chosen.store_id === recommended.store_id;
  const estimatedSaving = isRec ? savings.amount : Math.max(0, Math.round((savings.reference_cost - chosen.total_cost) * 100) / 100);
  const stop = chosen.fuel_stop;
  const fuelSaving = stop ? (isRec ? savings.fuel_saving : stop.saving) : 0;
  // quanto costa in più del consigliato (viaggio incluso)
  const extraVsRec = Math.round((chosen.total_cost - recommended.total_cost) * 100) / 100;
  const hereStore = hereId ? ranked.find((r) => r.store_id === hereId) : undefined;

  // Risparmio rispetto al negozio scelto alla conferma ("dove saresti andato di solito").
  // null = spesa tipica in zona (mediana): è quello calcolato dal backend.
  const refRow = refStore ? ranked.find((r) => r.store_id === refStore) : undefined;
  const shopSaving = refRow
    ? Math.max(0, Math.round((refRow.total_cost - chosen.total_cost) * 100) / 100)
    : estimatedSaving;
  const refLabel = refRow ? `rispetto a ${refRow.store_name}` : savings.reference.label;

  const openConfirm = (storeId?: string) => {
    setChosenId(storeId ?? null);
    // di solito saresti andato nel migliore dei tuoi preferiti (quello usato per il confronto)
    const favHere = savings.reference.type === 'habitual' ? savings.reference.store_id : null;
    setRefStore(favHere ?? null);
    setAskOpen(true);
  };

  const confirm = async (addToPiggyBank: boolean) => {
    if (!userId) return;
    setSaving(true);
    try {
      // #21: i prodotti presi per i gruppi vanno nella stessa spesa ma NON nel Salvadanaio (sono dei conti del gruppo)
      const merged = mergeShopping(items, groupMine);
      const gSpend = groupSpend(chosen.receipt.lines, merged);
      const share = chosen.receipt.total > 0 ? Math.max(0, 1 - gSpend / chosen.receipt.total) : 1;
      const h = await api.addHistory({ user_id: userId, items, store_id: chosen.store_id, total_cost: Math.round((chosen.total_cost - gSpend) * 100) / 100 });
      const amount = addToPiggyBank ? Math.round((shopSaving * share + fuelSaving) * 100) / 100 : 0;
      // la voce va comunque nel Salvadanaio (anche a zero) per poterla verificare con lo scontrino vero
      const listAtConfirm = merged;
      const entry = await api.addSaving({
        user_id: userId,
        store_id: chosen.store_id,
        // stima totale = spesa + pieno sulla strada (la parte pieno si azzera se alla verifica dici che non l'hai fatto)
        amount,
        note: (addToPiggyBank ? refLabel : 'spesa registrata senza risparmio') + (!isRec ? ` · scelto da me (consigliato ${recommended.store_name})` : '') + (gSpend > 0 ? ` · senza i ${euro(gSpend)} per i gruppi` : ''),
        reference_type: refRow ? 'habitual' : savings.reference.type,
        price_basis: savings.price_basis,
        history_id: h.id,
        estimated_spend: Math.round((chosen.receipt.total - gSpend) * 100) / 100,
        estimated_total: Math.round((chosen.total_cost - gSpend) * 100) / 100,
        snapshot: chosen, // lo scontrino virtuale di oggi, per rivederlo nello storico
        ...(stop && addToPiggyBank ? {
          fuel_saving: fuelSaving, fuel_liters: stop.liters, fuel_median: stop.median,
          fuel_detour_cost: stop.detour_cost, fuel_station: `${stop.brand}, ${stop.address}`,
        } : {}),
      });
      setAddedAmount(amount);
      setConfirmed(chosen.store_id);
      setAskOpen(false);
      // la lista diventa la "spesa in corso" da smarcare in negozio; la Lista in home si svuota
      try {
        await api.shopCreate({
          user_id: userId, store_id: chosen.store_id, saving_id: entry.id,
          branch: chosen.branch ? [chosen.branch.name, chosen.branch.address].filter(Boolean).join(' · ') : null,
          display_name: prefs.displayName || null,
          items: listAtConfirm.map((i) => ({ product_id: i.product_id, quantity: i.quantity, name: i.name ?? null, category_id: i.category_id ?? null, unit: i.unit ?? null,
            groups: i.groups })),
        });
        clearItems();
        reloadGroupMine();
        setShopError(null);
      } catch (e) {
        setShopError((e as Error).message);
      }
    } finally {
      setSaving(false);
    }
  };

  // #2: spesa in due negozi. Il risparmio va nel Salvadanaio contro lo stesso riferimento del calcolo (abituale o spesa tipica)
  const splitSaving = split ? Math.max(0, Math.round((savings.reference_cost - split.total_cost) * 100) / 100) : 0;
  const confirmSplit = async () => {
    if (!userId || !split) return;
    setSaving(true);
    try {
      const names = split.stops.map((st) => st.store_name).join(' e ');
      const first = split.stops[0];
      const merged = mergeShopping(items, groupMine);
      const gSpend = groupSpend(split.stops.flatMap((st) => st.lines), merged);
      const share = split.items_total > 0 ? Math.max(0, 1 - gSpend / split.items_total) : 1;
      const h = await api.addHistory({ user_id: userId, items, store_id: first.store_id, total_cost: Math.round((split.total_cost - gSpend) * 100) / 100 });
      const entry = await api.addSaving({
        user_id: userId, store_id: first.store_id, store_name: names, amount: Math.round(splitSaving * share * 100) / 100,
        note: (splitSaving > 0 ? `${savings.reference.label} · spesa in due negozi` : 'spesa in due negozi') + (gSpend > 0 ? ` · senza i ${euro(gSpend)} per i gruppi` : ''),
        reference_type: savings.reference.type, price_basis: savings.price_basis, history_id: h.id,
        estimated_spend: Math.round((split.items_total - gSpend) * 100) / 100, estimated_total: Math.round((split.total_cost - gSpend) * 100) / 100,
        snapshot: { store_id: first.store_id, store_name: names, split: true, stops: split.stops, travel: split.travel, total_cost: split.total_cost,
          receipt: { lines: split.stops.flatMap((st) => st.lines), total: split.items_total } },
      });
      setAddedAmount(Math.round(splitSaving * share * 100) / 100);
      setConfirmed('split');
      const stopOf = new Map(split.stops.flatMap((st, k) => st.lines.map((l) => [l.product_id, k] as const)));
      try {
        await api.shopCreate({
          user_id: userId, store_id: first.store_id, saving_id: entry.id,
          branch: first.branch ? [first.branch.name, first.branch.address].filter(Boolean).join(' · ') : null,
          display_name: prefs.displayName || null,
          stops: split.stops.map((st) => ({ store_id: st.store_id, store_name: st.store_name,
            branch: st.branch ? [st.branch.name, st.branch.address].filter(Boolean).join(' · ') : null,
            lat: st.branch?.lat ?? null, lon: st.branch?.lon ?? null, parking: st.branch?.parking ?? null })),
          items: merged.map((i) => ({ product_id: i.product_id, quantity: i.quantity, name: i.name ?? null, category_id: i.category_id ?? null,
            unit: i.unit ?? null, stop: stopOf.get(i.product_id) ?? 0, groups: i.groups })),
        });
        clearItems();
        reloadGroupMine();
        setShopError(null);
      } catch (e) { setShopError((e as Error).message); }
    } finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <ScrollView contentContainerStyle={s.content}>
        {hereStore && !confirmed && (
          <Card style={[s.hereBox, { borderColor: colors.primary }]}>
            <Text style={s.hereTitle}>📍 Sei da {hereStore.store_name}: fai la spesa qui?</Text>
            {hereStore.store_id !== recommended.store_id && (
              <Text style={s.modalSmall}>
                {hereStore.total_cost > recommended.total_cost
                  ? `Costa ${euro(hereStore.total_cost - recommended.total_cost)} in più di ${recommended.store_name}, ma sei già qui.`
                  : `Conviene quanto ${recommended.store_name}.`}
              </Text>
            )}
            <PrimaryButton label={`Faccio la spesa da ${hereStore.store_name}`} icon="cart-outline"
              onPress={() => openConfirm(hereStore.store_id)} style={{ marginTop: spacing.sm }} />
          </Card>
        )}
        <Text style={s.kicker}>Ti conviene andare da</Text>
        <View style={s.heroRow}>
          <StoreDot storeId={recommended.store_id} size={20} />
          <Text style={s.title}>{recommended.store_name}</Text>
        </View>

        {recommended.branch && (
          <>
            <Text style={s.branch}>
              {recommended.branch.name}{recommended.branch.address ? ` · ${recommended.branch.address}` : ''}
            </Text>
            <ParkingLine parking={recommended.branch.parking} />
            <PrimaryButton label="Portami lì" icon="navigate" variant="secondary" style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}
              onPress={() => openNavigation(recommended.branch!.lat, recommended.branch!.lon, recommended.branch!.name)} />
          </>
        )}
        {parkingHint && (
          <View style={s.locNote}>
            <Text style={s.locNoteText}>🅿️ {parkingHint}</Text>
          </View>
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
          {(recommended.receipt.custom_items?.length ?? 0) > 0 && (() => {
            const cs = recommended.receipt.custom_items;
            const known = cs.filter((c) => c.price != null).length;
            return (
              <Text style={s.heroSub}>
                ✍️ Scritti a mano: {known > 0 ? `+ ${euro(recommended.receipt.custom_total ?? 0)} visti da te qui` : ''}
                {known > 0 && known < cs.length ? ' · ' : ''}
                {known < cs.length ? `${cs.length - known} da verificare sul posto` : ''} (fuori dal confronto)
              </Text>
            );
          })()}
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
          {car_hint && lim && (
            <Pressable onPress={tryCar} disabled={carBusy} style={s.savingBox} accessibilityRole="button">
              <Icon name="car-outline" size={16} color={colors.primary} />
              <Text style={[s.lastText, { color: colors.text }]}>
                Se prendi l'auto: da <Text style={{ fontWeight: '700' }}>{car_hint.store_name}</Text> ({kmTxt(car_hint.distance_km)}) risparmi{' '}
                <Text style={{ fontWeight: '700', color: colors.success }}>{euro(car_hint.saving)}</Text>, carburante compreso ({euro(car_hint.fuel_cost)}).
                <Text style={{ color: colors.primary, fontWeight: '700' }}>{carBusy ? '  Calcolo…' : '  Vedi in auto ›'}</Text>
              </Text>
            </Pressable>
          )}
          {!split && split_note && (
            <View style={s.savingBox}>
              <Icon name="git-branch-outline" size={16} color={colors.textSecondary} />
              <Text style={s.lastText}>{split_note}</Text>
            </View>
          )}
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
          {stop && (
            <Pressable onPress={() => Linking.openURL(stop.maps_url)} style={s.fuelStop}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <BrandLogo domain={fuelDomain(stop.brand)} color="#5B6470" size={20} />
                <Text style={[s.fuelStopTitle, { flex: 1 }]}>Sulla strada: {stop.brand} · {stop.price.toLocaleString('it-IT', { minimumFractionDigits: 3 })} €/l</Text>
              </View>
              <Text style={s.fuelStopText}>
                {stop.address}{stop.city ? `, ${stop.city}` : ''} · deviazione circa {stop.detour_km.toLocaleString('it-IT')} km
              </Text>
              <Text style={s.fuelStopText}>
                Pieno da {stop.liters.toLocaleString('it-IT')} l: {euro(stop.fill_cost)} · risparmi {euro(stop.saving)} rispetto alla media
                ({stop.median.toLocaleString('it-IT', { minimumFractionDigits: 3 })} €/l), deviazione inclusa
              </Text>
              <Text style={s.fuelStopLink}>Portami lì ↗</Text>
              {!!stop.alternatives?.length && (
                <View style={{ marginTop: 6, gap: 2 }}>
                  <Text style={s.fuelStopText}>Altri sulla strada (prezzi self comunicati al Ministero):</Text>
                  {stop.alternatives.map((a) => (
                    <Pressable key={a.maps_url} onPress={() => Linking.openURL(a.maps_url)} hitSlop={4}>
                      <Text style={s.fuelStopText}>
                        · {a.brand}, {a.address} · {a.price.toLocaleString('it-IT', { minimumFractionDigits: 3 })} €/l ·{' '}
                        {a.extra_cost >= 0.01 ? `+${euro(a.extra_cost)} sul pieno` : 'stesso costo'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </Pressable>
          )}
          <View style={s.savingBox}>
            <Icon name="wallet-outline" size={16} color={estimatedSaving > 0 ? colors.success : colors.textSecondary} />
            <Text style={[s.savingText, estimatedSaving > 0 && { color: colors.success }]}>
              {estimatedSaving > 0
                ? `Risparmi ${euro(estimatedSaving)} ${savings.reference.label}`
                : savings.reference.type === 'habitual'
                  ? 'Resti nel tuo supermercato preferito: nessun risparmio da aggiungere'
                  : 'Nessun risparmio rispetto alla spesa tipica in zona'}
              {estimatedSaving > 0 && savings.price_basis !== 'reale' ? ' · stima, da verificare con lo scontrino' : ''}
            </Text>
          </View>
          {stop && fuelSaving > 0 && (
            <Text style={[s.savingText, { color: colors.success, marginTop: 4, marginLeft: 22 }]}>
              + {euro(fuelSaving)} sul pieno, se lo fai lì (lo confermi alla verifica)
            </Text>
          )}
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

        {split && (
          <Card style={s.splitCard}>
            <View style={s.altRow}>
              <Icon name="git-branch-outline" size={20} color={colors.primary} />
              <Text style={[s.altName, { flex: 1 }]}>Conviene dividere in due negozi</Text>
            </View>
            <Text style={s.splitTotal}>{euro(split.total_cost)}
              <Text style={s.splitSave}>  · {euro(split.saving)} in meno di {split.vs.store_name}</Text>
            </Text>
            <Text style={s.altMeta}>
              spesa {euro(split.items_total)}{split.travel.fuel_cost > 0 ? ` + carburante ${euro(split.travel.fuel_cost)}` : ''} · giro di {km(split.travel.distance_km)}
              {' · '}{split.travel.time_min} min{split.extra_min > 0 ? ` (${split.extra_min} in più)` : ''}
            </Text>
            {split.stops.map((st, k) => (
              <View key={st.store_id} style={s.splitStop}>
                <View style={s.altRow}>
                  <StoreDot storeId={st.store_id} size={14} />
                  <Text style={[s.altName, { flex: 1 }]}>{k + 1}. {st.store_name}</Text>
                  <Text style={s.altTotal}>{euro(st.subtotal)}</Text>
                </View>
                {st.branch && (
                  <Pressable onPress={() => openNavigation(st.branch.lat, st.branch.lon, st.branch.name)} hitSlop={4} style={s.altNav}>
                    <Text style={[s.altMeta, { flex: 1 }]} numberOfLines={1}>{st.branch.name}{st.branch.address ? ` · ${st.branch.address}` : ''}</Text>
                    <Icon name="navigate" size={14} color={colors.primary} />
                    <Text style={s.altNavText}>Portami lì</Text>
                  </Pressable>
                )}
                {st.branch && <ParkingLine parking={st.branch.parking} size={12} />}
                <Text style={s.altMeta} numberOfLines={3}>
                  {st.lines.length} {st.lines.length === 1 ? 'prodotto' : 'prodotti'}: {st.lines.map((l) => l.name).join(', ')}
                </Text>
                {st.by_rule > 0 && <Text style={s.altMeta}>📌 {st.by_rule} per le tue regole</Text>}
                {confirmed !== 'split' && (
                  <View style={s.ruleRow}>
                    <Text style={s.altMeta}>Sempre qui:</Text>
                    {[...new Set(st.lines.map((l) => l.category_id).filter((c): c is string => !!c && c !== 'altro'))].map((c) => {
                      const on = rules[c] === st.store_id;
                      return (
                        <Pressable key={c} onPress={() => toggleRule(c, st.store_id, st.store_name)} hitSlop={4}
                          style={[s.ruleChip, on && s.ruleChipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}
                          accessibilityLabel={`${catOf(c)?.name ?? c} sempre da ${st.store_name}`}>
                          <Text style={[s.ruleChipText, on && s.ruleChipTextOn]}>{on ? '📌 ' : ''}{catOf(c)?.emoji ?? ''} {catOf(c)?.name ?? c}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
            ))}
            {split.rules_cost > 0 && (
              <Text style={s.altMeta}>
                📌 Le tue regole ({usedRules.map(([c, st]) => `${catOf(c)?.name ?? c} → ${split.stops.find((x) => x.store_id === st)?.store_name ?? st}`).join(', ')}) oggi costano{' '}
                <Text style={{ fontWeight: '700' }}>{euro(split.rules_cost)}</Text> in più rispetto a dividere liberamente.{'  '}
                <Text onPress={dropUsedRules} style={{ color: colors.primary, fontWeight: '700' }}>Togli</Text>
              </Text>
            )}
            {ruleMsg && <Text style={[s.altMeta, { color: colors.primary }]}>{ruleMsg}</Text>}
            {confirmed === 'split' ? (
              <Text style={s.confirmNote}>
                {addedAmount && addedAmount > 0 ? `Aggiunti ${euro(addedAmount)} al Salvadanaio 🐷` : 'Spesa registrata nel Salvadanaio'}
                {'\n'}La lista è pronta, divisa per negozio.
              </Text>
            ) : (
              <PrimaryButton label="Usa due negozi" icon="git-branch-outline" onPress={confirmSplit} loading={saving}
                disabled={!!confirmed} style={{ marginTop: spacing.sm }} />
            )}
            {confirmed === 'split' && !shopError && (
              <PrimaryButton label="Vai alla spesa in corso" icon="basket-outline" onPress={() => router.push('/spesa')} style={{ marginTop: spacing.sm }} />
            )}
          </Card>
        )}

        <PrimaryButton
          label={confirmed === recommended.store_id ? 'Spesa confermata' : split ? `Resto in un negozio: ${recommended.store_name}` : 'Confermo questa spesa'}
          icon={confirmed === recommended.store_id ? 'checkmark-circle' : 'cart-outline'}
          onPress={() => openConfirm()}
          disabled={!!confirmed}
          style={{ marginTop: spacing.lg }}
        />
        {!!confirmed && confirmed !== 'split' && (
          <Text style={s.confirmNote}>
            {confirmed !== recommended.store_id ? `Spesa da ${chosen.store_name} confermata.\n` : ''}
            {addedAmount && addedAmount > 0 ? `Aggiunti ${euro(addedAmount)} al Salvadanaio 🐷` : 'Spesa registrata nel Salvadanaio'}
            {'\n'}La lista è pronta da smarcare in negozio.
          </Text>
        )}
        {!!confirmed && confirmed !== 'split' && !shopError && (
          <PrimaryButton label="Vai alla spesa in corso" icon="basket-outline" onPress={() => router.push('/spesa')} style={{ marginTop: spacing.sm }} />
        )}
        {shopError && <Text style={[s.confirmNote, { color: colors.danger }]}>Non riesco a preparare la spesa in corso: {shopError}</Text>}

        <SmartSuggestions
          items={items}
          storeId={recommended.store_id}
          budget={budget_status?.budget ?? null}
          spent={budget_status ? budget_status.spend : null}
          onListChanged={() => {}}
        />

        <SectionTitle>Le alternative</SectionTitle>
        <View style={{ gap: spacing.sm }}>
          {others.map((r) => (
            <Card key={r.store_id} style={{ padding: spacing.md }}>
              <View style={s.altRow}>
                <StoreDot storeId={r.store_id} size={14} />
                <Text style={s.altName}>{r.store_name}</Text>
                <Text style={s.altTotal}>{euro(r.total_cost)}</Text>
              </View>
              {r.branch && (
                <Pressable onPress={() => openNavigation(r.branch!.lat, r.branch!.lon, r.branch!.name)} hitSlop={4} style={s.altNav}>
                  <Text style={[s.altMeta, { flex: 1 }]}>{r.branch.name}{r.branch.address ? ` · ${r.branch.address}` : ''}</Text>
                  <Icon name="navigate" size={14} color={colors.primary} />
                  <Text style={s.altNavText}>Portami lì</Text>
                </Pressable>
              )}
              {r.branch && <ParkingLine parking={r.branch.parking} size={12} />}
              <Text style={s.altMeta}>
                spesa {euro(r.receipt.total)} · carburante {euro(r.travel.fuel_cost)} · {km(r.travel.distance_km)} · {r.travel.time_min} min
              </Text>
              {r.fuel_stop && (
                <Text style={s.altMeta}>⛽ sulla strada {r.fuel_stop.brand} {r.fuel_stop.price.toLocaleString('it-IT', { minimumFractionDigits: 3 })} €/l · −{euro(r.fuel_stop.saving)} sul pieno</Text>
              )}
              <DeltaBadge delta={r.effective_cost - recommended.effective_cost} />
              <ReceiptToggle store={r} expanded={expanded === r.store_id} onToggle={() => setExpanded(expanded === r.store_id ? null : r.store_id)} />
              {confirmed === r.store_id ? (
                <Text style={[s.confirmNote, { marginTop: spacing.xs }]}>✓ Fai la spesa qui</Text>
              ) : (
                <PrimaryButton label="Faccio la spesa qui" icon="cart-outline" variant="secondary" disabled={!!confirmed}
                  onPress={() => openConfirm(r.store_id)} style={{ marginTop: spacing.sm }} />
              )}
            </Card>
          ))}
        </View>
        {location.habitual_far && !location.favorites_far && (
          <Text style={s.missing}>
            📍 Sei lontano dal tuo {location.habitual_far}: qui ti consiglio il negozio più conveniente della zona, senza preferire la catena abituale.
          </Text>
        )}
        {location.favorites_far && (
          <Text style={s.missing}>
            {favIds.length
              ? `⭐ Non ho usato come riferimento ${location.favorites_far.join(', ')}: ${lim ? `oltre ${kmTxt(lim.km)} ${how} o ` : ''}non qui vicino.`
              : `📍 Sei lontano dai tuoi preferiti (${location.favorites_far.join(', ')}): ti consiglio il negozio più conveniente dove ti trovi.`}
          </Text>
        )}
        {lim && (lim.none_within || lim.excluded.length > 0) && (
          <Text style={s.missing}>
            {lim.none_within
              ? `🚶 Nessun supermercato entro ${kmTxt(lim.km)} ${how}: ti mostro i più vicini. Forse conviene l'auto.`
              : `🚶 Sei ${how}: considero solo i negozi entro ${kmTxt(lim.km)}. Esclusi: ${lim.excluded.join(', ')}.`}
          </Text>
        )}
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

      <Modal visible={askOpen} transparent animationType="fade" onRequestClose={() => setAskOpen(false)}>
        <View style={s.modalBg}>
          <Card style={s.modal}>
            <Text style={s.modalTitle}>Confermi la spesa da {chosen.store_name}?</Text>
            {!isRec && (
              <Text style={[s.modalText, { marginBottom: spacing.sm }]}>
                {extraVsRec > 0
                  ? `${chosen.store_name} costa ${euro(extraVsRec)} in più di ${recommended.store_name} (viaggio incluso). Va bene: decidi tu.`
                  : `Costa quanto ${recommended.store_name}.`}
              </Text>
            )}
            <Text style={s.modalText}>Rispetto a dove saresti andato di solito?</Text>
            <View style={s.refWrap}>
              {ranked.map((r) => (
                <Pressable key={r.store_id} onPress={() => setRefStore(r.store_id)} style={[s.refChip, refStore === r.store_id && s.refChipOn]}>
                  <StoreDot storeId={r.store_id} size={12} />
                  <Text style={[s.refText, refStore === r.store_id && s.refTextOn]}>
                    {r.store_name}{isFav(r.store_id) ? ' (preferito)' : ''}
                  </Text>
                </Pressable>
              ))}
              <Pressable onPress={() => setRefStore(null)} style={[s.refChip, refStore === null && s.refChipOn]}>
                <Text style={[s.refText, refStore === null && s.refTextOn]}>Non saprei (spesa tipica in zona)</Text>
              </Pressable>
            </View>

            <View style={s.preview}>
              {refRow && refRow.store_id !== chosen.store_id ? (
                <Text style={s.modalText}>
                  Da {refRow.store_name} avresti speso {euro(refRow.total_cost)}, qui {euro(chosen.total_cost)} (viaggio incluso).
                </Text>
              ) : refRow ? (
                <Text style={s.modalText}>È proprio il negozio dove vai di solito: nessun risparmio da aggiungere.</Text>
              ) : (
                <Text style={s.modalText}>Confronto con la spesa tipica in zona (mediana delle catene).</Text>
              )}
              <Text style={s.previewValue}>
                {shopSaving > 0 ? `Risparmi ${euro(shopSaving)}` : 'Nessun risparmio'}
                {fuelSaving > 0 ? ` + ${euro(fuelSaving)} sul pieno (da verificare)` : ''}
              </Text>
              {refRow && isRec && refRow.total_cost < recommended.total_cost && (
                <Text style={s.modalSmall}>{refRow.store_name} costerebbe meno in euro, ma tra strada e tempo non conviene.</Text>
              )}
            </View>


            <PrimaryButton
              label={shopSaving + fuelSaving > 0 ? `Conferma e aggiungi ${euro(shopSaving + fuelSaving)}` : 'Conferma la spesa'}
              icon="wallet-outline"
              loading={saving}
              onPress={() => confirm(shopSaving + fuelSaving > 0)}
            />
            {shopSaving + fuelSaving > 0 && (
              <PrimaryButton label="Conferma senza aggiungere al Salvadanaio" variant="secondary" onPress={() => confirm(false)} disabled={saving} />
            )}
            {shopSaving + fuelSaving <= 0 && !isRec && (
              <Text style={[s.modalSmall, { textAlign: 'center' }]}>Nessun risparmio da mettere nel Salvadanaio: la spesa resta registrata, da verificare con lo scontrino.</Text>
            )}
            <Pressable onPress={() => setAskOpen(false)} style={{ alignSelf: 'center', padding: spacing.sm }}>
              <Text style={s.modalSmall}>Annulla</Text>
            </Pressable>
          </Card>
        </View>
      </Modal>
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
  ruleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4 },
  ruleChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border },
  ruleChipOn: { backgroundColor: c.primarySoft, borderColor: c.primary },
  ruleChipText: { color: c.textSecondary, fontSize: 12 },
  ruleChipTextOn: { color: c.text, fontWeight: '700' },
  splitCard: { marginTop: spacing.lg, gap: spacing.sm, borderColor: c.primary, borderWidth: 2 },
  splitTotal: { color: c.text, fontSize: 24, fontWeight: '800' },
  splitSave: { color: c.success, fontSize: 14, fontWeight: '700' },
  splitStop: { gap: 4, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: c.border },
  hereBox: { padding: spacing.md, marginBottom: spacing.lg, borderWidth: 2 },
  hereTitle: { color: c.text, fontSize: 17, fontWeight: '800', marginBottom: 4 },
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
  modalBg: { flex: 1, backgroundColor: c.overlay, justifyContent: 'center', padding: spacing.lg },
  modal: { gap: spacing.md, width: '100%', maxWidth: 460, alignSelf: 'center' },
  modalTitle: { color: c.text, fontSize: 19, fontWeight: '700' },
  modalText: { color: c.text, fontSize: 14, lineHeight: 20, flexShrink: 1 },
  modalSmall: { color: c.textSecondary, fontSize: 12 },
  refWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  refChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border },
  refChipOn: { backgroundColor: c.primary, borderColor: c.primary },
  refText: { color: c.text, fontSize: 13 },
  refTextOn: { color: c.primaryText },
  preview: { backgroundColor: c.primarySoft, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  previewValue: { color: c.success, fontSize: 16, fontWeight: '700' },
  remember: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fuelStop: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: c.surface, gap: 2 },
  fuelStopTitle: { color: c.text, fontSize: 14, fontWeight: '700' },
  fuelStopText: { color: c.textSecondary, fontSize: 12, lineHeight: 17 },
  fuelStopLink: { color: c.primary, fontSize: 13, fontWeight: '700', marginTop: 2 },
  savingBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: spacing.md },
  savingText: { flex: 1, color: c.textSecondary, fontSize: 13, fontWeight: '600' },
  branch: { color: c.textSecondary, fontSize: 13, marginTop: 2 },
  altNav: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  altNavText: { color: c.primary, fontSize: 13, fontWeight: '600' },
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
