export type ResourceType =
  | 'article'
  | 'meeting_note'
  | 'interview'
  | 'presentation'
  | 'transcript'
  | 'personal_note'
  | 'unknown';

export interface Source {
  slug: string;
  title: string;
  type: ResourceType;
  author: string | null;
  date: string | null; // format YYYY, YYYY-MM, YYYY-MM-DD ou null
  url: string | null;
  deposited_by: string | null;
  topics: string[];
  needs_review: boolean;
  file_path: string; // chemin relatif dans le wiki (by-type/...)
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
