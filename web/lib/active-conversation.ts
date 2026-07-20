// Mémoire de la « conversation active » du chat, via un cookie.
//
// Pourquoi un cookie et pas localStorage : le cookie doit être lisible côté
// serveur (dans `app/chat/page.tsx` via `next/headers` `cookies()`) pour pouvoir
// rediriger vers `/chat/[id]` SANS flash. Le client ne fait qu'écrire/effacer ;
// la lecture se fait côté serveur.

const COOKIE = 'active_conversation';
const MAX_AGE = 60 * 60 * 24 * 365; // ~1 an

/** Mémorise la conversation courante comme « active » (écriture client). */
export function setActiveConversationId(id: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${COOKIE}=${id}; path=/; max-age=${MAX_AGE}; samesite=lax`;
}

/** Oublie la conversation active (ex. « Nouvelle discussion »). */
export function clearActiveConversationId() {
  if (typeof document === 'undefined') return;
  document.cookie = `${COOKIE}=; path=/; max-age=0; samesite=lax`;
}
