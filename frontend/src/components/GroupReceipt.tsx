/**
 * #16: lo scontrino del gruppo da verificare con quello di carta. Si correggono i prezzi dei prodotti
 * (lo scontrino di carta ha anche la tua roba) oppure si scrive il totale per il gruppo; "Conferma" lo manda al gruppo.
 */
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { confirmExpense, ExpenseLine } from '../cloud/groups';
import { euro } from '../format';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { PrimaryButton } from './ui';

const num = (t: string) => { const n = parseFloat(t.replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : null; };
const fmt = (n: number) => n.toFixed(2).replace('.', ',');

export function GroupReceiptEditor({ expenseId, title, lines, amount, onDone }: {
  expenseId: string; title: string; lines: ExpenseLine[]; amount: number; onDone?: (amount: number) => void;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const [prices, setPrices] = useState<string[]>(lines.map((l) => fmt(Number(l.price) || 0)));
  const [byTotal, setByTotal] = useState(!lines.length);
  const [total, setTotal] = useState(fmt(amount));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const sum = Math.round(prices.reduce((t, p) => t + (num(p) ?? 0), 0) * 100) / 100;
  const final = byTotal ? num(total) : sum;

  const confirm = async () => {
    if (!final || final <= 0) { setErr('Il totale per il gruppo deve essere più di zero'); return; }
    setBusy(true); setErr(null);
    try {
      const newLines = lines.map((l, k) => ({ ...l, price: num(prices[k]) ?? Number(l.price) }));
      await confirmExpense(expenseId, final, byTotal ? null : newLines);
      setDone(final); onDone?.(final);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  if (done != null) {
    return (
      <View style={s.box}>
        <Text style={s.title}>{title}</Text>
        <Text style={[s.text, { color: colors.success }]}>✓ Mandato al gruppo: {euro(done)}. I conti si sono aggiornati.</Text>
      </View>
    );
  }
  return (
    <View style={s.box}>
      <Text style={s.title}>{title}</Text>
      <Text style={s.help}>Controlla con lo scontrino di carta. Correggi i prezzi dei prodotti del gruppo (sullo scontrino c'è anche la tua roba), poi conferma: solo allora arriva nel gruppo.</Text>
      {!byTotal && lines.map((l, k) => (
        <View key={k} style={s.line}>
          <Text style={[s.text, { flex: 1 }]} numberOfLines={2}>{l.name}{l.quantity ? ` · ${l.quantity}${l.unit ? ` ${l.unit}` : ''}` : ''}</Text>
          <Text style={s.text}>€</Text>
          <TextInput value={prices[k]} onChangeText={(t) => setPrices((p) => p.map((x, i) => (i === k ? t.replace(/[^0-9.,]/g, '') : x)))}
            keyboardType="decimal-pad" inputMode="decimal" style={s.price} selectTextOnFocus accessibilityLabel={`Prezzo di ${l.name}`} />
        </View>
      ))}
      {byTotal ? (
        <View style={s.line}>
          <Text style={[s.text, { flex: 1, fontWeight: '700' }]}>Totale per il gruppo</Text>
          <Text style={s.text}>€</Text>
          <TextInput value={total} onChangeText={(t) => setTotal(t.replace(/[^0-9.,]/g, ''))} keyboardType="decimal-pad" inputMode="decimal"
            style={s.price} selectTextOnFocus accessibilityLabel="Totale per il gruppo" />
        </View>
      ) : (
        <Text style={[s.text, { fontWeight: '800', textAlign: 'right' }]}>Totale per il gruppo: {euro(sum)}</Text>
      )}
      {lines.length > 0 && (
        <Pressable onPress={() => setByTotal(!byTotal)} hitSlop={6}>
          <Text style={s.link}>{byTotal ? 'Correggi i prezzi dei prodotti' : 'Scrivo solo il totale per il gruppo'}</Text>
        </Pressable>
      )}
      {err && <Text style={[s.help, { color: colors.danger }]}>{err}</Text>}
      <PrimaryButton label="Conferma e manda al gruppo" icon="send-outline" onPress={confirm} loading={busy} disabled={!final} />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  box: { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.primary, padding: spacing.md, gap: spacing.sm },
  title: { color: c.text, fontSize: 16, fontWeight: '800' },
  help: { color: c.textSecondary, fontSize: 13, lineHeight: 18 },
  text: { color: c.text, fontSize: 14 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  price: { width: 84, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: 8, paddingVertical: 6,
    color: c.text, backgroundColor: c.background, fontSize: 15, textAlign: 'right' },
  link: { color: c.primary, fontWeight: '700', fontSize: 13 },
}));
