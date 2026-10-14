/**
 * #23: cosa può usare chi è nell'app (ruoli). Oggi due ruoli:
 *  - "completo": tutto;
 *  - "partecipante": chi è entrato con l'invito a un gruppo (festa, cena…) senza usare l'app per sé.
 *    Ha tutto quello che serve per il gruppo (lista, "Lo prendo io", Trova la spesa migliore, spesa in corso, conti);
 *    le funzioni personali restano visibili ma ingrigite, e un tocco spiega che sono nell'app completa.
 * Per aggiungere un ruolo o una funzione basta toccare FEATURES / LOCKED.
 */
import { useSyncExternalStore } from 'react';

import type { Prefs } from './store';

export type Feature = 'vicino' | 'salvadanaio' | 'carburante' | 'volantini' | 'ricette' | 'abituale' | 'nuovoGruppo';
export type Role = 'completo' | 'partecipante';

export const FEATURES: Record<Feature, { title: string; emoji: string; why: string }> = {
  vicino: { title: 'Vicino a me', emoji: '🗺️', why: 'i supermercati e i distributori intorno a te, con prezzi e parcheggi' },
  salvadanaio: { title: 'Salvadanaio', emoji: '🐷', why: 'quanto risparmi spesa dopo spesa, verificato con lo scontrino' },
  carburante: { title: 'Risparmio carburante', emoji: '⛽', why: 'il distributore più conveniente sulla strada del supermercato' },
  volantini: { title: 'Volantini', emoji: '📰', why: 'le offerte delle catene vicino a te' },
  ricette: { title: 'Ricette e menu', emoji: '📖', why: 'scegli le ricette e gli ingredienti vanno in lista' },
  abituale: { title: 'Spesa abituale', emoji: '🔁', why: 'la tua solita spesa in lista con un tocco' },
  nuovoGruppo: { title: 'Creare gruppi', emoji: '🎉', why: 'organizza tu feste, cene e spese con gli amici' },
};

const LOCKED: Record<Role, Feature[]> = {
  completo: [],
  partecipante: ['vicino', 'salvadanaio', 'carburante', 'volantini', 'ricette', 'abituale', 'nuovoGruppo'],
};

export const roleOf = (prefs: Pick<Prefs, 'participant'>): Role => (prefs.participant ? 'partecipante' : 'completo');
export const can = (prefs: Pick<Prefs, 'participant'>, f: Feature) => !LOCKED[roleOf(prefs)].includes(f);
export const lockedFeatures = (prefs: Pick<Prefs, 'participant'>) => LOCKED[roleOf(prefs)];

// ---- la scheda "È nell'app completa" (una sola, aperta da qualsiasi punto)
let shown: Feature | 'tutte' | null = null;
const listeners = new Set<() => void>();
export function showLocked(f: Feature | 'tutte') { shown = f; listeners.forEach((l) => l()); }
export function hideLocked() { shown = null; listeners.forEach((l) => l()); }
export function useLockedSheet() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => shown, () => null);
}
