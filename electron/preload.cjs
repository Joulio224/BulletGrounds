// Pont minimal et sûr entre la page du jeu et l'appli de bureau : une seule action possible,
// rouvrir la fenêtre (utile quand elle est cachée dans la zone de notification).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bgDesktop', {
  showWindow: () => ipcRenderer.send('bg:show-window'),
});
