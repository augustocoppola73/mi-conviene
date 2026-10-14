/** #42: la lista come testo (WhatsApp, SMS…), ordinata per reparto, per chi non ha l'app. */
import type { Category, ListItem, Product } from './api';
import { formatQty } from './format';
import { shareText } from './invite';

const SITE = 'https://mi-conviene.augustocoppola.workers.dev';

export function listText(title: string, rows: { name: string; quantity: number; unit: string; category_id: string }[], categories: Category[], footer?: string): string {
  const order = new Map(categories.map((c, i) => [c.id, i]));
  const groups = new Map<string, string[]>();
  for (const r of rows) {
    const k = order.has(r.category_id) ? r.category_id : 'altro';
    groups.set(k, [...(groups.get(k) ?? []), `${r.name} ${formatQty(r.quantity, r.unit)}`.trim()]);
  }
  const lines = [...groups.entries()]
    .sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99))
    .map(([k, names]) => {
      const c = categories.find((x) => x.id === k);
      return `${c?.emoji ?? '🛒'} *${c?.name ?? 'Altro'}*\n${names.map((n) => `• ${n}`).join('\n')}`;
    });
  return `🧺 ${title}\n\n${lines.join('\n\n')}\n\n${footer ?? `Fatta con Mi Conviene: ${SITE}`}`;
}

/** la mia lista (prodotti del catalogo e scritti a mano) */
export function myListRows(items: ListItem[], productById: (id: string) => Product | undefined) {
  return items.map((i) => {
    const p = productById(i.product_id);
    return p ? { name: p.name, quantity: i.quantity, unit: p.unit, category_id: p.category_id }
      : { name: i.name ?? i.product_id.slice(7), quantity: i.quantity, unit: i.unit ?? 'pz', category_id: i.category_id ?? 'altro' };
  });
}

export const shareList = (text: string) => shareText(text);
