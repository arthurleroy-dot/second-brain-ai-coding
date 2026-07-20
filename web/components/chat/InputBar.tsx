'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Send, Square } from 'lucide-react';

interface Props {
  onSend: (text: string) => void;
  onStop?: () => void;
  // Génération en cours : le bouton devient Stop et l'envoi est bloqué — mais
  // la frappe reste libre (le texte partira une fois la génération finie).
  isGenerating?: boolean;
  // Autres blocages (ex. aller-retour de création de la conversation).
  disabled?: boolean;
}

// Classes communes des boutons ronds de la barre (pas de design system, une
// simple constante locale suffit).
const iconBtn = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full';

export default function InputBar({ onSend, onStop, isGenerating, disabled }: Props) {
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow : la hauteur suit le contenu, plafonnée à 200px (scroll interne
  // au-delà). `height:auto` d'abord pour que scrollHeight reflète aussi les
  // suppressions de lignes.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  const canSend = !!input.trim() && !disabled && !isGenerating;

  const send = () => {
    if (!canSend) return;
    onSend(input.trim());
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
      <div className="flex items-end gap-2 rounded-[26px] border border-gray-200 bg-white px-2.5 py-2 shadow-sm transition-shadow focus-within:border-gray-300 focus-within:shadow-md">
        <button
          type="button"
          onClick={toggleMic}
          title="Dictée vocale"
          className={`${iconBtn} ${
            listening ? 'bg-red-50 text-red-600' : 'text-gray-500 hover:bg-gray-100'
          }`}
        >
          {listening ? <MicOff size={18} /> : <Mic size={18} />}
        </button>

        <textarea
          ref={taRef}
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
          className="flex-1 resize-none overflow-y-auto bg-transparent py-1 text-sm outline-none"
        />

        {isGenerating ? (
          <button
            type="button"
            onClick={onStop}
            title="Arrêter la génération"
            className={`${iconBtn} bg-gray-900 text-white hover:bg-gray-700`}
          >
            <Square size={13} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={!canSend}
            title="Envoyer"
            className={`${iconBtn} bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-30`}
          >
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
