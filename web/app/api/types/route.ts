import { NextRequest } from 'next/server';
import {
  listTypeRegistryFull,
  listTypes,
  slugify,
  writeTypeRegistry,
} from '@/lib/wiki-parser';
import { BUILTIN_TYPE_SLUGS, typeLabel } from '@/lib/ui';
import { OriginValue } from '@/types';

export const dynamic = 'force-dynamic';

const SLUG_RE = /^[a-z0-9-]+$/;

/**
 * Registre des types de document — miroir léger de settings/route (GET+POST fichier de
 * config). Le registre EFFECTIF = liste complète du menu de dépôt : `wiki/types.json`
 * (`{ "types": [{ slug, origin }] }`) fait autorité dès qu'il est non vide (sinon graine
 * `BUILTIN_TYPE_SLUGS` avec origines par défaut). Une mutation (POST ici, PATCH/DELETE
 * dans [slug]) réécrit TOUJOURS la liste effective complète (objets) → elle matérialise
 * la graine au premier changement. Chaque type porte une ORIGINE binaire (interne|externe)
 * qui alimente les futurs dépôts ; filtres/graphe restent dérivés des ressources réelles.
 */

// GET → liste enrichie { slug, label, origin, source_count, builtin }, triée par libellé.
// `builtin` = « fait partie de la graine par défaut » (indicatif ; ne verrouille RIEN).
export async function GET() {
  const [full, inUse] = await Promise.all([listTypeRegistryFull(), listTypes()]);
  const counts = new Map(inUse.map((t) => [t.type, t.source_count]));
  const builtin = new Set<string>(BUILTIN_TYPE_SLUGS);
  const types = full
    .map((t) => ({
      slug: t.slug,
      label: typeLabel(t.slug),
      origin: t.origin,
      source_count: counts.get(t.slug) ?? 0,
      builtin: builtin.has(t.slug),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return Response.json({ types });
}

// POST { name, origin? } → crée un type (ajoute { slug, origin } au registre). Slug +
// couleur auto ; origine binaire (défaut externe si absente/invalide).
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
  const originIn = (body as any)?.origin;
  const origin: OriginValue = originIn === 'interne' || originIn === 'externe' ? originIn : 'externe';

  // Base = liste effective complète (fichier ou graine) → écriture = matérialisation.
  const current = await listTypeRegistryFull();
  if (current.some((t) => t.slug === slug)) {
    return Response.json({ error: 'Ce type existe déjà' }, { status: 409 });
  }

  try {
    await writeTypeRegistry([...current, { slug, origin }]);
    return Response.json({ ok: true, slug, label: typeLabel(slug), origin });
  } catch (e: any) {
    return Response.json(
      { error: `Écriture locale échouée : ${e?.message ?? 'inconnu'}` },
      { status: 500 },
    );
  }
}
