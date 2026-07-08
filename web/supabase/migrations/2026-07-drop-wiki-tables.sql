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

-- Storage : vider puis supprimer le bucket des fichiers bruts (les binaires
-- vivent maintenant dans git sous raw/).
delete from storage.objects where bucket_id = 'raw-files';
delete from storage.buckets where id = 'raw-files';
