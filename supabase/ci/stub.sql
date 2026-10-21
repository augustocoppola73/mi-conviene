-- Il minimo di Supabase che serve allo schema per girare su un Postgres qualsiasi (prove automatiche, NON produzione):
-- ruoli, schema auth con auth.uid()/auth.jwt(), auth.users, pgcrypto, la pubblicazione del tempo reale e net.http_post finto.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb,
  is_anonymous boolean not null default false);
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), current_setting('request.jwt.claims', true)::jsonb->>'sub')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
end $$;
create schema if not exists net;
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000) returns bigint language sql as $$ select 0::bigint $$;
grant usage on schema public, auth, extensions to anon, authenticated, service_role;
-- come Supabase: le tabelle nuove di public sono accessibili ai ruoli dell'API (poi decidono le regole RLS)
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant usage on schema net to postgres;
do $$ begin execute format($f$alter database %I set search_path = public, extensions$f$, current_database()); end $$;
