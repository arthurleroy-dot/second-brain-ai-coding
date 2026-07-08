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
