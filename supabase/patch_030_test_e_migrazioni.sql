-- #89: patch tracciate e una correzione trovata dalle prove automatiche. Da eseguire una volta (dopo patch_029).

-- quali patch sono già state applicate (d'ora in poi ogni patch si segna qui da sola)
create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now());
alter table public.schema_migrations enable row level security;
revoke all on public.schema_migrations from anon, authenticated;
insert into public.schema_migrations (name)
select format('patch_%s', lpad(n::text, 3, '0')) from generate_series(1, 29) n on conflict do nothing;

-- quando il proprietario toglie qualcuno dalla famiglia, il database gli riporta via ricette e spesa in corso:
-- quell'aggiornamento lo fa il database stesso (trigger dentro trigger), non va bloccato come se lo facesse un altro
create or replace function public.trg_owner_family_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;                       -- lavori del server (chiave segreta)
  if pg_trigger_depth() > 1 then return new; end if;                  -- lo sta facendo un altro trigger del database
  if new.user_id is distinct from old.user_id then raise exception 'Non si cambia chi l''ha creata'; end if;
  if new.family_id is distinct from old.family_id then
    if old.user_id <> auth.uid() then raise exception 'Solo chi l''ha creata la sposta'; end if;
    if new.family_id is not null and new.family_id is distinct from public.my_family() then
      raise exception 'Puoi metterla solo nella tua famiglia';
    end if;
  end if;
  return new;
end $$;

insert into public.schema_migrations (name) values ('patch_030') on conflict do nothing;
