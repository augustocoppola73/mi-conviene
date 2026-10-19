-- =====================================================================
-- #84 firma del listino (il telefono riscarica i prezzi Open Prices solo se cambiati)
-- #88 eliminare l'account e i dati dall'app (Google Play e GDPR)
-- Da eseguire una volta in Supabase → SQL Editor (dopo patch_026). Si può rieseguire.
-- =====================================================================

create or replace function public.price_book_sig() returns text
language sql stable security definer set search_path = public as $$
  select count(*)::text || '|' || coalesce(max(updated_at)::text, '') from public.product_prices
$$;
revoke all on function public.price_book_sig() from public;
grant execute on function public.price_book_sig() to anon, authenticated;

-- indice per scaricare solo i prezzi visti nuovi
create index if not exists user_prices_created_idx on public.user_prices (created_at);

-- eliminare il mio account: prima i gruppi (non devono restare conti a metà), poi tutto il resto in cascata
create or replace function public.delete_my_account(p_confirm text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare me uuid := auth.uid(); g record; fam uuid;
begin
  if me is null then raise exception 'Entra prima nell''app'; end if;
  if upper(trim(coalesce(p_confirm, ''))) <> 'ELIMINA' then raise exception 'Scrivi ELIMINA per confermare'; end if;
  -- gruppi attivi in cui ho pagato o saldato qualcosa: i conti degli altri si romperebbero
  for g in
    select distinct f.id, f.name from public.families f
    where f.kind = 'evento' and f.archived_at is null
      and (exists (select 1 from public.group_expenses e where e.group_id = f.id and e.paid_by = me)
        or exists (select 1 from public.group_settlements s where s.group_id = f.id and (s.from_user = me or s.to_user = me)))
  loop
    raise exception 'Nel gruppo «%» ci sono spese o pareggi tuoi: prima chiudete i conti e archiviate il gruppo (o eliminatelo), poi elimina l''account', g.name;
  end loop;
  -- esco dai gruppi (la proprietà passa a un altro) e dalla famiglia
  for g in select gm.group_id from public.group_members gm join public.families f on f.id = gm.group_id where gm.user_id = me and f.kind = 'evento' loop
    perform public.leave_group(g.group_id);
  end loop;
  select family_id into fam from public.profiles where id = me;
  update public.profiles set family_id = null where id = me;
  -- l'account: profilo, liste, spese, salvadanaio, ricette, prezzi visti, telefoni… spariscono in cascata
  delete from auth.users where id = me;
  -- una famiglia rimasta senza nessuno non serve più
  if fam is not null and not exists (select 1 from public.profiles where family_id = fam) then
    delete from public.families where id = fam;
  end if;
end $$;
revoke all on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;

notify pgrst, 'reload schema';
