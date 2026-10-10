import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api, Bootstrap, FavoriteStore, FuelType, ListItem, MenuEntry, OptimizeResult, Product, Transport } from './api';
import type { GeoPoint } from './location';
import { getUserId } from './user';
import { IS_CLOUD } from './cloud/client';
import { MyGroupItem, myGroupItems } from './cloud/groups';

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
  /** le mie regole per la spesa in due negozi: categoria → catena */
  categoryRules: Record<string, string>;
  /** #21: la lista mostrata nella scheda Lista: null = la mia, altrimenti l'id del gruppo */
  activeList: string | null;
}

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
  /** #21: i prodotti che prendo io nei gruppi (entrano nella mia spesa) */
  groupMine: MyGroupItem[];
  reloadGroupMine: () => Promise<MyGroupItem[]>;
}

/** id di un prodotto scritto a mano: "custom:coca-cola" */
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
  const [lastResult, setLastResult] = useState<OptimizeResult | null>(null);

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
    if (hydrated) AsyncStorage.setItem(LIST_KEY, JSON.stringify(items)).catch(() => {});
  }, [items, hydrated]);

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
