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

## 2026-07-23 — Copier un patron déterministe dans un autre domaine : vérifier ce qui DIFFÈRE en aval
**Contexte :** chantier « entités = miroir des thèmes » (remontée frontmatter + section index +
nœuds labellisés). La spec disait « fais exactement comme les thèmes ». Mais les entités ont
une distinction **niveau ressource vs niveau section** que les thèmes n'ont pas
(`buildEntityBlock` change d'affichage selon `resourceLevel`, l'arête `mentions` porte des
ancres de section). En dérivant `resourceLevel = présence au frontmatter` ET en remontant TOUTES
les entités de section au frontmatter, on **aplatissait** chaque mention en « Ressource entière »
(perte des ancres de section sur les fiches d'entités + le graphe). La branche section-level de la
spec devenait morte (contradiction interne). Arthur voulait AU CONTRAIRE les deux : entités au
frontmatter ET ancres de section conservées.
**Correction :** découpler l'affichage de l'appartenance au frontmatter :
`resourceLevel = aucune section ne cible l'entité` (comme les thèmes, mais côté affichage). Les
entités remontées gardent leurs ancres ; « Ressource entière » seulement si aucune section ne la
cible. Correction d'une ligne, dans les 2 sites (bloc entité + nœud graphe).
**Règle :** copier un patron éprouvé dans un nouveau domaine ≠ garantie de correction. Lister ce
qui **diffère en aval** dans le nouveau domaine (branches conditionnelles, effets sur les vues/le
graphe) AVANT de coder, pas seulement la symétrie de surface. Un miroir littéral peut créer une
contradiction interne (ici, une branche rendue morte) — c'est le signal qu'un invariant du domaine
source n'existe pas dans le domaine cible.

## 2026-07-23 — Réparer l'existant : réparation CIBLÉE > re-projection complète (churn collatéral)
**Contexte :** le backfill entités devait, par la spec, `projectResource` (re-projeter) chaque
ressource pour fixer le frontmatter. Mais `projectResource` régénère TOUTES les vues dérivées de la
ressource — dont les pages **thèmes/origine**, écrites à l'ingestion INITIALE par l'IA avec des
résumés soignés (et quelques ancres cassées). La re-projection les remplaçait par des résumés bruts
(1re phrase déterministe) : ~22 fichiers touchés pour un correctif « entités ». Or les fiches
d'entités + arêtes de graphe portaient DÉJÀ les mentions section-level correctes ; les seuls vrais
gaps étaient : frontmatter, section index, 3 labels de nœuds nus.
**Correction (décision d'Arthur : minimal) :** backfill CIBLÉ — (a) `rollupSectionEntities` écrit
UNIQUEMENT la ligne `entities:` du frontmatter (corps + vues intacts) ; (b) section index
reconstruite depuis le registre ; (c) filet anti-nu sur `graph.json`. Blast radius : **8 fichiers**
au lieu de 22, résumés soignés préservés. Validé sur copie scratch (`WIKI_ROOT` isolé) : diff
chirurgical (1 ligne/fiche), `verify` vert, idempotent — AVANT d'appliquer au vrai wiki.
**Règle :** avant de re-projeter « pour être propre », mesurer le **blast radius réel** (diff sur
copie scratch) et se demander quels gaps EXISTENT vraiment. Si les vues dérivées sont déjà correctes,
une réparation chirurgicale (n'écrire que ce qui manque) bat une re-projection qui écrase du contenu
soigné. Toujours diffusion sur COPIE d'abord, puis vrai wiki.

## 2026-07-27 — Miroir entité/thème : passer par un accesseur typé + un composant d'affichage partagés
**Contexte :** les alias d'un thème ne s'affichaient jamais sur sa page de détail (bug signalé
sur « Évaluation des agents de code »), alors que les entités les affichaient. Entités et thèmes
sont des « jumeaux » (le code dit « Miroir de … ») maintenus à la main par copier-coller. Trois
copies avaient divergé : pas de `getTheme` typé (la page thème re-parsait le frontmatter inline
et « oubliait » `aliases`), pas d'affichage des alias dans la page thème, et `createThemePage`
n'émettait pas le champ `aliases` là où `createEntityPage` l'émet.
**Correction :** ne pas patcher l'affichage seul. Supprimer la classe de bug : (1) un accesseur
détail **typé** par domaine (`getEntity`/`getTheme`) — la page ne re-parse jamais le frontmatter à
la main, donc ne peut plus oublier un champ ; (2) un **composant d'affichage partagé**
(`<AliasLine>`) portant la règle de rendu + dédoublonnage (masquer alias == label, insensible
casse/espaces) à un seul endroit ; (3) aligner les DEUX chemins de création de page du moteur.
**Règle :** quand deux domaines sont un miroir maintenu à la main, tout champ ajouté d'un côté
doit transiter par un accesseur typé partagé ET un composant d'affichage partagé — jamais de
re-parsing inline du frontmatter dans une page (c'est le maillon qui laisse un champ être oublié).
Réparer la cause structurelle, pas l'instance. (Preuve : ces server components étant
`force-dynamic`, un `curl | grep` du HTML rendu par le `next dev` déjà lancé suffit à démontrer
l'affichage réel sans lancer d'instance ni toucher au wiki — penser à retirer les marqueurs
`<!-- -->` que React insère entre texte statique et dynamique.)

## 2026-07-27 — Un filtre d'affichage ne nettoie pas la donnée : traiter la SOURCE, pas le symptôme
**Contexte :** pour masquer les alias == label (bruit), j'avais mis un filtre uniquement à
l'affichage (`<AliasLine>`). Arthur : « pourquoi tu ne supprimes pas l'alias alors ? ». Le
filtre laissait la donnée sale, d'où une incohérence : les vues LISTE (`/entities`, `/themes`)
comptent `aliases.length` BRUT → badge « 1 alias » pour une fiche dont la page de détail
n'affiche rien.
**Correction :** appliquer la règle sur 3 couches — (1) SOURCE : le moteur d'écriture
(`wiki-mutate`, 4 points create/merge × entité/thème) ne stocke plus d'alias == label ;
(2) DONNÉES : nettoyage ponctuel SURGICAL des fichiers existants (ne réécrire que la ligne
`aliases:`, byte-identique ailleurs) — 16 fichiers, validé en dry-run puis `git diff` +
`wiki:verify` (avertissements identiques avant/après) ; (3) AFFICHAGE : garder le filtre comme
filet. La règle vit dans UN module sans dépendance (`lib/alias-rule.ts`) importé en relatif par
le moteur (qui interdit les imports `@/…`) ET par la vue → zéro divergence possible.
**Règle :** un filtre d'affichage cache un symptôme ; il ne rend pas la donnée cohérente (les
autres consommateurs — compteurs, graphe, recherche — voient toujours la donnée brute). Pour une
règle « telle valeur est du bruit », la porter à la SOURCE (empêcher l'écriture) + nettoyer
l'existant + garder l'affichage comme filet, et loger la règle dans un module unique partagé.
Toujours dry-run + diff surgical + `wiki:verify` (comparer les avertissements avant/après) avant
d'écrire dans le vrai wiki.

## 2026-07-28 — Tailwind ne scanne QUE les chemins de `content` : une classe dans `lib/` est ignorée
**Contexte :** chantier « types de document ouverts » — les badges de type créé prennent leur
couleur d'une palette de classes LITTÉRALES dans `web/lib/ui.ts` (`bg-emerald-50 text-emerald-700`…).
Or `tailwind.config.ts` avait `content: ['./app/**', './components/**']` — **pas `./lib/**`**. Donc
Tailwind ne voyait AUCUNE classe de `ui.ts` : ni la nouvelle palette, ni même les overrides existants
(`bg-[#EAF0FB]`…). Preuve : le CSS compilé du build précédent contenait **0** occurrence de `#eaf0fb`
— les badges de type étaient (silencieusement) sans couleur d'arrière-plan depuis toujours.
**Correction :** ajouter `./lib/**/*.{ts,tsx}` au `content`. Vérifié SANS build Next complet (un
`next dev` concurrent tournait sur `.next` — le corrompre est interdit, cf. 2026-07-21) : `npx
tailwindcss -c tailwind.config.ts -i <@tailwind utilities> -o out.css` puis `grep` de la classe →
`bg-emerald-50` ET `#eaf0fb` désormais présents.
**Règle :** toute classe Tailwind qui n'apparaît QUE dans un fichier hors `app/`/`components/`
(souvent un helper `lib/*.ts` qui mappe donnée→classe) exige que son dossier figure dans `content`.
Symptôme = élément sans style alors que la classe est « correcte ». Vérifier vite en compilant le CSS
avec la CLI `tailwindcss` (zéro dépendance au build Next) et en greppant la classe attendue.

## 2026-07-28 — Prouver un chantier full-stack sans coût ni serveur, en pilotant les vrais handlers
**Contexte :** livrer « types de document créables depuis l'UI » (registre `wiki/types.json`, API
CRUD, moteur déterministe) tout en (a) évitant le vrai chemin de dépôt (appel LLM payant + mutation
du vrai wiki) et (b) sans monopoliser `.next` (un `next dev` concurrent tournait — cf. 2026-07-21 :
plusieurs sessions Claude mutent l'arbre en //, ici ChatWindow.tsx cassait `tsc` par intermittence).
**Correction (chaîne de preuves, zéro coût, vrai wiki intact) :** (1) copie ISOLÉE du wiki
(`DATA_ROOT`/`WIKI_ROOT` surchargés) ; (2) import DIRECT des handlers `GET/POST/DELETE` de la route
(`new Request(...)` suffit, NextRequest ⊃ Request) → prouve doublon 409, intégré 403, en-usage 409,
créé-inutilisé OK, et l'écriture de `types.json` ; (3) pour le downstream déterministe, appeler
`ingestOne({ markdown: <fiche source_type: podcast rédigée à la main>, … })` — il NE fait PAS l'appel
LLM (le markdown est un paramètre) → `applyFileOps` + `rebuildDerivedIndexes` → grep `graph.json`
(nœud `type:podcast` + arête `has_type`), `types.md` (`## podcast`), `listTypes` (podcast=1) ;
(4) build de prod dans une COPIE isolée (`rsync` + symlink `node_modules`, `.next` propre) pour ne
pas corrompre le `.next` du dev concurrent ; (5) Tailwind vérifié via sa CLI (cf. leçon ci-dessus).
**Règle :** un chantier full-stack se prouve sans le happy-path coûteux en pilotant les **vrais**
handlers de route (import direct, `Request` natif) sur un `DATA_ROOT` isolé, et en exerçant le
moteur déterministe via sa fonction pure d'entrée (celle qui prend le markdown en paramètre, pas
celle qui appelle l'IA). Build/Tailwind : copie isolée + CLI, jamais sur le `.next` partagé quand une
autre session tourne. `git add` cadré sur MES fichiers (laisser ChatWindow.tsx & co à l'autre session).

## 2026-07-28 — Un registre « avec des entrées permanentes » se bat avec l'attente de contrôle total
**Contexte :** j'avais conçu le registre de types avec des types « intégrés » INDÉBOULONNABLES
(garde-fou 403 sur DELETE + cadenas UI même à 0 ressource). `wiki/types.json` ne stockait que les
AJOUTS utilisateur, unis aux intégrés à la lecture. En test, Arthur a vu 8 types verrouillés (dont 4
inutilisés) et voulait les supprimer/renommer : le « mobilier permanent » contredisait son attente de
piloter la liste.
**Correction :** UNE seule règle — un type est renommable ET supprimable tant qu'aucune ressource ne le
porte ; dès qu'≥1 ressource l'utilise, son slug est figé (cardinale #5, identifiants immuables). Plus
de type « permanent » : `BUILTIN_TYPE_SLUGS` devient une simple GRAINE. `types.json` devient la liste
COMPLÈTE du menu, autoritaire dès qu'il est non vide (fin de l'union → un type retiré ne repousse pas) ;
chaque mutation réécrit la liste effective entière (matérialise la graine au 1er changement). Renommage
= PATCH qui échange le slug (interdit si utilisé). Le libellé RESTE dérivé du slug (fonction pure) : pas
de label stocké → renommer un type utilisé resterait impossible sans réécrire tous les documents+graphe,
donc explicité comme limite plutôt que bricolé.
**Règle :** avant de rendre des entrées « permanentes/non supprimables » dans un registre piloté par
l'utilisateur, se demander si ça sert un invariant RÉEL ou si ça ne fait qu'ôter du contrôle. Une graine
éditable + une règle unique fondée sur l'usage réel (« modifiable tant qu'inutilisé, figé dès qu'utilisé »)
bat une liste figée arbitraire. Corollaire honnêteté : quand une limite technique subsiste (ici renommer
un type déjà utilisé), l'expliquer, ne pas la masquer.

## 2026-07-28 — Un `<button>` imbriqué dans un `<label>` détourne le clic vers le contrôle du label
**Contexte :** dans le champ « Type » de l'upload, le `<label>` enveloppait à la fois le bouton « Gérer
les types », le `<select>` et la ligne de création inline (avec ses boutons Créer/Annuler). Symptôme
rapporté : cliquer « Annuler » (ou ailleurs dans la zone) ouvrait la modale « Gérer les types » par
erreur. Cause : un `<label>` renvoie tout clic sur ses descendants NON interactifs vers son PREMIER
contrôle labelable — ici le bouton « Gérer les types » — d'où des activations parasites.
**Correction :** ne jamais imbriquer de contrôles interactifs (surtout plusieurs boutons) dans un
`<label>`. Passer le conteneur en `<div>` et n'associer le caption qu'au `<select>` via
`<label htmlFor="type-select">` + `id`. Les boutons deviennent de simples frères, sans détournement.
**Règle :** un `<label>` n'enveloppe QUE son unique contrôle (ou utilise `htmlFor`). Dès qu'un champ
porte des boutons d'action à côté de son input/select, utiliser un `<div>` + `htmlFor` — sinon clics
fantômes vers le premier élément labelable.

## 2026-07-28 — Une valeur-sentinelle (repli) ne doit pas fuiter dans une liste de CHOIX utilisateur
**Contexte :** le type « inconnu » (`unknown`) apparaissait dans la barre de choix des types du dépôt
(`/upload`). Or `unknown` n'est PAS un type qu'on choisit : c'est le REPLI d'affichage d'une ressource
sans type (`normalizeType` → `s || 'unknown'`, `listTypes` groupe les sans-type sous `unknown`). Je
l'avais malencontreusement mis dans la graine `BUILTIN_TYPE_SLUGS` (et donc dans `wiki/types.json`)
lors du chantier « types ouverts » du matin — mélangeant valeur-sentinelle et vocabulaire choisissable.
**Correction :** retirer `unknown` de la graine ET du registre `wiki/types.json` (menu = 8 → 7 types),
MAIS conserver ses libellé/couleur curés (`Inconnu`/orange) comme repli d'affichage pour une ressource
sans type. Aucune ressource ne portant `source_type: unknown`, la suppression respecte la cardinale #5.
Test de non-régression : `unknown` absent de la graine, `typeLabel('unknown')` = `Inconnu` maintenu.
**Règle :** distinguer deux rôles d'une même constante — (a) valeur de REPLI/sentinelle pour données
manquantes vs (b) entrée d'une liste de CHOIX utilisateur. La première ne doit jamais peupler la
seconde. Un fourre-tout « Inconnu » proposé à la sélection est un signal de confusion des deux rôles :
garder son affichage de repli, l'exclure du menu.

## 2026-07-28 — Distribution multiplateforme : `raw/` doit être compatible Windows, et macOS unsigned = « endommagé »
**Contexte :** premier build CI Mac+Windows. (1) Le job **Windows échouait au checkout** :
`git.exe failed with exit code 128 · invalid path 'raw/2026 … | … .pdf'`. Windows **interdit**
`| : ? * < > "` dans les noms de fichiers → git ne peut pas écrire le fichier, ET même en forçant
l'app ne pourrait jamais poser ce fichier dans `~/second-brain/raw/` sur un PC Windows. 4 sources
`raw/` portaient `|`/`:`. (2) Le `.dmg` Mac s'ouvrait avec « **SecondBrain est endommagé** » sur
Apple Silicon — trompeur : l'app n'est pas corrompue, elle est **non signée + en quarantaine**.
Cause racine (lue dans le code d'electron-builder 26) : `mac.identity: null` → `handleNullIdentity()`
« skipped macOS code signing » → **aucune** signature ; les modifs d'`afterPack` invalident la
signature héritée d'Electron → « endommagé ».
**Correction :** (1) **renommer** les 4 sources (`|`/`:` → `-`) en migration coordonnée et prouvée
sur copie — fichier raw + sidecar `.meta.md` + clé `_ingested.json` + `source_file` de la fiche
DOIVENT rester égaux (invariant `manifest-missing` de `wiki-verify`) ; `git` enregistre des renames
(contenu 100 % identique) ; `log.md` (mention historique en prose) laissé tel quel. (2) `mac.identity: "-"`
(signature **ad-hoc** valide) → le téléchargement affiche le message doux « développeur non vérifié »
(clic droit → Ouvrir) au lieu de « endommagé ». `CSC_IDENTITY_AUTO_DISCOVERY=false` reste sans effet
sur l'ad-hoc (`isSignAllowed` ne teste que « macOS »). Repli utilisateur si « endommagé » persiste :
`xattr -cr <app> && codesign --force --deep --sign - <app>`. Vrai « zéro Terminal » = notarisation
Apple payante (hors périmètre v1).
**Règle :** avant de distribuer, (a) **auditer `raw/` pour les caractères interdits Windows**
(`git ls-files raw/ | grep -E '[<>:"|?*]'`) — un nom illégal casse le checkout ET l'app côté Windows,
le renommer est inévitable (entorse encadrée à « raw immuable ») en gardant le triangle
raw=source_file=clé_ingested cohérent + `wiki-verify` identique ; (b) une app macOS **non signée**
(`identity: null`) est cassée sur Apple Silicon → **toujours au moins `identity: "-"` (ad-hoc)**.
Prouver la migration raw sur COPIE (`WIKI_ROOT` isolé) avant le vrai wiki, jamais l'inverse.
