import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, BudgetSuggestion, Category, Flyer, HabitualItem, Offer } from '@/api';
import { FuelCard } from '@/components/FuelCard';
import { HabitualPicker } from '@/components/HabitualPicker';
import { HScroll } from '@/components/HScroll';
import { ProductSearch } from '@/components/ProductSearch';
import { ShoppingList } from '@/components/ShoppingList';
import { SmartSuggestions } from '@/components/SmartSuggestions';
import { Chip, EmptyState, ErrorState, Icon, PrimaryButton, SectionTitle, StoreDot } from '@/components/ui';
import { euro, formatDate, formatQty, qtyStep, TRANSPORTS } from '@/format';
import { getCurrentPosition } from '@/location';
import { useStore } from '@/store';
import { makeStyles, radius, spacing, useTheme } from '@/theme';

function notify(title: string, message: string) {
  if (Platform.OS === 'web') globalThis.alert?.(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

export default function ListaScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const {
    catalog, catalogError, reloadCatalog, productById, items, addItem, addCustom, updateQty, removeItem, clearItems,
    prefs, setPrefs, userId, setLastResult,
  } = useStore();

  const [offers, setOffers] = useState<Offer[]>([]);
  const [openCategory, setOpenCategory] = useState<Category | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingHabitual, setLoadingHabitual] = useState(false);
  const [habitualProposal, setHabitualProposal] = useState<{ items: HabitualItem[]; occasions: number } | null>(null);
  const [budgetText, setBudgetText] = useState(prefs.budget != null ? String(prefs.budget) : '');

  useEffect(() => {
    api.offers().then(setOffers).catch(() => setOffers([]));
  }, [catalog]);

  // volantini ufficiali delle catene vicine (link al sito della catena o del negozio)
  const [flyers, setFlyers] = useState<Flyer[]>([]);
  useEffect(() => {
    api.flyers(prefs.location?.lat, prefs.location?.lon).then(setFlyers).catch(() => setFlyers([]));
  }, [prefs.location]);

  useEffect(() => {
    setBudgetText(prefs.budget != null ? String(prefs.budget) : '');
  }, [prefs.budget]);

  // Budget suggerito dallo storico: mediana delle spese simili + 10% (calcolato dal backend)
  const [suggestion, setSuggestion] = useState<BudgetSuggestion | null>(null);
  useEffect(() => {
    if (!userId || !items.length) { setSuggestion(null); return; }
    const t = setTimeout(() => {
      api.budgetSuggest(userId, items).then(setSuggestion).catch(() => setSuggestion(null));
    }, 600);
    return () => clearTimeout(t);
  }, [userId, items]);

  const onBudgetChange = (t: string) => {
    const clean = t.replace(',', '.').replace(/[^0-9.]/g, '');
    setBudgetText(clean);
    const n = parseFloat(clean);
    setPrefs({ budget: Number.isFinite(n) ? n : null });
  };

  const loadHabitual = useCallback(async () => {
    if (!userId) return;
    setLoadingHabitual(true);
    try {
      const h = await api.habitual(userId);
      if (h.occasions < h.needed) {
        notify('Spesa abituale', h.occasions === 0
          ? 'Conferma qualche spesa dai Risultati: imparo cosa compri di solito.'
          : `Finora ho visto ${h.occasions} ${h.occasions === 1 ? 'spesa diversa' : 'spese diverse'}: me ne servono almeno ${h.needed} per capire cosa compri davvero di solito. (Se confermi più volte lo stesso carrello conta una volta sola.)`);
        return;
      }
      if (!h.items.length) {
        notify('Spesa abituale', `Su ${h.occasions} spese non c'è ancora niente che compri spesso: lo imparo con le prossime.`);
        return;
      }
      setHabitualProposal({ items: h.items, occasions: h.occasions });
    } catch (e) {
      notify('Errore', (e as Error).message);
    } finally {
      setLoadingHabitual(false);
    }
  }, [userId]);

  const [locating, setLocating] = useState(false);
  const useMyLocation = async () => {
    setLocating(true);
    try {
      setPrefs({ location: await getCurrentPosition() });
    } catch (e) {
      notify('Posizione', (e as Error).message);
    } finally {
      setLocating(false);
    }
  };

  const findBest = async () => {
    if (!userId || !items.length) return;
    setLoading(true);
    try {
      const r = await api.optimize({
        user_id: userId,
        items,
        budget: prefs.budget,
        transport: prefs.transport,
        habitual_store_id: prefs.habitualStoreId,
        min_savings_threshold: prefs.minSavingsThreshold,
        fuel_type: prefs.fuelType,
        ...(prefs.location ? { lat: prefs.location.lat, lon: prefs.location.lon } : {}),
        refuel: prefs.transport === 'car' && prefs.refuel,
        refuel_liters: prefs.refuelLiters,
      });
      setLastResult(r);
      router.push('/risultati');
    } catch (e) {
      notify('Errore', (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const categoryProducts = useMemo(
    () => catalog?.products.filter((p) => p.category_id === openCategory?.id) ?? [],
    [catalog, openCategory],
  );

  if (catalogError && !catalog) {
    return (
      <SafeAreaView style={[s.screen, { justifyContent: 'center' }]}>
        <ErrorState message={catalogError} onRetry={reloadCatalog} />
      </SafeAreaView>
    );
  }
  if (!catalog) {
    return (
      <SafeAreaView style={[s.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.kicker}>Mi Conviene · Ciao 👋</Text>
        <Text style={s.title}>Cosa devi comprare?</Text>
        <View style={{ marginTop: spacing.md }}>
          <ProductSearch
            products={catalog.products}
            categories={catalog.categories}
            onAddProduct={(id) => addItem(id)}
            onAddCustom={(name, cat) => addCustom(name, cat)}
            inList={(id) => items.some((i) => i.product_id === id)}
          />
        </View>

        {offers.length > 0 && (
          <>
            <SectionTitle>🔥 Offerte di oggi</SectionTitle>
            <HScroll style={s.bleed} contentContainerStyle={s.hRow}>
              {offers.map((o) => (
                <View key={`${o.store_id}-${o.product_id}`} style={s.offerCard}>
                  <View style={s.offerTop}>
                    <Text style={s.offerName} numberOfLines={2}>{o.product_name}</Text>
                    <View style={s.badge}><Text style={s.badgeText}>-{o.discount_pct}%</Text></View>
                  </View>
                  <View style={s.storeRow}>
                    <StoreDot storeId={o.store_id} />
                    <Text style={s.muted}>{o.store_name}</Text>
                  </View>
                  <View style={s.offerBottom}>
                    <View>
                      <Text style={s.price}>
                        {euro(o.promo_price)} <Text style={s.strike}>{euro(o.normal_price)}</Text>
                      </Text>
                      {o.loyalty_required && <Text style={s.loyalty}>Carta fedeltà</Text>}
                      <Text style={o.source === 'stima' ? s.tagEstimate : s.tagReal}>
                        {o.source === 'stima' ? 'stima' : '✓ prezzo reale'}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityLabel={`Aggiungi ${o.product_name}`}
                      onPress={() => addItem(o.product_id)}
                      style={s.addBtn}>
                      <Icon name="add" size={20} color={colors.textSecondary} />
                    </Pressable>
                  </View>
                </View>
              ))}
            </HScroll>
          </>
        )}

        {flyers.length > 0 && (
          <>
            <SectionTitle>📰 Volantini di oggi</SectionTitle>
            <HScroll style={s.bleed} contentContainerStyle={s.hRow}>
              {flyers.map((f) => (
                <Pressable
                  key={f.store_id}
                  accessibilityRole="link"
                  accessibilityLabel={`Apri il volantino ${f.store_name}`}
                  onPress={() => Linking.openURL(f.url)}
                  style={({ pressed }) => [s.flyerCard, pressed && { opacity: 0.7 }]}>
                  <View style={s.storeRow}>
                    <StoreDot storeId={f.store_id} size={14} />
                    <Text style={s.offerName} numberOfLines={1}>{f.store_name}</Text>
                  </View>
                  <Text style={s.muted} numberOfLines={2}>
                    {f.branch_name
                      ? `${f.branch_name}${f.address ? `, ${f.address}` : ''}${f.distance_km != null ? ` · ${f.distance_km.toLocaleString('it-IT')} km` : ''}`
                      : 'Volantino nazionale'}
                  </Text>
                  <View style={s.flyerLink}>
                    <Text style={s.flyerLinkText}>{f.store_page ? 'Volantino di zona' : 'Volantino nazionale'}</Text>
                    <Icon name="open-outline" size={14} color={colors.primary} />
                  </View>
                </Pressable>
              ))}
            </HScroll>
            <Text style={s.flyerNote}>Si apre il sito ufficiale della catena. Le offerte dei volantini non sono ancora nei calcoli.</Text>
          </>
        )}

        <SectionTitle>Categorie</SectionTitle>
        <HScroll style={s.bleed} contentContainerStyle={s.hRow}>
          {catalog.categories.map((c) => (
            <Pressable key={c.id} onPress={() => setOpenCategory(c)} style={({ pressed }) => [s.catTile, pressed && { opacity: 0.7 }]}>
              <Text style={s.catEmoji}>{c.emoji}</Text>
              <Text style={s.catName} numberOfLines={1}>{c.name}</Text>
            </Pressable>
          ))}
        </HScroll>

        <Pressable onPress={loadHabitual} style={s.habitualBtn} disabled={loadingHabitual}>
          {loadingHabitual ? <ActivityIndicator color={colors.primary} /> : <Icon name="repeat" size={18} color={colors.primary} />}
          <Text style={s.habitualText}>Carica la mia spesa abituale</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/ricette')} style={[s.habitualBtn, { marginTop: spacing.sm }]}>
          <Icon name="book-outline" size={18} color={colors.primary} />
          <Text style={s.habitualText}>Dalle ricette</Text>
        </Pressable>

        <SectionTitle
          right={items.length > 0 && (
            <Pressable onPress={clearItems} hitSlop={8}><Text style={s.clear}>Svuota</Text></Pressable>
          )}>
          La tua lista
        </SectionTitle>

        {items.length === 0 ? (
          <EmptyState icon="basket-outline" text="Nessun prodotto. Cerca o scrivi qui sopra, oppure tocca una categoria." />
        ) : (
          <ShoppingList
            items={items}
            categories={catalog.categories}
            productById={productById}
            updateQty={updateQty}
            removeItem={removeItem}
          />
        )}
        {items.length >= 1 && <SmartSuggestions items={items} />}

        <SectionTitle>Budget</SectionTitle>
        <View style={s.budgetBox}>
          <Text style={s.budgetEuro}>€</Text>
          <TextInput
            value={budgetText}
            onChangeText={onBudgetChange}
            keyboardType="decimal-pad"
            placeholder="Nessun limite"
            placeholderTextColor={colors.textSecondary}
            style={s.budgetInput}
          />
          <Text style={s.budgetHint}>per questa{'\n'}spesa</Text>
        </View>
        {suggestion?.suggested != null && suggestion.suggested !== prefs.budget && (
          <Pressable style={s.suggestRow} onPress={() => setPrefs({ budget: suggestion.suggested })}>
            <Icon name="bulb-outline" size={16} color={colors.primary} />
            <Text style={s.suggestText}>
              Ti propongo <Text style={{ fontWeight: '700' }}>{euro(suggestion.suggested)}</Text> · {suggestion.reason}
            </Text>
            <Text style={s.suggestUse}>Usa</Text>
          </Pressable>
        )}

        {suggestion?.last_similar && (
          <View style={s.lastRow}>
            <Icon name="time-outline" size={16} color={colors.textSecondary} />
            <Text style={s.lastText}>
              L'ultima volta, per una spesa simile, sei andato da{' '}
              <Text style={{ fontWeight: '700', color: colors.text }}>{suggestion.last_similar.store_name}</Text>
              {' '}({formatDate(suggestion.last_similar.date)}
              {suggestion.last_similar.total_cost ? ` · ${euro(suggestion.last_similar.total_cost)}` : ''})
            </Text>
          </View>
        )}

        <SectionTitle>Come vai?</SectionTitle>
        <View style={s.wrap}>
          {TRANSPORTS.map((t) => (
            <Chip key={t.id} label={t.label} icon={t.icon as never} selected={prefs.transport === t.id} onPress={() => setPrefs({ transport: t.id })} />
          ))}
        </View>

        {prefs.transport === 'car' && (
          <View style={{ marginTop: spacing.lg }}>
            <FuelCard
              fuel={prefs.fuelType}
              onFuelChange={(f) => setPrefs({ fuelType: f })}
              lat={prefs.location?.lat}
              lon={prefs.location?.lon}
            />
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: prefs.refuel }}
              onPress={() => setPrefs({ refuel: !prefs.refuel })}
              style={[s.refuelRow, prefs.refuel && s.refuelOn]}>
              <Icon name={prefs.refuel ? 'checkbox' : 'square-outline'} size={22} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={s.itemName}>Devo anche fare carburante</Text>
                <Text style={s.muted}>
                  {prefs.location
                    ? 'Cerco il distributore più conveniente sulla strada di ogni supermercato e lo metto nel confronto.'
                    : 'Attiva la posizione qui sotto: serve per sapere qual è la tua strada.'}
                </Text>
              </View>
            </Pressable>
            {prefs.refuel && (
              <View style={s.litersRow}>
                <Text style={s.muted}>Litri (facoltativo)</Text>
                <TextInput
                  value={prefs.refuelLiters != null ? String(prefs.refuelLiters) : ''}
                  onChangeText={(t) => {
                    const n = parseFloat(t.replace(',', '.'));
                    setPrefs({ refuelLiters: Number.isFinite(n) && n > 0 ? Math.min(n, 200) : null });
                  }}
                  keyboardType="decimal-pad"
                  placeholder="40 (pieno medio)"
                  placeholderTextColor={colors.textSecondary}
                  style={s.litersInput}
                />
              </View>
            )}
          </View>
        )}

        <SectionTitle>Dove sei?</SectionTitle>
        {prefs.location ? (
          <View style={s.locRow}>
            <Icon name="location" size={18} color={colors.primary} />
            <Text style={s.locText}>Confronto i punti vendita veri più vicini a te</Text>
            <Pressable onPress={useMyLocation} hitSlop={8} disabled={locating}>
              <Text style={s.suggestUse}>{locating ? '…' : 'Aggiorna'}</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable style={s.locCard} onPress={useMyLocation} disabled={locating}>
            {locating ? <ActivityIndicator color={colors.primary} /> : <Icon name="location-outline" size={22} color={colors.primary} />}
            <View style={{ flex: 1 }}>
              <Text style={s.itemName}>Usa la mia posizione</Text>
              <Text style={s.muted}>Così confronto i supermercati veri vicino a te, con le distanze reali. Senza, uso distanze di esempio.</Text>
            </View>
          </Pressable>
        )}

        <SectionTitle>Dove vai di solito?</SectionTitle>
        <View style={s.wrap}>
          {catalog.stores.map((st) => (
            <Chip
              key={st.id}
              label={st.name}
              leading={<StoreDot storeId={st.id} size={14} />}
              selected={prefs.habitualStoreId === st.id}
              onPress={() => setPrefs({ habitualStoreId: prefs.habitualStoreId === st.id ? null : st.id })}
            />
          ))}
        </View>
      </ScrollView>

      {items.length > 0 && (
        <View style={[s.ctaWrap, { paddingBottom: spacing.md }]} pointerEvents="box-none">
          <PrimaryButton label="Trova la spesa migliore" icon="sparkles" onPress={findBest} loading={loading} style={s.cta} />
        </View>
      )}

      <Modal visible={!!openCategory} transparent animationType="slide" onRequestClose={() => setOpenCategory(null)}>
        <Pressable style={s.overlay} onPress={() => setOpenCategory(null)} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={s.grabber} />
          <Text style={s.sheetTitle}>{openCategory?.emoji} {openCategory?.name}</Text>
          <FlatList
            data={categoryProducts}
            keyExtractor={(p) => p.id}
            ItemSeparatorComponent={() => <View style={s.sep} />}
            renderItem={({ item: p }) => {
              const inList = items.find((i) => i.product_id === p.id);
              return (
                <Pressable onPress={() => addItem(p.id)} style={s.sheetRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.itemName}>{p.name}</Text>
                    <Text style={s.muted}>
                      {formatQty(p.default_qty, p.unit)}
                      {inList ? ` · in lista: ${formatQty(inList.quantity, p.unit)}` : ''}
                    </Text>
                  </View>
                  <View style={[s.addBtn, inList && { backgroundColor: colors.primary }]}>
                    <Icon name={inList ? 'checkmark' : 'add'} color={inList ? colors.primaryText : colors.textSecondary} />
                  </View>
                </Pressable>
              );
            }}
          />
          <PrimaryButton label="Fatto" onPress={() => setOpenCategory(null)} style={{ marginTop: spacing.md }} />
        </View>
      </Modal>
      {habitualProposal && catalog && (
        <HabitualPicker
          items={habitualProposal.items}
          occasions={habitualProposal.occasions}
          categories={catalog.categories}
          productById={productById}
          inList={(id) => items.some((it) => it.product_id === id)}
          onClose={() => setHabitualProposal(null)}
          onConfirm={(chosen) => {
            chosen.forEach((i) => {
              if (!items.some((it) => it.product_id === i.product_id)) addItem(i.product_id, i.quantity);
            });
            setHabitualProposal(null);
          }}
        />
      )}
    </SafeAreaView>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.background },
  content: { width: '100%', maxWidth: 640, alignSelf: 'center', padding: spacing.lg, paddingBottom: 120 },
  bleed: { marginHorizontal: -spacing.lg },
  hRow: { paddingHorizontal: spacing.lg, gap: spacing.md },
  kicker: { color: c.textSecondary, fontSize: 14 },
  title: { color: c.text, fontSize: 28, fontWeight: '800', marginTop: 2 },
  offerCard: {
    width: 160, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border,
    backgroundColor: c.surface, gap: 6,
  },
  offerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 4 },
  offerName: { flex: 1, color: c.text, fontWeight: '700', fontSize: 14 },
  badge: { backgroundColor: c.badge, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { color: c.badgeText, fontSize: 11, fontWeight: '700' },
  storeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  offerBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 4 },
  price: { color: c.primary, fontWeight: '800', fontSize: 16 },
  strike: { color: c.textSecondary, fontWeight: '400', fontSize: 12, textDecorationLine: 'line-through' },
  loyalty: { color: c.warning, fontSize: 11, marginTop: 2 },
  flyerCard: {
    width: 170, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border,
    backgroundColor: c.surface, gap: 6, justifyContent: 'space-between',
  },
  flyerLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  flyerLinkText: { color: c.primary, fontWeight: '700', fontSize: 13 },
  flyerNote: { color: c.textSecondary, fontSize: 11, marginTop: spacing.sm },
  tagEstimate: { color: c.textSecondary, fontSize: 10, marginTop: 2, fontStyle: 'italic' },
  tagReal: { color: c.success, fontSize: 10, marginTop: 2, fontWeight: '600' },
  addBtn: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.surfaceMuted,
  },
  catTile: {
    width: 84, height: 92, borderRadius: radius.lg, backgroundColor: c.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 4,
  },
  catEmoji: { fontSize: 32 },
  catName: { color: c.text, fontSize: 12, fontWeight: '500' },
  habitualBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'flex-start',
    marginTop: spacing.lg, paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    borderRadius: radius.pill, backgroundColor: c.primarySoft,
  },
  habitualText: { color: c.primary, fontWeight: '600', fontSize: 14 },
  clear: { color: c.danger, fontSize: 14 },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface,
  },
  itemName: { color: c.text, fontSize: 16, fontWeight: '600' },
  muted: { color: c.textSecondary, fontSize: 13 },
  stepBtn: {
    width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.surfaceMuted,
  },
  budgetBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface,
  },
  budgetEuro: { color: c.text, fontSize: 20, fontWeight: '700' },
  budgetInput: { flex: 1, minWidth: 0, color: c.text, fontSize: 20, paddingVertical: 14 },
  budgetHint: { color: c.textSecondary, fontSize: 11, textAlign: 'right' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  suggestRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm,
    padding: spacing.md, borderRadius: radius.md, backgroundColor: c.primarySoft,
  },
  suggestText: { flex: 1, color: c.text, fontSize: 13, lineHeight: 18 },
  locRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md,
    borderRadius: radius.md, backgroundColor: c.primarySoft,
  },
  locText: { flex: 1, color: c.text, fontSize: 14 },
  locCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg,
    borderRadius: radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.primary, backgroundColor: c.surface,
  },
  refuelRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, marginTop: spacing.sm,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface,
  },
  refuelOn: { borderColor: c.primary, backgroundColor: c.primarySoft },
  litersRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm, paddingHorizontal: spacing.xs },
  litersInput: {
    flex: 1, minWidth: 0, color: c.text, fontSize: 16, paddingHorizontal: spacing.md, paddingVertical: 10,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface,
  },
  lastRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm, paddingHorizontal: spacing.xs },
  lastText: { flex: 1, color: c.textSecondary, fontSize: 13, lineHeight: 18 },
  suggestUse: { color: c.primary, fontWeight: '700', fontSize: 14 },
  ctaWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, alignItems: 'center' },
  cta: { width: '100%', maxWidth: 608, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  overlay: { flex: 1, backgroundColor: c.overlay },
  sheet: {
    maxHeight: '75%', width: '100%', maxWidth: 640, alignSelf: 'center', backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
  },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: c.border, marginBottom: spacing.md },
  sheetTitle: { color: c.text, fontSize: 20, fontWeight: '700', marginBottom: spacing.sm },
  sheetRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, gap: spacing.md },
  sep: { height: 1, backgroundColor: c.border },
}));
