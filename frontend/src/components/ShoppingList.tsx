import { useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Category, ListItem, Product } from '../api';
import { formatQty, qtyStep } from '../format';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { productEmoji } from '../productEmoji';
import { QtyStepper } from './QtyStepper';
import { Icon, PrimaryButton } from './ui';

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

export function ShoppingList({ items, categories, productById, updateQty, removeItem, setCategory, view = 'lista', categoryOrder }: {
  items: ListItem[];
  categories: Category[];
  productById: (id: string) => Product | undefined;
  updateQty: (id: string, q: number) => void;
  removeItem: (id: string) => void;
  /** solo per i prodotti scritti a mano: cambia reparto */
  setCategory?: (id: string, categoryId: string) => void;
  /** #24: lista (righe) o griglia (card compatte) */
  view?: 'lista' | 'griglia';
  /** #24: ordine dei reparti imparato nel negozio preferito */
  categoryOrder?: string[] | null;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [catFor, setCatFor] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);   // griglia: card aperta
  const [width, setWidth] = useState(0);

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
  const baseOrder = categoryOrder?.length ? categoryOrder : categories.map((c) => c.id);
  const order = new Map([...baseOrder, ...categories.map((c) => c.id).filter((id) => !baseOrder.includes(id))].map((id, i) => [id, i]));
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

  if (view === 'griglia') {
    // fino a 4 per riga se ci stanno (card da almeno 80 px), altrimenti 3
    const GAP = 8;
    const cols = width ? Math.max(3, Math.min(4, Math.floor((width + GAP) / (80 + GAP)))) : 4;
    const tileW = width ? Math.floor((width - GAP * (cols - 1)) / cols) : 0;
    const sel = open ? rows.find((r) => r.item.product_id === open) : undefined;
    return (
      <View style={{ gap: spacing.md }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {/* tutte di seguito nell'ordine dei reparti (meno scorrimento): il reparto è il segnetto in alto a sinistra */}
        <View style={[s.grid, { gap: GAP }]}>
          {sorted.flatMap(([, list]) => list).map((r) => (
            <Pressable key={r.item.product_id} onPress={() => setOpen(r.item.product_id)}
              style={({ pressed }) => [s.tile, tileW ? { width: tileW } : { width: '23%' }, pressed && { opacity: 0.7 }]}
              accessibilityRole="button" accessibilityLabel={`${r.name}, ${formatQty(r.item.quantity, r.unit)}, ${catById.get(r.categoryId)?.name ?? 'Altro'}`}
              accessibilityHint="Tocca per cambiare quantità o toglierlo">
              <Text style={s.tileCat}>{catById.get(r.categoryId)?.emoji ?? '🛒'}</Text>
              <Text style={s.tileEmoji}>{productEmoji(r.name, catById.get(r.categoryId)?.emoji)}</Text>
              <Text style={s.tileName} numberOfLines={2}>{r.name}</Text>
              <Text style={s.tileQty} numberOfLines={1}>{formatQty(r.item.quantity, r.unit)}{r.custom ? ' ✍️' : ''}</Text>
            </Pressable>
          ))}
        </View>
        <ItemSheet row={sel} categories={categories} catEmoji={sel ? catById.get(sel.categoryId)?.emoji : undefined}
          onClose={() => setOpen(null)}
          onQty={(q) => { if (!sel) return; if (q <= 0) { removeItem(sel.item.product_id); setOpen(null); } else updateQty(sel.item.product_id, q); }}
          onRemove={() => { if (sel) removeItem(sel.item.product_id); setOpen(null); }}
          onCategory={sel?.custom && setCategory ? (c) => setCategory(sel.item.product_id, c) : undefined} />
      </View>
    );
  }

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
                {r.custom && setCategory && (
                  <Pressable onPress={() => setCatFor(catFor === r.item.product_id ? null : r.item.product_id)} hitSlop={6}
                    accessibilityRole="button" accessibilityLabel={`Cambia reparto di ${r.name}`}>
                    <Text style={s.catLink}>
                      {catFor === r.item.product_id ? 'Scegli il reparto:' : `${catById.get(r.categoryId)?.emoji ?? '🛒'} Cambia reparto`}
                    </Text>
                  </Pressable>
                )}
                {catFor === r.item.product_id && setCategory && (
                  <View style={s.catRow}>
                    {categories.map((c) => {
                      const on = c.id === r.categoryId;
                      return (
                        <Pressable key={c.id} onPress={() => { setCategory(r.item.product_id, c.id); setCatFor(null); }}
                          style={[s.catChip, on && s.catOn]} accessibilityState={{ selected: on }}>
                          <Text style={[s.catChipText, on && { fontWeight: '700' }]}>{c.emoji} {c.name}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
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

/** #24: la card aperta: quantità grande, togli, cambia reparto. Facile con una mano (in basso). */
function ItemSheet({ row, categories, catEmoji, onClose, onQty, onRemove, onCategory }: {
  row: Row | undefined; categories: Category[]; catEmoji?: string;
  onClose: () => void; onQty: (q: number) => void; onRemove: () => void; onCategory?: (c: string) => void;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState<string | null>(null);
  const [cats, setCats] = useState(false);
  const close = () => { setText(null); setCats(false); onClose(); };
  return (
    <Modal visible={!!row} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={s.sheetBg} onPress={close}>
        <Pressable style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + spacing.md }]} onPress={() => {}}>
          {row && (
            <>
              <View style={s.sheetHead}>
                <Text style={{ fontSize: 40 }}>{productEmoji(row.name, catEmoji)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.sheetTitle}>{row.name}</Text>
                  {row.custom && <Text style={s.muted}>✍️ scritto a mano · senza prezzo in lista</Text>}
                </View>
                <Pressable onPress={close} hitSlop={12} accessibilityLabel="Chiudi"><Icon name="close" size={26} color={colors.textSecondary} /></Pressable>
              </View>
              <View style={s.sheetQty}>
                <QtyStepper quantity={row.item.quantity} unit={row.unit} step={row.step} onChange={onQty} />
                {text === null ? (
                  <Pressable onPress={() => setText(String(row.item.quantity).replace('.', ','))} hitSlop={8}>
                    <Text style={s.catLink}>✎ Scrivi la quantità</Text>
                  </Pressable>
                ) : (
                  <TextInput value={text} onChangeText={setText} autoFocus selectTextOnFocus keyboardType="decimal-pad"
                    onSubmitEditing={() => { const n = parseQty(text, row.unit); if (n != null) onQty(n); setText(null); }}
                    onBlur={() => { const n = parseQty(text, row.unit); if (n != null) onQty(n); setText(null); }}
                    style={s.editInput} accessibilityLabel={`Quantità di ${row.name}`} />
                )}
              </View>
              {onCategory && (
                <>
                  <Pressable onPress={() => setCats(!cats)} hitSlop={6}><Text style={s.catLink}>{cats ? 'Scegli il reparto:' : '🏷️ Cambia reparto'}</Text></Pressable>
                  {cats && (
                    <View style={s.catRow}>
                      {categories.map((c) => (
                        <Pressable key={c.id} onPress={() => { onCategory(c.id); setCats(false); }}
                          style={[s.catChip, c.id === row.categoryId && s.catOn]}>
                          <Text style={s.catChipText}>{c.emoji} {c.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </>
              )}
              <PrimaryButton label="Togli dalla lista" icon="trash-outline" variant="secondary" onPress={onRemove} style={{ marginTop: spacing.md }} />
              <PrimaryButton label="Fatto" icon="checkmark-outline" onPress={close} style={{ marginTop: spacing.sm }} />
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: {
    minHeight: 96, paddingVertical: 8, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'flex-start', gap: 2,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface,
  },
  tileEmoji: { fontSize: 30, lineHeight: 36 },
  tileCat: { position: 'absolute', top: 3, left: 4, fontSize: 10, opacity: 0.75 },
  tileName: { color: c.text, fontSize: 12.5, fontWeight: '600', textAlign: 'center', lineHeight: 15 },
  tileQty: { color: c.primary, fontSize: 12, fontWeight: '700', marginTop: 'auto' },
  sheetBg: { flex: 1, backgroundColor: c.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl,
    width: '100%', maxWidth: 640, alignSelf: 'center', gap: spacing.sm },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  sheetTitle: { color: c.text, fontSize: 19, fontWeight: '800' },
  sheetQty: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginTop: spacing.sm, flexWrap: 'wrap' },
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
  catLink: { color: c.primary, fontSize: 12, fontWeight: '600', marginTop: 4 },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  catChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border },
  catOn: { backgroundColor: c.primarySoft, borderColor: c.primary },
  catChipText: { color: c.text, fontSize: 13 },
  stepBtn: {
    width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.surfaceMuted,
  },
}));
