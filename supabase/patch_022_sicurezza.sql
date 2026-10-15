-- =====================================================================
-- Sicurezza e privacy (sessione QA): #52 famiglia altrui, #53 prezzi falsi, #54 privacy dei prezzi,
-- #55 lista del gruppo cancellabile, #58 rientro con l'ok del proprietario.
-- Da eseguire una volta in Supabase → SQL Editor (dopo patch_021). Si può rieseguire.
-- =====================================================================

-- ---------------------------------------------------------------- #52: spesa e ricette solo nella MIA famiglia
drop policy if exists "spesa: creo la mia" on public.shops;
create policy "spesa: creo la mia" on public.shops for insert to authenticated
  with check (user_id = auth.uid() and (family_id is null or family_id = public.my_family()));
drop policy if exists "spesa: smarco mia e famiglia" on public.shops;
create policy "spesa: smarco mia e famiglia" on public.shops for update to authenticated
  using (user_id = auth.uid() or (family_id is not null and family_id = public.my_family()))
  with check (user_id = auth.uid() or (family_id is not null and family_id = public.my_family()));

drop policy if exists "ricette: creo" on public.recipes;
create policy "ricette: creo" on public.recipes for insert to authenticated
  with check (user_id = auth.uid() and (family_id is null or family_id = public.my_family()));
drop policy if exists "ricette: modifico mie e famiglia" on public.recipes;
create policy "ricette: modifico mie e famiglia" on public.recipes for update to authenticated
  using (user_id = auth.uid() or (family_id is not null and family_id = public.my_family()))
  with check (user_id = auth.uid() or (family_id is not null and family_id = public.my_family()));

-- chi ha creato la spesa / la ricetta non cambia; la famiglia si può cambiare solo verso la mia (o nessuna)
create or replace function public.trg_owner_family_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;                       -- lavori del server (chiave segreta)
  if new.user_id is distinct from old.user_id then raise exception 'Non si cambia chi l''ha creata'; end if;
  if new.family_id is distinct from old.family_id then
    if old.user_id <> auth.uid() then raise exception 'Solo chi l''ha creata la sposta'; end if;
    if new.family_id is not null and new.family_id is distinct from public.my_family() then
      raise exception 'Puoi metterla solo nella tua famiglia';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists shops_owner_guard on public.shops;
create trigger shops_owner_guard before update on public.shops for each row execute function public.trg_owner_family_guard();
drop trigger if exists recipes_owner_guard on public.recipes;
create trigger recipes_owner_guard before update on public.recipes for each row execute function public.trg_owner_family_guard();

-- ---------------------------------------------------------------- #53: prezzi visti dagli utenti con regole
-- righe fuori scala scartate in silenzio (lo scontrino si salva lo stesso), date e offerte riportate nei limiti
create or replace function public.trg_user_price_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare oggi date := (now() at time zone 'Europe/Rome')::date; ref numeric;
begin
  if auth.uid() is null then return new; end if;
  if new.date is null or new.date > oggi + 1 then new.date := oggi; end if;
  if new.date < oggi - 400 then return null; end if;
  if new.promo_until is not null and new.promo_until > new.date + 62 then new.promo_until := new.date + 62; end if;
  if new.ref_price is null or new.ref_price < 0.05 or new.ref_price > 2000 then return null; end if;
  if new.paid is not null and (new.paid <= 0 or new.paid > 5000) then return null; end if;
  -- confronto con Open Prices (stesso negozio, o la mediana delle catene): più di 8 volte sopra o sotto = errore di battitura
  select coalesce(
    (select normal_price from public.product_prices where store_id = new.store_id and product_id = new.product_id),
    (select percentile_cont(0.5) within group (order by normal_price) from public.product_prices where product_id = new.product_id))
  into ref;
  if ref is not null and ref > 0 and (new.ref_price > ref * 8 or new.ref_price < ref / 8) then return null; end if;
  -- niente valanghe: al massimo 300 prezzi al giorno a persona
  if (select count(*) from public.user_prices where user_id = auth.uid() and created_at > now() - interval '1 day') >= 300 then return null; end if;
  return new;
end $$;
drop trigger if exists user_prices_check on public.user_prices;
create trigger user_prices_check before insert on public.user_prices for each row execute function public.trg_user_price_check();

-- si tengono le ultime 4 righe PER PERSONA (e 20 in tutto): uno solo non può più cancellare i prezzi degli altri
create or replace function public.trim_user_prices() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.user_prices where store_id = new.store_id and product_id = new.product_id and kind = new.kind and user_id = new.user_id
    and id not in (select id from public.user_prices where store_id = new.store_id and product_id = new.product_id
                   and kind = new.kind and user_id = new.user_id order by created_at desc limit 4);
  delete from public.user_prices where store_id = new.store_id and product_id = new.product_id and kind = new.kind
    and id not in (select id from public.user_prices where store_id = new.store_id and product_id = new.product_id
                   and kind = new.kind order by created_at desc limit 20);
  return null;
end $$;

-- ---------------------------------------------------------------- #54: chi ha visto un prezzo non è visibile agli altri
revoke select on public.user_prices from anon, authenticated;
grant select (id, store_id, product_id, kind, ref_price, paid, quantity, weight_kg, receipt_text, note, location_name, date, promo_until, created_at)
  on public.user_prices to authenticated;

-- ---------------------------------------------------------------- #55: la lista del gruppo la gestisce solo il proprietario
drop policy if exists "liste gruppo: membri" on public.group_lists;
drop policy if exists "liste gruppo: leggo" on public.group_lists;
create policy "liste gruppo: leggo" on public.group_lists for select to authenticated using (public.is_member(group_id));
drop policy if exists "liste gruppo: proprietario" on public.group_lists;
create policy "liste gruppo: proprietario" on public.group_lists for update to authenticated
  using (public.is_group_owner(group_id)) with check (public.is_group_owner(group_id));
-- niente insert/delete dal telefono: la lista nasce con il gruppo e sparisce con lui

-- ---------------------------------------------------------------- #58: rientro con l'ok del proprietario
alter table public.group_join_requests add column if not exists rejoin_as uuid;

-- chiave di rientro: non è l'id dell'utente (che non si espone più a chi ha solo il link)
create or replace function public.rejoin_key(g uuid, u uuid) returns uuid
language sql immutable as $$ select md5(g::text || ':' || u::text)::uuid $$;

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
    select coalesce(jsonb_agg(jsonb_build_object('id', public.rejoin_key(f.id, m.user_id), 'name', m.display_name) order by m.joined_at), '[]'::jsonb) into back
    from public.group_members m join auth.users u on u.id = m.user_id
    where m.group_id = f.id and coalesce(u.is_anonymous, false) and coalesce(trim(m.display_name), '') <> '';
  end if;
  return jsonb_build_object('valid', true, 'kind', f.kind, 'name', f.name, 'emoji', f.emoji,
    'invited_by', coalesce(who, 'Un amico'), 'needs_approval', i.needs_approval, 'expires_at', i.expires_at,
    'returning', coalesce(back, '[]'::jsonb));
end $$;
grant execute on function public.invite_preview(text) to anon, authenticated;

-- il passaggio vero e proprio (dopo l'ok): il telefono nuovo prende il posto del vecchio
create or replace function public.do_rejoin(g uuid, newu uuid, old uuid) returns void
language plpgsql security definer set search_path = public as $$
declare f public.families; m public.group_members;
begin
  select * into f from public.families where id = g;
  select * into m from public.group_members where group_id = g and user_id = old;
  if not found then raise exception 'Questa persona non è più nel gruppo'; end if;
  perform set_config('mc.rientro', 'on', true);
  delete from public.group_members where group_id = g and user_id = newu;   -- era entrato come "secondo Luca": lo fondo
  insert into public.group_members (group_id, user_id, role, display_name, muted, excluded_from_split, joined_at)
  values (g, newu, m.role, m.display_name, m.muted, m.excluded_from_split, m.joined_at);
  update public.group_list_items set added_by = newu where added_by = old and list_id in (select id from public.group_lists where group_id = g);
  update public.group_list_items set assigned_to = newu where assigned_to = old and list_id in (select id from public.group_lists where group_id = g);
  update public.group_expenses set paid_by = newu where paid_by = old and group_id = g;
  update public.group_settlements set from_user = newu where from_user = old and group_id = g;
  update public.group_settlements set to_user = newu where to_user = old and group_id = g;
  delete from public.group_members where group_id = g and user_id = old;
  perform set_config('mc.rientro', 'off', true);
  update public.profiles set display_name = m.display_name, updated_at = now() where id = newu and coalesce(display_name, '') = '';
  perform public.send_family_notification('gruppo_rientro', g, newu,
    jsonb_build_object('group', true, 'group_name', f.name, 'group_emoji', f.emoji, 'name', m.display_name));
end $$;
revoke all on function public.do_rejoin(uuid, uuid, uuid) from public, anon, authenticated;

-- "Sono Luca, rientro": ora è una richiesta che il proprietario conferma
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
  select * into m from public.group_members where group_id = f.id and public.rejoin_key(f.id, user_id) = old;
  if not found or m.user_id = me then raise exception 'Non trovo questa persona nel gruppo'; end if;
  if not exists (select 1 from auth.users where id = m.user_id and coalesce(is_anonymous, false)) then
    raise exception 'Questa persona ha un account con email: rientra con la sua email';
  end if;
  insert into public.invite_attempts (user_id, ok) values (me, true);
  insert into public.group_join_requests (group_id, user_id, display_name, status, rejoin_as)
  values (f.id, me, m.display_name, 'attesa', m.user_id)
  on conflict (group_id, user_id) do update set status = 'attesa', display_name = excluded.display_name, rejoin_as = excluded.rejoin_as,
    created_at = now(), decided_by = null, decided_at = null;
  return jsonb_build_object('status', 'pending', 'kind', 'evento', 'rejoin', true);
end $$;
revoke all on function public.rejoin_as(text, uuid) from public, anon;
grant execute on function public.rejoin_as(text, uuid) to authenticated;

-- decidere: il proprietario; se chi rientra È il proprietario, un altro membro con account
create or replace function public.decide_join_request(g uuid, u uuid, accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare f public.families; r public.group_join_requests; other uuid; me uuid := auth.uid();
begin
  select * into f from public.families where id = g;
  if not found or not public.is_member(g) then raise exception 'Non sei in questo gruppo'; end if;
  select * into r from public.group_join_requests where group_id = g and user_id = u for update;
  if not found or r.status <> 'attesa' then raise exception 'Richiesta non trovata o già decisa'; end if;
  if f.kind = 'evento' and not public.is_group_owner(g) then
    if not (r.rejoin_as is not null
            and exists (select 1 from public.group_members where group_id = g and user_id = r.rejoin_as and role = 'proprietario')
            and me <> r.rejoin_as
            and not exists (select 1 from auth.users where id = me and coalesce(is_anonymous, false))) then
      raise exception 'Decide chi ha creato il gruppo';
    end if;
  end if;
  if r.rejoin_as is not null and r.rejoin_as = me then raise exception 'Non puoi confermare il rientro al tuo posto'; end if;
  if accept then
    if r.rejoin_as is not null then
      perform public.do_rejoin(g, u, r.rejoin_as);
    elsif f.kind = 'famiglia' then
      select family_id into other from public.profiles where id = u;
      if other is not null and other <> g then raise exception 'Nel frattempo è entrato in un''altra famiglia'; end if;
      update public.profiles set family_id = g, updated_at = now() where id = u;
    else
      insert into public.group_members (group_id, user_id, role, display_name) values (g, u, 'membro', r.display_name) on conflict do nothing;
    end if;
  end if;
  update public.group_join_requests set status = case when accept then 'accettata' else 'rifiutata' end,
    decided_by = me, decided_at = now() where group_id = g and user_id = u;
end $$;

-- richieste in attesa (con il nome di chi vuole rientrare al posto di chi)
drop function if exists public.group_pending_requests(uuid);
create function public.group_pending_requests(g uuid)
returns table (user_id uuid, display_name text, created_at timestamptz, rejoin_name text)
language sql stable security definer set search_path = public as $$
  select r.user_id, r.display_name, r.created_at,
    case when r.rejoin_as is not null then (select m.display_name from public.group_members m where m.group_id = g and m.user_id = r.rejoin_as) end
  from public.group_join_requests r
  where r.group_id = g and r.status = 'attesa' and public.is_member(g)
  order by r.created_at
$$;
revoke all on function public.group_pending_requests(uuid), public.decide_join_request(uuid, uuid, boolean) from public, anon;
grant execute on function public.group_pending_requests(uuid), public.decide_join_request(uuid, uuid, boolean) to authenticated;

-- avviso: la richiesta di rientro arriva al gruppo (non come "entrare in famiglia")
create or replace function public.trg_join_request_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare f public.families;
begin
  select * into f from public.families where id = new.group_id;
  if new.status = 'attesa' and (tg_op = 'INSERT' or old.status is distinct from 'attesa') then
    if f.kind = 'evento' then
      if new.rejoin_as is not null then
        perform public.send_family_notification('gruppo_proposta', new.group_id, new.user_id,
          jsonb_build_object('group', true, 'group_name', f.name, 'group_emoji', '🔁', 'item', 'di rientrare come ' || coalesce(new.display_name, 'un membro')));
      end if;
    else
      perform public.send_family_notification('ingresso', new.group_id, new.user_id, jsonb_build_object('name', new.display_name));
    end if;
  elsif new.status = 'accettata' and old.status = 'attesa' and f.kind <> 'evento' then
    perform public.send_family_notification('ingresso_ok', new.group_id, new.decided_by, jsonb_build_object('to', new.user_id));
  end if;
  return new;
end $$;

-- chi esce dal gruppo: la proprietà passa a chi ha un account (non a chi può essere "preso" con il link)
create or replace function public.leave_group(g uuid) returns void
language plpgsql security definer set search_path = public as $$
declare f public.families; was_owner boolean; nxt uuid;
begin
  select * into f from public.families where id = g;
  if not found or f.kind <> 'evento' then raise exception 'Gruppo non trovato'; end if;
  if not public.is_member(g) then return; end if;
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

notify pgrst, 'reload schema';
