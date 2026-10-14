/**
 * #29: quale icona per un prodotto, stile "confezione vera": la scatoletta di tonno, il vasetto di maionese, la busta
 * dei piselli surgelati… (disegni: Fluent Emoji di Microsoft, licenza MIT, più le confezioni e alcuni disegni nostri).
 *
 * Ordine di ricerca:
 *  1. prodotto del catalogo → tabella PRODUCT_ICONS (una scelta per prodotto);
 *  2. scritto a mano: somiglia a un prodotto del catalogo ("tonno rio mare" → tonno in scatola); se il nome dice la
 *     confezione ("… surgelati", "… in vetro", "… in bottiglia", "… in scatola") si usa quella;
 *  3. parole chiave (anche cose non alimentari: asciugacapelli, trapano, phon…);
 *  4. niente di adatto: l'icona del reparto con l'iniziale del nome.
 */
import { PRODUCTS } from './engine/data';
import { ContainerKind, CONTAINERS } from './foodShapes';
import { PRODUCT_ICONS } from './productIcons';

export interface IconSpec {
  /** il prodotto (emoji disegnata) */
  base?: string;
  /** la confezione, col prodotto sull'etichetta */
  container?: { kind: ContainerKind; color: string };
  /** disegno fatto apposta (carne tritata, affettati…) */
  special?: string;
  /** nessuna icona adatta: l'iniziale del nome */
  letter?: string;
}

const norm = (t: string) => t.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
/** "🍌" · "can:b|🐟" · "@minced" */
export function parse(v: string): IconSpec {
  if (v.startsWith('@')) return { special: v.slice(1) };
  const [a, b] = v.split('|');
  if (b) { const [kind, color] = a.split(':') as [ContainerKind, string]; return { container: { kind, color: color || CONTAINERS[kind].color }, base: b }; }
  return { base: a };
}

// confezione scritta nel nome
const MODIFIERS: [RegExp, ContainerKind][] = [
  [/surgelat|congelat|frozen/, 'frozen'], [/in scatola|scatolett|lattina|latta\b/, 'can'], [/in vetro|vasett|barattol/, 'jar'],
  [/bottigli/, 'bottle'], [/cartone|brick|tetra/, 'carton'], [/in busta|bustin|sacchett/, 'pack'], [/vaschett/, 'tray'], [/tubett/, 'tube'],
];

// parole chiave per i prodotti che non somigliano a nessuno del catalogo
const RULES: [RegExp, string][] = [
  [/asciugacapell|phon\b|fon\b/, '💨'], [/idropul|idropulitric/, '🚿'], [/trapan|avvitator|cacciavit|attrezz|utensil/, '🛠️'],
  [/martell/, '🔨'], [/chiod|vite\b|viti\b/, '🔩'], [/lampad/, '💡'], [/pile|batteri/, '🔋'], [/cavo|caricator|presa/, '🔌'],
  [/candel/, '🕯️'], [/fiori|piant/, '💐'], [/regal/, '🎁'], [/giornal|rivist/, '📰'], [/quadern|penn[ae] |matit|cancelleri/, '✏️'],
  [/calz/, '🧦'], [/magliett|maglia/, '👕'], [/scarp|ciabatt/, '👟'], [/ombrell/, '☂️'], [/giocattol|gioco/, '🧸'],
  [/medicin|farmac|aspirin|tachipirin|vitamin/, '💊'], [/termometr/, '🌡️'], [/mascherin/, '😷'],
  [/sushi/, '🍣'], [/kebab|gyros/, '🥙'], [/taco|burrito/, '🌯'], [/curry/, '🍛'], [/ramen|noodle/, '🍜'], [/dumpling|ravioli cinesi/, '🥟'],
  [/ravioli|agnolotti|cappellett/, '🥟'], [/risott/, '🍚'], [/paella/, '🥘'], [/zuppa|vellutat|minestr/, '🍲'],
  [/cocco/, '🥥'], [/mango/, '🥭'], [/melagran|melograno/, '🍎'], [/papaya|maracuj|frutto della passione/, '🥭'],
  [/zenzero/, '🫚'], [/peperoncin/, '🌶️'], [/castagn/, '🌰'], [/oliv/, '🫒'], [/ceci|fagiol|lentic|legum/, '🫘'], [/piselli/, '🫛'],
  [/salsicc|wurstel|hot dog/, '🌭'], [/costat|costin/, '🍖'], [/pollo|tacchino/, '🍗'], [/maiale|porchett/, '🐖'],
  [/manzo|vitell|bistecc|carne/, '🥩'], [/prosciutt|salam|mortadell|speck|pancett|guancial|lard/, '🥓'],
  [/gamber|scamp|mazzanc/, '🦐'], [/aragost|astice/, '🦞'], [/grancio/, '🦀'], [/cozz|ostric/, '🦪'], [/vongol|telline/, '🐚'],
  [/calamar|seppi|totan/, '🦑'], [/polp/, '🐙'], [/pesce|baccal|tonno|acciug|alic|sardin|trot|spigol|sogliol|platess|nasell|pesce spada/, '🐟'],
  [/formagg|caciott|scamorz|fontina|taleggio|robiola|caprino|brie|camembert|cheddar|mozzarell|grana|parmig|pecorin/, '🧀'],
  [/latte\b|panna/, '🥛'], [/uov[ao]/, '🥚'], [/burro/, '🧈'], [/yogurt|skyr/, '🍶'], [/budin|creme caramel|panna cotta/, '🍮'],
  [/pane|pagnott|rosett|ciabatt|filon/, '🍞'], [/baguette/, '🥖'], [/cornett|brioche|croissant/, '🥐'], [/pizz/, '🍕'],
  [/focacc|piadin/, '🫓'], [/panin|tramezz|sandwich|toast/, '🥪'], [/ciambell|donut|bombol/, '🍩'], [/muffin|cupcake|tortin|merendin/, '🧁'],
  [/torta|crostat|dolce|pasticc|tiramisu/, '🍰'], [/biscott|frollin|cookie/, '🍪'], [/cioccolat|nutella|cacao/, '🍫'],
  [/caramell|lecca|zuccher/, '🍬'], [/gelat/, '🍨'], [/ghiaccio|ghiacciol/, '🧊'], [/pop ?corn/, '🍿'], [/patatin|chips/, '🥔'],
  [/cracker|gallett|tuc\b|salatin/, '🍘'], [/arachid|nocciol|pistacch|anacard|noci|mandorl|frutta secca/, '🥜'],
  [/spaghett|pasta|penne|fusill|rigaton|maccheron|tagliatell|lasagn|linguin/, '🍝'], [/riso|basmati/, '🍚'], [/gnocch/, '🥔'],
  [/farin|semola|cereal|avena|orzo|farro|crusca|quinoa|grano/, '🌾'], [/muesli|granola|corn flakes/, '🥣'],
  [/caffe|espresso|capsul/, '☕'], [/\bte\b|the\b|tisana|camomill|infus/, '🍵'], [/miel/, '🍯'], [/marmellat|confettur/, 'jar|🍓'],
  [/acqua/, '💧'], [/birra/, '🍺'], [/vino|lambrusc|chianti/, '🍷'], [/spumant|prosecc|champagne/, '🍾'], [/aperitiv|spritz|cocktail|liquor|amaro|grappa|vodka|gin\b|rum\b|whisky/, '🍸'],
  [/succo|nettare|estathe|the freddo|te freddo/, '🧃'], [/cola|aranciata|gassosa|chinotto|bibit|energy/, '🥤'],
  [/olio/, 'bottle|🫒'], [/aceto/, '🍶'], [/sale\b/, '🧂'], [/pepe\b|spezi|curcuma|paprika|cannella/, '🌶️'],
  [/maiones|ketchup|senape|salsa|sugo|pesto|ragu/, '🫙'], [/scatolett|in scatola/, '🥫'],
  [/mel[aei]\b/, '🍎'], [/banan/, '🍌'], [/aranc/, '🍊'], [/pera|pere\b/, '🍐'], [/fragol/, '🍓'], [/limon/, '🍋'],
  [/mandarin|clementin/, '🍊'], [/kiwi/, '🥝'], [/\buva\b/, '🍇'], [/pesc[ah]|albicocc|nettarin/, '🍑'], [/prugn|susin/, '🫐'],
  [/cilieg/, '🍒'], [/anguri|cocomer/, '🍉'], [/melon/, '🍈'], [/ananas/, '🍍'], [/avocad/, '🥑'], [/mirtill|lampon|more\b|ribes/, '🫐'],
  [/pomodor/, '🍅'], [/insalat|lattug|rucol|valerian|radicchi|indivia|scarola/, '🥬'], [/zucchin|cetriol/, '🥒'],
  [/patat/, '🥔'], [/carot/, '🥕'], [/cipoll|scalogn|porr/, '🧅'], [/aglio/, '🧄'], [/melanzan/, '🍆'], [/peperon/, '🫑'],
  [/spinac|bietol|cavol|verz|cime di rapa|friariell/, '🥬'], [/broccol/, '🥦'], [/fungh|porcin|champignon/, '🍄'], [/zucca/, '🎃'],
  [/mais|polenta/, '🌽'], [/basilic|prezzemol|rosmarin|salvi|menta|erbe|aromi|origano|timo/, '🌿'], [/asparag|germogl/, '🌱'],
  [/tofu|seitan|tempeh/, '🧈'], [/hummus|falafel/, '🧆'],
  [/detersiv|bucato|lavatric/, '🧺'], [/lavastovigl|piatti/, '🍽️'], [/carta igienic/, '🧻'], [/fazzolett/, '🤧'],
  [/scottex|carta cucina|carta da cucina|rotolon/, '🧻'], [/sapon/, '🧼'], [/shampoo|balsam/, '🧴'], [/bagnoschium|doccia/, '🛁'],
  [/dentifric|spazzolin|filo interdent/, '🪥'], [/rasoi|lamett/, '🪒'], [/deodorant|profum/, '🌸'], [/crema|lozion/, '🧴'],
  [/cerott/, '🩹'], [/pannolin|bimb|neonat|omogeneizz/, '👶'], [/spugn/, '🧽'], [/guant/, '🧤'], [/scop|pavimen|mocio/, '🧹'],
  [/sacchett|sacch|busta|buste/, '🛍️'], [/candeggin|varechin|sgrassat|anticalc|spray/, '🧴'], [/insetticid|zanzar/, '🦟'],
  [/cane|cani\b|crocchett/, '🐕'], [/gatt|lettiera/, '🐈'], [/pesc[ie] rossi|acquari/, '🐠'], [/uccell|canarin/, '🐦'],
];

const SKIP = new Set(['di', 'da', 'del', 'della', 'alla', 'al', 'con', 'per', 'in', 'e', 'a', 'x', 'la', 'il', 'lo', 'le', 'gli', 'i']);
// stem semplice per italiano: "zucchine" ~ "zucchina", "pomodori" ~ "pomodoro"
const stem = (w: string) => (w.length > 4 ? w.replace(/(e|i|a|o)$/, '') : w);

// indice dei prodotti del catalogo per parola principale (la prima parola significativa del nome)
let INDEX: { stem: string; words: string[]; spec: IconSpec }[] | null = null;
function index() {
  if (INDEX) return INDEX;
  INDEX = PRODUCTS.filter((p) => PRODUCT_ICONS[p.id]).map((p) => {
    const words = norm(p.name).split(' ').filter((w) => w.length >= 3 && !SKIP.has(w) && !/^\d/.test(w));
    return { stem: stem(words[0] ?? ''), words: words.map(stem), spec: parse(PRODUCT_ICONS[p.id]) };
  }).filter((x) => x.stem.length >= 3);
  return INDEX;
}

const cache = new Map<string, IconSpec>();
// il disegno principale di un disegno fatto apposta, se va messo in un'altra confezione
const SPECIAL_BASE: Record<string, string> = { minced: '🥩', steak: '🥩', steak_light: '🥩', stew: '🥩' };
function withContainer(sp: IconSpec, kind?: ContainerKind): IconSpec {
  if (!kind || sp.container?.kind === kind) return sp;
  const base = sp.base ?? (sp.special ? SPECIAL_BASE[sp.special] ?? '🥓' : undefined);
  if (!base) return sp;
  return { base, container: { kind, color: sp.container?.color ?? CONTAINERS[kind].color } };
}

export function productIcon(name: string, productId?: string | null, categoryEmoji?: string | null): IconSpec {
  if (productId && PRODUCT_ICONS[productId]) return parse(PRODUCT_ICONS[productId]);
  const n = norm(name);
  const key = `${n}|${categoryEmoji ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const mod = MODIFIERS.find(([re]) => re.test(n))?.[1];
  let out: IconSpec | null = null;
  // 2. somiglia a un prodotto del catalogo: stessa parola principale, il più parole in comune possibile
  const mine = n.split(' ').filter((w) => w.length >= 3 && !SKIP.has(w)).map(stem);
  if (mine.length) {
    let best: { spec: IconSpec; score: number } | null = null;
    for (const p of index()) {
      if (!mine.includes(p.stem)) continue;
      const score = p.words.filter((w) => mine.includes(w)).length * 10 - p.words.length;
      if (!best || score > best.score) best = { spec: p.spec, score };
    }
    if (best) out = withContainer(best.spec, mod);
  }
  // 3. parole chiave
  if (!out) {
    const r = RULES.find(([re]) => re.test(n));
    if (r) out = withContainer(parse(r[1]), mod);
  }
  // 4. reparto + iniziale
  if (!out) out = { base: categoryEmoji || '🛒', letter: (n[0] ?? '?').toUpperCase() };
  cache.set(key, out);
  return out;
}

/** il solo disegno principale come testo (dove non servono le immagini) */
export function productEmoji(name: string, categoryEmoji?: string | null, productId?: string | null): string {
  return productIcon(name, productId, categoryEmoji).base ?? categoryEmoji ?? '🛒';
}

/** tutto quello che può servire (per preparare le immagini: scripts/build_food_icons.ts) */
export function allIconParts(categoryEmojis: string[]): { emoji: string[]; containers: string[] } {
  const emoji = new Set<string>(categoryEmojis);
  const containers = new Set<string>();
  const add = (v: string) => {
    const sp = parse(v);
    if (sp.base) emoji.add(sp.base);
    if (sp.container) containers.add(`${sp.container.kind}:${sp.container.color}`);
  };
  Object.values(PRODUCT_ICONS).forEach(add);
  RULES.forEach(([, v]) => add(v));
  Object.values(SPECIAL_BASE).forEach((e) => emoji.add(e));
  emoji.add('🥓');
  (Object.keys(CONTAINERS) as ContainerKind[]).forEach((k) => containers.add(`${k}:${CONTAINERS[k].color}`));
  return { emoji: [...emoji], containers: [...containers] };
}
