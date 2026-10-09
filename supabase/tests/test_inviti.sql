-- Prove degli inviti (#13). Solo sul database di PROVA: tutto in una transazione annullata alla fine.
begin;
\set A '11111111-1111-1111-1111-111111111111'
\set M '22222222-2222-2222-2222-222222222222'
\set L 'afadd53b-619c-4179-8700-fecd62bdc200'
\set X '38ec4af5-45e6-420c-a719-9e0c30653623'
\set FAM '23692106-51a1-4ce8-aca7-74e20e805fb6'
create temp table esito (prova text, ok boolean) on commit drop;
create temp table v (k text primary key, val text) on commit drop;
grant all on esito, v to authenticated;
create or replace function pg_temp.come(u text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', u, true); $$;
create or replace function pg_temp.fallisce(q text, msg text default null) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return msg is null or sqlerrm ilike '%' || msg || '%'; end $$;
grant execute on function pg_temp.come(text), pg_temp.fallisce(text, text) to authenticated;
insert into public.savings (user_id, store_id, verified, data) values (:'M', 'conad', false, '{"amount": 5}');
update public.profiles set family_id = null where id in (:'L', :'X');
delete from public.notif_test;

-- Augusto crea un invito in famiglia
set local role authenticated;
select pg_temp.come(:'A');
insert into v select 'fam', code from public.create_invite(:'FAM');
insert into esito select 'Invito famiglia: 48 ore, un uso, con approvazione',
  (select expires_at between now() + interval '47 hours' and now() + interval '49 hours' and max_uses = 1 and needs_approval
   from public.group_invites where code = (select val from v where k = 'fam'));
insert into esito select 'Codice di 8 caratteri senza 0/O/1/I', (select val ~ '^[A-HJ-NP-Z2-9]{8}$' from v where k = 'fam');

-- Laura (fuori) vede l'anteprima e chiede di entrare
select pg_temp.come(:'L');
insert into esito select 'Anteprima: valido, famiglia, invitata da Augusto',
  (select (p->>'valid')::boolean and p->>'kind' = 'famiglia' and p->>'invited_by' = 'Augusto' from (select public.invite_preview((select val from v where k = 'fam')) p) x);
insert into esito select 'Laura entra con l''invito → in attesa di approvazione',
  (select public.join_with_invite((select val from v where k = 'fam'), 'Laura')->>'status') = 'pending';
insert into esito select 'In attesa: Laura NON vede ancora il salvadanaio', not exists (select 1 from public.savings where user_id = :'M');
select pg_temp.come(:'X');
insert into esito select 'Lo stesso invito non vale per un secondo (un uso)',
  (select r->>'status' = 'invalid' and r->>'reason' ilike '%già stato usato%' from (select public.join_with_invite((select val from v where k = 'fam')) r) x);

-- Moira (familiare) vede la richiesta e accetta
select pg_temp.come(:'M');
insert into esito select 'Moira vede la richiesta di Laura', exists (select 1 from public.group_pending_requests(:'FAM') where user_id = :'L');
select public.decide_join_request(:'FAM', :'L', true);
select pg_temp.come(:'L');
insert into esito select 'Accettata: Laura è in famiglia e vede il salvadanaio', exists (select 1 from public.savings where user_id = :'M');
insert into esito select 'La sua richiesta risulta accettata', (select status from public.my_join_request()) = 'accettata';

-- Moira (non proprietaria) non può togliere nessuno; Augusto sì
select pg_temp.come(:'M');
insert into esito select 'Moira NON può togliere Laura (non è proprietaria)', pg_temp.fallisce(format('select public.remove_member(%L, %L)', :'FAM', :'L'), 'proprietario');
select pg_temp.come(:'A');
select public.remove_member(:'FAM', :'L');
select pg_temp.come(:'L');
insert into esito select 'Tolta: Laura non vede più il salvadanaio', not exists (select 1 from public.savings where user_id = :'M');

-- revoca, scadenza, vecchio codice famiglia
select pg_temp.come(:'A');
insert into v select 'fam2', code from public.create_invite(:'FAM');
select pg_temp.come(:'M');
insert into esito select 'Moira NON revoca l''invito di Augusto', pg_temp.fallisce(format('select public.revoke_invite(%L)', (select val from v where k = 'fam2')), 'revocarlo');
select pg_temp.come(:'A');
select public.revoke_invite((select val from v where k = 'fam2'));
select pg_temp.come(:'X');
insert into esito select 'Invito revocato: non fa entrare',
  (select r->>'reason' ilike '%revocato%' from (select public.join_with_invite((select val from v where k = 'fam2')) r) x);
reset role;
insert into v select 'old', public.new_invite_code();
insert into public.group_invites (code, group_id, created_by, expires_at, max_uses, needs_approval)
  values ((select val from v where k = 'old'), :'FAM', :'A', now() - interval '1 minute', 1, true);
set local role authenticated;
select pg_temp.come(:'X');
insert into esito select 'Invito scaduto: non fa entrare',
  (select r->>'reason' ilike '%scaduto%' from (select public.join_with_invite((select val from v where k = 'old')) r) x);
insert into esito select 'Il vecchio codice famiglia non fa più entrare', pg_temp.fallisce('select public.join_family(''ABC234'')', 'non vale più');

-- tentativi a caso: dopo 10 sbagliati, stop per un'ora
select public.join_with_invite('ZZZZZZZ' || n) from generate_series(1, 7) n;  -- con i 3 sbagliati di prima fanno 10
insert into esito select 'Dopo 10 codici sbagliati: "troppi tentativi"', pg_temp.fallisce('select public.join_with_invite(''QQQQQQQQ'')', 'Troppi');

-- gruppo evento: Laura proprietaria, si entra subito, solo lei invita
reset role;
insert into public.families (id, kind, name, created_by) values ('eeeeeeee-0000-0000-0000-00000000000e', 'evento', 'Festa di sabato', :'L');
insert into public.group_members (group_id, user_id, role, display_name) values ('eeeeeeee-0000-0000-0000-00000000000e', :'L', 'proprietario', 'Laura');
set local role authenticated;
select pg_temp.come(:'L');
insert into v select 'ev', code from public.create_invite('eeeeeeee-0000-0000-0000-00000000000e');
insert into esito select 'Invito evento: usi illimitati, senza approvazione',
  (select max_uses is null and not needs_approval from public.group_invites where code = (select val from v where k = 'ev'));
select pg_temp.come(:'M');
insert into esito select 'Moira entra subito nella festa', (select public.join_with_invite((select val from v where k = 'ev'))->>'status') = 'joined';
insert into esito select 'Moira (già in famiglia) resta anche in famiglia', (select family_id from public.profiles where id = :'M') = :'FAM';
insert into esito select 'Moira NON invita nella festa (non è proprietaria)', pg_temp.fallisce('select public.create_invite(''eeeeeeee-0000-0000-0000-00000000000e'')', 'Solo chi');
select pg_temp.come(:'L');
insert into esito select 'Laura (solo festa) NON vede il salvadanaio di famiglia', not exists (select 1 from public.savings where user_id = :'M');
reset role;
insert into esito select 'Avvisi: richiesta di ingresso e accettazione', (select string_agg(kind, ',' order by at) from public.notif_test) = 'ingresso,ingresso_ok';

select (case when ok then '✓ ' else '✗ ' end) || prova from esito;
select case when bool_and(ok) then 'TUTTE LE PROVE OK ✓' else 'PROVE FALLITE: ' || count(*) filter (where not ok) end from esito;
rollback;
