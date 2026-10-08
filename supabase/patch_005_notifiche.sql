-- Notifiche push alla famiglia (ottobre 2026).
-- Quando un familiare condivide la lista, prepara una spesa, la prende in carico o la finisce, il database chiama
-- la funzione "notifica" (Edge Function), che manda la notifica agli altri membri della famiglia via Firebase.

create extension if not exists pg_net with schema extensions;

-- i telefoni dove arrivano le notifiche (un utente può averne più d'uno)
create table if not exists public.push_tokens (
  token text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  platform text not null default 'android',
  updated_at timestamptz not null default now()
);
alter table public.push_tokens enable row level security;
drop policy if exists "token: miei" on public.push_tokens;
create policy "token: miei" on public.push_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- segreto condiviso tra database e funzione (nessuna regola di accesso: lo leggono solo il database e la funzione)
create table if not exists public.app_secrets (key text primary key, value text not null);
alter table public.app_secrets enable row level security;
insert into public.app_secrets (key, value)
  values ('notify_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (key) do nothing;

-- ultime notifiche per famiglia (per non mandarne a raffica)
create table if not exists public.notify_log (
  family_id uuid not null, kind text not null, at timestamptz not null default now(),
  primary key (family_id, kind)
);
alter table public.notify_log enable row level security;

create or replace function public.send_family_notification(p_kind text, p_family uuid, p_actor uuid, p_extra jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare s text;
begin
  if p_family is null then return; end if;
  select value into s from public.app_secrets where key = 'notify_secret';
  perform net.http_post(
    url := 'https://tkzbradzyuhcgkfkktlx.supabase.co/functions/v1/notifica',
    body := jsonb_build_object('kind', p_kind, 'family_id', p_family, 'actor', p_actor) || coalesce(p_extra, '{}'::jsonb),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-mc-secret', s),
    timeout_milliseconds := 5000);
exception when others then
  null; -- una notifica che non parte non deve mai bloccare la spesa
end $$;
revoke all on function public.send_family_notification(text, uuid, uuid, jsonb) from public, anon, authenticated;

-- lista condivisa con la famiglia
create or replace function public.trg_family_list_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.send_family_notification('lista', new.family_id, new.updated_by,
    jsonb_build_object('items', jsonb_array_length(coalesce(new.items, '[]'::jsonb))));
  return new;
end $$;
drop trigger if exists family_list_notify on public.family_lists;
create trigger family_list_notify after insert or update of items on public.family_lists
  for each row execute function public.trg_family_list_notify();

-- spesa: preparata, presa in carico, finita
create or replace function public.trg_shop_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare extra jsonb;
begin
  extra := jsonb_build_object('shop_id', new.id, 'saving_id', new.saving_id, 'store', new.store_name,
    'items', jsonb_array_length(coalesce(new.items, '[]'::jsonb)));
  if tg_op = 'INSERT' then
    if new.status = 'active' then
      perform public.send_family_notification('spesa', new.family_id, new.user_id, extra);
    end if;
  else
    if new.status = 'done' and old.status is distinct from 'done' then
      perform public.send_family_notification('finita', new.family_id, coalesce((new.taken_by->>'user_id')::uuid, new.user_id), extra);
    elsif new.status = 'active' and new.taken_by is not null
      and (old.taken_by is null or old.taken_by->>'user_id' is distinct from new.taken_by->>'user_id') then
      perform public.send_family_notification('presa', new.family_id, (new.taken_by->>'user_id')::uuid, extra);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists shop_notify on public.shops;
create trigger shop_notify after insert or update on public.shops
  for each row execute function public.trg_shop_notify();

-- "Prova le notifiche" dal Profilo: una notifica solo a me
create or replace function public.test_my_notification() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.send_family_notification('prova', coalesce(public.my_family(), auth.uid()), auth.uid(), '{}'::jsonb);
end $$;
revoke all on function public.test_my_notification() from public, anon;
grant execute on function public.test_my_notification() to authenticated;
