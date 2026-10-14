/**
 * #29: icona di ogni prodotto del catalogo, stile "confezione vera" (come Bring).
 *  - "🍌"            il prodotto così com'è (frutta, verdura, freschi);
 *  - "can:b|🐟"      una confezione (can scatoletta, jar vasetto, bottle bottiglia, carton cartone, box scatola,
 *                    frozen busta surgelati, spray spruzzino, tray vaschetta, bag sacchetto di carta, cup vasetto da yogurt,
 *                    tube tubetto, pack confezione morbida) del colore indicato, con il prodotto disegnato sull'etichetta;
 *  - "@minced"       disegno fatto apposta (carne tritata, fettine, affettati…).
 * Colori: r rosso, o arancio, y giallo, g verde, t verde acqua, b blu, n blu scuro, p viola, k rosa, w marrone, s grigio, c crema.
 */
export const PRODUCT_ICONS: Record<string, string> = {
  // frutta
  mele: '🍏', banane: '🍌', arance: '🍊', pere: '🍐', fragole: '🍓', mele_rosse: '🍎', mele_verdi: '🍏', limoni: '🍋',
  mandarini: '🍊', kiwi: '🥝', uva_bianca: '🍇', uva_nera: '🍇', pesche: '🍑', albicocche: '🍑', ciliegie: '🍒',
  anguria: '🍉', melone: '🍈', ananas: '🍍', avocado: '🥑', frutti_bosco: 'cup:p|🫐', mirtilli: '🫐', pompelmi: '🍊',
  prugne: '🫐', fichi: '🍐', cachi: '🍅', frutta_secca_mix: 'bag:w|🥜', noci: '🌰', mandorle: 'bag:c|🥜',
  // verdura
  pomodori: '🍅', insalata: '🥬', zucchine: '🥒', patate: '🥔', carote: '🥕', cipolle: '🧅', pomodorini: 'cup:r|🍅',
  melanzane: '🍆', peperoni: '🫑', cetrioli: '🥒', lattuga: '🥬', rucola: 'pack:g|🌿', spinaci: 'pack:g|🥬',
  insalata_busta: 'pack:t|🥗', broccoli: '🥦', cavolfiore: '🥦', finocchi: '🧅', sedano: '🌿', aglio: '🧄',
  cipolle_rosse: '🧅', porri: '🧅', funghi: 'cup:w|🍄', zucca: '🎃', carciofi: '🥬', asparagi: '🌱', fagiolini: '🫛',
  patate_dolci: '🍠', basilico: '🌿', prezzemolo: '🌱', minestrone_fresco: 'pack:o|🥕',
  // carne
  petto_pollo: 'tray:y|🍗', macinato: '@minced', salsiccia: '🌭', bistecca: '🥩', cosce_pollo: '🍗', ali_pollo: 'tray:o|🍗',
  pollo_intero: '🐔', fesa_tacchino: '@slices_turkey', hamburger: 'tray:r|🍔', spezzatino: '@stew', fettine_manzo: '@steak',
  arrosto_maiale: '🍖', braciole_maiale: 'tray:k|🍖', costine: '🍖', vitello_fettine: '@steak_light', agnello: '🐑',
  wurstel: 'pack:y|🌭', cotolette_pollo: 'tray:o|🍗', polpette: '🧆',
  // salumi e formaggi
  prosciutto: '@slices_ham', parmigiano: '🧀', prosciutto_crudo: '@slices_raw', salame: '@slices_salami',
  mortadella: '@slices_mortadella', bresaola: '@slices_bresaola', speck: '@slices_raw', pancetta: 'tray:r|🥓',
  tacchino_fette: '@slices_turkey', grana_padano: '🧀', grana_grattugiato: 'pack:y|🧀', pecorino: '🧀',
  gorgonzola: 'tray:b|🧀', provolone: '🧀', sottilette: 'pack:o|🧀', asiago: '🧀', feta: 'cup:b|🧀',
  emmental: '🧀', formaggio_spalmabile: 'cup:t|🧀',
  // pesce
  salmone: '🍣', tonno: 'can:b|🐟', merluzzo: 'tray:b|🐟', orata: '🐟', branzino: '🐠', gamberi: '🦐', cozze: '🦪',
  vongole: '🐚', calamari: '🦑', polpo: '🐙', salmone_affumicato: 'pack:o|🍣', sgombro_scatola: 'can:n|🐟',
  alici: 'jar:g|🐟', bastoncini_pesce: 'frozen:b|🐟', tonno_vetro: 'jar:b|🐟',
  // latticini e uova
  latte: 'carton:b|🥛', uova: '🥚', mozzarella: 'pack:b|🧀', yogurt: 'cup:b|🥛', burro: '🧈', latte_scremato: 'carton:t|🥛',
  latte_lungaconservazione: 'carton:n|🥛', latte_senza_lattosio: 'carton:p|🥛', bevanda_soia: 'carton:g|🫘',
  bevanda_avena: 'carton:w|🌾', uova_x10: '🥚', panna: 'carton:y|🥛', panna_montare: 'carton:k|🍦', yogurt_greco: 'cup:n|🥛',
  yogurt_frutta: 'cup:k|🍓', kefir: 'bottle:b|🥛', mascarpone: 'cup:y|🍰', burrata: 'cup:g|🧀', mozzarella_bufala: 'pack:t|🧀',
  fiordilatte: 'pack:r|🍕', budino: '🍮', ricotta: 'cup:s|🧀', stracchino: 'pack:g|🧀',
  // pane e forno
  pane: '🍞', cracker: 'box:r|🍘', pancarre: 'pack:y|🍞', pane_integrale: '🍞', baguette: '🥖', piadina: '🫓', tortillas: 'pack:o|🌮',
  grissini: 'box:y|🥖', taralli: 'bag:y|🥯', gallette_riso: 'pack:t|🍘', pangrattato: 'bag:y|🍞', focaccia: '🫓',
  pizza_base: 'pack:r|🍕', pasta_sfoglia: 'pack:b|🥐', pasta_brisee: 'pack:g|🥧', croissant: '🥐', crackers_integrali: 'box:w|🍘',
  // colazione
  fette_biscottate: 'box:y|🍞', biscotti: 'pack:b|🍪', zucchero: 'bag:s|🍬', caffe: 'pack:w|☕', cereali: 'box:o|🌽',
  muesli: 'box:g|🥣', fiocchi_avena: 'box:c|🌾', caffe_capsule: 'box:n|☕', caffe_grani: 'bag:w|🫘', caffe_solubile: 'jar:w|☕',
  orzo: 'jar:y|🌾', te: 'box:r|🫖', tisana: 'box:g|🍵', cacao: 'can:w|🍫', marmellata: 'jar:k|🍓', miele: '🍯',
  crema_nocciole: 'jar:w|🌰', merendine: 'box:k|🧁', plumcake: 'pack:y|🍰', biscotti_integrali: 'pack:w|🍪',
  zucchero_canna: 'bag:w|🍬', dolcificante: 'box:s|🍬',
  // dispensa
  pasta: 'box:n|🍝', riso: 'box:y|🍚', passata: 'bottle:r|🍅', farina: 'bag:c|🌾', legumi: 'can:y|🫘', spaghetti: 'box:b|🍝',
  penne: 'box:r|🍝', fusilli: 'box:g|🍝', pasta_integrale: 'box:w|🍝', pasta_uovo: 'box:y|🥚', lasagne_secche: 'box:o|🍝',
  gnocchi: 'pack:y|🥔', tortellini: 'pack:r|🥟', riso_basmati: 'box:p|🍚', riso_arborio: 'box:r|🍚', cous_cous: 'box:o|🥘',
  farro: 'bag:w|🌾', orzo_perlato: 'bag:c|🌾', polenta: 'bag:y|🌽', lenticchie: 'pack:w|🫘', fagioli_scatola: 'can:r|🫘',
  piselli_scatola: 'can:g|🫛', mais_scatola: 'can:y|🌽', pelati: 'can:r|🍅', polpa_pomodoro: 'carton:r|🍅',
  concentrato: 'tube:r|🍅', sugo_pronto: 'jar:r|🌿', pesto: 'jar:g|🌿', ragu: 'jar:r|🥩', dado: 'box:y|🍲',
  brodo_pronto: 'carton:o|🍲', lievito: 'box:k|🧁', lievito_birra: 'pack:y|🍞', farina_manitoba: 'bag:b|🌾',
  fecola: 'box:c|🥔', cioccolato_cucina: 'pack:w|🍫', olive: 'jar:g|🫒', capperi: 'jar:t|🌿', sottaceti: 'jar:y|🥒',
  funghi_trifolati: 'jar:w|🍄', carciofini: 'jar:g|🥬', zuppa_pronta: 'carton:o|🥣', pure_patate: 'box:y|🥔',
  // condimenti e salse
  olio_evo: 'bottle:g|🫒', olio_semi: 'bottle:y|🌻', olio_oliva: 'bottle:t|🫒', aceto_vino: 'bottle:r|🍇',
  aceto_balsamico: 'bottle:w|🍇', sale_fino: 'box:b|🧂', sale_grosso: 'bag:b|🧂', pepe: 'jar:s|🧂', origano: 'jar:g|🌿',
  spezie_mix: 'jar:o|🌶️', maionese: 'jar:y|🥚', ketchup: 'bottle:r|🍅', senape: 'tube:y|🌭', salsa_soia: 'bottle:w|🥢',
  tonnato: 'jar:b|🐟', burro_arachidi: 'jar:w|🥜',
  // bevande
  acqua: 'bottle:b|💧', succo: 'carton:o|🍊', birra: '🍺', vino: '🍷', acqua_frizzante: 'bottle:t|🫧', acqua_piccola: 'bottle:n|💧',
  cola: 'bottle:r|🥤', aranciata: 'bottle:o|🍊', te_freddo: 'bottle:y|🍋', succo_ace: 'carton:y|🥕', spremuta: 'bottle:o|🍊',
  vino_bianco: '🥂', prosecco: '🍾', birra_bottiglia: 'bottle:w|🍺', birra_analcolica: 'can:g|🍺', bevanda_sport: 'can:b|⚡',
  sciroppo: 'bottle:k|🍓',
  // surgelati
  piselli: 'frozen:t|🫛', pizza_surg: 'frozen:r|🍕', gelato: 'cup:k|🍨', spinaci_surg: 'frozen:g|🥬', minestrone_surg: 'frozen:o|🥕',
  verdure_grigliate: 'frozen:p|🍆', patatine_forno: 'frozen:y|🍟', fagiolini_surg: 'frozen:n|🫛', gamberetti_surg: 'frozen:k|🦐',
  misto_mare: 'frozen:b|🦑', filetti_merluzzo_surg: 'frozen:s|🐟', pasta_surg: 'frozen:r|🍝', lasagne_surg: 'frozen:o|🍝',
  cornetti_surg: 'frozen:y|🥐', ghiaccioli: '🍧', coni_gelato: '🍦',
  // casa e igiene
  detersivo: 'bottle:b|🧺', piatti: 'bottle:g|🍽️', carta_igienica: '🧻', ammorbidente: 'bottle:k|🌸', candeggina: 'bottle:s|✨',
  sgrassatore: 'spray:t|✨', detersivo_pavimenti: 'bottle:y|🧹', vetri: 'spray:b|🪟', anticalcare: 'spray:p|🚿',
  pastiglie_lavastoviglie: 'box:b|🍽️', sale_lavastoviglie: 'box:s|🧂', brillantante: 'bottle:t|✨', carta_cucina: 'pack:y|🧻',
  fazzoletti: 'pack:b|🤧', tovaglioli: 'pack:k|🍽️', sacchi_spazzatura: '🗑️', sacchetti_gelo: 'box:t|❄️', pellicola: 'box:g|🎞️',
  alluminio: 'box:s|🪙', carta_forno: 'box:o|📜', spugne: '🧽', guanti: '🧤', pile: '🔋', lampadina: '💡',
  // cura della persona
  shampoo: 'bottle:p|💇', bagnoschiuma: 'bottle:t|🛁', sapone_mani: '🧼', balsamo: 'bottle:k|💇', dentifricio: 'tube:b|🦷',
  spazzolino: '🪥', collutorio: 'bottle:t|🦷', deodorante: 'spray:s|🌸', rasoi: '🪒', schiuma_barba: 'spray:b|🪒',
  assorbenti: 'pack:k|🌸', cotton_fioc: 'box:t|☁️', dischetti: 'pack:k|☁️', crema_corpo: 'tube:k|🌸', salviette: 'pack:t|💧',
  cerotti: 'box:o|🩹',
  // dolci e snack
  cioccolato_latte: 'pack:b|🍫', cioccolato_fondente: 'pack:w|🍫', patatine: 'pack:y|🥔', snack_mais: 'pack:o|🌽', arachidi: 'can:r|🥜',
  pop_corn: '🍿', caramelle: '🍬', chewing_gum: 'pack:t|🫧', wafer: '🧇', barrette: 'box:w|🌾', torta_pronta: '🥧',
  // pronti e gastronomia
  insalata_pronta: '🥗', lasagna_pronta: 'tray:o|🍝', pizza_fresca: '🍕', piadina_farcita: '🌯', tramezzini: '🥪',
  hummus: 'cup:y|🧆', pollo_arrosto: '🍗', burger_vegetale: 'tray:g|🍔', tofu: 'pack:c|🫘',
  // bambini
  pannolini: 'pack:b|👶', salviette_bimbi: 'pack:k|👶', omogeneizzati: 'jar:o|🍼', latte_crescita: 'carton:t|🍼',
  biscotti_bimbi: 'box:y|🍪', succo_bimbi: 'carton:g|🧃',
  // animali
  crocchette_cane: 'bag:r|🐕', umido_cane: 'can:r|🐕', crocchette_gatto: 'bag:p|🐈', umido_gatto: 'pack:p|🐈', lettiera: 'bag:s|🐈',
  snack_animali: '🦴',
};
