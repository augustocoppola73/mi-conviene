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
      return new Response(JSON.stringify(manifest), {
        headers: { 'content-type': 'application/json', 'expo-protocol-version': '1', 'expo-sfv-version': '0', 'cache-control': 'private, max-age=0' },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
