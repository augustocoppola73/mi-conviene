-- =====================================================================
-- Gruppi F1 (#12): struttura dati per famiglia + gruppi evento. NESSUNA differenza visibile nell'app.
-- Progetto: wiki "Progetto Gruppi" (#3).
--
-- Scelta: la tabella "families" diventa la tabella dei GRUPPI (stesso id, niente spostamenti di dati):
--   kind = 'famiglia' (una per persona, condivide tutto) | 'evento' (quanti vuoi, condivide solo liste, spese, conti).
-- La famiglia di ognuno resta in profiles.family_id: salvadanaio, storico, ricette, reparti, spese in corso,
-- liste di famiglia continuano a usare my_family() → un gruppo evento non li vede MAI.
-- I membri di tutti i gruppi stanno in group_members; per la famiglia sono tenuti allineati da un trigger.
--
-- Da eseguire una volta in Supabase → SQL Editor (dopo patch_009). Si può rieseguire.
-- =====================================================================

-- ---------------------------------------------------------------- gruppi (= families)
alter table public.families add column if not exists kind text not null default 'famiglia';
alter table public.families add column if not exists name text;
alter table public.families add column if not exists emoji text;
alter table public.families add column if not exists event_date date;
alter table public.families add column if not exists expires_at timestamptz;
alter table public.families add column if not exists archived_at timestamptz;
alter table public.families alter column code drop not null;   -- i gruppi evento entrano con gli inviti (F2)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'families_kind_check') then
    alter table public.families add constraint families_kind_check check (kind in ('famiglia', 'evento'));
  end if;
end $$;

-- ---------------------------------------------------------------- membri
create table if not exists public.group_members (
  group_id uuid not null references public.families on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'membro' check (role in ('proprietario', 'membro')),
  display_name text,                                   -- il nome che vedono gli altri del gruppo (niente email)
  joined_at timestamptz not null default now(),
  muted boolean not null default false,                -- notifiche di questo gruppo spente
  primary key (group_id, user_id)
);
create index if not exists group_members_user on public.group_members (user_id);

-- sono nel gruppo? (usata dalle regole di accesso; security definer per non girare in tondo con le regole)
create or replace function public.is_member(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members where group_id = g and user_id = auth.uid())
$$;
create or replace function public.is_group_owner(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members where group_id = g and user_id = auth.uid() and role = 'proprietario')
$$;

-- famiglia: i membri seguono profiles.family_id (crea / entra / esci famiglia non cambiano)
create or replace function public.sync_family_member() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  if tg_op = 'UPDATE' and old.family_id is not null and old.family_id is distinct from new.family_id then
    delete from public.group_members where group_id = old.family_id and user_id = new.id;
    -- se è uscito il proprietario, il ruolo passa a chi è dentro da più tempo
    if not exists (select 1 from public.group_members where group_id = old.family_id and role = 'proprietario') then
      select user_id into owner from public.group_members where group_id = old.family_id order by joined_at limit 1;
      if owner is not null then
        update public.group_members set role = 'proprietario' where group_id = old.family_id and user_id = owner;
      end if;
    end if;
  end if;
  if new.family_id is not null and (tg_op = 'INSERT' or old.family_id is distinct from new.family_id) then
    insert into public.group_members (group_id, user_id, role, display_name)
    values (new.family_id, new.id,
      case when exists (select 1 from public.group_members where group_id = new.family_id and role = 'proprietario')
           then 'membro' else 'proprietario' end,
      new.display_name)
    on conflict (group_id, user_id) do nothing;
  end if;
  if tg_op = 'UPDATE' and new.display_name is distinct from old.display_name then
    update public.group_members set display_name = new.display_name where user_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists profiles_sync_family on public.profiles;
create trigger profiles_sync_family after insert or update of family_id, display_name on public.profiles
  for each row execute function public.sync_family_member();

-- migrazione: i membri delle famiglie di oggi (proprietario = chi l'ha creata, altrimenti il primo)
insert into public.group_members (group_id, user_id, role, display_name, joined_at)
select p.family_id, p.id,
  case when f.created_by = p.id then 'proprietario' else 'membro' end,
  p.display_name, coalesce(f.created_at, now())
from public.profiles p join public.families f on f.id = p.family_id
on conflict (group_id, user_id) do nothing;
update public.group_members gm set role = 'proprietario'
where not exists (select 1 from public.group_members x where x.group_id = gm.group_id and x.role = 'proprietario')
  and gm.user_id = (select user_id from public.group_members y where y.group_id = gm.group_id order by joined_at, user_id limit 1);

-- con il codice famiglia si entra solo in una FAMIGLIA (mai in un gruppo evento per sbaglio)
create or replace function public.join_family(join_code text) returns public.families
language plpgsql security definer set search_path = public as $$
declare f public.families;
begin
  select * into f from public.families where code = upper(trim(join_code)) and kind = 'famiglia';
  if not found then raise exception 'Codice famiglia non trovato'; end if;
  update public.profiles set family_id = f.id, updated_at = now() where id = auth.uid();
  return f;
end $$;

-- ---------------------------------------------------------------- inviti e richieste (usati da F2)
create table if not exists public.group_invites (
  code text primary key,                               -- 8 caratteri senza 0/O 1/I
  group_id uuid not null references public.families on delete cascade,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  max_uses int,                                        -- null = illimitati
  uses int not null default 0,
  needs_approval boolean not null default false,
  revoked boolean not null default false
);
create index if not exists group_invites_group on public.group_invites (group_id);

create table if not exists public.group_join_requests (
  group_id uuid not null references public.families on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  display_name text,
  status text not null default 'attesa' check (status in ('attesa', 'accettata', 'rifiutata')),
  created_at timestamptz not null default now(),
  decided_by uuid references auth.users on delete set null,
  decided_at timestamptz,
  primary key (group_id, user_id)
);

-- tentativi di codice (contro chi prova codici a caso: max 10 sbagliati all'ora)
create table if not exists public.invite_attempts (
  user_id uuid not null references auth.users on delete cascade,
  at timestamptz not null default now(),
  ok boolean not null default false
);
create index if not exists invite_attempts_user on public.invite_attempts (user_id, at);

-- ---------------------------------------------------------------- liste di gruppo: una riga per prodotto (F3)
create table if not exists public.group_lists (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.families on delete cascade,
  name text not null default 'Lista' check (length(name) between 1 and 60),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists group_lists_group on public.group_lists (group_id);

create table if not exists public.group_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.group_lists on delete cascade,
  product_id text not null,                            -- id del catalogo, o "custom:..." scritto a mano
  name text,
  quantity numeric(9,3) not null default 1 check (quantity > 0),
  unit text,
  category_id text,
  added_by uuid references auth.users on delete set null,
  assigned_to uuid references auth.users on delete set null,  -- "lo prendo io"
  store_id text,                                       -- dove lo prende (se deciso)
  status text not null default 'da_prendere' check (status in ('da_prendere', 'preso', 'mancava')),
  paid_price numeric(9,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists group_list_items_list on public.group_list_items (list_id);

-- ---------------------------------------------------------------- spese del gruppo / conti (F5)
create table if not exists public.group_expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.families on delete cascade,
  paid_by uuid references auth.users on delete set null,     -- null = ex membro (account cancellato)
  amount numeric(9,2) not null check (amount > 0),
  note text check (length(note) <= 120),
  spent_on date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists group_expenses_group on public.group_expenses (group_id);

-- chi non partecipa alla divisione (es. bambini) e i pareggi segnati come saldati
create table if not exists public.group_settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.families on delete cascade,
  from_user uuid references auth.users on delete set null,
  to_user uuid references auth.users on delete set null,
  amount numeric(9,2) not null check (amount > 0),
  settled_at timestamptz not null default now()
);
alter table public.group_members add column if not exists excluded_from_split boolean not null default false;

-- ---------------------------------------------------------------- regole di accesso
-- permessi di base solo per chi è dentro (le regole qui sotto decidono riga per riga); gli anonimi senza accesso niente
grant select, insert, update, delete on public.group_members, public.group_invites, public.group_join_requests,
  public.group_lists, public.group_list_items, public.group_expenses, public.group_settlements to authenticated;
revoke all on public.group_members, public.group_invites, public.group_join_requests, public.invite_attempts,
  public.group_lists, public.group_list_items, public.group_expenses, public.group_settlements from anon;
revoke all on public.invite_attempts from authenticated;
-- dei membri si cambia solo il "silenzia notifiche" (ruoli ed esclusioni li gestiscono le funzioni del proprietario)
revoke update on public.group_members from authenticated;
grant update (muted) on public.group_members to authenticated;
-- dei prodotti non si cambiano chi l'ha aggiunto né la lista
revoke update on public.group_list_items from authenticated;
grant update (name, quantity, unit, category_id, assigned_to, store_id, status, paid_price, updated_at) on public.group_list_items to authenticated;
alter table public.group_members       enable row level security;
alter table public.group_invites       enable row level security;
alter table public.group_join_requests enable row level security;
alter table public.invite_attempts     enable row level security;
alter table public.group_lists         enable row level security;
alter table public.group_list_items    enable row level security;
alter table public.group_expenses      enable row level security;
alter table public.group_settlements   enable row level security;

-- gruppi: vedo i gruppi di cui faccio parte (la mia famiglia compresa); creare/cambiare passa dalle funzioni
drop policy if exists "famiglia: la mia" on public.families;
drop policy if exists "gruppi: i miei" on public.families;
create policy "gruppi: i miei" on public.families for select to authenticated
  using (id = public.my_family() or public.is_member(id));
-- (rinominare / archiviare passerà da funzioni dedicate in F2-F3: niente modifiche dirette)
drop policy if exists "gruppi: il proprietario modifica" on public.families;

-- membri: vedo chi c'è nei miei gruppi; cambio solo le MIE impostazioni (es. silenziare); entrare/uscire con le funzioni
drop policy if exists "membri: dei miei gruppi" on public.group_members;
create policy "membri: dei miei gruppi" on public.group_members for select to authenticated using (public.is_member(group_id));
drop policy if exists "membri: le mie impostazioni" on public.group_members;
create policy "membri: le mie impostazioni" on public.group_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- inviti: li vede solo il proprietario (gli altri entrano con la funzione, conoscendo il codice)
drop policy if exists "inviti: del proprietario" on public.group_invites;
create policy "inviti: del proprietario" on public.group_invites for select to authenticated using (public.is_group_owner(group_id));

-- richieste: la mia, o quelle dei gruppi di cui sono proprietario
drop policy if exists "richieste: mie o da decidere" on public.group_join_requests;
create policy "richieste: mie o da decidere" on public.group_join_requests for select to authenticated
  using (user_id = auth.uid() or public.is_group_owner(group_id));

-- tentativi: nessuna regola → li tocca solo il database

-- liste di gruppo: tutto per i membri
drop policy if exists "liste gruppo: membri" on public.group_lists;
create policy "liste gruppo: membri" on public.group_lists for all to authenticated
  using (public.is_member(group_id)) with check (public.is_member(group_id));

-- prodotti: i membri leggono, aggiungono e aggiornano; tolgono solo chi li ha aggiunti (o il proprietario) e solo se nessuno li ha presi
create or replace function public.list_group(l uuid) returns uuid
language sql stable security definer set search_path = public as $$ select group_id from public.group_lists where id = l $$;
drop policy if exists "prodotti gruppo: leggo" on public.group_list_items;
create policy "prodotti gruppo: leggo" on public.group_list_items for select to authenticated using (public.is_member(public.list_group(list_id)));
drop policy if exists "prodotti gruppo: aggiungo" on public.group_list_items;
create policy "prodotti gruppo: aggiungo" on public.group_list_items for insert to authenticated
  with check (public.is_member(public.list_group(list_id)) and added_by = auth.uid());
drop policy if exists "prodotti gruppo: aggiorno" on public.group_list_items;
create policy "prodotti gruppo: aggiorno" on public.group_list_items for update to authenticated
  using (public.is_member(public.list_group(list_id))) with check (public.is_member(public.list_group(list_id)));
drop policy if exists "prodotti gruppo: tolgo" on public.group_list_items;
create policy "prodotti gruppo: tolgo" on public.group_list_items for delete to authenticated
  using (public.is_member(public.list_group(list_id)) and status = 'da_prendere' and assigned_to is null
         and (added_by = auth.uid() or public.is_group_owner(public.list_group(list_id))));

-- spese: i membri vedono; ognuno segna e toglie le sue
drop policy if exists "spese gruppo: leggo" on public.group_expenses;
create policy "spese gruppo: leggo" on public.group_expenses for select to authenticated using (public.is_member(group_id));
drop policy if exists "spese gruppo: segno le mie" on public.group_expenses;
create policy "spese gruppo: segno le mie" on public.group_expenses for insert to authenticated
  with check (public.is_member(group_id) and paid_by = auth.uid());
drop policy if exists "spese gruppo: tolgo le mie" on public.group_expenses;
create policy "spese gruppo: tolgo le mie" on public.group_expenses for delete to authenticated
  using (paid_by = auth.uid() or public.is_group_owner(group_id));

drop policy if exists "pareggi: leggo" on public.group_settlements;
create policy "pareggi: leggo" on public.group_settlements for select to authenticated using (public.is_member(group_id));
drop policy if exists "pareggi: segno" on public.group_settlements;
create policy "pareggi: segno" on public.group_settlements for insert to authenticated
  with check (public.is_member(group_id) and (from_user = auth.uid() or to_user = auth.uid()));

-- tempo reale per la lista condivisa (F3)
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'group_list_items') then
    alter publication supabase_realtime add table public.group_list_items;
  end if;
exception when undefined_object then null;  -- database di prova senza pubblicazione "realtime"
end $$;
