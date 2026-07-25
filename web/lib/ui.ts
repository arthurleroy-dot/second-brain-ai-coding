import { OriginValue, ResourceType } from '@/types';

export const TYPE_LABELS: Record<ResourceType, string> = {
  article: 'Article',
  report_pdf: 'Rapport PDF',
  tweet: 'Tweet',
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
  report_pdf: 'bg-[#EAF0FB] text-[#2952A3]',
  tweet: 'bg-sky-50 text-sky-700',
  interview: 'bg-[#FAEEDA] text-[#633806]',
  presentation: 'bg-[#FBEAF0] text-[#993556]',
  transcript: 'bg-violet-50 text-violet-700',
  personal_note: 'bg-slate-100 text-slate-700',
  unknown: 'bg-orange-50 text-orange-700',
};

// Valeurs du champ `source_type` (frontmatter wiki, ex. `report-pdf`) →
// ResourceType (web, ex. `report_pdf`). Table client-safe (aucune dépendance fs)
// réutilisée par le parser serveur ET les composants client (graphe).
export const SOURCE_TYPE_TO_TYPE: Record<string, ResourceType> = {
  article: 'article',
  'report-pdf': 'report_pdf',
  report_pdf: 'report_pdf',
  tweet: 'tweet',
  interview: 'interview',
  presentation: 'presentation',
  'meeting-notes': 'meeting_note',
  meeting_note: 'meeting_note',
  transcript: 'transcript',
  'personal-notes': 'personal_note',
  personal_note: 'personal_note',
  unknown: 'unknown',
};

/** Résout un `source_type` brut du wiki → ResourceType (fallback `unknown`). */
export function resolveSourceType(raw: string): ResourceType {
  return SOURCE_TYPE_TO_TYPE[raw.trim()] ?? 'unknown';
}

export function typeLabel(t: ResourceType): string {
  return TYPE_LABELS[t] ?? 'Inconnu';
}

export function typeBadgeClass(t: ResourceType): string {
  return TYPE_BADGE[t] ?? TYPE_BADGE.unknown;
}

// Valeur du filtre /sources?type= — on utilise directement le ResourceType.
export const TYPE_TO_FOLDER: Record<ResourceType, string> = {
  article: 'article',
  report_pdf: 'report_pdf',
  tweet: 'tweet',
  meeting_note: 'meeting_note',
  interview: 'interview',
  presentation: 'presentation',
  transcript: 'transcript',
  personal_note: 'personal_note',
  unknown: 'unknown',
};

export const ALL_TYPES: ResourceType[] = [
  'article',
  'report_pdf',
  'tweet',
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

// Origine (interne/externe) — enum fermé de 2 valeurs, sans registre.
export const ORIGIN_LABELS: Record<OriginValue, string> = {
  interne: 'Interne',
  externe: 'Externe',
};

export const ALL_ORIGINS: OriginValue[] = ['interne', 'externe'];

export function originLabel(o: OriginValue): string {
  return ORIGIN_LABELS[o] ?? o;
}

// Libellés d'affichage des types d'entités (entity_type). Extensible : tout
// nouveau type inconnu retombe sur une capitalisation du slug.
const ENTITY_TYPE_LABELS: Record<string, string> = {
  tool: 'Outils',
  client: 'Clients',
  company: 'Entreprises',
  concept: 'Concepts',
  model: 'Modèles',
  person: 'Personnes',
};

export function entityTypeLabel(type: string): string {
  if (ENTITY_TYPE_LABELS[type]) return ENTITY_TYPE_LABELS[type];
  const t = type.replace(/-/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
