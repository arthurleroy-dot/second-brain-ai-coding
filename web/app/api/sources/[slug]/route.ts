import { NextRequest } from 'next/server';
import matter from 'gray-matter';
import { applyFileOps, readRepoFile, repoPathExists } from '@/lib/wiki-fs';
import { slugify } from '@/lib/wiki-parser';
import { typeLabel } from '@/lib/ui';
import {
  deleteResource,
  parseResourceMeta,
  type DeleteViews,
  type ResourceMeta,
} from '@/lib/wiki-mutate';
import { projectResource } from '@/lib/wiki-project';
import { buildEditedResourceContent } from '@/lib/wiki-edit';
import {
  rebuildDerivedIndexes,
  loadRegistries,
  resolveDeclarations,
  loadProjectViews,
  rebuildNav,
  type Sidecar,
} from '@/lib/ingest-local';
import { OriginValue } from '@/types';

export const dynamic = 'force-dynamic';

const SLUG_RE = /^[a-z0-9-]+$/;

// Libellé d'un `source_type` (slug kebab brut) — fonction pure du slug (lib/ui).
const wikiTypeLabel = (t: string) => typeLabel(t);

/**
 * Lit les vues dérivées dépendantes d'une ressource (déduites de son frontmatter,
 * pas de scan global) pour alimenter `deleteResource`. Renvoie `null` si les fichiers
 * d'index centraux (graph/manifest/index) sont illisibles. Partagé par DELETE (purge)
 * et PATCH (phase A « retract » de l'édition) → un seul chemin de lecture testé.
 */
async function readDeleteViews(meta: ResourceMeta): Promise<DeleteViews | null> {
  const authorSlug = meta.author ? slugify(meta.author) : null;
  const year = (meta.date ?? '').slice(0, 4);
  const ym = (meta.date ?? '').slice(0, 7);
  const isMonth = (meta.date ?? '').length >= 7;

  const themes: Record<string, string> = {};
  await Promise.all(
    meta.topics.map(async (t) => {
      const c = await readRepoFile(`wiki/themes/${t}.md`);
      if (c !== null) themes[t] = c;
    }),
  );
  const entities: Record<string, string> = {};
  await Promise.all(
    meta.entities.map(async (e) => {
      const c = await readRepoFile(`wiki/entities/${e}.md`);
      if (c !== null) entities[e] = c;
    }),
  );

  const [
    authorContent,
    originContent,
    yearContent,
    monthContent,
    graph,
    manifest,
    index,
    types,
    metaExists,
  ] = await Promise.all([
    authorSlug ? readRepoFile(`wiki/authors/${authorSlug}.md`) : Promise.resolve(null),
    meta.origin ? readRepoFile(`wiki/origin/${meta.origin}.md`) : Promise.resolve(null),
    year ? readRepoFile(`wiki/by-date/${year}/${year}.md`) : Promise.resolve(null),
    isMonth ? readRepoFile(`wiki/by-date/${year}/${ym}/${ym}.md`) : Promise.resolve(null),
    readRepoFile('wiki/graph.json'),
    readRepoFile('wiki/_ingested.json'),
    readRepoFile('wiki/index.md'),
    readRepoFile('wiki/types.md'),
    meta.source_file
      ? repoPathExists(`raw/${meta.source_file}.meta.md`)
      : Promise.resolve(false),
  ]);

  if (graph === null || manifest === null || index === null) return null;

  return {
    themes,
    authorPath: authorSlug ? `wiki/authors/${authorSlug}.md` : null,
    authorContent,
    originPath: meta.origin ? `wiki/origin/${meta.origin}.md` : null,
    originContent,
    entities,
    yearPath: year ? `wiki/by-date/${year}/${year}.md` : null,
    yearContent,
    monthPath: isMonth ? `wiki/by-date/${year}/${ym}/${ym}.md` : null,
    monthContent,
    graph,
    manifest,
    index,
    types,
    metaExists,
  };
}

/**
 * Supprime DÉTERMINISTIQUEMENT une ressource : retire la ressource canonique +
 * toutes ses références (thèmes, auteur, origine, by-date, entités, graphe,
 * index, types, manifeste) + les fichiers bruts (`raw/<source>` + sidecar).
 * Écriture locale via `applyFileOps` ; la clé du manifeste `_ingested.json` est
 * purgée dans le même lot, donc aucune ré-ingestion possible de la source.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const slug = params.slug?.trim();
  if (!slug || !SLUG_RE.test(slug)) {
    return Response.json({ error: 'Slug invalide' }, { status: 400 });
  }

  const resourceContent = await readRepoFile(`wiki/resources/${slug}.md`);
  if (resourceContent === null) {
    return Response.json({ error: `Ressource « ${slug} » introuvable` }, { status: 404 });
  }

  const meta = parseResourceMeta(resourceContent, slug);
  const views = await readDeleteViews(meta);
  if (views === null) {
    return Response.json(
      { error: 'Lecture des fichiers d’index du wiki impossible (graph/manifest/index).' },
      { status: 502 },
    );
  }

  const ops = deleteResource({
    slug,
    resourceContent,
    views,
    slugifyAuthor: slugify,
    typeLabel: wikiTypeLabel,
  });

  try {
    await applyFileOps(ops);
    // Régénère index.md + by-date EN ENTIER après suppression : lignes retirées,
    // compteurs à jour, pages by-date orphelines purgées.
    await applyFileOps(await rebuildDerivedIndexes(new Date().toISOString().slice(0, 10)));
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json(
      { error: `Écriture locale échouée : ${e?.message ?? 'inconnu'}` },
      { status: 500 },
    );
  }
}

// ————————————————————————————————————————————————————————————————
// PATCH : édition des métadonnées « déclarées » d'une ressource existante.
// AUCUN appel IA (le corps verbatim est conservé) → synchrone, instantané, gratuit.
// Modèle en 2 phases symétriques + reconstruction des index (cf. spec §3, décision D1) :
//   A. retract : deleteResource (filtré : ni raw/ ni la page canonique) → applyFileOps
//   B. project : loadProjectViews (disque POST-retract) + projectResource → applyFileOps
//   C. rebuild : rebuildDerivedIndexes (index.md + by-date reconstruits en entier)

/** Chaîne trimée d'un champ JSON, `''` autorisé ; repli si le champ n'est pas une string. */
function strField(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v.trim() : fallback;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const slug = params.slug?.trim();
  if (!slug || !SLUG_RE.test(slug)) {
    return Response.json({ error: 'Slug invalide' }, { status: 400 });
  }

  const oldContent = await readRepoFile(`wiki/resources/${slug}.md`);
  if (oldContent === null) {
    return Response.json({ error: `Ressource « ${slug} » introuvable` }, { status: 404 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const oldMeta = parseResourceMeta(oldContent, slug);
  const today = new Date().toISOString().slice(0, 10);

  // ---- Normalisation du payload (slugify + validations minimales, cf. décision D5) ----
  const title = strField(payload.title, oldMeta.title ?? '');
  const author = strField(payload.author, oldMeta.author ?? '');
  const date = strField(payload.date, oldMeta.date ?? '');
  const oldUrl = typeof matter(oldContent).data.url === 'string' ? String(matter(oldContent).data.url) : '';
  const url = strField(payload.url, oldUrl);
  // Type : slug ; vide → repli sur l'ancien type, sinon `unknown` (miroir forceType).
  const source_type = slugify(strField(payload.type, '')) || oldMeta.source_type || 'unknown';
  // Origine : n'accepte que interne|externe, sinon garde l'ancienne (repli externe si nulle).
  const originRaw = strField(payload.origin, '');
  const origin: OriginValue =
    originRaw === 'interne' || originRaw === 'externe'
      ? originRaw
      : (oldMeta.origin as OriginValue) ?? 'externe';

  // links : { entity_type → [nom|slug] } déjà objet JSON → slugifié, types/valeurs vides retirés.
  const links: Record<string, string[]> = {};
  if (payload.links && typeof payload.links === 'object' && !Array.isArray(payload.links)) {
    for (const [t, names] of Object.entries(payload.links as Record<string, unknown>)) {
      const ts = slugify(String(t));
      if (!ts || !Array.isArray(names)) continue;
      const slugs = [...new Set(names.map((n) => slugify(String(n))).filter(Boolean))];
      if (slugs.length) links[ts] = slugs;
    }
  }
  // themes : liste plate de noms → slugs uniques.
  const themes: string[] = Array.isArray(payload.themes)
    ? [...new Set((payload.themes as unknown[]).map((n) => slugify(String(n))).filter(Boolean))]
    : [];

  // ---- Résolution des déclarations en slugs définitifs (confiance graduée §R11, D2) ----
  // Même logique que le dépôt : entité de même type existante → lien ; inconnue → créée
  // DIRECTEMENT (isNew), SANS passer par le sas des candidats.
  const reg = await loadRegistries();
  const sidecar: Sidecar = {
    links,
    entitiesGranularity: {},
    themes,
    themesGranularity: 'auto',
    origin,
    date: date || null,
  };
  const { declaredEntities, declaredThemes } = resolveDeclarations(sidecar, reg);
  const newTopics = [...new Set(declaredThemes.map((t) => t.slug))];
  const newEntities = [...new Set(declaredEntities.map((e) => e.slug))];
  const themeLabels: Record<string, string> = {};
  for (const t of declaredThemes) themeLabels[t.slug] = t.label;

  // ---- Construction du nouveau contenu canonique (pur) + nav régénérée (route) ----
  let newContent = buildEditedResourceContent(oldContent, {
    title,
    author,
    date,
    source_type,
    origin,
    url,
    topics: newTopics,
    entities: newEntities,
  });
  newContent = rebuildNav(newContent, author || null, date || null, newTopics, themeLabels);

  try {
    // PHASE A — retract de l'ANCIEN état (vues dérivées + graphe). Le filtre épargne le
    // fichier brut (raw immuable) ET la page canonique (jamais supprimée ici).
    const delViews = await readDeleteViews(oldMeta);
    if (delViews === null) {
      return Response.json(
        { error: 'Lecture des fichiers d’index du wiki impossible (graph/manifest/index).' },
        { status: 502 },
      );
    }
    const delOps = deleteResource({
      slug,
      resourceContent: oldContent,
      views: delViews,
      slugifyAuthor: slugify,
      typeLabel: wikiTypeLabel,
    }).filter(
      (op) => !op.path.startsWith('raw/') && op.path !== `wiki/resources/${slug}.md`,
    );
    await applyFileOps(delOps);

    // PHASE B — project du NOUVEL état sur le disque POST-retract (graphe/compteurs corrects).
    const { views: pViews } = await loadProjectViews(
      newContent,
      reg,
      today,
      declaredEntities,
      declaredThemes,
    );
    const projOps = projectResource({
      slug,
      resourceContent: newContent,
      views: pViews,
      slugifyAuthor: slugify,
      typeLabel: wikiTypeLabel,
      today,
    });
    await applyFileOps(projOps);

    // PHASE C — reconstruction INTÉGRALE des index dérivés (index.md + by-date).
    await applyFileOps(await rebuildDerivedIndexes(today));

    return Response.json({ ok: true, slug });
  } catch (e: any) {
    return Response.json(
      { error: `Écriture locale échouée : ${e?.message ?? 'inconnu'}` },
      { status: 500 },
    );
  }
}
