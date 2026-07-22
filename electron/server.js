// Pilotage du serveur Next embarqué (sortie `standalone`).
//
// La coquille lance `server.js` (le serveur auto-contenu produit par `next build`) comme
// un PROCESS NODE séparé, via le binaire Electron en mode pur Node (ELECTRON_RUN_AS_NODE=1).
// Une SEULE instance à la fois (réf. module) ; tuée au quit. Les logs du serveur vont dans
// <userData>/.data/server.log pour diagnostic.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');

let serverProc = null;

/**
 * Localise server.js dans l'arbre standalone. La racine de tracing est fixée au dossier
 * web/ (next.config.js) → server.js est à plat. Détection tolérante du cas imbriqué
 * `<base>/web/server.js` par sécurité. Renvoie le chemin absolu, ou null si introuvable.
 */
function resolveServerJs(serverBase) {
  const candidates = [
    path.join(serverBase, 'server.js'),
    path.join(serverBase, 'web', 'server.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * Premier port TCP libre à partir de `start`, en écoute locale (127.0.0.1). On teste en
 * ouvrant réellement un listener : s'il rend EADDRINUSE, on incrémente (jusqu'à +100).
 */
function pickPort(start) {
  return new Promise((resolve, reject) => {
    let port = start;
    const tryPort = () => {
      const srv = net.createServer();
      srv.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && port - start < 100) {
          port += 1;
          tryPort();
        } else {
          reject(err);
        }
      });
      srv.once('listening', () => srv.close(() => resolve(port)));
      srv.listen(port, '127.0.0.1');
    };
    tryPort();
  });
}

/**
 * Démarre le serveur Next. `env` doit porter DATA_ROOT / REFERENCE_DOCS_ROOT / PORT /
 * HOSTNAME / NODE_ENV. On force ELECTRON_RUN_AS_NODE=1 dans l'enfant (binaire Electron =
 * pur Node). stdout+stderr → fichier de log.
 */
function startServer({ serverJs, env, logPath }) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const out = fs.openSync(logPath, 'a');
  serverProc = spawn(process.execPath, [serverJs], {
    cwd: path.dirname(serverJs),
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', out, out],
  });
  serverProc.on('exit', (code, signal) => {
    console.log(`[server] arrêté (code=${code} signal=${signal})`);
  });
  return serverProc;
}

/** Tue l'unique process serveur s'il tourne (idempotent). */
function stopServer() {
  if (serverProc && !serverProc.killed) {
    try {
      serverProc.kill('SIGTERM');
    } catch {
      /* déjà mort */
    }
  }
  serverProc = null;
}

/**
 * Attend que le serveur réponde en HTTP (n'importe quel statut = « à l'écoute »).
 * Boucle un GET toutes les 250 ms jusqu'à réponse ou `timeoutMs`.
 */
function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume(); // vide la réponse
        resolve();
      });
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error(`Serveur injoignable après ${timeoutMs} ms`));
        else setTimeout(attempt, 250);
      });
      req.setTimeout(2000, () => req.destroy());
    };
    attempt();
  });
}

module.exports = { resolveServerJs, pickPort, startServer, stopServer, waitForServer };
