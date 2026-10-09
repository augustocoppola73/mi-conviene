-- Prove dei gruppi evento e di "Lo prendo io" (#14). Solo sul database di PROVA: transazione annullata alla fine.
begin;
\set A '11111111-1111-1111-1111-111111111111'
\set L 'afadd53b-619c-4179-8700-fecd62bdc200'
\set X '38ec4af5-45e6-420c-a719-9e0c30653623'
create temp table esito (prova text, ok boolean) on commit drop;
create temp table v (k text primary key, val text) on commit drop;
grant all on esito, v to authenticated;
create or replace function pg_temp.come(u text, anon boolean default false) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'is_anonymous', anon)::text, true),
         set_config('request.jwt.claim.sub', u, true); $$;
create or replace function pg_temp.fallisce(q text, msg text default null) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return msg is null or sqlerrm ilike '%' || msg || '%'; end $$;
create or replace function pg_temp.val(key text) returns text language sql as $$ select val from v where k = key $$;
grant execute on function pg_temp.come(text, boolean), pg_temp.fallisce(text, text), pg_temp.val(text) to authenticated;
delete from public.notif_test;
set local role authenticated;

-- chi è entrato senza account non crea gruppi (D2)
select pg_temp.come(:'L', true);
insert into esito select 'Senza account: niente nuovo gruppo', pg_temp.fallisce('select public.create_group(''Festa'')', 'salva prima');

-- Augusto crea "Festa di sabato" per dopodomani
select pg_temp.come(:'A');
insert into esito select 'Senza nome: no', pg_temp.fallisce('select public.create_group(''  '')', 'nome');
insert into v select 'g', id from public.create_group('Festa di sabato', '🎉', current_date + 2);
insert into esito select 'Augusto è proprietario e c''è una lista', (select role from public.group_members where group_id = pg_temp.val('g')::uuid and user_id = :'A') = 'proprietario'
  and exists (select 1 from public.group_lists where group_id = pg_temp.val('g')::uuid);
insert into v select 'l', list_id from public.my_groups() where id = pg_temp.val('g')::uuid;
insert into esito select 'my_groups: la festa con 1 membro', (select members = 1 and emoji = '🎉' from public.my_groups() where id = pg_temp.val('g')::uuid);
insert into esito select 'La famiglia di Augusto non cambia', (select family_id from public.profiles where id = :'A') is distinct from pg_temp.val('g')::uuid;
insert into v select 'inv', code from public.create_invite(pg_temp.val('g')::uuid);
insert into esito select 'Invito festa: usi illimitati, niente approvazione, scade il giorno dopo l''evento',
  (select max_uses is null and not needs_approval and expires_at::date = current_date + 3 from public.group_invites where code = pg_temp.val('inv'));

-- Laura (senza account) entra col link e aggiunge le patatine
select pg_temp.come(:'L', true);
insert into esito select 'Laura entra subito', (select public.join_with_invite(pg_temp.val('inv'), 'Laura')->>'status') = 'joined';
insert into public.group_list_items (list_id, product_id, name, added_by, assigned_to, status)
  values (pg_temp.val('l')::uuid, 'custom:patatine', 'patatine', :'A', :'A', 'preso');
insert into esito select 'Nuovo prodotto: è di Laura, libero e da prendere',
  (select added_by = :'L' and assigned_to is null and status = 'da_prendere' from public.group_list_items where name = 'patatine');
insert into public.group_list_items (list_id, product_id, name, added_by) values (pg_temp.val('l')::uuid, 'custom:birra', 'birra', :'L');
insert into public.group_list_items (list_id, product_id, name, added_by) values (pg_temp.val('l')::uuid, 'custom:pane', 'pane', :'L');

-- X (fuori) non vede e non aggiunge
select pg_temp.come(:'X');
insert into esito select 'Chi è fuori non vede la lista', not exists (select 1 from public.group_list_items where list_id = pg_temp.val('l')::uuid);
insert into esito select 'Chi è fuori non aggiunge',
  pg_temp.fallisce(format('insert into public.group_list_items (list_id, product_id, added_by) values (%L, ''x'', %L)', pg_temp.val('l'), :'X'));

-- "Lo prendo io"
select pg_temp.come(:'A');
update public.group_list_items set assigned_to = :'A' where name = 'birra';
insert into esito select 'Augusto prende la birra', (select assigned_to from public.group_list_items where name = 'birra') = :'A';
select pg_temp.come(:'L', true);
insert into esito select 'Laura non può prendere la birra di Augusto', pg_temp.fallisce('update public.group_list_items set assigned_to = auth.uid() where name = ''birra''', 'già');
insert into esito select 'Laura non può lasciare la birra di Augusto', pg_temp.fallisce('update public.group_list_items set assigned_to = null where name = ''birra''', 'altro');
insert into esito select 'Laura non può assegnarla ad altri', pg_temp.fallisce(format('update public.group_list_items set assigned_to = %L where name = ''pane''', :'A'), 'solo per te');
with d as (delete from public.group_list_items where name = 'birra' returning 1)
  insert into esito select 'Laura non toglie la birra presa da Augusto', (select count(*) from d) = 0;
update public.group_list_items set status = 'preso' where name = 'pane';
insert into esito select 'Spuntato "preso" senza prenderlo prima: è di Laura', (select assigned_to = :'L' and status = 'preso' from public.group_list_items where name = 'pane');
update public.group_list_items set assigned_to = :'L' where name = 'patatine';
select pg_temp.come(:'A');
with u as (update public.group_list_items set assigned_to = null where name = 'patatine' returning 1)
  insert into esito select 'Il proprietario può liberare un prodotto', (select count(*) from u) = 1;
insert into esito select 'Augusto non cambia il gruppo di un altro... ma il suo sì',
  (select name from public.update_group(pg_temp.val('g')::uuid, 'Festa grande', '🎂', current_date + 2)) = 'Festa grande';
select pg_temp.come(:'L', true);
insert into esito select 'Laura non rinomina il gruppo', pg_temp.fallisce(format('select public.update_group(%L, ''Mia'')', pg_temp.val('g')), 'solo chi');
insert into esito select 'Laura vede il gruppo e i membri', (select count(*) from public.group_members where group_id = pg_temp.val('g')::uuid) = 2;
insert into esito select 'Laura NON vede la famiglia di Augusto', not exists (select 1 from public.families where kind = 'famiglia');
update public.group_list_items set assigned_to = :'L' where name = 'patatine';
-- Laura esce: le patatine tornano libere
select public.leave_group(pg_temp.val('g')::uuid);
select pg_temp.come(:'A');
insert into esito select 'Laura uscita: le patatine sono di nuovo libere', (select assigned_to from public.group_list_items where name = 'patatine') is null;
insert into esito select 'my_groups: 1 membro, 2 da prendere', (select members = 1 and todo = 2 from public.my_groups() where id = pg_temp.val('g')::uuid);
-- silenziare il gruppo: solo il proprio
update public.group_members set muted = true where group_id = pg_temp.val('g')::uuid and user_id = :'A';
insert into esito select 'Silenziato', (select muted from public.my_groups() where id = pg_temp.val('g')::uuid);
-- l'ultimo che esce chiude il gruppo
select public.leave_group(pg_temp.val('g')::uuid);
reset role;
insert into esito select 'Uscito l''ultimo: il gruppo non c''è più', not exists (select 1 from public.families where id = pg_temp.val('g')::uuid);
insert into esito select 'Avvisi: ingresso e prodotti aggiunti',
  (select count(*) filter (where kind = 'gruppo_ingresso') = 1 and count(*) filter (where kind = 'gruppo_lista') = 3 from public.notif_test);

select (case when ok then '✓ ' else '✗ ' end) || prova from esito;
select case when bool_and(ok) then 'TUTTE LE PROVE OK ✓' else 'PROVE FALLITE: ' || count(*) filter (where not ok) end from esito;
rollback;
