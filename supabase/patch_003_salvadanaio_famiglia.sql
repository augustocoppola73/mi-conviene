-- Salvadanaio e storico condivisi in famiglia: ognuno vede (e può verificare con lo scontrino) le spese degli altri.
-- Inserire e cancellare restano solo tuoi. Da eseguire una volta in Supabase → SQL Editor.
create or replace function public.in_my_family(owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select owner = auth.uid() or exists (
    select 1 from public.profiles p where p.id = owner and p.family_id is not null and p.family_id = public.my_family())
$$;

drop policy if exists "storico: mio" on public.history;
drop policy if exists "storico: leggo mio e famiglia" on public.history;
drop policy if exists "storico: aggiorno mio e famiglia" on public.history;
drop policy if exists "storico: inserisco il mio" on public.history;
drop policy if exists "storico: cancello il mio" on public.history;
create policy "storico: leggo mio e famiglia" on public.history for select to authenticated using (public.in_my_family(user_id));
create policy "storico: aggiorno mio e famiglia" on public.history for update to authenticated using (public.in_my_family(user_id));
create policy "storico: inserisco il mio" on public.history for insert to authenticated with check (user_id = auth.uid());
create policy "storico: cancello il mio" on public.history for delete to authenticated using (user_id = auth.uid());

drop policy if exists "salvadanaio: mio" on public.savings;
drop policy if exists "salvadanaio: leggo mio e famiglia" on public.savings;
drop policy if exists "salvadanaio: aggiorno mio e famiglia" on public.savings;
drop policy if exists "salvadanaio: inserisco il mio" on public.savings;
drop policy if exists "salvadanaio: cancello il mio" on public.savings;
create policy "salvadanaio: leggo mio e famiglia" on public.savings for select to authenticated using (public.in_my_family(user_id));
create policy "salvadanaio: aggiorno mio e famiglia" on public.savings for update to authenticated using (public.in_my_family(user_id));
create policy "salvadanaio: inserisco il mio" on public.savings for insert to authenticated with check (user_id = auth.uid());
create policy "salvadanaio: cancello il mio" on public.savings for delete to authenticated using (user_id = auth.uid());
