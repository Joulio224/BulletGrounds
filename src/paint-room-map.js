// ---------------------------------------------------------------------------
// Easter egg « salle de peinture » — la carte privée.
//
// Une salle blanche générée en code (aucun .glb, aucune texture). Chaque face
// visible est découpée en petites cellules, et toutes les cellules sont rangées
// dans UN SEUL atlas : c'est dans cet atlas que la peinture est dessinée (voir
// paint-atlas.js). La salle entière est donc un seul mesh, un seul matériau.
//
// Repère : sol à y = 0, la salle va de -ROOM.half à +ROOM.half en X et en Z.
// Le joueur apparaît au sud (z > 0) et regarde vers -Z.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

export const ROOM = {
  half: 24, // demi-côté de la salle (m)
  wallHeight: 14,
  spawn: new THREE.Vector3(0, 1.7, 18),
};

// Le mur qui cache le code : sa face avant (+Z) est découpée comme les autres
// mais marquée `code` (voir paint-atlas.js, éclaircissement des chiffres).
export const CODE_WALL = {
  center: new THREE.Vector3(0, 3.5, -10),
  size: new THREE.Vector3(16, 7, 0.8), // largeur, hauteur, épaisseur
};

// Terminal à code (posé près du mur ouest, voir easter-egg-paint.js).
export const TERMINAL = {
  position: new THREE.Vector3(-22.6, 0, 14),
  facing: new THREE.Vector3(1, 0, 0), // l'écran regarde vers l'est
};

const CELL_MAX = 4; // taille maximale d'une cellule (m) : on ne repeint que celles qui sont touchées
const GUTTER = 3; // pixels de marge autour de chaque cellule (évite les coutures)

// ------------------------------------------------------------------ boîtes
// Repères des 6 faces d'une boîte : [axe de la normale, signe, axe u, signe u, axe v, signe v]
// choisis pour que u × v = normale (la face est donc vue à l'endroit de l'extérieur).
const FACE_FRAMES = {
  '+x': { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  '-x': { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  '+y': { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  '-y': { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  '+z': { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  '-z': { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
};
const AXIS_OF = { x: 0, y: 1, z: 2 };

/**
 * Description de la salle : une liste de boîtes (éventuellement inclinées) et
 * pour chacune les faces à peindre.
 */
function roomLayout() {
  const H = ROOM.half;
  const W = ROOM.wallHeight;
  const boxes = [];
  const add = (center, size, faces, extra = {}) => boxes.push({ center: new THREE.Vector3(...center), size: new THREE.Vector3(...size), faces, ...extra });
  const SOLID = ['+x', '-x', '+y', '+z', '-z']; // pas de face du dessous (posé sur le sol)

  // sol + murs d'enceinte (on ne peint que ce qui est visible depuis l'intérieur)
  add([0, -0.5, 0], [H * 2, 1, H * 2], ['+y']);
  add([0, W / 2, -H - 0.5], [H * 2 + 2, W, 1], ['+z']);
  add([0, W / 2, H + 0.5], [H * 2 + 2, W, 1], ['-z']);
  add([-H - 0.5, W / 2, 0], [1, W, H * 2], ['+x']);
  add([H + 0.5, W / 2, 0], [1, W, H * 2], ['-x']);

  // le mur du code, au milieu : les deux faces se peignent, seule la face avant cache les chiffres
  add(CODE_WALL.center.toArray(), CODE_WALL.size.toArray(), ['+z', '-z', '+x', '-x', '+y'], { codeFace: '+z' });

  // piliers
  [[-12, -2], [12, -2], [-12, 10], [12, 10]].forEach(([x, z]) => add([x, 3, z], [2, 6, 2], SOLID));
  // caisses
  add([-6, 1.2, 4], [2.4, 2.4, 2.4], SOLID);
  add([6, 1.2, 4], [2.4, 2.4, 2.4], SOLID);
  add([0, 1.2, 12], [3, 2.4, 3], SOLID);
  add([0, 3.1, 12], [1.8, 1.4, 1.8], ['+x', '-x', '+y', '+z', '-z']);
  // murs bas (abris)
  add([-18, 1.5, -14], [8, 3, 0.6], SOLID);
  add([18, 1.5, -14], [8, 3, 0.6], SOLID);
  add([-8, 1.2, -18], [0.6, 2.4, 7], SOLID);
  add([8, 1.2, -18], [0.6, 2.4, 7], SOLID);
  // plateforme + rampe
  add([17, 1.6, 14], [10, 3.2, 10], SOLID);
  add([8.9, 1.65, 14], [7.6, 0.4, 5], ['+x', '-x', '+y', '-y', '+z', '-z'], { rotationZ: THREE.MathUtils.degToRad(25) });
  return boxes;
}

// ------------------------------------------------------------------ construction
/**
 * Construit la salle : cellules, atlas (positions dans l'atlas), géométries.
 * @param density pixels d'atlas par mètre (32 = un pixel de 3 cm)
 */
export function buildPaintRoom({ density = 32 } = {}) {
  const boxes = roomLayout();
  const cells = [];

  // ---- 1. découper chaque face en cellules
  boxes.forEach((box, boxIndex) => {
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, box.rotationZ || 0));
    const half = box.size.clone().multiplyScalar(0.5);
    box.faces.forEach((faceKey) => {
      const frame = FACE_FRAMES[faceKey];
      const n = new THREE.Vector3(...frame.n).applyQuaternion(rotation);
      const u = new THREE.Vector3(...frame.u).applyQuaternion(rotation);
      const v = new THREE.Vector3(...frame.v).applyQuaternion(rotation);
      const axisN = AXIS_OF['xyz'[frame.n.findIndex((c) => c !== 0)]];
      const axisU = frame.u.findIndex((c) => c !== 0);
      const axisV = frame.v.findIndex((c) => c !== 0);
      const faceW = box.size.getComponent(axisU);
      const faceH = box.size.getComponent(axisV);
      const faceCenter = box.center.clone().addScaledVector(n, half.getComponent(axisN));
      const faceOrigin = faceCenter.clone().addScaledVector(u, -faceW / 2).addScaledVector(v, -faceH / 2);
      const isCodeFace = box.codeFace === faceKey;

      const nu = Math.max(1, Math.ceil(faceW / CELL_MAX));
      const nv = Math.max(1, Math.ceil(faceH / CELL_MAX));
      const cw = faceW / nu;
      const ch = faceH / nv;
      for (let j = 0; j < nv; j++) {
        for (let i = 0; i < nu; i++) {
          cells.push({
            boxIndex,
            faceKey,
            normal: n.clone(),
            u: u.clone(),
            v: v.clone(),
            w: cw,
            h: ch,
            origin: faceOrigin.clone().addScaledVector(u, i * cw).addScaledVector(v, j * ch),
            faceU0: i * cw, // décalage de la cellule dans sa face (m) : sert au masque des chiffres
            faceV0: j * ch,
            faceW,
            faceH,
            code: isCodeFace,
          });
        }
      }
    });
  });

  // ---- 2. ranger toutes les cellules dans l'atlas (étagères)
  cells.forEach((cell) => {
    cell.pw = Math.max(4, Math.ceil(cell.w * density));
    cell.ph = Math.max(4, Math.ceil(cell.h * density));
  });
  const order = cells.map((_, i) => i).sort((a, b) => cells[b].ph - cells[a].ph);
  function pack(width) {
    let x = 0;
    let y = 0;
    let shelf = 0;
    for (const index of order) {
      const cell = cells[index];
      const sw = cell.pw + GUTTER * 2;
      const sh = cell.ph + GUTTER * 2;
      if (x + sw > width) {
        x = 0;
        y += shelf;
        shelf = 0;
      }
      cell.sx = x; // coin bas-gauche du créneau (marge comprise)
      cell.sy = y;
      x += sw;
      shelf = Math.max(shelf, sh);
    }
    return y + shelf;
  }
  let atlasW = 1024;
  let atlasH = pack(atlasW);
  while (atlasH > atlasW * 1.0 && atlasW < 4096) {
    atlasW *= 2;
    atlasH = pack(atlasW);
  }
  if (atlasH > 4096) throw new Error(`Atlas de peinture trop grand (${atlasW}x${atlasH}) : baisse la densité.`);
  // hauteur arrondie au multiple de 4 (propre pour le GPU)
  atlasH = Math.ceil(atlasH / 4) * 4;

  // ---- 3. géométrie d'affichage (la salle) et géométrie de peinture (cellules étendues)
  const count = cells.length;
  const dPos = new Float32Array(count * 12);
  const dNormal = new Float32Array(count * 12);
  const dUv = new Float32Array(count * 8);
  const pPos = new Float32Array(count * 12);
  const pUv = new Float32Array(count * 8);
  const pNormal = new Float32Array(count * 12);
  const pFaceUV = new Float32Array(count * 8);
  const pCode = new Float32Array(count * 4);
  const indices = new Uint32Array(count * 6);

  const tmp = new THREE.Vector3();
  cells.forEach((cell, c) => {
    const x0 = cell.sx + GUTTER; // intérieur de la cellule dans l'atlas
    const y0 = cell.sy + GUTTER;
    // mètres par pixel de cette cellule (peut différer légèrement entre u et v à cause de l'arrondi)
    const mpx = cell.w / cell.pw;
    const mpy = cell.h / cell.ph;
    const gu = GUTTER * mpx;
    const gv = GUTTER * mpy;

    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
    corners.forEach(([cu, cv], k) => {
      // affichage : exactement la cellule
      tmp.copy(cell.origin).addScaledVector(cell.u, cu * cell.w).addScaledVector(cell.v, cv * cell.h);
      dPos.set([tmp.x, tmp.y, tmp.z], (c * 4 + k) * 3);
      dNormal.set([cell.normal.x, cell.normal.y, cell.normal.z], (c * 4 + k) * 3);
      dUv.set([(x0 + cu * cell.pw) / atlasW, (y0 + cv * cell.ph) / atlasH], (c * 4 + k) * 2);

      // peinture : la cellule ÉLARGIE de la marge (la peinture continue au-delà du bord)
      const eu = cu === 0 ? -gu : cell.w + gu;
      const ev = cv === 0 ? -gv : cell.h + gv;
      tmp.copy(cell.origin).addScaledVector(cell.u, eu).addScaledVector(cell.v, ev);
      pPos.set([tmp.x, tmp.y, tmp.z], (c * 4 + k) * 3);
      pNormal.set([cell.normal.x, cell.normal.y, cell.normal.z], (c * 4 + k) * 3);
      pUv.set([(cell.sx + (cu === 0 ? 0 : cell.pw + GUTTER * 2)) / atlasW, (cell.sy + (cv === 0 ? 0 : cell.ph + GUTTER * 2)) / atlasH], (c * 4 + k) * 2);
      pFaceUV.set([cell.faceU0 + eu, cell.faceV0 + ev], (c * 4 + k) * 2);
      pCode[c * 4 + k] = cell.code ? 1 : 0;
    });
    const o = c * 4;
    indices.set([o, o + 1, o + 2, o, o + 2, o + 3], c * 6);
  });

  const displayGeometry = new THREE.BufferGeometry();
  displayGeometry.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  displayGeometry.setAttribute('normal', new THREE.BufferAttribute(dNormal, 3));
  displayGeometry.setAttribute('uv', new THREE.BufferAttribute(dUv, 2));
  displayGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
  displayGeometry.computeBoundingSphere();
  displayGeometry.computeBoundingBox();

  const paintGeometry = new THREE.BufferGeometry();
  paintGeometry.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  paintGeometry.setAttribute('uv', new THREE.BufferAttribute(pUv, 2));
  paintGeometry.setAttribute('aNormal', new THREE.BufferAttribute(pNormal, 3));
  paintGeometry.setAttribute('aFaceUV', new THREE.BufferAttribute(pFaceUV, 2));
  paintGeometry.setAttribute('aCode', new THREE.BufferAttribute(pCode, 1));
  const paintIndex = new THREE.BufferAttribute(new Uint32Array(count * 6), 1);
  paintIndex.setUsage(THREE.DynamicDrawUsage);
  paintGeometry.setIndex(paintIndex);
  paintGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6); // jamais écarté

  // sphères englobantes des cellules (pour savoir lesquelles une tache touche)
  cells.forEach((cell) => {
    const centre = cell.origin.clone().addScaledVector(cell.u, cell.w / 2).addScaledVector(cell.v, cell.h / 2);
    cell.centre = centre;
    cell.radius = Math.hypot(cell.w, cell.h) / 2;
  });

  // le mesh de la salle (le matériau et l'atlas sont fournis par le contrôleur)
  const mesh = new THREE.Mesh(displayGeometry, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'paint-room';

  let totalTexels = 0;
  cells.forEach((cell) => { totalTexels += cell.pw * cell.ph; });

  return {
    mesh,
    cells,
    displayGeometry,
    paintGeometry,
    paintIndex,
    atlasW,
    atlasH,
    gutter: GUTTER,
    density,
    totalTexels,
    boxes,
  };
}
