-- =====================================================================
-- #70: un solo obiettivo visibile: quello della famiglia se ci sei, altrimenti il tuo.
-- Entrando in famiglia il tuo obiettivo diventa della famiglia (se la famiglia non ne ha già uno).
-- Da eseguire una volta in Supabase → SQL Editor (dopo patch_023). Si può rieseguire.
-- =====================================================================

drop policy if exists "obiettivo: mio e famiglia" on public.saving_goals;
create policy "obiettivo: mio e famiglia" on public.saving_goals for select to authenticated
  using (owner_id = coalesce(public.my_family(), auth.uid()));
drop policy if exists "obiettivo: tolgo mio e famiglia" on public.saving_goals;
create policy "obiettivo: tolgo mio e famiglia" on public.saving_goals for delete to authenticated
  using (owner_id = coalesce(public.my_family(), auth.uid()));

create or replace function public.trg_goal_follow_family() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.family_id is not null and new.family_id is distinct from old.family_id then
    if exists (select 1 from public.saving_goals where owner_id = new.family_id) then
      delete from public.saving_goals where owner_id = new.id;
    else
      update public.saving_goals set owner_id = new.family_id, updated_at = now() where owner_id = new.id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_goal_follow_family on public.profiles;
create trigger profiles_goal_follow_family after update of family_id on public.profiles
  for each row execute function public.trg_goal_follow_family();

-- chi è già in famiglia con un obiettivo personale rimasto: lo porto nella famiglia (o lo tolgo se la famiglia ne ha uno)
update public.saving_goals g set owner_id = p.family_id
from public.profiles p
where g.owner_id = p.id and p.family_id is not null
  and not exists (select 1 from public.saving_goals x where x.owner_id = p.family_id)
  and p.id = (select min(q.id::text)::uuid from public.profiles q join public.saving_goals y on y.owner_id = q.id where q.family_id = p.family_id);
delete from public.saving_goals g using public.profiles p where g.owner_id = p.id and p.family_id is not null;

notify pgrst, 'reload schema';
