# Distribution multiplateforme (CI Mac + Windows) & données locales dans `~/second-brain`

## Contexte

L'application est une coquille Electron local-first (voir
`tasks/specs/2026-07-21-electron-desktop-shell.md`). Un `.dmg` Mac Apple Silicon
a déjà été produit et lancé une fois (2026-07-21, **non signé**). Objectif de ce
chantier : rendre l'app **distribuable à des collègues** (Mac Apple Silicon +
Windows) et **verrouiller la confidentialité des données**.

Demande d'origine de l'utilisateur (Arthur, non-développeur — cette spec est
destinée à l'agent d'implémentation, pas à lui) :

1. S'assurer que `raw/`, `wiki/`, le dossier `.data/` (historique de chat) et la
   **clé API** vivent **exclusivement en local** sur la machine de chaque
   utilisateur, et **ne soient jamais accessibles sur GitHub**.
2. Regrouper toutes ces données locales dans **un dossier unique et visible**
   nommé `second-brain` dans le dossier personnel de l'utilisateur
   (`/Users/<nom>/second-brain` sur Mac, `C:\Users\<nom>\second-brain` sur
   Windows), posé automatiquement au premier lancement.
3. Fabriquer les deux installeurs (`.dmg` Mac + `.exe` Windows) via **GitHub
   Actions**, téléchargeables comme artefacts.

### État réel constaté (vérifié le 2026-07-28, à ne pas re-vérifier)

- **Le dépôt `arthurleroy-dot/second-brain-ai-coding` est PUBLIC** (API GitHub →
  HTTP 200 sans auth). `raw/` (41 fichiers suivis, dont PDF sources
  Deloitte/Accenture) et `wiki/` (87 fichiers suivis) y sont donc lisibles par
  tout Internet. **C'est la seule vraie fuite.** → corrigée par le passage en
  privé (todo côté humain).
- **Déjà correct, à ne pas « corriger » :**
  - `.gitignore` contient `/.data/` et `/dist/`. `git ls-files` ne suit **aucun**
    fichier `.data/`. La clé API et l'historique de chat ne sont donc jamais
    poussés.
  - La clé API vit dans `<DATA_ROOT>/.data/ai-settings.json`
    (`web/lib/ai-settings.ts`, constante `SETTINGS_PATH`), créée à l'exécution
    quand l'utilisateur la saisit dans `/reglages`. Elle **n'est jamais embarquée
    dans le `.dmg`/`.exe`** (`electron/main.js` ne l'injecte pas ; cf. commentaire
    en tête de fichier « La clé n'est pas injectée par la coquille »).
  - Tout est déjà regroupé sous un seul dossier applicatif (`app.setName('SecondBrain')`
    → `app.getPath('userData')`), mais dans l'emplacement système caché. Ce
    chantier le déplace vers `~/second-brain` (visible).

### Rappels d'architecture (invariants à respecter)

- `DATA_ROOT` est la racine unique des données. Défini côté web dans
  `web/lib/wiki-fs.ts` :
  ```js
  export const DATA_ROOT = process.env.DATA_ROOT ?? path.resolve(process.cwd(), '..');
  export const WIKI_ROOT = process.env.WIKI_ROOT ?? path.join(DATA_ROOT, 'wiki');
  export const RAW_ROOT  = process.env.RAW_ROOT  ?? path.join(DATA_ROOT, 'raw');
  ```
  En **dev navigateur** (`npm --prefix web run dev`), `DATA_ROOT` non défini → racine
  du dépôt. En **app packagée**, `electron/main.js` définit `DATA_ROOT` (env du
  serveur Next). **Ce chantier ne change QUE la valeur injectée par la coquille
  Electron ; le dev navigateur reste inchangé (continue de lire/écrire le dépôt).**
- Le « seed » (`electron/seed.js`, `seedIfEmpty(dataRoot, seedRoot)`) copie
  `wiki/` et `raw/` du bundle vers `dataRoot` **une seule fois** (idempotent, non
  destructif : si le dossier existe déjà, il n'écrase rien). C'est **volontaire**
  (choix « instantané figé » : chaque instance garde sa copie ; aucune synchro
  entre utilisateurs).
- L'écriture des vues wiki passe **uniquement** par `applyFileOps`
  (`web/lib/wiki-fs.ts`), dont le garde-fou n'autorise que `wiki/` et `raw/`.
  `.data/` est hors de ce périmètre (écrit directement par `ai-settings.ts` et le
  serveur), c'est normal.

## Plan

Plan validé par l'utilisateur, intégral.

### Décision 1 — Dépôt GitHub en privé (action humaine)

Passer `arthurleroy-dot/second-brain-ai-coding` en **privé** (GitHub → Settings →
General → Danger Zone → Change repository visibility → Private). Ne bloque ni la
distribution (les collègues reçoivent un fichier, pas un accès au dépôt) ni la
GitHub Action (les dépôts privés exécutent les Actions dans le quota gratuit).
**Caveat assumé :** le dépôt ayant été public, le contenu a pu être vu/indexé ;
le passage en privé arrête l'exposition à partir de maintenant, il ne réécrit pas
le passé.

### Décision 2 — Données locales dans `~/second-brain` (visible)

Modifier **uniquement** `electron/main.js` pour que la coquille utilise
`path.join(app.getPath('home'), 'second-brain')` comme `dataRoot`, au lieu de
`app.getPath('userData')`. Structure cible sur la machine utilisateur :

```
~/second-brain/            (visible dans le Finder / l'Explorateur)
  ├─ wiki/                 (copié au 1er lancement — seed)
  ├─ raw/                  (copié au 1er lancement — seed)
  └─ .data/                (clé API + historique chat + server.log — 100 % local, jamais transmis)
```

Détail des modifications dans `electron/main.js` :

1. Dans `boot()`, remplacer :
   ```js
   const dataRoot = app.getPath('userData');
   ```
   par :
   ```js
   const dataRoot = path.join(app.getPath('home'), 'second-brain');
   const legacyRoot = app.getPath('userData'); // ancien emplacement (< v0.2.0)
   ```

2. Ajouter un helper de **migration douce, une-fois, non destructive** (au niveau
   module) qui rapatrie les données de l'ancien emplacement `userData` si elles
   existent et que le nouveau dossier ne les a pas encore :
   ```js
   /** Migration une-fois : rapatrie wiki/raw/.data de l'ancien userData vers le nouveau dataRoot. */
   function migrateLegacyData(legacyRoot, dataRoot) {
     if (legacyRoot === dataRoot) return;
     for (const name of ['wiki', 'raw', '.data']) {
       const oldp = path.join(legacyRoot, name);
       const newp = path.join(dataRoot, name);
       if (fs.existsSync(oldp) && !fs.existsSync(newp)) {
         fs.mkdirSync(path.dirname(newp), { recursive: true });
         fs.cpSync(oldp, newp, { recursive: true });
         console.log(`[migration] ${name}/ rapatrié ${oldp} → ${newp}`);
       }
     }
   }
   ```

3. Ordonner le début de `boot()` ainsi (⚠ la migration DOIT précéder toute
   création de `dataRoot/.data`, sinon le `.data` legacy ne serait jamais
   rapatrié car `existsSync(newp)` serait déjà vrai) :
   ```js
   async function boot() {
     const dataRoot = path.join(app.getPath('home'), 'second-brain');
     const legacyRoot = app.getPath('userData');
     const { serverBase, referenceRoot, seedRoot } = resolvePaths();

     // 0) Migration douce depuis l'ancien userData — AVANT toute création de dossier.
     try { migrateLegacyData(legacyRoot, dataRoot); } catch (e) { console.error('[migration] échec', e); }

     // S'assurer que dataRoot/.data existe (server.log, ai-settings, etc.).
     fs.mkdirSync(path.join(dataRoot, '.data'), { recursive: true });

     // 1) Amorçage (idempotent, non destructif).
     try { seedIfEmpty(dataRoot, seedRoot); } catch (e) { console.error('[seed] échec', e); }

     // …suite inchangée : resolveServerJs, pickPort, logPath = path.join(dataRoot,'.data','server.log'),
     //   startServer({ env: buildServerEnv(dataRoot, referenceRoot, port) }), fenêtre, waitForServer…
   }
   ```
   Le reste de `boot()` est inchangé : il utilise déjà la variable locale
   `dataRoot` (pour `logPath` et `buildServerEnv(dataRoot, …)`). **Ne pas toucher**
   à `resolvePaths()`, `buildServerEnv()`, `seed.js`, `server.js`, ni au défaut de
   `wiki-fs.ts` (le dev navigateur doit continuer de pointer le dépôt).

### Décision 3 — Build Mac + Windows via GitHub Actions

Créer `.github/workflows/build-desktop.yml`. Un job par OS (matrice). Chaque job
lance la chaîne de packaging existante et publie l'installeur en **artefact
téléchargeable** (pas de GitHub Release, pas de publication automatique).

```yaml
name: build-desktop

on:
  workflow_dispatch:        # bouton « Run workflow » (déclenchement principal)
  push:
    tags:
      - 'v*'                # optionnel : pousser un tag v0.2.0 déclenche aussi le build

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-14           # runner Apple Silicon (arm64) → cible les Mac M1/M2/M3…
            artifact_name: secondbrain-mac-dmg
            artifact_glob: dist/*.dmg
          - os: windows-latest     # runner Windows x64 → installeur NSIS
            artifact_name: secondbrain-windows-exe
            artifact_glob: dist/*.exe
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20         # LTS stable pour Next 14 + electron-builder 26

      - name: Install root deps (electron + electron-builder)
        run: npm install

      - name: Build web standalone + package installer
        env:
          # macOS : app NON signée en v1 → empêcher electron-builder de chercher un certificat.
          CSC_IDENTITY_AUTO_DISCOVERY: false
        run: |
          npm run build:web
          npx electron-builder --publish never

      - name: Upload installer artifact
        uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.artifact_name }}
          path: ${{ matrix.artifact_glob }}
          if-no-files-found: error
```

Notes de conception pour l'implémenteur :
- `npm run build:web` fait déjà : `rm -rf web/.next` (via `node -e`), `npm --prefix
  web install`, `npm --prefix web run build`, `node electron/copy-standalone-assets.js`.
  Multiplateforme (n'utilise que Node + `&&`, valide dans les scripts npm sous
  Windows). **Ne PAS le remplacer.**
- On sépare `build:web` puis `npx electron-builder --publish never` (au lieu de
  `npm run dist` qui enchaîne les deux) uniquement pour ajouter `--publish never`
  et garantir l'absence de publication accidentelle.
- Le hook `afterPack` (`electron/after-pack.js`) copie l'arbre standalone +
  `node_modules/next` dans les Resources ; il tourne pendant `electron-builder`,
  sur Mac ET Windows (utilise `getResourcesDir`). Rien à changer.
- `macos-14` est épinglé explicitement (et non `macos-latest`) pour **garantir
  arm64**. Sur dépôt privé, les minutes macOS sont facturées ×10 (Windows ×2) :
  ~20 builds Mac/mois dans le quota gratuit de 2 000 min — suffisant, non bloquant.
- Artefacts récupérés sur la page du run Actions (rétention 90 j par défaut), puis
  déposés manuellement sur un Drive partagé. Pas d'auto-updater (choix v1).

### Étapes annexes

- **Bump de version** : `package.json` racine `"version": "0.1.0"` → `"0.2.0"`
  (l'IPC `app:version` lit cette valeur ; affichée dans l'app). Cette version
  matérialise le nouveau schéma de dossier.
- **Commit du contenu à jour** avant le premier build CI : 2 fichiers sont non
  commités (`wiki/Sans titre.canvas`, `wiki/themes/_candidates.json`), sinon la CI
  embarquerait un wiki obsolète.
- **Notice « Premiers pas »** : `docs/premiers-pas.md` — installation, contournement
  de l'alerte « app non vérifiée » (Mac : clic droit → Ouvrir → Ouvrir ; Windows :
  « Informations complémentaires » → « Exécuter quand même »), saisie de la clé IA
  dans `/reglages` (Anthropic direct OU gateway compatible), et rappel que les
  données vivent dans `~/second-brain` (100 % local).

## Décisions

- **D1 — Dépôt en privé** (au lieu de rester public). Raison : `raw/`+`wiki/` sont
  dans le dépôt (nécessaire pour le seed et le build CI) ; seul le passage en privé
  empêche leur lecture publique. Écarté : sortir le contenu du dépôt (injection au
  build par un autre canal) — sur-ingénierie inutile une fois le dépôt privé.
- **D2 — Dossier `~/second-brain` visible** (au lieu du `userData` système caché).
  Raison : demande explicite d'Arthur + facilité d'ouverture/sauvegarde manuelle.
  Point clarifié en discussion : **« local » ≠ « caché »** — les deux emplacements
  sont aussi privés l'un que l'autre ; la sécurité vient du fait que rien ne quitte
  la machine et que le dépôt est privé, pas de la visibilité du dossier. Écarté :
  `~/Documents/second-brain` (Arthur a validé la racine du dossier perso).
- **D3 — Build des DEUX OS via GitHub Actions** (au lieu de « Mac en local +
  Windows en CI »). Raison : reproductibilité, même commit → contenu identique
  garanti sur les deux plateformes, Arthur n'a plus à builder localement. Coût
  assumé : minutes macOS ×10 sur dépôt privé (non bloquant, ~20 builds/mois
  gratuits ; repli = build Mac local si plafond atteint).
- **D4 — Migration douce des données** de l'ancien `userData` vers `~/second-brain`
  au premier lancement de la v0.2.0. Raison : ne pas orpheliner les données de la
  machine de test d'Arthur. Non destructive (copie, ne supprime pas l'ancien), ne
  s'exécute que si la cible est absente.
- **D5 — App toujours NON signée en v1** (inchangé, cf. spec electron D-E5).
  `mac.identity: null` conservé ; `CSC_IDENTITY_AUTO_DISCOVERY=false` sur le runner
  pour éviter que electron-builder ne cherche un certificat. Contournement
  Gatekeeper/SmartScreen documenté dans la notice.
- **D6 — Artefacts, pas GitHub Release** (`--publish never`). Raison : distribution
  manuelle via Drive déjà décidée ; sur dépôt privé les assets de Release seraient
  de toute façon protégés. Repli : câbler une Release plus tard si besoin.
- **D7 — Node 20 en CI.** Raison : LTS le mieux testé pour Next 14 + electron-builder
  26. La machine locale d'Arthur tourne en Node 26 (le build local a réussi ainsi),
  mais la CI part d'un arbre propre → le piège « Node 26 casse `next build`
  par-dessus un `.next` sale » (déjà neutralisé par le `rm -rf web/.next` de
  `build:web`) ne s'applique pas. Repli : Node 22 si un souui de build apparaît.

## Hors périmètre

- **Aucune synchronisation entre utilisateurs.** L'app reste « instantané figé » :
  chaque instance a sa copie ; les ajouts futurs d'Arthur ne se propagent pas
  automatiquement chez les collègues (une réinstallation ne re-seed pas — le seed
  est non destructif). Un éventuel bouton « réimporter le dernier contenu » est un
  chantier ultérieur, hors de cette spec.
- **Auto-updater** : retiré en v1 (mise à jour = re-télécharger + réinstaller ;
  les données locales sont préservées par le seed non destructif). Non réintroduit
  ici.
- **Signature de code** (certificats Apple/Windows) : hors périmètre v1.
- **Version Mac Intel** : Arthur a confirmé qu'aucun collègue n'est sur Mac Intel.
  On ne produit qu'un `.dmg` arm64.
- **Réécriture de l'historique Git** pour purger le contenu déjà exposé
  publiquement : hors périmètre (le passage en privé suffit pour l'usage voulu).

## Todo

- [x] **Commiter le contenu wiki à jour** — `git add wiki/ && git commit` des 2
      fichiers non suivis (`wiki/Sans titre.canvas`, `wiki/themes/_candidates.json`)
      + tout autre changement de contenu en attente.
      *Vérif :* `git status` propre ; `git ls-files wiki/ | wc -l` reflète le contenu
      courant.
      **Fait :** déjà satisfait — les 2 fichiers ont été committés dans une session
      antérieure (depuis l'écriture de la spec). `git status --porcelain` ne montre
      plus aucun changement wiki/raw (seul le fichier de spec est non suivi) ;
      `git ls-files wiki/` = 87 fichiers reflète le contenu courant. Aucun nouveau
      commit nécessaire pour ce point.

- [x] **`package.json` racine : bump `0.1.0` → `0.2.0`.**
      *Vérif :* `node -e "console.log(require('./package.json').version)"` affiche
      `0.2.0`. **Fait :** vérifié, affiche `0.2.0`.

- [x] **`electron/main.js` : `dataRoot` → `~/second-brain` + migration douce.**
      Appliquer les 3 modifications de la section « Décision 2 » (nouvelle valeur de
      `dataRoot`, helper `migrateLegacyData`, réordonnancement du début de `boot()`
      avec migration AVANT `mkdirSync(.data)`).
      *Vérif :* build `npm run build:web` OK, puis `npm start` (app packagée non
      requise pour ce test) — au lancement, l'app crée `~/second-brain/{wiki,raw,.data}`
      et l'affiche ; `ls ~/second-brain` montre les 3 entrées ; le chat charge le
      wiki. Sur une machine ayant déjà des données dans l'ancien `userData`
      (`~/Library/Application Support/SecondBrain`), vérifier que `~/second-brain`
      contient bien les données rapatriées (log `[migration] … rapatrié`).
      **Fait :** les 3 modifications appliquées + commentaire d'en-tête mis à jour.
      `node --check electron/main.js` OK. Preuve du comportement **sans** `build:web`
      (interdit : un `next dev` concurrent tourne, `rm -rf web/.next` le casserait —
      cf. lessons 2026-07-21/28) et **sans GUI** (éviterait un dialogue sur l'écran
      d'Arthur) : harnais headless stubbant `electron` pour exécuter le VRAI `boot()`
      avec `HOME`/`userData` scratch. Résultats : (a) scénario migration → logs
      `[migration] wiki/raw/.data rapatrié`, `~/second-brain/{wiki,raw,.data}` créés,
      clé API + historique imbriqué rapatriés, ancien dossier intact (non destructif),
      seed n'écrase pas le wiki legacy ; la clé migrée prouve l'ordre migration AVANT
      `mkdirSync(.data)` ; (b) scénario nouvel utilisateur → `[seed] wiki/raw amorcé`,
      `~/second-brain/{wiki,raw,.data}` créés depuis le dépôt (41 fichiers raw).
      Le lancement GUI complet + chargement du chat reste à confirmer côté humain lors
      du 1er run de l'app packagée (dépend du build CI).

- [x] **`.github/workflows/build-desktop.yml` : créer le workflow matrice Mac+Windows.**
      Contenu exact en section « Décision 3 ».
      *Vérif locale (avant push) :* `npx --yes @action-validator/cli .github/workflows/build-desktop.yml`
      si dispo, sinon relecture YAML + `node -e "require('js-yaml')"` optionnel ;
      au minimum, valider que le fichier parse (indentation). *Vérif réelle
      (post-push, côté humain) :* déclencher « Run workflow » → les 2 jobs
      réussissent → les artefacts `secondbrain-mac-dmg` (`.dmg`) et
      `secondbrain-windows-exe` (`.exe`) sont téléchargeables.
      **Fait :** fichier créé avec le contenu exact de la spec. Parse validé via
      `js-yaml` : `jobs: [build]`, 2 entrées de matrice (macos-14 + windows-latest),
      triggers `workflow_dispatch` + `push` tags `v*`. `@action-validator/cli` non
      disponible hors-ligne (repli YAML documenté appliqué). Vérif réelle post-push
      reste côté humain.

- [x] **`docs/premiers-pas.md` : notice d'installation utilisateur.**
      Sections : (1) Installer (Mac : ouvrir le `.dmg`, glisser dans Applications ;
      Windows : lancer le `.exe`). (2) Contourner l'alerte 1er lancement (Mac : clic
      droit → Ouvrir → Ouvrir ; Windows : « Informations complémentaires » →
      « Exécuter quand même »). (3) Renseigner l'accès IA dans `/reglages` (clé
      Anthropic directe OU passerelle : clé + URL de base + modèle ; prise en compte
      à chaud). (4) « Où sont mes données » : `~/second-brain`, 100 % local, jamais
      transmis.
      *Vérif :* fichier présent, les 4 sections rédigées, chemins/manips exacts.
      **Fait :** fichier créé, 4 sections présentes (`grep '^## '` = Installer /
      Autoriser 1er lancement / Accès IA / Où sont mes données). Libellés alignés sur
      l'UI réelle de `/reglages` (« Clé API », « Adresse du service (optionnel) »,
      « Modèle » défaut `claude-sonnet-4-5`, presets « Anthropic (perso/entreprise) »
      / « Passerelle d'entreprise », boutons « Tester la connexion » / « Enregistrer »).

- [x] **(Doc) Mettre à jour les mentions de l'emplacement des données** dans
      `docs/platform.md` (et tout doc décrivant le stockage packagé) : remplacer les
      références à `userData`/`Application Support` par `~/second-brain` là où elles
      décrivent l'emplacement des données de l'app packagée.
      *Vérif :* `grep -rn -i "userData\|Application Support" docs/` ne renvoie plus de
      description erronée de l'emplacement des données (les mentions historiques dans
      les specs figées peuvent rester).
      **Fait :** 5 mentions de `docs/platform.md` mises à jour (intro, §1, table
      `DATA_ROOT`, §8 amorçage, §8 données) + ajout de la migration douce et du
      workflow CI dans §8. `grep` final : seule reste ligne 174 décrivant l'**ancien**
      `userData` comme source de la migration (exact, non erroné). Le commentaire
      d'en-tête de `electron/main.js` a aussi été corrigé.

- [ ] **(Humain) Passer le dépôt GitHub en privé.**
      *Vérif :* `curl -s -o /dev/null -w "%{http_code}" https://api.github.com/repos/arthurleroy-dot/second-brain-ai-coding`
      renvoie `404` (au lieu de `200`) pour un appel non authentifié.

- [ ] **(Humain + agent) Test IA de bout en bout, une fois, avec une vraie clé.**
      Lancer l'app, saisir une clé valide (Anthropic ou gateway) dans `/reglages`,
      poser une question au chat (doit remonter du contenu wiki) et lancer une
      ingestion d'une source de `raw/` (doit produire une nouvelle ressource sous
      `~/second-brain/wiki/resources/`).
      *Vérif :* réponse de chat citant le wiki + fichier `resources/<slug>.md` créé
      dans `~/second-brain/wiki/` ; aucun secret écrit ailleurs que
      `~/second-brain/.data/ai-settings.json`.

### Ordre d'exécution recommandé

Étapes de code d'abord (commit contenu → bump version → `main.js` → workflow →
notice → docs), testables/relisibles localement. Puis actions humaines (dépôt
privé, déclenchement CI, test IA) qui dépendent de secrets/plateforme.

## Bilan

Implémenté le 2026-07-28. Les **6 étapes de code/doc** sont faites et vérifiées ;
les **3 étapes restantes sont humaines** (dépôt privé, déclenchement CI, test IA
réel) et ne peuvent pas être exécutées par l'agent.

### Ce qui a été fait

| Étape | Fichier(s) | Preuve |
|-------|-----------|--------|
| Contenu wiki à jour | — | Déjà committé avant l'implémentation ; `git status` propre côté wiki, `git ls-files wiki/` = 87. |
| Bump version | `package.json` | `require('./package.json').version` → `0.2.0`. |
| Données → `~/second-brain` + migration | `electron/main.js` | Harnais headless (stub `electron`, vrai `boot()`) : migration `wiki/raw/.data` + clé rapatriée, non destructif, seed non écrasé ; scénario neuf → seed depuis dépôt. `node --check` OK. |
| Workflow CI | `.github/workflows/build-desktop.yml` | Parse `js-yaml` : 2 jobs (macos-14 + windows-latest), artefacts `.dmg`/`.exe`, triggers `workflow_dispatch` + tags `v*`. |
| Notice utilisateur | `docs/premiers-pas.md` | 4 sections, libellés alignés sur l'UI `/reglages` réelle. |
| Doc emplacement | `docs/platform.md` | 5 mentions `userData` → `~/second-brain` + migration + CI ajoutés ; grep final propre. |

### Écarts au plan (et pourquoi)

1. **Étape « commiter le contenu wiki » = déjà satisfaite.** Depuis l'écriture de
   la spec, les 2 fichiers cités (`wiki/Sans titre.canvas`,
   `wiki/themes/_candidates.json`) ont été committés dans une session antérieure.
   `git status --porcelain` ne montrait plus aucun changement wiki/raw. Aucun
   nouveau commit nécessaire — item coché sans action.

2. **Preuve de l'étape `main.js` sans `npm run build:web` ni GUI.** La spec
   suggérait `build:web` + `npm start`. Deux raisons de ne pas l'exécuter tel quel :
   (a) un `next dev` concurrent tournait (autre session) et `build:web` fait
   `rm -rf web/.next` → l'aurait corrompu (cf. lessons 2026-07-21/28) ; (b) le
   lancement GUI complet aurait fait surgir un dialogue d'erreur sur l'écran
   d'Arthur (serveur standalone non bâti). Remplacé par un **harnais headless
   isolé** stubbant `electron` pour exécuter le **vrai** `boot()` (vraie
   `migrateLegacyData`, vrai calcul `dataRoot`, vrai `seedIfEmpty`) sur un
   `HOME`/`userData` scratch — preuve plus forte (2 scénarios : migration +
   nouvel utilisateur) et sans effet de bord. Le lancement GUI réel + chargement
   du chat reste couvert par le test IA humain de bout en bout.

3. **Ajouts hors todo stricte, pour cohérence :** commentaire d'en-tête de
   `electron/main.js` corrigé (décrivait encore `userData`) ; section §8 de
   `docs/platform.md` enrichie de la migration douce et du workflow CI (désormais
   exacts). Aucun changement de comportement.

### Reste à faire (humain — hors capacité de l'agent)

- **Passer le dépôt GitHub en privé** (seule vraie fuite : `raw/`+`wiki/` lisibles
  publiquement tant que le dépôt est public). Vérif : `curl` de l'API repo → `404`.
- **Déclencher le workflow** (« Run workflow ») et récupérer les 2 artefacts
  (`.dmg` arm64 + `.exe`).
- **Test IA de bout en bout** avec une vraie clé (chat cite le wiki + ingestion
  crée une fiche sous `~/second-brain/wiki/resources/`).
