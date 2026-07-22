# Lessons

Journal des leçons tirées des corrections de l'utilisateur. Après **toute**
correction, ajoute ici le pattern + la règle pour ne pas refaire l'erreur. Relis
ce fichier en début de session.

Format :

```
## <date> — <titre court>
**Contexte :** ce qui s'est passé.
**Correction :** ce que l'utilisateur a demandé à la place.
**Règle :** ce que je fais désormais systématiquement.
```

---

## 2026-07-08 — Git = seule source de vérité du wiki
**Contexte :** l'ancienne plateforme écrivait le wiki dans Supabase, créant une
seconde source de vérité désynchronisée du markdown.
**Correction :** le wiki markdown versionné dans git est la SEULE source de
vérité ; Supabase ne garde que conversations/messages/comptes.
**Règle :** ne jamais persister de contenu wiki dans Supabase. La plateforme lit
le markdown. Toute écriture de contenu passe par un commit dans `raw/` puis
l'agent d'ingestion (qui n'écrit que dans `wiki/`).

## 2026-07-08 — CLAUDE.md doit rester court
**Contexte :** CLAUDE.md faisait 261 lignes, chargé intégralement à chaque session.
**Correction :** CLAUDE.md court (carte + règles cardinales + renvois) ; le détail
dans `docs/*` que les agents ne lisent que si nécessaire.
**Règle :** ne pas gonfler CLAUDE.md ; toute spec détaillée va dans `docs/`.

## 2026-07-08 — Ne pas mettre de deny bloquants dans le `.claude/settings.json` committé
**Contexte :** j'avais mis `Write/Edit(web/**, .github/**, .claude/**, …)` en deny
dans le `.claude/settings.json` versionné comme « double ceinture » pour l'Action
d'ingestion. Mais ce fichier s'applique à TOUTES les sessions du repo : il a fini
par bloquer mes propres éditions de `web/` (dev), et il se protège lui-même
(`Edit(.claude/**)`), créant un lockout impossible à corriger en auto-mode.
**Correction :** les restrictions spécifiques à un run headless doivent vivre dans
un fichier dédié chargé via `claude --settings <file>` (ex. `.github/ingest-settings.json`),
PAS dans le `.claude/settings.json` partagé. L'invariant anti-boucle est de toute
façon garanti par `git add wiki/` seul dans l'Action.
**Règle :** ne jamais committer dans `.claude/settings.json` un deny qui couvre des
chemins de dev (`web/**`, `.github/**`, `.claude/**`). Scoper les restrictions d'un
agent headless via `--settings`. Vérifier après coup que je peux toujours éditer
les zones de travail.

## 2026-07-09 — Le CLI Claude Code via gateway (LiteLLM) exige ANTHROPIC_AUTH_TOKEN
**Contexte :** validation de bout en bout de `claude -p` via le proxy LiteLLM
(`ANTHROPIC_BASE_URL`). Le proxy répond 200 en curl (x-api-key, streamé et non
streamé), mais `claude -p` bouclait sur des **401** puis, sur config vierge,
affichait « Not logged in · Please run /login ». La GitHub Action (runner vierge,
`ANTHROPIC_API_KEY` seule) aurait donc échoué.
**Correction :** pour une gateway, le CLI s'authentifie via **`ANTHROPIC_AUTH_TOKEN`**
(envoyé en `Authorization: Bearer`), PAS via `ANTHROPIC_API_KEY` seule. Ajout de
`ANTHROPIC_AUTH_TOKEN: ${{ secrets.ANTHROPIC_API_KEY }}` dans l'env de `ingest.yml`.
Le SDK web (`@anthropic-ai/sdk`, chat) se contente de `ANTHROPIC_API_KEY` (x-api-key).
**Règle :** CLI Claude Code + gateway → `ANTHROPIC_AUTH_TOKEN`. Tester en isolant la
config (`CLAUDE_CONFIG_DIR=$(mktemp -d)`) pour reproduire un runner vierge, sinon la
session OAuth locale masque le vrai comportement.

## 2026-07-10 — Un formulaire dense va dans une page, pas une modale
**Contexte :** l'upload était une modale `max-w-md` bourrée de champs (métadonnées +
liens + thèmes + suivi d'ingestion). Impossible de scroller / de sortir ressenti par
l'utilisateur — aggravé par les scrollbars overlay quasi invisibles de macOS. Un
premier correctif (en-tête/pied fixes + `overflow-y-auto` interne) était correct mais
ne réglait pas l'ergonomie.
**Correction :** en faire une vraie page `/upload` (scroll natif du navigateur, sortie
par le bouton Retour / la barre latérale toujours visible), en réutilisant le patron
des pages existantes (`<div className="h-full overflow-y-auto p-6">` dans le `<main>`
clippé).
**Règle :** quand un formulaire est long/dense, préférer une route dédiée à une modale.
La scrollbar native et la navigation (Retour, sidebar) sont plus ergonomiques qu'un
scroll interne. Extraire la logique en composant réutilisable et supprimer la modale +
son provider (pas de code mort).

## 2026-07-10 — Décisions candidates : appliquer en TS déterministe, pas via un 2e agent
**Contexte :** les routes `/api/*/resolve` écrivaient la décision dans `_candidates.json`
puis `dispatchIngest()`. Mais le workflow `ingest.yml` a un gate `count != 0` calculé
sur les **nouveaux fichiers `raw/`** uniquement : sans upload, `count=0` → l'agent est
sauté → la décision **n'était jamais appliquée**. Aucune suppression de ressource non plus.
**Correction :** un **moteur TypeScript pur et déterministe** (`web/lib/wiki-mutate.ts`),
appliqué **in-process** par les routes (lecture via `fetchRepoFileRaw` → mutation →
`commitFiles` en un commit), qui fait « l'inverse de l'ingestion » (décisions +
suppression de ressource). Plus de `dispatchIngest`. `commitFiles` étendu pour supprimer
(entrée de tree `sha: null`). Filet : `wiki:verify` étendu aux orphelins.
**Règle :** une opération **mécanique** (appliquer une décision déjà prise, supprimer)
n'a pas besoin d'un LLM — la faire en TS déterministe, testé (`node:test`), validé contre
le vrai wiki via `wiki:verify`. Deux pièges de données appris : (1) les ancres de section
des `seen_in` de candidates sont parfois désaccentuées/compactées alors que l'ancre
GitHub réelle garde accents+doubles tirets → **rapprocher tolérant, écrire l'ancre réelle** ;
(2) l'arête `belongs_to_theme` du graphe suit les `topics` du **frontmatter**, pas l'union
avec les topics chunk → vérifier sur le frontmatter seul (sinon faux positifs).

## 2026-07-10 — Un lien vers une page filtrée doit émettre la valeur *canonique* du filtre
**Contexte :** les clics sur les nœuds du graphe (`hrefForNode`) envoyaient le **slug
brut** de l'id du nœud vers `/sources?author=…`/`?type=…`. Or `/sources` filtre côté
client (`SourceList`) sur le **nom d'affichage** (`s.author === author`) et sur le
**ResourceType souligné** (`report_pdf`), pas le slug (`anthropic`) ni le `source_type`
brut (`report-pdf`). Résultat : 0 résultat sur auteur et sur type. En prime, un nœud
date-**année** (`date=2025`) filtrait bien (`startsWith`) mais le menu `FilterBar` ne
listait que des `AAAA-MM` → menu jamais auto-rempli.
**Correction :** aligner **l'émetteur** (le graphe) sur la convention de la page cible,
pas l'inverse : `author` → `node.label` (nom d'affichage) ; `type` → `resolveSourceType(slug)`
(→ ResourceType). Résolveur `source_type`→ResourceType extrait dans `lib/ui.ts`
(client-safe, réutilisé par le parser serveur ; `wiki-parser`/`wiki-query` importent `fs`
donc **inimportables côté client**). Pour la date-année, injecter la valeur courante dans
les options du menu si absente.
**Règle :** un composant qui lie vers une liste filtrée doit envoyer **exactement** la
valeur que la cible matche (et que son menu propose comme `value=`), sinon le filtre ET
l'auto-remplissage cassent. Un menu `<select>` ne peut afficher une valeur absente de ses
options → injecter la valeur active au besoin. Factoriser tout mapping partagé dans un
module **client-safe** (`lib/ui.ts`), jamais via un module qui touche `fs`.

## 2026-07-16 — Les artefacts (specs, plans, todo) sont pour l'agent, la pédagogie pour la conversation
**Contexte :** en concevant le workflow spec → implémentation global, j'avais prévu
que les specs soient « écrites pour un relecteur non technique ».
**Correction :** non — la spec doit être le plan validé **intégral**, avec toute sa
précision technique : elle est destinée à l'agent qui implémente dans une session
vierge. C'est dans la *conversation* (explications, comptes rendus) que Claude
vulgarise et définit les termes techniques, pas dans les documents de travail.
**Règle :** ne jamais vulgariser ni résumer un artefact destiné à un agent (spec,
plan, todo) ; y maximiser la précision. Réserver la pédagogie aux échanges avec
l'utilisateur. (Encodé dans `~/.claude/CLAUDE.md` et `~/.claude/commands/spec.md`.)

## 2026-07-20 — Une trace d'activité affichée doit couvrir tout ce que la réponse cite
**Contexte :** la checklist du chat n'affichait que les outils réellement exécutés
(trace honnête), mais l'agent citait des fiches identifiées dans les index SANS les
ouvrir → sources citées ⊃ étapes affichées, ressenti comme une checklist « incomplète ».
**Correction :** aligner le **comportement de l'agent** (prompt : toute fiche exploitée
ou citée doit avoir été ouverte via `read_wiki_page`), jamais fabriquer des étapes UI
pour combler l'écart. Exception encadrée : questions d'énumération qui ne restituent
que des métadonnées d'index.
**Règle :** quand une trace d'activité est montrée à l'utilisateur, l'invariant est
« tout ce que la réponse cite figure dans la trace » — on l'obtient en corrigeant le
comportement qui produit la trace, pas en truquant l'affichage.

## 2026-07-21 — Remplacer un agent IA par du code déterministe : énumérer TOUTES ses branches
**Contexte :** en spécifiant la refonte « IA + déterministe » de l'ingestion (l'IA
n'écrit que la page ressource, `projectResource` reconstruit les vues), la spec ne
gérait que le chemin nominal des entités : connue → lien, inconnue-détectée → candidate.
Le cas « entité **déclarée** au sidecar mais nouvelle » (que l'ancien agent créait
directement, `docs/entities.md §4`) était perdu. Arthur l'a repéré en posant la question.
**Correction :** capturer la confiance graduée complète dans la spec (§R11) :
déclaré-nouveau → création directe de la page (règle de slug suffixé en cas de collision
de type) ; détecté-inconnu → candidate ; connu → lien.
**Règle :** quand on remplace un agent LLM par du code déterministe, lister explicitement
**toutes** les branches conditionnelles que l'agent gérait implicitement (relire la spec de
référence branche par branche — ici `docs/entities.md §4`), pas seulement le happy path.
Une branche non traduite disparaît silencieusement.

## 2026-07-21 — Ingestion PDF peu coûteuse : extraire le texte en local, pas le PDF natif
**Contexte :** pour donner un PDF au modèle dans le nouvel appel unique, j'avais
recommandé le « bloc document » natif Anthropic (fidélité tables/graphes).
**Correction :** Arthur ne veut QUE le texte, au coût minimal. Le PDF natif fait payer
l'IA pour « regarder » chaque page comme une image (2–4× l'input) sans bénéfice voulu.
**Règle :** pour une ingestion de texte cost-sensitive, extraire le texte **en local**
(librairie type `unpdf`, coût 0) et n'envoyer que le texte. Réserver le PDF natif aux
cas où la mise en page (tableaux, graphiques) est réellement nécessaire. Distinguer
toujours deux coûts : l'extraction (gratuite en local) vs la lecture par l'IA
(incompressible mais bon marché sur du texte).

## 2026-07-21 — Le prompt caching ne passe pas forcément la gateway (mesurer avant de compter dessus)
**Contexte :** la spec « ingestion peu coûteuse » comptait sur des cache hits dès la 2ᵉ
ressource (`cache_control: ephemeral` sur le système). Vrai run mesuré :
`cache_creation_input_tokens = 0` au 1ᵉ appel → la gateway
(`vercel/anthropic-claude-sonnet-4.5` via LiteLLM) n'honore pas `cache_control`.
**Correction :** ne pas AFFIRMER un gain de caching sans l'avoir mesuré à travers la vraie
gateway (`usage.cache_read_input_tokens` / `cache_creation_input_tokens`). Ici l'impact est
marginal (la sortie domine le coût), donc non bloquant — mais le fait était supposé, pas prouvé.
**Règle :** toute optimisation qui dépend d'une capacité du fournisseur (caching, sorties
structurées, blocs document) doit être **vérifiée sur la vraie route de gateway** ; logguer
le `usage` détaillé pour pouvoir le constater, et présenter le coût comme estimation tant
que le chiffre gateway réel n'est pas confirmé. (Rappel connexe : le budget d'équipe LiteLLM
a un plafond — un run peut échouer en 429 `budget_exceeded`.)

## 2026-07-20 — Un auto-scroll doit être conditionné à la position de l'utilisateur
**Contexte :** pendant le streaming du chat, un `useEffect` scrollait en bas à chaque
mise à jour (≈30×/s), avec `behavior:'smooth'` : impossible de remonter lire, la vue
« aspirait » vers le bas en permanence.
**Correction :** pattern « pinned si déjà en bas » — un ref booléen mis à jour par
`onScroll` (en bas = distance < 80px), l'effet d'auto-scroll ne s'exécute que si
pinned, en `behavior:'auto'` (les smooth empilés à haute fréquence se combattent).
Envoyer un message re-pin la vue.
**Règle :** ne JAMAIS auto-scroller sans vérifier que l'utilisateur est déjà en bas ;
ref (pas state) pour la position ; scroll instantané (pas smooth) quand l'effet est
déclenché à haute fréquence.

## 2026-07-10 — Lancer l'app en local : une seule instance, et cache webpack off en dev (Node 26)
**Contexte :** « ouvre l'app » a viré au cauchemar. Deux causes cumulées : (1) plusieurs
`next dev`/`next start` lancés au fil des tentatives — leurs workers `next-server` se
**détachent** (notif « completed » alors que le worker survit) et **s'accumulent**, se
battant pour le port 3000 et écrivant dans le **même `.next`** → build corrompu
(`Cannot read properties of undefined (reading 'call')`, `Cannot find module _error.js`,
routes en 404/500). Aggravé par mes `rm -rf .next && build` **pendant** qu'un serveur
tournait dessus. (2) Même en instance unique, le dev crashait sur le cache webpack disque :
`unhandledRejection: ENOENT … .next/cache/webpack/*.pack.gz` — fatal sous **Node 26**.
Une nouvelle page (`/graph`) n'apparaissait pas car un `next start` de prod ne détecte
jamais une route ajoutée après son démarrage (pas de HMR ; il fige son manifeste au boot).
**Correction :** désactiver le cache webpack **en dev uniquement** dans `next.config.js`
(`webpack: (config, { dev }) => { if (dev) config.cache = false; return config }`) — la prod
Vercel garde son cache. Puis : tuer TOUT (`pkill -9 -f next-server|next dev|next start` +
`lsof -ti:3000 | xargs kill -9`), vérifier **0 process** et port libre, `rm -rf .next`,
lancer **UNE** instance `next dev`. Le dev survit alors au stress (recompilations répétées).
**Règle :** pour lancer l'app en dev : (a) garantir **une seule** instance sur le port 3000
(jamais rebuild `.next` sous un serveur vivant ; toujours re-vérifier `ps` car les workers
détachés survivent aux notifs « completed ») ; (b) sous Node récent, `config.cache = false`
en dev sinon crash `pack.gz`. Préférer **dev** (HMR) quand l'utilisateur itère sur de
nouvelles pages ; `next start` ne montre pas les routes ajoutées après le boot.

## 2026-07-21 — Node 26 : `next dev` crashe aussi en `MODULE_NOT_FOUND`, préférer build+start pour un test fonctionnel

**Contexte :** Arthur voulait juste *tester* l'app (upload → ingestion → graphe →
suppression), pas itérer sur du code. Symptôme : « l'application ne s'ouvre pas »
= page blanche, tous les `/_next/static/*.js|css` en **404**.
**Diagnostic :** (1) plusieurs `next dev` de sessions passées tournaient en parallèle
(ports 3000+3001 + un 3e) → build `.next` corrompu, chunks 404. (2) Après `pkill` de
tout + `rm -rf .next` + **une seule** instance dév propre : le serveur a **planté puis
s'est arrêté** sur `GET /` avec `Error: Cannot find module … .next/server/pages/_document.js`
(`code: MODULE_NOT_FOUND`, requireStack `_not-found/page.js` → `webpack-runtime.js`).
C'est un crash DIFFÉRENT du `pack.gz`/`cache=false` déjà documenté : ici le bundler dév
n'émet pas le chunk du `_document`/`_not-found` à la volée sous **Node 26** → le process meurt.
**Correction :** `rm -rf .next && npm run build && npm run start`. Le build de prod émet
TOUS les chunks d'un coup ⇒ plus de résolution paresseuse à la requête ⇒ plus de crash.
Vérifié : les 6 pages du test (`/chat /upload /graph /reglages /sources`, `/`→307) en 200,
un chunk statique en 200, et le serveur **toujours vivant** après les requêtes.
**Règle :** quand l'utilisateur veut *utiliser/tester* l'app (pas coder) sous Node récent,
lancer `build && start`, pas `next dev`. Rappel du compromis (déjà noté) : `next start` fige
son manifeste au boot → une route ajoutée APRÈS ne sera pas servie (rebuild nécessaire) ;
donc revenir à `next dev` uniquement pour l'itération sur de nouvelles pages. NB avertissement
bénin `"next start" does not work with "output: standalone"` : sans effet ici (assets servis,
vérifiés 200) — l'alternative stricte est `node .next/standalone/server.js`.

## 2026-07-21 — electron-builder exclut les node_modules d'un extraResources (Next standalone)
**Contexte :** coquille Electron embarquant le serveur Next `output: standalone`. J'avais mis
`extraResources: [{ from: "web/.next/standalone", to: "standalone" }]` pour copier le serveur
dans le `.app`. Le seeding et les chemins marchaient, mais le serveur packagé plantait
immédiatement : `Cannot find module 'next'` (`server.js:16`). Constat : `Resources/standalone/
node_modules` était **vide (0 entrée)** alors que la source en a 23 (dont `next`).
**Correction :** electron-builder **saute les `node_modules` imbriqués** d'un `extraResources`
— **même avec `filter: ["**/*"]`** (testé, toujours 0). Solution robuste : un hook
`afterPack` (`electron/after-pack.js`) qui copie soi-même l'arbre standalone (node_modules
inclus) dans les `Resources`, en pur Node (`fs.cpSync`), avant la fabrication du `.dmg`.
Vérifier `node_modules/next` présent dans le `.app` AVANT de tester l'app (évite un cycle de
lancement pour rien). `getResourcesDir(appOutDir)` du packager donne le bon dossier (mac ET win).
**Règle :** ne jamais compter sur `extraResources` pour copier un dossier **contenant des
`node_modules`** ; le faire dans un hook `afterPack`. Corollaire : après un packaging, inspecter
le contenu réel du `.app`/`Resources` (pas seulement « le dmg s'est construit »).

## 2026-07-21 — ELECTRON_RUN_AS_NODE dans l'env ambiant fait démarrer Electron sans fenêtre
**Contexte :** `electron .` ne montrait aucune fenêtre ; `electron --version` affichait
`v24.18.0` (≠ v43 installé). Cause : l'environnement (shell/sandbox) portait
`ELECTRON_RUN_AS_NODE=1`. Sous ce drapeau, le binaire Electron **se comporte comme Node** — pas
d'API Electron, pas de `BrowserWindow`, et `--version` imprime la version **Node embarquée**.
**Correction :** (1) diagnostiquer avec `env -u ELECTRON_RUN_AS_NODE electron --version` (a
bien rendu `v43.1.1`) ; (2) garde-fou dans `main.js` : si `process.env.ELECTRON_RUN_AS_NODE`
est présent au lancement, se **re-`spawn`** proprement sans le drapeau puis `process.exit`.
Le serveur Next embarqué, lui, est spawné **avec** `ELECTRON_RUN_AS_NODE=1` (voulu : binaire
Electron = pur Node pour lancer `server.js`).
**Règle :** un binaire Electron peut être « détourné » en Node par l'env ambiant. Pour tout
lancement GUI de test, neutraliser le drapeau (`env -u …`) ET prévoir un re-spawn défensif
dans le process principal. Ne jamais lire une version Electron sans vérifier ce drapeau.

## 2026-07-21 — Sur un dépôt partagé, une autre session Claude peut muter l'arbre pendant qu'on travaille
**Contexte :** en fin de session Electron, `git status` montrait des fichiers que je n'avais
jamais touchés (`raw/note-*.txt`, `wiki/resources/note-*.md`, entités, `graph.json`/vues
régénérées, et un ajout à `tasks/lessons.md`). Un `ps` a révélé **plusieurs process
`claude` + un `next-server`** portant `CLAUDE_EFFORT` : une autre session ingérait en parallèle.
Effets : compte de ressources 13 → 15, **1 test sur 98 en échec** (count codé en dur), et un
`next-server` détaché qui a corrompu un `next build`.
**Correction :** (1) avant tout build, `pgrep`/`pkill` les `next-server` détachés et vérifier
0 process ; (2) **ne pas** committer en bloc — cadrer le `git add` sur ses propres fichiers,
laisser à l'utilisateur les fichiers d'une autre session ; (3) relire un fichier partagé
(`lessons.md`) **juste avant** de l'éditer pour ne pas écraser l'ajout concurrent.
**Règle :** ne jamais présumer que le working tree n'appartient qu'à moi. Vérifier les process
concurrents, isoler mon commit, et traiter un échec de test « data-dépendant » comme
possiblement dû à une mutation externe avant de l'imputer à mon code.

## 2026-07-22 — Restauration de scroll : ne PAS sauver au démontage (le navigateur remet scrollTop à 0 d'abord)
**Contexte :** hook `useScrollRestoration` (persistance d'état à la navigation). Croquis
initial de la spec : « `el.scrollTop = saved` au montage, `scrollStore.set(scrollTop)` au
cleanup ». Pilotage Chrome réel : le scroll revenait toujours à **0** au retour. Trace
instrumentée : `onScroll` enregistrait bien 150, puis le **cleanup lisait `scrollTop === 0`**
(au démontage lors d'une navigation, le navigateur/Next a déjà remis le conteneur à 0) et
**écrasait 150 par 0**. Second piège : les pages chargent leurs données APRÈS le montage →
au montage le conteneur n'est pas assez haut, `scrollTop = saved` est clampé à 0.
**Correction :** (1) enregistrer la position **en continu** via l'écouteur `scroll`, JAMAIS
au cleanup ; (2) **ré-appliquer** `saved` tant que le contenu grandit (boucle rAF bornée),
en cessant dès un vrai geste utilisateur (`wheel`/`touchstart`/`keydown`, pas l'événement
`scroll` que nos propres sets déclenchent). Re-testé en CDP : scroll 150 px/120 px restauré.
**Règle :** pour restaurer une position de scroll à travers un démontage/remontage, la source
de vérité est un écouteur `scroll` **continu** (dernière position réelle) — surtout pas une
lecture au cleanup, car `scrollTop` y vaut déjà 0. Et prévoir le contenu asynchrone :
réappliquer jusqu'à ce que la hauteur le permette, sans combattre l'utilisateur.

## 2026-07-22 — Prouver un comportement UI sans serveur exclusif ni coût : instance isolée + CDP + état simulé
**Contexte :** devoir démontrer de bout en bout (scroll, survie de navigation, reprise d'upload)
alors que (a) une session concurrente faisait tourner `npm run start` sur `.next`/port 3000 —
rebuilder l'aurait corrompu — et (b) le vrai chemin d'upload déclenche une ingestion LLM payante.
Aucun Playwright/Puppeteer installé.
**Correction :** monter une **instance totalement isolée** : `rsync` de `web/` (sans
`node_modules`/`.next`) + symlink `node_modules`, config allégée (`eslint/typescript
ignoreBuildErrors`, pas de `standalone`), build vers son propre `.next`, `next start -p 3005`,
et surtout **`DATA_ROOT` surchargé** vers un dossier scratch (wiki copié, `.data/ingest-state.json`
**simulé** → zéro coût LLM, wiki réel intact). Piloter un **Chrome headless via CDP** sans
dépendance (Node 26 a `WebSocket`+`fetch` globaux) : `Page.navigate` + `Runtime.evaluate` +
`.click()` pour la navigation SPA, lecture de `scrollTop`/DOM pour les assertions. Compléter par
des tests unitaires du store (fetch mocké) et du handler de route (import direct avec `DATA_ROOT`
isolé). Piège rencontré : des Chrome zombies sur le même port de debug faussent la cible CDP →
`pkill` avant chaque run.
**Règle :** quand l'app est monopolisée par une autre session et/ou que le vrai chemin coûte de
l'argent, ne pas renoncer à la preuve : cloner l'app en isolé (`DATA_ROOT`/`WIKI_ROOT`/`RAW_ROOT`
surchargeables), simuler l'état serveur sur disque, et piloter un vrai navigateur en CDP (zéro
dépendance). Tuer les Chrome de debug traînants entre les runs.

## 2026-07-22 — Un champ à validation explicite (`+`/Entrée) perd sa saisie au submit → flush()
**Contexte :** à l'upload, taper un nom d'entité (LinkPicker) ou de thème (ThemePicker) puis
cliquer « Déposer → » **sans** presser `+`/Entrée perdait la saisie : le brouillon vivait dans
un état LOCAL du picker (`drafts`/`draft`) et ne rejoignait la valeur remontée au parent qu'à la
validation explicite. Conséquence en aval : item non déclaré au sidecar → jamais créé
directement → au mieux détecté par l'IA → tombe en « candidate » (confirmation manuelle). Symptôme
rapporté : « déclarer un item **nouveau** ne le crée pas, un item **connu** oui » — car un connu a
une puce cliquable (1 clic = validé), un nouveau doit être tapé (exposé à l'oubli de validation).
**Correction :** au submit, **flusher** les brouillons via `useImperativeHandle` + `flush()` :
`flush()` calcule SYNCHRONEMENT la valeur fusionnée (`value` + brouillon, via helpers purs testés
`web/lib/upload-drafts.ts`), la commit dans l'état du picker pour l'UI, ET la **retourne** ;
`submit()` bâtit le FormData sur la valeur RETOURNÉE, jamais sur l'état `links`/`themes` (pas encore
re-rendu à ce tick). Écartés : `onBlur→commit` (course non déterministe, le `onClick` lit une
closure périmée) et le lifting de `drafts` dans le parent (couplage + re-render à chaque frappe).
**Règle :** tout champ à validation explicite doit **flusher son brouillon au submit** et le
consommateur doit lire la valeur **retournée** par le flush, pas l'état React (asynchrone). Preuve
sans clé IA ni serveur exclusif : piloter le VRAI handler `POST /api/upload` avec un `DATA_ROOT`
isolé + verrou d'ingestion pré-posé (`ingest.lock` → `runIngestion()` no-op, 0 coût), FormData
issue des vrais helpers de fusion → inspecter le sidecar écrit (`links:`/`themes:` présents).

## 2026-07-22 — Supprimer une ressource ne supprime PAS un thème qu'elle a créé (thème fantôme)
**Contexte :** purge d'une note de test qui avait créé le thème « harness-engineering ». La note
liait ce thème en **chunk-only** (`topics: []` au frontmatter, mais arête `belongs_to_theme` +
fichier thème + ligne d'index bien présents). Or `deleteResource` (a) ne nettoie que les thèmes du
**frontmatter** `meta.topics`, et (b) commente explicitement « Registre = jamais delete » : il ne
supprime JAMAIS un fichier thème. Résultat de la purge « littérale » : un thème fantôme vide
(fichier + nœud `theme:` + ligne d'index) pointant vers une ressource supprimée. Piège : `wiki:verify`
reste **vert** (il vérifie ressource→thème via frontmatter et les orphelins `resource:`, pas
thème→ressource ni les nœuds `theme:` orphelins) → le vert ne prouve pas « zéro trace ».
**Correction :** compléter la purge par un retrait manuel du thème : `delete` du fichier
`wiki/themes/<slug>.md` + retrait du nœud/arêtes `theme:<slug>` (via `parseGraph`/`serializeGraph`
pour un formatage byte-identique) + retrait de la ligne `[[themes/<slug>|…]]` d'`index.md`. Toujours
**valider d'abord sur une COPIE scratch** (`DATA_ROOT` isolé) : rejouer la purge complète, vérifier
`wiki:verify` vert ET **grep zéro trace résiduelle** (fichiers + index) avant d'appliquer au vrai wiki.
**Règle :** `wiki:verify` vert ≠ « zéro trace ». Après une suppression, prouver la propreté par un
**grep exhaustif des slugs supprimés** (fichiers + `graph.json`/`index.md`/`_ingested.json`/candidats),
pas seulement par le linter. Un thème créé par déclaration chunk-only n'est pas nettoyé par
`deleteResource` — le retirer explicitement, et valider sur copie avant le vrai dépôt.
