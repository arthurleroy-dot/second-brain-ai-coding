'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardType, Info, UploadCloud, X } from 'lucide-react';
import { ResourceType } from '@/types';
import { typeLabel } from '@/lib/ui';
import ProcessingStatus from './ProcessingStatus';

interface Props {
  onClose: () => void;
  onResolved?: (status: 'done' | 'error', title: string) => void;
}

type Mode = 'paste' | 'upload';

const ACCEPT_UPLOAD = '.pdf,.pptx,.docx';
const DEPOSITED_BY_KEY = 'wiki:deposited_by';

/** Types proposés en mode « coller » (docs textuels sans fichier source). */
const PASTE_TYPES: ResourceType[] = [
  'article',
  'meeting_note',
  'interview',
  'personal_note',
  'transcript',
];
/** Types proposés en mode « uploader un fichier » (PDF / PPTX / DOCX). */
const UPLOAD_TYPES: ResourceType[] = ['article', 'presentation', 'transcript', 'unknown'];

const TITLE_HINT =
  'Pour un article, le titre est détecté de façon fiable par l’analyse. En revanche, ' +
  'pour une présentation, un transcript, une note de réunion ou une interview, mieux ' +
  'vaut le saisir : l’IA ne peut pas deviner un titre précis.';

/** Slug minimal pour nommer le .md synthétique du mode coller.
 *  Le slug définitif est recalculé côté serveur à partir du titre final. */
function localSlug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function UploadModal({ onClose, onResolved }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>('paste');

  // Champs partagés entre les deux onglets.
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [date, setDate] = useState('');
  const [depositedBy, setDepositedBy] = useState('');
  const [type, setType] = useState<ResourceType>('article');

  // Spécifiques à chaque mode.
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  // Prénom du déposant mémorisé d'un dépôt à l'autre.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DEPOSITED_BY_KEY);
      if (saved) setDepositedBy(saved);
    } catch {
      /* localStorage indisponible : on ignore */
    }
  }, []);

  const switchMode = useCallback(
    (next: Mode) => {
      setMode(next);
      setError(null);
      // Réaligne le type sur la liste de l'onglet si l'actuel n'y figure pas.
      const allowed = next === 'paste' ? PASTE_TYPES : UPLOAD_TYPES;
      setType((cur) => (allowed.includes(cur) ? cur : allowed[0]));
    },
    [],
  );

  const pick = useCallback((f: File | null | undefined) => {
    if (f) setFile(f);
  }, []);

  const typeOptions = mode === 'paste' ? PASTE_TYPES : UPLOAD_TYPES;
  const displayName =
    mode === 'paste' ? title.trim() || 'Note collée' : file?.name ?? 'Ressource';

  const submit = async () => {
    setError(null);

    let payloadFile: File;
    if (mode === 'paste') {
      if (!text.trim()) {
        setError('Colle le contenu à enregistrer.');
        return;
      }
      const base = (title.trim() && localSlug(title)) || 'note';
      payloadFile = new File([text], `${base}.md`, { type: 'text/markdown' });
    } else {
      if (!file) {
        setError('Choisis un fichier à uploader.');
        return;
      }
      payloadFile = file;
    }

    setSubmitting(true);
    try {
      // Mémorise le déposant pour les prochains dépôts.
      try {
        if (depositedBy.trim())
          localStorage.setItem(DEPOSITED_BY_KEY, depositedBy.trim());
      } catch {
        /* ignore */
      }

      const form = new FormData();
      form.append('file', payloadFile);
      if (title.trim()) form.append('title', title.trim());
      if (author.trim()) form.append('author', author.trim());
      if (date.trim()) form.append('date', date.trim());
      if (depositedBy.trim()) form.append('deposited_by', depositedBy.trim());
      form.append('type', type);
      // URL : pertinente seulement pour un article collé (sans PDF).
      if (mode === 'paste' && type === 'article' && url.trim())
        form.append('url', url.trim());

      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Échec de l'upload");
        return;
      }
      setJobId(data.job_id);
    } catch {
      setError("Erreur réseau pendant l'upload.");
    } finally {
      setSubmitting(false);
    }
  };

  const authorLabel = type === 'meeting_note' ? 'Participants (optionnel)' : 'Auteur (optionnel)';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Déposer une ressource</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Fermer"
          >
            <X size={18} />
          </button>
        </div>

        {jobId ? (
          // ---- Vue traitement ----
          <div className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
              {displayName}
            </div>
            <ProcessingStatus
              jobId={jobId}
              onResolved={(status) => onResolved?.(status, displayName)}
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
              >
                Fermer
              </button>
            </div>
          </div>
        ) : (
          // ---- Vue formulaire ----
          <div className="space-y-4">
            {/* Onglets */}
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1">
              <button
                type="button"
                onClick={() => switchMode('paste')}
                className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${
                  mode === 'paste'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <ClipboardType size={15} />
                Coller le contenu
              </button>
              <button
                type="button"
                onClick={() => switchMode('upload')}
                className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${
                  mode === 'upload'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <UploadCloud size={15} />
                Uploader un fichier
              </button>
            </div>

            {/* Zone d'entrée selon l'onglet */}
            {mode === 'paste' ? (
              <label className="block text-xs text-gray-600">
                Contenu (Markdown, notes de réunion, interview…)
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={7}
                  placeholder="Colle ici le contenu de la ressource…"
                  className="mt-1 w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
            ) : (
              <div
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  pick(e.dataTransfer.files?.[0]);
                }}
                className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center ${
                  dragOver
                    ? 'border-[#0F6E56] bg-[#E1F5EE]'
                    : 'border-gray-300 bg-gray-50 hover:border-gray-400'
                }`}
              >
                <UploadCloud size={24} className="text-gray-400" />
                <div className="text-sm text-gray-700">
                  {file ? file.name : 'Glisse un fichier ou clique pour choisir'}
                </div>
                <div className="text-xs text-gray-400">PDF, PPTX, DOCX acceptés</div>
                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPT_UPLOAD}
                  className="hidden"
                  onChange={(e) => pick(e.target.files?.[0])}
                />
              </div>
            )}

            <div className="grid grid-cols-1 gap-3">
              <label className="text-xs text-gray-600">
                <span className="flex items-center gap-1">
                  Titre (optionnel)
                  <span className="group relative inline-flex items-center">
                    <Info size={13} className="text-gray-400" aria-hidden />
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute left-0 top-5 z-10 hidden w-60 rounded-md bg-gray-900 px-2.5 py-1.5 text-[11px] font-normal leading-snug text-white shadow-lg group-hover:block"
                    >
                      {TITLE_HINT}
                    </span>
                  </span>
                </span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Rempli automatiquement si laissé vide"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                />
                <span className="mt-1 block text-[11px] text-gray-400">
                  À renseigner si la ressource n'est pas un article.
                </span>
              </label>

              <label className="text-xs text-gray-600">
                Type
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as ResourceType)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                >
                  {typeOptions.map((t) => (
                    <option key={t} value={t}>
                      {typeLabel(t)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-gray-600">
                {authorLabel}
                <input
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                />
              </label>

              <label className="text-xs text-gray-600">
                Date (optionnel — YYYY, YYYY-MM ou YYYY-MM-DD)
                <input
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  placeholder="2026-06"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                />
              </label>

              {mode === 'paste' && type === 'article' && (
                <label className="text-xs text-gray-600">
                  URL de l'article (optionnel)
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://…"
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                  />
                  <span className="mt-1 block text-[11px] text-gray-400">
                    Lien vers l'article original sur le web. Laisse vide si tu ne l'as
                    pas — il ne sera jamais deviné automatiquement.
                  </span>
                </label>
              )}

              <label className="text-xs text-gray-600">
                Déposé par (optionnel)
                <input
                  value={depositedBy}
                  onChange={(e) => setDepositedBy(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                />
              </label>
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={submitting || (mode === 'paste' ? !text.trim() : !file)}
                className="rounded-lg bg-[#0F6E56] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0c5a47] disabled:opacity-50"
              >
                {submitting ? 'Dépôt…' : 'Déposer →'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
