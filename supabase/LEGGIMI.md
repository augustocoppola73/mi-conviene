# Database (Supabase)

- `schema.sql` crea il database **da zero** (non si rilancia su quello in uso: alcune funzioni sono poi cambiate nelle patch).
- `patch_NNN_*.sql`, in ordine di numero, portano il database com'è in produzione. Ogni patch si lancia **una volta**.
  Da patch_030 in poi la patch scrive il suo nome in `public.schema_migrations`; per sapere quali sono già applicate:
  `select name, applied_at from public.schema_migrations order by name;`
- Una patch nuova: numero successivo, scritta in modo che rilanciarla non faccia danni (`if not exists`, `create or replace`),
  e alla fine `insert into public.schema_migrations (name) values ('patch_NNN') on conflict do nothing;`.

## Prove automatiche
A ogni push GitHub (Actions → «Prove (database e app)») fa da sé:
1. un Postgres 16 nuovo con un finto Supabase (`ci/stub.sql`: ruoli, `auth.uid()`, `auth.users`, `net.http_post` che non manda nulla);
2. `schema.sql` + tutte le patch in ordine (`ci/apply.sh --stub`): se una patch non si applica su un database nuovo, la prova fallisce;
3. le prove di `tests/` con i dati di `ci/fixtures.sql` (`ci/test.sh --fixtures`): ognuna finisce con «TUTTE LE PROVE OK ✓».

In locale, con un Postgres qualsiasi: `PSQL="psql -h localhost -U postgres -d prova" bash supabase/ci/apply.sh --stub && PSQL=... bash supabase/ci/test.sh --fixtures`.
