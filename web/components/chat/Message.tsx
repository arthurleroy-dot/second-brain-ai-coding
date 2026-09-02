'use client';

import { memo, useEffect, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import { Message as MessageType } from '@/types';
import Markdown from '@/components/Markdown';
import SourceChip from '@/components/chat/SourceChip';
import StepTrail from '@/components/chat/StepTrail';
import { splitStreamingMarkdown } from '@/lib/streaming-markdown';

// Rendu markdown mémoïsé du préfixe « engagé » (blocs terminés). memo compare
// `text` par valeur → le composant ne re-parse que quand un bloc se termine
// (le préfixe grandit), pas à chaque caractère révélé pendant le streaming.
// La coloration du code et les formules KaTeX viennent du composant partagé
// `<Markdown>` (variante `chat`) — même rendu que les pages ressource.
const CommittedMarkdown = memo(function CommittedMarkdown({ text }: { text: string }) {
  return <Markdown variant="chat" content={text} />;
});

// Bloc « actif » : le bloc markdown en cours d'écriture, rendu en texte brut
// (même typographie que les paragraphes — le conteneur porte déjà
// `text-sm leading-relaxed`) pour éviter les claquements de syntaxe.
//
// Fondu (C.1) : on isole le morceau NOUVEAU de cette image (au-delà de la
// longueur du render précédent) dans un span keyé par `text.length`. La clé
// change à chaque image → le span est remonté → l'animation CSS `stream-fade-in`
// se rejoue sur la seule « tête d'écriture ». Le préfixe stable ne ré-anime pas.
// Quand `active` rétrécit (un bloc vient de « monter » dans committed), on
// repart de 0 : tout le nouveau bloc actif fond en entrée.
function ActiveText({ text }: { text: string }) {
  const prevLenRef = useRef(0);
  const prevLen = text.length < prevLenRef.current ? 0 : prevLenRef.current;
  const stable = text.slice(0, prevLen);
  const fresh = text.slice(prevLen);

  useEffect(() => {
    prevLenRef.current = text.length;
  });

  return (
    <div className="whitespace-pre-wrap">
      {stable}
      {fresh && (
        <span key={text.length} className="stream-fade-in">
          {fresh}
        </span>
      )}
    </div>
  );
}

function Message({
  message,
  isStreaming = false,
}: {
  message: MessageType;
  isStreaming?: boolean;
}) {
  const isUser = message.role === 'user';

  // Pendant le streaming d'un message assistant : deux zones — les blocs
  // terminés en markdown STABLE (mémoïsé), le bloc en cours en texte brut.
  let body: React.ReactNode;
  if (isUser) {
    body = message.content;
  } else if (isStreaming) {
    const { committed, active } = splitStreamingMarkdown(message.content);
    body = (
      <>
        {committed && <CommittedMarkdown text={committed} />}
        {active && <ActiveText text={active} />}
      </>
    );
  } else {
    body = <Markdown variant="chat" content={message.content} />;
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-2`}>
        {!isUser && message.steps && message.steps.length > 0 && (
          <details className="group text-xs text-gray-400">
            <summary className="flex cursor-pointer list-none items-center gap-1">
              <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
              {message.steps.length} étape{message.steps.length > 1 ? 's' : ''} de recherche
            </summary>
            <div className="mt-1.5 pl-3">
              <StepTrail steps={message.steps} />
            </div>
          </details>
        )}
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? 'whitespace-pre-wrap bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-900'
          }`}
        >
          {body}
        </div>

        {!isUser && message.sources.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {message.sources.map((s, i) => (
              <SourceChip key={`${s.slug}-${i}`} source={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Mémoïsation : pendant un streaming, seul le message en cours de rédaction
// change — les messages figés ne re-parsent pas leur markdown à chaque frame
// du drain. `steps` est comparé par référence : le tableau n'est posé qu'une
// fois (au 'done') et n'est jamais muté ensuite. `isStreaming` est comparé pour
// que le passage streaming→figé re-render (bascule sur le markdown complet).
export default memo(
  Message,
  (prev, next) =>
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.message.sources.length === next.message.sources.length &&
    prev.message.steps === next.message.steps &&
    prev.isStreaming === next.isStreaming,
);
