-- Spesa in corso: chi la fa si prende solo in modo esplicito; gli altri chiedono e chi la fa risponde.
-- Nuovi avvisi, mandati SOLO alla persona interessata (campo "to"):
--   richiesta  → a chi fa la spesa ("Moira chiede di fare la spesa al posto tuo" / "vuole aiutarti")
--   accettata  → a chi ha chiesto ("Augusto ti ha lasciato la spesa" / "ha accettato il tuo aiuto")
--   rifiutata  → a chi ha chiesto ("Augusto continua la spesa")
--   lasciata   → alla famiglia ("Augusto ha lasciato la spesa: è libera")
-- Da eseguire una volta in Supabase → SQL Editor (dopo patch_005).

create or replace function public.trg_shop_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  extra jsonb;
  old_t jsonb := old.taken_by;
  new_t jsonb := new.taken_by;
  old_taker uuid; new_taker uuid; old_req jsonb; new_req jsonb;
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
