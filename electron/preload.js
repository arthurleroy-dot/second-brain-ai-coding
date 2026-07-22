// Pont sécurisé entre la page web (BrowserWindow, contextIsolation:true) et le process
// principal Electron. Expose `window.secondBrain` en lecture seule.
//
// Périmètre v1 (Option A, sans auto-updater) : seulement la version de l'app, pour
// l'afficher dans l'écran /reglages. Les réglages IA (clé/adresse/modèle) passent par
// les routes Next /api/settings — pas par ce pont — puisque la clé est stockée en clair
// dans <userData>/.data/ai-settings.json et relue à chaud par le serveur.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('secondBrain', {
  isElectron: true,
  getVersion: () => ipcRenderer.invoke('app:version'),
});
