import { NextRequest } from 'next/server';
import { applyFileOps, readRepoFile } from '@/lib/wiki-fs';
import { slugify } from '@/lib/wiki-parser';
import { applyThemeDecision, type SeenIn } from '@/lib/wiki-mutate';
import { rebuildDerivedIndexes } from '@/lib/ingest-local';
import { CandidateStatus } from '@/types';

export const dynamic = 'force-dynamic';

const CANDIDATES_PATH = 'wiki/themes/_candidates.json';
const ACTIONS: CandidateStatus[] = ['merge_alias', 'create', 'reject'];

interface ResolveBody {
  normalized?: string;
  action?: CandidateStatus;
  target_slug?: string; // merge_alias
  slug?: string; // create (défaut : slugify(name))
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Applique DÉTERMINISTIQUEMENT une décision humaine sur un thème candidat
 * (fusionner comme alias, créer, ou rejeter). Miroir de /api/candidates/resolve,
 * sans le champ `entity_type` (un thème n'a pas de type). Relie les `topics:` des
 * ressources de `seen_in`, met à jour graphe + index, purge l'entrée — écrit
 * localement via `applyFileOps`, aucun réseau.
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
    return Response.json({ error: 'Fusion : « target_slug » (thème cible) requis' }, { status: 400 });
  }

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
    return Response.json({ error: `Thème candidat « ${normalized} » introuvable` }, { status: 404 });
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
    slug: action === 'create' ? (body.slug?.trim() ? slugify(body.slug) : slugify(name)) : null,
  };

  const graph = await readRepoFile('wiki/graph.json');
  const index = await readRepoFile('wiki/index.md');
  if (graph === null || index === null) {
    return Response.json({ error: 'Lecture de wiki/graph.json ou index.md impossible.' }, { status: 502 });
  }
  const resources: Record<string, string> = {};
  const uniqueResources = [...new Set(seenIn.map((s) => s.resource).filter(Boolean))];
  await Promise.all(
    uniqueResources.map(async (r) => {
      const c = await readRepoFile(`wiki/resources/${r}.md`);
      if (c !== null) resources[r] = c;
    }),
  );
  let themePage: string | null = null;
  if (action === 'merge_alias') {
    themePage = await readRepoFile(`wiki/themes/${decision.target_slug}.md`);
    if (themePage === null) {
      return Response.json(
        { error: `Thème cible « ${decision.target_slug} » introuvable.` },
        { status: 404 },
      );
    }
  }

  const ops = applyThemeDecision({
    action: action as 'merge_alias' | 'create' | 'reject',
    candidate: { name, normalized, variants, seen_in: seenIn },
    decision,
    resources,
    themePage,
    graph,
    candidatesJson,
    index,
    today: today(),
  });

  try {
    await applyFileOps(ops);
    // Régénère index.md + by-date EN ENTIER (symétrie avec /api/candidates/resolve).
    await applyFileOps(await rebuildDerivedIndexes(today()));
    return Response.json({ ok: true, applied: true });
  } catch (e: any) {
    return Response.json(
      { error: `Écriture locale échouée : ${e?.message ?? 'inconnu'}` },
      { status: 500 },
    );
  }
}
