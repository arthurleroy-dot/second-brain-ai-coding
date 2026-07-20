# Chat agentique : navigation par paliers dans le wiki

## Contexte

**Demande d'origine (Arthur).** « J'ai envie que le chat soit juste un agent qui
navigue au sein du wiki et qui trouve toutes les bonnes données nécessaires. Si je lui
demande les trucs écrits en 2026, il trouve ce qui a été écrit en 2026. Si je lui
demande ce qu'a écrit McKinsey, pareil. S'il faut croiser thème et date, il croise.
Un agent autonome qui navigue dans le wiki de façon fluide. »

**Problème constaté.** À la question « Qu'est-ce qui a été écrit en 2026 ? », le chat
cite 5 ressources alors que le wiki en contient 11 datées 2026 (vérifié dans le
frontmatter des 13 fiches `wiki/resources/*.md`, champ `date`, granularité mixte :
`"2026"`, `"2026-04"`, `"2026-02-12"`).

**Cause racine (audit du 2026-07-16).** Le chat n'est pas un agent : c'est un appel
LLM unique (`web/app/api/chat/route.ts`) dont le contexte est pré-construit par
`web/lib/chat-context.ts` avec :
- un plafond dur `MAX_SOURCES = 6` (l.22) — le modèle ne voit jamais plus de 6
  ressources, donc ne peut jamais en citer 11 ;
- un scoring par mots-clés (entités/auteur/topics/titre) **aveugle aux dates** —
  « 2026 » (4 caractères) est même exclu du matching de mots (`w.length > 4`, l.116) ;
- un repli « les 6 plus récentes » quand aucun signal ne matche (l.121-125) — c'est
  exactement ce qui a produit la réponse observée (les 5 citées = les 5 plus récentes
  par tri de date décroissante) ;
- aucune lecture des vues `index.md` / `by-date/` / thèmes. La spec
  `docs/wiki-spec.md` §7 (« requête par paliers ») n'est pas implémentée, malgré un
  commentaire trompeur dans `chat-context.ts:73-76`.

**Résultat attendu.** Le chat devient un agent (boucle de tool use Anthropic) qui
navigue lui-même dans le wiki par paliers (index → sommaires → fiches). La profondeur
découle de la question. Les questions d'énumération deviennent exhaustives (test
témoin : la question 2026 doit citer les 11 ressources).

## Plan

### Décisions produit validées par Arthur (2026-07-18)

1. **Navigation pure par paliers** (spec §7) : outils de navigation (lire une page,
   lister un dossier), PAS de requêtes structurées type `search(filters)`.
2. **Garde-fou recoupement** : l'agent peut lister les **noms** de fichiers
   (ex. `wiki/resources/`) pour vérifier qu'un sommaire n'a rien oublié sur les
   questions d'énumération. Lister = noms seulement, jamais lecture en masse.
3. **Étapes visibles en direct** dans l'UI (« Lecture de by-date/2026… »).
4. **Filtres du panneau droit = contrainte dure** (consigne stricte dans le prompt +
   validation déterministe côté serveur des sources citées).
5. **Plafond de sécurité léger** : cap d'itérations généreux (disjoncteur d'anomalie),
   + augmenter `maxDuration`.
6. **Wiki uniquement** : jamais les connaissances générales du modèle. Rien trouvé →
   le dire clairement + `SOURCES: []`.
7. **On conserve** : protocole NDJSON (`delta`/`done`/`error` ; on ajoute `step`),
   persistance Supabase, bloc `SOURCES:` + hydratation + chips, chat éphémère,
   gestion `clientGone`.
8. **Mémoire conversationnelle intacte** : l'historique complet de la conversation
   (`getConversationHistory`, `web/lib/supabase.ts:87-97`, sans limite) continue d'être
   transmis au modèle à chaque message — les questions de suivi (« et en 2025 ? » après
   une question sur McKinsey 2026) restent comprises en contexte. NB : le fichier
   supprimé `chat-context.ts` n'a rien à voir avec cette mémoire — son « contexte » est
   le paquet de contenu wiki pré-sélectionné (la cause du bug).

### Existant à réutiliser (vérifié)

- `web/lib/wiki-fs.ts` : `readWikiFile` ('' si absent), `listWikiDir`, `wikiExists` —
  anti path-traversal via `resolveUnder` (l.12-19). **Réutiliser tel quel.**
- `web/lib/wiki-query.ts` : `describeChatFilters`, `parseResponse`, `listSources`,
  `resolveType` — restent la base du prompt filtres et du parsing SOURCES.
- `web/app/api/chat/route.ts` : `emittableLength` (masque le bloc SOURCES pendant le
  stream, l.210-223), `finalize()` idempotent (l.123-149), flag `clientGone`
  (l.103-111), persistance (saveMessage user AVANT l'appel LLM l.88, assistant dans
  finalize l.144) — **structure conservée**, seul le cœur (appel unique → boucle agent)
  change.
- `web/lib/chat-stream-store.ts` : ignore les types NDJSON inconnus (chaîne if/else
  l.207-222) → ajout de `step` nativement rétro-compatible.
- SDK `@anthropic-ai/sdk` **0.39.0** (version installée vérifiée) : tools + streaming
  OK (`messages.stream({tools})`, `finalMessage()`, `stop_reason: 'tool_use'`, events
  `content_block_start`/`input_json_delta`). Pas d'upgrade nécessaire ; le tool runner
  n'existe pas en 0.39 → boucle manuelle.
- Modèle via proxy LiteLLM : `ANTHROPIC_BASE_URL` (env), modèle
  `ANTHROPIC_MODEL=vercel/anthropic-claude-sonnet-4.5` (env), défaut code
  `claude-sonnet-4-6` (`web/lib/claude.ts:9`).
- Structure du wiki : `wiki/index.md` (sommaire général), `wiki/by-date/<YYYY>/<YYYY>.md`
  et `<YYYY>/<YYYY-MM>/<YYYY-MM>.md`, `wiki/themes/*.md`, `wiki/authors/*.md`,
  `wiki/entities/*.md`, `wiki/types.md`, `wiki/origin/{interne,externe}.md`,
  `wiki/resources/*.md` (canonique, 13 fiches), `wiki/graph.json`. Fichiers non-md à
  exclure : `graph.json`, `_ingested.json`, `themes/_candidates.json`,
  `entities/_candidates.json` le cas échéant, `Sans titre.canvas`.
- Cas réel d'erreur de vue dérivée (justifie le garde-fou) :
  `wiki/by-date/2026/2026.md` a `resource_count: 13` en frontmatter alors qu'il liste
  11 ressources.
- Plus grosse fiche actuelle ≈ 27 Ko (`2026-agentic-coding-trends-report.md`) —
  dimensionne le plafond de troncature.
- `next.config.js` : `outputFileTracingIncludes` embarque `../wiki/**` dans les
  fonctions serverless → la lecture fs des nouveaux outils marche en prod.

### 1. Outils (nouveau `web/lib/chat-agent.ts`)

Deux outils, `/raw` inaccessible en v1 :

- **`read_wiki_page(path)`** : lit une page `.md` du wiki (chemin relatif ; description
  listant les familles de chemins : `index.md`, `themes/…`, `authors/…`, `entities/…`,
  `by-date/…`, `resources/<slug>.md`, `types.md`, `origin/…`). Contenu renvoyé
  **verbatim, frontmatter inclus** (il porte slug/date/author/type — nécessaires aux
  SOURCES et aux filtres ; wikilinks conservés car ils portent les slugs de navigation ;
  ne PAS appliquer `stripChunkAnnotations` ni `wikilinksToMarkdown`).
  Refus non-`.md` (exclut `graph.json`, `_ingested.json`, `.canvas`). Page absente →
  `tool_result` `is_error: true` : « page introuvable, vérifie le chemin avec
  list_wiki_folder sur le dossier parent » (le modèle se corrige seul, on ne plante
  jamais ; distinguer absent/vide via `wikiExists` car `readWikiFile` renvoie `''`
  dans les deux cas). Plafond `MAX_PAGE_CHARS = 30_000` avec suffixe
  `[--- CONTENU TRONQUÉ : ${total} caractères au total, ${MAX_PAGE_CHARS} affichés ---]`.
- **`list_wiki_folder(path)`** : noms des entrées d'un dossier (`''` ou `'.'` =
  racine), un nom par ligne, en filtrant le bruit (`_candidates.json`,
  `_ingested.json`, `*.canvas`). Dossier inexistant → `is_error` même style. Sert au
  recoupement des sommaires.

Schémas d'entrée : `{ type: 'object', properties: { path: { type: 'string' } },
required: ['path'] }` pour les deux. Normalisation d'entrée tolérante (trim, préfixe
`wiki/` ou `/` retiré). Sécurité entièrement déléguée à `resolveUnder` de `wiki-fs.ts`
+ restriction `.md` pour la lecture. `executeWikiTool(name, input)` exporté (testable),
paramètre `maxChars` injectable pour tester la troncature.

### 2. Boucle agentique (`runWikiAgent` dans `chat-agent.ts`)

Signature :

```ts
export interface AgentCallbacks {
  onText(delta: string): void;   // deltas de texte bruts (masquage SOURCES fait par la route)
  onStep(step: { label: string; tool: string; path: string }): void;
}

export async function runWikiAgent(opts: {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  callbacks: AgentCallbacks;
  deadlineMs?: number;           // échéance absolue
  client?: Anthropic;            // injection pour les tests (défaut: anthropic de lib/claude)
  model?: string;                // défaut: CLAUDE_MODEL
}): Promise<{ rawText: string; iterations: number }>
```

Aucune dépendance à `Response`/Supabase → testable avec client mocké.

- Boucle manuelle : `client.messages.stream({ model, max_tokens: 8000, system,
  messages: loopMessages, tools: WIKI_TOOLS })` ; les deltas texte
  (`content_block_delta`/`text_delta`) → `rawText` + `onText` à **toutes** les
  itérations ; `await stream.finalMessage()` ; si `stop_reason !== 'tool_use'` →
  return. Sinon : un `onStep` par bloc `tool_use` (libellés : `read_wiki_page` →
  « Lecture de ${path} » ; `list_wiki_folder` → « Exploration du dossier
  ${path || 'racine'} »), exécution séquentielle, puis
  `loopMessages.push({ role: 'assistant', content: final.content })` et **tous les
  `tool_result` dans UN SEUL message user** (contrat API, avec les bons
  `tool_use_id`), itération suivante.
- **Cap `MAX_ITERATIONS = 15`** + `deadlineMs` : à l'avant-dernière itération OU si
  `Date.now() > deadlineMs`, ajouter au message user de résultats un bloc texte :
  `[Système] Limite d'exploration atteinte. Réponds MAINTENANT à partir de ce que tu
  as déjà lu, sans nouvel appel d'outil. Si l'information manque, dis-le et cite
  SOURCES: []`. On ne retire **jamais** `tools` de la requête (l'API l'exige dès que
  l'historique contient des blocs tool_use). Si le modèle appelle encore un outil
  après le nudge : un `tool_result` `is_error` « Limite atteinte, réponds sans
  outil. » une fois, puis sortie de boucle avec le texte accumulé.
- Erreurs d'outil (chemin inexistant, non-.md, traversal) → toujours `tool_result`
  `is_error: true`, jamais d'exception. Les exceptions réseau/proxy du stream
  remontent à la route (pattern `catch`/`finalize` existant).
- **Historique multi-tours** : les blocs tool_use/tool_result ne sont PAS persistés ;
  chaque tour repart des messages texte purs user/assistant de Supabase (comportement
  actuel, assumé ; l'API accepte un historique assistant texte-seul).
- Steps émis au moment de l'exécution de l'outil (input complet après
  `finalMessage()`), pas en cours de stream — simplification v1 assumée.

### 3. System prompt (`buildSystemPrompt(filterDesc)` dans `chat-agent.ts`)

Texte complet (le bloc FILTRES n'est inséré que si `filterDesc` non vide ;
`filterDesc` vient de `describeChatFilters` de `wiki-query.ts`) :

```
Tu es l'assistant d'une base de connaissances sur l'AI Coding. Cette base est un wiki markdown
que tu explores TOI-MÊME avec les outils `read_wiki_page` et `list_wiki_folder`.

STRUCTURE DU WIKI :
- index.md — sommaire général : thèmes, auteurs, ressources, index par date/type/origine. COMMENCE TOUJOURS ICI.
- themes/<slug>.md — synthèses par thème, avec liens vers les ressources.
- authors/<slug>.md — pages par auteur.
- entities/<slug>.md — pages par entité (organisations, produits, personnes).
- by-date/<YYYY>/<YYYY>.md et by-date/<YYYY>/<YYYY-MM>/<YYYY-MM>.md — index chronologiques.
- types.md, origin/externe.md, origin/interne.md — index par type et par origine.
- resources/<slug>.md — les fiches ressources CANONIQUES (contenu détaillé + frontmatter :
  slug, title, author, date, source_type, origin, topics, url).

MÉTHODE (lecture par paliers) :
1. Lis index.md pour repérer les pages pertinentes.
2. Lis les vues concernées (themes/, authors/, entities/, by-date/) — souvent suffisant.
3. N'ouvre les fiches resources/ que si un détail précis est nécessaire.
N'appelle PAS d'outil inutilement : arrête la navigation dès que tu peux répondre.
N'écris AUCUN texte avant ou entre tes appels d'outils : navigue d'abord, rédige ta réponse
UNIQUEMENT quand la navigation est terminée.

FIABILITÉ ET RECOUPEMENT :
- Les vues dérivées (index, themes/, by-date/…) sont générées automatiquement et peuvent contenir
  des erreurs (compteurs faux, oublis). Les fiches resources/ et leur frontmatter font foi.
- Pour toute question d'ÉNUMÉRATION ou de COMPTAGE (« tout ce qui… », « combien… », « liste… »),
  recoupe avec `list_wiki_folder` (ex. le dossier resources/) pour vérifier que rien ne manque,
  puis confirme les métadonnées litigieuses (date, auteur) dans le frontmatter des fiches concernées.
  Lister = obtenir des noms ; ne lis jamais toutes les fiches en masse.
- Les dates du frontmatter ont une granularité variable : "2026", "2026-04" ou "2026-02-12".
  Une ressource datée "2026" appartient à l'année 2026 même sans mois connu.

[si filtres actifs :]
FILTRES ACTIFS (CONTRAINTE ABSOLUE) : ${filterDesc}.
Tu ne dois exploiter et citer QUE des ressources qui respectent ces filtres — vérifie leur
frontmatter avant de les utiliser. Si la question contredit les filtres, LES FILTRES GAGNENT :
réponds dans le périmètre des filtres et signale la restriction. Le serveur rejettera toute
source citée hors filtres.

RÈGLES DE RÉPONSE :
- Tu réponds EXCLUSIVEMENT à partir du contenu du wiki lu pendant cette conversation. N'utilise
  JAMAIS tes connaissances générales, même pour compléter. Si le wiki ne couvre pas la question,
  dis-le clairement et termine par SOURCES: []
- Termine TOUJOURS ta réponse par une ligne dédiée :
  SOURCES: [{"slug":"...","title":"...","type":"...","author":"...","date":"..."}]
  N'y mets que des ressources (resources/<slug>.md) réellement lues ou identifiées dans le wiki,
  avec les valeurs exactes de leur frontmatter.
- Réponds en français. Sois concis et factuel. Ne décris pas ta navigation dans la réponse.
```

### 4. Route + protocole NDJSON (`web/app/api/chat/route.ts`)

- Nouvel événement NDJSON `{ type: 'step', label, tool, path }` émis via le `send()`
  existant (donc no-op si `clientGone`). `delta`/`done`/`error` inchangés.
- Supprimer l'appel `getRelevantContext` (l.47-51) et le `conversationText` de
  détection (l.42-44) ; `systemPrompt = buildSystemPrompt(describeChatFilters(filters))`.
- Dans `start(controller)` : remplacer le bloc `anthropic.messages.stream(...)` +
  boucle `for await` (l.152-176) par :

```ts
const { rawText: _ } = await runWikiAgent({
  system: systemPrompt,
  messages,                      // historique Supabase + message courant (inchangé)
  deadlineMs: Date.now() + 280_000,
  callbacks: {
    onText: (delta) => {         // logique de masquage SOURCES inchangée
      rawText += delta;
      const safe = emittableLength(rawText);
      if (safe > emittedLen) { send({ type: 'delta', text: rawText.slice(emittedLen, safe) }); emittedLen = safe; }
    },
    onStep: (s) => send({ type: 'step', ...s }),
  },
});
await finalize();
```

  `emittableLength`, `finalize`, le `catch` de récupération (« Premature close »
  LiteLLM), le `finally`/close tolérant : **inchangés**.
- `finalize()` : après l'hydratation par slug existante (l.132-140), insérer la
  **validation dure des filtres** (§5) avant `saveMessage`.
- `max_tokens` 4000 → 8000 (passé par `runWikiAgent` à chaque itération).
- `maxDuration` 60 → **300** (point de config : nécessite Vercel Pro/Fluid compute ;
  si le plan d'hébergement ne le permet pas, retomber à 60 avec `deadlineMs` ≈ 50 s —
  le cap d'itérations prend le relais).
- Ajouter `console.error` du message d'erreur amont dans le `catch` (diagnostic
  proxy LiteLLM).

### 5. Validation dure des filtres (nouveau `web/lib/chat-filters.ts`)

Module pur remplaçant le `passesFilters` privé de `chat-context.ts`, avec sémantique
de dates corrigée pour la granularité mixte :

```ts
export function dateIntervalOf(date: string | null): { start: string; end: string } | null
// "2026"       → { start: "2026-01-01", end: "2026-12-31" }
// "2026-04"    → { start: "2026-04-01", end: "2026-04-31" }  (comparaison lexicale, "-31" suffit)
// "2026-02-12" → { start: "2026-02-12", end: "2026-02-12" }
// null         → null

export function sourcePassesFilters(s: Source, filters?: ChatFilterState): boolean
// types   : résolution dossier→ResourceType via resolveType (wiki-query)
// authors : match exact + 'unknown' ⇔ author == null (logique actuelle conservée)
// origins : appartenance stricte
// date    : bornes du panneau 'YYYY-MM' → from+'-01' / to+'-31' ; une ressource passe
//           si son INTERVALLE intersecte l'intervalle du filtre (modes between/after/before).
//           Ressource sans date : passe (pas de preuve de violation — comportement actuel).
```

`ChatFilterState` : `web/types/index.ts` l.88-93 (`types?: string[]`, `authors?:
string[]`, `origins?: string[]`, `date?: DateFilter`) ; `DateFilter` l.80-84
(`{ mode: 'between'|'before'|'after'; from?: 'YYYY-MM'; to?: 'YYYY-MM' }`).

Branchement dans `finalize()` (route) après hydratation :

```ts
const validated = filters
  ? sources.filter((s) => {
      const hydrated = allSources.some((a) => a.slug === s.slug);
      if (!hydrated) return false;          // filtres actifs + slug inconnu du wiki → rejet
      return sourcePassesFilters(s, filters);
    })
  : sources;
if (validated.length !== sources.length) console.warn('[chat] sources hors filtres retirées');
```

Les sources violantes sont **retirées** (chips + persistance) ; le texte de la réponse
n'est pas réécrit (le prompt est la première ligne de défense, la validation est le
filet déterministe). Sans filtres actifs, le repli actuel (source non hydratée
conservée telle quelle) est maintenu.

### 6. Client (`web/types/index.ts`, `chat-stream-store.ts`, `ChatWindow.tsx`)

- `web/types/index.ts` : ajouter `export interface ChatStep { label: string; tool:
  string; path: string; }`.
- `web/lib/chat-stream-store.ts` : ajouter `steps: ChatStep[]` à `ConvState`
  (initialisé `[]` partout où `ConvState` est construit : défaut de `update`,
  `seedIfAbsent`, `hydrateFromDb`, début de `sendMessage`). Parsing NDJSON : branche
  `else if (evt.type === 'step')` → append `{ label, tool, path }`. Les steps ne
  déclenchent PAS `ensureAssistant()` (`loading` reste vrai jusqu'au premier delta).
  Sur `done`, `error` et dans le `finally` : `steps: []` (éphémère, pas de
  persistance v1).
- `web/components/chat/ChatWindow.tsx` : le bloc « Recherche dans le wiki… »
  (l.147-153) devient visible si `loading || (streaming && steps.length > 0)` et
  liste les steps dans l'ordre (une ligne par step, `text-xs text-gray-400`, icône
  lucide-react `BookOpen` pour `read_wiki_page` / `Folder` pour `list_wiki_folder`,
  dernier step en `text-gray-600`). Si le JSX grossit, extraire
  `components/chat/StepTrail.tsx`.
- `Message.tsx`, `SourceChip.tsx`, `RightPanel.tsx` : **aucun changement**.

### 7. Nettoyage

- **Supprimer `web/lib/chat-context.ts`** (avec lui disparaissent `MAX_SOURCES` et
  `CONTEXT_BUDGET`).
- `web/lib/wiki-query.ts` : retirer `import { getRelevantContext }` (l.13) et son
  re-export (l.29-30). `describeChatFilters`, `parseResponse`, `listSources`,
  `resolveType` **restent**.
- La route n'importe plus `getRelevantContext`.

### 8. Documentation

`docs/platform.md`, section chat : réécrire — supprimer la mention de
`chat-context.ts`, décrire la boucle agentique (`web/lib/chat-agent.ts`, outils
`read_wiki_page`/`list_wiki_folder`, cap 15, deadline), le protocole NDJSON
(`step`/`delta`/`done`/`error`), la validation dure des filtres
(`web/lib/chat-filters.ts`), la non-persistance des tool blocks et des steps,
`maxDuration 300`.

## Décisions

| Décision | Alternatives écartées | Raison |
|---|---|---|
| **Navigation pure par paliers** (outils lire/lister uniquement) | (a) Hybride : outils de requête structurés déterministes + navigation (recommandation initiale de Claude) ; (b) retrieval intelligent sans agent (un seul appel, code qui comprend la question) | Choix d'Arthur : fidélité à l'esprit du wiki et à la spec §7 — l'agent lit le wiki comme un humain. Le risque (dépendance aux vues dérivées faillibles) est couvert par le garde-fou de recoupement. |
| **Garde-fou recoupement : OUI** | Paliers stricts sans recoupement | Validé après clarification lister ≠ lire : lister le dossier = noms seulement (~200 tokens, négligeable), uniquement sur les énumérations. Cas réel justificatif : `by-date/2026/2026.md` annonce `resource_count: 13` pour 11 ressources listées. Sans recoupement, une vue qui oublie une fiche produit une réponse silencieusement incomplète. |
| **Étapes visibles en direct** | Simple indicateur d'activité | Choix d'Arthur : transparence, attente perçue plus courte, vérifiabilité de la navigation. |
| **Filtres panneau = contrainte dure** | Suppression du panneau ; panneau indicatif | Choix d'Arthur : comportement prévisible. Enforcement double : consigne stricte dans le prompt + validation déterministe serveur des SOURCES citées (les violantes sont retirées des chips et de la persistance). |
| **Pas de logique d'adaptation codée ; cap léger** | Modes profondeur codés (rapide/exhaustif) | Remarque d'Arthur, exacte : la profondeur découle de la question. Le seul élément codé est un disjoncteur (MAX_ITERATIONS = 15 + deadline) qui ne se déclenche qu'en anomalie (boucle infinie, timeout hébergeur). |
| **Wiki uniquement, jamais de connaissances générales** | Compléter avec les connaissances du modèle en le signalant | Choix d'Arthur : le chat est un miroir de sa veille ; zéro risque de confusion entre contenu de la base et savoir du modèle. Rien trouvé → le dire + `SOURCES: []`. |
| **Contenu des pages renvoyé verbatim (frontmatter + wikilinks conservés)** | Nettoyage `stripChunkAnnotations`/`wikilinksToMarkdown` | Le frontmatter porte les métadonnées exigées par SOURCES et les filtres ; les wikilinks portent les slugs de navigation. Les nettoyer détruirait l'information dont l'agent a besoin. |
| **tool_use/tool_result non persistés ; historique texte pur** | Persister les blocs d'outils | Simplicité v1 ; l'API accepte un historique assistant texte-seul ; coût = re-navigation éventuelle sur question de suivi (wiki petit, acceptable). La mémoire conversationnelle (préoccupation explicite d'Arthur, scénario « McKinsey 2026 » puis « et en 2025 ? ») est garantie par `getConversationHistory` inchangé — test E2E n°6 obligatoire. |
| **Steps éphémères (effacés à l'arrivée de la réponse)** | Persistance des steps en base | Simplicité v1 ; aucun besoin exprimé de relire la navigation a posteriori. |
| **`/raw` inaccessible à l'agent** | Palier 4 de la spec §7 (vérification fine dans les bruts) | v1 : les bruts sont volumineux/PDF ; seuls les `.meta.md` sont tracés en serverless. Le prompt fait dire à l'agent quand une vérification dans le brut serait nécessaire. |
| **SDK 0.39.0 conservé** | Upgrade @anthropic-ai/sdk | 0.39.0 supporte tools+streaming (vérifié dans les types installés). Boucle manuelle nécessaire de toute façon pour le NDJSON custom. Upgrade = churn sans gain. |
| **Nudge textuel de terminaison au cap** | Retirer `tools` de la requête pour forcer la réponse | Interdit par le contrat API (tools requis dès que l'historique contient des blocs tool_use). |
| **Sources hors filtres : retrait silencieux (chips/persistance) + console.warn** | Réécrire le texte de la réponse | Réécrire le texte généré est fragile ; le prompt est la première défense, la validation le filet. |

## Hors périmètre

- **Le graphe** : Arthur a explicitement validé le comportement actuel (nœud année →
  4 ressources directes + nœuds mois → le total 2026 fait bien 11). Aucun changement
  à `graph.json`, `GraphView.tsx`, `api/graph`.
- **Génération déterministe des vues dérivées et de `graph.json`** (recommandation n°2
  de l'audit) : non demandée ici. Le garde-fou de recoupement compense côté chat.
- **Renforcement de `wiki-verify`** (contrôles `year_of`, compteurs by-date, caractère
  bloquant en CI) : non demandé ici.
- **Recherche plein texte** dans le wiki : aucun outil `search` — navigation pure.
- **Prompt caching** (`cache_control` sur system+tools) : optimisation future notée,
  pas en v1 (proxy LiteLLM, gain incertain).
- **Persistance des steps** et des blocs tool_use/tool_result : non (v1).
- **Accès `/raw`** pour l'agent : non (v1).
- **Upgrade du SDK Anthropic** : non.
- **Uniformisation des trois sémantiques de date de l'app** (préfixe liste vs
  granularité graphe vs bornes chat) au-delà de `chat-filters.ts` : hors périmètre.

## Todo

- [x] **1. Module filtres purs** — créer `web/lib/chat-filters.ts` (`dateIntervalOf`,
  `sourcePassesFilters` selon §5) + `web/lib/__tests__/chat-filters.test.ts` (matrice
  dates mixtes × modes before/after/between, auteurs `unknown`, types
  dossier→ResourceType, origines) ; élargir le script test de `web/package.json` :
  `"test": "node --import tsx --test lib/__tests__/"` (si le runner ne découvre pas le
  dossier, lister les fichiers explicitement).
  **Vérif** : `npm test` dans `web/` — tous les tests passent, y compris l'existant
  `wiki-mutate.test.ts` ; cas clé : ressource datée `"2026"` passe un filtre
  `after 2026-03` (intersection d'intervalles).
- [x] **2. Outils wiki** — créer `web/lib/chat-agent.ts` (partie outils : défs
  `WIKI_TOOLS` + `executeWikiTool` avec normalisation, restriction `.md`,
  `wikiExists`, troncature `maxChars` injectable, filtrage du bruit dans les listings)
  + `web/lib/__tests__/wiki-tools.test.ts` exécuté contre le vrai `wiki/` du dépôt.
  **Vérif** : `npm test` — lecture `index.md` non vide ; `list_wiki_folder('resources')`
  = 13 noms ; chemin inexistant → `is_error` ; `../raw/x` et chemin absolu →
  `is_error` ; `graph.json` → `is_error` ; troncature effective avec `maxChars` bas.
- [x] **3. Boucle agentique** — compléter `chat-agent.ts` (`runWikiAgent`,
  `buildSystemPrompt` selon §2-§3) + `web/lib/__tests__/chat-agent.test.ts` avec
  client Anthropic mocké (objet `{ messages: { stream: () => fakeStream } }`,
  `fakeStream` = async-iterable d'événements + `finalMessage()`).
  **Vérif** : `npm test` — réponse directe sans outil (1 itération, deltas transmis) ;
  un tour tool_use puis réponse (step émis, tool_result avec le bon `tool_use_id`,
  écho assistant dans loopMessages) ; outil en erreur → boucle continue et aboutit ;
  cap → nudge injecté, terminaison ≤ MAX_ITERATIONS ; deux tool_use dans un tour →
  deux steps, un seul message user de résultats.
- [x] **4. Réécriture de la route** — `web/app/api/chat/route.ts` : brancher
  `runWikiAgent`, événement `step`, validation filtres dans `finalize()`,
  `max_tokens: 8000`, `maxDuration: 300`, `console.error` dans le catch (§4-§5).
  **Vérif** : `npm run build` sans erreur ; `npm run dev` + un message simple dans le
  chat → réponse streamée, événements `step` visibles dans l'onglet réseau (NDJSON),
  message persisté dans Supabase.
- [x] **5. Client steps** — `web/types/index.ts` (`ChatStep`),
  `web/lib/chat-stream-store.ts` (état `steps`, branche `step`, reset sur
  done/error/finally), `web/components/chat/ChatWindow.tsx` (affichage selon §6).
  **Vérif** : question d'énumération dans l'UI → les étapes s'affichent au fil de
  l'eau (« Lecture de index.md », …) puis disparaissent à l'arrivée de la réponse.
- [x] **6. Nettoyage** — supprimer `web/lib/chat-context.ts` ; purger le re-export
  dans `web/lib/wiki-query.ts` (l.13, l.29-30).
  **Vérif** : `npm run build` sans erreur ; `grep -r "chat-context\|getRelevantContext" web/`
  ne renvoie plus rien (hors éventuels commentaires de docs).
- [ ] **7. E2E manuel** (dans l'ordre — le point 0 est le risque n°1) :
  - [x] 0. **Sonde proxy LiteLLM** : premier message quelconque ; si erreur immédiate,
    le proxy bloque `tools` → diagnostiquer par curl direct avec `tools` sur
    `ANTHROPIC_BASE_URL` (vérifier `drop_params`/support tools du modèle).
  - [x] 1. « Qu'est-ce qui a été écrit en 2026 ? » → **11 ressources** citées
    (recoupement malgré le `resource_count: 13` faux du sommaire — test témoin).
  - [x] 2. « Qu'a écrit McKinsey ? » → **3 ressources**
    (`unlocking-value-ai-software-development`, `ai-revolution-software-development`,
    `rewiring-software-delivery-agentic-era`).
  - [x] 3. « Que dit McKinsey sur la transformation des équipes en 2026 ? » → les 2
    fiches McKinsey 2026, pas celle de 2025.
  - [x] 4. Question hors wiki (« Que penses-tu de Rust ? ») → le dit explicitement +
    `SOURCES: []`, rien d'inventé.
  - [x] 5. Filtre panneau `types=[articles]` + « liste les rapports PDF » → le filtre
    gagne ; aucune chip hors filtre (validation serveur).
  - [x] 6. **Suivi conversationnel** : « Quelles ressources écrites par McKinsey en
    2026 ? » puis « et en 2025 ? » dans la même conversation → l'agent comprend
    « McKinsey en 2025 » et cite `unlocking-value-ai-software-development` (2025-11).
  - [x] 7. UX : steps visibles puis effacés ; navigation ailleurs pendant le streaming
    puis retour → flux vivant ; messages + sources persistés dans Supabase ; 2e tour
    dans la même conversation OK (historique texte pur).
- [x] **8. Docs** — mettre à jour `docs/platform.md` (section chat, selon §8).
  **Vérif** : la section ne mentionne plus `chat-context.ts` ni le plafond de 6 ;
  décrit outils, boucle, protocole `step`, validation filtres.

## Bilan (2026-07-18)

**Fait.** Toute la todo (8 items + E2E 0-7) est implémentée et vérifiée :
54 tests automatisés passent (`npm test` : filtres, outils, boucle mockée),
`tsc --noEmit` et `npm run build` propres, batterie E2E complète contre le vrai
proxy LiteLLM (test témoin : la question 2026 cite bien les **11 ressources**,
avec recoupement visible `index → by-date/2026 → list resources → frontmatters`).
Suivi conversationnel, filtres durs, hors-wiki, persistance Supabase, steps UI
(affichés/effacés), navigation pendant streaming : tous conformes (vérifiés par
pilotage navigateur headless + captures).

**Déviations par rapport au plan :**

1. **`finalMessage()` abandonné au profit d'une reconstruction depuis les
   événements bruts** (`consumeTurn` dans `chat-agent.ts`). Prouvé nécessaire
   hors Next : le proxy LiteLLM clôt la connexion en « Premature close » APRÈS
   `message_stop` à CHAQUE stream — `finalMessage()` rejetait systématiquement
   alors que le message était complet (E2E 0 échouait). La reconstruction tolère
   l'erreur post-`message_stop` uniquement ; une erreur avant la fin du message
   remonte à la route comme prévu. Corollaire : les blocs texte vides émis par le
   proxy avant un tool_use sont écartés de l'écho assistant (l'API les refuse).
2. **Retry unique d'un flux mort-né** : le proxy tue parfois un stream à la
   racine (zéro événement, observé ~1 fois sur 8 questions). Comme la boucle
   fait N streams par question, l'exposition est multipliée → une retentative,
   uniquement si rien n'a été émis (invisible, pas de doublon possible). Testé.
3. **Script de test** : `node --test` ne découvre pas un dossier nu → motif
   `"lib/__tests__/*.test.ts"` (cas de repli prévu par la spec).

**Constat hors périmètre (préexistant, non corrigé)** : dans les ~30 s suivant
une navigation interne, le clic « Chat » de la sidebar peut retomber sur un chat
vide au lieu de la conversation active — cache client du routeur Next (30 s sur
les pages dynamiques) qui ressert le payload `/chat` d'avant la pose du cookie
`active_conversation`. Le flux, lui, survit bien (retour via Historique →
streaming en direct). Piste si gênant : `staleTimes` dans `next.config.js` ou
`router.refresh()` après la pose du cookie.

## Points de vigilance

- **LiteLLM + tools** : à valider en tout premier (E2E 0) ; filet = `catch`/`finalize`
  existant + `console.error` ajouté.
- **`maxDuration = 300`** : dépend du plan d'hébergement Vercel (Pro/Fluid) — à
  confirmer au déploiement ; repli 60 s avec `deadlineMs` ≈ 50 s documenté.
- **Narration pré-outil** : interdite par le prompt ; si bruyante en pratique, repli
  documenté : bufferiser le texte par itération et jeter celui des itérations
  terminées en `tool_use`.
- **Coût/latence attendus** : question ciblée ≈ 2-4 allers-retours (~10 s) ;
  énumération ≈ 5-8 (~20-40 s).
