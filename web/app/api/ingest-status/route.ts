import { NextRequest } from 'next/server';
import { readRepoFile } from '@/lib/wiki-fs';
import { readIngestState, lockHeld } from '@/lib/ingest-local';

export const dynamic = 'force-dynamic';

/**
 * Statut d'ingestion d'un fichier déposé dans /raw — état 100 % LOCAL.
 * - "ingested"   : présent dans wiki/_ingested.json (avec le slug de la ressource).
 * - "processing" : une ingestion locale tourne (état `running` ou verrou tenu).
 * - "error"      : le dernier run local a échoué (message dans `error`).
 * - "pending"    : déposé, pas encore ingéré.
 */
export async function GET(req: NextRequest) {
  const file = new URL(req.url).searchParams.get('file');

  // Mode GLOBAL (sans `file`) : renvoie l'état du moteur d'ingestion, sans avoir
  // à connaître le nom du fichier. Sert à reprendre le suivi d'un run en cours
  // après une navigation ou un rechargement complet (cf. ingest-view-store).
  if (!file) {
    const state = await readIngestState();
    const processing = state.status === 'running' || lockHeld();
    return Response.json({
      state: processing
        ? 'processing'
        : state.status === 'error'
          ? 'error'
          : state.status === 'done'
            ? 'done'
            : 'idle',
      pending: state.pending ?? [],
      slug: state.slug ?? null,
      costUsd: state.costUsd ?? null,
      perFile: state.perFile ?? [],
      error: state.error ?? null,
    });
  }

  // 1. Déjà ingéré ? (le manifeste fait foi)
  const manifestJson = await readRepoFile('wiki/_ingested.json');
  if (manifestJson !== null) {
    try {
      const manifest = JSON.parse(manifestJson);
      const entry = manifest?.files?.[file];
      if (entry?.slug) {
        // Coût : total du run + coût de CE fichier (depuis l'état persistant).
        const st = await readIngestState();
        const fileCost = st.perFile?.find((p) => p.file === file)?.costUsd;
        return Response.json({
          state: 'ingested',
          slug: entry.slug,
          costUsd: st.costUsd,
          fileCostUsd: fileCost,
        });
      }
    } catch {
      /* manifeste illisible : on continue */
    }
  }

  // 2. Sinon, état du moteur d'ingestion local.
  const state = await readIngestState();
  if (state.status === 'running' || lockHeld()) {
    return Response.json({ state: 'processing' });
  }
  if (state.status === 'error') {
    return Response.json({ state: 'error', error: state.error });
  }
  return Response.json({ state: 'pending' });
}
