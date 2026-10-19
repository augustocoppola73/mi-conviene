-- =====================================================================
-- Secondo giro dei tester: rientro confermato da sé (#58), pareggi doppi (#56), prezzi (#53).
-- Da eseguire una volta in Supabase → SQL Editor (dopo patch_025). Si può rieseguire.
-- =====================================================================

-- due utenti nello stesso conto (la stessa persona o la stessa famiglia)
create or replace function public.same_account(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select a = b or exists (select 1 from public.profiles x join public.profiles y on x.family_id = y.family_id
                          where x.id = a and y.id = b and x.family_id is not null)
$$;
revoke all on function public.same_account(uuid, uuid) from public, anon;
grant execute on function public.same_account(uuid, uuid) to authenticated;

create or replace function public.decide_join_request(g uuid, u uuid, accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare f public.families; r public.group_join_requests; other uuid; me uuid := auth.uid();
begin
  select * into f from public.families where id = g;
  if not found or not public.is_member(g) then raise exception 'Non sei in questo gruppo'; end if;
  select * into r from public.group_join_requests where group_id = g and user_id = u for update;
  if not found or r.status <> 'attesa' then raise exception 'Richiesta non trovata o già decisa'; end if;
  if f.kind = 'evento' and not public.is_group_owner(g) then
    if not (r.rejoin_as is not null
            and exists (select 1 from public.group_members where group_id = g and user_id = r.rejoin_as and role = 'proprietario')
            and me <> r.rejoin_as
            and not exists (select 1 from auth.users where id = me and coalesce(is_anonymous, false))) then
      raise exception 'Decide chi ha creato il gruppo';
    end if;
  end if;
  if r.rejoin_as is not null and r.rejoin_as = me then raise exception 'Non puoi confermare il rientro al tuo posto'; end if;
  if u = me then raise exception 'Non puoi decidere la tua stessa richiesta'; end if;   -- #58: nessuno si conferma da solo
  if accept then
    if r.rejoin_as is not null then
      perform public.do_rejoin(g, u, r.rejoin_as);
    elsif f.kind = 'famiglia' then
      select family_id into other from public.profiles where id = u;
      if other is not null and other <> g then raise exception 'Nel frattempo è entrato in un''altra famiglia'; end if;
      update public.profiles set family_id = g, updated_at = now() where id = u;
    else
      insert into public.group_members (group_id, user_id, role, display_name) values (g, u, 'membro', r.display_name) on conflict do nothing;
    end if;
  end if;
  update public.group_join_requests set status = case when accept then 'accettata' else 'rifiutata' end,
    decided_by = me, decided_at = now() where group_id = g and user_id = u;
end $$;

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
  -- i «Ho dato» ancora da confermare contano già: niente pareggi doppi
  owe := coalesce(owe, 0) - coalesce((select sum(s.amount) from public.group_settlements s
    where s.group_id = g and s.status = 'da_confermare' and public.same_account(s.from_user, p_from)), 0);
  if owe <= 0.005 then raise exception 'Non ha niente da dare (o c''è già un «Ho dato» da confermare)'; end if;
  if coalesce((select b.balance from public.group_balances(g) b where p_to = any(b.members)), 0) <= 0 then
    raise exception 'Può ricevere solo chi deve avere'; end if;
  if p_amount > owe + 0.01 then raise exception 'È più di quanto deve (% €)', replace(to_char(owe, 'FM999990.00'), '.', ','); end if;
  insert into public.group_settlements (group_id, from_user, to_user, amount, created_by, status)
  values (g, p_from, p_to, round(p_amount, 2), auth.uid(), case when recv then 'confermato' else 'da_confermare' end);
end $$;

create or replace function public.confirm_settlement(p_id uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare s public.group_settlements;
begin
  select * into s from public.group_settlements where id = p_id for update;
  if not found or not public.is_member(s.group_id) then raise exception 'Pareggio non trovato'; end if;
  if not public.is_me_or_family(s.to_user) then raise exception 'Lo conferma chi riceve i soldi'; end if;
  if s.status <> 'da_confermare' then raise exception 'Già confermato'; end if;
  if p_ok and coalesce((select -b.balance from public.group_balances(s.group_id) b where s.from_user = any(b.members)), 0) < s.amount - 0.01 then
    raise exception 'Nel frattempo è già stato saldato: tocca «Non li ho» per toglierlo';
  end if;
  if p_ok then update public.group_settlements set status = 'confermato', settled_at = now() where id = p_id;
  else delete from public.group_settlements where id = p_id; end if;
end $$;

-- #53: prezzi più stretti. Niente tetto «20 in tutto» (con più account si cancellavano i prezzi degli altri):
-- restano 4 righe a persona. Gli utenti senza account non segnano prezzi per tutti. Fuori scala: più di 4 volte.
create or replace function public.trim_user_prices() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.user_prices where store_id = new.store_id and product_id = new.product_id and kind = new.kind and user_id = new.user_id
    and id not in (select id from public.user_prices where store_id = new.store_id and product_id = new.product_id
                   and kind = new.kind and user_id = new.user_id order by created_at desc limit 4);
  return null;
end $$;

create or replace function public.trg_user_price_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare oggi date := (now() at time zone 'Europe/Rome')::date; ref numeric;
begin
  if auth.uid() is null then return new; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then return null; end if;
  if new.date is null or new.date > oggi + 1 then new.date := oggi; end if;
  if new.date < oggi - 400 then return null; end if;
  if new.promo_until is not null and new.promo_until > new.date + 62 then new.promo_until := new.date + 62; end if;
  if new.ref_price is null or new.ref_price < 0.05 or new.ref_price > 500 then return null; end if;
  if new.paid is not null and (new.paid <= 0 or new.paid > 1000) then return null; end if;
  select coalesce(
    (select normal_price from public.product_prices where store_id = new.store_id and product_id = new.product_id),
    (select percentile_cont(0.5) within group (order by normal_price) from public.product_prices where product_id = new.product_id))
  into ref;
  if ref is not null and ref > 0 and (new.ref_price > ref * 4 or new.ref_price < ref / 4) then return null; end if;
  if (select count(*) from public.user_prices where user_id = auth.uid() and created_at > now() - interval '1 day') >= 300 then return null; end if;
  return new;
end $$;

notify pgrst, 'reload schema';
