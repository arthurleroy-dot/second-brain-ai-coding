import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getTheme } from '@/lib/wiki-parser';
import { listSources } from '@/lib/wiki-query';
import { derivedPageForDisplay } from '@/lib/wiki-md';
import { typeBadgeClass, typeLabel, formatDate } from '@/lib/ui';
import FullContentProse from '@/components/sources/FullContentProse';
import AliasLine from '@/components/wiki/AliasLine';

export const dynamic = 'force-dynamic';

export default async function TopicPage({
  params,
}: {
  params: { slug: string };
}) {
  const data = await getTheme(params.slug);
  if (!data) notFound();

  const { theme, body } = data;
  const title = theme.label;
  const display = derivedPageForDisplay(body);

  // Ressources liées : lues depuis les fichiers markdown (resources/).
  const allSources = await listSources();
  const resources = allSources.filter((s) => s.topics.includes(params.slug));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl p-6">
        <Link
          href="/wiki"
          className="mb-4 inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600"
        >
          <ArrowLeft size={13} /> Tous les thèmes
        </Link>

        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-sm text-gray-400">{resources.length} ressource(s)</p>
            <AliasLine label={theme.label} aliases={theme.aliases} />
          </div>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white p-6">
          <FullContentProse content={display} />
        </div>

        {resources.length > 0 && (
          <section className="mt-6 rounded-xl border border-gray-100 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
              Sources ({resources.length})
            </h2>
            <div className="flex flex-col">
              {resources.map((r) => (
                <Link
                  key={r.slug}
                  href={`/sources/${r.slug}`}
                  className="flex items-center gap-3 border-b border-gray-50 py-2 last:border-0 hover:bg-gray-50"
                >
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeBadgeClass(
                      r.type,
                    )}`}
                  >
                    {typeLabel(r.type)}
                  </span>
                  <span className="flex-1 text-sm text-gray-800">{r.title}</span>
                  <span className="whitespace-nowrap text-xs text-gray-400">
                    {r.author || 'auteur inconnu'} · {formatDate(r.date)}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
