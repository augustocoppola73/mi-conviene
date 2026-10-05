import { useMemo, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { api, PriceKind, SavingEntry } from '../api';
import { euro, formatQty } from '../format';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { KIND_HELP, PriceKindPicker } from './PriceKindPicker';
import { Card, PrimaryButton } from './ui';

const toNum = (t: string) => {
  const n = parseFloat(t.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};

/**
 * Prezzi veri scritti a mano, riga per riga accanto allo scontrino calcolato (senza foto).
 * Salvati come i prezzi dello scontrino: valgono per i calcoli successivi in quel negozio.
 */
export function ManualPrices({ entry, userId, onClose, onDone }: {
  entry: SavingEntry; userId: string; onClose: () => void; onDone: (msg: string) => void;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const lines = entry.snapshot?.receipt.lines ?? [];
  const already = useMemo(
    () => Object.fromEntries((entry.real_receipt?.lines ?? []).filter((l) => l.product_id).map((l) => [l.product_id!, l.net_price])),
    [entry],
  );
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.product_id, already[l.product_id] != null ? String(already[l.product_id]).replace('.', ',') : ''])),
  );
  const [totalText, setTotalText] = useState(
    entry.paid != null ? String(entry.paid).replace('.', ',') : entry.real_receipt?.total ? String(entry.real_receipt.total).replace('.', ',') : '',
  );
  const [totalTouched, setTotalTouched] = useState(false);
  const [kinds, setKinds] = useState<Record<string, PriceKind>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filled = lines.filter((l) => toNum(prices[l.product_id] ?? '') != null);
  const sum = Math.round(filled.reduce((a, l) => a + (toNum(prices[l.product_id]) ?? 0), 0) * 100) / 100;
  const allFilled = filled.length === lines.length && lines.length > 0;
  // il totale si propone da solo quando hai scritto tutte le righe (lo puoi sempre correggere)
  const total = totalTouched || !allFilled ? toNum(totalText) : sum;
  const calcFilled = Math.round(filled.reduce((a, l) => a + l.line_price, 0) * 100) / 100;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await api.applyReceipt({
        saving_id: entry.id, user_id: userId, store_id: entry.store_id,
        date: entry.created_at.slice(0, 10), total: total ?? null,
        lines: filled.map((l) => ({
          product_id: l.product_id, text: l.name, net_price: toNum(prices[l.product_id])!,
          // a peso: la quantità è il peso comprato; a pezzi/confezioni: il numero di pezzi
          quantity: l.unit === 'kg' ? 1 : l.quantity, weight_kg: l.unit === 'kg' ? l.quantity : null,
          kind: kinds[l.product_id] ?? 'normale',
        })),
      });
      onDone(`Salvati ${r.prices_saved} prezzi veri di ${entry.store_name}${r.verified ? ' e spesa verificata' : ''}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.bg}>
        <Card style={s.card}>
          <ScrollView contentContainerStyle={{ gap: spacing.sm }} keyboardShouldPersistTaps="handled">
            <Text style={s.title}>✍️ Prezzi veri · {entry.store_name}</Text>
            <Text style={s.text}>
              Scrivi accanto a ogni riga quanto l'hai pagata davvero (prezzo della riga, sconti compresi).
              Puoi lasciare vuote quelle che non ricordi.
            </Text>
            <View style={s.headRow}>
              <Text style={[s.head, { flex: 1 }]}>Prodotto</Text>
              <Text style={[s.head, s.colCalc]}>Calcolato</Text>
              <Text style={[s.head, s.colReal]}>Vero</Text>
            </View>
            {lines.map((l) => {
              const v = toNum(prices[l.product_id] ?? '');
              const diff = v != null ? v - l.line_price : null;
              return (
                <View key={l.product_id} style={{ gap: 4 }}>
                <View style={s.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.name} numberOfLines={2}>{l.name}</Text>
                    <Text style={s.meta}>
                      {formatQty(l.quantity, l.unit)}
                      {diff != null && Math.abs(diff) >= 0.01 ? (
                        <Text style={{ color: diff < 0 ? colors.success : colors.danger }}>  {diff < 0 ? '−' : '+'}{euro(Math.abs(diff))}</Text>
                      ) : null}
                    </Text>
                  </View>
                  <Text style={[s.calc, s.colCalc]}>{euro(l.line_price)}</Text>
                  <View style={[s.inputBox, s.colReal]}>
                    <Text style={s.euro}>€</Text>
                    <TextInput
                      value={prices[l.product_id] ?? ''}
                      onChangeText={(t) => setPrices((p) => ({ ...p, [l.product_id]: t.replace(/[^0-9.,]/g, '') }))}
                      keyboardType="decimal-pad" placeholder="—" placeholderTextColor={colors.textSecondary}
                      style={s.input} accessibilityLabel={`Prezzo vero di ${l.name}`}
                    />
                  </View>
                </View>
                {v != null && (
                  <View style={{ gap: 2, paddingBottom: 4 }}>
                    <PriceKindPicker compact value={kinds[l.product_id] ?? 'normale'} onChange={(k) => setKinds((x) => ({ ...x, [l.product_id]: k }))} />
                    {(kinds[l.product_id] ?? 'normale') !== 'normale' && <Text style={s.meta}>{KIND_HELP[kinds[l.product_id]!]}</Text>}
                  </View>
                )}
                </View>
              );
            })}
            {(entry.snapshot?.receipt.custom_items?.length ?? 0) > 0 && (
              <Text style={s.meta}>I prodotti scritti a mano senza prezzo non sono in elenco: contano solo nel totale pagato.</Text>
            )}

            <View style={s.sumRow}>
              <Text style={s.meta}>Righe scritte: {filled.length} di {lines.length}</Text>
              {filled.length > 0 && (
                <Text style={[s.meta, { color: sum <= calcFilled ? colors.success : colors.danger }]}>
                  {euro(sum)} contro {euro(calcFilled)} calcolati
                </Text>
              )}
            </View>

            <Text style={s.label}>Totale pagato (per verificare il Salvadanaio)</Text>
            <View style={s.totalBox}>
              <Text style={s.euroBig}>€</Text>
              <TextInput
                value={totalTouched || !allFilled ? totalText : String(sum).replace('.', ',')}
                onChangeText={(t) => { setTotalTouched(true); setTotalText(t.replace(/[^0-9.,]/g, '')); }}
                keyboardType="decimal-pad" placeholder="facoltativo" placeholderTextColor={colors.textSecondary} style={s.totalInput}
              />
            </View>
            <Text style={s.meta}>
              {total ? 'Con il totale la spesa risulta verificata.' : 'Senza totale salvo solo i prezzi, la spesa resta da verificare.'}
            </Text>

            {error && <Text style={[s.meta, { color: colors.danger }]}>{error}</Text>}
            <PrimaryButton
              label={filled.length ? `Salva ${filled.length} prezzi veri${total ? ' e verifica' : ''}` : total ? 'Verifica con il totale' : 'Scrivi almeno un prezzo'}
              icon="checkmark" loading={saving} disabled={!filled.length && !total} onPress={save}
            />
            <Pressable onPress={onClose} style={{ alignSelf: 'center', padding: spacing.sm }}>
              <Text style={s.meta}>Chiudi</Text>
            </Pressable>
          </ScrollView>
        </Card>
      </View>
    </Modal>
  );
}

const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });
const useStyles = makeStyles((c) => ({
  bg: { flex: 1, backgroundColor: c.overlay, justifyContent: 'center', padding: spacing.md },
  card: { width: '100%', maxWidth: 560, maxHeight: '92%', alignSelf: 'center' },
  title: { color: c.text, fontSize: 19, fontWeight: '700' },
  text: { color: c.text, fontSize: 14, lineHeight: 20 },
  label: { color: c.textSecondary, fontSize: 13, fontWeight: '700', marginTop: spacing.sm },
  headRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', marginTop: spacing.xs },
  head: { color: c.textSecondary, fontSize: 12, fontWeight: '700' },
  colCalc: { width: 70, textAlign: 'right' },
  colReal: { width: 92 },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: c.border },
  name: { color: c.text, fontSize: 14, fontWeight: '600', fontFamily: mono },
  meta: { color: c.textSecondary, fontSize: 12 },
  calc: { color: c.textSecondary, fontSize: 13 },
  inputBox: { flexDirection: 'row', alignItems: 'center', gap: 2, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, paddingHorizontal: 6, backgroundColor: c.surface },
  euro: { color: c.textSecondary, fontSize: 13 },
  input: { flex: 1, minWidth: 0, color: c.text, fontSize: 15, paddingVertical: 6, textAlign: 'right' },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  totalBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface,
  },
  euroBig: { color: c.text, fontSize: 20, fontWeight: '700' },
  totalInput: { flex: 1, minWidth: 0, color: c.text, fontSize: 20, paddingVertical: 10 },
}));
