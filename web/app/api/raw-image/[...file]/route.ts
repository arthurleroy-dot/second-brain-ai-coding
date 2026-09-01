import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { RAW_ROOT } from '@/lib/wiki-fs';
import { renderPdfPageToPng } from '@/lib/pdf-render';

export const dynamic = 'force-dynamic';

/**
 * Rend UNE page d'un PDF de /raw en PNG, À LA DEMANDE (rien de stocké : `raw/` reste
 * l'unique vérité). Sert les blocs figure du wiki : leur ligne
 * `![…](/api/raw-image/<fichier>?page=N)` fait charger l'image par le NAVIGATEUR
 * (indépendamment de l'agent chat, qui n'accède pas à /raw). Calqué sur
 * `/api/raw/[...file]` (basename anti-traversal, lecture RAW_ROOT), + rendu pdf-render.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { file: string[] } },
) {
  // Noms de /raw plats : on ne garde que le basename (anti-traversal).
  const name = path.basename((params.file ?? []).join('/'));
  if (!name) return new Response('Not found', { status: 404 });
  if (!name.toLowerCase().endsWith('.pdf')) {
    return new Response('Rendu image disponible pour les PDF uniquement.', { status: 415 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, Math.floor(Number(url.searchParams.get('page') ?? '1')) || 1);
  // Échelle bornée [1, 4] : 2 par défaut (bord long ≲ 1568 px sur une diapo 16:9).
  const scaleRaw = Number(url.searchParams.get('scale') ?? '2');
  const scale = Math.min(4, Math.max(1, Number.isFinite(scaleRaw) ? scaleRaw : 2));

  let bytes: Buffer;
  try {
    bytes = await fs.readFile(path.join(RAW_ROOT, name));
  } catch {
    return new Response('Fichier introuvable', { status: 404 });
  }

  let png: Buffer;
  try {
    png = await renderPdfPageToPng(new Uint8Array(bytes), page, scale);
  } catch (e: any) {
    return new Response(`Rendu impossible (page ${page}) : ${e?.message ?? e}`, { status: 500 });
  }

  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
