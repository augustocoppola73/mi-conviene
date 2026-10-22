import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, SavingEntry, SavingsSummary } from '@/api';
import { PaperReceipt } from '@/components/PaperReceipt';
import { ManualPrices } from '@/components/ManualPrices';
import { IS_CLOUD } from '@/cloud/client';
import { available as OCR_ON } from '../../../modules/receipt-ocr';
import { ReceiptScanner } from '@/components/ReceiptScanner';
import { MonthSummary } from '@/components/MonthSummary';
import { SavingGoalCard } from '@/components/SavingGoalCard';
import { Card, EmptyState, ErrorState, Icon, PrimaryButton, SectionTitle, StoreDot } from '@/components/ui';
import { euro, formatDate, parseEuro, plain } from '@/format';
import { confirmAsk } from '@/confirm';
import { showError } from '@/errors';
import { useStore } from '@/store';
import { makeStyles, radius, spacing, useTheme } from '@/theme';
import { LockedScreen } from '@/components/LockedScreen';
import { can } from '@/features';

const value = (e: SavingEntry) => (e.verified ? e.verified_amount ?? 0 : e.amount);
/** "+€1,20" oppure "−€5,34" */
const signed = (n: number) => `${n < 0 ? '−' : '+'}${euro(Math.abs(n))}`;

/** Stesse formule del backend, per l'anteprima mentre scrivi. */
function previewFuel(e: SavingEntry, refueled: boolean | null, fuelPrice: number | null): number {
  const est = e.fuel_saving ?? 0;
  if (!est) return 0;
  if (refueled === false) return 0;
  if (fuelPrice != null && e.fuel_median && e.fuel_liters) {
    return Math.round(((e.fuel_median - fuelPrice) * e.fuel_liters - (e.fuel_detour_cost ?? 0)) * 100) / 100;
  }
  return est;
}
function previewVerified(e: SavingEntry, paid: number, refueled: boolean | null = null, fuelPrice: number | null = null): number {
  const shop = e.amount - (e.fuel_saving ?? 0);
  const shopPart = e.estimated_spend == null ? shop : shop + e.estimated_spend - paid; // può essere negativo
  return Math.round((shopPart + previewFuel(e, refueled, fuelPrice)) * 100) / 100;
}

// #76: in modalità partecipante anche aprendo l'indirizzo diretto si vede la spiegazione, non la funzione
export default function SalvadanaioScreen() {
  const { prefs } = useStore();
  if (!can(prefs, 'salvadanaio')) return <LockedScreen feature="salvadanaio" />;
  return <SalvadanaioScreenInner />;
}

function SalvadanaioScreenInner() {
  const s = useStyles();
  const { colors } = useTheme();
  const { userId, productById, catalog, familyId } = useStore();
  const [scanning, setScanning] = useState<SavingEntry | null>(null);
  // #32: da «Fotografa lo scontrino» a fine spesa si arriva qui con la voce da leggere
  const { scan: scanId } = useLocalSearchParams<{ scan?: string }>();
  const [scanDone, setScanDone] = useState<string | null>(null);
  const [manual, setManual] = useState<SavingEntry | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [data, setData] = useState<SavingsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [verifying, setVerifying] = useState<SavingEntry | null>(null);
  const [paidText, setPaidText] = useState('');
  const [partsText, setPartsText] = useState<string[]>([]);   // #99: uno scontrino per negozio
  const [busy, setBusy] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [openReceipt, setOpenReceipt] = useState<string | null>(null);
  const [refueled, setRefueled] = useState<boolean | null>(null);
  const [fuelText, setFuelText] = useState('');

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setError(null);
      setData(await api.savings(userId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [userId]);

  // ricarica ogni volta che si apre il tab
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => {
    if (!scanId || scanDone === scanId || !data || !OCR_ON) return;
    const e = data.entries.find((x) => x.id === scanId);
    if (e) { setScanDone(scanId); setScanning(e); }
  }, [scanId, scanDone, data]);

  const remove = async (e: SavingEntry) => {
    if (!(await confirmAsk('Eliminare questa spesa?', `${e.store_name} del ${formatDate(e.created_at)}: il suo risparmio (${euro(e.amount)}) esce dal Salvadanaio.`, 'Elimina'))) return;
    await api.deleteSaving(e.id).catch((err) => showError('Non l\'ho eliminata', err, 'eliminarla'));
    load();
  };

  const openVerify = (e: SavingEntry) => {
    setVerifying(e);
    setPaidText(e.paid != null ? String(e.paid).replace('.', ',') : '');
    setPartsText([]);
    setRefueled(e.refueled ?? null);
    setFuelText(e.fuel_price_paid != null ? String(e.fuel_price_paid).replace('.', ',') : '');
  };
  const fuelPrice = parseFloat(fuelText.replace(',', '.'));
  const fuelOk = Number.isFinite(fuelPrice) && fuelPrice > 0 && fuelPrice < 5;
  const hasFuel = (verifying?.fuel_saving ?? 0) > 0;
  // #99: spesa in due negozi o con chi ha dato una mano: un totale per scontrino, li sommo io
  const parts = verifying ? (verifying.stops_paid?.length ? verifying.stops_paid
    : (verifying.snapshot as any)?.split ? ((verifying.snapshot as any).stops ?? []).map((st: any) => ({ store_name: st.store_name, by: null, items: 0 })) : null) : null;
  const multi = !!parts && parts.length > 1 && verifying?.paid == null;
  const partVals: number[] = multi ? parts!.map((_: unknown, k: number) => parseEuro(partsText[k] ?? '')) : [];
  const paid = multi ? (partVals.every((v) => Number.isFinite(v) && v >= 0) ? Math.round(partVals.reduce((t, v) => t + v, 0) * 100) / 100 : NaN) : parseEuro(paidText);
  const paidOk = Number.isFinite(paid) && paid > 0;

  const doVerify = async () => {
    if (!verifying || !paidOk) return;
    setBusy(true);
    try {
      await api.verifySaving(verifying.id, paid, hasFuel ? refueled ?? undefined : undefined,
        hasFuel && refueled !== false && fuelOk ? fuelPrice : undefined);
      setVerifying(null);
      await load();
    } catch (err) {
      showError('Verifica non salvata', err, 'salvare la verifica');   // #71: prima non diceva niente
    } finally {
      setBusy(false);
    }
  };

  const undoVerify = async (e: SavingEntry) => {
    if (!(await confirmAsk('Annullare la verifica?', `Torna al risparmio stimato (${euro(e.amount)}) e perdi quanto hai pagato davvero (${euro(e.paid ?? 0)}).`, 'Annulla la verifica', 'No'))) return;
    await api.unverifySaving(e.id).catch((err) => showError('Verifica non annullata', err, 'annullarla'));
    load();
  };

  const now = new Date();
  const thisMonth = data?.entries
    .filter((e) => { const d = new Date(e.created_at); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); })
    .reduce((sum, e) => sum + value(e), 0) ?? 0;

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        <Text style={s.kicker}>Il tuo salvadanaio 🐷</Text>
        <Text style={s.title}>Quanto hai risparmiato</Text>
        {notice && <Text style={s.notice}>✓ {notice}</Text>}

        {error && !data ? (
          <ErrorState message={error} onRetry={load} />
        ) : !data ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />
        ) : (
          <>
            <Card style={[s.hero, thisMonth < 0 && s.heroNeg]}>
              <Text style={s.heroLabel}>Questo mese</Text>
              <Text style={s.heroValue}>{thisMonth < 0 ? '−' : ''}{euro(Math.abs(thisMonth))}</Text>
              {thisMonth < 0 && <Text style={s.heroSmall}>Questo mese hai speso un po' più del riferimento: succede, la prossima lista andrà meglio.</Text>}
              <View style={s.totals}>
                <View style={{ flex: 1 }}>
                  <Text style={s.heroLabel}>✓ Verificato</Text>
                  <Text style={s.totalValue}>{data.total_verified < 0 ? '−' : ''}{euro(Math.abs(data.total_verified))}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.heroLabel}>Stimato, da verificare</Text>
                  <Text style={s.totalValue}>{euro(data.total_estimated)}</Text>
                </View>
              </View>
              <Text style={s.heroSmall}>Totale di sempre: {data.total < 0 ? '−' : ''}{euro(Math.abs(data.total))}</Text>
            </Card>

            {IS_CLOUD && <SavingGoalCard entries={data.entries} inFamily={!!familyId || data.entries.some((e) => e.mine === false)} />}
            {data.entries.length > 0 && <MonthSummary entries={data.entries} categories={catalog?.categories ?? []} />}

            <Pressable onPress={() => setShowHelp(!showHelp)} style={s.helpToggle}>
              <Icon name="help-circle-outline" size={16} color={colors.primary} />
              <Text style={s.helpToggleText}>Stimato o verificato: che differenza c'è?</Text>
            </Pressable>
            {showHelp && (
              <Card style={s.helpCard}>
                <Text style={s.helpText}>
                  <Text style={s.bold}>Stimato</Text>: quando confermi una spesa, l'app calcola il risparmio con i prezzi che conosce
                  (in gran parte stime) rispetto al tuo supermercato abituale o alla spesa media nei supermercati qui vicino.{'\n\n'}
                  <Text style={s.bold}>Verificato</Text>: dopo aver fatto la spesa tocca “Verifica” e scrivi il totale dello scontrino.
                  Il risparmio viene ricalcolato con quello che hai pagato davvero: se hai speso meno del previsto sale, se hai speso di più scende.
                  Se alla cassa hai speso più del riferimento, la differenza viene <Text style={s.bold}>tolta</Text> dal Salvadanaio.{'\n\n'}
                  Il totale vero aggiorna anche il tuo storico, così il budget suggerito diventa più preciso.
                </Text>
              </Card>
            )}

            <SectionTitle right={data.to_verify > 0 ? <Text style={s.badge}>{data.to_verify} da verificare</Text> : undefined}>
              Storico
            </SectionTitle>
            {data.entries.length === 0 ? (
              <EmptyState icon="wallet-outline" text="Ancora niente. Fai la lista, tocca «Trova la spesa migliore» e conferma: il risparmio arriva qui, e lo verifichi con lo scontrino." />
            ) : (
              <View style={{ gap: spacing.sm }}>
                {data.entries.map((e) => (
                  <Card key={e.id} style={s.entry}>
                    <View style={s.row}>
                      <StoreDot storeId={e.store_id} size={14} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.rowTitle}>{e.store_name}</Text>
                        <Text style={s.rowMeta}>{formatDate(e.created_at)}{e.by ? ` · fatta da ${e.by}` : ''}{e.note ? ` · ${plain(e.note)}` : ''}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[s.amount, !e.verified && s.amountEstimated, value(e) < 0 && { color: colors.danger }]}>
                          {signed(value(e))}
                        </Text>
                        <Text style={[s.status, e.verified && { color: colors.success }]}>
                          {e.verified ? '✓ verificato' : 'stimato'}
                        </Text>
                      </View>
                    </View>
                    {e.cancelled && !e.verified ? (
                      <View style={s.footer}>
                        <Text style={[s.rowMeta, { flex: 1 }]}>🚫 Spesa annullata da {e.cancelled_by || 'un familiare'}: il risparmio stimato ({euro(e.cancelled_amount ?? 0)}) non conta</Text>
                        {e.mine !== false && (
                          <Pressable onPress={() => remove(e)} hitSlop={10} accessibilityLabel="Elimina questa spesa" accessibilityRole="button" style={{ padding: 8 }}>
                            <Icon name="trash-outline" size={20} color={colors.danger} />
                          </Pressable>
                        )}
                      </View>
                    ) : e.verified ? (
                      <View style={[s.footer, { gap: spacing.xs }]}>
                        {/* il testo va a capo, i due pulsanti restano dentro la card anche a 360 px */}
                        <Text style={[s.rowMeta, { flex: 1, minWidth: 0 }]}>
                          Pagato {euro(e.paid ?? 0)}
                          {e.estimated_spend != null ? ` · previsto ${euro(e.estimated_spend)}` : ''}
                          {e.amount !== e.verified_amount ? ` · stima era ${euro(e.amount)}` : ''}
                        </Text>
                        <Pressable onPress={() => openVerify(e)} hitSlop={6} style={{ paddingVertical: 8, paddingHorizontal: 6 }} accessibilityRole="button"><Text style={s.link}>Modifica</Text></Pressable>
                        <Pressable onPress={() => undoVerify(e)} hitSlop={6} style={{ paddingVertical: 8, paddingHorizontal: 6 }} accessibilityRole="button" accessibilityLabel="Annulla la verifica"><Text style={s.linkMuted}>Annulla</Text></Pressable>
                      </View>
                    ) : (
                      <View style={s.footer}>
                        {e.estimated_spend != null && <Text style={s.rowMeta}>Spesa prevista {euro(e.estimated_spend)}</Text>}
                        <View style={{ flex: 1 }} />
                        {e.mine !== false && (
                          <Pressable onPress={() => remove(e)} hitSlop={10} accessibilityLabel="Elimina questa spesa" accessibilityRole="button"
                            style={{ padding: 8, marginRight: spacing.sm }}>
                            <Icon name="trash-outline" size={20} color={colors.danger} />
                          </Pressable>
                        )}
                        {(!IS_CLOUD || OCR_ON) && (
                          <Pressable onPress={() => setScanning(e)} style={[s.verifyBtn, s.scanBtn]} accessibilityLabel="Leggi lo scontrino dalla foto">
                            <Icon name="camera-outline" size={16} color={colors.primary} />
                            <Text style={[s.verifyText, { color: colors.primary }]}>Foto</Text>
                          </Pressable>
                        )}
                        <Pressable onPress={() => openVerify(e)} style={s.verifyBtn}>
                          <Icon name="receipt-outline" size={16} color={colors.primaryText} />
                          <Text style={s.verifyText}>Verifica</Text>
                        </Pressable>
                      </View>
                    )}
                    {(e.added_in_store?.length || e.not_bought?.length) ? (
                      <Text style={s.rowMeta}>
                        {e.added_in_store?.length ? `+ aggiunti in negozio: ${e.added_in_store.join(', ')}` : ''}
                        {e.added_in_store?.length && e.not_bought?.length ? ' · ' : ''}
                        {e.not_bought?.length ? `non presi: ${e.not_bought.join(', ')}` : ''}
                      </Text>
                    ) : null}
                    {e.snapshot && (
                      <Pressable onPress={() => setOpenReceipt(openReceipt === e.id ? null : e.id)} style={s.receiptToggle} hitSlop={6}>
                        <Icon name="receipt-outline" size={15} color={colors.primary} />
                        <Text style={s.receiptLink}>{openReceipt === e.id ? 'Nascondi scontrino' : 'Vedi scontrino calcolato'}</Text>
                      </Pressable>
                    )}
                    {e.snapshot && openReceipt === e.id && (
                      <Pressable onPress={() => setManual(e)} style={s.manualBtn} accessibilityLabel="Scrivi i prezzi veri a mano">
                        <Icon name="create-outline" size={15} color={colors.primary} />
                        <Text style={s.receiptLink}>{e.real_receipt ? 'Correggi i prezzi veri' : 'Scrivi i prezzi veri accanto (senza foto)'}</Text>
                      </Pressable>
                    )}
                    {e.snapshot && openReceipt === e.id && (
                      <PaperReceipt
                        store={e.snapshot}
                        when={new Date(e.created_at)}
                        paid={e.verified ? e.paid : null}
                        actual={e.real_receipt ? Object.fromEntries(e.real_receipt.lines.filter((l) => l.product_id).map((l) => [l.product_id!, l.net_price])) : undefined}
                      />
                    )}
                  </Card>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <Modal visible={!!verifying} transparent animationType="fade" onRequestClose={() => setVerifying(null)}>
        <View style={s.modalBg}>
          <Card style={s.modal}>
            <Text style={s.modalTitle}>Verifica con lo scontrino</Text>
            <Text style={s.helpText}>
              {verifying?.store_name} · {verifying ? formatDate(verifying.created_at) : ''}{'\n'}
              {multi ? <>Scrivi il <Text style={s.bold}>totale</Text> di ogni scontrino: li sommo io.</> : <>Scrivi il <Text style={s.bold}>totale pagato</Text> che leggi sullo scontrino.</>}
            </Text>
            {multi && parts!.map((pt: { store_name: string; by: string | null }, k: number) => (
              <View key={k} style={{ gap: 4 }}>
                <Text style={s.rowMeta}>🧾 {pt.store_name}{pt.by ? ` · l'ha fatta ${pt.by}` : ''}</Text>
                <View style={s.inputRow}>
                  <Text style={s.euro}>€</Text>
                  <TextInput value={partsText[k] ?? ''} keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={colors.textSecondary}
                    autoFocus={k === 0} style={s.input} accessibilityLabel={`Totale dello scontrino di ${pt.store_name}`}
                    onChangeText={(t) => setPartsText((x) => { const n = [...x]; n[k] = t.replace(/[^0-9.,]/g, ''); return n; })} />
                </View>
              </View>
            ))}
            {multi && paidOk && <Text style={s.helpText}>In tutto <Text style={s.bold}>{euro(paid)}</Text></Text>}
            {!multi && <View style={s.inputRow}>
              <Text style={s.euro}>€</Text>
              <TextInput
                value={paidText}
                onChangeText={(t) => setPaidText(t.replace(/[^0-9.,]/g, ''))}
                keyboardType="decimal-pad"
                placeholder="0,00"
                placeholderTextColor={colors.textSecondary}
                autoFocus
                style={s.input}
                onSubmitEditing={doVerify}
              />
            </View>}
            {verifying && hasFuel && (
              <View style={s.fuelQ}>
                <Text style={s.helpText}>
                  Hai fatto carburante da <Text style={s.bold}>{verifying.fuel_station}</Text>?
                </Text>
                <View style={s.actions}>
                  <Pressable onPress={() => setRefueled(true)} style={[s.choice, refueled === true && s.choiceOn]}>
                    <Text style={[s.choiceText, refueled === true && s.choiceTextOn]}>Sì</Text>
                  </Pressable>
                  <Pressable onPress={() => setRefueled(false)} style={[s.choice, refueled === false && s.choiceOn]}>
                    <Text style={[s.choiceText, refueled === false && s.choiceTextOn]}>No</Text>
                  </Pressable>
                </View>
                {refueled === true && (
                  <View style={s.inputRow}>
                    <TextInput
                      value={fuelText}
                      onChangeText={(t) => setFuelText(t.replace(/[^0-9.,]/g, ''))}
                      keyboardType="decimal-pad"
                      placeholder="Prezzo pagato €/l (facoltativo)"
                      placeholderTextColor={colors.textSecondary}
                      style={[s.input, { fontSize: 16 }]}
                    />
                  </View>
                )}
              </View>
            )}
            {verifying && paidOk && (
              <View style={s.preview}>
                {verifying.estimated_spend != null && (
                  <Text style={s.rowMeta}>
                    Previsto {euro(verifying.estimated_spend)} · pagato {euro(paid)} ·{' '}
                    {paid <= verifying.estimated_spend
                      ? `${euro(verifying.estimated_spend - paid)} in meno`
                      : `${euro(paid - verifying.estimated_spend)} in più`}
                  </Text>
                )}
                {previewVerified(verifying, paid, refueled, fuelOk ? fuelPrice : null) >= 0 ? (
                  <Text style={s.previewValue}>Risparmio verificato: {signed(previewVerified(verifying, paid, refueled, fuelOk ? fuelPrice : null))}</Text>
                ) : (
                  <Text style={[s.previewValue, { color: colors.danger }]}>
                    Hai speso {euro(-previewVerified(verifying, paid, refueled, fuelOk ? fuelPrice : null))} più del riferimento: verranno tolti dal Salvadanaio
                  </Text>
                )}
                {hasFuel && (
                  <Text style={s.rowMeta}>
                    di cui carburante: {euro(previewFuel(verifying, refueled, fuelOk ? fuelPrice : null))}
                    {refueled === null ? ' (stima: rispondi alla domanda sopra)' : ''}
                  </Text>
                )}
                <Text style={s.rowMeta}>(stima era {euro(verifying.amount)})</Text>
                {(verifying.snapshot?.receipt.custom_items?.length ?? 0) > 0 && (
                  <Text style={[s.rowMeta, { color: colors.danger }]}>
                    ✍️ {verifying.snapshot!.receipt.custom_items.length} prodotti scritti a mano non hanno il prezzo
                    ({verifying.snapshot!.receipt.custom_items.map((c) => c.name).join(', ')}): il pagato li comprende, il previsto no.
                    Scrivili prima in "Prezzi veri", così il conto torna.
                  </Text>
                )}
              </View>
            )}
            <View style={s.actions}>
              <PrimaryButton label="Annulla" variant="secondary" onPress={() => setVerifying(null)} style={{ flex: 1 }} />
              <PrimaryButton label="Verifica" icon="checkmark" disabled={!paidOk} loading={busy} onPress={doVerify} style={{ flex: 1 }} />
            </View>
          </Card>
        </View>
      </Modal>
      {manual && userId && (
        <ManualPrices
          entry={manual}
          userId={userId}
          onClose={() => setManual(null)}
          onDone={(msg) => { setManual(null); setNotice(msg); load(); }}
        />
      )}
      {scanning && userId && (
        <ReceiptScanner
          entry={scanning}
          userId={userId}
          productById={productById}
          onClose={() => setScanning(null)}
          onDone={(msg) => { setScanning(null); setNotice(msg); load(); }}
        />
      )}
    </SafeAreaView>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.background },
  content: { width: '100%', maxWidth: 640, alignSelf: 'center', padding: spacing.lg, paddingBottom: spacing.xxl },
  kicker: { color: c.textSecondary, fontSize: 14 },
  title: { color: c.text, fontSize: 28, fontWeight: '800', marginTop: 2 },
  hero: { marginTop: spacing.lg, backgroundColor: c.primary, borderColor: c.primary },
  heroNeg: { backgroundColor: c.textSecondary, borderColor: c.textSecondary },   // #93: niente verde da festa quando si è speso di più
  heroLabel: { color: c.primaryText, opacity: 0.85, fontSize: 13 },
  heroValue: { color: c.primaryText, fontSize: 40, fontWeight: '800' },
  heroSmall: { color: c.primaryText, opacity: 0.92, fontSize: 12, marginTop: spacing.md },
  totals: { flexDirection: 'row', marginTop: spacing.md, gap: spacing.md },
  totalValue: { color: c.primaryText, fontSize: 18, fontWeight: '700' },
  helpToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md },
  helpToggleText: { color: c.primary, fontSize: 13, fontWeight: '600' },
  helpCard: { marginTop: spacing.sm },
  helpText: { color: c.textSecondary, fontSize: 13, lineHeight: 19 },
  bold: { fontWeight: '700', color: c.text },
  badge: { color: c.warning, fontSize: 13, fontWeight: '600' },
  entry: { padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowTitle: { color: c.text, fontSize: 15, fontWeight: '600' },
  rowMeta: { color: c.textSecondary, fontSize: 12 },
  amount: { color: c.success, fontSize: 16, fontWeight: '700' },
  amountEstimated: { color: c.textSecondary },
  status: { color: c.textSecondary, fontSize: 11 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderTopWidth: 1, borderTopColor: c.border, paddingTop: spacing.sm },
  receiptToggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  receiptLink: { color: c.primary, fontSize: 13, fontWeight: '600' },
  link: { color: c.primary, fontSize: 13, fontWeight: '600', marginLeft: 'auto' },
  linkMuted: { color: c.textSecondary, fontSize: 13 },
  verifyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.primary,
    paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill,
  },
  scanBtn: { backgroundColor: c.primarySoft },
  manualBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm, alignSelf: 'flex-start' },
  notice: { color: c.success, fontSize: 13, marginTop: spacing.sm },
  verifyText: { color: c.primaryText, fontWeight: '700', fontSize: 13 },
  modalBg: { flex: 1, backgroundColor: c.overlay, justifyContent: 'center', padding: spacing.xl },
  modal: { gap: spacing.md, width: '100%', maxWidth: 440, alignSelf: 'center' },
  modalTitle: { color: c.text, fontSize: 20, fontWeight: '700' },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface,
  },
  euro: { color: c.text, fontSize: 22, fontWeight: '700' },
  input: { flex: 1, minWidth: 0, color: c.text, fontSize: 24, paddingVertical: 12 },
  preview: { backgroundColor: c.primarySoft, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  previewValue: { color: c.success, fontSize: 16, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: spacing.sm },
  fuelQ: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: c.border },
  choice: { flex: 1, paddingVertical: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, alignItems: 'center' },
  choiceOn: { backgroundColor: c.primary, borderColor: c.primary },
  choiceText: { color: c.text, fontWeight: '600' },
  choiceTextOn: { color: c.primaryText },
}));
