/** Dopo l'accesso: se si è arrivati da un invito, propone di entrare nella famiglia. */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Text, View } from 'react-native';

import { api } from '../api';
import { clearInvite, pendingInvite } from '../invite';
import { useStore } from '../store';
import { makeStyles, radius, spacing } from '../theme';
import { PrimaryButton } from './ui';

export function InviteHandler() {
  const { userId, prefs, setPrefs, hydrated } = useStore();
  const s = useStyles();
  const [code, setCode] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated || !userId) return;
    const c = pendingInvite();
    if (!c) return;
    // entrato adesso dalla schermata d'invito (senza account): si entra nella famiglia senza altre domande
    let auto: string | null = null;
    try { auto = localStorage.getItem('mc_invito_auto'); localStorage.removeItem('mc_invito_auto'); } catch { /* niente */ }
    api.familyByUser(userId).then(async (f) => {
      const mine = 'code' in f ? f.code : null;
      if (mine === c) { clearInvite(); return; }   // già dentro
      if (auto !== null && !mine) {
        if (auto) setPrefs({ displayName: auto });
        try {
          const fam = await api.familyJoin(userId, auto, c);
          clearInvite();
          const others = fam.members.filter((m) => m.user_id !== userId).map((m) => m.display_name).join(', ');
          setTimeout(() => globalThis.alert?.(`Benvenuto! Sei nella famiglia${others ? ` con ${others}` : ''}.`), 300);
          return;
        } catch { /* si ripiega sulla domanda */ }
      }
      setCurrent(mine);
      setCode(c);
    }).catch(() => setCode(c));
  }, [hydrated, userId]);

  if (!code) return null;
  const close = () => { clearInvite(); setCode(null); setMsg(null); };
  const join = async () => {
    setBusy(true); setMsg(null);
    try {
      if (current) await api.familyLeave(userId!);
      const f = await api.familyJoin(userId!, prefs.displayName || '', code);
      clearInvite();
      setCode(null);
      router.push('/profilo');
      setTimeout(() => globalThis.alert?.(`Sei nella famiglia ${f.code}: ${f.members.map((m) => m.display_name).join(', ')}.`), 300);
    } catch (e) {
      setMsg((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={s.backdrop}>
        <View style={s.box}>
          <Text style={s.title}>Invito in famiglia</Text>
          <Text style={s.text}>
            Ti hanno invitato nella famiglia <Text style={{ fontWeight: '700' }}>{code}</Text>: vedrete la stessa spesa in corso,
            le ricette e la lista condivisa.
            {current ? ` Adesso sei nella famiglia ${current}: entrando in questa esci dall'altra.` : ''}
          </Text>
          {!prefs.displayName && <Text style={s.hint}>Consiglio: dopo scrivi il tuo nome nel Profilo, così gli altri sanno chi ha preso cosa.</Text>}
          {msg && <Text style={s.error}>{msg}</Text>}
          <PrimaryButton label="Entra nella famiglia" icon="people-outline" onPress={join} loading={busy} />
          <PrimaryButton label="No, grazie" variant="secondary" onPress={close} style={{ marginTop: spacing.sm }} />
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  backdrop: { flex: 1, backgroundColor: c.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  box: { backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.xl, width: '100%', maxWidth: 420 },
  title: { fontSize: 20, fontWeight: '700', color: c.text, marginBottom: spacing.sm },
  text: { fontSize: 15, color: c.text, lineHeight: 21, marginBottom: spacing.md },
  hint: { fontSize: 13, color: c.textSecondary, marginBottom: spacing.md },
  error: { fontSize: 14, color: c.danger, marginBottom: spacing.md },
}));
