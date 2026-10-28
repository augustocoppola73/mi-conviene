/**
 * #40: i dati del widget (lista di casa e spesa in corso). Funziona anche ad app chiusa (compito in background):
 * legge la lista salvata sul telefono e, se c'è la rete, quella di casa della famiglia e la spesa in corso dal server.
 * L'ultima versione resta salvata (WIDGET_KEY): il widget si disegna subito anche senza rete.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { IS_CLOUD, sb } from '../cloud/client';
import { CATEGORIES, PRODUCT_INDEX } from '../engine/data';

export const WIDGET_KEY = 'mc_widget_v1';
const LIST_KEY = 'margine_list';

export interface WidgetItem { name: string; qty: string; emoji: string }
export interface WidgetShop { who: string | null; store: string; done: number; total: number; mine: boolean }
export interface WidgetData { family: boolean; total: number; items: WidgetItem[]; shop: WidgetShop | null; at: string }

const CAT = new Map(CATEGORIES.map((c, i) => [c.id, { emoji: c.emoji, order: i }]));
const qtyText = (q: number, unit: string, name: string) => {
  const n = Number.isInteger(q) ? String(q) : q.toLocaleString('it-IT');
  // «Latte intero 1L» ×2: il formato c'è già nel nome
  if (/(\d+([.,]\d+)?\s?(kg|g|l|ml|cl)\b)|(\bx\s?\d+\b)/i.test(name)) return `×${n}`;
  return unit === 'kg' && q < 1 ? `${Math.round(q * 1000)} g` : `${n} ${unit}`;
};

type Row = { product_id: string; quantity: number; name?: string | null; category_id?: string | null; unit?: string | null };
function toItems(rows: Row[]): WidgetItem[] {
  return rows.map((r) => {
    const p = PRODUCT_INDEX[r.product_id];
    const name = p?.name ?? r.name ?? r.product_id.replace(/^custom:/, '');
    const cat = p?.category_id ?? r.category_id ?? 'altro';
    return { name, qty: qtyText(Number(r.quantity), p?.unit ?? r.unit ?? 'pz', name), emoji: CAT.get(cat)?.emoji ?? '🛒', order: CAT.get(cat)?.order ?? 99 };
  }).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'it')).map(({ name, qty, emoji }) => ({ name, qty, emoji }));
}

export async function cachedWidgetData(): Promise<WidgetData | null> {
  try { const raw = await AsyncStorage.getItem(WIDGET_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/** dati freschi: server se possibile, altrimenti la lista sul telefono (e l'ultima spesa nota) */
export async function loadWidgetData(): Promise<WidgetData> {
  const prev = await cachedWidgetData();
  let local: Row[] = [];
  try { local = JSON.parse((await AsyncStorage.getItem(LIST_KEY)) || '[]'); } catch { /* lista vuota */ }
  let rows: Row[] = local;
  let family = prev?.family ?? false;
  let shop: WidgetShop | null = prev?.shop ?? null;
  if (IS_CLOUD) {
    try {
      const { data: s } = await sb().auth.getSession();
      const me = s.session?.user.id;
      if (me) {
        const { data: prof } = await sb().from('profiles').select('family_id').eq('id', me).maybeSingle();
        const fid = (prof as any)?.family_id as string | null;
        family = !!fid;
        if (fid) {
          const { data: home, error } = await sb().from('home_list_items').select('product_id,quantity,name,category_id,unit').eq('family_id', fid);
          if (!error && home) rows = home as Row[];
        }
        let q = sb().from('shops').select('user_id,display_name,store_name,items,taken_by,updated_at').eq('status', 'active').order('updated_at', { ascending: false }).limit(1);
        q = fid ? q.eq('family_id', fid) : q.eq('user_id', me);
        const { data: sh, error: se } = await q;
        if (!se) {
          const r = (sh ?? [])[0] as any;
          if (!r) shop = null;
          else {
            const items = (r.items ?? []) as { checked: boolean }[];
            const doer = r.taken_by?.user_id ?? r.user_id;
            shop = { who: doer === me ? null : (r.taken_by?.name ?? r.display_name ?? null), store: r.store_name, mine: doer === me,
              done: items.filter((i) => i.checked).length, total: items.length };
          }
        }
      }
    } catch { /* senza rete: resta quello che so */ }
  }
  const items = toItems(rows);
  const data: WidgetData = { family, total: items.length, items: items.slice(0, 12), shop, at: new Date().toISOString() };
  AsyncStorage.setItem(WIDGET_KEY, JSON.stringify(data)).catch(() => {});
  return data;
}
