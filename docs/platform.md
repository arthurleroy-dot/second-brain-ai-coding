# Architecture de la plateforme web (`web/`)

Application Next.js 14 (App Router, TypeScript, Tailwind) qui expose le wiki et
le chat, **empaquetée en application de bureau Electron**. Principe directeur :
**markdown local = seule source de vérité du wiki**. L'historique de chat est le
seul état applicatif, stocké en **fichiers JSON locaux** (`web/lib/conversations-store.ts`),
plus aucune base externe. L'app **lit et écrit le wiki directement sur le disque local**.

Modèle **local-first** : chaque personne installe l'app de bureau et dispose de sa
propre instance et de son propre wiki EN LOCAL, sous une racine de données unique
`DATA_ROOT` (le dossier de données utilisateur d'Electron, `userData`). GitHub ne
sert plus qu'à **distribuer les mises à jour** de l'app (auto-updater Electron) —
plus aucun commit, plus aucune API GitHub pour les écritures.

---

## 1. Lecture du wiki

- Toutes les données vivent sous `DATA_ROOT` : `WIKI_ROOT = <DATA_ROOT>/wiki` et
  `RAW_ROOT = <DATA_ROOT>/raw` (dérivés dans `web/lib/wiki-fs.ts`). En dev,
  `DATA_ROOT` est la racine du dépôt (un cran au-dessus de `/web`) ; dans l'app
  packagée, la coquille Electron pointe `DATA_ROOT` vers `userData`.
- Le contenu est toujours **frais sans base intermédiaire ni sync** : l'ingestion
  locale écrit sur le même disque que celui que l'app lit.
- Les pages lisent le filesystem à la requête via `web/lib/wiki-fs.ts` (garde
  anti path-traversal : `resolveUnder` borne chaque accès à `WIKI_ROOT`/`RAW_ROOT`).
  Le parsing des ressources/vues/graph vit dans `web/lib/wiki-parser.ts` ;
  `web/lib/wiki-query.ts` est la façade de lecture.
- `web/next.config.js` ne contient plus de configuration spécifique à un hébergeur
  serverless : seulement `serverComponentsExternalPackages: ['gray-matter']` et,
  en dev uniquement, `webpack: config.cache = false` (contourne un bug de cache
  disque webpack sous Node récent). Override possible des chemins via `DATA_ROOT`,
  `WIKI_ROOT`, `RAW_ROOT`.

## 2. PDFs et binaires

Les binaires (`raw/*.pdf`, `.pptx`, `.docx`) sont servis par le proxy
`web/app/api/raw/[...file]/route.ts` qui lit le fichier **directement sur le
disque local** sous `RAW_ROOT` et le streame (basename seulement, anti-traversal ;
`?download=1` force le téléchargement). Aucun accès réseau.

## 3. Upload → écriture locale dans `/raw`

Toutes les écritures se font sur le **disque local** via `web/lib/wiki-fs.ts` :

- `applyFileOps(ops)` applique une liste d'opérations `WriteOp` (upsert `content`
  ou `delete: true`) en **écriture atomique** (fichier temporaire dans le même
  dossier puis `rename`). **Garde-fou en dur** : seuls les chemins repo-relatifs
  sous `wiki/` ou `raw/` sont autorisés ; tout autre préfixe fait échouer le lot
  entier **avant** la première écriture (validation de tous les chemins d'abord).
- `web/app/api/upload/route.ts` valide (extensions, taille ≈50 Mo), résout un nom
  libre via `resolveAvailableRawName` (collision → suffixe `-2`, `-3`…), construit
  le sidecar `.meta.md` (voir [ingestion.md](ingestion.md) §2) et écrit en un lot
  `raw/<source>` + `raw/<source>.meta.md` via `applyFileOps`. Le fichier de contenu
  reste byte-identique (raw immuable).
- En fin d'upload, la route **déclenche l'ingestion en arrière-plan**
  (`runIngestion()` de `web/lib/ingest-local.ts`, non bloquant pour la réponse
  HTTP ; no-op si une ingestion tourne déjà — verrou). Voir [ingestion.md](ingestion.md) §4.

## 4. Statut d'ingestion côté UI

`web/app/api/ingest-status/route.ts?file=<nom>` renvoie un état **100 % local** :

1. **`ingested`** — le fichier est présent dans `wiki/_ingested.json` (lu sur
   disque) ; fournit le slug → lien vers la fiche.
2. **`processing`** — une ingestion locale tourne (état `running` dans
   `ingest-state.json` ou verrou `ingest.lock` tenu).
3. **`error`** — le dernier run local a échoué (message dans `error`).
4. **`pending`** — déposé, pas encore ingéré.

Relance manuelle : `POST /api/ingest` (bouton de l'UI) lance `runIngestion()` en
arrière-plan si aucune ingestion n'est en cours, puis renvoie l'état courant.

## 5. Chat

Le chat est un **agent** qui navigue lui-même dans le wiki markdown par paliers
(docs/wiki-spec.md §7) — aucun contexte pré-construit.

- **Boucle agentique** (`web/lib/chat-agent.ts`) : `runWikiAgent` enchaîne des
  appels streamés (`max_tokens: 8000`) avec deux outils — `read_wiki_page`
  (contenu verbatim, frontmatter inclus, tronqué à 30 000 caractères ; `.md`
  uniquement) et `list_wiki_folder` (noms seulement, bruit filtré) — sécurité
  chemin déléguée à `resolveUnder` (`wiki-fs.ts`), `/raw` inaccessible.
  Disjoncteurs : `MAX_ITERATIONS = 15` + deadline absolue (~280 s) → nudge
  textuel forçant la réponse (`tools` jamais retiré de la requête). Le message
  final de chaque tour est reconstruit depuis les événements bruts : le proxy
  LiteLLM clôt souvent le flux en « Premature close » APRÈS `message_stop`
  (toléré) ; un flux mort sans aucun événement est retenté une fois.
  `buildSystemPrompt` impose : wiki seul (jamais les connaissances du modèle,
  sinon le dire + `SOURCES: []`), recoupement `list_wiki_folder` sur les
  énumérations (les vues dérivées peuvent être fausses ; le frontmatter des
  fiches fait foi), réponse terminée par la ligne `SOURCES: [...]`.
- **Route** (`web/app/api/chat/route.ts`, `maxDuration: 300`) : serveur local
  long-vécu (Electron / `next start`), pas de limite serverless ; le vrai
  garde-temps est le `deadlineMs` passé à `runWikiAgent`. Protocole NDJSON
  `step` (une étape de navigation par outil exécuté) / `delta` / `done` /
  `error`. Le bloc `SOURCES:` est masqué du flux (`emittableLength`), parsé à la
  fin, hydraté par slug sur l'index fs, puis **validé dur contre les filtres du
  panneau** (`web/lib/chat-filters.ts`, intersection d'intervalles pour les
  dates à granularité mixte) : les sources hors filtres sont retirées des chips
  et de la persistance (le texte n'est pas réécrit). Conversations et messages
  sont persistés **localement** via `web/lib/conversations-store.ts` (un fichier
  JSON par conversation) ; les blocs tool_use/tool_result et les steps ne sont
  PAS persistés (l'historique renvoyé au modèle est texte pur).
- **Client** : `chat-stream-store.ts` accumule `steps` (éphémères, effacés sur
  `done`/`error`) ; `ChatWindow` les affiche en direct (« Lecture de … »)
  pendant la génération.

### Historique de chat local (`web/lib/conversations-store.ts`)

Un fichier JSON par conversation sous `<DATA_ROOT>/.data/conversations/<id>.json`
(`{ id, title, created_at, updated_at, messages: Message[] }`). Mêmes signatures
que l'ancien helper de persistance (`createConversation`, `listConversations`,
`getConversation`, `getConversationHistory`, `saveMessage`,
`renameConversationIfDefault`) — seuls les imports des appelants ont changé.
Écriture atomique dédiée (temp + rename) ; `.data/` est **hors** `wiki/`/`raw/`,
donc hors du garde-fou d'`applyFileOps` (à dessein). Routes historiques :
`GET/POST /api/conversations`, `GET /api/conversations/[id]`.

## 6. Accès IA

L'accès au modèle passe par la **gateway LiteLLM de l'entreprise**
(`https://llm-gateway.m33.tech`), avec une **clé partagée par les employés** (pas
de clé Anthropic personnelle). Deux chemins d'authentification distincts :

- **Chat** (`web/lib/claude.ts`, SDK `@anthropic-ai/sdk`) : s'authentifie en
  `x-api-key` (`ANTHROPIC_API_KEY`) sur `baseURL = ANTHROPIC_BASE_URL` (la
  gateway). Suffisant pour la lecture/chat.
- **Ingestion** (`web/lib/ingest-local.ts`, SDK `@anthropic-ai/claude-agent-sdk`) :
  s'authentifie en **Bearer** via `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL`
  (le SDK Agent exige le token Bearer, cf. `tasks/lessons.md` 2026-07-09).

## 7. Variables d'environnement

Aucune clé n'est obligatoire pour que l'app démarre et lise le wiki. En dev, elles
sont lues depuis `web/.env.local` (voir `.env.local.example`) ; dans l'app Electron,
elles sont fournies par l'écran de réglages (clé chiffrée via `safeStorage`) et
injectées dans `process.env` à l'exécution.

| Variable | Usage |
|----------|-------|
| `ANTHROPIC_API_KEY` | Clé de la gateway LiteLLM (chat + ingestion). Vide = chat/ingestion désactivés, le reste de l'app fonctionne |
| `ANTHROPIC_BASE_URL` | URL de la gateway (défaut d'exemple : `https://llm-gateway.m33.tech`) |
| `ANTHROPIC_MODEL` | Modèle routé par la gateway (défaut `claude-sonnet-4-6`) |
| `DATA_ROOT` | Dossier de données de l'app (défaut dev : racine du dépôt). Dérive `WIKI_ROOT`/`RAW_ROOT` |
| `WIKI_ROOT`, `RAW_ROOT` | Override direct des chemins wiki/raw (optionnel) |
| `REFERENCE_DOCS_ROOT` | Racine des assets de référence (prompt + docs injectées à l'ingestion ; défaut : racine du dépôt) |

## 8. Packaging Electron & accès

- **Application de bureau Electron** : chaque utilisateur a sa propre instance et
  son propre wiki local sous `DATA_ROOT` (`userData`). Les assets de référence
  (prompt d'ingestion + `docs/` injectées) sont embarqués en lecture seule
  (`REFERENCE_DOCS_ROOT`).
- **Pas d'authentification** : accès direct à l'app, sans login (la protection par
  mot de passe partagé a été retirée — l'app tourne en local pour un seul utilisateur).
- **Mises à jour** : GitHub distribue les releases de l'app (auto-updater Electron) ;
  il n'héberge plus de contenu wiki et ne reçoit plus aucun commit d'écriture.
