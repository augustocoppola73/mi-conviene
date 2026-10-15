-- =====================================================================
-- Gruppi: cassa comune con budget (#47) e «Chi porta cosa» (#50).
-- Da eseguire una volta in Supabase → SQL Editor (dopo patch_020). Si può rieseguire.
-- =====================================================================

-- #47: budget dell'evento, in tutto oppure a testa (a testa = per ogni persona del gruppo)
alter table public.families add column if not exists budget numeric;
alter table public.families add column if not exists budget_per_head boolean not null default false;

create or replace function public.set_group_budget(g uuid, p_amount numeric, p_per_head boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_owner(g) then raise exception 'Il budget lo decide chi ha creato il gruppo'; end if;
  if p_amount is not null and (p_amount <= 0 or p_amount > 100000) then raise exception 'Importo non valido'; end if;
  update public.families set budget = case when p_amount is null then null else round(p_amount, 2) end,
    budget_per_head = coalesce(p_per_head, false)
  where id = g and kind = 'evento';
end $$;
revoke all on function public.set_group_budget(uuid, numeric, boolean) from public, anon;
grant execute on function public.set_group_budget(uuid, numeric, boolean) to authenticated;

-- #50: righe "da portare" (non si comprano: nessun negozio, nessun prezzo, solo «Lo porto io»)
alter table public.group_list_items add column if not exists kind text not null default 'compra';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'group_list_items_kind_check') then
    alter table public.group_list_items add constraint group_list_items_kind_check check (kind in ('compra', 'porta'));
  end if;
end $$;

-- i gruppi con il budget
drop function if exists public.my_groups();
create or replace function public.my_groups()
returns table (id uuid, name text, emoji text, event_date date, role text, members int, todo int, muted boolean, list_id uuid,
  add_policy text, proposals int, budget numeric, budget_per_head boolean)
language sql stable security definer set search_path = public as $$
  select f.id, f.name, f.emoji, f.event_date, m.role,
    (select count(*)::int from public.group_members x where x.group_id = f.id),
    (select count(*)::int from public.group_list_items i join public.group_lists l on l.id = i.list_id
       where l.group_id = f.id and i.status = 'da_prendere'),
    m.muted,
    (select l.id from public.group_lists l where l.group_id = f.id order by l.created_at limit 1),
    f.add_policy,
    (select count(*)::int from public.group_list_items i join public.group_lists l on l.id = i.list_id
       where l.group_id = f.id and i.status = 'proposto'),
    f.budget, f.budget_per_head
  from public.group_members m join public.families f on f.id = m.group_id
  where m.user_id = auth.uid() and f.kind = 'evento' and f.archived_at is null
  order by f.event_date nulls last, f.created_at
$$;

-- nella mia lista della spesa entrano solo le cose da comprare, non quelle da portare
create or replace function public.my_group_items()
returns table (id uuid, group_id uuid, group_name text, group_emoji text, product_id text, name text, quantity numeric, unit text, category_id text)
language sql stable security definer set search_path = public as $$
  select i.id, f.id, f.name, f.emoji, i.product_id, i.name, i.quantity, i.unit, i.category_id
  from public.group_list_items i join public.group_lists l on l.id = i.list_id join public.families f on f.id = l.group_id
  where i.assigned_to = auth.uid() and i.status = 'da_prendere' and i.kind = 'compra' and f.archived_at is null and public.is_member(f.id)
  order by f.name, i.created_at
$$;

revoke all on function public.my_groups(), public.my_group_items() from public, anon;
grant execute on function public.my_groups(), public.my_group_items() to authenticated;

notify pgrst, 'reload schema';
