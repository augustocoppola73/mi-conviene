/**
 * #44 "Di solito compri" e #35 "Di solito lo ricompri": dallo storico delle spese confermate.
 *  - usual: i prodotti comprati più spesso (almeno 2 volte), per aggiungerli con un tocco;
 *  - due: i prodotti che compri a intervalli regolari (almeno 3 volte) e che ormai "toccano": dall'ultima volta
 *    è passato circa l'intervallo tipico (mediana dei giorni tra un acquisto e l'altro).
 */
import { HistoryShop, shoppingOccasions } from './core';
import { PRODUCT_INDEX } from './data';
import { median } from './util';

export interface UsualItem { product_id: string; name: string; count: number; quantity: number }
export interface DueItem extends UsualItem { every_days: number; since_days: number }

const DAY = 86_400_000;

export function usualAndDue(shops: HistoryShop[], now = Date.now()): { usual: UsualItem[]; due: DueItem[] } {
  const occ = shoppingOccasions(shops).filter((o) => o.date != null);
  const agg = new Map<string, { dates: number[]; qty: number[] }>();
  for (const o of occ) {
    o.items.forEach((q, pid) => {
      const a = agg.get(pid) ?? { dates: [], qty: [] };
      a.dates.push(o.date!); a.qty.push(q);
      agg.set(pid, a);
    });
  }
  const usual: UsualItem[] = [];
  const due: DueItem[] = [];
  agg.forEach((a, pid) => {
    const p = PRODUCT_INDEX[pid];
    if (!p || a.dates.length < 2) return;
    const item = { product_id: pid, name: p.name, count: a.dates.length, quantity: Math.round(median(a.qty) * 1000) / 1000 };
    usual.push(item);
    if (a.dates.length < 3) return;
    const d = [...a.dates].sort((x, y) => x - y);
    const gaps = d.slice(1).map((t, i) => (t - d[i]) / DAY).filter((g) => g >= 1);
    if (gaps.length < 2) return;
    const every = Math.round(median(gaps));
    const since = Math.floor((now - d[d.length - 1]) / DAY);
    if (every >= 2 && every <= 60 && since >= Math.max(1, Math.round(every * 0.9))) due.push({ ...item, every_days: every, since_days: since });
  });
  usual.sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
  due.sort((x, y) => y.since_days / y.every_days - x.since_days / x.every_days);
  return { usual: usual.slice(0, 16), due: due.slice(0, 5) };
}
