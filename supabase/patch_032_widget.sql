-- #40: il widget si aggiorna da solo. Quando cambia la lista di casa o la spesa in corso, il database chiede alla
-- funzione «notifica» un avviso invisibile (solo dati) per i telefoni della famiglia, che ridisegnano il widget.
-- Da eseguire una volta (dopo patch_031).

-- lista di casa: un avviso per comando (anche se cambiano più righe insieme).
-- con le transition table servono funzioni distinte per inserimento, modifica e cancellazione
create or replace function public.trg_home_list_widget_ins() returns trigger
language plpgsql security definer set search_path = public as $$
declare f uuid;
begin
  for f in select distinct family_id from new_rows where family_id is not null loop
    perform public.send_family_notification('widget', f, auth.uid(), jsonb_build_object('what', 'list'));
  end loop;
  return null;
end $$;
create or replace function public.trg_home_list_widget_del() returns trigger
language plpgsql security definer set search_path = public as $$
declare f uuid;
begin
  for f in select distinct family_id from old_rows where family_id is not null loop
    perform public.send_family_notification('widget', f, auth.uid(), jsonb_build_object('what', 'list'));
  end loop;
  return null;
end $$;

drop trigger if exists home_list_widget_ins on public.home_list_items;
create trigger home_list_widget_ins after insert on public.home_list_items
  referencing new table as new_rows for each statement execute function public.trg_home_list_widget_ins();
drop trigger if exists home_list_widget_upd on public.home_list_items;
create trigger home_list_widget_upd after update on public.home_list_items
  referencing new table as new_rows for each statement execute function public.trg_home_list_widget_ins();
drop trigger if exists home_list_widget_del on public.home_list_items;
create trigger home_list_widget_del after delete on public.home_list_items
  referencing old table as old_rows for each statement execute function public.trg_home_list_widget_del();

-- spesa in corso: inizio, presa in carico, fine (subito) e spunte («8 di 15», al massimo una al minuto: lo regola la funzione)
create or replace function public.trg_shop_widget() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.family_id is null then return new; end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status or new.taken_by is distinct from old.taken_by then
    perform public.send_family_notification('widget', new.family_id, auth.uid(), jsonb_build_object('what', 'shop'));
  elsif new.items is distinct from old.items then
    perform public.send_family_notification('widget', new.family_id, auth.uid(), jsonb_build_object('what', 'shop_items'));
  end if;
  return new;
end $$;
drop trigger if exists shop_widget on public.shops;
create trigger shop_widget after insert or update of status, taken_by, items on public.shops
  for each row execute function public.trg_shop_widget();

insert into public.schema_migrations (name) values ('patch_032') on conflict do nothing;
