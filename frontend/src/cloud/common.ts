/** Costanti e piccoli aiuti condivisi dalla versione online. */
import { Recipe, primeCores } from '../engine/kitchen';
import { pyRound, todayRome } from '../engine/util';
import WIKIBOOKS from '../engine/data/recipes_wikibooks.json';
import RECIPE_CORES from '../engine/data/recipe_cores.json';

export const COLLECTION = (WIKIBOOKS as { recipes: Recipe[] }).recipes;
export const LICENSE = (WIKIBOOKS as { license: string }).license;
export const BUDGET_HISTORY_LIMIT = 50;
export const HABITUAL_SAME_STORE_KM = 1.0;   // entro 1 km è lo stesso punto vendita
/** #19: a piedi e in bici non si consigliano negozi lontani (km di strada, solo andata) */
export const DISTANCE_LIMIT_KM: Partial<Record<string, number>> = { walk: 1.2, bike: 5 };
export const nowIso = () => new Date().toISOString();
export const today = () => todayRome();   // #87: ora italiana
export const r2 = (x: number) => pyRound(x, 2);

// le ricette della raccolta si preparano subito, a piccoli blocchi
primeCores(COLLECTION, RECIPE_CORES as any); // ricette già abbinate ai prodotti: niente calcoli pesanti sul telefono
