import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, MenuPlan, PlanRow, ProposedRecipe, Recipe, RecipeSummary } from '@/api';
import { IS_CLOUD } from '@/cloud/client';
import { Card, Icon, PrimaryButton } from '@/components/ui';
import { euro, formatQty } from '@/format';
import { useStore } from '@/store';
import { makeStyles, radius, spacing, useTheme } from '@/theme';

type View_ =
  | { kind: 'list' }
  | { kind: 'detail'; recipe: Recipe }
  | { kind: 'edit'; recipe: Recipe }
  | { kind: 'menu' };

const KIND_LABEL: Record<string, string> = { g: 'g', ml: 'ml', spicchio: 'spicchi', fetta: 'fette', foglia: 'foglie', pz: '' };
const amountText = (r: PlanRow) => {
  if (r.measure?.count != null) {  // "2 cucchiai", "1 bicchiere": come scritto nella ricetta
    const c = r.measure.count;
    const n = (Math.round(c * 4) / 4).toLocaleString('it-IT');
    const g = r.kind === 'g' && r.amount ? ` (~${Math.round(r.amount)} g)` : '';
    return `${n} ${c > 1 ? r.measure.many : r.measure.one}${g}`;
  }
  if (r.amount == null) return 'q.b.';
  const n = r.amount >= 10 ? Math.round(r.amount) : Math.round(r.amount * 10) / 10;
  return `${n.toLocaleString('it-IT')}${r.kind && KIND_LABEL[r.kind] ? ' ' + KIND_LABEL[r.kind] : ''}`;
};

export default function RicetteScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const { userId, addItem, addCustom, catalog, prefs, setPrefs } = useStore();
  const [view, setView] = useState<View_>({ kind: 'list' });
  const params = useLocalSearchParams<{ open?: string }>();
  const menu = prefs.menu ?? [];

  // aperta da un suggerimento ("puoi già cucinare…"): si va dritti alla ricetta
  useEffect(() => {
    if (!params.open) return;
    api.recipe(String(params.open), userId).then((r) => setView({ kind: 'detail', recipe: r })).catch(() => {});
  }, [params.open, userId]);

  const addRows = (rows: PlanRow[]) => {
    for (const r of rows) {
      if (r.product_id) addItem(r.product_id, r.quantity);
      else addCustom(r.name, r.category_id ?? 'altro', 1, 'pz');
    }
    return rows.length;
  };
  const [people, setPeople] = useState(2);
  const [notice, setNotice] = useState<string | null>(null);

  // persone di default: i membri della famiglia (almeno 2)
  useEffect(() => {
    if (!userId) return;
    api.familyByUser(userId)
      .then((f) => { if ('members' in f && f.members?.length) setPeople(Math.max(2, f.members.length)); })
      .catch(() => {});
  }, [userId]);

  const back = () => (view.kind === 'list' ? (router.canGoBack() ? router.back() : router.replace('/')) : setView({ kind: 'list' }));

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Pressable onPress={back} hitSlop={10} accessibilityLabel="Indietro" style={s.backBtn}>
          <Icon name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={s.headerTitle}>
          {view.kind === 'list' ? 'Ricette' : view.kind === 'menu' ? 'Menu' : view.kind === 'edit' ? (view.recipe.id ? 'Modifica ricetta' : 'Nuova ricetta') : view.recipe.name}
        </Text>
      </View>
      {notice && (
        <Pressable onPress={() => setNotice(null)} style={s.notice}>
          <Text style={s.noticeText}>✓ {notice}</Text>
          <Pressable onPress={() => router.replace('/')} hitSlop={6}><Text style={s.noticeLink}>Vai alla lista</Text></Pressable>
        </Pressable>
      )}
      {view.kind === 'list' && menu.length > 0 && (
        <Pressable onPress={() => setView({ kind: 'menu' })} style={s.menuBar}>
          <Text style={s.menuBarText}>🗓️ Menu: {menu.length} {menu.length === 1 ? 'piatto' : 'piatti'}</Text>
          <Text style={s.noticeLink}>Vedi e fai la lista ›</Text>
        </Pressable>
      )}
      {view.kind === 'list' && (
        <RecipeList
          onMenu={() => setView({ kind: 'menu' })}
          userId={userId}
          onOpen={(r) => setView({ kind: 'detail', recipe: r })}
          onNew={(r) => setView({ kind: 'edit', recipe: r })}
        />
      )}
      {view.kind === 'detail' && (
        <RecipeDetail
          recipe={view.recipe}
          userId={userId}
          people={people}
          setPeople={setPeople}
          onEdit={() => setView({ kind: 'edit', recipe: view.recipe })}
          onDeleted={() => { setNotice('Ricetta eliminata.'); setView({ kind: 'list' }); }}
          onSaved={(r) => { setNotice('Salvata tra le tue ricette.'); setView({ kind: 'detail', recipe: r }); }}
          inMenu={menu.some((m) => m.recipe_id === view.recipe.id)}
          onToggleMenu={() => {
            const id = view.recipe.id;
            if (!id) return;
            const has = menu.some((m) => m.recipe_id === id);
            setPrefs({ menu: has ? menu.filter((m) => m.recipe_id !== id) : [...menu, { recipe_id: id, name: view.recipe.name, servings: people }] });
            setNotice(has ? `«${view.recipe.name}» tolta dal menu.` : `«${view.recipe.name}» aggiunta al menu (${menu.length + 1}).`);
          }}
          onAdd={(rows) => {
            const n = addRows(rows);
            setNotice(`Aggiunti ${n} ingredienti di «${view.recipe.name}» alla lista. Puoi aggiungere un'altra ricetta.`);
            setView({ kind: 'list' });
          }}
          hasCatalog={!!catalog}
        />
      )}
      {view.kind === 'menu' && (
        <MenuView
          userId={userId}
          people={people}
          onOpen={async (id) => { try { setView({ kind: 'detail', recipe: await api.recipe(id, userId) }); } catch { /* */ } }}
          onAdded={(n) => { setNotice(`Aggiunti ${n} ingredienti del menu alla lista.`); setView({ kind: 'list' }); }}
          addRows={addRows}
        />
      )}
      {view.kind === 'edit' && userId && (
        <RecipeEditor
          recipe={view.recipe}
          userId={userId}
          onCancel={() => setView(view.recipe.id ? { kind: 'detail', recipe: view.recipe } : { kind: 'list' })}
          onSaved={(r) => { setNotice('Ricetta salvata.'); setView({ kind: 'detail', recipe: r }); }}
        />
      )}
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ elenco + ricerca + link */
function RecipeList({ userId, onOpen, onNew, onMenu }: { userId: string | null; onOpen: (r: Recipe) => void; onNew: (r: Recipe) => void; onMenu: () => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'rilevanza' | 'prezzo'>('rilevanza');
  const [list, setList] = useState<RecipeSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [link, setLink] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setList(null);
      api.recipes(q.trim(), userId, sort).then((r) => { setList(r.recipes); setTotal(r.total_collection); }).catch((e) => setError(e.message));
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, userId, sort]);

  const open = async (id: string) => {
    try { onOpen(await api.recipe(id, userId)); } catch (e) { setError((e as Error).message); }
  };
  const importLink = async () => {
    setError(null);
    setImporting(true);
    try { onOpen(await api.recipeImport(link.trim())); setLink(''); } catch (e) { setError((e as Error).message); } finally { setImporting(false); }
  };

  const mine = (list ?? []).filter((r) => r.mine);
  const others = (list ?? []).filter((r) => !r.mine);

  return (
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      {!IS_CLOUD && <Card style={{ gap: spacing.sm }}>
        <Text style={s.cardTitle}>🔗 Da un sito di ricette</Text>
        <Text style={s.muted}>Incolla il link di una ricetta (GialloZafferano, Cookist, un blog…): leggo titolo, porzioni e ingredienti. Il procedimento lo trovi sul sito.</Text>
        <View style={s.inputRow}>
          <TextInput
            value={link} onChangeText={setLink} placeholder="https://…" placeholderTextColor={colors.textSecondary}
            autoCapitalize="none" autoCorrect={false} keyboardType="url" style={s.input}
            onSubmitEditing={() => link.trim().length > 8 && importLink()}
          />
        </View>
        <PrimaryButton label="Leggi la ricetta" icon="download-outline" loading={importing} disabled={link.trim().length < 9} onPress={importLink} />
      </Card>}

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: IS_CLOUD ? 0 : spacing.md }}>
        <PrimaryButton
          label="Scrivi una ricetta" icon="create-outline" variant="secondary"
          onPress={() => onNew({ name: '', servings: 4, ingredients: [] })} style={{ flex: 1 }}
        />
        <PrimaryButton label="Menu" icon="calendar-outline" variant="secondary" onPress={onMenu} style={{ flex: 1 }} />
      </View>

      <View style={[s.inputRow, { marginTop: spacing.lg }]}>
        <Icon name="search" size={18} color={colors.textSecondary} />
        <TextInput value={q} onChangeText={setQ} placeholder="Cerca un piatto o un ingrediente…" placeholderTextColor={colors.textSecondary} style={s.input} />
      </View>
      <View style={s.sortRow}>
        {([['rilevanza', 'Tutte'], ['prezzo', '€ Più economiche']] as const).map(([k, label]) => (
          <Pressable key={k} onPress={() => setSort(k)} style={[s.sortChip, sort === k && s.sortOn]}>
            <Text style={[s.sortText, sort === k && s.sortTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {sort === 'prezzo' && <Text style={s.muted}>Piatti principali, dal costo a persona più basso, al supermercato più conveniente. Solo ricette con tutti gli ingredienti a prezzo.</Text>}
      {error && <Text style={[s.muted, { color: colors.danger, marginTop: spacing.sm }]}>{error}</Text>}
      {!list ? <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} /> : (
        <>
          {mine.length > 0 && <Text style={s.section}>Le tue ricette</Text>}
          {mine.map((r) => <RecipeRow key={r.id} r={r} onPress={() => open(r.id)} />)}
          <Text style={s.section}>Raccolta libera{q ? '' : ` · ${total} ricette`}</Text>
          {others.length === 0 && <Text style={s.muted}>Nessuna ricetta trovata.</Text>}
          {others.map((r) => <RecipeRow key={r.id} r={r} onPress={() => open(r.id)} />)}
          <Text style={[s.muted, { marginTop: spacing.md, fontSize: 11 }]}>
            Raccolta libera: ricette di Wikibooks «Libro di cucina», licenza CC BY-SA 4.0, a cura dei contributori di Wikibooks.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

function RecipeRow({ r, onPress }: { r: RecipeSummary; onPress: () => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} style={s.row}>
      <Text style={s.rowEmoji}>{r.mine ? (r.url ? '🔗' : '📝') : '📖'}</Text>
      <View style={{ flex: 1 }}>
        <Text style={s.rowName}>{r.name}</Text>
        <Text style={s.muted}>
          {r.n_ingredients} ingredienti{r.servings ? ` · per ${r.servings}` : ''}
          {r.mine ? (r.url ? ` · ${r.source}` : ' · tua') : r.categories?.length ? ` · ${r.categories[0]}` : ''}
        </Text>
        {r.cheapest && (
          <Text style={s.price}>
            {r.cheapest.complete ? '' : 'da '}~{euro(r.cheapest.portion)} a persona · {r.cheapest.store_name}
          </Text>
        )}
      </View>
      <Icon name="chevron-forward" size={18} color={colors.textSecondary} />
    </Pressable>
  );
}

/* ------------------------------------------------------------------ dettaglio + persone + aggiunta */
function RecipeDetail({ recipe, userId, people, setPeople, onAdd, onEdit, onDeleted, onSaved, hasCatalog, inMenu, onToggleMenu }: {
  recipe: Recipe; userId: string | null; people: number; setPeople: (n: number) => void;
  onAdd: (rows: PlanRow[]) => void; onEdit: () => void; onDeleted: () => void; onSaved: (r: Recipe) => void; hasCatalog: boolean;
  inMenu: boolean; onToggleMenu: () => void;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const [rows, setRows] = useState<PlanRow[] | null>(null);
  const [assumed, setAssumed] = useState(false);
  const [costs, setCosts] = useState<{ best: { store_name: string; total: number } | null; portion: number | null; complete: boolean }>({ best: null, portion: null, complete: true });
  const [off, setOff] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isWikibooks = recipe.id?.startsWith('wb:');
  const isMine = !!recipe.id && !isWikibooks;
  const unsavedImport = !recipe.id;

  const load = useCallback(async () => {
    setError(null);
    try {
      const p = recipe.id
        ? await api.recipePlan({ recipe_id: recipe.id, user_id: userId, servings: people })
        : await api.recipePlan({ ingredients: recipe.ingredients, recipe_servings: recipe.servings, servings: people });
      setRows(p.items);
      setAssumed(p.assumed_servings);
      setCosts({ best: p.costs[0] ?? null, portion: p.cheapest?.portion ?? null, complete: p.cheapest?.complete ?? true });
      setOff(new Set(p.items.map((r, i) => (r.pantry ? i : -1)).filter((i) => i >= 0)));
    } catch (e) { setError((e as Error).message); }
  }, [recipe, people, userId]);
  useEffect(() => { load(); }, [load]);

  const chosen = useMemo(() => (rows ?? []).filter((_, i) => !off.has(i)), [rows, off]);
  const toggle = (i: number) => setOff((o) => { const n = new Set(o); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  const save = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      onSaved(await api.recipeCreate({ user_id: userId, name: recipe.name, servings: recipe.servings, ingredients: recipe.ingredients, url: recipe.url, source: recipe.source }));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!userId || !recipe.id) return;
    const ok = Platform.OS === 'web' ? window.confirm(`Eliminare «${recipe.name}»?`) : true;
    if (!ok) return;
    try { await api.recipeDelete(recipe.id, userId); onDeleted(); } catch (e) { setError((e as Error).message); }
  };

  return (
    <ScrollView contentContainerStyle={s.content}>
      <Text style={s.muted}>
        {isWikibooks ? 'Dalla raccolta libera di Wikibooks' : recipe.url ? `Da ${recipe.source ?? 'un sito'}` : 'La tua ricetta'}
        {recipe.servings ? ` · dosi originali per ${recipe.servings}` : ''}
      </Text>
      {recipe.url && (
        <Pressable onPress={() => Linking.openURL(recipe.url!)} hitSlop={6}>
          <Text style={s.link}>Apri la ricetta con il procedimento ↗</Text>
        </Pressable>
      )}
      {recipe.notes ? <Text style={[s.text, { marginTop: spacing.sm }]}>{recipe.notes}</Text> : null}

      <View style={s.peopleRow}>
        <Text style={s.cardTitle}>Per quante persone?</Text>
        <View style={s.stepper}>
          <Pressable onPress={() => setPeople(Math.max(1, people - 1))} style={s.stepBtn} accessibilityLabel="Meno persone"><Icon name="remove" /></Pressable>
          <Text style={s.peopleN}>{people}</Text>
          <Pressable onPress={() => setPeople(Math.min(30, people + 1))} style={s.stepBtn} accessibilityLabel="Più persone"><Icon name="add" /></Pressable>
        </View>
      </View>
      {assumed && <Text style={s.muted}>La ricetta non dice per quante persone è: ho considerato 4.</Text>}
      {costs.best && (
        <View style={s.costBox}>
          <Text style={s.costMain}>
            Spesa per {people}: {euro(costs.best.total)} da {costs.best.store_name}
          </Text>
          <Text style={s.muted}>
            {costs.portion != null ? `Circa ${euro(costs.portion)} a persona per quello che usi` : ''}
            {!costs.complete ? ' · esclusi i prodotti senza prezzo' : ''} · ingredienti "di casa" esclusi · confezioni intere
          </Text>
        </View>
      )}

      <Text style={s.section}>Cosa comprare</Text>
      {!rows && !error && <ActivityIndicator color={colors.primary} />}
      {rows?.map((r, i) => {
        const on = !off.has(i);
        return (
          <Pressable key={i} onPress={() => toggle(i)} style={[s.ingRow, on && s.ingOn]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
            <Icon name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.primary : colors.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={s.rowName}>{r.product_name ?? r.name}</Text>
              <Text style={s.muted} numberOfLines={2}>
                ricetta: {r.from ? `${r.from} → ${amountText(r)} ${r.name}` : `${amountText(r)} ${r.name}`}
                {r.pantry ? ' · di solito in casa' : ''}
                {!r.product_id ? ' · prodotto nuovo, senza prezzo' : ''}
              </Text>
            </View>
            <Text style={s.buyQty}>{r.product_id ? `${r.approx ? '~' : ''}${formatQty(r.quantity, r.unit)}` : '1 pz'}</Text>
          </Pressable>
        );
      })}
      {error && <Text style={[s.muted, { color: colors.danger }]}>{error}</Text>}

      <PrimaryButton
        label={chosen.length ? `Aggiungi ${chosen.length} ingredienti alla lista` : 'Nessun ingrediente scelto'}
        icon="cart-outline" disabled={!chosen.length || !hasCatalog} onPress={() => onAdd(chosen)}
        style={{ marginTop: spacing.md }}
      />
      {!!recipe.id && (
        <PrimaryButton
          label={inMenu ? 'Nel menu ✓ (tocca per togliere)' : 'Aggiungi al menu della settimana'}
          icon="calendar-outline" variant="secondary" onPress={onToggleMenu} style={{ marginTop: spacing.sm }}
        />
      )}
      {unsavedImport && userId && <PrimaryButton label="Salva tra le mie ricette" icon="bookmark-outline" variant="secondary" loading={busy} onPress={save} style={{ marginTop: spacing.sm }} />}
      {isMine && (
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          <PrimaryButton label="Modifica" icon="create-outline" variant="secondary" onPress={onEdit} style={{ flex: 1 }} />
          <PrimaryButton label="Elimina" icon="trash-outline" variant="danger" onPress={remove} style={{ flex: 1 }} />
        </View>
      )}
      {isWikibooks && (
        <Text style={[s.muted, { fontSize: 11, marginTop: spacing.md }]}>
          Ingredienti da Wikibooks «Libro di cucina», licenza CC BY-SA 4.0. Le quantità da comprare sono calcolate dall'app.
        </Text>
      )}
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ menu della settimana */
function MenuView({ userId, people, onOpen, onAdded, addRows }: {
  userId: string | null; people: number; onOpen: (id: string) => void; onAdded: (n: number) => void; addRows: (rows: PlanRow[]) => number;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const { prefs, setPrefs, items } = useStore();
  const menu = prefs.menu ?? [];
  const [plan, setPlan] = useState<MenuPlan | null>(null);
  const [off, setOff] = useState<Set<number>>(new Set());
  const [count, setCount] = useState(5);
  const [budgetText, setBudgetText] = useState('');
  const [proposal, setProposal] = useState<{ recipes: ProposedRecipe[]; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = menu.map((m) => `${m.recipe_id}:${m.servings}`).join('|');

  useEffect(() => {
    if (!menu.length) { setPlan(null); return; }
    api.recipeMenu(userId, menu.map((m) => ({ recipe_id: m.recipe_id, servings: m.servings })))
      .then((p) => { setPlan(p); setOff(new Set(p.items.map((r, i) => (r.pantry ? i : -1)).filter((i) => i >= 0))); })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, userId]);

  const setServings = (id: string, n: number) => setPrefs({ menu: menu.map((m) => (m.recipe_id === id ? { ...m, servings: Math.max(1, Math.min(30, n)) } : m)) });
  const remove = (id: string) => setPrefs({ menu: menu.filter((m) => m.recipe_id !== id) });
  const propose = async (exclude: string[] = []) => {
    setBusy(true);
    setError(null);
    const b = parseFloat(budgetText.replace(',', '.'));
    try {
      const r = await api.recipePropose({ user_id: userId, count, servings: people, budget: Number.isFinite(b) && b > 0 ? b : null, exclude, items });
      setProposal(r);
      if (!r.recipes.length) setError('Nessun menu trovato con questi limiti: prova ad alzare il budget.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const chosen = (plan?.items ?? []).filter((_, i) => !off.has(i));

  return (
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Card style={{ gap: spacing.sm }}>
        <Text style={s.cardTitle}>✨ Proponimi un menu</Text>
        <Text style={s.muted}>Piatti principali vari ed economici, che usano quello che hai in lista o compri spesso. Per {people} persone.</Text>
        <View style={s.peopleRow}>
          <Text style={s.label}>Quanti piatti</Text>
          <View style={s.stepper}>
            <Pressable onPress={() => setCount(Math.max(1, count - 1))} style={s.stepBtn}><Icon name="remove" /></Pressable>
            <Text style={s.peopleN}>{count}</Text>
            <Pressable onPress={() => setCount(Math.min(14, count + 1))} style={s.stepBtn}><Icon name="add" /></Pressable>
          </View>
        </View>
        <View style={s.inputRow}>
          <Text style={s.cardTitle}>€</Text>
          <TextInput value={budgetText} onChangeText={(t) => setBudgetText(t.replace(/[^0-9.,]/g, ''))} keyboardType="decimal-pad"
            placeholder="Budget per tutto il menu (facoltativo)" placeholderTextColor={colors.textSecondary} style={s.input} />
        </View>
        <PrimaryButton label="Proponi" icon="sparkles-outline" loading={busy} onPress={() => propose()} />
        {proposal && proposal.recipes.length > 0 && (
          <View style={{ gap: 6 }}>
            {proposal.recipes.map((r) => (
              <Pressable key={r.id} onPress={() => onOpen(r.id)} style={s.row}>
                <Text style={s.rowEmoji}>{r.kind === 'primo' ? '🍝' : '🍲'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowName}>{r.name}</Text>
                  <Text style={s.price}>~{euro(r.portion)} a persona · {euro(r.cost)} per {people}</Text>
                </View>
              </Pressable>
            ))}
            <Text style={s.muted}>Totale stimato: {euro(proposal.total)} (per quello che usi; le confezioni intere costano un po' di più)</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <PrimaryButton label="Usa questo menu" icon="checkmark" style={{ flex: 1 }}
                onPress={() => { setPrefs({ menu: proposal.recipes.map((r) => ({ recipe_id: r.id, name: r.name, servings: people })) }); setProposal(null); }} />
              <PrimaryButton label="Altre idee" icon="refresh" variant="secondary" style={{ flex: 1 }}
                onPress={() => propose(proposal.recipes.map((r) => r.id))} />
            </View>
          </View>
        )}
      </Card>

      <Text style={s.section}>Il tuo menu</Text>
      {!menu.length && <Text style={s.muted}>Vuoto: aggiungi le ricette con «Aggiungi al menu», oppure fattene proporre uno.</Text>}
      {menu.map((m) => (
        <View key={m.recipe_id} style={s.row}>
          <Pressable onPress={() => onOpen(m.recipe_id)} style={{ flex: 1 }}>
            <Text style={s.rowName}>{m.name}</Text>
            <Text style={s.muted}>per {m.servings}</Text>
          </Pressable>
          <Pressable onPress={() => setServings(m.recipe_id, m.servings - 1)} style={s.stepBtn}><Icon name="remove" /></Pressable>
          <Pressable onPress={() => setServings(m.recipe_id, m.servings + 1)} style={s.stepBtn}><Icon name="add" /></Pressable>
          <Pressable onPress={() => remove(m.recipe_id)} hitSlop={8} accessibilityLabel={`Togli ${m.name}`}><Icon name="trash-outline" color={colors.danger} /></Pressable>
        </View>
      ))}

      {plan && plan.items.length > 0 && (
        <>
          <Text style={s.section}>Cosa comprare per tutto il menu</Text>
          {plan.costs[0] && (
            <View style={s.costBox}>
              <Text style={s.costMain}>{euro(plan.costs[0].total)} da {plan.costs[0].store_name}</Text>
              <Text style={s.muted}>quantità sommate tra le ricette e arrotondate una volta sola alle confezioni</Text>
            </View>
          )}
          {plan.items.map((r, i) => {
            const on = !off.has(i);
            return (
              <Pressable key={i} onPress={() => setOff((o) => { const n = new Set(o); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
                style={[s.ingRow, on && s.ingOn]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                <Icon name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.primary : colors.textSecondary} />
                <View style={{ flex: 1 }}>
                  <Text style={s.rowName}>{r.product_name ?? r.name}</Text>
                  <Text style={s.muted} numberOfLines={2}>
                    {r.recipes.join(', ')}{r.pantry ? ' · di solito in casa' : ''}{!r.product_id ? ' · prodotto nuovo' : ''}
                  </Text>
                </View>
                <Text style={s.buyQty}>{r.product_id ? formatQty(r.quantity, r.unit) : '1 pz'}</Text>
              </Pressable>
            );
          })}
          <PrimaryButton label={`Aggiungi ${chosen.length} ingredienti alla lista`} icon="cart-outline" disabled={!chosen.length}
            onPress={() => onAdded(addRows(chosen))} style={{ marginTop: spacing.md }} />
          <PrimaryButton label="Svuota il menu" variant="secondary" onPress={() => setPrefs({ menu: [] })} style={{ marginTop: spacing.sm }} />
        </>
      )}
      {error && <Text style={[s.muted, { color: colors.danger }]}>{error}</Text>}
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ ricetta personale */
function RecipeEditor({ recipe, userId, onCancel, onSaved }: { recipe: Recipe; userId: string; onCancel: () => void; onSaved: (r: Recipe) => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const [name, setName] = useState(recipe.name);
  const [servings, setServings] = useState(recipe.servings ?? 4);
  const [ings, setIngs] = useState(recipe.ingredients.join('\n'));
  const [notes, setNotes] = useState(recipe.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lines = ings.split('\n').map((l) => l.trim()).filter(Boolean);

  const save = async () => {
    setBusy(true);
    setError(null);
    const body = { user_id: userId, name: name.trim(), servings, ingredients: lines, notes: notes.trim() || null, url: recipe.url ?? null, source: recipe.source ?? null };
    try {
      onSaved(recipe.id ? await api.recipeUpdate(recipe.id, body) : await api.recipeCreate(body));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Text style={s.label}>Nome del piatto</Text>
      <View style={s.inputRow}>
        <TextInput value={name} onChangeText={setName} placeholder="Es. Pasta al forno della nonna" placeholderTextColor={colors.textSecondary} style={s.input} />
      </View>
      <View style={s.peopleRow}>
        <Text style={s.label}>Dosi per</Text>
        <View style={s.stepper}>
          <Pressable onPress={() => setServings(Math.max(1, servings - 1))} style={s.stepBtn}><Icon name="remove" /></Pressable>
          <Text style={s.peopleN}>{servings}</Text>
          <Pressable onPress={() => setServings(Math.min(30, servings + 1))} style={s.stepBtn}><Icon name="add" /></Pressable>
        </View>
      </View>
      <Text style={s.label}>Ingredienti, uno per riga</Text>
      <TextInput
        value={ings} onChangeText={setIngs} multiline
        placeholder={'500 g di spaghetti\n200 g di guanciale\n4 tuorli\npecorino q.b.'}
        placeholderTextColor={colors.textSecondary}
        style={[s.input, s.area]}
      />
      <Text style={s.muted}>Scrivi come preferisci: «500 g di spaghetti», «uova 4», «2 spicchi d'aglio», «sale q.b.». Le quantità le scalo io per le persone.</Text>
      <Text style={s.label}>Note o procedimento (facoltativo)</Text>
      <TextInput value={notes} onChangeText={setNotes} multiline style={[s.input, s.area, { minHeight: 90 }]} placeholderTextColor={colors.textSecondary} placeholder="Come la prepari…" />
      {error && <Text style={[s.muted, { color: colors.danger }]}>{error}</Text>}
      <PrimaryButton label="Salva la ricetta" icon="checkmark" loading={busy} disabled={!name.trim() || !lines.length} onPress={save} style={{ marginTop: spacing.md }} />
      <PrimaryButton label="Annulla" variant="secondary" onPress={onCancel} style={{ marginTop: spacing.sm }} />
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  safe: { flex: 1, backgroundColor: c.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  backBtn: { padding: 4 },
  headerTitle: { color: c.text, fontSize: 22, fontWeight: '800', flex: 1 },
  content: { padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: 60, gap: 6, maxWidth: 720, width: '100%', alignSelf: 'center' },
  notice: { marginHorizontal: spacing.lg, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: c.primarySoft, gap: 4 },
  noticeText: { color: c.text, fontSize: 13 },
  noticeLink: { color: c.primary, fontSize: 13, fontWeight: '700' },
  cardTitle: { color: c.text, fontSize: 16, fontWeight: '700' },
  section: { color: c.textSecondary, fontSize: 13, fontWeight: '700', marginTop: spacing.lg, marginBottom: 2 },
  label: { color: c.textSecondary, fontSize: 13, fontWeight: '700', marginTop: spacing.md },
  text: { color: c.text, fontSize: 14, lineHeight: 20 },
  muted: { color: c.textSecondary, fontSize: 12, lineHeight: 17 },
  link: { color: c.primary, fontSize: 14, fontWeight: '700', marginTop: 4 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface,
  },
  input: { flex: 1, minWidth: 0, color: c.text, fontSize: 15, paddingVertical: 10 },
  area: { minHeight: 150, textAlignVertical: 'top', borderWidth: 1, borderColor: c.border, borderRadius: radius.md, paddingHorizontal: spacing.md, backgroundColor: c.surface, flex: undefined },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  rowEmoji: { fontSize: 20 },
  rowName: { color: c.text, fontSize: 15, fontWeight: '600' },
  peopleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.lg },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepBtn: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceMuted },
  peopleN: { color: c.text, fontSize: 20, fontWeight: '800', minWidth: 28, textAlign: 'center' },
  ingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: c.border },
  ingOn: { borderColor: c.primary, backgroundColor: c.primarySoft },
  buyQty: { color: c.text, fontSize: 14, fontWeight: '700' },
  price: { color: c.success, fontSize: 12, fontWeight: '600', marginTop: 1 },
  sortRow: { flexDirection: 'row', gap: 6, marginTop: spacing.md },
  sortChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border },
  sortOn: { backgroundColor: c.primary, borderColor: c.primary },
  sortText: { color: c.text, fontSize: 13 },
  sortTextOn: { color: c.primaryText },
  costBox: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: c.surfaceMuted, gap: 2 },
  costMain: { color: c.text, fontSize: 15, fontWeight: '700' },
  menuBar: { marginHorizontal: spacing.lg, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: c.primarySoft, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  menuBarText: { color: c.text, fontSize: 14, fontWeight: '700' },
}));
