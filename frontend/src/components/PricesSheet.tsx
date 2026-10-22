/**
 * #45: i prezzi di una spesa calcolata, uno per uno, con da dove vengono e quanto sono vecchi.
 * «Il prezzo è cambiato?»: si scrive quello visto e va nei prezzi di tutti (con i controlli del database).
 */
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, RankedStore, ReceiptLine } from '../api';
import { showError } from '../errors';
import { euro, formatQty, parseEuro } from '../format';
import { priceLabel } from '../priceInfo';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { PrimaryButton } from './ui';

export function PricesSheet({ store, visible, onClose }: { store: RankedStore; visible: boolean; onClose: () => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Record<string, number>>({});
  const lines = store.receipt.lines.filter((l) => !l.custom);
  const real = lines.filter((l) => l.source !== 'stima');
  const est = lines.filter((l) => l.source === 'stima');

  const send = async (l: ReceiptLine) => {
    const v = parseEuro(text);
    if (!Number.isFinite(v) || v <= 0) return;
    setBusy(true);
    try {
      const r = await api.reportPrice(store.store_id, l.product_id, v, l.quantity);
      if (!r.prices_saved) throw new Error('Questo prezzo sembra fuori scala: ricontrolla la cifra');
      setSent((x) => ({ ...x, [l.product_id]: v }));
      setEditing(null); setText('');
    } catch (e) { showError('Prezzo', e); } finally { setBusy(false); }
  };

  const Row = ({ l }: { l: ReceiptLine }) => {
    const pl = priceLabel(l);
    const mine = sent[l.product_id];
    return (
      <View style={s.row}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.name} numberOfLines={2}>{l.name}</Text>
            <Text style={[s.meta, !pl.real && { fontStyle: 'italic' }, pl.old && { color: colors.warning }]}>
              {formatQty(l.quantity, l.unit)} · {pl.real ? pl.text : 'stima'}{l.in_promo ? ' · in offerta' : ''}
            </Text>
            {mine != null && <Text style={[s.meta, { color: colors.success }]}>✓ Hai segnalato {euro(mine)}: vale dalla prossima ricerca</Text>}
          </View>
          <Text style={[s.price, !pl.real && { color: colors.textSecondary }]}>{pl.real ? '' : '~'}{euro(l.line_price)}</Text>
        </View>
        {editing === l.product_id ? (
          <View style={s.editRow}>
            <Text style={s.meta}>Prezzo visto per {formatQty(l.quantity, l.unit)}: €</Text>
            <TextInput value={text} onChangeText={(t) => setText(t.replace(/[^0-9.,]/g, ''))} keyboardType="decimal-pad" inputMode="decimal" autoFocus
              placeholder={String(l.line_price).replace('.', ',')} placeholderTextColor={colors.textSecondary} style={s.input} onSubmitEditing={() => send(l)}
              accessibilityLabel={`Prezzo visto di ${l.name}`} />
            <Text onPress={() => send(l)} style={[s.link, busy && { opacity: 0.5 }]} accessibilityRole="button">Invia</Text>
            <Text onPress={() => setEditing(null)} style={[s.link, { color: colors.textSecondary }]} accessibilityRole="button">Annulla</Text>
          </View>
        ) : (
          <Text onPress={() => { setEditing(l.product_id); setText(''); }} style={[s.link, { alignSelf: 'flex-start', paddingVertical: 4 }]} accessibilityRole="button">
            {pl.real ? 'Il prezzo è cambiato?' : 'Hai visto il prezzo? Scrivilo'}
          </Text>
        )}
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.bg} onPress={onClose}>
        <Pressable style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + spacing.md }]} onPress={() => {}}>
          <Text style={s.title}>Prezzi da {store.store_name}</Text>
          <Text style={s.meta}>
            {real.length} {real.length === 1 ? 'prezzo visto' : 'prezzi visti'} (scontrini, negozio, Open Prices) e {est.length} {est.length === 1 ? 'stimato' : 'stimati'}.
            Le stime vengono dalla media della catena: il prezzo vero può essere diverso.
          </Text>
          <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: spacing.sm }} keyboardShouldPersistTaps="handled">
            {real.length > 0 && <Text style={s.section}>Prezzi visti</Text>}
            {real.map((l) => <Row key={l.product_id} l={l} />)}
            {est.length > 0 && <Text style={s.section}>Stimati</Text>}
            {est.map((l) => <Row key={l.product_id} l={l} />)}
          </ScrollView>
          <PrimaryButton label="Chiudi" variant="secondary" onPress={onClose} style={{ marginTop: spacing.sm }} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  bg: { flex: 1, backgroundColor: c.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.sm,
    width: '100%', maxWidth: 640, alignSelf: 'center', maxHeight: '92%' },
  title: { color: c.text, fontSize: 20, fontWeight: '800' },
  section: { color: c.text, fontSize: 14, fontWeight: '800', marginTop: spacing.sm },
  row: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.border, gap: 2 },
  name: { color: c.text, fontSize: 15, fontWeight: '600' },
  meta: { color: c.textSecondary, fontSize: 12.5, lineHeight: 17 },
  price: { color: c.text, fontSize: 15, fontWeight: '700' },
  link: { color: c.primary, fontWeight: '700', fontSize: 13 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', marginTop: 4 },
  input: { minWidth: 80, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 6,
    color: c.text, backgroundColor: c.background, fontSize: 15 },
}));
