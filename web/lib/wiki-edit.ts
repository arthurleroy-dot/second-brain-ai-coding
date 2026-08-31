/**
 * Cœur déterministe de l'ÉDITION d'une ressource — construction du NOUVEAU contenu
 * de la page canonique à partir de l'ancien + des métadonnées éditées.
 *
 * Fonctions PURES (aucune I/O) → testables sous `node:test` par chemin relatif.
 * Comme `wiki-mutate.ts` / `wiki-project.ts` : AUCUN import `@/…`, seulement des
 * imports relatifs purs (`./wiki-mutate` pour splitFrontmatter/withFrontmatter/
 * setScalar). La ligne de nav (`> Par … · Thèmes : …`) est régénérée PAR LA ROUTE
 * (via `rebuildNav` d'ingest-local, qui dépend de `slugify`) — pas ici, pour
 * garder ce module libre de toute dépendance à `@/`.
 *
 * Le reste des vues (thèmes, entités, auteur, origine, by-date, graphe, index) est
 * reconstruit par les moteurs existants (`deleteResource` puis `projectResource`) :
 * ce module ne fabrique QUE la page ressource éditée, source canonique dont tout dérive.
 */
import { splitFrontmatter, withFrontmatter, setScalar } from './wiki-mutate';

/** Échappe une chaîne pour l'insérer dans une RegExp (identique à wiki-mutate). */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Remplace (ou crée) la ligne `key: [a, b, c]` du frontmatter par la liste COMPLÈTE
 * fournie — contrairement à `patchInlineArray` (wiki-mutate) qui ne fait qu'AJOUTER.
 * Format inline sans guillemets : `key: [a, b]`, ou `key: []` si vide. Si la clé est
 * absente et vaut `entities`, elle est insérée juste après la ligne `topics:` (comme
 * `patchInlineArray`) ; sinon en fin de frontmatter.
 */
export function setInlineArray(fm: string, key: string, slugs: string[]): string {
  const rendered = `${key}: [${slugs.join(', ')}]`;
  const lines = fm.split('\n');
  const re = new RegExp(`^(${escapeRe(key)}):\\s*\\[(.*)\\]\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      lines[i] = rendered;
      return lines.join('\n');
    }
  }
  // Clé absente : insérer. Pour `entities`, juste après `topics:` (miroir patchInlineArray).
  if (key === 'entities') {
    for (let i = 0; i < lines.length; i++) {
      if (/^topics:/.test(lines[i])) {
        lines.splice(i + 1, 0, rendered);
        return lines.join('\n');
      }
    }
  }
  lines.push(rendered);
  return lines.join('\n');
}

/**
 * Réconcilie les annotations de SECTION du corps (`` `topics: [ … ]` `` /
 * `` `entities: [ … ]` ``) avec les ensembles cibles : pour chaque ligne
 * d'annotation, on ne garde que les slugs présents dans l'ensemble correspondant.
 * Ligne vidée → `` `topics: []` `` / `` `entities: []` ``. Indentation préservée.
 * AUCUNE autre ligne n'est touchée (le verbatim reste intact — ces annotations sont
 * des repères structurels autorisés, règle cardinale 6).
 *
 * OBLIGATOIRE avant projection : `parseResourceMeta` calcule `meta.entities` =
 * frontmatter ∪ annotations de section. Une entité retirée du frontmatter mais laissée
 * dans une annotation serait RÉ-AJOUTÉE par `projectResource`. On réconcilie donc les
 * entités (et les topics, par cohérence).
 */
export function reconcileChunkAnnotations(
  body: string,
  keepTopics: Set<string>,
  keepEntities: Set<string>,
): string {
  const reTopics = /^`topics:\s*\[(.*)\]`$/;
  const reEntities = /^`entities:\s*\[(.*)\]`$/;
  return body
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      const indent = line.slice(0, line.length - trimmed.length);
      const mt = trimmed.match(reTopics);
      if (mt) {
        const kept = splitInner(mt[1]).filter((x) => keepTopics.has(x));
        return `${indent}\`topics: [${kept.join(', ')}]\``;
      }
      const me = trimmed.match(reEntities);
      if (me) {
        const kept = splitInner(me[1]).filter((x) => keepEntities.has(x));
        return `${indent}\`entities: [${kept.join(', ')}]\``;
      }
      return line;
    })
    .join('\n');
}

/** Découpe l'intérieur d'un `[a, b]` en slugs (vide → []). */
function splitInner(inner: string): string[] {
  const t = inner.trim();
  return t ? t.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

export interface EditedResourceMeta {
  title: string;
  author: string;
  date: string;
  source_type: string;
  origin: string;
  url: string;
  topics: string[];
  entities: string[];
}

/**
 * Assemble le NOUVEAU contenu de la page ressource à partir de l'ancien :
 *  1. scalaires du frontmatter mis à jour (`title/author/date/source_type/origin/url`) ;
 *     `slug` et `source_file` NE SONT JAMAIS touchés (identité gelée, règles 5 & 9).
 *  2. tableaux inline `topics:`/`entities:` remplacés par les listes complètes ;
 *  3. annotations de section réconciliées avec les nouveaux ensembles.
 *
 * La ligne de nav n'est PAS régénérée ici (voir en-tête) : l'appelant appelle
 * `rebuildNav` juste après. Les scalaires chaîne sont écrits QUOTÉS (JSON.stringify),
 * `source_type`/`origin` NON quotés (convention frontmatter). `setScalar` est un no-op
 * si la clé manque — dans un frontmatter d'ingestion, ces clés existent toujours.
 */
export function buildEditedResourceContent(oldContent: string, next: EditedResourceMeta): string {
  const { fm, rest } = splitFrontmatter(oldContent);
  let nf = fm;
  nf = setScalar(nf, 'title', JSON.stringify(next.title));
  nf = setScalar(nf, 'author', JSON.stringify(next.author));
  nf = setScalar(nf, 'date', JSON.stringify(next.date));
  nf = setScalar(nf, 'source_type', next.source_type);
  nf = setScalar(nf, 'origin', next.origin);
  nf = setScalar(nf, 'url', JSON.stringify(next.url));
  nf = setInlineArray(nf, 'topics', next.topics);
  nf = setInlineArray(nf, 'entities', next.entities);

  const bodyReconciled = reconcileChunkAnnotations(rest, new Set(next.topics), new Set(next.entities));
  return withFrontmatter(nf, bodyReconciled);
}
