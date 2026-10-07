/** Versione online: si entra con Google, con un link via email, oppure senza account (anche da un invito). */
import { ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IS_CLOUD, joinFamilyWithEmail, redeemDeviceCode, sb, sendLoginLink, signInWithGoogle, signInWithoutAccount, verifyCode } from '../cloud/client';
import { pendingInvite } from '../invite';
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

/** Chi arriva da un invito: basta il nome, si entra subito nella famiglia (niente email). */
function InviteLogin({ code, onOther }: { code: string; onOther: () => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<false | 'email' | 'guest'>(false);
  const [error, setError] = useState<string | null>(null);
  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());
  const remember = () => { try { localStorage.setItem('mc_invito_auto', name.trim()); } catch { /* pazienza */ } };
  const enter = async () => {
    setBusy('email'); setError(null);
    try { remember(); await joinFamilyWithEmail(code, email, name); } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  const guest = async () => {
    setBusy('guest'); setError(null);
    try { remember(); await signInWithoutAccount(name); } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.wrap}>
        <View style={s.logo}><Icon name="people" size={34} color={colors.primaryText} /></View>
        <Text style={s.title}>Ti hanno invitato</Text>
        <Text style={s.sub}>Entra nella famiglia {code} su Mi Conviene: fate la spesa insieme e vedete dove conviene.</Text>
        <Text style={s.label}>Come ti chiami?</Text>
        <TextInput value={name} onChangeText={setName} placeholder="Il tuo nome" placeholderTextColor={colors.textSecondary}
          autoComplete="given-name" style={s.input} />
        <Text style={s.label}>La tua email</Text>
        <TextInput value={email} onChangeText={setEmail} placeholder="nome@esempio.it" placeholderTextColor={colors.textSecondary}
          autoCapitalize="none" autoComplete="email" keyboardType="email-address" inputMode="email" style={s.input}
          onSubmitEditing={() => name.trim() && validEmail && enter()} />
        <PrimaryButton label="Entra nella famiglia" icon="log-in-outline" onPress={enter} loading={busy === 'email'} disabled={!name.trim() || !validEmail} />
        <Text style={s.note}>Non ti mandiamo nessuna email: l'indirizzo serve a ritrovarti. Su un altro telefono rientri con il codice famiglia {code} e la stessa email.</Text>
        <PrimaryButton label="Entra senza email" variant="secondary" onPress={guest} loading={busy === 'guest'} disabled={!name.trim()} style={{ marginTop: spacing.md }} />
        <PrimaryButton label="Ho già un account" variant="secondary" onPress={onOther} style={{ marginTop: spacing.sm }} />
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
  if (invite) return <InviteLogin code={invite} onOther={() => setInvite(null)} />;
  return <LoginForm />;
}

function LoginForm() {
  const s = useStyles();
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [withCode, setWithCode] = useState(false);
  const [busy, setBusy] = useState<false | 'email' | 'google' | 'guest' | 'link'>(false);
  const [linking, setLinking] = useState(NATIVE);
  const [linkCode, setLinkCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const valid = /^\S+@\S+\.\S+$/.test(email.trim());

  const google = async () => {
    setBusy('google'); setError(null);
    try { await signInWithGoogle(); } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  const redeem = async () => {
    setBusy('link'); setError(null);
    try {
      if (linkCode.length === 6) await joinFamilyWithEmail(linkCode, email);
      else await redeemDeviceCode(linkCode);
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
            {!NATIVE && <PrimaryButton label="Mandami il link per entrare" icon="mail-outline" onPress={send} loading={busy === 'email'} disabled={!valid} />}
            <PrimaryButton label="Inizia senza account" icon="arrow-forward-outline" variant="secondary" onPress={guest} loading={busy === 'guest'} style={{ marginTop: spacing.sm }} />
            {!linking ? (
              <PrimaryButton label="Ho un codice" icon="key-outline" variant="secondary" onPress={() => setLinking(true)} style={{ marginTop: spacing.sm }} />
            ) : (
              <View style={{ marginTop: spacing.md }}>
                <Text style={s.label}>Codice famiglia (6) o di collegamento (8)</Text>
                <TextInput value={linkCode} onChangeText={(t) => setLinkCode(t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
                  placeholder="ABC234" placeholderTextColor={colors.textSecondary} autoCapitalize="characters" autoCorrect={false}
                  style={[s.input, { letterSpacing: 4, fontSize: 20, textAlign: 'center' }]} />
                {linkCode.length === 6 && (
                  <Text style={s.note}>Codice famiglia: scrivi sopra la tua email (quella con cui sei nella famiglia) e premi Entra.</Text>
                )}
                <PrimaryButton label="Entra con il codice" icon="log-in-outline" onPress={redeem} loading={busy === 'link'}
                  disabled={!(linkCode.length === 8 || (linkCode.length === 6 && valid))} style={{ marginTop: spacing.sm }} />
                <Text style={s.note}>Codice famiglia: lo trovi in Profilo → Famiglia sul telefono di chi è già dentro. Codice di collegamento: Profilo → Account → "Collega un altro telefono".</Text>
              </View>
            )}
            <Text style={s.note}>{NATIVE
              ? 'Niente password: scrivi la tua email e il codice famiglia, oppure il codice di collegamento di un telefono dove sei già dentro.'
              : "Niente password. Con Google o con l'email ritrovi i tuoi dati su ogni dispositivo; senza account restano su questo telefono (puoi salvarli dopo con Google)."}</Text>
          </>
        ) : (
          <>
            <Text style={s.ok}>Controlla la posta di {email.trim()} e apri il link: ti fa entrare direttamente. Se non la trovi, guarda anche nello spam.</Text>
            {!withCode ? (
              <PrimaryButton label="Nell'email c'è un codice" variant="secondary" onPress={() => setWithCode(true)} />
            ) : (
              <>
                <Text style={s.label}>Codice dell'email</Text>
                <TextInput value={code} onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 8))} placeholder="123456"
                  placeholderTextColor={colors.textSecondary} keyboardType="number-pad" inputMode="numeric" style={s.input} />
                <PrimaryButton label="Entra" icon="log-in-outline" onPress={confirm} loading={busy === 'email'} disabled={code.length < 6} />
              </>
            )}
            <PrimaryButton label="Cambia email" variant="secondary" onPress={() => { setSent(false); setCode(''); setWithCode(false); }} style={{ marginTop: spacing.sm }} />
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
