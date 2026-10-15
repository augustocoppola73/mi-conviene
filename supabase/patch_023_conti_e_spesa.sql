-- =====================================================================
-- Conti e spesa (sessione QA): #56 pareggi confermati da chi riceve, #57 conti di chi esce o rientra,
-- #59 chiusure doppie, #60 chi può chiudere o annullare la spesa.
-- Da eseguire una volta in Supabase → SQL Editor (dopo patch_022). Si può rieseguire.
-- =====================================================================

-- ---------------------------------------------------------------- #59/#60: la spesa la chiude (o annulla) chi la sta facendo, una volta sola
create or replace function public.trg_shop_status_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); doer uuid;
begin
  if me is null or new.status is not distinct from old.status then return new; end if;
  if old.status <> 'active' then raise exception 'Questa spesa è già chiusa'; end if;
  if new.status in ('done', 'cancelled') then
    doer := coalesce((old.taken_by->>'user_id')::uuid, old.user_id);
    if doer <> me then
      raise exception 'La % chi la sta facendo (%)', case when new.status = 'done' then 'chiude' else 'annulla' end,
        coalesce(old.taken_by->>'name', 'un familiare');
    end if;
    if new.status = 'done' then new.finished_at := coalesce(new.finished_at, now()); end if;
  end if;
  return new;
end $$;
drop trigger if exists shops_status_guard on public.shops;
create trigger shops_status_guard before update of status on public.shops for each row execute function public.trg_shop_status_guard();

-- scontrini del gruppo: una chiusura alla volta (niente doppioni) e li paga chi ha fatto la spesa
create or replace function public.shop_group_sync(p_shop uuid, p_finish boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.shops; it jsonb; g jsonb; q numeric; part numeric; st text; per jsonb := '{}'::jsonb; out jsonb := '[]'::jsonb;
  k text; v jsonb; eid uuid; who uuid; payer uuid;
begin
  select * into s from public.shops where id = p_shop for update;   -- due telefoni insieme: uno alla volta
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
  who := coalesce((s.taken_by->>'user_id')::uuid, s.user_id);   -- ha pagato chi ha fatto la spesa
  if s.group_receipts is not null then return s.group_receipts; end if;
  for k, v in select * from jsonb_each(per) loop
    v := v || jsonb_build_object('amount', round((v->>'amount')::numeric, 2));
    eid := null;
    -- ha pagato chi ha fatto la spesa; se lui non è nel gruppo, chi aveva preso i prodotti (stessa famiglia, stesso conto)
    payer := case when exists (select 1 from public.group_members where group_id = k::uuid and user_id = who) then who
                  when exists (select 1 from public.group_members where group_id = k::uuid and user_id = s.user_id) then s.user_id end;
    if payer is not null then
      insert into public.group_expenses (group_id, paid_by, amount, note, status, shop_id, store_name, lines, created_by)
      values (k::uuid, payer, greatest((v->>'amount')::numeric, 0.01), left('Spesa da ' || coalesce(s.store_name, 'negozio'), 120),
        'da_confermare', s.id, s.store_name, v->'lines', auth.uid())
      returning id into eid;
    end if;
    out := out || jsonb_build_array(v || jsonb_build_object('saved', eid is not null, 'expense_id', eid));
  end loop;
  update public.shops set group_receipts = out where id = p_shop;
  return out;
end $$;
revoke all on function public.shop_group_sync(uuid, boolean) from public, anon;
grant execute on function public.shop_group_sync(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- #56: pareggi confermati da chi riceve
alter table public.group_settlements add column if not exists status text not null default 'confermato';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'group_settlements_status_check') then
    alter table public.group_settlements add constraint group_settlements_status_check check (status in ('da_confermare', 'confermato'));
  end if;
end $$;
-- niente inserimenti diretti: solo con settle_group (che controlla)
drop policy if exists "pareggi: segno" on public.group_settlements;

-- io (o la mia famiglia) sono questa persona?
create or replace function public.is_me_or_family(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select u = auth.uid() or (public.my_family() is not null and exists (select 1 from public.profiles p where p.id = u and p.family_id = public.my_family()))
$$;

-- ---------------------------------------------------------------- #57: conti con gli ex membri e quote al centesimo
create or replace function public.group_balances(g uuid)
returns table (account text, label text, members uuid[], spent numeric, share numeric, settled numeric, balance numeric, excluded boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_member(g) then raise exception 'Non sei in questo gruppo'; end if;
  return query
  with ppl as (
    -- chi è nel gruppo…
    select gm.user_id, coalesce(nullif(trim(gm.display_name), ''), 'Senza nome') as nm, gm.excluded_from_split as ex, gm.joined_at
    from public.group_members gm where gm.group_id = g
    union all
    -- …e chi è uscito ma ha pagato o ha pareggi: i suoi conti restano
    select x.u, coalesce(nullif(trim(p.display_name), ''), 'Ex membro') || ' (uscito)', false, 'infinity'::timestamptz
    from (select e.paid_by as u from public.group_expenses e where e.group_id = g and e.status = 'confermata' and e.paid_by is not null
          union select s.from_user from public.group_settlements s where s.group_id = g and s.status = 'confermato' and s.from_user is not null
          union select s.to_user from public.group_settlements s where s.group_id = g and s.status = 'confermato' and s.to_user is not null) x
    left join public.profiles p on p.id = x.u
    where not exists (select 1 from public.group_members gm where gm.group_id = g and gm.user_id = x.u)
  ), m as (
    select ppl.*, coalesce(pr.family_id::text, ppl.user_id::text) as acc from ppl left join public.profiles pr on pr.id = ppl.user_id
  ), acc as (
    select m.acc, string_agg(m.nm, ' e ' order by m.joined_at) as label, array_agg(m.user_id order by m.joined_at) as members, bool_and(m.ex) as ex
    from m group by m.acc
  ), sp as (
    select coalesce(pf.family_id::text, e.paid_by::text) as acc, sum(e.amount) as spent
    from public.group_expenses e left join public.profiles pf on pf.id = e.paid_by
    where e.group_id = g and e.status = 'confermata' and e.paid_by is not null
    group by 1
  ), st as (
    select x.acc, sum(x.v) as v from (
      select coalesce(pf.family_id::text, s.from_user::text) as acc, s.amount as v
        from public.group_settlements s left join public.profiles pf on pf.id = s.from_user where s.group_id = g and s.status = 'confermato'
      union all
      select coalesce(pt.family_id::text, s.to_user::text), -s.amount
        from public.group_settlements s left join public.profiles pt on pt.id = s.to_user where s.group_id = g and s.status = 'confermato'
    ) x group by x.acc
  ), tot as (
    select round(coalesce(sum(spent), 0) * 100)::bigint as c from sp
  ), cnt as (
    select count(*) filter (where not ex) as n from acc
  ), q as (
    -- quote in centesimi: i centesimi di resto vanno ai primi conti (la somma torna sempre)
    select a.acc, case when a.ex or cnt.n = 0 then 0
      else (tot.c / cnt.n) + case when (row_number() over (partition by a.ex order by a.acc)) <= (tot.c % cnt.n) then 1 else 0 end end as c
    from acc a cross join tot cross join cnt
  )
  select a.acc, a.label, a.members, round(coalesce(sp.spent, 0), 2),
    round(q.c / 100.0, 2), round(coalesce(st.v, 0), 2),
    round(coalesce(sp.spent, 0) - q.c / 100.0 + coalesce(st.v, 0), 2),
    a.ex
  from acc a join q on q.acc = a.acc left join sp on sp.acc = a.acc left join st on st.acc = a.acc
  order by 7 desc;
end $$;

-- «Ho dato» (da confermare) o «Ricevuto» (confermato subito): solo chi dà o chi riceve, tra persone del gruppo, non più del debito
create or replace function public.settle_group(g uuid, p_from uuid, p_to uuid, p_amount numeric) returns void
language plpgsql security definer set search_path = public as $$
declare owe numeric; recv boolean; pay boolean;
begin
  if not public.is_member(g) then raise exception 'Non sei in questo gruppo'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Importo non valido'; end if;
  if p_from is null or p_to is null or p_from = p_to then raise exception 'Scegli chi dà e chi riceve'; end if;
  if not exists (select 1 from public.group_balances(g) b where p_from = any(b.members))
     or not exists (select 1 from public.group_balances(g) b where p_to = any(b.members)) then
    raise exception 'Può dare o ricevere solo chi è nei conti del gruppo';
  end if;
  recv := public.is_me_or_family(p_to);
  pay := public.is_me_or_family(p_from);
  if not (recv or pay) then raise exception 'Lo segna chi dà o chi riceve'; end if;
  select -b.balance into owe from public.group_balances(g) b where p_from = any(b.members);
  if coalesce(owe, 0) <= 0 then raise exception 'Non ha niente da dare'; end if;
  if p_amount > owe + 0.01 then raise exception 'È più di quanto deve (% €)', replace(to_char(owe, 'FM999990.00'), '.', ','); end if;
  insert into public.group_settlements (group_id, from_user, to_user, amount, created_by, status)
  values (g, p_from, p_to, round(p_amount, 2), auth.uid(), case when recv then 'confermato' else 'da_confermare' end);
end $$;

-- chi riceve conferma (o dice che non è vero)
create or replace function public.confirm_settlement(p_id uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare s public.group_settlements;
begin
  select * into s from public.group_settlements where id = p_id for update;
  if not found or not public.is_member(s.group_id) then raise exception 'Pareggio non trovato'; end if;
  if not public.is_me_or_family(s.to_user) then raise exception 'Lo conferma chi riceve i soldi'; end if;
  if s.status <> 'da_confermare' then raise exception 'Già confermato'; end if;
  if p_ok then update public.group_settlements set status = 'confermato', settled_at = now() where id = p_id;
  else delete from public.group_settlements where id = p_id; end if;
end $$;

-- annullare un pareggio: chi l'ha segnato finché è da confermare; chi riceve sempre (un tocco sbagliato si rimedia)
create or replace function public.delete_settlement(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.group_settlements;
begin
  select * into s from public.group_settlements where id = p_id;
  if not found or not public.is_member(s.group_id) then raise exception 'Pareggio non trovato'; end if;
  if not (public.is_me_or_family(s.to_user) or (s.status = 'da_confermare' and s.created_by = auth.uid())) then
    raise exception 'Lo annulla chi riceve i soldi';
  end if;
  delete from public.group_settlements where id = p_id;
end $$;

revoke all on function public.settle_group(uuid, uuid, uuid, numeric), public.confirm_settlement(uuid, boolean), public.delete_settlement(uuid),
  public.group_balances(uuid), public.is_me_or_family(uuid) from public, anon;
grant execute on function public.settle_group(uuid, uuid, uuid, numeric), public.confirm_settlement(uuid, boolean), public.delete_settlement(uuid),
  public.group_balances(uuid), public.is_me_or_family(uuid) to authenticated;

notify pgrst, 'reload schema';
