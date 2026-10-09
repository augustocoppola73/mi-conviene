-- =====================================================================
-- #21: spesa di famiglia con prodotti di un gruppo. Se in negozio spunta un familiare (es. Moira, che può essere
-- anche nel gruppo della festa) o se è lei a chiudere la spesa, i prodotti del gruppo risultano presi lo stesso
-- e lo scontrino del gruppo viene segnato una volta sola, a nome di chi li aveva presi in carico.
-- Da eseguire una volta in Supabase → SQL Editor (dopo patch_014). Si può rieseguire.
-- =====================================================================
alter table public.shops add column if not exists group_receipts jsonb;

create or replace function public.shop_group_sync(p_shop uuid, p_finish boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.shops; it jsonb; g jsonb; q numeric; part numeric; st text; per jsonb := '{}'::jsonb; out jsonb := '[]'::jsonb;
  k text; v jsonb;
begin
  select * into s from public.shops where id = p_shop;
  if not found then raise exception 'Spesa non trovata'; end if;
  if s.user_id is distinct from auth.uid() and (s.family_id is null or s.family_id is distinct from public.my_family()) then
    raise exception 'Non è una spesa tua o della tua famiglia';
  end if;
  perform set_config('mc.rientro', 'on', true);   -- passaggio di servizio: il prodotto è di chi ha preparato la spesa
  for it in select * from jsonb_array_elements(coalesce(s.items, '[]'::jsonb)) loop
    if coalesce(jsonb_typeof(it->'groups'), '') <> 'array' then continue; end if;
    st := case when coalesce((it->>'checked')::boolean, false) then 'preso' else 'da_prendere' end;
    q := nullif((it->>'quantity')::numeric, 0);
    for g in select * from jsonb_array_elements(it->'groups') loop
      update public.group_list_items set status = st, updated_at = now()
      where id = (g->>'group_item_id')::uuid and assigned_to = s.user_id and status in ('da_prendere', 'preso');
      if p_finish and st = 'preso' and (it->>'price') is not null and q is not null then
        part := (it->>'price')::numeric * (g->>'quantity')::numeric / q;
        k := g->>'group_id';
        v := coalesce(per->k, jsonb_build_object('group_id', k, 'group_name', g->>'group_name', 'emoji', g->'emoji', 'amount', 0, 'lines', 0));
        per := per || jsonb_build_object(k, v || jsonb_build_object('amount', (v->>'amount')::numeric + part, 'lines', (v->>'lines')::int + 1));
      end if;
    end loop;
  end loop;
  perform set_config('mc.rientro', 'off', true);
  if not p_finish then return '[]'::jsonb; end if;
  if s.group_receipts is not null then return s.group_receipts; end if;   -- già segnato: niente doppioni
  for k, v in select * from jsonb_each(per) loop
    v := v || jsonb_build_object('amount', round((v->>'amount')::numeric, 2));
    if (v->>'amount')::numeric > 0 and exists (select 1 from public.group_members where group_id = k::uuid and user_id = s.user_id) then
      insert into public.group_expenses (group_id, paid_by, amount, note)
      values (k::uuid, s.user_id, (v->>'amount')::numeric, left('Spesa da ' || coalesce(s.store_name, 'negozio'), 120));
      v := v || jsonb_build_object('saved', true);
    else
      v := v || jsonb_build_object('saved', false);
    end if;
    out := out || jsonb_build_array(v);
  end loop;
  update public.shops set group_receipts = out where id = p_shop;
  return out;
end $$;
revoke all on function public.shop_group_sync(uuid, boolean) from public, anon;
grant execute on function public.shop_group_sync(uuid, boolean) to authenticated;
