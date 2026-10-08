/**
 * Dove sei: un interruttore "Usa la mia posizione" (poi si aggiorna da sola, vedi AutoLocation)
 * oppure un indirizzo scritto a mano. Usato nella Lista e nel Profilo.
 */
import { useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, Switch, Text, TextInput, View } from 'react-native';

import { api } from '../api';
import { getCurrentPosition } from '../location';
import { useStore } from '../store';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { Icon } from './ui';

function notify(title: string, message: string) {
  if (Platform.OS === 'web') globalThis.alert?.(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

const hhmm = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '');

export function LocationControl() {
  const s = useStyles();
  const { colors } = useTheme();
  const { prefs, setPrefs } = useStore();
  const [busy, setBusy] = useState(false);
  const [addr, setAddr] = useState('');
  const [editing, setEditing] = useState(false);
  const [results, setResults] = useState<{ lat: number; lon: number; label: string }[] | null>(null);
  const gps = prefs.locationMode === 'gps';

  const toggle = async (on: boolean) => {
    if (!on) { setPrefs({ locationMode: null, location: null }); setEditing(true); return; }
    setBusy(true);
    try {
      setPrefs({ location: await getCurrentPosition(), locationMode: 'gps' });
      setEditing(false);
    } catch (e) {
      notify('Posizione', `${(e as Error).message}\nPuoi scrivere il tuo indirizzo o la città qui sotto.`);
      setEditing(true);
    } finally { setBusy(false); }
  };
  const search = async () => {
    if (addr.trim().length < 3) return;
    setBusy(true);
    try {
      const r = await api.geocode(addr.trim());
      setResults(r);
      if (!r.length) notify('Indirizzo', 'Non trovo questo indirizzo: prova con via, numero e città.');
    } catch (e) { notify('Indirizzo', (e as Error).message); } finally { setBusy(false); }
  };
  const short = (label: string) => label.split(',').slice(0, 3).join(',');

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={s.row}>
        <Icon name={gps ? 'location' : 'location-outline'} size={20} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Usa la mia posizione</Text>
          <Text style={s.muted}>
            {gps
              ? `Si aggiorna da sola${prefs.location ? ` · ultimo aggiornamento ${hhmm(prefs.location.updatedAt)}` : ''}`
              : 'Disattivata: puoi scrivere un indirizzo qui sotto.'}
          </Text>
        </View>
        {busy ? <ActivityIndicator color={colors.primary} />
          : <Switch value={gps} onValueChange={toggle} trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff" />}
      </View>

      {!gps && prefs.locationMode === 'address' && prefs.location?.label && !editing && (
        <Pressable style={s.row} onPress={() => setEditing(true)}>
          <Icon name="home-outline" size={18} color={colors.primary} />
          <Text style={[s.muted, { flex: 1, color: colors.text }]} numberOfLines={2}>{short(prefs.location.label)}</Text>
          <Text style={s.link}>Cambia</Text>
        </Pressable>
      )}

      {!gps && (editing || prefs.locationMode !== 'address') && (
        <View style={{ gap: spacing.xs }}>
          <View style={s.input}>
            <TextInput value={addr} onChangeText={setAddr} placeholder="Indirizzo o città, es. Via Roma 10, Livorno"
              placeholderTextColor={colors.textSecondary} style={s.inputText} onSubmitEditing={search} returnKeyType="search" />
            <Pressable onPress={search} hitSlop={6}><Icon name="search" size={20} color={colors.primary} /></Pressable>
          </View>
          {results?.map((r) => (
            <Pressable key={`${r.lat},${r.lon}`} style={s.row}
              onPress={() => {
                setPrefs({ locationMode: 'address', location: { lat: r.lat, lon: r.lon, updatedAt: new Date().toISOString(), label: r.label } });
                setResults(null); setAddr(''); setEditing(false);
              }}>
              <Icon name="location-outline" size={16} color={colors.primary} />
              <Text style={[s.muted, { flex: 1 }]} numberOfLines={2}>{r.label}</Text>
            </Pressable>
          ))}
          {!prefs.location && <Text style={s.muted}>Senza posizione uso distanze di esempio.</Text>}
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: c.primarySoft },
  title: { color: c.text, fontSize: 15, fontWeight: '600' },
  muted: { color: c.textSecondary, fontSize: 13 },
  link: { color: c.primary, fontWeight: '700', fontSize: 14 },
  input: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  inputText: { flex: 1, minWidth: 0, color: c.text, fontSize: 15, paddingVertical: 12 },
}));
