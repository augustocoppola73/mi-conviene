import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { api, Product, SavingEntry, ScanResult } from '../api';
import { euro } from '../format';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { Card, Icon, PrimaryButton, StoreDot } from './ui';

const CHAINS = ['esselunga', 'conad', 'coop', 'lidl', 'carrefour', 'pam', 'eurospin'];
const CHAIN_NAME: Record<string, string> = {
  esselunga: 'Esselunga', conad: 'Conad', coop: 'Coop', lidl: 'Lidl', carrefour: 'Carrefour', pam: 'PAM', eurospin: 'Eurospin',
};

/**
 * Foto dello scontrino -> righe lette -> abbinamento ai prodotti -> controllo dell'utente
 * -> i prezzi veri vengono salvati (prezzi "R" di quel negozio) e la spesa è verificata.
 */
export function ReceiptScanner({ entry, userId, productById, onClose, onDone }: {
  entry: SavingEntry; userId: string; productById: (id: string) => Product | undefined;
  onClose: () => void; onDone: (msg: string) => void;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const [step, setStep] = useState<'pick' | 'reading' | 'review'>('pick');
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [store, setStore] = useState<string>(entry.store_id);
  const [totalText, setTotalText] = useState('');
  const [choosing, setChoosing] = useState<number | null>(null);
  const [refueled, setRefueled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  const expected = (entry.snapshot?.receipt.lines ?? []).map((l) => l.product_id);

  const pick = async (camera: boolean) => {
    setError(null);
    try {
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], base64: true, quality: 0.7 };
      if (camera && Platform.OS !== 'web') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { setError('Permesso fotocamera negato.'); return; }
      }
      const res = camera && Platform.OS !== 'web'
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const b64 = a.base64 ?? (a.uri.startsWith('data:') ? a.uri : null);
      if (!b64) { setError('Non riesco a leggere il file.'); return; }
      setStep('reading');
      const r = await api.scanReceipt(b64, entry.id);
      setScan(r);
      if (r.store_id) setStore(r.store_id);
      setTotalText(r.total != null ? String(r.total).replace('.', ',') : r.lines_sum ? String(r.lines_sum).replace('.', ',') : '');
      setStep('review');
    } catch (e) {
      setError((e as Error).message);
      setStep('pick');
    }
  };

  const total = parseFloat(totalText.replace(',', '.'));
  const totalOk = Number.isFinite(total) && total > 0;

  const setLineProduct = (i: number, pid: string | null) => {
    if (!scan) return;
    const lines = scan.lines.map((l, k) => (k === i ? { ...l, product_id: pid, product_name: pid ? productById(pid)?.name ?? pid : null } : l));
    setScan({ ...scan, lines });
    setChoosing(null);
  };

  const save = async () => {
    if (!scan) return;
    setSaving(true);
    try {
      const r = await api.applyReceipt({
        saving_id: entry.id, user_id: userId, store_id: store, date: scan.date, total: totalOk ? total : null,
        lines: scan.lines.map((l) => ({ product_id: l.product_id, text: l.text, net_price: l.net_price, quantity: l.quantity, weight_kg: l.weight_kg })),
        ...((entry.fuel_saving ?? 0) > 0 && refueled !== null ? { refueled } : {}),
      });
      onDone(`Salvati ${r.prices_saved} prezzi veri di ${CHAIN_NAME[store] ?? store}${r.verified ? ' e spesa verificata' : ''}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const matchedCount = scan?.lines.filter((l) => l.product_id).length ?? 0;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.bg}>
        <Card style={s.card}>
          <ScrollView contentContainerStyle={{ gap: spacing.md }}>
            <Text style={s.title}>📷 Scontrino di {entry.store_name}</Text>

            {step === 'pick' && (
              <>
                <Text style={s.text}>
                  Fotografa lo scontrino intero, ben steso e con buona luce. Lo leggo qui sul tuo computer: la foto non viene inviata a nessuno.
                </Text>
                {Platform.OS !== 'web' && (
                  <PrimaryButton label="Scatta una foto" icon="camera-outline" onPress={() => pick(true)} />
                )}
                <PrimaryButton
                  label={Platform.OS === 'web' ? 'Scegli la foto dello scontrino' : 'Scegli dalla galleria'}
                  icon="image-outline"
                  variant={Platform.OS === 'web' ? 'primary' : 'secondary'}
                  onPress={() => pick(false)}
                />
              </>
            )}

            {step === 'reading' && (
              <View style={{ alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl }}>
                <ActivityIndicator color={colors.primary} size="large" />
                <Text style={s.text}>Leggo lo scontrino… (la prima volta ci mette qualche secondo in più)</Text>
              </View>
            )}

            {step === 'review' && scan && (
              <>
                <Text style={s.text}>
                  Ho letto {scan.lines.length} righe e ne ho abbinate {matchedCount} ai prodotti. Controlla e correggi se serve.
                </Text>

                <Text style={s.label}>Supermercato</Text>
                <View style={s.chips}>
                  {CHAINS.map((c) => (
                    <Pressable key={c} onPress={() => setStore(c)} style={[s.chip, store === c && s.chipOn]}>
                      <StoreDot storeId={c} size={10} />
                      <Text style={[s.chipText, store === c && s.chipTextOn]}>{CHAIN_NAME[c]}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={s.label}>Righe dello scontrino</Text>
                {scan.lines.map((l, i) => {
                  const diff = l.calculated_price != null ? l.net_price - l.calculated_price : null;
                  return (
                    <View key={i} style={s.line}>
                      <View style={s.lineTop}>
                        <Text style={s.lineText} numberOfLines={1}>{l.text}</Text>
                        <Text style={s.linePrice}>{euro(l.net_price)}</Text>
                      </View>
                      {(l.quantity > 1 || l.weight_kg || l.discount > 0) && (
                        <Text style={s.small}>
                          {l.quantity > 1 ? `${l.quantity} pezzi · ` : ''}{l.weight_kg ? `${l.weight_kg.toLocaleString('it-IT')} kg · ` : ''}
                          {l.discount > 0 ? `sconto ${euro(l.discount)}` : ''}
                        </Text>
                      )}
                      <Pressable onPress={() => setChoosing(choosing === i ? null : i)} style={s.matchRow}>
                        <Icon name={l.product_id ? 'link' : 'help-circle-outline'} size={14} color={l.product_id ? colors.success : colors.warning} />
                        <Text style={[s.small, { color: l.product_id ? colors.text : colors.warning, flex: 1 }]}>
                          {l.product_id ? `= ${l.product_name}` : 'Non abbinato: tocca per scegliere'}
                        </Text>
                        {diff != null && Math.abs(diff) >= 0.01 && (
                          <Text style={[s.small, { color: diff < 0 ? colors.success : colors.danger }]}>
                            calcolato {euro(l.calculated_price!)} ({diff < 0 ? '−' : '+'}{euro(Math.abs(diff))})
                          </Text>
                        )}
                      </Pressable>
                      {choosing === i && (
                        <View style={s.chips}>
                          {expected.map((pid) => (
                            <Pressable key={pid} onPress={() => setLineProduct(i, pid)} style={[s.chip, l.product_id === pid && s.chipOn]}>
                              <Text style={[s.chipText, l.product_id === pid && s.chipTextOn]}>{productById(pid)?.name ?? pid}</Text>
                            </Pressable>
                          ))}
                          <Pressable onPress={() => setLineProduct(i, null)} style={s.chip}>
                            <Text style={s.chipText}>Nessuno (non salvare il prezzo)</Text>
                          </Pressable>
                        </View>
                      )}
                    </View>
                  );
                })}
                {scan.missing_expected.length > 0 && (
                  <Text style={s.small}>
                    Non trovati sullo scontrino: {scan.missing_expected.map((p) => productById(p)?.name ?? p).join(', ')}
                  </Text>
                )}

                <Text style={s.label}>Totale pagato</Text>
                <View style={s.inputRow}>
                  <Text style={s.euro}>€</Text>
                  <TextInput value={totalText} onChangeText={(t) => setTotalText(t.replace(/[^0-9.,]/g, ''))} keyboardType="decimal-pad" style={s.input} />
                </View>
                <Text style={[s.small, { color: scan.total_matches ? colors.success : colors.warning }]}>
                  {scan.total_matches
                    ? `✓ Il totale torna con la somma delle righe (${euro(scan.lines_sum)})`
                    : `Somma delle righe lette: ${euro(scan.lines_sum)}${scan.total != null ? ` · totale letto: ${euro(scan.total)}` : ''}: controlla`}
                </Text>

                {(entry.fuel_saving ?? 0) > 0 && (
                  <View style={s.chips}>
                    <Text style={s.small}>Hai fatto carburante da {entry.fuel_station}?</Text>
                    {[true, false].map((v) => (
                      <Pressable key={String(v)} onPress={() => setRefueled(v)} style={[s.chip, refueled === v && s.chipOn]}>
                        <Text style={[s.chipText, refueled === v && s.chipTextOn]}>{v ? 'Sì' : 'No'}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}

                <PrimaryButton
                  label={`Salva i prezzi veri${totalOk ? ` e verifica (${euro(total)})` : ''}`}
                  icon="checkmark"
                  loading={saving}
                  disabled={!matchedCount && !totalOk}
                  onPress={save}
                />
                <PrimaryButton label="Rifai la foto" variant="secondary" onPress={() => { setScan(null); setStep('pick'); }} />
              </>
            )}

            {error && <Text style={[s.small, { color: colors.danger }]}>{error}</Text>}
            <Pressable onPress={onClose} style={{ alignSelf: 'center', padding: spacing.sm }}>
              <Text style={s.small}>Chiudi</Text>
            </Pressable>
          </ScrollView>
        </Card>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  bg: { flex: 1, backgroundColor: c.overlay, justifyContent: 'center', padding: spacing.md },
  card: { width: '100%', maxWidth: 520, maxHeight: '92%', alignSelf: 'center' },
  title: { color: c.text, fontSize: 19, fontWeight: '700' },
  text: { color: c.text, fontSize: 14, lineHeight: 20 },
  label: { color: c.textSecondary, fontSize: 13, fontWeight: '700', marginTop: spacing.xs },
  small: { color: c.textSecondary, fontSize: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border },
  chipOn: { backgroundColor: c.primary, borderColor: c.primary },
  chipText: { color: c.text, fontSize: 12 },
  chipTextOn: { color: c.primaryText },
  line: { borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: spacing.sm, gap: 4 },
  lineTop: { flexDirection: 'row', gap: spacing.sm },
  lineText: { flex: 1, color: c.text, fontSize: 13, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) },
  linePrice: { color: c.text, fontSize: 13, fontWeight: '700' },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface,
  },
  euro: { color: c.text, fontSize: 20, fontWeight: '700' },
  input: { flex: 1, minWidth: 0, color: c.text, fontSize: 20, paddingVertical: 10 },
}));
