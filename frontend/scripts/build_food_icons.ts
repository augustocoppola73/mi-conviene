/**
 * #29: prepara le immagini delle icone dei prodotti (assets/food/*.png) e src/foodIcons.generated.ts:
 *  - le icone dei prodotti/ingredienti (Fluent Emoji Flat di Microsoft, licenza MIT);
 *  - le confezioni vuote (scatoletta, vasetto, bottiglia…) nei colori usati: l'app ci mette sopra il prodotto sull'etichetta;
 *  - i disegni fatti apposta (carne tritata, fettine, affettati…).
 * Si lancia a mano quando cambiano le icone:
 *   npm pack @iconify-json/fluent-emoji-flat @resvg/resvg-js   (in una cartella a parte, poi npm i lì)
 *   npx tsx scripts/build_food_icons.ts <cartella di @iconify-json/fluent-emoji-flat> <cartella di @resvg/resvg-js>
 *   python3 scripts/shrink_pngs.py assets/food      (128 colori: molto più leggere)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { CATEGORIES } from '../src/engine/data';
import { allIconParts } from '../src/productEmoji';
import { COLORS, CONTAINERS, ContainerKind } from '../src/foodShapes';

const [setDir, resvgDir] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const { Resvg } = require(path.resolve(resvgDir));
const icons = JSON.parse(fs.readFileSync(path.join(setDir, 'icons.json'), 'utf8'));
const chars: Record<string, string> = JSON.parse(fs.readFileSync(path.join(setDir, 'chars.json'), 'utf8'));
const SIZE = 96;
const out = path.resolve(__dirname, '../assets/food');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const png = (body: string, file: string) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="${SIZE}" height="${SIZE}">${body}</svg>`;
  fs.writeFileSync(path.join(out, file), new Resvg(svg, { fitTo: { mode: 'width', value: SIZE } }).render().asPng());
};
const cps = (e: string) => [...e].map((c) => c.codePointAt(0)!.toString(16));
const emojiBody = (e: string) => {
  const all = cps(e);
  const name = chars[all.join('-')] ?? chars[all.filter((c) => c !== 'fe0f').join('-')];
  const icon = name && icons.icons[name];
  return icon ? icon.body as string : null;
};
const put = (e: string, x: number, y: number, s: number) => `<svg x="${x}" y="${y}" width="${s}" height="${s}" viewBox="0 0 32 32">${emojiBody(e)}</svg>`;
const shade = (hex: string, k: number) => '#' + [1, 3, 5].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * k))).toString(16).padStart(2, '0')).join('');

// ---------------------------------------------------------------- confezioni vuote (l'etichetta resta bianca)
const SHAPES: Record<ContainerKind, (c: string) => string> = {
  can: (c) => `<ellipse cx="48" cy="72" rx="34" ry="12" fill="#9AA3AD"/><rect x="14" y="36" width="68" height="36" fill="${c}"/>
    <rect x="14" y="40" width="68" height="28" fill="#fff" opacity=".93"/><ellipse cx="48" cy="36" rx="34" ry="12" fill="#C9D0D7"/>
    <ellipse cx="48" cy="36" rx="28" ry="9" fill="#AEB6BF"/><path d="M30 34h36" stroke="#8A939C" stroke-width="3" stroke-linecap="round"/>`,
  jar: (c) => `<rect x="22" y="16" width="52" height="14" rx="4" fill="${c}"/><rect x="22" y="16" width="52" height="4" rx="2" fill="${shade(c, 1.2)}"/>
    <rect x="18" y="28" width="60" height="58" rx="12" fill="#EAF2F7" stroke="#C8D6E0" stroke-width="2"/><rect x="22" y="44" width="52" height="30" rx="4" fill="#fff"/>`,
  bottle: (c) => `<rect x="40" y="6" width="16" height="10" rx="2" fill="${shade(c, 0.8)}"/>
    <path d="M42 16h12v10c0 4 12 8 12 18v40a6 6 0 0 1-6 6H36a6 6 0 0 1-6-6V44c0-10 12-14 12-18z" fill="${c}"/>
    <path d="M36 46v30" stroke="#fff" stroke-width="3" opacity=".35" stroke-linecap="round"/><rect x="30" y="50" width="36" height="28" fill="#fff"/>`,
  carton: (c) => `<path d="M24 26l8-16h32l8 16z" fill="#D9E2EA"/><path d="M44 10h8v-4h-8z" fill="${c}"/><rect x="24" y="26" width="48" height="62" rx="3" fill="${c}"/>
    <rect x="24" y="26" width="48" height="6" fill="#000" opacity=".1"/><rect x="28" y="40" width="40" height="36" rx="4" fill="#fff"/>`,
  box: (c) => `<rect x="16" y="14" width="64" height="74" rx="6" fill="${c}"/><rect x="16" y="14" width="64" height="12" rx="6" fill="#000" opacity=".12"/>
    <rect x="24" y="36" width="48" height="42" rx="21" fill="#fff"/>`,
  frozen: (c) => `<path d="M14 18q34-8 68 0l-4 66q-30 8-60 0z" fill="${c}"/><path d="M14 18q34-8 68 0" stroke="#fff" stroke-width="4" fill="none" opacity=".6"/>
    <circle cx="48" cy="54" r="22" fill="#fff"/>${put('❄️', 62, 14, 20)}`,
  spray: (c) => `<rect x="30" y="8" width="30" height="12" rx="3" fill="#555"/><path d="M60 12h14v6H60z" fill="#555"/><rect x="32" y="20" width="26" height="10" fill="#777"/>
    <rect x="24" y="30" width="42" height="58" rx="10" fill="${c}"/><rect x="28" y="46" width="34" height="28" rx="4" fill="#fff"/>`,
  tray: (c) => `<path d="M6 54h84l-9 30H15z" fill="#E9ECEF"/><path d="M6 54h84" stroke="#CED4DA" stroke-width="3"/><rect x="60" y="70" width="22" height="9" rx="2" fill="${c}"/>`,
  bag: (c) => `<path d="M22 24l6-12h40l6 12z" fill="${shade(c, 0.8)}"/><path d="M22 24h52l6 62H16z" fill="${c}"/><circle cx="48" cy="60" r="21" fill="#fff"/>`,
  cup: (c) => `<path d="M16 30h64l-9 56H25z" fill="${c}"/><ellipse cx="48" cy="30" rx="33" ry="8" fill="#E5E9EC" stroke="#C8D0D6" stroke-width="2"/>
    <rect x="25" y="42" width="46" height="34" rx="17" fill="#fff"/>`,
  tube: (c) => `<rect x="22" y="10" width="52" height="9" rx="1" fill="${shade(c, 0.8)}"/><path d="M24 19h48l-8 56H32z" fill="${c}"/>
    <rect x="38" y="74" width="20" height="14" rx="3" fill="#fff" stroke="#C8D0D6" stroke-width="2"/><circle cx="48" cy="42" r="16" fill="#fff"/>`,
  pack: (c) => `<path d="M16 22l4-8 4 8 4-8 4 8 4-8 4 8 4-8 4 8 4-8 4 8 4-8 4 8 4-8 4 8 4-8 4 8v62H16z" fill="${c}"/>
    <rect x="16" y="22" width="64" height="5" fill="#000" opacity=".1"/><ellipse cx="48" cy="56" rx="25" ry="22" fill="#fff"/>`,
};

// ---------------------------------------------------------------- disegni fatti apposta
const rnd = (i: number) => ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
const trayWith = (inner: string, tag: string) => `${SHAPES.tray(tag).replace(/<rect x="60"[^>]*\/>/, '')}${inner}<rect x="60" y="70" width="22" height="9" rx="2" fill="${tag}"/>`;
const minced = () => {
  let d = '<ellipse cx="48" cy="52" rx="36" ry="15" fill="#C0504D"/>';
  for (let i = 0; i < 80; i++) {
    const a = rnd(i) * Math.PI * 2, r = Math.sqrt(rnd(i + 99)) * 0.95;
    d += `<circle cx="${(48 + Math.cos(a) * 33 * r).toFixed(1)}" cy="${(50 + Math.sin(a) * 13 * r).toFixed(1)}" r="${(2 + rnd(i + 7) * 2.2).toFixed(1)}" fill="${['#D9655F', '#B03A36', '#E88A80', '#A8322F'][i % 4]}"/>`;
  }
  return d;
};
const steak = (c: string, fat: string) => `<path d="M18 52c4-15 32-20 48-13s17 19 6 23-14 4-28 4-30 0-26-14z" fill="${c}"/><path d="M27 49c8-7 24-9 34-4" stroke="${fat}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
const stew = () => [0, 1, 2, 3, 4, 5].map((k) => `<rect x="${18 + (k % 3) * 20}" y="${36 + Math.floor(k / 3) * 14}" width="18" height="14" rx="4" fill="${['#B5413E', '#C0504D', '#A63A37'][k % 3]}" transform="rotate(${(k % 2 ? 8 : -8)} ${27 + (k % 3) * 20} ${43 + Math.floor(k / 3) * 14})"/>`).join('');
const slices = (c1: string, c2: string, dots?: string) => [0, 1, 2].map((k) => `<ellipse cx="${30 + k * 18}" cy="${50 - k * 3}" rx="21" ry="14" fill="${c1}" stroke="${c2}" stroke-width="3"/>` +
  (dots ? [0, 1, 2, 3, 4].map((j) => `<circle cx="${30 + k * 18 + (rnd(k * 9 + j) - 0.5) * 24}" cy="${50 - k * 3 + (rnd(k * 9 + j + 50) - 0.5) * 14}" r="2" fill="${dots}"/>`).join('') : '')).join('');
export const SPECIALS: Record<string, string> = {
  minced: trayWith(minced(), '#C0392B'),
  steak: trayWith(steak('#C0504D', '#F3C1B5'), '#C0392B'),
  steak_light: trayWith(steak('#E39A8F', '#FBE3DF'), '#E67E22'),
  stew: trayWith(stew(), '#8E2C2C'),
  slices_ham: trayWith(slices('#F7B7B5', '#FBE3E1'), '#E84393'),
  slices_raw: trayWith(slices('#D9656A', '#FBE3E1'), '#C0392B'),
  slices_salami: trayWith(slices('#C9504E', '#B03A36', '#F6D5D0'), '#8E2C2C'),
  slices_mortadella: trayWith(slices('#F5A9B0', '#F9D9DC', '#FFF3F3'), '#E84393'),
  slices_bresaola: trayWith(slices('#8E2F33', '#B5555A'), '#6D1F23'),
  slices_turkey: trayWith(slices('#F3E1D2', '#E2C4AA'), '#E67E22'),
};

// ---------------------------------------------------------------- genera
const parts = allIconParts(CATEGORIES.map((c: any) => c.emoji));
const lines: string[] = [], cLines: string[] = [], sLines: string[] = [], missing: string[] = [];
for (const e of parts.emoji) {
  const body = emojiBody(e);
  if (!body) { missing.push(e); continue; }
  const file = `${cps(e).filter((c) => c !== 'fe0f').join('-')}.png`;
  png(`<svg x="0" y="0" width="96" height="96" viewBox="0 0 32 32">${body}</svg>`, file);
  lines.push(`  ${JSON.stringify(e)}: require('../assets/food/${file}'),`);
}
for (const key of parts.containers) {
  const [kind, col] = key.split(':') as [ContainerKind, string];
  if (!SHAPES[kind] || !COLORS[col]) { missing.push(key); continue; }
  png(SHAPES[kind](COLORS[col]), `ct_${kind}_${col}.png`);
  cLines.push(`  '${key}': require('../assets/food/ct_${kind}_${col}.png'),`);
}
for (const [k, body] of Object.entries(SPECIALS)) {
  png(body, `sp_${k}.png`);
  sLines.push(`  ${k}: require('../assets/food/sp_${k}.png'),`);
}
fs.writeFileSync(path.resolve(__dirname, '../src/foodIcons.generated.ts'),
  `/* generato da scripts/build_food_icons.ts: non modificare a mano. Icone Fluent Emoji © Microsoft, licenza MIT. */\n` +
  `export const FOOD_ICONS: Record<string, number> = {\n${lines.join('\n')}\n};\n` +
  `export const CONTAINER_ICONS: Record<string, number> = {\n${cLines.join('\n')}\n};\n` +
  `export const SPECIAL_ICONS: Record<string, number> = {\n${sLines.join('\n')}\n};\n`);
fs.copyFileSync(path.resolve(__dirname, 'food_icons_LICENSE.txt'), path.join(out, 'LICENSE'));
console.log(`icone ${lines.length}, confezioni ${cLines.length}, disegni ${sLines.length}, mancanti: ${missing.join(' ') || 'nessuna'}`);
