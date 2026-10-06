-- Correzione: "Crea famiglia" non funzionava su Supabase (gen_random_bytes sta nello schema extensions).
-- Da eseguire una volta in Supabase → SQL Editor.
create or replace function public.create_family() returns public.families
language plpgsql security definer set search_path = public as $$
declare f public.families; c text;
begin
  select fa.* into f from public.families fa join public.profiles p on p.family_id = fa.id where p.id = auth.uid();
  if found then return f; end if;
  loop
    -- 6 caratteri facili da dettare (niente 0/O, 1/I); random() non dipende da estensioni
    c := '';
    for i in 1..6 loop
      c := c || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1);
    end loop;
    exit when not exists (select 1 from public.families where code = c);
  end loop;
  insert into public.families (code, created_by) values (c, auth.uid()) returning * into f;
  update public.profiles set family_id = f.id, updated_at = now() where id = auth.uid();
  return f;
end $$;
