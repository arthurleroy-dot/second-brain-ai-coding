import fs from 'fs/promises';
import path from 'path';

// Toutes les données vivent sous une racine unique (DATA_ROOT) : `wiki/` (contenu
// canonique + vues) et `raw/` (sources brutes immuables). En dev, DATA_ROOT est la
// racine du dépôt (un cran au-dessus de /web) ; dans l'app packagée, la coquille
// Electron pointe DATA_ROOT vers le dossier de données utilisateur (userData).
export const DATA_ROOT = process.env.DATA_ROOT ?? path.resolve(process.cwd(), '..');
export const WIKI_ROOT = process.env.WIKI_ROOT ?? path.join(DATA_ROOT, 'wiki');
export const RAW_ROOT = process.env.RAW_ROOT ?? path.join(DATA_ROOT, 'raw');

/** Résout un chemin relatif sous `root` et garantit qu'il n'en sort pas (anti path-traversal). */
function resolveUnder(root: string, relPath: string): string {
  const resolved = path.resolve(root, relPath);
  const normalizedRoot = path.resolve(root);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
    throw new Error(`Chemin hors périmètre autorisé: ${relPath}`);
  }
  return resolved;
}

/**
 * Résout un chemin repo-relatif ("wiki/…" ou "raw/…") en chemin absolu sur disque.
 * Garde-fou en dur : tout autre préfixe est refusé — c'est l'invariant qui protège
 * le reste de la machine contre une mutation défectueuse.
 */
function resolveRepoPath(repoRel: string): string {
  const normalized = repoRel.replace(/\\/g, '/');
  if (normalized.startsWith('wiki/') && normalized.length > 5) {
    return resolveUnder(WIKI_ROOT, normalized.slice(5));
  }
  if (normalized.startsWith('raw/') && normalized.length > 4) {
    return resolveUnder(RAW_ROOT, normalized.slice(4));
  }
  throw new Error(`Chemin refusé (seuls wiki/ et raw/ sont autorisés): ${repoRel}`);
}

/** Écriture atomique : fichier temporaire dans le même dossier (même volume) puis rename. */
async function writeFileAtomic(abs: string, data: Buffer | string): Promise<void> {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const tmp = path.join(
    path.dirname(abs),
    `.${path.basename(abs)}.tmp-${process.pid}-${Date.now()}`,
  );
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, abs);
  } catch (e) {
    await fs.unlink(tmp).catch(() => {});
    throw e;
  }
}

/**
 * Une opération d'écriture : upsert (`content`) ou suppression (`delete: true`).
 * Même forme que les `FileOp[]` produits par `wiki-mutate` (sous-type strict) —
 * les mutations du moteur se passent donc telles quelles à `applyFileOps`.
 */
export type WriteOp =
  | { path: string; content: Buffer | string } // repo-relatif : "wiki/…" ou "raw/…"
  | { path: string; delete: true };

/**
 * Applique une série d'opérations dans l'ordre reçu (wiki-mutate ordonne déjà).
 * Atomicité par fichier (temp + rename) ; les suppressions ignorent ENOENT ;
 * `wiki:verify` sert de filet global après coup.
 */
export async function applyFileOps(ops: WriteOp[]): Promise<void> {
  // Valide TOUS les chemins avant la première écriture : une op hors périmètre
  // fait échouer le lot entier sans rien toucher.
  const resolved = ops.map((op) => ({ op, abs: resolveRepoPath(op.path) }));
  for (const { op, abs } of resolved) {
    if ('delete' in op) {
      await fs.unlink(abs).catch((e) => {
        if (e?.code !== 'ENOENT') throw e;
      });
    } else {
      await writeFileAtomic(abs, op.content);
    }
  }
}

/** Lit un fichier repo-relatif ("wiki/…" ou "raw/…") en utf-8 ; null si absent. */
export async function readRepoFile(repoRel: string): Promise<string | null> {
  try {
    return await fs.readFile(resolveRepoPath(repoRel), 'utf-8');
  } catch {
    return null;
  }
}

/** Lit un fichier repo-relatif en binaire ; null si absent. */
export async function readRepoBinary(repoRel: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(resolveRepoPath(repoRel));
  } catch {
    return null;
  }
}

/** Vrai si le chemin repo-relatif existe sur disque. */
export async function repoPathExists(repoRel: string): Promise<boolean> {
  try {
    await fs.access(resolveRepoPath(repoRel));
    return true;
  } catch {
    return false;
  }
}

/** Premier nom libre dans raw/ : `nom.ext`, sinon `nom-2.ext`, `nom-3.ext`… */
export async function resolveAvailableRawName(name: string): Promise<string> {
  const dot = name.lastIndexOf('.');
  const stem = dot === -1 ? name : name.slice(0, dot);
  const ext = dot === -1 ? '' : name.slice(dot);
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? name : `${stem}-${n}${ext}`;
    if (!(await repoPathExists(`raw/${candidate}`))) return candidate;
  }
  // Filet de sécurité improbable.
  return `${stem}-${Date.now()}${ext}`;
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
