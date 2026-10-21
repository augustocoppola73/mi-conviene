/** Spesa in corso: presa in carico, spunte, aiuto in un altro negozio, chiusura e Salvadanaio. */
import type * as T from '../api';
import { REQUEST_WAIT_MIN } from '../shopRules';
import { helpOptions } from '../engine/split';
import { computeVirtualReceipt, fuelInfo, FuelStation } from '../engine/core';
import { STORE_INDEX, STORES } from '../engine/data';
import { aisleOrder, learnAislesSteady, shopItem } from '../engine/kitchen';
import { nearestPerChain, parkingsAround, storesAround, storesFor } from '../engine/places';
import { median, pyRound } from '../engine/util';
import { check, sb, uid } from './client';
import { nowIso, r2, today } from './common';
import { customPrices, kv, priceBook, resetBookCache, saveCustomPrice, saveObserved, stationsNear, withCustomPrice, withParking } from './prices';
import { myProfile, savingRow } from './data';

// ------------------------------------------------------------------ spesa in corso
export async function shopOut(row: any, me: string): Promise<T.Shop> {
  const owner = row.family_id || row.user_id;
  const { data } = await sb().from('aisles').select('ranks').eq('owner_id', owner).eq('store_id', row.store_id).maybeSingle();
  const items: T.ShopItem[] = row.items;
  const done = items.filter((i) => i.checked);
  return { ...row, aisles: aisleOrder(data?.ranks),
    progress: { checked: done.length, total: items.length, cart: r2(done.reduce((s, i) => s + (i.price || 0), 0)),
      estimated: r2(items.reduce((s, i) => s + (i.price || 0), 0)) },
    mine: row.user_id === me };
}

export async function shopRow(id: string): Promise<any> {
  const row = check(await sb().from('shops').select('*').eq('id', id).maybeSingle());
  if (!row) throw new Error('Spesa non trovata');
  return row;
}

/** Modifica della spesa senza perdere le spunte degli altri: se nel frattempo è cambiata, si rilegge e si riprova. */
export async function updateShop(id: string, change: (row: any) => void): Promise<any> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await shopRow(id);
    change(row);
    const stamp = nowIso();
    const res = check(await sb().from('shops').update({ items: row.items, taken_by: row.taken_by ?? null, stops: row.stops ?? null, updated_at: stamp })
      .eq('id', id).eq('updated_at', row.updated_at).select('*')) as any[];
    if (res.length) return res[0];
  }
  throw new Error('La spesa è stata modificata da un altro: riprova');
}

/**
 * Spesa presa in carico da un altro: si guarda soltanto (a meno di aiutare o prenderla).
 * "Ti do una mano": i prodotti di una tappa con un proprietario ("by") li smarca solo lui, e lui solo quelli.
 */
export function guardAct(shop: any, me: string, item?: any) {
  if (shop.status && shop.status !== 'active') throw new Error('Questa spesa è già chiusa');
  const owner = item && item.stop != null ? shop.stops?.[item.stop]?.by : null;
  if (owner) {
    if (owner.user_id !== me) throw new Error(`Questo lo prende ${owner.name || 'un familiare'} da ${shop.stops[item.stop].store_name}`);
    return;
  }
  const t = shop.taken_by;
  if (t && t.user_id !== me && !(t.helpers || []).some((h: any) => h.user_id === me)) {
    throw new Error(`La sta facendo ${t.name || 'un familiare'}: chiedi di aiutare per smarcare anche tu`);
  }
}

/** #60: la spesa la chiude o la annulla solo chi la sta facendo (chi aiuta no) */
export function guardClose(shop: any, me: string, what: 'chiude' | 'annulla') {
  if (shop.status !== 'active') throw new Error('Questa spesa è già chiusa');
  const doer = shop.taken_by?.user_id ?? shop.user_id;
  if (doer !== me) throw new Error(`La ${what} chi la sta facendo (${shop.taken_by?.name || 'un familiare'})`);
}

export async function learnFromShop(row: any) {
  const owner = row.family_id || row.user_id;
  // spesa in più tappe: l'ordine dei reparti si impara negozio per negozio
  const parts: { store_id: string; items: any[] }[] = row.stops?.length > 1
    ? row.stops.map((st: any, k: number) => ({ store_id: st.store_id, items: row.items.filter((i: any) => (i.stop ?? 0) === k) }))
    : [{ store_id: row.store_id, items: row.items }];
  for (const part of parts) {
    const { data } = await sb().from('aisles').select('ranks').eq('owner_id', owner).eq('store_id', part.store_id).maybeSingle();
    const ranks = learnAislesSteady(part.items, data?.ranks);
    if (ranks) await sb().from('aisles').upsert({ owner_id: owner, store_id: part.store_id, ranks, updated_at: nowIso() });
  }
}

/** scontrino calcolato di una spesa, anche in più tappe (ogni prodotto col prezzo del suo negozio) */
export function shopReceipt(book: any, shop: any, listItems: any[], stopOf: (i: number) => number): any {
  if (!(shop.stops?.length > 1)) return computeVirtualReceipt(book, shop.store_id, listItems);
  const parts = shop.stops.map((st: any, k: number) => computeVirtualReceipt(book, st.store_id, listItems.filter((_: any, i: number) => stopOf(i) === k)));
  const sum = (f: (r: any) => number) => r2(parts.reduce((t: number, r: any) => t + f(r), 0));
  return { lines: parts.flatMap((r: any) => r.lines), unknown_products: parts.flatMap((r: any) => r.unknown_products),
    custom_items: parts.flatMap((r: any) => r.custom_items), real_lines: parts.reduce((t: number, r: any) => t + r.real_lines, 0),
    total: sum((r) => r.total), normal_total: sum((r) => r.normal_total), savings_vs_normal: sum((r) => r.savings_vs_normal) };
}

/**
 * Fine spesa: lo scontrino calcolato diventa quello di ciò che è finito davvero nel carrello
 * (comprese le cose aggiunte in negozio, senza quelle non prese), con i prezzi visti in negozio.
 * Così la verifica con lo scontrino vero confronta cose uguali.
 */
// #21: i prodotti per i gruppi seguono la spesa (anche se spunta o chiude un familiare): lo fa il database
export async function shopGroupSync(shopId: string, finish: boolean): Promise<T.GroupReceipt[]> {
  const { data, error } = await sb().rpc('shop_group_sync', { p_shop: shopId, p_finish: finish });
  if (error) throw new Error(error.message);
  return (data ?? []) as T.GroupReceipt[];
}

export async function finalizeSaving(shop: any) {
  if (!shop.saving_id) return;
  const row = await savingRow(shop.saving_id);
  const data = { ...(row.data || {}) };
  // #21: nel Salvadanaio solo la parte mia / della famiglia (quella per i gruppi va nei conti del gruppo)
  const mineQty = (i: T.ShopItem) => Math.round((i.quantity - (i.groups ?? []).reduce((t, g) => t + g.quantity, 0)) * 1000) / 1000;
  const bought: T.ShopItem[] = shop.items.filter((i: T.ShopItem) => i.checked && mineQty(i) > 0);
  const listItems = bought.map((i) => ({ product_id: i.product_id, quantity: mineQty(i), name: i.name, category_id: i.category_id, unit: i.unit }));
  resetBookCache();  // i prezzi segnati in negozio valgono subito
  const receipt: any = shopReceipt(await priceBook(), shop, listItems, (i) => bought[i].stop ?? 0);
  // #82: dove hai segnato il prezzo in negozio (anche «altra marca») vale quello, non la stima
  for (const l of receipt.lines ?? []) {
    const it = bought.find((b) => b.product_id === l.product_id);
    if (!it?.seen || !(it.quantity > 0)) continue;
    const p = r2(it.seen.price * (l.quantity / it.quantity));
    receipt.total = r2(receipt.total - (l.line_price || 0) + p);
    Object.assign(l, { line_price: p, unit_price: r2(p / (l.quantity || 1)), source: 'scontrino', confidence: 'green', location_name: 'segnato da te in negozio' });
  }
  // #26: i prodotti scritti a mano col prezzo (segnato in negozio o ricordato) diventano righe vere e contano nel totale
  const left: any[] = [];
  for (const c of receipt.custom_items ?? []) {
    const it = bought.find((b) => b.product_id === c.product_id);
    const full = it ? (it.seen?.price ?? it.price ?? null) : null;
    const price = full != null && it!.quantity > 0 ? r2(full * c.quantity / it!.quantity) : null;
    if (price == null) { left.push(c); continue; }
    receipt.lines.push({ product_id: c.product_id, name: c.name, quantity: c.quantity, unit: c.unit, category_id: it!.category_id ?? c.category_id ?? null, unit_price: r2(price / (c.quantity || 1)),
      normal_price: price, line_price: price, in_promo: false, loyalty_required: false, confidence: 'green',
      source: 'scontrino', observed_at: today(), location_name: it!.seen ? 'segnato da te in negozio' : 'visto da te',
      sample_product: null, proof_url: null, custom: true });
    receipt.total = r2(receipt.total + price);
    receipt.normal_total = r2(receipt.normal_total + price);
  }
  receipt.custom_items = left;
  // #99: spesa in più negozi (o con chi dà una mano): alla verifica serve uno scontrino per negozio
  if ((shop.stops?.length ?? 0) > 1) {
    data.stops_paid = shop.stops.map((st: any, k: number) => ({ store_name: st.store_name, by: st.by?.name ?? null,
      items: bought.filter((b) => (b.stop ?? 0) === k).length })).filter((x: any) => x.items > 0);
  }
  const snap = data.snapshot ? { ...data.snapshot } : null;
  if (snap) {
    const fuel = snap.travel?.fuel_cost ?? 0;
    snap.receipt = receipt;
    snap.total_cost = r2(receipt.total + fuel);
    snap.effective_cost = r2(snap.total_cost - (snap.fuel_stop?.saving ?? 0));
    data.snapshot = snap;
  }
  // #63: il risparmio conta solo i prodotti presi davvero. Calcolo quanto pesa ogni prodotto nel risparmio
  // (riferimento − negozio scelto, con gli stessi prezzi) e tengo la parte dei prodotti comprati.
  const before = Number(data.amount) || 0;
  if (!data.no_saving && before > 0 && data.amount_planned == null) {
    const book = await priceBook();
    const storeOf = (i: T.ShopItem) => i.store_id ?? shop.store_id;
    const refPrice = (pid: string, q: number): number | null => {
      if (data.reference_store_id) return shopItem(book, { product_id: pid, quantity: q }, data.reference_store_id).price;
      const ps = STORES.map((st) => shopItem(book, { product_id: pid, quantity: q }, st.id).price).filter((x): x is number => x != null);
      return ps.length ? median(ps) : null;
    };
    const gain = (list: T.ShopItem[]) => list.reduce((t, i) => {
      const q = mineQty(i);
      if (q <= 0 || i.product_id.startsWith('custom:')) return t;
      const here = shopItem(book, { product_id: i.product_id, quantity: q }, storeOf(i)).price;
      const ref = refPrice(i.product_id, q);
      return here != null && ref != null ? t + (ref - here) : t;
    }, 0);
    const all = gain(shop.items.filter((i: T.ShopItem) => !i.added_in_store));
    const got = gain(bought.filter((i) => !i.added_in_store));   // le cose aggiunte in negozio non erano nel confronto
    const fuel = Number(data.fuel_saving) || 0;
    const shopPart = Math.max(0, before - fuel);
    const newShop = all > 0.01 ? r2(Math.max(0, shopPart * Math.min(1, got / all))) : r2(Math.max(0, got));
    if (Math.abs(newShop - shopPart) > 0.005) {
      data.amount_planned = before;              // quello promesso alla conferma
      data.amount = r2(newShop + fuel);
    }
  }
  const travel = (data.estimated_total ?? 0) - (data.estimated_spend ?? 0);
  data.planned_spend = data.planned_spend ?? data.estimated_spend ?? null;   // quello previsto alla conferma
  data.estimated_spend = receipt.total;
  data.estimated_total = r2(receipt.total + Math.max(travel, 0));
  data.added_in_store = bought.filter((i) => i.added_in_store).map((i) => i.name);
  data.not_bought = shop.items.filter((i: T.ShopItem) => !i.checked).map((i: T.ShopItem) => i.name);
  data.bought_by = shop.taken_by?.name ?? shop.display_name ?? null;
  check(await sb().from('savings').update({ data }).eq('id', row.id));
  // lo storico (abitudini, budget) registra quello che è stato comprato davvero
  if (data.history_id) await sb().from('history').update({ items: listItems }).eq('id', data.history_id);
  return { before, after: Number(data.amount) || 0 };
}


export const shopApi = {
  shopCreate: async (body: { user_id: string; store_id: string; saving_id?: string; branch?: string | null; items: T.ShopItemIn[]; display_name?: string | null; stops?: T.ShopStop[] | null }): Promise<T.Shop> => {
    if (!STORE_INDEX[body.store_id]) throw new Error('Negozio sconosciuto');
    const me = await uid();
    const [book, cp] = await Promise.all([priceBook(), customPrices()]);
    const seen = new Set<string>();
    const items: any[] = [];
    const stops = body.stops && body.stops.length > 1 ? body.stops : null;
    for (const it of body.items) {
      if (seen.has(it.product_id)) continue;
      seen.add(it.product_id);
      const groups = it.groups?.length ? { groups: it.groups } : {};   // #21: la parte per i gruppi
      if (!stops) { items.push({ ...withCustomPrice(shopItem(book, it, body.store_id), body.store_id, cp), ...groups }); continue; }
      // spesa in più tappe: ogni prodotto col prezzo del negozio dove lo prendi
      const k = Math.min(Math.max(it.stop ?? 0, 0), stops.length - 1);
      items.push({ ...withCustomPrice(shopItem(book, it, stops[k].store_id), stops[k].store_id, cp), stop: k, store_id: stops[k].store_id, ...groups });
    }
    const row = check(await sb().from('shops').insert({
      display_name: body.display_name ?? null, store_id: body.store_id,
      store_name: stops ? stops.map((st) => STORE_INDEX[st.store_id]?.name ?? st.store_name).join(' e ') : STORE_INDEX[body.store_id].name,
      branch: body.branch ?? null, saving_id: body.saving_id ?? null, items,
      ...(stops ? { stops } : {}),
    }).select('*').single());
    return shopOut(row, me);
  },

  shopActive: async (_user_id: string): Promise<{ shop: T.Shop | null; others?: number }> => {
    const me = await uid();
    const shops = check(await sb().from('shops').select('*').eq('status', 'active').order('created_at', { ascending: false }).limit(5)) as any[];
    if (!shops.length) return { shop: null };
    const mine = shops.find((s) => s.user_id === me);
    return { shop: await shopOut(mine ?? shops[0], me), others: shops.length - 1 };
  },

  shopCheck: async (id: string, _user_id: string, key: string, checked: boolean, display_name?: string | null): Promise<T.Shop> => {
    const me = await uid();
    const row = await updateShop(id, (shop) => {
      if (shop.status !== 'active') throw new Error('Questa spesa è già chiusa');
      guardAct(shop, me, shop.items.find((i: any) => i.key === key));
      let found = false;
      for (const i of shop.items) {
        if (i.key === key) {
          Object.assign(i, { checked, checked_by: checked ? display_name || null : null, checked_by_id: checked ? me : null,
            checked_at: checked ? nowIso() : null });
          found = true;
        }
      }
      if (!found) throw new Error('Prodotto non trovato');
      // spesa libera: smarcare vuol dire prenderla (l'app chiede conferma prima)
      if (checked && !shop.taken_by) shop.taken_by = { user_id: me, name: display_name || null, at: nowIso(), helpers: [] };
    });
    // #21: un prodotto preso anche per un gruppo risulta preso nel gruppo (gli altri lo vedono subito)
    const it = (row.items as T.ShopItem[]).find((i) => i.key === key);
    if (it?.groups?.length) shopGroupSync(id, false).catch(() => {});
    return shopOut(row, me);
  },

  /**
   * Chi fa la spesa: una persona sola, presa solo con un gesto esplicito. Chi vuole prenderla (o aiutare) chiede,
   * chi la fa risponde; dopo un "no" niente nuova richiesta per REQUEST_WAIT_MIN minuti; senza risposta per
   * REQUEST_WAIT_MIN minuti chi ha chiesto può prenderla comunque.
   */
  shopTake: async (id: string, _user_id: string, display_name?: string | null, mode: T.TakeMode = 'take'): Promise<T.Shop> => {
    const me = await uid();
    // il nome lo vedono gli altri ("La sta facendo Moira"): se sul telefono non c'è, quello del profilo
    const name = display_name || (await myProfile().catch(() => null as any))?.display_name || null;
    const waitMs = REQUEST_WAIT_MIN * 60_000;
    const row = await updateShop(id, (shop) => {
      if (shop.status !== 'active') throw new Error('Questa spesa è già chiusa');
      const t = shop.taken_by;
      const who = t?.name || 'un familiare';
      const fresh = (u: string) => ({ user_id: u, name, at: nowIso(), helpers: [] });
      switch (mode) {
        case 'take': {
          if (!t || t.user_id === me) { shop.taken_by = t?.user_id === me ? t : fresh(me); break; }
          const r = t.request;
          if (r?.user_id === me && Date.now() - new Date(r.at).getTime() >= waitMs) { shop.taken_by = fresh(me); break; }
          throw new Error(`La sta facendo ${who}: chiedi di prenderla`);
        }
        case 'request': case 'request_help': case 'help': {
          if (!t) { shop.taken_by = fresh(me); break; }               // libera: la prendo e basta
          if (t.user_id === me || (t.helpers || []).some((h: any) => h.user_id === me)) break;
          if (t.request && t.request.user_id !== me) throw new Error(`${t.request.name || 'Un familiare'} ha già chiesto a ${who}: aspetta la risposta`);
          if (t.declined?.user_id === me && new Date(t.declined.until).getTime() > Date.now()) {
            const at = new Date(t.declined.until).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
            throw new Error(`${who} la sta facendo: potrai chiedere di nuovo dalle ${at}`);
          }
          t.request = { user_id: me, name, mode: mode === 'request' ? 'take' : 'help', at: nowIso() };
          break;
        }
        case 'cancel':
          if (t?.request?.user_id === me) t.request = null;
          break;
        case 'accept': case 'decline': {
          if (!t || t.user_id !== me) throw new Error('Solo chi fa la spesa può rispondere');
          const r = t.request;
          if (!r) break;
          if (mode === 'decline') { t.request = null; t.declined = { user_id: r.user_id, until: new Date(Date.now() + waitMs).toISOString() }; break; }
          if (r.mode === 'help') { t.helpers = [...(t.helpers || []).filter((h: any) => h.user_id !== r.user_id), { user_id: r.user_id, name: r.name }]; t.request = null; t.declined = null; }
          else shop.taken_by = { user_id: r.user_id, name: r.name, at: nowIso(), helpers: [] };
          break;
        }
        case 'release':
          if (!t) break;
          if (t.user_id === me) shop.taken_by = null;
          else t.helpers = (t.helpers || []).filter((h: any) => h.user_id !== me);
          break;
      }
    });
    return shopOut(row, me);
  },

  shopAdd: async (id: string, _user_id: string, item: T.ShopItemIn): Promise<T.Shop> => {
    const me = await uid();
    const myName = (await myProfile().catch(() => null))?.display_name ?? null;   // #82: «preso da Augusto», non «da un familiare»
    const [book, cp] = await Promise.all([priceBook(), customPrices()]);
    const row = await updateShop(id, (shop) => {
      if (shop.status !== 'active') throw new Error('Questa spesa è già chiusa');
      // #102: chi dà una mano in un'altra tappa può aggiungere nella sua parte
      const ex0 = shop.items.find((i: any) => i.key === item.product_id);
      guardAct(shop, me, ex0 ?? (shop.stops?.length > 1 ? { stop: Math.min(Math.max(item.stop ?? 0, 0), shop.stops.length - 1) } : undefined));
      const existing = shop.items.find((i: any) => i.key === item.product_id);
      if (existing) existing.quantity = pyRound(existing.quantity + item.quantity, 3);
      else if (shop.stops?.length > 1) {
        const k = Math.min(Math.max(item.stop ?? 0, 0), shop.stops.length - 1);
        const sid = shop.stops[k].store_id;
        shop.items.push({ ...withCustomPrice(shopItem(book, item, sid, true), sid, cp), stop: k, store_id: sid, checked: true, checked_at: nowIso(), checked_by: myName, checked_by_id: me });
      } else shop.items.push({ ...withCustomPrice(shopItem(book, item, shop.store_id, true), shop.store_id, cp), checked: true, checked_at: nowIso(), checked_by: myName, checked_by_id: me });
    });
    return shopOut(row, me);
  },

  shopPrice: async (id: string, body: { user_id: string; key: string; price: number; kind: T.PriceKind; note?: string | null; display_name?: string | null; promo_until?: string | null }): Promise<T.Shop> => {
    const me = await uid();
    const current = await shopRow(id);
    const item = current.items.find((i: any) => i.key === body.key);
    if (!item) throw new Error('Prodotto non trovato');
    guardAct(current, me, item);
    if (!item.product_id.startsWith('custom:')) {
      const kg = item.unit === 'kg';
      await saveObserved([{ product_id: item.product_id, text: item.name, net_price: body.price,
        quantity: kg ? 1 : item.quantity, weight_kg: kg ? item.quantity : null, kind: body.kind,
        promo_until: body.promo_until ?? null, note: body.note ?? null }], item.store_id ?? current.store_id, today(),
        (item.stop != null && current.stops?.[item.stop]?.branch) || current.branch || null);
    } else if (body.kind !== 'variante' && item.quantity > 0) {
      // #26: scritto a mano: il prezzo resta per la prossima volta in questo negozio
      await saveCustomPrice(item.store_id ?? current.store_id, item.product_id, item.name, item.unit, body.price / item.quantity).catch(() => {});
    }
    const row = await updateShop(id, (shop) => {
      const it = shop.items.find((i: any) => i.key === body.key);
      if (!it) throw new Error('Prodotto non trovato');
      Object.assign(it, { seen: { price: body.price, kind: body.kind, note: body.note ?? null }, checked: true,
        checked_at: it.checked_at || nowIso(), checked_by: body.display_name ?? null, checked_by_id: me });
      it.price = body.price;   // #82: nel carrello conta quello che paghi, anche se è un'altra marca
    });
    return shopOut(row, me);
  },

  /** "Ti do una mano" (#4): proposte di negozi vicino a te per una parte della spesa in corso di un familiare. */
  shopHelpPlan: async (id: string, lat: number, lon: number, transport: T.Transport, fuelType: T.FuelType): Promise<T.HelpOption[]> => {
    const me = await uid();
    const shop = await shopRow(id);
    if (shop.status !== 'active') throw new Error('Questa spesa è già chiusa');
    if (shop.taken_by?.user_id === me) throw new Error('Questa spesa la stai già facendo tu');
    const book = await priceBook();
    const todo = shop.items.filter((i: any) => !i.checked && !(i.stop != null && shop.stops?.[i.stop]?.by));
    if (!todo.length) throw new Error('Non resta niente da prendere');
    let near;
    try { near = nearestPerChain(await storesAround(lat, lon, kv), lat, lon); } catch { throw new Error('OpenStreetMap non raggiungibile: riprova tra poco'); }
    const [stores, loc] = storesFor(near);
    if (loc.mode !== 'reale') throw new Error('Nessun supermercato vicino a te');
    const [stations, parkings] = await Promise.all([stationsNear(lat, lon).catch(() => [] as FuelStation[]), parkingsAround(lat, lon, kv).catch(() => null)]);
    const fuel = fuelInfo(fuelType || 'benzina', stations, lat, lon);
    if (parkings) withParking(stores.map((st) => (st.branch ? Object.assign(st.branch, { chain: st.id }) : null)), parkings);
    return helpOptions(todo, stores, (sid, pid, q) => shopItem(book, { product_id: pid, quantity: q }, sid).price, { transport, fuel }) as T.HelpOption[];
  },

  /**
   * #15 "Cosa conviene prendere a me": tra i prodotti liberi del gruppo, quelli che costano meno nei negozi vicino a me
   * (rispetto al prezzo tipico in zona). Stesso motore di "Ti do una mano".
   */
  groupHelpPlan: async (items: { id: string; product_id: string; name: string; quantity: number; unit: string; category_id: string | null }[],
    lat: number, lon: number, transport: T.Transport, fuelType: T.FuelType): Promise<T.HelpOption[]> => {
    const book = await priceBook();
    let near;
    try { near = nearestPerChain(await storesAround(lat, lon, kv), lat, lon); } catch { throw new Error('OpenStreetMap non raggiungibile: riprova tra poco'); }
    const [stores, loc] = storesFor(near);
    if (loc.mode !== 'reale') throw new Error('Nessun supermercato vicino a te');
    const priceAt = (sid: string, pid: string, q: number) => shopItem(book, { product_id: pid, quantity: q }, sid).price;
    // prezzo "tipico": mediana dei negozi vicini (così "conviene" vuol dire meno di quanto si spenderebbe di solito)
    const todo = items.filter((i) => !i.product_id.startsWith('custom:')).map((i) => {
      const ps = stores.map((st) => priceAt(st.id, i.product_id, i.quantity)).filter((p): p is number => p != null);
      return { key: i.id, product_id: i.product_id, name: i.name, quantity: i.quantity, unit: i.unit, category_id: i.category_id, price: ps.length ? r2(median(ps)) : null };
    });
    if (!todo.length) throw new Error('Non ci sono prodotti del catalogo liberi da prendere');
    const [stations, parkings] = await Promise.all([stationsNear(lat, lon).catch(() => [] as FuelStation[]), parkingsAround(lat, lon, kv).catch(() => null)]);
    const fuel = fuelInfo(fuelType || 'benzina', stations, lat, lon);
    if (parkings) withParking(stores.map((st) => (st.branch ? Object.assign(st.branch, { chain: st.id }) : null)), parkings);
    return helpOptions(todo, stores, priceAt, { transport, fuel }) as T.HelpOption[];
  },

  /** prendo io questi prodotti da quel negozio: diventano una tappa mia, spariscono dalla lista di chi fa la spesa */
  shopHelpTake: async (id: string, opt: { store_id: string; store_name: string; branch?: any }, keys: string[], display_name?: string | null): Promise<T.Shop> => {
    const me = await uid();
    const name = display_name || (await myProfile().catch(() => null as any))?.display_name || null;
    const book = await priceBook();
    const row = await updateShop(id, (shop) => {
      if (shop.status !== 'active') throw new Error('Questa spesa è già chiusa');
      if (!shop.taken_by || shop.taken_by.user_id === me) throw new Error('Puoi dare una mano a una spesa che sta facendo un altro');
      if (shop.stops?.some((st: any) => st.by?.user_id === me)) throw new Error('Hai già una parte di questa spesa');
      if (!shop.stops?.length) {
        shop.stops = [{ store_id: shop.store_id, store_name: shop.store_name, branch: shop.branch ?? null, lat: null, lon: null }];
      }
      const k = shop.stops.length;
      const b = opt.branch;
      shop.stops.push({ store_id: opt.store_id, store_name: opt.store_name,
        branch: b ? [b.name, b.address].filter(Boolean).join(' · ') : null, lat: b?.lat ?? null, lon: b?.lon ?? null,
        parking: b?.parking ?? null, by: { user_id: me, name, at: nowIso() } });
      let moved = 0;
      for (const it of shop.items) {
        if (!keys.includes(it.key) || it.checked) continue;
        const from = it.stop ?? 0;
        if (shop.stops[from]?.by) continue;  // già di qualcun altro
        it.helped_from = { stop: from, store_id: it.store_id ?? shop.store_id, price: it.price };
        it.stop = k;
        it.store_id = opt.store_id;
        it.price = shopItem(book, it, opt.store_id).price;
        moved++;
      }
      if (!moved) throw new Error('Questi prodotti li ha già presi qualcuno');
    });
    return shopOut(row, me);
  },

  /** lascio la mia parte: quello che non ho ancora preso torna a chi fa la spesa */
  shopHelpRelease: async (id: string): Promise<T.Shop> => {
    const me = await uid();
    const row = await updateShop(id, (shop) => {
      const k = shop.stops?.findIndex((st: any) => st.by?.user_id === me) ?? -1;
      if (k < 0) return;
      let kept = 0;
      for (const it of shop.items) {
        if ((it.stop ?? 0) !== k) continue;
        if (it.checked) { kept++; continue; }
        const f = it.helped_from || { stop: 0, store_id: shop.store_id, price: it.price };
        Object.assign(it, { stop: f.stop, store_id: f.store_id, price: f.price });
        delete it.helped_from;
      }
      if (kept) shop.stops[k].released = true;  // quello che ho già preso resta registrato
      else {
        shop.stops.splice(k, 1);
        for (const it of shop.items) if ((it.stop ?? 0) > k) it.stop -= 1;
      }
    });
    return shopOut(row, me);
  },

  shopFinish: async (id: string, _user_id: string) => {
    const shop = await shopRow(id);
    guardClose(shop, await uid(), 'chiude');
    // #59: una volta sola (due telefoni insieme, o una spesa già annullata): passa a "done" solo se è ancora attiva
    const closed = check(await sb().from('shops').update({ status: 'done', finished_at: nowIso() }).eq('id', id).eq('status', 'active').select('id')) as any[];
    if (!closed?.length) throw new Error('Questa spesa è già chiusa');
    await learnFromShop(shop).catch(() => {});
    const saving_change = await finalizeSaving(shop).catch(() => undefined);
    const items: T.ShopItem[] = shop.items;
    const group_receipts = items.some((i) => i.groups?.length) ? await shopGroupSync(id, true).catch(() => []) : [];
    return { missing: items.filter((i) => !i.checked), saving_id: shop.saving_id ?? null, store_name: shop.store_name as string,
      cart: r2(items.filter((i) => i.checked).reduce((s, i) => s + (i.price || 0), 0)), group_receipts,
      saving_change: saving_change && Math.abs(saving_change.after - saving_change.before) > 0.005 ? saving_change : null };
  },

  shopCancel: async (id: string, _user_id: string, dropSaving = false) => {
    const shop = await shopRow(id);
    guardClose(shop, await uid(), 'annulla');
    const closed = check(await sb().from('shops').update({ status: 'cancelled' }).eq('id', id).eq('status', 'active').select('id')) as any[];
    if (!closed?.length) throw new Error('Questa spesa è già chiusa');
    // #99: il risparmio stimato di una spesa mai fatta: lo tolgo (se è mio e lo chiedi) o lo segno «annullata» (se è di un familiare)
    if (shop.saving_id) await sb().rpc('cancel_shop_saving', { p_shop: id, p_drop: dropSaving }).then(() => {}, () => {});
    return { items: shop.items as T.ShopItem[] };
  },

};
