-- #26: prezzi dei prodotti scritti a mano ("custom:..."), ricordati per negozio.
-- Sono della famiglia (o della persona senza famiglia): nomi liberi, non si condividono con tutti.
create table if not exists public.custom_prices (
  owner_id uuid not null,                       -- id della famiglia, oppure dell'utente se non ha famiglia
  store_id text not null,
  key text not null,                            -- "custom:idropulsore"
  name text not null,
  unit text not null default 'pz',
  unit_price numeric(9,2) not null check (unit_price > 0),
  seen_on date not null default current_date,
  seen_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, store_id, key)
);
alter table public.custom_prices enable row level security;

drop policy if exists "prezzi a mano: miei e famiglia" on public.custom_prices;
create policy "prezzi a mano: miei e famiglia" on public.custom_prices for select to authenticated
  using (owner_id = auth.uid() or owner_id = public.my_family());
drop policy if exists "prezzi a mano: tolgo miei e famiglia" on public.custom_prices;
create policy "prezzi a mano: tolgo miei e famiglia" on public.custom_prices for delete to authenticated
  using (owner_id = auth.uid() or owner_id = public.my_family());

-- si scrive solo da qui: il proprietario lo decide il database (famiglia se c'è, altrimenti io)
create or replace function public.save_custom_price(p_store text, p_key text, p_name text, p_unit text, p_unit_price numeric)
returns void language plpgsql security definer set search_path = public as $$
declare o uuid := coalesce(public.my_family(), auth.uid());
begin
  if auth.uid() is null then raise exception 'Serve un accesso'; end if;
  if p_key is null or left(p_key, 7) <> 'custom:' then raise exception 'Solo per i prodotti scritti a mano'; end if;
  if p_unit_price is null or p_unit_price <= 0 or p_unit_price > 99999 then raise exception 'Prezzo non valido'; end if;
  insert into public.custom_prices (owner_id, store_id, key, name, unit, unit_price, seen_on, seen_by, updated_at)
  values (o, left(p_store, 60), left(p_key, 120), left(coalesce(nullif(trim(p_name), ''), substr(p_key, 8)), 120),
          left(coalesce(p_unit, 'pz'), 10), round(p_unit_price, 2), current_date, auth.uid(), now())
  on conflict (owner_id, store_id, key) do update
    set name = excluded.name, unit = excluded.unit, unit_price = excluded.unit_price,
        seen_on = excluded.seen_on, seen_by = excluded.seen_by, updated_at = now();
end $$;
revoke all on function public.save_custom_price(text, text, text, text, numeric) from public, anon;
grant execute on function public.save_custom_price(text, text, text, text, numeric) to authenticated;
grant select, delete on public.custom_prices to authenticated;
