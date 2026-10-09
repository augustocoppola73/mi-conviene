-- Prove dei conti del gruppo (#16): scontrini da confermare, una famiglia = un conto, saldi e pareggi.
begin;
\set A '11111111-1111-1111-1111-111111111111'
\set M '22222222-2222-2222-2222-222222222222'
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
create or replace function pg_temp.saldo(u text) returns numeric language sql as $$
  select balance from public.group_balances(pg_temp.val('g')::uuid) where u::uuid = any(members) $$;
grant execute on function pg_temp.come(text), pg_temp.fallisce(text, text), pg_temp.val(text), pg_temp.saldo(text) to authenticated;
set local role authenticated;

select pg_temp.come(:'A');
insert into v select 'g', id from public.create_group('Festa', '🎉');
insert into v select 'inv', code from public.create_invite(pg_temp.val('g')::uuid);
select pg_temp.come(:'M'); select public.join_with_invite(pg_temp.val('inv'), 'Moira');
select pg_temp.come(:'L'); select public.join_with_invite(pg_temp.val('inv'), 'Laura');

insert into esito select 'Una famiglia = un conto (Augusto e Moira) + Laura',
  (select count(*) = 2 and bool_or(label = 'Augusto e Moira') from public.group_balances(pg_temp.val('g')::uuid));

select pg_temp.come(:'A');
insert into public.group_expenses (group_id, paid_by, amount, note) values (pg_temp.val('g')::uuid, :'A', 30, 'Pizze');
insert into esito select 'Augusto paga 30: famiglia avere 15, Laura dare 15', pg_temp.saldo(:'A') = 15 and pg_temp.saldo(:'L') = -15;
select pg_temp.come(:'L');
insert into public.group_expenses (group_id, paid_by, amount, note) values (pg_temp.val('g')::uuid, :'L', 10, 'Ghiaccio');
insert into esito select 'Laura paga 10: famiglia avere 10, Laura dare 10', pg_temp.saldo(:'M') = 10 and pg_temp.saldo(:'L') = -10;
insert into esito select 'Non si segna una spesa a nome di un altro',
  pg_temp.fallisce(format('insert into public.group_expenses (group_id, paid_by, amount) values (%L, %L, 5)', pg_temp.val('g'), :'A'));

-- scontrino da confermare (nasce a fine spesa): pagato da Moira
reset role;
with x as (insert into public.group_expenses (group_id, paid_by, amount, status, store_name)
  values (pg_temp.val('g')::uuid, :'M', 6, 'da_confermare', 'Lidl') returning id)
insert into v select 'e', id::text from x;
set local role authenticated;
select pg_temp.come(:'L');
insert into esito select 'Laura non vede lo scontrino ancora da confermare', not exists (select 1 from public.group_expenses where id = pg_temp.val('e')::uuid);
insert into esito select 'Da confermare non sposta i conti', pg_temp.saldo(:'L') = -10;
insert into esito select 'Laura non lo conferma', pg_temp.fallisce(format('select public.confirm_group_expense(%L, 8)', pg_temp.val('e')), 'chi l''ha pagato');
select pg_temp.come(:'A');
insert into esito select 'Augusto (stessa famiglia) lo vede', exists (select 1 from public.group_expenses where id = pg_temp.val('e')::uuid);
select public.confirm_group_expense(pg_temp.val('e')::uuid, 8, '[{"name":"birra","price":8}]'::jsonb);
insert into esito select 'Confermato a 8: famiglia avere 14, Laura dare 14', pg_temp.saldo(:'A') = 14 and pg_temp.saldo(:'L') = -14;
select pg_temp.come(:'L');
insert into esito select 'Ora Laura lo vede, con i prodotti', (select lines->0->>'name' from public.group_expenses where id = pg_temp.val('e')::uuid) = 'birra';
-- pareggio
select public.settle_group(pg_temp.val('g')::uuid, :'L', :'A', 14);
insert into esito select 'Laura dà 14 ad Augusto: tutti in pari', pg_temp.saldo(:'A') = 0 and pg_temp.saldo(:'L') = 0;
insert into esito select 'Laura non esclude nessuno', pg_temp.fallisce(format('select public.set_split_excluded(%L, %L, true)', pg_temp.val('g'), :'L'), 'creato');
select pg_temp.come(:'A');
select public.set_split_excluded(pg_temp.val('g')::uuid, :'L', true);
insert into esito select 'Laura esclusa: la famiglia paga tutto (48), Laura riprende i suoi 10 + 14',
  pg_temp.saldo(:'A') = -24 and pg_temp.saldo(:'L') = 24;
reset role;

select (case when ok then '✓ ' else '✗ ' end) || prova from esito;
select case when bool_and(ok) then 'TUTTE LE PROVE OK ✓' else 'PROVE FALLITE: ' || count(*) filter (where not ok) end from esito;
rollback;
