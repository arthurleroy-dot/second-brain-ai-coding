/**
 * Side-effect d'environnement pour type-registry.test.ts — importé EN PREMIER pour
 * figer `WIKI_ROOT` vers un dossier temporaire AVANT l'éval de wiki-fs (qui capte
 * `process.env.WIKI_ROOT` à son chargement). Node exécute chaque fichier de test dans
 * un process séparé, donc ceci n'affecte pas les autres tests. Nommé avec `_` (et sans
 * suffixe `.test.ts`) pour ne pas matcher le glob `*.test.ts`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'type-reg-'));
export const wikiDir = path.join(tmp, 'wiki');
fs.mkdirSync(wikiDir, { recursive: true });
process.env.DATA_ROOT = tmp;
process.env.WIKI_ROOT = wikiDir;
