// Notifiche push alla famiglia. La chiama il database (patch_005_notifiche.sql) con un segreto condiviso.
// Manda la notifica agli ALTRI membri della famiglia, a chi non l'ha spenta nel Profilo, via Firebase Cloud Messaging.
// Segreti: FCM_SERVICE_ACCOUNT (chiave privata dell'account di servizio Firebase, JSON).
// Deploy: npx supabase functions deploy notifica --no-verify-jwt --project-ref tkzbradzyuhcgkfkktlx
import { createClient } from 'npm:@supabase/supabase-js@2';

function findSecretKey(): string | undefined {
  const direct = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY');
  if (direct) return direct;
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    return keys.default ?? Object.values(keys)[0] as string | undefined;
  } catch { return undefined; }
}
const admin = createClient(Deno.env.get('SUPABASE_URL')!, findSecretKey()!, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

// ------------------------------------------------------------------ accesso a Firebase (OAuth con l'account di servizio)
const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === 'string' ? new TextEncoder().encode(b) : new Uint8Array(b as ArrayBuffer);
  let s = ''; for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
let cached: { token: string; exp: number } | null = null;
async function fcmAccess(sa: any): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: sa.token_uri ?? 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claim}`));
  const r = await fetch(sa.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${b64url(sig)}` }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`OAuth Firebase: ${JSON.stringify(j).slice(0, 200)}`);
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cached.token;
}

// ------------------------------------------------------------------ testi
const euro = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;
function message(kind: string, who: string, b: any): { title: string; body: string; url: string } | null {
  const n = Number(b.items ?? 0);
  const prodotti = `${n} ${n === 1 ? 'prodotto' : 'prodotti'}`;
  switch (kind) {
    case 'lista': return { title: `🛒 ${who} ha condiviso la lista della spesa`, body: `${prodotti} · tocca per vederla`, url: '/profilo' };
    case 'spesa': return { title: `📝 ${who} ha preparato la spesa da ${b.store}`, body: `${prodotti} da prendere`, url: '/spesa' };
    case 'presa': return { title: `🚶 ${who} sta facendo la spesa da ${b.store}`, body: 'Tocca per vedere a che punto è', url: '/spesa' };
    case 'finita': return { title: `✅ ${who} ha finito la spesa da ${b.store}`,
      body: b.total ? `Totale ${euro(Number(b.total))}` : 'Tocca per vedere com\'è andata', url: '/salvadanaio' };
    case 'prova': return { title: '🔔 Notifiche attive', body: 'Da ora ti avviso quando la famiglia fa la spesa.', url: '/' };
    case 'richiesta': return b.mode === 'help'
      ? { title: `🤝 ${who} vuole aiutarti con la spesa da ${b.store}`, body: 'Tocca per rispondere', url: '/spesa' }
      : { title: `🙋 ${who} chiede di fare la spesa da ${b.store} al posto tuo`, body: 'Tocca per rispondere', url: '/spesa' };
    case 'accettata': return b.mode === 'help'
      ? { title: `🤝 ${who} ha accettato il tuo aiuto da ${b.store}`, body: 'Ora potete smarcare in due', url: '/spesa' }
      : { title: `✅ ${who} ti ha lasciato la spesa da ${b.store}`, body: 'Ora la fai tu: tocca per aprirla', url: '/spesa' };
    case 'rifiutata': return { title: `👌 ${who} continua la spesa da ${b.store}`, body: 'Puoi seguirla in diretta', url: '/spesa' };
    case 'lasciata': return { title: `🔓 ${who} ha lasciato la spesa da ${b.store}`, body: 'È libera: tocca se vuoi prenderla tu', url: '/spesa' };
    case 'aiuto': return { title: `🤝 ${who} prende ${prodotti} da ${b.store}`, body: 'Li ha tolti dalla tua lista: tocca per vedere quali', url: '/spesa' };
    case 'aiuto_lasciato': return { title: `↩️ ${who} ha lasciato la sua parte da ${b.store}`, body: 'Quello che non ha preso torna nella tua lista', url: '/spesa' };
  }
  return null;
}
const THROTTLE_MIN: Record<string, number> = { lista: 10, spesa: 2, presa: 5, finita: 1, lasciata: 1, aiuto: 0, aiuto_lasciato: 0 };
// avvisi personali (a una persona sola): niente pausa e non si possono spegnere, sono il modo in cui vi parlate
const DIRECT = new Set(['richiesta', 'accettata', 'rifiutata']);
// avvisi che seguono l'interruttore di un altro tipo nel Profilo
const PREF_OF: Record<string, string> = { lasciata: 'presa', aiuto: 'presa', aiuto_lasciato: 'presa' };

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const { data: sec } = await admin.from('app_secrets').select('value').eq('key', 'notify_secret').maybeSingle();
    if (!sec?.value || req.headers.get('x-mc-secret') !== sec.value) return json({ error: 'non autorizzato' }, 401);
    const sa = JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT') ?? 'null');
    if (!sa?.private_key) return json({ error: 'FCM_SERVICE_ACCOUNT mancante' }, 500);
    const { kind, family_id, actor } = body;

    // destinatari: la famiglia meno chi ha fatto l'azione (o, per la prova, solo chi la chiede)
    let to: { id: string; prefs: any }[] = [];
    if (kind === 'prova') {
      to = [{ id: actor, prefs: {} }];
    } else if (DIRECT.has(kind)) {
      // solo alla persona interessata, se è davvero nella stessa famiglia
      const { data } = await admin.from('profiles').select('id, prefs').eq('id', body.to).eq('family_id', family_id);
      to = data ?? [];
    } else {
      // niente raffiche: la stessa cosa nella stessa famiglia al massimo ogni qualche minuto
      const { data: last } = await admin.from('notify_log').select('at').eq('family_id', family_id).eq('kind', kind).maybeSingle();
      if (last && Date.now() - new Date(last.at).getTime() < (THROTTLE_MIN[kind] ?? 2) * 60_000) return json({ ok: true, skipped: 'throttle' });
      await admin.from('notify_log').upsert({ family_id, kind, at: new Date().toISOString() });
      const { data } = await admin.from('profiles').select('id, prefs').eq('family_id', family_id).neq('id', actor);
      to = (data ?? []).filter((p: any) => p.prefs?.notify?.[PREF_OF[kind] ?? kind] !== false);
    }
    if (!to.length) return json({ ok: true, sent: 0 });

    const { data: me } = await admin.from('profiles').select('display_name').eq('id', actor).maybeSingle();
    const who = me?.display_name?.trim() || 'Un familiare';
    if (kind === 'finita' && body.saving_id) {
      const { data: sv } = await admin.from('savings').select('data').eq('id', body.saving_id).maybeSingle();
      body.total = sv?.data?.estimated_spend ?? sv?.data?.total_cost ?? null;
    }
    const msg = message(kind, who, body);
    if (!msg) return json({ error: 'tipo sconosciuto' }, 400);

    const { data: tokens } = await admin.from('push_tokens').select('token, user_id').in('user_id', to.map((p) => p.id));
    const access = await fcmAccess(sa);
    let sent = 0;
    for (const t of tokens ?? []) {
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token: t.token, notification: { title: msg.title, body: msg.body }, data: { url: msg.url, kind },
          android: { priority: 'high', notification: { channel_id: 'famiglia', color: '#4F6B4A', tag: `${DIRECT.has(kind) ? 'richiesta' : kind}-${family_id ?? ''}` } } } }),
      });
      if (r.ok) { sent++; continue; }
      const err = await r.text();
      // telefono disinstallato o token scaduto: lo tolgo
      if (r.status === 404 || err.includes('UNREGISTERED') || err.includes('INVALID_ARGUMENT')) await admin.from('push_tokens').delete().eq('token', t.token);
    }
    return json({ ok: true, sent });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
