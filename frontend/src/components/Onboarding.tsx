/**
 * #90: primo avvio guidato. Quattro passi, «Salta» sempre visibile:
 * 1) a cosa serve l'app, 2) come ti chiami, 3) da dove parti (posizione o indirizzo), 4) la prima lista con i prodotti di tutti i giorni.
 * Compare solo a chi è nuovo (niente nome, lista vuota, nessun preferito) e non a chi entra con un invito.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '../api';
import { pendingInvite } from '../invite';
import { getCurrentPosition } from '../location';
import { useStore } from '../store';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { ProductIcon } from './ProductIcon';
import { PrimaryButton } from './ui';

const STARTER = ['latte', 'pane', 'pasta', 'uova', 'mele', 'acqua', 'yogurt', 'pomodori'];

export function Onboarding() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { hydrated, userId, prefs, setPrefs, items, addItem, catalog, productById } = useStore();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [addr, setAddr] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set(['latte', 'pane', 'pasta']));

  // chi usa già l'app (nome, lista, preferiti) non lo vede mai
  const veteran = !!prefs.displayName.trim() || items.length > 0 || prefs.favorites.length > 0 || prefs.participant;
  // si decide una volta sola all'avvio (poi il nome scritto qui non deve chiudere la guida)
  const [show, setShow] = useState<boolean | null>(null);
  useEffect(() => {
    if (show !== null || !hydrated || !userId || !catalog) return;
    if (prefs.onboarded) { setShow(false); return; }
    if (veteran) { setPrefs({ onboarded: true }); setShow(false); return; }
    setShow(!pendingInvite());
  }, [show, hydrated, userId, catalog, prefs.onboarded, veteran, setPrefs]);
  const visible = !!show && !prefs.onboarded;
  if (!visible) return null;

  const done = () => setPrefs({ onboarded: true });
  const useGps = async () => {
    setBusy(true); setErr(null);
    try { const g = await getCurrentPosition(); setPrefs({ location: g, locationMode: 'gps' }); setStep(3); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const useAddress = async () => {
    if (addr.trim().length < 3) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.geocode(addr.trim());
      if (!r.length) throw new Error('Non trovo questo indirizzo: prova con via e città');
      setPrefs({ location: { lat: r[0].lat, lon: r[0].lon, updatedAt: new Date().toISOString(), label: r[0].label }, locationMode: 'address' });
      setStep(3);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const finish = () => {
    for (const id of picked) { const p = productById(id); if (p) addItem(id, p.default_qty); }
    done();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={done}>
      <View style={s.bg}>
        <View style={[s.box, { paddingBottom: Math.max(insets.bottom, 12) + spacing.md }]}>
          <View style={s.top}>
            <Text style={s.dots}>{[0, 1, 2, 3].map((k) => (k === step ? '●' : '○')).join(' ')}</Text>
            <Pressable onPress={done} hitSlop={12} accessibilityRole="button"><Text style={s.skip}>Salta</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ gap: spacing.md }} keyboardShouldPersistTaps="handled">
            {step === 0 && (
              <>
                <Text style={s.big}>🛒 Ti dico dove la spesa ti costa meno</Text>
                <Text style={s.text}>Scrivi cosa devi comprare: confronto i supermercati vicino a te, viaggio e carburante compresi, e ti dico dove conviene.</Text>
                <Text style={s.text}>🐷 Quello che risparmi va nel Salvadanaio. 👨‍👩‍👧 In famiglia avete la stessa lista, in diretta.</Text>
                <PrimaryButton label="Iniziamo" icon="arrow-forward" onPress={() => setStep(1)} />
              </>
            )}
            {step === 1 && (
              <>
                <Text style={s.big}>Come ti chiami?</Text>
                <Text style={s.text}>Lo vedono solo la tua famiglia e i gruppi in cui entri.</Text>
                <TextInput value={name} onChangeText={setName} placeholder="Il tuo nome" placeholderTextColor={colors.textSecondary} autoFocus
                  autoComplete="given-name" style={s.input} maxLength={40} onSubmitEditing={() => { if (name.trim()) { setPrefs({ displayName: name.trim() }); setStep(2); } }} />
                <PrimaryButton label="Avanti" icon="arrow-forward" disabled={!name.trim()} onPress={() => { setPrefs({ displayName: name.trim() }); setStep(2); }} />
              </>
            )}
            {step === 2 && (
              <>
                <Text style={s.big}>Da dove parti per la spesa?</Text>
                <Text style={s.text}>Mi serve per sapere quali supermercati hai vicino e quanto costa arrivarci.</Text>
                <PrimaryButton label="Usa la mia posizione" icon="locate-outline" onPress={useGps} loading={busy} />
                <Text style={[s.text, { textAlign: 'center' }]}>oppure scrivi l'indirizzo di casa</Text>
                <TextInput value={addr} onChangeText={setAddr} placeholder="Via Roma 1, Livorno" placeholderTextColor={colors.textSecondary}
                  style={s.input} onSubmitEditing={useAddress} autoComplete="street-address" />
                <PrimaryButton label="Usa questo indirizzo" variant="secondary" onPress={useAddress} disabled={busy || addr.trim().length < 3} />
                {err && <Text style={{ color: colors.danger }}>{err}</Text>}
                <Pressable onPress={() => setStep(3)} style={{ alignSelf: 'center', padding: spacing.sm }}><Text style={s.skip}>Più tardi</Text></Pressable>
              </>
            )}
            {step === 3 && (
              <>
                <Text style={s.big}>La tua prima lista</Text>
                <Text style={s.text}>Tocca quello che ti serve: poi aggiungi il resto con la ricerca o i reparti.</Text>
                {!catalog ? <ActivityIndicator color={colors.primary} /> : (
                  <View style={s.grid}>
                    {STARTER.map((id) => productById(id)).filter(Boolean).map((p) => {
                      const on = picked.has(p!.id);
                      return (
                        <Pressable key={p!.id} onPress={() => setPicked((x) => { const n = new Set(x); if (n.has(p!.id)) n.delete(p!.id); else n.add(p!.id); return n; })}
                          style={[s.tile, on && s.tileOn]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                          <ProductIcon name={p!.name} productId={p!.id} size={36} />
                          <Text style={s.tileText} numberOfLines={2}>{p!.name}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                <PrimaryButton label={picked.size ? `Metti in lista (${picked.size})` : 'Comincio da zero'} icon="checkmark" onPress={finish} />
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  bg: { flex: 1, backgroundColor: c.overlay, justifyContent: 'flex-end' },
  box: { backgroundColor: c.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, maxHeight: '92%',
    width: '100%', maxWidth: 640, alignSelf: 'center' },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  dots: { color: c.primary, fontSize: 14, letterSpacing: 2 },
  skip: { color: c.textSecondary, fontSize: 15, fontWeight: '600' },
  big: { color: c.text, fontSize: 22, fontWeight: '800' },
  text: { color: c.text, fontSize: 15, lineHeight: 21 },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: spacing.md, color: c.text, backgroundColor: c.background, fontSize: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '23%', minWidth: 72, alignItems: 'center', padding: 8, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, gap: 4 },
  tileOn: { borderColor: c.primary, borderWidth: 2, backgroundColor: c.primarySoft },
  tileText: { color: c.text, fontSize: 11.5, textAlign: 'center' },
}));
