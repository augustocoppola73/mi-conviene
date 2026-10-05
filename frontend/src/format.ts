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
