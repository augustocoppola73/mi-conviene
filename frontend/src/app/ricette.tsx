import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, PlanRow, Recipe, RecipeSummary } from '@/api';
import { Card, Icon, PrimaryButton } from '@/components/ui';
import { formatQty } from '@/format';
import { useStore } from '@/store';
import { makeStyles, radius, spacing, useTheme } from '@/theme';

type View_ =
  | { kind: 'list' }
  | { kind: 'detail'; recipe: Recipe }
  | { kind: 'edit'; recipe: Recipe };

const KIND_LABEL: Record<string, string> = { g: 'g', ml: 'ml', spicchio: 'spicchi', fetta: 'fette', foglia: 'foglie', pz: '' };
const amountText = (r: PlanRow) => {
  if (r.amount == null) return 'q.b.';
  const n = r.amount >= 10 ? Math.round(r.amount) : Math.round(r.amount * 10) / 10;
  return `${n.toLocaleString('it-IT')}${r.kind && KIND_LABEL[r.kind] ? ' ' + KIND_LABEL[r.kind] : ''}`;
};

export default function RicetteScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const { userId, addItem, addCustom, catalog } = useStore();
  const [view, setView] = useState<View_>({ kind: 'list' });
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
          {view.kind === 'list' ? 'Ricette' : view.kind === 'edit' ? (view.recipe.id ? 'Modifica ricetta' : 'Nuova ricetta') : view.recipe.name}
        </Text>
      </View>
      {notice && (
        <Pressable onPress={() => setNotice(null)} style={s.notice}>
          <Text style={s.noticeText}>✓ {notice}</Text>
          <Pressable onPress={() => router.replace('/')} hitSlop={6}><Text style={s.noticeLink}>Vai alla lista</Text></Pressable>
        </Pressable>
      )}
      {view.kind === 'list' && (
        <RecipeList
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
          onAdd={(rows) => {
            let n = 0;
            for (const r of rows) {
              if (r.product_id) addItem(r.product_id, r.quantity);
              else addCustom(r.name, r.category_id ?? 'altro', 1, 'pz');
              n += 1;
            }
            setNotice(`Aggiunti ${n} ingredienti di «${view.recipe.name}» alla lista. Puoi aggiungere un'altra ricetta.`);
            setView({ kind: 'list' });
          }}
          hasCatalog={!!catalog}
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
function RecipeList({ userId, onOpen, onNew }: { userId: string | null; onOpen: (r: Recipe) => void; onNew: (r: Recipe) => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const [q, setQ] = useState('');
  const [list, setList] = useState<RecipeSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [link, setLink] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api.recipes(q.trim(), userId).then((r) => { setList(r.recipes); setTotal(r.total_collection); }).catch((e) => setError(e.message));
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, userId]);

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
      <Card style={{ gap: spacing.sm }}>
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
      </Card>

      <PrimaryButton
        label="Scrivi una tua ricetta" icon="create-outline" variant="secondary"
        onPress={() => onNew({ name: '', servings: 4, ingredients: [] })}
        style={{ marginTop: spacing.md }}
      />

      <View style={[s.inputRow, { marginTop: spacing.lg }]}>
        <Icon name="search" size={18} color={colors.textSecondary} />
        <TextInput value={q} onChangeText={setQ} placeholder="Cerca un piatto o un ingrediente…" placeholderTextColor={colors.textSecondary} style={s.input} />
      </View>
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
      </View>
      <Icon name="chevron-forward" size={18} color={colors.textSecondary} />
    </Pressable>
  );
}

/* ------------------------------------------------------------------ dettaglio + persone + aggiunta */
function RecipeDetail({ recipe, userId, people, setPeople, onAdd, onEdit, onDeleted, onSaved, hasCatalog }: {
  recipe: Recipe; userId: string | null; people: number; setPeople: (n: number) => void;
  onAdd: (rows: PlanRow[]) => void; onEdit: () => void; onDeleted: () => void; onSaved: (r: Recipe) => void; hasCatalog: boolean;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const [rows, setRows] = useState<PlanRow[] | null>(null);
  const [assumed, setAssumed] = useState(false);
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
                ricetta: {amountText(r)} {r.name}
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
}));
