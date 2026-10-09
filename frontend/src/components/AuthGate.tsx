/** Versione online: si entra con Google, con un link via email, oppure senza account (anche da un invito). */
import { ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, InvitePreview } from '../api';
import { IS_CLOUD, redeemDeviceCode, sb, sendLoginLink, signInWithGoogle, signInWithoutAccount, verifyCode } from '../cloud/client';
import { clearInvite, normCode, pendingInvite, setPendingInvite, takeOldLinkNotice } from '../invite';
import { makeStyles, radius, spacing, useTheme } from '../theme';

// nell'app Android il link dell'email aprirebbe il browser: si entra con i codici
const NATIVE = Platform.OS !== 'web';
import { BootLoader } from './BootLoader';
import { Icon, PrimaryButton } from './ui';

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'in' | 'out'>(IS_CLOUD ? 'loading' : 'in');
  useEffect(() => {
    if (!IS_CLOUD) return;
    sb().auth.getSession().then(({ data }) => setState(data.session ? 'in' : 'out')).catch(() => setState('out'));
    const { data } = sb().auth.onAuthStateChange((_e, session) => setState(session ? 'in' : 'out'));
    return () => data.subscription.unsubscribe();
  }, []);
  if (state === 'in') return <>{children}</>;
  if (state === 'loading') return <Loading />;
  return <Login />;
}

/** Chi arriva da un invito: basta il nome (account senza registrazione), poi si entra o si aspetta l'approvazione. */
function InviteLogin({ code, onOther }: { code: string; onOther: () => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<InvitePreview | null>(null);
  useEffect(() => { api.invitePreview(code).then(setInfo).catch(() => setInfo({ valid: false, reason: 'Non riesco a leggere l\'invito: controlla la connessione' })); }, [code]);
  const enter = async (back?: { id: string; name: string }) => {
    setBusy(true); setError(null);
    const nm = back ? back.name : name.trim();
    try { setPendingInvite(code, nm, back?.id ?? null); await signInWithoutAccount(nm); } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  const back = info?.valid && info.kind === 'evento' ? info.returning ?? [] : [];
  const fam = info?.kind !== 'evento';
  const where = fam ? 'nella famiglia' : `in «${info?.emoji ? `${info.emoji} ` : ''}${info?.name || 'un gruppo'}»`;
  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.wrap}>
        <View style={s.logo}><Icon name="people" size={34} color={colors.primaryText} /></View>
        <Text style={s.title}>Ti hanno invitato</Text>
        {!info ? <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} /> : !info.valid ? (
          <>
            <Text style={s.sub}>{info.reason}</Text>
            <PrimaryButton label="Vai all'accesso" variant="secondary" onPress={() => { clearInvite(); onOther(); }} />
          </>
        ) : (
          <>
            <Text style={s.sub}>{info.invited_by} ti invita {where} su Mi Conviene: fate la spesa insieme e vedete dove conviene.</Text>
            <Text style={s.label}>Come ti chiami?</Text>
            <TextInput value={name} onChangeText={setName} placeholder="Il tuo nome" placeholderTextColor={colors.textSecondary}
              autoComplete="given-name" style={s.input} onSubmitEditing={() => { if (name.trim()) enter(); }} />
            <PrimaryButton label={info.needs_approval ? 'Chiedi di entrare' : 'Entra'} icon="log-in-outline" onPress={() => enter()} loading={busy} disabled={!name.trim()} />
            {back.length > 0 && (
              <View style={{ marginTop: spacing.lg }}>
                <Text style={s.label}>Eri già nel gruppo da un altro telefono?</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {back.map((b) => (
                    <PrimaryButton key={b.id} label={`Sono ${b.name}, rientro`} variant="secondary" onPress={() => enter(b)} disabled={busy} />
                  ))}
                </View>
                <Text style={s.note}>Ritrovi quello che avevi aggiunto e preso. Gli altri ricevono un avviso.</Text>
              </View>
            )}
            <Text style={s.note}>{info.needs_approval
              ? `Niente email né password. ${info.invited_by} (o un familiare) ti accetta e sei dentro.`
              : 'Niente email né password: entri subito.'} Gli altri vedono solo il tuo nome. Dopo puoi salvare l'accesso con la tua email dal Profilo.</Text>
            <PrimaryButton label="Ho già un account" variant="secondary" onPress={onOther} style={{ marginTop: spacing.md }} />
          </>
        )}
        {error && <Text style={s.error}>{error}</Text>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Loading() {
  return <BootLoader text="Controllo l'accesso…" />;
}

function Login() {
  const [invite, setInvite] = useState(pendingInvite);
  const [old] = useState(takeOldLinkNotice);
  if (invite) return <InviteLogin code={invite} onOther={() => setInvite(null)} />;
  return <LoginForm old={old} onInvite={(c) => { setPendingInvite(c); setInvite(c); }} />;
}

function LoginForm({ old, onInvite }: { old: boolean; onInvite: (code: string) => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [withCode, setWithCode] = useState(NATIVE);
  const [busy, setBusy] = useState<false | 'email' | 'google' | 'guest' | 'link'>(false);
  const [linking, setLinking] = useState(false);
  const [linkCode, setLinkCode] = useState('');
  const [error, setError] = useState<string | null>(old ? 'Il link che hai aperto usa il vecchio codice famiglia, che non vale più: chiedi un nuovo invito a chi è già nella famiglia.' : null);
  const valid = /^\S+@\S+\.\S+$/.test(email.trim());

  const google = async () => {
    setBusy('google'); setError(null);
    try { await signInWithGoogle(); } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  // 8 caratteri: un invito (famiglia o gruppo) oppure il codice di collegamento di un altro telefono
  const redeem = async () => {
    setBusy('link'); setError(null);
    try {
      const p = await api.invitePreview(linkCode).catch(() => null);
      if (p?.valid) { setBusy(false); onInvite(linkCode); return; }
      if (p && p.reason && p.reason !== 'Invito non trovato') throw new Error(p.reason);
      await redeemDeviceCode(linkCode);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  const guest = async () => {
    setBusy('guest'); setError(null);
    try { await signInWithoutAccount(); } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  const send = async () => {
    setBusy('email'); setError(null);
    try { await sendLoginLink(email); setSent(true); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const confirm = async () => {
    setBusy('email'); setError(null);
    try { await verifyCode(email, code); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.wrap}>
        <View style={s.logo}><Icon name="pricetag" size={36} color={colors.primaryText} /></View>
        <Text style={s.title}>Mi Conviene</Text>
        <Text style={s.sub}>Dove fare la spesa spendendo meno, viaggio compreso.</Text>
        {!sent ? (
          <>
            {!NATIVE && <PrimaryButton label="Continua con Google" icon="logo-google" variant="secondary" onPress={google} loading={busy === 'google'} />}
            {!NATIVE && <View style={s.orRow}><View style={s.line} /><Text style={s.or}>oppure con la tua email</Text><View style={s.line} /></View>}
            <Text style={s.label}>La tua email</Text>
            <TextInput value={email} onChangeText={setEmail} placeholder="nome@esempio.it" placeholderTextColor={colors.textSecondary}
              autoCapitalize="none" autoComplete="email" keyboardType="email-address" inputMode="email" style={s.input}
              onSubmitEditing={() => valid && send()} />
            <PrimaryButton label={NATIVE ? 'Mandami il codice per entrare' : 'Mandami il link per entrare'} icon="mail-outline" onPress={send} loading={busy === 'email'} disabled={!valid} />
            <PrimaryButton label="Inizia senza account" icon="arrow-forward-outline" variant="secondary" onPress={guest} loading={busy === 'guest'} style={{ marginTop: spacing.sm }} />
            {!linking ? (
              <PrimaryButton label="Ho un codice" icon="key-outline" variant="secondary" onPress={() => setLinking(true)} style={{ marginTop: spacing.sm }} />
            ) : (
              <View style={{ marginTop: spacing.md }}>
                <Text style={s.label}>Codice d'invito o di collegamento (8 caratteri)</Text>
                <TextInput value={linkCode} onChangeText={(t) => setLinkCode(normCode(t))}
                  placeholder="ABCD2345" placeholderTextColor={colors.textSecondary} autoCapitalize="characters" autoCorrect={false}
                  style={[s.input, { letterSpacing: 4, fontSize: 20, textAlign: 'center' }]} />
                <PrimaryButton label="Entra con il codice" icon="log-in-outline" onPress={redeem} loading={busy === 'link'}
                  disabled={linkCode.length !== 8} style={{ marginTop: spacing.sm }} />
                <Text style={s.note}>Invito: te lo manda chi è già nella famiglia o nel gruppo. Collegamento: sul telefono dove sei già dentro, Profilo → Account → "Collega un altro telefono".</Text>
              </View>
            )}
            <Text style={s.note}>{NATIVE
              ? "Niente password: ti mandiamo un codice via email e ritrovi i tuoi dati. Senza account restano su questo telefono (puoi aggiungere l'email dopo)."
              : "Niente password. Con Google o con l'email ritrovi i tuoi dati su ogni dispositivo; senza account restano su questo telefono (puoi salvarli dopo)."}</Text>
          </>
        ) : (
          <>
            <Text style={s.ok}>{NATIVE
              ? `Ti ho mandato un'email a ${email.trim()} (guarda anche nello spam). Se dentro c'è un codice scrivilo qui. Se c'è solo un link: aprilo nel browser, entra, poi in Profilo → Account tocca «Collega un altro telefono» e qui usa «Ho un codice».`
              : `Controlla la posta di ${email.trim()} e apri il link: ti fa entrare direttamente. Se non la trovi, guarda anche nello spam.`}</Text>
            {!withCode ? (
              <PrimaryButton label="Nell'email c'è un codice" variant="secondary" onPress={() => setWithCode(true)} />
            ) : (
              <>
                <Text style={s.label}>Codice dell'email</Text>
                <TextInput value={code} onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 8))} placeholder="123456"
                  placeholderTextColor={colors.textSecondary} keyboardType="number-pad" inputMode="numeric" style={s.input}
                  autoComplete="one-time-code" onSubmitEditing={() => code.length >= 6 && confirm()} />
                <PrimaryButton label="Entra" icon="log-in-outline" onPress={confirm} loading={busy === 'email'} disabled={code.length < 6} />
              </>
            )}
            <PrimaryButton label="Cambia email" variant="secondary" onPress={() => { setSent(false); setCode(''); setWithCode(NATIVE); }} style={{ marginTop: spacing.sm }} />
          </>
        )}
        {error && <Text style={s.error}>{error}</Text>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.background },
  wrap: { flex: 1, justifyContent: 'center', padding: spacing.xl, maxWidth: 440, width: '100%', alignSelf: 'center' },
  logo: { width: 64, height: 64, borderRadius: radius.lg, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  title: { fontSize: 28, fontWeight: '700', color: c.text, textAlign: 'center', marginTop: spacing.md },
  sub: { fontSize: 15, color: c.textSecondary, textAlign: 'center', marginTop: spacing.xs, marginBottom: spacing.xl },
  label: { fontSize: 14, fontWeight: '600', color: c.text, marginBottom: spacing.xs },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: radius.md, backgroundColor: c.surface, color: c.text,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: 16, marginBottom: spacing.md },
  note: { fontSize: 13, color: c.textSecondary, marginTop: spacing.md, lineHeight: 18 },
  ok: { fontSize: 15, color: c.text, marginBottom: spacing.lg, lineHeight: 21 },
  error: { fontSize: 14, color: c.danger, marginTop: spacing.md },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginVertical: spacing.lg },
  line: { flex: 1, height: 1, backgroundColor: c.border },
  or: { fontSize: 13, color: c.textSecondary },
}));
