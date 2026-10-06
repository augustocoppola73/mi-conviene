-- "Collega questo telefono": codici monouso (10 minuti) letti e scritti solo dalla funzione "collega".
create table if not exists public.device_links (
  code text primary key,
  user_id uuid not null references auth.users on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.device_links enable row level security;   -- nessuna regola: dall'app non si legge né si scrive
