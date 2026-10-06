import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
const secret = 'e2e-secret-e2e-secret-e2e-secret-e2e-secret';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub, email) => {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({ sub, email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 36000 });
  return `${h}.${p}.${crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
};
const PL = JSON.parse(fs.readFileSync(new URL('../src/engine/__golden__/places_golden.json', import.meta.url), 'utf8'));
const b = await chromium.launch();
async function user(sub, email) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 820 } });
  const session = { access_token: jwt(sub, email), refresh_token: 'r', token_type: 'bearer', expires_in: 36000,
    expires_at: Math.floor(Date.now() / 1000) + 36000, user: { id: sub, email, aud: 'authenticated', role: 'authenticated' } };
  await ctx.addInitScript((s) => localStorage.setItem('sb-localhost-auth-token', s), JSON.stringify(session));
  await ctx.route(/overpass-api/, (r) => r.fulfill({ json: { elements: PL.elements } }));
  await ctx.route(/nominatim/, (r) => r.fulfill({ json: [{ lat: '43.5485', lon: '10.3106', display_name: 'Livorno, Toscana, Italia' }] }));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('requestfailed', (r) => console.log('   FAIL', r.method(), r.url().slice(0, 140), r.failure()?.errorText));
  await page.goto('http://localhost:8790/');
  await page.waitForFunction(() => !!globalThis.__mc, null, { timeout: 30000 });
  return { page, errs, call: (fn, ...args) => page.evaluate(([fn, args]) => globalThis.__mc[fn](...args).then((r) => r, (e) => ({ __error: String(e.message || e) })), [fn, args]) };
}
const A = await user('11111111-1111-1111-1111-111111111111', 'a@test.it');
const Bu = await user('22222222-2222-2222-2222-222222222222', 'b@test.it');
let fails = 0;
const ok = (name, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? '✓' : '✗'} ${name} ${extra}`); };
const U = '11111111-1111-1111-1111-111111111111';
const items = [{ product_id: 'latte', quantity: 2 }, { product_id: 'spaghetti', quantity: 1 }, { product_id: 'passata', quantity: 1 },
  { product_id: 'uova', quantity: 1 }, { product_id: 'custom:zucchine', quantity: 1, name: 'zucchine', category_id: 'frutta', unit: 'pz' }];

const boot = await A.call('bootstrap'); ok('bootstrap', boot.products?.length > 50, boot.products?.length);
const opt = await A.call('optimize', { user_id: U, items, budget: 30, transport: 'car', min_savings_threshold: 3, fuel_type: 'benzina', lat: 43.55, lon: 10.31, refuel: true });
ok('optimize', !opt.__error && opt.ranked?.length > 0, opt.__error || `${opt.location?.mode} ${opt.ranked.length} negozi, consigliato ${opt.recommended.store_name} ${opt.recommended.total_cost}, carburante ${opt.fuel.source} ${opt.fuel.price_per_liter}`);
console.log('   ', opt.reasoning);
const h = await A.call('addHistory', { user_id: U, items, store_id: opt.recommended?.store_id, total_cost: opt.recommended?.total_cost });
ok('addHistory', !!h.id, h.__error || '');
const sv = await A.call('addSaving', { user_id: U, store_id: opt.recommended.store_id, amount: 3.5, history_id: h.id, estimated_spend: 20, estimated_total: 22, snapshot: opt.recommended, price_basis: 'misto', reference_type: 'median' });
ok('addSaving', !!sv.id && sv.store_name, sv.__error || sv.store_name);
const ap = await A.call('applyReceipt', { saving_id: sv.id, user_id: U, store_id: sv.store_id, total: 18.4,
  lines: [{ product_id: 'latte', text: 'LATTE 1L', net_price: 2.2, quantity: 2, weight_kg: null, kind: 'normale' },
          { product_id: 'spaghetti', text: 'SPAGHETTI 500G', net_price: 0.69, quantity: 1, weight_kg: null, kind: 'offerta', gross_price: 0.99 }] });
ok('applyReceipt', ap.prices_saved === 2 && ap.verified?.verified, ap.__error || JSON.stringify({ saved: ap.prices_saved, verified_amount: ap.verified?.verified_amount }));
const sm = await A.call('savings', U);
ok('savings', sm.entries?.length === 1 && sm.total_verified === ap.verified?.verified_amount && sm.entries[0].real_receipt, sm.__error || JSON.stringify({ total: sm.total, to_verify: sm.to_verify }));
const opt2 = await A.call('optimize', { user_id: U, items, transport: 'car', min_savings_threshold: 3, fuel_type: 'benzina', lat: 43.55, lon: 10.31 });
const line = opt2.ranked.find((r) => r.store_id === sv.store_id).receipt.lines.find((l) => l.product_id === 'spaghetti');
ok('prezzo visto usato', line?.in_promo && line.unit_price === 0.69, JSON.stringify({ unit: line?.unit_price, normal: line?.normal_price, promo: line?.in_promo }));
ok('ultima spesa simile', opt2.last_similar?.store_id === sv.store_id, JSON.stringify(opt2.last_similar));
const offers = await A.call('offers'); ok('offers', Array.isArray(offers) && offers.some((o) => o.product_id === 'spaghetti'), offers.length);
ok('budgetSuggest', !(await A.call('budgetSuggest', U, items)).__error);
ok('habitual', (await A.call('habitual', U)).based_on === 1);
const un = await A.call('unverifySaving', sv.id); ok('unverify', un.ok);
const vs = await A.call('verifySaving', sv.id, 19.0, true, 1.79); ok('verify', vs.verified && vs.paid === 19, JSON.stringify({ a: vs.verified_amount, f: vs.verified_fuel }));

// ricette
const rc = await A.call('recipeCreate', { user_id: U, name: 'Pasta zucchine e uova', servings: 2, ingredients: ['200 g di spaghetti', '2 zucchine', '2 uova', ' ', 'parmigiano q.b.'] });
ok('recipeCreate', !!rc.id && rc.ingredients.length === 4, rc.__error || rc.id);
const list = await A.call('recipes', '', U, 'rilevanza'); ok('recipes', list.recipes?.[0]?.mine && list.total_collection > 600, list.__error || list.recipes?.[0]?.name);
const byPrice = await A.call('recipes', 'pasta', U, 'prezzo'); ok('recipes per prezzo', byPrice.recipes?.length > 0, byPrice.recipes?.[0]?.name + ' ' + byPrice.recipes?.[0]?.cheapest?.portion);
ok('recipe', (await A.call('recipe', rc.id, U)).name === 'Pasta zucchine e uova');
ok('recipe wb', !!(await A.call('recipe', list.recipes.find((r) => !r.mine).id, U)).ingredients);
const up = await A.call('recipeUpdate', rc.id, { user_id: U, name: 'Pasta con zucchine', servings: 3, ingredients: ['300 g di spaghetti', '3 zucchine', '3 uova'] });
ok('recipeUpdate', up.name === 'Pasta con zucchine' && up.source === 'mia', up.__error || '');
const pl = await A.call('recipePlan', { servings: 4, recipe_id: rc.id }); ok('recipePlan', pl.items?.length === 3 && pl.costs?.length, pl.__error || JSON.stringify(pl.cheapest));
const mn = await A.call('recipeMenu', U, [{ recipe_id: rc.id, servings: 2 }, { recipe_id: list.recipes.find((r) => !r.mine).id, servings: 4 }]);
ok('recipeMenu', mn.recipes?.length === 2 && mn.items.length > 0, mn.__error || mn.items.length);
const sg = await A.call('suggest', { user_id: U, items, budget: 40, spent: 25, servings: 2 });
ok('suggest', !sg.__error && (sg.ready.length + sg.almost.length) > 0, sg.__error || `${sg.ready.length} pronte, ${sg.almost.length} quasi: ${sg.ready.concat(sg.almost).slice(0, 3).map((r) => r.name).join(', ')}`);
const pr = await A.call('recipePropose', { user_id: U, count: 5, servings: 2, budget: 30 }); ok('recipePropose', pr.recipes?.length > 0, pr.__error || pr.recipes.map((r) => r.name).join(', '));

// famiglia
const fam = await A.call('familyCreate', U, 'Augusto'); ok('familyCreate', fam.code?.length === 6, fam.__error || fam.code);
const fb = await Bu.call('familyJoin', 'x', 'Ale', fam.code.toLowerCase()); ok('familyJoin', fb.members?.length === 2, fb.__error || JSON.stringify(fb.members));
ok('familyJoin codice errato', (await Bu.call('familyJoin', 'x', 'Ale', 'ZZZZZZ')).__error === 'Codice famiglia non trovato');
const fa = await A.call('familyByUser', U); ok('familyByUser', fa.members?.length === 2 && fa.members.some((m) => m.display_name === 'Augusto'));
await Bu.call('familyPushList', fam.code, 'x', items.slice(0, 2));
const pulled = await A.call('familyPullList', fam.code); ok('lista di famiglia', pulled.items?.length === 2, pulled.__error || '');
const rcB = await Bu.call('recipes', '', 'x', 'rilevanza'); ok('ricetta vista dalla famiglia', rcB.recipes?.[0]?.id === rc.id, rcB.recipes?.[0]?.name);

// spesa in corso
const shop = await A.call('shopCreate', { user_id: U, store_id: sv.store_id, saving_id: sv.id, items: [...items, items[0]], display_name: 'Augusto' });
ok('shopCreate', shop.items?.length === 5 && shop.mine && shop.progress.total === 5, shop.__error || JSON.stringify(shop.progress));
const seenB = await Bu.call('shopActive', 'x'); ok('la famiglia vede la spesa', seenB.shop?.id === shop.id && !seenB.shop.mine);
const [c1, c2] = await Promise.all([A.call('shopCheck', shop.id, U, 'latte', true, 'Augusto'), Bu.call('shopCheck', shop.id, 'x', 'uova', true, 'Ale')]);
ok('spunte contemporanee', !c1.__error && !c2.__error, (c1.__error || '') + (c2.__error || ''));
await new Promise((r) => setTimeout(r, 300));
const pricey = await Bu.call('shopPrice', shop.id, { user_id: 'x', key: 'passata', price: 0.79, kind: 'offerta', display_name: 'Ale' });
ok('prezzo in negozio', pricey.items?.find((i) => i.key === 'passata')?.price === 0.79, pricey.__error || '');
const added = await A.call('shopAdd', shop.id, U, { product_id: 'banane', quantity: 1 });
const after = await A.call('shopActive', U);
const chk = after.shop.items.filter((i) => i.checked).map((i) => i.key).sort().join(',');
ok('tutte le spunte salvate', chk === 'banane,latte,passata,uova', chk);
ok('chi ha preso cosa', after.shop.items.find((i) => i.key === 'uova').checked_by === 'Ale');
const fin = await A.call('shopFinish', shop.id, U); ok('shopFinish', fin.missing?.length === 2 && fin.cart > 0, fin.__error || JSON.stringify({ missing: fin.missing.map((m) => m.key), cart: fin.cart }));
ok('nessuna spesa attiva', (await A.call('shopActive', U)).shop === null);
const shop2 = await A.call('shopCreate', { user_id: U, store_id: sv.store_id, items });
ok('reparti imparati', shop2.aisles?.length > 3, shop2.aisles?.slice(0, 4).join(','));
const canc = await A.call('shopCancel', shop2.id, U); ok('shopCancel', canc.items?.length === 5);

// posti e carburante
const fuel = await A.call('fuelNearby', 'benzina', 43.53, 10.3, 40); ok('fuelNearby', fuel.stations?.length > 0, fuel.__error || `${fuel.best?.brand} ${fuel.best?.price} mediana ${fuel.median}`);
const fl = await A.call('flyers', 43.55, 10.31); ok('flyers', fl.length > 0, fl.map((f) => f.store_id).join(','));
const near = await A.call('storesNearby', 43.55, 10.31); ok('storesNearby', near.stores?.length > 0, near.stores?.map((s) => `${s.chain} ${s.distance_km}`).join(', '));
const geo = await A.call('geocode', 'Livorno'); ok('geocode', geo[0]?.label?.includes('Livorno'));
ok('classify', (await A.call('classify', 'zucchine')).category_id !== 'altro');
ok('foto scontrino spenta', !!(await A.call('scanReceipt', [])).__error);

// sicurezza: B non vede i dati personali di A
ok('B non vede il salvadanaio di A', (await Bu.call('savings', 'x')).entries.length === 0);
ok('B non vede lo storico di A', (await Bu.call('habitual', 'x')).based_on === 0);
await Bu.call('familyLeave', 'x');
ok('uscito: niente ricette di A', !(await Bu.call('recipes', '', 'x', 'rilevanza')).recipes.some((r) => r.id === rc.id));
ok('recipeDelete', (await A.call('recipeDelete', rc.id, U)).ok);
ok('deleteSaving', (await A.call('deleteSaving', sv.id)).deleted === 1);

// interfaccia: la home si apre
await A.page.goto('http://localhost:8790/'); await A.page.waitForTimeout(2500);
await A.page.screenshot({ path: process.argv[2] + '/home.png' });
await A.page.goto('http://localhost:8790/profilo'); await A.page.waitForTimeout(2000);
await A.page.screenshot({ path: process.argv[2] + '/profilo.png', fullPage: true });
ok('nessun errore nella pagina', !A.errs.length && !Bu.errs.length, [...A.errs, ...Bu.errs].slice(0, 3).join(' | '));
console.log(fails ? `ERRORI: ${fails}` : 'TUTTO OK');
await b.close();
