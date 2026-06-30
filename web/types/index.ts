export type ResourceType =
  | 'article'
  | 'meeting_note'
  | 'interview'
  | 'presentation'
  | 'transcript'
  | 'personal_note'
  | 'unknown';

export type ResourceStatus = 'pending' | 'processing' | 'done' | 'error';

export interface Source {
  id?: string; // uuid Supabase (absent pour les sources citées par Claude non hydratées)
  slug: string;
  title: string;
  type: ResourceType;
  author: string | null;
  date: string | null; // format YYYY, YYYY-MM, YYYY-MM-DD ou null
  url: string | null;
  deposited_by: string | null;
  topics: string[];
  needs_review: boolean;
  status?: ResourceStatus;
  created_at?: string;
  file_path?: string; // legacy : chemin relatif dans le wiki (by-type/...)
}

export interface ResourceContent {
  summary: string | null;
  full_content: string | null;
  key_concepts: string[];
  notable_quotes: string[];
  key_figures: string[];
}

export type JobStatus = 'queued' | 'running' | 'done' | 'error';

export interface ProcessingJob {
  id: string;
  resource_id: string;
  status: JobStatus;
  error_message: string | null;
}

export interface WikiTopic {
  slug: string;
  title: string;
  source_count: number;
  sources: Source[];
  last_updated: string | null;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: Source[]; // sources citées dans la réponse
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  created_at: string;
  updated_at: string;
}

// Filtre date structuré : intervalle, avant une borne, ou après une borne.
export type DateFilterMode = 'between' | 'before' | 'after';

export interface DateFilter {
  mode: DateFilterMode;
  from?: string; // borne basse 'YYYY-MM' (between/after)
  to?: string; // borne haute 'YYYY-MM' (between/before)
}

// Filtres actifs du panneau de chat. type/auteur sont multi-sélection (OR
// intra-axe), les axes se combinent en ET. La date est un filtre structuré.
export interface ChatFilterState {
  types?: string[]; // dossiers by-type (ex: 'articles')
  authors?: string[]; // noms d'auteur exacts, ou 'unknown'
  date?: DateFilter;
}

// Type d'auteur/date pour les pages d'exploration
export interface AuthorEntry {
  slug: string;
  name: string;
  source_count: number;
}

export interface DateEntry {
  year: string;
  month: string | null; // "YYYY-MM" ou null (unknown)
  label: string;
  source_count: number;
  is_unknown: boolean;
}

export interface TypeEntry {
  type: ResourceType;
  folder: string; // dossier by-type (valeur du filtre /sources?type=)
  label: string;
  source_count: number;
}
