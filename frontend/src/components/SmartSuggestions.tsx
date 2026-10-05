import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { api, ListItem, Suggestions, SuggestRecipe } from '../api';
import { euro, formatQty } from '../format';
import { useStore } from '../store';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { Card, Icon } from './ui';

/**
 * Cosa puoi fare con la lista che hai (regole, niente AI):
 * ricette già pronte, ricette a cui manca poco, cose che compri di solito e non ci sono,
 * e, se c'è un budget, cosa ci sta ancora dentro.
 */
export function SmartSuggestions({ items, storeId, budget, spent, onListChanged }: {
  items: ListItem[]; storeId?: string; budget?: number | null; spent?: number | null; onListChanged?: () => void;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const { userId, addItem, addCustom } = useStore();
  const [data, setData] = useState<Suggestions | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  // si ricalcola solo quando cambia davvero la lista (non a ogni render)
  const key = useMemo(() => items.map((i) => i.product_id).sort().join('|'), [items]);

  useEffect(() => {
    if (items.length < 1) { setData(null); return; }
    const t = setTimeout(() => {
      api.suggest({ user_id: userId, items, store_id: storeId, budget: budget ?? null, spent: spent ?? null, servings: 2 })
        .then(setData).catch(() => setData(null));
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, userId, storeId, budget, spent]);

  if (!data) return null;
  const remaining = data.remaining;
  const almost = data.almost.filter((r) => !added.has(r.id));
  const habitual = data.habitual_missing.filter((h) => !added.has(h.product_id));
  if (!data.ready.length && !almost.length && !habitual.length) {
    return (
      <Card style={s.card}>
        <Text style={s.title}>💡 Con questa lista…</Text>
        <Text style={s.meta}>Non trovo ricette che usano questi prodotti (o ne mancano troppi).</Text>
        <Pressable onPress={() => router.push('/ricette')} hitSlop={6}>
          <Text style={s.link}>Cerca tra le ricette ›</Text>
        </Pressable>
      </Card>
    );
  }
  const inBudget = remaining != null && remaining > 0;
  const habitualShown = inBudget ? habitual.filter((h) => h.fits_budget) : habitual.slice(0, 4);
  const almostShown = inBudget ? [...almost.filter((a) => a.fits_budget), ...almost.filter((a) => !a.fits_budget)].slice(0, 3) : almost.slice(0, 3);

  const mark = (k: string) => { setAdded((a) => new Set(a).add(k)); onListChanged?.(); };
  const addRecipeMissing = (r: SuggestRecipe) => {
    r.missing?.forEach((m) => addItem(m.product_id, m.quantity));
    r.missing_new?.forEach((n) => addCustom(n, 'altro', 1, 'pz'));
    mark(r.id);
  };
  const open = (id: string) => router.push({ pathname: '/ricette', params: { open: id } });

  return (
    <Card style={s.card}>
      <Text style={s.title}>💡 Con questa lista…</Text>
      {inBudget && (
        <Text style={s.budget}>Ti restano {euro(remaining!)} nel budget{storeId ? '' : ''}.</Text>
      )}

      {data.ready.length > 0 && (
        <>
          <Text style={s.section}>Puoi già cucinare</Text>
          <View style={s.chips}>
            {data.ready.slice(0, 6).map((r) => (
              <Pressable key={r.id} onPress={() => open(r.id)} style={s.chip}>
                <Text style={s.chipText}>🍽️ {r.name}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      {almostShown.length > 0 && (
        <>
          <Text style={s.section}>Ti manca poco</Text>
          {almostShown.map((r) => {
            const names = [...(r.missing ?? []).map((m) => m.name), ...(r.missing_new ?? [])];
            return (
              <View key={r.id} style={s.row}>
                <Pressable onPress={() => open(r.id)} style={{ flex: 1 }}>
                  <Text style={s.rowName}>{r.name}</Text>
                  <Text style={s.meta}>
                    manca {names.join(', ')}
                    {r.missing_cost != null ? ` · +${euro(r.missing_cost)}${r.missing_store && !storeId ? ` da ${r.missing_store}` : ''}` : ''}
                    {inBudget && r.fits_budget ? ' · ci sta nel budget' : ''}
                  </Text>
                </Pressable>
                <Pressable onPress={() => addRecipeMissing(r)} style={s.addBtn} accessibilityLabel={`Aggiungi quello che manca per ${r.name}`}>
                  <Icon name="add" size={18} color={colors.primary} />
                </Pressable>
              </View>
            );
          })}
        </>
      )}

      {habitualShown.length > 0 && (
        <>
          <Text style={s.section}>{inBudget ? 'Ci stanno ancora: le compri di solito' : 'Di solito compri anche'}</Text>
          {habitualShown.map((h) => (
            <View key={h.product_id} style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowName}>{h.name}</Text>
                <Text style={s.meta}>{h.count} volte su {h.occasions} · {formatQty(h.quantity, h.unit)} · {euro(h.cost)}</Text>
              </View>
              <Pressable onPress={() => { addItem(h.product_id, h.quantity); mark(h.product_id); }} style={s.addBtn} accessibilityLabel={`Aggiungi ${h.name}`}>
                <Icon name="add" size={18} color={colors.primary} />
              </Pressable>
            </View>
          ))}
        </>
      )}
      {added.size > 0 && onListChanged && (
        <Text style={s.meta}>Lista cambiata: ricalcola il supermercato migliore dalla Lista.</Text>
      )}
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  card: { gap: 6, marginTop: spacing.lg },
  title: { color: c.text, fontSize: 16, fontWeight: '700' },
  budget: { color: c.success, fontSize: 13, fontWeight: '600' },
  section: { color: c.textSecondary, fontSize: 12, fontWeight: '700', marginTop: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: c.primarySoft },
  chipText: { color: c.text, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4 },
  rowName: { color: c.text, fontSize: 14, fontWeight: '600' },
  meta: { color: c.textSecondary, fontSize: 12 },
  link: { color: c.primary, fontSize: 13, fontWeight: '700' },
  addBtn: { width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySoft },
}));
