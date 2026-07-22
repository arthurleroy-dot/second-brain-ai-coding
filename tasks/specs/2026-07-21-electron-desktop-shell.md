# Coquille Electron — application de bureau (.dmg / .exe) local-first

## Contexte

Le projet « AI Coding Second Brain » (wiki de veille + plateforme Next.js dans `web/`)
a été refondu en **local-first** (spec `tasks/specs/2026-07-20-refonte-local-first-electron.md`,
Phases 0–5 **faites et démontrées**). État réel du dépôt au moment de cette spec :

- **Toutes les écritures et lectures wiki/raw sont locales** via `web/lib/wiki-fs.ts`.
  Les racines dérivent d'une variable unique :
  ```ts
  // web/lib/wiki-fs.ts (lignes 8-10)
  export const DATA_ROOT = process.env.DATA_ROOT ?? path.resolve(process.cwd(), '..');
  export const WIKI_ROOT = process.env.WIKI_ROOT ?? path.join(DATA_ROOT, 'wiki');
  export const RAW_ROOT  = process.env.RAW_ROOT  ?? path.join(DATA_ROOT, 'raw');
  ```
- **L'historique de chat est local** : un fichier JSON par conversation sous
  `<DATA_ROOT>/.data/conversations/` (`web/lib/conversations-store.ts`).
- **L'ingestion est locale** (`web/lib/ingest-local.ts`, SDK Agent embarqué). Les règles
  du projet sont lues depuis `REFERENCE_DOCS_ROOT` :
  ```ts
  // web/lib/ingest-local.ts (ligne 24)
  const REFERENCE_ROOT = process.env.REFERENCE_DOCS_ROOT ?? path.resolve(process.cwd(), '..');
  // lit prompts/ingest-prompt.md + CLAUDE.md + docs/{ingestion,wiki-spec,entities}.md
  ```
- **L'accès IA passe par la gateway LiteLLM d'entreprise** (amendement D2, gateway conservée) :
  ```ts
  // web/lib/claude.ts (lignes 12-19)
  export const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
  });
  export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
  ```
  Le **chat** s'authentifie en `x-api-key` (`ANTHROPIC_API_KEY`). L'**ingestion**
  (SDK Agent) remappe en interne `ANTHROPIC_API_KEY` → `ANTHROPIC_AUTH_TOKEN` (Bearer)
  dans l'env du sous-process agent (`web/lib/ingest-local.ts:225-233`). **Conséquence pour
  la coquille : il suffit d'injecter `ANTHROPIC_API_KEY` (= clé gateway) + `ANTHROPIC_BASE_URL`
  + `ANTHROPIC_MODEL` dans l'env du serveur Next ; les deux chemins d'auth marchent.**
- Le chat renvoie déjà un **503 propre sans clé** :
  ```ts
  // web/app/api/chat/route.ts:25-31
  if (!isClaudeConfigured()) { … "Ajoute ta clé dans les réglages de l'app" … status: 503 }
  ```

**Il ne reste que la coquille Electron** (Phase 6 de la spec précédente, reportée à une
session sur le Mac d'Arthur). Demande d'origine d'Arthur (non-développeur, décide du QUOI) :
distribuer un **exécutable** (`.dmg` Mac + `.exe` Windows) ; double-clic → l'app s'ouvre ;
chacun a son wiki en local ; clé collée une fois ; mises à jour par un bouton. Décision D8 :
la couche Electron vit à la **racine du dépôt** (hors `web/`) et lance `web/` en sous-jacent.

**Faits d'environnement (relevés) :** pas de `package.json` à la racine ; pas de dossier
`web/public` ; `web/next.config.js` sans réglages hébergeur (nettoyé en Phase 5) ;
`wiki/resources/` contient **13 ressources** ; `raw/` contient les sources + sidecars
`.meta.md` ; `git remote origin = https://github.com/arthurleroy-dot/second-brain-ai-coding.git` ;
Node 26 / npm 11 ; dernières versions publiées : `electron@43.1.1`, `electron-builder@26.15.3`,
`electron-updater@6.8.9` (le `npm install` résoudra la version courante).

---

## Plan

*(Contenu intégral du plan validé, augmenté des faits code nécessaires à une session vierge.)*

### Architecture retenue

**1. Serveur Next embarqué via la sortie `standalone`.**
`web/next.config.js` gagne `output: 'standalone'`. Le build produit un serveur
auto-contenu (`web/.next/standalone/…/server.js` + `node_modules` tracés + `.next`
minimal). La coquille le lance comme un **process Node séparé** :
```js
child_process.spawn(process.execPath, [serverJsAbsPath], {
  cwd: path.dirname(serverJsAbsPath),
  env: { ...serverEnv, ELECTRON_RUN_AS_NODE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
```
`ELECTRON_RUN_AS_NODE=1` fait tourner le binaire Electron en **pur Node** (pas d'API
Electron) — idéal pour le serveur Next, et ça évite toute dépendance à un `node` système.
Raison du choix standalone plutôt que « bundler tout `web/` » : c'est le mécanisme conçu
pour l'embarquement, il embarque les deps tracées (dont `@anthropic-ai/sdk` du chat), et
il ne réécrit rien dans `.next` à l'exécution pour une app 100 % dynamique comme la nôtre.

⚠️ **Chemin de `server.js` à détecter au runtime** (dépend de la racine de tracing Next) :
tester `<standalone>/server.js` **puis** `<standalone>/web/server.js`. Idem dans le
script de copie d'assets. **Ne pas deviner : inspecter l'arbre après le premier build.**

⚠️ **Assets statiques** : Next standalone ne copie pas `.next/static` ni `public`.
Un script post-build (`electron/copy-standalone-assets.js`) copie `web/.next/static`
vers `<base>/.next/static` (où `<base> = dirname(server.js)`). Pas de `web/public` ici
(inexistant) → sauter cette copie si absent.

**2. Séparation code / données (décision D9).**
`DATA_ROOT = app.getPath('userData')`. Appeler `app.setName('SecondBrain')` **avant** tout
`app.getPath('userData')` pour figer le dossier (`~/Library/Application Support/SecondBrain/`
sur Mac, `%APPDATA%\SecondBrain\` sur Windows). Variables injectées dans l'env du serveur :

| Variable | Valeur |
|----------|--------|
| `DATA_ROOT` | `app.getPath('userData')` |
| `ANTHROPIC_API_KEY` | clé gateway déchiffrée (`safeStorage`), ou `''` si non configurée |
| `ANTHROPIC_BASE_URL` | URL gateway du réglage (défaut `https://llm-gateway.m33.tech`) |
| `ANTHROPIC_MODEL` | modèle du réglage (défaut `claude-sonnet-4-6`) |
| `REFERENCE_DOCS_ROOT` | dev : racine du dépôt ; packagé : `<resources>/reference` |
| `PORT` | port local choisi (voir §4) |
| `HOSTNAME` | `127.0.0.1` (écoute locale uniquement) |
| `NODE_ENV` | `production` |

Le code (standalone + assets de référence + seed) vit en **lecture seule** dans le bundle ;
`wiki/`, `raw/`, `.data/`, `electron-settings.json` vivent dans `userData` → une mise à
jour du code ne les touche jamais.

**3. Réglages = page Next `/settings` + pont `preload`.**
L'app EST l'app Next dans une `BrowserWindow`. Un preload `contextBridge` expose
`window.secondBrain` ; une page `web/app/settings/page.tsx` (client) l'appelle. Les
opérations privilégiées (safeStorage, redémarrage serveur, updater, test de clé) vivent
dans le **main process** via IPC `ipcMain.handle`.

`BrowserWindow` : `{ webPreferences: { preload, contextIsolation: true, nodeIntegration: false } }`.

Preload (`electron/preload.js`) :
```js
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('secondBrain', {
  isElectron: true,
  getSettings:   () => ipcRenderer.invoke('settings:get'),      // → {hasKey, model, gatewayUrl}
  saveSettings:  (s) => ipcRenderer.invoke('settings:save', s), // s: {key?, model, gatewayUrl}
  testKey:       (s) => ipcRenderer.invoke('settings:test', s), // s: {key?, model, gatewayUrl} → {ok, error?}
  getVersion:    () => ipcRenderer.invoke('app:version'),
  checkForUpdate:() => ipcRenderer.invoke('update:check'),
  quitAndInstall:() => ipcRenderer.invoke('update:install'),
  onUpdateStatus:(cb) => ipcRenderer.on('update:status', (_e, d) => cb(d)),
});
```

**4. Cycle de vie (`electron/main.js`).**
```
app.setName('SecondBrain')
app.whenReady():
  DATA_ROOT = app.getPath('userData')
  seedIfEmpty(DATA_ROOT, seedRoot)                # §6
  settings = loadSettings()                        # déchiffre la clé
  port = pickPort(41730)                           # fixe si libre, sinon 1er libre ; bind 127.0.0.1
  startServer(buildServerEnv(settings, port))      # spawn + attendre disponibilité (poll HTTP)
  win = new BrowserWindow({...preload...})
  win.loadFile('electron/loading.html')            # écran d'attente
  await waitForServer('http://127.0.0.1:'+port)    # poll GET / jusqu'à réponse (timeout ~30 s)
  win.loadURL('http://127.0.0.1:'+port+'/chat')
  registerIpcHandlers()
  setupAutoUpdater()
app.on('window-all-closed' → quit) ; kill du process serveur au quit.
```
`pickPort` : tenter `net.createServer().listen(port,'127.0.0.1')` ; si `EADDRINUSE`,
incrémenter. `waitForServer` : boucle `fetch`/`http.get` sur `/` toutes les ~250 ms.

**5. Clé chiffrée + réglages (`electron/settings-store.js`, décision D12).**
Fichier `path.join(app.getPath('userData'), 'electron-settings.json')` :
`{ model, gatewayUrl, keyEnc }` où `keyEnc = safeStorage.encryptString(key).toString('base64')`.
- `loadSettings()` : parse le JSON ; `getKey()` = `safeStorage.decryptString(Buffer.from(keyEnc,'base64'))`
  si `keyEnc` présent et `safeStorage.isEncryptionAvailable()`, sinon `''`.
- `saveSettings({model, gatewayUrl, key?})` : si `key` non vide → rechiffrer `keyEnc` ;
  si `key` absent/vide → **conserver** `keyEnc` existant. Écrire le JSON. Défauts :
  `gatewayUrl = 'https://llm-gateway.m33.tech'`, `model = 'claude-sonnet-4-6'`.
- `settings:get` renvoie `{ hasKey: Boolean(keyEnc), model, gatewayUrl }` — **jamais** la clé.
- **La clé ne doit jamais apparaître en clair sur disque** (vérif : `grep` de la clé dans
  `electron-settings.json` = 0).

**Redémarrage serveur à tout changement** : le modèle et la clé sont lus au **chargement
des modules Next** (`web/lib/claude.ts` en top-level) → un changement exige de relancer le
serveur. `settings:save` doit : écrire les réglages → `killServer()` → `startServer(newEnv)`
→ `waitForServer()` → `win.webContents.reload()` (recharge l'app avec le nouvel env). C'est
un comportement **voulu** par la spec (« prévoir un redémarrage du serveur quand elle change »).

**6. Premier lancement / seeding (`electron/seed.js`).**
```js
function seedIfEmpty(dataRoot, seedRoot) {
  // seedRoot = dev: racine du dépôt ; packagé: path.join(process.resourcesPath, 'seed')
  if (!fs.existsSync(path.join(dataRoot, 'wiki')))
    fs.cpSync(path.join(seedRoot, 'wiki'), path.join(dataRoot, 'wiki'), { recursive: true });
  if (!fs.existsSync(path.join(dataRoot, 'raw')))
    fs.cpSync(path.join(seedRoot, 'raw'),  path.join(dataRoot, 'raw'),  { recursive: true });
}
```
Résultat attendu au 1er lancement sur `userData` vierge : **13 ressources** dans
`<userData>/wiki/resources/`, et `raw/` pré-rempli.

**7. Test de clé (`settings:test`, main process, avant sauvegarde).**
`fetch` direct vers la gateway (miroir exact du client chat `@anthropic-ai/sdk`, prouvé
en Phase 3) :
```js
const base = (gatewayUrl || 'https://llm-gateway.m33.tech').replace(/\/$/, '');
const r = await fetch(base + '/v1/messages', {
  method: 'POST',
  headers: { 'content-type': 'application/json',
             'x-api-key': keyToTest,               // clé du formulaire, sinon clé stockée
             'anthropic-version': '2023-06-01' },
  body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
});
// ok si r.ok ; sinon renvoyer { ok:false, error: (texte tronqué) } ; catch réseau → { ok:false, error }
```
Node d'Electron (main) a `fetch` global. `max_tokens:1` = appel minuscule.

**8. Auto-updater (`electron-updater`, décisions D10).**
- `update:check` : si `!app.isPackaged` → `{ status: 'dev' }` (l'updater lève une erreur
  hors app packagée). Sinon `autoUpdater.checkForUpdates()`. Câbler les events
  (`update-available`, `update-not-available`, `download-progress`, `update-downloaded`,
  `error`) → `win.webContents.send('update:status', {...})`.
- `update:install` : `autoUpdater.quitAndInstall()`.
- **Sûreté données** : `electron-updater` remplace le code dans `/Applications` (ou
  `%LOCALAPPDATA%`), **jamais** `userData`. Inhérent à la séparation D9 (l'updater
  n'a pas connaissance de `userData`).
- Config `publish` (voir build) fournit le feed ; electron-builder écrit `app-update.yml`.

### Fichiers

**Racine (nouveaux) :**
- `package.json` — voir §build.
- `electron/main.js` — cycle de vie §4 + IPC + updater.
- `electron/preload.js` — pont §3.
- `electron/settings-store.js` — §5.
- `electron/server.js` — helper spawn/kill/poll/détection chemin server.js ; logs →
  `<userData>/.data/server.log`.
- `electron/seed.js` — §6.
- `electron/copy-standalone-assets.js` — copie `web/.next/static` dans l'arbre standalone
  (détection du `<base>`), Node pur, idempotent.
- `electron/loading.html` — écran d'attente statique (aucune ressource externe).
- `GUIDE.md` — voir §GUIDE.
- `.gitignore` — ajouter `/node_modules/` (racine) et `/dist/` (sortie electron-builder).

**`web/` (modifs) :**
- `web/next.config.js` — ajouter `output: 'standalone'`. **Conserver** `reactStrictMode`,
  `experimental.serverComponentsExternalPackages:['gray-matter']`, et le
  `webpack: (config,{dev}) => { if (dev) config.cache = false; return config }`
  (fix Node récent, cf. `tasks/lessons.md` 2026-07-10). Contenu actuel du fichier :
  ```js
  /** @type {import('next').NextConfig} */
  const nextConfig = {
    reactStrictMode: true,
    experimental: { serverComponentsExternalPackages: ['gray-matter'] },
    webpack: (config, { dev }) => { if (dev) { config.cache = false; } return config; },
  };
  module.exports = nextConfig;
  ```
- `web/app/settings/page.tsx` (nouveau, `'use client'`) — formulaire réglages + section
  mise à jour. Motif de page (cf. `web/app/layout.tsx:23` `<main className="flex-1 overflow-hidden">`) :
  englober dans `<div className="h-full overflow-y-auto p-6">` (scroll interne, cf.
  `tasks/lessons.md` 2026-07-10). Champs : URL gateway (`text`), modèle (`text`), clé
  (`password`, placeholder « •••• (déjà enregistrée) » si `hasKey`, vide = conserver).
  Boutons « Tester la clé » (→ `testKey`, affiche OK/erreur) et « Enregistrer »
  (→ `saveSettings`, affiche « Enregistré, redémarrage… »). Section « Mise à jour » :
  `getVersion()` + bouton « Vérifier / Mettre à jour » (→ `checkForUpdate`, statut via
  `onUpdateStatus`). Lire les valeurs via `useEffect(() => { window.secondBrain?.getSettings()… })`
  (guard SSR : `typeof window`). Repli si `!window.secondBrain` : message « Réglages
  disponibles uniquement dans l'application de bureau. »
- `web/components/Sidebar.tsx` — le bouton Paramètres (actuellement un `<button>` inerte,
  lignes 67-73, icône `Settings` de `lucide-react` déjà importée) devient
  `<Link href="/settings" title="Paramètres" className="…">` (réutiliser le style actif/inactif
  des autres liens ; `active = pathname.startsWith('/settings')`).

### Config electron-builder (clé `build` de `package.json` racine)

```jsonc
{
  "name": "secondbrain-desktop",
  "version": "0.1.0",
  "private": true,
  "main": "electron/main.js",
  "scripts": {
    "build:web": "npm --prefix web install && npm --prefix web run build && node electron/copy-standalone-assets.js",
    "start": "electron .",
    "app": "npm run build:web && electron .",
    "dist": "npm run build:web && electron-builder"
  },
  "dependencies": { "electron-updater": "^6.8.9" },
  "devDependencies": { "electron": "^43.1.1", "electron-builder": "^26.15.3" },
  "build": {
    "appId": "tech.m33.secondbrain",
    "productName": "SecondBrain",
    "files": ["electron/**/*", "package.json"],
    "extraResources": [
      { "from": "web/.next/standalone", "to": "standalone" },
      { "from": "wiki",     "to": "seed/wiki" },
      { "from": "raw",      "to": "seed/raw" },
      { "from": "prompts",  "to": "reference/prompts" },
      { "from": "docs",     "to": "reference/docs" },
      { "from": "CLAUDE.md","to": "reference/CLAUDE.md" }
    ],
    "mac": { "target": ["dmg"], "category": "public.app-category.productivity", "identity": null },
    "win": { "target": ["nsis"] },
    "publish": { "provider": "github", "owner": "arthurleroy-dot", "repo": "second-brain-ai-coding" }
  }
}
```
- `electron-updater` en `dependencies` (requis au runtime, bundlé dans l'app) ;
  `electron` + `electron-builder` en `devDependencies` (outillage).
- `mac.identity: null` → build **non signé** (v1).
- En packagé, calculer dans `main.js` : `resources = process.resourcesPath` ;
  `serverBase = <resources>/standalone` (+ détection `server.js`|`web/server.js`) ;
  `REFERENCE_DOCS_ROOT = <resources>/reference` ; `seedRoot = <resources>/seed`.
- En dev, `serverBase = <repo>/web/.next/standalone`, `REFERENCE_DOCS_ROOT = <repo>`,
  `seedRoot = <repo>`. Détecter dev/packagé via `app.isPackaged`.

### GUIDE.md (FR, non-technicien)

Sections : (1) Installer (Mac : ouvrir le `.dmg`, glisser dans Applications ;
Windows : lancer le `.exe`). (2) **Contourner l'alerte « app non vérifiée »** — Mac :
clic droit sur l'app → **Ouvrir** → **Ouvrir** ; Windows : « Windows a protégé votre
PC » → **Informations complémentaires** → **Exécuter quand même**. (3) Coller **la clé
de la gateway d'entreprise** dans Réglages (⚙️) → « Tester la clé » → « Enregistrer »
(pas de console.anthropic.com — clé gateway partagée, amendement D2). (4) Déposer une
ressource (bouton Déposer). (5) Mettre à jour (Réglages → Mise à jour).

### Points de vigilance

- **Une seule instance de serveur** : tuer tout process serveur au quit ; ne pas cumuler
  les `next start`/serveurs (cf. `tasks/lessons.md` 2026-07-10 — les workers Next se
  détachent et se battent pour le port). Le spawn unique piloté par `main.js` gère ça.
- **Écriture read-only en packagé** : l'app est 100 % dynamique (aucun ISR ; `webpack
  cache=false` en dev seulement) donc le serveur standalone ne réécrit pas `.next/cache`.
  Si le `.dmg` installé plante sur une écriture read-only, **replier** en copiant l'arbre
  standalone vers `<userData>/server/` au 1er lancement (writable) et lancer depuis là.
  À **vérifier** sur le `.dmg` réel (todo Phase build).
- **Ingestion réelle en packagé NON garantie v1** : `runIngestion` (binaire SDK Agent) et
  le `spawn` `tsx scripts/wiki-verify.ts` peuvent ne pas être tracés dans standalone.
  Reporté à la spec « ingestion pas chère » (cf. encadré Phase 4 de la spec précédente).
  Le chat, la lecture, l'upload, l'arbitrage, la suppression fonctionnent en packagé.

---

## Décisions

### Périmètre de production validé (Arthur, 2026-07-21)

- **P1 — Cibles : Mac ET Windows.** `.dmg` Mac buildé localement (session sur le Mac
  d'Arthur) ; `.exe` Windows (NSIS) buildé par **GitHub Actions** (runner `windows-latest`)
  qui produit l'installeur en **artefact téléchargeable** — pas de machine Windows requise.
- **P2 — v1 NON signée** (confirme D-E5) : ni Apple ni Windows. Contournement Gatekeeper/
  SmartScreen documenté dans `GUIDE.md`.
- **P3 — Distribution = fichier partagé à la main** (lien / drive interne), PAS de Releases
  GitHub. **Conséquence : l'auto-updater est RETIRÉ de la v1.** Concrètement dans
  `electron/main.js` : ne pas câbler `electron-updater` (retirer `setupAutoUpdater`, les IPC
  `update:check`/`update:install`, la clé `publish` de la config build, et la dépendance
  `electron-updater`). La page réglages garde l'affichage de la **version** (`app:version`)
  mais pas de bouton « Mettre à jour ». Sortie de secours : câblage updater réactivable plus
  tard si Arthur passe aux Releases. Annule D-E9 pour la v1.
- **P4 — Réglages à effet immédiat (Bloc 1) plutôt que redémarrage serveur.** L'écran
  `/reglages` (spec `2026-07-21-reglages-acces-ia.md`) reconstruit l'accès IA **à
  l'exécution** ⇒ **supersède D-E4** (redémarrage du serveur à chaque changement). La coquille
  n'a donc plus à faire `killServer→startServer→reload` sur `settings:save` : elle écrit les
  réglages (clé chiffrée `safeStorage`) et l'app les prend en compte à chaud. `/reglages` est
  le **socle** ; l'apport Electron par-dessus = chiffrement disque + seeding + packaging.

### Décisions techniques

- **D-E1 — Serveur Next embarqué via `output: 'standalone'` + `spawn(process.execPath,
  …, ELECTRON_RUN_AS_NODE=1)`.** Écarté : bundler tout `web/node_modules` (bundle énorme,
  mais évite les soucis de tracing) ; `utilityProcess.fork` (viable, mais `spawn` +
  `ELECTRON_RUN_AS_NODE` est plus simple pour stdio et cwd). Raison : mécanisme conçu pour
  l'embarquement, dépendances tracées, pas de `node` système requis, dev == packagé.
- **D-E2 — Réglages en page Next `/settings` + preload `contextBridge`.** Écarté : fenêtre
  Electron native séparée (duplique l'UI, sort du style de l'app). Raison : cohérence UI,
  le pont couvre les op privilégiées.
- **D-E3 — Clé testable AVANT sauvegarde, via `fetch` main process.** Écarté : route Next
  `/api/test-key` (la clé n'est pas encore dans l'env du serveur tant que non sauvegardée+
  redémarrée). Raison : tester la clé saisie sans redémarrage préalable.
- **D-E4 — Redémarrage du serveur à chaque changement de réglage.** Écarté : lecture
  dynamique des réglages par requête (imposerait de modifier `claude.ts`/`ingest-local.ts`).
  Raison : conforme à la spec (« redémarrage quand la clé change »), zéro modif de la logique IA.
- **D-E5 — v1 NON signée.** Écarté : signature Apple/Windows (certificats + coût). Raison
  (décision Arthur) : livrer vite ; contournement documenté dans `GUIDE.md`.
- **D-E6 — Aller jusqu'au `.dmg` réel dans la session d'implémentation.** Raison (décision
  Arthur) : repartir avec un artefact installable ; valider la chaîne de packaging.
- **D-E7 — Injecter uniquement `ANTHROPIC_API_KEY` (clé gateway) + `BASE_URL` + `MODEL`.**
  L'ingestion remappe seule en `ANTHROPIC_AUTH_TOKEN`. Raison : un seul secret à gérer.
- **D-E8 — `DATA_ROOT = userData` en dev ET en packagé** (la coquille le fixe toujours).
  Raison : prouve « données dans userData, pas le dépôt » et unifie dev/packagé.
- **D-E9 — Updater sur `arthurleroy-dot/second-brain-ai-coding` (Releases publiques).**
  Raison : dépôt détecté ; à corriger si Arthur change de dépôt de distribution.

---

## Hors périmètre

- **Signature de code** (certificats Apple/Windows) — v1 non signée (D-E5).
- **Ingestion réelle end-to-end en packagé** — reportée à la spec « ingestion pas chère ».
- **Optimisation du coût d'ingestion** — spec dédiée (encadré Phase 4 de la spec précédente).
- **Modification de `web/lib/wiki-mutate.ts`** — interdite (moteur pur testé).
- **Migration/partage de données entre coéquipiers** — aucun (chaque wiki diverge).
- **Publier une Release GitHub / tester une vraie mise à jour de bout en bout** — la
  sûreté données est démontrée par l'architecture (données hors du code) ; publier une
  release sort du périmètre de cette session.

---

## Todo

### Préparation & build web
- [x] Ajouter `output: 'standalone'` à `web/next.config.js` (conserver le reste).
      **Vérif :** `npm --prefix web run build` réussit et crée `web/.next/standalone/`.
      **+ élégance :** `experimental.outputFileTracingRoot` fixé au dossier `web/` pour que
      l'arbre reste **plat** (`standalone/server.js`) malgré le `package.json` racine.
- [x] Inspecter l'arbre `web/.next/standalone/` (`find web/.next/standalone -maxdepth 3 -name server.js`)
      pour figer le chemin réel de `server.js`.
      **Vérif :** chemin réel = `web/.next/standalone/server.js` (à plat) ; `electron/server.js`
      détecte quand même les deux cas (`server.js` / `web/server.js`).
- [x] Écrire `electron/copy-standalone-assets.js` (copie `web/.next/static` → `<base>/.next/static`).
      **Vérif :** exécuté en fin de `build:web` ; `<base>/.next/static` présent (styles OK à l'écran) ; idempotent.

### Coquille Electron (dev)
- [x] Créer `package.json` racine (deps + scripts + clé `build`) et l'installer
      (`npm install` à la racine). **Sans `electron-updater` ni `publish` (P3).**
      **Vérif :** `electron --version` = **v43.1.1** (hors `ELECTRON_RUN_AS_NODE`) ;
      `electron-builder` v26.15.3 ; `electron-updater` **absent** (conforme P3).
- [~] ~~`electron/settings-store.js` (chiffrement `safeStorage`)~~ **SUPPRIMÉ — Option A
      retenue par Arthur (2026-07-21).** La clé est stockée en clair dans
      `<userData>/.data/ai-settings.json` (écran `/reglages`), relue à chaud par le serveur.
      Pas de `safeStorage`, pas de redémarrage serveur. (Voir Bilan.)
- [x] Écrire `electron/seed.js`, `electron/server.js`, `electron/preload.js`,
      `electron/loading.html`, `electron/main.js` (cycle §4, **sans updater** ; preload réduit
      à `getVersion`). **+ garde-fou** : re-`spawn` propre si `ELECTRON_RUN_AS_NODE` fuit dans l'env ambiant.
      **Vérif :** l'app démarre (voir vérifs suivantes) ; `server.log` → `Ready in ~100–200ms`.
- [~] ~~`web/app/settings/page.tsx` + Sidebar → `/settings`~~ **SUPERSÉDÉ (P4)** : l'écran
      `/reglages` existe déjà et la Sidebar y pointe déjà. Seul ajout : ligne « version »
      dans `ReglagesView.tsx` (guardée `window.secondBrain`, SSR-safe, additive).
      **Vérif :** `npm run build:web` liste bien `/reglages` ; `tsc --noEmit` OK.

### Vérification fonctionnelle (dev, sur le Mac)
- [x] Sur un `userData` **vierge**, l'app (electron sur le standalone) ouvre une fenêtre
      affichant l'app.
      **Vérif :** `capturePage()` → PNG relu = page `/chat` stylée (Tailwind chargé), Sidebar,
      badge « sources » ; serveur `Ready in 203ms` sur `http://127.0.0.1:41730`.
- [x] **Données dans userData, pas le dépôt** + seeding.
      **Vérif :** `wiki/resources/*.md` dans userData ⇒ **13 en dev** (14 en packagé, cf. Bilan :
      le wiki a grossi pendant la session via une **ingestion concurrente**, seeding fidèle) ;
      `git status wiki raw` du dépôt inchangé **par l'app** (DATA_ROOT=userData).
- [x] **Test de clé + persistance (Option A, clair).**
      **Vérif (déterministe, sans clé valide) :** `POST /api/settings` ⇒ `configured:true,
      keyHint:ABCD` écrit dans `<userData>/.data/ai-settings.json` (clé **en clair**, hors dépôt) ;
      **redémarrage** du serveur ⇒ `GET /api/settings` toujours `configured:true, source:store`
      ⇒ la clé survit. Stream réussi non montré (pas de clé gateway valide dispo — cf. Bilan).
- [x] **Sûreté « mise à jour » (raisonnée).**
      **Vérif :** `userData` (wiki/raw/.data/clé) prouvé hors du code bundlé (seeding + dépôt
      intact). Updater retiré (P3) ⇒ item `update:check {status:'dev'}` **sans objet**.

### Packaging (.dmg réel)
- [x] `npm run dist` (build:web + electron-builder) produit un `.dmg` non signé.
      **Vérif :** `dist/SecondBrain-0.1.0-arm64.dmg` (~131 Mo) ; **monté en lecture seule**,
      binaire lancé ⇒ fenêtre `/chat` stylée, wiki lisible (seed depuis `<resources>/seed` sur
      userData vierge), serveur `Ready in 95ms`. **Écriture read-only : AUCUN blocage** ⇒ le
      repli « copie standalone → userData » n'est **pas nécessaire**. Deux correctifs de packaging
      trouvés & appliqués (cf. Bilan) : `afterPack` pour les `node_modules` du standalone, et
      `rm -rf .next` en tête de `build:web` (crash Node 26 `_document`).

### Documentation & clôture
- [x] Rédiger `GUIDE.md` (FR, sections §GUIDE : install, contournement Gatekeeper/SmartScreen,
      clé gateway, dépôt ressource, mise à jour **manuelle** — updater retiré P3).
      **Vérif :** relecture — un non-technicien peut suivre ; mentionne la **clé gateway** (pas
      console.anthropic.com) ; explique que les données survivent à une réinstallation.
- [x] Mettre à jour `.gitignore` (`/node_modules/`, `/dist/`).
      **Vérif :** `git status` ne liste ni `node_modules/` racine ni `dist/`.
- [x] Ajouter une section « Session Electron » au `## Bilan` de cette spec (fait / dévié / limites).
      (La spec précédente `2026-07-20` garde son Bilan ; cette session est tracée ici.)
- [x] Consigner les patterns dans `tasks/lessons.md` ; mettre à jour la mémoire projet
      (`electron-app-todo.md`).
- [ ] **Proposer** le commit (ne pas committer sans accord).
```
```

---

*Note d'implémentation : lire `tasks/lessons.md` en début de session. Après toute
correction d'Arthur pendant l'implémentation, y consigner le pattern (contexte / correction
/ règle).*

---

## Bilan

**Statut : implémenté et démontré sur le Mac d'Arthur — un `.dmg` installable est produit
et lancé avec succès.** `tsc --noEmit` OK ; `next build` OK ; `npm run dist` produit
`dist/SecondBrain-0.1.0-arm64.dmg` (~131 Mo, non signé) ; l'app packagée démarre depuis un
volume **read-only** (dmg monté) et affiche le wiki.

### Périmètre retenu (décisions d'Arthur en début de session)
- **Option A — clé en clair.** Arthur a choisi de stocker la clé **en clair** dans
  `<userData>/.data/ai-settings.json` (via l'écran `/reglages` existant), plutôt que chiffrée
  `safeStorage`. Conséquence : **pas** de `electron/settings-store.js`, **pas** de page
  `/settings`, **pas** de redémarrage serveur, **pas** de pont IPC pour la clé. La coquille
  n'apporte que : serveur embarqué + seeding + packaging + `DATA_ROOT=userData`.
- **P3 — pas d'auto-updater.** `electron-updater`, `setupAutoUpdater`, les IPC
  `update:*` et la clé `publish` sont retirés. Seule la **version** est affichée (`app:version`).
- **P4 — réglages à chaud.** `/reglages` (déjà livré) reconstruit l'accès IA à l'exécution ;
  la coquille n'a rien à redémarrer.

### Ce qui a été fait (et prouvé)
- **`web/next.config.js`** : `output: 'standalone'` + `experimental.outputFileTracingRoot`
  fixé à `web/` → arbre standalone **plat et déterministe** (`standalone/server.js`).
- **`electron/`** : `main.js` (cycle de vie §4, sans updater), `server.js` (spawn/kill/poll +
  détection de `server.js`), `seed.js` (seeding idempotent non destructif), `preload.js` (pont
  minimal `getVersion`), `loading.html`, `copy-standalone-assets.js`, `after-pack.js`.
- **`package.json` racine** + `build` electron-builder (dmg mac + nsis win, non signés).
- **`ReglagesView.tsx`** : ligne « Application de bureau — version X » (additive, guardée `window.secondBrain`).
- **Preuves** : (1) capture d'écran de `/chat` **stylée** en dev ET en packagé ; (2) seeding
  → `wiki/resources` dans userData, **dépôt jamais écrit par l'app** (DATA_ROOT=userData) ;
  (3) persistance de la clé à travers un **redémarrage** du serveur, clé en clair hors dépôt ;
  (4) app packagée fonctionnelle depuis le **dmg read-only** (serveur `Ready in 95ms`).

### Déviations par rapport au plan écrit (assumées)
1. **`afterPack` au lieu de `extraResources` pour le standalone.** electron-builder **exclut
   de force les `node_modules` imbriqués** d'un `extraResources` (même avec `filter`) → le
   serveur plantait `Cannot find module 'next'`. Correctif : hook `electron/after-pack.js` qui
   copie l'arbre standalone (avec ses `node_modules`) dans les `Resources` en pur Node. Prouvé
   par `node_modules/next` présent dans le `.app`.
2. **`rm -rf .next` en tête de `build:web`.** Sous **Node 26**, `next build` par-dessus un
   `.next` existant (aggravé par un worker `next-server` détaché) plante en
   `PageNotFoundError: /_document`. Nettoyage systématique = build reproductible (corroboré par
   une leçon ajoutée en parallèle par une autre session, cf. `lessons.md` 2026-07-21 Node 26).
3. **`outputFileTracingRoot` ajouté** (non prévu) : rend l'arbre plat malgré le `package.json`
   racine et évite d'aspirer les `node_modules` d'Electron. Plus robuste que la détection à deux cas.
4. **Garde-fou `ELECTRON_RUN_AS_NODE`** : l'environnement de dev portait ce drapeau (le binaire
   Electron démarrait en pur Node, sans fenêtre) → `main.js` se relance proprement sans le drapeau.

### Limites connues (v1, hors périmètre)
- **Stream de chat réussi non démontré** : aucune clé gateway valide dans l'environnement de
  build. Prouvé à la place : 503 propre sans clé, persistance de la config à chaud/après
  redémarrage. À vérifier par Arthur avec une vraie clé via `/reglages`.
- **`.exe` Windows non produit ici** : décision P1 = build via **GitHub Actions** (runner
  `windows-latest`). ⚠️ **Le workflow GitHub Actions n'est pas dans la todo de cette spec** —
  à créer dans une étape ultérieure (le `package.json` cible déjà `win: nsis`).
- **Signature de code** : aucune (v1 non signée, P2) → contournement Gatekeeper/SmartScreen
  documenté dans `GUIDE.md`.
- **Ingestion réelle en packagé** : non revérifiée cette session (dépend du tracing standalone
  de `unpdf`/`spawn`) — reste hors périmètre. Chat, lecture, upload, arbitrage, suppression OK.

### Point d'attention hors sujet (à signaler)
Pendant la session, **une ou plusieurs autres sessions Claude Code tournaient sur le même
dépôt** et y ont **ingéré des ressources** (`raw/note-*.txt`, `wiki/resources/note-*.md`,
entités, vues régénérées, et un ajout à `tasks/lessons.md`). C'est ce qui fait passer le
compte de ressources de 13 → 14/15 et fait échouer **1 test sur 98** (`wiki-tools.test.ts`
attend 13, trouve 15). **Aucun lien avec la coquille Electron** ; à trancher par Arthur (ces
fichiers ne doivent pas entrer dans le commit Electron).
