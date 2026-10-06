/** Inviti in famiglia: link con il codice (…/?famiglia=ABC123) da mandare su WhatsApp, SMS, email. */
import { Platform, Share } from 'react-native';

const KEY = 'mc_invito_famiglia';

function appUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.origin;
  return 'https://mi-conviene.augustocoppola.workers.dev';
}

export function inviteLink(code: string): string {
  return `${appUrl()}/?famiglia=${encodeURIComponent(code)}`;
}

/** Apre la condivisione del telefono; dove non c'è, copia il messaggio. Restituisce come è andata. */
export async function shareInvite(code: string, from: string): Promise<'shared' | 'copied' | 'cancelled'> {
  const link = inviteLink(code);
  const message = `${from ? `${from} ti invita` : 'Ti invito'} nella famiglia su Mi Conviene: facciamo la spesa insieme e vediamo dove conviene.\n` +
    `Apri il link, scrivi il tuo nome e sei dentro: ${link}`;
  if (Platform.OS === 'web') {
    const nav = globalThis.navigator as any;
    if (nav?.share) {
      try { await nav.share({ title: 'Mi Conviene', text: message }); return 'shared'; } catch { return 'cancelled'; }
    }
    try { await nav?.clipboard?.writeText(message); return 'copied'; } catch { return 'cancelled'; }
  }
  const r = await Share.share({ message });
  return r.action === Share.dismissedAction ? 'cancelled' : 'shared';
}

/** All'apertura dell'app: se l'indirizzo contiene un invito lo ricorda (serve dopo l'accesso con il link email). */
export function rememberInviteFromUrl(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('famiglia');
    if (code && /^[A-Za-z0-9]{4,10}$/.test(code)) {
      localStorage.setItem(KEY, code.toUpperCase());
      url.searchParams.delete('famiglia');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  } catch { /* niente invito */ }
}

export function pendingInvite(): string | null {
  try { return Platform.OS === 'web' ? localStorage.getItem(KEY) : null; } catch { return null; }
}

export function clearInvite(): void {
  try { if (Platform.OS === 'web') localStorage.removeItem(KEY); } catch { /* pazienza */ }
}
