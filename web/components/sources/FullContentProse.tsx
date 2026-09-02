'use client';

import Markdown from '@/components/Markdown';

/**
 * Rend le `full_content` d'une ressource en typographie propre (pas de markdown
 * brut). Les sources texte sont souvent du markdown ; on le formate joliment.
 * Le rendu (typo + coloration du code + formules KaTeX) est factorisé dans le
 * composant partagé `<Markdown>` (variante `prose`).
 */
export default function FullContentProse({ content }: { content: string }) {
  return (
    <div className="text-[15px] leading-7 text-gray-800">
      <Markdown variant="prose" content={content} />
    </div>
  );
}
