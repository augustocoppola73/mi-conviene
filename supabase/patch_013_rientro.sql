-- =====================================================================
-- Gruppi (#14): "Sono Luca, rientro" — chi è entrato in un gruppo evento senza account e cambia telefono
-- (o cancella i dati del browser) riapre il link e torna "lui", invece di diventare un secondo Luca.
-- Vale solo per i membri SENZA account (quelli con email rientrano con l'email) e lo sanno tutti (avviso al gruppo).
-- Da eseguire una volta in Supabase → SQL Editor (dopo patch_012). Si può rieseguire.
-- =====================================================================

-- l'anteprima dell'invito di un gruppo evento elenca chi è dentro senza account (solo nome e id)
create or replace function public.invite_preview(c text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare i public.group_invites; f public.families; who text; back jsonb;
begin
  select * into i from public.group_invites where code = upper(regexp_replace(coalesce(c, ''), '[^A-Za-z0-9]', '', 'g'));
  if not found then return jsonb_build_object('valid', false, 'reason', 'Invito non trovato'); end if;
  if i.revoked then return jsonb_build_object('valid', false, 'reason', 'Questo invito è stato revocato'); end if;
  if i.expires_at <= now() then return jsonb_build_object('valid', false, 'reason', 'Questo invito è scaduto: chiedine uno nuovo'); end if;
  if i.max_uses is not null and i.uses >= i.max_uses then return jsonb_build_object('valid', false, 'reason', 'Questo invito è già stato usato: chiedine uno nuovo'); end if;
  select * into f from public.families where id = i.group_id;
  select display_name into who from public.group_members where group_id = i.group_id and user_id = i.created_by;
  if f.kind = 'evento' then
    select coalesce(jsonb_agg(jsonb_build_object('id', m.user_id, 'name', m.display_name) order by m.joined_at), '[]'::jsonb) into back
    from public.group_members m join auth.users u on u.id = m.user_id
    where m.group_id = f.id and coalesce(u.is_anonymous, false) and coalesce(trim(m.display_name), '') <> '';
  end if;
  return jsonb_build_object('valid', true, 'kind', f.kind, 'name', f.name, 'emoji', f.emoji,
    'invited_by', coalesce(who, 'Un amico'), 'needs_approval', i.needs_approval, 'expires_at', i.expires_at,
    'returning', coalesce(back, '[]'::jsonb));
end $$;

-- i passaggi "di servizio" (rientro) possono spostare un prodotto preso da un altro
create or replace function public.trg_group_item_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g uuid;
begin
  if me is null or current_setting('mc.rientro', true) = 'on' then return new; end if;
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
  if new.status is distinct from old.status then
    if new.assigned_to is null then new.assigned_to := me;
    elsif new.assigned_to <> me and not public.is_group_owner(g) then raise exception 'Lo sta prendendo un altro'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- rientro: il telefono nuovo prende il posto del vecchio account senza email (prodotti, "lo prendo io", spese)
create or replace function public.rejoin_as(c text, old uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); i public.group_invites; f public.families; m public.group_members;
begin
  if me is null then raise exception 'Entra prima nell''app'; end if;
  if (select count(*) from public.invite_attempts where user_id = me and not ok and at > now() - interval '1 hour') >= 10 then
    raise exception 'Troppi codici sbagliati: riprova tra un''ora';
  end if;
  select * into i from public.group_invites where code = upper(regexp_replace(coalesce(c, ''), '[^A-Za-z0-9]', '', 'g'));
  if not found or i.revoked or i.expires_at <= now() or (i.max_uses is not null and i.uses >= i.max_uses) then
    insert into public.invite_attempts (user_id, ok) values (me, false);
    return jsonb_build_object('status', 'invalid', 'reason', 'Invito non valido o scaduto: chiedine uno nuovo');
  end if;
  select * into f from public.families where id = i.group_id;
  if f.kind <> 'evento' then raise exception 'Il rientro vale solo per i gruppi'; end if;
  select * into m from public.group_members where group_id = f.id and user_id = old;
  if not found or old = me then raise exception 'Non trovo questa persona nel gruppo'; end if;
  if not exists (select 1 from auth.users where id = old and coalesce(is_anonymous, false)) then
    raise exception 'Questa persona ha un account con email: rientra con la sua email';
  end if;
  insert into public.invite_attempts (user_id, ok) values (me, true);
  perform set_config('mc.rientro', 'on', true);
  if public.is_member(f.id) then
    delete from public.group_members where group_id = f.id and user_id = me;   -- era entrato come "secondo Luca": lo fondo
  end if;
  insert into public.group_members (group_id, user_id, role, display_name, muted, excluded_from_split, joined_at)
  values (f.id, me, m.role, m.display_name, m.muted, m.excluded_from_split, m.joined_at);
  update public.group_list_items set added_by = me where added_by = old and list_id in (select id from public.group_lists where group_id = f.id);
  update public.group_list_items set assigned_to = me where assigned_to = old and list_id in (select id from public.group_lists where group_id = f.id);
  update public.group_expenses set paid_by = me where paid_by = old and group_id = f.id;
  delete from public.group_members where group_id = f.id and user_id = old;
  perform set_config('mc.rientro', 'off', true);
  update public.profiles set display_name = m.display_name, updated_at = now() where id = me and coalesce(display_name, '') = '';
  perform public.send_family_notification('gruppo_rientro', f.id, me,
    jsonb_build_object('group', true, 'group_name', f.name, 'group_emoji', f.emoji, 'name', m.display_name));
  return jsonb_build_object('status', 'joined', 'kind', 'evento', 'group_id', f.id);
end $$;
revoke all on function public.rejoin_as(text, uuid) from public, anon;
grant execute on function public.rejoin_as(text, uuid) to authenticated;

-- il rientro non è un "nuovo ingresso": niente doppio avviso
create or replace function public.trg_group_member_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare f public.families;
begin
  if current_setting('mc.rientro', true) = 'on' then return new; end if;
  select * into f from public.families where id = new.group_id;
  if f.kind = 'evento' and new.role = 'membro' then
    perform public.send_family_notification('gruppo_ingresso', f.id, new.user_id,
      jsonb_build_object('group', true, 'group_name', f.name, 'group_emoji', f.emoji, 'name', new.display_name));
  end if;
  return new;
end $$;
