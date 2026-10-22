/**
 * #45: da dove viene un prezzo e quanto è vecchio, detto in chiaro.
 * «Stima», «Open Prices · 5 set», «Scontrino · 10 ott», «Visto in negozio · 10 ott»; oltre 60 giorni: da ricontrollare.
 */
import { todayRome } from './engine/util';

export const OLD_DAYS = 60;
type Src = { source: string; observed_at: string | null; location_name?: string | null; custom?: boolean };

const shortDay = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
export const ageDays = (iso: string | null) =>
  iso ? Math.max(0, Math.round((Date.parse(todayRome()) - Date.parse(iso.slice(0, 10))) / 86_400_000)) : null;

export function priceLabel(l: Src): { text: string; real: boolean; old: boolean; age: number | null } {
  if (l.source === 'stima') return { text: 'Stima: nessuno ha ancora visto questo prezzo qui', real: false, old: false, age: null };
  const age = ageDays(l.observed_at);
  const when = l.observed_at ? ` · ${shortDay(l.observed_at)}` : '';
  const loc = (l.location_name || '').toLowerCase();
  // #104: «visto da te» / «visto da voi» (famiglia): il prezzo che pagate voi in quel negozio
  const ours = /^visto da (te|voi)\b/.exec(loc);
  const what = l.custom ? 'Scritto a mano'
    : ours ? (ours[1] === 'te' ? 'Visto da te' : 'Visto dalla famiglia')
    : l.source === 'openprices' ? 'Open Prices'
    : loc.includes('scontrino') ? 'Scontrino'
    : loc.includes('segnalato') ? 'Segnalato da un utente'
    : 'Visto in negozio';
  const old = age != null && age > OLD_DAYS;
  return { text: `${what}${when}${old ? ' · da ricontrollare' : ''}`, real: true, old, age };
}
