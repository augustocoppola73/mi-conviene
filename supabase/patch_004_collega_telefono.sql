-- "Collega questo telefono": codici monouso (10 minuti) letti e scritti solo dalla funzione "collega".
create table if not exists public.device_links (
  code text primary key,
  user_id uuid not null references auth.users on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.device_links enable row level security;   -- nessuna regola: dall'app non si legge né si scrive

-- Ingresso con codice famiglia + email (senza ricevere email): la funzione "collega" deve sapere
-- se un'email ha già un account. Solo la chiave segreta può chiamarla.
create or replace function public.user_id_by_email(p_email text) returns uuid
language sql stable security definer set search_path = public, auth as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1
$$;
revoke execute on function public.user_id_by_email(text) from public, anon, authenticated;
