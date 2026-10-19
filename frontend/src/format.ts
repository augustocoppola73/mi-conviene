import type { Transport } from './api';

export const euro = (n: number) =>
  `€${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function formatQty(quantity: number, unit: string): string {
  if (unit === 'kg' && quantity < 1) return `${Math.round(quantity * 1000)} g`;
  const n = Number.isInteger(quantity) ? String(quantity) : quantity.toLocaleString('it-IT');
  return `${n} ${unit}`;
}

/** Passo dello stepper: la quantità di default per kg/L, 1 per pezzi e confezioni. */
export function qtyStep(defaultQty: number, unit: string): number {
  if (unit === 'kg' || unit === 'L') return defaultQty < 1 ? defaultQty : 0.5;
  return 1;
}

export const TRANSPORTS: { id: Transport; label: string; icon: string }[] = [
  { id: 'walk', label: 'A piedi', icon: 'walk-outline' },
  { id: 'bike', label: 'Bici', icon: 'bicycle-outline' },
  { id: 'car', label: 'Auto', icon: 'car-outline' },
  { id: 'transit', label: 'Mezzi', icon: 'bus-outline' },
];

export const km = (n: number) => `${n.toLocaleString('it-IT')} km`;

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * #81: importo scritto all'italiana: «1.234,50» = 1234,5 · «12,5» = 12,5 · «1.500» = 1500 · «2.50» = 2,5.
 * Il punto vale come migliaia solo se segue lo schema 1.234 / 1.234.567 (o se c'è anche la virgola).
 */
export function parseEuro(t: string): number {
  const s = (t ?? '').trim().replace(/\s|€/g, '');
  if (!s) return NaN;
  let norm = s;
  if (s.includes(',') && s.includes('.')) norm = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) norm = s.replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) norm = s.replace(/\./g, '');
  const n = Number(norm);
  return Number.isFinite(n) ? n : NaN;
}
