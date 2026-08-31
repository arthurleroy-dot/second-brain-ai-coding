import { notFound } from 'next/navigation';
import { getResource, listEntities } from '@/lib/wiki-parser';
import EditForm from '@/components/sources/EditForm';

export const dynamic = 'force-dynamic';

/**
 * Écran d'édition des métadonnées d'une ressource existante. Server component :
 * pré-remplit le formulaire depuis le frontmatter canonique (`getResource`), en
 * regroupant les entités à plat (`entities: [a, b]`) par leur `entity_type` (jointure
 * sur le registre d'entités) pour alimenter `LinkPicker` (qui attend un
 * `Record<entity_type, string[]>`). Le segment dynamique s'appelle `[id]` mais reçoit
 * le SLUG. L'édition ne rappelle jamais l'IA (cf. PATCH /api/sources/[slug]).
 */
export default async function EditSourcePage({
  params,
}: {
  params: { id: string };
}) {
  const parsed = await getResource(params.id);
  if (!parsed) notFound();
  const { source } = parsed;

  // Regroupe les slugs d'entités à plat par leur entity_type (jointure sur le registre).
  const registry = await listEntities();
  const typeBySlug = new Map(registry.map((e) => [e.slug, e.entity_type]));
  const initialLinks: Record<string, string[]> = {};
  for (const eslug of source.entities ?? []) {
    const etype = typeBySlug.get(eslug);
    if (!etype) {
      // Ne doit pas arriver : toute entité liée a une page (donc un type). On l'ignore.
      console.warn(`[modifier] entité liée « ${eslug} » absente du registre — ignorée du pré-remplissage`);
      continue;
    }
    (initialLinks[etype] ??= []).push(eslug);
  }

  return (
    <EditForm
      slug={source.slug}
      initial={{
        title: source.title ?? '',
        author: source.author ?? '',
        date: source.date ?? '',
        // `source.type` = slug du source_type (jamais null ; `unknown` en repli).
        type: source.type,
        // En édition, l'origine est concrète (pas d'« Auto ») ; repli externe si absente.
        origin: source.origin ?? 'externe',
        url: source.url ?? '',
        links: initialLinks,
        themes: source.topics ?? [],
      }}
    />
  );
}
