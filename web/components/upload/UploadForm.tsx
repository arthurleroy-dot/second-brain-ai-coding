'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ClipboardType, Info, UploadCloud } from 'lucide-react';
import { OriginValue, ResourceType } from '@/types';
import { clear, getView, seedFromServer, startTracking, subscribe } from '@/lib/ingest-view-store';
import IngestStatus from './IngestStatus';
import LinkPicker, { LinksValue, Gran, LinkPickerHandle } from './LinkPicker';
import ThemePicker, { ThemePickerHandle } from './ThemePicker';
import ManageTypesModal from './ManageTypesModal';

type Mode = 'paste' | 'upload';
type TypeOpt = { slug: string; label: string };

const ACCEPT_UPLOAD = '.pdf,.pptx,.docx,.txt,.md';
const DEPOSITED_BY_KEY = 'wiki:deposited_by';
const NEW_TYPE = '__new__'; // valeur sentinelle de l'option « + Nouveau type… »
const AUTO_TYPE = ''; // '' = Auto (l'IA déduit le type du contenu) — miroir du champ Origine Auto

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
  // Type : démarre sur Auto ('') — l'IA déduit le type du contenu (repli déterministe
  // `unknown`). Miroir du champ Origine « Auto ». Plus de défaut concret trompeur.
  const [type, setType] = useState<ResourceType>(AUTO_TYPE);
  // Origine : '' = Auto (le moteur déterministe la dérive du type), sinon forcée.
  const [origin, setOrigin] = useState<'' | 'interne' | 'externe'>('');

  // Registre des types de document (menu unique alimenté par /api/types). La
  // création se fait inline via l'option sentinelle « + Nouveau type… » ; la
  // suppression via ManageTypesModal (lien « Gérer les types »).
  const [types, setTypes] = useState<TypeOpt[]>([]);
  const [creating, setCreating] = useState(false); // ligne de création inline ouverte
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypeOrigin, setNewTypeOrigin] = useState<OriginValue>('externe'); // origine du type créé
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [managing, setManaging] = useState(false); // modale « Gérer les types » ouverte

  // Recharge le registre ET réconcilie le type sélectionné : si le type courant a
  // disparu (supprimé via la modale), on retombe sur le premier du menu.
  const loadTypes = useCallback(() => {
    fetch('/api/types')
      .then((r) => r.json())
      .then((d) => {
        const list: TypeOpt[] = (d.types ?? []).map((t: { slug: string; label: string }) => ({
          slug: t.slug,
          label: t.label,
        }));
        setTypes(list);
        // Auto ('') doit survivre à un rechargement du registre ; sinon on garde le type
        // courant s'il existe encore, à défaut on retombe sur Auto (jamais list[0]).
        setType((cur) => (cur === AUTO_TYPE || list.some((t) => t.slug === cur) ? cur : AUTO_TYPE));
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadTypes();
  }, [loadTypes]);

  // Liens typés (optionnel) — { type d'entité → noms }, cf. docs/entities.md.
  const [links, setLinks] = useState<LinksValue>({});
  // Granularité déclarée PAR type de lien (indice pour l'agent, cf. docs/entities.md §3).
  const [linkGranularity, setLinkGranularity] = useState<Record<string, Gran>>({});

  // Thèmes déclarés (optionnel) — liste plate de noms, cf. docs/entities.md.
  const [themes, setThemes] = useState<string[]>([]);
  const [themesGranularity, setThemesGranularity] =
    useState<'auto' | 'resource' | 'chunk'>('auto');

  // Poignées des pickers : au submit, `flush()` ramasse les brouillons tapés mais
  // non validés (`+`/Entrée) et retourne la valeur fusionnée — cf. submit().
  const linkRef = useRef<LinkPickerHandle>(null);
  const themeRef = useRef<ThemePickerHandle>(null);

  // Spécifiques à chaque mode.
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Suivi d'ingestion : vit dans un store module-level (survit à la navigation ET
  // au rechargement complet de l'app). `null` = rien à suivre → on montre le formulaire.
  const ingest = useSyncExternalStore(subscribe, getView, () => null);

  // Au montage : si le store est vide, tenter d'adopter un run serveur RÉELLEMENT
  // en cours (reprise après navigation ou rechargement complet).
  useEffect(() => {
    seedFromServer();
  }, []);

  // Prénom du déposant mémorisé d'un dépôt à l'autre.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DEPOSITED_BY_KEY);
      if (saved) setDepositedBy(saved);
    } catch {
      /* localStorage indisponible : on ignore */
    }
  }, []);

  // Menu de type unique dans les deux onglets (fin de la distinction paste/upload) :
  // un type créé n'a pas de mode. On garde seulement setMode + reset d'erreur.
  const switchMode = useCallback((next: Mode) => {
    setMode(next);
    setError(null);
  }, []);

  const pick = useCallback((f: File | null | undefined) => {
    if (f) setFile(f);
  }, []);

  // Crée un type via POST /api/types { name }. Succès → recharge, sélectionne, referme.
  // 409 (existe déjà) → message + si le slug figure déjà au menu, on le sélectionne quand même.
  const createType = useCallback(async () => {
    const name = newTypeName.trim();
    if (!name) return;
    setCreatingBusy(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/types', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, origin: newTypeOrigin }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCreateError(d.error ?? 'Création impossible');
        // Le slug déterministe du nom (localSlug == slugify serveur) : s'il est déjà
        // au menu, on le sélectionne et on referme (le type existe, but c'est le voulu).
        const existing = localSlug(name);
        if (types.some((t) => t.slug === existing)) {
          setType(existing as ResourceType);
          setCreating(false);
          setNewTypeName('');
        }
        return;
      }
      loadTypes();
      setType(d.slug as ResourceType);
      setCreating(false);
      setNewTypeName('');
      setNewTypeOrigin('externe');
    } catch {
      setCreateError('Erreur réseau');
    } finally {
      setCreatingBusy(false);
    }
  }, [newTypeName, newTypeOrigin, types, loadTypes]);

  // Réinitialise le formulaire pour un nouveau dépôt (garde le déposant mémorisé).
  const reset = () => {
    setMode('paste');
    setTitle('');
    setAuthor('');
    setDate('');
    // Type par défaut : Auto ('') — l'IA déduit (miroir de l'origine Auto). Plus de
    // défaut concret trompeur.
    setType(AUTO_TYPE);
    setOrigin('');
    setLinks({});
    setLinkGranularity({});
    setThemes([]);
    setThemesGranularity('auto');
    setText('');
    setUrl('');
    setFile(null);
    setError(null);
    setCreating(false);
    setNewTypeName('');
    setNewTypeOrigin('externe');
    setCreateError(null);
    clear();
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

      // Ramasse les brouillons tapés-non-validés des pickers AVANT de bâtir le
      // FormData. `flush()` retourne SYNCHRONEMENT la valeur fusionnée : on bâtit
      // dessus, jamais sur l'état `links`/`themes` (pas encore re-rendu à ce tick).
      const mergedLinks = linkRef.current?.flush() ?? links;
      const mergedThemes = themeRef.current?.flush() ?? themes;

      const form = new FormData();
      form.append('file', payloadFile);
      if (title.trim()) form.append('title', title.trim());
      if (author.trim()) form.append('author', author.trim());
      if (date.trim()) form.append('date', date.trim());
      if (depositedBy.trim()) form.append('deposited_by', depositedBy.trim());
      // Type envoyé SEULEMENT si un vrai type est choisi ; Auto ('') → pas de champ →
      // l'IA déduit le type du contenu (repli déterministe `unknown`).
      if (type) form.append('type', type);
      // Origine : envoyée seulement si forcée par l'utilisateur (sinon Auto → l'agent déduit).
      if (origin) form.append('origin', origin);
      // URL : pertinente seulement pour un article collé (sans PDF).
      if (mode === 'paste' && type === 'article' && url.trim())
        form.append('url', url.trim());
      const anyLinks = Object.values(mergedLinks).some((names) => names.length > 0);
      if (anyLinks) {
        // Ne garde que les types réellement renseignés + leur granularité par type.
        const clean: LinksValue = {};
        const gran: Record<string, Gran> = {};
        for (const [t, names] of Object.entries(mergedLinks))
          if (names.length) {
            clean[t] = names;
            gran[t] = linkGranularity[t] ?? 'auto';
          }
        form.append('links', JSON.stringify(clean));
        form.append('entities_granularity', JSON.stringify(gran));
      }
      const anyThemes = mergedThemes.length > 0;
      if (anyThemes) {
        form.append('themes', JSON.stringify(mergedThemes));
        form.append('themes_granularity', themesGranularity);
      }

      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Échec de l'upload");
        return;
      }
      startTracking(data.file);
    } catch {
      setError("Erreur réseau pendant l'upload.");
    } finally {
      setSubmitting(false);
    }
  };

  const authorLabel = type === 'meeting-notes' ? 'Participants (optionnel)' : 'Auteur (optionnel)';

  // ---- Vue ingestion (après un dépôt réussi, ou reprise d'un run en cours) ----
  if (ingest) {
    // Nom affiché : les champs du formulaire s'ils sont encore là (dépôt de la même
    // session), sinon le nom du fichier suivi (reprise après rechargement complet,
    // où le formulaire est reparti vierge).
    const trackedName = file?.name?.trim() || title.trim() || ingest.file || 'Ressource';
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          {trackedName}
        </div>
        <IngestStatus
          state={ingest.state}
          slug={ingest.slug}
          cost={ingest.cost}
          error={ingest.error}
          steps={ingest.steps}
        />
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

        {/* Champ Type en <div> (PAS <label>) : un <label> renvoie tout clic vers son
            premier contrôle labelable — ici le bouton « Gérer les types » — donc cliquer
            « Annuler »/le menu ouvrait la modale par erreur. Caption = <label htmlFor>. */}
        <div className="text-xs text-gray-600">
          <span className="flex items-center justify-between">
            <label htmlFor="type-select">Type</label>
            <button
              type="button"
              onClick={() => setManaging(true)}
              className="text-[11px] font-normal text-gray-400 underline hover:text-gray-600"
            >
              Gérer les types
            </button>
          </span>
          <select
            id="type-select"
            value={type}
            onChange={(e) => {
              const v = e.target.value;
              if (v === NEW_TYPE) {
                // Ouvre la ligne de création inline SANS changer le type courant.
                setCreating(true);
                setNewTypeName('');
                setNewTypeOrigin('externe');
                setCreateError(null);
              } else {
                setType(v as ResourceType);
              }
            }}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          >
            <option value={AUTO_TYPE}>Auto (déduit par l'IA)</option>
            {types.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.label}
              </option>
            ))}
            <option value={NEW_TYPE}>+ Nouveau type…</option>
          </select>
          <span className="mt-1 block text-[11px] text-gray-400">
            Laisse « Auto » pour que l'IA déduise le type d'après le contenu.
          </span>

          {creating && (
            <div className="mt-2 flex items-center gap-2">
              <input
                autoFocus
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    createType();
                  }
                }}
                placeholder="Nom du nouveau type (ex. Podcast)"
                className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              />
              {/* Origine par défaut du type créé (BINAIRE). Défaut « Externe » ; pilote
                  l'origine des futurs dépôts de ce type (modifiable ensuite via Gérer). */}
              <select
                value={newTypeOrigin}
                onChange={(e) => setNewTypeOrigin(e.target.value as OriginValue)}
                aria-label="Origine par défaut du nouveau type"
                className="shrink-0 rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
              >
                <option value="externe">Externe</option>
                <option value="interne">Interne</option>
              </select>
              <button
                type="button"
                onClick={createType}
                disabled={!newTypeName.trim() || creatingBusy}
                className="rounded-lg bg-[#0F6E56] px-2.5 py-1.5 text-xs font-medium text-white hover:bg-[#0c5a47] disabled:opacity-50"
              >
                {creatingBusy ? '…' : 'Créer'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setCreateError(null);
                  setNewTypeName('');
                  setNewTypeOrigin('externe');
                }}
                className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                Annuler
              </button>
            </div>
          )}
          {createError && (
            <span className="mt-1 block text-[11px] text-red-600">{createError}</span>
          )}
        </div>

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
          ref={linkRef}
          value={links}
          onChange={setLinks}
          granularity={linkGranularity}
          onGranularityChange={setLinkGranularity}
        />

        <ThemePicker
          ref={themeRef}
          value={themes}
          onChange={setThemes}
          granularity={themesGranularity}
          onGranularityChange={setThemesGranularity}
        />
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

      {managing && (
        <ManageTypesModal
          onClose={() => {
            setManaging(false);
            loadTypes(); // un type supprimé disparaît du menu ; réconcilie le type courant
          }}
        />
      )}
    </div>
  );
}
