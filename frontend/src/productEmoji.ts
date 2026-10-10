/**
 * #24: "immagine" del prodotto per le card della lista. Niente foto (pesanti, con diritti): un'emoji scelta dal nome,
 * altrimenti quella del reparto. Vale anche per i prodotti scritti a mano.
 */
const RULES: [RegExp, string][] = [
  [/caffe|orzo solubile/, '☕'], [/macinato di manzo/, '🥩'],
  [/\bmel[ae]\b/, '🍎'], [/banan/, '🍌'], [/aranc|spremut/, '🍊'], [/\bper[ae]\b/, '🍐'], [/fragol/, '🍓'], [/limon/, '🍋'],
  [/mandarin|clementin/, '🍊'], [/kiwi/, '🥝'], [/\buva\b/, '🍇'], [/pesch|albicocc|prugn/, '🍑'], [/cilieg/, '🍒'],
  [/anguria/, '🍉'], [/melone/, '🍈'], [/ananas/, '🍍'], [/avocado/, '🥑'], [/mirtill|frutti di bosco/, '🫐'],
  [/pompelm/, '🍊'], [/fich|cach/, '🍑'], [/noci|mandorl|frutta secca|arachid/, '🥜'], [/cocco/, '🥥'], [/mango/, '🥭'],
  [/pomodor|pelati|passata|polpa di pom|concentrato/, '🍅'], [/insalat|lattuga|rucola/, '🥬'], [/zucchin|cetriol/, '🥒'],
  [/patat|pure/, '🥔'], [/carot/, '🥕'], [/cipoll|porri/, '🧅'], [/melanzan/, '🍆'], [/peperon/, '🫑'], [/spinac|bietol/, '🥬'],
  [/brocc|cavol/, '🥦'], [/finocch|sedano|asparag|fagiolin|carcio/, '🥬'], [/aglio/, '🧄'], [/fungh|champignon/, '🍄'],
  [/zucca/, '🎃'], [/basilico|prezzemolo|origano|pesto/, '🌿'], [/\bmais\b|pop corn|snack di mais/, '🌽'],
  [/pizza/, '🍕'], [/hamburger|burger/, '🍔'], [/pollo|tacchino|cotolett/, '🍗'], [/manzo|vitello|bistecc|fettine|spezzatino|agnello|macinato/, '🥩'],
  [/maiale|salsicc|costine|arista|braciol|wurstel/, '🥓'], [/prosciutto|salame|mortadella|bresaola|speck|pancetta/, '🥓'],
  [/salmone|merluzzo|orata|branzino|sgombro|alici|pesce|tonno/, '🐟'], [/gamber|scamp/, '🦐'], [/cozz|vongol/, '🦪'],
  [/calamar|polpo/, '🦑'], [/sushi/, '🍣'],
  [/latte|kefir|bevanda di soia|bevanda d.avena/, '🥛'], [/uova/, '🥚'], [/burro\b/, '🧈'], [/yogurt|budino/, '🍮'],
  [/mozzarell|burrata|fiordilatte|parmigian|grana|pecorino|gorgonzola|provolone|ricotta|stracchino|formagg|asiago|feta|emmental|mascarpone/, '🧀'],
  [/panna/, '🥛'], [/baguette|pane|focaccia|pan carre|grissini|taralli|pangrattato/, '🥖'], [/croissant|cornett/, '🥐'],
  [/piadin|tortill|tramezzin/, '🌯'], [/cracker|gallette|fette biscottate/, '🍘'],
  [/spaghetti|penne|fusilli|pasta|lasagn|tortellini|gnocchi/, '🍝'], [/riso/, '🍚'], [/cous|farro|orzo perlato|polenta|farina|fecola|lievito/, '🌾'],
  [/lenticch|fagiol|ceci|piselli/, '🫘'], [/olio|olive/, '🫒'], [/aceto|salsa di soia/, '🍶'], [/\bsale\b|pepe|spezie|dado|brodo/, '🧂'],
  [/maionese|ketchup|senape|salsa|sugo|ragu/, '🥫'], [/zuppa|minestrone/, '🍲'], [/capperi|sottaceti/, '🫙'],
  [/caffe|orzo solubile/, '☕'], [/\bte\b|tisana|camomilla/, '🍵'], [/cereali|muesli|fiocchi d.avena/, '🥣'],
  [/miele/, '🍯'], [/marmellat|confettur|crema spalmabile|burro di arachidi/, '🍯'], [/zucchero|dolcificante/, '🍬'],
  [/biscott|wafer|merendin|plumcake|barrett/, '🍪'], [/cioccolat|cacao/, '🍫'], [/torta|crostata/, '🍰'],
  [/gelato|ghiacciol|coni/, '🍦'], [/patatine/, '🍟'], [/caramell|gomme/, '🍬'],
  [/acqua/, '💧'], [/birra/, '🍺'], [/vino|prosecco/, '🍷'], [/cola|aranciata|bevanda|succo|sciroppo|te freddo/, '🧃'],
  [/hummus|tofu/, '🥙'],
  [/detersiv|ammorbident|candeggin|sgrassator|anticalcare|detergente|lavastovigli|brillantante/, '🧴'],
  [/carta igienica|carta da cucina|fazzolett|tovagliol/, '🧻'], [/sacch|pellicola|alluminio|carta forno/, '🛍️'],
  [/spugn|guanti/, '🧽'], [/pile|batteri/, '🔋'], [/lampadin/, '💡'],
  [/shampoo|balsamo|bagnoschiuma|sapone|crema corpo|salviett/, '🧼'], [/dentifric|spazzolin|colluttor|collutorio/, '🪥'],
  [/deodorant|rasoi|schiuma da barba|assorbent|cotton|dischetti|cerott/, '🧴'], [/pannolin|omogeneizz|latte di crescita|infanzia/, '🍼'],
  [/cani|gatti|lettiera|animali/, '🐾'],
  [/asciugacapelli|phon/, '💨'], [/idropul|trapano|avvitator|attrezz/, '🛠️'],
];

const norm = (t: string) => t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

export function productEmoji(name: string, categoryEmoji?: string | null): string {
  const n = norm(name);
  for (const [re, e] of RULES) if (re.test(n)) return e;
  return categoryEmoji || '🛒';
}
