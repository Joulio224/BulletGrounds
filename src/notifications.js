// ---------------------------------------------------------------------------
// Notifications : sur l'ordinateur (fenêtre en arrière-plan) et à l'écran (en partie)
// ---------------------------------------------------------------------------
// Deux canaux, réglables dans Paramètres (voir settings.js) :
//   desktopNotifications  notification système (Windows : toast) quand la fenêtre du jeu n'est
//                         pas au premier plan (réduite, Alt+Tab...). API Notification du
//                         navigateur : marche dans l'appli Electron, sans code côté Electron.
//   ingameAlerts          petite alerte en haut à droite de l'écran, pendant la partie, quand la
//                         fenêtre est au premier plan (la souris est capturée : le menu Échap
//                         n'est pas ouvert, donc sans ça on ne verrait jamais le message).
// Ce sont des notifications « appli ouverte » : elles arrivent tant que le jeu tourne (même
// réduit), pas quand il est fermé (ça demanderait un vrai push serveur, voir README).
import { getSettings } from './settings.js';

const TOAST_MS = 5000;
const MAX_TOASTS = 3;

let styleInjected = false;
let layerEl = null;

function injectStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    #notif-layer {
      position: fixed; top: 14px; right: 14px; z-index: 1800; width: min(320px, calc(100vw - 28px));
      display: flex; flex-direction: column; gap: 8px; pointer-events: none;
      font: 14px/1.35 system-ui, sans-serif;
    }
    .notif-toast {
      padding: 10px 12px; border-radius: 10px; color: #fff;
      background: rgba(20, 22, 30, 0.92); border: 1px solid rgba(255,255,255,0.18);
      border-left: 4px solid #e63946; box-shadow: 0 6px 20px rgba(0,0,0,0.45);
      animation: notif-in 0.18s ease-out;
    }
    .notif-toast strong { display: block; font-size: 0.85rem; }
    .notif-toast span {
      display: block; color: #ddd; font-size: 0.82rem;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    @keyframes notif-in { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; } }
  `;
  document.head.appendChild(style);
}

function getLayer() {
  injectStyle();
  if (!layerEl) {
    layerEl = document.createElement('div');
    layerEl.id = 'notif-layer';
    document.body.appendChild(layerEl);
  }
  return layerEl;
}

function isWindowActive() {
  return document.hasFocus() && !document.hidden;
}

// Le jeu (écran 3D) est affiché : ni l'écran de connexion, ni le lobby.
function isInGameScreen() {
  const auth = document.getElementById('auth-screen');
  const lobby = document.getElementById('lobby-screen');
  return Boolean(auth && lobby && auth.hidden && lobby.hidden);
}

function showToast(title, body) {
  const layer = getLayer();
  const toast = document.createElement('div');
  toast.className = 'notif-toast';
  const strong = document.createElement('strong');
  strong.textContent = title; // textContent : un message ne doit jamais injecter de HTML
  const span = document.createElement('span');
  span.textContent = body;
  toast.append(strong, span);
  layer.appendChild(toast);
  while (layer.children.length > MAX_TOASTS) layer.firstElementChild.remove();
  setTimeout(() => toast.remove(), TOAST_MS);
}

export function notificationsSupported() {
  return typeof Notification !== 'undefined';
}

// À appeler depuis un geste de l'utilisateur (clic) : certains navigateurs refusent sinon.
export function requestNotificationPermission() {
  if (!notificationsSupported() || Notification.permission !== 'default') return;
  try {
    const result = Notification.requestPermission();
    result?.catch?.(() => {});
  } catch {
    // vieux navigateurs (callback) ou refus : pas grave, les alertes à l'écran restent disponibles
  }
}

// Une seule demande, au premier clic dans l'appli (sinon il faudrait attendre un réglage).
export function requestPermissionOnFirstClick() {
  if (!notificationsSupported() || Notification.permission !== 'default') return;
  const handler = () => {
    document.removeEventListener('pointerdown', handler, true);
    if (getSettings().desktopNotifications) requestNotificationPermission();
  };
  document.addEventListener('pointerdown', handler, true);
}

// options : { title, body, tag?, toast? }
//   toast : true = peut aussi s'afficher à l'écran pendant la partie (messages)
export function notify({ title, body, tag, toast = false }) {
  const settings = getSettings();
  const cleanTitle = String(title || 'BulletGrounds').slice(0, 80);
  const cleanBody = String(body || '').slice(0, 200);

  if (!isWindowActive()) {
    if (!settings.desktopNotifications || !notificationsSupported() || Notification.permission !== 'granted') return;
    try {
      const n = new Notification(cleanTitle, { body: cleanBody, tag, silent: false });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      // certains environnements refusent le constructeur : on ignore
    }
    return;
  }

  if (toast && settings.ingameAlerts && isInGameScreen()) showToast(cleanTitle, cleanBody);
}

// Pour le bouton « Tester » éventuel et pour vérifier que tout est branché
export function sendTestNotification() {
  const settings = getSettings();
  if (isWindowActive()) {
    showToast('BulletGrounds', 'Notification de test : tout fonctionne.');
    return;
  }
  notify({ title: 'BulletGrounds', body: 'Notification de test : tout fonctionne.', tag: 'test' });
  void settings;
}
