/**
 * #29: prepara le immagini delle icone dei prodotti (assets/food/*.png) e la tabella src/foodIcons.generated.ts.
 * Fonte: Fluent Emoji Flat di Microsoft (licenza MIT), in formato Iconify. Si lancia a mano quando cambiano le icone:
 *   npm pack @iconify-json/fluent-emoji-flat @resvg/resvg-js   (in una cartella a parte, poi estrarre)
 *   npx tsx scripts/build_food_icons.ts <cartella di @iconify-json/fluent-emoji-flat> <cartella di @resvg/resvg-js>
 *   poi alleggerire i PNG (128 colori, da ~930 KB a ~270 KB): python3 scripts/shrink_pngs.py assets/food
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { CATEGORIES } from '../src/engine/data';
import { allIconEmoji } from '../src/productEmoji';

const [setDir, resvgDir] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const { Resvg } = require(path.resolve(resvgDir));
const icons = JSON.parse(fs.readFileSync(path.join(setDir, 'icons.json'), 'utf8'));
const chars: Record<string, string> = JSON.parse(fs.readFileSync(path.join(setDir, 'chars.json'), 'utf8'));
const SIZE = 96;   // card da ~36 px: nitide anche sugli schermi 3x
const out = path.resolve(__dirname, '../assets/food');
fs.mkdirSync(out, { recursive: true });

const cps = (e: string) => [...e].map((c) => c.codePointAt(0)!.toString(16));
const lines: string[] = [];
const missing: string[] = [];
for (const e of allIconEmoji(CATEGORIES.map((c: any) => c.emoji))) {
  const all = cps(e);
  const name = chars[all.join('-')] ?? chars[all.filter((c) => c !== 'fe0f').join('-')];
  const icon = name && icons.icons[name];
  if (!icon) { missing.push(e); continue; }
  const w = icon.width ?? icons.width ?? 32, h = icon.height ?? icons.height ?? 32;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${SIZE}" height="${SIZE}">${icon.body}</svg>`;
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: SIZE } }).render().asPng();
  const file = `${all.filter((c) => c !== 'fe0f').join('-')}.png`;
  fs.writeFileSync(path.join(out, file), png);
  lines.push(`  ${JSON.stringify(e)}: require('../assets/food/${file}'),`);
}
fs.writeFileSync(path.resolve(__dirname, '../src/foodIcons.generated.ts'),
  `/* generato da scripts/build_food_icons.ts: non modificare a mano. Icone Fluent Emoji © Microsoft, licenza MIT. */\n` +
  `export const FOOD_ICONS: Record<string, number> = {\n${lines.join('\n')}\n};\n`);
console.log(`icone: ${lines.length}, mancanti: ${missing.join(' ') || 'nessuna'}`);
