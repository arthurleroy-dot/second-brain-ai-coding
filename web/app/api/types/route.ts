import { NextRequest } from 'next/server';
import { applyFileOps } from '@/lib/wiki-fs';
import { listTypeRegistry, listTypes, slugify } from '@/lib/wiki-parser';
import { BUILTIN_TYPE_SLUGS, typeLabel } from '@/lib/ui';

export const dynamic = 'force-dynamic';

const SLUG_RE = /^[a-z0-9-]+$/;

/**
 * Registre des types de document — miroir léger de settings/route (GET+POST fichier de
 * config). Le registre EFFECTIF = liste complète du menu de dépôt : `wiki/types.json`
 * fait autorité dès qu'il est non vide (sinon graine `BUILTIN_TYPE_SLUGS`). Une
 * mutation (POST ici, PATCH/DELETE dans [slug]) réécrit TOUJOURS la liste effective
 * complète → elle matérialise la graine au premier changement. Pilote UNIQUEMENT le
 * menu de dépôt ; filtres/graphe restent dérivés des ressources réelles (cf. spec §A5).
 */

// GET → liste enrichie { slug, label, source_count, builtin }, triée par libellé.
// `builtin` = « fait partie de la graine par défaut » (indicatif ; ne verrouille RIEN).
export async function GET() {
  const [slugs, inUse] = await Promise.all([listTypeRegistry(), listTypes()]);
  const counts = new Map(inUse.map((t) => [t.type, t.source_count]));
  const builtin = new Set<string>(BUILTIN_TYPE_SLUGS);
  const types = slugs
    .map((s) => ({
      slug: s,
      label: typeLabel(s),
      source_count: counts.get(s) ?? 0,
      builtin: builtin.has(s),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return Response.json({ types });
}

// POST { name } → crée un type (ajoute son slug au registre). Slug + couleur auto.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }
  const name = typeof (body as any)?.name === 'string' ? (body as any).name : '';
  const slug = slugify(name);
  if (!slug || !SLUG_RE.test(slug)) {
    return Response.json({ error: 'Nom de type invalide' }, { status: 400 });
  }

  // Base = liste effective complète (fichier ou graine) → écriture = matérialisation.
  const current = await listTypeRegistry();
  if (current.includes(slug)) {
    return Response.json({ error: 'Ce type existe déjà' }, { status: 409 });
  }

  try {
    await applyFileOps([
      {
        path: 'wiki/types.json',
        content: JSON.stringify({ types: [...current, slug] }, null, 2) + '\n',
      },
    ]);
    return Response.json({ ok: true, slug, label: typeLabel(slug) });
  } catch (e: any) {
    return Response.json(
      { error: `Écriture locale échouée : ${e?.message ?? 'inconnu'}` },
      { status: 500 },
    );
  }
}
