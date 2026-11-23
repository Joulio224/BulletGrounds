// ---------------------------------------------------------------------------
// EASTER EGG « SALLE DE PEINTURE »
//
// Une carte privée, vide, sans texture : on y est seul (aucune connexion au
// serveur) et le but est de la peindre entièrement. Chaque impact de balle et
// chaque grenade laisse un rond de peinture ; plus l'arme tire lentement, plus
// le rond est gros (voir PAINT_EGG.radius). Un mur de la salle cache un code :
// là où il est peint, la peinture s'éclaircit pour former des chiffres (voir
// PAINT_EGG.code et PAINT_EGG.reveal). Ce code s'entre sur le terminal de la salle.
//
// ACCÈS : deux portes (PAINT_EGG.doors) — un bouton réservé aux admins dans le menu
// pause, et une éclaboussure sur un mur de la vraie carte (paint-secret-spot.js).
//
// Fichiers : paint-room-map.js (la salle), paint-atlas.js (la peinture),
// ce fichier (règles du jeu, terminal, interface). main.js ne fait que prêter
// ses fonctions via `hooks` (voir startPaintRoom dans main.js).
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { buildPaintRoom, ROOM, CODE_WALL, TERMINAL } from './paint-room-map.js';
import { createPaintAtlas } from './paint-atlas.js';
import { createCollisionWorld } from './collision-world.js';

// ------------------------------------------------------------------ réglages
export const PAINT_EGG = {
  // Interrupteur général. Sur false, l'easter egg n'existe plus : aucune porte, aucun bouton.
  enabled: true,

  // Les portes d'entrée (chacune peut être coupée séparément) :
  doors: {
    admin: true, // bouton « Salle de peinture (test) » dans le menu pause, réservé aux admins
    map: true, // l'éclaboussure sur un mur de la vraie carte : tirer dessus téléporte dans la salle
  },

  // L'éclaboussure secrète (voir paint-secret-spot.js). Le mur sud de la carte est à z = 75 ;
  // ce coin se trouve derrière le gros bloc du couloir sud, à l'abri des regards.
  secretSpot: {
    position: [18, 1.6, 74.96], // centre de la tache (x, y, z)
    normal: [0, 0, -1], // le mur regarde vers -Z
    size: 3.0, // taille de la tache (m)
    radius: 1.0, // un tir doit tomber à moins de 1 m du centre
    hitsNeeded: 3, // nombre de tirs...
    windowSeconds: 4, // ...dans cet intervalle de temps
  },
  // Clé de session qui demande la salle au prochain « Cliquer pour jouer ».
  sessionKey: 'mw_paint_room',
  solvedKey: 'mw_paint_egg_solved',

  // Le code caché sur le mur (chiffres uniquement). C'est CETTE valeur qui est
  // dessinée sur le mur ET attendue par le terminal : change-la ici.
  code: '4827',

  // Densité de l'atlas (pixels par mètre). 32 ≈ un pixel de 3 cm. Plus haut = plus net
  // mais plus lourd (mémoire graphique).
  density: 32,

  // Taille des ronds de peinture selon la CADENCE de l'arme (son temps de recharge
  // entre deux tirs, `cooldown` dans weapons.js). Échelle logarithmique : une arme
  // qui tire 10 fois plus lentement fait un rond bien plus gros.
  //   mitraillette (0,09 s) -> 10 cm   fusil (0,18 s) -> ~20 cm   pistolet (0,35 s) -> ~30 cm
  //   fusil à pompe (0,85 s, 8 plombs) -> ~25 cm par plomb   sniper (1,3 s) -> 50 cm
  radius: {
    min: 0.1, // rayon (m) de l'arme la plus rapide
    max: 0.5, // rayon (m) de l'arme la plus lente
    minCooldown: 0.09,
    maxCooldown: 1.3,
    pelletScale: 0.55, // un plomb de fusil à pompe = 55 % du rond d'un tir simple
    jitter: 0.1, // ± 10 % au hasard
  },

  // Les chiffres : à quel point la peinture s'éclaircit là où ils se cachent
  // (0 = invisible, 1 = blanc pur). Les couleurs de la palette sont assez sombres
  // pour que ça ressorte.
  reveal: { lift: 0.5 },

  // Grenade à fragmentation : une gerbe de taches sur tout ce qui l'entoure.
  grenade: { rays: 110, range: 10, minRadius: 0.8, maxRadius: 1.4 },

  // Au-delà de ce taux, la salle est considérée entièrement peinte (message de victoire).
  fullThreshold: 0.97,
};

export function paintEggRequested() {
  try {
    return PAINT_EGG.enabled && sessionStorage.getItem(PAINT_EGG.sessionKey) === '1';
  } catch {
    return false;
  }
}
export function paintEggDoorOpen(door) {
  return Boolean(PAINT_EGG.enabled && PAINT_EGG.doors?.[door]);
}
// À brancher plus tard sur la vraie porte d'entrée (clic secret, code, évènement…).
export function requestPaintRoom() {
  if (!PAINT_EGG.enabled) return false;
  sessionStorage.setItem(PAINT_EGG.sessionKey, '1');
  return true;
}

// Palette : saturée et plutôt sombre, pour que les chiffres plus clairs ressortent.
export const PAINT_COLORS = [
  { name: 'Rouge', hex: '#d62839' },
  { name: 'Bleu', hex: '#1d4ed8' },
  { name: 'Vert', hex: '#15803d' },
  { name: 'Violet', hex: '#7e22ce' },
  { name: 'Orange', hex: '#d9480f' },
  { name: 'Turquoise', hex: '#0f766e' },
  { name: 'Rose', hex: '#be185d' },
  { name: 'Marron', hex: '#7c4a21' },
];

// Rayon d'un rond de peinture pour une arme (voir PAINT_EGG.radius).
export function paintRadiusFor(def) {
  const { min, max, minCooldown, maxCooldown, pelletScale, jitter } = PAINT_EGG.radius;
  const cooldown = Math.max(def?.cooldown ?? minCooldown, 1e-3);
  const t = THREE.MathUtils.clamp(
    (Math.log(cooldown) - Math.log(minCooldown)) / (Math.log(maxCooldown) - Math.log(minCooldown)),
    0,
    1
  );
  let radius = min + (max - min) * t;
  if ((def?.pellets ?? 1) > 1) radius *= pelletScale;
  return radius * (1 + (Math.random() * 2 - 1) * jitter);
}

// ------------------------------------------------------------------ masque des chiffres
// Chiffres « 7 segments », dessinés dans une image qui couvre tout le mur du code.
const SEGMENTS = {
  0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc',
  5: 'afgcd', 6: 'afgecd', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
};

function createCodeMask(code, wallW, wallH, pxPerMeter = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(wallW * pxPerMeter);
  canvas.height = Math.round(wallH * pxPerMeter);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';

  const digits = String(code).replace(/\D/g, '');
  const digitW = 2.5;
  const digitH = 4.4;
  const thick = 0.58;
  const gap = 1.2;
  const total = digits.length * digitW + (digits.length - 1) * gap;
  const startX = (wallW - total) / 2;
  const baseY = (wallH - digitH) / 2;
  const g = 0.07; // petit jeu entre segments

  // (x, y, largeur, hauteur) en mètres, y vers le haut depuis le bas du mur
  function rect(x, y, w, h) {
    const px = x * pxPerMeter;
    const py = (wallH - (y + h)) * pxPerMeter;
    const r = Math.min(w, h) * 0.3 * pxPerMeter;
    ctx.beginPath();
    ctx.roundRect(px, py, w * pxPerMeter, h * pxPerMeter, r);
    ctx.fill();
  }
  digits.split('').forEach((digit, index) => {
    const x0 = startX + index * (digitW + gap);
    const y0 = baseY;
    const halfH = digitH / 2;
    const seg = {
      a: [x0 + thick * 0.5, y0 + digitH - thick, digitW - thick, thick],
      g: [x0 + thick * 0.5, y0 + halfH - thick / 2, digitW - thick, thick],
      d: [x0 + thick * 0.5, y0, digitW - thick, thick],
      f: [x0, y0 + halfH + g, thick, halfH - thick * 0.5 - g * 2],
      b: [x0 + digitW - thick, y0 + halfH + g, thick, halfH - thick * 0.5 - g * 2],
      e: [x0, y0 + thick * 0.5 + g, thick, halfH - thick * 0.5 - g * 2],
      c: [x0 + digitW - thick, y0 + thick * 0.5 + g, thick, halfH - thick * 0.5 - g * 2],
    };
    (SEGMENTS[digit] || '').split('').forEach((s) => rect(...seg[s]));
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  return { texture, canvas };
}

// ------------------------------------------------------------------ interface (DOM créé ici : index.html n'est pas touché)
const STYLE = `
#paint-hud { position: fixed; left: 16px; top: 96px; z-index: 30; min-width: 230px; padding: 12px 14px; border-radius: 10px;
  background: rgba(14, 16, 20, 0.72); color: #fff; font: 600 13px system-ui, sans-serif; backdrop-filter: blur(4px);
  pointer-events: none; line-height: 1.45; }
#paint-hud .ph-title { font-size: 11px; letter-spacing: 0.12em; opacity: 0.6; text-transform: uppercase; margin-bottom: 6px; }
#paint-hud .ph-bar { height: 8px; border-radius: 4px; background: rgba(255,255,255,0.14); overflow: hidden; margin: 4px 0 8px; }
#paint-hud .ph-bar > i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #d62839, #d9480f, #15803d, #1d4ed8, #7e22ce); transition: width 0.25s ease; }
#paint-hud .ph-color { display: flex; align-items: center; gap: 8px; }
#paint-hud .ph-dot { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.8); }
#paint-hud .ph-keys { opacity: 0.6; font-weight: 500; font-size: 12px; margin-top: 6px; }
#paint-prompt { position: fixed; left: 50%; bottom: 22%; transform: translateX(-50%); z-index: 30; padding: 8px 16px; border-radius: 8px;
  background: rgba(14,16,20,0.8); color: #fff; font: 600 14px system-ui, sans-serif; display: none; pointer-events: none; }
#paint-terminal { position: fixed; inset: 0; z-index: 60; display: none; align-items: center; justify-content: center; pointer-events: none;
  background: rgba(0,0,0,0.45); }
#paint-terminal .pt-box { width: min(420px, 90vw); padding: 22px 26px; border-radius: 14px; background: #0b1410; border: 2px solid #1f6f4a;
  box-shadow: 0 0 40px rgba(31,111,74,0.45); color: #7dffb3; font-family: ui-monospace, "SF Mono", Consolas, monospace; text-align: center; }
#paint-terminal .pt-title { font-size: 12px; letter-spacing: 0.18em; opacity: 0.75; }
#paint-terminal .pt-code { font-size: 44px; letter-spacing: 0.35em; margin: 16px 0 10px; min-height: 56px; }
#paint-terminal .pt-msg { min-height: 20px; font-size: 14px; }
#paint-terminal .pt-msg.err { color: #ff6b6b; }
#paint-terminal .pt-msg.ok { color: #7dffb3; }
#paint-terminal .pt-help { margin-top: 12px; font-size: 11px; opacity: 0.6; }
#paint-flash { position: fixed; inset: 0; z-index: 90; background: #fff; opacity: 0; pointer-events: none; display: flex; align-items: center;
  justify-content: center; color: #101418; font: 700 26px system-ui, sans-serif; letter-spacing: 0.3em; transition: opacity 0.4s ease; }
#paint-banner { position: fixed; left: 50%; top: 14%; transform: translateX(-50%); z-index: 40; padding: 12px 22px; border-radius: 10px;
  background: rgba(14,16,20,0.8); color: #fff; font: 600 15px system-ui, sans-serif; text-align: center; max-width: 80vw; opacity: 0;
  transition: opacity 0.5s ease; pointer-events: none; }
/* en salle de peinture : on masque ce qui ne concerne que la partie en ligne */
body.paint-room #kill-feed, body.paint-room #team-label, body.paint-room #money-hud, body.paint-room #zone-warning,
body.paint-room #scoreboard, body.paint-room #ping-layer, body.paint-room #health-bar, body.paint-room #shield-bar,
body.paint-room #vest-stock, body.paint-room #low-hp-vignette, body.paint-room #pickup-prompt { display: none !important; }
`;

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  if (text) node.textContent = text;
  return node;
}

// ------------------------------------------------------------------ contrôleur
/**
 * @param ctx.scene, ctx.camera, ctx.renderer, ctx.ambiance, ctx.audio, ctx.hudFx
 * @param ctx.getKeybinds()   touches actuelles du jeu
 * @param ctx.keyLabel(code)  libellé d'une touche
 * @param ctx.hooks           fonctions prêtées par main.js :
 *   hideWorld(), setCollision(world), setGround(objects), placePlayer(position),
 *   setWeapon(id), giveGrenades()
 * @param ctx.onSolved()      appelé quand le bon code est saisi (récompense future)
 */
export function createPaintRoom(ctx) {
  const { scene, camera, renderer, hooks } = ctx;

  // style + éléments d'interface
  const style = el('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  const hud = el('div', { id: 'paint-hud' });
  hud.hidden = true;
  const hudTitle = el('div', { class: 'ph-title' }, 'Salle de peinture');
  const hudCoverage = el('div', {}, 'Salle peinte : 0 %');
  const hudBar = el('div', { class: 'ph-bar' });
  const hudBarFill = el('i');
  hudBar.appendChild(hudBarFill);
  const hudColor = el('div', { class: 'ph-color' });
  const hudDot = el('span', { class: 'ph-dot' });
  const hudColorName = el('span');
  hudColor.append(hudDot, hudColorName);
  const hudKeys = el('div', { class: 'ph-keys' });
  hud.append(hudTitle, hudCoverage, hudBar, hudColor, hudKeys);
  const prompt = el('div', { id: 'paint-prompt' });
  const terminalUi = el('div', { id: 'paint-terminal' });
  terminalUi.innerHTML = '<div class="pt-box"><div class="pt-title">TERMINAL — ENTRE LE CODE</div><div class="pt-code"></div><div class="pt-msg"></div><div class="pt-help">Chiffres : saisir · Retour : effacer · Entrée : valider · E / Échap : fermer</div></div>';
  const flash = el('div', { id: 'paint-flash' });
  const banner = el('div', { id: 'paint-banner' });
  document.body.append(hud, prompt, terminalUi, flash, banner);
  const ptCode = terminalUi.querySelector('.pt-code');
  const ptMsg = terminalUi.querySelector('.pt-msg');

  // salle + peinture
  const room = buildPaintRoom({ density: PAINT_EGG.density });
  const mask = createCodeMask(PAINT_EGG.code, CODE_WALL.size.x, CODE_WALL.size.y);
  const atlas = createPaintAtlas({
    renderer,
    room,
    codeMask: mask.texture,
    maskSize: new THREE.Vector2(CODE_WALL.size.x, CODE_WALL.size.y),
    lift: PAINT_EGG.reveal.lift,
  });
  room.mesh.material.map = atlas.texture;
  room.mesh.material.shadowSide = THREE.DoubleSide;

  const group = new THREE.Group();
  group.name = 'paint-room-root';
  group.add(room.mesh);

  // cadre sombre autour du mur du code : repère visuel, non peint
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.7 });
  const fz = CODE_WALL.center.z + CODE_WALL.size.z / 2 + 0.06;
  const fw = CODE_WALL.size.x;
  const fh = CODE_WALL.size.y;
  [
    [fw + 0.5, 0.25, 0.14, 0, CODE_WALL.center.y + fh / 2 + 0.125],
    [0.25, fh + 0.5, 0.14, -fw / 2 - 0.125, CODE_WALL.center.y],
    [0.25, fh + 0.5, 0.14, fw / 2 + 0.125, CODE_WALL.center.y],
  ].forEach(([w, h, d, x, y]) => {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMaterial);
    strip.position.set(CODE_WALL.center.x + x, y, fz);
    strip.castShadow = true;
    group.add(strip);
  });

  // terminal : pupitre + écran (canvas)
  const terminalGroup = new THREE.Group();
  terminalGroup.position.copy(TERMINAL.position);
  terminalGroup.rotation.y = Math.atan2(TERMINAL.facing.x, TERMINAL.facing.z);
  const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.25, 0.7), new THREE.MeshStandardMaterial({ color: 0x4a5565, roughness: 0.55, metalness: 0.25 }));
  pedestal.position.y = 0.625;
  pedestal.castShadow = true;
  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = 256;
  screenCanvas.height = 160;
  const screenTexture = new THREE.CanvasTexture(screenCanvas);
  screenTexture.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.45), new THREE.MeshBasicMaterial({ map: screenTexture, toneMapped: false }));
  screen.position.set(0, 1.0, 0.356);
  const keypad = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.3), new THREE.MeshStandardMaterial({ color: 0x2b323c, roughness: 0.5 }));
  keypad.position.set(0, 1.255, 0.12);
  terminalGroup.add(pedestal, screen, keypad);
  group.add(terminalGroup);

  // collisions (les mêmes que la vraie carte : triangles réels + BVH)
  group.updateMatrixWorld(true);
  const collisionWorld = createCollisionWorld(group);

  // ---------------------------------------------------------------- état
  let active = false;
  let colorIndex = -1; // -1 = couleurs au hasard
  let terminalOpen = false;
  let typed = '';
  let solved = false;
  let nearTerminal = false;
  let hudTimer = 0;
  let announcedFull = false;
  let celebrate = 0;
  const terminalCenter = new THREE.Vector3();
  terminalGroup.getWorldPosition(terminalCenter);
  terminalCenter.y = 1.0;
  const _toTerminal = new THREE.Vector3();
  const _forward = new THREE.Vector3();

  const linear = (hex) => new THREE.Color(hex);
  function currentColor() {
    const index = colorIndex < 0 ? Math.floor(Math.random() * PAINT_COLORS.length) : colorIndex;
    return linear(PAINT_COLORS[index].hex);
  }
  function refreshColorUi() {
    if (colorIndex < 0) {
      hudDot.style.background = 'conic-gradient(#d62839, #d9480f, #15803d, #1d4ed8, #7e22ce, #d62839)';
      hudColorName.textContent = 'Couleur : au hasard';
    } else {
      hudDot.style.background = PAINT_COLORS[colorIndex].hex;
      hudColorName.textContent = `Couleur : ${PAINT_COLORS[colorIndex].name}`;
    }
  }
  function refreshKeysUi() {
    const kb = ctx.getKeybinds?.() || {};
    const label = ctx.keyLabel || ((c) => c);
    hudKeys.textContent = `1-5 armes · ${label(kb.grenadeFrag || 'KeyG')} grenade · X couleur · ${label(kb.pickupWeapon || 'KeyE')} terminal`;
  }

  function say(text, ms = 5000) {
    banner.textContent = text;
    banner.style.opacity = '1';
    clearTimeout(say.timer);
    say.timer = setTimeout(() => { banner.style.opacity = '0'; }, ms);
  }

  // ---------------------------------------------------------------- écran du terminal
  function drawScreen(state, text = '') {
    const c = screenCanvas.getContext('2d');
    const palette = { idle: ['#06140e', '#7dffb3'], ok: ['#062a14', '#7dff8f'], error: ['#2a0808', '#ff6b6b'] }[state] || ['#06140e', '#7dffb3'];
    c.fillStyle = palette[0];
    c.fillRect(0, 0, 256, 160);
    c.fillStyle = palette[1];
    c.font = '700 15px ui-monospace, Consolas, monospace';
    c.textAlign = 'center';
    c.fillText(state === 'ok' ? 'ACCES ACCORDE' : state === 'error' ? 'CODE INCORRECT' : 'TERMINAL', 128, 34);
    c.font = '700 44px ui-monospace, Consolas, monospace';
    const shown = text || '';
    c.fillText(shown.padEnd(PAINT_EGG.code.length, '_').split('').join(' '), 128, 98);
    c.font = '12px ui-monospace, Consolas, monospace';
    c.globalAlpha = 0.7;
    c.fillText(`CODE A ${PAINT_EGG.code.length} CHIFFRES`, 128, 140);
    c.globalAlpha = 1;
    screenTexture.needsUpdate = true;
  }
  drawScreen('idle');

  function renderTerminalUi(message = '', kind = '') {
    ptCode.textContent = typed.padEnd(PAINT_EGG.code.length, '•').split('').join(' ');
    ptMsg.textContent = message;
    ptMsg.className = `pt-msg ${kind}`;
  }

  function openTerminal() {
    terminalOpen = true;
    typed = '';
    terminalUi.style.display = 'flex';
    renderTerminalUi(solved ? 'Accès déjà accordé.' : '');
    drawScreen(solved ? 'ok' : 'idle', solved ? PAINT_EGG.code : '');
    prompt.style.display = 'none';
  }
  function closeTerminal() {
    terminalOpen = false;
    terminalUi.style.display = 'none';
    drawScreen(solved ? 'ok' : 'idle', solved ? PAINT_EGG.code : '');
  }
  function submitCode() {
    if (typed.length < PAINT_EGG.code.length) {
      renderTerminalUi(`Il faut ${PAINT_EGG.code.length} chiffres.`, 'err');
      return;
    }
    if (typed === PAINT_EGG.code) {
      solved = true;
      try { localStorage.setItem(PAINT_EGG.solvedKey, '1'); } catch { /* stockage indisponible */ }
      renderTerminalUi('ACCÈS ACCORDÉ', 'ok');
      drawScreen('ok', typed);
      setTimeout(closeTerminal, 1400);
      celebrate = 3.2;
      say('Code validé — tu as percé le secret de la salle !', 7000);
      ctx.hudFx?.showAnnouncement?.('Code validé — bravo !', null, false);
      ctx.onSolved?.();
    } else {
      renderTerminalUi('CODE INCORRECT', 'err');
      drawScreen('error', typed);
      typed = '';
      setTimeout(() => { if (terminalOpen && !solved) { renderTerminalUi(''); drawScreen('idle'); } }, 1200);
    }
  }

  // ---------------------------------------------------------------- peinture
  function addSplat(point, normal, radius, color, seed = Math.random()) {
    atlas.addSplat({ point: point.clone(), normal: normal.clone().normalize(), radius, color, seed, reveal: true });
  }

  /** Un impact de balle (appelé par tryShoot dans main.js, une fois par plomb). */
  function onShot({ point, normal, def }) {
    if (!active || !point || !normal) return;
    addSplat(point, normal, paintRadiusFor(def), currentColor());
  }

  // Directions régulièrement réparties sur une sphère (spirale de Fibonacci).
  function sphereDirections(n) {
    const out = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = golden * i;
      out.push(new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r));
    }
    return out;
  }
  function burst(position, { rays, range, minRadius, maxRadius, baseColor }) {
    const base = baseColor || currentColor();
    sphereDirections(rays).forEach((dir) => {
      const hit = collisionWorld.raycastFirst(position.x, position.y, position.z, dir.x, dir.y, dir.z, range);
      if (!hit || !hit.normal) return;
      const n = hit.normal.clone();
      if (n.dot(dir) > 0) n.negate(); // face tournée vers l'explosion
      // une petite variation de teinte d'un rond à l'autre
      const color = base.clone().offsetHSL((Math.random() - 0.5) * 0.08, 0, (Math.random() - 0.5) * 0.06);
      const falloff = 1 - 0.45 * (hit.distance / range); // plus gros près de l'explosion
      addSplat(hit.point, n, THREE.MathUtils.lerp(minRadius, maxRadius, Math.random()) * falloff, color);
    });
  }

  /** Explosion d'une grenade (appelé par main.js quand la grenade éclate). */
  function onGrenadeExploded(position, kind = 'frag') {
    if (!active || kind !== 'frag') return;
    const origin = new THREE.Vector3(position.x, position.y + 0.3, position.z);
    burst(origin, PAINT_EGG.grenade);
  }

  // ---------------------------------------------------------------- clavier
  function typeDigit(char) {
    if (typed.length >= PAINT_EGG.code.length) return;
    typed += char;
    renderTerminalUi('');
    drawScreen('idle', typed);
  }
  function onKeyDown(e) {
    if (!active) return;
    const keybinds = ctx.getKeybinds?.() || {};
    if (terminalOpen) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      const digit = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
      if (digit) typeDigit(digit[1]);
      else if (e.code === 'Backspace') { typed = typed.slice(0, -1); renderTerminalUi(''); drawScreen('idle', typed); }
      else if (e.code === 'Enter' || e.code === 'NumpadEnter') submitCode();
      else if (e.code === 'Escape' || e.code === keybinds.pickupWeapon) closeTerminal();
      return;
    }
    if (e.code === keybinds.pickupWeapon && nearTerminal && !e.repeat) {
      e.preventDefault();
      e.stopImmediatePropagation();
      openTerminal();
      return;
    }
    const weaponKey = /^Digit([1-5])$/.exec(e.code);
    if (weaponKey && !e.repeat) {
      e.stopImmediatePropagation();
      hooks.setWeapon(['pistol', 'smg', 'rifle', 'shotgun', 'sniper'][Number(weaponKey[1]) - 1]);
      return;
    }
    if (e.code === 'KeyX' && !e.repeat) {
      colorIndex = colorIndex + 1 >= PAINT_COLORS.length ? -1 : colorIndex + 1;
      refreshColorUi();
    }
  }
  window.addEventListener('keydown', onKeyDown, true);

  // ---------------------------------------------------------------- entrée dans la salle
  function enter() {
    if (active) return;
    // « téléportation » : flash blanc, on change de décor pendant qu'il cache tout
    flash.textContent = 'TÉLÉPORTATION';
    flash.style.transition = 'opacity 0.35s ease';
    flash.style.opacity = '1';
    setTimeout(() => {
      hooks.hideWorld();
      scene.add(group);
      hooks.setCollision(collisionWorld);
      hooks.setGround([room.mesh]);
      hooks.placePlayer(ROOM.spawn);
      hooks.setWeapon('smg');
      hooks.giveGrenades?.();
      ctx.ambiance?.setPhaseOverride?.(0.3);
      document.body.classList.add('paint-room');
      hud.hidden = false;
      refreshColorUi();
      refreshKeysUi();
      active = true;
      flash.style.transition = 'opacity 1.1s ease';
      flash.style.opacity = '0';
      say('Salle de peinture — peins tout ! Un mur cache un code…', 7000);
    }, 420);
  }

  // ---------------------------------------------------------------- mise à jour (chaque image)
  function update(delta) {
    if (!active) return;
    atlas.flush(48);

    // terminal : à portée et dans le regard ?
    camera.getWorldDirection(_forward);
    _toTerminal.subVectors(terminalCenter, camera.position);
    const distance = _toTerminal.length();
    nearTerminal = distance < 3.2 && _toTerminal.normalize().dot(_forward) > 0.55;
    if (!terminalOpen) {
      const kb = ctx.getKeybinds?.() || {};
      prompt.textContent = `${(ctx.keyLabel || ((c) => c))(kb.pickupWeapon || 'KeyE')} — Utiliser le terminal`;
      prompt.style.display = nearTerminal ? 'block' : 'none';
    }

    // pourcentage de salle peinte
    hudTimer += delta;
    if (hudTimer > 0.25) {
      hudTimer = 0;
      const percent = Math.min(100, atlas.coverage() * 100);
      hudCoverage.textContent = `Salle peinte : ${percent < 10 ? percent.toFixed(1) : Math.round(percent)} %`;
      hudBarFill.style.width = `${percent}%`;
      if (!announcedFull && atlas.coverage() >= PAINT_EGG.fullThreshold) {
        announcedFull = true;
        say('La salle est entièrement peinte ! Magnifique.', 7000);
      }
    }

    // célébration : une pluie de taches un peu partout
    if (celebrate > 0) {
      celebrate -= delta;
      if (Math.random() < delta * 14) {
        const p = new THREE.Vector3((Math.random() - 0.5) * 36, 2 + Math.random() * 8, (Math.random() - 0.5) * 36);
        burst(p, { rays: 14, range: 12, minRadius: 0.7, maxRadius: 1.3, baseColor: linear(PAINT_COLORS[Math.floor(Math.random() * PAINT_COLORS.length)].hex) });
      }
    }
  }

  refreshColorUi();

  return {
    enter,
    update,
    onShot,
    onGrenadeExploded,
    isActive: () => active,
    isTerminalOpen: () => terminalOpen,
    coverage: () => atlas.coverage(),
    group,
    room,
    atlas,
    collisionWorld,
    code: PAINT_EGG.code,
    // pour les tests / le débogage
    debug: { addSplat, burst, openTerminal, closeTerminal, typeDigit, submitCode, getTyped: () => typed, isSolved: () => solved, setActive: (v) => { active = v; } },
  };
}
