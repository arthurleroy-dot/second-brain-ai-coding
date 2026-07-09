-- ============================================================
-- Migration : suppression des tables « wiki » de Supabase.
-- Le wiki vit désormais UNIQUEMENT dans git (markdown). Supabase ne garde que
-- les données applicatives : conversations + messages du chat.
-- À exécuter une fois dans le SQL Editor du projet Supabase.
-- Idempotent.
-- ============================================================

-- Ordre : d'abord les tables filles (FK), puis les parentes.
drop table if exists resource_topics cascade;
drop table if exists resource_content cascade;
drop table if exists processing_jobs cascade;
drop table if exists resources cascade;
drop table if exists topics cascade;
-- (Les policies "public_read" de ces tables tombent avec les tables.)

-- Storage : le bucket des fichiers bruts (`raw-files`) n'est plus utilisé — les
-- binaires vivent désormais dans git sous raw/. Supabase INTERDIT la suppression
-- directe en SQL (trigger storage.protect_delete → « Direct deletion from storage
-- tables is not allowed »). Vider/supprimer le bucket via le Dashboard Storage
-- (⋯ → Empty bucket, puis Delete bucket) ou l'API Storage. Étape optionnelle.
