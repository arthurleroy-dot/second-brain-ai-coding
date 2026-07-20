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
