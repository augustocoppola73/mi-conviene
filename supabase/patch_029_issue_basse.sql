-- Issue basse (#87 #89 #98 #99). Da eseguire una volta (dopo patch_028).

-- ---------------------------------------------------------------- #87: le date sono in ora italiana
-- (tra mezzanotte e le 2 current_date in UTC dava il giorno prima)
alter table public.user_prices alter column date set default (now() at time zone 'Europe/Rome')::date;
alter table public.group_expenses alter column spent_on set default (now() at time zone 'Europe/Rome')::date;
alter table public.custom_prices alter column seen_on set default (now() at time zone 'Europe/Rome')::date;
alter table public.saving_goals alter column start_date set default (now() at time zone 'Europe/Rome')::date;
do $$
declare f text;
begin
  foreach f in array array['save_custom_price(text, text, text, text, numeric)', 'set_saving_goal(text, numeric, date, boolean)',
    'custom_prices_all()', 'age_open_prices()'] loop
    begin
      execute format('alter function public.%s set timezone to %L', f, 'Europe/Rome');
    exception when undefined_function then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------- #89: notifiche più leggere e a nome giusto
-- l'indirizzo della funzione non è più scritto nel codice: sta in app_secrets (notify_url)
create table if not exists public.app_secrets (key text primary key, value text not null);
alter table public.app_secrets enable row level security;
insert into public.app_secrets (key, value) values ('notify_url', 'https://tkzbradzyuhcgkfkktlx.supabase.co/functions/v1/notifica')
  on conflict (key) do nothing;
create or replace function public.send_family_notification(p_kind text, p_family uuid, p_actor uuid, p_extra jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare s text; u text;
begin
  if p_family is null then return; end if;
  select value into s from public.app_secrets where key = 'notify_secret';
  select value into u from public.app_secrets where key = 'notify_url';
  if u is null then return; end if;
  perform net.http_post(
    url := u,
    body := jsonb_build_object('kind', p_kind, 'family_id', p_family, 'actor', p_actor) || coalesce(p_extra, '{}'::jsonb),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-mc-secret', s),
    timeout_milliseconds := 5000);
exception when others then
  null; -- una notifica che non parte non deve mai bloccare la spesa
end $$;
revoke all on function public.send_family_notification(text, uuid, uuid, jsonb) from public, anon, authenticated;

-- la spesa: il trigger scatta solo quando cambiano stato, chi la fa o le tappe (non a ogni spunta)
do $$
begin
  if to_regprocedure('public.trg_shop_notify()') is not null then
    drop trigger if exists shop_notify on public.shops;
    create trigger shop_notify after insert or update of status, taken_by, stops on public.shops
      for each row execute function public.trg_shop_notify();
  end if;
end $$;

-- la vecchia lista di famiglia: «chi ha cambiato» lo mette il database, non il telefono
create or replace function public.trg_family_list_stamp() returns trigger
language plpgsql as $$
begin
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists family_list_stamp on public.family_lists;
create trigger family_list_stamp before insert or update on public.family_lists
  for each row execute function public.trg_family_list_stamp();

-- ---------------------------------------------------------------- #98: togliere un membro da un gruppo evento
-- libera quello che doveva prendere (come quando esce) e chiede di saldare prima
create or replace function public.remove_member(g uuid, u uuid) returns void
language plpgsql security definer set search_path = public as $$
declare f public.families; owes numeric;
begin
  select * into f from public.families where id = g;
  if not found or not public.is_group_owner(g) then raise exception 'Solo il proprietario può togliere qualcuno'; end if;
  if u = auth.uid() then raise exception 'Per uscire usa "Esci"'; end if;
  if f.kind = 'famiglia' then
    update public.profiles set family_id = null, updated_at = now() where id = u and family_id = g;
    return;
  end if;
  select -b.balance into owes from public.group_balances(g) b where u = any(b.members);
  if coalesce(owes, 0) > 0.005 then
    raise exception 'Deve ancora % € al gruppo: prima segnate il pagamento nei Conti, poi toglilo',
      replace(to_char(owes, 'FM999990.00'), '.', ',');
  end if;
  update public.group_list_items set assigned_to = null, updated_at = now()
  where assigned_to = u and status = 'da_prendere' and list_id in (select id from public.group_lists where group_id = g);
  delete from public.group_members where group_id = g and user_id = u;
end $$;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- il piano della festa (tipo, adulti, bambini) sta nel gruppo: lo vedono tutti
alter table public.families add column if not exists event_plan jsonb;
create or replace function public.set_group_plan(g uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare f public.families;
begin
  select * into f from public.families where id = g;
  if not found or f.kind <> 'evento' or not public.is_member(g) then raise exception 'Gruppo non trovato'; end if;
  if f.add_policy = 'proprietario' and not public.is_group_owner(g) then return; end if;  -- propone: il piano resta di chi decide
  update public.families set event_plan = jsonb_build_object(
    'type', left(coalesce(p->>'type', 'grigliata'), 30),
    'adults', greatest(0, least(500, coalesce((p->>'adults')::int, 0))),
    'kids', greatest(0, least(500, coalesce((p->>'kids')::int, 0)))) where id = g;
end $$;
revoke all on function public.set_group_plan(uuid, jsonb) from public, anon;
grant execute on function public.set_group_plan(uuid, jsonb) to authenticated;

drop function if exists public.my_groups();
create function public.my_groups()
returns table (id uuid, name text, emoji text, event_date date, role text, members int, todo int, muted boolean, list_id uuid,
  add_policy text, proposals int, budget numeric, budget_per_head boolean, event_plan jsonb)
language sql stable security definer set search_path = public as $$
  select f.id, f.name, f.emoji, f.event_date, m.role,
    (select count(*)::int from public.group_members x where x.group_id = f.id),
    (select count(*)::int from public.group_list_items i join public.group_lists l on l.id = i.list_id
       where l.group_id = f.id and i.status = 'da_prendere'),
    m.muted,
    (select l.id from public.group_lists l where l.group_id = f.id order by l.created_at limit 1),
    f.add_policy,
    (select count(*)::int from public.group_list_items i join public.group_lists l on l.id = i.list_id
       where l.group_id = f.id and i.status = 'proposto'),
    f.budget, f.budget_per_head, f.event_plan
  from public.group_members m join public.families f on f.id = m.group_id
  where m.user_id = auth.uid() and f.kind = 'evento' and f.archived_at is null
  order by f.event_date nulls last, f.created_at
$$;
revoke all on function public.my_groups() from public, anon;
grant execute on function public.my_groups() to authenticated;

-- proposta rifiutata: chi l'ha proposta lo viene a sapere (per due giorni)
create table if not exists public.group_rejections (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.families on delete cascade,
  name text not null,
  proposed_by uuid not null references auth.users on delete cascade,
  rejected_name text,
  created_at timestamptz not null default now()
);
create index if not exists group_rejections_user_idx on public.group_rejections (proposed_by, created_at desc);
alter table public.group_rejections enable row level security;
drop policy if exists "rifiuti: chi ha proposto" on public.group_rejections;
create policy "rifiuti: chi ha proposto" on public.group_rejections for select to authenticated using (proposed_by = auth.uid());
drop policy if exists "rifiuti: chi ha proposto toglie" on public.group_rejections;
create policy "rifiuti: chi ha proposto toglie" on public.group_rejections for delete to authenticated using (proposed_by = auth.uid());
revoke all on public.group_rejections from anon;
grant select, delete on public.group_rejections to authenticated;

create or replace function public.trg_group_item_rejected() returns trigger
language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  if old.status = 'proposto' and old.added_by is not null and auth.uid() is distinct from old.added_by then
    select group_id into g from public.group_lists where id = old.list_id;
    if g is not null and exists (select 1 from public.group_members where group_id = g and user_id = old.added_by) then
      insert into public.group_rejections (group_id, name, proposed_by, rejected_name)
      values (g, coalesce(old.name, old.product_id), old.added_by,
              (select display_name from public.group_members where group_id = g and user_id = auth.uid()));
    end if;
  end if;
  return old;
end $$;
drop trigger if exists group_item_rejected on public.group_list_items;
create trigger group_item_rejected after delete on public.group_list_items
  for each row execute function public.trg_group_item_rejected();

-- ---------------------------------------------------------------- #99: spesa annullata e Salvadanaio
-- chi annulla sceglie se togliere il risparmio stimato; se la voce è di un familiare resta, a zero e segnata «annullata»
create or replace function public.cancel_shop_saving(p_shop uuid, p_drop boolean) returns text
language plpgsql security definer set search_path = public as $$
declare s public.shops; v public.savings; me uuid := auth.uid(); nm text;
begin
  select * into s from public.shops where id = p_shop;
  if not found or s.status <> 'cancelled' or s.saving_id is null then return 'none'; end if;
  if coalesce((s.taken_by->>'user_id')::uuid, s.user_id) <> me then raise exception 'La annulla chi la stava facendo'; end if;
  select * into v from public.savings where id = s.saving_id;
  if not found or v.verified then return 'none'; end if;
  if v.user_id = me then
    if not p_drop then return 'kept'; end if;
    delete from public.savings where id = v.id;
    return 'deleted';
  end if;
  if not public.same_account(v.user_id, me) then return 'none'; end if;
  select display_name into nm from public.profiles where id = me;
  update public.savings set data = data || jsonb_build_object(
      'cancelled', true, 'cancelled_amount', coalesce(data->'amount', '0'::jsonb), 'amount', 0,
      'fuel_saving', 0, 'cancelled_by', coalesce(nm, 'un familiare'))
  where id = v.id;
  return 'marked';
end $$;
revoke all on function public.cancel_shop_saving(uuid, boolean) from public, anon;
grant execute on function public.cancel_shop_saving(uuid, boolean) to authenticated;

-- pulizia notturna: anche gli avvisi di proposta rifiutata vecchi
create or replace function public.nightly_cleanup() returns jsonb language plpgsql security definer set search_path = public as $$
declare promos int; shops_old int; aged int;
begin
  delete from public.user_prices where kind = 'offerta' and promo_until < (now() at time zone 'Europe/Rome')::date - 1;
  get diagnostics promos = row_count;
  update public.shops set status = 'cancelled' where status = 'active' and updated_at < now() - interval '30 days';
  get diagnostics shops_old = row_count;
  aged := public.age_open_prices();
  delete from public.group_rejections where created_at < now() - interval '2 days';
  return jsonb_build_object('expired_promos', promos, 'abandoned_shops', shops_old, 'aged_open_promos', aged);
end $$;
revoke execute on function public.nightly_cleanup() from public, anon, authenticated;
