-- Dati di partenza delle prove in supabase/tests (solo database di prova).
-- Augusto (A) e Moira (M) in famiglia FAM; Laura (L) e X fuori. Gli avvisi push finiscono in notif_test invece di partire.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'augusto@test.it'),
  ('22222222-2222-2222-2222-222222222222', 'moira@test.it'),
  ('afadd53b-619c-4179-8700-fecd62bdc200', 'laura@test.it'),
  ('38ec4af5-45e6-420c-a719-9e0c30653623', 'x@test.it')
on conflict do nothing;
update public.profiles set display_name = case id
  when '11111111-1111-1111-1111-111111111111' then 'Augusto' when '22222222-2222-2222-2222-222222222222' then 'Moira'
  when 'afadd53b-619c-4179-8700-fecd62bdc200' then 'Laura' else 'Xeno' end;
insert into public.families (id, kind, name, created_by) values
  ('23692106-51a1-4ce8-aca7-74e20e805fb6', 'famiglia', 'Famiglia', '11111111-1111-1111-1111-111111111111') on conflict do nothing;
update public.profiles set family_id = '23692106-51a1-4ce8-aca7-74e20e805fb6'
  where id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
insert into public.group_members (group_id, user_id, role, display_name) values
  ('23692106-51a1-4ce8-aca7-74e20e805fb6', '11111111-1111-1111-1111-111111111111', 'proprietario', 'Augusto'),
  ('23692106-51a1-4ce8-aca7-74e20e805fb6', '22222222-2222-2222-2222-222222222222', 'membro', 'Moira')
on conflict do nothing;

create table if not exists public.notif_test (kind text, actor uuid, extra jsonb, at timestamptz default clock_timestamp());
create or replace function public.send_family_notification(p_kind text, p_family uuid, p_actor uuid, p_extra jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_family is null then return; end if;
  insert into public.notif_test (kind, actor, extra) values (p_kind, p_actor, p_extra);
end $$;
