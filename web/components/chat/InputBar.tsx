'use client';

import { useRef, useState } from 'react';
import { Mic, MicOff, Paperclip, Send } from 'lucide-react';
import { useUpload } from '@/components/UploadProvider';

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export default function InputBar({ onSend, disabled }: Props) {
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const { openPicker, uploading } = useUpload();

  const send = () => {
    const text = input.trim();
    if (!text || disabled) return;
    onSend(text);
    setInput('');
  };

  const toggleMic = () => {
    if (typeof window === 'undefined') return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert("La dictée vocale n'est pas supportée par ce navigateur.");
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new SR();
    recognition.lang = 'fr-FR';
    recognition.interimResults = false;
    recognition.onresult = (e: SpeechRecognitionEvent) => {
      const transcript = e.results[0][0].transcript;
      setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  return (
    <div className="border-t border-gray-200 bg-white px-4 py-3">
      <div className="flex items-end gap-2 rounded-2xl border border-gray-300 bg-white px-3 py-2 focus-within:border-gray-400">
        <button
          type="button"
          onClick={toggleMic}
          title="Dictée vocale"
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
            listening ? 'bg-red-50 text-red-600' : 'text-gray-500 hover:bg-gray-100'
          }`}
        >
          {listening ? <MicOff size={18} /> : <Mic size={18} />}
        </button>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder="Pose une question sur le wiki…"
          className="max-h-32 flex-1 resize-none bg-transparent py-1 text-sm outline-none"
        />

        <button
          type="button"
          onClick={openPicker}
          disabled={uploading}
          title="Déposer une source"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-50"
        >
          <Paperclip size={18} />
        </button>

        <button
          type="button"
          onClick={send}
          disabled={disabled || !input.trim()}
          title="Envoyer"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
