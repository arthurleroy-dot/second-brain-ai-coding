# Architecture de la plateforme web (`web/`)

Application Next.js 14 (App Router, TypeScript, Tailwind) qui expose le wiki et
le chat. Principe directeur : **git markdown = seule source de vérité du wiki**.
Supabase ne stocke que les données applicatives (conversations/messages du chat,
et plus tard les comptes). L'app **lit le wiki directement depuis les fichiers**.

---

## 1. Lecture du wiki

- Le repo entier est déployé ; chaque commit sous `wiki/` (fait par l'agent
  d'ingestion) déclenche un redéploiement Vercel automatique (~2 min) → contenu
  frais sans base intermédiaire ni sync.
- Les pages lisent le filesystem à la requête via `web/lib/wiki-fs.ts`
  (`WIKI_ROOT` / `RAW_ROOT`, avec garde anti path-traversal). Le parsing des
  ressources/vues/graph vit dans `web/lib/wiki-parser.ts` ; `web/lib/wiki-query.ts`
  est la façade (mêmes signatures que l'ancienne version Supabase).
- `web/next.config.js` inclut le wiki dans le bundle serverless via
  `outputFileTracingIncludes: { '/**': ['../wiki/**', '../raw/**/*.meta.md'] }`.
  Échappatoire si le chemin tracé diffère sur Vercel : variable `WIKI_ROOT`.

## 2. PDFs et binaires

Les binaires (`raw/*.pdf`, `.pptx`, `.docx`) ne sont **pas** inclus dans le bundle
(taille). Ils sont servis par le proxy `web/app/api/raw/[...file]/route.ts` qui
lit le fichier via l'API GitHub Contents (`Accept: application/vnd.github.raw+json`,
token `GITHUB_TOKEN`) et le streame. En dev, fallback lecture fs sous `RAW_ROOT`.
Limite d'upload documentée côté route (≈50 Mo) ; Git LFS = évolution future.

## 3. Upload → commit dans `/raw`

Vercel a un filesystem read-only : l'écriture dans `raw/` passe par l'API GitHub.

- `web/lib/github.ts` expose `commitFiles(files[], message)` : commit **atomique**
  via la Git Data API (create blobs → tree → commit → update ref). Un upload =
  un seul commit contenant `raw/<source>` + `raw/<source>.meta.md` → jamais de
  paire incomplète, un seul run d'ingestion déclenché. Retry ×3 sur update-ref
  non-fast-forward (uploads concurrents). Collision de nom → suffixe `-2`, `-3`.
- `web/app/api/upload/route.ts` valide, construit le sidecar `.meta.md` (voir
  [ingestion.md](ingestion.md) §2) et appelle `commitFiles`.
- Le commit sous `raw/**` déclenche `.github/workflows/ingest.yml`.

## 4. Statut d'ingestion côté UI

`web/app/api/ingest-status/route.ts?file=<nom>` renvoie l'un de :
1. **Ingéré ✓** — le fichier est présent dans `wiki/_ingested.json` lu via
   `raw.githubusercontent.com` (no-store ; PAS le fs local, en retard d'un
   déploiement). Fournit le slug → lien vers la fiche.
2. **Ingestion en cours…** — un run de l'Action est `in_progress`/`queued`.
3. **En attente** — sinon (message : traitement automatique + rattrapage nocturne).

## 5. Chat

`web/lib/chat-context.ts` sélectionne le contexte depuis le markdown (pas de DB) :
index des frontmatters `resources/` → matching sur themes/authors/entities
(aliases)/titres depuis tout l'historique → chargement par paliers (index →
themes matchés → N ressources) plafonné par un budget de caractères. L'hydratation
des `SOURCES:` citées se fait sur le même index fs. Conversations et messages
restent persistés dans Supabase.

## 6. Variables d'environnement

| Variable | Usage |
|----------|-------|
| `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL` | LLM (chat) via proxy LiteLLM |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase (lecture conversations) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase (écriture messages) |
| `GITHUB_TOKEN` | PAT fine-grained (Contents R/W) — upload + proxy PDF |
| `GITHUB_REPO` | `owner/repo` cible des commits |
| `SITE_PASSWORD`, `SITE_SECRET` | Protection d'accès (mot de passe partagé) |
| `WIKI_ROOT`, `RAW_ROOT` | Override des chemins wiki/raw (dev, ou Vercel si tracing diffère) |

## 7. Déploiement & accès

- **Vercel** : Root Directory `web`, « Include files outside root directory »
  activé (nécessaire pour lire `../wiki`). Chaque commit wiki redéploie.
- **Protection d'accès** : `web/middleware.ts` vérifie un cookie httpOnly signé
  HMAC (`SITE_SECRET`) ; `web/app/login/page.tsx` + `web/app/api/auth/route.ts`
  comparent à `SITE_PASSWORD`. Évolution future : Supabase Auth (la table
  `conversations` est prête à recevoir un `user_id`).
