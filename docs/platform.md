# Architecture de la plateforme web (`web/`)

Application Next.js 14 (App Router, TypeScript, Tailwind) qui expose le wiki et
le chat, **empaquetée en application de bureau Electron**. Principe directeur :
**markdown local = seule source de vérité du wiki**. L'historique de chat est le
seul état applicatif, stocké en **fichiers JSON locaux** (`web/lib/conversations-store.ts`),
plus aucune base externe. L'app **lit et écrit le wiki directement sur le disque local**.

Modèle **local-first** : chaque personne installe l'app de bureau et dispose de sa
propre instance et de son propre wiki EN LOCAL, sous une racine de données unique
`DATA_ROOT` = le dossier **`~/second-brain`** (dossier visible du dossier personnel :
`/Users/<nom>/second-brain` sur Mac, `C:\Users\<nom>\second-brain` sur Windows),
posé au 1er lancement. GitHub ne sert plus qu'à **distribuer les binaires** de l'app
(téléchargés à la main ; pas d'auto-updater en v1) — plus aucun commit, plus aucune API
GitHub pour les écritures.

---

## 1. Lecture du wiki

- Toutes les données vivent sous `DATA_ROOT` : `WIKI_ROOT = <DATA_ROOT>/wiki` et
  `RAW_ROOT = <DATA_ROOT>/raw` (dérivés dans `web/lib/wiki-fs.ts`). En dev,
  `DATA_ROOT` est la racine du dépôt (un cran au-dessus de `/web`) ; dans l'app
  packagée, la coquille Electron pointe `DATA_ROOT` vers `~/second-brain`.
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

**Un seul chemin d'authentification**, partagé par le chat ET l'ingestion : le client
`getAnthropic()` (`web/lib/claude.ts`, SDK `@anthropic-ai/sdk`) qui parle **uniquement
le protocole « Messages » d'Anthropic**, en auth **`x-api-key`**. La cible peut être
**Anthropic en direct** (`baseUrl` vide → `https://api.anthropic.com`) **ou une
passerelle compatible** (gateway LiteLLM d'entreprise, ex. `https://llm-gateway.m33.tech`).
Une clé/URL OpenAI ou Gemini ne fonctionne pas.

Le triplet **clé / adresse / modèle** vient du store de réglages `getAiSettings()`
(`web/lib/ai-settings.ts`, cf. §7), saisi par l'utilisateur sur l'écran **`/reglages`**
et **relu à chaud à chaque appel IA** (aucun redémarrage). Le client SDK est mémorisé
par signature `clé+URL` et reconstruit dès que l'une des deux change. `baseURL` est
toujours passé explicitement (sinon le SDK relit `process.env.ANTHROPIC_BASE_URL` et la
gateway du `.env.local` fuiterait dans le preset « Anthropic direct »).

> Historique : l'ingestion utilisait auparavant `@anthropic-ai/claude-agent-sdk` en
> **Bearer** (`ANTHROPIC_AUTH_TOKEN`). Depuis la refonte « IA + déterministe », elle
> fait un simple `messages.create` via le même client `x-api-key` que le chat — plus
> aucun `Bearer`, plus aucun `ANTHROPIC_AUTH_TOKEN` dans le code.

## 7. Réglages IA & variables d'environnement

Deux sources de configuration IA, le **store primant sur l'env** (`getAiSettings`,
`web/lib/ai-settings.ts`) :

- **Store de réglages** (voie normale de l'app) : `<DATA_ROOT>/.data/ai-settings.json`
  = `{ apiKey, baseUrl, model }`, écrit par l'écran **`/reglages`** (`POST /api/settings` ;
  test sans enregistrer via `POST /api/settings/test`) et relu **à chaud** (lecture
  synchrone à chaque appel IA). La clé y est **stockée en clair** — choix « Option A »
  assumé (app mono-utilisateur en local, dossier `.data/` non versionné) ; `safeStorage`
  a été envisagé mais n'est **pas** implémenté. L'UI ne réaffiche jamais la clé (juste un
  indice des 4 derniers caractères).
- **Variables d'environnement** (secours de dev) : lues depuis `web/.env.local` (gabarit
  propre `.env.local.example`) seulement si le store ne fournit pas la valeur.

Aucune clé n'est obligatoire pour démarrer et **lire** le wiki ; sans clé, seuls le chat
et l'ingestion sont désactivés.

| Variable | Usage |
|----------|-------|
| `ANTHROPIC_API_KEY` | Clé IA (chat + ingestion). Vide = chat/ingestion désactivés, le reste fonctionne |
| `ANTHROPIC_BASE_URL` | Cible : vide = Anthropic direct ; sinon une passerelle compatible (ex. `https://llm-gateway.m33.tech`) |
| `ANTHROPIC_MODEL` | Modèle (défaut `claude-sonnet-4-5`) |
| `DATA_ROOT` | Dossier de données (défaut dev : racine du dépôt ; en Electron : `~/second-brain`). Dérive `WIKI_ROOT`/`RAW_ROOT` |
| `WIKI_ROOT`, `RAW_ROOT` | Override direct des chemins wiki/raw (optionnel) |
| `REFERENCE_DOCS_ROOT` | Racine des assets de référence (le prompt d'ingestion ; défaut : racine du dépôt) |

## 8. Packaging Electron & distribution

La coquille Electron vit dans `electron/` (`electron/main.js` = process principal).
Au lancement elle : (0) **migre en douceur** les données de l'ancien emplacement caché
`userData` (versions < 0.2.0) vers `~/second-brain` si elles existent et que la cible est
absente (`migrateLegacyData` — copie une-fois, non destructive) ; (1) **amorce** le wiki
dans `~/second-brain` au 1er lancement (`seedIfEmpty` copie les seeds `wiki/`+`raw/`
embarqués **seulement s'ils sont absents** — idempotent, non destructif : une mise à jour
du code ne touche jamais les données) ; (2) lance le **serveur Next standalone** comme
process Node séparé sur un port local (`127.0.0.1`) ; (3) l'affiche dans une fenêtre, page
d'accueil `/chat`.

- **Données** : tout vit sous `DATA_ROOT = ~/second-brain` — dossier **visible** du dossier
  personnel (`/Users/<nom>/second-brain` sur Mac, `C:\Users\<nom>\second-brain` sur
  Windows) contenant `wiki/`, `raw/`, `.data/` (réglages IA en clair + historique de chat +
  `server.log`). « Local » ≠ « caché » : le choix du dossier visible facilite l'ouverture /
  la sauvegarde manuelle ; la confidentialité tient au fait que rien ne quitte la machine et
  que le dépôt GitHub est privé. La clé n'est **pas** injectée par la coquille — elle est
  saisie via `/reglages` et relue par le serveur.
- **Assets de référence** embarqués en lecture seule sous `REFERENCE_DOCS_ROOT`
  (`prompts/` + `docs/` + `CLAUDE.md`) ; seul le **prompt d'ingestion** y est lu au runtime.
- **Build** : `npm run dist` en local (→ `electron-builder`), OU — voie recommandée — le
  workflow **GitHub Actions `.github/workflows/build-desktop.yml`** (matrice `macos-14`
  arm64 + `windows-latest`) qui lance `npm run build:web` puis
  `npx electron-builder --publish never` et publie les installeurs en **artefacts
  téléchargeables** (pas de GitHub Release). Cibles : **`.dmg`** (macOS arm64, non signé —
  `identity: null`, `CSC_IDENTITY_AUTO_DISCOVERY=false` en CI) et **`.exe`** (Windows,
  installeur NSIS). Déclenchement : bouton « Run workflow » ou push d'un tag `v*`.
- **Pas d'authentification** : accès direct, sans login (le mot de passe partagé a été
  retiré — app locale mono-utilisateur).
- **Mises à jour** : **pas d'auto-updater en v1**. Distribution par **téléchargement
  manuel** du `.dmg`/`.exe` (artefacts du run Actions, déposés sur un Drive partagé) ;
  GitHub n'héberge plus de contenu wiki et ne reçoit plus aucun commit d'écriture.
