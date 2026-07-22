# Écran de Réglages IA (`/reglages`) + accès IA reconstruit à l'exécution

## Contexte

L'accès IA de l'app `web/` est **figé au chargement du module**.
`web/lib/claude.ts` (24 lignes, contenu actuel intégral) :

```ts
import Anthropic from '@anthropic-ai/sdk';

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? '',
  baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
});

export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';

export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
```

Le client `anthropic` et la constante `CLAUDE_MODEL` sont construits **une seule fois**
à l'import, depuis `process.env` (`ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`,
`ANTHROPIC_MODEL`, alimentés par `web/.env.local` en dev). Aucun moyen, pour
l'utilisateur, de saisir ses accès depuis l'app : la seule voie est d'éditer
`.env.local` puis de **redémarrer** le serveur. Aucun écran de réglages n'existe.

**Demande d'origine (Arthur, non-développeur — décide du QUOI) :** créer un écran de
Réglages (`/reglages`) permettant de saisir ses accès IA — clé API perso **ou** clé de
passerelle d'entreprise — et de les faire **prendre effet à l'exécution sans
redémarrer**. La spec local-first (`tasks/specs/2026-07-20-refonte-local-first-electron.md`,
Phase 6) prévoit cet écran ; l'UI web construite ici en est le **socle réutilisé par la
future coquille Electron** (le chiffrement `safeStorage` viendra par-dessus).

**Contrainte protocole (ajout Arthur, à MENTIONNER à l'utilisateur) :** l'app ne
fonctionne qu'avec une **clé Anthropic (Claude)** ou une **clé de passerelle compatible
Anthropic** (ex. gateway LiteLLM d'entreprise). Justification vérifiée dans le code
(pas une supposition) :
- L'app n'utilise QUE `@anthropic-ai/sdk` — `grep -riE "openai|gpt|gemini|mistral|cohere|ollama|langchain" web/lib web/app` = **0 résultat**.
- `web/lib/chat-agent.ts` est câblé en dur sur la sémantique streaming **Messages API
  d'Anthropic** : `Anthropic.Messages.MessageStreamEvent`, blocs `content_block_start`,
  `content_block.type === 'tool_use'`, `input_json_delta`, `message_stop` (l.140-186).
  Un endpoint qui ne parle pas ce protocole casserait la boucle de streaming + outils.
- `web/lib/ingest-local.ts` dépend de spécificités Anthropic : `system: [{ type:'text',
  text, cache_control:{type:'ephemeral'} }]` (l.397) et l'en-tête gateway
  `x-litellm-response-cost` (l.406).
Donc : Anthropic en direct, OU une passerelle (LiteLLM) qui expose une **façade
compatible Anthropic** routant vers un modèle Claude. Une clé OpenAI/Google/etc. brute
pointée sur son endpoint natif **ne marche pas** (protocole différent).

**Fait déterminant (vérifié) :** l'ingestion n'utilise **plus** le SDK Agent — depuis la
refonte 2026-07-21, `web/lib/ingest-local.ts` appelle `anthropic.messages.create` via le
**même** client `@anthropic-ai/sdk` (auth `x-api-key`) que le chat. Rendre **un seul**
factory dynamique couvre donc chat ET ingestion. Aucun `ANTHROPIC_AUTH_TOKEN` n'est
nécessaire côté web (il l'était pour l'ancien SDK Agent, désormais code mort).

---

## Plan

*(Contenu intégral du plan validé.)*

### Périmètre des accès gérés — le triplet (clé / adresse / modèle)

L'app parle **un seul protocole : Messages API d'Anthropic (`x-api-key`)**. Trois
configurations valides, toutes = le triplet :
- **Anthropic perso/entreprise** : clé `sk-ant-…`, adresse **vide** (⇒
  `https://api.anthropic.com` en direct), modèle = identifiant Anthropic standard
  (défaut : `claude-sonnet-4-5`).
- **Passerelle compatible Anthropic** (gateway LiteLLM d'entreprise) : clé de la
  passerelle + adresse `https://llm-gateway.m33.tech` + modèle propre à la passerelle
  (ex. `vercel/anthropic-claude-sonnet-4.5`).

On ne peut pas fiabiliser la détection du protocole à partir de la chaîne de la clé
(une clé de passerelle peut être un `sk-…` quelconque). Le garde-fou est donc :
(1) une **mention permanente** dans l'UI (voir §5) ; (2) le bouton **« Tester la
connexion »** qui échoue lisiblement si l'endpoint/clé n'est pas compatible.

### 1. `web/lib/ai-settings.ts` (NOUVEAU) — store de réglages

Module **serveur** (utilise `fs`). Persiste un petit JSON sous
`<DATA_ROOT>/.data/ai-settings.json`. Réutilise `DATA_ROOT` de `@/lib/wiki-fs`
(`export const DATA_ROOT = process.env.DATA_ROOT ?? path.resolve(process.cwd(), '..')`).
`.data/` est **hors** `wiki/`/`raw/` → le garde-fou d'`applyFileOps` le refuse : écrire
avec un writer atomique dédié (pattern identique à `web/lib/conversations-store.ts`
`writeJsonAtomic` : `mkdir -p` ; temp `.${basename}.tmp-${pid}-${Date.now()}` même
dossier ; `fs.writeFile` ; `fs.rename` ; `unlink` du temp en cas d'échec).

```ts
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { DATA_ROOT } from '@/lib/wiki-fs';

const SETTINGS_PATH = path.join(DATA_ROOT, '.data', 'ai-settings.json');
export const DEFAULT_MODEL = 'claude-sonnet-4-5';
export const ANTHROPIC_DIRECT_URL = 'https://api.anthropic.com';

export interface AiSettings { apiKey: string; baseUrl: string; model: string; }

// Lecture SYNCHRONE (readFileSync) : appelée par getAnthropic()/getModel() à chaque
// appel IA → garantit la fraîcheur sans redémarrage. null si absent/illisible.
function readStore(): AiSettings | null {
  try {
    const s = JSON.parse(fsSync.readFileSync(SETTINGS_PATH, 'utf-8'));
    return {
      apiKey: typeof s.apiKey === 'string' ? s.apiKey : '',
      baseUrl: typeof s.baseUrl === 'string' ? s.baseUrl : '',
      model: typeof s.model === 'string' ? s.model : '',
    };
  } catch { return null; }
}

// Store prime sur env (env = secours dev). baseUrl : autorité TOTALE du store (y
// compris '' = Anthropic direct) — sinon le SDK relit ANTHROPIC_BASE_URL de l'env et
// la gateway du .env.local fuite dans le preset « direct ». apiKey/model : valeur du
// store si non vide, sinon secours env (évite le footgun « le dev perd sa clé
// .env.local en changeant juste le modèle »).
export function getAiSettings(): AiSettings {
  const s = readStore();
  if (!s) return {
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    baseUrl: process.env.ANTHROPIC_BASE_URL ?? '',
    model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
  };
  return {
    apiKey: s.apiKey || process.env.ANTHROPIC_API_KEY || '',
    baseUrl: s.baseUrl ?? '',
    model: s.model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
  };
}

// Forme sûre pour l'UI — JAMAIS la clé en clair.
export interface SafeAiSettings {
  configured: boolean;        // = hasKey
  source: 'store' | 'env';    // d'où vient la config effective
  baseUrl: string;
  model: string;
  hasKey: boolean;            // Boolean(clé effective)
  keyHint: string | null;    // 4 derniers caractères, SEULEMENT si le store porte sa propre clé
}
export function getSafeAiSettings(): SafeAiSettings { /* dérivé de readStore()+getAiSettings() */ }

// Fusion + écriture atomique. Si patch.apiKey vide/absent → conserve la clé déjà en
// store (permet d'éditer adresse/modèle sans re-saisir le secret).
export async function saveAiSettings(patch: { apiKey?: string; baseUrl: string; model: string }): Promise<void> {
  const cur = readStore();
  const next: AiSettings = {
    apiKey: (patch.apiKey && patch.apiKey.trim()) ? patch.apiKey.trim() : (cur?.apiKey ?? ''),
    baseUrl: patch.baseUrl ?? '',
    model: (patch.model && patch.model.trim()) ? patch.model.trim() : DEFAULT_MODEL,
  };
  // writeJsonAtomic(SETTINGS_PATH, next)  (mkdir -p .data + temp + rename)
}
```

`AiSettings`/`SafeAiSettings` restent **locaux au module** (pas besoin de les ajouter à
`web/types/index.ts`). **Ne jamais logguer `apiKey` ni le renvoyer en clair.**

### 2. `web/lib/claude.ts` — remplacer les singletons figés par des factories

Retirer `export const anthropic` et `export const CLAUDE_MODEL`. Nouveau contenu :

```ts
import Anthropic from '@anthropic-ai/sdk';
import { getAiSettings, ANTHROPIC_DIRECT_URL } from '@/lib/ai-settings';

let cached: { sig: string; client: Anthropic } | null = null;

export function getAnthropic(): Anthropic {
  const { apiKey, baseUrl } = getAiSettings();
  const sig = `${apiKey} ${baseUrl}`;    // reconstruit seulement si clé/URL change
  if (!cached || cached.sig !== sig) {
    cached = { sig, client: new Anthropic({ apiKey, baseURL: baseUrl || ANTHROPIC_DIRECT_URL }) };
  }
  return cached.client;
}
export function getModel(): string { return getAiSettings().model; }
export function isClaudeConfigured(): boolean { return Boolean(getAiSettings().apiKey); }
```

**Correctness clé (vérifiée dans la source SDK `node_modules/@anthropic-ai/sdk/client.js`) :**
- l.68 : `baseURL = readEnv('ANTHROPIC_BASE_URL')` quand `baseURL` n'est pas passé → il
  faut passer `baseURL` **explicite** (`baseUrl || ANTHROPIC_DIRECT_URL`) sinon la gateway
  du `.env.local` fuite dans le preset « Anthropic direct ». `ANTHROPIC_DIRECT_URL`
  (`https://api.anthropic.com`) = le défaut propre du SDK (l.59).
- l.75 : `apiKey` non passé → relu de l'env ; on le passe toujours explicitement (même
  `''`) → l'env ne peut pas le shadow. Construire avec `apiKey:''` est accepté (le code
  actuel le fait déjà à l'import).

### 3. Répercuter sur les 2 consommateurs (appels AU RUNTIME, pas à l'import)

- `web/lib/chat-agent.ts` : `import { getAnthropic, getModel } from '@/lib/claude'` ; dans
  `runWikiAgent` — `const client = opts.client ?? (getAnthropic() as WikiAgentClient)`
  (actuellement l.236) et `const model = opts.model ?? getModel()` (l.237). Conserver
  `import type Anthropic from '@anthropic-ai/sdk'` (l.1). Le type structurel `WikiAgentClient`
  (l.129-142) est satisfait par le client réel.
- `web/lib/ingest-local.ts` : `import { getAnthropic, getModel } from '@/lib/claude'`
  (remplace l.8) ; dans `callModel` (l.391-409) — `await getAnthropic().messages.create({
  model: getModel(), max_tokens: 16000, system: [{ type:'text', text: system,
  cache_control:{type:'ephemeral'} }], messages:[{ role:'user', content: user }]
  }).withResponse()`. Le reste de `callModel` (lecture header `x-litellm-response-cost`,
  parsing) inchangé.
- `web/app/api/chat/route.ts` : `import { isClaudeConfigured } from '@/lib/claude'` (l.2)
  inchangé — devient store-aware automatiquement (gate 503 l.25-33 conservé).

**Test-safety (vérifié) :** aucun test n'importe `lib/claude`. `chat-agent.test.ts` injecte
`opts.client` + `opts.model:'claude-test'` (getAnthropic/getModel non touchés).
`ingest-local.test.ts` n'appelle jamais `callModel` (le chemin payant). Refactor sans
casse de tests.

### 4. Routes API (Node runtime, thin — logique dans `lib/`)

- `web/app/api/settings/route.ts` — `export const dynamic = 'force-dynamic'` ;
  `GET` → `Response.json(getSafeAiSettings())` ; `POST` → parse `{ apiKey?, baseUrl, model }`,
  `await saveAiSettings(...)`, renvoie `getSafeAiSettings()`. **Ne jamais renvoyer la clé.**
- `web/app/api/settings/test/route.ts` — `POST { apiKey?, baseUrl, model }`. Clé =
  `body.apiKey?.trim() || getAiSettings().apiKey` (teste la config enregistrée sans
  re-saisir). Client jetable `new Anthropic({ apiKey, baseURL: (baseUrl||'').trim() ||
  ANTHROPIC_DIRECT_URL })`. Appel minimal :
  `messages.create({ model, max_tokens: 1, messages:[{role:'user',content:'ping'}] })`.
  (max_tokens:1 plutôt que GET /v1/models : valide **aussi** que l'identifiant de modèle
  se résout sur la gateway, et exerce le même protocole que les vrais appels.) Renvoie
  `{ ok:true }` ou `{ ok:false, status, message }`. **Mapping d'erreurs lisible :**
  401 → « Clé invalide ou refusée par le service. » ; 429 → « Quota/budget dépassé. » ;
  404 → « Modèle inconnu ou adresse incorrecte (l'adresse n'expose peut-être pas l'API
  Messages d'Anthropic). » ; sinon → message brut de l'API + statut. Lire le statut via
  `err.status` (erreurs `@anthropic-ai/sdk`, ex. `Anthropic.APIError`).

### 5. UI — page `/reglages` + mention utilisateur obligatoire

- `web/app/reglages/page.tsx` — wrapper server (comme les autres pages), `export const
  dynamic = 'force-dynamic'`, rend `<ReglagesView />`.
- `web/components/reglages/ReglagesView.tsx` — `'use client'`. Patron `/upload`
  (`web/components/upload/UploadView.tsx`) : racine
  `<div className="h-full overflow-y-auto"><div className="mx-auto max-w-2xl px-6 py-6">…`
  (scroll natif dans le `<main>` clippé du layout). Classes copiées de
  `web/components/upload/UploadForm.tsx` : input `mt-1 w-full rounded-lg border
  border-gray-300 px-3 py-1.5 text-sm` ; bouton primaire `rounded-lg bg-[#0F6E56] px-3
  py-1.5 text-sm font-medium text-white hover:bg-[#0c5a47] disabled:opacity-50` ; bouton
  secondaire `rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white
  hover:bg-gray-700` ; libellés `text-xs text-gray-600` ; aide `text-[11px] text-gray-400`.

  **MENTION UTILISATEUR (obligatoire, toujours visible en haut du formulaire)** — encart
  d'information expliquant la contrainte protocole, ex. :
  > ℹ️ **Cette app fonctionne uniquement avec Claude (Anthropic).** Colle soit une **clé
  > Anthropic** (perso ou entreprise), soit la **clé d'une passerelle compatible Anthropic**
  > (ex. la passerelle LiteLLM de l'entreprise). Une clé **OpenAI, Google/Gemini** ou autre
  > **ne fonctionnera pas** : l'app ne parle que le protocole « Messages » d'Anthropic.
  > Utilise « Tester la connexion » pour vérifier avant d'enregistrer.

  Style encart : `rounded-lg bg-[#E1F5EE] px-3 py-2 text-xs text-[#0F6E56]` (ou équivalent
  neutre visible en clair). Texte en français.

  Comportement : au montage, `fetch('/api/settings')` → préremplit adresse + modèle,
  affiche un badge **Configuré ✓ / Non configuré** (depuis `configured`) et la source
  (store / `.env.local`). Champs :
  - **Preset** (2 boutons radio ou segmented) : « Anthropic (perso/entreprise) » → adresse
    `''`, modèle `claude-sonnet-4-5` ; « Passerelle d'entreprise » → adresse
    `https://llm-gateway.m33.tech`, modèle `vercel/anthropic-claude-sonnet-4.5`. Le preset
    **préremplit** ; tout reste éditable.
  - **Clé API** : `<input type="password">` + bouton œil afficher/masquer (lucide `Eye`/
    `EyeOff` ; bascule `type` password↔text). Vide au montage ; placeholder « •••• (clé
    enregistrée — laisser vide pour conserver) » si `hasKey`, sinon « Colle ta clé… ».
  - **Adresse du service** : `<input type="text">` optionnel, placeholder « https://… — vide
    = API Anthropic en direct ».
  - **Modèle** : `<input type="text">`, défaut `claude-sonnet-4-5`.
  - Boutons **« Enregistrer »** (POST `/api/settings` avec `{apiKey, baseUrl, model}` du
    formulaire) et **« Tester la connexion »** (POST `/api/settings/test` avec les valeurs
    **du formulaire**) → résultat inline : succès (vert « Connexion OK ») / échec (rouge +
    message lisible). Après un « Enregistrer » réussi, re-`fetch('/api/settings')` pour
    rafraîchir badge + `hasKey`.
- `web/components/Sidebar.tsx` — convertir le `<button type="button" title="Paramètres">`
  inerte (l.67-73 ; `Settings` de `lucide-react` déjà importé l.14) en
  `<Link href="/reglages" title="Réglages">` avec l'état actif
  (`pathname.startsWith('/reglages')`) et le style des autres entrées (actif
  `bg-gray-900 text-white`, sinon `text-gray-500 hover:bg-gray-100 hover:text-gray-900`).
- `web/components/TopBar.tsx` — ajouter `'/reglages': 'Réglages'` à `TITLES` (l.8-16).

### 6. Sécurité — `.gitignore` racine

`git check-ignore .data` = **non ignoré** (vérifié). Ajouter `/.data/` au `.gitignore`
**racine** (`/Users/arthur/ai-coding-secondbrain/.gitignore`) — protège aussi
`conversations/` + `ingest-state.json` déjà écrits là. Le fichier `ai-settings.json`
(clé en clair en dev, conforme à la demande) ne doit **jamais** être committable. En
Electron (Phase 6, hors périmètre) : `safeStorage` chiffrera par-dessus et injectera via
l'env — `getAiSettings()` reste compatible (l'env est le secours).

### Fichiers

**Créer :** `web/lib/ai-settings.ts`, `web/app/api/settings/route.ts`,
`web/app/api/settings/test/route.ts`, `web/app/reglages/page.tsx`,
`web/components/reglages/ReglagesView.tsx`.
**Modifier :** `web/lib/claude.ts`, `web/lib/chat-agent.ts`, `web/lib/ingest-local.ts`,
`web/components/Sidebar.tsx`, `web/components/TopBar.tsx`, `.gitignore` (racine).
**Réutiliser :** `DATA_ROOT` (`@/lib/wiki-fs`), le pattern `writeJsonAtomic` de
`web/lib/conversations-store.ts`, les classes Tailwind de `web/components/upload/UploadForm.tsx`.
**Ne pas toucher :** `web/lib/wiki-mutate.ts` (moteur figé/testé), `web/.env.local`
(secours dev conservé).

---

## Décisions

- **D1 — Client à la demande vs singleton figé.** Choix : `getAnthropic()`/`getModel()`
  reconstruisant le client depuis le store à chaque appel (mémo par signature clé+URL).
  Écarté : garder le singleton + un « setter » qui mute le client — plus fragile (état
  mutable partagé, ordre d'init). Raison : le seul moyen fiable que la saisie UI prenne
  effet sans redémarrage.
- **D2 — Un seul factory couvre chat + ingestion.** Constat vérifié : depuis la refonte
  2026-07-21, l'ingestion passe par `anthropic.messages.create` (même client
  `@anthropic-ai/sdk`, `x-api-key`), plus par le SDK Agent. Donc pas besoin de gérer
  `ANTHROPIC_AUTH_TOKEN` côté web. Le SDK Agent (`@anthropic-ai/claude-agent-sdk`) reste
  dans `package.json` mais est **code mort** (0 import) — ne pas s'en occuper ici.
- **D3 — Précédence store > env, autorité TOTALE du store sur `baseUrl`.** `apiKey`/`model`
  du store priment, avec secours env quand vides (évite de casser un dev qui a sa clé dans
  `.env.local`). `baseUrl` : dès qu'un store existe, sa valeur fait autorité **y compris
  `''`** (= Anthropic direct). Écarté : secours env par champ pour `baseUrl` — casserait le
  preset « direct » (l'env gateway du `.env.local` reviendrait). Raison : cohérence des
  presets + pas de fuite d'URL.
- **D4 — `baseURL` explicite au SDK.** On passe toujours `baseURL: baseUrl ||
  ANTHROPIC_DIRECT_URL`. Écarté : `baseURL: baseUrl || undefined` (l'actuel) — le SDK
  relit alors `process.env.ANTHROPIC_BASE_URL` (source `client.js:68`) et la gateway
  fuite. Raison : correctness, prouvée par lecture de la source du SDK.
- **D5 — Contrainte protocole Anthropic + mention utilisateur.** L'app ne parle que
  l'API Messages d'Anthropic (câblage streaming/`tool_use` de `chat-agent.ts`,
  `cache_control` d'`ingest-local.ts`, 0 dépendance non-Anthropic). Choix : encart
  d'information permanent dans l'UI + validation réelle par « Tester la connexion ».
  Écarté : bloquer par préfixe de clé (`sk-ant-`) — non fiable (clés de passerelle
  arbitraires) → faux refus. Raison : informer sans bloquer à tort ; le test est le juge.
- **D6 — Persistance : JSON clair dans `.data/` (dev) + `.gitignore`.** Choix : fichier
  `ai-settings.json` en clair sous `<DATA_ROOT>/.data/`, dossier ajouté au `.gitignore`.
  Écarté : chiffrer en dev — pas de `safeStorage` hors Electron ; la demande dit
  explicitement « fichier de config local hors git » pour le dev. Le chiffrement est le
  rôle d'Electron (Phase 6). Raison : conforme à la demande, socle réutilisable.
- **D7 — Lecture synchrone (`readFileSync`) dans `getAnthropic`/`getModel`.** Choix : relire
  le petit JSON à chaque appel garantit la fraîcheur (preuve « sans redémarrage »). Écarté :
  cache mémoire invalidé au save — plus de code, risque de staleness (Next recharge des
  modules en dev). Raison : les appels IA sont rares et réseau-bound ; un read sync de
  ~200 octets est négligeable. Mémo du client construit par signature pour éviter de le
  reconstruire inutilement.
- **D8 — `messages.create max_tokens:1` pour le test.** Écarté : `GET /v1/models` (pas
  garanti exposé par toutes les passerelles). Raison : exerce le vrai protocole, valide
  l'auth ET la résolution du modèle.
- **D9 — Défaut modèle `claude-sonnet-4-5`.** Le codé-en-dur actuel est `claude-sonnet-4-6` ;
  la demande recommande `claude-sonnet-4-5` (preset Anthropic). En dev, `.env.local`
  définit `ANTHROPIC_MODEL` qui **reste prioritaire** tant qu'aucun réglage n'est
  enregistré → comportement dev inchangé ; le défaut ne joue qu'en dernier recours et pour
  le préremplissage. Raison : suivre la demande sans régression dev.
- **D10 — Route page `/reglages` (FR), routes API `/api/settings[/test]` (EN).** La page
  suit la demande (`/reglages`). Les routes API internes en anglais pour la clarté ; sans
  impact fonctionnel.

## Hors périmètre

- **Chiffrement `safeStorage` + injection Electron** (Phase 6, session dédiée) — l'UI web
  ici en est le socle ; `getAiSettings()` restera compatible (env = secours).
- **Support d'un protocole non-Anthropic** (OpenAI/Google/Gemini brut à endpoint natif) —
  impossible sans réécrire chat + ingestion ; seulement via passerelle compatible Anthropic.
- **Détection/blocage automatique du type de clé** — non fiable ; on informe (mention) et
  on teste, on ne bloque pas.
- **Rework de `ingest-local.ts`/`chat-agent.ts`** au-delà du basculement vers
  `getAnthropic()`/`getModel()`.
- **Retrait du SDK Agent mort ou nettoyage de `.env.local`** (clés Supabase/GitHub héritées) —
  hors sujet.
- **Bouton « effacer la clé »** — v1 : laisser vide conserve la clé ; un effacement explicite
  n'est pas requis (peut se faire en supprimant `ai-settings.json`).

## Todo

- [x] **`web/lib/ai-settings.ts`** — créer le store : `AiSettings`/`SafeAiSettings`,
      `readStore()` (sync, tolérant), `getAiSettings()` (précédence D3), `getSafeAiSettings()`
      (jamais la clé), `saveAiSettings()` (fusion + `writeJsonAtomic` atomique sous
      `<DATA_ROOT>/.data/ai-settings.json`), constantes `DEFAULT_MODEL='claude-sonnet-4-5'`
      et `ANTHROPIC_DIRECT_URL='https://api.anthropic.com'`.
      **Vérif :** test manuel Node/tsx — sans fichier : `getAiSettings()` renvoie l'env ;
      après `saveAiSettings({apiKey:'k',baseUrl:'',model:''})` : fichier
      `.data/ai-settings.json` présent, `getAiSettings().baseUrl===''` (pas la gateway env),
      `.model==='claude-sonnet-4-5'`, `getSafeAiSettings()` ne contient PAS `'k'` et expose
      `keyHint`/`hasKey:true`.
- [x] **`web/lib/claude.ts`** — remplacer `anthropic`/`CLAUDE_MODEL` par `getAnthropic()`
      (baseURL explicite, mémo par signature), `getModel()`, `isClaudeConfigured()`
      store-aware.
      **Vérif :** `grep -rn "export const anthropic\|export const CLAUDE_MODEL" web/lib/claude.ts`
      = 0 ; `npx tsc --noEmit` OK après l'étape suivante.
- [x] **Basculer les 2 consommateurs** — `web/lib/chat-agent.ts` (`getAnthropic()` en défaut
      client, `getModel()` en défaut modèle) et `web/lib/ingest-local.ts` (`getAnthropic().messages.create`,
      `model: getModel()` dans `callModel`).
      **Vérif :** `grep -rn "from '@/lib/claude'" web/lib web/app` ne montre plus `anthropic`/
      `CLAUDE_MODEL` importés ; `npx tsc --noEmit` OK ; `npm --prefix web test` (les 82 tests)
      vert (chat-agent + ingest-local inclus).
- [x] **`web/app/api/settings/route.ts`** — `GET` (forme sûre) + `POST` (`saveAiSettings`),
      jamais la clé en clair.
      **Vérif :** `curl GET /api/settings` → `{configured,source,baseUrl,model,hasKey,keyHint}`
      sans clé ; `curl POST /api/settings -d '{"apiKey":"...","baseUrl":"","model":"claude-sonnet-4-5"}'`
      → 200 + fichier écrit.
- [x] **`web/app/api/settings/test/route.ts`** — appel minimal `messages.create max_tokens:1`
      + mapping d'erreurs (401/429/404/autre).
      **Vérif :** `curl POST /api/settings/test` clé valide → `{ok:true}` ; clé invalide →
      `{ok:false,status:401,message:"Clé invalide…"}`.
- [x] **`.gitignore` racine** — ajouter `/.data/`.
      **Vérif :** `git check-ignore .data/ai-settings.json` → renvoie le chemin (ignoré, exit 0).
- [x] **`web/components/reglages/ReglagesView.tsx`** + **`web/app/reglages/page.tsx`** —
      formulaire (mention utilisateur obligatoire en haut, preset, clé masquée+œil, adresse,
      modèle, Enregistrer, Tester), branché sur les 3 routes.
      **Vérif :** ouvrir `/reglages` dans un `next dev` : l'encart de mention est visible ;
      basculer un preset préremplit adresse+modèle ; l'œil affiche/masque ; « Tester » montre
      succès/échec lisible ; « Enregistrer » persiste (badge passe à « Configuré ✓ »).
- [x] **`web/components/Sidebar.tsx`** (bouton engrenage → `<Link href="/reglages">` actif) +
      **`web/components/TopBar.tsx`** (`TITLES['/reglages']='Réglages'`).
      **Vérif :** l'engrenage navigue vers `/reglages` et s'affiche actif ; le titre de page
      est « Réglages ».
- [x] **Preuve « prise d'effet à chaud » (cœur du refactor)** — un seul `next dev`, port 3000
      (discipline `tasks/lessons.md` 2026-07-10 : tuer tout autre `next`, une seule instance).
      **Vérif :** (a) sans `ai-settings.json`, clé env valide → `curl -N POST /api/chat` streame ;
      (b) `POST /api/settings` avec une clé **volontairement invalide** ; (c) `curl -N POST
      /api/chat` de nouveau → **erreur d'auth 401** (prouve : nouvel appel = nouvelle clé, sans
      redémarrage) ; (d) restaurer (`rm .data/ai-settings.json` ou POST clé réelle) → `/api/chat`
      re-streame.
- [x] **Vérif finale** — `npx tsc --noEmit` OK ; `npm --prefix web run build` (`next build`) OK ;
      `npm --prefix web test` (82 tests) vert ; `web/lib/wiki-mutate.ts` non modifié
      (`git diff --stat` ne le liste pas).

---

*Note d'implémentation : après toute correction de l'utilisateur pendant
l'implémentation, consigner le pattern dans `tasks/lessons.md`.*

---

## Bilan

**Statut : implémenté et vérifié.** `tsc --noEmit` OK, `next build` OK, **98 tests**
verts (la spec annonçait 82 ; le projet en a gagné 16 depuis la rédaction — tous verts),
`web/lib/wiki-mutate.ts` non modifié (`git diff` ne le liste pas), `.data/ai-settings.json`
ignoré par git.

### Ce qui a été fait (conforme au plan)
- **`web/lib/ai-settings.ts`** — store `readStore()`/`getAiSettings()` (précédence D3)/
  `getSafeAiSettings()` (jamais la clé)/`saveAiSettings()` (fusion + écriture atomique).
  Vérifié par test Node isolé (DATA_ROOT temporaire) : sans fichier → env ; après save
  `baseUrl===''` (pas la gateway env), `model==='claude-sonnet-4-5'`, forme sûre sans la
  clé mais avec `keyHint`/`hasKey`.
- **`web/lib/claude.ts`** — `getAnthropic()` (baseURL explicite, mémo par signature),
  `getModel()`, `isClaudeConfigured()` store-aware. Singletons figés supprimés.
- **Bascule** `chat-agent.ts` + `ingest-local.ts` vers `getAnthropic()`/`getModel()` (au
  runtime). Aucun test cassé.
- **Routes** `GET/POST /api/settings` et `POST /api/settings/test` (mapping d'erreurs).
- **`.gitignore` racine** — `/.data/` ajouté.
- **UI** — `web/app/reglages/page.tsx` + `web/components/reglages/ReglagesView.tsx` (encart
  de mention obligatoire, preset segmented, clé masquée + œil, adresse, modèle, Enregistrer,
  Tester). `Sidebar` engrenage → `<Link href="/reglages">` actif ; `TopBar` titre « Réglages ».

### Preuve « prise d'effet à chaud » (cœur du refactor)
La recette littérale de la todo (a→d) supposait une **clé env valide** dans `web/.env.local`.
Or la clé présente y est un **placeholder invalide** (25 caractères ; une vraie clé Anthropic
en fait ~100+) : `POST /api/settings/test` corps vide → `401 « Clé invalide »`. Une clé
valide n'existant pas dans cet environnement de dev, les étapes (a)/(d) « clé valide → streame »
étaient **indémontrables pour une raison étrangère au refactor**.

**Déviation assumée — preuve déterministe équivalente (plus robuste, sans clé valide).** Un seul
`next dev` (port 3000, instance unique), on ne change QUE `.data/ai-settings.json` entre deux
requêtes `/api/chat` **identiques**, sans redémarrage, et le mode d'échec **bascule** :
- Leg 1 — clé bidon + Claude direct → `/api/chat` échoue en **401 `invalid x-api-key`** (auth).
- Leg 2 — SEUL le fichier change → `baseUrl:http://127.0.0.1:9` → même requête → **« Connection
  error. »** (≠ 401) : le changement d'adresse a pris effet à chaud.
- Leg 3 — suppression du fichier → `GET /api/settings` repasse `source:env`, `keyHint:null`.
Cela prouve exactement la revendication de la spec (« nouvel appel = nouvelle config, sans
redémarrage »), y compris l'étape (b)/(c) 401. La seule chose non montrée est un stream
*réussi* (nécessite une vraie clé) — démontrable à la demande via l'écran `/reglages` avec une
clé Anthropic ou gateway réelle.

### Petits écarts de détail (sans impact fonctionnel)
- **Route de test** : le **403** est mappé comme le **401** (« Clé invalide ou refusée ») — un
  refus d'autorisation de clé/budget se présente indifféremment en 401/403 selon la passerelle.
- **Route de test** : renvoie toujours **HTTP 200** avec le résultat dans le corps
  `{ok,status,message}` (le `status` porte le code amont) — plus simple à consommer côté client
  qu'un code HTTP d'erreur sur la route elle-même.
- **`saveMsg` UI** après enregistrement : re-`GET /api/settings` (comme demandé) pour rafraîchir
  badge + `hasKey`, et le champ clé est vidé (le secret est enregistré).
