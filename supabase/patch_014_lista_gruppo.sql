-- =====================================================================
-- Gruppi F3b (#21): lista del gruppo nella scheda Lista, proposte, niente doppioni, la mia parte nella mia spesa.
-- Da eseguire una volta in Supabase → SQL Editor (dopo patch_013). Si può rieseguire.
-- =====================================================================

-- chi aggiunge alla lista: tutti, oppure solo il proprietario (gli altri propongono)
alter table public.families add column if not exists add_policy text not null default 'tutti';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'families_add_policy_check') then
    alter table public.families add constraint families_add_policy_check check (add_policy in ('tutti', 'proprietario'));
  end if;
end $$;

-- nuovo stato "proposto" (in attesa che il proprietario lo aggiunga)
alter table public.group_list_items drop constraint if exists group_list_items_status_check;
alter table public.group_list_items add constraint group_list_items_status_check
  check (status in ('proposto', 'da_prendere', 'preso', 'mancava'));

-- niente doppioni: lo stesso prodotto del catalogo una volta sola tra quelli ancora da prendere
-- (prima unisco eventuali doppioni già presenti, sommando le quantità)
with d as (
  select id, row_number() over (partition by list_id, product_id order by created_at) rn,
         sum(quantity) over (partition by list_id, product_id) tot
  from public.group_list_items
  where status in ('da_prendere', 'proposto') and product_id not like 'custom:%' and assigned_to is null
)
update public.group_list_items i set quantity = d.tot from d where i.id = d.id and d.rn = 1 and d.tot <> i.quantity;
delete from public.group_list_items i using (
  select id, row_number() over (partition by list_id, product_id order by created_at) rn
  from public.group_list_items
  where status in ('da_prendere', 'proposto') and product_id not like 'custom:%' and assigned_to is null
) d where i.id = d.id and d.rn > 1;
create unique index if not exists group_list_items_unico on public.group_list_items (list_id, product_id)
  where status in ('da_prendere', 'proposto') and product_id not like 'custom:%';

-- creare / modificare con la regola su chi aggiunge
drop function if exists public.create_group(text, text, date);
create or replace function public.create_group(p_name text, p_emoji text default null, p_date date default null, p_policy text default 'tutti')
returns public.families
language plpgsql security definer set search_path = public as $$
declare f public.families; nm text; me uuid := auth.uid(); who text;
begin
  if me is null then raise exception 'Entra prima nell''app'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Per creare un gruppo salva prima il tuo accesso con l''email (Profilo › Account)';
  end if;
  nm := nullif(trim(left(coalesce(p_name, ''), 40)), '');
  if nm is null then raise exception 'Dai un nome al gruppo'; end if;
  if (select count(*) from public.group_members m join public.families x on x.id = m.group_id
      where m.user_id = me and m.role = 'proprietario' and x.kind = 'evento' and x.archived_at is null) >= 20 then
    raise exception 'Hai già 20 gruppi: chiudine qualcuno';
  end if;
  insert into public.families (kind, name, emoji, event_date, created_by, add_policy)
  values ('evento', nm, nullif(left(coalesce(p_emoji, ''), 8), ''), p_date, me,
    case when p_policy = 'proprietario' then 'proprietario' else 'tutti' end)
  returning * into f;
  select display_name into who from public.profiles where id = me;
  insert into public.group_members (group_id, user_id, role, display_name) values (f.id, me, 'proprietario', who);
  insert into public.group_lists (group_id, name, created_by) values (f.id, 'Lista', me);
  return f;
end $$;

drop function if exists public.update_group(uuid, text, text, date);
create or replace function public.update_group(g uuid, p_name text, p_emoji text default null, p_date date default null, p_policy text default null)
returns public.families
language plpgsql security definer set search_path = public as $$
declare f public.families; nm text;
begin
  select * into f from public.families where id = g;
  if not found or f.kind <> 'evento' or not public.is_group_owner(g) then raise exception 'Può cambiarlo solo chi ha creato il gruppo'; end if;
  nm := nullif(trim(left(coalesce(p_name, ''), 40)), '');
  if nm is null then raise exception 'Dai un nome al gruppo'; end if;
  update public.families set name = nm, emoji = nullif(left(coalesce(p_emoji, ''), 8), ''), event_date = p_date,
    add_policy = case when p_policy in ('tutti', 'proprietario') then p_policy else add_policy end
  where id = g returning * into f;
  return f;
end $$;

drop function if exists public.my_groups();
create or replace function public.my_groups()
returns table (id uuid, name text, emoji text, event_date date, role text, members int, todo int, muted boolean, list_id uuid,
  add_policy text, proposals int)
language sql stable security definer set search_path = public as $$
  select f.id, f.name, f.emoji, f.event_date, m.role,
    (select count(*)::int from public.group_members x where x.group_id = f.id),
    (select count(*)::int from public.group_list_items i join public.group_lists l on l.id = i.list_id
       where l.group_id = f.id and i.status = 'da_prendere'),
    m.muted,
    (select l.id from public.group_lists l where l.group_id = f.id order by l.created_at limit 1),
    f.add_policy,
    (select count(*)::int from public.group_list_items i join public.group_lists l on l.id = i.list_id
       where l.group_id = f.id and i.status = 'proposto')
  from public.group_members m join public.families f on f.id = m.group_id
  where m.user_id = auth.uid() and f.kind = 'evento' and f.archived_at is null
  order by f.event_date nulls last, f.created_at
$$;

-- i prodotti che prendo io nei miei gruppi (per la mia lista di casa)
create or replace function public.my_group_items()
returns table (id uuid, group_id uuid, group_name text, group_emoji text, product_id text, name text, quantity numeric, unit text, category_id text)
language sql stable security definer set search_path = public as $$
  select i.id, f.id, f.name, f.emoji, i.product_id, i.name, i.quantity, i.unit, i.category_id
  from public.group_list_items i join public.group_lists l on l.id = i.list_id join public.families f on f.id = l.group_id
  where i.assigned_to = auth.uid() and i.status = 'da_prendere' and f.archived_at is null and public.is_member(f.id)
  order by f.name, i.created_at
$$;

revoke all on function public.create_group(text, text, date, text), public.update_group(uuid, text, text, date, text),
  public.my_groups(), public.my_group_items() from public, anon;
grant execute on function public.create_group(text, text, date, text), public.update_group(uuid, text, text, date, text),
  public.my_groups(), public.my_group_items() to authenticated;

-- regole sulle righe: proposte, quantità, "lo prendo io"
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

-- togliere: chi l'ha aggiunto o il proprietario, finché nessuno l'ha preso (anche le proposte)
drop policy if exists "prodotti gruppo: tolgo" on public.group_list_items;
create policy "prodotti gruppo: tolgo" on public.group_list_items for delete to authenticated
  using (public.is_member(public.list_group(list_id)) and status in ('da_prendere', 'proposto') and assigned_to is null
         and (added_by = auth.uid() or public.is_group_owner(public.list_group(list_id))));

-- avvisi: una proposta avvisa il gruppo come un prodotto nuovo (al proprietario serve saperlo)
create or replace function public.trg_group_item_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare f public.families;
begin
  select * into f from public.families where id = public.list_group(new.list_id);
  if f.kind = 'evento' then
    perform public.send_family_notification(case when new.status = 'proposto' then 'gruppo_proposta' else 'gruppo_lista' end, f.id, new.added_by,
      jsonb_build_object('group', true, 'group_name', f.name, 'group_emoji', f.emoji, 'item', coalesce(new.name, new.product_id)));
  end if;
  return new;
end $$;
