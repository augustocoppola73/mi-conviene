-- =====================================================================
-- Gruppi F3 (#14): gruppi evento con nome, emoji e data; lista condivisa una riga per prodotto, "Lo prendo io".
-- Da eseguire una volta in Supabase → SQL Editor (dopo patch_011). Si può rieseguire.
--   - crea / modifica / esci da un gruppo evento (chi entra senza account non può crearne: D2)
--   - "Lo prendo io": prendo solo un prodotto libero, lascio solo il mio (o il proprietario)
--   - avvisi ai membri del gruppo (silenziabili gruppo per gruppo con group_members.muted)
-- =====================================================================

-- nuovo gruppo evento: chi lo crea è il proprietario; c'è subito una lista
create or replace function public.create_group(p_name text, p_emoji text default null, p_date date default null)
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
  insert into public.families (kind, name, emoji, event_date, created_by)
  values ('evento', nm, nullif(left(coalesce(p_emoji, ''), 8), ''), p_date, me)
  returning * into f;
  select display_name into who from public.profiles where id = me;
  insert into public.group_members (group_id, user_id, role, display_name) values (f.id, me, 'proprietario', who);
  insert into public.group_lists (group_id, name, created_by) values (f.id, 'Lista', me);
  return f;
end $$;

-- il proprietario cambia nome, emoji, data
create or replace function public.update_group(g uuid, p_name text, p_emoji text default null, p_date date default null)
returns public.families
language plpgsql security definer set search_path = public as $$
declare f public.families; nm text;
begin
  select * into f from public.families where id = g;
  if not found or f.kind <> 'evento' or not public.is_group_owner(g) then raise exception 'Può cambiarlo solo chi ha creato il gruppo'; end if;
  nm := nullif(trim(left(coalesce(p_name, ''), 40)), '');
  if nm is null then raise exception 'Dai un nome al gruppo'; end if;
  update public.families set name = nm, emoji = nullif(left(coalesce(p_emoji, ''), 8), ''), event_date = p_date
  where id = g returning * into f;
  return f;
end $$;

-- esco da un gruppo evento: se ero il proprietario passa a chi è dentro da più tempo; se resto l'ultimo, il gruppo sparisce
create or replace function public.leave_group(g uuid) returns void
language plpgsql security definer set search_path = public as $$
declare f public.families; was_owner boolean; nxt uuid;
begin
  select * into f from public.families where id = g;
  if not found or f.kind <> 'evento' then raise exception 'Gruppo non trovato'; end if;
  if not public.is_member(g) then return; end if;
  was_owner := public.is_group_owner(g);
  -- quello che avevo preso e non ancora comprato torna libero
  update public.group_list_items set assigned_to = null, updated_at = now()
  where assigned_to = auth.uid() and status = 'da_prendere' and list_id in (select id from public.group_lists where group_id = g);
  delete from public.group_members where group_id = g and user_id = auth.uid();
  if not exists (select 1 from public.group_members where group_id = g) then
    delete from public.families where id = g;
    return;
  end if;
  if was_owner then
    select user_id into nxt from public.group_members where group_id = g order by joined_at, user_id limit 1;
    update public.group_members set role = 'proprietario' where group_id = g and user_id = nxt;
  end if;
end $$;

-- i miei gruppi evento, con i numeri per la lista dei gruppi
create or replace function public.my_groups()
returns table (id uuid, name text, emoji text, event_date date, role text, members int, todo int, muted boolean, list_id uuid)
language sql stable security definer set search_path = public as $$
  select f.id, f.name, f.emoji, f.event_date, m.role,
    (select count(*)::int from public.group_members x where x.group_id = f.id),
    (select count(*)::int from public.group_list_items i join public.group_lists l on l.id = i.list_id
       where l.group_id = f.id and i.status = 'da_prendere'),
    m.muted,
    (select l.id from public.group_lists l where l.group_id = f.id order by l.created_at limit 1)
  from public.group_members m join public.families f on f.id = m.group_id
  where m.user_id = auth.uid() and f.kind = 'evento' and f.archived_at is null
  order by f.event_date nulls last, f.created_at
$$;

revoke all on function public.create_group(text, text, date), public.update_group(uuid, text, text, date),
  public.leave_group(uuid), public.my_groups() from public, anon;
grant execute on function public.create_group(text, text, date), public.update_group(uuid, text, text, date),
  public.leave_group(uuid), public.my_groups() to authenticated;

-- ---------------------------------------------------------------- "Lo prendo io"
-- regole sulle righe della lista (oltre ai permessi): niente "rubare" un prodotto preso da un altro
create or replace function public.trg_group_item_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g uuid;
begin
  if me is null then return new; end if;   -- dal database (es. pulizie): nessun controllo
  g := public.list_group(new.list_id);
  if tg_op = 'INSERT' then
    new.added_by := me;
    new.assigned_to := null;
    new.status := 'da_prendere';
    new.paid_price := null;
    return new;
  end if;
  if new.list_id <> old.list_id then raise exception 'Non si sposta un prodotto tra liste'; end if;
  if new.assigned_to is distinct from old.assigned_to then
    if new.assigned_to is null then
      if old.assigned_to <> me and not public.is_group_owner(g) then raise exception 'Lo sta prendendo un altro'; end if;
    elsif new.assigned_to <> me then
      raise exception 'Puoi prendere solo per te';
    elsif old.assigned_to is not null then
      raise exception 'Lo sta già prendendo un altro';
    end if;
  end if;
  -- spuntare "preso" o "mancava": se nessuno l'aveva preso, è mio; se l'ha preso un altro, solo lui (o il proprietario)
  if new.status is distinct from old.status then
    if new.assigned_to is null then new.assigned_to := me;
    elsif new.assigned_to <> me and not public.is_group_owner(g) then raise exception 'Lo sta prendendo un altro'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists group_item_guard on public.group_list_items;
create trigger group_item_guard before insert or update on public.group_list_items
  for each row execute function public.trg_group_item_guard();

-- ---------------------------------------------------------------- avvisi del gruppo
create or replace function public.trg_group_item_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare f public.families;
begin
  select * into f from public.families where id = public.list_group(new.list_id);
  if f.kind = 'evento' then
    perform public.send_family_notification('gruppo_lista', f.id, new.added_by,
      jsonb_build_object('group', true, 'group_name', f.name, 'group_emoji', f.emoji, 'item', coalesce(new.name, new.product_id)));
  end if;
  return new;
end $$;
drop trigger if exists group_item_notify on public.group_list_items;
create trigger group_item_notify after insert on public.group_list_items
  for each row execute function public.trg_group_item_notify();

create or replace function public.trg_group_member_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare f public.families;
begin
  select * into f from public.families where id = new.group_id;
  if f.kind = 'evento' and new.role = 'membro' then
    perform public.send_family_notification('gruppo_ingresso', f.id, new.user_id,
      jsonb_build_object('group', true, 'group_name', f.name, 'group_emoji', f.emoji, 'name', new.display_name));
  end if;
  return new;
end $$;
drop trigger if exists group_member_notify on public.group_members;
create trigger group_member_notify after insert on public.group_members
  for each row execute function public.trg_group_member_notify();

-- i membri di un gruppo evento si vedono tra loro con il nome (già: "membri: dei miei gruppi");
-- la lista e i prodotti seguono le regole di patch_010; il tempo reale è già attivo su group_list_items
