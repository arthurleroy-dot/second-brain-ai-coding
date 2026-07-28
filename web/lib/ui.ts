import { OriginValue } from '@/types';

// ————————————————————————————————————————————————————————————————
// Types de document (source_type) — système OUVERT, calqué sur entityTypeLabel.
// Le slug kebab (`report-pdf`) est l'identité canonique unique : libellé et
// couleur sont des fonctions PURES du slug (client-safe, synchrones, zéro
// dépendance registre/fs). Un type inconnu retombe sur une dérivation du slug
// (libellé) et une palette par hash déterministe (couleur) — aucune table à
// maintenir. Le registre des types créables vit dans wiki/types.json (lu côté
// serveur par wiki-parser.listTypeRegistry), pas ici.

// GRAINE par défaut du registre (kebab = vocabulaire wiki). Amorce le menu de dépôt
// tant que `wiki/types.json` est vide ; dès la 1re écriture, le fichier fait autorité
// et l'utilisateur peut retirer/renommer n'importe lequel de ces types (aucun n'est
// « permanent »). Ce sont AUSSI les seuls slugs à libellé/couleur curés ci-dessous —
// un type retiré du registre garde son affichage curé s'il réapparaît (ex. fallback
// `unknown`). `tweet` RETIRÉ (aucune ressource ne l'utilise ; filtres dérivés).
export const BUILTIN_TYPE_SLUGS = [
  'article',
  'report-pdf',
  'personal-notes',
  'meeting-notes',
  'interview',
  'presentation',
  'transcript',
  'unknown',
] as const;

// Libellés FR curés des intégrés (les seuls non dérivables du slug).
const TYPE_LABEL_OVERRIDES: Record<string, string> = {
  article: 'Article',
  'report-pdf': 'Rapport PDF',
  'personal-notes': 'Note perso',
  'meeting-notes': 'Réunion',
  interview: 'Interview',
  presentation: 'Présentation',
  transcript: 'Transcript',
  unknown: 'Inconnu',
};

/** Libellé d'un source_type (slug kebab). Override curé, sinon dérivation du slug. */
export function typeLabel(slug: string): string {
  const s = (slug ?? '').trim();
  if (!s) return 'Inconnu';
  if (TYPE_LABEL_OVERRIDES[s]) return TYPE_LABEL_OVERRIDES[s];
  const t = s.replace(/-/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Couleurs curées des intégrés (Tailwind bg+texte). Reprise EXACTE de l'ancien
// TYPE_BADGE, re-clés en kebab (`tweet` retiré).
const TYPE_BADGE_OVERRIDES: Record<string, string> = {
  'meeting-notes': 'bg-[#E1F5EE] text-[#0F6E56]',
  article: 'bg-blue-50 text-blue-700',
  'report-pdf': 'bg-[#EAF0FB] text-[#2952A3]',
  interview: 'bg-[#FAEEDA] text-[#633806]',
  presentation: 'bg-[#FBEAF0] text-[#993556]',
  transcript: 'bg-violet-50 text-violet-700',
  'personal-notes': 'bg-slate-100 text-slate-700',
  unknown: 'bg-orange-50 text-orange-700',
};

// Palette de repli pour les types créés — classes LITTÉRALES (Tailwind JIT doit
// les voir en clair dans le source ; NE PAS interpoler). `lib/**` est inclus au
// `content` de tailwind.config.ts pour que ces classes soient générées au build.
const TYPE_BADGE_PALETTE = [
  'bg-emerald-50 text-emerald-700',
  'bg-sky-50 text-sky-700',
  'bg-amber-50 text-amber-700',
  'bg-rose-50 text-rose-700',
  'bg-indigo-50 text-indigo-700',
  'bg-teal-50 text-teal-700',
  'bg-fuchsia-50 text-fuchsia-700',
  'bg-lime-50 text-lime-700',
];

function hashSlug(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Classe badge d'un source_type. Override curé, sinon palette par hash du slug. */
export function typeBadgeClass(slug: string): string {
  const s = (slug ?? '').trim();
  if (TYPE_BADGE_OVERRIDES[s]) return TYPE_BADGE_OVERRIDES[s];
  return TYPE_BADGE_PALETTE[hashSlug(s || 'unknown') % TYPE_BADGE_PALETTE.length];
}

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
