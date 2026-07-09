export type ResourceType =
  | 'article'
  | 'report_pdf'
  | 'tweet'
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
  entities?: string[]; // slugs d'entités liées (registre wiki/entities)
  needs_review: boolean;
  status?: ResourceStatus;
  created_at?: string;
  source_file?: string | null; // nom du fichier de contenu dans /raw
  file_path?: string; // chemin relatif dans le wiki (resources/<slug>.md)
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

// Entité candidate : nom détecté à l'ingestion mais absent du registre. Sas de
// décision humaine, matérialisé dans wiki/entities/_candidates.json.
export interface CandidateSeenIn {
  resource: string; // slug de la ressource où le nom apparaît
  section: string | null; // heading-slug (null = niveau ressource)
  context: string; // extrait d'une ligne décrivant la mention
}

export interface SuggestedAlias {
  slug: string; // entité existante du registre à laquelle le nom ressemble
  label: string;
  score: number; // proximité 0..1 (tri décroissant)
}

export type CandidateStatus = 'pending' | 'merge_alias' | 'create' | 'reject';

export interface CandidateDecision {
  target_slug: string | null; // cible d'une fusion (merge_alias)
  entity_type: string | null; // type choisi (create)
  slug: string | null; // slug de la nouvelle entité (create)
}

export interface Candidate {
  name: string; // forme représentative détectée
  normalized: string; // clé d'identité/dédoublonnage
  variants: string[]; // toutes les écritures vues
  note?: string | null; // contexte humain optionnel (ex. faux positif écarté)
  seen_in: CandidateSeenIn[];
  suggested_aliases: SuggestedAlias[]; // « ressemble à » (entités proches)
  suggested_types: string[]; // types suggérés — ⊆ entity_types existants
  status: CandidateStatus;
  decision: CandidateDecision;
  updated_at: string | null;
}
