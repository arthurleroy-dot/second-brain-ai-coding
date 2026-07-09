import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getEntity } from '@/lib/wiki-parser';
import { entityTypeLabel } from '@/lib/ui';
import { derivedPageForDisplay } from '@/lib/wiki-md';
import FullContentProse from '@/components/sources/FullContentProse';

export const dynamic = 'force-dynamic';

export default async function EntityDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  const data = await getEntity(params.slug);
  if (!data) notFound();

  const { entity, body } = data;
  const display = derivedPageForDisplay(body);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {/* En-tête */}
      <div className="flex items-center gap-3 border-b border-gray-200 px-6 py-3">
        <Link
          href="/entities"
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"
        >
          <ArrowLeft size={16} /> Entités
        </Link>
        <span className="truncate text-sm font-medium text-gray-900">{entity.label}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-10 py-8">
        <article className="mx-auto max-w-3xl">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 font-medium text-indigo-700">
              {entityTypeLabel(entity.entity_type)}
            </span>
            {entity.aliases.length > 0 && (
              <span className="text-gray-500">
                alias : {entity.aliases.join(', ')}
              </span>
            )}
          </div>

          <h1 className="mb-6 mt-4 text-2xl font-semibold text-gray-900">{entity.label}</h1>

          {display ? (
            <FullContentProse content={display} />
          ) : (
            <p className="text-sm text-gray-400">Aucune mention enregistrée pour le moment.</p>
          )}
        </article>
      </div>
    </div>
  );
}
