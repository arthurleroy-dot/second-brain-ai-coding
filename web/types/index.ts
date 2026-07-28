// Type de document = slug `source_type` kebab (ex. `report-pdf`). Open set piloté
// par le registre `wiki/types.json` : `ResourceType` n'est plus une union figée
// mais un alias `string`, sur le modèle des `entity_type`. Libellé/couleur sont
// dérivés du slug (cf. typeLabel/typeBadgeClass dans lib/ui.ts).
export type ResourceType = string;

// Origine d'une ressource : produite en interne vs source tierce publique.
export type OriginValue = 'interne' | 'externe';

export type ResourceStatus = 'pending' | 'processing' | 'done' | 'error';

export interface Source {
  id?: string; // uuid de la ressource (absent pour les sources citées par Claude non hydratées)
  slug: string;
  title: string;
  type: ResourceType;
  author: string | null;
  date: string | null; // format YYYY, YYYY-MM, YYYY-MM-DD ou null
  url: string | null;
  deposited_by: string | null;
  topics: string[];
  entities?: string[]; // slugs d'entités liées (registre wiki/entities)
  origin?: OriginValue | null; // interne | externe (null si inconnu)
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
  // Checklist des ressources consultées pendant la génération (assistant
  // uniquement). Trace TRANSIENTE attachée côté client à la fin du streaming —
  // jamais persistée en base, absente après un hard reload.
  steps?: ChatStep[];
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  created_at: string;
  updated_at: string;
}

// Base commune d'une étape affichée en checklist (spinner → coche), partagée
// par le chat et le suivi d'ingestion pour que `StepTrail` accepte les deux.
// `status` est DÉRIVÉ côté client (absent de l'événement serveur) : les étapes
// se déroulent séquentiellement, donc l'étape N est 'done' dès que la N+1 arrive.
// `detail` (optionnel) porte un texte d'animation « en cours » (ex. compteur de
// caractères rédigés) affiché en style muté sous le label de l'étape active.
export interface TrailStep {
  label: string;
  status?: 'reading' | 'done';
  detail?: string;
}

// Étape de navigation de l'agent de chat dans le wiki (événement NDJSON `step`).
// Affichée en direct puis conservée repliée sous la réponse via Message.steps.
export interface ChatStep extends TrailStep {
  tool: string;
  path: string;
}

// Étape du pipeline d'ingestion (événement NDJSON `step` de /api/ingest-stream).
// `phase` = clé déterministe de l'étape (extract|analyze|project|write|verify) ;
// `file` = basename de la source en cours (utile en lot multi-fichiers).
export interface IngestStep extends TrailStep {
  phase?: string;
  file?: string;
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
  origins?: string[]; // 'interne' | 'externe'
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

// Origine (interne/externe) dérivée des ressources, avec compteur. Miroir léger
// de TypeEntry pour la facette /sources?origin= et l'exploration.
export interface OriginEntry {
  value: OriginValue; // valeur du filtre /sources?origin=
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

// ————————————————————————————————————————————————————————————————
// Thèmes candidats — patron entités dupliqué, sans la dimension `type`.
// Un thème n'a pas d'`entity_type` : le contrat est plus simple (pas de
// `suggested_types`, pas d'`entity_type` dans `decision`, pas de sélecteur de
// type dans la carte). Matérialisé dans wiki/themes/_candidates.json.

// Registre : une fiche wiki/themes/<slug>.md (frontmatter). `aliases` optionnel,
// ajouté pour qu'un « fusionner » soit durable (miroir des entités).
export interface ThemeEntry {
  slug: string;
  label: string;
  aliases: string[];
}

export interface ThemeCandidateDecision {
  target_slug: string | null; // cible d'une fusion (merge_alias)
  slug: string | null; // slug du nouveau thème (create)
}

export interface ThemeCandidate {
  name: string; // forme représentative détectée
  normalized: string; // clé d'identité/dédoublonnage
  variants: string[]; // toutes les écritures vues
  note?: string | null; // contexte humain optionnel
  seen_in: CandidateSeenIn[];
  suggested_aliases: SuggestedAlias[]; // « ressemble à » (thèmes proches)
  status: CandidateStatus;
  decision: ThemeCandidateDecision;
  updated_at: string | null;
}

// ————————————————————————————————————————————————————————————————
// Graphe de connaissances — vue dérivée wiki/graph.json (générée à
// l'ingestion). La plateforme la lit seulement pour la visualiser.
// `type` = genre de nœud (resource | theme | entity | author | date |
// source_type | origin) ; les champs optionnels dépendent du genre.
export interface GraphNode {
  id: string; // '<genre>:<slug>' — ex. 'resource:...', 'type:article'
  type: string;
  label: string;
  date?: string; // nœuds resource
  granularity?: string; // nœuds date
  entity_type?: string; // nœuds entity
}

export interface GraphEdge {
  source: string; // id du nœud source
  target: string; // id du nœud cible
  relation: string; // written_by | has_type | belongs_to_theme | mentions | …
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
