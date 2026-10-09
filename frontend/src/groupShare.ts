/** #21: la mia lista + i prodotti che prendo per i gruppi = la spesa che faccio davvero (un solo giro). */
import type { GroupShare, ListItem } from './api';
import type { MyGroupItem } from './cloud/groups';

/** Unisce la mia lista e i prodotti dei gruppi presi da me: stesso prodotto = una riga, con la parte di ogni gruppo. */
export function mergeShopping(items: ListItem[], mine: MyGroupItem[]): ListItem[] {
  const out = new Map<string, ListItem>();
  for (const i of items) out.set(i.product_id, { ...i, groups: undefined });
  for (const g of mine) {
    const share: GroupShare = { group_item_id: g.id, group_id: g.group_id, group_name: g.group_name, emoji: g.group_emoji, quantity: Number(g.quantity) };
    const cur = out.get(g.product_id);
    if (cur) {
      cur.quantity = Math.round((cur.quantity + share.quantity) * 1000) / 1000;
      cur.groups = [...(cur.groups ?? []), share];
    } else {
      out.set(g.product_id, {
        product_id: g.product_id, quantity: share.quantity, groups: [share],
        ...(g.product_id.startsWith('custom:') ? { name: g.name ?? g.product_id.slice(7), category_id: g.category_id ?? 'altro', unit: g.unit ?? 'pz' } : {}),
      });
    }
  }
  return [...out.values()];
}

/** Quota del gruppo su una riga (0…1): "1 per te + 2 per 🎉" → 2/3. */
export function groupFraction(it: { quantity: number; groups?: GroupShare[] | null }): number {
  const g = (it.groups ?? []).reduce((t, x) => t + x.quantity, 0);
  return it.quantity > 0 ? Math.min(1, g / it.quantity) : 0;
}

/** "1 per te + 2 per 🎉 Festa" */
export function shareLabel(it: { quantity: number; unit?: string | null; groups?: GroupShare[] | null }): string | null {
  if (!it.groups?.length) return null;
  const g = it.groups.reduce((t, x) => t + x.quantity, 0);
  const mine = Math.round((it.quantity - g) * 1000) / 1000;
  const parts = it.groups.map((x) => `${x.quantity} per ${x.emoji || '👥'} ${x.group_name}`);
  return (mine > 0 ? [`${mine} per te`, ...parts] : parts).join(' + ');
}

/** Quanto dello scontrino (righe con il prezzo) è per i gruppi: non va nel Salvadanaio. */
export function groupSpend(lines: { product_id: string; line_price: number }[], merged: { product_id: string; quantity: number; groups?: GroupShare[] }[]): number {
  const by = new Map(merged.map((m) => [m.product_id, m]));
  let t = 0;
  for (const l of lines) {
    const m = by.get(l.product_id);
    if (m) t += (l.line_price || 0) * groupFraction(m);
  }
  return Math.round(t * 100) / 100;
}
