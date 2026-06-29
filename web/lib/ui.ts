import { ResourceType } from '@/types';

export const TYPE_LABELS: Record<ResourceType, string> = {
  article: 'Article',
  meeting_note: 'Réunion',
  interview: 'Interview',
  presentation: 'Présentation',
  transcript: 'Transcript',
  personal_note: 'Note perso',
  unknown: 'Inconnu',
};

// Classes Tailwind (bg + texte) par type, d'après le prompt.
export const TYPE_BADGE: Record<ResourceType, string> = {
  meeting_note: 'bg-[#E1F5EE] text-[#0F6E56]',
  article: 'bg-blue-50 text-blue-700',
  interview: 'bg-[#FAEEDA] text-[#633806]',
  presentation: 'bg-[#FBEAF0] text-[#993556]',
  transcript: 'bg-violet-50 text-violet-700',
  personal_note: 'bg-slate-100 text-slate-700',
  unknown: 'bg-orange-50 text-orange-700',
};

export function typeLabel(t: ResourceType): string {
  return TYPE_LABELS[t] ?? 'Inconnu';
}

export function typeBadgeClass(t: ResourceType): string {
  return TYPE_BADGE[t] ?? TYPE_BADGE.unknown;
}

// Mapping dossier by-type <-> ResourceType (pour les filtres UI)
export const TYPE_TO_FOLDER: Record<ResourceType, string> = {
  article: 'articles',
  meeting_note: 'meeting-notes',
  interview: 'interviews',
  presentation: 'presentations',
  transcript: 'transcripts',
  personal_note: 'personal-notes',
  unknown: 'unknown',
};

export const ALL_TYPES: ResourceType[] = [
  'article',
  'meeting_note',
  'interview',
  'presentation',
  'transcript',
  'personal_note',
  'unknown',
];

export function formatDate(date: string | null): string {
  if (!date) return 'date inconnue';
  return date;
}
