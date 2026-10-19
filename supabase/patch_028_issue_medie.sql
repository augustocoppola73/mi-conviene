-- =====================================================================
-- Issue medie: permessi della lista del gruppo (#79), limiti del database (#85), offerte che scadono (#86), residui (#102).
-- Da eseguire una volta in Supabase → SQL Editor (dopo patch_027). Si può rieseguire.
-- =====================================================================

-- ---------------------------------------------------------------- #79
create or replace function public.trg_group_item_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g uuid; pol text; own boolean;
begin
  if me is null or current_setting('mc.rientro', true) = 'on' then return new; end if;
  g := public.list_group(new.list_id);
  own := public.is_group_owner(g);
  if tg_op = 'INSERT' then
    select add_policy into pol from public.families where id = g;
    new.added_by := me;
    new.assigned_to := null;
    new.status := case when pol = 'proprietario' and not own then 'proposto' else 'da_prendere' end;
    new.paid_price := null;
    return new;
  end if;
  if new.list_id <> old.list_id then raise exception 'Non si sposta un prodotto tra liste'; end if;
  -- proposte: le accetta solo il proprietario; finché è proposto nessuno lo prende
  if old.status = 'proposto' and new.status is distinct from old.status then
    if not own then raise exception 'Lo aggiunge chi ha creato il gruppo'; end if;
    if new.status <> 'da_prendere' then raise exception 'Prima va aggiunto alla lista'; end if;
  end if;
  if new.status = 'proposto' and new.assigned_to is not null then raise exception 'È ancora una proposta'; end if;
  if new.status = 'proposto' and old.status <> 'proposto' then raise exception 'Non si torna a proposta'; end if;
  if new.assigned_to is distinct from old.assigned_to then
    if new.assigned_to is null then
      if old.assigned_to <> me and not own then raise exception 'Lo sta prendendo un altro'; end if;
    elsif new.assigned_to <> me then
      raise exception 'Puoi prendere solo per te';
    elsif old.assigned_to is not null then
      raise exception 'Lo sta già prendendo un altro';
    end if;
  end if;
  -- #79: nome, unità, reparto e prezzo li cambia solo chi lo prende (o chi l'ha aggiunto se è libero, o il proprietario)
  if (new.name is distinct from old.name or new.unit is distinct from old.unit or new.category_id is distinct from old.category_id
      or new.paid_price is distinct from old.paid_price or new.kind is distinct from old.kind or new.product_id is distinct from old.product_id)
     and not own and coalesce(old.assigned_to, old.added_by) is distinct from me then
    raise exception 'Questo prodotto lo cambia chi lo prende o chi l''ha aggiunto';
  end if;
  -- #79: con la regola «solo il proprietario aggiunge» gli altri non cambiano le quantità (propongono), tranne quello che prendono loro
  select add_policy into pol from public.families where id = g;
  if pol = 'proprietario' and not own and new.quantity is distinct from old.quantity and old.assigned_to is distinct from me then
    raise exception 'In questo gruppo le quantità le decide chi l''ha creato: proponi un prodotto';
  end if;
  -- quantità: chiunque finché è libero; poi solo chi lo prende (o il proprietario)
  if new.quantity is distinct from old.quantity and old.assigned_to is not null and old.assigned_to <> me and not own then
    raise exception 'Lo prende %: chiedi a lui di cambiare la quantità', coalesce((select display_name from public.group_members where group_id = g and user_id = old.assigned_to), 'un altro');
  end if;
  if new.status is distinct from old.status then
    if new.assigned_to is null then
      if new.status <> 'da_prendere' then new.assigned_to := me; end if;   -- spuntato senza "lo prendo io": è mio
    elsif new.assigned_to <> me and not own then raise exception 'Lo sta prendendo un altro'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- i codici d'invito di un gruppo evento li vede solo chi l'ha creato (in famiglia tutti)
create or replace function public.group_open_invites(g uuid)
returns table (code text, expires_at timestamptz, uses int, max_uses int, created_by_name text)
language sql stable security definer set search_path = public as $$
  select i.code, i.expires_at, i.uses, i.max_uses, m.display_name
  from public.group_invites i left join public.group_members m on m.group_id = i.group_id and m.user_id = i.created_by
  where i.group_id = g and public.is_member(g) and not i.revoked and i.expires_at > now()
    and (i.max_uses is null or i.uses < i.max_uses)
    and ((select kind from public.families where id = g) <> 'evento' or public.is_group_owner(g))
  order by i.created_at desc
$$;

-- ---------------------------------------------------------------- #85: niente funzioni per chi non è entrato; indici
alter default privileges in schema public revoke execute on functions from public, anon;
do $$
declare f text;
begin
  foreach f in array array['create_family()', 'join_family(text)', 'leave_family()', 'family_members()', 'in_my_family(uuid)',
    'list_group(uuid)', 'is_member(uuid)', 'is_group_owner(uuid)', 'my_family()'] loop
    begin
      execute format('revoke execute on function public.%s from public, anon', f);
      execute format('grant execute on function public.%s to authenticated', f);
    exception when undefined_function then null;
    end;
  end loop;
end $$;
create index if not exists recipes_user_idx on public.recipes (user_id);
create index if not exists recipes_family_idx on public.recipes (family_id);
create index if not exists profiles_family_idx on public.profiles (family_id);
create index if not exists push_tokens_user_idx on public.push_tokens (user_id);
create index if not exists group_settlements_group_idx on public.group_settlements (group_id);
create index if not exists group_join_requests_user_idx on public.group_join_requests (user_id);
create index if not exists shops_family_idx on public.shops (family_id);

-- chi esce (o viene tolto) dalla famiglia si riporta via le sue ricette e la sua spesa in corso (lo fa il database, non il telefono)
create or replace function public.trg_family_leave_things() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.family_id is not null and new.family_id is distinct from old.family_id then
    update public.recipes set family_id = new.family_id where user_id = new.id and family_id = old.family_id;
    update public.shops set family_id = new.family_id where user_id = new.id and family_id = old.family_id and status = 'active';
  end if;
  return new;
end $$;
drop trigger if exists profiles_family_leave_things on public.profiles;
create trigger profiles_family_leave_things after update of family_id on public.profiles
  for each row execute function public.trg_family_leave_things();

-- prezzi dei prodotti scritti a mano: le chiavi con numeri di telefono, link o parolacce restano della famiglia
create or replace function public.custom_prices_all()
returns table (store_id text, key text, unit_price numeric, seen_on date, mine boolean)
language sql stable security definer set search_path = public as $$
  select distinct on (c.store_id, c.key) c.store_id, c.key, c.unit_price, c.seen_on,
         coalesce(c.owner_id = auth.uid() or c.owner_id = public.my_family(), false) as mine
  from public.custom_prices c
  where c.seen_on > current_date - 365
    and (c.owner_id = auth.uid() or c.owner_id = public.my_family() or public.custom_name_ok(replace(substr(c.key, 8), '-', ' ')))
  order by c.store_id, c.key, c.seen_on desc, c.updated_at desc
$$;
revoke all on function public.custom_prices_all() from public, anon;
grant execute on function public.custom_prices_all() to authenticated;

-- ---------------------------------------------------------------- #86: le offerte e la fiducia invecchiano
create or replace function public.age_open_prices() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.product_prices set promo_price = null
  where promo_price is not null and observed_at is not null and observed_at < current_date - 21;
  get diagnostics n = row_count;
  update public.product_prices set confidence = case when observed_at < current_date - 180 then 'red' else 'yellow' end
  where observed_at is not null and observed_at < current_date - 60 and confidence = 'green';
  update public.product_prices set confidence = 'red'
  where observed_at is not null and observed_at < current_date - 180 and confidence = 'yellow';
  return n;
end $$;
revoke execute on function public.age_open_prices() from public, anon, authenticated;

create or replace function public.nightly_cleanup() returns jsonb language plpgsql security definer set search_path = public as $$
declare promos int; shops_old int; aged int;
begin
  delete from public.user_prices where kind = 'offerta' and promo_until < current_date - 1;
  get diagnostics promos = row_count;
  update public.shops set status = 'cancelled' where status = 'active' and updated_at < now() - interval '30 days';
  get diagnostics shops_old = row_count;
  aged := public.age_open_prices();
  return jsonb_build_object('expired_promos', promos, 'abandoned_shops', shops_old, 'aged_open_promos', aged);
end $$;
revoke execute on function public.nightly_cleanup() from public, anon, authenticated;
select public.age_open_prices();

-- ---------------------------------------------------------------- #102: chi deve soldi al gruppo salda prima di uscire
create or replace function public.leave_group(g uuid) returns void
language plpgsql security definer set search_path = public as $$
declare f public.families; was_owner boolean; nxt uuid;
begin
  select * into f from public.families where id = g;
  if not found or f.kind <> 'evento' then raise exception 'Gruppo non trovato'; end if;
  if not public.is_member(g) then return; end if;
  -- #102: chi deve ancora dei soldi al gruppo prima salda (poi non vedrebbe più i conti)
  if coalesce((select -b.balance from public.group_balances(g) b where auth.uid() = any(b.members)), 0) > 0.005
     and (select count(*) from public.group_members where group_id = g) > 1 then
    raise exception 'Devi ancora % € al gruppo: prima segna «Gli ho dato i soldi» nei Conti, poi esci',
      replace(to_char((select -b.balance from public.group_balances(g) b where auth.uid() = any(b.members)), 'FM999990.00'), '.', ',');
  end if;
  if (select count(*) from public.group_members where group_id = g) <= 1 then
    update public.families set archived_at = now() where id = g;
    return;
  end if;
  was_owner := public.is_group_owner(g);
  update public.group_list_items set assigned_to = null, updated_at = now()
  where assigned_to = auth.uid() and status = 'da_prendere' and list_id in (select id from public.group_lists where group_id = g);
  delete from public.group_members where group_id = g and user_id = auth.uid();
  if was_owner then
    select m.user_id into nxt from public.group_members m left join auth.users u on u.id = m.user_id
    where m.group_id = g order by coalesce(u.is_anonymous, false), m.joined_at, m.user_id limit 1;
    update public.group_members set role = 'proprietario' where group_id = g and user_id = nxt;
  end if;
end $$;

-- #102: entrando in famiglia l'obiettivo personale non si cancella: resta da parte (torna se esci) e si vede quello di famiglia
create or replace function public.trg_goal_follow_family() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.family_id is not null and new.family_id is distinct from old.family_id
     and not exists (select 1 from public.saving_goals where owner_id = new.family_id) then
    update public.saving_goals set owner_id = new.family_id, updated_at = now() where owner_id = new.id;
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
