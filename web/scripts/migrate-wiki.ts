/**
 * Migration des fiches markdown du wiki (wiki/by-type/**\/*.md) vers Supabase.
 *
 * Exécution (depuis la racine du dépôt ou ailleurs) :
 *   npx tsx web/scripts/migrate-wiki.ts
 *
 * Idempotent : une fiche déjà présente (même slug) est ignorée.
 * Lit les identifiants Supabase depuis web/.env.local (service role).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(WEB_ROOT, '..');
const WIKI_ROOT = path.join(REPO_ROOT, 'wiki');
const BY_TYPE = path.join(WIKI_ROOT, 'by-type');

// ---- Chargement minimal de web/.env.local ----
function loadEnv() {
  const envPath = path.join(WEB_ROOT, '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error(
    'NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis dans web/.env.local',
  );
  process.exit(1);
}
const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---- Helpers ----
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const FOLDER_TO_TYPE: Record<string, string> = {
  articles: 'article',
  'meeting-notes': 'meeting_note',
  interviews: 'interview',
  presentations: 'presentation',
  transcripts: 'transcript',
  'personal-notes': 'personal_note',
  unknown: 'unknown',
};
const VALID_TYPES = new Set(Object.values(FOLDER_TO_TYPE));

function normalizeType(raw: unknown, folder: string): string {
  if (typeof raw === 'string') {
    const t = raw.trim().replace(/-/g, '_');
    if (VALID_TYPES.has(t)) return t;
  }
  return FOLDER_TO_TYPE[folder] ?? 'unknown';
}

function cleanStr(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t.toLowerCase() === 'unknown') return null;
  return t;
}

function firstH1(body: string): string | null {
  for (const line of body.split('\n')) {
    const m = line.match(/^#\s+(.+?)\s*$/);
    if (m) return m[1].trim();
  }
  return null;
}

/** Découpe le corps en sections { heading -> contenu } sur les titres `## `. */
function splitSections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const re = /^##\s+(.+?)\s*$/gm;
  const matches = [...body.matchAll(re)];
  for (let i = 0; i < matches.length; i++) {
    const heading = matches[i][1].trim();
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : body.length;
    sections[heading] = body.slice(start, end).trim();
  }
  return sections;
}

/** Extrait les items de liste (`- ...`) d'un bloc de texte. */
function listItems(text: string): string[] {
  if (!text) return [];
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- ') || l.startsWith('* '))
    .map((l) => l.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);
}

function findSection(sections: Record<string, string>, ...names: string[]): string {
  for (const n of names) {
    const key = Object.keys(sections).find(
      (k) => k.toLowerCase() === n.toLowerCase(),
    );
    if (key) return sections[key];
  }
  return '';
}

function walkMarkdown(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(full));
    else if (entry.name.endsWith('.md') && entry.name !== 'index.md') out.push(full);
  }
  return out;
}

// ---- Topics ----
const topicIdCache = new Map<string, string>();

async function ensureTopic(slug: string): Promise<string | null> {
  if (!slug) return null;
  if (topicIdCache.has(slug)) return topicIdCache.get(slug)!;
  const title = slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  await db.from('topics').upsert({ slug, title }, { onConflict: 'slug', ignoreDuplicates: true });
  const { data } = await db.from('topics').select('id').eq('slug', slug).single();
  if (data?.id) {
    topicIdCache.set(slug, data.id);
    return data.id;
  }
  return null;
}

// ---- Migration ----
async function migrate() {
  const files = walkMarkdown(BY_TYPE);
  console.log(`${files.length} fiche(s) trouvée(s) dans wiki/by-type/`);

  let migrated = 0;
  let skipped = 0;

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const { data: fm, content: body } = matter(content);
    const rel = path.relative(REPO_ROOT, file);
    const folder = path.basename(path.dirname(file));
    const fileBase = path.basename(file, '.md');

    const title = firstH1(body) ?? cleanStr(fm.slug) ?? fileBase;
    const slug = cleanStr(fm.slug) ?? slugify(title);

    // Idempotence : skip si slug déjà présent
    const { data: existing } = await db
      .from('resources')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    if (existing) {
      console.log(`  ⏭  déjà migré : ${slug}`);
      skipped++;
      continue;
    }

    const topics = Array.isArray(fm.topics)
      ? fm.topics.map((t: unknown) => slugify(String(t))).filter(Boolean)
      : [];

    const sections = splitSections(body);

    // 1. resources
    const { data: resource, error: resErr } = await db
      .from('resources')
      .insert({
        slug,
        title,
        type: normalizeType(fm.type, folder),
        author: cleanStr(fm.author),
        date: cleanStr(fm.date),
        url: cleanStr(fm.url),
        deposited_by: cleanStr(fm.deposited_by),
        topics,
        needs_review: fm.needs_review === true,
        status: 'done',
        storage_path: null,
        source_file: cleanStr(fm.source_file) ?? rel,
      })
      .select()
      .single();
    if (resErr || !resource) {
      console.error(`  ✗ échec insert ${slug}: ${resErr?.message}`);
      continue;
    }

    // 2. resource_content
    await db.from('resource_content').insert({
      resource_id: resource.id,
      summary: findSection(sections, 'Résumé', 'Resume') || null,
      full_content: findSection(sections, 'Contenu complet') || null,
      key_concepts: listItems(findSection(sections, 'Concepts clés', 'Concepts cles')),
      notable_quotes: listItems(
        findSection(sections, 'Citations et formulations notables', 'Citations'),
      ),
      key_figures: listItems(
        findSection(sections, 'Données et chiffres clés', 'Donnees et chiffres cles'),
      ),
    });

    // 3. topics + resource_topics
    for (const ts of topics) {
      const topicId = await ensureTopic(ts);
      if (topicId) {
        await db
          .from('resource_topics')
          .upsert(
            { resource_id: resource.id, topic_id: topicId },
            { onConflict: 'resource_id,topic_id', ignoreDuplicates: true },
          );
      }
    }

    console.log(`  ✓ ${slug}`);
    migrated++;
  }

  console.log(`\nTerminé : ${migrated} migrée(s), ${skipped} ignorée(s).`);
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
