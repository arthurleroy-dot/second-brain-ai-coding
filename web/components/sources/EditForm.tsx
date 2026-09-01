'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { typeLabel } from '@/lib/ui';
import { validateDateInput } from '@/lib/date-input';
import LinkPicker, { LinksValue, LinkPickerHandle } from '@/components/upload/LinkPicker';
import ThemePicker, { ThemePickerHandle } from '@/components/upload/ThemePicker';

type TypeOpt = { slug: string; label: string };

export interface EditInitial {
  title: string;
  author: string;
  date: string;
  type: string; // slug du source_type (jamais vide ; `unknown` en repli)
  origin: 'interne' | 'externe';
  url: string;
  links: LinksValue; // { entity_type → [slugs courants] } (cf. D3 : pré-remplissage en slugs)
  themes: string[]; // slugs courants
}

/**
 * Formulaire d'ÉDITION des métadonnées d'une ressource existante. Mêmes champs que le
 * dépôt (via `LinkPicker`/`ThemePicker` réutilisés), SANS bloc contenu ni contrôles de
 * granularité (D4). Au submit : `flush()` des pickers (ramasse les brouillons non validés),
 * puis PATCH JSON /api/sources/<slug> — synchrone, instantané, AUCUN appel IA. Le slug
 * (identité) et le fichier source ne changent jamais.
 */
export default function EditForm({ slug, initial }: { slug: string; initial: EditInitial }) {
  const router = useRouter();

  const [title, setTitle] = useState(initial.title);
  const [author, setAuthor] = useState(initial.author);
  const [date, setDate] = useState(initial.date);
  const [type, setType] = useState(initial.type);
  const [origin, setOrigin] = useState<'interne' | 'externe'>(initial.origin);
  const [url, setUrl] = useState(initial.url);
  const [links, setLinks] = useState<LinksValue>(initial.links);
  const [themes, setThemes] = useState<string[]>(initial.themes);

  const [types, setTypes] = useState<TypeOpt[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [today] = useState(() => new Date().toISOString().slice(0, 10));

  const linkRef = useRef<LinkPickerHandle>(null);
  const themeRef = useRef<ThemePickerHandle>(null);

  // Registre des types de document (menu de dépôt). L'édition NE crée pas de type.
  useEffect(() => {
    fetch('/api/types')
      .then((r) => r.json())
      .then((d) => setTypes((d.types ?? []).map((t: TypeOpt) => ({ slug: t.slug, label: t.label }))))
      .catch(() => {});
  }, []);

  // Le type COURANT doit rester sélectionnable même s'il n'est plus au registre
  // (ex. `unknown`, ou un type retiré) — sinon il serait perdu au submit.
  const typeOptions = useMemo(() => {
    const list = types.map((t) => ({ slug: t.slug, label: t.label }));
    if (type && !list.some((t) => t.slug === type)) {
      list.unshift({ slug: type, label: typeLabel(type) });
    }
    return list;
  }, [types, type]);

  const submit = async () => {
    setError(null);
    // Validation de FORMAT seule (pas de confirmation forcée en édition, cf. D3) : une
    // ressource déjà ingérée a une date vérifiée ; on empêche juste d'en saisir une cassée.
    const d = date.trim();
    if (d) {
      const res = validateDateInput(d, today);
      if (!res.ok) {
        setError(res.error);
        return;
      }
    }
    setSubmitting(true);
    try {
      // Ramasse les brouillons tapés mais non validés (`+`/Entrée) AVANT de bâtir le
      // payload — `flush()` retourne SYNCHRONEMENT la valeur fusionnée (cf. UploadForm).
      const mergedLinks = linkRef.current?.flush() ?? links;
      const mergedThemes = themeRef.current?.flush() ?? themes;

      const res = await fetch(`/api/sources/${slug}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title,
          author,
          date,
          type,
          origin,
          url,
          links: mergedLinks,
          themes: mergedThemes,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Échec de l'enregistrement");
        return;
      }
      // Succès : retour à la page détail avec les nouvelles valeurs (force-dynamic).
      router.push(`/sources/${slug}`);
      router.refresh();
    } catch {
      setError('Erreur réseau pendant l’enregistrement.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-6">
        <button
          type="button"
          onClick={() => router.back()}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft size={16} /> Retour
        </button>

        <h1 className="mb-1 text-lg font-semibold text-gray-900">Modifier les informations</h1>
        <p className="mb-5 text-sm text-gray-500">
          Corrige les métadonnées de cette ressource. Le texte de la source n’est pas
          modifié et l’IA n’est pas rappelée : la mise à jour est instantanée.
          L’identifiant de la ressource (son adresse <code>/sources/{slug}</code>) ne
          change pas, même si tu modifies le titre.
        </p>

        <div className="grid grid-cols-1 gap-3">
          <label className="text-xs text-gray-600">
            Titre
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            />
          </label>

          <label className="text-xs text-gray-600">
            Type
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            >
              {typeOptions.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-gray-600">
            Origine
            <select
              value={origin}
              onChange={(e) => setOrigin(e.target.value as 'interne' | 'externe')}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            >
              <option value="externe">Externe (source tierce publique)</option>
              <option value="interne">Interne (note / transcript interne)</option>
            </select>
          </label>

          <label className="text-xs text-gray-600">
            Auteur
            <input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Laisse vide si inconnu"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            />
          </label>

          <label className="text-xs text-gray-600">
            Date (YYYY, YYYY-MM ou YYYY-MM-DD)
            <input
              value={date}
              onChange={(e) => setDate(e.target.value)}
              placeholder="2026-06"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            />
          </label>

          <label className="text-xs text-gray-600">
            URL de l’original (optionnel)
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            />
          </label>

          <LinkPicker
            ref={linkRef}
            value={links}
            onChange={setLinks}
            granularity={{}}
            onGranularityChange={() => {}}
            showGranularity={false}
          />

          <ThemePicker
            ref={themeRef}
            value={themes}
            onChange={setThemes}
            granularity="auto"
            onGranularityChange={() => {}}
            showGranularity={false}
          />
        </div>

        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="rounded-lg bg-[#0F6E56] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0c5a47] disabled:opacity-50"
          >
            {submitting ? 'Enregistrement…' : 'Enregistrer les modifications'}
          </button>
        </div>
      </div>
    </div>
  );
}
