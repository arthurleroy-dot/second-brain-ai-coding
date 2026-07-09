/**
 * Accès au dépôt GitHub (source de vérité du wiki).
 * - Lecture : proxy des binaires de /raw (PDF…) que l'on ne bundle pas.
 * - Écriture (commit d'upload) : ajoutée en phase 5.
 *
 * Config via env : GITHUB_TOKEN (PAT fine-grained, Contents R/W) et
 * GITHUB_REPO ("owner/repo"). Branche par défaut : GITHUB_BRANCH ?? "main".
 */

const API = 'https://api.github.com';

export function githubRepo(): string | null {
  return process.env.GITHUB_REPO || null;
}
export function githubBranch(): string {
  return process.env.GITHUB_BRANCH || 'main';
}
export function githubToken(): string | null {
  return process.env.GITHUB_TOKEN || null;
}
export function isGithubConfigured(): boolean {
  return Boolean(githubRepo() && githubToken());
}

function headers(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...extra,
  };
  const token = githubToken();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** Appel JSON à l'API GitHub. Lève sur statut non-2xx (sauf `allow`). */
async function ghJson(
  method: string,
  pathOrUrl: string,
  body?: unknown,
  allow: number[] = [],
): Promise<{ status: number; data: any }> {
  const repo = githubRepo();
  const url = pathOrUrl.startsWith('http')
    ? pathOrUrl
    : `${API}/repos/${repo}${pathOrUrl}`;
  const res = await fetch(url, {
    method,
    headers: headers(body ? { 'Content-Type': 'application/json' } : undefined),
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok && !allow.includes(res.status)) {
    throw new Error(`GitHub ${method} ${pathOrUrl} → ${res.status} : ${data?.message ?? text}`);
  }
  return { status: res.status, data };
}

export interface RawFetchResult {
  ok: boolean;
  status: number;
  buffer?: Buffer;
}

/**
 * Récupère le contenu brut d'un fichier du dépôt (ex. `raw/mon.pdf`) via la
 * Contents API. Renvoie les octets bruts (Accept: raw).
 */
export async function fetchRepoFileRaw(pathInRepo: string): Promise<RawFetchResult> {
  const repo = githubRepo();
  if (!repo || !githubToken()) return { ok: false, status: 503 };

  const encoded = pathInRepo
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const url = `${API}/repos/${repo}/contents/${encoded}?ref=${encodeURIComponent(githubBranch())}`;

  const res = await fetch(url, {
    headers: headers({ Accept: 'application/vnd.github.raw+json' }),
    cache: 'no-store',
  });
  if (!res.ok) return { ok: false, status: res.status };
  const buffer = Buffer.from(await res.arrayBuffer());
  return { ok: true, status: 200, buffer };
}

/** Vrai si un chemin existe dans le dépôt (sur la branche par défaut). */
export async function repoPathExists(pathInRepo: string): Promise<boolean> {
  const encoded = pathInRepo.split('/').map(encodeURIComponent).join('/');
  const { status } = await ghJson(
    'GET',
    `/contents/${encoded}?ref=${encodeURIComponent(githubBranch())}`,
    undefined,
    [404, 200],
  );
  return status === 200;
}

/**
 * Résout un nom de fichier libre dans `raw/` : ajoute un suffixe -2, -3… si le
 * nom (ou son sidecar) existe déjà. Renvoie le basename retenu.
 */
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

export interface FileToCommit {
  path: string; // chemin dans le dépôt (ex. "raw/mon.pdf")
  content: Buffer | string;
}

/**
 * Commit atomique de plusieurs fichiers via la Git Data API
 * (blobs → tree → commit → update ref). Un seul commit, un seul déclenchement de
 * l'Action. Retry sur update-ref non-fast-forward (uploads concurrents).
 */
export async function commitFiles(
  files: FileToCommit[],
  message: string,
): Promise<{ commitSha: string }> {
  if (!isGithubConfigured()) throw new Error('GitHub non configuré (GITHUB_TOKEN / GITHUB_REPO).');
  const branch = githubBranch();
  const ref = `heads/${branch}`;

  // Les blobs sont indépendants du parent : on les crée une fois.
  const blobs: { path: string; sha: string }[] = [];
  for (const f of files) {
    const base64 = Buffer.isBuffer(f.content)
      ? f.content.toString('base64')
      : Buffer.from(f.content, 'utf-8').toString('base64');
    const { data } = await ghJson('POST', '/git/blobs', {
      content: base64,
      encoding: 'base64',
    });
    blobs.push({ path: f.path, sha: data.sha });
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { data: refData } = await ghJson('GET', `/git/ref/${ref}`);
      const baseCommitSha = refData.object.sha;
      const { data: baseCommit } = await ghJson('GET', `/git/commits/${baseCommitSha}`);
      const baseTreeSha = baseCommit.tree.sha;

      const { data: tree } = await ghJson('POST', '/git/trees', {
        base_tree: baseTreeSha,
        tree: blobs.map((b) => ({ path: b.path, mode: '100644', type: 'blob', sha: b.sha })),
      });
      const { data: commit } = await ghJson('POST', '/git/commits', {
        message,
        tree: tree.sha,
        parents: [baseCommitSha],
      });
      // force:false → 422 si un autre commit est arrivé entre-temps.
      await ghJson('PATCH', `/git/refs/${ref}`, { sha: commit.sha, force: false });
      return { commitSha: commit.sha };
    } catch (e) {
      lastErr = e;
      // On retente : la ref a bougé (commit concurrent). base_tree/parent rechargés.
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('commitFiles a échoué');
}

/** Lit le manifeste d'ingestion du dépôt (wiki/_ingested.json). */
export async function fetchIngestManifest(): Promise<Record<string, { slug: string }> | null> {
  const res = await fetchRepoFileRaw('wiki/_ingested.json');
  if (!res.ok || !res.buffer) return null;
  try {
    const json = JSON.parse(res.buffer.toString('utf-8'));
    return json.files ?? {};
  } catch {
    return null;
  }
}

/**
 * Déclenche le workflow d'ingestion (workflow_dispatch) pour que l'agent applique
 * une décision de candidate committée. Nécessite un token avec la permission
 * Actions:write. Renvoie false (sans lever) si l'appel échoue — le cron nocturne
 * reste le filet de rattrapage.
 */
export async function dispatchIngest(): Promise<boolean> {
  if (!isGithubConfigured()) return false;
  try {
    await ghJson('POST', `/actions/workflows/ingest.yml/dispatches`, {
      ref: githubBranch(),
    });
    return true;
  } catch {
    return false;
  }
}

/** Vrai si un run du workflow d'ingestion est en cours ou en file. */
export async function hasActiveIngestRun(): Promise<boolean> {
  try {
    const { data } = await ghJson(
      'GET',
      `/actions/workflows/ingest.yml/runs?per_page=5`,
    );
    const runs = (data?.workflow_runs ?? []) as { status: string }[];
    return runs.some((r) => r.status === 'in_progress' || r.status === 'queued');
  } catch {
    return false;
  }
}
