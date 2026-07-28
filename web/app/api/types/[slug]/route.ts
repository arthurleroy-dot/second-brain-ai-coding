import { NextRequest } from 'next/server';
import { listTypeRegistryFull, listTypes, slugify, writeTypeRegistry } from '@/lib/wiki-parser';
import { typeLabel } from '@/lib/ui';
import { OriginValue } from '@/types';

export const dynamic = 'force-dynamic';

const SLUG_RE = /^[a-z0-9-]+$/;

/** Nombre de ressources portant ce type (source de vérité = ressources réelles). */
async function usageCount(slug: string): Promise<number> {
  return (await listTypes()).find((t) => t.type === slug)?.source_count ?? 0;
}

/**
 * Règle du registre : un type est RENOMMABLE/SUPPRIMABLE tant qu'AUCUNE ressource ne le
 * porte ; dès qu'une ressource l'utilise, son slug est figé (identifiants immuables —
 * cardinale #5) → ni renommage ni suppression. En REVANCHE, changer l'ORIGINE par défaut
 * d'un type est TOUJOURS autorisé (même utilisé) : ça ne touche pas au slug (aucune
 * rupture de wikilink) et n'affecte QUE les futurs dépôts (cf. spec §6). Le registre
 * `wiki/types.json` porte des objets `{ slug, origin }` ; chaque mutation réécrit la
 * liste effective complète (matérialise la graine). Aucune vue dérivée à toucher.
 */

// DELETE → retire un type inutilisé du registre.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const slug = params.slug?.trim();
  if (!slug || !SLUG_RE.test(slug)) {
    return Response.json({ error: 'Slug invalide' }, { status: 400 });
  }

  const count = await usageCount(slug);
  if (count > 0) {
    return Response.json(
      { error: `${count} ressource(s) utilisent ce type` },
      { status: 409 },
    );
  }

  const current = await listTypeRegistryFull();
  const next = current.filter((t) => t.slug !== slug);
  // Idempotent : si le slug n'était pas listé, on réécrit la liste effective à l'identique.

  try {
    await writeTypeRegistry(next);
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json(
      { error: `Écriture locale échouée : ${e?.message ?? 'inconnu'}` },
      { status: 500 },
    );
  }
}

// PATCH { name?, origin? } → change l'ORIGINE (toujours autorisé) et/ou RENOMME (interdit
// si le type est utilisé). Les deux opérations sont indépendantes : on peut ne changer que
// l'origine d'un type en usage sans toucher au slug.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const oldSlug = params.slug?.trim();
  if (!oldSlug || !SLUG_RE.test(oldSlug)) {
    return Response.json({ error: 'Slug invalide' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const current = await listTypeRegistryFull();
  const idx = current.findIndex((t) => t.slug === oldSlug);
  if (idx === -1) {
    return Response.json({ error: 'Type introuvable' }, { status: 404 });
  }
  const next = [...current];

  // (a) Changement d'origine — INCONDITIONNEL (n'affecte que les futurs dépôts).
  const oIn = (body as any)?.origin;
  if (oIn === 'interne' || oIn === 'externe') {
    next[idx] = { ...next[idx], origin: oIn as OriginValue };
  }

  // (b) Renommage — seulement si un `name` est fourni ET le slug change.
  const name = typeof (body as any)?.name === 'string' ? (body as any).name : '';
  const newSlug = name ? slugify(name) : oldSlug;
  if (name && newSlug && newSlug !== oldSlug) {
    if (!SLUG_RE.test(newSlug)) {
      return Response.json({ error: 'Nouveau nom invalide' }, { status: 400 });
    }
    const count = await usageCount(oldSlug);
    if (count > 0) {
      return Response.json(
        { error: `${count} ressource(s) utilisent ce type — nom figé` },
        { status: 409 },
      );
    }
    if (current.some((t) => t.slug === newSlug)) {
      return Response.json({ error: 'Un type porte déjà ce nom' }, { status: 409 });
    }
    next[idx] = { ...next[idx], slug: newSlug };
  }

  try {
    await writeTypeRegistry(next);
    return Response.json({
      ok: true,
      slug: next[idx].slug,
      label: typeLabel(next[idx].slug),
      origin: next[idx].origin,
    });
  } catch (e: any) {
    return Response.json(
      { error: `Écriture locale échouée : ${e?.message ?? 'inconnu'}` },
      { status: 500 },
    );
  }
}
