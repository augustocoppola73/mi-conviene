// "Collega questo telefono": entrare su un altro dispositivo con un codice, senza email.
//  - create (da un dispositivo dove sei già dentro): crea un codice di 8 caratteri valido 10 minuti
//  - redeem (dal dispositivo nuovo): il codice diventa un accesso (token monouso), poi l'app chiama verifyOtp
// Deploy: Supabase → Edge Functions → nome "collega", con "Verify JWT" disattivato (il controllo lo fa la funzione).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function findSecretKey(): string | undefined {
  const direct = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY');
  if (direct) return direct;
  try {   // chiavi nuove: {"default": "sb_secret_..."}
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    return keys.default ?? Object.values(keys)[0] as string | undefined;
  } catch { return undefined; }
}
const secretKey = findSecretKey();
const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey!, { auth: { persistSession: false, autoRefreshToken: false } });

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // niente 0/O, 1/I
const newCode = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => ALPHABET[b % 32]).join('');
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === 'ping') {   // controllo dopo il deploy (solo i nomi, mai i valori)
      return json({ ok: true, key: !!secretKey, env: Object.keys(Deno.env.toObject()).filter((k) => k.startsWith('SUPABASE')) });
    }
    if (body.action === 'create') {
      const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
      const { data, error } = await admin.auth.getUser(jwt);
      const user = data?.user;
      if (error || !user) return json({ error: 'Entra prima su questo dispositivo' }, 401);
      if (!user.email) return json({ error: "Questo account non ha un'email: salvalo prima con Google" }, 400);
      await admin.from('device_links').delete().lt('expires_at', new Date().toISOString());
      const code = newCode();
      const { error: e2 } = await admin.from('device_links')
        .insert({ code, user_id: user.id, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() });
      if (e2) return json({ error: e2.message }, 500);
      return json({ code, minutes: 10 });
    }
    if (body.action === 'redeem') {
      const code = String(body.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length !== 8) return json({ error: 'Il codice ha 8 caratteri' }, 400);
      const { data: row } = await admin.from('device_links').delete()
        .eq('code', code).gt('expires_at', new Date().toISOString()).select().maybeSingle();
      if (!row) return json({ error: 'Codice non valido o scaduto' }, 400);
      const { data: u } = await admin.auth.admin.getUserById(row.user_id);
      const email = u?.user?.email;
      if (!email) return json({ error: 'Account senza email' }, 400);
      // generateLink non manda email: restituisce il token monouso che l'app usa subito
      const { data: link, error: e3 } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
      if (e3 || !link?.properties?.hashed_token) return json({ error: e3?.message ?? 'Accesso non creato' }, 500);
      return json({ token_hash: link.properties.hashed_token });
    }
    return json({ error: 'Azione sconosciuta' }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
