/** Nuovo gruppo / modifica (#14): nome, emoji, giorno (o "gruppo fisso" senza data). */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { AddPolicy, createGroup, isAnonymous, updateGroup } from '../cloud/groups';
import { useStore } from '../store';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { PrimaryButton } from './ui';

const EMOJIS = ['🎉', '🍕', '🎂', '🏖️', '🏠', '⚽', '🍖', '🎄', '⛺', '🍝'];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function nextDays(n: number) {
  const out: { iso: string; label: string }[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
    out.push({ iso: iso(x), label: i === 0 ? 'Oggi' : i === 1 ? 'Domani' : x.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric' }) });
  }
  return out;
}

export function GroupSheet({ visible, onClose, edit, onSaved, noNavigate }: {
  visible: boolean; onClose: () => void;
  edit?: { id: string; name: string; emoji: string | null; event_date: string | null; add_policy?: AddPolicy } | null;
  onSaved?: (id: string) => void;
  /** dalla scheda Lista: resta lì (il gruppo diventa la lista scelta) */
  noNavigate?: boolean;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState<string | null>('🎉');
  const [date, setDate] = useState<string | null>(null);
  const [policy, setPolicy] = useState<AddPolicy>('tutti');
  const { setPrefs } = useStore();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [anon, setAnon] = useState(false);
  const days = nextDays(14);

  useEffect(() => {
    if (!visible) return;
    setErr(null);
    setName(edit?.name ?? ''); setEmoji(edit ? edit.emoji : '🎉'); setDate(edit?.event_date ?? null); setPolicy(edit?.add_policy ?? 'tutti');
    if (!edit) isAnonymous().then(setAnon).catch(() => {});
  }, [visible]);

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      if (edit) { await updateGroup(edit.id, name, emoji, date, policy); onSaved?.(edit.id); onClose(); return; }
      const id = await createGroup(name, emoji, date, policy);
      onClose();
      setPrefs({ activeList: id });   // la scheda Lista passa al gruppo nuovo
      onSaved?.(id);
      if (!noNavigate) router.push('/');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const extra = date && !days.some((d) => d.iso === date);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.md }}>
            <Text style={s.title}>{edit ? 'Modifica il gruppo' : 'Nuovo gruppo'}</Text>
            {anon ? (
              <>
                <Text style={s.text}>
                  Per creare un gruppo serve un accesso salvato: in Profilo › Account aggiungi la tua email (ti arriva un codice o un link).
                  Puoi comunque entrare nei gruppi a cui ti invitano.
                </Text>
                <PrimaryButton label="Vai all'account" icon="key-outline" onPress={() => { onClose(); router.push('/profilo'); }} />
                <PrimaryButton label="Chiudi" variant="secondary" onPress={onClose} />
              </>
            ) : (
              <>
                <Text style={s.label}>Nome</Text>
                <TextInput value={name} onChangeText={setName} placeholder="Festa di sabato, Coinquilini, Gita al mare…"
                  placeholderTextColor={colors.textSecondary} style={s.input} maxLength={40} autoFocus={!edit} />
                <View style={s.row}>
                  {EMOJIS.map((e) => (
                    <Pressable key={e} onPress={() => setEmoji(e)} style={[s.emoji, emoji === e && s.on]} accessibilityLabel={`Emoji ${e}`}>
                      <Text style={{ fontSize: 22 }}>{e}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={s.label}>Quando?</Text>
                <View style={s.row}>
                  <Pressable onPress={() => setDate(null)} style={[s.chip, date === null && s.on]}>
                    <Text style={[s.chipText, date === null && s.onText]}>Senza data (gruppo fisso)</Text>
                  </Pressable>
                  {extra && (
                    <Pressable style={[s.chip, s.on]}><Text style={[s.chipText, s.onText]}>{date}</Text></Pressable>
                  )}
                  {days.map((d) => (
                    <Pressable key={d.iso} onPress={() => setDate(d.iso)} style={[s.chip, date === d.iso && s.on]}>
                      <Text style={[s.chipText, date === d.iso && s.onText]}>{d.label}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={s.hint}>
                  {date ? 'L\'invito vale fino al giorno dopo. Dopo l\'evento il gruppo resta da consultare.' : 'Per chi fa la spesa insieme sempre (coinquilini, amici): l\'invito vale 30 giorni.'}
                </Text>
                <Text style={s.label}>Chi aggiunge prodotti alla lista?</Text>
                <View style={s.row}>
                  <Pressable onPress={() => setPolicy('tutti')} style={[s.chip, policy === 'tutti' && s.on]}>
                    <Text style={[s.chipText, policy === 'tutti' && s.onText]}>Tutti</Text>
                  </Pressable>
                  <Pressable onPress={() => setPolicy('proprietario')} style={[s.chip, policy === 'proprietario' && s.on]}>
                    <Text style={[s.chipText, policy === 'proprietario' && s.onText]}>Solo io (gli altri propongono)</Text>
                  </Pressable>
                </View>
                <Text style={s.hint}>
                  {policy === 'tutti' ? 'Ognuno aggiunge quello che serve. Lo stesso prodotto non si aggiunge due volte: si aumenta la quantità.'
                    : 'Gli altri propongono ("Luca propone: birra") e tu decidi se aggiungerlo.'}
                </Text>
                {err && <Text style={s.err}>{err}</Text>}
                <PrimaryButton label={edit ? 'Salva' : 'Crea il gruppo'} icon={edit ? 'checkmark-outline' : 'people-outline'}
                  onPress={save} loading={busy} disabled={!name.trim()} />
                <PrimaryButton label="Annulla" variant="secondary" onPress={onClose} />
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  backdrop: { flex: 1, backgroundColor: c.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl,
    maxHeight: '90%', width: '100%', maxWidth: 640, alignSelf: 'center' },
  title: { color: c.text, fontSize: 20, fontWeight: '800' },
  text: { color: c.text, fontSize: 15, lineHeight: 21 },
  label: { color: c.text, fontSize: 14, fontWeight: '700' },
  hint: { color: c.textSecondary, fontSize: 13, lineHeight: 18 },
  err: { color: c.danger, fontSize: 14 },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: spacing.md, color: c.text, backgroundColor: c.background, fontSize: 16 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emoji: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border },
  chipText: { color: c.text, fontSize: 14 },
  on: { backgroundColor: c.primarySoft, borderColor: c.primary },
  onText: { fontWeight: '700' },
}));
