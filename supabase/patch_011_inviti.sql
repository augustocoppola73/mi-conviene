-- =====================================================================
-- Gruppi F2 (#13): inviti con scadenza, approvazione, revoca, rimozione; il codice famiglia fisso non vale più.
-- Progetto: wiki "Progetto Gruppi". Da eseguire una volta in Supabase → SQL Editor (dopo patch_010). Si può rieseguire.
--
--   famiglia: link 48 ore, un uso, serve l'approvazione di un familiare ("Laura vuole entrare · Accetta / Rifiuta")
--   evento:   link fino al giorno dopo l'evento (o 30 giorni), usi illimitati, si entra subito
-- Contro i codici provati a caso: max 10 tentativi sbagliati all'ora per account.
-- =====================================================================

-- codice di 8 caratteri senza 0/O 1/I (circa 10^12 combinazioni)
create or replace function public.new_invite_code() returns text
language plpgsql volatile set search_path = public, extensions as $$
declare c text;
begin
  loop
    c := '';
    for i in 1..8 loop
      c := c || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + get_byte(gen_random_bytes(1), 0) % 32, 1);  -- casuale "vero" (pgcrypto)
    end loop;
    exit when not exists (select 1 from public.group_invites where code = c);
  end loop;
  return c;
end $$;

-- nuovo invito (lo crea un membro del gruppo; per i gruppi evento solo il proprietario)
create or replace function public.create_invite(g uuid) returns public.group_invites
language plpgsql security definer set search_path = public as $$
declare f public.families; i public.group_invites;
begin
  select * into f from public.families where id = g;
  if not found or not public.is_member(g) then raise exception 'Non sei in questo gruppo'; end if;
  if f.kind = 'evento' and not public.is_group_owner(g) then raise exception 'Solo chi ha creato il gruppo può invitare'; end if;
  if f.archived_at is not null then raise exception 'Il gruppo è archiviato'; end if;
  insert into public.group_invites (code, group_id, created_by, expires_at, max_uses, needs_approval)
  values (public.new_invite_code(), g, auth.uid(),
    case when f.kind = 'famiglia' then now() + interval '48 hours'
         else coalesce((f.event_date + 1)::timestamptz, now() + interval '30 days') end,
    case when f.kind = 'famiglia' then 1 else null end,
    f.kind = 'famiglia')
  returning * into i;
  return i;
end $$;

-- inviti ancora validi del gruppo (per mostrarli e revocarli)
create or replace function public.group_open_invites(g uuid)
returns table (code text, expires_at timestamptz, uses int, max_uses int, created_by_name text)
language sql stable security definer set search_path = public as $$
  select i.code, i.expires_at, i.uses, i.max_uses, m.display_name
  from public.group_invites i left join public.group_members m on m.group_id = i.group_id and m.user_id = i.created_by
  where i.group_id = g and public.is_member(g) and not i.revoked and i.expires_at > now()
    and (i.max_uses is null or i.uses < i.max_uses)
  order by i.created_at desc
$$;

create or replace function public.revoke_invite(c text) returns void
language plpgsql security definer set search_path = public as $$
declare i public.group_invites;
begin
  select * into i from public.group_invites where code = upper(trim(c));
  if not found then return; end if;
  if i.created_by is distinct from auth.uid() and not public.is_group_owner(i.group_id) then
    raise exception 'Può revocarlo chi l''ha creato o il proprietario';
  end if;
  update public.group_invites set revoked = true where code = i.code;
end $$;

-- anteprima per la pagina d'invito (anche prima di avere un account): solo il minimo
create or replace function public.invite_preview(c text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare i public.group_invites; f public.families; who text;
begin
  select * into i from public.group_invites where code = upper(regexp_replace(coalesce(c, ''), '[^A-Za-z0-9]', '', 'g'));
  if not found then return jsonb_build_object('valid', false, 'reason', 'Invito non trovato'); end if;
  if i.revoked then return jsonb_build_object('valid', false, 'reason', 'Questo invito è stato revocato'); end if;
  if i.expires_at <= now() then return jsonb_build_object('valid', false, 'reason', 'Questo invito è scaduto: chiedine uno nuovo'); end if;
  if i.max_uses is not null and i.uses >= i.max_uses then return jsonb_build_object('valid', false, 'reason', 'Questo invito è già stato usato: chiedine uno nuovo'); end if;
  select * into f from public.families where id = i.group_id;
  select display_name into who from public.group_members where group_id = i.group_id and user_id = i.created_by;
  return jsonb_build_object('valid', true, 'kind', f.kind, 'name', f.name, 'emoji', f.emoji,
    'invited_by', coalesce(who, 'Un amico'), 'needs_approval', i.needs_approval, 'expires_at', i.expires_at);
end $$;

-- entro con un invito
create or replace function public.join_with_invite(c text, p_name text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); i public.group_invites; f public.families; v_code text; nm text; mine uuid;
begin
  if me is null then raise exception 'Entra prima nell''app'; end if;
  if (select count(*) from public.invite_attempts where user_id = me and not ok and at > now() - interval '1 hour') >= 10 then
    raise exception 'Troppi codici sbagliati: riprova tra un''ora';
  end if;
  v_code := upper(regexp_replace(coalesce(c, ''), '[^A-Za-z0-9]', '', 'g'));
  select * into i from public.group_invites where group_invites.code = v_code for update;
  if not found or i.revoked or i.expires_at <= now() or (i.max_uses is not null and i.uses >= i.max_uses) then
    -- niente errore: il tentativo sbagliato deve restare registrato (un errore lo annullerebbe)
    insert into public.invite_attempts (user_id, ok) values (me, false);
    return jsonb_build_object('status', 'invalid', 'reason', coalesce((public.invite_preview(v_code))->>'reason', 'Invito non valido'));
  end if;
  insert into public.invite_attempts (user_id, ok) values (me, true);
  select * into f from public.families where id = i.group_id;
  nm := nullif(trim(left(coalesce(p_name, ''), 40)), '');
  if nm is not null then update public.profiles set display_name = nm, updated_at = now() where id = me and coalesce(display_name, '') = ''; end if;
  select coalesce(nm, display_name) into nm from public.profiles where id = me;
  if public.is_member(f.id) then return jsonb_build_object('status', 'already', 'kind', f.kind); end if;

  if f.kind = 'famiglia' then
    select family_id into mine from public.profiles where id = me;
    if mine is not null then raise exception 'Sei già in un''altra famiglia: esci prima da quella (Profilo › Famiglia)'; end if;
  end if;

  update public.group_invites set uses = uses + 1 where group_invites.code = i.code;
  if i.needs_approval then
    insert into public.group_join_requests (group_id, user_id, display_name, status)
    values (f.id, me, nm, 'attesa')
    on conflict (group_id, user_id) do update set status = 'attesa', display_name = excluded.display_name,
      created_at = now(), decided_by = null, decided_at = null;
    return jsonb_build_object('status', 'pending', 'kind', f.kind);
  end if;
  insert into public.group_members (group_id, user_id, role, display_name) values (f.id, me, 'membro', nm)
  on conflict do nothing;
  return jsonb_build_object('status', 'joined', 'kind', f.kind, 'group_id', f.id);
end $$;

-- un familiare (o il proprietario di un gruppo evento) accetta o rifiuta
create or replace function public.decide_join_request(g uuid, u uuid, accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare f public.families; r public.group_join_requests; other uuid;
begin
  select * into f from public.families where id = g;
  if not found or not public.is_member(g) then raise exception 'Non sei in questo gruppo'; end if;
  if f.kind = 'evento' and not public.is_group_owner(g) then raise exception 'Decide chi ha creato il gruppo'; end if;
  select * into r from public.group_join_requests where group_id = g and user_id = u for update;
  if not found or r.status <> 'attesa' then raise exception 'Richiesta non trovata o già decisa'; end if;
  if accept then
    if f.kind = 'famiglia' then
      select family_id into other from public.profiles where id = u;
      if other is not null and other <> g then raise exception 'Nel frattempo è entrato in un''altra famiglia'; end if;
      update public.profiles set family_id = g, updated_at = now() where id = u;   -- il trigger lo aggiunge ai membri
    else
      insert into public.group_members (group_id, user_id, role, display_name) values (g, u, 'membro', r.display_name) on conflict do nothing;
    end if;
  end if;
  update public.group_join_requests set status = case when accept then 'accettata' else 'rifiutata' end,
    decided_by = auth.uid(), decided_at = now() where group_id = g and user_id = u;
end $$;

-- richieste in attesa del gruppo (per chi può decidere)
create or replace function public.group_pending_requests(g uuid)
returns table (user_id uuid, display_name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.user_id, r.display_name, r.created_at from public.group_join_requests r
  where r.group_id = g and r.status = 'attesa' and public.is_member(g)
  order by r.created_at
$$;

-- la mia richiesta più recente (per la schermata "aspetto che ti accettino")
create or replace function public.my_join_request()
returns table (group_id uuid, kind text, status text, invited_by text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.group_id, f.kind, r.status,
    (select m.display_name from public.group_members m where m.group_id = r.group_id and m.role = 'proprietario' limit 1),
    r.created_at
  from public.group_join_requests r join public.families f on f.id = r.group_id
  where r.user_id = auth.uid() order by r.created_at desc limit 1
$$;

-- il proprietario toglie qualcuno (da quel momento non vede più niente)
create or replace function public.remove_member(g uuid, u uuid) returns void
language plpgsql security definer set search_path = public as $$
declare f public.families;
begin
  select * into f from public.families where id = g;
  if not found or not public.is_group_owner(g) then raise exception 'Solo il proprietario può togliere qualcuno'; end if;
  if u = auth.uid() then raise exception 'Per uscire usa "Esci"'; end if;
  if f.kind = 'famiglia' then
    update public.profiles set family_id = null, updated_at = now() where id = u and family_id = g;
  else
    delete from public.group_members where group_id = g and user_id = u;
  end if;
end $$;

-- ruoli visibili all'app (chi è il proprietario)
drop function if exists public.family_members();
create function public.family_members()
returns table (user_id uuid, display_name text, notifications boolean, role text)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name,
    exists (select 1 from public.push_tokens t where t.user_id = p.id and t.updated_at > now() - interval '60 days'),
    coalesce((select m.role from public.group_members m where m.group_id = p.family_id and m.user_id = p.id), 'membro')
  from public.profiles p
  where p.family_id is not null and p.family_id = public.my_family()
$$;

-- il codice famiglia fisso non fa più entrare: si entra solo con un invito
create or replace function public.join_family(join_code text) returns public.families
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Il codice famiglia non vale più: chiedi un invito a chi è già nella famiglia';
end $$;

-- permessi: le funzioni le chiamano solo gli utenti entrati; l'anteprima anche prima dell'accesso
revoke all on function public.create_invite(uuid), public.group_open_invites(uuid), public.revoke_invite(text),
  public.join_with_invite(text, text), public.decide_join_request(uuid, uuid, boolean), public.group_pending_requests(uuid),
  public.my_join_request(), public.remove_member(uuid, uuid), public.new_invite_code() from public, anon;
grant execute on function public.create_invite(uuid), public.group_open_invites(uuid), public.revoke_invite(text),
  public.join_with_invite(text, text), public.decide_join_request(uuid, uuid, boolean), public.group_pending_requests(uuid),
  public.my_join_request(), public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.invite_preview(text) to anon, authenticated;

-- ---------------------------------------------------------------- avvisi
-- richiesta di ingresso → ai familiari; accettata → a chi l'ha chiesta
create or replace function public.trg_join_request_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'attesa' and (tg_op = 'INSERT' or old.status is distinct from 'attesa') then
    perform public.send_family_notification('ingresso', new.group_id, new.user_id, jsonb_build_object('name', new.display_name));
  elsif new.status = 'accettata' and old.status = 'attesa' then
    perform public.send_family_notification('ingresso_ok', new.group_id, new.decided_by, jsonb_build_object('to', new.user_id));
  end if;
  return new;
end $$;
drop trigger if exists join_request_notify on public.group_join_requests;
create trigger join_request_notify after insert or update on public.group_join_requests
  for each row execute function public.trg_join_request_notify();
