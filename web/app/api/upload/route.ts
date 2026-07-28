import { NextRequest } from 'next/server';
import path from 'path';
import { applyFileOps, resolveAvailableRawName, type WriteOp } from '@/lib/wiki-fs';
import { runIngestion } from '@/lib/ingest-local';

export const dynamic = 'force-dynamic';

const ACCEPTED_EXT = ['.md', '.txt', '.pdf', '.pptx', '.docx'];
const MAX_BYTES = 50 * 1024 * 1024; // 50 Mo

function ext(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
}

/** Nettoie un nom de fichier d'upload (basename, sans caractères de chemin). */
function safeName(name: string): string {
  return path.basename(name).replace(/[\\/]/g, '').trim();
}

/** Scalaire YAML sûr pour une chaîne (guillemets doubles échappés). */
function yamlStr(v: string): string {
  return JSON.stringify(v);
}

function field(form: FormData, key: string): string | null {
  const v = form.get(key);
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Parse le champ `links` (JSON : { type → [noms] }) en map slugifiée et nettoyée. */
function parseLinks(raw: string | null): Record<string, string[]> {
  if (!raw) return {};
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return {};
  }
  const out: Record<string, string[]> = {};
  if (obj && typeof obj === 'object') {
    for (const [type, names] of Object.entries(obj as Record<string, unknown>)) {
      const t = slugify(type);
      if (!t || !Array.isArray(names)) continue;
      const slugs = [...new Set(names.map((n) => slugify(String(n))).filter(Boolean))];
      if (slugs.length) out[t] = slugs;
    }
  }
  return out;
}

/**
 * Parse le champ `entities_granularity` en map { entity_type → resource|chunk }.
 * Nouveau format : JSON objet { type → granularité }. `auto` (et valeurs inconnues)
 * sont ignorées — un type absent retombe sur `auto` côté agent. Restreint aux types
 * réellement présents dans `links`. Rétro-compat : un scalaire `resource|chunk`
 * (ancien client, non JSON) s'applique à tous les types déclarés.
 */
function parseGranularity(raw: string | null, linkTypes: string[]): Record<string, string> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = raw; // ancien format : scalaire brut non quoté ('chunk', 'resource', 'auto')
  }
  const valid = (v: unknown): v is string => v === 'resource' || v === 'chunk';
  const out: Record<string, string> = {};
  if (typeof parsed === 'string') {
    if (valid(parsed)) for (const t of linkTypes) out[t] = parsed;
    return out;
  }
  if (parsed && typeof parsed === 'object') {
    for (const [type, val] of Object.entries(parsed as Record<string, unknown>)) {
      const t = slugify(type);
      if (t && valid(val) && linkTypes.includes(t)) out[t] = val;
    }
  }
  return out;
}

/** Parse le champ `themes` (JSON : liste plate de noms) en slugs uniques. */
function parseThemes(raw: string | null): string[] {
  if (!raw) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.map((n) => slugify(String(n))).filter(Boolean))];
}

/** Construit le sidecar `<source>.meta.md` à partir des métadonnées du formulaire. */
function buildSidecar(meta: {
  title: string | null;
  sourceType: string;
  origin: string | null;
  author: string | null;
  date: string | null;
  url: string | null;
  depositedBy: string | null;
  links: Record<string, string[]>;
  granularity: Record<string, string>;
  themes: string[];
  themesGranularity: string;
}): string {
  const lines: string[] = ['---'];
  if (meta.title) lines.push(`title: ${yamlStr(meta.title)}`);
  lines.push(`type: ${meta.sourceType}`);
  // Origine optionnelle : si absente, l'agent d'ingestion la déduit du type
  // (heuristique docs/wiki-spec.md §5). Si fournie, le sidecar fait autorité.
  if (meta.origin) lines.push(`origin: ${meta.origin}`);
  if (meta.author) lines.push(`author: ${yamlStr(meta.author)}`);
  if (meta.date) lines.push(`date: ${yamlStr(meta.date)}`);
  if (meta.url) lines.push(`url: ${yamlStr(meta.url)}`);
  if (meta.depositedBy) lines.push(`deposited_by: ${yamlStr(meta.depositedBy)}`);
  const linkTypes = Object.keys(meta.links);
  if (linkTypes.length) {
    // Bloc `links:` typé — chaque clé = entity_type, valeur = liste de slugs.
    lines.push('links:');
    for (const t of linkTypes) lines.push(`  ${t}: [${meta.links[t].join(', ')}]`);
    // Granularité PAR type (map) — n'émet que les entrées non-auto ; type absent ⇒ auto.
    const granTypes = linkTypes.filter((t) => meta.granularity[t]);
    if (granTypes.length) {
      lines.push('entities_granularity:');
      for (const t of granTypes) lines.push(`  ${t}: ${meta.granularity[t]}`);
    }
  }
  if (meta.themes.length) {
    // Liste plate `themes:` — les thèmes n'ont pas de type (cf. docs/entities.md).
    lines.push(`themes: [${meta.themes.join(', ')}]`);
    lines.push(`themes_granularity: ${meta.themesGranularity}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'Requête multipart invalide' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({ error: 'Aucun fichier fourni' }, { status: 400 });
  }

  const name = safeName(file.name);
  const extension = ext(name);
  if (!name || !ACCEPTED_EXT.includes(extension)) {
    return Response.json(
      { error: `Extension non supportée (${extension}). Acceptés : ${ACCEPTED_EXT.join(', ')}` },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: `Fichier trop volumineux (max ${MAX_BYTES / 1024 / 1024} Mo).` },
      { status: 413 },
    );
  }

  // Métadonnées (précédence humaine : le sidecar est autoritaire côté agent).
  const title = field(form, 'title');
  const author = field(form, 'author');
  const date = field(form, 'date');
  const depositedBy = field(form, 'deposited_by');
  const url = field(form, 'url');
  // Le menu de dépôt envoie DÉJÀ le slug kebab (identité canonique). On le
  // re-slugifie par sûreté (idempotent sur un slug propre) et on retombe sur
  // `unknown` si vide. Le sidecar écrit alors `type: <slug>`.
  const sourceType = slugify(field(form, 'type') ?? '') || 'unknown';
  // Origine : 'interne' | 'externe' si l'utilisateur a choisi, sinon null (= Auto,
  // l'agent d'ingestion déduira). On n'accepte que les deux valeurs connues.
  const originRaw = field(form, 'origin');
  const origin = originRaw === 'interne' || originRaw === 'externe' ? originRaw : null;
  const links = parseLinks(field(form, 'links'));
  const granularity = parseGranularity(field(form, 'entities_granularity'), Object.keys(links));
  const themes = parseThemes(field(form, 'themes'));
  const themesGranularity = field(form, 'themes_granularity') ?? 'auto';

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    // Nom disponible dans raw/ (suffixe -2, -3… en cas de collision).
    const finalName = await resolveAvailableRawName(name);
    const sidecar = buildSidecar({
      title,
      sourceType,
      origin,
      author,
      date,
      url,
      depositedBy,
      links,
      granularity,
      themes,
      themesGranularity,
    });

    // Écriture locale : la source brute + son sidecar, sur le disque de la machine.
    const files: WriteOp[] = [
      { path: `raw/${finalName}`, content: buffer },
      { path: `raw/${finalName}.meta.md`, content: sidecar },
    ];
    await applyFileOps(files);

    // Déclenche l'ingestion en ARRIÈRE-PLAN (ne bloque pas la réponse HTTP).
    // No-op si une ingestion tourne déjà (verrou). Le client suit l'avancement
    // via GET /api/ingest-status. Serveur long-vécu (Electron/next start) → la
    // tâche de fond survit à la réponse.
    void runIngestion().catch((e) => {
      console.error('[upload] ingestion en arrière-plan échouée :', e?.message ?? e);
    });

    return Response.json({ ok: true, file: finalName });
  } catch (e: any) {
    return Response.json(
      { error: `Écriture locale échouée : ${e?.message ?? 'inconnu'}` },
      { status: 500 },
    );
  }
}
