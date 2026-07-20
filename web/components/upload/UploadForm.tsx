'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardType, Info, UploadCloud } from 'lucide-react';
import { ResourceType } from '@/types';
import { typeLabel } from '@/lib/ui';
import IngestStatus from './IngestStatus';
import LinkPicker, { LinksValue, Gran } from './LinkPicker';
import ThemePicker from './ThemePicker';

type Mode = 'paste' | 'upload';

const ACCEPT_UPLOAD = '.pdf,.pptx,.docx,.txt,.md';
const DEPOSITED_BY_KEY = 'wiki:deposited_by';

/** Types proposés en mode « coller » (docs textuels sans fichier source). */
const PASTE_TYPES: ResourceType[] = [
  'article',
  'meeting_note',
  'interview',
  'personal_note',
  'transcript',
];
/** Types proposés en mode « uploader un fichier » (PDF / PPTX / DOCX / TXT / MD). */
const UPLOAD_TYPES: ResourceType[] = [
  'report_pdf',
  'article',
  'presentation',
  'transcript',
  'meeting_note',
  'interview',
  'personal_note',
  'unknown',
];

const TITLE_HINT =
  'Pour un article, le titre est détecté de façon fiable par l’analyse. En revanche, ' +
  'pour une présentation, un transcript, une note de réunion ou une interview, mieux ' +
  'vaut le saisir : l’IA ne peut pas deviner un titre précis.';

/** Slug minimal pour nommer le .txt synthétique du mode coller.
 *  Le slug définitif est recalculé côté serveur à partir du titre final. */
function localSlug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Formulaire de dépôt d'une ressource, rendu en pleine page (cf. /upload).
 * Reprend la logique de l'ancienne modale sans l'habillage overlay : deux modes
 * (coller un texte / uploader un fichier), métadonnées, liens typés et thèmes,
 * POST multipart vers /api/upload, puis suivi d'ingestion via IngestStatus.
 */
export default function UploadForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>('paste');

  // Champs partagés entre les deux onglets.
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [date, setDate] = useState('');
  const [depositedBy, setDepositedBy] = useState('');
  const [type, setType] = useState<ResourceType>('article');
  // Origine : '' = Auto (l'agent d'ingestion déduit du type), sinon forcée.
  const [origin, setOrigin] = useState<'' | 'interne' | 'externe'>('');

  // Liens typés (optionnel) — { type d'entité → noms }, cf. docs/entities.md.
  const [links, setLinks] = useState<LinksValue>({});
  // Granularité déclarée PAR type de lien (indice pour l'agent, cf. docs/entities.md §3).
  const [linkGranularity, setLinkGranularity] = useState<Record<string, Gran>>({});
  const hasLinks = Object.values(links).some((names) => names.length > 0);

  // Thèmes déclarés (optionnel) — liste plate de noms, cf. docs/entities.md.
  const [themes, setThemes] = useState<string[]>([]);
  const [themesGranularity, setThemesGranularity] =
    useState<'auto' | 'resource' | 'chunk'>('auto');
  const hasThemes = themes.length > 0;

  // Spécifiques à chaque mode.
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedFile, setSubmittedFile] = useState<string | null>(null);

  // Prénom du déposant mémorisé d'un dépôt à l'autre.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DEPOSITED_BY_KEY);
      if (saved) setDepositedBy(saved);
    } catch {
      /* localStorage indisponible : on ignore */
    }
  }, []);

  const switchMode = useCallback((next: Mode) => {
    setMode(next);
    setError(null);
    // Réaligne le type sur la liste de l'onglet si l'actuel n'y figure pas.
    const allowed = next === 'paste' ? PASTE_TYPES : UPLOAD_TYPES;
    setType((cur) => (allowed.includes(cur) ? cur : allowed[0]));
  }, []);

  const pick = useCallback((f: File | null | undefined) => {
    if (f) setFile(f);
  }, []);

  const typeOptions = mode === 'paste' ? PASTE_TYPES : UPLOAD_TYPES;
  const displayName =
    mode === 'paste' ? title.trim() || 'Note collée' : file?.name ?? 'Ressource';

  // Réinitialise le formulaire pour un nouveau dépôt (garde le déposant mémorisé).
  const reset = () => {
    setMode('paste');
    setTitle('');
    setAuthor('');
    setDate('');
    setType('article');
    setOrigin('');
    setLinks({});
    setLinkGranularity({});
    setThemes([]);
    setThemesGranularity('auto');
    setText('');
    setUrl('');
    setFile(null);
    setError(null);
    setSubmittedFile(null);
  };

  const submit = async () => {
    setError(null);

    let payloadFile: File;
    if (mode === 'paste') {
      if (!text.trim()) {
        setError('Colle le contenu à enregistrer.');
        return;
      }
      const base = (title.trim() && localSlug(title)) || 'note';
      // Texte brut : stocké en .txt (l'agent d'ingestion le normalise en markdown).
      // Convention : .txt = brut à mettre en forme, .md = markdown déjà structuré.
      payloadFile = new File([text], `${base}.txt`, { type: 'text/plain' });
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
      // Origine : envoyée seulement si forcée par l'utilisateur (sinon Auto → l'agent déduit).
      if (origin) form.append('origin', origin);
      // URL : pertinente seulement pour un article collé (sans PDF).
      if (mode === 'paste' && type === 'article' && url.trim())
        form.append('url', url.trim());
      if (hasLinks) {
        // Ne garde que les types réellement renseignés + leur granularité par type.
        const clean: LinksValue = {};
        const gran: Record<string, Gran> = {};
        for (const [t, names] of Object.entries(links))
          if (names.length) {
            clean[t] = names;
            gran[t] = linkGranularity[t] ?? 'auto';
          }
        form.append('links', JSON.stringify(clean));
        form.append('entities_granularity', JSON.stringify(gran));
      }
      if (hasThemes) {
        form.append('themes', JSON.stringify(themes));
        form.append('themes_granularity', themesGranularity);
      }

      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Échec de l'upload");
        return;
      }
      setSubmittedFile(data.file);
    } catch {
      setError("Erreur réseau pendant l'upload.");
    } finally {
      setSubmitting(false);
    }
  };

  const authorLabel = type === 'meeting_note' ? 'Participants (optionnel)' : 'Auteur (optionnel)';

  // ---- Vue ingestion (après un dépôt réussi) ----
  if (submittedFile) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          {displayName}
        </div>
        <IngestStatus file={submittedFile} />
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
        >
          Déposer un autre document
        </button>
      </div>
    );
  }

  // ---- Vue formulaire ----
  return (
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
          Contenu — colle du texte brut (notes, transcript, article…), l’IA le met en forme
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            placeholder="Colle ton texte, pas besoin de markdown…"
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
          <div className="text-xs text-gray-400">PDF, PPTX, DOCX, TXT, MD acceptés</div>
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
          Origine
          <select
            value={origin}
            onChange={(e) => setOrigin(e.target.value as '' | 'interne' | 'externe')}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          >
            <option value="">Auto (déduite à l'ingestion)</option>
            <option value="externe">Externe (source tierce publique)</option>
            <option value="interne">Interne (note / transcript interne)</option>
          </select>
          <span className="mt-1 block text-[11px] text-gray-400">
            Laisse « Auto » pour que l'agent déduise l'origine du type de ressource.
          </span>
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

        <LinkPicker
          value={links}
          onChange={setLinks}
          granularity={linkGranularity}
          onGranularityChange={setLinkGranularity}
        />

        <ThemePicker value={themes} onChange={setThemes} />

        {hasThemes && (
          <label className="text-xs text-gray-600">
            Granularité des thèmes
            <select
              value={themesGranularity}
              onChange={(e) =>
                setThemesGranularity(e.target.value as 'auto' | 'resource' | 'chunk')
              }
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            >
              <option value="auto">Auto (l'agent décide)</option>
              <option value="resource">Ressource entière</option>
              <option value="chunk">Sections concernées</option>
            </select>
            <span className="mt-1 block text-[11px] text-gray-400">
              Indice transmis à l'agent : « ressource » = thème central/transverse,
              « sections » = thème localisé. L'agent choisit les sections exactes.
            </span>
          </label>
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex justify-end">
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
  );
}
