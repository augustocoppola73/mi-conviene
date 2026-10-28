import AsyncStorage from '@react-native-async-storage/async-storage';
import { refreshWidgets } from './widget';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState, useRef } from 'react';

import { api, Bootstrap, FavoriteStore, FuelType, ListItem, MenuEntry, OptimizeResult, Product, Transport } from './api';
import type { GeoPoint } from './location';
import { getUserId } from './user';
import { IS_CLOUD } from './cloud/client';
import { MyGroupItem, myGroupItems } from './cloud/groups';
import { diffLists, homeDelete, homeList, homeUpsert, myAppProfile, saveAppPrefs, saveDisplayName, watchHome } from './cloud/homeList';
import { sb } from './cloud/client';
import { AppState } from 'react-native';

// Chiavi con prefisso storico "margine_": rinominarle cancellerebbe i dati salvati.
const LIST_KEY = 'margine_list';
const PREFS_KEY = 'margine_prefs';

export interface Prefs {
  transport: Transport;
  /** vecchio "abituale" (uno solo): resta per leggere i dati salvati, ora valgono i preferiti */
  habitualStoreId: string | null;
  habitualBranch: { name: string; address: string | null; lat: number; lon: number } | null;
  /** #19: i supermercati preferiti, punti vendita precisi (valgono quando sei lì vicino) */
  favorites: FavoriteStore[];
  budget: number | null;
  minSavingsThreshold: number;
  displayName: string;
  fuelType: FuelType;
  location: GeoPoint | null;
  /** gps = la posizione si aggiorna da sola; address = indirizzo scritto a mano; null = posizione non usata */
  locationMode: 'gps' | 'address' | null;
  refuel: boolean;
  refuelLiters: number | null;
  /** menu in preparazione (ricette scelte, con le persone) */
  menu: MenuEntry[];
  /** Vicino a me: solo le insegne con prezzi nell'app */
  nearOnlyPriced: boolean;
  /** regione delle ricette regionali (null = quella della posizione) */
  recipeRegion?: string | null;
  /** le mie regole per la spesa in due negozi: categoria → catena */
  categoryRules: Record<string, string>;
  /** #21: la lista mostrata nella scheda Lista: null = la mia, altrimenti l'id del gruppo */
  activeList: string | null;
  /** #24: la mia lista a righe o a card compatte */
  listView: 'lista' | 'griglia';
  /** #23: entrato con l'invito a un gruppo, senza usare l'app per sé: funzioni personali ingrigite */
  participant: boolean;
  /** #30: Offerte di oggi aperte o chiuse in fondo alla Lista */
  offersOpen: boolean;
  /** #35: "Di solito lo ricompri": prodotto → fino a quando non riproporlo (AAAA-MM-GG) */
  restockSnooze: Record<string, string>;
  /** #41: spesa in corso a tutto schermo con card grandi (modalità negozio) */
  storeFull: boolean;
  /** #46: l'ultima "Organizza la festa" per gruppo (per rifarla con altre persone) */
  eventPlans: Record<string, { type: string; adults: number; kids: number; /** #67: quanto ha aggiunto la festa (lista personale) */ added?: Record<string, number> }>;
  /** #75: quando le preferenze sono state allineate con il profilo online (ms) */
  syncAt: number;
  /** #90: primo avvio guidato già visto */
  onboarded: boolean;
}

/** #75: le preferenze che seguono la persona su ogni telefono (le altre restano del telefono: GPS, vista, modalità…) */
const SYNC_KEYS = ['displayName', 'favorites', 'budget', 'minSavingsThreshold', 'fuelType', 'transport', 'categoryRules',
  'refuel', 'refuelLiters', 'nearOnlyPriced', 'restockSnooze', 'menu', 'onboarded', 'recipeRegion'] as const;
const pickSync = (p: Prefs) => Object.fromEntries(SYNC_KEYS.map((k) => [k, p[k]]));

const DEFAULT_PREFS: Prefs = {
  transport: 'car',
  habitualStoreId: null,
  habitualBranch: null,
  favorites: [],
  budget: null, // nessun limite finché non lo scegli (o accetti quello suggerito)
  minSavingsThreshold: 3,
  displayName: '',
  fuelType: 'benzina',
  location: null,
  locationMode: null,
  refuel: false,
  refuelLiters: null,
  menu: [],
  nearOnlyPriced: false,
  categoryRules: {},
  activeList: null,
  listView: 'griglia',
  participant: false,
  offersOpen: true,
  restockSnooze: {},
  storeFull: false,
  eventPlans: {},
  syncAt: 0,
  onboarded: false,
};

interface StoreValue {
  hydrated: boolean;
  userId: string | null;
  catalog: Bootstrap | null;
  catalogError: string | null;
  reloadCatalog: () => void;
  productById: (id: string) => Product | undefined;
  items: ListItem[];
  addItem: (productId: string, quantity?: number) => void;
  addCustom: (name: string, categoryId: string, quantity?: number, unit?: string) => void;
  removeItem: (productId: string) => void;
  toggleItem: (productId: string) => void;
  updateQty: (productId: string, quantity: number) => void;
  /** reparto di un prodotto scritto a mano (si può correggere dopo averlo aggiunto) */
  setItemCategory: (productId: string, categoryId: string) => void;
  setItems: (items: ListItem[]) => void;
  clearItems: () => void;
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;
  lastResult: OptimizeResult | null;
  setLastResult: (r: OptimizeResult | null) => void;
  /** #66: la lista è cambiata dopo l'ultimo calcolo (il risultato non vale più) */
  lastResultStale: boolean;
  /** #91: in famiglia la lista è la «lista di casa», in comune e in diretta */
  familyId: string | null;
  /** chi ha aggiunto i prodotti della lista di casa (se non sono io): product_id → nome */
  addedBy: Record<string, string>;
  /** rilegge famiglia e preferenze dal profilo online (dopo entrare/uscire dalla famiglia) */
  reloadProfile: () => Promise<void>;
  /** #21: i prodotti che prendo io nei gruppi (entrano nella mia spesa) */
  groupMine: MyGroupItem[];
  reloadGroupMine: () => Promise<MyGroupItem[]>;
}

/** id di un prodotto scritto a mano: "custom:coca-cola" */
/** #66: impronta della lista (mia + parte dei gruppi) per capire se un risultato è ancora valido */
export function shoppingSig(items: { product_id: string; quantity: number }[], mine: { product_id: string; quantity: number }[]): string {
  return [...items, ...mine].map((i) => `${i.product_id}:${i.quantity}`).sort().join('|');
}

export function customId(name: string): string {
  return 'custom:' + name.trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Bootstrap | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [items, setItemsState] = useState<ListItem[]>([]);
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
  const [lastResult, setLastResultState] = useState<OptimizeResult | null>(null);
  const [resultSig, setResultSig] = useState('');

  // Idratazione: leggiamo PRIMA di scrivere, altrimenti i default sovrascrivono i dati salvati.
  useEffect(() => {
    (async () => {
      try {
        const [list, p, uid] = await Promise.all([
          AsyncStorage.getItem(LIST_KEY),
          AsyncStorage.getItem(PREFS_KEY),
          getUserId(),
        ]);
        if (list) setItemsState(JSON.parse(list));
        if (p) {
          const saved = { ...DEFAULT_PREFS, ...JSON.parse(p) } as Prefs;
          // prima la posizione si aggiornava a mano: chi l'aveva attivata passa a quella automatica
          if (saved.location && saved.locationMode == null) saved.locationMode = saved.location.label ? 'address' : 'gps';
          // #19: l'abituale di prima diventa il primo preferito
          if (!saved.favorites?.length && saved.habitualStoreId && saved.habitualBranch) {
            saved.favorites = [{ store_id: saved.habitualStoreId, branch: saved.habitualBranch }];
          }
          if (!Array.isArray(saved.favorites)) saved.favorites = [];
          setPrefsState(saved);
        }
        setUserId(uid);
      } catch {
        // dati corrotti: si riparte dai default
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(LIST_KEY, JSON.stringify(items)).then(() => refreshWidgets(), () => {});   // #40: il widget segue la lista
  }, [items, hydrated]);
  // #67: lista svuotata (spesa confermata o Svuota): la festa di prima non è più in lista, la prossima si somma da capo
  useEffect(() => {
    if (!hydrated || items.length) return;
    setPrefsState((p) => (p.eventPlans?.mine?.added && Object.keys(p.eventPlans.mine.added).length
      ? { ...p, eventPlans: { ...p.eventPlans, mine: { ...p.eventPlans.mine, added: {} } } } : p));
  }, [items.length, hydrated]);

  useEffect(() => {
    if (hydrated) AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs)).catch(() => {});
  }, [prefs, hydrated]);

  const reloadCatalog = useCallback(() => {
    setCatalogError(null);
    api.bootstrap().then(setCatalog).catch((e: Error) => setCatalogError(e.message));
  }, []);

  useEffect(reloadCatalog, [reloadCatalog]);

  const productIndex = useMemo(() => {
    const m = new Map<string, Product>();
    catalog?.products.forEach((p) => m.set(p.id, p));
    return m;
  }, [catalog]);

  const productById = useCallback((id: string) => productIndex.get(id), [productIndex]);

  const addItem = useCallback(
    (productId: string, quantity?: number) => {
      const qty = quantity ?? productIndex.get(productId)?.default_qty ?? 1;
      setItemsState((prev) => {
        const found = prev.find((i) => i.product_id === productId);
        if (found) {
          return prev.map((i) => (i.product_id === productId ? { ...i, quantity: round(i.quantity + qty) } : i));
        }
        return [...prev, { product_id: productId, quantity: qty }];
      });
    },
    [productIndex],
  );

  const addCustom = useCallback((name: string, categoryId: string, quantity = 1, unit = 'pz') => {
    const clean = name.trim();
    if (!clean) return;
    const id = customId(clean);
    setItemsState((prev) =>
      prev.some((i) => i.product_id === id)
        ? prev // già in lista: la quantità si cambia dalla lista, niente aggiunte silenziose
        : [...prev, { product_id: id, quantity, name: clean, category_id: categoryId, unit }],
    );
  }, []);

  // tocco su un prodotto (ricerca, categorie, offerte): se non c'è lo aggiunge, se c'è già lo toglie
  const toggleItem = useCallback(
    (productId: string) => {
      setItemsState((prev) =>
        prev.some((i) => i.product_id === productId)
          ? prev.filter((i) => i.product_id !== productId)
          : [...prev, { product_id: productId, quantity: productIndex.get(productId)?.default_qty ?? 1 }]);
    },
    [productIndex],
  );

  const removeItem = useCallback((productId: string) => {
    setItemsState((prev) => prev.filter((i) => i.product_id !== productId));
  }, []);

  const updateQty = useCallback((productId: string, quantity: number) => {
    setItemsState((prev) =>
      quantity <= 0
        ? prev.filter((i) => i.product_id !== productId)
        : prev.map((i) => (i.product_id === productId ? { ...i, quantity: round(quantity) } : i)),
    );
  }, []);

  const setItemCategory = useCallback((productId: string, categoryId: string) => {
    setItemsState((prev) => {
      const it = prev.find((i) => i.product_id === productId);
      // #27: il reparto corretto vale anche nel catalogo di tutti (se l'ho creato io e lo uso solo io)
      if (it && productId.startsWith('custom:')) api.rememberCustom(productId, it.name ?? productId.slice(7), categoryId, it.unit ?? 'pz').catch(() => {});
      return prev.map((i) => (i.product_id === productId ? { ...i, category_id: categoryId } : i));
    });
  }, []);

  const setPrefs = useCallback((patch: Partial<Prefs>) => setPrefsState((p) => ({ ...p, ...patch })), []);

  const [groupMine, setGroupMine] = useState<MyGroupItem[]>([]);
  const itemsRef = useRef(items); itemsRef.current = items;
  const groupMineRef = useRef(groupMine); groupMineRef.current = groupMine;
  const setLastResult = useCallback((r: OptimizeResult | null) => {
    setLastResultState(r);
    setResultSig(r ? shoppingSig(itemsRef.current, groupMineRef.current) : '');
  }, []);
  const reloadGroupMine = useCallback(async () => {
    if (!IS_CLOUD) return [];
    try {
      // quelli già nella mia spesa in corso non li conto due volte
      const [r, act] = await Promise.all([myGroupItems(), api.shopActive('').catch(() => null)]);
      const busy = new Set(act?.shop?.mine ? act.shop.items.flatMap((i) => (i.groups ?? []).map((g) => g.group_item_id)) : []);
      const free = r.filter((g) => !busy.has(g.id));
      setGroupMine(free);
      return free;
    } catch { return []; }
  }, []);
  useEffect(() => { if (hydrated && userId) reloadGroupMine(); }, [hydrated, userId, reloadGroupMine]);

  // ---------------------------------------------------------------- #91 lista di casa · #75 preferenze online
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [addedBy, setAddedBy] = useState<Record<string, string>>({});
  const prefsRef = useRef(prefs); prefsRef.current = prefs;
  const lastPushed = useRef<string | null>(null);
  const reloadProfile = useCallback(async () => {
    if (!IS_CLOUD || !userId) return;
    const pr = await myAppProfile();
    if (!pr) return;
    setFamilyId(pr.family_id ?? null);
    const cur = prefsRef.current;
    const patch: Partial<Prefs> = {};
    // preferenze più nuove su un altro telefono: valgono quelle
    if (pr.app?.at && pr.app.at > (cur.syncAt || 0)) Object.assign(patch, pr.app.data as Partial<Prefs>, { syncAt: pr.app.at });
    else if (!pr.app) { const at = Date.now(); saveAppPrefs(at, pickSync(cur)).then(() => setPrefsState((p) => ({ ...p, syncAt: at }))).catch(() => {}); }   // prima volta: salvo le mie
    // il nome: se qui non c'è ma è sul profilo, lo riprendo; se qui c'è e sul profilo no, lo salvo
    const nm = (patch.displayName ?? cur.displayName ?? '').trim();
    if (!nm && pr.display_name) patch.displayName = pr.display_name;
    else if (nm && !pr.display_name) saveDisplayName(userId, nm).catch(() => {});
    if (Object.keys(patch).length) {
      if (patch.syncAt) lastPushed.current = JSON.stringify(pickSync({ ...cur, ...patch }));   // arrivate dal server: non le rimando indietro
      setPrefsState((p) => ({ ...p, ...patch }));
    }
  }, [userId]);
  useEffect(() => {
    if (!hydrated || !userId || !IS_CLOUD) return;
    reloadProfile();
    const t = setInterval(reloadProfile, 60_000);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') reloadProfile(); });
    return () => { clearInterval(t); sub.remove(); };
  }, [hydrated, userId, reloadProfile]);
  // preferenze cambiate qui: le salvo online (dopo un attimo)
  const syncSig = JSON.stringify(pickSync(prefs));
  useEffect(() => {
    if (!hydrated || !userId || !IS_CLOUD) return;
    if (lastPushed.current === null) { lastPushed.current = syncSig; return; }   // all'avvio non spingo: prima rileggo
    if (lastPushed.current === syncSig) return;
    const t = setTimeout(() => {
      const at = Date.now();
      saveAppPrefs(at, pickSync(prefsRef.current)).then(() => { lastPushed.current = syncSig; setPrefsState((p) => ({ ...p, syncAt: at })); }).catch(() => {});
    }, 2500);
    return () => clearTimeout(t);
  }, [syncSig, hydrated, userId]);

  // lista di casa: synced = quello che il server ha (per mandare solo le differenze)
  const synced = useRef<ListItem[] | null>(null);
  const syncing = useRef(false);
  const pull = useCallback(async (fid: string) => {
    const rows = await homeList(fid);
    const me = userId;
    const local = itemsRef.current;
    if (synced.current === null) {
      const key = `mc_home_synced_${fid}`;
      const prevRaw = await AsyncStorage.getItem(key).catch(() => null);
      const server = rows.map(({ added_by: _a, ...r }) => r as ListItem);
      let merged: ListItem[];
      if (prevRaw) {
        // #91: riapro l'app: mando solo quello che ho cambiato io da allora (quello che gli altri hanno tolto resta tolto)
        const prev = JSON.parse(prevRaw) as ListItem[];
        const { upsert, remove } = diffLists(local, prev);
        if (upsert.length) await homeUpsert(fid, upsert);
        if (remove.length) await homeDelete(fid, remove);
        const byId = new Map(server.map((r) => [r.product_id, r]));
        for (const u of upsert) byId.set(u.product_id, u);
        for (const r of remove) byId.delete(r);
        merged = [...byId.values()];
      } else {
        // prima volta in questa famiglia: la mia lista entra nella lista di casa (non si perde niente, vale la quantità più grande)
        const byId = new Map(server.map((r) => [r.product_id, r]));
        const up: ListItem[] = [];
        for (const i of local) {
          const r = byId.get(i.product_id);
          if (!r || i.quantity > r.quantity) { byId.set(i.product_id, r ? { ...r, quantity: i.quantity } : i); up.push(r ? { ...r, quantity: i.quantity } : i); }
        }
        if (up.length) await homeUpsert(fid, up);
        merged = [...byId.values()];
      }
      synced.current = merged;
      AsyncStorage.setItem(key, JSON.stringify(merged)).catch(() => {});
      setItemsState(merged);
    } else {
      const { upsert, remove } = diffLists(local, synced.current);
      if (upsert.length || remove.length) return;   // ho modifiche da mandare: prima quelle
      const list = rows.map(({ added_by: _a, ...r }) => r as ListItem);
      synced.current = list;
      AsyncStorage.setItem(`mc_home_synced_${fid}`, JSON.stringify(list)).catch(() => {});
      setItemsState(list);
    }
    // chi ha aggiunto cosa (i nomi dei familiari)
    const others = rows.filter((r) => r.added_by && r.added_by !== me);
    if (others.length) {
      const { data } = await sb().rpc('family_members');
      const names = new Map(((data as any[]) ?? []).map((m) => [m.user_id, m.display_name || 'un familiare']));
      setAddedBy(Object.fromEntries(others.map((r) => [r.product_id, names.get(r.added_by!) ?? 'un familiare'])));
    } else setAddedBy({});
  }, [userId]);
  const push = useCallback(async (fid: string) => {
    if (syncing.current || synced.current === null) return;
    const { upsert, remove } = diffLists(itemsRef.current, synced.current);
    if (!upsert.length && !remove.length) return;
    syncing.current = true;
    const snap = itemsRef.current;
    try {
      await homeUpsert(fid, upsert);
      await homeDelete(fid, remove);
      synced.current = snap;
      AsyncStorage.setItem(`mc_home_synced_${fid}`, JSON.stringify(snap)).catch(() => {});
    } catch { /* senza rete: riprovo tra poco */ } finally { syncing.current = false; }
  }, []);
  useEffect(() => {
    synced.current = null;
    if (!familyId) { setAddedBy({}); return; }
    pull(familyId).catch(() => {});
    const stop = watchHome(familyId, () => { if (!syncing.current) pull(familyId).catch(() => {}); });
    const t = setInterval(() => { push(familyId).then(() => pull(familyId)).catch(() => {}); }, 20_000);
    return () => { stop(); clearInterval(t); };
  }, [familyId, pull, push]);
  useEffect(() => {
    if (!familyId || synced.current === null) return;
    const t = setTimeout(() => { push(familyId).catch(() => {}); }, 400);
    return () => clearTimeout(t);
  }, [items, familyId, push]);

  const value: StoreValue = {
    hydrated,
    userId,
    catalog,
    catalogError,
    reloadCatalog,
    productById,
    items,
    addItem,
    addCustom,
    removeItem,
    toggleItem,
    updateQty,
    setItemCategory,
    setItems: setItemsState,
    clearItems: () => setItemsState([]),
    prefs,
    setPrefs,
    lastResult,
    setLastResult,
    lastResultStale: !!lastResult && resultSig !== shoppingSig(items, groupMine),
    familyId,
    addedBy,
    reloadProfile,
    groupMine,
    reloadGroupMine,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore deve stare dentro <StoreProvider>');
  return ctx;
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}
