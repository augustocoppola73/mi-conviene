import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Image, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { api, PriceKind, Product, SavingEntry, ScanResult } from '../api';
import { euro } from '../format';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { PriceKindPicker } from './PriceKindPicker';
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
  const [photos, setPhotos] = useState<string[]>([]);
  const [kinds, setKinds] = useState<Record<number, PriceKind>>({}); // tipo di prezzo per riga // pezzi dello scontrino, dall'alto in basso

  const expected = (entry.snapshot?.receipt.lines ?? []).map((l) => l.product_id);

  // aggiunge una foto (un pezzo dello scontrino) alla serie
  const pick = async (camera: boolean) => {
    setError(null);
    try {
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], base64: true, quality: 0.8 };
      if (camera && Platform.OS !== 'web') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { setError('Permesso fotocamera negato.'); return; }
      }
      const res = camera && Platform.OS !== 'web'
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync({ ...opts, allowsMultipleSelection: true, selectionLimit: 6 - photos.length, orderedSelection: true });
      if (res.canceled || !res.assets?.length) return;
      const added = res.assets
        .map((a) => (a.base64 ? `data:${a.mimeType ?? 'image/jpeg'};base64,${a.base64}` : a.uri.startsWith('data:') ? a.uri : null))
        .filter((x): x is string => !!x);
      if (!added.length) { setError('Non riesco a leggere il file.'); return; }
      setPhotos((p) => [...p, ...added].slice(0, 6));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const read = async () => {
    if (!photos.length) return;
    setError(null);
    setStep('reading');
    try {
      const r = await api.scanReceipt(photos, entry.id);
      setScan(r);
      // riga con SCONTO sotto: è un'offerta (il prezzo pieno resta il prezzo normale)
      setKinds(Object.fromEntries(r.lines.map((l, i) => [i, l.discount > 0 ? 'offerta' : 'normale'])));
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
        lines: scan.lines.map((l, i) => ({
          product_id: l.product_id, text: l.text, net_price: l.net_price, quantity: l.quantity, weight_kg: l.weight_kg,
          kind: kinds[i] ?? 'normale', gross_price: l.discount > 0 ? l.price : null,
        })),
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
                  Scontrino lungo? Fotografalo <Text style={{ fontWeight: '700' }}>a pezzi, da vicino</Text>, dall'alto in basso,
                  lasciando 2-3 righe in comune tra una foto e la successiva: le righe ripetute le tolgo io.
                  Luce buona e scontrino ben steso. Lo leggo qui sul tuo computer: la foto non va a nessuno.
                </Text>
                {photos.length > 0 && (
                  <View style={s.thumbs}>
                    {photos.map((p, i) => (
                      <View key={i} style={s.thumbBox}>
                        <Image source={{ uri: p }} style={s.thumb} resizeMode="cover" />
                        <Text style={s.thumbN}>{i + 1}</Text>
                        <Pressable onPress={() => setPhotos((ph) => ph.filter((_, k) => k !== i))} style={s.thumbX} hitSlop={6} accessibilityLabel={`Togli la foto ${i + 1}`}>
                          <Icon name="close" size={12} color="#fff" />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}
                {photos.length < 6 && (
                  <>
                    {Platform.OS !== 'web' && (
                      <PrimaryButton
                        label={photos.length ? `Scatta il pezzo ${photos.length + 1}` : 'Scatta una foto'}
                        icon="camera-outline"
                        variant={photos.length ? 'secondary' : 'primary'}
                        onPress={() => pick(true)}
                      />
                    )}
                    <PrimaryButton
                      label={photos.length ? 'Aggiungi altre foto' : Platform.OS === 'web' ? 'Scegli le foto dello scontrino' : 'Scegli dalla galleria'}
                      icon="image-outline"
                      variant={photos.length || Platform.OS !== 'web' ? 'secondary' : 'primary'}
                      onPress={() => pick(false)}
                    />
                  </>
                )}
                {photos.length > 0 && (
                  <PrimaryButton
                    label={photos.length === 1 ? 'Leggi lo scontrino' : `Leggi lo scontrino (${photos.length} foto)`}
                    icon="scan-outline"
                    onPress={read}
                  />
                )}
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
                  {(scan.photos ?? 1) > 1 ? `Ho unito ${scan.photos} foto${scan.overlaps?.some((n) => n > 0) ? ` (tolte ${scan.overlaps!.reduce((a, b) => a + b, 0)} righe ripetute)` : ''}. ` : ''}
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
                          {[l.quantity > 1 ? `${l.quantity} pezzi` : '', l.weight_kg ? `${l.weight_kg.toLocaleString('it-IT')} kg` : '', l.discount > 0 ? `sconto ${euro(l.discount)}` : ''].filter(Boolean).join(' · ')}
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
                      {l.product_id && (
                        <PriceKindPicker compact value={kinds[i] ?? 'normale'} onChange={(k) => setKinds((x) => ({ ...x, [i]: k }))} />
                      )}
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
                {scan.missing_amount != null && scan.missing_amount > 0.01 && (
                  <Text style={[s.small, { color: colors.warning }]}>
                    Mancano circa {euro(scan.missing_amount)}: forse una riga non si leggeva bene.
                    Puoi rifare la foto di quel pezzo da più vicino{(scan.photos ?? 1) > 1 && scan.overlaps?.some((n) => n === 0) ? ' (tra due foto non ho trovato righe in comune: forse ne manca un pezzo)' : ''}.
                  </Text>
                )}
                {scan.missing_amount != null && scan.missing_amount < -0.01 && (
                  <Text style={[s.small, { color: colors.warning }]}>
                    Le righe superano il totale di {euro(-scan.missing_amount)}: forse una riga è stata letta due volte, controlla.
                  </Text>
                )}

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
                <PrimaryButton label="Rifai le foto" variant="secondary" onPress={() => { setScan(null); setPhotos([]); setStep('pick'); }} />
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
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumbBox: { width: 64, height: 86, borderRadius: radius.sm, overflow: 'hidden', borderWidth: 1, borderColor: c.border },
  thumb: { width: '100%', height: '100%' },
  thumbN: { position: 'absolute', left: 4, bottom: 2, color: '#fff', fontWeight: '700', fontSize: 13, textShadowColor: '#000', textShadowRadius: 3 },
  thumbX: { position: 'absolute', right: 3, top: 3, width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface,
  },
  euro: { color: c.text, fontSize: 20, fontWeight: '700' },
  input: { flex: 1, minWidth: 0, color: c.text, fontSize: 20, paddingVertical: 10 },
}));
