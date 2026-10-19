/**
 * #35 "Di solito lo ricompri" (suggerimento, niente notifiche) e #44 "Di solito compri" (un tocco e va in lista).
 * Dallo storico delle spese confermate, tuo e della famiglia.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { api } from '../api';
import { useStore } from '../store';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { HScroll } from './HScroll';
import { ProductIcon } from './ProductIcon';
import { Icon } from './ui';

type Usual = Awaited<ReturnType<typeof api.usualAndDue>>;
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export function UsualPanel() {
  const s = useStyles();
  const { colors } = useTheme();
  const { items, addItem, removeItem, prefs, setPrefs, catalog, userId } = useStore();
  const [data, setData] = useState<Usual | null>(null);
  useFocusEffect(useCallback(() => {
    if (!userId) return;
    api.usualAndDue().then(setData).catch(() => setData(null));
  }, [userId]));
  if (!data) return null;
  const inList = (id: string) => items.some((i) => i.product_id === id);
  const snooze = prefs.restockSnooze ?? {};
  const due = data.due.filter((d) => !inList(d.product_id) && !((snooze[d.product_id] ?? '') > today()));
  const catEmoji = (id: string) => catalog?.categories.find((c) => c.id === catalog.products.find((p) => p.id === id)?.category_id)?.emoji;
  const later = (id: string, every: number) => setPrefs({ restockSnooze: { ...snooze, [id]: addDays(Math.max(1, Math.round(every / 2))) } });

  // #94: un solo riquadro «Le tue solite cose»: prima quelle da ricomprare, sotto le tessere
  if (!due.length && !data.usual.length) return null;
  return (
    <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
      <Text style={s.section}>🧺 Le tue solite cose <Text style={s.muted}>· un tocco e va in lista</Text></Text>
      {due.length > 0 && (
        <View style={s.dueBox}>
          <View style={s.dueHead}>
            <Text style={s.dueTitle}>⏰ È ora di ricomprarli</Text>
            {due.length > 1 && (
              <Pressable onPress={() => due.slice(0, 3).forEach((d) => addItem(d.product_id, d.quantity))} hitSlop={8}>
                <Text style={s.link}>Aggiungi questi</Text>
              </Pressable>
            )}
          </View>
          {due.slice(0, 3).map((d) => (
            <View key={d.product_id} style={s.dueRow}>
              <ProductIcon name={d.name} productId={d.product_id} categoryEmoji={catEmoji(d.product_id)} size={30} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.name} numberOfLines={1}>{d.name}</Text>
                <Text style={s.muted}>ogni ~{d.every_days} giorni · l'ultima volta {d.since_days} giorni fa</Text>
              </View>
              <Pressable onPress={() => addItem(d.product_id, d.quantity)} style={s.addBtn} accessibilityRole="button" accessibilityLabel={`Aggiungi ${d.name}`}>
                <Text style={s.addText}>Aggiungi</Text>
              </Pressable>
              <Pressable onPress={() => later(d.product_id, d.every_days)} hitSlop={10} accessibilityLabel={`Non ora: ${d.name}`}>
                <Icon name="close" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      {data.usual.length > 0 && (
        <>
          <HScroll style={s.bleed} contentContainerStyle={s.hRow}>
            {data.usual.map((u) => {
              const on = inList(u.product_id);
              return (
                <Pressable key={u.product_id} onPress={() => (on ? removeItem(u.product_id) : addItem(u.product_id, u.quantity))}
                  style={[s.tile, on && s.tileOn]} accessibilityRole="button" accessibilityState={{ selected: on }}
                  accessibilityLabel={on ? `${u.name}, in lista: tocca per togliere` : `Aggiungi ${u.name}`}>
                  <ProductIcon name={u.name} productId={u.product_id} categoryEmoji={catEmoji(u.product_id)} size={34} />
                  <Text style={s.tileName} numberOfLines={2}>{u.name}</Text>
                  {on && <View style={s.check}><Icon name="checkmark" size={12} color={colors.primaryText} /></View>}
                </Pressable>
              );
            })}
          </HScroll>
        </>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  dueBox: { borderRadius: radius.md, borderWidth: 1, borderColor: c.primary, backgroundColor: c.primarySoft, padding: spacing.md, gap: spacing.sm },
  dueHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dueTitle: { color: c.text, fontSize: 15, fontWeight: '800' },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { color: c.text, fontSize: 14, fontWeight: '600' },
  muted: { color: c.textSecondary, fontSize: 12, fontWeight: '400' },
  link: { color: c.primary, fontWeight: '700', fontSize: 13 },
  addBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: c.primary },
  addText: { color: c.primaryText, fontWeight: '700', fontSize: 13 },
  section: { color: c.text, fontSize: 15, fontWeight: '800' },
  bleed: { marginHorizontal: -spacing.lg },
  hRow: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  tile: { width: 78, minHeight: 86, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface,
    alignItems: 'center', paddingVertical: 8, paddingHorizontal: 3, gap: 3 },
  tileOn: { borderColor: c.primary, backgroundColor: c.primarySoft },
  tileName: { color: c.text, fontSize: 11.5, fontWeight: '600', textAlign: 'center', lineHeight: 14 },
  check: { position: 'absolute', top: 4, right: 4, width: 18, height: 18, borderRadius: 9, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
}));
