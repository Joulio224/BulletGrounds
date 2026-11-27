const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { autoUpdater } = require('electron-updater');

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.autoRunAppAfterInstall = true;

let mainWindow = null;
let updateWindow = null;
let tray = null;
let isQuitting = false;

// Lancé par Windows au démarrage de la session (--hidden) : on reste dans la zone de notification
const startHidden = process.argv.includes('--hidden');

// Un seul BulletGrounds à la fois : relancer l'appli alors qu'elle tourne en arrière-plan
// rouvre simplement la fenêtre existante.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();

// Réglages propres à l'appli de bureau (pas ceux du jeu)
const prefsFile = () => path.join(app.getPath('userData'), 'desktop-prefs.json');
function readPrefs() {
  try {
    return { background: true, hintShown: false, ...JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) };
  } catch {
    return { background: true, hintShown: false };
  }
}
function writePrefs(patch) {
  try {
    fs.writeFileSync(prefsFile(), JSON.stringify({ ...readPrefs(), ...patch }));
  } catch {}
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// Icône + menu de la zone de notification (à côté de l'horloge)
async function createTray() {
  if (tray) return;
  let icon = nativeImage.createEmpty();
  try {
    icon = await app.getFileIcon(process.execPath, { size: 'small' });
  } catch {}
  tray = new Tray(icon);
  tray.setToolTip('BulletGrounds');
  const rebuildMenu = () => {
    const prefs = readPrefs();
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Ouvrir BulletGrounds', click: showMainWindow },
        { type: 'separator' },
        {
          label: 'Rester actif en arrière-plan (notifications)',
          type: 'checkbox',
          checked: prefs.background,
          click: (item) => {
            writePrefs({ background: item.checked });
            rebuildMenu();
          },
        },
        {
          label: 'Lancer au démarrage de Windows',
          type: 'checkbox',
          checked: app.getLoginItemSettings().openAtLogin,
          click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }),
        },
        { type: 'separator' },
        {
          label: 'Quitter BulletGrounds',
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ])
    );
  };
  rebuildMenu();
  tray.on('click', showMainWindow);
}

function log(message) {
  try {
    const file = path.join(app.getPath('userData'), 'updater.log');
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${message}\n`);
  } catch {}
}

function createUpdateWindow() {
  if (updateWindow && !updateWindow.isDestroyed()) return;

  updateWindow = new BrowserWindow({
    width: 460,
    height: 310,
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    alwaysOnTop: true,
    parent: mainWindow && mainWindow.isVisible() ? mainWindow : undefined,
    modal: Boolean(mainWindow && mainWindow.isVisible()),
    frame: false,
    backgroundColor: '#080d18',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<style>
*{box-sizing:border-box}
body{
  margin:0;height:100vh;display:flex;align-items:center;
  justify-content:center;background:linear-gradient(145deg,#101a2b,#080d18);
  color:white;font-family:Arial,sans-serif
}
.panel{width:100%;padding:34px 36px;text-align:center}
.logo{font-size:12px;letter-spacing:4px;color:#8ca8d2;font-weight:700;margin-bottom:18px}
h1{font-size:25px;margin:0 0 10px}
p{font-size:13px;color:#aab8ce;line-height:1.5;margin:0}
.track{height:9px;background:#26364e;border-radius:20px;overflow:hidden;margin:25px 0 10px}
#fill{height:100%;width:0;background:linear-gradient(90deg,#2878df,#55b7ff);border-radius:20px;transition:width .18s}
.meta{display:flex;justify-content:space-between;font-size:12px;color:#aab8ce}
#percent{color:white;font-weight:700;font-size:15px}
.foot{margin-top:20px;font-size:11px;color:#71839d}
</style>
</head>
<body>
<main class="panel">
  <div class="logo">BULLETGROUNDS</div>
  <h1>Mise à jour en cours</h1>
  <p id="status">Préparation du téléchargement…</p>
  <div class="track"><div id="fill"></div></div>
  <div class="meta">
    <span id="details">Connexion à GitHub</span>
    <span id="percent">0 %</span>
  </div>
  <div class="foot">Ne ferme pas le jeu pendant la mise à jour.</div>
</main>
</body>
</html>`;

  updateWindow.loadURL(
    'data:text/html;charset=utf-8,' + encodeURIComponent(html)
  );

  updateWindow.on('closed', () => {
    updateWindow = null;
  });
}

function updateProgress(progress) {
  if (!updateWindow || updateWindow.isDestroyed()) return;

  const percent = Math.max(0, Math.min(100, Math.round(progress.percent || 0)));
  const transferred = (progress.transferred / 1024 / 1024).toFixed(1);
  const total = (progress.total / 1024 / 1024).toFixed(1);
  const speed = (progress.bytesPerSecond / 1024 / 1024).toFixed(1);

  updateWindow.webContents.executeJavaScript(`
    document.getElementById('fill').style.width = '${percent}%';
    document.getElementById('percent').textContent = '${percent} %';
    document.getElementById('details').textContent =
      '${transferred} / ${total} Mo · ${speed} Mo/s';
    document.getElementById('status').textContent =
      'Téléchargement des fichiers de mise à jour…';
  `).catch(() => {});
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#080d18',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Le script de pont (preload) laisse une notification cliquée rouvrir la fenêtre cachée
      preload: path.join(__dirname, 'preload.cjs'),
      // Fenêtre cachée : on garde la page active pour continuer à recevoir les notifications
      backgroundThrottling: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (!startHidden) mainWindow.show();
  });

  // Fermer la fenêtre ne quitte plus le jeu : il reste dans la zone de notification pour
  // continuer à envoyer les notifications (désactivable dans le menu de l'icône).
  mainWindow.on('close', (event) => {
    if (isQuitting || !readPrefs().background) return;
    event.preventDefault();
    mainWindow.hide();
    if (!readPrefs().hintShown) {
      writePrefs({ hintShown: true });
      tray?.displayBalloon?.({
        title: 'BulletGrounds reste actif',
        content: 'Tu recevras tes notifications en arrière-plan. Clic droit sur l’icône pour quitter.',
      });
    }
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  } else {
    mainWindow.loadURL('http://127.0.0.1:5173');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function checkForUpdates() {
  if (!app.isPackaged) return;

  log(`Vérification. Version installée : ${app.getVersion()}`);

  autoUpdater.on('checking-for-update', () => {
    log('Vérification auprès de GitHub...');
  });

  autoUpdater.on('update-available', (info) => {
    log(`Mise à jour disponible : ${info.version}`);
    createUpdateWindow();
  });

  autoUpdater.on('update-not-available', (info) => {
    log(`Aucune mise à jour. Version distante : ${info.version}`);
  });

  autoUpdater.on('download-progress', updateProgress);

  autoUpdater.on('error', (error) => {
    log(`ERREUR : ${error.stack || error.message}`);

    if (updateWindow && !updateWindow.isDestroyed()) {
      updateWindow.close();
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    log(`Téléchargement terminé : ${info.version}`);

    if (updateWindow && !updateWindow.isDestroyed()) {
      updateWindow.webContents.executeJavaScript(`
        document.getElementById('status').textContent =
          'Installation de la mise à jour…';
        document.getElementById('details').textContent =
          'Redémarrage automatique';
        document.getElementById('percent').textContent = '100 %';
        document.getElementById('fill').style.width = '100%';
      `).catch(() => {});
    }

    setTimeout(() => {
      autoUpdater.quitAndInstall(true, true);
    }, 1000);
  });

  autoUpdater.checkForUpdates().catch((error) => {
    log(`ÉCHEC DE VÉRIFICATION : ${error.stack || error.message}`);
  });
}

// Windows associe les notifications à l'identifiant de l'appli (sauf version Microsoft Store,
// qui a déjà le sien).
if (process.platform === 'win32' && !process.windowsStore) {
  app.setAppUserModelId('fr.miniwarzone.game');
}

app.on('second-instance', showMainWindow);

// Clic sur une notification : le jeu (page) demande à rouvrir sa fenêtre
ipcMain.on('bg:show-window', showMainWindow);

app.on('before-quit', () => {
  isQuitting = true; // quitter pour de bon (menu de l'icône, mise à jour, arrêt de Windows)
});
autoUpdater.on('before-quit-for-update', () => {
  isQuitting = true;
});

if (gotSingleInstanceLock) {
  app.whenReady().then(() => {
    createWindow();
    createTray();
    setTimeout(checkForUpdates, 2500);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  // Avec « rester actif », la fenêtre est seulement cachée : cet événement n'arrive alors pas.
  if (process.platform !== 'darwin') app.quit();
});
