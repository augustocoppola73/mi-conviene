/**
 * #32: prove della lettura dello scontrino (src/engine/receipt.ts), le stesse di backend/tests/test_receipts.py
 * più una foto vera già letta (riquadri in scripts/fixtures/scontrino_ocr.json), intera e in due pezzi sovrapposti.
 * Uso: npx tsx scripts/test_receipt.ts
 */
import fs from 'node:fs';
import { groupRows, matchLines, mergeRows, parseRows } from '../src/engine/receipt';
import { PRODUCT_INDEX } from '../src/engine/data';
import { referencePrice } from '../src/engine/observed';

let bad = 0;
const ok = (n: string, c: boolean, x: unknown = '') => { console.log(c ? '✓' : '✗', n, c ? '' : JSON.stringify(x)); if (!c) bad++; };
const ROWS = ['CONAD CITY', 'VIA ROMA 1', 'DOCUMENTO COMMERCIALE', 'DESCRIZIONE IVA PREZZO',
  'SPAGHETTI N.5 500G 4% 0,89', 'OLIO EXTRAV. ITALIANO 1L 4% 7,99', 'PARMIGIANO REGG.300G 4% 5,49',
  'SCONTO -0,50', '2 X 0,79', 'PASSATA POMODORO 700G 4% 1,58', 'BANANE KG 1,120 x 1,59', 'BANANE 4% 1,78',
  'TOTALE COMPLESSIVO 17,23', 'DI CUI IVA 0,66', 'PAGAMENTO ELETTRONICO 17,23', '05/10/26 18:02'];
const p = parseRows(ROWS);
ok('negozio, data e totale', p.store_id === 'conad' && p.date === '2026-10-05' && p.total === 17.23 && p.total_matches, p);
const by = Object.fromEntries(p.lines.map((l) => [l.text.split(' ')[0], l]));
ok('sconto sulla riga sopra', by.PARMIGIANO?.discount === 0.5 && by.PARMIGIANO.net_price === 4.99, by.PARMIGIANO);
ok('«2 X 0,79» prima dell\'articolo', by.PASSATA?.quantity === 2, by.PASSATA);
ok('peso della riga sopra', by.BANANE?.weight_kg === 1.12, by.BANANE);
ok('5 articoli (totale, iva, pagamento esclusi)', p.lines.length === 5, p.lines.map((l) => l.text));
const m = matchLines(p, PRODUCT_INDEX as any, ['olio_evo', 'parmigiano', 'passata', 'banane']);
const mm = Object.fromEntries(m.lines.map((l) => [l.text.split(' ')[0], l]));
ok('abbinamento ai prodotti', mm.OLIO.product_id === 'olio_evo' && mm.OLIO.expected && mm.PARMIGIANO.product_id === 'parmigiano' && mm.BANANE.product_id === 'banane',
  m.lines.map((l) => [l.text, l.product_id]));
const P = PRODUCT_INDEX as any;
ok('prezzo al kg', referencePrice(mm.BANANE, P.banane) === Math.round((1.78 / 1.12) * 100) / 100);
ok('formato di riferimento', referencePrice(mm.PARMIGIANO, P.parmigiano) === 4.99);
ok('prezzo del pezzo', referencePrice(mm.PASSATA, P.passata) === 0.79);
const a = ['LIDL', 'SPAGHETTI 500G 0,89', 'OLIO EXTRAV. 1L 7,99', 'PARMIGIANO 4,99'];
const b = ['OLIO EXTRAV 1L 7,99', 'PARMIGIANO 4,99', 'BANANE 1,78', 'TOTALE 15,65'];
const r1 = mergeRows([a, b]);
ok('due foto: righe ripetute tolte', JSON.stringify(r1.removed) === '[2]' && JSON.stringify(r1.rows) === JSON.stringify([...a, 'BANANE 1,78', 'TOTALE 15,65']), r1);
const r2 = mergeRows([['LIDL', 'BANANE 1,78'], ['BANANE 1,95', 'TOTALE 3,73']]);
ok('stesso articolo con prezzo diverso: resta', JSON.stringify(r2.removed) === '[0]' && r2.rows.length === 4, r2);
const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/scontrino_ocr.json', import.meta.url), 'utf8'));
const one = parseRows(groupRows(fx.one));
ok('foto vera: Lidl, totale 18,52 che torna', one.store_id === 'lidl' && one.total === 18.52 && one.total_matches, one);
const pz = mergeRows(fx.pieces.map((x: any) => groupRows(x)));
const two = parseRows(pz.rows);
ok('foto vera in due pezzi: stesso risultato', two.total === 18.52 && two.total_matches && two.lines.length === one.lines.length && pz.removed[0] > 0, { removed: pz.removed, n: two.lines.length });
console.log(bad ? `PROVE FALLITE: ${bad}` : 'TUTTO OK ✓');
process.exit(bad ? 1 : 0);
