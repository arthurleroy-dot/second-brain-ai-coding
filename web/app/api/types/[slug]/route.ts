import { NextRequest } from 'next/server';
import { applyFileOps } from '@/lib/wiki-fs';
import { listTypeRegistry, listTypes, slugify } from '@/lib/wiki-parser';
import { typeLabel } from '@/lib/ui';

export const dynamic = 'force-dynamic';

const SLUG_RE = /^[a-z0-9-]+$/;

/** Écrit la liste effective complète dans wiki/types.json (matérialise la graine). */
async function writeRegistry(types: string[]): Promise<void> {
  await applyFileOps([
    {
      path: 'wiki/types.json',
      content: JSON.stringify({ types }, null, 2) + '\n',
    },
  ]);
}

/** Nombre de ressources portant ce type (source de vérité = ressources réelles). */
async function usageCount(slug: string): Promise<number> {
  return (await listTypes()).find((t) => t.type === slug)?.source_count ?? 0;
}

/**
 * Règle unique du registre : un type est modifiable/supprimable tant qu'AUCUNE
 * ressource ne le porte ; dès qu'une ressource l'utilise, son slug est figé
 * (identifiants immuables — cardinale #5) → ni renommage ni suppression.
 * Plus de notion de type « intégré » indéboulonnable : la graine par défaut est
 * juste un amorçage éditable. Aucune vue dérivée à toucher (un type à 0 ressource
 * n'a ni ligne `types.md`, ni nœud graphe) : on ne réécrit que `wiki/types.json`.
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

  const current = await listTypeRegistry();
  const next = current.filter((s) => s !== slug);
  // Idempotent : si le slug n'était pas listé, on réécrit la liste effective à l'identique.

  try {
    await writeRegistry(next);
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json(
      { error: `Écriture locale échouée : ${e?.message ?? 'inconnu'}` },
      { status: 500 },
    );
  }
}

// PATCH { name } → renomme un type inutilisé (retire l'ancien slug, ajoute le nouveau,
// même position). Renommer = changer le slug ; interdit dès qu'une ressource l'utilise.
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
  const name = typeof (body as any)?.name === 'string' ? (body as any).name : '';
  const newSlug = slugify(name);
  if (!newSlug || !SLUG_RE.test(newSlug)) {
    return Response.json({ error: 'Nouveau nom invalide' }, { status: 400 });
  }

  if (newSlug === oldSlug) {
    // Rien à changer (même slug après normalisation) — no-op réussi.
    return Response.json({ ok: true, slug: oldSlug, label: typeLabel(oldSlug) });
  }

  const count = await usageCount(oldSlug);
  if (count > 0) {
    return Response.json(
      { error: `${count} ressource(s) utilisent ce type — nom figé` },
      { status: 409 },
    );
  }

  const current = await listTypeRegistry();
  if (!current.includes(oldSlug)) {
    return Response.json({ error: 'Type introuvable' }, { status: 404 });
  }
  if (current.includes(newSlug)) {
    return Response.json({ error: 'Un type porte déjà ce nom' }, { status: 409 });
  }

  const next = current.map((s) => (s === oldSlug ? newSlug : s));

  try {
    await writeRegistry(next);
    return Response.json({ ok: true, slug: newSlug, label: typeLabel(newSlug) });
  } catch (e: any) {
    return Response.json(
      { error: `Écriture locale échouée : ${e?.message ?? 'inconnu'}` },
      { status: 500 },
    );
  }
}
