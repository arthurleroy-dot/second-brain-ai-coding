'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useScrollRestoration } from '@/lib/use-scroll-restoration';
import UploadForm from './UploadForm';

/**
 * Page de dépôt d'une ressource. Racine `h-full overflow-y-auto` → scrollbar
 * native du navigateur à l'intérieur du <main> (clippé) du layout. La sortie se
 * fait par « ← Retour » (historique navigateur) ou la barre latérale toujours
 * présente.
 */
export default function UploadView() {
  const router = useRouter();
  const scrollRef = useScrollRestoration<HTMLDivElement>('upload:scroll');

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-6">
        <button
          type="button"
          onClick={() => router.back()}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft size={16} /> Retour
        </button>

        <p className="mb-5 text-sm text-gray-500">
          Ajoute une source au wiki : colle un texte (l’IA le met en forme) ou
          uploade un fichier (PDF, PPTX, DOCX, TXT, MD). Renseigne les métadonnées
          utiles, puis dépose — l’ingestion se fait automatiquement.
        </p>

        <UploadForm />
      </div>
    </div>
  );
}
