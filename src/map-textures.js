// ---------------------------------------------------------------------------
// Textures de la map (style urbain / militaire).
//
// map.glb ne contient presque aucun matériau (215 objets sur 227 sont gris par
// défaut) et ses UV sont ceux de cubes Blender : une texture y serait étirée
// sur un mur de 60 m. On ne touche donc pas au .glb : après son chargement, on
// remplace le matériau de chaque objet selon son rôle (sol, murs d'enceinte,
// bâtiments, conteneurs, structures métalliques…) et on projette la texture
// en coordonnées MONDE (projection "triplanaire") : une brique ou une tôle a
// la même taille réelle partout, quelle que soit la taille de l'objet.
//
// Les images viennent de public/textures/map/ (générées par
// tools/gen_map_textures.py ; tu peux les remplacer par des packs CC0, par
// exemple ambientCG ou Poly Haven, en gardant les mêmes noms de fichiers).
//   <nom>_albedo.jpg  couleur
//   <nom>_normal.jpg  relief (normale OpenGL)
//   <nom>_orm.jpg     R = occlusion, G = rugosité, B = métallique
//
// Ajouter ?notex à l'adresse de la page désactive les textures (pour comparer).
// ---------------------------------------------------------------------------
import * as THREE from 'three';

// `tile` = taille réelle (en mètres) couverte par UNE répétition de l'image.
const TEXTURE_SETS = {
  asphalt: { tile: 4.0, normalScale: 0.9, macro: 0.16 },
  concrete: { tile: 4.0, normalScale: 1.0, macro: 0.14 },
  brick: { tile: 2.2, normalScale: 1.0, macro: 0.14 },
  metal: { tile: 2.0, normalScale: 1.0, macro: 0.12 },
  crate: { tile: 2.5, normalScale: 1.0, macro: 0.12 },
};

// Rôle d'un objet -> image utilisée + teinte (multiplie la couleur de l'image).
const SURFACES = {
  ground: { set: 'asphalt', tint: 0xd0d0d0 },
  wallOuter: { set: 'concrete', tint: 0xd2d0cc, tileScale: 2 }, // murs d'enceinte de 50 m : panneaux 2x plus grands
  building: { set: 'brick', tint: 0xffffff }, // les 4 grands bâtiments percés
  wall: { set: 'concrete', tint: 0xffffff }, // murs et cloisons
  barrier: { set: 'concrete', tint: 0xe6e0d4 }, // grandes barrières épaisses
  slab: { set: 'concrete', tint: 0xc4c2be }, // dalles, planchers, toits
  crate: { set: 'crate', tint: 0xffffff }, // blocs de couverture / conteneurs
  metal: { set: 'metal', tint: 0xffffff }, // rampes, pylône, poteaux, cônes
};

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();

// Renvoie le rôle d'un objet de la carte, ou null pour le laisser tel quel.
function classify(mesh) {
  const name = mesh.name || '';
  const materialName = mesh.material?.name || '';

  // Décors de zones de départ : on garde leur matériau d'origine (lisibilité).
  if (/^Spawn/i.test(name)) return null;
  if (materialName === 'Motif neutre' || materialName === 'Material') return null;

  _box.setFromObject(mesh);
  _box.getSize(_size);
  _box.getCenter(_center);
  const triangles = mesh.geometry.index ? mesh.geometry.index.count / 3 : mesh.geometry.attributes.position.count / 3;
  const horizontalMin = Math.min(_size.x, _size.z);
  const horizontalMax = Math.max(_size.x, _size.z);

  if (name === 'Cube') return 'ground'; // le sol de 150 x 150 m
  if (_size.y > 40 && horizontalMin < 4) return 'wallOuter';
  if (triangles > 500 && _size.y > 8 && _size.y < 12 && horizontalMax > 18) return 'building';
  if (/^(Cone|Sphere|Cylinder)/i.test(name)) return 'metal';
  if (_size.y <= 0.6 && _size.x >= 2 && _size.z >= 2) return 'slab';
  if (_size.x < 1.2 && _size.z < 1.2 && _size.y > 2) return 'metal'; // poteaux
  if (_center.y > 11) return 'metal'; // pylône central
  if (Math.abs(mesh.quaternion.w) < 0.999 && _size.y > 1) return 'metal'; // rampes inclinées
  if (_size.y >= 1.3 && _size.y <= 6 && horizontalMin >= 1.3 && horizontalMax <= 10) return 'crate';
  if (horizontalMin >= 0.9 && _size.y >= 4) return 'barrier';
  return 'wall';
}

// --------------------------------------------------------------------------- shader
const VERTEX_PARS = /* glsl */ `
varying vec3 vTriPos;
varying vec3 vTriNrm;
`;

const VERTEX_MAIN = /* glsl */ `
vTriPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vTriNrm = normalize( transpose( inverse( mat3( modelMatrix ) ) ) * objectNormal );
`;

const FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uTriAlbedo;
uniform sampler2D uTriNormal;
uniform sampler2D uTriOrm;
uniform float uTriInvTile;
uniform float uTriNormalScale;
uniform float uTriMacro;
varying vec3 vTriPos;
varying vec3 vTriNrm;

float triHash( vec2 p ) {
  p = fract( p * vec2( 123.34, 456.21 ) );
  p += dot( p, p + 45.32 );
  return fract( p.x * p.y );
}
float triValueNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( triHash( i ), triHash( i + vec2( 1.0, 0.0 ) ), f.x ),
              mix( triHash( i + vec2( 0.0, 1.0 ) ), triHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
`;

// Remplace map_fragment : tout est calculé ici, une seule fois par pixel.
const FRAGMENT_MAP = /* glsl */ `
vec3 triN = normalize( vTriNrm );
vec3 triW = pow( abs( triN ), vec3( 6.0 ) );
triW /= ( triW.x + triW.y + triW.z );
vec3 triS = vec3( triN.x >= 0.0 ? 1.0 : -1.0, triN.y >= 0.0 ? 1.0 : -1.0, triN.z >= 0.0 ? 1.0 : -1.0 );
vec3 triAlb = vec3( 0.0 );
vec3 triOrm = vec3( 0.0 );
vec3 triBent = vec3( 0.0 );
float triMacroNoise = 0.0;
if ( triW.x > 0.004 ) {
  vec2 uv = vTriPos.zy * uTriInvTile;
  vec3 t = texture2D( uTriNormal, uv ).xyz * 2.0 - 1.0;
  t.xy *= uTriNormalScale;
  t.x *= -triS.x;
  triAlb += texture2D( uTriAlbedo, uv ).rgb * triW.x;
  triOrm += texture2D( uTriOrm, uv ).rgb * triW.x;
  triBent += vec3( triN.x, triN.y + t.y, triN.z + t.x ) * triW.x;
  triMacroNoise += ( triValueNoise( uv * 0.29 ) * 0.65 + triValueNoise( uv * 0.83 + 7.1 ) * 0.35 ) * triW.x;
}
if ( triW.y > 0.004 ) {
  vec2 uv = vTriPos.xz * uTriInvTile;
  vec3 t = texture2D( uTriNormal, uv ).xyz * 2.0 - 1.0;
  t.xy *= uTriNormalScale;
  t.x *= -triS.y;
  triAlb += texture2D( uTriAlbedo, uv ).rgb * triW.y;
  triOrm += texture2D( uTriOrm, uv ).rgb * triW.y;
  triBent += vec3( triN.x + t.x, triN.y, triN.z + t.y ) * triW.y;
  triMacroNoise += ( triValueNoise( uv * 0.29 + 3.7 ) * 0.65 + triValueNoise( uv * 0.83 + 1.3 ) * 0.35 ) * triW.y;
}
if ( triW.z > 0.004 ) {
  vec2 uv = vTriPos.xy * uTriInvTile;
  vec3 t = texture2D( uTriNormal, uv ).xyz * 2.0 - 1.0;
  t.xy *= uTriNormalScale;
  t.x *= triS.z;
  triAlb += texture2D( uTriAlbedo, uv ).rgb * triW.z;
  triOrm += texture2D( uTriOrm, uv ).rgb * triW.z;
  triBent += vec3( triN.x + t.x, triN.y + t.y, triN.z ) * triW.z;
  triMacroNoise += ( triValueNoise( uv * 0.29 + 9.2 ) * 0.65 + triValueNoise( uv * 0.83 + 4.4 ) * 0.35 ) * triW.z;
}
// variation à grande échelle : casse la répétition visible de la texture
diffuseColor.rgb *= triAlb * mix( 1.0 - uTriMacro, 1.0 + uTriMacro, triMacroNoise );
`;

function patchShader(shader, textures, set, tile) {
  shader.uniforms.uTriAlbedo = { value: textures.albedo };
  shader.uniforms.uTriNormal = { value: textures.normal };
  shader.uniforms.uTriOrm = { value: textures.orm };
  shader.uniforms.uTriInvTile = { value: 1 / tile };
  shader.uniforms.uTriNormalScale = { value: set.normalScale };
  shader.uniforms.uTriMacro = { value: set.macro };

  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_MAIN}`);

  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
    .replace('#include <map_fragment>', FRAGMENT_MAP)
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * triOrm.g;')
    .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metalness * triOrm.b;')
    .replace(
      '#include <normal_fragment_maps>',
      'normal = normalize( ( viewMatrix * vec4( normalize( triBent ), 0.0 ) ).xyz ) * faceDirection;'
    )
    .replace(
      '#include <aomap_fragment>',
      'reflectedLight.indirectDiffuse *= mix( 1.0, triOrm.r, 0.9 );'
    );
}

// --------------------------------------------------------------------------- chargement
export function mapTexturesDisabled() {
  try {
    return new URLSearchParams(window.location.search).has('notex');
  } catch {
    return false;
  }
}

/**
 * Charge toutes les images. À lancer le plus tôt possible (en parallèle de map.glb).
 * Renvoie une Promise : { asphalt: {albedo, normal, orm}, ... } ou null (désactivé / échec).
 * Un échec ne bloque jamais le jeu : la carte garde simplement ses matériaux gris.
 */
export function loadMapTextureSets(renderer) {
  if (mapTexturesDisabled()) return Promise.resolve(null);

  const loader = new THREE.TextureLoader();
  const anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() ?? 1);

  const load = (file, srgb) =>
    loader.loadAsync(new URL(`./textures/map/${file}`, document.baseURI).href).then((texture) => {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = anisotropy;
      texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      return texture;
    });

  const names = Object.keys(TEXTURE_SETS);
  return Promise.all(
    names.map(async (name) => {
      const [albedo, normal, orm] = await Promise.all([
        load(`${name}_albedo.jpg`, true),
        load(`${name}_normal.jpg`, false),
        load(`${name}_orm.jpg`, false),
      ]);
      return [name, { albedo, normal, orm }];
    })
  )
    .then((entries) => Object.fromEntries(entries))
    .catch((error) => {
      console.error('[MAP-TEXTURES] Chargement des textures impossible, la carte reste grise :', error);
      return null;
    });
}

/**
 * Remplace les matériaux des objets de `root` (la scène de map.glb).
 * `ambiance` : l'objet de ambiance.js — ses ombres en cascade (CSM) doivent
 * préparer les matériaux AVANT que notre shader s'ajoute par-dessus.
 */
export function applyMapTextures(root, sets, { ambiance = null } = {}) {
  if (!sets) return { applied: 0, byRole: {} };

  const materials = new Map(); // rôle -> matériau partagé
  const byRole = {};
  let applied = 0;

  root.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;
    const role = classify(child);
    if (!role) return;

    let material = materials.get(role);
    if (!material) {
      const surface = SURFACES[role];
      material = new THREE.MeshStandardMaterial({
        name: `map-${role}`,
        color: surface.tint,
        roughness: 1, // multipliés par la texture ORM dans le shader
        metalness: 1,
        side: child.material?.side ?? THREE.FrontSide,
      });
      material.userData.mapTexture = { role, set: surface.set };
      materials.set(role, material);
    }
    child.material = material;
    byRole[role] = (byRole[role] || 0) + 1;
    applied++;
  });

  // 1) les ombres en cascade préparent d'abord le matériau (elles remplacent onBeforeCompile)…
  if (ambiance?.registerObject) ambiance.registerObject(root);

  // 2) …puis on ajoute notre shader par-dessus, en gardant le leur.
  materials.forEach((material) => {
    const { set: setName, role } = material.userData.mapTexture;
    const textures = sets[setName];
    const set = TEXTURE_SETS[setName];
    const tile = set.tile * (SURFACES[role].tileScale || 1);
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = function (shader, renderer) {
      previous?.call(this, shader, renderer);
      patchShader(shader, textures, set, tile);
    };
    material.customProgramCacheKey = () => 'map-triplanar-v1';
    material.needsUpdate = true;
  });

  console.info(
    `[MAP-TEXTURES] ${applied} objet(s) texturé(s) :`,
    Object.entries(byRole).map(([role, n]) => `${role} ${n}`).join(', ')
  );
  return { applied, byRole };
}
