-- Spesa in corso: chi l'ha presa in carico ("La faccio io"). Da eseguire una volta in Supabase → SQL Editor.
alter table public.shops add column if not exists taken_by jsonb;
