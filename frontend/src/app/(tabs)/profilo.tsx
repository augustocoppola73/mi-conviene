import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, Family, NearbyStore } from '@/api';
import { getCurrentPosition } from '@/location';
import { Card, Chip, Icon, PrimaryButton, SectionTitle, StoreDot } from '@/components/ui';
import { km, TRANSPORTS } from '@/format';
import { useStore } from '@/store';
import { makeStyles, radius, spacing, useTheme } from '@/theme';

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

  const [nearby, setNearby] = useState<NearbyStore[] | null>(null);
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const loc = prefs.location;
  useFocusEffect(useCallback(() => {
    if (!loc) { setNearby(null); return; }
    setNearbyError(null);
    api.storesNearby(loc.lat, loc.lon).then((r) => setNearby(r.stores)).catch((e: Error) => setNearbyError(e.message));
  }, [loc]));
  const locate = async () => {
    setLocating(true);
    try { setPrefs({ location: await getCurrentPosition() }); } catch (e) { notify((e as Error).message); } finally { setLocating(false); }
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { notify((e as Error).message); } finally { setBusy(false); }
  };

  const name = prefs.displayName || 'Io';

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.kicker}>Le tue preferenze</Text>
        <Text style={s.title}>Profilo</Text>

        <SectionTitle>Come ti chiami?</SectionTitle>
        <TextInput
          value={prefs.displayName}
          onChangeText={(t) => setPrefs({ displayName: t })}
          placeholder="Il tuo nome (visibile in famiglia)"
          placeholderTextColor={colors.textSecondary}
          style={s.input}
        />

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

        <SectionTitle>Posizione</SectionTitle>
        {loc ? (
          <Card>
            <Text style={s.help}>Punti vendita più vicini a te (OpenStreetMap), uno per catena:</Text>
            {nearbyError && <Text style={[s.help, { color: colors.danger }]}>{nearbyError}</Text>}
            {!nearby && !nearbyError && <Text style={s.help}>Cerco i negozi vicini…</Text>}
            {nearby?.map((n) => (
              <View key={n.osm_id} style={s.member}>
                <StoreDot storeId={n.chain} size={12} />
                <Text style={[s.memberName, { flex: 1 }]} numberOfLines={1}>
                  {n.name}{n.address ? ` · ${n.address}` : ''}
                </Text>
                <Text style={s.help}>{km(n.distance_km)}</Text>
              </View>
            ))}
            <View style={s.familyActions}>
              <PrimaryButton label="Aggiorna" icon="locate-outline" variant="secondary" loading={locating} onPress={locate} style={{ flex: 1 }} />
              <PrimaryButton label="Disattiva" variant="secondary" onPress={() => setPrefs({ location: null })} style={{ flex: 1 }} />
            </View>
          </Card>
        ) : (
          <Card>
            <Text style={s.help}>Senza posizione uso distanze di esempio (zona Milano). Con la posizione confronto i negozi veri vicino a te.</Text>
            <PrimaryButton label="Usa la mia posizione" icon="location-outline" loading={locating} onPress={locate} style={{ marginTop: spacing.sm }} />
          </Card>
        )}

        <SectionTitle>Supermercato abituale</SectionTitle>
        <View style={s.wrap}>
          <Chip label="Nessuno" selected={!prefs.habitualStoreId} onPress={() => setPrefs({ habitualStoreId: null })} />
          {catalog?.stores.map((st) => (
            <Chip
              key={st.id}
              label={`${st.name} · ${km(st.distance_km)}`}
              leading={<StoreDot storeId={st.id} size={14} />}
              selected={prefs.habitualStoreId === st.id}
              onPress={() => setPrefs({ habitualStoreId: st.id })}
            />
          ))}
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

        <SectionTitle>Famiglia</SectionTitle>
        {family ? (
          <Card>
            <Text style={s.help}>Condividi questo codice con chi fa la spesa con te</Text>
            <Text style={s.code} selectable>{family.code}</Text>
            <View style={{ gap: 6, marginTop: spacing.md }}>
              {family.members.map((m) => (
                <View key={m.user_id} style={s.member}>
                  <Icon name="person-circle-outline" size={22} color={colors.primary} />
                  <Text style={s.memberName}>{m.display_name}{m.user_id === userId ? ' (tu)' : ''}</Text>
                </View>
              ))}
            </View>
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
          </Card>
        ) : (
          <Card>
            <Text style={s.help}>Fate la spesa in più persone? Create una famiglia e condividete la lista.</Text>
            <View style={[s.familyActions, { marginTop: spacing.md }]}>
              <PrimaryButton
                label="Crea famiglia"
                icon="people-outline"
                loading={busy}
                onPress={() => run(async () => setFamily(await api.familyCreate(userId!, name)))}
                style={{ flex: 1 }}
              />
              <PrimaryButton label="Ho un codice" variant="secondary" onPress={() => setJoinOpen(true)} style={{ flex: 1 }} />
            </View>
          </Card>
        )}

        <Text style={s.footer}>Mi Conviene · i prezzi sono stime, controlla sempre in negozio.</Text>
      </ScrollView>

      <Modal visible={joinOpen} transparent animationType="fade" onRequestClose={() => setJoinOpen(false)}>
        <View style={s.modalBg}>
          <Card style={s.modal}>
            <Text style={s.modalTitle}>Entra in una famiglia</Text>
            <TextInput
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
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
                disabled={code.length !== 6}
                loading={busy}
                onPress={() => run(async () => {
                  setFamily(await api.familyJoin(userId!, name, code));
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
  familyActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  leave: { color: c.danger, fontSize: 14, fontWeight: '600' },
  footer: { color: c.textSecondary, fontSize: 12, textAlign: 'center', marginTop: spacing.xxl },
  modalBg: { flex: 1, backgroundColor: c.overlay, justifyContent: 'center', padding: spacing.xl },
  modal: { gap: spacing.md },
  modalTitle: { color: c.text, fontSize: 20, fontWeight: '700' },
  codeInput: { fontSize: 24, letterSpacing: 6, textAlign: 'center', fontWeight: '700' },
}));
