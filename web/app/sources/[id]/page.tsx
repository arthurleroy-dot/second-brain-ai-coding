import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Download, FileText, Presentation } from 'lucide-react';
import {
  getSourceDetail,
  createRawFileSignedUrl,
} from '@/lib/wiki-query';
import { typeBadgeClass, typeLabel, formatDate } from '@/lib/ui';
import FullContentProse from '@/components/sources/FullContentProse';
import OriginalLinkButton from '@/components/sources/OriginalLinkButton';

export const dynamic = 'force-dynamic';

function fileExt(path: string | null): string {
  if (!path) return '';
  const i = path.lastIndexOf('.');
  return i === -1 ? '' : path.slice(i).toLowerCase();
}

/** Retire le préfixe uuid- ajouté à l'upload pour retrouver le nom d'origine. */
function originalName(path: string | null, fallback: string): string {
  if (!path) return fallback;
  return path.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '');
}

export default async function SourceDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const detail = await getSourceDetail(params.id);
  if (!detail) notFound();

  const { source, storage_path, content } = detail;
  const ext = fileExt(storage_path);
  const isPdf = Boolean(storage_path) && ext === '.pdf';
  const isPptx = Boolean(storage_path) && (ext === '.pptx' || ext === '.ppt');
  const hasFile = Boolean(storage_path);
  // Document binaire (fichier uploadé) vs article texte (collé / markdown).
  const isBinaryDoc = isPdf || isPptx || ext === '.docx';
  // « Voir l'original » uniquement pour les articles markdown/collés (pas les PDF).
  const isTextArticle = source.type === 'article' && !isBinaryDoc;

  const downloadName = originalName(storage_path, source.title);
  const viewUrl = hasFile ? await createRawFileSignedUrl(storage_path!) : null;
  const downloadUrl = hasFile
    ? await createRawFileSignedUrl(storage_path!, downloadName)
    : null;

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

      <div className="flex flex-1 overflow-hidden">
        {/* Colonne gauche — 60% : visualisation du fichier original */}
        <div className="relative w-[60%] overflow-hidden border-r border-gray-200 bg-gray-50">
          {isPdf && viewUrl ? (
            <>
              {downloadUrl && (
                <a
                  href={downloadUrl}
                  className="absolute right-4 top-4 z-10 flex items-center gap-1.5 rounded-lg bg-white/95 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 hover:bg-white"
                >
                  <Download size={14} /> Télécharger
                </a>
              )}
              <iframe
                src={viewUrl}
                title={source.title}
                className="h-full w-full border-0"
              />
            </>
          ) : isPptx ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
              <Presentation size={48} className="text-gray-300" />
              <p className="text-sm font-medium text-gray-600">
                Visualisation PPTX disponible prochainement
              </p>
              {downloadUrl && (
                <a
                  href={downloadUrl}
                  className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
                >
                  <Download size={15} /> Télécharger
                </a>
              )}
            </div>
          ) : content?.full_content ? (
            // Markdown / texte / article web : notes formatées proprement.
            // (Couvre aussi les .md/.txt/.docx uploadés, qui ont un storage_path
            //  mais dont on affiche le contenu retranscrit plutôt que le binaire.)
            <div className="relative h-full overflow-y-auto px-10 py-8">
              {hasFile && downloadUrl && (
                <a
                  href={downloadUrl}
                  className="absolute right-4 top-4 z-10 flex items-center gap-1.5 rounded-lg bg-white/95 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 hover:bg-white"
                >
                  <Download size={14} /> Télécharger
                </a>
              )}
              <article className="mx-auto max-w-2xl">
                <h1 className="mb-6 text-2xl font-semibold text-gray-900">
                  {source.title}
                </h1>
                <FullContentProse content={content.full_content} />
              </article>
            </div>
          ) : hasFile ? (
            // Binaire sans full_content ni viewer dédié — proposer le téléchargement.
            <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
              <FileText size={48} className="text-gray-300" />
              <p className="text-sm font-medium text-gray-600">
                Aperçu indisponible pour ce format
              </p>
              {downloadUrl && (
                <a
                  href={downloadUrl}
                  className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
                >
                  <Download size={15} /> Télécharger
                </a>
              )}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-8 text-center">
              <p className="text-sm text-gray-400">
                Aucun contenu à afficher pour cette ressource.
              </p>
            </div>
          )}
        </div>

        {/* Colonne droite — 40% : fiche structurée */}
        <div className="w-[40%] overflow-y-auto px-6 py-6">
          {/* « Voir l'original » : seulement pour un article markdown/collé.
              Lien si renseigné, sinon message d'erreur au clic. */}
          {isTextArticle && <OriginalLinkButton url={source.url} />}

          {/* Métadonnées */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`rounded px-2 py-0.5 font-medium ${typeBadgeClass(source.type)}`}
            >
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
                <span
                  key={t}
                  className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-gray-600"
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          <h1 className="mt-5 text-lg font-semibold leading-snug text-gray-900">
            {source.title}
          </h1>

          {/* Résumé */}
          {content?.summary && (
            <section className="mt-5">
              <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Résumé
              </h2>
              <p className="text-sm leading-relaxed text-gray-700">{content.summary}</p>
            </section>
          )}

          {/* Concepts clés */}
          {content && content.key_concepts.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Concepts clés
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {content.key_concepts.map((c, i) => (
                  <span
                    key={`${c}-${i}`}
                    className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Citations notables */}
          {content && content.notable_quotes.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Citations notables
              </h2>
              <div className="space-y-3">
                {content.notable_quotes.map((q, i) => (
                  <blockquote
                    key={i}
                    className="border-l-2 border-gray-200 pl-3 text-sm italic leading-relaxed text-gray-600"
                  >
                    «&nbsp;{q}&nbsp;»
                  </blockquote>
                ))}
              </div>
            </section>
          )}

          {/* Données et chiffres clés */}
          {content && content.key_figures.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Données et chiffres clés
              </h2>
              <ul className="space-y-1.5">
                {content.key_figures.map((f, i) => (
                  <li
                    key={i}
                    className="flex gap-2 text-sm leading-relaxed text-gray-700"
                  >
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray-400" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

        </div>
      </div>
    </div>
  );
}
