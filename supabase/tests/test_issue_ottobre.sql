-- Prove delle regole aggiunte a ottobre (patch_028-030): uscire con un debito, togliere un membro, piano festa,
-- proposte rifiutate, spesa annullata e Salvadanaio, togliere un familiare che ha ricette. Transazione annullata alla fine.
begin;
\set A '11111111-1111-1111-1111-111111111111'
\set M '22222222-2222-2222-2222-222222222222'
\set L 'afadd53b-619c-4179-8700-fecd62bdc200'
\set FAM '23692106-51a1-4ce8-aca7-74e20e805fb6'
create temp table esito (prova text, ok boolean) on commit drop;
create temp table v (k text primary key, val text) on commit drop;
grant all on esito, v to authenticated;
create or replace function pg_temp.come(u text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', u, true); $$;
create or replace function pg_temp.fallisce(q text, msg text default null) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return msg is null or sqlerrm ilike '%' || msg || '%'; end $$;
create or replace function pg_temp.val(key text) returns text language sql as $$ select val from v where k = key $$;
grant execute on function pg_temp.come(text), pg_temp.fallisce(text, text), pg_temp.val(text) to authenticated;
set local role authenticated;

-- gruppo «solo io» di Augusto con Laura
select pg_temp.come(:'A');
insert into v select 'g', id from public.create_group('Grigliata', '🔥', null, 'proprietario');
insert into v select 'l', list_id from public.my_groups() where id = pg_temp.val('g')::uuid;
insert into v select 'inv', code from public.create_invite(pg_temp.val('g')::uuid);
select pg_temp.come(:'L');
select public.join_with_invite(pg_temp.val('inv'), 'Laura');
insert into public.group_list_items (list_id, product_id, name, quantity) values (pg_temp.val('l')::uuid, 'custom:ghiaccio', 'Ghiaccio', 1);

-- proposta rifiutata: Laura lo viene a sapere
select pg_temp.come(:'A');
delete from public.group_list_items where name = 'Ghiaccio';
select pg_temp.come(:'L');
insert into esito select 'Proposta rifiutata: Laura vede l''avviso', exists (select 1 from public.group_rejections where name = 'Ghiaccio' and rejected_name = 'Augusto');
select pg_temp.come(:'A');
insert into esito select 'Augusto non vede gli avvisi di Laura', not exists (select 1 from public.group_rejections);

-- piano della festa: lo salva il proprietario, lo vedono tutti; Laura (regola «solo io») no
select public.set_group_plan(pg_temp.val('g')::uuid, '{"type":"pizzata","adults":12,"kids":3}');
select pg_temp.come(:'L');
select public.set_group_plan(pg_temp.val('g')::uuid, '{"type":"grigliata","adults":2,"kids":0}');
insert into esito select 'Piano della festa del gruppo', (select event_plan->>'adults' from public.my_groups() where id = pg_temp.val('g')::uuid) = '12';

-- Laura prende il latte e ha un debito: non esce e non si toglie
select pg_temp.come(:'A');
insert into public.group_list_items (list_id, product_id, name, quantity) values (pg_temp.val('l')::uuid, 'latte', 'Latte', 1);
select pg_temp.come(:'L');
update public.group_list_items set assigned_to = auth.uid() where product_id = 'latte';
select pg_temp.come(:'A');
insert into public.group_expenses (group_id, paid_by, amount, note) values (pg_temp.val('g')::uuid, :'A', 30, 'carne');
select public.confirm_group_expense((select id from public.group_expenses where group_id = pg_temp.val('g')::uuid), 30, null);
insert into esito select 'Non si toglie chi deve soldi', pg_temp.fallisce(format('select public.remove_member(%L, %L)', pg_temp.val('g'), :'L'), 'deve ancora');
select pg_temp.come(:'L');
insert into esito select 'Non si esce con un debito', pg_temp.fallisce(format('select public.leave_group(%L)', pg_temp.val('g')), 'devi ancora');
-- pagato e confermato: ora Augusto la toglie e il latte torna libero
select public.settle_group(pg_temp.val('g')::uuid, :'L', :'A', 15);
select pg_temp.come(:'A');
select public.confirm_settlement((select id from public.group_settlements where group_id = pg_temp.val('g')::uuid), true);
select public.remove_member(pg_temp.val('g')::uuid, :'L');
insert into esito select 'Tolta Laura: il latte torna libero', (select assigned_to from public.group_list_items where product_id = 'latte') is null;
insert into esito select 'Tolta Laura: non è più nel gruppo', not exists (select 1 from public.group_members where group_id = pg_temp.val('g')::uuid and user_id = :'L');

-- spesa annullata: il mio risparmio stimato lo tolgo, quello di Moira resta segnato «annullato»
insert into public.savings (id, user_id, store_id, data) values ('aaaaaaaa-0000-0000-0000-000000000001', :'A', 'conad', '{"amount": 4}');
insert into public.shops (id, user_id, store_id, store_name, items, saving_id, status)
  values ('bbbbbbbb-0000-0000-0000-000000000001', :'A', 'conad', 'Conad', '[]', 'aaaaaaaa-0000-0000-0000-000000000001', 'cancelled');
insert into v select 'c1', public.cancel_shop_saving('bbbbbbbb-0000-0000-0000-000000000001', true);
insert into esito select 'Spesa annullata: tolgo il mio risparmio', pg_temp.val('c1') = 'deleted'
  and not exists (select 1 from public.savings where id = 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.come(:'M');
insert into public.savings (id, user_id, store_id, data) values ('aaaaaaaa-0000-0000-0000-000000000002', :'M', 'conad', '{"amount": 5}');
insert into public.shops (id, user_id, store_id, store_name, items, saving_id, status, taken_by)
  values ('bbbbbbbb-0000-0000-0000-000000000002', :'M', 'conad', 'Conad', '[]', 'aaaaaaaa-0000-0000-0000-000000000002', 'active',
          jsonb_build_object('user_id', :'A', 'name', 'Augusto'));
select pg_temp.come(:'A');
update public.shops set status = 'cancelled' where id = 'bbbbbbbb-0000-0000-0000-000000000002';
insert into v select 'c2', public.cancel_shop_saving('bbbbbbbb-0000-0000-0000-000000000002', true);
insert into esito select 'Spesa di Moira annullata da Augusto: voce segnata, non cancellata', pg_temp.val('c2') = 'marked'
  and (select (data->>'amount')::numeric = 0 and (data->>'cancelled')::boolean from public.savings where id = 'aaaaaaaa-0000-0000-0000-000000000002');

-- il proprietario toglie Moira (che ha una ricetta in famiglia): la ricetta va con lei
select pg_temp.come(:'M');
insert into public.recipes (name, ingredients) values ('Ragù di Moira', '[]');
select pg_temp.come(:'A');
insert into esito select 'Augusto toglie Moira dalla famiglia anche se ha ricette', not pg_temp.fallisce(format('select public.remove_member(%L, %L)', :'FAM', :'M'));
reset role;
insert into esito select 'La ricetta di Moira esce con lei', (select family_id from public.recipes where name = 'Ragù di Moira') is null;

select (case when ok then '✓ ' else '✗ ' end) || prova from esito;
select case when bool_and(ok) then 'TUTTE LE PROVE OK ✓' else 'PROVE FALLITE: ' || count(*) filter (where not ok) end from esito;
rollback;
