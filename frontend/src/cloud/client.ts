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

/** Entra senza registrazione: account legato a questo telefono (si può salvare dopo con Google). */
export async function signInWithoutAccount(displayName?: string): Promise<void> {
  const name = (displayName || '').trim().slice(0, 40);
  const { error } = await sb().auth.signInAnonymously(name ? { options: { data: { display_name: name } } } : undefined);
  if (error) {
    throw new Error(error.message.toLowerCase().includes('anonymous') ? "L'ingresso senza account non è ancora attivo" : error.message);
  }
}

/** Account senza registrazione → collegato a Google: stessi dati, ritrovabili su ogni dispositivo. */
export async function saveAccountWithGoogle(): Promise<void> {
  const { error } = await sb().auth.linkIdentity({ provider: 'google', options: { redirectTo: returnUrl() } });
  if (error) throw new Error(error.message.toLowerCase().includes('manual linking') || error.message.includes('not enabled')
    ? 'Il salvataggio con Google non è ancora attivo' : error.message);
}

/** Collega un altro dispositivo: codice di 8 caratteri (10 minuti) da scrivere sull'altro telefono. */
export async function createDeviceCode(): Promise<{ code: string; minutes: number }> {
  const { data, error } = await sb().functions.invoke('collega', { body: { action: 'create' } });
  if (error) throw new Error(await functionError(error, 'Non riesco a creare il codice'));
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Entra con il codice creato su un altro dispositivo (niente email). */
export async function redeemDeviceCode(code: string): Promise<void> {
  const { data, error } = await sb().functions.invoke('collega', { body: { action: 'redeem', code } });
  if (error) throw new Error(await functionError(error, 'Codice non valido o scaduto'));
  if (data?.error) throw new Error(data.error);
  const { error: e2 } = await sb().auth.verifyOtp({ token_hash: data.token_hash, type: 'magiclink' });
  if (e2) throw new Error('Codice non valido o scaduto');
}

/** Invito in famiglia: si entra con il codice famiglia e la propria email (nessuna email da aspettare). */
export async function joinFamilyWithEmail(family: string, email: string, name?: string): Promise<void> {
  const { data, error } = await sb().functions.invoke('collega', { body: { action: 'join', family, email: email.trim(), name } });
  if (error) throw new Error(await functionError(error, 'Non riesco a entrare'));
  if (data?.error) throw new Error(data.error);
  const { error: e2 } = await sb().auth.verifyOtp({ token_hash: data.token_hash, type: 'magiclink' });
  if (e2) throw new Error('Non riesco a entrare: riprova');
}

/** Account senza registrazione: aggiunge l'email (così lo ritrovi con codice famiglia + email). */
export async function attachEmail(email: string): Promise<void> {
  const { data, error } = await sb().functions.invoke('collega', { body: { action: 'attach_email', email: email.trim() } });
  if (error) throw new Error(await functionError(error, 'Email non salvata'));
  if (data?.error) throw new Error(data.error);
  await sb().auth.refreshSession();
}

async function functionError(error: any, fallback: string): Promise<string> {
  try { const body = await error.context?.json?.(); if (body?.error) return body.error; } catch { /* niente */ }
  return fallback;
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
