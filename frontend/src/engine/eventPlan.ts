/**
 * #46 "Organizza la festa": dal tipo di evento e da quante persone, la lista con le quantità.
 * Quantità a persona nell'unità del prodotto (kg, L, pezzi o confezioni del catalogo).
 * Bambini: metà porzione (k = 0.5), niente alcolici (k = 0), dolci e bibite come gli adulti (k = 1).
 * Le cose che non sono nel catalogo (carbonella, piatti e bicchieri…) diventano prodotti scritti a mano.
 */
import { PRODUCT_INDEX } from './data';

type Row = { p: string; a: number; k?: number } | { c: string; cat: string; per: number; k?: number };
export interface EventType { id: string; label: string; emoji: string; hint: string; rows: Row[] }

const ALC = 0;      // alcolici: i bambini non contano
const SAME = 1;     // dolci, bibite, piatti: come gli adulti

export const EVENT_TYPES: EventType[] = [
  { id: 'grigliata', label: 'Grigliata', emoji: '🍖', hint: 'carne alla brace, verdure, birra', rows: [
    { p: 'salsiccia', a: 0.12 }, { p: 'costine', a: 0.12 }, { p: 'braciole_maiale', a: 0.08 }, { p: 'petto_pollo', a: 0.06 },
    { p: 'pane', a: 0.08 }, { p: 'insalata', a: 0.15 }, { p: 'pomodori', a: 0.1 }, { p: 'peperoni', a: 0.08 }, { p: 'zucchine', a: 0.08 },
    { p: 'patatine', a: 0.15, k: SAME }, { p: 'ketchup', a: 1 / 15, k: SAME }, { p: 'maionese', a: 1 / 15, k: SAME },
    { p: 'birra', a: 0.6, k: ALC }, { p: 'vino', a: 0.2, k: ALC }, { p: 'acqua', a: 0.12, k: SAME }, { p: 'cola', a: 0.15, k: SAME },
    { c: 'Carbonella', cat: 'casa', per: 10, k: SAME }, { c: 'Piatti e bicchieri di carta', cat: 'casa', per: 20, k: SAME },
    { p: 'tovaglioli', a: 1 / 20, k: SAME }, { p: 'sacchi_spazzatura', a: 1 / 25, k: SAME },
  ] },
  { id: 'pizzata', label: 'Pizzata in casa', emoji: '🍕', hint: 'basi, passata, mozzarella', rows: [
    { p: 'pizza_base', a: 0.6 }, { p: 'passata', a: 0.3 }, { p: 'fiordilatte', a: 0.4 }, { p: 'olive', a: 1 / 10 },
    { p: 'patatine', a: 0.1, k: SAME }, { p: 'birra', a: 0.5, k: ALC }, { p: 'cola', a: 0.2, k: SAME }, { p: 'acqua', a: 0.1, k: SAME },
    { p: 'gelato', a: 1 / 5, k: SAME }, { p: 'tovaglioli', a: 1 / 20, k: SAME },
  ] },
  { id: 'compleanno', label: 'Compleanno', emoji: '🎂', hint: 'torta, salatini, bibite', rows: [
    { p: 'torta_pronta', a: 1 / 10, k: SAME }, { p: 'pizza_fresca', a: 0.25 }, { p: 'tramezzini', a: 0.3 },
    { p: 'patatine', a: 0.2, k: SAME }, { p: 'snack_mais', a: 0.15, k: SAME }, { p: 'caramelle', a: 1 / 10, k: SAME },
    { p: 'cola', a: 0.2, k: SAME }, { p: 'aranciata', a: 0.2, k: SAME }, { p: 'succo', a: 0.15, k: SAME }, { p: 'acqua', a: 0.1, k: SAME },
    { p: 'prosecco', a: 1 / 6, k: ALC },
    { c: 'Candeline', cat: 'altro', per: 1000, k: SAME }, { c: 'Piatti e bicchieri di carta', cat: 'casa', per: 20, k: SAME },
    { p: 'tovaglioli', a: 1 / 20, k: SAME },
  ] },
  { id: 'aperitivo', label: 'Aperitivo', emoji: '🥂', hint: 'bollicine, stuzzichini, affettati', rows: [
    { p: 'prosecco', a: 0.3, k: ALC }, { p: 'birra', a: 0.3, k: ALC }, { p: 'aranciata', a: 0.1, k: SAME }, { p: 'acqua', a: 0.08, k: SAME },
    { p: 'olive', a: 1 / 6 }, { p: 'patatine', a: 0.2 }, { p: 'taralli', a: 0.15 }, { p: 'arachidi', a: 1 / 8 },
    { p: 'salame', a: 0.03 }, { p: 'prosciutto_crudo', a: 0.03 }, { p: 'grana_padano', a: 0.03 }, { p: 'focaccia', a: 1 / 6 },
    { c: 'Ghiaccio', cat: 'surgelati', per: 10, k: SAME }, { c: 'Bicchieri di plastica', cat: 'casa', per: 25, k: SAME },
  ] },
  { id: 'rinfresco', label: 'Rinfresco', emoji: '🥪', hint: 'pizzette, panini, tramezzini, pasticcini', rows: [
    { c: 'Pizzette rosse (vassoio da 20)', cat: 'gastronomia', per: 5 }, { p: 'tramezzini', a: 0.5 },
    { c: 'Panini al latte (conf. da 12)', cat: 'pane', per: 5 }, { p: 'prosciutto', a: 0.03 }, { p: 'salame', a: 0.02 },
    { p: 'formaggio_spalmabile', a: 1 / 8 }, { c: 'Salatini', cat: 'pane', per: 8 }, { p: 'olive', a: 1 / 8 }, { p: 'patatine', a: 0.1 },
    { c: 'Pasticcini (vassoio da 500 g)', cat: 'dolci', per: 6, k: SAME },
    { p: 'prosecco', a: 0.25, k: ALC }, { p: 'aranciata', a: 0.15, k: SAME }, { p: 'cola', a: 0.15, k: SAME },
    { p: 'succo', a: 0.1, k: SAME }, { p: 'acqua', a: 0.1, k: SAME },
    { c: 'Piatti e bicchieri di carta', cat: 'casa', per: 20, k: SAME }, { p: 'tovaglioli', a: 1 / 20, k: SAME },
  ] },
  { id: 'cena', label: 'Cena con amici', emoji: '🍝', hint: 'primo, contorno, vino, dolce', rows: [
    { p: 'pasta', a: 0.1 }, { p: 'sugo_pronto', a: 1 / 4 }, { p: 'parmigiano', a: 0.02 }, { p: 'pane', a: 0.07 },
    { p: 'insalata', a: 0.15 }, { p: 'pomodori', a: 0.08 }, { p: 'vino', a: 0.3, k: ALC }, { p: 'acqua', a: 0.15, k: SAME },
    { p: 'gelato', a: 1 / 5, k: SAME }, { p: 'caffe', a: 1 / 15, k: ALC },
  ] },
  { id: 'colazione', label: 'Colazione / brunch', emoji: '🥐', hint: 'cornetti, latte, caffè, succhi', rows: [
    { p: 'croissant', a: 1 / 3, k: SAME }, { p: 'latte', a: 0.25, k: SAME }, { p: 'caffe', a: 1 / 10, k: ALC },
    { p: 'succo', a: 0.2, k: SAME }, { p: 'spremuta', a: 0.15, k: SAME }, { p: 'biscotti', a: 1 / 8, k: SAME },
    { p: 'marmellata', a: 1 / 8, k: SAME }, { p: 'fragole', a: 0.06 },
  ] },
  { id: 'picnic', label: 'Pic-nic / gita', emoji: '🧺', hint: 'panini, piadine, frutta, bibite', rows: [
    { p: 'tramezzini', a: 0.5 }, { p: 'piadina', a: 0.25 }, { p: 'prosciutto', a: 0.04 }, { p: 'mozzarella', a: 0.5 },
    { p: 'pomodori', a: 0.1 }, { p: 'anguria', a: 1 / 10, k: SAME }, { p: 'patatine', a: 0.15, k: SAME },
    { p: 'acqua', a: 0.15, k: SAME }, { p: 'te_freddo', a: 0.2, k: SAME },
    { c: 'Piatti e bicchieri di carta', cat: 'casa', per: 20, k: SAME }, { p: 'tovaglioli', a: 1 / 20, k: SAME },
  ] },
];

export interface PlanRow { product_id: string; name: string; quantity: number; unit: string; category_id: string }

const customKey = (name: string) =>
  'custom:' + name.trim().toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** arrotonda per eccesso a una quantità che si compra: kg a 100 g, litri a mezzo litro, il resto a pezzi interi */
const PACK = /(\d+([.,]\d+)?\s?(kg|g|l|ml|cl)\b)|(\bx\s?\d+\b)/i;
function buyable(q: number, unit: string, name?: string, pack?: number): number {
  if (q <= 0) return 0;
  // #101: venduto a bottiglia o confezione («Latte intero 1L»): confezioni intere, non mezzo litro
  if ((unit === 'kg' || unit === 'L') && name && PACK.test(name) && pack && pack >= 0.25) return Math.round(Math.max(1, Math.ceil(q / pack - 1e-9)) * pack * 1000) / 1000;
  if (unit === 'kg') return Math.max(0.1, Math.ceil(q * 10 - 1e-9) / 10);
  if (unit === 'L') return Math.max(0.5, Math.ceil(q * 2 - 1e-9) / 2);
  return Math.max(1, Math.ceil(q - 1e-9));
}

export function planEvent(typeId: string, adults: number, kids: number): PlanRow[] {
  const t = EVENT_TYPES.find((x) => x.id === typeId);
  if (!t || adults + kids <= 0) return [];
  const out: PlanRow[] = [];
  for (const r of t.rows) {
    const k = r.k ?? 0.5;
    const people = adults + kids * k;
    if (people <= 0) continue;
    if ('p' in r) {
      const p = PRODUCT_INDEX[r.p];
      if (!p) continue;
      const q = buyable(r.a * people, p.unit, p.name, p.default_qty);
      if (q > 0) out.push({ product_id: p.id, name: p.name, quantity: q, unit: p.unit, category_id: p.category_id });
    } else {
      out.push({ product_id: customKey(r.c), name: r.c, quantity: Math.max(1, Math.ceil(people / r.per - 1e-9)), unit: 'pz', category_id: r.cat });
    }
  }
  return out;
}

/** #50 «Chi porta cosa»: le cose che di solito non si comprano ma qualcuno porta, per tipo di festa */
export const BRING_SUGGESTIONS: Record<string, string[]> = {
  grigliata: ['Carbonella', 'Griglia', 'Ghiaccio', 'Sedie', 'Cassa per la musica', 'Tovaglia', 'Dolce fatto in casa'],
  pizzata: ['Teglie', 'Vino', 'Dolce fatto in casa', 'Giochi da tavolo'],
  compleanno: ['Torta', 'Candeline', 'Palloncini', 'Regalo', 'Cassa per la musica', 'Sedie'],
  aperitivo: ['Ghiaccio', 'Bicchieri', 'Cassa per la musica', 'Sedie'],
  rinfresco: ['Vassoi', 'Tovaglia', 'Sedie', 'Ghiaccio', 'Dolce fatto in casa', 'Torta'],
  cena: ['Vino', 'Dolce fatto in casa', 'Sedie', 'Tovaglia'],
  colazione: ['Torta fatta in casa', 'Moka', 'Tovaglia'],
  picnic: ['Coperta', 'Borsa frigo', 'Pallone', 'Giochi per bambini', 'Tovaglia'],
};
export const BRING_DEFAULT = ['Torta', 'Ghiaccio', 'Sedie', 'Cassa per la musica', 'Stoviglie', 'Tovaglia', 'Dolce fatto in casa'];
