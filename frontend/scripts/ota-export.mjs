/**
 * Aggiornamenti "via etere" dell'app Android (expo-updates, server fatto in casa su Cloudflare).
 *
 * Gira da solo prima di `wrangler deploy` (vedi "build" in wrangler.jsonc), quindi a ogni push:
 *   1. esporta il codice Android  →  dist-ota/
 *   2. copia bundle e immagini in  dist/ota/android/  (nome = hash: niente doppioni)
 *   3. scrive dist/ota/android/manifest.json, che il Worker (worker/index.js) serve all'app.
 *
 * L'app accetta solo aggiornamenti con lo stesso runtimeVersion (app.json): va alzato quando cambia
 * la parte nativa (nuovi permessi, nuovi moduli) e in quel caso serve un APK nuovo.
 */
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SITE = process.env.OTA_SITE || 'https://mi-conviene.augustocoppola.workers.dev';
const OUT = 'dist-ota';
const DEST = path.join('dist', 'ota', 'android');
const env = { ...process.env, EXPO_PUBLIC_MODE: 'cloud', NODE_ENV: 'production' };

if (!fs.existsSync('dist/index.html')) {
  console.log('[ota] manca la versione web: la esporto');
  execSync('npx expo export -p web', { stdio: 'inherit', env });
}
fs.rmSync(OUT, { recursive: true, force: true });
execSync(`npx expo export -p android --output-dir ${OUT}`, { stdio: 'inherit', env });

const app = JSON.parse(fs.readFileSync('app.json', 'utf8')).expo;
const runtimeVersion = String(app.runtimeVersion);
const meta = JSON.parse(fs.readFileSync(path.join(OUT, 'metadata.json'), 'utf8')).fileMetadata.android;

const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  ttf: 'font/ttf', otf: 'font/otf', svg: 'image/svg+xml', json: 'application/json' };

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(path.join(DEST, 'assets'), { recursive: true });

function publish(rel, ext, contentType) {
  const buf = fs.readFileSync(path.join(OUT, rel));
  const key = crypto.createHash('md5').update(buf).digest('hex');
  const hash = crypto.createHash('sha256').update(buf).digest('base64url');
  const file = `${key}.${ext}`;
  fs.writeFileSync(path.join(DEST, 'assets', file), buf);
  return { hash, key, contentType, fileExtension: `.${ext}`, url: `${SITE}/ota/android/assets/${file}` };
}

const launchAsset = publish(meta.bundle, 'bundle', 'application/javascript');
const assets = meta.assets.map((a) => publish(a.path, a.ext, TYPES[a.ext] || 'application/octet-stream'));

// id dell'aggiornamento: deriva dal contenuto, così lo stesso codice non viene riscaricato
const digest = crypto.createHash('sha256')
  .update(JSON.stringify({ runtimeVersion, launch: launchAsset.hash, assets: assets.map((a) => a.hash) })).digest('hex');
const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;

let expoClient = { name: app.name, slug: app.slug, version: app.version, runtimeVersion };
try {
  expoClient = JSON.parse(execSync('npx expo config --type public --json', { env, encoding: 'utf8' }));
} catch { /* basta la versione corta */ }

const manifest = { id, createdAt: new Date().toISOString(), runtimeVersion, launchAsset, assets, metadata: {}, extra: { expoClient } };
fs.writeFileSync(path.join(DEST, 'manifest.json'), JSON.stringify(manifest));
fs.rmSync(OUT, { recursive: true, force: true });
console.log(`[ota] aggiornamento ${id} (runtime ${runtimeVersion}, ${assets.length} file) pronto in ${DEST}`);
