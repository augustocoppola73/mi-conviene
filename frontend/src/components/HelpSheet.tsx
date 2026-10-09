/**
 * "Ti do una mano" (#4): la spesa la sta facendo un familiare, tu sei altrove. Guardo dove sei e propongo un
 * negozio vicino a te con i prodotti che lì costano uguale o meno; scegli cosa prendere e conferma:
 * quei prodotti diventano la tua parte e spariscono dalla lista dell'altro (che riceve un avviso).
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { api, HelpOption, Shop } from '../api';
import { euro, formatQty, km } from '../format';
import { getCurrentPosition } from '../location';
import { useStore } from '../store';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { ParkingLine } from './ParkingLine';
import { Icon, PrimaryButton, StoreDot } from './ui';

export function HelpSheet({ shop, visible, onClose, onDone }: { shop: Shop; visible: boolean; onClose: () => void; onDone: (s: Shop) => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const { prefs } = useStore();
  const [options, setOptions] = useState<HelpOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const who = shop.taken_by?.name ?? 'chi fa la spesa';

  useEffect(() => {
    if (!visible) return;
    setOptions(null); setError(null); setPick(0);
    (async () => {
      try {
        const pos = await getCurrentPosition();
        const o = await api.shopHelpPlan(shop.id, pos.lat, pos.lon, prefs.transport, prefs.fuelType);
        setOptions(o);
        setKeys(new Set(o[0]?.lines.slice(0, o[0].suggested).map((l) => l.key) ?? []));
        if (!o.length) setError('Vicino a te non c\'è un negozio dove convenga prendere una parte della spesa (almeno 3 prodotti o 5 €).');
      } catch (e) { setError((e as Error).message); }
    })();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const opt = options?.[pick];
  const choose = (i: number) => { setPick(i); setKeys(new Set(options![i].lines.slice(0, options![i].suggested).map((l) => l.key))); };
  const toggle = (k: string) => setKeys((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const chosen = opt ? opt.lines.filter((l) => keys.has(l.key)) : [];
  const gain = chosen.reduce((t, l) => t + (l.was != null ? l.was - l.line_price : 0), 0);

  const confirm = async () => {
    if (!opt || !chosen.length) return;
    setBusy(true);
    try {
      const sh = await api.shopHelpTake(shop.id, { store_id: opt.store_id, store_name: opt.store_name, branch: opt.branch }, chosen.map((l) => l.key), prefs.displayName || null);
      onDone(sh);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose} />
      <View style={s.sheet}>
        <View style={s.grabber} />
        <Text style={s.title}>🤝 Ti do una mano</Text>
        <Text style={s.muted}>Prendi una parte della spesa di {who} in un negozio vicino a te: quei prodotti spariscono dalla sua lista.</Text>
        {!options && !error && (
          <View style={s.row}><ActivityIndicator color={colors.primary} /><Text style={s.muted}>Guardo dove sei e cosa conviene…</Text></View>
        )}
        {error && <Text style={[s.muted, { color: colors.danger }]}>{error}</Text>}
        {opt && (
          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: spacing.sm }}>
            {options!.length > 1 && (
              <View style={s.tabs}>
                {options!.map((o, i) => (
                  <Pressable key={o.store_id} onPress={() => choose(i)} style={[s.tab, i === pick && s.tabOn]}>
                    <StoreDot storeId={o.store_id} size={10} />
                    <Text style={[s.tabText, i === pick && s.tabTextOn]}>{o.store_name} · {km(o.distance_km)}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <Text style={s.reason}>{opt.reasoning}</Text>
            {opt.lines.length > opt.suggested && <Text style={s.muted}>Ne ho spuntati circa metà per dividervi la spesa: puoi aggiungerne o toglierne.</Text>}
            {!!opt.branch && <Text style={s.muted}>{[opt.branch.name, opt.branch.address].filter(Boolean).join(' · ')}</Text>}
            {!!opt.branch && <ParkingLine parking={opt.branch.parking} size={12} />}
            {opt.lines.map((l) => {
              const on = keys.has(l.key);
              return (
                <Pressable key={l.key} onPress={() => toggle(l.key)} style={s.line} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                  <Icon name={on ? 'checkbox' : 'square-outline'} size={22} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.name}>{l.name}</Text>
                    <Text style={s.muted}>
                      {formatQty(l.quantity, l.unit)} · {euro(l.line_price)}
                      {l.was != null && l.was - l.line_price >= 0.01 ? ` · ${euro(l.was - l.line_price)} in meno` : ''}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
        {opt && (
          <PrimaryButton
            label={chosen.length ? `Prendo ${chosen.length} ${chosen.length === 1 ? 'prodotto' : 'prodotti'} da ${opt.store_name}` : 'Scegli almeno un prodotto'}
            icon="hand-left-outline" onPress={confirm} loading={busy} disabled={!chosen.length} style={{ marginTop: spacing.sm }} />
        )}
        {opt && gain >= 0.01 && <Text style={[s.muted, { textAlign: 'center' }]}>Risparmiate {euro(gain)} sulla spesa · {who} riceve un avviso</Text>}
        <Pressable onPress={onClose} style={{ alignSelf: 'center', padding: spacing.sm }}><Text style={s.muted}>Chiudi</Text></Pressable>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: c.background, padding: spacing.lg, paddingBottom: spacing.xl, borderTopLeftRadius: 20, borderTopRightRadius: 20, gap: spacing.sm, maxHeight: '90%' },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.border },
  title: { color: c.text, fontSize: 20, fontWeight: '800' },
  muted: { color: c.textSecondary, fontSize: 13 },
  reason: { color: c.text, fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  tabOn: { backgroundColor: c.primary, borderColor: c.primary },
  tabText: { color: c.text, fontSize: 13 },
  tabTextOn: { color: c.primaryText, fontWeight: '700' },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: c.surface },
  name: { color: c.text, fontSize: 15, fontWeight: '600' },
}));
