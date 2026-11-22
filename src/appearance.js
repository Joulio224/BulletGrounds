import * as THREE from 'three';
import { createCharacterModel } from './character-model.js';

// ---------------------------------------------------------------------------
// Personnalisation du personnage.
//
// Un soldat 3D réaliste (voir character-model.js) dont on choisit :
//   - la couleur du HAUT (t-shirt, manches, gilet) et du BAS (pantalon) ;
//   - la TÊTE : teint, coiffure, couleur des cheveux, couvre-chef et sa couleur.
// Dans le lobby, on clique directement sur la partie du personnage à modifier.
//
// Compatibilité : les anciens skins ({ bodyColor, face }) restent lisibles —
// bodyColor devient la couleur du haut. On continue d'envoyer bodyColor (= haut)
// et face (emoji, plus affiché) pour que le serveur, le ping d'équipe et la
// minimap, qui lisent bodyColor, continuent de fonctionner.
// ---------------------------------------------------------------------------

// Ancienne liste d'emojis : plus affichée, mais le serveur la valide encore.
// Doit rester identique à EMOJI_FACES dans mini-warzone-server/server.js.
export const EMOJI_FACES = ['😀', '😎', '😡', '😱', '🤖', '👽', '💀', '🥶', '🤠', '🤡', '😈', '🥵'];

// Listes de choix — doivent rester identiques dans mini-warzone-server/server.js :
// le serveur rejette toute valeur hors liste (un client modifié ne peut rien injecter).
export const HAIR_STYLES = [
  { id: 'court', label: 'Court' },
  { id: 'rase', label: 'Rasé' },
  { id: 'long', label: 'Long' },
  { id: 'crete', label: 'Crête' },
  { id: 'chauve', label: 'Chauve' },
];
export const HEADGEARS = [
  { id: 'none', label: 'Aucun' },
  { id: 'casquette', label: 'Casquette' },
  { id: 'bonnet', label: 'Bonnet' },
  { id: 'casque', label: 'Casque' },
];
const HAIR_IDS = HAIR_STYLES.map((h) => h.id);
const HEADGEAR_IDS = HEADGEARS.map((h) => h.id);

// Palettes proposées (on peut aussi choisir n'importe quelle couleur).
export const SKIN_TONES = ['#f6d5b8', '#f1c9a5', '#e0ac82', '#c68a5f', '#a06a44', '#7a4a2e', '#4f2f1d'];
export const HAIR_COLORS = ['#1c1410', '#3a2a1e', '#6b4a2e', '#b5321f', '#caa05a', '#e8d9a8', '#8a8d92', '#d63f6e', '#2f6fd6'];
export const TOP_COLORS = ['#4b5d3a', '#1d1f22', '#6b7078', '#b8a67a', '#243a5e', '#8a2f2f', '#d9d4c5', '#c8641e', '#5a1f2b', '#5f8a4a', '#4f86c6', '#d4b53a'];
export const BOTTOM_COLORS = ['#1c1d20', '#3b3f46', '#2d3a5a', '#6b6045', '#3f4a30', '#9c8b6b', '#5b4a32', '#7b7f86', '#2f4f8a'];
export const HEADGEAR_COLORS = ['#4b5320', '#1d1f22', '#6b7078', '#b8a67a', '#1f3a7a', '#8a2f2f', '#d9d4c5', '#c8641e'];

const STORAGE_KEY = 'mw_appearance';
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const hex = (...values) => values.find((v) => typeof v === 'string' && HEX_COLOR_RE.test(v));

export function sanitizeAppearance(input) {
  const fallback = {
    topColor: '#4b5d3a',
    bottomColor: '#3b3f46',
    skin: '#e0ac82',
    hair: 'court',
    hairColor: '#3a2a1e',
    headgear: 'none',
    headgearColor: '#4b5320',
  };
  const topColor = hex(input?.topColor, input?.bodyColor) ?? fallback.topColor; // bodyColor = ancien skin
  return {
    bodyColor: topColor, // compatibilité (ping d'équipe, minimap, anciens clients)
    face: EMOJI_FACES[0], // compatibilité : le serveur exige un emoji de sa liste
    topColor,
    bottomColor: hex(input?.bottomColor) ?? fallback.bottomColor,
    skin: hex(input?.skin) ?? fallback.skin,
    hair: HAIR_IDS.includes(input?.hair) ? input.hair : fallback.hair,
    hairColor: hex(input?.hairColor) ?? fallback.hairColor,
    headgear: HEADGEAR_IDS.includes(input?.headgear) ? input.headgear : fallback.headgear,
    headgearColor: hex(input?.headgearColor) ?? fallback.headgearColor,
  };
}

// Skin par défaut (défini après sanitizeAppearance et ses constantes).
export const DEFAULT_APPEARANCE = sanitizeAppearance({});

export function getAppearance() {
  try {
    return sanitizeAppearance(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function setAppearance(partial) {
  const merged = sanitizeAppearance({ ...getAppearance(), ...partial });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  return merged;
}

// Ancien visage emoji (plus utilisé en jeu) — conservé pour ne casser aucun import.
const textureCache = new Map();
export function getEmojiTexture(emoji) {
  const cached = textureCache.get(emoji);
  if (cached) return cached;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.font = `${Math.round(size * 0.78)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, size / 2, size / 2 + size * 0.04);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(emoji, texture);
  return texture;
}

// ---------------------------------------------------------------------------
// Petit perso en HTML/CSS (accueil du lobby, membres du groupe) — même
// couleurs que le modèle 3D. Passe toujours par sanitizeAppearance : même une
// apparence lue chez un autre joueur reste sûre à afficher.
// ---------------------------------------------------------------------------
export function createCharacterElement(appearance) {
  const el = document.createElement('div');
  el.className = 'character';

  const head = document.createElement('div');
  head.className = 'character-head';
  const hair = document.createElement('div');
  hair.className = 'character-hair';
  const hat = document.createElement('div');
  hat.className = 'character-hat';
  const face = document.createElement('div');
  face.className = 'character-face';
  head.append(hair, hat, face);

  const body = document.createElement('div');
  body.className = 'character-body';
  const top = document.createElement('div');
  top.className = 'character-top';
  const bottom = document.createElement('div');
  bottom.className = 'character-bottom';
  body.append(top, bottom);

  el.append(head, body);
  applyCharacterAppearance(el, appearance);
  return el;
}

export function applyCharacterAppearance(el, appearance) {
  const safe = sanitizeAppearance(appearance);
  el.querySelector('.character-head').style.background = safe.skin;
  const hair = el.querySelector('.character-hair');
  hair.style.background = safe.hair === 'rase' || safe.hair === 'crete'
    ? `color-mix(in srgb, ${safe.hairColor} 45%, ${safe.skin})`
    : safe.hairColor;
  hair.dataset.style = safe.hair;
  const hat = el.querySelector('.character-hat');
  hat.style.background = safe.headgearColor;
  hat.dataset.style = safe.headgear;
  el.querySelector('.character-top').style.background = safe.topColor;
  el.querySelector('.character-bottom').style.background = safe.bottomColor;
}

// Avatar rond des membres du groupe : buste (haut/bas) + petite tête.
export function fillMemberAvatar(avatar, appearance) {
  const safe = sanitizeAppearance(appearance);
  avatar.style.background = `linear-gradient(to bottom, ${safe.topColor} 0 58%, ${safe.bottomColor} 58% 100%)`;
  avatar.innerHTML = '';
  const head = document.createElement('span');
  head.className = 'member-head';
  head.style.background = safe.skin;
  const hair = document.createElement('span');
  hair.className = 'member-hair';
  hair.dataset.style = safe.hair;
  hair.style.background = safe.hairColor;
  const hat = document.createElement('span');
  hat.className = 'member-hat';
  hat.dataset.style = safe.headgear;
  hat.style.background = safe.headgearColor;
  head.append(hair, hat);
  avatar.appendChild(head);
}

// ---------------------------------------------------------------------------
// Aperçu 3D du lobby : le personnage tourne doucement, se fait tourner en
// glissant, et un clic sur le haut / le bas / la tête sélectionne la partie.
// ---------------------------------------------------------------------------
const PART_TO_TAB = { top: 'top', bottom: 'bottom', head: 'head', hair: 'head', headgear: 'head' };
const PREVIEW_W = 270;
const PREVIEW_H = 400;
// Cadrage de la caméra selon la partie sélectionnée.
const FRAMING = {
  full: { y: 0.93, dist: 4.5 },
  top: { y: 1.22, dist: 3.0 },
  bottom: { y: 0.5, dist: 3.4 },
  head: { y: 1.6, dist: 1.9 },
};

function createPreview(container, { onPick }) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return null; // pas de WebGL : on retombe sur le perso CSS
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(PREVIEW_W, PREVIEW_H);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.className = 'appearance-canvas';
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, PREVIEW_W / PREVIEW_H, 0.1, 50);
  scene.add(new THREE.HemisphereLight(0xdbe8ff, 0x3b3530, 1.25));
  const key = new THREE.DirectionalLight(0xfff0dc, 2.6);
  key.position.set(2.2, 4, 3.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -1.5, right: 1.5, top: 2.5, bottom: -0.5, near: 1, far: 12 });
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fb4ff, 1.4);
  rim.position.set(-3, 2.5, -2.5);
  scene.add(rim);

  // petit socle sous les pieds
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(0.75, 40),
    new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.95 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const pivot = new THREE.Group(); // tourne autour de l'axe vertical
  pivot.rotation.y = Math.PI + 0.45; // le perso regarde -Z : on le retourne face à la caméra, en 3/4
  scene.add(pivot);

  let model = null;
  function rebuild(appearance) {
    if (model) {
      pivot.remove(model.group);
      model.dispose();
    }
    model = createCharacterModel(appearance);
    model.group.traverse((c) => {
      if (c.isMesh) c.receiveShadow = true;
    });
    pivot.add(model.group);
  }

  // cadrage animé
  const view = { ...FRAMING.full };
  let target = FRAMING.full;
  function focus(tab) {
    target = FRAMING[tab] || FRAMING.full;
  }

  // interactions : glisser = tourner, clic = choisir une partie, survol = surbrillance
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let dragging = false;
  let moved = 0;
  let lastX = 0;
  let lastInteraction = -10;
  let hoveredPart = null;

  function partAt(event) {
    if (!model) return null;
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(model.pickables, false)[0];
    return hit ? hit.object.userData.part : null;
  }

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    moved = 0;
    lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging) {
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      moved += Math.abs(dx);
      pivot.rotation.y += dx * 0.012;
      lastInteraction = performance.now() / 1000;
      return;
    }
    const part = partAt(e);
    if (part !== hoveredPart) {
      hoveredPart = part;
      if (model) model.setHighlight(part);
      canvas.style.cursor = part ? 'pointer' : 'grab';
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    const wasClick = dragging && moved < 5;
    dragging = false;
    if (wasClick) {
      const part = partAt(e);
      if (part) onPick(PART_TO_TAB[part], part);
    }
  });
  canvas.addEventListener('pointerleave', () => {
    if (hoveredPart && model) model.setHighlight(null);
    hoveredPart = null;
  });
  canvas.style.cursor = 'grab';

  // boucle de rendu : ne dessine que si l'onglet Apparence est visible
  const clock = new THREE.Clock();
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    if (!canvas.isConnected || canvas.offsetParent === null) return;
    const now = performance.now() / 1000;
    if (!dragging && now - lastInteraction > 2.5 && !hoveredPart) pivot.rotation.y += dt * 0.35;
    view.y += (target.y - view.y) * Math.min(1, dt * 6);
    view.dist += (target.dist - view.dist) * Math.min(1, dt * 6);
    camera.position.set(0, view.y + 0.1, view.dist);
    camera.lookAt(0, view.y, 0);
    if (model) model.update(dt, 0);
    renderer.render(scene, camera);
  }
  frame();

  return { rebuild, focus, canvas };
}

// ---------------------------------------------------------------------------
// UI du sélecteur (branchée dans le lobby, voir index.html + lobby.js)
// ---------------------------------------------------------------------------
// onChange(appearance) est appelé à chaque modification (lobby.js s'en sert
// pour republier le skin et rafraîchir l'accueil).
export function initAppearancePicker({ onChange } = {}) {
  const controls = document.getElementById('appearance-controls');
  const previewSlot = document.getElementById('appearance-preview');
  if (!controls) return; // markup absent (ex. tests)

  let current = getAppearance();
  let activeTab = 'top';
  let preview = null;
  let fallbackCharacter = null;

  function commit(partial) {
    current = setAppearance(partial);
    if (preview) preview.rebuild(current);
    if (fallbackCharacter) applyCharacterAppearance(fallbackCharacter, current);
    if (onChange) onChange(current);
  }

  let focusedTab = null; // partie cadrée de près (null = personnage entier)
  function selectTab(tab) {
    // un second clic sur la partie déjà cadrée revient à la vue d'ensemble
    const zoomOut = tab === activeTab && focusedTab === tab;
    activeTab = tab;
    focusedTab = zoomOut ? null : tab;
    if (preview) preview.focus(focusedTab || 'full');
    renderControls();
  }

  // --- aperçu 3D (ou perso CSS si WebGL indisponible)
  if (previewSlot) {
    previewSlot.innerHTML = '';
    preview = createPreview(previewSlot, { onPick: (tab) => selectTab(tab) });
    if (preview) {
      preview.rebuild(current);
    } else {
      fallbackCharacter = createCharacterElement(current);
      previewSlot.appendChild(fallbackCharacter);
    }
  }

  // --- éléments d'interface
  function swatches(colors, selected, onPick) {
    const grid = document.createElement('div');
    grid.className = 'swatch-grid';
    colors.forEach((color) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.style.background = color;
      button.title = color;
      button.setAttribute('aria-label', `Couleur ${color}`);
      button.classList.toggle('selected', color.toLowerCase() === String(selected).toLowerCase());
      button.addEventListener('click', () => onPick(color));
      grid.appendChild(button);
    });
    return grid;
  }
  function customColor(selected, onInput) {
    const label = document.createElement('label');
    label.className = 'appearance-color-label';
    label.append('Autre couleur');
    const input = document.createElement('input');
    input.type = 'color';
    input.value = selected;
    input.className = 'appearance-color-input';
    input.addEventListener('input', () => onInput(input.value));
    label.appendChild(input);
    return label;
  }
  function choices(options, selected, onPick) {
    const row = document.createElement('div');
    row.className = 'ap-choice-row';
    options.forEach(({ id, label }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ap-choice';
      button.textContent = label;
      button.classList.toggle('selected', id === selected);
      button.addEventListener('click', () => onPick(id));
      row.appendChild(button);
    });
    return row;
  }
  function section(title, ...children) {
    const wrap = document.createElement('div');
    wrap.className = 'ap-section';
    const heading = document.createElement('div');
    heading.className = 'ap-section-title';
    heading.textContent = title;
    wrap.append(heading, ...children);
    return wrap;
  }

  function renderControls() {
    controls.innerHTML = '';

    const tabs = document.createElement('div');
    tabs.className = 'ap-tabs';
    [['top', 'Haut'], ['bottom', 'Bas'], ['head', 'Tête']].forEach(([id, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ap-tab';
      button.textContent = label;
      button.classList.toggle('active', id === activeTab);
      button.addEventListener('click', () => selectTab(id));
      tabs.appendChild(button);
    });
    controls.appendChild(tabs);

    const hint = document.createElement('div');
    hint.className = 'ap-hint';
    hint.textContent = 'Astuce : clique directement sur le haut, le bas ou la tête du personnage. Glisse pour le faire tourner.';
    controls.appendChild(hint);

    if (activeTab === 'top') {
      controls.appendChild(section(
        'Couleur du haut (t-shirt, manches, gilet)',
        swatches(TOP_COLORS, current.topColor, (color) => { commit({ topColor: color }); renderControls(); }),
        customColor(current.topColor, (color) => commit({ topColor: color }))
      ));
      const note = document.createElement('div');
      note.className = 'ap-hint';
      note.textContent = 'En mode Équipes, le haut prend la couleur de ton équipe pendant la partie.';
      controls.appendChild(note);
    } else if (activeTab === 'bottom') {
      controls.appendChild(section(
        'Couleur du bas (pantalon)',
        swatches(BOTTOM_COLORS, current.bottomColor, (color) => { commit({ bottomColor: color }); renderControls(); }),
        customColor(current.bottomColor, (color) => commit({ bottomColor: color }))
      ));
    } else {
      controls.appendChild(section('Teint',
        swatches(SKIN_TONES, current.skin, (color) => { commit({ skin: color }); renderControls(); })));
      controls.appendChild(section('Coiffure',
        choices(HAIR_STYLES, current.hair, (id) => { commit({ hair: id }); renderControls(); })));
      if (current.hair !== 'chauve') {
        controls.appendChild(section('Couleur des cheveux',
          swatches(HAIR_COLORS, current.hairColor, (color) => { commit({ hairColor: color }); renderControls(); }),
          customColor(current.hairColor, (color) => commit({ hairColor: color }))));
      }
      controls.appendChild(section('Couvre-chef',
        choices(HEADGEARS, current.headgear, (id) => { commit({ headgear: id }); renderControls(); })));
      if (current.headgear !== 'none') {
        controls.appendChild(section('Couleur du couvre-chef',
          swatches(HEADGEAR_COLORS, current.headgearColor, (color) => { commit({ headgearColor: color }); renderControls(); }),
          customColor(current.headgearColor, (color) => commit({ headgearColor: color }))));
      }
    }
  }

  renderControls();
}
