/** Prove della spesa in due negozi (#2): casi costruiti a mano. Lancio: npx tsx scripts/test_split.ts */
import { splitPlan } from '../src/engine/split';

const fuel = { fuel_type: 'benzina', price_per_liter: 1.8, source: 'stima', observed_at: null, stations: 0 } as any;
let fails = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++; };

// negozio con prezzi per prodotto; posizione a ~1 km l'uno dall'altro
function store(id: string, dist: number, lat: number, prices: Record<string, number>, timeMin = Math.round(dist * 2 / 30 * 60)) {
  const lines = Object.entries(prices).map(([p, v]) => ({ product_id: p, name: p, quantity: 1, unit: 'pz', line_price: v }));
  const total = lines.reduce((s, l) => s + l.line_price, 0);
  const fuelCost = dist * 2 * 0.065 * 1.8;
  return { store_id: id, store_name: id.toUpperCase(), branch: { lat, lon: 10.31, name: id }, total_cost: +(total + fuelCost).toFixed(2),
    travel: { distance_km: dist, time_min: timeMin, fuel_cost: +fuelCost.toFixed(2), time_cost: timeMin / 60 * 10 },
    receipt: { lines, total, unknown_products: [] }, score: 0 };
}
const items = ['carne', 'pasta', 'latte', 'olio', 'pane', 'mele'].map((p) => ({ product_id: p, category_id: p === 'carne' ? 'carne' : 'altro' }));
const opts = { transport: 'car', fuel, min_savings_threshold: 3 };

// 1. A conveniente su metà, B sull'altra metà: dividere conviene
{
  const a = store('a', 2, 43.55, { carne: 20, pasta: 1, latte: 1, olio: 9, pane: 2, mele: 3 });
  const b = store('b', 2.5, 43.56, { carne: 12, pasta: 1.5, latte: 1.4, olio: 5, pane: 2.4, mele: 3.5 });
  const r = splitPlan([a, b], a, items, opts);
  ok(!!r.split, 'divide quando il risparmio supera la soglia');
  ok(r.split?.stops.find((s) => s.store_id === 'b')?.lines.some((l) => l.product_id === 'carne') === true, 'la carne va dove costa meno (B)');
  ok((r.split?.saving ?? 0) >= 3, `risparmio ${r.split?.saving} ≥ 3 €`);
  ok(r.split?.stops[0].store_id === 'a', 'prima tappa = la più vicina');
}
// 2. differenze piccole: resta in un negozio, con la nota
{
  const a = store('a', 2, 43.55, { carne: 12, pasta: 1, latte: 1, olio: 5, pane: 2, mele: 3 });
  const b = store('b', 2.5, 43.56, { carne: 11.5, pasta: 1.1, latte: 1.1, olio: 4.6, pane: 2.1, mele: 3.1 });
  const r = splitPlan([a, b], a, items, opts);
  ok(!r.split, 'non divide per pochi centesimi');
  ok(!!r.split_note && r.split_note.includes('solo'), `nota: ${r.split_note}`);
}
// 3. tappa per un solo prodotto da 2 €: non vale il viaggio
{
  const a = store('a', 2, 43.55, { carne: 12, pasta: 1, latte: 1, olio: 5, pane: 4.5, mele: 3 });
  const b = store('b', 2.5, 43.56, { carne: 14, pasta: 1.5, latte: 1.4, olio: 6, pane: 0.5, mele: 3.5 });
  const r = splitPlan([a, b], a, items, opts);
  ok(!r.split, 'niente tappa per un prodotto solo sotto i 5 €');
}
// 4. regola "carne → c": c entra nel giro anche se non sarebbe la coppia migliore, e si dice quanto costa
{
  const a = store('a', 2, 43.55, { carne: 20, pasta: 1, latte: 1, olio: 9, pane: 2, mele: 3 });
  const b = store('b', 2.5, 43.56, { carne: 12, pasta: 1.5, latte: 1.4, olio: 5, pane: 2.4, mele: 3.5 });
  const c = store('c', 3, 43.565, { carne: 14, pasta: 1.6, latte: 1.5, olio: 5.2, pane: 2.5, mele: 3.6 });
  const r = splitPlan([a, b, c], a, items, { ...opts, rules: { carne: 'c' } });
  ok(!!r.split && r.split.stops.some((s) => s.store_id === 'c' && s.lines.some((l) => l.product_id === 'carne')), 'con la regola la carne va da C');
  ok((r.split?.rules_cost ?? 0) > 0, `la regola costa ${r.split?.rules_cost} € in più`);
}
// 5. negozi lontani tra loro: il viaggio si mangia il risparmio
{
  const a = store('a', 2, 43.55, { carne: 20, pasta: 1, latte: 1, olio: 9, pane: 2, mele: 3 });
  const b = store('b', 25, 43.80, { carne: 12, pasta: 1.5, latte: 1.4, olio: 5, pane: 2.4, mele: 3.5 });
  const r = splitPlan([a, b], a, items, opts);
  ok(!r.split, 'non divide se il secondo negozio è lontano');
}
// 6. un prodotto che A non ha: va nell'altro
{
  const a = store('a', 2, 43.55, { carne: 20, pasta: 1, latte: 1, pane: 2, mele: 3 });
  const b = store('b', 2.5, 43.56, { carne: 12, pasta: 1.5, latte: 1.4, olio: 5, pane: 2.4, mele: 3.5 });
  (a.receipt as any).unknown_products = ['olio'];
  const r = splitPlan([a, b], a, items, opts);
  ok(r.split?.stops.find((s) => s.store_id === 'b')?.lines.some((l) => l.product_id === 'olio') === true, "l'olio che A non ha va da B");
}
console.log(fails ? `\n${fails} PROVE FALLITE` : '\nTUTTE LE PROVE OK ✓');
process.exit(fails ? 1 : 0);
