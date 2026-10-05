import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { api, Category, ClassifyResult, Product } from '../api';
import { formatQty } from '../format';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { Icon } from './ui';

export const norm = (t: string) =>
  t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').trim();

/**
 * Cerca nel catalogo mentre scrivi. Se il prodotto non c'è, lo aggiungi come nuovo:
 * la categoria la propone il backend (parole chiave + somiglianza, niente AI), come Bring.
 */
export function ProductSearch({ products, categories, onAddProduct, onAddCustom, inList }: {
  products: Product[];
  categories: Category[];
  onAddProduct: (id: string) => void;
  onAddCustom: (name: string, categoryId: string) => void;
  inList: (id: string) => boolean;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const [q, setQ] = useState('');
  const [cls, setCls] = useState<ClassifyResult | null>(null);
  const [catPick, setCatPick] = useState<string | null>(null); // categoria scelta a mano per il prodotto nuovo
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

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
  const exactInCatalog = matches.some((m) => norm(m.name) === norm(q));
  const newCat = catPick ?? cls?.category_id ?? 'altro';

  const addNew = () => {
    onAddCustom(q.trim(), newCat);
    setQ('');
  };
  const add = (id: string) => {
    onAddProduct(id);
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
          onSubmitEditing={() => (matches[0] && norm(matches[0].name).startsWith(norm(q)) ? add(matches[0].id) : q.trim().length >= 2 && addNew())}
          accessibilityLabel="Cerca un prodotto"
        />
        {q.length > 0 && (
          <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityLabel="Cancella">
            <Icon name="close-circle" size={18} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>

      {q.trim().length >= 2 && (
        <View style={s.results}>
          {[...matches, ...extra.map((x) => products.find((p) => p.id === x.product_id)!).filter(Boolean)].map((p) => (
            <Pressable key={p.id} onPress={() => add(p.id)} style={s.row}>
              <Text style={s.emoji}>{catById.get(p.category_id)?.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{p.name}</Text>
                <Text style={s.meta}>{catById.get(p.category_id)?.name} · {formatQty(p.default_qty, p.unit)}</Text>
              </View>
              <Icon name={inList(p.id) ? 'checkmark-circle' : 'add-circle'} size={24} color={colors.primary} />
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
}));
