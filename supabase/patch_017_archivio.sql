-- =====================================================================
-- Gruppi (#17, anticipo): chi esce per ultimo non cancella il gruppo, lo ARCHIVIA (si può ripristinare).
-- Da eseguire una volta in Supabase → SQL Editor (dopo patch_016). Si può rieseguire.
-- =====================================================================

create or replace function public.leave_group(g uuid) returns void
language plpgsql security definer set search_path = public as $$
declare f public.families; was_owner boolean; nxt uuid;
begin
  select * into f from public.families where id = g;
  if not found or f.kind <> 'evento' then raise exception 'Gruppo non trovato'; end if;
  if not public.is_member(g) then return; end if;
  -- l'ultimo che esce: il gruppo va in archivio (resta suo, lo può ripristinare); niente cancellazioni per sbaglio
  if (select count(*) from public.group_members where group_id = g) <= 1 then
    update public.families set archived_at = now() where id = g;
    return;
  end if;
  was_owner := public.is_group_owner(g);
  update public.group_list_items set assigned_to = null, updated_at = now()
  where assigned_to = auth.uid() and status = 'da_prendere' and list_id in (select id from public.group_lists where group_id = g);
  delete from public.group_members where group_id = g and user_id = auth.uid();
  if was_owner then
    select user_id into nxt from public.group_members where group_id = g order by joined_at, user_id limit 1;
    update public.group_members set role = 'proprietario' where group_id = g and user_id = nxt;
  end if;
end $$;

-- i miei gruppi archiviati
create or replace function public.my_archived_groups()
returns table (id uuid, name text, emoji text, event_date date, archived_at timestamptz, members int)
language sql stable security definer set search_path = public as $$
  select f.id, f.name, f.emoji, f.event_date, f.archived_at, (select count(*)::int from public.group_members x where x.group_id = f.id)
  from public.group_members m join public.families f on f.id = m.group_id
  where m.user_id = auth.uid() and f.kind = 'evento' and f.archived_at is not null
  order by f.archived_at desc
$$;

create or replace function public.restore_group(g uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(g) then raise exception 'Non sei in questo gruppo'; end if;
  update public.families set archived_at = null where id = g and kind = 'evento';
end $$;

-- eliminare davvero: solo il proprietario, da Profilo › Gruppi (con conferma nell'app)
create or replace function public.delete_group(g uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_owner(g) then raise exception 'Lo elimina solo chi ha creato il gruppo'; end if;
  delete from public.families where id = g and kind = 'evento';
end $$;

revoke all on function public.my_archived_groups(), public.restore_group(uuid), public.delete_group(uuid) from public, anon;
grant execute on function public.my_archived_groups(), public.restore_group(uuid), public.delete_group(uuid) to authenticated;
