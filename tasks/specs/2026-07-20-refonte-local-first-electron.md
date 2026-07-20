# Refonte local-first — Application de bureau Electron + clé API par personne

## Contexte

Le projet (wiki de veille AI coding + plateforme Next.js dans `web/`) vit
aujourd'hui en **centralisé** : dépôt GitHub partagé, GitHub Action d'ingestion,
déploiement Vercel, Supabase pour l'historique de chat, auth par mot de passe.
Chaque écriture (upload d'une ressource, arbitrage entité/thème, suppression) passe
par un **commit sur l'API GitHub** ; l'ingestion `raw/` → `wiki/` est un agent
Claude Code lancé par la GitHub Action.

**Demande d'origine de l'utilisateur (Arthur, non-développeur, décide du QUOI) :**
changement total de direction. Chacun aura **sa propre application et sa propre
version qui tourne en local**. On distribue un exécutable ; chacun télécharge, ouvre
l'app, et dépose ses ressources — l'ingestion, les décisions de création/fusion/rejet
d'entités et de thèmes, et le chat se font **en local, dans le dossier `wiki/` sur sa
machine**, sans terminal, sans session Claude Code externe, sans serveur commun.
GitHub ne sert plus qu'à la distribution.

Cette spec fige le plan validé. Elle est destinée à l'agent qui implémentera dans une
session vierge : **précision technique maximale, aucune vulgarisation.**

**État du code au moment de la spec (working tree `feat/deterministic-wiki-mutate`) :**
- La **lecture** du wiki est déjà 100 % filesystem local (`web/lib/wiki-fs.ts`,
  `WIKI_ROOT`/`RAW_ROOT`). Toutes les routes GET lisent le disque.
- `web/lib/wiki-mutate.ts` est **pur** (renvoie des `FileOp[]`, aucune I/O), testé
  dans `web/lib/__tests__/wiki-mutate.test.ts`. **NE PAS LE MODIFIER.**
- Le chat est **déjà une boucle agentique** (`web/lib/chat-agent.ts` : outils
  `read_wiki_page` / `list_wiki_folder`, `@anthropic-ai/sdk` `messages.stream`,
  streaming NDJSON `{delta|step|done|error}`). `web/lib/chat-context.ts` est **déjà
  supprimé**. Le chat lit le wiki via `wiki-fs`.
- `web/scripts/wiki-verify.ts` est **déjà 100 % local**, sans réseau.
- `web/lib/claude.ts` pointe le client Anthropic vers une **gateway LiteLLM**
  (`ANTHROPIC_BASE_URL`), modèle défaut `claude-sonnet-4-6`.

---

## Plan

*(Contenu intégral du plan validé — v2.)*

### Décisions actées avec Arthur (v2)
1. Coéquipiers **non techniques**. **Mac ET Windows.**
2. **Tout depuis l'application ouverte** — aucune session Claude Code, aucun
   terminal. L'app appelle directement l'IA d'Anthropic via une **clé API**.
3. **Accès IA : chacun colle SA propre clé API** (créée sur console.anthropic.com),
   saisie une fois dans l'app, stockée de façon chiffrée sur sa machine. Elle
   alimente **l'ingestion ET le chat**. Coût réparti, aucune clé partagée.
4. **Vraie application packagée** : Windows `.exe`, Mac `.app` livrée dans un `.dmg`.
   Techno : **Electron**. Un double-clic, l'app s'ouvre.
5. **Historique de chat par personne, en local** — un fichier par conversation dans
   le dossier de données de l'app. **Plus de Supabase.**
6. **Mise à jour = bouton dans l'app** (auto-updater) : remplace le code de l'app,
   **jamais** le wiki, les ressources brutes, l'historique ni la clé.
7. **Wiki pré-rempli** avec le contenu actuel (13 ressources) au premier lancement.
8. **On débranche tout l'ancien modèle** : Action d'ingestion, Vercel, Supabase,
   auth mot de passe — supprimés.

### Conséquence intégrée : séparation app / données (automatique)
La contrainte « tout dans un seul dossier » est **levée** par le choix « vraie app ».
Le code de l'app est en lecture seule (dans `/Applications` ou `Program Files`) ; les
données modifiables vivent dans l'emplacement standard de données de l'app
(`~/Library/Application Support/SecondBrain/` sur Mac, `%APPDATA%\SecondBrain\` sur
Windows), géré par l'app, invisible pour l'utilisateur. C'est cette séparation qui
rend le bouton « Mettre à jour » sûr (remplace le code, jamais les données).

### Architecture d'accès à l'IA
- **Chat** : appels à l'**API Messages** d'Anthropic via `@anthropic-ai/sdk` (déjà
  en place dans `web/lib/chat-agent.ts`), authentifiés par la **clé de la personne**.
  On retire la gateway LiteLLM et on branche la clé. Zéro réécriture du chat.
- **Ingestion** : agent autonome qui écrit des fichiers, via
  **`@anthropic-ai/claude-agent-sdk`** (Claude Code packagé en librairie, embarqué
  dans l'app — **pas** le CLI `claude` externe), authentifié par la **clé de la
  personne**. Outils d'écriture **scopés au dossier `wiki/`**. Remplace `claude -p` +
  la GitHub Action.

### Chantier transversal — Gestion de la clé API
- **Saisie :** écran de réglages dans l'app ; au 1er lancement sans clé, on guide
  (lien console.anthropic.com + captures) et on fait coller la clé.
- **Stockage :** chiffré via `safeStorage` d'Electron (keychain OS), dans le dossier
  de données. La clé ne quitte jamais la machine sauf vers l'API Anthropic.
- **Injection :** fournie à l'exécution aux appels chat (`@anthropic-ai/sdk`) et à
  l'agent d'ingestion (`@anthropic-ai/claude-agent-sdk`) via l'environnement du
  process. Jamais écrite dans le repo ni dans `wiki/`/`raw/`.
- **Validation :** bouton « Tester la clé » (petit appel API) avant d'ingérer.

### Phase 0 — POC de dé-risquage (bloquant)
Prouver que l'agent d'ingestion tourne **embarqué + clé API + sans binaire
`claude`** et écrit correctement dans un dossier `wiki/` de test. Vérif : une
ressource test `raw/` → ressource + vues + `graph.json` + `_ingested.json` corrects ;
`wiki-verify` propre ; aucun accès réseau autre que l'API Anthropic ; aucune
dépendance externe. Si KO → repli boucle d'outils maison (`@anthropic-ai/sdk`).

### Phase 1 — Couche d'écriture locale (remplacer GitHub)
`web/lib/wiki-fs.ts` : ajouter `applyFileOps(ops)` (écrit/supprime, `mkdir -p`,
`writeFileAtomic` temp+rename, garde-fou « sous `wiki/` ou `raw/` » uniquement),
`readRepoFile`, `readRepoBinary`, `repoPathExists`, `resolveAvailableRawName`.
Racines `WIKI_ROOT`/`RAW_ROOT` dérivées d'un `DATA_ROOT` (dossier de données de
l'app). Atomicité par fichier + `wiki-verify` en filet. Remplacer
`commitFiles`→`applyFileOps` et `fetchRepoFileRaw`→`readRepoFile` dans les routes
d'écriture ; retirer les gardes `isGithubConfigured`→503 ; retirer le repli GitHub de
`raw/[...file]`. **Supprimer `web/lib/github.ts`.** `wiki-mutate.ts` inchangé.

### Phase 2 — Historique chat local (retrait Supabase)
Créer `web/lib/conversations-store.ts` (mêmes signatures que `supabase.ts`), un
fichier JSON par conversation. Modifier les 4 sites d'import Supabase. Supprimer
`web/lib/supabase.ts` et `web/supabase/`.

### Phase 3 — Chat sur clé API perso (retrait gateway)
`web/lib/claude.ts` : retirer la gateway LiteLLM ; client authentifié par la clé
perso ; modèle depuis les réglages. `chat-agent.ts` conservé (seul le client change).
Retirer `@supabase/supabase-js` du `package.json`.

> **⚠️ Coût d'ingestion — traité SÉPARÉMENT (décision Arthur 2026-07-20).**
> Le POC a mesuré **6,64 $ / 375 s / 65 tours / 33 écritures** pour ingérer UNE
> ressource (gateway → Sonnet 4.5). Objectif fixé par Arthur : **quelques centimes**.
> L'optimisation fera l'objet d'une **spec dédiée + plan en session neuve**, AVANT
> l'implémentation réelle de la Phase 4. En attendant, Phase 4 est implémentée « telle
> quelle » (prompt déplacé/adapté, mécanique locale) mais NON optimisée. Voir le
> paragraphe de passation ci-dessous.
>
> **Contexte pour la spec « ingestion pas chère » :** le coût vient de l'**empilement
> du contexte** dans la boucle agentique. À chaque tour (65 au total), tout l'historique
> est renvoyé au modèle ; l'agent a lu de gros fichiers (`docs/*`, `graph.json`,
> `index.md`) qui restent en contexte, et a édité lui-même ~25 **vues dérivées**
> (authors/, themes/, entities/ mentions, by-date/, types.md, origin/, index.md,
> graph.json, _ingested.json, log.md) — chaque édit = un tour. Or ces vues sont
> **entièrement déductibles** du frontmatter de `wiki/resources/<slug>.md`.
> **Piste recommandée :** faire de l'ingestion un split « IA + déterministe » —
> l'IA ne produit QUE la page ressource (frontmatter + corps paraphrasé + annotations
> chunk) et la détection entités/thèmes ; une **nouvelle** fonction déterministe
> `projectResource(...)` (SYMÉTRIQUE de `deleteResource` déjà dans `wiki-mutate.ts`)
> reconstruit toutes les vues. Cible ~3 tours au lieu de 65 → quelques centimes.
> **Contraintes :** NE PAS modifier `wiki-mutate.ts` (moteur figé/testé) — ajouter un
> module/une fonction ; sortie validée par `wiki:verify` ; formats dans
> `docs/wiki-spec.md` + `docs/entities.md` ; `deleteResource` est la référence des
> formats de vue. **Leviers secondaires :** injecter les règles au lieu de faire lire
> `docs/`/`CLAUDE.md` ; interdire la lecture de `graph.json`/`index.md` ; éventuellement
> router vers un modèle moins cher (Haiku) pour l'ingestion. **À mesurer d'emblée :**
> le coût réel sur un run de test + le `usage` (dont tokens de cache) — et **vérifier
> que le prompt caching passe bien à travers la gateway LiteLLM** (s'il ne passe pas,
> c'est un driver majeur du coût).

### Phase 4 — Ingestion locale (remplacer la GitHub Action)
Ajouter `@anthropic-ai/claude-agent-sdk`. Déplacer le prompt d'ingestion et le
scoping. Créer `web/lib/ingest-local.ts` (`detectPending`, `IngestState`,
`read/writeIngestState`, `acquireLock/releaseLock`, `runIngestion`). Déclenchement
auto en fin d'upload + bouton relance manuelle (route `web/app/api/ingest/route.ts`).
Réécrire `ingest-status/route.ts` (état local). Supprimer
`.github/workflows/ingest.yml`.

### Phase 5 — Nettoyage ancien modèle
Supprimer `middleware.ts`, `lib/auth.ts`, `api/auth/route.ts`, `app/login/page.tsx`,
`web/supabase/`, `web/lib/github.ts`, `ingest.yml`. `next.config.js` : retirer les
réglages Vercel. `.env.local.example` : réduit, aucune clé obligatoire. Docs mises à
jour.

### Phase 6 — Application de bureau Electron (.exe / .app)
Coquille Electron lance Next.js embarqué + fenêtre. Dossier de données via
`app.getPath('userData')`. Premier lancement : copier le wiki pré-rempli s'il est
vide. Écran réglages (clé API + modèle + test). `electron-builder` → `.exe` / `.dmg`.
Auto-updater (`electron-updater`) sur Releases GitHub. Signature : décision Arthur.
Guide `GUIDE.md`.

### Phase 7 — Vérification de bout en bout
POC ; saisie clé + test ; upload → ingestion → wiki à jour ; arbitrage entité+thème ;
suppression ; chat (streaming, `SOURCES:`, historique local) ; mise à jour (données
intactes) ; invariants.

### Invariants à préserver
`raw/` immuable (hors suppression via `wiki-mutate`) ; l'agent d'ingestion n'écrit que
sous `wiki/` ; `_ingested.json` = idempotence ; canonique vs vues dérivées ; slugs
immuables ; `wiki-verify` = filet ; `wiki-mutate.ts` pur et non modifié.

---

## Détails techniques (relevés dans le code réel — à respecter à l'implémentation)

### `web/lib/wiki-fs.ts` (état actuel)
- `WIKI_ROOT = process.env.WIKI_ROOT ?? path.resolve(process.cwd(), '..', 'wiki')`
- `RAW_ROOT  = process.env.RAW_ROOT  ?? path.resolve(process.cwd(), '..', 'raw')`
- `resolveUnder(root, relPath)` : garde anti path-traversal (à **réutiliser**).
- Fonctions existantes conservées : `readWikiFile`, `listWikiDir`, `listWikiSubdirs`,
  `wikiExists`, `rawExists`.
- **Code mort à supprimer** : `writeWikiFile`, `writeRaw` (jamais importés).

**Ajouts Phase 1** (racine commune + applicateur) :
```ts
export const DATA_ROOT = process.env.DATA_ROOT ?? path.resolve(process.cwd(), '..');
export const WIKI_ROOT = process.env.WIKI_ROOT ?? path.join(DATA_ROOT, 'wiki');
export const RAW_ROOT  = process.env.RAW_ROOT  ?? path.join(DATA_ROOT, 'raw');

export type WriteOp =
  | { path: string; content: Buffer | string }   // path repo-relatif : "wiki/..." ou "raw/..."
  | { path: string; delete: true };

// Écrit/supprime une série d'ops. Garde-fou en dur : chaque path DOIT commencer
// par "wiki/" ou "raw/". Écriture atomique par fichier (temp + rename). unlink
// ignore ENOENT. Appliquer dans l'ordre reçu (wiki-mutate ordonne déjà).
export async function applyFileOps(ops: WriteOp[]): Promise<void>;

export async function readRepoFile(repoRel: string): Promise<string | null>;   // utf-8, null si absent
export async function readRepoBinary(repoRel: string): Promise<Buffer | null>;
export async function repoPathExists(repoRel: string): Promise<boolean>;
export async function resolveAvailableRawName(name: string): Promise<string>;   // teste raw/<name> sur fs, suffixe -2,-3…

async function writeFileAtomic(abs: string, data: Buffer | string): Promise<void>; // temp + rename même volume
```
- Les `FileOp[]` de `wiki-mutate` (`{path, content: string} | {path, delete}`) sont
  un **sous-type** de `WriteOp[]` → passables directement à `applyFileOps`.
- `readRepoFile('wiki/entities/_candidates.json')` remplace
  `fetchRepoFileRaw('wiki/entities/_candidates.json')` (chemin repo-relatif COMPLET,
  avec le préfixe `wiki/` ou `raw/`, contrairement à `readWikiFile` qui prend un
  chemin SANS `wiki/`).

### `web/lib/github.ts` (à SUPPRIMER entièrement en Phase 1/5)
Exports actuels à faire disparaître (avec leurs sites d'appel) : `githubRepo`,
`githubBranch`, `githubToken`, `isGithubConfigured`, `RawFetchResult`,
`fetchRepoFileRaw`, `repoPathExists`, `resolveAvailableRawName`, `FileToCommit`,
`commitFiles`, `fetchIngestManifest`, `dispatchIngest` (déjà mort), `hasActiveIngestRun`.

### Routes à modifier (importent `@/lib/github`)
- `web/app/api/upload/route.ts` — `resolveAvailableRawName` (local) ;
  `applyFileOps([{path:'raw/<name>',content:buffer},{path:'raw/<name>.meta.md',content:sidecar}])` ;
  puis **spawn de l'ingestion en arrière-plan** (Phase 4). Retirer la garde 503.
  Conserver toute la construction du sidecar (`buildSidecar`, `parseLinks`,
  `parseGranularity`, `parseThemes`).
- `web/app/api/candidates/resolve/route.ts` — lectures d'état via `readRepoFile`
  (candidates.json, graph.json, resources de `seen_in`, page entité cible) ;
  `applyEntityDecision(...)` (pur, inchangé) + `applyFileOps(ops)`. Retirer
  `commit_sha` de la réponse.
- `web/app/api/theme-candidates/resolve/route.ts` — idem avec `applyThemeDecision`.
- `web/app/api/sources/[slug]/route.ts` (DELETE) — lectures via `readRepoFile`,
  `repoPathExists` (local) pour le sidecar, `deleteResource(...)` + `applyFileOps`.
  Notion `[skip ci]` supprimée (plus de commit). `unlink` ENOENT-safe rend le garde
  `repoPathExists` avant delete facultatif.
- `web/app/api/raw/[...file]/route.ts` — retirer l'import `fetchRepoFileRaw` et le
  bloc « repli GitHub » ; 404 direct si `fs.readFile(RAW_ROOT/name)` échoue.
- `web/app/api/ingest-status/route.ts` — réécrite en Phase 4 (état local).

### `web/lib/supabase.ts` → `web/lib/conversations-store.ts` (Phase 2)
Signatures à **répliquer à l'identique** (mêmes noms/paramètres) pour ne toucher
qu'aux imports des appelants :
```ts
createConversation(title = 'Nouvelle discussion'): Promise<Conversation | null>
listConversations(): Promise<Conversation[]>                       // tri updated_at desc
getConversation(id: string): Promise<Conversation | null>
getConversationHistory(conversationId: string): Promise<{ role:'user'|'assistant'; content:string }[]>
saveMessage(conversationId: string|null, role:'user'|'assistant', content: string, sources: Source[]): Promise<void>
renameConversationIfDefault(conversationId: string|null, firstUserMessage: string): Promise<void>
```
- Types `Conversation`, `Message`, `Source` définis dans `web/types/index.ts`
  (lignes 73, 61, 17). Réutiliser ces types.
- Format fichier : `<DATA_ROOT>/.data/conversations/<id>.json` =
  `{ id, title, created_at, updated_at, messages: Message[] }`. `id =
  crypto.randomUUID()`. Écritures atomiques (temp+rename). `saveMessage` met à jour
  `updated_at`. `renameConversationIfDefault` renomme si `title === 'Nouvelle
  discussion'` (titre = `firstUserMessage.slice(0,60)`).
- Sites d'import à basculer (`@/lib/supabase` → `@/lib/conversations-store`) :
  `web/app/chat/[id]/page.tsx`, `web/app/api/chat/route.ts`,
  `web/app/api/conversations/route.ts`, `web/app/api/conversations/[id]/route.ts`.
- **Supprimer** `web/lib/supabase.ts` et le dossier `web/supabase/`.

### `web/lib/claude.ts` (Phase 3)
État actuel :
```ts
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? '',
  baseURL: process.env.ANTHROPIC_BASE_URL || undefined,   // gateway LiteLLM — à RETIRER
});
export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
export function isClaudeConfigured(): boolean { return Boolean(process.env.ANTHROPIC_API_KEY); }
```
Cible : retirer `baseURL` (appel direct API Anthropic) ; `apiKey` = **clé perso**
injectée par la coquille Electron dans `process.env.ANTHROPIC_API_KEY` à l'exécution
(depuis le stockage chiffré `safeStorage`). `CLAUDE_MODEL` piloté par le réglage
« modèle » de l'app (défaut à choisir, ex. `claude-sonnet-4-6`). `chat-agent.ts`
importe `anthropic` et `CLAUDE_MODEL` → inchangé.

### Ingestion — `web/lib/ingest-local.ts` (Phase 4)
Assets déplacés depuis `.github/` : `prompts/ingest-prompt.md` (9,8 Ko, à **adapter**
pour l'ingestion locale — cf. Décisions §D5) et le scoping « écrit seulement sous
`wiki/` » (aujourd'hui `.github/ingest-settings.json`) porté par les options du SDK
Agent.
```ts
export async function detectPending(): Promise<string[]>;  // readdir(RAW_ROOT) - README - *.meta.md - clés _ingested.json (100% TS, remplace find|comm|jq)
export interface IngestState { status:'idle'|'running'|'done'|'error'; startedAt?:string; finishedAt?:string; pending?:string[]; slug?:string; error?:string; logTail?:string }
export async function readIngestState(): Promise<IngestState>;      // <DATA_ROOT>/.data/ingest-state.json
export async function writeIngestState(s: IngestState): Promise<void>;
export function acquireLock(): boolean;                             // <DATA_ROOT>/.data/ingest.lock (O_EXCL)
export function releaseLock(): void;
export async function runIngestion(): Promise<void>;               // lock → detectPending → agent SDK → wiki:verify → état
```
- `runIngestion` : `acquireLock` (sinon no-op) ; `detectPending` (vide → `done`) ;
  lance l'agent via `@anthropic-ai/claude-agent-sdk` (`cwd = DATA_ROOT`, outils
  Read/Glob/Grep + Write/Edit **scopés `wiki/`**, permission « accepte les écritures
  sans demander », `ANTHROPIC_API_KEY` = clé perso injectée) ; logs →
  `<DATA_ROOT>/.data/ingest.log` ; puis `wiki:verify` (non bloquant, `logTail`) ;
  `writeIngestState` ; `releaseLock`. Échec → `status:'error'` visible dans l'UI.
- **Déclenchement auto** : dans `upload/route.ts`, après `applyFileOps`, lancer
  `runIngestion()` en arrière-plan (ne pas bloquer la réponse HTTP).
- **Relance manuelle** : `web/app/api/ingest/route.ts` (POST → `runIngestion()` si
  lock libre).
- `web/app/api/ingest-status/route.ts` réécrite : lit `readIngestState()` + présence
  du lock → `{state, slug?, error?}`. Retirer `fetchIngestManifest` /
  `hasActiveIngestRun` / `isGithubConfigured`.
- **Noms exacts d'API du SDK Agent** (`query`, options `cwd`/`allowedTools`/
  `disallowedTools`/`systemPrompt`/`permissionMode`/`canUseTool`, auth via
  `ANTHROPIC_API_KEY`) : **confirmer sur la doc du SDK au moment du POC** (Phase 0)
  via la skill `claude-api` / docs officielles — ne pas deviner les signatures.

### `web/next.config.js` (Phase 5)
- **Retirer** `experimental.outputFileTracingIncludes` et
  `experimental.outputFileTracingRoot` (spécifiques Vercel/monorepo — inutiles quand
  wiki/raw vivent dans le dossier de données de l'app).
- **Conserver** `serverComponentsExternalPackages: ['gray-matter']` et le
  `webpack: config.cache = false` en dev (fix Node récent — cf. `tasks/lessons.md`).

### `web/package.json`
- Retirer : `@supabase/supabase-js` (^2.45.0). Garder : `@anthropic-ai/sdk` (^0.39.0),
  `next` (^14.2.35), `gray-matter`, `tsx` (^4.22.4).
- Ajouter : `@anthropic-ai/claude-agent-sdk` (ingestion). Pour la coquille bureau :
  `electron`, `electron-builder`, `electron-updater` (dépendances de la couche
  Electron, hors `web/` — cf. Décisions §D8 sur l'emplacement).

### Assets à déplacer / supprimer
- `.github/prompts/ingest-prompt.md` → `prompts/ingest-prompt.md` (puis adapter).
- `.github/ingest-settings.json` → scoping porté par les options du SDK Agent.
- **Supprimer** : `.github/workflows/ingest.yml`, `web/lib/github.ts`,
  `web/lib/supabase.ts`, `web/supabase/`, `web/middleware.ts`, `web/lib/auth.ts`,
  `web/app/api/auth/route.ts`, `web/app/login/page.tsx`.

---

## Décisions

> **⚠️ Amendement 2026-07-20 (validé par Arthur en cours d'implémentation) — D2 REMPLACÉE.**
> L'accès IA ne se fait **pas** par clé API Anthropic personnelle mais par la **clé de
> la gateway LiteLLM de l'entreprise** (`https://llm-gateway.m33.tech`), que chaque
> employé possède déjà. Conséquences sur le plan :
> - **Phase 3 réduite** : `web/lib/claude.ts` **conserve** `baseURL` (gateway). Seule la
>   provenance de la clé/URL change (réglages de l'app injectés dans l'env, au lieu du
>   `.env` du repo).
> - **Ingestion (SDK Agent)** : auth gateway via **`ANTHROPIC_AUTH_TOKEN`** (Bearer) +
>   `ANTHROPIC_BASE_URL` dans l'env du process agent — cf. `tasks/lessons.md`
>   2026-07-09 (CLI Claude Code + gateway ⇒ `AUTH_TOKEN`, pas `API_KEY` seule).
> - **Phase 6 (réglages)** : saisie de la clé gateway (pas de lien console.anthropic.com) ;
>   URL de gateway préconfigurée par défaut, modifiable. Stockage chiffré inchangé (D12).
> - **Vérifs** : lire « aucun accès réseau autre que l'API Anthropic » comme « autre que
>   la gateway ». Modèle par défaut : un modèle routé par la gateway (`claude-sonnet-4-6`).
> - **Risque accepté** : l'app dépend de la disponibilité de la gateway d'entreprise.

- **D1 — Local-first vs centralisé.** Choix : chaque coéquipier a son app + son wiki
  en local. Écarté : garder Vercel/Action en parallèle (double maintenance, deux
  chemins d'écriture à tester). Raison : un seul modèle à maintenir.
- **D2 — Accès IA : clé API par personne.** Choix : chacun crée et colle sa clé.
  Écarté : (a) clé unique fournie par Arthur intégrée à l'app — plus fluide mais
  Arthur porte tout le coût et la clé est extractible/réutilisable ; (b) abonnement
  Claude via login in-app — pas de clé mais nécessite un abonnement payant par
  personne + faisabilité à valider. Raison : coût réparti, aucune clé partagée qui
  fuit, autonomie de chacun.
- **D3 — « Tout dans l'app », pas de session Claude Code.** Choix : l'app appelle
  l'API directement (clé). Écarté : `claude -p` / Claude Code CLI externe (nécessite
  installation + login séparés — contredit « tout dans l'app »). Conséquence :
  ingestion via SDK Agent **embarqué** authentifié par clé API.
- **D4 — Chat : garder `@anthropic-ai/sdk`, ne PAS migrer vers le SDK Agent.** Choix :
  le chat agentique existant marche déjà avec `@anthropic-ai/sdk` ; on retire la
  gateway et on branche la clé perso. Écarté : réécrire le chat sur
  `@anthropic-ai/claude-agent-sdk` (travail + risque inutiles ; le chat n'écrit rien,
  il lit). Raison : minimiser le travail et le risque, ne pas jeter du code testé.
- **D5 — Ingestion : SDK Agent + prompt adapté.** Choix : agent embarqué qui écrit
  des fichiers, prompt d'ingestion **injectant les règles** (au lieu de demander à
  l'agent d'aller lire `CLAUDE.md`/`docs/`) pour opérer avec `cwd = DATA_ROOT` seul.
  Écarté : deux racines (bundle app pour docs + dossier données pour wiki/raw) — plus
  fragile. Raison : robustesse et déterminisme de l'ingestion locale.
- **D6 — Historique chat : fichiers JSON locaux.** Choix : un fichier JSON par
  conversation dans `<DATA_ROOT>/.data/conversations/`. Écarté : `better-sqlite3`
  (compilation native fragile sur machines non maîtrisées), `node:sqlite`
  (expérimental). Raison : volume minuscule mono-utilisateur, zéro dépendance native,
  zéro API expérimentale.
- **D7 — Atomicité d'écriture.** Choix : écriture atomique **par fichier**
  (temp + `rename`) + `wiki-verify` en filet. Écarté : transaction inter-fichiers
  (staging/journal global). Raison : mutations déterministes/rejouables,
  `_ingested.json` porte l'idempotence, éviter la sur-ingénierie.
- **D8 — Packaging : Electron.** Choix : app bureau Electron embarquant le serveur
  Next (`next start`) + fenêtre ; Node fourni par Electron. Écarté : dossier +
  scripts double-clic + Node portable (n'est pas une « vraie app » ; Arthur exige un
  `.exe`/`.app`). Écarté : Tauri (backend Node/SDK Agent plus dur à embarquer que
  sous Electron). La couche Electron (main process, `electron-builder`) vit à la
  **racine du dépôt** (hors `web/`), lance `web/` en sous-jacent.
- **D9 — Séparation app/données.** Choix : données dans `app.getPath('userData')` ;
  contrainte « un seul dossier » abandonnée (impossible avec app installée en lecture
  seule). Raison : permet une mise à jour sûre du code sans toucher aux données.
- **D10 — Mise à jour : auto-updater in-app.** Choix : `electron-updater` sur
  Releases GitHub publiques + bouton « Mettre à jour ». Écarté : script externe /
  redistribution manuelle de zip. Raison : cohérent avec « tout dans l'app », remplace
  le code sans risque pour les données.
- **D11 — Modèle par défaut : configurable.** Choix : réglage « modèle » dans l'app,
  défaut raisonnable (ex. `claude-sonnet-4-6` pour le coût). Raison : arbitrage
  coût/qualité laissé à l'utilisateur ; l'ingestion agentique consomme beaucoup.
- **D12 — Stockage de la clé : `safeStorage` d'Electron.** Choix : chiffrement via le
  keychain OS, dans le dossier de données. Écarté : clé en clair dans un fichier /
  dans `.env`. Raison : la clé est un secret personnel.

---

## Hors périmètre

- **Partage / synchronisation entre coéquipiers** — aucun (chaque wiki diverge, par
  décision d'Arthur). Pas d'export/import, pas de sync git.
- **Reprise de l'historique de chat Supabase existant** — chaque instance locale
  repart avec un `.data/` vide ; l'historique centralisé n'est pas migré.
- **Signature de code** (certificats Apple/Windows) — à trancher séparément au moment
  de fabriquer le livrable ; v1 possible non signée avec notice de contournement
  Gatekeeper/SmartScreen dans `GUIDE.md`.
- **Clé API unique fournie par Arthur** et **login abonnement in-app** — écartés
  (D2).
- **Migration du chat vers le SDK Agent** — écartée (D4).
- **Modification de `web/lib/wiki-mutate.ts`** — interdite (moteur pur testé).

---

## Todo

### Phase 0 — POC (bloquant)
- [x] Installer `@anthropic-ai/claude-agent-sdk` dans un bac à sable ; confirmer sur
      la doc officielle (skill `claude-api`) l'API `query` + options (`cwd`,
      `allowedTools`/`disallowedTools`, `systemPrompt`, `permissionMode`/`canUseTool`)
      et l'auth par `ANTHROPIC_API_KEY`.
      **Vérif :** un `query()` minimal en lecture seule répond avec une clé API dans
      l'env, **sans binaire `claude` installé** et sans erreur de dépendance.
      *(FAIT 2026-07-20 — SDK 0.3.215, binaire embarqué `claude-agent-sdk-darwin-arm64`,
      env vierge simulé (HOME/CLAUDE_CONFIG_DIR temp, PATH minimal), auth gateway via
      `ANTHROPIC_AUTH_TOKEN`+`ANTHROPIC_BASE_URL` (cf. amendement D2). PASS, ~0,13 $.
      Signature confirmée dans sdk.d.ts : `canUseTool(toolName, input, {signal}) →
      {behavior:'allow',updatedInput}|{behavior:'deny',message}` ; ATTENTION un outil
      listé en bare dans `allowedTools` court-circuite `canUseTool`.)*
- [x] Prototype d'ingestion : sur un `DATA_ROOT` de test (copie du wiki + une
      ressource `raw/` neuve), lancer l'agent (écriture scopée `wiki/`) avec le prompt
      d'ingestion adapté.
      **Vérif :** `wiki/resources/<slug>.md` + vues + `graph.json` + `_ingested.json`
      créés/à jour ; `npm --prefix web run wiki:verify` sans erreur ; aucun accès
      réseau hors API Anthropic ; aucun fichier écrit hors `wiki/`.
      *(FAIT 2026-07-20 — PASS intégral : 33 écritures toutes sous `wiki/`, 0 refus
      du garde-fou, checksums hors `wiki/` identiques avant/après, `wiki:verify`
      propre (WIKI_ROOT/RAW_ROOT pointés sur le test root), ressource + 7 edges graphe
      + fusion candidate Cursor + nouvelle candidate Devin + `_ingested.json` OK.
      Écart assumé : prompt PAS encore adapté (docs/ + CLAUDE.md copiés dans le
      DATA_ROOT de test) — l'injection des règles reste à faire en Phase 4.
      Mesures : 375 s, 65 tours, **6,64 $** via gateway (modèle routé
      `vercel/anthropic-claude-sonnet-4.5`) → optimisation du prompt nécessaire en
      Phase 4 (coût/latence). Détail : scratchpad `agent-sdk-poc/test2.log`.)*
- [ ] ~~Si POC KO : documenter le repli (boucle d'outils maison `@anthropic-ai/sdk`
      avec outils fichier scopés `wiki/`) et l'appliquer en Phase 4.~~ *(Sans objet —
      POC validé.)*

### Phase 1 — Couche d'écriture locale
- [x] `wiki-fs.ts` : introduire `DATA_ROOT` et dériver `WIKI_ROOT`/`RAW_ROOT` ;
      ajouter `applyFileOps`, `readRepoFile`, `readRepoBinary`, `repoPathExists`,
      `resolveAvailableRawName`, `writeFileAtomic` ; supprimer `writeWikiFile` /
      `writeRaw`.
      **Vérif :** test unitaire de `applyFileOps` : refuse un path hors `wiki/`/`raw/`
      (throw) ; écrit un `.md`, écrit un binaire dans `raw/`, supprime un fichier
      (ENOENT ignoré).
      *(FAIT — `wiki-fs.ts` réécrit : garde-fou en dur `resolveRepoPath` (préfixe
      wiki/ ou raw/ obligatoire) + anti-traversal `resolveUnder` réutilisé. Nouveau
      suite `wiki-fs.test.ts` : 8 tests PASS (hors périmètre, traversal, lot rejeté
      avant écriture, binaire, ENOENT, suffixe -N, zéro temp orphelin). Total node:test
      = 70 PASS.)*
- [x] Modifier `upload/route.ts` (écriture locale + `resolveAvailableRawName` local +
      retrait garde 503) ; **ne pas** encore brancher le déclenchement d'ingestion
      (Phase 4).
      **Vérif :** `POST` d'un `.md` → `raw/<name>` + `raw/<name>.meta.md` présents sur
      disque ; sidecar identique à l'ancien format.
      *(FAIT — testé sur serveur `next start` réel (WIKI_ROOT/RAW_ROOT sur test root) :
      `POST /api/upload` → `{ok:true,file}` ; `raw/note-test-phase1.md` + sidecar écrits ;
      format sidecar identique. `buildSidecar`/`parseLinks`/`parseThemes` conservés.)*
- [x] Modifier `candidates/resolve/route.ts` et `theme-candidates/resolve/route.ts`
      (`readRepoFile` + `applyFileOps`, retrait `commit_sha`).
      **Vérif :** arbitrage d'une candidate `create`/`merge_alias` → diff attendu sur
      `wiki/entities/…` (ou `themes/…`), `graph.json`, `_candidates.json` ;
      `wiki-verify` propre.
      *(FAIT — `create` Cursor via API réelle → `wiki/entities/cursor.md` créé,
      candidate purgée, node `entity:cursor` ajouté au graphe. `wiki:verify` = 0 erreur.
      Le seul avertissement (« Cursor » cité dans une ressource hors `seen_in`) est un
      comportement INCHANGÉ du moteur `wiki-mutate` (relie seulement `seen_in`) et
      identique à la voie GitHub — hors périmètre (moteur figé).)*
- [x] Modifier `sources/[slug]/route.ts` (DELETE local via `deleteResource` +
      `applyFileOps`).
      **Vérif :** suppression → `resources/<slug>.md` + `raw/<source>` + sidecar +
      entrée `_ingested.json` + nodes/edges du graphe retirés ; `wiki-verify` propre.
      *(FAIT — `DELETE /api/sources/2026-agentic-coding-trends-report` → ressource +
      raw PDF + sidecar + clé manifeste + node graphe retirés (13→12 ressources).
      `wiki:verify` = 0 erreur. Notion `[skip ci]` retirée (plus de commit).)*
- [x] Modifier `raw/[...file]/route.ts` (retrait repli GitHub) ; supprimer
      `web/lib/github.ts`.
      **Vérif :** `npm --prefix web run build` OK ; `grep -rn "@/lib/github" web/` → 0.
      *(FAIT — repli GitHub retiré (404 direct si `fs.readFile` échoue) ;
      `web/lib/github.ts` SUPPRIMÉ ; `grep "@/lib/github"` = 0 ; `next build` OK.
      Note : `ingest-status/route.ts` déjà réécrite en local ici (lecture manifeste),
      Phase 4 y ajoutera processing/error.)*
- [x] **Vérif Phase 1 :** tests `web/lib/__tests__/wiki-mutate.test.ts` toujours verts
      (moteur inchangé). *(FAIT — 70/70 PASS ; `wiki-mutate.ts` non modifié.)*

### Phase 2 — Historique chat local
- [x] Créer `web/lib/conversations-store.ts` (signatures identiques à `supabase.ts`,
      fichiers JSON sous `<DATA_ROOT>/.data/conversations/`, écritures atomiques).
      **Vérif :** créer une conversation → fichier `<uuid>.json` créé ;
      `saveMessage` ajoute le message et met à jour `updated_at` ;
      `renameConversationIfDefault` renomme au 1er message user.
      *(FAIT — 6 signatures répliquées à l'identique (createConversation,
      listConversations, getConversation, getConversationHistory, saveMessage,
      renameConversationIfDefault) ; `id = crypto.randomUUID()` ; écriture atomique
      temp+rename ; `.data/` hors garde-fou wiki/raw → writer dédié. Nouvelle suite
      `conversations-store.test.ts` : 7 tests PASS (création+fichier, saveMessage+
      updated_at+sources, history ordonné, rename au 1er msg puis figé, troncature 60,
      tri updated_at desc + messages vidés en liste, robustesse id inconnu). Total 77 PASS.)*
- [x] Basculer les 4 imports (`chat/route.ts`, `conversations/route.ts`,
      `conversations/[id]/route.ts`, `chat/[id]/page.tsx`) ; supprimer `supabase.ts` et
      `web/supabase/`.
      **Vérif :** rechargement `/chat/[id]` réaffiche l'historique persisté ;
      `grep -rn "@/lib/supabase\|supabase-js" web/` → 0.
      *(FAIT — 4 imports basculés vers `@/lib/conversations-store` ; `lib/supabase.ts`
      + dossier `web/supabase/` SUPPRIMÉS ; plus aucun `@/lib/supabase` ni usage de
      `supabase-js` dans le code (reste juste la dépendance package.json, retirée en
      Phase 3). `next build` OK. E2E serveur (DATA_ROOT de test) : POST création →
      `<uuid>.json` sur disque ; injection messages → GET `/api/conversations/[id]`
      réaffiche les 2 messages (chemin de relecture de `/chat/[id]`) ; liste triée,
      messages vidés ; id inconnu → 404.)*

### Phase 3 — Chat sur clé perso
- [x] `claude.ts` : ~~retirer `baseURL`~~ **CONSERVER `baseURL` (amendement D2 : gateway
      d'entreprise)** ; `apiKey` depuis `ANTHROPIC_API_KEY` injecté (dev : `.env.local` ;
      app : réglages → env) ; modèle depuis réglage. Retirer `@supabase/supabase-js` du
      `package.json`, `npm --prefix web install`.
      **Vérif :** avec une vraie clé dans l'env, poser une question wiki dans le chat →
      streaming `{delta}` + `{step}` ; réponse finale avec `SOURCES:[...]` masqué puis
      hydraté ; sans clé → message « ajoute ta clé » propre.
      *(FAIT — `claude.ts` : `baseURL` gardé (gateway), commentaires alignés sur la
      nouvelle archi ; défaut modèle `claude-sonnet-4-6` (routé gateway). `@supabase/
      supabase-js` retiré du `package.json` + de `package-lock` + de `node_modules`
      (dossier vide élagué) ; `grep supabase-js` code = 0. `next build` OK, 77 tests OK.
      E2E serveur : (1) sans clé → 503 « Ajoute ta clé dans les réglages… » ; (2) vraie
      clé via gateway → `POST /api/chat` streame `step`(lecture index.md) + `delta`×4 +
      `done` ; réponse cite la bonne ressource + slug. Note : `sources:[]` sur cette
      question courte (le modèle a répondu sans bloc `SOURCES:` — parseur inchangé et
      couvert par tests ; hydratation exercée en Phase 7). Message no-key du chat route
      mis à jour (« réglages de l'app »).)*

### Phase 4 — Ingestion locale
> **Statut : IMPLÉMENTÉE + CÂBLAGE VÉRIFIÉ. Run réel complet REPORTÉ (décision Arthur
> 2026-07-20)** — pas de dépense ~6 $ maintenant : le mécanisme d'agent est déjà prouvé
> correct par le POC (Phase 0), et cette version sera RÉÉCRITE par la spec « ingestion
> pas chère » (cf. encadré ci-dessus), où le run réel sera validé à moindre coût.
- [x] Déplacer `.github/prompts/ingest-prompt.md` → `prompts/ingest-prompt.md` et
      **l'adapter** : injecter les règles (au lieu de demander à l'agent de lire
      `CLAUDE.md`/`docs/`), viser `cwd = DATA_ROOT`, écriture scopée `wiki/`.
      **Vérif :** relecture manuelle du prompt : aucune instruction « va lire les
      docs » restante ; scoping wiki explicite.
      *(FAIT — prompt déplacé ; section « Avant de commencer, lis » remplacée par un
      « Contexte d'exécution » qui interdit de lire docs/CLAUDE.md (hors périmètre) et
      pointe vers les règles injectées. Injection RÉELLE côté code : `ingest-local.ts`
      lit `CLAUDE.md` + `docs/{ingestion,wiki-spec,entities}.md` depuis `REFERENCE_DOCS_ROOT`
      et les concatène au prompt → docs = source unique, zéro duplication, D5 respectée
      (l'agent garde un seul root = DATA_ROOT).)*
- [x] Créer `web/lib/ingest-local.ts` (`detectPending`, état, lock, `runIngestion`
      via SDK Agent + clé injectée) ~~et `web/scripts/ingest-run.ts` (entrée CLI si
      besoin d'un sous-process)~~.
      **Vérif :** `runIngestion()` sur un `raw/` neuf → wiki mis à jour +
      `_ingested.json` incrémenté + `wiki-verify` propre ; second `runIngestion()`
      (sans nouvel upload) = no-op (idempotence) ; double lancement concurrent
      sérialisé par le lock.
      *(FAIT — `ingest-local.ts` : detectPending (100% TS, remplace find|comm|jq),
      IngestState + read/write atomiques, acquireLock/releaseLock (O_EXCL), lockHeld,
      runIngestion (SDK Agent embarqué, cwd=DATA_ROOT, allowedTools lecture seule bare +
      canUseTool scoping écritures wiki/ (les write tools NON bare-listés → callback
      appelé), auth gateway ANTHROPIC_AUTH_TOKEN+BASE_URL, log, wiki:verify best-effort).
      Pas de `ingest-run.ts` : exécution IN-PROCESS via la route (aucun sous-process
      nécessaire). 5 tests unitaires PASS : detectPending (filtre README/sidecars/déjà-
      ingérés), verrou exclusif, état round-trip, no-op si verrou tenu, done si vide.
      Idempotence + sérialisation par verrou couvertes par tests. « wiki réellement mis
      à jour » = reporté au run réel (spec coût).)*
- [x] Brancher le déclenchement auto dans `upload/route.ts` (arrière-plan) + créer
      `web/app/api/ingest/route.ts` (relance manuelle).
      **Vérif :** upload via l'UI → ingestion se lance seule → wiki à jour sans action
      supplémentaire.
      *(FAIT — `upload/route.ts` : `void runIngestion().catch(...)` après `applyFileOps`
      (arrière-plan, ne bloque pas la réponse). `api/ingest/route.ts` POST = relance
      manuelle (no-op si verrou tenu, renvoie l'état). E2E démontré : POST /api/upload
      d'une source neuve → raw écrit → ingestion se lance seule → `GET /api/ingest-status`
      = `processing` + verrou posé + source dans `pending`. La suite du run (wiki à jour)
      = reportée (run réel, spec coût).)*
- [x] Réécrire `ingest-status/route.ts` (état local) ; supprimer
      `.github/workflows/ingest.yml`.
      **Vérif :** pendant l'ingestion, `GET /api/ingest-status` renvoie `processing`
      puis `ingested` (avec `slug`) ; en cas d'échec (couper le réseau) → `error`
      affiché dans l'UI.
      *(FAIT — `ingest-status/route.ts` : manifeste → `ingested`(+slug) ; sinon état
      local `running`/verrou → `processing` ; `error` → `error`(+message) ; sinon
      `pending`. `processing` observé en vrai. `ingested`/`error` = reportés au run réel.
      `.github/workflows/ingest.yml` ET `.github/ingest-settings.json` SUPPRIMÉS
      (`.github/` vide). `@anthropic-ai/claude-agent-sdk@^0.3.215` ajouté ;
      `@anthropic-ai/sdk` monté 0.39→^0.112.3 (peer du SDK Agent) — chat recompile OK.)*

### Phase 5 — Nettoyage ancien modèle
- [x] Supprimer `middleware.ts`, `lib/auth.ts`, `api/auth/route.ts`,
      `app/login/page.tsx` ; retirer `outputFileTracing*` de `next.config.js` ;
      réduire `.env.local.example` (aucune clé obligatoire) ; mettre à jour
      `docs/platform.md`, `docs/ingestion.md`, `docs/entities.md` §7, `CLAUDE.md`,
      `README.md`, `web/README.md`.
      **Vérif :** `grep -rin "supabase\|github.ts\|commitFiles\|isGithubConfigured\|
      SITE_PASSWORD\|outputFileTracing\|vercel" web/` → 0 hit fonctionnel ;
      `npm --prefix web run build` sans variable d'env ; accès direct à `/` sans
      redirection vers `/login`.
      *(FAIT — 4 fichiers auth supprimés (+ dossiers vides `app/login/`, `app/api/auth/`) ;
      `next.config.js` : `outputFileTracing*` retirés, `serverComponentsExternalPackages`
      + `webpack cache=false` dev conservés ; `.env.local.example` réduit (clé gateway
      optionnelle + chemins optionnels, 0 clé obligatoire) ; commentaires code trompeurs
      (Supabase/Vercel) nettoyés + 1 texte UI corrigé (« Supabase requis » → « Aucune
      conversation »). Docs mises à jour (sous-agent) : `docs/platform.md`,
      `docs/ingestion.md`, `docs/entities.md` §4/§7, `README.md`, `web/README.md` —
      grep termes ancien modèle = 0 hit trompeur (restent 2 mentions « supabase » =
      l'outil-exemple dans la liste d'entités seed, légitimes). `CLAUDE.md` : carte +
      règles cardinales réécrites local-first. Build 12 pages (plus de `/login` ni de
      Middleware). E2E : `/` → 307 vers `/chat` (redirection applicative, PAS `/login`) ;
      `/login` → 404 ; `/api/auth` → 404. 82 tests OK.)*

### Phase 6 — Application Electron
> **⚠️ REPORTÉE à une SPEC DÉDIÉE + session neuve (décision Arthur 2026-07-20).**
> Cet environnement d'implémentation ne peut PAS vérifier la Phase 6 : pas d'affichage
> (impossible d'ouvrir une fenêtre Electron), pas de machine Windows, et la fabrication
> d'un `.dmg`/`.exe` signé exige les certificats Apple/Windows d'Arthur. Écrire ~500
> lignes d'Electron non démontrables violerait le principe « prouver que ça marche »
> (Arthur ne lit pas le code). La couche Electron sera donc conçue + implémentée +
> **vérifiée** dans une session lancée sur le Mac d'Arthur. Paragraphe de passation
> dédié fourni en fin de session (+ mémoire projet).
- [ ] Coquille Electron (racine dépôt) : main process lance `next start` (port local
      fixe) + fenêtre pointant dessus ; définir `DATA_ROOT = app.getPath('userData')`
      et exposer `WIKI_ROOT`/`RAW_ROOT`/`DATA_ROOT` + `ANTHROPIC_API_KEY` (depuis
      `safeStorage`) à l'env du serveur Next. *(Le code `web/` est DÉJÀ prêt : toutes
      les racines dérivent de `DATA_ROOT` ; `REFERENCE_DOCS_ROOT` pour les règles
      d'ingestion ; auth gateway via env. Il ne reste que la coquille.)*
- [ ] Premier lancement : si `DATA_ROOT/wiki` vide, copier le wiki + raw pré-remplis
      (13 ressources) embarqués dans le bundle.
- [ ] Écran réglages : saisie/stockage chiffré (`safeStorage`) de la clé API + choix
      du modèle + bouton « Tester la clé ».
- [ ] `electron-builder` (`.exe` Windows, `.app`/`.dmg` Mac) + `electron-updater`
      (Releases GitHub) + bouton « Mettre à jour ».
- [ ] Rédiger `GUIDE.md` (FR, captures) : installer l'app, créer + coller sa clé API,
      déposer une ressource, contournement Gatekeeper/SmartScreen si non signée.

### Phase 7 — Vérification de bout en bout
> **⚠️ REPORTÉE avec la Phase 6** (dépend de l'app packagée + Mac/Windows). Le scénario
> complet sera joué dans la session Electron. NB : le cœur local-first (Phases 1–5) a
> déjà été vérifié end-to-end route par route dans cette session (upload, arbitrage,
> suppression, chat streaming, historique local, `wiki:verify` propre).
- [ ] Scénario complet sur machine vierge simulée, **Mac et Windows** : install →
      clé + test → upload (md/txt/pdf) → ingestion auto → wiki à jour → arbitrage
      candidate entité **et** thème → suppression → chat (streaming, `SOURCES:`,
      filtres durs, historique local, survie à la navigation) → `wiki-verify`
      (`--strict`) propre → mise à jour (données intactes).

---

## Bilan (session d'implémentation 2026-07-20)

### Fait et DÉMONTRÉ dans cette session (Phases 0–5)
- **Phase 0 — POC (verrou du projet) :** prouvé que l'agent d'ingestion tourne
  **embarqué** (`@anthropic-ai/claude-agent-sdk`, binaire bundlé), authentifié par la
  **clé gateway** (Bearer), **sans binaire `claude` externe**, en environnement vierge
  simulé, et n'écrit **que sous `wiki/`** (garde-fou `canUseTool`). Sortie conforme,
  `wiki:verify` propre. Coût mesuré : 6,64 $/ressource → optimisation renvoyée à une
  spec dédiée.
- **Phase 1 — Écriture locale :** `wiki-fs.ts` réécrit (`DATA_ROOT`/`WIKI_ROOT`/
  `RAW_ROOT`, `applyFileOps` atomique + garde-fou wiki/raw, `readRepoFile/Binary`,
  `repoPathExists`, `resolveAvailableRawName`). Routes upload/candidates/theme-candidates/
  suppression/raw basculées en local ; `web/lib/github.ts` **supprimé**. E2E réel
  (upload, arbitrage `create`, suppression) + `wiki:verify` 0 erreur.
- **Phase 2 — Historique chat local :** `conversations-store.ts` (fichiers JSON sous
  `<DATA_ROOT>/.data/conversations/`, mêmes signatures que l'ex-`supabase.ts`) ;
  `supabase.ts` + `web/supabase/` **supprimés**. E2E création/relecture.
- **Phase 3 — Chat sur clé gateway :** `claude.ts` conserve la gateway (amendement D2) ;
  `@supabase/supabase-js` retiré. E2E streaming réel + cas sans-clé propre.
- **Phase 4 — Ingestion locale :** prompt déplacé + adapté (règles injectées),
  `ingest-local.ts` (détection, verrou, état, `runIngestion` scopé wiki/), déclenchement
  auto à l'upload + relance manuelle + statut local ; GitHub Action supprimée. Câblage
  auto démontré ; **run réel complet reporté** (décision Arthur, coût).
- **Phase 5 — Nettoyage :** auth mot de passe + Vercel supprimés ; `.env.local.example`
  réduit ; `CLAUDE.md` + `docs/` + `README`s réécrits local-first.
- **Qualité :** 82 tests `node:test` verts (33 nouveaux : wiki-fs, conversations-store,
  ingest-local) ; `next build` OK ; `wiki-mutate.ts` **jamais modifié** (invariant).

### Dévié du plan (et pourquoi)
- **D2 amendée :** accès IA via **gateway d'entreprise** (clé partagée), pas de clé
  Anthropic perso — décision Arthur en cours de route. Conséquence : `claude.ts` garde
  `baseURL` (Phase 3 allégée), l'ingestion s'auth en `ANTHROPIC_AUTH_TOKEN`.
- **Coût d'ingestion (6,64 $)** extrait en spec dédiée (piste : split IA + projection
  déterministe symétrique de `deleteResource`).
- **Phases 6 (Electron) & 7 (E2E cross-platform)** reportées en spec/session dédiée :
  non vérifiables ici (pas d'affichage, pas de Windows, signature = décision Arthur).
- **`ingest-run.ts` non créé** : ingestion exécutée in-process (aucun sous-process
  nécessaire) — simplification par rapport au plan.
- **`@anthropic-ai/sdk` monté 0.39 → 0.112** : peer requis par le SDK Agent ; le chat
  n'utilise que la surface stable de l'API Messages → recompile sans changement.

### Reste à faire (specs dédiées)
1. **Ingestion pas chère** (viser quelques centimes) — cf. encadré Phase 4.
2. **Application Electron + packaging + updater + E2E Mac/Windows** — cf. encadré Phase 6.

---

*Note d'implémentation : après toute correction de l'utilisateur pendant
l'implémentation, consigner le pattern dans `tasks/lessons.md`.*
