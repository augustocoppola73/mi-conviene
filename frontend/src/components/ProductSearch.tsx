import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { api, Category, ClassifyResult, CommunityProduct, ListItem, Product } from '../api';
import { formatQty, qtyStep } from '../format';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { QtyStepper } from './QtyStepper';
import { Icon } from './ui';

const customKey = (name: string) =>
  'custom:' + name.trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** #27: i prodotti scritti a mano da tutti, cercabili come il catalogo */
let communityMem: CommunityProduct[] = [];
function useCommunity(): CommunityProduct[] {
  const [list, setList] = useState(communityMem);
  useEffect(() => { api.communityProducts().then((l) => { communityMem = l; setList(l); }).catch(() => {}); }, []);
  return list;
}

export const norm = (t: string) =>
  t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').trim();

/**
 * Cerca nel catalogo mentre scrivi. Se il prodotto non c'è, lo aggiungi come nuovo:
 * la categoria la propone il backend (parole chiave + somiglianza, niente AI), come Bring.
 * Tocco su un risultato: lo aggiunge, oppure lo toglie se è già in lista. Appena aggiunto compare una barra
 * con la quantità da regolare e "Annulla".
 */
export function ProductSearch({ products, categories, onToggleProduct, onAddCustom, itemFor, onUpdateQty }: {
  products: Product[];
  categories: Category[];
  onToggleProduct: (id: string) => void;
  onAddCustom: (name: string, categoryId: string) => void;
  itemFor: (id: string) => ListItem | undefined;
  onUpdateQty?: (id: string, q: number) => void; // senza: niente barra quantità (spesa in negozio)
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const [q, setQ] = useState('');
  const community = useCommunity();
  const [cls, setCls] = useState<ClassifyResult | null>(null);
  const [catPick, setCatPick] = useState<string | null>(null); // categoria scelta a mano per il prodotto nuovo
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  // l'ultimo prodotto aggiunto: barra con quantità e Annulla
  const [last, setLast] = useState<{ id: string; name: string; unit: string; step: number } | null>(null);
  const lastItem = last ? itemFor(last.id) : undefined;
  useEffect(() => {
    if (!last) return;
    const t = setTimeout(() => setLast(null), 12000);
    return () => clearTimeout(t);
  }, [last, lastItem?.quantity]);

  const matches = useMemo(() => {
    const nq = norm(q);
    if (nq.length < 2) return [];
    const words = nq.split(' ').filter(Boolean);
    return products
      .map((p) => {
        const n = norm(p.name);
        const all = words.every((w) => n.includes(w));
        const starts = n.startsWith(nq) || n.split(' ').some((w) => w.startsWith(words[0]));
        return { p, rank: all ? (starts ? 0 : 1) : 9 };
      })
      .filter((x) => x.rank < 9)
      .sort((a, b) => a.rank - b.rank || a.p.name.localeCompare(b.p.name))
      .slice(0, 8)
      .map((x) => x.p);
  }, [q, products]);

  // #27: prodotti scritti a mano da altri (non doppioni del catalogo)
  const communityMatches = useMemo(() => {
    const nq = norm(q);
    if (nq.length < 2) return [];
    const words = nq.split(' ').filter(Boolean);
    const inCatalog = new Set(products.map((p) => norm(p.name)));
    return community
      .filter((c) => { const n = norm(c.name); return words.every((w) => n.includes(w)) && !inCatalog.has(n); })
      .slice(0, 4);
  }, [q, community, products]);

  // classificazione del testo scritto (con un attimo di attesa mentre scrivi)
  useEffect(() => {
    setCatPick(null);
    const text = q.trim();
    if (text.length < 2) { setCls(null); return; }
    const t = setTimeout(() => api.classify(text).then(setCls).catch(() => setCls(null)), 350);
    return () => clearTimeout(t);
  }, [q]);

  // suggerimenti del backend che non sono già tra i risultati della ricerca
  const extra = (cls?.similar ?? []).filter((x) => !matches.some((m) => m.id === x.product_id)).slice(0, 2);
  const exactInCatalog = matches.some((m) => norm(m.name) === norm(q)) || communityMatches.some((c) => norm(c.name) === norm(q));
  const newCat = catPick ?? cls?.category_id ?? 'altro';

  const addNew = () => {
    const name = q.trim();
    onAddCustom(name, newCat);
    const id = customKey(name);
    api.rememberCustom(id, name, newCat, 'pz').catch(() => {});   // #27: entra nel catalogo di tutti
    setLast({ id, name, unit: 'pz', step: 1 });
    setQ('');
  };
  const tapCommunity = (c: CommunityProduct) => {
    if (itemFor(c.key)) { if (onUpdateQty) { onUpdateQty(c.key, 0); return; } return; }
    onAddCustom(c.name, c.category_id);
    api.rememberCustom(c.key, c.name, c.category_id, c.unit).catch(() => {});
    setLast({ id: c.key, name: c.name, unit: c.unit, step: 1 });
    setQ('');
  };
  const tap = (p: Product) => {
    const was = !!itemFor(p.id);
    onToggleProduct(p.id);
    if (was) { if (last?.id === p.id) setLast(null); if (onUpdateQty) return; } // toccato di nuovo: tolto, la ricerca resta aperta
    setLast({ id: p.id, name: p.name, unit: p.unit, step: qtyStep(p.default_qty, p.unit) });
    setQ('');
  };

  return (
    <View>
      <View style={s.box}>
        <Icon name="search" size={18} color={colors.textSecondary} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Cerca o scrivi un prodotto…"
          placeholderTextColor={colors.textSecondary}
          style={s.input}
          returnKeyType="done"
          onSubmitEditing={() => (matches[0] && norm(matches[0].name).startsWith(norm(q)) ? (!itemFor(matches[0].id) && tap(matches[0])) : q.trim().length >= 2 && addNew())}
          accessibilityLabel="Cerca un prodotto"
        />
        {q.length > 0 && (
          <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityLabel="Cancella">
            <Icon name="close-circle" size={18} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>

      {last && lastItem && onUpdateQty && q.trim().length < 2 && (
        <View style={s.lastBar}>
          <Icon name="checkmark-circle" size={20} color={colors.primary} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.name} numberOfLines={1}>{last.name}</Text>
            <Text style={s.meta}>Aggiunto alla lista</Text>
          </View>
          <QtyStepper compact quantity={lastItem.quantity} unit={last.unit} step={last.step} onChange={(n) => onUpdateQty(last.id, n)} />
          <Pressable onPress={() => { onUpdateQty(last.id, 0); setLast(null); }} hitSlop={8} accessibilityLabel="Annulla">
            <Text style={s.undo}>Annulla</Text>
          </Pressable>
        </View>
      )}

      {q.trim().length >= 2 && (
        <View style={s.results}>
          {[...matches, ...extra.map((x) => products.find((p) => p.id === x.product_id)!).filter(Boolean)].map((p) => (
            <Pressable key={p.id} onPress={() => tap(p)} style={s.row}
              accessibilityHint={itemFor(p.id) ? (onUpdateQty ? 'Già in lista: tocca per toglierlo' : 'Già nella spesa') : 'Tocca per aggiungerlo'}>
              <Text style={s.emoji}>{catById.get(p.category_id)?.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{p.name}</Text>
                <Text style={s.meta}>
                  {catById.get(p.category_id)?.name} · {!itemFor(p.id) ? formatQty(p.default_qty, p.unit) : onUpdateQty ? `in lista: ${formatQty(itemFor(p.id)!.quantity, p.unit)} · tocca per togliere` : 'già nella spesa'}
                </Text>
              </View>
              <Icon name={itemFor(p.id) ? 'checkmark-circle' : 'add-circle-outline'} size={24} color={colors.primary} />
            </Pressable>
          ))}

          {communityMatches.map((c) => (
            <Pressable key={c.key} onPress={() => tapCommunity(c)} style={s.row}
              accessibilityHint={itemFor(c.key) ? 'Già in lista' : 'Tocca per aggiungerlo'}>
              <Text style={s.emoji}>{catById.get(c.category_id)?.emoji ?? '✍️'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{c.name} <Text style={s.meta}>✍️</Text></Text>
                <Text style={s.meta}>
                  {catById.get(c.category_id)?.name ?? 'Altro'} · aggiunto da {c.uses > 1 ? `${c.uses} persone` : 'un utente'}
                  {itemFor(c.key) ? (onUpdateQty ? ' · in lista: tocca per togliere' : ' · già nella spesa') : ''}
                </Text>
              </View>
              <Icon name={itemFor(c.key) ? 'checkmark-circle' : 'add-circle-outline'} size={24} color={colors.primary} />
            </Pressable>
          ))}

          {!exactInCatalog && (
            <View style={s.newBox}>
              <Pressable onPress={addNew} style={s.row}>
                <Text style={s.emoji}>{catById.get(newCat)?.emoji ?? '🛒'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>Aggiungi «{q.trim()}»</Text>
                  <Text style={s.meta}>
                    Prodotto nuovo · {catById.get(newCat)?.name ?? 'Altro'}
                    {!catPick && cls ? ' (riconosciuta)' : ''} · senza prezzo
                  </Text>
                </View>
                <Icon name="add-circle-outline" size={24} color={colors.primary} />
              </Pressable>
              <Text style={s.meta}>Categoria sbagliata? Toccane un'altra:</Text>
              <View style={s.cats}>
                {categories.map((c) => (
                  <Pressable key={c.id} onPress={() => setCatPick(c.id)} style={[s.cat, newCat === c.id && s.catOn]}>
                    <Text style={[s.catText, newCat === c.id && s.catTextOn]}>{c.emoji} {c.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  box: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg,
    borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface,
  },
  input: { flex: 1, minWidth: 0, color: c.text, fontSize: 16, paddingVertical: 12 },
  results: { marginTop: spacing.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 10 },
  emoji: { fontSize: 20, width: 26, textAlign: 'center' },
  name: { color: c.text, fontSize: 15, fontWeight: '600' },
  meta: { color: c.textSecondary, fontSize: 12 },
  newBox: { borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.surfaceMuted, paddingBottom: spacing.md, paddingHorizontal: spacing.xs, gap: 6 },
  cats: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: spacing.sm },
  cat: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  catOn: { backgroundColor: c.primary, borderColor: c.primary },
  catText: { color: c.text, fontSize: 12 },
  catTextOn: { color: c.primaryText },
  lastBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.lg, backgroundColor: c.primarySoft,
  },
  undo: { color: c.primary, fontWeight: '700', fontSize: 14 },
}));
