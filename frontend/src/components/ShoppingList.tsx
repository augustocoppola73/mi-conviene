import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import type { Category, ListItem, Product } from '../api';
import { formatQty, qtyStep } from '../format';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { Icon } from './ui';

/**
 * Interpreta la quantità scritta a mano rispetto all'unità del prodotto:
 * "1,5" -> 1.5 · per i kg anche "500 g" / "500g" -> 0.5 · per i litri "750 ml" -> 0.75.
 */
export function parseQty(text: string, unit: string): number | null {
  const t = text.trim().toLowerCase().replace(',', '.');
  const m = t.match(/^(\d+(?:\.\d+)?)\s*([a-z]*)$/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  const u = m[2];
  if (unit === 'kg' && (u === 'g' || u === 'gr')) n = n / 1000;
  else if (unit === 'L' && u === 'ml') n = n / 1000;
  else if (unit === 'L' && u === 'cl') n = n / 100;
  if (!Number.isFinite(n) || n <= 0 || n > 999) return null;
  return Math.round(n * 1000) / 1000;
}

interface Row { item: ListItem; name: string; unit: string; step: number; custom: boolean; categoryId: string }

export function ShoppingList({ items, categories, productById, updateQty, removeItem }: {
  items: ListItem[];
  categories: Category[];
  productById: (id: string) => Product | undefined;
  updateQty: (id: string, q: number) => void;
  removeItem: (id: string) => void;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');

  const rows: Row[] = items
    .map((it): Row | null => {
      if (it.product_id.startsWith('custom:')) {
        return { item: it, name: it.name ?? it.product_id.slice(7), unit: it.unit ?? 'pz', step: 1, custom: true, categoryId: it.category_id ?? 'altro' };
      }
      const p = productById(it.product_id);
      if (!p) return null;
      return { item: it, name: p.name, unit: p.unit, step: qtyStep(p.default_qty, p.unit), custom: false, categoryId: p.category_id };
    })
    .filter((r): r is Row => r !== null);

  // raggruppate per categoria, nell'ordine delle categorie (come in negozio)
  const order = new Map(categories.map((c, i) => [c.id, i]));
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = order.has(r.categoryId) ? r.categoryId : 'altro';
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const sorted = [...groups.entries()].sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99));
  const catById = new Map(categories.map((c) => [c.id, c]));

  const commit = (r: Row) => {
    const n = parseQty(text, r.unit);
    if (n != null) updateQty(r.item.product_id, n);
    setEditing(null);
  };

  return (
    <View style={{ gap: spacing.md }}>
      {sorted.map(([catId, list]) => (
        <View key={catId} style={{ gap: spacing.sm }}>
          <Text style={s.group}>{catById.get(catId)?.emoji ?? '🛒'} {catById.get(catId)?.name ?? 'Altro'}</Text>
          {list.map((r) => (
            <View key={r.item.product_id} style={s.itemRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.itemName}>{r.name}</Text>
                {editing === r.item.product_id ? (
                  <View style={s.editRow}>
                    <TextInput
                      value={text}
                      onChangeText={setText}
                      autoFocus
                      selectTextOnFocus
                      keyboardType="decimal-pad"
                      onSubmitEditing={() => commit(r)}
                      onBlur={() => commit(r)}
                      style={s.editInput}
                      accessibilityLabel={`Quantità di ${r.name}`}
                    />
                    <Text style={s.muted}>{r.unit}{r.unit === 'kg' ? ' (o "500 g")' : ''}</Text>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => { setEditing(r.item.product_id); setText(String(r.item.quantity).replace('.', ',')); }}
                    hitSlop={6}
                    accessibilityHint="Tocca per scrivere la quantità">
                    <Text style={s.qty}>
                      {formatQty(r.item.quantity, r.unit)} <Text style={s.editHint}>✎</Text>
                      {r.custom ? <Text style={s.muted}>  · senza prezzo</Text> : null}
                    </Text>
                  </Pressable>
                )}
              </View>
              <Pressable accessibilityLabel="Diminuisci" style={s.stepBtn} onPress={() => updateQty(r.item.product_id, Math.round((r.item.quantity - r.step) * 1000) / 1000)}>
                <Icon name="remove" />
              </Pressable>
              <Pressable accessibilityLabel="Aumenta" style={s.stepBtn} onPress={() => updateQty(r.item.product_id, Math.round((r.item.quantity + r.step) * 1000) / 1000)}>
                <Icon name="add" />
              </Pressable>
              <Pressable accessibilityLabel="Rimuovi" hitSlop={8} onPress={() => removeItem(r.item.product_id)} style={{ paddingLeft: spacing.xs }}>
                <Icon name="trash-outline" color={colors.danger} />
              </Pressable>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  group: { color: c.textSecondary, fontSize: 13, fontWeight: '700', marginTop: spacing.xs },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface,
  },
  itemName: { color: c.text, fontSize: 16, fontWeight: '600' },
  qty: { color: c.textSecondary, fontSize: 13, marginTop: 2 },
  editHint: { color: c.primary, fontSize: 12 },
  muted: { color: c.textSecondary, fontSize: 12 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 },
  editInput: {
    width: 90, color: c.text, fontSize: 15, paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.sm, borderWidth: 1, borderColor: c.primary, backgroundColor: c.surface,
  },
  stepBtn: {
    width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.surfaceMuted,
  },
}));
