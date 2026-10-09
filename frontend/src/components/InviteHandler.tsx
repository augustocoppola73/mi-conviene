/** Dopo l'accesso: se si è arrivati da un invito (#13) si entra nel gruppo o si chiede di entrare in famiglia. */
import { router } from 'expo-router';
import { ReactNode, useEffect, useState } from 'react';
import { Modal, Text, View } from 'react-native';

import { api, InvitePreview, JoinResult } from '../api';
import { IS_CLOUD } from '../cloud/client';
import { clearInvite, pendingInvite, takeAutoName, takeOldLinkNotice, takeRejoin } from '../invite';
import { useStore } from '../store';
import { makeStyles, radius, spacing } from '../theme';
import { PrimaryButton } from './ui';

type View_ = { mode: 'ask'; code: string; info: InvitePreview; current: boolean }
  | { mode: 'pending'; info: InvitePreview | null }
  | { mode: 'error'; message: string; code?: string; canLeave?: boolean };

export function InviteHandler() {
  const { userId, prefs, setPrefs, hydrated } = useStore();
  const s = useStyles();
  const [view, setView] = useState<View_ | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!IS_CLOUD || !hydrated || !userId) return;
    if (takeOldLinkNotice()) {
      setView({ mode: 'error', message: 'Il link che hai aperto usa il vecchio codice famiglia, che non vale più: chiedi un nuovo invito a chi è già nella famiglia.' });
      return;
    }
    const code = pendingInvite();
    if (!code) return;
    const auto = takeAutoName();   // entrato adesso dalla schermata d'invito: niente altre domande
    const rejoin = takeRejoin();
    (async () => {
      const info = await api.invitePreview(code).catch(() => null);
      if (auto !== null) {
        if (auto) setPrefs({ displayName: auto });
        await join(code, auto, info, rejoin);
        return;
      }
      if (!info?.valid) { clearInvite(); setView({ mode: 'error', message: info?.reason || 'Invito non valido' }); return; }
      const f = await api.familyByUser(userId).catch(() => ({}));
      setView({ mode: 'ask', code, info, current: info.kind === 'famiglia' && 'code' in f });
    })();
  }, [hydrated, userId]);

  const join = async (code: string, name: string | undefined, info: InvitePreview | null, rejoin?: string | null) => {
    setBusy(true);
    try {
      const r: JoinResult = rejoin ? await api.inviteRejoin(code, rejoin) : await api.inviteJoin(code, name);
      clearInvite();
      if (r.status === 'invalid') return setView({ mode: 'error', message: r.reason || 'Invito non valido' });
      if (r.status === 'pending') return setView({ mode: 'pending', info });
      setView(null);
      if (r.status === 'joined') {
        router.push(r.kind === 'famiglia' ? '/profilo' : r.group_id ? `/gruppo/${r.group_id}` : '/');
        setTimeout(() => globalThis.alert?.(`Benvenuto! Sei ${r.kind === 'famiglia' ? 'nella famiglia' : `in «${info?.name || 'gruppo'}»`}.`), 300);
      }
    } catch (e) {
      const message = (e as Error).message;
      setView({ mode: 'error', message, code, canLeave: message.includes("un'altra famiglia") });
    } finally { setBusy(false); }
  };

  if (!view) return null;
  const close = () => { clearInvite(); setView(null); };
  const leaveAndJoin = async (code: string) => {
    setBusy(true);
    try { await api.familyLeave(userId!); } catch (e) { setBusy(false); return setView({ mode: 'error', message: (e as Error).message }); }
    await join(code, prefs.displayName || undefined, null);
  };

  let title = ''; let body = '';
  let actions: ReactNode;
  if (view.mode === 'ask') {
    const fam = view.info.kind === 'famiglia';
    title = fam ? 'Invito in famiglia' : `Invito in «${view.info.name || 'gruppo'}»`;
    body = `${view.info.invited_by} ti invita ${fam ? 'nella sua famiglia: vedrete la stessa spesa in corso, le ricette e la lista' : 'nel gruppo: lista e conti insieme'}.` +
      (view.current ? " Adesso sei in un'altra famiglia: entrando in questa esci dall'altra." : '') +
      (view.info.needs_approval ? ' Un familiare dovrà accettarti.' : '');
    const code = view.code;
    actions = (
      <>
        <PrimaryButton label={view.info.needs_approval ? 'Chiedi di entrare' : 'Entra'} icon="people-outline" loading={busy}
          onPress={() => (view.current ? leaveAndJoin(code) : join(code, prefs.displayName || undefined, view.info))} />
        <PrimaryButton label="No, grazie" variant="secondary" onPress={close} style={{ marginTop: spacing.sm }} />
      </>
    );
  } else if (view.mode === 'pending') {
    title = 'Richiesta inviata';
    body = `${view.info?.invited_by || 'Chi ti ha invitato'} (o un altro familiare) deve accettarti: gli è arrivato un avviso. ` +
      'Appena ti accetta vedi la spesa di famiglia. Intanto puoi usare l\'app.';
    actions = <PrimaryButton label="Ok" onPress={() => { setView(null); router.push('/profilo'); }} />;
  } else {
    title = 'Invito';
    body = view.message;
    const code = view.code;
    actions = view.canLeave && code ? (
      <>
        <PrimaryButton label="Esci dalla mia e chiedi di entrare" loading={busy} onPress={() => leaveAndJoin(code)} />
        <PrimaryButton label="Lascia stare" variant="secondary" onPress={close} style={{ marginTop: spacing.sm }} />
      </>
    ) : <PrimaryButton label="Ok" onPress={close} />;
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={s.backdrop}>
        <View style={s.box}>
          <Text style={s.title}>{title}</Text>
          <Text style={s.text}>{body}</Text>
          {view.mode === 'ask' && !prefs.displayName && <Text style={s.hint}>Consiglio: dopo scrivi il tuo nome nel Profilo, così gli altri sanno chi ha preso cosa.</Text>}
          {actions}
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
}));
