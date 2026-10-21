import type { Transport } from './api';

export const euro = (n: number) =>
  `€${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function formatQty(quantity: number, unit: string): string {
  if (unit === 'kg' && quantity < 1) return `${Math.round(quantity * 1000)} g`;
  const n = Number.isInteger(quantity) ? String(quantity) : quantity.toLocaleString('it-IT');
  return `${n} ${unit}`;
}

/** il nome dice già il formato della confezione («Latte intero 1L», «Uova fresche x6», «Salsiccia 300 g») */
export const hasPack = (name?: string | null) => !!name && /(\d+([.,]\d+)?\s?(kg|g|l|ml|cl)\b)|(\bx\s?\d+\b)/i.test(name);

/** Passo dello stepper: la quantità di default per kg/L, 1 per pezzi e confezioni.
 *  #101: un prodotto venduto a bottiglia/confezione («Latte intero 1L») va a confezioni intere, non a mezzo litro. */
export function qtyStep(defaultQty: number, unit: string, name?: string | null): number {
  if (unit === 'kg' || unit === 'L') {
    if (hasPack(name) && defaultQty >= 0.25) return defaultQty;
    return defaultQty < 1 ? defaultQty : 0.5;
  }
  return 1;
}

/** #101: nel testo condiviso «Latte intero 1L ×2» invece di «Latte intero 1L 2 L» */
export function qtyWithName(name: string, quantity: number, unit: string, defaultQty?: number | null): string {
  if (hasPack(name) && defaultQty && defaultQty > 0) {
    const n = Math.round((quantity / defaultQty) * 100) / 100;
    if (Number.isInteger(n)) return `${name} ×${n}`;
  }
  return `${name} ${formatQty(quantity, unit)}`.trim();
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

/** #93: frasi del motore dette in modo semplice (il motore resta uguale per i test di confronto con quello Python) */
export function plain(t: string | null | undefined): string {
  return (t ?? '')
    .replace(/rispetto alla spesa tipica in zona \(mediana delle catene\)/g, 'rispetto alla spesa media nei supermercati qui vicino')
    .replace(/spesa tipica in zona/g, 'spesa media qui vicino')
    .replace(/mediana di (\d+) ([^(]+?) \(([^)]+)\) \+ 10%/g, 'di solito spendi circa $3 ($1 $2), più un margine del 10%')
    .replace(/sotto la tua soglia di/g, 'meno dei');
}
