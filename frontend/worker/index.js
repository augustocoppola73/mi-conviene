/**
 * Worker di Mi Conviene: i file dell'app web li serve Cloudflare da solo (cartella dist);
 * qui passa solo /api/*, cioè il server degli aggiornamenti "via etere" dell'app Android
 * (protocollo expo-updates v1, manifest preparato da scripts/ota-export.mjs).
 */
const NO_UPDATE = (extra = {}) =>
  new Response(null, { status: 204, headers: { 'expo-protocol-version': '1', 'expo-sfv-version': '0', 'cache-control': 'private, max-age=0', ...extra } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/ota/manifest') {
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
