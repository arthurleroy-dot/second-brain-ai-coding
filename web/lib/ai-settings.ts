import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { DATA_ROOT } from '@/lib/wiki-fs';

/**
 * Store de réglages IA — un petit JSON local sous `<DATA_ROOT>/.data/ai-settings.json`.
 *
 * But : permettre à l'utilisateur de saisir ses accès IA (clé / adresse / modèle)
 * depuis l'écran `/reglages` et de les faire prendre effet À CHAUD, sans redémarrer
 * le serveur. `getAiSettings()` est relu (synchrone) à CHAQUE appel IA via
 * `getAnthropic()`/`getModel()` de `@/lib/claude`.
 *
 * `.data/` est HORS `wiki/`/`raw/` → le garde-fou d'`applyFileOps` refuse ce chemin :
 * on écrit donc avec un writer atomique dédié (même pattern que
 * `@/lib/conversations-store` writeJsonAtomic). La clé est stockée EN CLAIR en dev
 * (dossier `.gitignore`) ; en Electron (Phase 6), `safeStorage` chiffrera par-dessus
 * et injectera via l'env — `getAiSettings()` reste compatible (env = secours).
 *
 * SÉCURITÉ : ne JAMAIS logguer `apiKey` ni la renvoyer en clair (cf. getSafeAiSettings).
 */

const SETTINGS_PATH = path.join(DATA_ROOT, '.data', 'ai-settings.json');
export const DEFAULT_MODEL = 'claude-sonnet-4-5';
export const ANTHROPIC_DIRECT_URL = 'https://api.anthropic.com';

export interface AiSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
}

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
  } catch {
    return null;
  }
}

// Store prime sur env (env = secours dev). baseUrl : autorité TOTALE du store (y
// compris '' = Anthropic direct) — sinon le SDK relit ANTHROPIC_BASE_URL de l'env et
// la gateway du .env.local fuite dans le preset « direct ». apiKey/model : valeur du
// store si non vide, sinon secours env (évite le footgun « le dev perd sa clé
// .env.local en changeant juste le modèle »).
export function getAiSettings(): AiSettings {
  const s = readStore();
  if (!s)
    return {
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
  configured: boolean; // = hasKey
  source: 'store' | 'env'; // d'où vient la config effective
  baseUrl: string;
  model: string;
  hasKey: boolean; // Boolean(clé effective)
  keyHint: string | null; // 4 derniers caractères, SEULEMENT si le store porte sa propre clé
}

export function getSafeAiSettings(): SafeAiSettings {
  const store = readStore();
  const eff = getAiSettings();
  const hasKey = Boolean(eff.apiKey);
  // Un fichier store présent ⇒ la config effective est pilotée par le store
  // (baseUrl surtout, cf. getAiSettings). Sinon tout vient de l'env (.env.local).
  const source: 'store' | 'env' = store ? 'store' : 'env';
  // keyHint : seulement si le STORE porte sa propre clé (pas le secours env) —
  // permet à l'UI de distinguer « clé enregistrée dans l'app » de « clé du .env.local ».
  const storeKey = store?.apiKey ?? '';
  const keyHint = storeKey ? storeKey.slice(-4) : null;
  return { configured: hasKey, source, baseUrl: eff.baseUrl, model: eff.model, hasKey, keyHint };
}

/** Écriture atomique (temp + rename même volume), dossiers créés au besoin. */
async function writeJsonAtomic(abs: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const tmp = path.join(
    path.dirname(abs),
    `.${path.basename(abs)}.tmp-${process.pid}-${Date.now()}`,
  );
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmp, abs);
  } catch (e) {
    await fs.unlink(tmp).catch(() => {});
    throw e;
  }
}

// Fusion + écriture atomique. Si patch.apiKey vide/absent → conserve la clé déjà en
// store (permet d'éditer adresse/modèle sans re-saisir le secret).
export async function saveAiSettings(patch: {
  apiKey?: string;
  baseUrl: string;
  model: string;
}): Promise<void> {
  const cur = readStore();
  const next: AiSettings = {
    apiKey: patch.apiKey && patch.apiKey.trim() ? patch.apiKey.trim() : cur?.apiKey ?? '',
    baseUrl: patch.baseUrl ?? '',
    model: patch.model && patch.model.trim() ? patch.model.trim() : DEFAULT_MODEL,
  };
  await writeJsonAtomic(SETTINGS_PATH, next);
}
