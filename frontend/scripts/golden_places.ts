import { readFileSync } from 'node:fs';
import { chainOf, cheapestFuel, flyers, fuelNearby, nearestPerChain, parseElements, storesFor } from '../src/engine/places';

const G = JSON.parse(readFileSync(new URL('../src/engine/__golden__/places_golden.json', import.meta.url), 'utf8'));
const close = (a: any, b: any, path = ''): string | null => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6 ? null : `${path}: ${a} != ${b}`;
  if (a === null || b === null || a === undefined || b === undefined) return (a ?? null) === (b ?? null) ? null : `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return `${path}: lunghezza ${a?.length} != ${b?.length}`;
    for (let i = 0; i < a.length; i++) { const r = close(a[i], b[i], `${path}[${i}]`); if (r) return r; }
    return null;
  }
  if (typeof a === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const r = close(a[k], b[k], `${path}.${k}`); if (r) return r; }
    return null;
  }
  return a === b ? null : `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
};
let fails = 0;
const check = (name: string, exp: any, got: any) => { const d = close(exp, got); if (d) { fails += 1; console.log(`✗ ${name} → ${d}`); } };

G.chains.forEach(([n, c]: [string, string | null]) => check(`catena ${n}`, c, chainOf({ osm_name: n })));
check('negozi OSM', G.parsed, parseElements(G.elements));
G.near.forEach((n: any, i: number) => {
  const near = nearestPerChain(n.stores, n.lat, n.lon);
  check(`più vicini #${i}`, n.near, near);
  const [chosen, loc] = storesFor(near);
  check(`catene scelte #${i}`, n.chosen, chosen);
  check(`posizione #${i}`, n.loc, loc);
});
G.flyers.forEach((f: any, i: number) => check(`volantini #${i}`, f.out, flyers(f.stores, f.lat, f.lon)));
G.fuel.forEach((f: any, i: number) => {
  const info = f.med ? { fuel_type: f.fuel, price_per_liter: f.med.price_per_liter, source: 'mimit' as const, observed_at: f.med.observed_at, stations: 1 }
    : { fuel_type: f.fuel, price_per_liter: 1.85, source: 'stima' as const, observed_at: null, stations: 0 };
  check(`carburante #${i}`, f.out, fuelNearby(G.stations, info, f.lat, f.lon, f.liters, f.radius));
});
void cheapestFuel;
console.log(fails ? `DIFFERENZE: ${fails}` : `TUTTO UGUALE AL PYTHON ✓ (${G.parsed.length} negozi OSM, ${G.flyers.length} volantini, ${G.fuel.length} ricerche carburante)`);
process.exit(fails ? 1 : 0);
