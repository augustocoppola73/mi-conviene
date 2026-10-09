-- Prove della lista di gruppo (#21): proposte, niente doppioni, quantità, "i miei prodotti del gruppo".
begin;
\set A '11111111-1111-1111-1111-111111111111'
\set L 'afadd53b-619c-4179-8700-fecd62bdc200'
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

select pg_temp.come(:'A');
insert into v select 'g', id from public.create_group('Cena', '🍕', null, 'proprietario');
insert into v select 'l', list_id from public.my_groups() where id = pg_temp.val('g')::uuid;
insert into esito select 'Regola "solo io" salvata', (select add_policy from public.my_groups() where id = pg_temp.val('g')::uuid) = 'proprietario';
insert into v select 'inv', code from public.create_invite(pg_temp.val('g')::uuid);
insert into public.group_list_items (list_id, product_id, name, quantity) values (pg_temp.val('l')::uuid, 'latte', 'Latte', 1);
insert into esito select 'Il proprietario aggiunge direttamente', (select status from public.group_list_items where product_id = 'latte') = 'da_prendere';

select pg_temp.come(:'L');
select public.join_with_invite(pg_temp.val('inv'), 'Laura');
insert into public.group_list_items (list_id, product_id, name, quantity) values (pg_temp.val('l')::uuid, 'custom:birra', 'birra', 6);
insert into esito select 'Laura propone (non aggiunge)', (select status from public.group_list_items where name = 'birra') = 'proposto';
insert into esito select 'Laura non approva la sua proposta', pg_temp.fallisce('update public.group_list_items set status = ''da_prendere'' where name = ''birra''', 'creato il gruppo');
insert into esito select 'Una proposta non si prende', pg_temp.fallisce('update public.group_list_items set assigned_to = auth.uid() where name = ''birra''', 'proposta');
insert into esito select 'Doppione del latte: no', pg_temp.fallisce(format('insert into public.group_list_items (list_id, product_id, name) values (%L, ''latte'', ''Latte'')', pg_temp.val('l')), 'unico');
insert into esito select 'my_groups: 1 proposta', (select proposals from public.my_groups() where id = pg_temp.val('g')::uuid) = 1;

select pg_temp.come(:'A');
update public.group_list_items set status = 'da_prendere' where name = 'birra';
insert into esito select 'Augusto accetta la proposta', (select status from public.group_list_items where name = 'birra') = 'da_prendere';
update public.group_list_items set assigned_to = :'A' where product_id = 'latte';

select pg_temp.come(:'L');
insert into esito select 'Laura non cambia la quantità del latte preso da Augusto', pg_temp.fallisce('update public.group_list_items set quantity = 3 where product_id = ''latte''', 'chiedi');
update public.group_list_items set quantity = 8 where name = 'birra';
insert into esito select 'Quantità di un prodotto libero: la cambia chiunque', (select quantity from public.group_list_items where name = 'birra') = 8;

select pg_temp.come(:'A');
update public.group_list_items set quantity = 2 where product_id = 'latte';
insert into esito select 'my_group_items di Augusto: il latte (2) con il gruppo',
  (select count(*) = 1 and min(quantity) = 2 and min(group_name) = 'Cena' from public.my_group_items() where group_id = pg_temp.val('g')::uuid);
update public.group_list_items set status = 'preso' where product_id = 'latte';

select pg_temp.come(:'L');
insert into esito select 'Laura non rimette "da prendere" il latte di Augusto', pg_temp.fallisce('update public.group_list_items set status = ''da_prendere'' where product_id = ''latte''', 'altro');
insert into public.group_list_items (list_id, product_id, name) values (pg_temp.val('l')::uuid, 'latte', 'Latte');
insert into esito select 'Latte già preso: se ne può proporre di nuovo', (select count(*) from public.group_list_items where product_id = 'latte') = 2;
with d as (delete from public.group_list_items where product_id = 'latte' and status = 'proposto' returning 1)
  insert into esito select 'Laura ritira la sua proposta', (select count(*) from d) = 1;

select pg_temp.come(:'A');
select public.update_group(pg_temp.val('g')::uuid, 'Cena', '🍕', null, 'tutti');
select pg_temp.come(:'L');
insert into public.group_list_items (list_id, product_id, name) values (pg_temp.val('l')::uuid, 'custom:pane', 'pane');
insert into esito select 'Con "tutti" Laura aggiunge direttamente', (select status from public.group_list_items where name = 'pane') = 'da_prendere';
reset role;

select (case when ok then '✓ ' else '✗ ' end) || prova from esito;
select case when bool_and(ok) then 'TUTTE LE PROVE OK ✓' else 'PROVE FALLITE: ' || count(*) filter (where not ok) end from esito;
rollback;
