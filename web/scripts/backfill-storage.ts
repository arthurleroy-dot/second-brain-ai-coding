/**
 * Backfill Storage — upload les fichiers binaires de /raw (PDF, PPTX, DOCX)
 * vers le bucket Supabase `raw-files` et renseigne `resources.storage_path`.
 *
 * Contexte : les ressources ont été créées par migrate-wiki.ts (storage_path
 * null). Les binaires d'origine ne vivent que dans /raw. Ce script les met dans
 * le Storage pour que la page /sources/[id] puisse les afficher (iframe PDF).
 *
 * Exécution :
 *   npx tsx web/scripts/backfill-storage.ts
 *
 * Idempotent : une ressource qui a déjà un storage_path est ignorée.
 * Les ressources markdown/texte (affichées via full_content) sont ignorées.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(WEB_ROOT, '..');

function loadEnv() {
  const envPath = path.join(WEB_ROOT, '.env.local');
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
}
loadEnv();

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

// Extensions binaires à backfiller (les .md/.txt s'affichent via full_content).
const BINARY_CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function ext(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
}

/**
 * Nettoie un nom de fichier pour en faire une clé Storage valide.
 * Supabase rejette certains caractères (ex: `|`). On garde lettres, chiffres,
 * espaces, points, tirets, underscores et parenthèses ; le reste devient `-`.
 */
function safeKey(name: string): string {
  return name.replace(/[^a-zA-Z0-9 ._()\-]/g, '-').replace(/-+/g, '-');
}

async function main() {
  const { data: resources, error } = await db
    .from('resources')
    .select('id, title, source_file, storage_path');
  if (error) {
    console.error('Erreur lecture resources:', error.message);
    process.exit(1);
  }

  let uploaded = 0;
  let skipped = 0;
  let missing = 0;

  for (const r of resources ?? []) {
    if (r.storage_path) {
      skipped++;
      continue; // déjà backfillé
    }
    if (!r.source_file) {
      skipped++;
      continue;
    }
    const e = ext(r.source_file);
    const contentType = BINARY_CONTENT_TYPES[e];
    if (!contentType) {
      skipped++; // markdown/texte → pas de backfill
      continue;
    }

    // source_file est de la forme "raw/<nom>.pdf" relatif à la racine du dépôt.
    const absPath = path.join(REPO_ROOT, r.source_file);
    if (!fs.existsSync(absPath)) {
      console.warn(`⚠ Fichier introuvable pour "${r.title}": ${absPath}`);
      missing++;
      continue;
    }

    const filename = path.basename(r.source_file);
    // Même format que /api/upload : "<uuid>-<filename>" (clé assainie).
    const storagePath = `${crypto.randomUUID()}-${safeKey(filename)}`;
    const buffer = fs.readFileSync(absPath);

    const { error: upErr } = await db.storage
      .from('raw-files')
      .upload(storagePath, buffer, { contentType, upsert: false });
    if (upErr) {
      console.error(`✗ Upload échoué pour "${r.title}": ${upErr.message}`);
      continue;
    }

    const { error: updErr } = await db
      .from('resources')
      .update({ storage_path: storagePath })
      .eq('id', r.id);
    if (updErr) {
      console.error(`✗ Update storage_path échoué pour "${r.title}": ${updErr.message}`);
      continue;
    }

    console.log(`✓ ${r.title}\n    → ${storagePath}`);
    uploaded++;
  }

  console.log(
    `\nTerminé. Uploadés: ${uploaded} | ignorés: ${skipped} | fichiers manquants: ${missing}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
