import { listThemes } from '@/lib/wiki-parser';

export const dynamic = 'force-dynamic';

/**
 * Registre des thèmes (wiki/themes/*.md). Alimente le ThemePicker de l'upload
 * (thèmes existants proposés en autocomplétion) et le registre de la page
 * /themes. Miroir de /api/entities, sans la dimension `entity_type`.
 */
export async function GET() {
  const themes = await listThemes();
  return Response.json({ themes });
}
