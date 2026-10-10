import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, SavingEntry, SavingsSummary } from '@/api';
import { PaperReceipt } from '@/components/PaperReceipt';
import { ManualPrices } from '@/components/ManualPrices';
import { IS_CLOUD } from '@/cloud/client';
import { ReceiptScanner } from '@/components/ReceiptScanner';
import { Card, EmptyState, ErrorState, Icon, PrimaryButton, SectionTitle, StoreDot } from '@/components/ui';
import { euro, formatDate } from '@/format';
import { useStore } from '@/store';
import { makeStyles, radius, spacing, useTheme } from '@/theme';

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

export default function SalvadanaioScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const { userId, productById } = useStore();
  const [scanning, setScanning] = useState<SavingEntry | null>(null);
  const [manual, setManual] = useState<SavingEntry | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [data, setData] = useState<SavingsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [verifying, setVerifying] = useState<SavingEntry | null>(null);
  const [paidText, setPaidText] = useState('');
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

  const remove = async (id: string) => {
    await api.deleteSaving(id).catch(() => {});
    load();
  };

  const openVerify = (e: SavingEntry) => {
    setVerifying(e);
    setPaidText(e.paid != null ? String(e.paid).replace('.', ',') : '');
    setRefueled(e.refueled ?? null);
    setFuelText(e.fuel_price_paid != null ? String(e.fuel_price_paid).replace('.', ',') : '');
  };
  const fuelPrice = parseFloat(fuelText.replace(',', '.'));
  const fuelOk = Number.isFinite(fuelPrice) && fuelPrice > 0 && fuelPrice < 5;
  const hasFuel = (verifying?.fuel_saving ?? 0) > 0;
  const paid = parseFloat(paidText.replace(',', '.'));
  const paidOk = Number.isFinite(paid) && paid > 0;

  const doVerify = async () => {
    if (!verifying || !paidOk) return;
    setBusy(true);
    try {
      await api.verifySaving(verifying.id, paid, hasFuel ? refueled ?? undefined : undefined,
        hasFuel && refueled !== false && fuelOk ? fuelPrice : undefined);
      setVerifying(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const undoVerify = async (e: SavingEntry) => {
    await api.unverifySaving(e.id).catch(() => {});
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
            <Card style={s.hero}>
              <Text style={s.heroLabel}>Questo mese</Text>
              <Text style={s.heroValue}>{thisMonth < 0 ? '−' : ''}{euro(Math.abs(thisMonth))}</Text>
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

            <Pressable onPress={() => setShowHelp(!showHelp)} style={s.helpToggle}>
              <Icon name="help-circle-outline" size={16} color={colors.primary} />
              <Text style={s.helpToggleText}>Stimato o verificato: che differenza c'è?</Text>
            </Pressable>
            {showHelp && (
              <Card style={s.helpCard}>
                <Text style={s.helpText}>
                  <Text style={s.bold}>Stimato</Text>: quando confermi una spesa, l'app calcola il risparmio con i prezzi che conosce
                  (in gran parte stime) rispetto al tuo supermercato abituale o alla spesa tipica in zona.{'\n\n'}
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
              <EmptyState icon="wallet-outline" text="Ancora niente. Quando confermi una spesa dai Risultati, la trovi qui e puoi verificarla con lo scontrino." />
            ) : (
              <View style={{ gap: spacing.sm }}>
                {data.entries.map((e) => (
                  <Card key={e.id} style={s.entry}>
                    <View style={s.row}>
                      <StoreDot storeId={e.store_id} size={14} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.rowTitle}>{e.store_name}</Text>
                        <Text style={s.rowMeta}>{formatDate(e.created_at)}{e.by ? ` · fatta da ${e.by}` : ''}{e.note ? ` · ${e.note}` : ''}</Text>
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
                    {e.verified ? (
                      <View style={s.footer}>
                        <Text style={s.rowMeta}>
                          Pagato {euro(e.paid ?? 0)}
                          {e.estimated_spend != null ? ` · previsto ${euro(e.estimated_spend)}` : ''}
                          {e.amount !== e.verified_amount ? ` · stima era ${euro(e.amount)}` : ''}
                        </Text>
                        <Pressable onPress={() => openVerify(e)} hitSlop={6}><Text style={s.link}>Modifica</Text></Pressable>
                        <Pressable onPress={() => undoVerify(e)} hitSlop={6}><Text style={s.linkMuted}>Annulla</Text></Pressable>
                      </View>
                    ) : (
                      <View style={s.footer}>
                        {e.estimated_spend != null && <Text style={s.rowMeta}>Spesa prevista {euro(e.estimated_spend)}</Text>}
                        <View style={{ flex: 1 }} />
                        {e.mine !== false && (
                          <Pressable onPress={() => remove(e.id)} hitSlop={6} accessibilityLabel="Elimina">
                            <Icon name="trash-outline" size={18} color={colors.danger} />
                          </Pressable>
                        )}
                        {!IS_CLOUD && (
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
              Scrivi il <Text style={s.bold}>totale pagato</Text> che leggi sullo scontrino.
            </Text>
            <View style={s.inputRow}>
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
            </View>
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
  heroLabel: { color: c.primaryText, opacity: 0.85, fontSize: 13 },
  heroValue: { color: c.primaryText, fontSize: 40, fontWeight: '800' },
  heroSmall: { color: c.primaryText, opacity: 0.75, fontSize: 12, marginTop: spacing.md },
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
