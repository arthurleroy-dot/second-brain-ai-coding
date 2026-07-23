import { NextRequest } from 'next/server';
import { snapshot, subscribe, type IngestEvent } from '@/lib/ingest-events';

export const dynamic = 'force-dynamic';
// Un run d'ingestion peut durer (extraction + appel IA + projection) ; on aligne
// la durée max sur celle du chat. Serveur local long-vécu (Electron / next start).
export const maxDuration = 300;

/**
 * Flux NDJSON de suivi d'ingestion — MIROIR de `app/api/chat/route.ts`, adapté au
 * fait que l'ingestion est fire-and-forget (détachée de toute requête). À la
 * connexion : on REJOUE le buffer du run courant (`snapshot`) puis on s'ABONNE au
 * live (`subscribe`) — sans aucun `await` entre les deux, donc ni trou ni doublon.
 * Aucune écriture disque, aucun appel modèle : la route ne fait que relayer.
 *
 * Contrat NDJSON (un objet JSON par ligne `\n`), `Content-Type: application/x-ndjson` :
 *   {type:'step', id, phase, label, file?} · {type:'delta', text}
 *   {type:'done'} · {type:'error', error}
 * Le `status` reading|done est DÉRIVÉ côté client (comme pour le chat).
 */
export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  let unsub = () => {}; // au scope de GET → partagé entre `start` et `cancel`

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let gone = false;
      const send = (o: IngestEvent) => {
        if (gone) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(o) + '\n'));
        } catch {
          gone = true; // client déconnecté (miroir du `clientGone` du chat)
        }
      };
      const close = () => {
        unsub();
        try {
          controller.close();
        } catch {
          /* déjà fermé */
        }
      };

      const snap = snapshot();
      if (!snap) {
        close();
        return; // aucun run : le client retombe sur le polling /api/ingest-status
      }
      for (const e of snap.events) send(e); // REJEU du buffer
      if (snap.terminal) {
        close();
        return; // run déjà fini : rejeu + fermeture immédiate
      }

      // Pas d'`await` entre snapshot() et subscribe() → atomicité rejeu → live.
      unsub = subscribe((e) => {
        send(e);
        if (e.type === 'done' || e.type === 'error') close();
      });

      req.signal.addEventListener('abort', () => {
        gone = true;
        close();
      });
    },
    cancel() {
      unsub();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}
