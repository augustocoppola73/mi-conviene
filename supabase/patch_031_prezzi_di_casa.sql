-- #104: i prezzi visti da me e dalla mia famiglia, per usarli subito nei miei confronti (prima di quelli degli altri).
-- Da eseguire una volta (dopo patch_030).
create index if not exists user_prices_user_idx on public.user_prices (user_id, created_at desc);

-- l'ultimo prezzo per negozio, prodotto e tipo visto da me o dalla famiglia (ultimi 400 giorni), senza dire chi
create or replace function public.family_prices()
returns table (store_id text, product_id text, kind text, ref_price numeric, paid numeric, receipt_text text, note text,
  location_name text, date date, promo_until date, created_at timestamptz, mine boolean)
language sql stable security definer set search_path = public as $$
  select distinct on (u.store_id, u.product_id, u.kind)
    u.store_id, u.product_id, u.kind, u.ref_price, u.paid, u.receipt_text, u.note, u.location_name, u.date, u.promo_until, u.created_at,
    u.user_id = auth.uid()
  from public.user_prices u
  where auth.uid() is not null
    and (u.user_id = auth.uid() or (public.my_family() is not null and u.user_id in (select id from public.profiles where family_id = public.my_family())))
    and u.date > (now() at time zone 'Europe/Rome')::date - 400
  order by u.store_id, u.product_id, u.kind, u.date desc, u.created_at desc
$$;
revoke all on function public.family_prices() from public, anon;
grant execute on function public.family_prices() to authenticated;

insert into public.schema_migrations (name) values ('patch_031') on conflict do nothing;
