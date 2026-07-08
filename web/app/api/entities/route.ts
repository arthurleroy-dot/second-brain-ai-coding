import { listEntities } from '@/lib/wiki-parser';
import { entityTypeLabel } from '@/lib/ui';

export const dynamic = 'force-dynamic';

/**
 * Registre des entités, groupé par type. Alimente le formulaire d'upload :
 * les types de liens (outil, client, …) et les entités connues sont proposés
 * dynamiquement → le formulaire s'étend tout seul quand un nouveau type apparaît.
 */
export async function GET() {
  const entities = await listEntities();
  const typeSet = [...new Set(entities.map((e) => e.entity_type))].sort();
  const types = typeSet.map((slug) => ({ slug, label: entityTypeLabel(slug) }));
  return Response.json({ types, entities });
}
