'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Message as MessageType } from '@/types';
import SourceChip from '@/components/chat/SourceChip';

export default function Message({ message }: { message: MessageType }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-2`}>
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? 'whitespace-pre-wrap bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-900'
          }`}
        >
          {isUser ? (
            message.content
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
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
              }}
            >
              {message.content}
            </ReactMarkdown>
          )}
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
