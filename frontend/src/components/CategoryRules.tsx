/**
 * Profilo › Le mie regole (spesa in due negozi): "la carne sempre da Eurospin".
 * Valgono solo quando l'app divide la spesa: la categoria va in quel negozio, il resto dove conviene,
 * e nei Risultati si vede quanto costano.
 */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useStore } from '../store';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { Card, Icon, SectionTitle, StoreDot } from './ui';

export function CategoryRules() {
  const s = useStyles();
  const { colors } = useTheme();
  const { catalog, prefs, setPrefs } = useStore();
  const [pickCat, setPickCat] = useState<string | null>(null);
  if (!catalog) return null;
  const rules = prefs.categoryRules ?? {};
  const catById = new Map(catalog.categories.map((c) => [c.id, c]));
  const storeById = new Map(catalog.stores.map((st) => [st.id, st]));
  const set = (cat: string, store: string | null) => {
    const next = { ...rules };
    if (store) next[cat] = store; else delete next[cat];
    setPrefs({ categoryRules: next });
    setPickCat(null);
  };

  return (
    <>
      <SectionTitle>Le mie regole</SectionTitle>
      <Card style={{ gap: spacing.sm }}>
        <Text style={s.help}>
          Quando conviene dividere la spesa in due negozi, alcune cose le vuoi sempre da un posto preciso? Es. la carne da Eurospin.
          Il resto va dove costa meno, e nei Risultati vedi quanto ti costa la regola.
        </Text>
        {Object.entries(rules).map(([cat, store]) => (
          <View key={cat} style={s.rule}>
            <Text style={s.ruleText}>{catById.get(cat)?.emoji ?? '🛒'} {catById.get(cat)?.name ?? cat}</Text>
            <Icon name="arrow-forward" size={16} color={colors.textSecondary} />
            <StoreDot storeId={store} size={12} />
            <Text style={[s.ruleText, { flex: 1 }]}>{storeById.get(store)?.name ?? store}</Text>
            <Pressable onPress={() => set(cat, null)} hitSlop={8} accessibilityLabel="Togli la regola">
              <Icon name="close-circle" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
        ))}
        {!pickCat ? (
          <>
            <Text style={s.label}>Aggiungi una regola: scegli la categoria</Text>
            <View style={s.chips}>
              {catalog.categories.filter((c) => !rules[c.id]).map((c) => (
                <Pressable key={c.id} onPress={() => setPickCat(c.id)} style={s.chip}>
                  <Text style={s.chipText}>{c.emoji} {c.name}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <>
            <Text style={s.label}>{catById.get(pickCat)?.emoji} {catById.get(pickCat)?.name} sempre da…</Text>
            <View style={s.chips}>
              {catalog.stores.map((st) => (
                <Pressable key={st.id} onPress={() => set(pickCat, st.id)} style={[s.chip, s.chipRow]}>
                  <StoreDot storeId={st.id} size={10} />
                  <Text style={s.chipText}>{st.name}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={() => setPickCat(null)} style={{ alignSelf: 'flex-start' }}><Text style={s.cancel}>Annulla</Text></Pressable>
          </>
        )}
      </Card>
    </>
  );
}

const useStyles = makeStyles((c) => ({
  help: { color: c.textSecondary, fontSize: 13, lineHeight: 18 },
  label: { color: c.text, fontSize: 14, fontWeight: '600', marginTop: spacing.xs },
  rule: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: c.primarySoft },
  ruleText: { color: c.text, fontSize: 14, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipText: { color: c.text, fontSize: 13 },
  cancel: { color: c.primary, fontWeight: '700', fontSize: 14, paddingVertical: 4 },
}));
