/**
 * #100: ricette più vicine alla cucina di casa. La raccolta di Wikibooks ha anche piatti di altri paesi e salse/liquori:
 * nei suggerimenti e in cima all'elenco vanno prima i piatti italiani di tutti i giorni.
 */
const FOREIGN = /^Ricette (francesi|spagnole|israeliane|giapponesi|malesi|arabe|statunitensi|indiane|austriache|tedesche|argentine|russe|greche|cinesi|scozzesi|svizzere|messicane|ungheresi|inglesi|peruviane|australiane|svedesi|brasiliane|tunisine|moldave|armene)$/;
const NOT_A_DISH = /^(Bevande alcoliche|Salse)$/;
const EVERYDAY = /^(Primi piatti|Secondi piatti|Piatti unici|Risotti|Contorni)/;

type WithCats = { categories?: string[] | null };
export const isForeign = (r: WithCats) => (r.categories ?? []).some((c) => FOREIGN.test(c));
export const isNotADish = (r: WithCats) => (r.categories ?? []).some((c) => NOT_A_DISH.test(c));
/** 0 = piatto di tutti i giorni, 1 = altro italiano, 2 = salse e liquori, 3 = cucina straniera */
export function homeRank(r: WithCats): number {
  if (isForeign(r)) return 3;
  if (isNotADish(r)) return 2;
  return (r.categories ?? []).some((c) => EVERYDAY.test(c)) ? 0 : 1;
}
export const isQuick = (r: WithCats) => (r.categories ?? []).includes('Ricette veloci') || (r.categories ?? []).some((c) => /^(Uova|Ricette a base di uova)$/.test(c));

/* ------------------------------------------------------------------ ricette della tua regione */
/** le 20 regioni come le scrive la raccolta («Ricette regionali-…») */
export const REGIONS = ['Abruzzo', 'Basilicata', 'Calabria', 'Campania', 'Emilia Romagna', 'Friuli Venezia Giulia', 'Lazio', 'Liguria', 'Lombardia',
  'Marche', 'Molise', 'Piemonte', 'Puglia', 'Sardegna', 'Sicilia', 'Toscana', 'Trentino Alto Adige', 'Umbria', "Valle d'Aosta", 'Veneto'] as const;
export const regionCat = (r: string) => `Ricette regionali-${r}`;
export const isRegion = (region: string) => (r: WithCats) => (r.categories ?? []).includes(regionCat(region));

// capoluoghi (lat, lon, regione): la regione è quella del capoluogo più vicino, niente rete
const CITIES: [number, number, number][] = [
  // [lat, lon, indice in REGIONS]
  [42.35, 13.40, 0], [42.46, 14.21, 0], [42.66, 13.70, 0], [42.35, 14.17, 0],
  [40.64, 15.81, 1], [40.67, 16.60, 1],
  [38.91, 16.59, 2], [39.30, 16.25, 2], [38.11, 15.65, 2], [39.08, 17.13, 2], [38.68, 16.10, 2],
  [40.85, 14.27, 3], [40.68, 14.77, 3], [41.07, 14.33, 3], [40.91, 14.79, 3], [41.13, 14.78, 3],
  [44.49, 11.34, 4], [44.80, 10.33, 4], [44.65, 10.93, 4], [44.84, 11.62, 4], [44.42, 12.20, 4], [44.22, 12.04, 4], [44.06, 12.57, 4], [45.05, 9.69, 4], [44.70, 10.63, 4],
  [45.65, 13.78, 5], [46.06, 13.24, 5], [45.96, 12.66, 5], [45.94, 13.62, 5],
  [41.90, 12.50, 6], [41.47, 12.90, 6], [42.42, 12.11, 6], [42.40, 12.86, 6], [41.64, 13.34, 6],
  [44.41, 8.93, 7], [43.89, 8.03, 7], [44.31, 8.48, 7], [44.10, 9.82, 7],
  [45.46, 9.19, 8], [45.70, 9.67, 8], [45.54, 10.22, 8], [45.81, 9.09, 8], [45.82, 8.83, 8], [45.19, 9.16, 8],
  [45.16, 10.79, 8], [45.13, 10.02, 8], [46.17, 9.87, 8], [45.85, 9.39, 8], [45.31, 9.50, 8], [45.58, 9.27, 8],
  [43.62, 13.52, 9], [43.30, 13.45, 9], [42.85, 13.58, 9], [43.91, 12.91, 9], [43.16, 13.72, 9],
  [41.56, 14.67, 10], [41.59, 14.23, 10],
  [45.07, 7.69, 11], [44.39, 7.55, 11], [44.91, 8.61, 11], [44.90, 8.21, 11], [45.45, 8.62, 11], [45.32, 8.42, 11], [45.56, 8.05, 11], [45.92, 8.55, 11],
  [41.12, 16.87, 12], [40.63, 17.94, 12], [40.35, 18.17, 12], [40.47, 17.24, 12], [41.46, 15.54, 12], [41.23, 16.29, 12],
  [39.22, 9.11, 13], [40.72, 8.56, 13], [40.32, 9.33, 13], [39.90, 8.59, 13], [40.92, 9.50, 13],
  [38.12, 13.36, 14], [37.50, 15.09, 14], [38.19, 15.55, 14], [37.07, 15.29, 14], [37.31, 13.58, 14], [37.49, 14.06, 14], [37.57, 14.28, 14], [37.93, 12.54, 14], [36.93, 14.73, 14],
  [43.77, 11.25, 15], [43.55, 10.31, 15], [43.72, 10.40, 15], [43.84, 10.50, 15], [43.32, 11.33, 15], [43.46, 11.88, 15], [42.76, 11.11, 15], [43.88, 10.77, 15], [43.93, 10.92, 15], [44.04, 10.14, 15], [43.88, 11.10, 15],
  [46.07, 11.12, 16], [46.50, 11.35, 16],
  [43.11, 12.39, 17], [42.56, 12.65, 17],
  [45.74, 7.32, 18],
  [45.44, 12.33, 19], [45.41, 11.88, 19], [45.44, 10.99, 19], [45.55, 11.55, 19], [45.67, 12.24, 19], [45.07, 11.79, 19], [46.14, 12.22, 19],
];

export function regionAt(lat: number, lon: number, label?: string | null): string {
  // se l'indirizzo scritto dice già la regione («…, Livorno, Toscana, 57100, Italia») vale quella
  if (label) {
    const l = label.toLowerCase().replace(/-/g, ' ');
    const hit = REGIONS.find((r) => l.includes(r.toLowerCase().replace(/-/g, ' ')))
      ?? (l.includes('emilia') ? 'Emilia Romagna' : l.includes('friuli') ? 'Friuli Venezia Giulia' : l.includes('trentino') || l.includes('südtirol') ? 'Trentino Alto Adige' : l.includes('aosta') ? "Valle d'Aosta" : undefined);
    if (hit) return hit;
  }
  const k = Math.cos((lat * Math.PI) / 180);
  let best = CITIES[0], d0 = Infinity;
  for (const c of CITIES) { const d = (c[0] - lat) ** 2 + ((c[1] - lon) * k) ** 2; if (d < d0) { d0 = d; best = c; } }
  return REGIONS[best[2]];
}
