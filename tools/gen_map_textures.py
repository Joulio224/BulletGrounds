#!/usr/bin/env python3
"""
Génère les textures de la map (style urbain / militaire, façon Warzone).

Chaque matériau produit 3 images SANS COUTURE, en 1024 px :
  <nom>_albedo.jpg   couleur (sRGB)
  <nom>_normal.jpg   relief (normale tangente, convention OpenGL : vert = haut)
  <nom>_orm.jpg      R = occlusion ambiante, G = rugosité, B = métallique

Utilisation :  python3 tools/gen_map_textures.py [dossier_de_sortie]
Dépendances :  pip install numpy pillow
Par défaut les fichiers vont dans public/textures/map/.

Tout est procédural et déterministe (graines fixes) : relancer le script donne
exactement les mêmes images. Pour changer l'allure d'un matériau, modifie les
couleurs de base ou les "graines" (seed) en haut de chaque fonction.
"""
import os
import sys

import numpy as np
from PIL import Image

SIZE = 1024
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'public', 'textures', 'map')


# --------------------------------------------------------------------------- outils
def noise(seed, beta=1.0, aniso=(1.0, 1.0), size=SIZE):
    """Bruit sans couture par synthèse spectrale (amplitude ~ 1/f^beta), normalisé ~[0,1]."""
    rng = np.random.default_rng(seed)
    f = np.fft.fftfreq(size)
    fx, fy = np.meshgrid(f * aniso[0], f * aniso[1])
    r = np.sqrt(fx ** 2 + fy ** 2)
    r[0, 0] = 1.0
    spec = np.fft.fft2(rng.standard_normal((size, size))) / (r ** beta)
    spec[0, 0] = 0.0
    n = np.real(np.fft.ifft2(spec))
    lo, hi = np.percentile(n, [1, 99])
    return np.clip((n - lo) / (hi - lo), 0.0, 1.0)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def grid(size=SIZE):
    y, x = np.mgrid[0:size, 0:size].astype(np.float64)
    return x / size, y / size  # u (colonnes), v (lignes, vers le bas)


def height_to_normal(h, strength):
    """Hauteur -> normale tangente (OpenGL). `strength` en 'pixels de hauteur' par pixel."""
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    d_row = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
    nx = -dx * strength
    ny = d_row * strength  # les lignes vont vers le bas, v vers le haut
    nz = np.ones_like(h)
    length = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
    return np.stack([nx / length, ny / length, nz / length], axis=-1)


def cavity(h, radius_noise_seed=0):
    """Occlusion ambiante bon marché : les creux sont plus sombres."""
    blur = h.copy()
    for shift in (3, 7, 15):
        blur = 0.5 * blur + 0.125 * (
            np.roll(blur, shift, 0) + np.roll(blur, -shift, 0) + np.roll(blur, shift, 1) + np.roll(blur, -shift, 1)
        )
    ao = np.clip(1.0 - np.clip(blur - h, 0, None) * 6.0, 0.55, 1.0)
    for _ in range(2):  # lissage : l AO ne doit pas coder du grain pixel par pixel
        ao = 0.5 * ao + 0.125 * (np.roll(ao, 1, 0) + np.roll(ao, -1, 0) + np.roll(ao, 1, 1) + np.roll(ao, -1, 1))
    return ao


def save(name, albedo, normal, rough, metal, ao, height_strength=None):
    os.makedirs(OUT, exist_ok=True)

    def to_img(a):
        return Image.fromarray(np.clip(a * 255.0 + 0.5, 0, 255).astype(np.uint8))

    to_img(albedo).save(os.path.join(OUT, f'{name}_albedo.jpg'), quality=88, subsampling=2)
    to_img(normal * 0.5 + 0.5).save(os.path.join(OUT, f'{name}_normal.jpg'), quality=84, subsampling=0)
    orm = np.stack([ao, rough, metal], axis=-1)
    to_img(orm).save(os.path.join(OUT, f'{name}_orm.jpg'), quality=80, subsampling=0)
    print('  ->', name)


def tint(rgb, factor_map):
    return np.stack([c * factor_map for c in rgb], axis=-1)


# --------------------------------------------------------------------------- asphalte (sol)
def make_asphalt():
    u, v = grid()
    grain = noise(11, 0.15)  # grain très fin
    mid = noise(12, 0.7)
    big = noise(13, 1.3)
    base = 0.25 + 0.10 * grain + 0.04 * mid
    # gravillons clairs
    gravel = smoothstep(0.86, 0.95, noise(14, 0.05))
    base = base + gravel * 0.16
    # grandes taches (usure, poussière)
    base = base * (0.92 + 0.16 * big)
    # fissures : crêtes d'un bruit déformé
    warp = noise(15, 1.4)
    ridge = np.abs(noise(16, 1.1) - 0.5 + (warp - 0.5) * 0.06)
    cracks = 1.0 - smoothstep(0.004, 0.014, ridge)
    cracks *= smoothstep(0.35, 0.65, noise(17, 1.5))  # seulement par endroits
    base = base * (1.0 - 0.75 * cracks)
    # taches d'huile / mouillé
    oil = smoothstep(0.88, 0.94, noise(18, 0.9))  # petites flaques d huile, rares
    base = base * (1.0 - 0.22 * oil)
    # marques claires de poussière
    dust = smoothstep(0.55, 0.85, noise(19, 1.2))
    base = base + dust * 0.015

    albedo = np.stack([base * 1.00, base * 1.00, base * 1.04], axis=-1)
    albedo[..., 0] += oil * 0.0
    height = grain * 0.5 + gravel * 0.9 + mid * 0.6 - cracks * 2.5
    normal = height_to_normal(height, 2.2)
    rough = np.clip(0.90 - 0.5 * oil + 0.03 * gravel, 0.3, 1.0)
    metal = np.zeros_like(rough)
    ao = cavity(height) * (1.0 - 0.3 * cracks)
    save('asphalt', albedo, normal, rough, metal, ao)


# --------------------------------------------------------------------------- béton (murs, dalles, barrières)
def make_concrete():
    u, v = grid()
    grain = noise(21, 0.2)
    mid = noise(22, 0.8)
    big = noise(23, 1.2)
    base = 0.50 + 0.05 * grain + 0.04 * mid
    base = base * (0.86 + 0.30 * big)

    # banches de coffrage : panneaux de 2 m x 1 m (tuile = 4 m) -> 2 colonnes, 4 lignes
    cols, rows = 2, 4
    fu = (u * cols) % 1.0
    fv = (v * rows) % 1.0
    seam_w = 0.012
    seam_u = np.minimum(fu, 1 - fu) / (1.0 / cols) * 1.0  # distance au joint vertical
    seam_v = np.minimum(fv, 1 - fv) / (1.0 / rows) * 1.0
    seam = 1.0 - smoothstep(0.0, seam_w * 2.0, np.minimum(np.minimum(fu, 1 - fu) / cols, np.minimum(fv, 1 - fv) / rows))
    # trous de banche (tirants) : 4 par panneau
    holes = np.zeros_like(base)
    for hx in (0.12, 0.88):
        for hy in (0.2, 0.8):
            du = (fu - hx) / cols
            dv = (fv - hy) / rows
            d = np.sqrt(du ** 2 + dv ** 2)
            holes = np.maximum(holes, 1.0 - smoothstep(0.0045, 0.0075, d))
    # pores
    pores = smoothstep(0.935, 0.975, noise(24, 0.05))
    # coulures verticales
    streak = smoothstep(0.50, 0.80, noise(25, 1.1, aniso=(0.07, 1.0)))
    streak2 = smoothstep(0.55, 0.85, noise(26, 0.9, aniso=(0.04, 1.0)))
    base = base * (1.0 - 0.17 * streak - 0.10 * streak2)
    base = base * (1.0 - 0.45 * seam) * (1.0 - 0.7 * holes) * (1.0 - 0.35 * pores)
    # léger écaillage / reprises plus claires
    patch = smoothstep(0.62, 0.8, noise(27, 1.4))
    base = base + patch * 0.04

    albedo = np.stack([base * 1.00, base * 0.985, base * 0.95], axis=-1)
    height = grain * 0.4 + mid * 0.5 - seam * 3.0 - holes * 4.0 - pores * 1.2 + patch * 0.4
    normal = height_to_normal(height, 1.6)
    rough = np.clip(0.86 - 0.07 * patch - 0.1 * streak, 0.5, 1.0)
    metal = np.zeros_like(rough)
    ao = cavity(height) * (1.0 - 0.25 * seam) * (1.0 - 0.4 * holes)
    save('concrete', albedo, normal, rough, metal, ao)


# --------------------------------------------------------------------------- brique (tuile ~ 2,2 m)
def make_brick():
    u, v = grid()
    bricks_x, courses = 10, 28
    cw = SIZE / bricks_x      # largeur d'une brique (px)
    ch = SIZE / courses       # hauteur d'une assise (px)
    xs = np.arange(SIZE, dtype=np.float64)[None, :].repeat(SIZE, 0)
    ys = np.arange(SIZE, dtype=np.float64)[:, None].repeat(SIZE, 1)
    row = np.floor(ys / ch).astype(int)
    offs = np.where(row % 2 == 0, 0.0, cw / 2.0)
    bx = (xs + offs) % SIZE
    col = np.floor(bx / cw).astype(int)
    lx = (bx - col * cw) / cw         # 0..1 dans la brique
    ly = (ys - row * ch) / ch
    mortar_x = 0.05
    mortar_y = 0.14
    # profil de brique : plateau arrondi
    ex = np.minimum(lx, 1 - lx) / mortar_x
    ey = np.minimum(ly, 1 - ly) / mortar_y
    plateau = smoothstep(0.6, 2.2, np.minimum(ex, ey))
    is_brick = smoothstep(0.55, 1.05, np.minimum(ex, ey))

    rng = np.random.default_rng(31)
    per_brick = rng.random((courses, bricks_x + 1))
    per_brick2 = rng.random((courses, bricks_x + 1))
    pick = per_brick[row % courses, col % bricks_x]
    pick2 = per_brick2[row % courses, col % bricks_x]
    palette = np.array([[0.46, 0.21, 0.15], [0.52, 0.25, 0.17], [0.40, 0.19, 0.14], [0.55, 0.30, 0.21], [0.33, 0.17, 0.13]])
    idx = np.clip((pick * len(palette)).astype(int), 0, len(palette) - 1)
    brick_rgb = palette[idx] * np.array([0.96, 0.97, 0.98])
    brick_rgb = brick_rgb * (0.88 + 0.24 * pick2)[..., None]
    grain = noise(32, 0.25)
    mid = noise(33, 0.9)
    brick_rgb = brick_rgb * (0.82 + 0.34 * grain)[..., None] * (0.9 + 0.2 * mid)[..., None]
    mortar_rgb = np.stack([0.50 + 0.1 * grain, 0.48 + 0.1 * grain, 0.44 + 0.1 * grain], axis=-1) * (0.9 + 0.2 * mid)[..., None]
    albedo = brick_rgb * is_brick[..., None] + mortar_rgb * (1 - is_brick[..., None])
    # poussière / salpêtre vers le bas de chaque zone
    streak = smoothstep(0.55, 0.85, noise(34, 1.0, aniso=(0.08, 1.0)))
    albedo = albedo * (1.0 - 0.10 * streak)[..., None]
    soot = smoothstep(0.62, 0.85, noise(35, 1.4))
    albedo = albedo * (1.0 - 0.12 * soot)[..., None]

    height = plateau * 3.0 + grain * 0.8 + mid * 0.8
    normal = height_to_normal(height, 1.35)
    rough = np.clip(0.90 - 0.04 * plateau, 0.6, 1.0)
    metal = np.zeros_like(rough)
    ao = cavity(height) * (0.7 + 0.3 * is_brick)
    save('brick', albedo, normal, rough, metal, ao)


# --------------------------------------------------------------------------- acier peint (structures, rampes) tuile ~ 2 m
def make_metal():
    u, v = grid()
    grain = noise(41, 0.2)
    mid = noise(42, 0.8)
    big = noise(43, 1.3)
    # plaques de 1 m (2x2) avec joints et rivets
    n = 2
    fu = (u * n) % 1.0
    fv = (v * n) % 1.0
    dist_edge = np.minimum(np.minimum(fu, 1 - fu), np.minimum(fv, 1 - fv)) / n
    seam = 1.0 - smoothstep(0.0015, 0.004, dist_edge)
    rivets = np.zeros_like(grain)
    for k in range(8):
        t = (k + 0.5) / 8
        for (cx, cy) in ((t, 0.03), (t, 0.97), (0.03, t), (0.97, t)):
            du = ((fu - cx + 0.5) % 1.0 - 0.5) / n
            dv = ((fv - cy + 0.5) % 1.0 - 0.5) / n
            rivets = np.maximum(rivets, 1.0 - smoothstep(0.0026, 0.0038, np.sqrt(du ** 2 + dv ** 2)))
    # peinture gris-vert de service
    paint = np.stack([0.20, 0.22, 0.20], axis=-1)[None, None, :] * np.ones((SIZE, SIZE, 1))
    paint = paint * (0.85 + 0.3 * mid)[..., None]
    # usure : bords, rayures, éclats
    scratches = smoothstep(0.78, 0.9, noise(44, 0.7, aniso=(1.0, 0.12))) * smoothstep(0.4, 0.8, noise(45, 1.0))
    scratches2 = smoothstep(0.80, 0.92, noise(46, 0.7, aniso=(0.1, 1.0))) * smoothstep(0.4, 0.8, noise(47, 1.0))
    edge_wear = (1.0 - smoothstep(0.0, 0.03, dist_edge)) * smoothstep(0.35, 0.7, noise(48, 1.0))
    chips = smoothstep(0.86, 0.93, noise(49, 0.3)) * smoothstep(0.45, 0.75, noise(50, 1.4))
    bare = np.clip(scratches * 0.8 + scratches2 * 0.8 + edge_wear + chips, 0, 1)
    # rouille
    rust_zone = smoothstep(0.58, 0.78, noise(51, 1.3))
    rust = np.clip(rust_zone * (0.35 + 0.65 * smoothstep(0.35, 0.7, noise(52, 0.5))) + bare * 0.35 * rust_zone, 0, 1)
    steel = np.stack([0.50, 0.50, 0.52], axis=-1)[None, None, :] * (0.85 + 0.3 * grain)[..., None]
    rust_rgb = np.stack([0.34, 0.16, 0.07], axis=-1)[None, None, :] * (0.7 + 0.6 * noise(53, 0.4))[..., None]
    albedo = paint * (1 - bare[..., None]) + steel * bare[..., None]
    albedo = albedo * (1 - rust[..., None]) + rust_rgb * rust[..., None]
    albedo = albedo * (1 - 0.5 * seam[..., None]) * (0.92 + 0.2 * rivets[..., None])
    albedo = albedo * (0.88 + 0.24 * big)[..., None]

    height = grain * 0.3 + mid * 0.3 - seam * 2.5 + rivets * 2.2 - rust * 0.8
    normal = height_to_normal(height, 1.8)
    rough = np.clip(0.55 - 0.25 * bare + 0.35 * rust, 0.25, 1.0)
    metal = np.clip(0.25 + 0.55 * bare * (1 - rust) - 0.2 * rust, 0.0, 1.0)
    ao = cavity(height) * (1.0 - 0.3 * seam)
    save('metal', albedo, normal, rough, metal, ao)


# --------------------------------------------------------------------------- conteneur / bloc de couverture (tuile ~ 2,5 m)
def make_crate():
    u, v = grid()
    grain = noise(61, 0.2)
    mid = noise(62, 0.8)
    big = noise(63, 1.3)
    ribs = 20
    # ondulation verticale (tôle ondulée de conteneur), profil trapézoïdal
    phase = (u * ribs) % 1.0
    tri = np.abs(phase * 2 - 1)               # 0 au creux, 1 à la crête
    profile = smoothstep(0.15, 0.85, tri)
    # cadre : rails haut et bas de 7 % de la hauteur de la tuile (plats)
    frame = (v < 0.04) | (v > 0.96)
    profile = np.where(frame, 0.5, profile)
    # peinture vert militaire / sable
    paint = np.stack([0.30, 0.34, 0.21], axis=-1)[None, None, :] * np.ones((SIZE, SIZE, 1))
    paint = paint * (0.86 + 0.28 * mid)[..., None] * (0.92 + 0.16 * big)[..., None]
    # écaillage sur les crêtes
    chip = smoothstep(0.80, 0.9, noise(64, 0.4)) * smoothstep(0.45, 0.8, profile + 0.2)
    scratch = smoothstep(0.80, 0.92, noise(65, 0.7, aniso=(0.12, 1.0))) * smoothstep(0.4, 0.8, noise(66, 1.0))
    bare = np.clip(chip + scratch * 0.7, 0, 1)
    # coulures de rouille verticales
    rust_zone = smoothstep(0.56, 0.80, noise(67, 1.1, aniso=(0.05, 1.0)))
    rust = np.clip(rust_zone * (0.25 + 0.75 * bare + 0.2 * smoothstep(0.5, 0.8, noise(68, 0.6))), 0, 1)
    steel = np.stack([0.42, 0.42, 0.43], axis=-1)[None, None, :] * (0.85 + 0.3 * grain)[..., None]
    rust_rgb = np.stack([0.33, 0.15, 0.06], axis=-1)[None, None, :] * (0.7 + 0.6 * noise(69, 0.4))[..., None]
    albedo = paint * (1 - bare[..., None]) + steel * bare[..., None]
    albedo = albedo * (1 - rust[..., None]) + rust_rgb * rust[..., None]
    # creux plus sombres (ombre propre des ondulations)
    albedo = albedo * (0.78 + 0.22 * profile)[..., None]
    albedo = albedo * (1.0 - 0.16 * smoothstep(0.55, 0.85, noise(70, 1.0, aniso=(0.06, 1.0))))[..., None]

    height = profile * 5.0 + grain * 0.3 + mid * 0.3 - rust * 0.6
    normal = height_to_normal(height, 1.2)
    rough = np.clip(0.58 - 0.2 * bare + 0.3 * rust, 0.25, 1.0)
    metal = np.clip(0.2 + 0.6 * bare * (1 - rust) - 0.15 * rust, 0.0, 1.0)
    ao = cavity(height) * (0.8 + 0.2 * profile)
    save('crate', albedo, normal, rough, metal, ao)


if __name__ == '__main__':
    print('Génération des textures dans', os.path.abspath(OUT))
    make_asphalt()
    make_concrete()
    make_brick()
    make_metal()
    make_crate()
    print('Terminé.')
