/** Inviti (#13): link con il codice (…/?invito=ABCD2345) da mandare su WhatsApp, SMS, email.
 *  Famiglia: vale 48 ore e una volta sola, poi un familiare accetta. Il vecchio …/?famiglia=CODICE non vale più. */
import { Platform, Share } from 'react-native';

const KEY = 'mc_invito';
const AUTO = 'mc_invito_auto';
const REJOIN = 'mc_invito_rientro';
let memo: string | null = null;        // sul telefono (app) non c'è localStorage: basta la memoria
let memoAuto: string | null = null;
let memoRejoin: string | null = null;
let oldLink = false;

function appUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.origin;
  return 'https://mi-conviene.augustocoppola.workers.dev';
}

export function inviteLink(code: string): string {
  return `${appUrl()}/?invito=${encodeURIComponent(code)}`;
}

export function normCode(t: string): string {
  return t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

async function shareText(message: string): Promise<'shared' | 'copied' | 'cancelled'> {
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

/** Apre la condivisione del telefono; dove non c'è, copia il messaggio. */
export async function shareInvite(code: string, from: string, kind: 'famiglia' | 'evento' = 'famiglia', group?: string | null) {
  const link = inviteLink(code);
  const who = from ? `${from} ti invita` : 'Ti invito';
  const message = kind === 'famiglia'
    ? `${who} nella famiglia su Mi Conviene: facciamo la spesa insieme e vediamo dove conviene.\n` +
      `Apri il link e scrivi il tuo nome: ti faccio entrare io. Vale 48 ore: ${link}\n(Oppure nell'app: «Ho un codice» → ${code})`
    : `${who} in «${group || 'un gruppo'}» su Mi Conviene: lista e conti insieme.\nApri il link, scrivi il tuo nome e sei dentro: ${link}`;
  return shareText(message);
}

/** All'apertura dell'app: se l'indirizzo contiene un invito lo ricorda (serve anche dopo l'accesso con il link email). */
export function rememberInviteFromUrl(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('invito');
    if (code && /^[A-Za-z0-9]{8}$/.test(code)) setPendingInvite(code);
    if (url.searchParams.has('famiglia')) oldLink = true;
    if (url.searchParams.has('invito') || url.searchParams.has('famiglia')) {
      url.searchParams.delete('invito'); url.searchParams.delete('famiglia');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  } catch { /* niente invito */ }
}

/** Si è aperto un vecchio link con il codice famiglia (non vale più): lo dico una volta. */
export function takeOldLinkNotice(): boolean {
  const r = oldLink; oldLink = false; return r;
}

export function setPendingInvite(code: string, autoName?: string, rejoin?: string | null): void {
  memo = normCode(code);
  if (autoName !== undefined) memoAuto = autoName;
  memoRejoin = rejoin ?? null;
  try {
    if (Platform.OS !== 'web') return;
    localStorage.setItem(KEY, memo);
    if (autoName !== undefined) localStorage.setItem(AUTO, autoName);
    if (rejoin) localStorage.setItem(REJOIN, rejoin); else localStorage.removeItem(REJOIN);
  } catch { /* pazienza */ }
}

export function pendingInvite(): string | null {
  try { if (Platform.OS === 'web') return localStorage.getItem(KEY) || memo; } catch { /* niente */ }
  return memo;
}

/** Nome scritto nella schermata d'invito: c'è solo se si è entrati da lì (allora si entra senza altre domande). */
export function takeAutoName(): string | null {
  let v = memoAuto;
  try { if (Platform.OS === 'web') { v = localStorage.getItem(AUTO) ?? v; localStorage.removeItem(AUTO); } } catch { /* niente */ }
  memoAuto = null;
  return v;
}

export function clearInvite(): void {
  memo = null; memoAuto = null; memoRejoin = null;
  try { if (Platform.OS === 'web') { localStorage.removeItem(KEY); localStorage.removeItem(AUTO); localStorage.removeItem(REJOIN); } } catch { /* pazienza */ }
}

/** "Sono Luca, rientro": l'account (senza email) di cui prendere il posto nel gruppo. */
export function takeRejoin(): string | null {
  let v = memoRejoin;
  try { if (Platform.OS === 'web') { v = localStorage.getItem(REJOIN) ?? v; localStorage.removeItem(REJOIN); } } catch { /* niente */ }
  memoRejoin = null;
  return v;
}

/** Promemoria a un familiare che non riceve le notifiche (WhatsApp, SMS… dal menu Condividi). */
export async function shareNotifyReminder(name: string): Promise<'shared' | 'copied' | 'cancelled'> {
  const message = `Ciao ${name}! Per ricevere gli avvisi della spesa di famiglia apri Mi Conviene sul telefono, ` +
    `vai in Profilo › Notifiche e tocca «Prova le notifiche» (poi consenti le notifiche).\n` +
    `Se non hai ancora l'app: https://raw.githubusercontent.com/augustocoppola73/mi-conviene/apk/MiConviene.apk`;
  return shareText(message);
}
