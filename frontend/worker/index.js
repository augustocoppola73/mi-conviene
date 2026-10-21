/**
 * Worker di Mi Conviene: i file dell'app web li serve Cloudflare da solo (cartella dist);
 * qui passa solo /api/*, cioè il server degli aggiornamenti "via etere" dell'app Android
 * (protocollo expo-updates v1, manifest preparato da scripts/ota-export.mjs).
 */
const NO_UPDATE = (extra = {}) =>
  new Response(null, { status: 204, headers: { 'expo-protocol-version': '1', 'expo-sfv-version': '0', 'cache-control': 'private, max-age=0', ...extra } });

// OTA_MODE (wrangler.jsonc): "on" = aggiornamenti attivi, "rollback" = tutti tornano al codice dentro l'APK
function rollBack() {
  const b = 'mc-ota-boundary';
  const body = `--${b}\r\ncontent-disposition: form-data; name="directive"\r\ncontent-type: application/json\r\n\r\n` +
    JSON.stringify({ type: 'rollBackToEmbedded', parameters: { commitTime: new Date().toISOString() } }) + `\r\n--${b}--\r\n`;
  return new Response(body, { headers: { 'content-type': `multipart/mixed; boundary=${b}`, 'expo-protocol-version': '1', 'expo-sfv-version': '0', 'cache-control': 'private, max-age=0' } });
}

let keyCache = null;
async function sign(text, pem) {
  try {
    if (!keyCache) {
      const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
      keyCache = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    }
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyCache, new TextEncoder().encode(text));
    let bin = ''; for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b);
    return btoa(bin);
  } catch {
    return null;   // chiave rovinata: meglio nessuna firma (l'APK firmato rifiuta e resta sul codice che ha) che un Worker rotto
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/ota/manifest') {
      if (env.OTA_MODE === 'rollback') return rollBack();
      const platform = request.headers.get('expo-platform') || url.searchParams.get('platform');
      const runtime = request.headers.get('expo-runtime-version') || url.searchParams.get('runtime-version');
      if (platform !== 'android') return NO_UPDATE();
      const res = await env.ASSETS.fetch(new Request(new URL('/ota/android/manifest.json', url)));
      if (!res.ok) return NO_UPDATE();
      const manifest = await res.json();
      // aggiornamenti solo per APK con la stessa parte nativa; quello già installato non si riscarica
      if (manifest.runtimeVersion !== runtime || request.headers.get('expo-current-update-id') === manifest.id) return NO_UPDATE();
      const body = JSON.stringify(manifest);
      const headers = { 'content-type': 'application/json', 'expo-protocol-version': '1', 'expo-sfv-version': '0', 'cache-control': 'private, max-age=0' };
      // #89: aggiornamenti firmati. L'APK con il certificato (app.json → codeSigningCertificate) accetta solo manifest firmati
      // con la chiave privata giusta, che sta solo nei segreti del Worker (OTA_PRIVATE_KEY), mai nel codice.
      if (env.OTA_PRIVATE_KEY && request.headers.get('expo-expect-signature')) {
        const sig = await sign(body, env.OTA_PRIVATE_KEY);
        if (sig) headers['expo-signature'] = `sig="${sig}", keyid="main"`;
      }
      return new Response(body, { headers });
    }
    return env.ASSETS.fetch(request);
  },
};
