/**
 * #28/#29: icona di ogni prodotto del catalogo. "base" o "base|segno": il segno è un piccolo distintivo in basso a destra
 * (🥫 in scatola, 🧊 surgelato, 🫙 in vasetto, 🍾 in bottiglia…), così prodotti simili hanno icone diverse
 * (orata 🐟 / tonno in scatola 🐟+🥫 / bastoncini 🐟+🧊).
 * I prodotti scritti a mano (e quelli della comunità) usano le parole del nome: vedi productEmoji.ts.
 */
export const PRODUCT_ICONS: Record<string, string> = {
  // frutta
  mele: '🍏', banane: '🍌', arance: '🍊', pere: '🍐', fragole: '🍓', mele_rosse: '🍎', mele_verdi: '🍏|💚', limoni: '🍋',
  mandarini: '🍊|🍃', kiwi: '🥝', uva_bianca: '🍇|⚪', uva_nera: '🍇', pesche: '🍑', albicocche: '🍑|🟠', ciliegie: '🍒',
  anguria: '🍉', melone: '🍈', ananas: '🍍', avocado: '🥑', frutti_bosco: '🫐|🍓', mirtilli: '🫐', pompelmi: '🍊|🔴',
  prugne: '🫐|🟣', fichi: '🍐|🟣', cachi: '🍅|🟠', frutta_secca_mix: '🥜|🌰', noci: '🌰', mandorle: '🥜|🤎',
  // verdura
  pomodori: '🍅', insalata: '🥬', zucchine: '🥒', patate: '🥔', carote: '🥕', cipolle: '🧅', pomodorini: '🍅|🍒',
  melanzane: '🍆', peperoni: '🫑', cetrioli: '🥒|💧', lattuga: '🥬|🍃', rucola: '🌿|🥬', spinaci: '🥬|💪',
  insalata_busta: '🥗', broccoli: '🥦', cavolfiore: '🥦|⚪', finocchi: '🧅|🌿', sedano: '🌿|🥬', aglio: '🧄',
  cipolle_rosse: '🧅|🔴', porri: '🧅|🌿', funghi: '🍄', zucca: '🎃', carciofi: '🥬|🟣', asparagi: '🌱', fagiolini: '🫛',
  patate_dolci: '🍠', basilico: '🌿', prezzemolo: '🌱|🌿', minestrone_fresco: '🥕|🥬',
  // carne
  petto_pollo: '🍗|⚪', macinato: '🥩|🔪', salsiccia: '🌭|🥩', bistecca: '🥩', cosce_pollo: '🍗', ali_pollo: '🍗|🪽',
  pollo_intero: '🐔', fesa_tacchino: '🦃', hamburger: '🍔', spezzatino: '🥩|🍲', fettine_manzo: '🥩|🔪', arrosto_maiale: '🐖',
  braciole_maiale: '🐖|🥩', costine: '🍖', vitello_fettine: '🐄', agnello: '🐑', wurstel: '🌭', cotolette_pollo: '🍗|🍞',
  polpette: '🧆',
  // salumi e formaggi
  prosciutto: '🥓|🍖', parmigiano: '🧀', prosciutto_crudo: '🥓', salame: '🥓|🔴', mortadella: '🥓|🩷', bresaola: '🥩|🔪',
  speck: '🥓|🌲', pancetta: '🥓|🔪', tacchino_fette: '🦃|🔪', grana_padano: '🧀|🟡', grana_grattugiato: '🧀|🫙',
  pecorino: '🧀|🐑', gorgonzola: '🧀|💙', provolone: '🧀|🟠', sottilette: '🧀|🥪', asiago: '🧀|⛰️', feta: '🧀|⬜',
  emmental: '🧀|🕳️', formaggio_spalmabile: '🧀|🫙',
  // pesce
  salmone: '🍣', tonno: '🐟|🥫', merluzzo: '🐟|⚪', orata: '🐟', branzino: '🐠', gamberi: '🦐', cozze: '🦪', vongole: '🐚',
  calamari: '🦑', polpo: '🐙', salmone_affumicato: '🍣|💨', sgombro_scatola: '🐟|🔵', alici: '🐟|🫙',
  bastoncini_pesce: '🐟|🧊', tonno_vetro: '🐟|🫙',
  // latticini e uova
  latte: '🥛', uova: '🥚', mozzarella: '🧀|⚪', yogurt: '🍶|🥄', burro: '🧈', latte_scremato: '🥛|💧',
  latte_lungaconservazione: '🥛|📦', latte_senza_lattosio: '🥛|🚫', bevanda_soia: '🫘|🥛', bevanda_avena: '🌾|🥛',
  uova_x10: '🥚|🔟', panna: '🥛|🍳', panna_montare: '🍦|🥛', yogurt_greco: '🍶|🏛️', yogurt_frutta: '🍶|🍓', kefir: '🥛|🫧',
  mascarpone: '🫙|🍰', burrata: '🧀|💧', mozzarella_bufala: '🧀|🐃', fiordilatte: '🧀|🍕', budino: '🍮', ricotta: '🫙|⚪',
  stracchino: '🧀|🥛',
  // pane e forno
  pane: '🍞', cracker: '🍘', pancarre: '🍞|🥪', pane_integrale: '🍞|🌾', baguette: '🥖', piadina: '🫓', tortillas: '🌮',
  grissini: '🥢', taralli: '🥯', gallette_riso: '🍘|🍚', pangrattato: '🍞|🫙', focaccia: '🫓|🫒', pizza_base: '🍕|⚪',
  pasta_sfoglia: '🥐|📜', pasta_brisee: '🥧', croissant: '🥐', crackers_integrali: '🍘|🌾',
  // colazione
  fette_biscottate: '🍞|☕', biscotti: '🍪', zucchero: '🧂|🍬', caffe: '☕', cereali: '🥣', muesli: '🥣|🌰',
  fiocchi_avena: '🌾|🥣', caffe_capsule: '☕|💊', caffe_grani: '🫘|☕', caffe_solubile: '☕|🫙', orzo: '🌾|☕', te: '🫖',
  tisana: '🍵', cacao: '🍫|🥄', marmellata: '🫙|🍓', miele: '🍯', crema_nocciole: '🫙|🌰', merendine: '🧁', plumcake: '🍰',
  biscotti_integrali: '🍪|🌾', zucchero_canna: '🧂|🤎', dolcificante: '💊|🍬',
  // dispensa
  pasta: '🍝', riso: '🍚', passata: '🍅|🍾', farina: '🌾', legumi: '🫘|🥫', spaghetti: '🍝|📏', penne: '🍝|🔸',
  fusilli: '🍝|🌀', pasta_integrale: '🍝|🌾', pasta_uovo: '🍝|🥚', lasagne_secche: '🍝|📄', gnocchi: '🥔|🍝',
  tortellini: '🥟', riso_basmati: '🍚|🌏', riso_arborio: '🍚|⭐', cous_cous: '🥘', farro: '🌾|🥣', orzo_perlato: '🌾|⚪',
  polenta: '🌽|🌾', lenticchie: '🫘', fagioli_scatola: '🫘|🥫', piselli_scatola: '🫛|🥫', mais_scatola: '🌽|🥫',
  pelati: '🍅|🥫', polpa_pomodoro: '🥫|🍅', concentrato: '🍅|🧪', sugo_pronto: '🍅|🌿', pesto: '🫙|🌿', ragu: '🫙|🥩',
  dado: '🧊|🍲', brodo_pronto: '🍲', lievito: '🧁|✨', lievito_birra: '🍞|✨', farina_manitoba: '🌾|💪', fecola: '🥔|⚪',
  cioccolato_cucina: '🍫|👩‍🍳', olive: '🫒', capperi: '🫙|🟢', sottaceti: '🫙|🥒', funghi_trifolati: '🍄|🫙',
  carciofini: '🫙|🥬', zuppa_pronta: '🥣|🥫', pure_patate: '🥔|🥣',
  // condimenti e salse
  olio_evo: '🫒|🍾', olio_semi: '🌻', olio_oliva: '🫒|💧', aceto_vino: '🍷|🧪', aceto_balsamico: '🍶|⚫', sale_fino: '🧂',
  sale_grosso: '🧂|🧊', pepe: '🧂|⚫', origano: '🌿|🫙', spezie_mix: '🌶️', maionese: '🫙|🥚', ketchup: '🍅|🫙', senape: '🌭|🟡',
  salsa_soia: '🍶|🥢', tonnato: '🫙|🐟', burro_arachidi: '🥜|🫙',
  // bevande
  acqua: '💧', succo: '🧃', birra: '🍺', vino: '🍷', acqua_frizzante: '💧|🫧', acqua_piccola: '💧|🔹', cola: '🥤',
  aranciata: '🥤|🍊', te_freddo: '🧋|🍋', succo_ace: '🧃|🥕', spremuta: '🍊|🥛', vino_bianco: '🥂', prosecco: '🍾',
  birra_bottiglia: '🍻', birra_analcolica: '🍺|🚫', bevanda_sport: '🥤|⚡', sciroppo: '🍹',
  // surgelati
  piselli: '🫛|🧊', pizza_surg: '🍕|🧊', gelato: '🍨', spinaci_surg: '🥬|🧊', minestrone_surg: '🥕|🧊', verdure_grigliate: '🫑|🔥',
  patatine_forno: '🍟', fagiolini_surg: '🫛|❄️', gamberetti_surg: '🦐|🧊', misto_mare: '🦑|🧊', filetti_merluzzo_surg: '🐟|❄️',
  pasta_surg: '🍝|🧊', lasagne_surg: '🍝|❄️', cornetti_surg: '🥐|🧊', ghiaccioli: '🍧', coni_gelato: '🍦',
  // casa e igiene
  detersivo: '🧺', piatti: '🍽️|🫧', carta_igienica: '🧻', ammorbidente: '🧺|🌸', candeggina: '🧴|⚠️', sgrassatore: '🧴|✨',
  detersivo_pavimenti: '🧹', vetri: '🪟', anticalcare: '🚿', pastiglie_lavastoviglie: '🍽️|💊', sale_lavastoviglie: '🍽️|🧂',
  brillantante: '🍽️|✨', carta_cucina: '🧻|🍳', fazzoletti: '🤧', tovaglioli: '🍽️|📄', sacchi_spazzatura: '🗑️',
  sacchetti_gelo: '🛍️|❄️', pellicola: '🎞️', alluminio: '🪙|📜', carta_forno: '📜', spugne: '🧽', guanti: '🧤', pile: '🔋',
  lampadina: '💡',
  // cura della persona
  shampoo: '🧴|💇', bagnoschiuma: '🛁', sapone_mani: '🧼', balsamo: '🧴|✨', dentifricio: '🪥|🦷', spazzolino: '🪥',
  collutorio: '🦷|💧', deodorante: '🌸|🧴', rasoi: '🪒', schiuma_barba: '🪒|🫧', assorbenti: '🌸', cotton_fioc: '🦻',
  dischetti: '💄|⚪', crema_corpo: '🧴|🌸', salviette: '🧻|💧', cerotti: '🩹',
  // dolci e snack
  cioccolato_latte: '🍫|🥛', cioccolato_fondente: '🍫', patatine: '🥔|🧂', snack_mais: '🌽|🧂', arachidi: '🥜',
  pop_corn: '🍿', caramelle: '🍬', chewing_gum: '🫧', wafer: '🧇', barrette: '🌾|🍫', torta_pronta: '🍰|🥧',
  // pronti e gastronomia
  insalata_pronta: '🥗|🍴', lasagna_pronta: '🍝|🔥', pizza_fresca: '🍕', piadina_farcita: '🌯', tramezzini: '🥪',
  hummus: '🧆|🫙', pollo_arrosto: '🍗|🔥', burger_vegetale: '🍔|🌱', tofu: '🧈|🫘',
  // bambini
  pannolini: '👶', salviette_bimbi: '👶|💧', omogeneizzati: '🍼|🫙', latte_crescita: '🍼', biscotti_bimbi: '🍪|👶',
  succo_bimbi: '🧃|👶',
  // animali
  crocchette_cane: '🐕', umido_cane: '🐕|🥫', crocchette_gatto: '🐈', umido_gatto: '🐈|🥫', lettiera: '🐈|🪣', snack_animali: '🦴',
};
