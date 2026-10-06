/** Collegamento a Supabase (solo nella versione online: EXPO_PUBLIC_MODE=cloud). */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, Session, SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

export const IS_CLOUD = process.env.EXPO_PUBLIC_MODE === 'cloud';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://tkzbradzyuhcgkfkktlx.supabase.co';
// chiave PUBBLICABILE: può stare nell'app (le regole di accesso proteggono i dati)
const KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY || 'sb_publishable_rqu_JKZYJVIFUZKKNH1Wxg_UdYI0n2i';

let client: SupabaseClient | null = null;
export function sb(): SupabaseClient {
  if (!client) {
    client = createClient(URL, KEY, {
      auth: {
        storage: Platform.OS === 'web' ? undefined : AsyncStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: Platform.OS === 'web',
        flowType: 'implicit',
      },
    });
  }
  return client;
}

/** Utente collegato (id) oppure errore: le funzioni dell'app lo usano al posto dell'id anonimo. */
export async function uid(): Promise<string> {
  const { data } = await sb().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('Accedi per continuare');
  return id;
}

export async function currentSession(): Promise<Session | null> {
  return (await sb().auth.getSession()).data.session;
}

/** Dove torna l'app dopo l'accesso (con l'eventuale invito in famiglia in sospeso). */
function returnUrl(): string | undefined {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
  let url = window.location.origin;
  try {
    const invite = localStorage.getItem('mc_invito_famiglia');
    if (invite) url += `/?famiglia=${encodeURIComponent(invite)}`;
  } catch { /* niente invito */ }
  return url;
}

/** Accesso con l'account Google (nessuna email da aspettare). */
export async function signInWithGoogle(): Promise<void> {
  const { error } = await sb().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: returnUrl() } });
  if (error) throw new Error(error.message.includes('not enabled') ? "L'accesso con Google non è ancora attivo" : error.message);
}

/** Link di accesso via email (nessuna password). */
export async function sendLoginLink(email: string): Promise<void> {
  const redirect = returnUrl();
  const { error } = await sb().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirect } });
  if (error) throw new Error(error.message.includes('rate') ? 'Troppe richieste: riprova tra qualche minuto' : error.message);
}

/** Codice a 6 cifre ricevuto nella stessa email (utile sul telefono, se il link apre un altro browser). */
export async function verifyCode(email: string, token: string): Promise<void> {
  const { error } = await sb().auth.verifyOtp({ email: email.trim(), token: token.trim(), type: 'email' });
  if (error) throw new Error('Codice non valido o scaduto');
}

export async function signOut(): Promise<void> {
  await sb().auth.signOut();
}

/** Errore Supabase → messaggio leggibile */
export function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}
