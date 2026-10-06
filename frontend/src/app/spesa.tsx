import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, PriceKind, Shop, ShopItem } from '@/api';
import { KIND_HELP, PriceKindPicker } from '@/components/PriceKindPicker';
import { ProductSearch } from '@/components/ProductSearch';
import { Card, Icon, PrimaryButton } from '@/components/ui';
import { euro, formatQty } from '@/format';
import { useStore } from '@/store';
import { makeStyles, radius, spacing, useTheme } from '@/theme';

const CACHE_KEY = 'mc_shop_cache';
const PENDING_KEY = 'mc_shop_pending';
type Pending = { shopId: string; key: string; checked: boolean };

/** Lo schermo resta acceso mentre sei in negozio (dove si può). */
function KeepAwake() {
  try { useKeepAwake(); } catch { /* non supportato: pazienza */ }
  return null;
}

/**
 * In negozio: la lista come checklist. Tocchi un prodotto e va nel carrello.
 * Reparti nell'ordine del negozio (imparato da come smarchi), condivisa con la famiglia,
 * e funziona anche se in negozio la rete va e viene (le spunte si inviano appena torna).
 */
export default function SpesaScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const { userId, catalog, prefs, addItem, addCustom, setItems, items: listItems } = useStore();
  const [shop, setShop] = useState<Shop | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState(false);
  const [adding, setAdding] = useState(false);
  const [finishing, setFinishing] = useState<{ missing: ShopItem[]; saving_id: string | null; cart: number } | null>(null);
  const [putBack, setPutBack] = useState<Set<string>>(new Set());
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [pricing, setPricing] = useState<ShopItem | null>(null);
  const [priceText, setPriceText] = useState('');
  const [priceKind, setPriceKind] = useState<PriceKind>('normale');
  const [priceNote, setPriceNote] = useState('');
  const pending = useRef<Pending[]>([]);
  const name = prefs.displayName || null;

  const catById = useMemo(() => new Map((catalog?.categories ?? []).map((c) => [c.id, c])), [catalog]);

  // spunte non ancora inviate (rete assente): si applicano sopra la copia del server
  const applyPending = (sh: Shop): Shop => {
    const mine = pending.current.filter((p) => p.shopId === sh.id);
    if (!mine.length) return sh;
    const items = sh.items.map((i) => {
      const p = [...mine].reverse().find((x) => x.key === i.key);
      return p ? { ...i, checked: p.checked } : i;
    });
    return { ...sh, items };
  };
  const save = (sh: Shop | null) => {
    AsyncStorage.setItem(CACHE_KEY, JSON.stringify(sh)).catch(() => {});
  };
  const savePending = () => AsyncStorage.setItem(PENDING_KEY, JSON.stringify(pending.current)).catch(() => {});

  const flush = useCallback(async () => {
    if (!userId) return;
    while (pending.current.length) {
      const p = pending.current[0];
      try {
        await api.shopCheck(p.shopId, userId, p.key, p.checked, name);
        pending.current.shift();
        savePending();
      } catch {
        setOffline(true);
        return false;
      }
    }
    return true;
  }, [userId, name]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const ok = await flush();
    if (ok === false) return;
    try {
      const r = await api.shopActive(userId);
      setOffline(false);
      setShop(r.shop ? applyPending(r.shop) : null);
      save(r.shop);
    } catch {
      setOffline(true);
    } finally {
      setLoaded(true);
    }
  }, [userId, flush]);

  // all'avvio: copia salvata (se in negozio non c'è rete) poi il server
  useEffect(() => {
    (async () => {
      try {
        const [c, p] = await Promise.all([AsyncStorage.getItem(CACHE_KEY), AsyncStorage.getItem(PENDING_KEY)]);
        if (p) pending.current = JSON.parse(p);
        if (c) { const sh = JSON.parse(c) as Shop | null; if (sh) setShop(applyPending(sh)); }
      } catch { /* */ }
      refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // aggiornamento ogni pochi secondi: vedi le spunte di chi fa la spesa con te
  useFocusEffect(useCallback(() => {
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]));

  const take = async () => {
    if (!shop || !userId) return;
    setShop({ ...shop, taken_by: { user_id: userId, name, at: new Date().toISOString() } });
    try { const sh = await api.shopTake(shop.id, userId, name); setShop(applyPending(sh)); save(sh); } catch { /* riprovo al prossimo aggiornamento */ }
  };

  // un familiare apre la lista di un altro: la prende in carico (se nessuno l'ha già fatto)
  const autoTook = useRef<string | null>(null);
  useEffect(() => {
    if (shop && userId && !shop.mine && !shop.taken_by && autoTook.current !== shop.id) {
      autoTook.current = shop.id;
      take();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop?.id, shop?.taken_by, userId]);

  const toggle = (it: ShopItem) => {
    if (!shop || !userId) return;
    const checked = !it.checked;
    const next = {
      ...shop,
      taken_by: shop.taken_by ?? (checked ? { user_id: userId, name, at: new Date().toISOString() } : null),
      items: shop.items.map((i) => (i.key === it.key ? { ...i, checked, checked_at: checked ? new Date().toISOString() : null, checked_by: checked ? name : null, checked_by_id: checked ? userId : null } : i)),
    };
    setShop(next);
    pending.current.push({ shopId: shop.id, key: it.key, checked });
    savePending();
    flush().then((ok) => { if (ok) setOffline(false); });
  };

  const addInStore = async (productId: string, nameNew?: string, categoryId?: string) => {
    if (!shop || !userId) return;
    const p = catalog?.products.find((x) => x.id === productId);
    try {
      const r = await api.shopAdd(shop.id, userId, {
        product_id: productId, quantity: p?.default_qty ?? 1, name: nameNew, category_id: categoryId,
      });
      setShop(applyPending(r));
      save(r);
      setAdding(false);
    } catch {
      setOffline(true);
    }
  };

  const openPrice = (it: ShopItem) => {
    setPricing(it);
    setPriceText(it.seen ? String(it.seen.price).replace('.', ',') : '');
    setPriceKind(it.seen?.kind ?? 'normale');
    setPriceNote(it.seen?.note ?? '');
  };
  const savePrice = async () => {
    if (!shop || !userId || !pricing) return;
    const v = parseFloat(priceText.replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0) return;
    try {
      const r = await api.shopPrice(shop.id, { user_id: userId, key: pricing.key, price: Math.round(v * 100) / 100, kind: priceKind,
        note: priceKind === 'variante' ? priceNote.trim() || null : null, display_name: name });
      setShop(applyPending(r));
      save(r);
      setPricing(null);
    } catch {
      setOffline(true);
    }
  };

  const finish = async () => {
    if (!shop || !userId) return;
    await flush();
    try {
      const r = await api.shopFinish(shop.id, userId);
      setFinishing(r);
      setPutBack(new Set(r.missing.map((m) => m.key)));
    } catch {
      setOffline(true);
    }
  };
  const closeFinished = (goVerify: boolean) => {
    if (!finishing) return;
    for (const m of finishing.missing) {
      if (!putBack.has(m.key)) continue;
      if (m.product_id.startsWith('custom:')) addCustom(m.name, m.category_id, m.quantity, m.unit);
      else addItem(m.product_id, m.quantity);
    }
    setShop(null);
    save(null);
    setFinishing(null);
    router.replace(goVerify ? '/salvadanaio' : '/');
  };
  const cancel = async () => {
    if (!shop || !userId) return;
    try {
      const r = await api.shopCancel(shop.id, userId);
      // la lista torna com'era (si aggiunge a quello che hai scritto nel frattempo)
      const byId = new Map(listItems.map((i) => [i.product_id, i]));
      for (const i of r.items) {
        if (!byId.has(i.product_id)) {
          byId.set(i.product_id, i.product_id.startsWith('custom:')
            ? { product_id: i.product_id, quantity: i.quantity, name: i.name, category_id: i.category_id, unit: i.unit }
            : { product_id: i.product_id, quantity: i.quantity });
        }
      }
      setItems([...byId.values()]);
      setShop(null);
      save(null);
      router.replace('/');
    } catch {
      setOffline(true);
    }
  };

  if (finishing) {
    return (
      <SafeAreaView style={s.safe}>
        <ScrollView contentContainerStyle={s.content}>
          <Text style={s.title}>🏁 Spesa finita</Text>
          <Text style={s.text}>Nel carrello circa {euro(finishing.cart)}. Ho imparato l'ordine dei reparti di questo negozio: la prossima volta la lista è già in ordine.</Text>
          {!!finishing.missing.length && (
            <>
              <Text style={s.group}>Non presi: li rimetto nella prossima lista?</Text>
              {finishing.missing.map((m) => {
                const on = putBack.has(m.key);
                return (
                  <Pressable key={m.key} style={s.row} onPress={() => setPutBack((p) => { const n = new Set(p); if (n.has(m.key)) n.delete(m.key); else n.add(m.key); return n; })}>
                    <Icon name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.primary : colors.textSecondary} />
                    <Text style={[s.name, { flex: 1 }]}>{m.name}</Text>
                  </Pressable>
                );
              })}
            </>
          )}
          {finishing.saving_id && (
            <PrimaryButton label="Verifica con lo scontrino" icon="receipt-outline" onPress={() => closeFinished(true)} style={{ marginTop: spacing.md }} />
          )}
          <PrimaryButton label="Torna alla lista" variant="secondary" onPress={() => closeFinished(false)} style={{ marginTop: spacing.sm }} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!loaded && !shop) {
    return <SafeAreaView style={s.safe}><ActivityIndicator style={{ marginTop: 80 }} color={colors.primary} /></SafeAreaView>;
  }
  if (!shop) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.content}>
          <Text style={s.title}>Nessuna spesa in corso</Text>
          <Text style={s.muted}>Prepara la lista, trova il negozio migliore e conferma: qui la trovi pronta da smarcare.</Text>
          <PrimaryButton label="Vai alla lista" icon="list" onPress={() => router.replace('/')} style={{ marginTop: spacing.lg }} />
        </View>
      </SafeAreaView>
    );
  }

  const order = new Map(shop.aisles.map((c, i) => [c, i]));
  const todo = shop.items.filter((i) => !i.checked);
  const done = shop.items.filter((i) => i.checked).sort((a, b) => (b.checked_at ?? '').localeCompare(a.checked_at ?? ''));
  const groups = new Map<string, ShopItem[]>();
  for (const i of todo) groups.set(i.category_id, [...(groups.get(i.category_id) ?? []), i]);
  const sortedGroups = [...groups.entries()].sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99));
  const cart = Math.round(done.reduce((a, i) => a + (i.price ?? 0), 0) * 100) / 100;
  const estimated = Math.round(shop.items.reduce((a, i) => a + (i.price ?? 0), 0) * 100) / 100;
  const pct = shop.items.length ? done.length / shop.items.length : 0;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeepAwake />
      <View style={s.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={10} accessibilityLabel="Indietro">
          <Icon name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>🛒 {shop.store_name}</Text>
          {!!shop.branch && <Text style={s.muted} numberOfLines={1}>{shop.branch}</Text>}
          {!shop.mine && <Text style={s.muted}>Lista di {shop.display_name ?? 'un familiare'}</Text>}
        </View>
      </View>
      <View style={s.takenRow}>
        {shop.taken_by ? (
          <Text style={s.takenText}>
            🙋 {shop.taken_by.user_id === userId ? 'La stai facendo tu' : `La sta facendo ${shop.taken_by.name ?? 'un familiare'}`}
            {' · dalle '}{new Date(shop.taken_by.at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        ) : (
          <Text style={s.takenText}>Nessuno l'ha ancora presa in carico</Text>
        )}
        {shop.taken_by?.user_id !== userId && (
          <Pressable onPress={take} style={s.takeBtn} accessibilityRole="button">
            <Text style={s.takeBtnText}>La faccio io</Text>
          </Pressable>
        )}
      </View>
      <View style={s.progressBox}>
        <View style={s.progressTrack}><View style={[s.progressFill, { width: `${Math.round(pct * 100)}%` }]} /></View>
        <Text style={s.progressText}>
          {done.length} di {shop.items.length} nel carrello · ~{euro(cart)} di ~{euro(estimated)}
        </Text>
        {offline && <Text style={[s.muted, { color: colors.warning }]}>Senza rete: le spunte restano sul telefono e le invio appena torna.</Text>}
      </View>

      <ScrollView contentContainerStyle={s.content}>
        {todo.length === 0 && <Text style={s.allDone}>✅ Hai preso tutto!</Text>}
        {sortedGroups.map(([cat, list]) => (
          <View key={cat} style={{ gap: 6 }}>
            <Text style={s.group}>{catById.get(cat)?.emoji ?? '🛒'} {catById.get(cat)?.name ?? 'Altro'}</Text>
            {list.map((i) => (
              <Pressable key={i.key} onPress={() => toggle(i)} style={s.row} accessibilityRole="checkbox" accessibilityState={{ checked: false }}>
                <Icon name="ellipse-outline" size={26} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{i.name}</Text>
                  <Text style={s.muted}>
                    {formatQty(i.quantity, i.unit)}{i.price != null ? ` · ~${euro(i.price)}` : ''}
                    {i.in_promo ? ` · in offerta${i.promo_until ? ` fino al ${i.promo_until.slice(8, 10)}/${i.promo_until.slice(5, 7)}` : ''}` : ''}
                  </Text>
                  {i.variant && (
                    <Text style={[s.muted, { color: colors.primary }]}>
                      💡 l'ultima volta qui: {i.variant.note || 'altra marca'} a {euro(i.variant.price)}
                    </Text>
                  )}
                </View>
                {!i.product_id.startsWith('custom:') && (
                  <Pressable onPress={() => openPrice(i)} hitSlop={8} style={s.priceBtn} accessibilityLabel={`Segna il prezzo di ${i.name}`}>
                    <Text style={s.priceBtnText}>€</Text>
                  </Pressable>
                )}
              </Pressable>
            ))}
          </View>
        ))}

        {adding ? (
          <View style={{ marginTop: spacing.md }}>
            <ProductSearch
              products={catalog?.products ?? []}
              categories={catalog?.categories ?? []}
              onAddProduct={(id) => addInStore(id)}
              onAddCustom={(n, cat) => addInStore('custom:' + n.toLowerCase().replace(/[^a-z0-9]+/g, '-'), n, cat)}
              inList={(id) => shop.items.some((x) => x.key === id)}
            />
            <Pressable onPress={() => setAdding(false)} style={{ alignSelf: 'center', padding: spacing.sm }}><Text style={s.muted}>Chiudi</Text></Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setAdding(true)} style={s.addBtn}>
            <Icon name="add" size={18} color={colors.primary} />
            <Text style={s.addText}>Aggiungi una cosa vista in negozio</Text>
          </Pressable>
        )}

        {done.length > 0 && (
          <View style={{ gap: 6, marginTop: spacing.lg }}>
            <Text style={s.group}>✓ Nel carrello ({done.length})</Text>
            {done.map((i) => (
              <Pressable key={i.key} onPress={() => toggle(i)} style={[s.row, s.rowDone]} accessibilityRole="checkbox" accessibilityState={{ checked: true }}>
                <Icon name="checkmark-circle" size={26} color={colors.success} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.name, s.nameDone]}>{i.name}</Text>
                  <Text style={s.muted}>
                    {formatQty(i.quantity, i.unit)}
                    {i.checked_by_id && i.checked_by_id !== userId ? ` · preso da ${i.checked_by ?? 'un familiare'}` : ''}
                    {i.added_in_store ? ' · aggiunto in negozio' : ''}
                    {i.seen ? ` · ${euro(i.seen.price)}${i.seen.kind === 'offerta' ? ' in offerta' : i.seen.kind === 'variante' ? ` (${i.seen.note || 'altra marca'})` : ''}` : ''}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        <PrimaryButton label="Ho finito la spesa" icon="flag-outline" onPress={finish} style={{ marginTop: spacing.xl }} />
        <Pressable onPress={() => setConfirmCancel(true)} style={{ alignSelf: 'center', padding: spacing.md }}>
          <Text style={[s.muted, { color: colors.danger }]}>Annulla la spesa (la lista torna com'era)</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={!!pricing} transparent animationType="fade" onRequestClose={() => setPricing(null)}>
        <View style={s.bg}>
          <Card style={s.card}>
            <Text style={s.title}>€ {pricing?.name}</Text>
            <Text style={s.muted}>Quanto costa {pricing ? formatQty(pricing.quantity, pricing.unit) : ''}? Lo metto anche nel carrello.</Text>
            <View style={s.priceBox}>
              <Text style={s.title}>€</Text>
              <TextInput value={priceText} onChangeText={(t) => setPriceText(t.replace(/[^0-9.,]/g, ''))} keyboardType="decimal-pad"
                autoFocus placeholder="0,00" placeholderTextColor={colors.textSecondary} style={s.priceInput} onSubmitEditing={savePrice} />
            </View>
            <PriceKindPicker value={priceKind} onChange={setPriceKind} />
            <Text style={s.muted}>{KIND_HELP[priceKind]}</Text>
            {priceKind === 'variante' && (
              <TextInput value={priceNote} onChangeText={setPriceNote} placeholder="Quale? es. marca Lidl, formato 1 kg"
                placeholderTextColor={colors.textSecondary} style={s.noteInput} maxLength={80} />
            )}
            <PrimaryButton label="Salva e metti nel carrello" icon="checkmark" onPress={savePrice} style={{ marginTop: spacing.sm }} />
            <PrimaryButton label="Annulla" variant="secondary" onPress={() => setPricing(null)} />
          </Card>
        </View>
      </Modal>

      <Modal visible={confirmCancel} transparent animationType="fade" onRequestClose={() => setConfirmCancel(false)}>
        <View style={s.bg}>
          <Card style={s.card}>
            <Text style={s.title}>Annullare la spesa?</Text>
            <Text style={s.text}>I prodotti tornano nella tua lista. La spesa resta nel Salvadanaio: se non la fai, puoi eliminarla da lì.</Text>
            <PrimaryButton label="Sì, annulla" variant="danger" onPress={() => { setConfirmCancel(false); cancel(); }} style={{ marginTop: spacing.md }} />
            <PrimaryButton label="No, continuo" variant="secondary" onPress={() => setConfirmCancel(false)} style={{ marginTop: spacing.sm }} />
          </Card>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((c) => ({
  safe: { flex: 1, backgroundColor: c.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  title: { color: c.text, fontSize: 22, fontWeight: '800' },
  takenRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.sm,
    padding: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: c.primarySoft },
  takenText: { flex: 1, color: c.text, fontSize: 14, fontWeight: '600' },
  takeBtn: { backgroundColor: c.primary, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  takeBtnText: { color: c.primaryText, fontWeight: '700', fontSize: 13 },
  text: { color: c.text, fontSize: 14, lineHeight: 20 },
  muted: { color: c.textSecondary, fontSize: 12 },
  progressBox: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: 4 },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: c.surfaceMuted, overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: c.success },
  progressText: { color: c.text, fontSize: 13, fontWeight: '600' },
  content: { padding: spacing.lg, paddingBottom: 60, gap: spacing.md, maxWidth: 720, width: '100%', alignSelf: 'center' },
  allDone: { color: c.success, fontSize: 18, fontWeight: '700', textAlign: 'center', marginVertical: spacing.md },
  group: { color: c.textSecondary, fontSize: 13, fontWeight: '700', marginTop: spacing.xs },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, minHeight: 56,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface,
  },
  rowDone: { backgroundColor: c.surfaceMuted, borderColor: c.surfaceMuted },
  name: { color: c.text, fontSize: 17, fontWeight: '600' },
  nameDone: { color: c.textSecondary, textDecorationLine: 'line-through', fontWeight: '400' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: spacing.sm, paddingVertical: spacing.sm },
  addText: { color: c.primary, fontSize: 14, fontWeight: '700' },
  priceBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceMuted },
  priceBtnText: { color: c.primary, fontSize: 18, fontWeight: '800' },
  priceBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  priceInput: { flex: 1, minWidth: 0, color: c.text, fontSize: 24, paddingVertical: 10 },
  noteInput: { color: c.text, fontSize: 15, paddingVertical: 8, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  bg: { flex: 1, backgroundColor: c.overlay, justifyContent: 'center', padding: spacing.md },
  card: { width: '100%', maxWidth: 480, alignSelf: 'center', gap: spacing.sm },
}));
