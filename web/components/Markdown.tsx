'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github.css'; // thème clair (l'app est mono-thème clair)

/**
 * Composant de rendu markdown PARTAGÉ par toutes les surfaces (pages ressource /
 * détail source / thème / entité via `variant="prose"`, chat via `variant="chat"`).
 * C'est le SEUL point où l'on branche les plugins :
 *  - `remark-math` (+ `rehype-katex`) : rend les formules `$$…$$` en vraies maths ;
 *    `singleDollarTextMath: false` DÉSACTIVE le simple `$…$` inline pour ne pas
 *    prendre les prix en dollars (« $6,64 ») pour des formules → toute formule est
 *    en display `$$…$$` (aligné sur le cas d'usage matrices, cf. spec §1.5).
 *  - `rehype-highlight` (highlight.js) : colore les blocs de code ; `detect: true`
 *    pour colorer aussi un bloc ```` ``` ```` sans langage explicite.
 *
 * Les deux maps de composants Tailwind sont copiées VERBATIM depuis les fichiers
 * d'origine (FullContentProse / Message) à l'exception des renderers `code`/`pre`,
 * redéfinis ci-dessous pour préserver la coloration → zéro régression typographique.
 */

// Renderer `code` par variante : un bloc fencé (coloré par rehype-highlight) porte la
// classe `hljs language-*` → on la FORWARD pour que le thème CSS s'applique (le cadre est
// sur `pre`). Un code INLINE (sans cette classe) garde la pastille du variant.
function makeCode(inlineClass: string): Components['code'] {
  return function CodeRenderer({ className, children }) {
    if (className && /\bhljs\b|\blanguage-/.test(className)) {
      return <code className={className}>{children}</code>;
    }
    return <code className={inlineClass}>{children}</code>;
  };
}

// Renderer `pre` par variante : cadre « éditeur » (arrondi, fond doux, scroll horizontal).
// Le fond/padding internes de `.hljs` sont neutralisés dans globals.css → le cadre unique
// vient d'ici ; les couleurs des tokens viennent du thème highlight.js.
function makePre(frameClass: string): Components['pre'] {
  return function PreRenderer({ children }) {
    return <pre className={frameClass}>{children}</pre>;
  };
}

const PROSE_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="mb-3 mt-6 text-xl font-semibold text-gray-900 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-5 text-lg font-semibold text-gray-900 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-4 text-base font-semibold text-gray-900 first:mt-0">{children}</h3>
  ),
  p: ({ children }) => <p className="mb-4 last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="mb-4 list-disc space-y-1.5 pl-6 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-4 list-decimal space-y-1.5 pl-6 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-7">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-gray-900">{children}</strong>
  ),
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
  code: makeCode('rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[0.85em] text-gray-800'),
  pre: makePre('mb-4 overflow-x-auto rounded-lg bg-[#f6f8fa] p-4 text-sm last:mb-0'),
  blockquote: ({ children }) => (
    <blockquote className="mb-4 border-l-2 border-gray-300 pl-4 italic text-gray-600 last:mb-0">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="mb-4 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-gray-300 bg-gray-50 px-3 py-1.5 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-gray-300 px-3 py-1.5 align-top">{children}</td>
  ),
  hr: () => <hr className="my-6 border-gray-200" />,
};

const CHAT_COMPONENTS: Components = {
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
  code: makeCode('rounded bg-gray-200 px-1 py-0.5 font-mono text-[0.85em]'),
  pre: makePre('mb-2 overflow-x-auto rounded-lg bg-[#f6f8fa] p-3 text-xs last:mb-0'),
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

export default function Markdown({
  content,
  variant,
}: {
  content: string;
  variant: 'prose' | 'chat';
}) {
  const components = variant === 'prose' ? PROSE_COMPONENTS : CHAT_COMPONENTS;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
      rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: true }]]}
      components={components}
    >
      {content}
    </ReactMarkdown>
  );
}

export { PROSE_COMPONENTS, CHAT_COMPONENTS };
