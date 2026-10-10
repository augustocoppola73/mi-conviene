-- #27: i prodotti scritti a mano entrano nel catalogo di tutti (prodotti della comunità), con i prezzi visti.
create table if not exists public.community_products (
  key text primary key,                         -- "custom:idropulsore"
  name text not null,
  category_id text not null default 'altro',
  unit text not null default 'pz',
  uses int not null default 1,                  -- quante persone l'hanno aggiunto
  created_by uuid default auth.uid(),
  hidden boolean not null default false,        -- tolto a mano (nome non adatto)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.community_product_users (
  key text not null references public.community_products on delete cascade,
  user_id uuid not null,
  primary key (key, user_id)
);
alter table public.community_products enable row level security;
alter table public.community_product_users enable row level security;
drop policy if exists "prodotti comunità: lettura" on public.community_products;
create policy "prodotti comunità: lettura" on public.community_products for select to authenticated using (not hidden);
grant select (key, name, category_id, unit, uses, hidden, updated_at) on public.community_products to authenticated;

-- nomi non adatti: niente parolacce, niente numeri di telefono/email (i nomi li vedono tutti)
create or replace function public.custom_name_ok(n text) returns boolean language sql immutable as $$
  select length(trim(n)) between 2 and 40
     and trim(n) !~ '[@]|https?://|www\.|\d{6,}'
     and lower(trim(n)) !~ '(^|[^a-z])(cazz|merd|stronz|vaffanc|troi|puttan|coglion|minchi|fanculo|porco ?d|porca ?m)'
$$;

create or replace function public.register_custom_product(p_key text, p_name text, p_category text, p_unit text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n text := trim(coalesce(p_name, '')); r public.community_products;
begin
  if me is null then return; end if;
  if p_key is null or left(p_key, 7) <> 'custom:' or length(p_key) > 120 then return; end if;
  if not public.custom_name_ok(n) then return; end if;
  select * into r from public.community_products where key = p_key;
  if not found then
    insert into public.community_products (key, name, category_id, unit, created_by)
    values (p_key, n, left(coalesce(nullif(p_category, ''), 'altro'), 40), left(coalesce(nullif(p_unit, ''), 'pz'), 10), me);
    insert into public.community_product_users values (p_key, me) on conflict do nothing;
    return;
  end if;
  insert into public.community_product_users values (p_key, me) on conflict do nothing;
  if found then update public.community_products set uses = uses + 1, updated_at = now() where key = p_key; end if;
  -- chi l'ha creato può correggere il reparto finché lo usa solo lui
  if r.created_by = me and r.uses <= 1 and p_category is not null and p_category <> r.category_id then
    update public.community_products set category_id = left(p_category, 40), updated_at = now() where key = p_key;
  end if;
end $$;
revoke all on function public.register_custom_product(text, text, text, text) from public, anon;
grant execute on function public.register_custom_product(text, text, text, text) to authenticated;

-- prezzi dei prodotti scritti a mano visti da tutti: per negozio l'ultimo, e se è il mio (o della mia famiglia)
create or replace function public.custom_prices_all()
returns table (store_id text, key text, unit_price numeric, seen_on date, mine boolean)
language sql stable security definer set search_path = public as $$
  select distinct on (c.store_id, c.key) c.store_id, c.key, c.unit_price, c.seen_on,
         (c.owner_id = auth.uid() or c.owner_id = public.my_family()) as mine
  from public.custom_prices c
  where c.seen_on > current_date - 365
  order by c.store_id, c.key, c.seen_on desc, c.updated_at desc
$$;
revoke all on function public.custom_prices_all() from public, anon;
grant execute on function public.custom_prices_all() to authenticated;

-- i prodotti già scritti a mano finora (prezzi salvati) entrano subito
insert into public.community_products (key, name, unit, created_by)
select distinct on (key) key, name, unit, seen_by from public.custom_prices where public.custom_name_ok(name)
order by key, updated_at
on conflict (key) do nothing;
