/** Versione online: prima di tutto si accede con un link via email (niente password). */
import { ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IS_CLOUD, sb, sendLoginLink, signInWithGoogle, verifyCode } from '../cloud/client';
import { makeStyles, radius, spacing, useTheme } from '../theme';
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

function Loading() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

function Login() {
  const s = useStyles();
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [withCode, setWithCode] = useState(false);
  const [busy, setBusy] = useState<false | 'email' | 'google'>(false);
  const [error, setError] = useState<string | null>(null);
  const valid = /^\S+@\S+\.\S+$/.test(email.trim());

  const google = async () => {
    setBusy('google'); setError(null);
    try { await signInWithGoogle(); } catch (e) { setError((e as Error).message); setBusy(false); }
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
        <View style={s.logo}><Icon name="cart" size={36} color={colors.primaryText} /></View>
        <Text style={s.title}>Mi Conviene</Text>
        <Text style={s.sub}>Dove fare la spesa spendendo meno, viaggio compreso.</Text>
        {!sent ? (
          <>
            <PrimaryButton label="Continua con Google" icon="logo-google" variant="secondary" onPress={google} loading={busy === 'google'} />
            <View style={s.orRow}><View style={s.line} /><Text style={s.or}>oppure con la tua email</Text><View style={s.line} /></View>
            <Text style={s.label}>La tua email</Text>
            <TextInput value={email} onChangeText={setEmail} placeholder="nome@esempio.it" placeholderTextColor={colors.textSecondary}
              autoCapitalize="none" autoComplete="email" keyboardType="email-address" inputMode="email" style={s.input}
              onSubmitEditing={() => valid && send()} />
            <PrimaryButton label="Mandami il link per entrare" icon="mail-outline" onPress={send} loading={busy === 'email'} disabled={!valid} />
            <Text style={s.note}>Niente password: con Google entri subito, con l'email ti arriva un link. Lo stesso indirizzo ti fa ritrovare i tuoi dati su ogni dispositivo.</Text>
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
