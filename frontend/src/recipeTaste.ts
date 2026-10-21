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
export const isTuscan = (r: WithCats) => (r.categories ?? []).includes('Ricette regionali-Toscana');
