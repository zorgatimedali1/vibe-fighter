import * as THREE from 'three';
import { STAGE_AFFINITY } from '../moves';

/**
 * Fighting-game arenas, built the way the classics do it:
 *
 *   1. a painted sky plate with a distinct sun or moon          z ÃƒÂ¢Ã¢â‚¬Â°Ã‹â€  ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢58
 *   2. a dominant far silhouette (castle, cliffs, giant statue) z ÃƒÂ¢Ã¢â‚¬Â°Ã‹â€  ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢40
 *   3. mid-ground architecture: walls, pillars, fences, torches  z ÃƒÂ¢Ã¢â‚¬Â°Ã‹â€  ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢22
 *   4. a near band: onlookers, rails, statues, practical lights  z ÃƒÂ¢Ã¢â‚¬Â°Ã‹â€  ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢11
 *   5. a readable floor material under the fighters              y = 0
 *
 * Six stages, each with its own palette, skyline and prop set. Parallax groups slide against the
 * camera, crowds bob, torches flicker and every arena has its own atmosphere field.
 */

export type Atmosphere = 'embers' | 'snow' | 'dust' | 'fireflies' | 'petals' | 'stars' | 'ash';
export type StageKind = 'castle' | 'pit' | 'lair' | 'airbase' | 'courtyard' | 'temple';

export interface StageTheme {
  id: string; name: string;
  skyTop: number; skyMid: number; skyBottom: number; horizon: number;
  fog: number; ground: number; groundTop: number;
  key: number; fill: number; rim: number; accent: number;
  kind: StageKind;
  atmosphere: Atmosphere;
  crowd: boolean;
  /** Onlooker tint (0xRRGGBB) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â crowds read as people when they are not one grey mass. */
  crowdTint?: number;
  /** Sun/moon painted on the sky plate. `x` is 0ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“1 across the plate. */
  orb?: { r: number; y: number; x?: number; color: number; glow: number; moon?: boolean };
  stars?: boolean;
  clouds?: number;
  /** Horizon bloom strength, 0ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“1. Day stages want less. */
  bloom?: number;
  /** Per-stage light levels (hemisphere, key, rim). */
  lights?: { hemi: number; key: number; rim: number };
}

export const THEMES: Record<string, StageTheme> = {
  /* ---------------- 1. Sunset castle bridge (Ryu / Suzaku energy) ---------------- */
  castle: {
    id: 'castle', name: 'Suzaku Castle',
    skyTop: 0x2a1030, skyMid: 0x8a2438, skyBottom: 0xff7a3d, horizon: 0xffd166,
    fog: 0x53202c, ground: 0x4a2e18, groundTop: 0x7a4a24,
    key: 0xffe3b0, fill: 0x7a2a3a, rim: 0xffc46b, accent: 0xff8a3d,
    kind: 'castle', atmosphere: 'petals', crowd: false, crowdTint: 0x3a2230,
    orb: { r: 36, y: 300, x: 0.44, color: 0xffe0a0, glow: 0.6 },
    clouds: 5, bloom: 0.55,
    lights: { hemi: 0.82, key: 2.6, rim: 1.6 },
  },

  /* ---------------- 2. Moonlit bridge over the spikes (The Pit) ---------------- */
  pit: {
    id: 'pit', name: 'The Pit',
    skyTop: 0x04060e, skyMid: 0x0e1730, skyBottom: 0x243a5e, horizon: 0xa8d4ff,
    fog: 0x0a1020, ground: 0x1e2232, groundTop: 0x2c3247,
    key: 0xdfe9ff, fill: 0x1a2a44, rim: 0x9ad7ff, accent: 0x5effc8,
    kind: 'pit', atmosphere: 'ash', crowd: false, crowdTint: 0x11182a,
    orb: { r: 54, y: 306, x: 0.56, color: 0xeaf4ff, glow: 0.66, moon: true },
    stars: true, bloom: 0.34,
    lights: { hemi: 0.58, key: 1.5, rim: 1.25 },
  },

  /* ---------------- 3. Lava lair (Goro's Lair energy) ---------------- */
  lair: {
    id: 'lair', name: "Goro's Lair",
    skyTop: 0x080305, skyMid: 0x1e0808, skyBottom: 0x4a1408, horizon: 0xff5a1f,
    fog: 0x1a0705, ground: 0x191110, groundTop: 0x261a16,
    key: 0xffc79a, fill: 0x4a160e, rim: 0xff6b2c, accent: 0xff8a3d,
    kind: 'lair', atmosphere: 'embers', crowd: false, crowdTint: 0x1a0e0a,
    orb: { r: 0, y: 0, color: 0x000000, glow: 0 },
    bloom: 0.65,
    lights: { hemi: 0.42, key: 1.25, rim: 1.4 },
  },

  /* ---------------- 4. Air base runway (Guile's stage) ---------------- */
  airbase: {
    id: 'airbase', name: 'Air Force Base',
    skyTop: 0x2f74b8, skyMid: 0x6fb0dc, skyBottom: 0xd9ecf7, horizon: 0xffe9b8,
    fog: 0xa8c8dd, ground: 0x454a52, groundTop: 0x565d66,
    key: 0xfff4dc, fill: 0x8fb4cc, rim: 0xffe9b8, accent: 0xffd166,
    kind: 'airbase', atmosphere: 'dust', crowd: true, crowdTint: 0x6d7350,
    clouds: 10, bloom: 0.16,
    lights: { hemi: 1.15, key: 2.9, rim: 1.1 },
  },

  /* ---------------- 5. Monastery courtyard at night ---------------- */
  courtyard: {
    id: 'courtyard', name: 'Monastery Courtyard',
    skyTop: 0x040814, skyMid: 0x0e1a30, skyBottom: 0x223650, horizon: 0xb9e6ff,
    fog: 0x0b1220, ground: 0x272a36, groundTop: 0x383d4b,
    key: 0xdfeaff, fill: 0x1c2740, rim: 0x9ad7ff, accent: 0xffb347,
    kind: 'courtyard', atmosphere: 'snow', crowd: true, crowdTint: 0x2a2130,
    orb: { r: 38, y: 308, x: 0.57, color: 0xdcefff, glow: 0.55, moon: true },
    stars: true, bloom: 0.3,
    lights: { hemi: 0.7, key: 1.65, rim: 1.3 },
  },

  /* ---------------- 6. Temple of the sun (Sagat / Thailand energy) ---------------- */
  temple: {
    id: 'temple', name: 'Temple of the Sun',
    skyTop: 0x3a1418, skyMid: 0xb03a1e, skyBottom: 0xffb347, horizon: 0xfff0b0,
    fog: 0x6b3320, ground: 0x6b3a22, groundTop: 0x8a4a28,
    key: 0xfff0cc, fill: 0x8a3a20, rim: 0xffc46b, accent: 0xffa53d,
    kind: 'temple', atmosphere: 'dust', crowd: false, crowdTint: 0x3a2418,
    orb: { r: 66, y: 274, x: 0.45, color: 0xfff2c0, glow: 0.75 },
    clouds: 3, bloom: 0.7,
    lights: { hemi: 0.95, key: 2.8, rim: 1.7 },
  },
};

const ORDER = ['castle', 'pit', 'lair', 'airbase', 'courtyard', 'temple'] as const;

/** Stable 32-bit string hash (FNV-1a). */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Every match gets its own stage, seeded by the match id and the pair of fighters. */
export function pickStage(matchId: string, fighters: [string, string]): StageTheme {
  const seed = hash(`${matchId}:${fighters[0]}:${fighters[1]}`);
  // Bias toward the two fighters' home turfs so the arena usually belongs to somebody.
  const pool = [STAGE_AFFINITY[fighters[0]], STAGE_AFFINITY[fighters[1]], ORDER[seed % ORDER.length]];
  return THEMES[pool[seed % 3]] ?? THEMES.castle;
}

export function affinityStage(fighterId: string): StageTheme {
  return THEMES[STAGE_AFFINITY[fighterId]] ?? THEMES.castle;
}

function rng(seed: number) {
  let s = seed || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; };
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/* ------------------------------- sky plates ------------------------------- */

/** Painted sky plate: gradient, clouds, stars, and a big sun/moon with real craters. */
function skyTexture(t: StageTheme): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d')!;

  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, hex(t.skyTop));
  grad.addColorStop(0.30, hex(t.skyTop));
  grad.addColorStop(0.52, hex(t.skyMid));
  grad.addColorStop(0.70, hex(t.skyBottom));
  grad.addColorStop(0.86, hex(t.fog));
  grad.addColorStop(1, hex(t.fog));
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 512);

  if (t.stars) {
    for (let i = 0; i < 220; i++) {
      const x = Math.random() * 1024, y = Math.random() * 260;
      const a = 0.12 + Math.random() * 0.6;
      g.fillStyle = `rgba(255,255,255,${a})`;
      const s = Math.random() < 0.1 ? 2 : 1;
      g.fillRect(x, y, s, s);
    }
  }

  // Soft painted clouds: wide, flat ellipses that catch the horizon colour.
  const clouds = t.clouds ?? 0;
  for (let i = 0; i < clouds; i++) {
    const cx = Math.random() * 1024;
    const cy = 150 + Math.random() * 170;
    const rx = 90 + Math.random() * 190;
    const ry = 12 + Math.random() * 26;
    const cg = g.createRadialGradient(cx, cy, 0, cx, cy, rx);
    const alpha = 0.10 + Math.random() * 0.14;
    cg.addColorStop(0, `rgba(255,255,255,${alpha})`);
    cg.addColorStop(0.55, `${hex(t.horizon)}22`);
    cg.addColorStop(1, `${hex(t.horizon)}00`);
    g.save(); g.translate(cx, cy); g.scale(1, ry / rx); g.translate(-cx, -cy);
    g.fillStyle = cg; g.beginPath(); g.arc(cx, cy, rx, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  // The orb: a hard disc plus a wide glow. Moons get craters, suns get a warm corona.
  if (t.orb && t.orb.r > 0) {
    const o = t.orb;
    const ox = Math.round((o.x ?? 0.5) * 1024);
    const glow = g.createRadialGradient(ox, o.y, o.r * 0.6, ox, o.y, o.r * 3.2);
    glow.addColorStop(0, `${hex(o.color)}${Math.round(o.glow * 140).toString(16).padStart(2, '0')}`);
    glow.addColorStop(0.45, `${hex(o.color)}22`);
    glow.addColorStop(1, `${hex(o.color)}00`);
    g.fillStyle = glow; g.fillRect(0, 0, 1024, 512);

    g.beginPath(); g.arc(ox, o.y, o.r, 0, Math.PI * 2);
    g.fillStyle = hex(o.color); g.fill();
    if (o.moon) {
      g.globalAlpha = 0.16; g.fillStyle = '#8fa4c0';
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * o.r * 0.62;
        g.beginPath();
        g.arc(ox + Math.cos(a) * d, o.y + Math.sin(a) * d, 2 + Math.random() * o.r * 0.16, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    }
  }

  // Horizon haze: tight band that lights the silhouettes without flooding the plate.
  const haze = g.createRadialGradient(512, 320, 10, 512, 320, 300);
  haze.addColorStop(0, `${hex(t.horizon)}66`);
  haze.addColorStop(0.4, `${hex(t.horizon)}22`);
  haze.addColorStop(1, `${hex(t.horizon)}00`);
  g.fillStyle = haze; g.fillRect(0, 0, 1024, 512);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/** Horizon bloom card behind the skyline. */
function horizonTexture(t: StageTheme): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  const rad = g.createRadialGradient(256, 200, 8, 256, 200, 250);
  rad.addColorStop(0, `${hex(t.horizon)}cc`);
  rad.addColorStop(0.32, `${hex(t.horizon)}55`);
  rad.addColorStop(0.68, `${hex(t.horizon)}14`);
  rad.addColorStop(1, `${hex(t.horizon)}00`);
  g.fillStyle = rad; g.fillRect(0, 0, 512, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

/** Vertical haze card: transparent at the top, glowing at the bottom. */
function hazeTexture(t: StageTheme): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, `${hex(t.horizon)}00`);
  grad.addColorStop(0.55, `${hex(t.horizon)}22`);
  grad.addColorStop(1, `${hex(t.horizon)}55`);
  g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

/** Soft round sprite used by every particle field. */
function dotTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const rad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  rad.addColorStop(0, 'rgba(255,255,255,1)');
  rad.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  rad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rad; g.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface Layer { group: THREE.Group; factor: number }
interface Flicker { mat: THREE.MeshStandardMaterial; base: number; phase: number; speed: number }
interface Crowd { mesh: THREE.InstancedMesh; base: Float32Array; phase: Float32Array; count: number }
interface Motes { points: THREE.Points; pos: Float32Array; vel: Float32Array; spread: THREE.Vector3; mode: Atmosphere }

/** Everything a stage builder needs: the three parallax bands plus material helpers. */
interface Ctx {
  theme: StageTheme;
  rand: () => number;
  far: THREE.Group;
  mid: THREE.Group;
  near: THREE.Group;
  mat: (c: number, opts?: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial;
  glow: (c: number, intensity?: number, flicker?: boolean) => THREE.MeshStandardMaterial;
  box: (parent: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rx?: number, ry?: number, rz?: number) => THREE.Mesh;
  cyl: (parent: THREE.Object3D, rt: number, rb: number, h: number, seg: number, m: THREE.Material, x: number, y: number, z: number) => THREE.Mesh;
  cone: (parent: THREE.Object3D, r: number, h: number, seg: number, m: THREE.Material, x: number, y: number, z: number) => THREE.Mesh;
  sphere: (parent: THREE.Object3D, r: number, m: THREE.Material, x: number, y: number, z: number, sx?: number, sy?: number, sz?: number) => THREE.Mesh;
}

/* ---------------------------- shared set pieces ---------------------------- */

/** Cloth banner hanging from a rod, with a swallow-tail cut. */
function banner(c: Ctx, parent: THREE.Group, x: number, y: number, z: number, w: number, h: number, color: number) {
  const cloth = c.mat(color, { side: THREE.DoubleSide });
  c.box(parent, w, h, 0.06, cloth, x, y - h / 2, z);
  c.box(parent, w * 0.34, h * 0.22, 0.06, cloth, x - w * 0.33, y - h - h * 0.1, z);
  c.box(parent, w * 0.34, h * 0.22, 0.06, cloth, x + w * 0.33, y - h - h * 0.1, z);
  c.cyl(parent, 0.05, 0.05, w * 1.14, 6, c.mat(0x2a2118), x, y, z).rotation.z = Math.PI / 2;
}

/** Iron torch: post, basket, flame. The flame is the only glowing part. */
function torch(c: Ctx, parent: THREE.Group, x: number, y: number, z: number, scale = 1) {
  const iron = c.mat(0x201a16);
  c.cyl(parent, 0.055 * scale, 0.075 * scale, 1.5 * scale, 6, iron, x, y + 0.75 * scale, z);
  c.cyl(parent, 0.19 * scale, 0.12 * scale, 0.3 * scale, 8, iron, x, y + 1.55 * scale, z);
  const flame = c.cone(parent, 0.17 * scale, 0.52 * scale, 7, c.glow(c.theme.accent, 2.6, true), x, y + 1.86 * scale, z);
  flame.scale.set(1, 1, 1);
}

/** Hanging paper lantern on a rope. */
function lantern(c: Ctx, parent: THREE.Group, x: number, y: number, z: number, color: number) {
  c.box(parent, 0.02, 0.7, 0.02, c.mat(0x1a1410), x, y + 0.35, z);
  c.sphere(parent, 0.19, c.glow(color, 1.9, true), x, y - 0.06, z, 1, 1.2, 1);
  c.box(parent, 0.12, 0.05, 0.12, c.mat(0x1a1410), x, y + 0.12, z);
}

/** Stone pillar with a cap. */
function pillar(c: Ctx, parent: THREE.Group, x: number, z: number, h: number, m: THREE.Material, cap: THREE.Material) {
  c.box(parent, 0.9, 0.28, 0.9, cap, x, 0.14, z);
  c.box(parent, 0.62, h, 0.62, m, x, h / 2 + 0.24, z);
  c.box(parent, 1.05, 0.3, 1.05, cap, x, h + 0.36, z);
}

/** A parked fighter jet, built from boxes so it still reads in the voxel style. */
function jet(c: Ctx, parent: THREE.Group, x: number, z: number, scale = 1) {
  const body = c.mat(0x9aa4ad), dark = c.mat(0x5a636b), glass = c.glow(0x9ad7ff, 0.8);
  c.cyl(parent, 0.5 * scale, 0.62 * scale, 5.4 * scale, 8, body, x, 1.25 * scale, z).rotation.x = Math.PI / 2;
  c.cone(parent, 0.5 * scale, 1.5 * scale, 8, body, x, 1.25 * scale, z + 3.4 * scale).rotation.x = -Math.PI / 2;
  // wings
  c.box(parent, 4.6 * scale, 0.12 * scale, 1.5 * scale, body, x, 1.2 * scale, z - 0.2 * scale);
  c.box(parent, 1.5 * scale, 0.12 * scale, 1.0 * scale, body, x, 1.3 * scale, z - 2.2 * scale);
  // tail fin
  c.box(parent, 0.14 * scale, 1.25 * scale, 1.15 * scale, dark, x, 1.95 * scale, z - 2.35 * scale);
  // canopy
  c.sphere(parent, 0.42 * scale, glass, x, 1.78 * scale, z + 1.15 * scale, 0.85, 0.55, 1.3);
  // intake glow
  c.box(parent, 0.7 * scale, 0.3 * scale, 0.1 * scale, c.glow(c.theme.accent, 1.4), x, 1.0 * scale, z + 3.9 * scale);
}

/** Chain: a run of small links, enough to read at silhouette distance. */
function chain(c: Ctx, parent: THREE.Group, x: number, yTop: number, z: number, len: number, m: THREE.Material) {
  const n = Math.max(3, Math.round(len / 0.42));
  for (let i = 0; i < n; i++) {
    c.box(parent, 0.11, 0.3, 0.11, m, x, yTop - i * 0.42, z, 0, 0, i % 2 ? 0.35 : -0.35);
  }
}

/** Skull pile: a few spheres with eye sockets, clustered on the floor. */
function skulls(c: Ctx, parent: THREE.Group, x: number, z: number, count: number, rand: () => number) {
  const bone = c.mat(0xc9bda4);
  for (let i = 0; i < count; i++) {
    const bx = x + (rand() - 0.5) * 1.9;
    const bz = z + (rand() - 0.5) * 1.2;
    const r = 0.13 + rand() * 0.09;
    c.sphere(parent, r, bone, bx, r * 0.9 + rand() * 0.32, bz, 1, 0.92, 1);
    c.box(parent, r * 0.5, r * 0.5, r * 0.3, c.mat(0x0d0a08), bx - r * 0.4, r * 1.0 + rand() * 0.3, bz + r * 0.8);
    c.box(parent, r * 0.5, r * 0.5, r * 0.3, c.mat(0x0d0a08), bx + r * 0.4, r * 1.0 + rand() * 0.3, bz + r * 0.8);
  }
}

/* ------------------------------- stage builders ------------------------------- */

/** Sunny castle bridge: tiled roofs, banners, cherry blossom and a low sun. */
function buildCastle(c: Ctx) {
  const { far, mid, near, rand } = c;
  const stone = c.mat(0x3a2a26), wood = c.mat(0x5a3418), roof = c.mat(0x2a1620), woodTop = c.mat(0x7a4a24);

  // far: mountain ridges + a two-tier castle on the horizon
  for (let i = 0; i < 7; i++) {
    const h = 8 + rand() * 9;
    c.cone(far, 7 + rand() * 5, h, 4, c.mat(0x35202c), -34 + i * 11 + rand() * 3, h / 2 - 2.2, -6 - rand() * 6);
  }
  for (const [cx, s] of [[-16, 1], [17, 0.82]] as const) {
    c.box(far, 9 * s, 5 * s, 5, stone, cx, 2.5 * s, -9);
    c.box(far, 11 * s, 0.7 * s, 6, roof, cx, 5.2 * s, -9);
    c.box(far, 6.5 * s, 3.4 * s, 4.4, stone, cx, 7.2 * s, -9);
    c.box(far, 8.5 * s, 0.8 * s, 5.2, roof, cx, 9.2 * s, -9);
    c.cone(far, 4.6 * s, 2.2 * s, 4, roof, cx, 10.7 * s, -9).rotation.y = Math.PI / 4;
  }

  // mid: bridge wall, railing and banner line
  c.box(mid, 34, 1.5, 1.2, stone, 0, 0.7, -8);
  for (let i = 0; i < 12; i++) {
    c.box(mid, 0.26, 1.25, 0.26, wood, -15.5 + i * 2.8, 1.55, -7.6);
  }
  c.box(mid, 33, 0.18, 0.34, woodTop, 0, 2.1, -7.6);
  c.box(mid, 33, 0.14, 0.3, woodTop, 0, 1.35, -7.6);
  for (const x of [-11, -4, 4, 11]) banner(c, mid, x, 5.6, -9.4, 1.5, 2.6, 0xb42a32);
  for (const x of [-13, -6, 6, 13]) lantern(c, mid, x, 4.2, -6.4, 0xffd9a0);

  // cherry trees behind the wall
  for (const [tx, s] of [[-9.5, 1], [9.5, 0.9]] as const) {
    c.cyl(mid, 0.22 * s, 0.34 * s, 3.4 * s, 6, c.mat(0x2e1a12), tx, 1.7 * s, -10.5);
    for (let i = 0; i < 5; i++) {
      c.sphere(mid, 1.1 * s, c.mat(0xff9ec4), tx + (rand() - 0.5) * 2.6, 3.6 * s + rand() * 1.1, -10.5 + (rand() - 0.5) * 1.4, 1.2, 0.7, 1);
    }
  }

  // near: front rope rail + stone lanterns
  for (const x of [-7.5, 7.5]) {
    pillar(c, near, x, -2.6, 2.2, c.mat(0x4a3a32), c.mat(0x2e241e));
    c.box(near, 0.7, 0.36, 0.7, c.glow(0xffd9a0, 1.6, true), x, 3.0, -2.6);
  }
  for (let i = 0; i < 14; i++) c.box(near, 0.42, 0.1, 0.1, c.mat(0x8a6a4a), -7 + i * 1.08, 0.92, 3.3, 0, 0, 0.05);

  // floor: warm cedar planks running toward the camera
  for (let i = 0; i < 26; i++) {
    const shade = i % 3 === 0 ? 0x5a3418 : i % 3 === 1 ? 0x6b3f1c : 0x7a4a24;
    c.box(near, 1.24, 0.03, 7.4, c.mat(shade), -16 + i * 1.28, 0.045, 2.2);
  }
}

/** The Pit: a stone bridge, moonlight, dead trees and a floor of spikes below. */
function buildPit(c: Ctx) {
  const { far, mid, near, rand } = c;
  const stone = c.mat(0x32384a), dark = c.mat(0x1a1e2c), moss = c.mat(0x22303a);

  // far: canyon walls and dead trees
  for (let i = 0; i < 6; i++) {
    const h = 12 + rand() * 12;
    const x = i % 2 ? 18 + rand() * 8 : -18 - rand() * 8;
    c.box(far, 7 + rand() * 5, h, 6, dark, x, h / 2 - 2, -8 - rand() * 8);
  }
  for (let i = 0; i < 9; i++) {
    const x = -22 + i * 5.4 + rand() * 2;
    const h = 4 + rand() * 5;
    c.cyl(far, 0.12, 0.26, h, 5, dark, x, h / 2 - 1.2, -12 - rand() * 6);
    for (let b = 0; b < 3; b++) {
      c.box(far, 1.5 + rand(), 0.1, 0.1, dark, x + (rand() - 0.5) * 1.6, h * 0.55 + b * 0.7, -12, 0, 0, (rand() - 0.5) * 0.9);
    }
  }

  // mid: the bridge railing right behind the fighters, then the drop and the spike bed
  c.box(mid, 44, 0.04, 22, c.mat(0x05070c), 0, 0.035, -7);
  for (let i = 0; i < 40; i++) {
    const x = -19 + i * 0.98 + (rand() - 0.5) * 0.3;
    c.cone(mid, 0.3, 1.5 + rand() * 1.5, 4, c.mat(0xb2bed2), x, 0.55, -1.2 - rand() * 7);
  }
  // iron railing + banner posts on the near edge of the chasm
  for (let i = 0; i < 17; i++) c.box(mid, 0.1, 1.35, 0.1, c.mat(0x14161e), -16 + i * 2, 1.05, 3.6);
  c.box(mid, 33, 0.09, 0.12, c.mat(0x14161e), 0, 1.75, 3.6);
  c.box(mid, 33, 0.07, 0.1, c.mat(0x2a3140), 0, 0.75, 3.6);
  for (const x of [-11, -3.5, 4, 11.5]) {
    c.box(mid, 0.26, 4.4, 0.26, c.mat(0x1e222e), x, 2.2, 3.4);
    banner(c, mid, x, 4.3, 3.2, 1.1, 1.9, 0x2a3a5e);
  }
  for (const x of [-8, 2, 9]) chain(c, mid, x, 4.4, 2.9, 2.2, c.mat(0x2a3140));
  for (const x of [-6, 7]) torch(c, mid, x, 0.1, 3.2, 1.05);

  // near: two braziers framing the arena, with green fire
  for (const x of [-8.6, 8.6]) {
    c.cyl(near, 0.2, 0.32, 1.2, 6, c.mat(0x1a1e28), x, 0.6, -1.2);
    c.cyl(near, 0.5, 0.28, 0.5, 8, c.mat(0x1a1e28), x, 1.4, -1.2);
    c.cone(near, 0.38, 1.0, 7, c.glow(0x5effc8, 2.2, true), x, 2.1, -1.2);
  }
  for (let i = 0; i < 12; i++) c.box(near, 0.5, 0.12, 0.12, c.mat(0x3a4254), -6 + i * 1.12, 1.4, 3.2);

  // floor: stone slabs
  for (let i = 0; i < 20; i++) {
    for (let j = 0; j < 3; j++) {
      c.box(near, 1.52, 0.03, 2.2, c.mat(i % 4 === 0 ? 0x232838 : 0x2b3244), -15 + i * 1.6, 0.045, 0.8 + j * 2.3);
    }
  }
}

/** Lava lair: cavern ceiling, lava falls, skulls and chains. */
function buildLair(c: Ctx) {
  const { far, mid, near, rand } = c;
  const rock = c.mat(0x241a16), rock2 = c.mat(0x1a1210), lava = c.glow(0xff5a1f, 2.1, true), bone = c.mat(0x8a7a62);

  // far: cave wall + a low ceiling of stalactites + lava falls
  c.box(far, 70, 26, 3, rock2, 0, 12, -12);
  for (let i = 0; i < 30; i++) {
    const x = -32 + i * 2.2 + rand();
    const h = 1.4 + rand() * 3.6;
    c.cone(far, 0.45 + rand() * 0.55, h, 5, rock2, x, 8.4 - h / 2, -11.2 + rand() * 1.4).rotation.x = Math.PI;
  }
  for (const x of [-13, -3, 7, 16]) {
    c.box(far, 0.5 + rand() * 0.5, 7.6 + rand() * 2.4, 0.4, lava, x, 3.9, -11.4);
  }
  for (let i = 0; i < 10; i++) {
    c.sphere(far, 0.7 + rand() * 1.5, rock, -26 + i * 5.8 + rand() * 2, rand() * 1.2, -9 - rand() * 3, 1.6, 0.5, 1);
  }

  // mid: rock columns, rib arch, lava pool
  for (const [x, s] of [[-11, 1], [11, 0.88]] as const) {
    c.cyl(mid, 1.1 * s, 1.5 * s, 9 * s, 6, rock, x, 4.4 * s, -9);
    c.box(mid, 2.4 * s, 0.4 * s, 2.4, rock2, x, 8.9 * s, -9);
  }
  // bone arch
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (0.12 + i * 0.095);
    c.box(mid, 0.26, 0.9, 0.26, bone, Math.cos(a) * 5.4, 3.4 + Math.sin(a) * 2.4, -10, 0, 0, -a + 1.2);
  }
  c.box(mid, 26, 0.07, 2.2, lava, 0, 0.05, -6.4);
  c.box(mid, 22, 0.03, 3.6, c.glow(0xff7a2a, 1.5, true), 0, 0.04, -9.6);   // lava pool behind the fight
  for (let i = 0; i < 7; i++) skulls(c, mid, -9 + i * 3 + rand(), -5.6 - rand() * 1.4, 4, c.rand);
  for (const x of [-7, 6]) chain(c, mid, x, 8.6, -8.4, 2.6, c.mat(0x2a221e));

  // near: braziers + hanging cages
  for (const x of [-8.2, 8.2]) {
    c.cyl(near, 0.16, 0.26, 1.1, 6, c.mat(0x2a221e), x, 0.55, -2.6);
    c.cyl(near, 0.42, 0.24, 0.5, 8, c.mat(0x2a221e), x, 1.32, -2.6);
    c.cone(near, 0.34, 0.9, 7, lava, x, 1.95, -2.6);
  }
  for (const x of [-4.4, 4.4]) {
    chain(c, near, x, 7.4, -3.2, 1.6, c.mat(0x1e1814));
    c.sphere(near, 0.34, bone, x, 5.2, -3.2, 1, 1.2, 1);
  }

  // floor: cracked basalt with glowing seams
  c.box(near, 34, 0.03, 7.2, c.mat(0x191110), 0, 0.045, 2.2);
  for (let i = 0; i < 26; i++) {
    c.box(near, 0.9 + rand() * 1.7, 0.02, 0.1 + rand() * 0.14, c.glow(0xff5a1f, 1.5 + rand(), true),
      -15 + rand() * 30, 0.06, -0.6 + rand() * 6.4, 0, rand() * 3.1, 0);
  }
}

/** Air base runway: tarmac, chain-link, hangar, a parked jet and an evening sky. */
function buildAirbase(c: Ctx) {
  const { far, mid, near, rand } = c;
  const steel = c.mat(0x6a737c), dark = c.mat(0x3a4048), concrete = c.mat(0x8a9099);

  // far: mountains + control tower
  for (let i = 0; i < 8; i++) {
    const h = 6 + rand() * 8;
    c.cone(far, 8 + rand() * 6, h, 4, c.mat(0x5b7186), -38 + i * 10, h / 2 - 1.5, -14 - rand() * 6);
  }
  c.box(far, 5, 9, 5, c.mat(0x7c8792), 15, 4, -16);
  c.box(far, 8, 1.6, 5.4, c.mat(0x6a737c), 15, 9.2, -16);
  c.box(far, 6.6, 1.1, 0.2, c.glow(0x9ad7ff, 1.1), 15, 9.2, -13.6);
  c.cyl(far, 0.12, 0.12, 3, 4, c.mat(0x3a4048), 15, 11.5, -16);

  // mid: hangar + chain-link fence + jet
  c.box(mid, 16, 6.4, 6, c.mat(0x525a63), -11, 3.2, -13);
  c.box(mid, 12, 4.4, 0.3, c.mat(0x1a1e22), -11, 2.2, -10);
  c.box(mid, 16.6, 0.4, 6.4, c.mat(0x3a4048), -11, 6.5, -13);
  for (let i = 0; i < 30; i++) {
    const x = -17 + i * 1.2;
    c.box(mid, 0.05, 1.9, 0.05, c.mat(0x8a9099), x, 1.1, -8.6);
  }
  for (const y of [0.5, 1.2, 1.9]) c.box(mid, 34, 0.05, 0.05, c.mat(0x8a9099), 0, y, -8.6);
  c.box(mid, 34, 0.14, 0.14, c.mat(0x5a636b), 0, 2.1, -8.6);
  jet(c, mid, 9.5, -11, 0.95);
  for (const x of [-6, -4.6, 5.4]) {
    c.cyl(mid, 0.35, 0.35, 0.9, 8, c.mat(0x2f6b3a), x, 0.45, -5.6);
    c.cyl(mid, 0.35, 0.35, 0.9, 8, c.mat(0x8a3a2a), x + 1.2, 0.45, -6.2);
  }

  // near: fuel drums + a wind sock
  for (let i = 0; i < 5; i++) {
    c.cyl(near, 0.34, 0.34, 0.8, 8, c.mat(0x4a5a6a), -8.4 + i * 0.9, 0.4, -3.4 - (i % 2) * 0.6);
  }
  c.cyl(near, 0.05, 0.05, 3.2, 5, c.mat(0x5a636b), 8.8, 1.6, -2.2);
  c.box(near, 1.1, 0.36, 0.06, c.mat(0xff8a3d), 9.35, 3.1, -2.2, 0, 0, 0.12);

  // floor: tarmac + painted runway lines
  c.box(near, 34, 0.03, 7.4, c.mat(0x454a52), 0, 0.045, 2.2);
  for (let i = 0; i < 9; i++) {
    c.box(near, 1.5, 0.02, 0.18, c.mat(0xd8d2c4), -13 + i * 3.4, 0.06, 4.6);
  }
  c.box(near, 34, 0.02, 0.12, c.mat(0xd8d2c4), 0, 0.075, -0.4);
  c.box(near, 34, 0.02, 0.12, c.mat(0xd8d2c4), 0, 0.075, 1.2);
}

/** Night courtyard: gate, pillars, incense and watching monks. */
function buildCourtyard(c: Ctx) {
  const { far, mid, near, rand } = c;
  const stone = c.mat(0x3a3e4e), stone2 = c.mat(0x2a2e3c), wood = c.mat(0x4a2a22);

  // far: outer wall with a lit gate + mountains
  for (let i = 0; i < 6; i++) {
    const h = 7 + rand() * 8;
    c.cone(far, 9 + rand() * 5, h, 4, c.mat(0x16202e), -34 + i * 13, h / 2 - 1.5, -18 - rand() * 5);
  }
  c.box(far, 46, 4.6, 3, stone2, 0, 2.3, -12);
  c.box(far, 7.4, 6.2, 3.4, stone, 0, 3.1, -12);
  c.box(far, 8.8, 0.7, 4, stone2, 0, 6.6, -12);
  c.box(far, 5.6, 4.6, 0.3, c.glow(0xffb347, 0.75), 0, 2.5, -10.4);
  // gate roof
  c.box(far, 12.4, 0.7, 4.8, wood, 0, 7.2, -12);
  c.cone(far, 6.6, 2.6, 4, wood, 0, 8.6, -12).rotation.y = Math.PI / 4;

  // mid: pillar colonnade + banners + incense
  for (let i = 0; i < 6; i++) {
    const x = -13.5 + i * 5.4;
    pillar(c, mid, x, -8.4, 5.2, stone, stone2);
    if (i % 2 === 0) lantern(c, mid, x, 6.4, -7.2, 0xffb347);
  }
  for (const x of [-8, 0, 8]) banner(c, mid, x, 6.2, -6.6, 1.4, 3.2, 0x8a2a2a);
  for (let i = 0; i < 3; i++) {
    c.cyl(mid, 0.5, 0.7, 0.5, 8, c.mat(0x2a2a30), -5 + i * 5, 0.25, -5.4);
    c.box(mid, 0.1, 1.1, 0.1, c.glow(0xffe0a0, 0.9, true), -5 + i * 5, 0.95, -5.4);
  }

  // near: stone lions on plinths
  for (const x of [-8.8, 8.8]) {
    c.box(near, 1.2, 1.3, 1.2, stone2, x, 0.65, -2.6);
    c.box(near, 0.85, 0.8, 1.1, stone, x, 1.7, -2.6);
    c.sphere(near, 0.36, stone, x, 2.3, -2.2, 1, 1, 0.9);
    c.box(near, 0.16, 0.1, 0.1, c.glow(0xffb347, 1.4, true), x - 0.13, 2.34, -1.94);
    c.box(near, 0.16, 0.1, 0.1, c.glow(0xffb347, 1.4, true), x + 0.13, 2.34, -1.94);
  }

  // floor: worn stone slabs with a central medallion
  for (let i = 0; i < 22; i++) {
    for (let j = 0; j < 3; j++) {
      c.box(near, 1.44, 0.03, 2.2, c.mat((i + j) % 5 === 0 ? 0x3a3e4e : 0x2e3240), -15.4 + i * 1.5, 0.045, 0.8 + j * 2.3);
    }
  }
  c.cyl(near, 1.9, 1.9, 0.04, 16, c.mat(0x474c5e), 0, 0.06, 1.6);
  c.cyl(near, 1.3, 1.3, 0.05, 16, c.mat(0x2a2e3c), 0, 0.07, 1.6);
}

/** Temple of the sun: giant statue, ruined columns, sandstone floor. */
function buildTemple(c: Ctx) {
  const { far, mid, near, rand } = c;
  const sand = c.mat(0x8a5a32), sandDark = c.mat(0x6b3a22), gold = c.glow(0xffc46b, 1.5, true);

  // far: the great statue head + shoulders
  c.box(far, 18, 4.6, 7, sandDark, 0, 2.3, -14);
  c.sphere(far, 5.2, sand, 0, 7.4, -14, 1.15, 1.05, 0.9);
  c.box(far, 8.6, 1.2, 1.4, sandDark, 0, 4.9, -12.6);
  for (const x of [-2.1, 2.1]) {
    c.box(far, 1.5, 0.6, 0.6, sandDark, x, 8.1, -12.2);
    c.box(far, 1.0, 0.2, 0.3, gold, x, 8.1, -12.0);
  }
  c.box(far, 1.7, 0.6, 0.5, sandDark, 0, 6.3, -12.1);
  // crown
  for (let i = 0; i < 7; i++) {
    c.cone(far, 0.55, 2.4 + rand(), 4, gold, -4.2 + i * 1.4, 11.6, -14);
  }

  // mid: ruined columns + palms + braziers
  for (let i = 0; i < 5; i++) {
    const x = -14 + i * 7;
    const h = 3.4 + rand() * 3.2;
    c.cyl(mid, 0.6, 0.72, h, 8, sand, x, h / 2, -8.6);
    c.box(mid, 1.6, 0.32, 1.6, sandDark, x, h + 0.16, -8.6);
    if (rand() < 0.5) c.box(mid, 1.2, 0.7, 1.2, sandDark, x, h + 0.7, -8.6, 0, 0.4, 0.1);
  }
  for (const [x, s] of [[-11, 1], [11, 0.85]] as const) {
    c.cyl(mid, 0.24 * s, 0.36 * s, 4.6 * s, 6, c.mat(0x3a2418), x, 2.3 * s, -11);
    for (let f = 0; f < 6; f++) {
      c.box(mid, 2.6 * s, 0.14, 0.7, c.mat(0x2e5a34), x + (f % 2 ? 0.5 : -0.5), 4.6 * s + f * 0.32, -11, 0, (f % 2 ? 0.5 : -0.5), (f % 2 ? 0.3 : -0.3));
    }
  }
  for (const x of [-6.5, 6.5]) torch(c, mid, x, 0, -7.2, 1.2);

  // near: broken colossus hand + offering bowls
  for (const x of [-9, 9]) {
    c.box(near, 1.6, 1.2, 1.6, sandDark, x, 0.6, -2.8);
    c.cyl(near, 0.55, 0.62, 1.5, 7, sand, x, 1.9, -2.8);
    c.sphere(near, 0.7, sand, x, 2.9, -2.8, 1, 0.8, 1);
  }

  // floor: sandstone slabs with a sun disc
  for (let i = 0; i < 22; i++) {
    for (let j = 0; j < 3; j++) {
      c.box(near, 1.46, 0.03, 2.2, c.mat((i + j) % 4 === 0 ? 0x8a4a28 : 0x7a4224), -15.4 + i * 1.5, 0.045, 0.8 + j * 2.3);
    }
  }
  c.cyl(near, 2.2, 2.2, 0.04, 18, c.mat(0x9a5a30), 0, 0.06, 1.8);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    c.box(near, 0.5, 0.05, 0.16, gold, Math.cos(a) * 2.7, 0.07, 1.8 + Math.sin(a) * 2.7, 0, -a, 0);
  }
}

const BUILDERS: Record<StageKind, (c: Ctx) => void> = {
  castle: buildCastle,
  pit: buildPit,
  lair: buildLair,
  airbase: buildAirbase,
  courtyard: buildCourtyard,
  temple: buildTemple,
};

/* --------------------------------- stage --------------------------------- */

export class Stage {
  readonly group = new THREE.Group();
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private texs: THREE.Texture[] = [];
  private layers: Layer[] = [];
  private flickers: Flicker[] = [];
  private crowd: Crowd | null = null;
  private motes: Motes | null = null;
  private current = '';
  private t = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.build(THEMES.castle);
  }

  get id() { return this.current; }

  build(theme: StageTheme) {
    if (theme.id === this.current) return;
    this.current = theme.id;
    this.clear();
    const rand = rng(hash(theme.id));

    const mat = (c: number, opts: THREE.MeshStandardMaterialParameters = {}) => {
      const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true, ...opts });
      this.mats.push(m); return m;
    };
    const glow = (c: number, intensity = 1.6, flicker = false) => {
      const m = mat(c, { emissive: c, emissiveIntensity: intensity, roughness: 0.35 });
      if (flicker) this.flickers.push({ mat: m, base: intensity, phase: rand() * 6.28, speed: 2 + rand() * 4 });
      return m;
    };
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      this.geos.push(geo);
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true; mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const box = (parent: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      const mesh = add(parent, new THREE.BoxGeometry(w, h, d), m, x, y, z);
      mesh.rotation.set(rx, ry, rz);
      return mesh;
    };
    const cyl = (parent: THREE.Object3D, rt: number, rb: number, h: number, seg: number, m: THREE.Material, x: number, y: number, z: number) =>
      add(parent, new THREE.CylinderGeometry(rt, rb, h, seg), m, x, y, z);
    const cone = (parent: THREE.Object3D, r: number, h: number, seg: number, m: THREE.Material, x: number, y: number, z: number) =>
      add(parent, new THREE.ConeGeometry(r, h, seg), m, x, y, z);
    const sphere = (parent: THREE.Object3D, r: number, m: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
      const mesh = add(parent, new THREE.SphereGeometry(r, 12, 9), m, x, y, z);
      mesh.scale.set(sx, sy, sz);
      return mesh;
    };

    /* ------------------------------- sky ------------------------------- */
    const skyTex = skyTexture(theme);
    this.texs.push(skyTex);
    const sky = new THREE.Mesh(
      new THREE.PlaneGeometry(170, 86),
      new THREE.MeshBasicMaterial({ map: skyTex, fog: false, depthWrite: false, toneMapped: false }),
    );
    this.geos.push(sky.geometry);
    this.mats.push(sky.material as THREE.Material);
    sky.position.set(0, 20, -58);
    sky.renderOrder = -10;
    this.group.add(sky);

    // Horizon bloom sits between the painted plate and the skyline, backlighting every silhouette.
    const bloomTex = horizonTexture(theme);
    this.texs.push(bloomTex);
    const bloom = new THREE.Mesh(
      new THREE.PlaneGeometry(130, 34),
      new THREE.MeshBasicMaterial({
        map: bloomTex, color: theme.horizon, transparent: true, opacity: theme.bloom ?? 0.4,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
      }),
    );
    this.geos.push(bloom.geometry);
    this.mats.push(bloom.material as THREE.Material);
    bloom.position.set(0, 5.5, -44);
    bloom.renderOrder = -9;
    this.group.add(bloom);

    /* ------------------------------ depth bands ------------------------------ */
    const band = (z: number, factor: number) => {
      const g = new THREE.Group(); g.position.z = z; this.group.add(g);
      this.layers.push({ group: g, factor });
      return g;
    };
    const far = band(-34, 0.22);
    const mid = band(-8, 0.5);
    const near = band(-3, 0.9);

    const hazeTex = hazeTexture(theme);
    this.texs.push(hazeTex);
    const haze = new THREE.Mesh(
      new THREE.PlaneGeometry(170, 44),
      new THREE.MeshBasicMaterial({
        map: hazeTex, color: theme.horizon, transparent: true, opacity: 0.42,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
      }),
    );
    this.geos.push(haze.geometry);
    this.mats.push(haze.material as THREE.Material);
    haze.position.set(0, 10, -30);
    haze.renderOrder = -8;
    this.group.add(haze);

    /* ------------------------------- ground ------------------------------- */
    // Wide base plane so the lower half of the frame is never empty sky; the per-stage builders
    // lay their own readable material on top of it.
    box(this.group, 130, 0.5, 92, mat(theme.ground), 0, -0.25, -40);
    // Thin surface slab: stage builders lay their own material a few centimetres above it, so the
    // detail never z-fights with the base plane.
    box(this.group, 130, 0.02, 92.02, mat(theme.groundTop), 0, 0, -40);
    for (const x of [-12.5, 12.5]) box(this.group, 0.24, 1.1, 6, mat(theme.ground), x, 0.45, 1.2);

    const ctx: Ctx = { theme, rand, far, mid, near, mat, glow, box, cyl, cone, sphere };
    BUILDERS[theme.kind](ctx);

    /* ------------------------------- crowd ------------------------------- */
    if (theme.crowd) this.buildCrowd(near, theme, rand);

    /* ----------------------------- atmosphere ----------------------------- */
    this.buildMotes(theme);
  }

  private buildCrowd(parent: THREE.Group, theme: StageTheme, rand: () => number) {
    const count = 90;
    const geo = new THREE.BoxGeometry(0.42, 0.56, 0.3);
    const m = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true, color: theme.crowdTint ?? 0x201a22 });
    this.geos.push(geo); this.mats.push(m);
    const mesh = new THREE.InstancedMesh(geo, m, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const base = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    const col = new THREE.Color();
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const row = i % 2;
      const x = -16 + (i / count) * 32 + (rand() - 0.5) * 0.6;
      const y = 0.28 + row * 0.52;
      const z = -3.0 - row * 0.95;
      base[i * 3] = x; base[i * 3 + 1] = y; base[i * 3 + 2] = z;
      phase[i] = rand() * Math.PI * 2;
      dummy.position.set(x, y, z);
      dummy.scale.setScalar(0.82 + rand() * 0.45);
      dummy.rotation.y = (rand() - 0.5) * 0.5;
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const v = 0.34 + rand() * 0.3;
      col.setRGB(v, v * 0.9, v * 1.12);
      mesh.setColorAt(i, col);
    }
    mesh.instanceColor!.needsUpdate = true;
    mesh.castShadow = false; mesh.receiveShadow = false;
    parent.add(mesh);
    this.crowd = { mesh, base, phase, count };
  }

  private buildMotes(theme: StageTheme) {
    const N = 240;
    const pos = new Float32Array(N * 3);
    const vel = new Float32Array(N);
    const spread = new THREE.Vector3(46, 15, 16);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * spread.x;
      pos[i * 3 + 1] = Math.random() * spread.y;
      pos[i * 3 + 2] = -spread.z * 0.5 + Math.random() * spread.z;
      vel[i] = 0.2 + Math.random() * 0.9;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geos.push(geo);

    const tex = dotTexture();
    this.texs.push(tex);
    const size = theme.atmosphere === 'snow' ? 0.11 : theme.atmosphere === 'fireflies' ? 0.13 : 0.09;
    const color = theme.atmosphere === 'embers' ? theme.accent
      : theme.atmosphere === 'snow' ? 0xdff6ff
        : theme.atmosphere === 'fireflies' ? theme.accent
          : theme.atmosphere === 'petals' ? 0xff9ec4
            : theme.atmosphere === 'ash' ? 0x9aa8b8
              : theme.horizon;
    const mat = new THREE.PointsMaterial({
      size, map: tex, color, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, toneMapped: false,
    });
    this.mats.push(mat);
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.group.add(points);
    this.motes = { points, pos, vel, spread, mode: theme.atmosphere };
  }

  /** Per-frame life: parallax, crowd bob, particles, torch flicker. */
  update(dt: number, cameraX: number) {
    this.t += dt;
    for (const l of this.layers) l.group.position.x = -cameraX * l.factor;

    if (this.crowd) {
      const { mesh, base, phase, count } = this.crowd;
      const d = new THREE.Object3D();
      for (let i = 0; i < count; i++) {
        const bob = Math.sin(this.t * 1.5 + phase[i]) * 0.035;
        d.position.set(base[i * 3], base[i * 3 + 1] + bob, base[i * 3 + 2]);
        d.scale.setScalar(1);
        d.rotation.y = Math.sin(this.t * 0.6 + phase[i]) * 0.12;
        d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    if (this.motes) {
      const { points, pos, vel, spread, mode } = this.motes;
      const arr = points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const n = pos.length / 3;
      for (let i = 0; i < n; i++) {
        const k = i * 3;
        switch (mode) {
          case 'snow':
            pos[k + 1] -= vel[i] * dt * 1.6;
            pos[k] += Math.sin(this.t * 0.8 + i) * dt * 0.5;
            if (pos[k + 1] < 0) pos[k + 1] = spread.y;
            break;
          case 'embers':
            pos[k + 1] += vel[i] * dt * 1.5;
            pos[k] += Math.sin(this.t * 1.3 + i) * dt * 0.7;
            if (pos[k + 1] > spread.y) { pos[k + 1] = 0; pos[k] = (Math.random() - 0.5) * spread.x; }
            break;
          case 'fireflies':
            pos[k] += Math.cos(this.t * 0.7 + i) * dt * 0.9;
            pos[k + 1] += Math.sin(this.t * 0.9 + i * 1.7) * dt * 0.5;
            break;
          case 'petals':
            pos[k + 1] -= vel[i] * dt * 0.9;
            pos[k] += Math.sin(this.t * 1.1 + i) * dt * 0.9;
            if (pos[k + 1] < 0) pos[k + 1] = spread.y;
            break;
          case 'dust':
            pos[k] += vel[i] * dt * 0.6;
            if (pos[k] > spread.x / 2) pos[k] = -spread.x / 2;
            break;
          case 'ash':
            pos[k + 1] -= vel[i] * dt * 0.55;
            pos[k] += Math.sin(this.t * 0.6 + i) * dt * 0.8;
            if (pos[k + 1] < 0) pos[k + 1] = spread.y;
            break;
          default: // stars drift almost imperceptibly
            pos[k + 1] += vel[i] * dt * 0.15;
            if (pos[k + 1] > spread.y) pos[k + 1] = 0;
        }
        arr.setXYZ(i, pos[k], pos[k + 1], pos[k + 2]);
      }
      arr.needsUpdate = true;
    }

    for (const f of this.flickers) {
      f.mat.emissiveIntensity = f.base * (0.82 + Math.sin(this.t * f.speed + f.phase) * 0.12 + Math.sin(this.t * 11 + f.phase) * 0.06);
    }
  }

  private clear() {
    for (const c of [...this.group.children]) this.group.remove(c);
    for (const m of this.mats) m.dispose();
    for (const g of this.geos) g.dispose();
    for (const t of this.texs) t.dispose();
    this.mats = []; this.geos = []; this.texs = [];
    this.layers = []; this.flickers = []; this.crowd = null; this.motes = null;
  }
}




