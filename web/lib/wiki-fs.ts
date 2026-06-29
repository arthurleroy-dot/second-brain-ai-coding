import fs from 'fs/promises';
import path from 'path';

// Le front lit le wiki directement sur le système de fichiers local.
// Par défaut on remonte d'un cran depuis /web vers la racine du dépôt.
export const WIKI_ROOT =
  process.env.WIKI_ROOT ?? path.resolve(process.cwd(), '..', 'wiki');
export const RAW_ROOT =
  process.env.RAW_ROOT ?? path.resolve(process.cwd(), '..', 'raw');

/** Résout un chemin relatif sous `root` et garantit qu'il n'en sort pas (anti path-traversal). */
function resolveUnder(root: string, relPath: string): string {
  const resolved = path.resolve(root, relPath);
  const normalizedRoot = path.resolve(root);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
    throw new Error(`Chemin hors périmètre autorisé: ${relPath}`);
  }
  return resolved;
}

/** Lit un fichier du wiki (renvoie '' si absent). */
export async function readWikiFile(relPath: string): Promise<string> {
  try {
    const abs = resolveUnder(WIKI_ROOT, relPath);
    return await fs.readFile(abs, 'utf-8');
  } catch {
    return '';
  }
}

/** Liste les noms d'entrées (fichiers + dossiers) d'un répertoire du wiki. */
export async function listWikiDir(relPath: string): Promise<string[]> {
  try {
    const abs = resolveUnder(WIKI_ROOT, relPath);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    return entries.map((e) => e.name);
  } catch {
    return [];
  }
}

/** Liste uniquement les sous-dossiers d'un répertoire du wiki. */
export async function listWikiSubdirs(relPath: string): Promise<string[]> {
  try {
    const abs = resolveUnder(WIKI_ROOT, relPath);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Vrai si le chemin relatif existe dans le wiki. */
export async function wikiExists(relPath: string): Promise<boolean> {
  try {
    const abs = resolveUnder(WIKI_ROOT, relPath);
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}

/** Écrit un fichier sous WIKI_ROOT (utilisé pour créer une ébauche de thème). Retourne le chemin relatif. */
export async function writeWikiFile(relPath: string, content: string): Promise<string> {
  const abs = resolveUnder(WIKI_ROOT, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf-8');
  return relPath;
}

/** Écrit un fichier dans /raw. Retourne le chemin relatif (raw/<filename>). */
export async function writeRaw(filename: string, data: Buffer | string): Promise<string> {
  // On n'autorise pas de sous-dossiers dans le nom de fichier d'upload.
  const safeName = path.basename(filename);
  const abs = resolveUnder(RAW_ROOT, safeName);
  await fs.mkdir(RAW_ROOT, { recursive: true });
  await fs.writeFile(abs, data);
  return path.join('raw', safeName);
}

/** Vrai si un fichier existe déjà dans /raw. */
export async function rawExists(filename: string): Promise<boolean> {
  try {
    const abs = resolveUnder(RAW_ROOT, path.basename(filename));
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}
