// ---------------------------------------------------------------------------
// Personnage 3D réaliste (soldat), construit en code : aucun fichier à charger.
//
// Utilisé à deux endroits avec le MÊME modèle :
//   - en jeu, pour les autres joueurs (main.js) ;
//   - dans l'aperçu 3D du lobby (appearance.js), où l'on clique sur le haut, le
//     bas ou la tête pour les personnaliser.
//
// Repère : pieds à y = 0, le personnage regarde vers -Z (comme la caméra du
// jeu), sa droite est +X. Taille ~1,80 m ; les sphères de touche du serveur
// (jambes / torse / tête, voir BODY_SPHERES dans main.js) restent valables.
//
// Chaque mesh "cliquable" porte userData.part :
//   'top' (haut : t-shirt, manches, gilet), 'bottom' (bas : pantalon),
//   'head' (peau), 'hair' (cheveux), 'headgear' (casquette / bonnet / casque).
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;

// ------------------------------------------------------------------ géométries partagées
// Créées une fois et réutilisées par tous les joueurs (les matériaux, eux, sont
// propres à chaque joueur : couleurs différentes). main.js ne détruit donc pas
// ces géométries quand un joueur part (userData.sharedMaterial sur chaque mesh).
const geometryCache = new Map();
function geo(key, factory) {
  let g = geometryCache.get(key);
  if (!g) {
    g = factory();
    geometryCache.set(key, g);
  }
  return g;
}
// Cylindre qui part de l'articulation (y = 0) et descend vers -Y.
function limbGeometry(rTop, rBottom, length, segments = 12) {
  return geo(`limb:${rTop}:${rBottom}:${length}`, () => {
    const g = new THREE.CylinderGeometry(rTop, rBottom, length, segments, 1);
    g.translate(0, -length / 2, 0);
    return g;
  });
}
function boxGeometry(w, h, d) {
  return geo(`box:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));
}
function sphereGeometry(r = 1, w = 16, h = 12) {
  return geo(`sphere:${r}:${w}:${h}`, () => new THREE.SphereGeometry(r, w, h));
}
// Calotte de sphère (haut d'un crâne) : thetaLength = fraction de sphère couverte.
function capGeometry(thetaLength, w = 20, h = 12) {
  return geo(`cap:${thetaLength}:${w}:${h}`, () => new THREE.SphereGeometry(1, w, h, 0, TAU, 0, thetaLength));
}

// Petite texture de bruit (une seule pour tous) : donne un grain de tissu aux vêtements.
let fabricBump = null;
function getFabricBump() {
  if (fabricBump || typeof document === 'undefined') return fabricBump;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const x = i % size;
    const y = Math.floor(i / size);
    // trame de tissu : fils horizontaux/verticaux + un peu de hasard
    const weave = ((x % 4 < 2) ^ (y % 4 < 2)) ? 150 : 110;
    const v = Math.max(0, Math.min(255, weave + (Math.random() - 0.5) * 60));
    image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = v;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  fabricBump = new THREE.CanvasTexture(canvas);
  fabricBump.wrapS = fabricBump.wrapT = THREE.RepeatWrapping;
  fabricBump.repeat.set(4, 4);
  return fabricBump;
}

// ------------------------------------------------------------------ IK à deux segments
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
// Position du coude (3D) : épaule S, main T, longueurs l1/l2, `pole` = direction vers laquelle le coude "pointe".
function solveElbow(S, T, l1, l2, pole, out = new THREE.Vector3()) {
  const toTarget = _a.subVectors(T, S);
  let d = toTarget.length();
  d = Math.min(Math.max(d, Math.abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4);
  const dir = toTarget.normalize();
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const height = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const side = _b.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (side.lengthSq() < 1e-8) side.set(0, -1, 0);
  side.normalize();
  return out.copy(S).addScaledVector(dir, along).addScaledVector(side, height);
}

// Jambe dans le plan sagittal (Y,Z) : renvoie les angles de rotation autour de X
// de la cuisse et du tibia (positif = vers l'avant, -Z).
function solveLegAngles(hipY, footY, footZ, l1, l2) {
  const vy = footY - hipY;
  const vz = footZ;
  let d = Math.hypot(vy, vz);
  d = Math.min(Math.max(d, Math.abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4);
  const toFoot = Math.atan2(-vz, -vy);
  const alpha = Math.acos(THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const thigh = toFoot + alpha; // genou vers l'avant
  const kneeY = hipY + l1 * -Math.cos(thigh);
  const kneeZ = l1 * -Math.sin(thigh);
  const shin = Math.atan2(-(footZ - kneeZ), -(footY - kneeY));
  return { thigh, shin };
}

// ------------------------------------------------------------------ modèle
const THIGH = 0.43;
const SHIN = 0.38;
const HIP_Y = 0.93;
const UPPER_ARM = 0.29;
const FOREARM = 0.27;

const BOOT_COLOR = 0x23201d;
const GLOVE_COLOR = 0x1f2124;
const METAL_COLOR = 0x1c1e21;
const POLYMER_COLOR = 0x2d3135;

function std(color, roughness = 0.85, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}
function cloth(color) {
  const m = std(color, 0.92, 0);
  const bump = getFabricBump();
  if (bump) {
    m.bumpMap = bump;
    m.bumpScale = 0.8;
  }
  return m;
}
function darker(color, factor) {
  return new THREE.Color(color).multiplyScalar(factor);
}

/**
 * @param appearance  { topColor, bottomColor, skin, hair, hairColor, headgear, headgearColor }
 * @param options.topColor  couleur du haut imposée (ex. couleur d'équipe en mode Équipes)
 * @param options.armed     fusil dans les mains (true par défaut)
 */
export function createCharacterModel(appearance, options = {}) {
  const topColor = new THREE.Color(options.topColor ?? appearance.topColor);
  const bottomColor = new THREE.Color(appearance.bottomColor);
  const skinColor = new THREE.Color(appearance.skin);
  const hairColor = new THREE.Color(appearance.hairColor);
  const headgearColor = new THREE.Color(appearance.headgearColor);

  // matériaux (un jeu par personnage)
  const materials = {
    top: cloth(topColor),
    vest: cloth(darker(topColor, 0.5)),
    bottom: cloth(bottomColor),
    bottomDetail: cloth(darker(bottomColor, 0.78)),
    skin: std(skinColor, 0.62),
    skinDark: std(darker(skinColor, 0.82), 0.62),
    hair: std(hairColor, 0.55),
    stubble: std(new THREE.Color(hairColor).lerp(skinColor, 0.6), 0.7),
    headgear: cloth(headgearColor),
    headgearDark: cloth(darker(headgearColor, 0.7)),
    boot: std(BOOT_COLOR, 0.75),
    glove: std(GLOVE_COLOR, 0.7),
    belt: std(0x1a1a1a, 0.6),
    metal: std(METAL_COLOR, 0.45, 0.6),
    polymer: std(POLYMER_COLOR, 0.6, 0.1),
    white: std(0xf1f1ee, 0.4),
    iris: std(0x2b1d14, 0.3),
    lips: std(darker(skinColor, 0.7).lerp(new THREE.Color(0xb05a55), 0.35), 0.5),
  };

  const group = new THREE.Group();
  const pickables = [];
  const NO_SHADOW = new Set([materials.white, materials.iris, materials.lips]);
  const partMaterials = { top: [materials.top, materials.vest], bottom: [materials.bottom, materials.bottomDetail], head: [materials.skin, materials.skinDark], hair: [materials.hair, materials.stubble], headgear: [materials.headgear, materials.headgearDark] };

  function mesh(parent, geometry, material, { x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0, part = null, shadow = true } = {}) {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.rotation.set(rx, ry, rz);
    m.castShadow = shadow;
    if (part) m.userData.part = part;
    parent.add(m);
    return m;
  }

  // ---- bassin et jambes
  // `upper` = bassin + buste + tête + bras + fusil : une seule pièce rigide (fusionnée plus bas)
  const upper = new THREE.Group();
  upper.position.y = HIP_Y;
  group.add(upper);
  const hips = new THREE.Group(); // simple support de construction des jambes
  hips.position.y = HIP_Y;
  group.add(hips);
  const pelvis = new THREE.Group();
  upper.add(pelvis);

  mesh(pelvis, sphereGeometry(1, 16, 10), materials.bottom, { y: 0.02, sx: 0.175, sy: 0.12, sz: 0.125, part: 'bottom' });
  mesh(pelvis, limbGeometry(0.168, 0.17, 0.045, 18), materials.belt, { y: 0.115, sz: 0.74 });
  mesh(pelvis, boxGeometry(0.04, 0.032, 0.012), materials.metal, { y: 0.095, z: -0.122 }); // boucle

  const legs = [];
  [-1, 1].forEach((side) => {
    const hip = new THREE.Group();
    hip.position.set(0.095 * side, 0, 0);
    hips.add(hip);
    mesh(hip, limbGeometry(0.086, 0.064, THIGH), materials.bottom, { part: 'bottom' });
    mesh(hip, sphereGeometry(1, 10, 8), materials.bottom, { sx: 0.086, sy: 0.086, sz: 0.086, part: 'bottom' });
    // poche cargo sur la cuisse (côté extérieur)
    mesh(hip, boxGeometry(0.03, 0.12, 0.1), materials.bottomDetail, { x: 0.075 * side, y: -0.2, z: -0.01, part: 'bottom' });
    const knee = new THREE.Group();
    knee.position.y = -THIGH;
    hip.add(knee);
    mesh(knee, sphereGeometry(1, 10, 8), materials.bottom, { sx: 0.066, sy: 0.066, sz: 0.066, part: 'bottom' });
    mesh(knee, limbGeometry(0.064, 0.046, SHIN), materials.bottom, { part: 'bottom' });
    mesh(knee, boxGeometry(0.075, 0.095, 0.045), materials.polymer, { y: 0.0, z: -0.05, rx: -0.1 }); // genouillère
    // botte
    const ankle = new THREE.Group();
    ankle.position.y = -SHIN;
    knee.add(ankle);
    mesh(ankle, limbGeometry(0.058, 0.052, 0.13, 10), materials.boot, { y: 0.1 }); // tige
    mesh(ankle, boxGeometry(0.095, 0.075, 0.27), materials.boot, { y: -0.035, z: -0.06 }); // semelle + pointe
    mesh(ankle, boxGeometry(0.1, 0.022, 0.285), materials.metal, { y: -0.078, z: -0.06 }); // semelle
    legs.push({ side, hip, knee, ankle });
  });

  // ---- buste
  const spine = new THREE.Group();
  spine.position.y = 0.075; // monde : ~1,0 m
  upper.add(spine);

  mesh(spine, sphereGeometry(1, 16, 12), materials.top, { y: 0.07, sx: 0.155, sy: 0.14, sz: 0.105, part: 'top' }); // ventre
  mesh(spine, sphereGeometry(1, 20, 14), materials.top, { y: 0.255, sx: 0.2, sy: 0.18, sz: 0.125, part: 'top' }); // poitrine
  // gilet pare-balles / porte-plaques : plaques + bretelles + poches
  mesh(spine, boxGeometry(0.3, 0.3, 0.06), materials.vest, { y: 0.255, z: -0.098, part: 'top' });
  mesh(spine, boxGeometry(0.3, 0.3, 0.05), materials.vest, { y: 0.255, z: 0.1, part: 'top' });
  [-1, 1].forEach((side) => {
    mesh(spine, boxGeometry(0.06, 0.07, 0.24), materials.vest, { x: 0.105 * side, y: 0.395, z: 0, part: 'top' }); // bretelles
    mesh(spine, boxGeometry(0.075, 0.1, 0.045), materials.vest, { x: 0.075 * side, y: 0.125, z: -0.125, part: 'top' }); // poches chargeurs
    mesh(spine, boxGeometry(0.06, 0.012, 0.047), materials.belt, { x: 0.075 * side, y: 0.165, z: -0.125 });
  });
  mesh(spine, boxGeometry(0.08, 0.06, 0.04), materials.vest, { y: 0.34, z: -0.13, part: 'top' }); // poche radio

  // cou + tête (pivot au sommet du cou)
  mesh(spine, limbGeometry(0.048, 0.054, 0.1, 12), materials.skin, { y: 0.51, part: 'head' });
  const head = new THREE.Group();
  head.position.set(0, 0.58, 0.0);
  spine.add(head);

  // crâne + mâchoire
  mesh(head, sphereGeometry(1, 24, 18), materials.skin, { y: 0.06, sx: 0.092, sy: 0.108, sz: 0.1, part: 'head' });
  mesh(head, sphereGeometry(1, 20, 14), materials.skin, { y: -0.005, z: -0.012, sx: 0.07, sy: 0.066, sz: 0.076, part: 'head' }); // menton
  // visage
  [-1, 1].forEach((side) => {
    mesh(head, sphereGeometry(1, 10, 8), materials.white, { x: 0.036 * side, y: 0.075, z: -0.082, sx: 0.0165, sy: 0.011, sz: 0.01, shadow: false });
    mesh(head, sphereGeometry(1, 10, 8), materials.iris, { x: 0.036 * side, y: 0.075, z: -0.0895, sx: 0.0075, sy: 0.0075, sz: 0.005, shadow: false });
    mesh(head, boxGeometry(0.036, 0.0065, 0.012), materials.hair, { x: 0.037 * side, y: 0.099, z: -0.083, rz: -0.14 * side, shadow: false, part: 'hair' }); // sourcils
    mesh(head, sphereGeometry(1, 10, 8), materials.skinDark, { x: 0.094 * side, y: 0.062, z: 0.004, sx: 0.012, sy: 0.026, sz: 0.019, part: 'head' }); // oreilles
  });
  mesh(head, sphereGeometry(1, 12, 10), materials.skin, { y: 0.046, z: -0.1, sx: 0.0145, sy: 0.026, sz: 0.0175, part: 'head' }); // nez
  mesh(head, boxGeometry(0.04, 0.0066, 0.01), materials.lips, { y: 0.004, z: -0.0925, shadow: false }); // bouche

  // cheveux
  const hairMeshes = [];
  const hairStyle = appearance.hair;
  if (hairStyle === 'court' || hairStyle === 'long') {
    hairMeshes.push(mesh(head, capGeometry(1.6), materials.hair, { y: 0.064, z: 0.006, sx: 0.0985, sy: 0.112, sz: 0.1065, rx: 0.42, part: 'hair' }));
  } else if (hairStyle === 'rase') {
    hairMeshes.push(mesh(head, capGeometry(1.52), materials.stubble, { y: 0.062, z: 0.004, sx: 0.0935, sy: 0.1095, sz: 0.1015, rx: 0.4, part: 'hair' }));
  } else if (hairStyle === 'crete') {
    hairMeshes.push(mesh(head, capGeometry(1.52), materials.stubble, { y: 0.062, z: 0.004, sx: 0.0935, sy: 0.1095, sz: 0.1015, rx: 0.4, part: 'hair' }));
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const h = 0.045 + 0.04 * Math.sin(Math.PI * t);
      hairMeshes.push(mesh(head, boxGeometry(0.022, 0.1, 0.03), materials.hair, { y: 0.172 + h / 2 - 0.05 + 0.002, z: -0.07 + t * 0.15, sy: h / 0.1 + 0.2, rx: (t - 0.45) * 0.55, part: 'hair' }));
    }
  }
  if (hairStyle === 'long') {
    hairMeshes.push(mesh(head, boxGeometry(0.19, 0.3, 0.06), materials.hair, { y: -0.06, z: 0.085, rx: 0.1, part: 'hair' }));
    [-1, 1].forEach((side) => {
      hairMeshes.push(mesh(head, boxGeometry(0.03, 0.2, 0.08), materials.hair, { x: 0.092 * side, y: 0.0, z: 0.02, part: 'hair' }));
    });
  }

  // couvre-chef
  const gear = appearance.headgear;
  if (gear === 'casquette') {
    mesh(head, capGeometry(1.62, 22, 12), materials.headgear, { y: 0.064, z: 0.002, sx: 0.103, sy: 0.12, sz: 0.111, rx: 0.12, part: 'headgear' });
    mesh(head, boxGeometry(0.15, 0.008, 0.08), materials.headgear, { y: 0.1, z: -0.132, rx: 0.12, part: 'headgear' }); // visière
    mesh(head, sphereGeometry(1, 8, 6), materials.headgearDark, { y: 0.184, z: 0.0, sx: 0.012, sy: 0.007, sz: 0.012, part: 'headgear' }); // bouton
  } else if (gear === 'bonnet') {
    mesh(head, capGeometry(1.95, 22, 12), materials.headgear, { y: 0.066, z: 0.002, sx: 0.1, sy: 0.116, sz: 0.108, rx: -0.14, part: 'headgear' });
    mesh(head, limbGeometry(0.101, 0.103, 0.045, 22), materials.headgearDark, { y: 0.128, z: 0.0, sz: 1.06, rx: -0.14, part: 'headgear' }); // revers
    mesh(head, sphereGeometry(1, 10, 8), materials.headgear, { y: 0.17, z: 0.012, sx: 0.022, sy: 0.022, sz: 0.022, part: 'headgear' }); // pompon discret
  } else if (gear === 'casque') {
    mesh(head, capGeometry(2.0, 24, 14), materials.headgear, { y: 0.07, z: 0.004, sx: 0.113, sy: 0.108, sz: 0.122, rx: -0.1, part: 'headgear' });
    mesh(head, limbGeometry(0.113, 0.116, 0.02, 24), materials.headgearDark, { y: 0.116, z: 0.004, sz: 1.08, part: 'headgear' }); // rebord
    mesh(head, boxGeometry(0.05, 0.04, 0.04), materials.metal, { y: 0.158, z: -0.098, part: 'headgear' }); // support de vision nocturne
    mesh(head, boxGeometry(0.2, 0.03, 0.06), materials.headgearDark, { y: 0.145, z: 0.11, part: 'headgear' }); // protection nuque
    [-1, 1].forEach((side) => {
      mesh(head, boxGeometry(0.012, 0.05, 0.06), materials.headgearDark, { x: 0.111 * side, y: 0.09, z: 0.0, part: 'headgear' }); // rail
    });
    // le casque couvre les cheveux courts ; les longs dépassent par derrière
    if (hairStyle !== 'long') hairMeshes.forEach((m) => { m.visible = false; });
  }
  if (gear === 'bonnet') {
    // sous le bonnet seuls les cheveux longs dépassent
    hairMeshes.forEach((m) => { m.visible = hairStyle === 'long' && m.geometry.type === 'BoxGeometry'; });
  }

  // ---- bras + fusil
  const rifle = new THREE.Group();
  rifle.position.set(0.12, 0.27, -0.15);
  rifle.rotation.set(-0.12, 0.05, 0);
  spine.add(rifle);
  const barrelGeo = geo('rifle-barrel', () => {
    const g = new THREE.CylinderGeometry(0.0115, 0.0115, 0.3, 8);
    g.rotateX(Math.PI / 2);
    return g;
  });
  const opticGeo = geo('rifle-optic', () => {
    const g = new THREE.CylinderGeometry(0.0235, 0.0235, 0.12, 12);
    g.rotateX(Math.PI / 2);
    return g;
  });
  mesh(rifle, boxGeometry(0.05, 0.085, 0.34), materials.metal, { z: 0.0 }); // boîtier
  mesh(rifle, boxGeometry(0.044, 0.056, 0.26), materials.polymer, { z: -0.3, y: -0.004 }); // garde-main
  mesh(rifle, barrelGeo, materials.metal, { z: -0.58 }); // canon
  mesh(rifle, boxGeometry(0.038, 0.07, 0.07), materials.polymer, { y: -0.075, z: -0.06, rx: 0.18 }); // chargeur
  mesh(rifle, boxGeometry(0.03, 0.075, 0.04), materials.polymer, { y: -0.075, z: 0.1, rx: -0.3 }); // poignée
  mesh(rifle, boxGeometry(0.04, 0.075, 0.2), materials.polymer, { y: -0.01, z: 0.26 }); // crosse
  mesh(rifle, boxGeometry(0.045, 0.012, 0.3), materials.metal, { y: 0.049, z: 0.0 }); // rail
  mesh(rifle, boxGeometry(0.04, 0.045, 0.11), materials.polymer, { y: 0.077, z: -0.04 }); // support de viseur
  mesh(rifle, opticGeo, materials.metal, { y: 0.075, z: -0.04 }); // viseur

  rifle.updateMatrix();

  const arms = [];
  const shoulderY = 0.4;
  [-1, 1].forEach((side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.215 * side, shoulderY, 0.0);
    spine.add(shoulder);
    mesh(shoulder, sphereGeometry(1, 12, 10), materials.top, { sx: 0.072, sy: 0.07, sz: 0.072, part: 'top' });
    mesh(shoulder, limbGeometry(0.056, 0.047, UPPER_ARM), materials.top, { part: 'top' });
    const elbow = new THREE.Group();
    elbow.position.y = -UPPER_ARM;
    shoulder.add(elbow);
    mesh(elbow, sphereGeometry(1, 10, 8), materials.top, { sx: 0.05, sy: 0.05, sz: 0.05, part: 'top' });
    mesh(elbow, limbGeometry(0.047, 0.037, FOREARM), materials.top, { part: 'top' });
    mesh(elbow, boxGeometry(0.07, 0.03, 0.07), materials.glove, { y: -FOREARM + 0.01 }); // poignet / gant
    const hand = new THREE.Group();
    hand.position.y = -FOREARM;
    elbow.add(hand);
    mesh(hand, boxGeometry(0.075, 0.09, 0.045), materials.glove, { y: -0.04 });
    arms.push({ side, shoulder, elbow, hand });
  });

  // pose "arme en main" : mains aux emplacements de la poignée et du garde-main
  const _shoulderPos = new THREE.Vector3();
  const _target = new THREE.Vector3();
  const _elbowPos = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _down = new THREE.Vector3(0, -1, 0);
  rifle.updateMatrixWorld(true);
  group.updateMatrixWorld(true);
  function poseArm(arm, localTarget) {
    // tout est exprimé dans le repère du buste (spine)
    _shoulderPos.copy(arm.shoulder.position);
    _target.copy(localTarget).applyMatrix4(rifle.matrix);
    const pole = new THREE.Vector3(0.35 * arm.side, -1, 0.5).normalize();
    solveElbow(_shoulderPos, _target, UPPER_ARM, FOREARM, pole, _elbowPos);
    _dir.subVectors(_elbowPos, _shoulderPos).normalize();
    _q.setFromUnitVectors(_down, _dir);
    arm.shoulder.quaternion.copy(_q);
    const upperQ = _q.clone();
    _dir.subVectors(_target, _elbowPos).normalize();
    const lowerWorld = new THREE.Quaternion().setFromUnitVectors(_down, _dir);
    arm.elbow.quaternion.copy(upperQ.invert().multiply(lowerWorld));
  }
  const rightArm = arms.find((a) => a.side === 1);
  const leftArm = arms.find((a) => a.side === -1);
  poseArm(rightArm, new THREE.Vector3(0.0, -0.075, 0.08));
  poseArm(leftArm, new THREE.Vector3(0.0, -0.03, -0.27));
  // le gant de la main gauche enveloppe le garde-main
  leftArm.hand.rotation.set(0.0, 0.0, 0.0);

  if (options.armed === false) rifle.visible = false;


  // ------------------------------------------------------------ fusion des géométries
  // ~70 petites pièces par joueur seraient lourdes avec les ombres en cascade :
  // on fusionne chaque pièce RIGIDE (buste complet, et chaque segment de jambe)
  // en un seul mesh par matériau. L'apparence ne change pas.
  const partOfMaterial = new Map([
    [materials.top, 'top'], [materials.vest, 'top'],
    [materials.bottom, 'bottom'], [materials.bottomDetail, 'bottom'],
    [materials.skin, 'head'], [materials.skinDark, 'head'],
    [materials.hair, 'hair'], [materials.stubble, 'hair'],
    [materials.headgear, 'headgear'], [materials.headgearDark, 'headgear'],
  ]);
  function collectMeshes(node, out) {
    node.children.forEach((child) => {
      if (child.isMesh) out.push(child);
      else collectMeshes(child, out);
    });
  }
  function bake(target, roots) {
    group.updateMatrixWorld(true);
    const inverse = new THREE.Matrix4().copy(target.matrixWorld).invert();
    const buckets = new Map();
    const relative = new THREE.Matrix4();
    roots.forEach((root) => {
      const found = [];
      if (root.isMesh) found.push(root);
      else collectMeshes(root, found);
      found.forEach((m) => {
        relative.multiplyMatrices(inverse, m.matrixWorld);
        const g = m.geometry.clone();
        g.applyMatrix4(relative);
        if (!buckets.has(m.material)) buckets.set(m.material, []);
        buckets.get(m.material).push(g);
        m.parent.remove(m);
      });
    });
    buckets.forEach((geometries, material) => {
      const merged = mergeGeometries(geometries, false);
      geometries.forEach((g) => g.dispose());
      const fused = new THREE.Mesh(merged, material);
      fused.castShadow = !NO_SHADOW.has(material);
      const part = partOfMaterial.get(material);
      if (part) {
        fused.userData.part = part;
        pickables.push(fused);
      }
      target.add(fused);
    });
  }
  bake(upper, [pelvis, spine]);
  upper.remove(pelvis, spine);
  legs.forEach((leg) => {
    // chaque segment de jambe garde sa propre articulation : on fusionne les meshes de chacun
    [leg.hip, leg.knee, leg.ankle].forEach((segment) => {
      const own = segment.children.filter((c) => c.isMesh);
      if (own.length) bake(segment, own);
    });
  });

  // ------------------------------------------------------------ animation (marche)
  let phase = Math.random();
  let blend = 0; // 0 = immobile, 1 = marche/course
  let breath = Math.random() * TAU;

  function setLegs(strideAmp, lift, bobAmp) {
    const stride = 0.62 * strideAmp; // longueur d'un pas
    legs.forEach((leg, index) => {
      const p = (phase + (index === 0 ? 0 : 0.5)) % 1;
      let z;
      let y = 0;
      if (p < 0.5) {
        // appui : le pied recule sous le corps
        z = -stride / 2 + stride * (p / 0.5);
      } else {
        // oscillation : le pied revient vers l'avant, levé
        const t = (p - 0.5) / 0.5;
        const eased = t * t * (3 - 2 * t);
        z = stride / 2 - stride * eased;
        y = Math.sin(Math.PI * t) * lift;
      }
      const hipY = HIP_Y - bobAmp * Math.abs(Math.cos(Math.PI * (p * 2)));
      const footY = 0.075 + y; // hauteur de la cheville au-dessus du sol
      const { thigh, shin } = solveLegAngles(hipY, footY, z, THIGH, SHIN);
      leg.hip.rotation.x = thigh;
      leg.knee.rotation.x = shin - thigh;
      // le pied reste à plat (légèrement relevé en fin d'oscillation)
      const toeUp = p >= 0.5 ? Math.sin(Math.PI * ((p - 0.5) / 0.5)) * 0.35 : 0;
      leg.ankle.rotation.x = -shin + toeUp * 0.0 - (p >= 0.5 ? toeUp * 0.0 : 0);
    });
  }

  /**
   * dt en secondes, speed en m/s (vitesse au sol constatée).
   */
  function update(dt, speed = 0) {
    const target = speed > 0.35 ? 1 : 0;
    blend += (target - blend) * Math.min(1, dt * 10);
    const gait = Math.min(1, speed / 6);
    if (speed > 0.35) phase = (phase + (dt * speed) / 2.1) % 1; // une foulée complète ~2,1 m
    breath += dt * 1.8;

    const strideAmp = (0.35 + 0.65 * gait) * blend;
    const lift = (0.045 + 0.11 * gait) * blend;
    const bob = 0.02 * blend;
    setLegs(strideAmp, lift, bob);

    // buste (bassin + torse + tête + bras + fusil, d'un bloc) : légère inclinaison en courant + respiration
    upper.rotation.x = -0.05 * blend * gait;
    upper.rotation.y = Math.sin(phase * TAU) * 0.04 * blend;
    upper.position.y = HIP_Y + Math.sin(breath) * 0.0015;
  }
  update(0, 0);

  // ------------------------------------------------------------ couleurs et surbrillance
  function setTopColor(color) {
    materials.top.color.set(color);
    materials.vest.color.set(color).multiplyScalar(0.5);
  }

  let highlighted = null;
  function setHighlight(part) {
    if (highlighted === part) return;
    Object.entries(partMaterials).forEach(([name, list]) => {
      list.forEach((m) => {
        m.emissive.setHex(name === part ? 0xffffff : 0x000000);
        m.emissiveIntensity = name === part ? 0.1 : 0;
      });
    });
    highlighted = part;
  }

  // Libère les géométries fusionnées et les matériaux de CE personnage (la texture
  // de tissu, partagée par tous, n'est jamais détruite).
  function dispose() {
    group.traverse((child) => {
      if (child.isMesh) child.geometry.dispose();
    });
    Object.values(materials).forEach((m) => m.dispose());
  }

  return { group, pickables, materials, update, setTopColor, setHighlight, dispose };
}
