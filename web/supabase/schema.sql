-- ============================================================
-- Second Brain — Schéma Supabase (données applicatives uniquement)
-- Le wiki vit dans git (markdown). Supabase ne stocke QUE le chat
-- (conversations + messages). Les comptes utilisateurs viendront ici plus tard.
-- À coller dans le SQL Editor du projet Supabase. Idempotent.
--
-- Nouvelle installation : exécuter ce fichier.
-- Installation existante (tables wiki présentes) : exécuter d'abord
-- migrations/2026-07-drop-wiki-tables.sql.
-- ============================================================

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ---------- Chat ----------

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  title text default 'Nouvelle discussion',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- `sources` (jsonb) : ressources citées dans la réponse (slug, title, type…).
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  role text check (role in ('user','assistant')) not null,
  content text not null,
  sources jsonb default '[]',
  created_at timestamptz default now()
);
create index if not exists messages_conversation_id_idx
  on messages (conversation_id);

-- ============================================================
-- Row Level Security
-- Lecture publique (clé anon) ; écritures via service role (bypasse la RLS).
-- ============================================================
alter table conversations enable row level security;
alter table messages      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['conversations','messages']
  loop
    execute format('drop policy if exists "public_read" on %I;', t);
    execute format('create policy "public_read" on %I for select using (true);', t);
  end loop;
end $$;
