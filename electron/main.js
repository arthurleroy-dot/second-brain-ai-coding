// Coquille Electron — process principal.
//
// Rôle : (1) amorcer le wiki dans ~/second-brain au 1er lancement ; (2) lancer le serveur
// Next embarqué (standalone) sur un port local ; (3) l'afficher dans une fenêtre. Toutes les
// données (wiki/raw/.data + réglages IA en clair) vivent dans ~/second-brain (dossier visible
// du dossier personnel), JAMAIS dans le code bundlé — une mise à jour du code ne les touche
// pas (décision D9/D-E8 ; emplacement fixé en v0.2.0, migration douce depuis l'ancien
// userData caché des versions < 0.2.0).
//
// Accès IA : la clé n'est pas injectée par la coquille. Elle est saisie via l'écran
// /reglages, stockée dans ~/second-brain/.data/ai-settings.json et relue à chaud par le
// serveur (Option A retenue par Arthur, 2026-07-21). Pas d'auto-updater en v1 (P3).

// ---------------------------------------------------------------------------
// Garde-fou : si l'environnement ambiant porte ELECTRON_RUN_AS_NODE=1 (certains shells
// de dev le définissent), le binaire Electron démarre en PUR NODE → aucune API Electron,
// aucune fenêtre. On se relance alors proprement sans ce drapeau, puis on sort.
// ---------------------------------------------------------------------------
if (process.env.ELECTRON_RUN_AS_NODE) {
  const { spawnSync } = require('child_process');
  const p = require('path');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const res = spawnSync(process.execPath, [p.join(__dirname, '..')], { stdio: 'inherit', env });
  process.exit(res.status == null ? 1 : res.status);
}

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { seedIfEmpty } = require('./seed');
const {
  resolveServerJs,
  pickPort,
  startServer,
  stopServer,
  waitForServer,
} = require('./server');

// Fige le dossier userData AVANT tout app.getPath('userData').
app.setName('SecondBrain');

const HOST = '127.0.0.1';
const BASE_PORT = 41730;

let win = null;

/**
 * Migration une-fois, non destructive : rapatrie wiki/raw/.data de l'ancien
 * emplacement caché (userData, < v0.2.0) vers le nouveau dataRoot (~/second-brain).
 * Ne copie que si la source existe ET que la cible est absente (jamais d'écrasement).
 */
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

/** Chemins des ressources, différents en dev et en packagé (app.isPackaged). */
function resolvePaths() {
  if (app.isPackaged) {
    const resources = process.resourcesPath;
    return {
      serverBase: path.join(resources, 'standalone'),
      referenceRoot: path.join(resources, 'reference'),
      seedRoot: path.join(resources, 'seed'),
    };
  }
  const repoRoot = path.resolve(__dirname, '..');
  return {
    serverBase: path.join(repoRoot, 'web', '.next', 'standalone'),
    referenceRoot: repoRoot,
    seedRoot: repoRoot,
  };
}

/** Env du serveur Next. La clé IA n'y est PAS (vit dans userData/.data/ai-settings.json). */
function buildServerEnv(dataRoot, referenceRoot, port) {
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    DATA_ROOT: dataRoot,
    REFERENCE_DOCS_ROOT: referenceRoot,
    PORT: String(port),
    HOSTNAME: HOST,
  };
  // Ne jamais transmettre ce drapeau tel quel : startServer le repositionne pour l'enfant.
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function showFatal(message) {
  dialog.showErrorBox('Second Brain — erreur de démarrage', message);
}

async function boot() {
  const dataRoot = path.join(app.getPath('home'), 'second-brain');
  const legacyRoot = app.getPath('userData'); // ancien emplacement (< v0.2.0)
  const { serverBase, referenceRoot, seedRoot } = resolvePaths();

  // 0) Migration douce depuis l'ancien userData — AVANT toute création de dossier
  //    (sinon le mkdirSync .data ci-dessous rendrait existsSync(newp) vrai et le
  //     .data legacy ne serait jamais rapatrié).
  try {
    migrateLegacyData(legacyRoot, dataRoot);
  } catch (e) {
    console.error('[migration] échec', e);
  }

  // S'assurer que dataRoot/.data existe (server.log, ai-settings, etc.).
  fs.mkdirSync(path.join(dataRoot, '.data'), { recursive: true });

  // 1) Amorçage (idempotent, non destructif).
  try {
    seedIfEmpty(dataRoot, seedRoot);
  } catch (e) {
    console.error('[seed] échec', e);
  }

  // 2) Localiser le serveur standalone.
  const serverJs = resolveServerJs(serverBase);
  if (!serverJs) {
    showFatal(
      `Serveur introuvable sous :\n${serverBase}\n\n` +
        `As-tu bien lancé \`npm run build:web\` (sortie standalone) avant de démarrer ?`,
    );
    app.quit();
    return;
  }

  // 3) Port local libre + lancement du serveur.
  const port = await pickPort(BASE_PORT);
  const serverUrl = `http://${HOST}:${port}`;
  const logPath = path.join(dataRoot, '.data', 'server.log');
  startServer({ serverJs, env: buildServerEnv(dataRoot, referenceRoot, port), logPath });

  // 4) Fenêtre + écran d'attente.
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: '#ffffff',
    title: 'Second Brain',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Liens externes (http/https) → navigateur système, jamais dans la fenêtre app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://' + HOST) || url.startsWith('https://' + HOST)) {
      return { action: 'allow' };
    }
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });

  win.loadFile(path.join(__dirname, 'loading.html'));

  // 5) Attendre le serveur puis charger l'app (page /chat).
  try {
    await waitForServer(serverUrl + '/', 30000);
    await win.loadURL(serverUrl + '/chat');
  } catch (e) {
    console.error('[boot] serveur injoignable', e);
    showFatal(
      `Le serveur local n'a pas répondu à temps.\n\n` +
        `Consulte le journal : ${logPath}`,
    );
    return;
  }

  // Hook de test (dev uniquement, piloté par env) : capture d'écran après chargement.
  // Jamais actif pour l'utilisateur final (variable non définie).
  if (process.env.SB_CAPTURE_PATH) {
    await new Promise((r) => setTimeout(r, 1800));
    try {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.SB_CAPTURE_PATH, img.toPNG());
      console.log('[capture] écrit →', process.env.SB_CAPTURE_PATH);
    } catch (e) {
      console.error('[capture] échec', e);
    }
    if (process.env.SB_CAPTURE_QUIT) app.quit();
  }
}

function registerIpc() {
  ipcMain.handle('app:version', () => app.getVersion());
}

app.whenReady().then(() => {
  registerIpc();
  boot();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) boot();
  });
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', stopServer); // une seule instance de serveur : tuée au quit
