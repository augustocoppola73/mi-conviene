-- =====================================================================
-- Gruppi F5 (#16): conti del gruppo. Ogni scontrino del gruppo lo conferma (dopo averlo corretto) chi l'ha pagato
-- o il proprietario; solo allora arriva nel gruppo e i conti si aggiornano. Una famiglia = un conto solo.
-- Da eseguire una volta in Supabase → SQL Editor (dopo patch_015). Si può rieseguire.
-- =====================================================================

alter table public.group_expenses add column if not exists status text not null default 'confermata';
alter table public.group_expenses add column if not exists shop_id uuid;
alter table public.group_expenses add column if not exists store_name text;
alter table public.group_expenses add column if not exists lines jsonb;           -- [{name, quantity, unit, price}]
alter table public.group_expenses add column if not exists confirmed_at timestamptz;
alter table public.group_expenses add column if not exists created_by uuid references auth.users on delete set null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'group_expenses_status_check') then
    alter table public.group_expenses add constraint group_expenses_status_check check (status in ('da_confermare', 'confermata'));
  end if;
end $$;
alter table public.group_settlements add column if not exists created_by uuid references auth.users on delete set null;

-- chi può confermare / correggere uno scontrino: chi l'ha pagato, la sua famiglia, il proprietario del gruppo
create or replace function public.can_edit_expense(e public.group_expenses) returns boolean
language sql stable security definer set search_path = public as $$
  select e.paid_by = auth.uid()
    or public.is_group_owner(e.group_id)
    or (public.my_family() is not null and exists (select 1 from public.profiles p where p.id = e.paid_by and p.family_id = public.my_family()))
$$;

-- vedo gli scontrini confermati del gruppo e quelli ancora da confermare che posso confermare io
drop policy if exists "spese gruppo: leggo" on public.group_expenses;
create policy "spese gruppo: leggo" on public.group_expenses for select to authenticated
  using (public.is_member(group_id) and (status = 'confermata' or public.can_edit_expense(group_expenses)));
drop policy if exists "spese gruppo: segno le mie" on public.group_expenses;
create policy "spese gruppo: segno le mie" on public.group_expenses for insert to authenticated
  with check (public.is_member(group_id) and paid_by = auth.uid() and status = 'confermata');
drop policy if exists "spese gruppo: tolgo le mie" on public.group_expenses;
create policy "spese gruppo: tolgo le mie" on public.group_expenses for delete to authenticated
  using (public.can_edit_expense(group_expenses));

-- conferma / correzione (totale, prezzi dei prodotti, nota)
create or replace function public.confirm_group_expense(p_id uuid, p_amount numeric, p_lines jsonb default null, p_note text default null)
returns public.group_expenses
language plpgsql security definer set search_path = public as $$
declare e public.group_expenses;
begin
  select * into e from public.group_expenses where id = p_id for update;
  if not found or not public.can_edit_expense(e) then raise exception 'Questo scontrino lo corregge chi l''ha pagato o chi ha creato il gruppo'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Scrivi il totale dello scontrino'; end if;
  update public.group_expenses set amount = round(p_amount, 2), lines = coalesce(p_lines, lines),
    note = coalesce(nullif(left(trim(coalesce(p_note, '')), 120), ''), note),
    status = 'confermata', confirmed_at = coalesce(confirmed_at, now())
  where id = p_id returning * into e;
  return e;
end $$;

-- il proprietario esclude qualcuno dalla divisione (es. bambini)
create or replace function public.set_split_excluded(g uuid, u uuid, p_excluded boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_owner(g) then raise exception 'Lo decide chi ha creato il gruppo'; end if;
  update public.group_members set excluded_from_split = p_excluded where group_id = g and user_id = u;
end $$;

-- i conti: per ogni "conto" (una persona, o una famiglia intera) quanto ha speso, la sua quota e il saldo
create or replace function public.group_balances(g uuid)
returns table (account text, label text, members uuid[], spent numeric, share numeric, settled numeric, balance numeric, excluded boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_member(g) then raise exception 'Non sei in questo gruppo'; end if;
  return query
  with m as (
    select gm.user_id, coalesce(nullif(trim(gm.display_name), ''), 'Senza nome') as nm, gm.excluded_from_split as ex, gm.joined_at,
      coalesce(p.family_id::text, gm.user_id::text) as acc
    from public.group_members gm left join public.profiles p on p.id = gm.user_id
    where gm.group_id = g
  ), acc as (
    select m.acc, string_agg(m.nm, ' e ' order by m.joined_at) as label, array_agg(m.user_id order by m.joined_at) as members,
      bool_and(m.ex) as ex
    from m group by m.acc
  ), sp as (
    select coalesce(pf.family_id::text, e.paid_by::text) as acc, sum(e.amount) as spent
    from public.group_expenses e left join public.profiles pf on pf.id = e.paid_by
    where e.group_id = g and e.status = 'confermata'
    group by 1
  ), st as (
    select x.acc, sum(x.v) as v from (
      select coalesce(pf.family_id::text, s.from_user::text) as acc, s.amount as v
        from public.group_settlements s left join public.profiles pf on pf.id = s.from_user where s.group_id = g
      union all
      select coalesce(pt.family_id::text, s.to_user::text), -s.amount
        from public.group_settlements s left join public.profiles pt on pt.id = s.to_user where s.group_id = g
    ) x group by x.acc
  ), tot as (
    select coalesce(sum(spent), 0) as t from sp
  ), cnt as (
    select count(*) filter (where not ex) as n from acc
  )
  select a.acc, a.label, a.members, round(coalesce(sp.spent, 0), 2),
    round(case when a.ex or cnt.n = 0 then 0 else tot.t / cnt.n end, 2),
    round(coalesce(st.v, 0), 2),
    round(coalesce(sp.spent, 0) - case when a.ex or cnt.n = 0 then 0 else tot.t / cnt.n end + coalesce(st.v, 0), 2),
    a.ex
  from acc a cross join tot cross join cnt left join sp on sp.acc = a.acc left join st on st.acc = a.acc
  order by 7 desc;
end $$;

-- "Segna come saldato": chi dà a chi (uno dei due, o il proprietario)
create or replace function public.settle_group(g uuid, p_from uuid, p_to uuid, p_amount numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(g) then raise exception 'Non sei in questo gruppo'; end if;
  if auth.uid() not in (p_from, p_to) and not public.is_group_owner(g)
     and not exists (select 1 from public.profiles p where p.id in (p_from, p_to) and p.family_id is not null and p.family_id = public.my_family()) then
    raise exception 'Lo segna chi dà, chi riceve o chi ha creato il gruppo';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Importo non valido'; end if;
  insert into public.group_settlements (group_id, from_user, to_user, amount, created_by) values (g, p_from, p_to, round(p_amount, 2), auth.uid());
end $$;

revoke all on function public.confirm_group_expense(uuid, numeric, jsonb, text), public.set_split_excluded(uuid, uuid, boolean),
  public.group_balances(uuid), public.settle_group(uuid, uuid, uuid, numeric), public.can_edit_expense(public.group_expenses) from public, anon;
grant execute on function public.confirm_group_expense(uuid, numeric, jsonb, text), public.set_split_excluded(uuid, uuid, boolean),
  public.group_balances(uuid), public.settle_group(uuid, uuid, uuid, numeric), public.can_edit_expense(public.group_expenses) to authenticated;

-- a fine spesa lo scontrino del gruppo nasce "da confermare", con i prodotti e il negozio
create or replace function public.shop_group_sync(p_shop uuid, p_finish boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.shops; it jsonb; g jsonb; q numeric; part numeric; st text; per jsonb := '{}'::jsonb; out jsonb := '[]'::jsonb;
  k text; v jsonb; eid uuid;
begin
  select * into s from public.shops where id = p_shop;
  if not found then raise exception 'Spesa non trovata'; end if;
  if s.user_id is distinct from auth.uid() and (s.family_id is null or s.family_id is distinct from public.my_family()) then
    raise exception 'Non è una spesa tua o della tua famiglia';
  end if;
  perform set_config('mc.rientro', 'on', true);
  for it in select * from jsonb_array_elements(coalesce(s.items, '[]'::jsonb)) loop
    if coalesce(jsonb_typeof(it->'groups'), '') <> 'array' then continue; end if;
    st := case when coalesce((it->>'checked')::boolean, false) then 'preso' else 'da_prendere' end;
    q := nullif((it->>'quantity')::numeric, 0);
    for g in select * from jsonb_array_elements(it->'groups') loop
      update public.group_list_items set status = st, updated_at = now()
      where id = (g->>'group_item_id')::uuid and assigned_to = s.user_id and status in ('da_prendere', 'preso');
      if p_finish and st = 'preso' then
        part := case when (it->>'price') is not null and q is not null then (it->>'price')::numeric * (g->>'quantity')::numeric / q else 0 end;
        k := g->>'group_id';
        v := coalesce(per->k, jsonb_build_object('group_id', k, 'group_name', g->>'group_name', 'emoji', g->'emoji', 'amount', 0, 'lines', '[]'::jsonb));
        per := per || jsonb_build_object(k, v || jsonb_build_object('amount', (v->>'amount')::numeric + part,
          'lines', (v->'lines') || jsonb_build_array(jsonb_build_object('name', it->>'name', 'quantity', (g->>'quantity')::numeric,
            'unit', it->>'unit', 'price', round(part, 2)))));
      end if;
    end loop;
  end loop;
  perform set_config('mc.rientro', 'off', true);
  if not p_finish then return '[]'::jsonb; end if;
  if s.group_receipts is not null then return s.group_receipts; end if;
  for k, v in select * from jsonb_each(per) loop
    v := v || jsonb_build_object('amount', round((v->>'amount')::numeric, 2));
    eid := null;
    if exists (select 1 from public.group_members where group_id = k::uuid and user_id = s.user_id) then
      insert into public.group_expenses (group_id, paid_by, amount, note, status, shop_id, store_name, lines, created_by)
      values (k::uuid, s.user_id, greatest((v->>'amount')::numeric, 0.01), left('Spesa da ' || coalesce(s.store_name, 'negozio'), 120),
        'da_confermare', s.id, s.store_name, v->'lines', auth.uid())
      returning id into eid;
    end if;
    out := out || jsonb_build_array(v || jsonb_build_object('saved', eid is not null, 'expense_id', eid));
  end loop;
  update public.shops set group_receipts = out where id = p_shop;
  return out;
end $$;

-- tempo reale per i conti
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'group_expenses') then
    alter publication supabase_realtime add table public.group_expenses;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'group_settlements') then
    alter publication supabase_realtime add table public.group_settlements;
  end if;
exception when undefined_object then null;
end $$;

-- avviso al gruppo quando arriva uno scontrino confermato (i conti sono cambiati)
create or replace function public.trg_group_expense_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare f public.families;
begin
  if new.status = 'confermata' and (tg_op = 'INSERT' or old.status is distinct from 'confermata') then
    select * into f from public.families where id = new.group_id;
    if f.kind = 'evento' then
      perform public.send_family_notification('gruppo_conti', f.id, coalesce(auth.uid(), new.paid_by),
        jsonb_build_object('group', true, 'group_name', f.name, 'group_emoji', f.emoji, 'amount', new.amount,
          'what', coalesce(new.store_name, new.note)));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists group_expense_notify on public.group_expenses;
create trigger group_expense_notify after insert or update of status on public.group_expenses
  for each row execute function public.trg_group_expense_notify();
