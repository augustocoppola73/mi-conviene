-- =====================================================================
-- Mi Conviene — schema Supabase (Postgres)
-- Da eseguire una volta in: Supabase → SQL Editor → New query → Run.
-- Si può rieseguire: crea solo quello che manca.
--
-- Principi:
--  * ogni persona vede i suoi dati; famiglia: spesa in corso, liste condivise, ricette, reparti
--  * dati pubblici (prezzi, carburanti) leggibili da tutti, scritti solo dall'aggiornamento automatico
--  * spazio sotto controllo: si sovrascrive dove si può, e le tabelle che crescono si potano da sole
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- famiglie e profili
create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  family_id uuid references public.families on delete set null,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- la famiglia di chi sta chiamando (usata dalle regole di accesso)
create or replace function public.my_family() returns uuid
language sql stable security definer set search_path = public as $$
  select family_id from public.profiles where id = auth.uid()
$$;

-- profilo creato in automatico alla prima registrazione
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.create_family() returns public.families
language plpgsql security definer set search_path = public as $$
declare f public.families; c text;
begin
  select fa.* into f from public.families fa join public.profiles p on p.family_id = fa.id where p.id = auth.uid();
  if found then return f; end if;
  loop
    -- 6 caratteri facili da dettare (niente 0/O, 1/I); random() non dipende da estensioni
    c := '';
    for i in 1..6 loop
      c := c || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1);
    end loop;
    exit when not exists (select 1 from public.families where code = c);
  end loop;
  insert into public.families (code, created_by) values (c, auth.uid()) returning * into f;
  update public.profiles set family_id = f.id, updated_at = now() where id = auth.uid();
  return f;
end $$;

create or replace function public.join_family(join_code text) returns public.families
language plpgsql security definer set search_path = public as $$
declare f public.families;
begin
  select * into f from public.families where code = upper(trim(join_code));
  if not found then raise exception 'Codice famiglia non trovato'; end if;
  update public.profiles set family_id = f.id, updated_at = now() where id = auth.uid();
  return f;
end $$;

create or replace function public.leave_family() returns void
language sql security definer set search_path = public as $$
  update public.profiles set family_id = null, updated_at = now() where id = auth.uid();
$$;

create or replace function public.family_members()
returns table (user_id uuid, display_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name from public.profiles p
  where p.family_id is not null and p.family_id = public.my_family()
$$;

-- ---------------------------------------------------------------- dati personali / di famiglia
create table if not exists public.lists (            -- la lista in preparazione (sincronizzata tra i tuoi dispositivi)
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.family_lists (
  family_id uuid primary key references public.families on delete cascade,
  items jsonb not null default '[]'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.history (          -- spese confermate: abitudini e budget suggerito
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  items jsonb not null,
  store_id text,
  total_cost numeric(9,2),
  created_at timestamptz not null default now()
);
create index if not exists history_user_idx on public.history (user_id, created_at desc);

create table if not exists public.savings (          -- salvadanaio: tutto il dettaglio in "data" (scontrino calcolato, verifica...)
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  store_id text not null,
  verified boolean not null default false,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists savings_user_idx on public.savings (user_id, created_at desc);

create table if not exists public.shops (            -- spesa in corso (smarcata in negozio, anche in famiglia)
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  family_id uuid default public.my_family() references public.families on delete set null,
  display_name text,
  store_id text not null,
  store_name text not null,
  branch text,
  saving_id uuid,
  items jsonb not null,
  status text not null default 'active' check (status in ('active', 'done', 'cancelled', 'replaced')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  taken_by jsonb                                     -- chi sta facendo la spesa: {user_id, name, at}
);
alter table public.shops add column if not exists taken_by jsonb;
create index if not exists shops_user_idx on public.shops (user_id, status, created_at desc);
create index if not exists shops_family_idx on public.shops (family_id, status);

create table if not exists public.recipes (          -- ricette personali (e da link), condivise in famiglia
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  family_id uuid default public.my_family() references public.families on delete set null,
  name text not null check (length(name) between 1 and 120),
  servings int check (servings between 1 and 50),
  ingredients jsonb not null,
  notes text,
  url text,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.aisles (           -- ordine dei reparti imparato, per famiglia (o persona) e negozio
  owner_id uuid not null,                            -- id della famiglia, oppure dell'utente se non ha famiglia
  store_id text not null,
  ranks jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_id, store_id)
);

-- prezzi visti dagli utenti (scontrino a mano, in negozio): conoscenza condivisa tra tutti
create table if not exists public.user_prices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  store_id text not null,
  product_id text not null,
  kind text not null default 'normale' check (kind in ('normale', 'offerta', 'variante')),
  ref_price numeric(9,2) not null check (ref_price > 0),
  paid numeric(9,2),
  quantity numeric,
  weight_kg numeric,
  receipt_text text,
  note text,
  location_name text,
  date date not null default current_date,
  promo_until date,
  created_at timestamptz not null default now()
);
create index if not exists user_prices_key_idx on public.user_prices (store_id, product_id, kind, created_at desc);

-- ---------------------------------------------------------------- dati pubblici (aggiornamento giornaliero)
create table if not exists public.product_prices (   -- prezzi Open Prices aggregati: uno per catena e prodotto (sovrascritti)
  store_id text not null,
  product_id text not null,
  normal_price numeric(9,2) not null,
  promo_price numeric(9,2),
  source text not null default 'openprices',
  observations int,
  observed_at date,
  confidence text,
  location_name text,
  sample_product text,
  proof_url text,
  updated_at timestamptz not null default now(),
  primary key (store_id, product_id)
);

create table if not exists public.fuel_stations (    -- distributori MIMIT con i prezzi di oggi (sovrascritti)
  id text primary key,
  brand text,
  name text,
  address text,
  city text,
  lat double precision not null,
  lon double precision not null,
  prices jsonb not null,
  updated text,
  refreshed_at timestamptz not null default now()
);
create index if not exists fuel_lat_lon_idx on public.fuel_stations (lat, lon);

create table if not exists public.meta (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- distributori in un riquadro attorno a un punto (l'app poi calcola le distanze vere)
create or replace function public.fuel_near(p_lat double precision, p_lon double precision, p_km double precision default 15)
returns setof public.fuel_stations
language sql stable as $$
  select * from public.fuel_stations
  where lat between p_lat - p_km / 111.0 and p_lat + p_km / 111.0
    and lon between p_lon - p_km / (111.0 * cos(radians(p_lat))) and p_lon + p_km / (111.0 * cos(radians(p_lat)))
$$;

-- ---------------------------------------------------------------- pulizia automatica (spazio sotto controllo)
create or replace function public.trim_history() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.history where user_id = new.user_id and id not in (
    select id from public.history where user_id = new.user_id order by created_at desc limit 100);
  return null;
end $$;
drop trigger if exists history_trim on public.history;
create trigger history_trim after insert on public.history for each row execute function public.trim_history();

create or replace function public.trim_savings() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.savings where user_id = new.user_id and id not in (
    select id from public.savings where user_id = new.user_id order by created_at desc limit 100);
  return null;
end $$;
drop trigger if exists savings_trim on public.savings;
create trigger savings_trim after insert on public.savings for each row execute function public.trim_savings();

create or replace function public.trim_user_prices() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.user_prices where store_id = new.store_id and product_id = new.product_id and kind = new.kind
    and id not in (select id from public.user_prices where store_id = new.store_id and product_id = new.product_id
                   and kind = new.kind order by created_at desc limit 4);
  return null;
end $$;
drop trigger if exists user_prices_trim on public.user_prices;
create trigger user_prices_trim after insert on public.user_prices for each row execute function public.trim_user_prices();

create or replace function public.trim_shops() returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- una sola spesa in corso per persona; delle finite si tengono le ultime 10
  update public.shops set status = 'replaced' where user_id = new.user_id and status = 'active' and id <> new.id;
  delete from public.shops where user_id = new.user_id and status <> 'active' and id not in (
    select id from public.shops where user_id = new.user_id and status <> 'active' order by created_at desc limit 10);
  return null;
end $$;
drop trigger if exists shops_trim on public.shops;
create trigger shops_trim after insert on public.shops for each row execute function public.trim_shops();

-- pulizia notturna (chiamata dall'aggiornamento giornaliero dei prezzi)
create or replace function public.nightly_cleanup() returns jsonb language plpgsql security definer set search_path = public as $$
declare promos int; shops_old int;
begin
  delete from public.user_prices where kind = 'offerta' and promo_until < current_date - 1;
  get diagnostics promos = row_count;
  update public.shops set status = 'cancelled' where status = 'active' and updated_at < now() - interval '30 days';
  get diagnostics shops_old = row_count;
  return jsonb_build_object('expired_promos', promos, 'abandoned_shops', shops_old);
end $$;
revoke execute on function public.nightly_cleanup() from public, anon, authenticated;

-- ---------------------------------------------------------------- regole di accesso (RLS)
alter table public.families      enable row level security;
alter table public.profiles      enable row level security;
alter table public.lists         enable row level security;
alter table public.family_lists  enable row level security;
alter table public.history       enable row level security;
alter table public.savings       enable row level security;
alter table public.shops         enable row level security;
alter table public.recipes       enable row level security;
alter table public.aisles        enable row level security;
alter table public.user_prices   enable row level security;
alter table public.product_prices enable row level security;
alter table public.fuel_stations enable row level security;
alter table public.meta          enable row level security;

drop policy if exists "famiglia: la mia" on public.families;
create policy "famiglia: la mia" on public.families for select to authenticated using (id = public.my_family());

drop policy if exists "profili: io e la mia famiglia" on public.profiles;
create policy "profili: io e la mia famiglia" on public.profiles for select to authenticated
  using (id = auth.uid() or (family_id is not null and family_id = public.my_family()));
drop policy if exists "profili: modifico il mio" on public.profiles;
create policy "profili: modifico il mio" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and family_id is not distinct from public.my_family());

-- solo miei
drop policy if exists "lista: mia" on public.lists;
create policy "lista: mia" on public.lists for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "storico: mio" on public.history;
create policy "storico: mio" on public.history for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "salvadanaio: mio" on public.savings;
create policy "salvadanaio: mio" on public.savings for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- miei e della mia famiglia
drop policy if exists "lista famiglia" on public.family_lists;
create policy "lista famiglia" on public.family_lists for all to authenticated
  using (family_id = public.my_family()) with check (family_id = public.my_family());

drop policy if exists "spesa: leggo mia e famiglia" on public.shops;
create policy "spesa: leggo mia e famiglia" on public.shops for select to authenticated
  using (user_id = auth.uid() or (family_id is not null and family_id = public.my_family()));
drop policy if exists "spesa: creo la mia" on public.shops;
create policy "spesa: creo la mia" on public.shops for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "spesa: smarco mia e famiglia" on public.shops;
create policy "spesa: smarco mia e famiglia" on public.shops for update to authenticated
  using (user_id = auth.uid() or (family_id is not null and family_id = public.my_family()));

drop policy if exists "ricette: leggo mie e famiglia" on public.recipes;
create policy "ricette: leggo mie e famiglia" on public.recipes for select to authenticated
  using (user_id = auth.uid() or (family_id is not null and family_id = public.my_family()));
drop policy if exists "ricette: creo" on public.recipes;
create policy "ricette: creo" on public.recipes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "ricette: modifico mie e famiglia" on public.recipes;
create policy "ricette: modifico mie e famiglia" on public.recipes for update to authenticated
  using (user_id = auth.uid() or (family_id is not null and family_id = public.my_family()));
drop policy if exists "ricette: cancello mie e famiglia" on public.recipes;
create policy "ricette: cancello mie e famiglia" on public.recipes for delete to authenticated
  using (user_id = auth.uid() or (family_id is not null and family_id = public.my_family()));

drop policy if exists "reparti: miei e famiglia" on public.aisles;
create policy "reparti: miei e famiglia" on public.aisles for all to authenticated
  using (owner_id = auth.uid() or owner_id = public.my_family())
  with check (owner_id = auth.uid() or owner_id = public.my_family());

-- prezzi visti: tutti leggono (aiutano tutti), ognuno scrive i suoi
drop policy if exists "prezzi visti: lettura" on public.user_prices;
create policy "prezzi visti: lettura" on public.user_prices for select to authenticated using (true);
drop policy if exists "prezzi visti: scrivo i miei" on public.user_prices;
create policy "prezzi visti: scrivo i miei" on public.user_prices for insert to authenticated with check (user_id = auth.uid());

-- pubblici in sola lettura (scrive solo l'aggiornamento automatico con la chiave segreta)
drop policy if exists "prezzi: lettura" on public.product_prices;
create policy "prezzi: lettura" on public.product_prices for select to anon, authenticated using (true);
drop policy if exists "carburanti: lettura" on public.fuel_stations;
create policy "carburanti: lettura" on public.fuel_stations for select to anon, authenticated using (true);
drop policy if exists "meta: lettura" on public.meta;
create policy "meta: lettura" on public.meta for select to anon, authenticated using (true);

-- ---------------------------------------------------------------- tempo reale: le spunte della spesa arrivano subito
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'shops') then
    alter publication supabase_realtime add table public.shops;
  end if;
end $$;
