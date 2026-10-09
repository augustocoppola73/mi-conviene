-- Prove delle regole di accesso dei gruppi (#12). Da lanciare sul database di PROVA (fa tutto in una transazione e annulla).
-- Uso: psql ... -v ON_ERROR_STOP=1 -f supabase/tests/test_gruppi_rls.sql
begin;
-- persone: A = Augusto (famiglia), M = Moira (famiglia), L = Laura (fuori dalla famiglia, amica della festa)
\set A '11111111-1111-1111-1111-111111111111'
\set M '22222222-2222-2222-2222-222222222222'
\set L 'afadd53b-619c-4179-8700-fecd62bdc200'
create temp table esito (prova text, ok boolean) on commit drop;
grant all on esito to authenticated;

-- dati di famiglia (di Moira) e un gruppo evento con Laura (proprietaria) e Augusto
insert into public.savings (user_id, store_id, verified, data) values (:'M', 'conad', false, '{"amount": 5}');
insert into public.history (user_id, items, store_id, total_cost) values (:'M', '[]', 'conad', 40);
insert into public.recipes (user_id, family_id, name, ingredients) select :'M', family_id, 'Ragù di Moira', '[]' from public.profiles where id = :'M';
insert into public.families (id, kind, name, created_by, code) values ('eeeeeeee-0000-0000-0000-00000000000e', 'evento', 'Festa di sabato', :'L', 'EVT234');
insert into public.group_members (group_id, user_id, role, display_name) values
  ('eeeeeeee-0000-0000-0000-00000000000e', :'L', 'proprietario', 'Laura'),
  ('eeeeeeee-0000-0000-0000-00000000000e', :'A', 'membro', 'Augusto');
insert into public.group_lists (id, group_id, name, created_by) values ('11110000-0000-0000-0000-00000000000e', 'eeeeeeee-0000-0000-0000-00000000000e', 'Spesa festa', :'L');

-- ---------------------------------------------------------------- come LAURA (solo gruppo evento)
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'L', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', :'L', true);
insert into esito select 'Laura NON vede il salvadanaio della famiglia', not exists (select 1 from public.savings where user_id = :'M');
insert into esito select 'Laura NON vede lo storico della famiglia', not exists (select 1 from public.history where user_id = :'M');
insert into esito select 'Laura NON vede le ricette della famiglia', not exists (select 1 from public.recipes where name = 'Ragù di Moira');
insert into esito select 'Laura NON vede le spese in corso della famiglia', not exists (select 1 from public.shops where user_id = :'M');
insert into esito select 'Laura NON vede la lista di famiglia', not exists (select 1 from public.family_lists);
insert into esito select 'Laura NON vede il profilo di Moira', not exists (select 1 from public.profiles where id = :'M');
insert into esito select 'Laura vede SOLO il gruppo evento (non la famiglia)', (select array_agg(kind) from public.families) = array['evento'];
insert into esito select 'Laura vede i membri della festa', (select count(*) from public.group_members where group_id = 'eeeeeeee-0000-0000-0000-00000000000e') = 2;
insert into esito select 'Laura NON vede i membri della famiglia', not exists (select 1 from public.group_members where user_id = :'M');
insert into esito select 'Laura vede la lista della festa', exists (select 1 from public.group_lists where name = 'Spesa festa');
insert into public.group_list_items (list_id, product_id, name, added_by) values ('11110000-0000-0000-0000-00000000000e', 'birra', 'Birra', :'L');
insert into esito select 'Laura aggiunge alla lista della festa', exists (select 1 from public.group_list_items where name = 'Birra');
insert into public.group_expenses (group_id, paid_by, amount, note) values ('eeeeeeee-0000-0000-0000-00000000000e', :'L', 20, 'bibite');
insert into esito select 'Laura segna una sua spesa della festa', exists (select 1 from public.group_expenses where note = 'bibite');
create or replace function pg_temp.prova_join(c text) returns boolean language plpgsql as $$
begin perform public.join_family(c); return false; exception when others then return true; end $$;
insert into esito select 'Un codice di gruppo evento NON fa entrare in una famiglia', pg_temp.prova_join('EVT234');

-- ---------------------------------------------------------------- come MOIRA (solo famiglia)
select set_config('request.jwt.claims', json_build_object('sub', :'M', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', :'M', true);
insert into esito select 'Moira NON vede la festa (non è invitata)', not exists (select 1 from public.families where kind = 'evento');
insert into esito select 'Moira NON vede la lista della festa', not exists (select 1 from public.group_list_items where name = 'Birra');
insert into esito select 'Moira NON vede le spese della festa', not exists (select 1 from public.group_expenses where note = 'bibite');
insert into esito select 'Moira vede il suo salvadanaio', exists (select 1 from public.savings where user_id = :'M');

-- ---------------------------------------------------------------- come AUGUSTO (famiglia + festa)
select set_config('request.jwt.claims', json_build_object('sub', :'A', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', :'A', true);
insert into esito select 'Augusto vede famiglia e festa', (select count(*) from public.families) = 2;
insert into esito select 'Augusto vede il salvadanaio di famiglia (Moira)', exists (select 1 from public.savings where user_id = :'M');
insert into esito select 'Augusto vede la lista della festa', exists (select 1 from public.group_list_items where name = 'Birra');
delete from public.group_list_items where name = 'Birra';  -- non l'ha aggiunta lui e non è proprietario
insert into esito select 'Augusto NON toglie la birra aggiunta da Laura', exists (select 1 from public.group_list_items where name = 'Birra');
insert into esito select 'Augusto NON vede gli inviti della festa (non è proprietario)', not exists (select 1 from public.group_invites);
create or replace function pg_temp.prova_ruolo(a uuid) returns boolean language plpgsql as $$
begin update public.group_members set role = 'proprietario' where user_id = a and group_id = 'eeeeeeee-0000-0000-0000-00000000000e';
  return false; exception when others then return true; end $$;
insert into esito select 'Augusto NON può cambiarsi il ruolo (permesso negato)', pg_temp.prova_ruolo(:'A');
update public.group_members set muted = true where user_id = :'A' and group_id = 'eeeeeeee-0000-0000-0000-00000000000e';
reset role;
insert into esito select 'Augusto può silenziare la festa', (select muted from public.group_members where user_id = :'A' and group_id = 'eeeeeeee-0000-0000-0000-00000000000e');
insert into esito select 'Augusto NON si fa proprietario da solo', (select role from public.group_members where user_id = :'A' and group_id = 'eeeeeeee-0000-0000-0000-00000000000e') = 'membro';

-- ---------------------------------------------------------------- famiglia: i membri seguono profiles.family_id
update public.profiles set family_id = null where id = :'M';
insert into esito select 'Moira esce: non è più membro della famiglia', not exists (select 1 from public.group_members where user_id = :'M' and group_id = '23692106-51a1-4ce8-aca7-74e20e805fb6');
update public.profiles set family_id = '23692106-51a1-4ce8-aca7-74e20e805fb6' where id = :'M';
insert into esito select 'Moira rientra: di nuovo membro', exists (select 1 from public.group_members where user_id = :'M' and group_id = '23692106-51a1-4ce8-aca7-74e20e805fb6' and role = 'membro');
update public.profiles set display_name = 'Moira C.' where id = :'M';
insert into esito select 'Il nome nel gruppo segue il profilo', (select display_name from public.group_members where user_id = :'M' limit 1) = 'Moira C.';

select (case when ok then '✓ ' else '✗ ' end) || prova from esito;
select case when bool_and(ok) then 'TUTTE LE PROVE OK ✓' else 'PROVE FALLITE: ' || count(*) filter (where not ok) end from esito;
rollback;
