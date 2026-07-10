import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Download } from 'lucide-react';
import { getSourceDetail } from '@/lib/wiki-query';
import { resourceBodyForDisplay } from '@/lib/wiki-md';
import { typeBadgeClass, typeLabel, formatDate } from '@/lib/ui';
import FullContentProse from '@/components/sources/FullContentProse';
import OriginalLinkButton from '@/components/sources/OriginalLinkButton';

export const dynamic = 'force-dynamic';

function rawUrl(file: string, download = false): string {
  return `/api/raw/${encodeURIComponent(file)}${download ? '?download=1' : ''}`;
}

export default async function SourceDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const detail = await getSourceDetail(params.id);
  if (!detail) notFound();

  const { source, body, rawFile, isPdf } = detail;
  const display = resourceBodyForDisplay(body);
  const viewUrl = isPdf && rawFile ? rawUrl(rawFile) : null;
  const downloadUrl = isPdf && rawFile ? rawUrl(rawFile, true) : null;
  // « Voir l'original » : uniquement pour un article/texte (pas de PDF embarqué).
  const isTextArticle = !isPdf;

  const Meta = (
    <>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded px-2 py-0.5 font-medium ${typeBadgeClass(source.type)}`}>
          {typeLabel(source.type)}
        </span>
        <span className="text-gray-500">{source.author ?? 'auteur inconnu'}</span>
        <span className="text-gray-300">·</span>
        <span className="text-gray-500">{formatDate(source.date)}</span>
        {source.deposited_by && (
          <>
            <span className="text-gray-300">·</span>
            <span className="text-gray-500">déposé par {source.deposited_by}</span>
          </>
        )}
      </div>

      {source.topics.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {source.topics.map((t) => (
            <Link
              key={t}
              href={`/wiki/${t}`}
              className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-gray-600 hover:bg-gray-200"
            >
              {t}
            </Link>
          ))}
        </div>
      )}

      {source.entities && source.entities.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {source.entities.map((e) => (
            <Link
              key={e}
              href={`/sources?entity=${encodeURIComponent(e)}`}
              className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100"
            >
              #{e}
            </Link>
          ))}
        </div>
      )}
    </>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {/* En-tête */}
      <div className="flex items-center gap-3 border-b border-gray-200 px-6 py-3">
        <Link
          href="/sources"
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"
        >
          <ArrowLeft size={16} /> Sources
        </Link>
        <span className="truncate text-sm font-medium text-gray-900">{source.title}</span>
      </div>

      {isPdf ? (
        // PDF : visualiseur à gauche, contenu paraphrasé + métadonnées à droite.
        <div className="flex flex-1 overflow-hidden">
          <div className="relative w-[60%] overflow-hidden border-r border-gray-200 bg-gray-50">
            {downloadUrl && (
              <a
                href={downloadUrl}
                className="absolute right-4 top-4 z-10 flex items-center gap-1.5 rounded-lg bg-white/95 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 hover:bg-white"
              >
                <Download size={14} /> Télécharger
              </a>
            )}
            {viewUrl && (
              <iframe src={viewUrl} title={source.title} className="h-full w-full border-0" />
            )}
          </div>
          <div className="w-[40%] overflow-y-auto px-6 py-6">
            {Meta}
            <h1 className="mt-5 text-lg font-semibold leading-snug text-gray-900">
              {source.title}
            </h1>
            {display && (
              <div className="mt-5">
                <FullContentProse content={display} />
              </div>
            )}
          </div>
        </div>
      ) : (
        // Article/texte : une seule colonne lisible.
        <div className="flex-1 overflow-y-auto px-10 py-8">
          <article className="mx-auto max-w-3xl">
            {isTextArticle && <OriginalLinkButton url={source.url} />}
            <div className="mt-4">{Meta}</div>
            <h1 className="mb-6 mt-5 text-2xl font-semibold text-gray-900">{source.title}</h1>
            <FullContentProse content={display} />
          </article>
        </div>
      )}
    </div>
  );
}
