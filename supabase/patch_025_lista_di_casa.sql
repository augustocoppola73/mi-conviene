-- =====================================================================
-- #91 lista di casa in diretta per la famiglia, #74 nomi (mai la parte dell'email), #75 preferenze online.
-- Da eseguire una volta in Supabase → SQL Editor (dopo patch_024). Si può rieseguire.
-- =====================================================================

-- ---------------------------------------------------------------- #91: la lista di casa (una riga per prodotto, in diretta)
create table if not exists public.home_list_items (
  family_id uuid not null references public.families on delete cascade,
  product_id text not null,
  quantity numeric not null check (quantity > 0 and quantity < 10000),
  name text,
  category_id text,
  unit text,
  added_by uuid default auth.uid() references auth.users on delete set null,
  updated_by uuid default auth.uid() references auth.users on delete set null,
  updated_at timestamptz not null default now(),
  primary key (family_id, product_id)
);
alter table public.home_list_items enable row level security;
drop policy if exists "lista di casa: famiglia" on public.home_list_items;
create policy "lista di casa: famiglia" on public.home_list_items for all to authenticated
  using (public.my_family() is not null and family_id = public.my_family())
  with check (public.my_family() is not null and family_id = public.my_family());
revoke all on public.home_list_items from anon;
grant select, insert, update, delete on public.home_list_items to authenticated;

create or replace function public.trg_home_item_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  if tg_op = 'INSERT' then new.added_by := coalesce(auth.uid(), new.added_by);
  else new.added_by := old.added_by; end if;
  new.name := left(new.name, 80);
  return new;
end $$;
drop trigger if exists home_items_stamp on public.home_list_items;
create trigger home_items_stamp before insert or update on public.home_list_items for each row execute function public.trg_home_item_stamp();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'home_list_items') then
    alter publication supabase_realtime add table public.home_list_items;
  end if;
exception when undefined_object then null;
end $$;

-- la lista di famiglia «inviata» finora (family_lists) diventa la lista di casa, se non c'è già
insert into public.home_list_items (family_id, product_id, quantity, name, category_id, unit)
select fl.family_id, it->>'product_id', (it->>'quantity')::numeric, it->>'name', it->>'category_id', it->>'unit'
from public.family_lists fl cross join lateral jsonb_array_elements(coalesce(fl.items, '[]'::jsonb)) it
where coalesce((it->>'quantity')::numeric, 0) > 0 and it->>'product_id' is not null
  and not exists (select 1 from public.home_list_items h where h.family_id = fl.family_id)
on conflict do nothing;

-- ---------------------------------------------------------------- #74: il nome lo scrive la persona (mai la parte dell'email)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(trim(new.raw_user_meta_data->>'display_name'), ''))
  on conflict (id) do nothing;
  return new;
end $$;
-- i nomi presi dall'email finora: tolti (l'app chiede il nome)
update public.profiles p set display_name = null, updated_at = now()
from auth.users u where u.id = p.id and u.email is not null and p.display_name = split_part(u.email, '@', 1);
update public.group_members m set display_name = null
from auth.users u where u.id = m.user_id and u.email is not null and m.display_name = split_part(u.email, '@', 1);

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
  if nm is not null then update public.profiles set display_name = nm, updated_at = now() where id = me; end if;   -- #74: il nome scritto entrando vale
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

-- quando cambio nome, cambia anche nei gruppi e in famiglia
create or replace function public.trg_profile_name_follow() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.display_name is distinct from old.display_name and nullif(trim(new.display_name), '') is not null then
    update public.group_members set display_name = new.display_name where user_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists profiles_name_follow on public.profiles;
create trigger profiles_name_follow after update of display_name on public.profiles for each row execute function public.trg_profile_name_follow();

-- ---------------------------------------------------------------- #75: preferenze dell'app sul profilo (le ritrovi su ogni telefono)
create or replace function public.set_app_prefs(p jsonb) returns void
language sql security definer set search_path = public as $$
  update public.profiles set prefs = coalesce(prefs, '{}'::jsonb) || jsonb_build_object('app', p) where id = auth.uid()
$$;
create or replace function public.my_app_profile() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('display_name', display_name, 'family_id', family_id, 'app', prefs->'app') from public.profiles where id = auth.uid()
$$;
revoke all on function public.set_app_prefs(jsonb), public.my_app_profile() from public, anon;
grant execute on function public.set_app_prefs(jsonb), public.my_app_profile() to authenticated;

notify pgrst, 'reload schema';
