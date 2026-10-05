import { Fragment } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { RankedStore } from '../api';
import { formatQty } from '../format';

// La carta dello scontrino è bianca anche col tema scuro: è un "oggetto", non interfaccia.
const PAPER = '#FFFFFF';
const INK = '#1F1F1F';
const FADED = '#6E6E6E';
const MONO = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: '"Courier New", Courier, ui-monospace, monospace',
});
const WIDTH = 32; // caratteri per riga, come una stampante termica

const num = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Riga "testo .......... importo" allineata a colonna fissa. */
function cols(left: string, right: string, width = WIDTH): string {
  const l = left.length + right.length + 1 > width ? left.slice(0, width - right.length - 2) + '…' : left;
  return l + ' '.repeat(Math.max(1, width - l.length - right.length)) + right;
}

function Teeth({ flip }: { flip?: boolean }) {
  // bordo seghettato: una fila di triangoli
  return (
    <View style={[st.teeth, flip && { transform: [{ rotate: '180deg' }] }]} accessible={false}>
      {Array.from({ length: 40 }, (_, i) => <View key={i} style={st.tooth} />)}
    </View>
  );
}

export function PaperReceipt({ store, when = new Date(), paid, actual }: {
  store: RankedStore; when?: Date; paid?: number | null;
  /** prezzi veri dello scontrino, per prodotto: mostrati sotto ogni riga calcolata */
  actual?: Record<string, number>;
}) {
  const { receipt, travel } = store;
  const date = when.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = when.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const dash = '-'.repeat(WIDTH);
  const pieces = receipt.lines.length;

  return (
    <View style={st.wrap}>
      <Teeth flip />
      <View style={st.paper}>
        <View style={st.column}>
        <Text style={[st.t, st.center, st.big]}>{store.store_name.toUpperCase()}</Text>
        {store.branch?.address && <Text style={[st.t, st.center]}>{store.branch.address}</Text>}
        <Text style={[st.t, st.center, st.faded]}>SCONTRINO VIRTUALE · STIMA</Text>
        <Text style={st.t}>{cols('', 'EURO')}</Text>

        {receipt.lines.map((l) => {
          const code = l.source === 'stima' ? 'S' : 'R';
          const qty = formatQty(l.quantity, l.unit);
          const row = (
            <Fragment>
              <Text style={st.t}>{cols(l.name.toUpperCase(), `${num(l.in_promo ? l.normal_price : l.line_price)} ${code}`)}</Text>
              <Text style={[st.t, st.faded]}>{'  '}{qty}{l.loyalty_required ? ' · CARTA FEDELTA' : ''}</Text>
              {l.in_promo && (
                <Text style={st.t}>{cols('  SCONTO PROMO', `-${num(l.normal_price - l.line_price)}  `)}</Text>
              )}
              {actual && actual[l.product_id] != null && (
                <Text style={[st.t, { color: actual[l.product_id] <= l.line_price ? '#1E7A3C' : '#B3261E' }]}>
                  {cols('  SCONTRINO VERO', `${num(actual[l.product_id])}  `)}
                </Text>
              )}
              {l.source !== 'stima' && (
                <Text style={[st.t, st.faded]}>
                  {'  '}R: {l.location_name}, {l.observed_at ? new Date(l.observed_at).toLocaleDateString('it-IT') : ''}
                </Text>
              )}
            </Fragment>
          );
          return l.proof_url ? (
            <Pressable key={l.product_id} onPress={() => Linking.openURL(l.proof_url!)} accessibilityHint="Apre la prova del prezzo">
              {row}
            </Pressable>
          ) : (
            <View key={l.product_id}>{row}</View>
          );
        })}

        {(receipt.custom_items?.length ?? 0) > 0 && (
          <>
            <Text style={st.t}>{dash}</Text>
            <Text style={[st.t, st.faded]}>ALTRO DA COMPRARE (SENZA PREZZO)</Text>
            {receipt.custom_items.map((c) => (
              <Text key={c.product_id} style={st.t}>{cols(c.name.toUpperCase(), `${formatQty(c.quantity, c.unit)}  `)}</Text>
            ))}
          </>
        )}
        <Text style={st.t}>{dash}</Text>
        <Text style={st.t}>{cols(`SUBTOTALE (${pieces} ART.)`, num(receipt.normal_total))}</Text>
        {receipt.savings_vs_normal > 0 && <Text style={st.t}>{cols('TOTALE SCONTI', `-${num(receipt.savings_vs_normal)}`)}</Text>}
        <Text style={[st.t, st.total]}>{cols('TOTALE EURO', num(receipt.total), 22)}</Text>
        {travel.fuel_cost > 0 && <Text style={[st.t, st.faded]}>{cols('+ CARBURANTE VIAGGIO', num(travel.fuel_cost))}</Text>}
        <Text style={st.t}>{dash}</Text>
        {paid != null && (
          <>
            <Text style={[st.t, st.total]}>{cols('PAGATO DAVVERO', num(paid), 22)}</Text>
            <Text style={[st.t, st.faded]}>{cols(paid <= receipt.total ? 'IN MENO DEL PREVISTO' : 'IN PIU DEL PREVISTO', num(Math.abs(receipt.total - paid)))}</Text>
            <Text style={st.t}>{dash}</Text>
          </>
        )}
        <Text style={[st.t, st.faded]}>{cols('PREZZI REALI', `${receipt.real_lines}/${pieces}`)}</Text>
        <Text style={[st.t, st.faded]}>R = PREZZO REALE (OPEN PRICES)</Text>
        <Text style={[st.t, st.faded]}>S = PREZZO STIMATO</Text>
        {receipt.unknown_products.length > 0 && (
          <Text style={[st.t, st.faded]}>{receipt.unknown_products.length} ART. NON TROVATI</Text>
        )}
        <Text style={st.t}>{dash}</Text>
        <Text style={[st.t, st.center]}>{date}  {time}</Text>
        <Text style={[st.t, st.center, st.big]}>GRAZIE E ARRIVEDERCI</Text>
        <Text style={[st.t, st.center, st.faded]}>MI CONVIENE · SPENDI MEGLIO</Text>
        </View>
      </View>
      <Teeth />
    </View>
  );
}

const st = StyleSheet.create({
  wrap: {
    alignSelf: 'center', width: '100%', maxWidth: 360, marginTop: 12,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  paper: { backgroundColor: PAPER, paddingHorizontal: 14, paddingVertical: 12 },
  column: { alignSelf: 'center', gap: 1 }, // blocco di 32 caratteri centrato sulla carta
  teeth: { flexDirection: 'row', height: 7, overflow: 'hidden', justifyContent: 'center' },
  tooth: {
    width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 7,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: PAPER,
  },
  t: { fontFamily: MONO, fontSize: 12, lineHeight: 17, color: INK, ...(Platform.OS === 'web' ? { whiteSpace: 'pre' } as object : {}) },
  center: { textAlign: 'center' },
  big: { fontWeight: '700', fontSize: 13 },
  faded: { color: FADED },
  total: { fontWeight: '700', fontSize: 16, lineHeight: 24 },
});
