import * as THREE from 'three';
import { MOVES, totalFrames, type ClientMove, type MoveName } from './moves';

/** Palette + accessory per fighter, sampled from the concept art. */
interface Look {
  head: number; torso: number; limb: number; foot: number;
  eyeFrame: number; eyeWhite: number; pupil: number; band?: number;
  visor?: boolean; accent: number;
  accessory: 'horns' | 'cap' | 'antenna' | 'mohawk' | 'propeller';
}
const LOOKS: Record<string, Look> = {
  ram:     { head: 0x5a2d1f, torso: 0x8f9fb0, limb: 0xefe6d2, foot: 0x6d5a42, eyeFrame: 0x14100e, eyeWhite: 0x7dff6a, pupil: 0x7dff6a, band: 0xe8e2d0, visor: true, accent: 0x5a2d1f, accessory: 'horns' },
  cap:     { head: 0x1f4a3a, torso: 0x15271f, limb: 0x1f4a3a, foot: 0x6fe8d8, eyeFrame: 0x6fe8d8, eyeWhite: 0xefe6d2, pupil: 0xefe6d2, accent: 0x2f6b46, accessory: 'cap' },
  antenna: { head: 0xa9adb3, torso: 0xdcd6c6, limb: 0xa9adb3, foot: 0xf08a24, eyeFrame: 0xa9adb3, eyeWhite: 0x14100e, pupil: 0x14100e, accent: 0xf08a24, accessory: 'antenna' },
  mohawk:  { head: 0xc8402a, torso: 0x16120f, limb: 0xc8402a, foot: 0x16120f, eyeFrame: 0xefe6d2, eyeWhite: 0xefe6d2, pupil: 0x14100e, accent: 0x8a4a3a, accessory: 'mohawk' },
  prop:    { head: 0x23907e, torso: 0x1a6b5c, limb: 0x23907e, foot: 0x14100e, eyeFrame: 0xa6f0a0, eyeWhite: 0xefe6d2, pupil: 0xefe6d2, accent: 0xefe6d2, accessory: 'propeller' },
};

const INK = new THREE.LineBasicMaterial({ color: 0x14100e });
function box(w: number, h: number, d: number, color: number, name = ''): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.82, flatShading: true }));
  m.add(new THREE.LineSegments(new THREE.EdgesGeometry(g), INK));   // black outline = the voxel-sticker look
  m.name = name; m.castShadow = true; m.receiveShadow = true;
  return m;
}
const pivot = (name: string, x: number, y: number, z = 0) => { const o = new THREE.Group(); o.name = name; o.position.set(x, y, z); return o; };
const f = (n: number) => n / 60;
const D = Math.PI / 180;
const HIPS_Y = 0.30;

/* ------------------------------ style ------------------------------ */
/**
 * Per-fighter animation identity. Every fighter shares the same frame-data-accurate clip
 * structure, but each one gets its own stance, its own swing amplitude and its own lead side, so
 * the basic attacks read differently: Ram swings wide and heavy, Cap is a compact left-handed
 * rushdown, Antenna throws long lanky limbs, Mohawk winds up huge hooks and Prop flails loosely.
 */
interface FighterStyle {
  /** Bone-angle deltas layered onto every authored pose: the resting stance. */
  stance: Pose;
  /** Swing amplitude multipliers. */
  arm: number; leg: number; twist: number;
  /** Hips height offset in metres (negative = lower, wider stance). */
  bodyY: number;
  /** Swap the lead arm/leg so the fighter fights southpaw. */
  mirror: boolean;
}

const IDENTITY: FighterStyle = { stance: {}, arm: 1, leg: 1, twist: 1, bodyY: 0, mirror: false };

const MIRROR_BONE: Record<string, string> = {
  ArmL: 'ArmR', ArmR: 'ArmL', ElbowL: 'ElbowR', ElbowR: 'ElbowL',
  LeftHand: 'RightHand', RightHand: 'LeftHand',
  LegL: 'LegR', LegR: 'LegL', KneeL: 'KneeR', KneeR: 'KneeL',
  LeftFoot: 'RightFoot', RightFoot: 'LeftFoot',
};
const ARMS = new Set(['ArmL', 'ArmR', 'ElbowL', 'ElbowR', 'LeftHand', 'RightHand']);
const LEGS = new Set(['LegL', 'LegR', 'KneeL', 'KneeR', 'LeftFoot', 'RightFoot']);
const CENTER = new Set(['Body', 'Spine', 'Head', 'Neck']);

export const STYLES: Record<string, FighterStyle> = {
  // Heavy brawler: hunched, low, huge arm swings.
  ram: {
    stance: {
      Spine: [5, 0, 0], Head: [-3, 0, 0], ArmL: [-4, 0, -7], ArmR: [-4, 0, 7],
      ElbowL: [-12, 0, 0], ElbowR: [-12, 0, 0], LegL: [-5, 0, 0], LegR: [-5, 0, 0],
      KneeL: [10, 0, 0], KneeR: [10, 0, 0],
    },
    arm: 1.18, leg: 1.08, twist: 1.15, bodyY: -0.012, mirror: false,
  },
  // Agile rushdown: upright, springy knees, left hand forward.
  cap: {
    stance: {
      Spine: [-2, 0, 0], Head: [2, 0, 0], ArmL: [10, 0, -4], ArmR: [8, 0, 4],
      ElbowL: [6, 0, 0], ElbowR: [6, 0, 0], LegL: [4, 0, 0], LegR: [-6, 0, 0],
      KneeL: [-4, 0, 0], KneeR: [-10, 0, 0],
    },
    arm: 0.92, leg: 1.2, twist: 1.3, bodyY: 0.008, mirror: true,
  },
  // Long-reach zoner: tall, elbows extended, little twist.
  antenna: {
    stance: {
      Spine: [-4, 0, 0], Head: [4, 0, 0], ArmL: [-12, 0, -3], ArmR: [-12, 0, 3],
      ElbowL: [12, 0, 0], ElbowR: [12, 0, 0], LegL: [2, 0, 0], LegR: [2, 0, 0],
      KneeL: [-4, 0, 0], KneeR: [-4, 0, 0],
    },
    arm: 1.12, leg: 0.86, twist: 0.8, bodyY: 0.016, mirror: false,
  },
  // Grappler: crouched, barrel-chested, enormous slow swings.
  mohawk: {
    stance: {
      Spine: [9, 0, 0], Head: [-7, 0, 0], ArmL: [-6, 0, -12], ArmR: [-6, 0, 12],
      ElbowL: [-18, 0, 0], ElbowR: [-18, 0, 0], LegL: [-8, 0, 0], LegR: [-8, 0, 0],
      KneeL: [14, 0, 0], KneeR: [14, 0, 0], LeftFoot: [-6, 0, 0], RightFoot: [-6, 0, 0],
    },
    arm: 1.32, leg: 1.02, twist: 1.4, bodyY: -0.02, mirror: false,
  },
  // Aerialist: loose shoulders, wide arms, big rotational flourish.
  prop: {
    stance: {
      Spine: [-3, 0, 0], Head: [3, 0, 0], ArmL: [-10, 0, -16], ArmR: [-10, 0, 16],
      ElbowL: [-6, 0, 0], ElbowR: [-6, 0, 0], LegL: [3, 0, 0], LegR: [3, 0, 0],
      KneeL: [-8, 0, 0], KneeR: [-8, 0, 0],
    },
    arm: 1.05, leg: 1.16, twist: 1.45, bodyY: 0.014, mirror: true,
  },
};

/** Layer a fighter's stance, amplitude and lead side onto an authored pose. */
function stylePose(p: Pose, st: FighterStyle): Pose {
  const out: Pose = {};
  for (const bone of new Set([...Object.keys(p), ...Object.keys(st.stance)])) {
    const v = p[bone] ?? [0, 0, 0];
    const d = st.stance[bone] ?? [0, 0, 0];
    const amp = ARMS.has(bone) ? st.arm : LEGS.has(bone) ? st.leg : 1;
    let x = v[0] * amp + d[0];
    let y = v[1] * st.twist + d[1];
    let z = v[2] * st.twist + d[2];
    let name = bone;
    if (st.mirror) {
      const swapped = MIRROR_BONE[bone];
      if (swapped) name = swapped;
      if (swapped || CENTER.has(bone)) { y = -y; z = -z; }
    }
    out[name] = [x, y, z];
  }
  return out;
}

/* ------------------------------- pose clips ------------------------------- */
/** Euler XYZ in degrees, per bone. Bones absent from a pose fall back to identity. */
type Pose = Record<string, [number, number, number]>;
interface Key { t: number; pose: Pose; body?: [number, number, number] }

function rawClip(name: string, keys: Key[], st: FighterStyle = IDENTITY): THREE.AnimationClip {
  const poses = keys.map((k) => stylePose(k.pose, st));
  const nodes = new Set<string>();
  for (const p of poses) for (const n of Object.keys(p)) nodes.add(n);
  const times = keys.map((k) => k.t);
  const tracks: THREE.KeyframeTrack[] = [];
  for (const node of nodes) {
    const vals: number[] = [];
    for (const p of poses) {
      const [x, y, z] = p[node] ?? [0, 0, 0];
      vals.push(...new THREE.Quaternion().setFromEuler(new THREE.Euler(x * D, y * D, z * D)).toArray());
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${node}.quaternion`, times, vals));
  }
  // Always author the hips track so a clip that bobs/leans cannot leave the body offset behind
  // when it crossfades into one that does not.
  {
    const vals: number[] = [];
    for (const k of keys) {
      const [bx, by, bz] = k.body ?? [0, 0, 0];
      vals.push(bx, HIPS_Y + by + st.bodyY, bz);
    }
    tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, vals));
  }
  return new THREE.AnimationClip(name, times[times.length - 1], tracks);
}

/** Base fighting stance: slight crouch, guard up, feet staggered. */
const BASE: Pose = {
  Body: [0, 0, 0],
  Spine: [4, 0, 0],
  Head: [0, 0, 0],
  ArmL: [-10, 0, -8], ArmR: [-10, 0, 8],
  ElbowL: [-35, 0, 0], ElbowR: [-35, 0, 0],
  LegL: [4, 0, 0], LegR: [-4, 0, 0],
  KneeL: [-8, 0, 0], KneeR: [-8, 0, 0],
  LeftFoot: [4, 0, 0], RightFoot: [4, 0, 0],
};
const pose = (o: Pose = {}): Pose => ({ ...BASE, ...o });

/** Build an attack clip whose keys land exactly on the server's startup/active/recovery frames. */
function attackKeys(mv: ClientMove, keys: { at: number | 'wind' | 'hit' | 'hold' | 'end'; pose: Pose; body?: [number, number, number] }[]): Key[] {
  const { startup: S, active: A, recovery: R } = mv;
  const frame = (at: number | 'wind' | 'hit' | 'hold' | 'end') =>
    typeof at === 'number' ? at : at === 'wind' ? Math.round(S * 0.55) : at === 'hit' ? S : at === 'hold' ? S + A : S + A + R;
  return keys.map((k) => ({ t: f(frame(k.at)), pose: k.pose, body: k.body }));
}

/* ------------------------------ spell clips ------------------------------ */
/**
 * Per-fighter spell choreography. Same clip name, same startup/active/recovery frames as
 * `MOVES.Spell`, so the netcode, controller and hitboxes never need to know which fighter cast.
 */
function spellClip(id: string, st: FighterStyle): THREE.AnimationClip {
  const mv = MOVES.Spell;
  // Bespoke choreography is authored for a specific hand, so apply the stance but never mirror it.
  const mk = (name: string, keys: Key[]) => rawClip(name, keys, { ...st, mirror: false });
  switch (id) {
    case 'cap': // Gale Slash — a full crescent spin that ends facing forward again
      return mk('Spell', attackKeys(mv, [
        { at: 0, pose: pose() },
        { at: 'wind', pose: pose({ Body: [0, -45, 0], Spine: [8, -18, 0], Head: [0, -14, 0], ArmR: [-70, 0, 46], ElbowR: [-24, 0, 0], ArmL: [24, 0, -34], ElbowL: [-60, 0, 0], LegL: [-20, 0, 0], KneeL: [30, 0, 0], LegR: [-12, 0, 0], KneeR: [20, 0, 0] }), body: [0, -0.05, -0.02] },
        { at: 'hit', pose: pose({ Body: [0, 80, 0], Spine: [10, 0, 0], Head: [0, -22, 0], ArmR: [-96, 0, 4], ElbowR: [0, 0, 0], ArmL: [30, 0, -40], ElbowL: [-30, 0, 0], LegL: [-8, 0, 0], LegR: [10, 0, 0], KneeR: [-10, 0, 0] }), body: [0, 0.02, 0.05] },
        { at: 'hold', pose: pose({ Body: [0, 112, 0], Spine: [10, 0, 0], Head: [0, -22, 0], ArmR: [-96, 0, 4], ElbowR: [0, 0, 0], ArmL: [30, 0, -40], ElbowL: [-30, 0, 0], LegL: [-8, 0, 0], LegR: [10, 0, 0], KneeR: [-10, 0, 0] }), body: [0, 0.02, 0.05] },
        { at: 26, pose: pose({ Body: [0, 250, 0], Spine: [4, 0, 0], ArmL: [-30, 0, -20], ArmR: [-30, 0, 20], ElbowL: [-50, 0, 0], ElbowR: [-50, 0, 0] }), body: [0, -0.02, 0] },
        { at: 'end', pose: pose({ Body: [0, 360, 0] }) },
      ]));

    case 'antenna': // Signal Beam — hands to the antenna, then a two-palm thrust
      return mk('Spell', attackKeys(mv, [
        { at: 0, pose: pose() },
        { at: 'wind', pose: pose({ Spine: [-18, 0, 0], Head: [-16, 0, 0], ArmL: [-150, 0, -30], ElbowL: [-118, 0, 0], ArmR: [-150, 0, 30], ElbowR: [-118, 0, 0], LegL: [-18, 0, 0], KneeL: [24, 0, 0], LegR: [-14, 0, 0], KneeR: [20, 0, 0], LeftFoot: [-10, 0, 0], RightFoot: [-10, 0, 0] }), body: [0, -0.03, -0.05] },
        { at: 'hit', pose: pose({ Spine: [18, 0, 0], Head: [-2, 0, 0], ArmL: [-94, 0, -8], ElbowL: [-2, 0, 0], ArmR: [-94, 0, 8], ElbowR: [-2, 0, 0], LegL: [-28, 0, 0], KneeL: [32, 0, 0], LegR: [18, 0, 0], KneeR: [-22, 0, 0] }), body: [0, 0, 0.07] },
        { at: 'hold', pose: pose({ Spine: [18, 0, 0], Head: [-2, 0, 0], ArmL: [-94, 0, -8], ElbowL: [-2, 0, 0], ArmR: [-94, 0, 8], ElbowR: [-2, 0, 0], LegL: [-28, 0, 0], KneeL: [32, 0, 0], LegR: [18, 0, 0], KneeR: [-22, 0, 0] }), body: [0, 0, 0.07] },
        { at: 26, pose: pose({ Spine: [8, 0, 0], ArmL: [-60, 0, -14], ArmR: [-60, 0, 14], ElbowL: [-40, 0, 0], ElbowR: [-40, 0, 0] }), body: [0, 0, 0.02] },
        { at: 'end', pose: pose() },
      ]));

    case 'mohawk': // Magma Fist — loaded uppercut, then a rising blow
      return mk('Spell', attackKeys(mv, [
        { at: 0, pose: pose() },
        { at: 'wind', pose: pose({ Spine: [36, 0, 0], Head: [14, 0, 0], ArmR: [46, 0, 22], ElbowR: [-104, 0, 0], ArmL: [-52, 0, -22], ElbowL: [-70, 0, 0], LegL: [-48, 0, 0], KneeL: [80, 0, 0], LegR: [-40, 0, 0], KneeR: [66, 0, 0], LeftFoot: [-30, 0, 0], RightFoot: [-30, 0, 0] }), body: [0, -0.16, -0.04] },
        { at: 'hit', pose: pose({ Spine: [-24, 0, 0], Head: [-24, 0, 0], ArmR: [-172, 0, 12], ElbowR: [-6, 0, 0], ArmL: [54, 0, -30], ElbowL: [-30, 0, 0], LegL: [-8, 0, 0], KneeL: [-6, 0, 0], LegR: [10, 0, 0], KneeR: [-8, 0, 0] }), body: [0, 0.09, 0.06] },
        { at: 'hold', pose: pose({ Spine: [-24, 0, 0], Head: [-24, 0, 0], ArmR: [-172, 0, 12], ElbowR: [-6, 0, 0], ArmL: [54, 0, -30], ElbowL: [-30, 0, 0], LegL: [-8, 0, 0], KneeL: [-6, 0, 0], LegR: [10, 0, 0], KneeR: [-8, 0, 0] }), body: [0, 0.09, 0.06] },
        { at: 26, pose: pose({ Spine: [-4, 0, 0], ArmR: [-90, 0, 16], ElbowR: [-30, 0, 0], ArmL: [-40, 0, -16], ElbowL: [-60, 0, 0] }), body: [0, 0.01, 0.02] },
        { at: 'end', pose: pose() },
      ]));

    case 'prop': // Cyclone — a pirouette with the arms out, 360° back to neutral
      return mk('Spell', attackKeys(mv, [
        { at: 0, pose: pose() },
        { at: 'wind', pose: pose({ Body: [0, -50, 0], Spine: [10, 0, 0], Head: [0, -16, 0], ArmL: [-88, 0, -72], ArmR: [-88, 0, 72], ElbowL: [-12, 0, 0], ElbowR: [-12, 0, 0], LegL: [-26, 0, 0], KneeL: [42, 0, 0], LegR: [-26, 0, 0], KneeR: [42, 0, 0] }), body: [0, -0.09, -0.02] },
        { at: 'hit', pose: pose({ Body: [0, 150, 0], Spine: [4, 0, 0], Head: [0, -10, 0], ArmL: [-96, 0, -82], ArmR: [-96, 0, 82], ElbowL: [-4, 0, 0], ElbowR: [-4, 0, 0], LegL: [-10, 0, 0], LegR: [-10, 0, 0] }), body: [0, 0.04, 0.04] },
        { at: 'hold', pose: pose({ Body: [0, 210, 0], Spine: [4, 0, 0], Head: [0, -10, 0], ArmL: [-96, 0, -82], ArmR: [-96, 0, 82], ElbowL: [-4, 0, 0], ElbowR: [-4, 0, 0], LegL: [-10, 0, 0], LegR: [-10, 0, 0] }), body: [0, 0.04, 0.04] },
        { at: 26, pose: pose({ Body: [0, 330, 0], Spine: [6, 0, 0], ArmL: [-50, 0, -34], ArmR: [-50, 0, 34], ElbowL: [-40, 0, 0], ElbowR: [-40, 0, 0] }), body: [0, -0.02, 0] },
        { at: 'end', pose: pose({ Body: [0, 360, 0] }) },
      ]));

    default: // Ram — Seismic Wave: double-fist slam into the floor
      return mk('Spell', attackKeys(mv, [
        { at: 0, pose: pose() },
        { at: 'wind', pose: pose({ Spine: [-18, 0, 0], Head: [-12, 0, 0], ArmL: [-158, 0, -18], ElbowL: [-26, 0, 0], ArmR: [-158, 0, 18], ElbowR: [-26, 0, 0], LegL: [-30, 0, 0], KneeL: [50, 0, 0], LegR: [-30, 0, 0], KneeR: [50, 0, 0] }), body: [0, -0.05, -0.03] },
        { at: 'hit', pose: pose({ Spine: [46, 0, 0], Head: [18, 0, 0], ArmL: [-28, 0, -10], ElbowL: [0, 0, 0], ArmR: [-28, 0, 10], ElbowR: [0, 0, 0], LegL: [-48, 0, 0], KneeL: [80, 0, 0], LegR: [-48, 0, 0], KneeR: [80, 0, 0], LeftFoot: [-32, 0, 0], RightFoot: [-32, 0, 0] }), body: [0, -0.17, 0.07] },
        { at: 'hold', pose: pose({ Spine: [46, 0, 0], Head: [18, 0, 0], ArmL: [-28, 0, -10], ElbowL: [0, 0, 0], ArmR: [-28, 0, 10], ElbowR: [0, 0, 0], LegL: [-48, 0, 0], KneeL: [80, 0, 0], LegR: [-48, 0, 0], KneeR: [80, 0, 0], LeftFoot: [-32, 0, 0], RightFoot: [-32, 0, 0] }), body: [0, -0.17, 0.07] },
        { at: 26, pose: pose({ Spine: [22, 0, 0], Head: [6, 0, 0], ArmL: [-58, 0, -14], ArmR: [-58, 0, 14], ElbowL: [-40, 0, 0], ElbowR: [-40, 0, 0], LegL: [-24, 0, 0], KneeL: [36, 0, 0], LegR: [-24, 0, 0], KneeR: [36, 0, 0] }), body: [0, -0.05, 0.02] },
        { at: 'end', pose: pose() },
      ]));
  }
}

/* ------------------------------ overdrive clip ------------------------------ */
/**
 * EX cast: a bigger, more committal version of the spell gesture — both arms drive forward, the
 * whole body leans into it and the stance drops. Styled per fighter like every other clip, so the
 * five EX animations still read differently.
 */
function overdriveClip(id: string, st: FighterStyle): THREE.AnimationClip {
  const mv = MOVES.Overdrive;
  const mk = (name: string, keys: Key[]) => rawClip(name, keys, { ...st, mirror: false });
  return mk('Overdrive', attackKeys(mv, [
    { at: 0, pose: pose() },
    {
      at: 'wind',
      pose: pose({
        Spine: [-18, 0, 0], Head: [-12, 0, 0],
        ArmL: [-128, 0, -36], ArmR: [-128, 0, 36], ElbowL: [-92, 0, 0], ElbowR: [-92, 0, 0],
        LegL: [-32, 0, 0], KneeL: [54, 0, 0], LegR: [-32, 0, 0], KneeR: [54, 0, 0],
        LeftFoot: [-22, 0, 0], RightFoot: [-22, 0, 0],
      }),
      body: [0, -0.13, -0.05],
    },
    {
      at: 'hit',
      pose: pose({
        Spine: [28, 0, 0], Head: [8, 0, 0],
        ArmL: [-94, 0, -8], ArmR: [-94, 0, 8], ElbowL: [0, 0, 0], ElbowR: [0, 0, 0],
        LegL: [-10, 0, 0], KneeL: [16, 0, 0], LegR: [26, 0, 0], KneeR: [-28, 0, 0],
      }),
      body: [0, 0.06, 0.11],
    },
    {
      at: 'hold',
      pose: pose({
        Spine: [28, 0, 0], Head: [8, 0, 0],
        ArmL: [-94, 0, -8], ArmR: [-94, 0, 8], ElbowL: [0, 0, 0], ElbowR: [0, 0, 0],
        LegL: [-10, 0, 0], KneeL: [16, 0, 0], LegR: [26, 0, 0], KneeR: [-28, 0, 0],
      }),
      body: [0, 0.06, 0.11],
    },
    {
      at: 30,
      pose: pose({
        Spine: [10, 0, 0], ArmL: [-52, 0, -18], ArmR: [-52, 0, 18],
        ElbowL: [-62, 0, 0], ElbowR: [-62, 0, 0],
      }),
      body: [0, -0.02, 0.03],
    },
    { at: 'end', pose: pose() },
  ]));
}

/* --------------------------------- rig ----------------------------------- */
/**
 * Builds a box-fighter (~1.0 unit tall, faces +Z) with a full humanoid hierarchy:
 * hips → spine → neck/head, shoulders → elbows → hands, hips → knees → feet.
 * The six names the hitbox system looks for (Head, Spine, LeftHand, RightHand, LeftFoot,
 * RightFoot) are preserved so every volume keeps tracking the animated skeleton.
 */
export function buildProceduralFighter(id: string): { scene: THREE.Group; animations: THREE.AnimationClip[] } {
  const L = LOOKS[id] ?? LOOKS.ram;
  const st = STYLES[id] ?? IDENTITY;
  /** Every clip built for this fighter automatically carries its stance and swing style. */
  const makeClip = (name: string, keys: Key[]) => rawClip(name, keys, st);
  const root = new THREE.Group(); root.name = 'Body';

  const hips = pivot('Hips', 0, HIPS_Y);
  const hipMesh = box(0.26, 0.16, 0.22, L.torso, 'HipsMesh');
  hipMesh.position.set(0, 0.02, 0);
  hips.add(hipMesh);
  root.add(hips);

  /* legs: hip → knee → foot */
  for (const [side, x] of [['Left', -0.09], ['Right', 0.09]] as const) {
    const leg = pivot(`Leg${side[0]}`, x, 0, 0);
    const thigh = box(0.11, 0.16, 0.11, L.limb); thigh.position.y = -0.08; leg.add(thigh);
    const knee = pivot(`Knee${side[0]}`, 0, -0.16, 0);
    const shin = box(0.10, 0.15, 0.10, L.limb === L.head ? L.foot : L.limb); shin.position.y = -0.075; knee.add(shin);
    const foot = pivot(`${side}Foot`, 0, -0.15, 0);
    const shoe = box(0.14, 0.06, 0.20, L.foot); shoe.position.set(0, -0.01, 0.04); foot.add(shoe);
    knee.add(foot); leg.add(knee); hips.add(leg);
  }

  /* torso → neck → head */
  const spine = pivot('Spine', 0, 0.10);
  const chest = box(0.34, 0.30, 0.24, L.torso, 'TorsoMesh'); chest.position.y = 0.13; spine.add(chest);
  hips.add(spine);

  const neck = pivot('Neck', 0, 0.30);
  const head = pivot('Head', 0, 0.10);
  head.add(box(0.46, 0.42, 0.42, L.head, 'HeadMesh'));
  neck.add(head); spine.add(neck);

  // Face: a wide visor (Ram) or two goggle frames.
  if (L.visor) {
    const v = box(0.44, 0.18, 0.03, L.eyeFrame); v.position.set(0, 0.0, 0.215); head.add(v);
    const band = box(0.48, 0.07, 0.44, L.band!); band.position.set(0, 0.15, 0); head.add(band);
    for (const x of [-0.11, 0.11]) { const e = box(0.07, 0.07, 0.02, L.pupil); e.position.set(x, 0, 0.235); head.add(e); }
  } else {
    for (const x of [-0.12, 0.12]) {
      const fr = box(0.18, 0.18, 0.03, L.eyeFrame); fr.position.set(x, 0.02, 0.215); head.add(fr);
      const ey = box(0.11, 0.11, 0.02, L.eyeWhite); ey.position.set(x, 0.02, 0.235); head.add(ey);
      const pu = box(0.05, 0.05, 0.02, L.pupil === L.eyeWhite ? 0x14100e : L.pupil); pu.position.set(x, 0.02, 0.25); head.add(pu);
    }
  }
  const acc = (m: THREE.Mesh, x: number, y: number, z = 0) => { m.position.set(x, y, z); head.add(m); };
  switch (L.accessory) {
    case 'horns': acc(box(0.09, 0.15, 0.09, L.accent), -0.16, 0.27); acc(box(0.09, 0.15, 0.09, L.accent), 0.16, 0.27); break;
    case 'cap': acc(box(0.48, 0.09, 0.46, L.accent), 0, 0.25); acc(box(0.44, 0.03, 0.20, L.accent), 0, 0.22, 0.30); break;
    case 'antenna':
      for (const x of [-0.13, 0.13]) { acc(box(0.05, 0.28, 0.05, 0x14100e), x, 0.34); acc(box(0.08, 0.06, 0.08, L.accent), x, 0.51); }
      acc(box(0.13, 0.05, 0.11, L.accent), -0.28, 0.0, 0.0); acc(box(0.13, 0.05, 0.11, L.accent), 0.28, 0.0, 0.0); break;
    case 'mohawk': [0.1, 0.17, 0.12].forEach((h, i) => acc(box(0.05, h + 0.10, 0.05, L.accent), 0, 0.21 + h / 2, -0.12 + i * 0.12)); break;
    case 'propeller': acc(box(0.48, 0.08, 0.44, 0x5b6577), 0, 0.25); acc(box(0.36, 0.025, 0.07, L.accent), 0, 0.33); acc(box(0.07, 0.025, 0.36, L.accent), 0, 0.33); break;
  }

  /* arms: shoulder → elbow → hand */
  for (const [side, x] of [['Left', -0.20], ['Right', 0.20]] as const) {
    const arm = pivot(`Arm${side[0]}`, x, 0.20, 0);
    const upper = box(0.09, 0.16, 0.09, L.limb); upper.position.y = -0.08; arm.add(upper);
    const elbow = pivot(`Elbow${side[0]}`, 0, -0.16, 0);
    const fore = box(0.085, 0.15, 0.085, L.limb); fore.position.y = -0.075; elbow.add(fore);
    const hand = pivot(`${side}Hand`, 0, -0.15, 0);
    const fist = box(0.11, 0.11, 0.11, L.limb === L.head ? L.foot : L.limb); hand.add(fist);
    elbow.add(hand); arm.add(elbow); spine.add(arm);
  }

  /* ----------------------------- animation clips ----------------------------- */

  const idle = makeClip('Idle', [
    { t: 0.00, pose: pose(), body: [0, 0, 0] },
    { t: 0.32, pose: pose({ Spine: [6, 2, 0], Head: [1, -3, 0], ArmL: [-13, 0, -9], ArmR: [-13, 0, 9], ElbowL: [-40, 0, 0], ElbowR: [-40, 0, 0], LegL: [3, 0, 0], KneeL: [-10, 0, 0] }), body: [0, 0.012, 0] },
    { t: 0.64, pose: pose({ Spine: [4, 1, 0], Head: [0, -1, 0] }), body: [0, 0.002, 0] },
    { t: 0.98, pose: pose({ Spine: [5, -2, 0], Head: [-1, 3, 0], ArmL: [-9, 0, -7], ArmR: [-9, 0, 7], ElbowL: [-33, 0, 0], ElbowR: [-33, 0, 0], LegR: [-3, 0, 0], KneeR: [-10, 0, 0] }), body: [0, -0.008, 0] },
    { t: 1.32, pose: pose({ Spine: [4, 0, 0] }), body: [0, -0.002, 0] },
    { t: 1.70, pose: pose(), body: [0, 0, 0] },
  ]);

  // Walks get a hip sway, a head bob and a counter-swinging shoulder so the body reads as weight
  // moving rather than legs sliding.
  const walkF = makeClip('WalkForward', [
    { t: 0.00, pose: pose({ Spine: [9, 4, 0], Head: [-1, -4, 0], LegL: [-30, 0, 0], KneeL: [-8, 0, 0], LegR: [24, 0, 0], KneeR: [-20, 0, 0], ArmL: [26, 0, -8], ArmR: [-34, 0, 8], ElbowL: [-28, 0, 0], ElbowR: [-48, 0, 0] }), body: [0, 0, 0] },
    { t: 0.10, pose: pose({ Spine: [9, 2, 0], LegL: [-16, 0, 0], KneeL: [-30, 0, 0], LegR: [4, 0, 0], KneeR: [-44, 0, 0], ArmL: [16, 0, -8], ArmR: [-20, 0, 8] }), body: [0, 0.018, 0] },
    { t: 0.22, pose: pose({ Spine: [9, 0, 0], LegL: [-4, 0, 0], KneeL: [-10, 0, 0], LegR: [-4, 0, 0], KneeR: [-58, 0, 0], ArmL: [4, 0, -8], ArmR: [-8, 0, 8] }), body: [0, 0.022, 0] },
    { t: 0.34, pose: pose({ Spine: [9, -4, 0], Head: [-1, 4, 0], LegL: [24, 0, 0], KneeL: [-20, 0, 0], LegR: [-30, 0, 0], KneeR: [-8, 0, 0], ArmL: [-34, 0, -8], ArmR: [26, 0, 8], ElbowL: [-48, 0, 0], ElbowR: [-28, 0, 0] }), body: [0, 0, 0] },
    { t: 0.44, pose: pose({ Spine: [9, -2, 0], LegL: [4, 0, 0], KneeL: [-44, 0, 0], LegR: [-16, 0, 0], KneeR: [-30, 0, 0], ArmL: [-20, 0, -8], ArmR: [16, 0, 8] }), body: [0, 0.018, 0] },
    { t: 0.56, pose: pose({ Spine: [9, 0, 0], LegL: [-4, 0, 0], KneeL: [-58, 0, 0], LegR: [-4, 0, 0], KneeR: [-10, 0, 0], ArmL: [-8, 0, -8], ArmR: [4, 0, 8] }), body: [0, 0.022, 0] },
    { t: 0.68, pose: pose({ Spine: [9, 4, 0], Head: [-1, -4, 0], LegL: [-30, 0, 0], KneeL: [-8, 0, 0], LegR: [24, 0, 0], KneeR: [-20, 0, 0], ArmL: [26, 0, -8], ArmR: [-34, 0, 8], ElbowL: [-28, 0, 0], ElbowR: [-48, 0, 0] }), body: [0, 0, 0] },
  ]);

  const walkB = makeClip('WalkBackward', [
    { t: 0.00, pose: pose({ Spine: [-3, 0, 0], LegL: [28, 0, 0], KneeL: [-10, 0, 0], LegR: [-26, 0, 0], KneeR: [-8, 0, 0], ArmL: [-26, 0, -8], ArmR: [28, 0, 8] }), body: [0, 0, 0] },
    { t: 0.10, pose: pose({ Spine: [-3, 0, 0], LegL: [10, 0, 0], KneeL: [-40, 0, 0], LegR: [-12, 0, 0], KneeR: [-10, 0, 0], ArmL: [-14, 0, -8], ArmR: [14, 0, 8] }), body: [0, 0.014, 0] },
    { t: 0.22, pose: pose({ Spine: [-3, 0, 0], LegL: [-4, 0, 0], KneeL: [-52, 0, 0], LegR: [-4, 0, 0], KneeR: [-8, 0, 0], ArmL: [-8, 0, -8], ArmR: [6, 0, 8] }), body: [0, 0.02, 0] },
    { t: 0.34, pose: pose({ Spine: [-3, 0, 0], LegL: [-26, 0, 0], KneeL: [-8, 0, 0], LegR: [28, 0, 0], KneeR: [-10, 0, 0], ArmL: [28, 0, -8], ArmR: [-26, 0, 8] }), body: [0, 0, 0] },
    { t: 0.44, pose: pose({ Spine: [-3, 0, 0], LegL: [-12, 0, 0], KneeL: [-10, 0, 0], LegR: [10, 0, 0], KneeR: [-40, 0, 0], ArmL: [14, 0, -8], ArmR: [-14, 0, 8] }), body: [0, 0.014, 0] },
    { t: 0.56, pose: pose({ Spine: [-3, 0, 0], LegL: [-4, 0, 0], KneeL: [-8, 0, 0], LegR: [-4, 0, 0], KneeR: [-52, 0, 0], ArmL: [6, 0, -8], ArmR: [-8, 0, 8] }), body: [0, 0.02, 0] },
    { t: 0.68, pose: pose({ Spine: [-3, 0, 0], LegL: [28, 0, 0], KneeL: [-10, 0, 0], LegR: [-26, 0, 0], KneeR: [-8, 0, 0], ArmL: [-26, 0, -8], ArmR: [28, 0, 8] }), body: [0, 0, 0] },
  ]);

  /* Jump is split into four clips so the arc reads: launch, float, fall, land. The controller picks
     by vertical speed and height; `Jump` stays as a single-clip fallback. */
  const jumpStart = makeClip('JumpStart', [
    { t: 0.00, pose: pose({ Spine: [18, 0, 0], Head: [-6, 0, 0], ArmL: [30, 0, -14], ArmR: [30, 0, 14], ElbowL: [-80, 0, 0], ElbowR: [-80, 0, 0], LegL: [-46, 0, 0], KneeL: [80, 0, 0], LegR: [-46, 0, 0], KneeR: [80, 0, 0], LeftFoot: [-30, 0, 0], RightFoot: [-30, 0, 0] }), body: [0, -0.12, 0] },
    { t: 0.09, pose: pose({ Spine: [4, 0, 0], Head: [-4, 0, 0], ArmL: [-70, 0, -22], ArmR: [-70, 0, 22], ElbowL: [-20, 0, 0], ElbowR: [-20, 0, 0], LegL: [-8, 0, 0], KneeL: [10, 0, 0], LegR: [-8, 0, 0], KneeR: [10, 0, 0] }), body: [0, 0.02, 0] },
    { t: 0.20, pose: pose({ Spine: [-4, 0, 0], Head: [-6, 0, 0], ArmL: [-120, 0, -26], ArmR: [-120, 0, 26], ElbowL: [-10, 0, 0], ElbowR: [-10, 0, 0], LegL: [4, 0, 0], KneeL: [-4, 0, 0], LegR: [4, 0, 0], KneeR: [-4, 0, 0] }), body: [0, 0.05, 0] },
  ]);

  const jumpApex = makeClip('JumpApex', [
    { t: 0.00, pose: pose({ Spine: [8, 0, 0], Head: [-2, 0, 0], ArmL: [-100, 0, -30], ArmR: [-100, 0, 30], ElbowL: [-24, 0, 0], ElbowR: [-24, 0, 0], LegL: [-46, 0, 0], KneeL: [-74, 0, 0], LegR: [-18, 0, 0], KneeR: [-58, 0, 0] }), body: [0, 0.02, 0] },
    { t: 0.45, pose: pose({ Spine: [5, 0, 0], Head: [0, 0, 0], ArmL: [-96, 0, -34], ArmR: [-96, 0, 34], ElbowL: [-30, 0, 0], ElbowR: [-30, 0, 0], LegL: [-40, 0, 0], KneeL: [-66, 0, 0], LegR: [-14, 0, 0], KneeR: [-52, 0, 0] }), body: [0, 0.03, 0] },
    { t: 0.90, pose: pose({ Spine: [8, 0, 0], Head: [-2, 0, 0], ArmL: [-100, 0, -30], ArmR: [-100, 0, 30], ElbowL: [-24, 0, 0], ElbowR: [-24, 0, 0], LegL: [-46, 0, 0], KneeL: [-74, 0, 0], LegR: [-18, 0, 0], KneeR: [-58, 0, 0] }), body: [0, 0.02, 0] },
  ]);

  const fall = makeClip('Fall', [
    { t: 0.00, pose: pose({ Spine: [-6, 0, 0], Head: [4, 0, 0], ArmL: [-130, 0, -34], ArmR: [-130, 0, 34], ElbowL: [-16, 0, 0], ElbowR: [-16, 0, 0], LegL: [-14, 0, 0], KneeL: [-24, 0, 0], LegR: [8, 0, 0], KneeR: [-12, 0, 0] }), body: [0, 0.01, 0] },
    { t: 0.35, pose: pose({ Spine: [-10, 0, 0], Head: [6, 0, 0], ArmL: [-140, 0, -38], ArmR: [-140, 0, 38], LegL: [-6, 0, 0], KneeL: [-14, 0, 0], LegR: [14, 0, 0], KneeR: [-8, 0, 0] }), body: [0, 0.0, 0] },
    { t: 0.70, pose: pose({ Spine: [-6, 0, 0], Head: [4, 0, 0], ArmL: [-130, 0, -34], ArmR: [-130, 0, 34], ElbowL: [-16, 0, 0], ElbowR: [-16, 0, 0], LegL: [-14, 0, 0], KneeL: [-24, 0, 0], LegR: [8, 0, 0], KneeR: [-12, 0, 0] }), body: [0, 0.01, 0] },
  ]);

  const land = makeClip('Land', [
    { t: 0.00, pose: pose({ Spine: [26, 0, 0], Head: [-10, 0, 0], ArmL: [40, 0, -30], ArmR: [40, 0, 30], ElbowL: [-40, 0, 0], ElbowR: [-40, 0, 0], LegL: [-54, 0, 0], KneeL: [94, 0, 0], LegR: [-54, 0, 0], KneeR: [94, 0, 0], LeftFoot: [-36, 0, 0], RightFoot: [-36, 0, 0] }), body: [0, -0.16, 0] },
    { t: 0.12, pose: pose({ Spine: [14, 0, 0], Head: [-4, 0, 0], ArmL: [10, 0, -20], ArmR: [10, 0, 20], ElbowL: [-50, 0, 0], ElbowR: [-50, 0, 0], LegL: [-34, 0, 0], KneeL: [56, 0, 0], LegR: [-34, 0, 0], KneeR: [56, 0, 0], LeftFoot: [-20, 0, 0], RightFoot: [-20, 0, 0] }), body: [0, -0.08, 0] },
    { t: 0.26, pose: pose(), body: [0, 0, 0] },
  ]);

  // Kept for older call sites and as a safe fallback if a clip name goes missing.
  const jump = makeClip('Jump', [
    { t: 0.00, pose: pose({ Spine: [-4, 0, 0], ArmL: [-110, 0, -28], ArmR: [-110, 0, 28], ElbowL: [-16, 0, 0], ElbowR: [-16, 0, 0], LegL: [-36, 0, 0], KneeL: [-62, 0, 0], LegR: [-12, 0, 0], KneeR: [-48, 0, 0] }), body: [0, 0.02, 0] },
    { t: 0.35, pose: pose({ Spine: [-2, 0, 0], ArmL: [-95, 0, -25], ArmR: [-95, 0, 25], LegL: [-30, 0, 0], KneeL: [-55, 0, 0], LegR: [-12, 0, 0], KneeR: [-40, 0, 0] }), body: [0, 0.03, 0] },
    { t: 0.70, pose: pose({ Spine: [-6, 0, 0], ArmL: [-80, 0, -20], ArmR: [-80, 0, 20], ElbowL: [-20, 0, 0], ElbowR: [-20, 0, 0], LegL: [-40, 0, 0], KneeL: [-70, 0, 0], LegR: [-20, 0, 0], KneeR: [-50, 0, 0] }), body: [0, 0.02, 0] },
  ]);

  const crouchPose = pose({
    Spine: [16, 0, 0], Head: [-8, 0, 0],
    ArmL: [-20, 0, -10], ArmR: [-20, 0, 10], ElbowL: [-70, 0, 0], ElbowR: [-70, 0, 0],
    LegL: [-55, 0, 0], KneeL: [95, 0, 0], LegR: [-55, 0, 0], KneeR: [95, 0, 0],
    LeftFoot: [-40, 0, 0], RightFoot: [-40, 0, 0],
  });
  const crouch = makeClip('Crouch', [
    { t: 0.00, pose: crouchPose, body: [0, -0.10, 0] },
    { t: 0.60, pose: { ...crouchPose, Spine: [18, 0, 0] }, body: [0, -0.108, 0] },
    { t: 1.20, pose: crouchPose, body: [0, -0.10, 0] },
  ]);

  const dash = makeClip('Dash', [
    { t: 0.00, pose: pose({ Spine: [30, 0, 0], Head: [-12, 0, 0], ArmL: [40, 0, -18], ArmR: [40, 0, 18], ElbowL: [-40, 0, 0], ElbowR: [-40, 0, 0], LegL: [24, 0, 0], KneeL: [-30, 0, 0], LegR: [-24, 0, 0], KneeR: [-40, 0, 0] }), body: [0, -0.04, 0.04] },
    { t: 0.06, pose: pose({ Spine: [46, 0, 0], Head: [-20, 0, 0], ArmL: [70, 0, -22], ArmR: [70, 0, 22], ElbowL: [-14, 0, 0], ElbowR: [-14, 0, 0], LegL: [46, 0, 0], KneeL: [-10, 0, 0], LegR: [-56, 0, 0], KneeR: [-52, 0, 0] }), body: [0, 0.0, 0.10] },
    { t: 0.14, pose: pose({ Spine: [42, 0, 0], Head: [-18, 0, 0], ArmL: [64, 0, -20], ArmR: [64, 0, 20], LegL: [34, 0, 0], KneeL: [-16, 0, 0], LegR: [-44, 0, 0], KneeR: [-40, 0, 0] }), body: [0, 0.01, 0.08] },
    { t: 0.24, pose: pose({ Spine: [16, 0, 0], Head: [-6, 0, 0], ArmL: [20, 0, -16], ArmR: [20, 0, 16], LegL: [10, 0, 0], LegR: [-12, 0, 0], KneeR: [-20, 0, 0] }), body: [0, -0.02, 0.02] },
  ]);

  const blockPose = pose({
    Spine: [-6, 0, 0], Head: [8, 0, 0],
    ArmL: [-112, 0, -20], ElbowL: [-102, 0, 0], ArmR: [-112, 0, 20], ElbowR: [-102, 0, 0],
    LegL: [-20, 0, 0], KneeL: [34, 0, 0], LegR: [-20, 0, 0], KneeR: [34, 0, 0],
    LeftFoot: [-14, 0, 0], RightFoot: [-14, 0, 0],
  });
  const block = makeClip('Block', [
    { t: 0.00, pose: blockPose, body: [0, -0.045, 0] },
    { t: 0.20, pose: { ...blockPose, Spine: [-8, 0, 0], ArmL: [-116, 0, -22], ArmR: [-116, 0, 22] }, body: [0, -0.05, -0.01] },
    { t: 0.50, pose: { ...blockPose, Spine: [-5, 0, 0] }, body: [0, -0.042, 0] },
    { t: 0.80, pose: { ...blockPose, Spine: [-8, 0, 0] }, body: [0, -0.05, -0.01] },
    { t: 1.00, pose: blockPose, body: [0, -0.045, 0] },
  ]);

  /* Directional reactions: high shots snap the head back, low shots fold the body over the hit. */
  const hitHigh = makeClip('HitReactHigh', [
    { t: 0.00, pose: pose(), body: [0, 0, 0] },
    { t: 0.05, pose: pose({ Spine: [-40, 0, 0], Head: [-38, 0, 0], ArmL: [46, 0, -30], ArmR: [52, 0, 30], ElbowL: [-16, 0, 0], ElbowR: [-16, 0, 0], LegL: [-14, 0, 0], KneeL: [-6, 0, 0], LegR: [12, 0, 0] }), body: [0, -0.01, -0.07] },
    { t: 0.14, pose: pose({ Spine: [-26, 0, 0], Head: [-20, 0, 0], ArmL: [20, 0, -20], ArmR: [26, 0, 20] }), body: [0, 0, -0.04] },
    { t: 0.24, pose: pose({ Spine: [-8, 0, 0], Head: [-4, 0, 0] }), body: [0, 0, -0.01] },
    { t: 0.36, pose: pose(), body: [0, 0, 0] },
  ]);

  const hitLow = makeClip('HitReactLow', [
    { t: 0.00, pose: pose(), body: [0, 0, 0] },
    { t: 0.05, pose: pose({ Spine: [46, 0, 0], Head: [18, 0, 0], ArmL: [-30, 0, -34], ArmR: [-26, 0, 34], ElbowL: [-70, 0, 0], ElbowR: [-70, 0, 0], LegL: [-26, 0, 0], KneeL: [44, 0, 0], LegR: [-18, 0, 0], KneeR: [30, 0, 0] }), body: [0, -0.09, -0.05] },
    { t: 0.15, pose: pose({ Spine: [30, 0, 0], Head: [10, 0, 0], ArmL: [-20, 0, -26], ArmR: [-16, 0, 26], LegL: [-16, 0, 0], KneeL: [26, 0, 0], LegR: [-12, 0, 0], KneeR: [18, 0, 0] }), body: [0, -0.05, -0.03] },
    { t: 0.28, pose: pose({ Spine: [10, 0, 0] }), body: [0, -0.01, 0] },
    { t: 0.40, pose: pose(), body: [0, 0, 0] },
  ]);

  const hit = makeClip('HitReact', [
    { t: 0.00, pose: pose(), body: [0, 0, 0] },
    { t: 0.06, pose: pose({ Spine: [-35, 0, 0], Head: [-30, 0, 0], ArmL: [30, 0, -25], ArmR: [35, 0, 25], ElbowL: [-20, 0, 0], ElbowR: [-20, 0, 0], LegL: [-10, 0, 0], LegR: [10, 0, 0] }), body: [0, 0, -0.06] },
    { t: 0.18, pose: pose({ Spine: [-18, 0, 0], Head: [-12, 0, 0], ArmL: [10, 0, -15], ArmR: [15, 0, 15] }), body: [0, 0, -0.03] },
    { t: 0.30, pose: pose(), body: [0, 0, 0] },
  ]);

  const ko = makeClip('Knockout', [
    { t: 0.00, pose: pose(), body: [0, 0, 0] },
    { t: 0.16, pose: pose({ Spine: [-42, 0, 0], Head: [-38, 0, 0], ArmL: [78, 0, -34], ArmR: [84, 0, 34], ElbowL: [-10, 0, 0], ElbowR: [-10, 0, 0], LegL: [-26, 0, 0], KneeL: [-14, 0, 0], LegR: [16, 0, 0] }), body: [0, 0.02, -0.16] },
    { t: 0.34, pose: pose({ Body: [-58, 0, 0], Spine: [-22, 0, 0], Head: [-26, 0, 0], ArmL: [56, 0, -42], ArmR: [60, 0, 42], LegL: [-42, 0, 0], KneeL: [-40, 0, 0], LegR: [-16, 0, 0], KneeR: [-26, 0, 0] }), body: [0, 0.08, -0.20] },
    { t: 0.52, pose: pose({ Body: [-88, 0, 0], Spine: [-8, 0, 0], Head: [-14, 0, 0], ArmL: [26, 0, -48], ArmR: [30, 0, 48], LegL: [-30, 0, 0], KneeL: [-24, 0, 0], LegR: [-6, 0, 0], KneeR: [-14, 0, 0] }), body: [0, 0.04, -0.26] },
    { t: 0.68, pose: pose({ Body: [-84, 0, 0], Spine: [-4, 0, 0], Head: [-8, 0, 0], ArmL: [14, 0, -50], ArmR: [16, 0, 50], LegL: [-20, 0, 0], KneeL: [-16, 0, 0], LegR: [-2, 0, 0], KneeR: [-8, 0, 0] }), body: [0, 0.06, -0.27] },
    { t: 0.86, pose: pose({ Body: [-90, 0, 0], Spine: [-2, 0, 0], Head: [-4, 0, 0], ArmL: [8, 0, -52], ArmR: [10, 0, 52], LegL: [-14, 0, 0], KneeL: [-10, 0, 0], LegR: [0, 0, 0], KneeR: [-4, 0, 0] }), body: [0, 0.04, -0.28] },
  ]);

  /* GetUp runs when a knocked-down fighter is reset for the next round. */
  const getUp = makeClip('GetUp', [
    { t: 0.00, pose: pose({ Body: [-90, 0, 0], Spine: [-2, 0, 0], Head: [-4, 0, 0], ArmL: [8, 0, -52], ArmR: [10, 0, 52], LegL: [-14, 0, 0], KneeL: [-10, 0, 0], LegR: [0, 0, 0], KneeR: [-4, 0, 0] }), body: [0, 0.04, -0.28] },
    { t: 0.18, pose: pose({ Body: [-64, 0, 0], Spine: [16, 0, 0], Head: [10, 0, 0], ArmL: [-60, 0, -30], ArmR: [-60, 0, 30], ElbowL: [-80, 0, 0], ElbowR: [-80, 0, 0], LegL: [-46, 0, 0], KneeL: [70, 0, 0], LegR: [-24, 0, 0], KneeR: [50, 0, 0] }), body: [0, 0.0, -0.20] },
    { t: 0.42, pose: pose({ Body: [-26, 0, 0], Spine: [34, 0, 0], Head: [2, 0, 0], ArmL: [-40, 0, -24], ArmR: [-40, 0, 24], ElbowL: [-60, 0, 0], ElbowR: [-60, 0, 0], LegL: [-52, 0, 0], KneeL: [88, 0, 0], LegR: [-30, 0, 0], KneeR: [60, 0, 0] }), body: [0, -0.14, -0.10] },
    { t: 0.66, pose: pose({ Body: [-4, 0, 0], Spine: [18, 0, 0], Head: [-4, 0, 0], ArmL: [-30, 0, -18], ArmR: [-30, 0, 18], ElbowL: [-60, 0, 0], ElbowR: [-60, 0, 0], LegL: [-32, 0, 0], KneeL: [50, 0, 0], LegR: [-18, 0, 0], KneeR: [32, 0, 0] }), body: [0, -0.06, -0.03] },
    { t: 0.90, pose: pose({ Spine: [6, 0, 0] }), body: [0, 0, 0] },
  ]);

  const victory = makeClip('Victory', [
    { t: 0.00, pose: pose(), body: [0, 0, 0] },
    { t: 0.16, pose: pose({ Spine: [14, 0, 0], Head: [6, 0, 0], ArmL: [20, 0, -16], ArmR: [20, 0, 16], ElbowL: [-70, 0, 0], ElbowR: [-70, 0, 0], LegL: [-16, 0, 0], KneeL: [24, 0, 0], LegR: [-16, 0, 0], KneeR: [24, 0, 0] }), body: [0, -0.05, 0] },
    { t: 0.42, pose: pose({ Spine: [-10, 0, 0], Head: [-14, 0, 0], ArmL: [-168, 0, -26], ArmR: [-168, 0, 26], ElbowL: [-14, 0, 0], ElbowR: [-14, 0, 0], LegL: [6, 0, 0], LegR: [-6, 0, 0] }), body: [0, 0.05, 0] },
    { t: 0.68, pose: pose({ Spine: [-6, 0, 0], Head: [-10, 0, 0], ArmL: [-160, 0, -30], ArmR: [-160, 0, 30], ElbowL: [-18, 0, 0], ElbowR: [-18, 0, 0], LegL: [4, 0, 0], LegR: [-4, 0, 0] }), body: [0, 0.0, 0] },
    { t: 1.10, pose: pose({ Spine: [-9, 0, 0], Head: [-12, 0, 0], ArmL: [-166, 0, -24], ArmR: [-166, 0, 24], ElbowL: [-12, 0, 0], ElbowR: [-12, 0, 0], LegL: [5, 0, 0], LegR: [-5, 0, 0] }), body: [0, 0.03, 0] },
  ]);

  /* ------------------------------- attacks ------------------------------- */

  const guardArms: Pose = { ArmL: [-45, 0, -14], ElbowL: [-85, 0, 0], ArmR: [-45, 0, 14], ElbowR: [-85, 0, 0] };

  const lightPunch = makeClip('LightPunch', attackKeys(MOVES.LightPunch, [
    { at: 0, pose: pose() },
    { at: 'wind', pose: pose({ Spine: [4, 18, 0], ArmR: [25, 0, 10], ElbowR: [-110, 0, 0], ArmL: [-40, 0, -12], ElbowL: [-80, 0, 0], LegR: [6, 0, 0], KneeR: [-16, 0, 0] }) },
    { at: 'hit', pose: pose({ Spine: [6, -26, 0], Head: [0, -8, 0], ArmR: [-95, 0, 10], ElbowR: [0, 0, 0], ArmL: [-55, 0, -18], ElbowL: [-95, 0, 0], LegL: [-10, 0, 0], KneeL: [12, 0, 0], LegR: [8, 0, 0], KneeR: [-14, 0, 0] }), body: [0, 0, 0.03] },
    { at: 'hold', pose: pose({ Spine: [6, -26, 0], Head: [0, -8, 0], ArmR: [-95, 0, 10], ElbowR: [0, 0, 0], ArmL: [-55, 0, -18], ElbowL: [-95, 0, 0], LegL: [-10, 0, 0], KneeL: [12, 0, 0], LegR: [8, 0, 0], KneeR: [-14, 0, 0] }), body: [0, 0, 0.03] },
    { at: 'end', pose: pose() },
  ]));

  const lightKick = makeClip('LightKick', attackKeys(MOVES.LightKick, [
    { at: 0, pose: pose() },
    { at: 'wind', pose: pose({ Spine: [-6, 0, 0], LegR: [-30, 0, 0], KneeR: [-95, 0, 0], ArmL: [10, 0, -20], ArmR: [15, 0, 20] }) },
    { at: 'hit', pose: pose({ Spine: [-14, 0, 0], LegR: [-95, 0, 0], KneeR: [0, 0, 0], RightFoot: [-20, 0, 0], ArmL: [20, 0, -25], ArmR: [25, 0, 25], LegL: [8, 0, 0], KneeL: [-6, 0, 0] }), body: [0, 0.01, 0] },
    { at: 'hold', pose: pose({ Spine: [-14, 0, 0], LegR: [-95, 0, 0], KneeR: [0, 0, 0], RightFoot: [-20, 0, 0], ArmL: [20, 0, -25], ArmR: [25, 0, 25], LegL: [8, 0, 0], KneeL: [-6, 0, 0] }), body: [0, 0.01, 0] },
    { at: 'end', pose: pose() },
  ]));

  const heavyPunch = makeClip('HeavyPunch', attackKeys(MOVES.HeavyPunch, [
    { at: 0, pose: pose() },
    { at: 'wind', pose: pose({ Spine: [2, 40, 0], Head: [0, 16, 0], ArmR: [50, 0, 18], ElbowR: [-120, 0, 0], ArmL: [-60, 0, -16], ElbowL: [-100, 0, 0], LegL: [-16, 0, 0], KneeL: [18, 0, 0], LegR: [12, 0, 0], KneeR: [-20, 0, 0] }), body: [0, -0.01, -0.03] },
    { at: 'hit', pose: pose({ Spine: [12, -45, 0], Head: [2, -18, 0], ArmR: [-100, 0, 6], ElbowR: [0, 0, 0], ArmL: [35, 0, -25], ElbowL: [-60, 0, 0], LegL: [-24, 0, 0], KneeL: [26, 0, 0], LegR: [16, 0, 0], KneeR: [-24, 0, 0] }), body: [0, 0, 0.09] },
    { at: 'hold', pose: pose({ Spine: [12, -45, 0], Head: [2, -18, 0], ArmR: [-100, 0, 6], ElbowR: [0, 0, 0], ArmL: [35, 0, -25], ElbowL: [-60, 0, 0], LegL: [-24, 0, 0], KneeL: [26, 0, 0], LegR: [16, 0, 0], KneeR: [-24, 0, 0] }), body: [0, 0, 0.09] },
    // Settle: weight lands on the front foot and the shoulder unwinds before the guard comes back.
    { at: 21, pose: pose({ Spine: [14, -14, 0], Head: [2, -4, 0], ArmR: [-62, 0, 14], ElbowR: [-46, 0, 0], ArmL: [10, 0, -18], ElbowL: [-70, 0, 0], LegL: [-18, 0, 0], KneeL: [22, 0, 0], LegR: [12, 0, 0], KneeR: [-18, 0, 0] }), body: [0, -0.03, 0.04] },
    { at: 'end', pose: pose() },
  ]));

  const heavyKick = makeClip('HeavyKick', attackKeys(MOVES.HeavyKick, [
    { at: 0, pose: pose() },
    { at: 'wind', pose: pose({ Spine: [-12, 0, 0], LegR: [-55, 0, 0], KneeR: [-110, 0, 0], ArmL: [25, 0, -25], ArmR: [30, 0, 25], LegL: [10, 0, 0], KneeL: [-14, 0, 0] }), body: [0, 0.01, -0.02] },
    { at: 'hit', pose: pose({ Spine: [22, 0, 0], Head: [-8, 0, 0], LegR: [-72, 0, 0], KneeR: [12, 0, 0], RightFoot: [-24, 0, 0], ArmL: [50, 0, -30], ArmR: [55, 0, 30], LegL: [-30, 0, 0], KneeL: [40, 0, 0] }), body: [0, -0.06, 0.06] },
    { at: 'hold', pose: pose({ Spine: [22, 0, 0], Head: [-8, 0, 0], LegR: [-72, 0, 0], KneeR: [12, 0, 0], RightFoot: [-24, 0, 0], ArmL: [50, 0, -30], ArmR: [55, 0, 30], LegL: [-30, 0, 0], KneeL: [40, 0, 0] }), body: [0, -0.06, 0.06] },
    // Settle: the kicking leg folds back under the hips and the torso unwinds.
    { at: 24, pose: pose({ Spine: [16, 0, 0], Head: [-4, 0, 0], LegR: [-44, 0, 0], KneeR: [-40, 0, 0], RightFoot: [-12, 0, 0], ArmL: [26, 0, -22], ArmR: [30, 0, 22], LegL: [-20, 0, 0], KneeL: [26, 0, 0] }), body: [0, -0.03, 0.02] },
    { at: 'end', pose: pose() },
  ]));

  const sweep = makeClip('Sweep', attackKeys(MOVES.Sweep, [
    { at: 0, pose: pose() },
    { at: 'wind', pose: pose({ Spine: [26, 0, 0], Head: [-10, 0, 0], LegR: [-60, 0, 0], KneeR: [-70, 0, 0], LegL: [-50, 0, 0], KneeL: [80, 0, 0], ArmL: [20, 0, -35], ArmR: [25, 0, 35] }), body: [0, -0.10, 0] },
    { at: 'hit', pose: pose({ Spine: [42, 0, 0], Head: [-16, 0, 0], LegR: [-84, 0, 0], KneeR: [14, 0, 0], RightFoot: [-30, 0, 0], LegL: [-55, 0, 0], KneeL: [95, 0, 0], LeftFoot: [-40, 0, 0], ArmL: [40, 0, -40], ArmR: [45, 0, 40] }), body: [0, -0.17, 0.03] },
    { at: 'hold', pose: pose({ Spine: [42, 0, 0], Head: [-16, 0, 0], LegR: [-84, 0, 0], KneeR: [14, 0, 0], RightFoot: [-30, 0, 0], LegL: [-55, 0, 0], KneeL: [95, 0, 0], LeftFoot: [-40, 0, 0], ArmL: [40, 0, -40], ArmR: [45, 0, 40] }), body: [0, -0.17, 0.03] },
    // Settle: push back up out of the low spin.
    { at: 25, pose: pose({ Spine: [26, 0, 0], Head: [-8, 0, 0], LegR: [-42, 0, 0], KneeR: [30, 0, 0], LegL: [-30, 0, 0], KneeL: [50, 0, 0], LeftFoot: [-22, 0, 0], ArmL: [22, 0, -28], ArmR: [26, 0, 28] }), body: [0, -0.09, 0.02] },
    { at: 'end', pose: pose() },
  ]));

  const airPunch = makeClip('AirPunch', attackKeys(MOVES.AirPunch, [
    { at: 0, pose: pose({ Spine: [-4, 0, 0], ArmL: [-70, 0, -20], ArmR: [-70, 0, 20], ElbowL: [-30, 0, 0], ElbowR: [-30, 0, 0], LegL: [-35, 0, 0], KneeL: [-70, 0, 0], LegR: [-15, 0, 0], KneeR: [-45, 0, 0] }) },
    { at: 'wind', pose: pose({ Spine: [-4, 12, 0], ArmR: [20, 0, 12], ElbowR: [-100, 0, 0], ArmL: [-60, 0, -18], ElbowL: [-60, 0, 0], LegL: [-35, 0, 0], KneeL: [-70, 0, 0], LegR: [-15, 0, 0], KneeR: [-45, 0, 0] }) },
    { at: 'hit', pose: pose({ Spine: [10, -22, 0], ArmR: [-100, 0, 12], ElbowR: [0, 0, 0], ArmL: [-50, 0, -20], ElbowL: [-70, 0, 0], LegL: [-40, 0, 0], KneeL: [-75, 0, 0], LegR: [-20, 0, 0], KneeR: [-50, 0, 0] }) },
    { at: 'hold', pose: pose({ Spine: [10, -22, 0], ArmR: [-100, 0, 12], ElbowR: [0, 0, 0], ArmL: [-50, 0, -20], ElbowL: [-70, 0, 0], LegL: [-40, 0, 0], KneeL: [-75, 0, 0], LegR: [-20, 0, 0], KneeR: [-50, 0, 0] }) },
    { at: 'end', pose: pose({ Spine: [-2, 0, 0], ArmL: [-60, 0, -18], ArmR: [-60, 0, 18], LegL: [-30, 0, 0], KneeL: [-60, 0, 0], LegR: [-12, 0, 0], KneeR: [-40, 0, 0] }) },
  ]));

  const airKick = makeClip('AirKick', attackKeys(MOVES.AirKick, [
    { at: 0, pose: pose({ Spine: [-4, 0, 0], ArmL: [-70, 0, -20], ArmR: [-70, 0, 20], LegL: [-35, 0, 0], KneeL: [-70, 0, 0], LegR: [-15, 0, 0], KneeR: [-45, 0, 0] }) },
    { at: 'wind', pose: pose({ Spine: [-10, 0, 0], LegR: [-60, 0, 0], KneeR: [-90, 0, 0], ArmL: [30, 0, -25], ArmR: [30, 0, 25], LegL: [-35, 0, 0], KneeL: [-70, 0, 0] }) },
    { at: 'hit', pose: pose({ Spine: [22, 0, 0], Head: [-6, 0, 0], LegR: [-80, 0, 0], KneeR: [0, 0, 0], RightFoot: [-20, 0, 0], ArmL: [55, 0, -30], ArmR: [55, 0, 30], LegL: [-20, 0, 0], KneeL: [-55, 0, 0] }) },
    { at: 'hold', pose: pose({ Spine: [22, 0, 0], Head: [-6, 0, 0], LegR: [-80, 0, 0], KneeR: [0, 0, 0], RightFoot: [-20, 0, 0], ArmL: [55, 0, -30], ArmR: [55, 0, 30], LegL: [-20, 0, 0], KneeL: [-55, 0, 0] }) },
    { at: 'end', pose: pose({ Spine: [-2, 0, 0], ArmL: [-60, 0, -18], ArmR: [-60, 0, 18], LegL: [-30, 0, 0], KneeL: [-60, 0, 0], LegR: [-12, 0, 0], KneeR: [-40, 0, 0] }) },
  ]));

  /* ------------------------------- spells ------------------------------- */
  // One shared clip name and one shared frame window (14/1/24) for every fighter: only the
  // choreography differs, so the move stays mechanically identical for wagered matches.
  const spell = spellClip(id, st);
  const overdrive = overdriveClip(id, st);

  const grabReach = pose({ Spine: [18, 0, 0], Head: [-6, 0, 0], ArmL: [-88, 0, -22], ArmR: [-88, 0, 22], ElbowL: [-10, 0, 0], ElbowR: [-10, 0, 0], LegL: [-26, 0, 0], KneeL: [34, 0, 0], LegR: [14, 0, 0], KneeR: [-20, 0, 0] });
  const grab = makeClip('Grab', attackKeys(MOVES.Grab, [
    { at: 0, pose: pose() },
    { at: 'wind', pose: pose({ Spine: [-8, 0, 0], ArmL: [30, 0, -35], ArmR: [30, 0, 35], ElbowL: [-80, 0, 0], ElbowR: [-80, 0, 0], LegL: [-20, 0, 0], KneeL: [26, 0, 0], LegR: [10, 0, 0], KneeR: [-16, 0, 0] }), body: [0, -0.02, -0.02] },
    { at: 'hit', pose: grabReach, body: [0, 0, 0.06] },
    { at: 'hold', pose: pose({ Spine: [-24, 55, 0], Head: [-6, 20, 0], ArmL: [-60, 0, -40], ArmR: [-60, 0, 40], ElbowL: [-70, 0, 0], ElbowR: [-70, 0, 0], LegL: [-10, 0, 0], LegR: [16, 0, 0], KneeR: [-24, 0, 0] }), body: [0, 0.01, -0.06] },
    { at: 'end', pose: pose() },
  ]));

  void guardArms;
  void totalFrames;

  return {
    scene: root,
    animations: [
      idle, walkF, walkB, jumpStart, jumpApex, fall, land, jump, crouch, dash, block,
      hitHigh, hitLow, hit, ko, getUp, victory,
      lightPunch, lightKick, heavyPunch, heavyKick, sweep, airPunch, airKick, spell, overdrive, grab,
    ],
  };
}

/** Names every fighter shares; handy for tests and tooling. */
export const CLIP_NAMES: readonly MoveName[] = [
  'LightPunch', 'LightKick', 'HeavyPunch', 'HeavyKick', 'Sweep', 'AirPunch', 'AirKick',
  'Spell', 'Overdrive', 'Grab',
];
