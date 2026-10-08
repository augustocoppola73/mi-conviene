-- Profilo › Famiglia: per ogni membro si vede se riceve le notifiche (ha un telefono registrato di recente).
-- Solo sì/no: i token dei telefoni restano invisibili. Da eseguire una volta in Supabase → SQL Editor.
drop function if exists public.family_members();
create function public.family_members()
returns table (user_id uuid, display_name text, notifications boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name,
    exists (select 1 from public.push_tokens t where t.user_id = p.id and t.updated_at > now() - interval '60 days')
  from public.profiles p
  where p.family_id is not null and p.family_id = public.my_family()
$$;
revoke all on function public.family_members() from public, anon;
grant execute on function public.family_members() to authenticated;
