import { NextRequest } from 'next/server';
import { applyFileOps, readRepoFile } from '@/lib/wiki-fs';
import { slugify } from '@/lib/wiki-parser';
import { applyEntityDecision, type SeenIn } from '@/lib/wiki-mutate';
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
 * Applique DÉTERMINISTIQUEMENT une décision humaine sur une entité candidate
 * (fusionner comme alias, créer, ou rejeter). On lit l'état à jour sur disque, on
 * calcule la mutation via le moteur `wiki-mutate` (relie rétroactivement les
 * ressources de `seen_in`, met à jour le graphe, purge l'entrée) et on écrit le
 * tout localement (`applyFileOps`). Application immédiate, aucun réseau.
 */
export async function POST(req: NextRequest) {
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
    return Response.json({ error: 'Fusion : « target_slug » (entité cible) requis' }, { status: 400 });
  }
  if (action === 'create' && !body.entity_type?.trim()) {
    return Response.json({ error: 'Création : « entity_type » requis' }, { status: 400 });
  }

  // État à jour sur disque (pas le snapshot bundlé au build).
  const candidatesJson = await readRepoFile(CANDIDATES_PATH);
  if (candidatesJson === null) {
    return Response.json({ error: `Lecture de ${CANDIDATES_PATH} impossible.` }, { status: 502 });
  }
  let doc: any;
  try {
    doc = JSON.parse(candidatesJson);
  } catch {
    return Response.json({ error: 'Fichier _candidates.json corrompu' }, { status: 502 });
  }
  const cand = (doc.candidates ?? []).find((c: any) => String(c?.normalized) === normalized);
  if (!cand) {
    return Response.json({ error: `Candidate « ${normalized} » introuvable` }, { status: 404 });
  }

  const seenIn: SeenIn[] = Array.isArray(cand.seen_in)
    ? cand.seen_in.map((s: any) => ({
        resource: String(s?.resource ?? ''),
        section: s?.section ?? null,
        context: String(s?.context ?? ''),
      }))
    : [];
  const variants: string[] = Array.isArray(cand.variants) ? cand.variants.map(String) : [];
  const name = String(cand.name ?? normalized);

  const decision = {
    target_slug: action === 'merge_alias' ? slugify(body.target_slug!) : null,
    entity_type: action === 'create' ? slugify(body.entity_type!) : null,
    slug: action === 'create' ? (body.slug?.trim() ? slugify(body.slug) : slugify(name)) : null,
  };

  // Lecture des fichiers nécessaires (best-effort : une ressource absente est
  // simplement ignorée par le moteur).
  const graph = await readRepoFile('wiki/graph.json');
  if (graph === null) {
    return Response.json({ error: 'Lecture de wiki/graph.json impossible.' }, { status: 502 });
  }
  const resources: Record<string, string> = {};
  const uniqueResources = [...new Set(seenIn.map((s) => s.resource).filter(Boolean))];
  await Promise.all(
    uniqueResources.map(async (r) => {
      const c = await readRepoFile(`wiki/resources/${r}.md`);
      if (c !== null) resources[r] = c;
    }),
  );
  let entityPage: string | null = null;
  if (action === 'merge_alias') {
    entityPage = await readRepoFile(`wiki/entities/${decision.target_slug}.md`);
    if (entityPage === null) {
      return Response.json(
        { error: `Entité cible « ${decision.target_slug} » introuvable.` },
        { status: 404 },
      );
    }
  }

  const ops = applyEntityDecision({
    action: action as 'merge_alias' | 'create' | 'reject',
    candidate: { name, normalized, variants, seen_in: seenIn },
    decision,
    resources,
    entityPage,
    graph,
    candidatesJson,
    today: today(),
  });

  try {
    await applyFileOps(ops);
    return Response.json({ ok: true, applied: true });
  } catch (e: any) {
    return Response.json(
      { error: `Écriture locale échouée : ${e?.message ?? 'inconnu'}` },
      { status: 500 },
    );
  }
}
