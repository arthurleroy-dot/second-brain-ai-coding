import { NextRequest } from 'next/server';
import {
  commitFiles,
  dispatchIngest,
  fetchRepoFileRaw,
  isGithubConfigured,
} from '@/lib/github';
import { slugify } from '@/lib/wiki-parser';
import { CandidateStatus } from '@/types';

export const dynamic = 'force-dynamic';

const CANDIDATES_PATH = 'wiki/entities/_candidates.json';
const ACTIONS: CandidateStatus[] = ['merge_alias', 'create', 'reject'];

interface ResolveBody {
  normalized?: string;
  action?: CandidateStatus;
  target_slug?: string; // merge_alias
  entity_type?: string; // create
  slug?: string; // create (défaut : slugify(name))
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Enregistre une décision humaine sur une entité candidate : fusionner comme
 * alias, créer (avec un type existant ou un nouveau type saisi), ou rejeter.
 * On écrit la décision dans wiki/entities/_candidates.json (commit GitHub) puis
 * on déclenche l'ingestion — le moteur d'ingestion applique la décision, crée
 * les liens et purge l'entrée au run suivant.
 */
export async function POST(req: NextRequest) {
  if (!isGithubConfigured()) {
    return Response.json(
      { error: 'Dépôt GitHub non configuré (GITHUB_TOKEN / GITHUB_REPO).' },
      { status: 503 },
    );
  }

  let body: ResolveBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const normalized = body.normalized?.trim();
  const action = body.action;
  if (!normalized) {
    return Response.json({ error: 'Champ « normalized » requis' }, { status: 400 });
  }
  if (!action || !ACTIONS.includes(action)) {
    return Response.json(
      { error: `Action invalide (attendu : ${ACTIONS.join(' | ')})` },
      { status: 400 },
    );
  }
  if (action === 'merge_alias' && !body.target_slug?.trim()) {
    return Response.json(
      { error: 'Fusion : « target_slug » (entité cible) requis' },
      { status: 400 },
    );
  }
  if (action === 'create' && !body.entity_type?.trim()) {
    return Response.json(
      { error: 'Création : « entity_type » requis' },
      { status: 400 },
    );
  }

  // On relit le fichier le plus à jour du dépôt (pas le snapshot bundlé au build).
  const res = await fetchRepoFileRaw(CANDIDATES_PATH);
  if (!res.ok || !res.buffer) {
    return Response.json(
      { error: `Lecture de ${CANDIDATES_PATH} impossible (statut ${res.status}).` },
      { status: 502 },
    );
  }

  let doc: any;
  try {
    doc = JSON.parse(res.buffer.toString('utf-8'));
  } catch {
    return Response.json({ error: 'Fichier _candidates.json corrompu' }, { status: 502 });
  }

  const list: any[] = Array.isArray(doc?.candidates) ? doc.candidates : [];
  const cand = list.find((c) => String(c?.normalized) === normalized);
  if (!cand) {
    return Response.json(
      { error: `Candidate « ${normalized} » introuvable` },
      { status: 404 },
    );
  }

  const newSlug =
    action === 'create'
      ? (body.slug?.trim() ? slugify(body.slug) : slugify(String(cand.name ?? normalized)))
      : null;

  cand.status = action;
  cand.decision = {
    target_slug: action === 'merge_alias' ? slugify(body.target_slug!) : null,
    entity_type: action === 'create' ? slugify(body.entity_type!) : null,
    slug: newSlug,
  };
  cand.updated_at = today();

  const content = JSON.stringify(doc, null, 2) + '\n';

  try {
    const { commitSha } = await commitFiles(
      [{ path: CANDIDATES_PATH, content }],
      `chore(entities): décision « ${action} » sur candidate ${normalized}`,
    );
    const dispatched = await dispatchIngest();
    return Response.json({ ok: true, commit_sha: commitSha, dispatched });
  } catch (e: any) {
    return Response.json(
      { error: `Commit GitHub échoué : ${e?.message ?? 'inconnu'}` },
      { status: 502 },
    );
  }
}
