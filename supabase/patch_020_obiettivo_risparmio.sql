-- #39: obiettivo di risparmio della famiglia (o della persona senza famiglia): "200 € entro Natale".
create table if not exists public.saving_goals (
  owner_id uuid primary key,                    -- id della famiglia, oppure dell'utente se non ha famiglia
  title text not null default 'Il nostro obiettivo',
  amount numeric(9,2) not null check (amount > 0 and amount < 100000),
  start_date date not null default current_date,
  deadline date,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table public.saving_goals enable row level security;
drop policy if exists "obiettivo: mio e famiglia" on public.saving_goals;
create policy "obiettivo: mio e famiglia" on public.saving_goals for select to authenticated
  using (owner_id = auth.uid() or owner_id = public.my_family());
drop policy if exists "obiettivo: tolgo mio e famiglia" on public.saving_goals;
create policy "obiettivo: tolgo mio e famiglia" on public.saving_goals for delete to authenticated
  using (owner_id = auth.uid() or owner_id = public.my_family());
grant select, delete on public.saving_goals to authenticated;

-- si scrive solo da qui: il proprietario è la famiglia se c'è, altrimenti io
create or replace function public.set_saving_goal(p_title text, p_amount numeric, p_deadline date, p_restart boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare o uuid := coalesce(public.my_family(), auth.uid());
begin
  if auth.uid() is null then raise exception 'Serve un accesso'; end if;
  if p_amount is null or p_amount <= 0 or p_amount >= 100000 then raise exception 'Importo non valido'; end if;
  insert into public.saving_goals (owner_id, title, amount, deadline, updated_by, updated_at)
  values (o, left(coalesce(nullif(trim(p_title), ''), 'Il nostro obiettivo'), 60), round(p_amount, 2), p_deadline, auth.uid(), now())
  on conflict (owner_id) do update
    set title = excluded.title, amount = excluded.amount, deadline = excluded.deadline, updated_by = excluded.updated_by, updated_at = now(),
        start_date = case when p_restart then current_date else saving_goals.start_date end;
end $$;
revoke all on function public.set_saving_goal(text, numeric, date, boolean) from public, anon;
grant execute on function public.set_saving_goal(text, numeric, date, boolean) to authenticated;
