import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * Supprime définitivement une ressource : le fichier dans Storage (le cas
 * échéant) puis la ligne `resources`. Les tables liées (resource_content,
 * resource_topics, processing_jobs) sont supprimées en cascade (cf. schema.sql).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  let db;
  try {
    db = requireAdmin();
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 503 });
  }

  const { id } = params;

  // Récupère le storage_path pour nettoyer le fichier brut.
  const { data: resource, error: fetchErr } = await db
    .from('resources')
    .select('id, storage_path')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) {
    return Response.json({ error: fetchErr.message }, { status: 502 });
  }
  if (!resource) {
    return Response.json({ error: 'Ressource introuvable' }, { status: 404 });
  }

  // 1. Supprime le fichier dans Storage (best-effort : on n'échoue pas la
  //    suppression de la ressource si le fichier est déjà absent).
  if (resource.storage_path) {
    const { error: rmErr } = await db.storage
      .from('raw-files')
      .remove([resource.storage_path]);
    if (rmErr) {
      console.error(`Suppression fichier Storage échouée (${resource.storage_path}):`, rmErr.message);
    }
  }

  // 2. Supprime la ressource (cascade sur les tables liées).
  const { error: delErr } = await db.from('resources').delete().eq('id', id);
  if (delErr) {
    return Response.json({ error: delErr.message }, { status: 502 });
  }

  return Response.json({ ok: true, id });
}
