-- "Ti do una mano" (#4): un familiare prende una parte della spesa in corso in un altro negozio vicino a lui.
-- La parte è una tappa in shops.stops con "by" (chi la prende). Avvisi alla famiglia (escluso chi aiuta):
--   aiuto          → "🤝 Augusto prende 3 prodotti da Ekom"
--   aiuto_lasciato → "Augusto ha lasciato la sua parte: i prodotti tornano nella tua lista"
-- Da eseguire una volta in Supabase → SQL Editor (dopo patch_007 e patch_008).

create or replace function public.trg_shop_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  extra jsonb;
  old_t jsonb := old.taken_by;
  new_t jsonb := new.taken_by;
  old_taker uuid; new_taker uuid; old_req jsonb; new_req jsonb;
  st jsonb; k int;
begin
  extra := jsonb_build_object('shop_id', new.id, 'saving_id', new.saving_id, 'store', new.store_name,
    'items', jsonb_array_length(coalesce(new.items, '[]'::jsonb)));
  if tg_op = 'INSERT' then
    if new.status = 'active' then
      perform public.send_family_notification('spesa', new.family_id, new.user_id, extra);
    end if;
    return new;
  end if;

  if new.status = 'done' and old.status is distinct from 'done' then
    perform public.send_family_notification('finita', new.family_id, coalesce((new_t->>'user_id')::uuid, new.user_id), extra);
    return new;
  end if;
  if new.status <> 'active' then return new; end if;

  -- "Ti do una mano" (#4): un familiare prende una parte in un altro negozio, o la lascia
  for st, k in
    select s, (o - 1)::int from jsonb_array_elements(coalesce(new.stops, '[]'::jsonb)) with ordinality as e(s, o)
    where s->'by' is not null and jsonb_typeof(s->'by') = 'object' and coalesce((s->>'released')::boolean, false) = false
  loop
    if not exists (select 1 from jsonb_array_elements(coalesce(old.stops, '[]'::jsonb)) o
                   where o->'by'->>'user_id' = st->'by'->>'user_id' and coalesce((o->>'released')::boolean, false) = false) then
      perform public.send_family_notification('aiuto', new.family_id, (st->'by'->>'user_id')::uuid,
        extra || jsonb_build_object('store', st->>'store_name', 'by_store', new.store_name,
          'items', (select count(*) from jsonb_array_elements(new.items) i where (i->>'stop')::int = k)));
      return new;
    end if;
  end loop;
  for st in
    select s from jsonb_array_elements(coalesce(old.stops, '[]'::jsonb)) s
    where s->'by' is not null and jsonb_typeof(s->'by') = 'object' and coalesce((s->>'released')::boolean, false) = false
  loop
    if not exists (select 1 from jsonb_array_elements(coalesce(new.stops, '[]'::jsonb)) n
                   where n->'by'->>'user_id' = st->'by'->>'user_id' and coalesce((n->>'released')::boolean, false) = false) then
      perform public.send_family_notification('aiuto_lasciato', new.family_id, (st->'by'->>'user_id')::uuid,
        extra || jsonb_build_object('store', st->>'store_name'));
      return new;
    end if;
  end loop;

  old_taker := (old_t->>'user_id')::uuid;  new_taker := (new_t->>'user_id')::uuid;
  old_req := old_t->'request';             new_req := new_t->'request';
  if jsonb_typeof(old_req) = 'null' then old_req := null; end if;
  if jsonb_typeof(new_req) = 'null' then new_req := null; end if;

  -- nuova richiesta → a chi fa la spesa
  if new_req is not null and (old_req is null or old_req->>'user_id' is distinct from new_req->>'user_id') then
    perform public.send_family_notification('richiesta', new.family_id, (new_req->>'user_id')::uuid,
      extra || jsonb_build_object('to', new_taker, 'mode', new_req->>'mode'));
    return new;
  end if;

  -- richiesta accettata: la spesa passa a chi l'ha chiesta (o diventa aiutante)
  -- (solo se a rispondere è stato chi la faceva: "prendila comunque" dopo l'attesa è una presa in carico)
  if old_req is not null and new_req is null and auth.uid() = old_taker and (
       new_taker = (old_req->>'user_id')::uuid
       or exists (select 1 from jsonb_array_elements(coalesce(new_t->'helpers', '[]'::jsonb)) h where h->>'user_id' = old_req->>'user_id')) then
    perform public.send_family_notification('accettata', new.family_id, old_taker,
      extra || jsonb_build_object('to', (old_req->>'user_id')::uuid, 'mode', old_req->>'mode'));
    return new;
  end if;

  -- richiesta rifiutata (chi la fa resta, chi ha chiesto è in pausa)
  if old_req is not null and new_req is null and new_taker = old_taker
     and new_t->'declined'->>'user_id' = old_req->>'user_id' then
    perform public.send_family_notification('rifiutata', new.family_id, old_taker,
      extra || jsonb_build_object('to', (old_req->>'user_id')::uuid));
    return new;
  end if;

  -- spesa lasciata: torna libera
  if old_taker is not null and new_taker is null then
    perform public.send_family_notification('lasciata', new.family_id, old_taker, extra);
    return new;
  end if;

  -- presa in carico (libera → qualcuno, oppure "prendila comunque" dopo l'attesa)
  if new_taker is not null and new_taker is distinct from old_taker then
    perform public.send_family_notification('presa', new.family_id, new_taker, extra);
  end if;
  return new;
end $$;
