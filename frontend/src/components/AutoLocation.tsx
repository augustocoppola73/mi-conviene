/**
 * Posizione automatica: con "Usa la mia posizione" attivo l'app la aggiorna da sola
 * (all'apertura e quando torni nell'app, al massimo ogni minuto). Si salva solo se ti sei spostato di almeno 100 m.
 */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { metersBetween, quietPosition } from '../location';
import { useStore } from '../store';

const EVERY_MS = 60 * 1000;
const MIN_MOVE_M = 100;

export function AutoLocation() {
  const { hydrated, prefs, setPrefs } = useStore();
  const last = useRef(0);
  const ref = useRef(prefs);
  ref.current = prefs;

  useEffect(() => {
    if (!hydrated) return;
    const tick = async () => {
      if (ref.current.locationMode !== 'gps' || Date.now() - last.current < EVERY_MS) return;
      last.current = Date.now();
      const p = await quietPosition();
      const cur = ref.current.location;
      if (p && ref.current.locationMode === 'gps' && (!cur || metersBetween(cur, p) >= MIN_MOVE_M)) setPrefs({ location: p });
    };
    tick();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') tick(); });
    return () => sub.remove();
  }, [hydrated, prefs.locationMode]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
