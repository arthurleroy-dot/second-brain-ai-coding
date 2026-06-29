'use client';

import { Message as MessageType } from '@/types';
import SourceChip from '@/components/chat/SourceChip';

export default function Message({ message }: { message: MessageType }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-2`}>
        <div
          className={`whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-900'
          }`}
        >
          {message.content}
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
