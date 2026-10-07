import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api, Bootstrap, FuelType, ListItem, MenuEntry, OptimizeResult, Product, Transport } from './api';
import type { GeoPoint } from './location';
import { getUserId } from './user';

// Chiavi con prefisso storico "margine_": rinominarle cancellerebbe i dati salvati.
const LIST_KEY = 'margine_list';
const PREFS_KEY = 'margine_prefs';

export interface Prefs {
  transport: Transport;
  habitualStoreId: string | null;
  /** il punto vendita preciso dell'abituale (non tutta la catena): vale solo quando sei lì vicino */
  habitualBranch: { name: string; address: string | null; lat: number; lon: number } | null;
  budget: number | null;
  minSavingsThreshold: number;
  displayName: string;
  fuelType: FuelType;
  location: GeoPoint | null;
  refuel: boolean;
  refuelLiters: number | null;
  /** menu in preparazione (ricette scelte, con le persone) */
  menu: MenuEntry[];
}

const DEFAULT_PREFS: Prefs = {
  transport: 'car',
  habitualStoreId: null,
  habitualBranch: null,
  budget: null, // nessun limite finché non lo scegli (o accetti quello suggerito)
  minSavingsThreshold: 3,
  displayName: '',
  fuelType: 'benzina',
  location: null,
  refuel: false,
  refuelLiters: null,
  menu: [],
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
  updateQty: (productId: string, quantity: number) => void;
  setItems: (items: ListItem[]) => void;
  clearItems: () => void;
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;
  lastResult: OptimizeResult | null;
  setLastResult: (r: OptimizeResult | null) => void;
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
        if (p) setPrefsState({ ...DEFAULT_PREFS, ...JSON.parse(p) });
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
    const id = 'custom:' + clean.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    setItemsState((prev) =>
      prev.some((i) => i.product_id === id)
        ? prev.map((i) => (i.product_id === id ? { ...i, quantity: round(i.quantity + quantity) } : i))
        : [...prev, { product_id: id, quantity, name: clean, category_id: categoryId, unit }],
    );
  }, []);

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

  const setPrefs = useCallback((patch: Partial<Prefs>) => setPrefsState((p) => ({ ...p, ...patch })), []);

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
    updateQty,
    setItems: setItemsState,
    clearItems: () => setItemsState([]),
    prefs,
    setPrefs,
    lastResult,
    setLastResult,
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
