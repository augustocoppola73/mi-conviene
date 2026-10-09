-- Spesa in due negozi (#2): le tappe della spesa in corso. Ogni prodotto in items ha "stop" (0, 1) e "store_id".
-- null = spesa in un negozio solo, come prima. Da eseguire una volta in Supabase → SQL Editor.
alter table public.shops add column if not exists stops jsonb;
