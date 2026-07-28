'use client';

import { memo, useEffect, useRef } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronRight } from 'lucide-react';
import { Message as MessageType } from '@/types';
import SourceChip from '@/components/chat/SourceChip';
import StepTrail from '@/components/chat/StepTrail';
import { splitStreamingMarkdown } from '@/lib/streaming-markdown';

// Map de rendu markdown partagée entre le rendu figé (message complet) et le
// rendu « committed » du streaming — définie une seule fois pour ne pas la
// dupliquer ni recréer un objet à chaque render.
const MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="mb-2 mt-3 text-base font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-1.5 mt-3 text-[15px] font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1 mt-2.5 text-sm font-semibold first:mt-0">{children}</h3>
  ),
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-blue-600 underline underline-offset-2 hover:text-blue-700"
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded bg-gray-200 px-1 py-0.5 font-mono text-[0.85em]">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-lg bg-gray-800 p-3 text-xs text-gray-100 last:mb-0">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-gray-300 pl-3 italic text-gray-600 last:mb-0">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-gray-300 bg-gray-50 px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-gray-300 px-2 py-1 align-top">{children}</td>
  ),
  hr: () => <hr className="my-3 border-gray-200" />,
};

// Rendu markdown mémoïsé du préfixe « engagé » (blocs terminés). memo compare
// `text` par valeur → ReactMarkdown ne re-parse que quand un bloc se termine
// (le préfixe grandit), pas à chaque caractère révélé pendant le streaming.
const CommittedMarkdown = memo(function CommittedMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
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
    body = (
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {message.content}
      </ReactMarkdown>
    );
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
