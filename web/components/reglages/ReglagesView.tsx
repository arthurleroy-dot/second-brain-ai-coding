'use client';

import { useEffect, useState } from 'react';
import { Eye, EyeOff, Info } from 'lucide-react';

/**
 * Écran de Réglages IA (/reglages). Permet de saisir ses accès IA — clé / adresse /
 * modèle — et de les faire prendre effet À CHAUD (le serveur reconstruit son client à
 * chaque appel depuis le store, cf. lib/claude.ts + lib/ai-settings.ts).
 *
 * Patron /upload : racine `h-full overflow-y-auto` → scroll natif dans le <main> clippé.
 * MENTION obligatoire en haut : l'app ne parle QUE le protocole « Messages » d'Anthropic.
 */

// Forme sûre renvoyée par GET /api/settings — JAMAIS la clé en clair (type local :
// on n'importe pas le module serveur ai-settings.ts, qui dépend de `fs`).
interface SafeAiSettings {
  configured: boolean;
  source: 'store' | 'env';
  baseUrl: string;
  model: string;
  hasKey: boolean;
  keyHint: string | null;
}

const PRESETS = {
  anthropic: {
    label: 'Anthropic (perso/entreprise)',
    baseUrl: '',
    model: 'claude-sonnet-4-5',
  },
  gateway: {
    label: "Passerelle d'entreprise",
    baseUrl: 'https://llm-gateway.m33.tech',
    model: 'vercel/anthropic-claude-sonnet-4.5',
  },
} as const;
type PresetKey = keyof typeof PRESETS;

const INPUT_CLS = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm';

// Déduit le preset actif de l'adresse (pour surligner le bon segment ; null = personnalisé).
function presetFromBaseUrl(baseUrl: string): PresetKey | null {
  if (baseUrl === PRESETS.gateway.baseUrl) return 'gateway';
  if (baseUrl.trim() === '') return 'anthropic';
  return null;
}

export default function ReglagesView() {
  const [safe, setSafe] = useState<SafeAiSettings | null>(null);

  // Champs du formulaire. La clé démarre vide (jamais préremplie — secret non renvoyé).
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('claude-sonnet-4-5');
  const [preset, setPreset] = useState<PresetKey | null>('anthropic');

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null);

  // Version de l'app de bureau (coquille Electron). Renseignée seulement quand la page
  // tourne dans l'app (pont `window.secondBrain`) ; nulle dans un navigateur web.
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    const bridge = (window as unknown as {
      secondBrain?: { getVersion: () => Promise<string> };
    }).secondBrain;
    if (bridge) bridge.getVersion().then(setAppVersion).catch(() => {});
  }, []);

  // Au montage : préremplit adresse + modèle depuis la config effective (store ou env).
  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((s: SafeAiSettings) => {
        setSafe(s);
        setBaseUrl(s.baseUrl);
        setModel(s.model);
        setPreset(presetFromBaseUrl(s.baseUrl));
      })
      .catch(() => setSafe(null));
  }, []);

  function applyPreset(key: PresetKey) {
    setPreset(key);
    setBaseUrl(PRESETS[key].baseUrl);
    setModel(PRESETS[key].model);
    setTestResult(null);
    setSaveMsg(null);
  }

  async function save() {
    setSaving(true);
    setSaveMsg(null);
    setTestResult(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, baseUrl, model }),
      });
      if (!res.ok) {
        setSaveMsg("Échec de l'enregistrement.");
        return;
      }
      // Rafraîchit badge + hasKey depuis la source de vérité (re-GET).
      const fresh: SafeAiSettings = await fetch('/api/settings').then((r) => r.json());
      setSafe(fresh);
      setApiKey(''); // secret enregistré : on vide le champ (placeholder « clé enregistrée »).
      setSaveMsg('Réglages enregistrés. Ils prennent effet immédiatement, sans redémarrer.');
    } catch {
      setSaveMsg("Erreur réseau pendant l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    setSaveMsg(null);
    try {
      const res = await fetch('/api/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, baseUrl, model }),
      });
      const data = await res.json();
      setTestResult(data.ok ? { ok: true } : { ok: false, message: data.message });
    } catch {
      setTestResult({ ok: false, message: 'Erreur réseau pendant le test.' });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-6">
        <p className="mb-5 text-sm text-gray-500">
          Saisis ici tes accès IA. Ils sont enregistrés en local sur ta machine et prennent
          effet immédiatement, sans redémarrer l’app.
        </p>

        {/* MENTION UTILISATEUR OBLIGATOIRE — contrainte protocole. */}
        <div className="mb-5 flex gap-2 rounded-lg bg-[#E1F5EE] px-3 py-2 text-xs leading-snug text-[#0F6E56]">
          <Info size={15} className="mt-0.5 shrink-0" aria-hidden />
          <p>
            <strong>Cette app fonctionne uniquement avec Claude (Anthropic).</strong> Colle
            soit une <strong>clé Anthropic</strong> (perso ou entreprise), soit la{' '}
            <strong>clé d’une passerelle compatible Anthropic</strong> (ex. la passerelle
            LiteLLM de l’entreprise). Une clé <strong>OpenAI, Google/Gemini</strong> ou autre{' '}
            <strong>ne fonctionnera pas</strong> : l’app ne parle que le protocole « Messages »
            d’Anthropic. Utilise « Tester la connexion » pour vérifier avant d’enregistrer.
          </p>
        </div>

        {/* Badge d'état. */}
        <div className="mb-5 flex flex-wrap items-center gap-2 text-xs">
          {safe?.configured ? (
            <span className="rounded-full bg-[#E1F5EE] px-2 py-0.5 font-medium text-[#0F6E56]">
              Configuré ✓
            </span>
          ) : (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-500">
              Non configuré
            </span>
          )}
          {safe && (
            <span className="text-gray-400">
              source :{' '}
              {safe.source === 'store' ? 'réglages de l’app' : 'fichier .env.local (dev)'}
              {safe.keyHint ? ` · clé …${safe.keyHint}` : ''}
            </span>
          )}
        </div>

        <div className="space-y-4">
          {/* Preset (segmented) — préremplit adresse + modèle ; tout reste éditable. */}
          <div>
            <span className="text-xs text-gray-600">Preset</span>
            <div className="mt-1 grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1">
              {(Object.keys(PRESETS) as PresetKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => applyPreset(key)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    preset === key
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {PRESETS[key].label}
                </button>
              ))}
            </div>
            <span className="mt-1 block text-[11px] text-gray-400">
              Un preset préremplit l’adresse et le modèle. Tu peux tout ajuster ensuite.
            </span>
          </div>

          {/* Clé API — masquée par défaut + bouton œil. */}
          <label className="block text-xs text-gray-600">
            Clé API
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
                placeholder={
                  safe?.hasKey
                    ? '•••• (clé enregistrée — laisser vide pour conserver)'
                    : 'Colle ta clé…'
                }
                className={`${INPUT_CLS} pr-10`}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                title={showKey ? 'Masquer la clé' : 'Afficher la clé'}
                aria-label={showKey ? 'Masquer la clé' : 'Afficher la clé'}
                className="absolute inset-y-0 right-0 top-1 flex items-center px-3 text-gray-400 hover:text-gray-700"
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <span className="mt-1 block text-[11px] text-gray-400">
              La clé est stockée en local. Laisse vide pour conserver la clé déjà enregistrée.
            </span>
          </label>

          {/* Adresse du service. */}
          <label className="block text-xs text-gray-600">
            Adresse du service (optionnel)
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                setPreset(presetFromBaseUrl(e.target.value));
              }}
              placeholder="https://… — vide = API Anthropic en direct"
              className={INPUT_CLS}
            />
            <span className="mt-1 block text-[11px] text-gray-400">
              Vide = Claude en direct (api.anthropic.com). Renseigne l’URL de ta passerelle
              d’entreprise sinon.
            </span>
          </label>

          {/* Modèle. */}
          <label className="block text-xs text-gray-600">
            Modèle
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="claude-sonnet-4-5"
              className={INPUT_CLS}
            />
          </label>

          {/* Résultats inline. */}
          {testResult && (
            <p className={`text-xs ${testResult.ok ? 'text-[#0F6E56]' : 'text-red-600'}`}>
              {testResult.ok ? 'Connexion OK' : testResult.message}
            </p>
          )}
          {saveMsg && <p className="text-xs text-gray-600">{saveMsg}</p>}

          {/* Actions. */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-[#0F6E56] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0c5a47] disabled:opacity-50"
            >
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            <button
              type="button"
              onClick={test}
              disabled={testing}
              className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
            >
              {testing ? 'Test…' : 'Tester la connexion'}
            </button>
          </div>
        </div>

        {/* Version — visible uniquement dans l'application de bureau (coquille Electron). */}
        {appVersion && (
          <p className="mt-8 border-t border-gray-100 pt-3 text-[11px] text-gray-400">
            Application de bureau — version {appVersion}
          </p>
        )}
      </div>
    </div>
  );
}
