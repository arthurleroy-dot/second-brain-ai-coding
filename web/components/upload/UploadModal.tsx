'use client';

import { useCallback, useRef, useState } from 'react';
import { UploadCloud, X } from 'lucide-react';
import { ResourceType } from '@/types';
import { ALL_TYPES, typeLabel } from '@/lib/ui';
import ProcessingStatus from './ProcessingStatus';

interface Props {
  onClose: () => void;
  onResolved?: (status: 'done' | 'error', title: string) => void;
}

const ACCEPT = '.md,.txt,.pdf,.pptx,.docx';

export default function UploadModal({ onClose, onResolved }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [author, setAuthor] = useState('');
  const [date, setDate] = useState('');
  const [type, setType] = useState<ResourceType>('unknown');
  const [depositedBy, setDepositedBy] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const pick = useCallback((f: File | null | undefined) => {
    if (f) setFile(f);
  }, []);

  const submit = async () => {
    if (!file) return;
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      if (author) form.append('author', author);
      if (date) form.append('date', date);
      if (depositedBy) form.append('deposited_by', depositedBy);
      form.append('type', type);

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            Déposer une ressource
          </h2>
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
              {file?.name}
            </div>
            <ProcessingStatus
              jobId={jobId}
              onResolved={(status) => onResolved?.(status, file?.name ?? 'Ressource')}
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
              <div className="text-xs text-gray-400">PDF, PPTX, DOCX, MD, TXT acceptés</div>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => pick(e.target.files?.[0])}
              />
            </div>

            <div className="grid grid-cols-1 gap-3">
              <label className="text-xs text-gray-600">
                Auteur (optionnel)
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
              <label className="text-xs text-gray-600">
                Type
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as ResourceType)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                >
                  {ALL_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {typeLabel(t)}
                    </option>
                  ))}
                </select>
              </label>
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
                disabled={!file || submitting}
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
