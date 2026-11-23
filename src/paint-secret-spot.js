// ---------------------------------------------------------------------------
// Easter egg « salle de peinture » — la porte secrète dans la VRAIE carte.
//
// Une grosse éclaboussure de peinture multicolore est « tagguée » sur un mur
// discret de la carte (voir PAINT_EGG.secretSpot). Il suffit de tirer dessus
// plusieurs fois de suite pour être téléporté dans la salle de peinture.
//
// C'est un simple décor côté client : le serveur ne sait rien de tout ça, les
// autres joueurs voient juste un graffiti. Seul celui qui tire dessus est téléporté.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

const SPLASH_COLORS = ['#d62839', '#1d4ed8', '#15803d', '#7e22ce', '#d9480f', '#0f766e', '#be185d'];

// Petit générateur pseudo-aléatoire : la même éclaboussure à chaque fois.
function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function createSplashTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rand = seededRandom(20261121);
  const c = size / 2;

  // la tache centrale : plusieurs cercles de couleurs qui se recouvrent
  for (let layer = 0; layer < 5; layer++) {
    ctx.fillStyle = SPLASH_COLORS[Math.floor(rand() * SPLASH_COLORS.length)];
    for (let i = 0; i < 7; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = rand() * (95 - layer * 12);
      const r = 40 + rand() * (62 - layer * 6);
      ctx.beginPath();
      ctx.arc(c + Math.cos(angle) * dist, c + Math.sin(angle) * dist, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // gouttes projetées tout autour
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = SPLASH_COLORS[Math.floor(rand() * SPLASH_COLORS.length)];
    const angle = rand() * Math.PI * 2;
    const dist = 130 + rand() * 105;
    const r = 4 + rand() * 15;
    ctx.beginPath();
    ctx.arc(c + Math.cos(angle) * dist, c + Math.sin(angle) * dist, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // coulures vers le bas
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = SPLASH_COLORS[Math.floor(rand() * SPLASH_COLORS.length)];
    const x = c - 90 + rand() * 180;
    const len = 50 + rand() * 120;
    const w = 7 + rand() * 9;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, c + 30, w, len, w / 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, c + 30 + len, w * 0.85, 0, Math.PI * 2);
    ctx.fill();
  }
  // léger reflet humide
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(c - 40, c - 50, 60, 30, -0.6, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * @param config  { position: [x,y,z], normal: [x,y,z], size, hitsNeeded, windowSeconds, radius }
 * @param onTriggered  appelé une seule fois, quand assez de tirs ont touché la tache
 */
export function createPaintSecretSpot({ scene, config, onTriggered }) {
  const position = new THREE.Vector3(...config.position);
  const normal = new THREE.Vector3(...config.normal).normalize();

  const splashTexture = createSplashTexture();
  const material = new THREE.MeshStandardMaterial({
    map: splashTexture,
    // une légère lueur : la tache reste repérable même dans l'ombre du couloir
    emissive: 0xffffff,
    emissiveMap: splashTexture,
    emissiveIntensity: 0.45,
    transparent: true,
    alphaTest: 0.04,
    roughness: 0.8,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(config.size, config.size), material);
  mesh.position.copy(position).addScaledVector(normal, 0.02); // 2 cm devant le mur
  mesh.lookAt(position.clone().add(normal));
  mesh.name = 'paint-secret-spot';
  scene.add(mesh);

  let hits = 0;
  let lastHitAt = -Infinity;
  let triggered = false;

  /** À appeler pour chaque impact de tir sur un mur ou le sol (point = position monde de l'impact). */
  function onShot(point) {
    if (triggered || !mesh.visible || !point) return;
    if (point.distanceTo(position) > config.radius) return;
    const now = performance.now() / 1000;
    hits = now - lastHitAt > config.windowSeconds ? 1 : hits + 1;
    lastHitAt = now;
    // petite pulsation pour montrer que ça réagit
    mesh.scale.setScalar(1.1);
    setTimeout(() => mesh.scale.setScalar(1), 120);
    if (hits >= config.hitsNeeded) {
      triggered = true;
      onTriggered();
    }
  }

  return {
    mesh,
    onShot,
    setVisible(visible) {
      mesh.visible = visible;
    },
    reset() {
      hits = 0;
      triggered = false;
    },
    // pour les tests
    getHits: () => hits,
  };
}
