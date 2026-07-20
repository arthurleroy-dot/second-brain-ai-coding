import { NextRequest } from 'next/server';
import { runIngestion, readIngestState, lockHeld } from '@/lib/ingest-local';

export const dynamic = 'force-dynamic';

/**
 * Relance MANUELLE de l'ingestion (bouton de l'UI).
 * POST → lance `runIngestion()` en arrière-plan si aucune ingestion n'est en cours
 * (le verrou sérialise), puis renvoie l'état courant. Ne bloque pas sur la fin du run.
 */
export async function POST(_req: NextRequest) {
  if (lockHeld()) {
    const state = await readIngestState();
    return Response.json({ ok: true, alreadyRunning: true, state });
  }
  void runIngestion().catch((e) => {
    console.error('[ingest] relance manuelle échouée :', e?.message ?? e);
  });
  return Response.json({ ok: true, started: true });
}
