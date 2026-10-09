import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, Family, FavoriteStore, NearbyStore } from '@/api';
import { attachEmail, confirmEmail, createDeviceCode, IS_CLOUD, saveAccountWithGoogle, sb, signOut } from '@/cloud/client';
import { normCode, shareNotifyReminder } from '@/invite';
import { FamilyInvites, MyJoinRequestCard, removeMember } from '@/components/FamilyInvites';
import { LocationControl } from '@/components/LocationControl';
import { NotifySettings } from '@/components/NotifySettings';
import { CategoryRules } from '@/components/CategoryRules';
import { ProfileSection } from '@/components/ProfileSection';
import { GroupSheet } from '@/components/GroupSheet';
import { ArchivedGroup, deleteGroup, eventLabel, Group, myArchivedGroups, myGroups, restoreGroup } from '@/cloud/groups';
import { PUSH_SUPPORTED } from '@/push';
import { Card, Chip, Icon, PrimaryButton, SectionTitle, StoreDot } from '@/components/ui';
import { km, TRANSPORTS } from '@/format';
import { useStore } from '@/store';
import { makeStyles, radius, setThemeMode, spacing, ThemeMode, useTheme, useThemeMode } from '@/theme';

function notify(message: string) {
  if (Platform.OS === 'web') globalThis.alert?.(message);
  else Alert.alert('Famiglia', message);
}

function parseNum(t: string): number | null {
  const n = parseFloat(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export default function ProfiloScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const { prefs, setPrefs, catalog, userId, items, setItems } = useStore();
  const [family, setFamily] = useState<Family | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const loadFamily = useCallback(async () => {
    if (!userId) return;
    try {
      const f = await api.familyByUser(userId);
      setFamily('code' in f ? (f as Family) : null);
    } catch {
      setFamily(null);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => { loadFamily(); }, [loadFamily]));
  // gruppi evento (#14)
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupSheet, setGroupSheet] = useState(false);
  const [archived, setArchived] = useState<ArchivedGroup[]>([]);
  const loadGroups = useCallback(async () => {
    if (!IS_CLOUD) return;
    const [g, a] = await Promise.all([myGroups().catch(() => []), myArchivedGroups().catch(() => [])]);
    setGroups(g); setArchived(a);
  }, []);
  useFocusEffect(useCallback(() => { loadGroups(); }, [loadGroups]));
  // eliminare un gruppo: solo chi l'ha creato, con conferma (non si torna indietro)
  const removeGroup = async (g: { id: string; name: string }) => {
    const msg = `Eliminare per sempre «${g.name}» con la lista e i conti, per tutti? Non si torna indietro.`;
    const ok = Platform.OS === 'web' ? (globalThis.confirm?.(msg) ?? false)
      : await new Promise<boolean>((res) => Alert.alert('Elimina gruppo', msg,
        [{ text: 'Annulla', style: 'cancel', onPress: () => res(false) }, { text: 'Elimina', style: 'destructive', onPress: () => res(true) }]));
    if (ok) run(async () => { await deleteGroup(g.id); if (prefs.activeList === g.id) setPrefs({ activeList: null }); await loadGroups(); });
  };
  // richieste di ingresso da accettare: la sezione Famiglia si apre da sola
  const [pendingCount, setPendingCount] = useState(0);
  const famId = family?.id;
  useFocusEffect(useCallback(() => {
    if (!IS_CLOUD || !famId) { setPendingCount(0); return; }
    const tick = () => api.joinRequests(famId).then((r) => setPendingCount(r.length)).catch(() => {});
    tick();
    const t = setInterval(tick, 15_000);
    return () => clearInterval(t);
  }, [famId]));

  const [nearby, setNearby] = useState<NearbyStore[] | null>(null);
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  const loc = prefs.location;
  useFocusEffect(useCallback(() => {
    if (!loc) { setNearby(null); return; }
    setNearbyError(null);
    api.storesNearby(loc.lat, loc.lon).then((r) => setNearby(r.stores)).catch((e: Error) => setNearbyError(e.message));
  }, [loc]));
  // un preferito è un punto vendita preciso scelto qui (stessa posizione entro ~100 m)
  const sameBranch = (f: FavoriteStore, n: { chain: string; lat: number; lon: number }) =>
    f.store_id === n.chain && Math.abs(f.branch.lat - n.lat) < 0.001 && Math.abs(f.branch.lon - n.lon) < 0.0013;
  const isFavorite = (n: NearbyStore) => prefs.favorites.some((f) => sameBranch(f, n));
  const toggleFavorite = (n: NearbyStore) => setPrefs({
    favorites: isFavorite(n)
      ? prefs.favorites.filter((f) => !sameBranch(f, n))
      : [...prefs.favorites, { store_id: n.chain, branch: { name: n.name, address: n.address, lat: n.lat, lon: n.lon } }],
    habitualStoreId: null, habitualBranch: null,   // il vecchio abituale non serve più
  });
  const removeFavorite = (i: number) => setPrefs({ favorites: prefs.favorites.filter((_, k) => k !== i), habitualStoreId: null, habitualBranch: null });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { notify((e as Error).message); } finally { setBusy(false); }
  };


  // riepiloghi delle sezioni chiuse (#20)
  const themeMode = useThemeMode();
  const [myEmail, setMyEmail] = useState<string | null>(null);
  useFocusEffect(useCallback(() => { if (IS_CLOUD) sb().auth.getUser().then(({ data }) => setMyEmail(data.user?.email ?? null)).catch(() => {}); }, []));
  const summaryTu = `${prefs.displayName.trim() || 'Senza nome'} · ${IS_CLOUD ? (myEmail || 'senza email') : `tema ${themeMode === 'auto' ? 'come il telefono' : themeMode === 'dark' ? 'scuro' : 'chiaro'}`}`;
  const tr = TRANSPORTS.find((t) => t.id === prefs.transport)?.label ?? '';
  const summarySpesa = `${prefs.budget ? `budget €${prefs.budget}` : 'nessun budget'} · soglia €${prefs.minSavingsThreshold} · ${tr.toLowerCase()}${prefs.transport === 'car' ? `, ${prefs.fuelType}` : ''}`;
  const chainName = (id: string) => catalog?.stores.find((x) => x.id === id)?.name ?? id;
  const favNames = [...new Set(prefs.favorites.map((f) => chainName(f.store_id)))];
  const summaryNegozi = `${loc ? (loc.label || 'posizione attiva') : 'posizione non attiva'} · ${favNames.length ? `${prefs.favorites.length === 1 ? '1 preferito' : `${prefs.favorites.length} preferiti`}: ${favNames.join(', ')}` : 'nessun preferito'}`;
  const ruleEntries = Object.entries(prefs.categoryRules ?? {});
  const summaryRegole = ruleEntries.length
    ? ruleEntries.map(([c, st]) => `${catalog?.categories.find((x) => x.id === c)?.name ?? c} → ${chainName(st)}`).join(', ')
    : 'Nessuna: la spesa si divide dove conviene';
  const summaryFamiglia = family
    ? `${family.members.map((m) => (m.user_id === userId ? 'tu' : m.display_name)).join(', ')}${pendingCount ? ` · ${pendingCount} ${pendingCount === 1 ? 'richiesta' : 'richieste'}` : ''}`
    : 'Non sei in una famiglia';
  const myNotifyOff = !!family?.members.some((m) => m.user_id === userId && m.notifications === false);

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.kicker}>Le tue preferenze</Text>
        <Text style={s.title}>Profilo</Text>

        <ProfileSection id="tu" icon="person-outline" title={IS_CLOUD ? 'Tu e account' : 'Tu'} summary={summaryTu}>
          <SectionTitle>Come ti chiami?</SectionTitle>
          <TextInput
            value={prefs.displayName}
            onChangeText={(t) => setPrefs({ displayName: t })}
            onBlur={() => {
              // online: il nome si vede anche negli altri telefoni della famiglia
              const n = prefs.displayName.trim();
              if (IS_CLOUD && n && userId) sb().from('profiles').update({ display_name: n.slice(0, 40) }).eq('id', userId).then(() => {});
            }}
            placeholder="Il tuo nome (visibile in famiglia)"
            placeholderTextColor={colors.textSecondary}
            style={s.input}
          />

          <SectionTitle>Aspetto</SectionTitle>
          <ThemePicker />

          {IS_CLOUD && (
            <>
              <SectionTitle>Account</SectionTitle>
              <AccountCard embedded />
            </>
          )}
        </ProfileSection>

        <ProfileSection id="spesa" icon="cart-outline" title="La spesa" summary={summarySpesa}>
          <SectionTitle>Budget per spesa</SectionTitle>
          <View style={s.inputRow}>
            <Text style={s.prefix}>€</Text>
            <TextInput
              defaultValue={prefs.budget != null ? String(prefs.budget) : ''}
              onChangeText={(t) => setPrefs({ budget: parseNum(t) })}
              keyboardType="decimal-pad"
              placeholder="Nessun limite"
              placeholderTextColor={colors.textSecondary}
              style={[s.input, s.inputFlex]}
            />
          </View>

          <SectionTitle>Soglia minima di convenienza</SectionTitle>
          <Text style={s.help}>
            Ti consiglio di cambiare supermercato solo se risparmi almeno questa cifra. Sotto, resti dove sei: niente fatica per pochi centesimi.
          </Text>
          <View style={s.wrap}>
            {[1, 3, 5, 10].map((v) => (
              <Chip key={v} label={`€${v}`} selected={prefs.minSavingsThreshold === v} onPress={() => setPrefs({ minSavingsThreshold: v })} />
            ))}
          </View>

          <SectionTitle>Mezzo di trasporto</SectionTitle>
          <View style={s.wrap}>
            {TRANSPORTS.map((t) => (
              <Chip key={t.id} label={t.label} icon={t.icon as never} selected={prefs.transport === t.id} onPress={() => setPrefs({ transport: t.id })} />
            ))}
          </View>

          {prefs.transport === 'car' && (
            <>
              <SectionTitle>Carburante</SectionTitle>
              <Text style={s.help}>Uso il prezzo medio di oggi dei distributori vicini (dati MIMIT).</Text>
              <View style={s.wrap}>
                {(['benzina', 'gasolio', 'gpl', 'metano'] as const).map((f) => (
                  <Chip key={f} label={f[0].toUpperCase() + f.slice(1)} selected={prefs.fuelType === f} onPress={() => setPrefs({ fuelType: f })} />
                ))}
              </View>
            </>
          )}

        </ProfileSection>

        <ProfileSection id="negozi" icon="location-outline" title="Negozi" summary={summaryNegozi}>
          <SectionTitle>Posizione</SectionTitle>
          <LocationControl />
          {loc && (
            <View style={{ marginTop: spacing.sm }}>
              <Text style={s.help}>Punti vendita più vicini a te, uno per catena. Tocca la ⭐ dei supermercati dove vai di solito (anche più di uno):</Text>
              {nearbyError && <Text style={[s.help, { color: colors.danger }]}>{nearbyError}</Text>}
              {!nearby && !nearbyError && <Text style={s.help}>Cerco i negozi vicini…</Text>}
              {nearby?.map((n) => (
                <Pressable key={n.osm_id} onPress={() => toggleFavorite(n)} style={[s.member, s.storeRow]}>
                  <Icon name={isFavorite(n) ? 'star' : 'star-outline'} size={18} color={isFavorite(n) ? colors.primary : colors.textSecondary} />
                  <StoreDot storeId={n.chain} size={12} />
                  <Text style={[s.memberName, { flex: 1 }, isFavorite(n) && { fontWeight: '700' }]} numberOfLines={1}>
                    {n.name}{n.address ? ` · ${n.address}` : ''}
                  </Text>
                  <Text style={s.help}>{km(n.distance_km)}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <SectionTitle>Supermercati preferiti</SectionTitle>
          <View>
            {prefs.favorites.length ? (
              <>
                {prefs.favorites.map((f, i) => (
                  <View key={`${f.store_id}-${f.branch.lat}`} style={[s.member, s.storeRow]}>
                    <Icon name="star" size={18} color={colors.primary} />
                    <StoreDot storeId={f.store_id} size={12} />
                    <Text style={[s.memberName, { flex: 1, fontWeight: '700' }]} numberOfLines={2}>
                      {f.branch.name}{f.branch.address ? ` · ${f.branch.address}` : ''}
                    </Text>
                    <Pressable onPress={() => removeFavorite(i)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Togli ${f.branch.name} dai preferiti`}>
                      <Icon name="close-circle-outline" size={20} color={colors.textSecondary} />
                    </Pressable>
                  </View>
                ))}
                <Text style={s.help}>
                  Ogni volta ti confronto con il più conveniente dei tuoi preferiti per quella lista, viaggio compreso: cambi negozio solo se risparmi più della soglia.
                  Quando sei lontano da qui, ti consiglio il migliore dove ti trovi.
                </Text>
              </>
            ) : (
              <Text style={s.help}>
                {loc ? 'Nessuno. Sceglili toccando la ⭐ nella lista dei negozi qui sopra.' : 'Nessuno. Attiva la posizione qui sopra (meglio da casa) e scegli i tuoi negozi dalla lista.'}
              </Text>
            )}
          </View>

        </ProfileSection>

        {IS_CLOUD && (
          <ProfileSection id="regole" icon="git-branch-outline" title="Regole per reparto" summary={summaryRegole}>
            <CategoryRules embedded />
          </ProfileSection>
        )}

        <ProfileSection id="famiglia" icon="people-outline" title="Famiglia" summary={summaryFamiglia} attention={pendingCount > 0}>
          {family ? (
            <View>
              {IS_CLOUD ? <FamilyInvites family={family} myName={prefs.displayName} onChanged={loadFamily} /> : (
                <>
                  <Text style={s.help}>Codice della famiglia (versione su questo computer):</Text>
                  <Text style={s.code} selectable>{family.code}</Text>
                </>
              )}
              <View style={{ gap: 6, marginTop: spacing.md }}>
                {family.members.map((m) => (
                  <View key={m.user_id} style={s.member}>
                    <Icon name="person-circle-outline" size={22} color={colors.primary} />
                    <Text style={[s.memberName, { flex: 1 }]}>{m.display_name}{m.user_id === userId ? ' (tu)' : ''}
                      {m.role === 'proprietario' && <Text style={s.notifyState}>  · proprietario</Text>}</Text>
                    {m.notifications != null && (
                      <View style={s.member} accessibilityLabel={m.notifications ? 'Riceve le notifiche' : 'Non riceve le notifiche'}>
                        <Icon name={m.notifications ? 'notifications' : 'notifications-off-outline'} size={16}
                          color={m.notifications ? colors.primary : colors.textSecondary} />
                        <Text style={s.notifyState}>{m.notifications ? 'notifiche attive' : 'notifiche non attive'}</Text>
                      </View>
                    )}
                    {family.my_role === 'proprietario' && m.user_id !== userId && (
                      <Pressable onPress={() => removeMember(family, m.user_id, m.display_name, loadFamily)} hitSlop={6}
                        accessibilityRole="button" accessibilityLabel={`Togli ${m.display_name}`}>
                        <Icon name="person-remove-outline" size={18} color={colors.danger} />
                      </Pressable>
                    )}
                  </View>
                ))}
              </View>
              {family.members.filter((m) => m.notifications === false).map((m) => m.user_id === userId ? (
                <Text key={m.user_id} style={[s.help, { marginTop: spacing.sm }]}>
                  🔕 Su questo account non arrivano gli avvisi della famiglia: usa l'app sul telefono e tocca «Prova le notifiche» qui sopra.
                </Text>
              ) : (
                <View key={m.user_id} style={s.reminder}>
                  <Text style={[s.help, { flex: 1 }]}>🔕 {m.display_name} non riceve gli avvisi: deve attivarli dal suo Profilo.</Text>
                  <Pressable onPress={async () => {
                    const r = await shareNotifyReminder(m.display_name);
                    if (r === 'copied') notify('Promemoria copiato: incollalo su WhatsApp o SMS.');
                  }} hitSlop={6} accessibilityRole="button">
                    <Text style={s.reminderBtn}>Invia il promemoria</Text>
                  </Pressable>
                </View>
              ))}
              <View style={s.familyActions}>
                <PrimaryButton
                  label="Invia lista"
                  icon="cloud-upload-outline"
                  variant="secondary"
                  disabled={!items.length || busy}
                  onPress={() => run(async () => {
                    await api.familyPushList(family.code, userId!, items);
                    notify('Lista condivisa con la famiglia.');
                  })}
                  style={{ flex: 1 }}
                />
                <PrimaryButton
                  label="Scarica lista"
                  icon="cloud-download-outline"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => run(async () => {
                    const l = await api.familyPullList(family.code);
                    if (!l.items.length) return notify('La lista di famiglia è vuota.');
                    setItems(l.items);
                    notify(`Caricati ${l.items.length} prodotti nella tua lista.`);
                  })}
                  style={{ flex: 1 }}
                />
              </View>
              <Pressable
                onPress={() => run(async () => { await api.familyLeave(userId!); setFamily(null); })}
                style={{ marginTop: spacing.md, alignSelf: 'center' }}>
                <Text style={s.leave}>Esci dalla famiglia</Text>
              </Pressable>
            </View>
          ) : (
            <View>
              <Text style={s.help}>Fate la spesa in più persone? Create una famiglia e condividete la lista.</Text>
              {IS_CLOUD && <MyJoinRequestCard onAccepted={loadFamily} />}
              <View style={[s.familyActions, { marginTop: spacing.md }]}>
                <PrimaryButton
                  label="Crea famiglia"
                  icon="people-outline"
                  loading={busy}
                  onPress={() => run(async () => setFamily(await api.familyCreate(userId!, prefs.displayName)))}
                  style={{ flex: 1 }}
                />
                <PrimaryButton label={IS_CLOUD ? 'Ho un invito' : 'Ho un codice'} variant="secondary" onPress={() => setJoinOpen(true)} style={{ flex: 1 }} />
              </View>
            </View>
          )}

        </ProfileSection>

        {IS_CLOUD && (
          <ProfileSection id="gruppi" icon="happy-outline" title="Gruppi" summary={groups.length ? groups.map((g) => `${g.emoji || '🛒'} ${g.name}`).join(', ') : 'Liste con amici: feste, cene, coinquilini'}>
            {groups.map((g) => (
              <Pressable key={g.id} onPress={() => router.push(`/gruppo/${g.id}`)} style={[s.member, s.storeRow]}>
                <Text style={{ fontSize: 20 }}>{g.emoji || '🛒'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[s.memberName, { fontWeight: '700' }]} numberOfLines={1}>{g.name}</Text>
                  <Text style={s.notifyState}>{eventLabel(g.event_date)} · {g.members} {g.members === 1 ? 'persona' : 'persone'}{g.todo ? ` · ${g.todo} da prendere` : ''}{g.muted ? ' · 🔕' : ''}</Text>
                </View>
                {g.role === 'proprietario' && (
                  <Pressable onPress={() => removeGroup(g)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Elimina ${g.name}`}>
                    <Icon name="trash-outline" size={18} color={colors.danger} />
                  </Pressable>
                )}
                <Icon name="chevron-forward" size={18} color={colors.textSecondary} />
              </Pressable>
            ))}
            <PrimaryButton label="Nuovo gruppo" icon="add-outline" variant="secondary" onPress={() => setGroupSheet(true)} />
            {archived.length > 0 && (
              <>
                <SectionTitle>Archiviati</SectionTitle>
                {archived.map((g) => (
                  <View key={g.id} style={[s.member, s.storeRow]}>
                    <Text style={{ fontSize: 20, opacity: 0.6 }}>{g.emoji || '🛒'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.memberName, { color: colors.textSecondary }]} numberOfLines={1}>{g.name}</Text>
                      <Text style={s.notifyState}>archiviato il {new Date(g.archived_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}</Text>
                    </View>
                    <Text onPress={() => run(async () => { await restoreGroup(g.id); await loadGroups(); })} style={s.reminderBtn}>Ripristina</Text>
                    <Text onPress={() => removeGroup(g)} style={[s.reminderBtn, { color: colors.danger }]}>Elimina</Text>
                  </View>
                ))}
                <Text style={s.help}>Un gruppo archiviato non si vede nella Lista ma resta qui con la sua lista e i conti. Eliminare è per sempre (lo può fare solo chi l'ha creato).</Text>
              </>
            )}
            <Text style={s.help}>Ognuno aggiunge prodotti e dice «Lo prendo io». Chi inviti vede solo la lista del gruppo, mai la tua famiglia.</Text>
          </ProfileSection>
        )}

        {PUSH_SUPPORTED && (
          <ProfileSection id="notifiche" icon="notifications-outline" title="Notifiche" summary={myNotifyOff ? 'Non attive su questo telefono' : 'Avvisi dalla famiglia'} attention={myNotifyOff}>
            <NotifySettings embedded />
          </ProfileSection>
        )}

        <Text style={s.footer}>Mi Conviene · i prezzi sono stime, controlla sempre in negozio.</Text>
      </ScrollView>

      <GroupSheet visible={groupSheet} onClose={() => setGroupSheet(false)} />
      <Modal visible={joinOpen} transparent animationType="fade" onRequestClose={() => setJoinOpen(false)}>
        <View style={s.modalBg}>
          <Card style={s.modal}>
            <Text style={s.modalTitle}>Entra in una famiglia</Text>
            {IS_CLOUD && <Text style={s.help}>Scrivi il codice dell'invito (8 caratteri) che ti hanno mandato.</Text>}
            <TextInput
              value={code}
              onChangeText={(t) => setCode(IS_CLOUD ? normCode(t) : t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              placeholder="CODICE"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="characters"
              autoFocus
              style={[s.input, s.codeInput]}
            />
            <View style={s.familyActions}>
              <PrimaryButton label="Annulla" variant="secondary" onPress={() => setJoinOpen(false)} style={{ flex: 1 }} />
              <PrimaryButton
                label="Entra"
                disabled={code.length !== (IS_CLOUD ? 8 : 6)}
                loading={busy}
                onPress={() => run(async () => {
                  if (IS_CLOUD) {
                    const r = await api.inviteJoin(code, prefs.displayName);
                    setJoinOpen(false); setCode('');
                    if (r.status === 'invalid') return notify(r.reason || 'Invito non valido');
                    if (r.status === 'pending') { notify('Richiesta inviata: appena un familiare ti accetta sei dentro.'); return loadFamily(); }
                    return loadFamily();
                  }
                  setFamily(await api.familyJoin(userId!, prefs.displayName, code));
                  setJoinOpen(false);
                  setCode('');
                })}
                style={{ flex: 1 }}
              />
            </View>
          </Card>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.background },
  content: { width: '100%', maxWidth: 640, alignSelf: 'center', padding: spacing.lg, paddingBottom: spacing.xxl },
  kicker: { color: c.textSecondary, fontSize: 14 },
  title: { color: c.text, fontSize: 28, fontWeight: '800', marginTop: 2 },
  input: {
    color: c.text, fontSize: 16, paddingHorizontal: spacing.lg, paddingVertical: 14,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  inputFlex: { flex: 1 },
  prefix: { color: c.text, fontSize: 20, fontWeight: '700' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  help: { color: c.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: spacing.sm },
  code: { color: c.primary, fontSize: 34, fontWeight: '800', letterSpacing: 6, textAlign: 'center' },
  member: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  memberName: { color: c.text, fontSize: 15 },
  notifyState: { color: c.textSecondary, fontSize: 12 },
  reminder: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm, padding: spacing.sm,
    borderRadius: radius.md, backgroundColor: c.surfaceMuted },
  reminderBtn: { color: c.primary, fontWeight: '700', fontSize: 14 },
  storeRow: { paddingVertical: 6 },
  familyActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  leave: { color: c.danger, fontSize: 14, fontWeight: '600' },
  footer: { color: c.textSecondary, fontSize: 12, textAlign: 'center', marginTop: spacing.xxl },
  modalBg: { flex: 1, backgroundColor: c.overlay, justifyContent: 'center', padding: spacing.xl },
  modal: { gap: spacing.md },
  modalTitle: { color: c.text, fontSize: 20, fontWeight: '700' },
  codeInput: { fontSize: 24, letterSpacing: 6, textAlign: 'center', fontWeight: '700' },
}));


function AccountCard({ embedded }: { embedded?: boolean }) {
  const { colors } = useTheme();
  const [user, setUser] = useState<{ email: string | null; anonymous: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    sb().auth.getUser().then(({ data }) => data.user && setUser({ email: data.user.email || null, anonymous: !!data.user.is_anonymous && !data.user.email })).catch(() => {});
  }, []));
  const [devCode, setDevCode] = useState<{ code: string; minutes: number } | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [emailCode, setEmailCode] = useState('');
  const addEmail = async () => {
    setBusy(true); setMsg(null);
    try { await attachEmail(newEmail); setEmailSent(true); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const confirmCode = async () => {
    setBusy(true); setMsg(null);
    try {
      await confirmEmail(newEmail, emailCode);
      const { data } = await sb().auth.getUser();
      if (data.user) setUser({ email: data.user.email || null, anonymous: !!data.user.is_anonymous && !data.user.email });
      setEmailSent(false); setEmailCode('');
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  // l'email ha solo il link (modelli di Supabase senza codice): dopo averlo toccato si ricontrolla l'account
  const checkLinked = async () => {
    setBusy(true); setMsg(null);
    try {
      await sb().auth.refreshSession();
      const { data } = await sb().auth.getUser();
      const mail = data.user?.email || null;
      if (!mail) throw new Error("Non risulta ancora confermata: tocca il link nell'email e riprova");
      setUser({ email: mail, anonymous: false }); setEmailSent(false);
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const newDevCode = async () => {
    setBusy(true); setMsg(null);
    try { setDevCode(await createDeviceCode()); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setMsg(null);
    try { await saveAccountWithGoogle(); } catch (e) { setMsg((e as Error).message); setBusy(false); }
  };
  const exit = () => {
    if (user?.anonymous && !(globalThis.confirm?.("Sei senza account: uscendo non potrai più rientrare in questi dati. Salvali prima con Google. Esci lo stesso?") ?? true)) return;
    signOut();
  };
  const text = { color: colors.text, fontSize: 14, lineHeight: 20 };
  const Box = embedded ? View : Card;
  return (
    <>
      {!embedded && <SectionTitle>Account</SectionTitle>}
      <Box style={{ gap: spacing.sm }}>
        {user?.anonymous ? (
          <>
            <Text style={text}>Stai usando l'app senza email: i tuoi dati sono online ma legati a questo telefono. Aggiungi la tua email per ritrovarli anche su un altro telefono (entri con il codice che ti mandiamo via email).</Text>
            {!emailSent ? (
              <>
                <TextInput value={newEmail} onChangeText={setNewEmail} placeholder="nome@esempio.it" placeholderTextColor={colors.textSecondary}
                  autoCapitalize="none" autoComplete="email" keyboardType="email-address" inputMode="email"
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text, backgroundColor: colors.surface, fontSize: 16 }} />
                <PrimaryButton label="Aggiungi la mia email" icon="mail-outline" onPress={addEmail} loading={busy} disabled={!/^\S+@\S+\.\S+$/.test(newEmail.trim())} />
              </>
            ) : (
              <>
                <Text style={text}>Ti ho mandato un'email a {newEmail.trim()} (guarda anche nello spam). Se contiene un codice scrivilo qui; se c'è solo un link, toccalo e poi «Ho toccato il link».</Text>
                <TextInput value={emailCode} onChangeText={(t) => setEmailCode(t.replace(/\D/g, '').slice(0, 8))} placeholder="123456"
                  placeholderTextColor={colors.textSecondary} keyboardType="number-pad" inputMode="numeric" autoComplete="one-time-code"
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text, backgroundColor: colors.surface, fontSize: 20, letterSpacing: 4, textAlign: 'center' }} />
                <PrimaryButton label="Conferma l'email" icon="checkmark-outline" onPress={confirmCode} loading={busy} disabled={emailCode.length < 6} />
                <PrimaryButton label="Ho toccato il link" icon="link-outline" variant="secondary" onPress={checkLinked} loading={busy} />
                <PrimaryButton label="Cambia email" variant="secondary" onPress={() => { setEmailSent(false); setEmailCode(''); }} />
              </>
            )}
            {Platform.OS === 'web' && <PrimaryButton label="Salva con Google" icon="logo-google" variant="secondary" onPress={save} loading={busy} />}
          </>
        ) : user?.email ? (
          <>
            <Text style={text}>Sei entrato come {user.email}. I tuoi dati sono salvati online e li ritrovi su ogni dispositivo.</Text>
            {devCode ? (
              <View style={{ alignItems: 'center', gap: 4, paddingVertical: spacing.sm }}>
                <Text style={[text, { fontSize: 13 }]}>Sull'altro telefono: "Ho un codice di collegamento" e scrivi</Text>
                <Text selectable style={{ color: colors.text, fontSize: 30, fontWeight: '800', letterSpacing: 6 }}>{devCode.code}</Text>
                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Vale {devCode.minutes} minuti e una volta sola</Text>
              </View>
            ) : (
              <PrimaryButton label="Collega un altro telefono" icon="phone-portrait-outline" variant="secondary" onPress={newDevCode} loading={busy} />
            )}
          </>
        ) : null}
        {msg && <Text style={{ color: colors.danger, fontSize: 14 }}>{msg}</Text>}
        <PrimaryButton label="Esci" icon="log-out-outline" variant="secondary" onPress={exit} />
      </Box>
    </>
  );
}

function ThemePicker() {
  const current = useThemeMode();
  const opts: { id: ThemeMode; label: string; icon: 'phone-portrait-outline' | 'sunny-outline' | 'moon-outline' }[] = [
    { id: 'auto', label: 'Come il telefono', icon: 'phone-portrait-outline' },
    { id: 'light', label: 'Chiaro', icon: 'sunny-outline' },
    { id: 'dark', label: 'Scuro', icon: 'moon-outline' },
  ];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      {opts.map((o) => (
        <Chip key={o.id} label={o.label} icon={o.icon} selected={current === o.id} onPress={() => setThemeMode(o.id)} />
      ))}
    </View>
  );
}
