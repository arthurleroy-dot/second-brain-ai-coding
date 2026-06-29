-- ============================================================
-- Second Brain — Schéma Supabase (source de vérité unique)
-- À coller dans le SQL Editor du projet Supabase.
-- Idempotent : peut être ré-exécuté sans erreur.
-- ============================================================

-- ---------- Extensions ----------
create extension if not exists "pgcrypto"; -- pour gen_random_uuid()

-- ---------- Tables ----------

-- Fichiers bruts déposés (1 ligne = 1 ressource)
create table if not exists resources (
  id uuid primary key default gen_random_uuid(),
  slug text unique,                 -- identifiant stable (slugifié du titre)
  title text,
  type text check (type in (
    'article','meeting_note','interview',
    'presentation','transcript','personal_note','unknown'
  )) default 'unknown',
  author text,
  date text,                        -- YYYY-MM-DD ou partiel ou null
  url text,
  deposited_by text,
  topics text[] default '{}',       -- dénormalisé pour filtrage rapide
  needs_review boolean default false,
  status text check (status in (
    'pending','processing','done','error'
  )) default 'pending',
  storage_path text,                -- chemin dans le bucket raw-files (null si migré)
  source_file text,                 -- chemin d'origine /raw (trace, pour migration)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Contenu traité de chaque ressource
create table if not exists resource_content (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid references resources(id) on delete cascade,
  summary text,                     -- résumé court
  full_content text,                -- retranscription quasi intégrale
  key_concepts text[] default '{}', -- liste des concepts clés
  notable_quotes text[] default '{}', -- citations notables
  key_figures text[] default '{}',  -- chiffres et données clés
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists resource_content_resource_id_idx
  on resource_content (resource_id);

-- Pages thématiques du wiki
create table if not exists topics (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,        -- ex: "agentic-coding"
  title text not null,
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Relation ressources <-> topics
create table if not exists resource_topics (
  resource_id uuid references resources(id) on delete cascade,
  topic_id uuid references topics(id) on delete cascade,
  primary key (resource_id, topic_id)
);

-- Jobs de traitement en arrière-plan
create table if not exists processing_jobs (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid references resources(id) on delete cascade,
  status text check (status in ('queued','running','done','error')) default 'queued',
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists processing_jobs_resource_id_idx
  on processing_jobs (resource_id);

-- Conversations du chat
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  title text default 'Nouvelle discussion',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Messages du chat
-- NB : colonne `sources` (jsonb) — alignée avec le code existant (lib/supabase.ts).
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  role text check (role in ('user','assistant')) not null,
  content text not null,
  sources jsonb default '[]',       -- ressources citées dans la réponse
  created_at timestamptz default now()
);
create index if not exists messages_conversation_id_idx
  on messages (conversation_id);

-- ---------- Seed des 6 topics (slugs validés) ----------
insert into topics (slug, title) values
  ('agentic-coding', 'Agentic Coding'),
  ('finops-ia', 'FinOps IA'),
  ('outils-et-marche', 'Outils et marché'),
  ('transformation-organisationnelle', 'Transformation organisationnelle'),
  ('securite-et-risques', 'Sécurité et risques'),
  ('context-engineering', 'Context Engineering')
on conflict (slug) do nothing;

-- ============================================================
-- Row Level Security
-- Lecture publique (clé anon, navigateur) ; écritures via service role
-- (la service role bypasse RLS, donc aucune policy d'écriture nécessaire).
-- ============================================================
alter table resources         enable row level security;
alter table resource_content  enable row level security;
alter table topics            enable row level security;
alter table resource_topics   enable row level security;
alter table processing_jobs   enable row level security;
alter table conversations     enable row level security;
alter table messages          enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'resources','resource_content','topics','resource_topics',
    'processing_jobs','conversations','messages'
  ]
  loop
    execute format('drop policy if exists "public_read" on %I;', t);
    execute format('create policy "public_read" on %I for select using (true);', t);
  end loop;
end $$;

-- ============================================================
-- Storage : bucket privé pour les fichiers bruts
-- ============================================================
insert into storage.buckets (id, name, public)
values ('raw-files', 'raw-files', false)
on conflict (id) do nothing;

-- Pas de policy publique sur le bucket : seules les requêtes service role
-- (côté serveur) peuvent lire/écrire les fichiers bruts.
