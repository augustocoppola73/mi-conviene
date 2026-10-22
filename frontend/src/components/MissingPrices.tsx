/**
 * #43: a fine spesa, «Mancano i prezzi di 3 prodotti: li segni?». Solo quelli presi di cui nessuno ha mai visto
 * il prezzo in quel negozio (stime e prodotti scritti a mano), al massimo 6. «Salta» sempre possibile.
 */
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { api, UnpricedItem } from '../api';
import { euro, formatQty, parseEuro } from '../format';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { PrimaryButton } from './ui';

export function MissingPrices({ items, onSaved }: { items: UnpricedItem[]; onSaved?: (n: number) => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const list = items.slice(0, 6);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ ok: number; refused: number } | null>(null);
  const [skipped, setSkipped] = useState(false);
  if (!list.length || skipped) return null;
  if (done) {
    return (
      <View style={s.card}>
        <Text style={s.text}>✅ {done.ok === 1 ? 'Un prezzo salvato' : `${done.ok} prezzi salvati`}: dalla prossima spesa sono prezzi veri, per te e per chi fa la spesa lì.
          {done.refused ? ` ${done.refused === 1 ? 'Uno sembrava' : `${done.refused} sembravano`} fuori scala e non l'ho tenuto.` : ''}</Text>
      </View>
    );
  }
  const filled = list.filter((i) => { const v = parseEuro(vals[i.key] ?? ''); return Number.isFinite(v) && v > 0; });
  const save = async () => {
    setBusy(true);
    let ok = 0; let refused = 0;
    for (const i of filled) {
      try {
        const r = await api.reportPrice(i.store_id, i.product_id, parseEuro(vals[i.key]), i.quantity, 'normale', { name: i.name, unit: i.unit });
        if (r.prices_saved) ok++; else refused++;
      } catch { refused++; }
    }
    setBusy(false); setDone({ ok, refused }); onSaved?.(ok);
  };
  return (
    <View style={s.card}>
      <Text style={s.title}>🏷️ {list.length === 1 ? 'Manca il prezzo di un prodotto' : `Mancano i prezzi di ${list.length} prodotti`}: li segni?</Text>
      <Text style={s.muted}>Nessuno li ha ancora visti in questo negozio. Scrivi quanto li hai pagati (lo leggi sullo scontrino): da domani il confronto è più preciso.</Text>
      {list.map((i) => (
        <View key={i.key} style={s.row}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.name} numberOfLines={2}>{i.name}</Text>
            <Text style={s.muted}>{formatQty(i.quantity, i.unit)}</Text>
          </View>
          <Text style={s.euro}>€</Text>
          <TextInput value={vals[i.key] ?? ''} onChangeText={(t) => setVals((v) => ({ ...v, [i.key]: t.replace(/[^0-9.,]/g, '') }))}
            keyboardType="decimal-pad" inputMode="decimal" placeholder="0,00" placeholderTextColor={colors.textSecondary} style={s.input}
            accessibilityLabel={`Prezzo pagato di ${i.name}`} />
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
        <PrimaryButton label={filled.length ? `Salva ${filled.length === 1 ? 'il prezzo' : `${filled.length} prezzi`}` : 'Salva'} icon="pricetag-outline"
          onPress={save} loading={busy} disabled={!filled.length} style={{ flex: 1 }} />
        <PrimaryButton label="Salta" variant="secondary" onPress={() => setSkipped(true)} style={{ flex: 1 }} />
      </View>
      {filled.length > 0 && <Text style={s.muted}>In tutto {euro(filled.reduce((t, i) => t + parseEuro(vals[i.key]), 0))}</Text>}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  card: { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: spacing.md, gap: spacing.sm, marginTop: spacing.md },
  title: { color: c.text, fontSize: 16, fontWeight: '800' },
  text: { color: c.text, fontSize: 14, lineHeight: 20 },
  muted: { color: c.textSecondary, fontSize: 12.5, lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { color: c.text, fontSize: 15, fontWeight: '600' },
  euro: { color: c.text, fontSize: 16, fontWeight: '700' },
  input: { width: 90, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 8,
    color: c.text, backgroundColor: c.background, fontSize: 16, textAlign: 'right' },
}));
