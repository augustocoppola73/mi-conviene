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
  return { page, errs, call: (fn, ...args) => page.evaluate(([fn, args]) => globalThis.__mc[fn](...args).then((r) => r, (e) => ({ __error: String(e.message || e) })), [fn, args]),
    g: (fn, ...args) => page.evaluate(([fn, args]) => globalThis.__mcg[fn](...args).then((r) => r ?? null, (e) => ({ __error: String(e.message || e) })), [fn, args]) };
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

// preferiti e limite a piedi (#19)
{
  const near = (await A.call('storesNearby', 43.55, 10.31)).stores;
  const fav = (c) => { const n = near.find((x) => x.chain === c); return { store_id: c, branch: { name: n.name, address: n.address, lat: n.lat, lon: n.lon } }; };
  const base = { user_id: U, items, budget: null, min_savings_threshold: 3, fuel_type: 'benzina', lat: 43.55, lon: 10.31 };
  const two = await A.call('optimize', { ...base, transport: 'car', favorites: [fav('penny'), fav('conad')] });
  ok('due preferiti usati', two.location?.favorites_here?.length === 2 && two.savings.reference.type === 'habitual', two.__error || `${two.location?.favorites_here} · ${two.reasoning}`);
  ok('riferimento = il migliore dei preferiti', ['penny', 'conad'].includes(two.savings.reference.store_id)
    && two.ranked.findIndex((r) => r.store_id === two.savings.reference.store_id) <= Math.max(...['penny', 'conad'].map((c) => two.ranked.findIndex((r) => r.store_id === c))), two.savings.reference.label);
  const walk = await A.call('optimize', { ...base, transport: 'walk', favorites: [fav('carrefour'), fav('pam')] });
  ok('a piedi solo entro 1,2 km', !walk.__error && walk.location.distance_limit?.km === 1.2 && walk.ranked.every((r) => r.travel.distance_km <= 1.2), walk.__error || walk.ranked.map((r) => `${r.store_id} ${r.travel.distance_km}`).join(', '));
  ok('preferito lontano escluso a piedi', walk.location.favorites_far?.some((n) => n.includes('Carrefour')) && walk.location.favorites_here.join() === 'pam', JSON.stringify(walk.location.favorites_far));
  console.log('    car_hint:', JSON.stringify(walk.car_hint), '·', walk.reasoning);
  ok('suggerimento auto coerente', walk.car_hint == null || (walk.car_hint.saving >= 3 && walk.car_hint.distance_km > 1.2));
  const bike = await A.call('optimize', { ...base, transport: 'bike' });
  ok('in bici entro 5 km', bike.ranked.every((r) => r.travel.distance_km <= 5) && bike.location.distance_limit?.km === 5);
  const old = await A.call('optimize', { ...base, transport: 'car', habitual_store_id: 'pam', habitual_branch: fav('pam').branch });
  ok('vecchio abituale ancora valido', old.location?.favorites_here?.join() === 'pam', JSON.stringify(old.location?.favorites_here));
}

// famiglia
const fam = await A.call('familyCreate', U, 'Augusto'); ok('familyCreate', !!fam.id && fam.my_role === 'proprietario', fam.__error || JSON.stringify(fam));
// inviti (#13): il vecchio codice non fa entrare; invito → richiesta → accetta
ok('codice famiglia vecchio rifiutato', !!(await Bu.call('familyJoin', 'x', 'Ale', fam.code)).__error);
const inv = await A.call('inviteCreate', fam.id); ok('inviteCreate', inv.code?.length === 8, inv.__error || inv.code);
const pv = await Bu.call('invitePreview', inv.code.toLowerCase());
ok('invitePreview', pv.valid && pv.kind === 'famiglia' && pv.needs_approval && pv.invited_by === 'Augusto', JSON.stringify(pv));
ok('invito sbagliato', (await Bu.call('inviteJoin', 'ZZZZ2222', 'Ale')).status === 'invalid');
const jb = await Bu.call('inviteJoin', inv.code, 'Ale'); ok('inviteJoin → in attesa', jb.status === 'pending', jb.__error || JSON.stringify(jb));
ok('invito usato una volta', !(await Bu.call('invitePreview', inv.code)).valid);
ok('B non vede ancora la famiglia', !('code' in (await Bu.call('familyByUser', 'x'))));
const mine = await Bu.call('myJoinRequest'); ok('myJoinRequest', mine?.status === 'attesa' && mine.invited_by === 'Augusto', JSON.stringify(mine));
const reqs = await A.call('joinRequests', fam.id); ok('joinRequests', reqs.length === 1 && reqs[0].display_name === 'Ale', JSON.stringify(reqs));
ok('B non può accettarsi da solo', !!(await Bu.call('joinDecide', fam.id, '22222222-2222-2222-2222-222222222222', true)).__error);
const dec = await A.call('joinDecide', fam.id, reqs[0].user_id, true); ok('joinDecide', !dec?.__error, dec?.__error || '');
const fa = await A.call('familyByUser', U); ok('familyByUser', fa.members?.length === 2 && fa.members.some((m) => m.display_name === 'Augusto' && m.role === 'proprietario'));
const inv2 = await A.call('inviteCreate', fam.id); ok('invitesOpen', (await A.call('invitesOpen', fam.id)).some((i) => i.code === inv2.code));
await Bu.call('inviteRevoke', inv2.code); ok('revoca solo chi può', (await A.call('invitePreview', inv2.code)).valid);
await A.call('inviteRevoke', inv2.code); ok('inviteRevoke', !(await A.call('invitePreview', inv2.code)).valid);
await Bu.call('familyPushList', fam.code, 'x', items.slice(0, 2));
const pulled = await A.call('familyPullList', fam.code); ok('lista di famiglia', pulled.items?.length === 2, pulled.__error || '');
const rcB = await Bu.call('recipes', '', 'x', 'rilevanza'); ok('ricetta vista dalla famiglia', rcB.recipes?.[0]?.id === rc.id, rcB.recipes?.[0]?.name);

// gruppi evento (#14)
{
  const gid = await A.g('createGroup', 'Festa di sabato', '🎉', null);
  ok('createGroup', typeof gid === 'string', JSON.stringify(gid));
  const g = await A.g('groupInfo', gid);
  ok('groupInfo: proprietario e lista', g?.role === 'proprietario' && !!g.list_id, JSON.stringify(g));
  const ginv = await A.call('inviteCreate', gid);
  const pv = await Bu.call('invitePreview', ginv.code);
  ok('anteprima invito gruppo', pv.valid && pv.kind === 'evento' && !pv.needs_approval && pv.name === 'Festa di sabato', JSON.stringify(pv));
  const j = await Bu.call('inviteJoin', ginv.code, 'Ale');
  ok('B entra subito nel gruppo', j.status === 'joined' && j.group_id === gid, JSON.stringify(j));
  ok('B resta nella famiglia', (await Bu.call('familyByUser', 'x')).members?.length === 2);
  await Bu.g('addGroupItem', g.list_id, { product_id: 'custom:patatine', name: 'patatine', quantity: 2, unit: 'pz', category_id: null });
  await A.g('addGroupItem', g.list_id, { product_id: 'latte', name: 'Latte', quantity: 1, unit: 'L', category_id: 'latticini' });
  let items = await A.g('groupItems', g.list_id);
  ok('lista condivisa', items.length === 2, JSON.stringify(items.map((i) => i.name)));
  const pat = items.find((i) => i.name === 'patatine');
  await A.g('updateGroupItem', pat.id, { assigned_to: '11111111-1111-1111-1111-111111111111' });
  const steal = await Bu.g('updateGroupItem', pat.id, { assigned_to: '22222222-2222-2222-2222-222222222222' });
  ok('B non ruba le patatine di A', !!steal?.__error, steal?.__error || '');
  ok('B non toglie le patatine prese da A', (await Bu.g('removeGroupItem', pat.id)) === false);
  const lat = items.find((i) => i.name === 'Latte');
  await Bu.g('updateGroupItem', lat.id, { status: 'preso' });
  items = await A.g('groupItems', g.list_id);
  ok('B spunta il latte: preso da B', items.find((i) => i.name === 'Latte')?.assigned_to === '22222222-2222-2222-2222-222222222222');
  ok('my_groups di B', (await Bu.g('myGroups')).some((x) => x.id === gid && x.members === 2 && x.todo === 1));
  // la pagina del gruppo si apre
  await A.page.goto(`http://localhost:8790/gruppo/${gid}`); await A.page.waitForTimeout(3000);
  ok('pagina gruppo', await A.page.getByText('Festa di sabato').count() > 0 && await A.page.getByText('patatine').count() > 0);
  await A.page.screenshot({ path: process.argv[2] + '/gruppo.png' });
  // #21: la mia parte del gruppo entra nella mia spesa; a fine spesa diventa lo scontrino del gruppo
  await A.g('updateGroupItem', pat.id, { assigned_to: '11111111-1111-1111-1111-111111111111' }).catch(() => {});
  const mineG = await A.g('myGroupItems');
  ok('myGroupItems: le patatine (2) di A', mineG.some((x) => x.name === 'patatine' && x.quantity === 2 && x.group_id === gid), JSON.stringify(mineG));
  const share = mineG.filter((x) => x.group_id === gid).map((x) => ({ group_item_id: x.id, group_id: gid, group_name: x.group_name, emoji: x.group_emoji, quantity: x.quantity }));
  const gshop = await A.call('shopCreate', { user_id: U, store_id: 'conad', items: [
    { product_id: 'latte', quantity: 1 },
    { product_id: 'custom:patatine', quantity: 2, name: 'patatine', category_id: 'altro', unit: 'pz', groups: share },
  ] });
  ok('spesa con la parte del gruppo', gshop.items?.find((i) => i.key === 'custom:patatine')?.groups?.length === 1, gshop.__error || '');
  await A.call('shopPrice', gshop.id, { user_id: U, key: 'custom:patatine', price: 3.2, kind: 'normale', display_name: 'Augusto' });
  // la spesa la fa B (famiglia, e anche nel gruppo): le sue spunte valgono anche per il gruppo
  await Bu.call('shopCheck', gshop.id, 'x', 'custom:patatine', true, 'Ale');
  await new Promise((r) => setTimeout(r, 800));
  ok('spuntate da un familiare → prese nel gruppo', (await A.g('groupItems', g.list_id)).find((i) => i.name === 'patatine')?.status === 'preso');
  await Bu.call('shopCheck', gshop.id, 'x', 'latte', true, 'Ale');
  const gfin = await Bu.call('shopFinish', gshop.id, 'x');
  ok('scontrino del gruppo a fine spesa (chiusa dal familiare)', gfin.group_receipts?.length === 1 && gfin.group_receipts[0].amount === 3.2 && gfin.group_receipts[0].saved, JSON.stringify(gfin.group_receipts ?? gfin.__error));
  // #16: lo scontrino nasce da confermare; corretto e confermato arriva nei conti
  const rec = gfin.group_receipts?.[0];
  ok('scontrino con i prodotti', rec?.lines?.[0]?.name === 'patatine' && !!rec.expense_id, JSON.stringify(rec));
  ok('da confermare: non conta ancora', (await A.g('groupBalances', gid)).every((b) => b.spent === 0));
  await A.g('confirmExpense', rec.expense_id, 4.1, [{ name: 'patatine', quantity: 2, unit: 'pz', price: 4.1 }]);
  await Bu.g('addGroupExpense', gid, 2, 'Ghiaccio');
  const bal = await A.g('groupBalances', gid);
  ok('conti: una famiglia = un conto, speso 6,10 → in pari', bal.length === 1 && bal[0].spent === 6.1 && bal[0].balance === 0, JSON.stringify(bal));
  await A.page.goto(`http://localhost:8790/gruppo/${gid}?tab=conti`); await A.page.waitForTimeout(3000);
  ok('pagina Conti', await A.page.getByText('Chi dà a chi').count() === 0 && await A.page.getByText('Ghiaccio').count() > 0);
  await A.page.screenshot({ path: process.argv[2] + '/conti.png', fullPage: true });
  // la pagina Lista in modalità gruppo
  await A.page.evaluate((gid) => { const p = JSON.parse(localStorage.getItem('margine_prefs') || '{}'); p.activeList = gid; localStorage.setItem('margine_prefs', JSON.stringify(p)); }, gid);
  await A.page.goto('http://localhost:8790/'); await A.page.waitForTimeout(3500);
  ok('scheda Lista sul gruppo', await A.page.getByText('Lista 🎉 Festa di sabato').count() > 0);
  await A.page.screenshot({ path: process.argv[2] + '/lista_gruppo.png', fullPage: false });
  await A.page.evaluate(() => { const p = JSON.parse(localStorage.getItem('margine_prefs') || '{}'); p.activeList = null; localStorage.setItem('margine_prefs', JSON.stringify(p)); });
  await Bu.g('leaveGroup', gid);
  ok('B uscito', !(await Bu.g('myGroups')).some((x) => x.id === gid));
  await A.g('leaveGroup', gid);
  ok('gruppo chiuso', (await A.g('groupInfo', gid)) === null);
}

// spesa in corso
const shop = await A.call('shopCreate', { user_id: U, store_id: sv.store_id, saving_id: sv.id, items: [...items, items[0]], display_name: 'Augusto' });
ok('shopCreate', shop.items?.length === 5 && shop.mine && shop.progress.total === 5, shop.__error || JSON.stringify(shop.progress));
const seenB = await Bu.call('shopActive', 'x'); ok('la famiglia vede la spesa', seenB.shop?.id === shop.id && !seenB.shop.mine);
// #11: la prende A, B chiede di aiutare e A accetta
await A.call('shopTake', shop.id, U, 'Augusto', 'take');
await Bu.call('shopTake', shop.id, 'x', 'Ale', 'request_help');
const acc = await A.call('shopTake', shop.id, U, 'Augusto', 'accept'); ok('aiuto accettato', !acc.__error, acc.__error || '');
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
await Bu.call('familyLeave', 'x');
ok('uscito: B non vede il salvadanaio di A', (await Bu.call('savings', 'x')).entries.length === 0);
ok('uscito: B non vede lo storico di A', (await Bu.call('habitual', 'x')).based_on === 0);
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
