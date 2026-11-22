// ---------------------------------------------------------------------------
// Moteur de peinture de l'easter egg.
//
// La peinture est dessinée dans un atlas (une texture) qui sert de couleur à
// toute la salle (voir paint-room-map.js). Pour peindre une tache, on dessine
// les cellules de la salle qu'elle touche DANS l'atlas : le shader reçoit la
// position 3D de chaque pixel de l'atlas, et colorie ceux qui sont à moins de
// « rayon » de la tache, sur le même plan que le point d'impact.
//
// Résultat : des ronds de peinture nets, qui épousent murs, sol et rampe, sans
// aucun décalque flottant et pour un coût quasi nul (une texture, un mesh).
//
// En parallèle, un tableau côté CPU note quels pixels ont été peints : c'est ce
// qui donne le pourcentage de la salle peinte (sans relire la carte graphique).
// ---------------------------------------------------------------------------
import * as THREE from 'three';

const MAX_SPLATS_PER_PASS = 16;

const VERTEX = /* glsl */ `
attribute vec3 aNormal;
attribute vec2 aFaceUV;
attribute float aCode;
varying vec3 vWorld;
varying vec3 vNrm;
varying vec2 vFaceUV;
varying float vCode;
void main() {
  vWorld = position;
  vNrm = aNormal;
  vFaceUV = aFaceUV;
  vCode = aCode;
  gl_Position = vec4( uv * 2.0 - 1.0, 0.0, 1.0 );
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;
uniform int uCount;
uniform vec4 uSplatA[${MAX_SPLATS_PER_PASS}]; // xyz = centre, w = rayon
uniform vec4 uSplatB[${MAX_SPLATS_PER_PASS}]; // rgb = couleur (linéaire), w = graine
uniform vec4 uSplatC[${MAX_SPLATS_PER_PASS}]; // xyz = normale de la surface touchée, w = 1 si les chiffres s'éclaircissent
uniform sampler2D uCodeMask;
uniform vec2 uMaskSize;   // taille du mur du code (m)
uniform float uLift;      // éclaircissement des chiffres (0..1)
varying vec3 vWorld;
varying vec3 vNrm;
varying vec2 vFaceUV;
varying float vCode;

float hash11( float p ) {
  p = fract( p * 0.1031 );
  p *= p + 33.33;
  p *= p + p;
  return fract( p );
}

void main() {
  vec4 acc = vec4( 0.0 );
  vec3 n = normalize( vNrm );
  for ( int i = 0; i < ${MAX_SPLATS_PER_PASS}; i++ ) {
    if ( i >= uCount ) break;
    vec4 A = uSplatA[ i ];
    vec4 B = uSplatB[ i ];
    vec4 C = uSplatC[ i ];
    // seulement la surface qui a été touchée : même orientation et même plan
    if ( dot( n, C.xyz ) < 0.5 ) continue;
    vec3 d = vWorld - A.xyz;
    if ( abs( dot( d, n ) ) > 0.12 + 0.1 * A.w ) continue;
    if ( dot( d, d ) > ( A.w * 2.1 ) * ( A.w * 2.1 ) ) continue;

    // repère dans le plan de la tache
    vec3 N = C.xyz;
    vec3 T = normalize( abs( N.y ) < 0.9 ? cross( N, vec3( 0.0, 1.0, 0.0 ) ) : cross( N, vec3( 1.0, 0.0, 0.0 ) ) );
    vec3 Bv = cross( N, T );
    vec2 l = vec2( dot( d, T ), dot( d, Bv ) );
    float dist = length( l );
    float ang = atan( l.y, l.x );
    float seed = B.w;
    // bord irrégulier, comme une vraie éclaboussure
    float edge = 1.0
      + 0.15 * sin( ang * 3.0 + seed * 6.2831 )
      + 0.09 * sin( ang * 5.0 + seed * 13.7 )
      + 0.05 * sin( ang * 9.0 + seed * 29.1 );
    float r = A.w * edge;
    float a = 1.0 - smoothstep( r - 0.012 - 0.05 * A.w, r, dist );
    // petites gouttelettes autour
    for ( int k = 0; k < 6; k++ ) {
      float fk = float( k );
      float ak = hash11( seed * 7.1 + fk * 1.7 ) * 6.2831;
      float dk = A.w * ( 1.18 + 0.75 * hash11( seed * 3.3 + fk * 5.1 ) );
      float rk = A.w * ( 0.05 + 0.1 * hash11( seed * 9.7 + fk * 2.3 ) );
      vec2 pk = vec2( cos( ak ), sin( ak ) ) * dk;
      a = max( a, 1.0 - smoothstep( rk - 0.006, rk, length( l - pk ) ) );
    }
    if ( a <= 0.0 ) continue;

    vec3 col = B.rgb;
    // la peinture est un peu plus sombre sur le bord (épaisseur)
    col *= mix( 1.0, 0.84, smoothstep( 0.55, 1.0, dist / max( r, 1e-4 ) ) );
    // MUR DU CODE : là où se cachent les chiffres, la peinture s'éclaircit
    if ( vCode > 0.5 && C.w > 0.5 ) {
      float m = texture2D( uCodeMask, vFaceUV / uMaskSize ).r;
      col = mix( col, vec3( 1.0 ), uLift * m );
    }
    // cette tache recouvre ce qui était déjà peint
    acc.rgb = col * a + acc.rgb * ( 1.0 - a );
    acc.a = a + acc.a * ( 1.0 - a );
  }
  gl_FragColor = acc;
}
`;

export function createPaintAtlas({ renderer, room, codeMask, maskSize, lift = 0.5, baseColor = 0xf1f1ee }) {
  const { atlasW, atlasH, cells, paintGeometry, paintIndex } = room;

  const target = new THREE.WebGLRenderTarget(atlasW, atlasH, {
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    depthBuffer: false,
    stencilBuffer: false,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.SRGBColorSpace,
  });
  target.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  target.texture.wrapS = target.texture.wrapT = THREE.ClampToEdgeWrapping;

  const uniforms = {
    uCount: { value: 0 },
    uSplatA: { value: Array.from({ length: MAX_SPLATS_PER_PASS }, () => new THREE.Vector4()) },
    uSplatB: { value: Array.from({ length: MAX_SPLATS_PER_PASS }, () => new THREE.Vector4()) },
    uSplatC: { value: Array.from({ length: MAX_SPLATS_PER_PASS }, () => new THREE.Vector4()) },
    uCodeMask: { value: codeMask },
    uMaskSize: { value: new THREE.Vector2(maskSize.x, maskSize.y) },
    uLift: { value: lift },
  };
  const paintMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const paintMesh = new THREE.Mesh(paintGeometry, paintMaterial);
  paintMesh.frustumCulled = false;
  const paintScene = new THREE.Scene();
  paintScene.add(paintMesh);
  const paintCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // ---- état de couverture côté CPU : 1 octet par pixel de l'atlas
  const painted = new Uint8Array(atlasW * atlasH);
  let paintedCount = 0;

  function clear() {
    const previousTarget = renderer.getRenderTarget();
    const previousColor = renderer.getClearColor(new THREE.Color());
    const previousAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(target);
    renderer.setClearColor(baseColor, 1);
    renderer.clear(true, false, false);
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousColor, previousAlpha);
    painted.fill(0);
    paintedCount = 0;
  }
  clear();

  // ---- file d'attente de taches
  const queue = [];
  /**
   * @param s { point: Vector3, normal: Vector3, radius: number, color: Color (linéaire), seed: number, reveal: boolean }
   */
  function addSplat(s) {
    queue.push(s);
  }

  const _d = new THREE.Vector3();

  // Cellules touchées par une tache (même plan, même orientation, à portée).
  function touchedCells(s, out) {
    cells.forEach((cell, index) => {
      if (cell.normal.dot(s.normal) < 0.5) return;
      _d.subVectors(s.point, cell.centre);
      if (Math.abs(_d.dot(cell.normal)) > 0.12 + 0.1 * s.radius) return;
      if (_d.length() > cell.radius + s.radius * 2.1) return;
      out.add(index);
    });
  }

  // Met à jour le tableau de couverture (pixels de l'atlas dont le centre est dans la tache).
  function markCoverage(s, cellIndexes) {
    const rr = s.radius * 0.92;
    cellIndexes.forEach((index) => {
      const cell = cells[index];
      const mpx = cell.w / cell.pw;
      const mpy = cell.h / cell.ph;
      // position de la tache dans le repère de la cellule
      _d.subVectors(s.point, cell.origin);
      const cu = _d.dot(cell.u);
      const cv = _d.dot(cell.v);
      const i0 = Math.max(0, Math.floor((cu - rr) / mpx));
      const i1 = Math.min(cell.pw - 1, Math.ceil((cu + rr) / mpx));
      const j0 = Math.max(0, Math.floor((cv - rr) / mpy));
      const j1 = Math.min(cell.ph - 1, Math.ceil((cv + rr) / mpy));
      const baseX = cell.sx + room.gutter;
      const baseY = cell.sy + room.gutter;
      for (let j = j0; j <= j1; j++) {
        const dv = (j + 0.5) * mpy - cv;
        for (let i = i0; i <= i1; i++) {
          const du = (i + 0.5) * mpx - cu;
          if (du * du + dv * dv > rr * rr) continue;
          const p = (baseY + j) * atlasW + (baseX + i);
          if (!painted[p]) {
            painted[p] = 1;
            paintedCount += 1;
          }
        }
      }
    });
  }

  /**
   * À appeler une fois par image, AVANT le rendu de la scène.
   * Dessine au plus `budget` taches (le reste attend la prochaine image) : une
   * explosion de 120 taches s'étale sur quelques images au lieu de bloquer.
   */
  function flush(budget = 48) {
    if (queue.length === 0) return 0;
    const batchAll = queue.splice(0, budget);

    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const previousXr = renderer.xr.enabled;
    renderer.xr.enabled = false;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);

    for (let start = 0; start < batchAll.length; start += MAX_SPLATS_PER_PASS) {
      const batch = batchAll.slice(start, start + MAX_SPLATS_PER_PASS);
      const touched = new Set();
      batch.forEach((s, k) => {
        const mine = new Set();
        touchedCells(s, mine);
        mine.forEach((index) => touched.add(index));
        markCoverage(s, mine);
        uniforms.uSplatA.value[k].set(s.point.x, s.point.y, s.point.z, s.radius);
        uniforms.uSplatB.value[k].set(s.color.r, s.color.g, s.color.b, s.seed);
        uniforms.uSplatC.value[k].set(s.normal.x, s.normal.y, s.normal.z, s.reveal ? 1 : 0);
      });
      uniforms.uCount.value = batch.length;
      if (touched.size === 0) continue;

      // on ne dessine que les cellules touchées
      const array = paintIndex.array;
      let n = 0;
      touched.forEach((index) => {
        const o = index * 4;
        array.set([o, o + 1, o + 2, o, o + 2, o + 3], n);
        n += 6;
      });
      paintIndex.needsUpdate = true;
      paintGeometry.setDrawRange(0, n);
      renderer.render(paintScene, paintCamera);
    }

    renderer.setRenderTarget(previousTarget);
    renderer.autoClear = previousAutoClear;
    renderer.xr.enabled = previousXr;
    return batchAll.length;
  }

  return {
    texture: target.texture,
    addSplat,
    flush,
    clear,
    pending: () => queue.length,
    coverage: () => paintedCount / room.totalTexels,
    paintedTexels: () => paintedCount,
    dispose() {
      target.dispose();
      paintMaterial.dispose();
    },
  };
}
