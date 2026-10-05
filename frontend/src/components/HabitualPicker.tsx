import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import type { Category, HabitualItem, Product } from '../api';
import { formatQty } from '../format';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { Card, Icon, PrimaryButton } from './ui';

/**
 * Proposta della spesa abituale: i prodotti che compri più spesso, ognuno con quante volte
 * l'hai comprato. Sono già spuntati: togli quelli che oggi non servono e confermi.
 */
export function HabitualPicker({ items, occasions, categories, productById, inList, onConfirm, onClose }: {
  items: HabitualItem[]; occasions: number; categories: Category[];
  productById: (id: string) => Product | undefined; inList: (id: string) => boolean;
  onConfirm: (chosen: HabitualItem[]) => void; onClose: () => void;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const [off, setOff] = useState<Set<string>>(() => new Set(items.filter((i) => inList(i.product_id)).map((i) => i.product_id)));
  const catById = new Map(categories.map((c) => [c.id, c]));
  const chosen = items.filter((i) => !off.has(i.product_id));
  const toggle = (id: string) =>
    setOff((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.bg}>
        <Card style={s.card}>
          <Text style={s.title}>🔁 Quello che compri di solito</Text>
          <Text style={s.text}>
            Su {occasions} spese diverse, questi sono i prodotti che compri più spesso. Togli quelli che oggi non ti servono.
          </Text>
          <View style={s.rowHead}>
            <Pressable onPress={() => setOff(new Set())} hitSlop={6}><Text style={s.link}>Tutti</Text></Pressable>
            <Pressable onPress={() => setOff(new Set(items.map((i) => i.product_id)))} hitSlop={6}><Text style={s.link}>Nessuno</Text></Pressable>
          </View>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 6 }}>
            {items.map((i) => {
              const p = productById(i.product_id);
              const on = !off.has(i.product_id);
              return (
                <Pressable key={i.product_id} onPress={() => toggle(i.product_id)} style={[s.row, on && s.rowOn]}
                  accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                  <Icon name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.primary : colors.textSecondary} />
                  <Text style={s.emoji}>{p ? catById.get(p.category_id)?.emoji ?? '🛒' : '🛒'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.name}>{i.name}</Text>
                    <Text style={s.meta}>
                      {i.count} {i.count === 1 ? 'volta' : 'volte'} su {occasions}
                      {p ? ` · di solito ${formatQty(i.quantity, p.unit)}` : ''}
                      {inList(i.product_id) ? ' · già in lista' : ''}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          <PrimaryButton
            label={chosen.length ? `Aggiungi ${chosen.length} ${chosen.length === 1 ? 'prodotto' : 'prodotti'}` : 'Nessun prodotto scelto'}
            icon="add"
            disabled={!chosen.length}
            onPress={() => onConfirm(chosen)}
          />
          <Pressable onPress={onClose} style={{ alignSelf: 'center', padding: spacing.sm }}>
            <Text style={s.meta}>Annulla</Text>
          </Pressable>
        </Card>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  bg: { flex: 1, backgroundColor: c.overlay, justifyContent: 'center', padding: spacing.md },
  card: { width: '100%', maxWidth: 480, maxHeight: '90%', alignSelf: 'center', gap: spacing.md },
  title: { color: c.text, fontSize: 19, fontWeight: '700' },
  text: { color: c.text, fontSize: 14, lineHeight: 20 },
  rowHead: { flexDirection: 'row', gap: spacing.lg, justifyContent: 'flex-end' },
  link: { color: c.primary, fontSize: 13, fontWeight: '700' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.border,
  },
  rowOn: { borderColor: c.primary, backgroundColor: c.primarySoft },
  emoji: { fontSize: 18, width: 24, textAlign: 'center' },
  name: { color: c.text, fontSize: 15, fontWeight: '600' },
  meta: { color: c.textSecondary, fontSize: 12 },
}));
