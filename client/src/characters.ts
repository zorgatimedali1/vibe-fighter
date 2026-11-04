// Character data from the Phase 2 spec sheet. Fighters are COSMETIC + hitbox-shape only: for fair
// wagering the server gives every fighter identical speed, health and frame data (see moves.ts).
// Units are meters; each model is scaled to `heightM`.

export type BoneKey = 'Head' | 'Spine' | 'LeftHand' | 'RightHand' | 'LeftFoot' | 'RightFoot';
export type HurtName = 'head' | 'torso' | 'legL' | 'legR';
export type HitName = 'rightHand' | 'leftHand' | 'rightFoot';
export type AttackName = 'LightPunch' | 'HeavyKick';
export type Archetype = 'Heavy Brawler' | 'Agile Rushdown' | 'Long-Reach Zoner' | 'Evasive Aerialist' | 'Grappler';

export interface BoxDims {
  size: [number, number, number];   // width, height, depth
  offset: [number, number, number]; // bone-local offset (bone space)
}
export interface CharacterSpec {
  id: string; name: string; archetype: Archetype; glb: string;
  heightM: number; wingspanM: number; reachM: number;
  walkSpeed: number; walkBackMul: number; maxHealth: number;
  /** Regex candidates per bone (first match wins). */
  boneNames: Record<BoneKey, RegExp>;
  /** Used when the rig lacks a bone (voxel models often have no hands/feet): a proxy anchor
   *  is created under the model root at this normalized position (x right, y up, z forward). */
  fallbackAnchors: Record<BoneKey, [number, number, number]>;
  hurtboxes: Record<HurtName, BoxDims>;
  hitboxes: Record<HitName, BoxDims>;
}

const BONES = (prefix = '(mixamorig:?)?'): Record<BoneKey, RegExp> => ({
  Head: new RegExp(`${prefix}head$`, 'i'),
  Spine: new RegExp(`${prefix}(spine2|spine1|spine|chest)$`, 'i'),
  LeftHand: new RegExp(`${prefix}(left_?hand|hand_?l|l_hand)$`, 'i'),
  RightHand: new RegExp(`${prefix}(right_?hand|hand_?r|r_hand)$`, 'i'),
  LeftFoot: new RegExp(`${prefix}(left_?foot|foot_?l|l_foot)$`, 'i'),
  RightFoot: new RegExp(`${prefix}(right_?foot|foot_?r|r_foot)$`, 'i'),
});

const mk = (
  c: Pick<CharacterSpec, 'id' | 'name' | 'archetype' | 'glb' | 'heightM' | 'wingspanM' | 'walkSpeed' | 'walkBackMul' | 'maxHealth'>,
  headY: number, // head centre height ratio
  rest: Omit<CharacterSpec, keyof typeof c | 'reachM' | 'boneNames' | 'fallbackAnchors'>,
  reach: number, // fist/foot forward reach (m)
): CharacterSpec => ({
  ...c,
  reachM: reach,
  boneNames: BONES(),
  fallbackAnchors: {
    Head: [0, c.heightM * headY, 0],
    Spine: [0, c.heightM * 0.30, 0],
    LeftHand: [-c.wingspanM * 0.3, c.heightM * 0.28, reach * 0.4],
    RightHand: [c.wingspanM * 0.3, c.heightM * 0.28, reach * 0.4],
    LeftFoot: [-0.12, 0.05, 0],
    RightFoot: [0.12, 0.05, 0.05],
  },
  ...rest,
});


export const CHARACTERS: Record<string, CharacterSpec> = {
  // 1. Brown horned bruiser — visor, grey belt, stubby cream legs.
  ram: mk(
    { id: 'ram', name: 'Ram', archetype: 'Heavy Brawler', glb: '/models/ram.glb',
      heightM: 1.7, wingspanM: 1.45, walkSpeed: 2.6, walkBackMul: 0.7, maxHealth: 1100 },
    0.68,
    {
      hurtboxes: {
        head:  { size: [0.95, 0.80, 0.90], offset: [0, 0.05, 0] },
        torso: { size: [0.80, 0.45, 0.60], offset: [0, 0.0, 0] },
        legL:  { size: [0.22, 0.38, 0.22], offset: [0, 0.18, 0] },
        legR:  { size: [0.22, 0.38, 0.22], offset: [0, 0.18, 0] },
      },
      hitboxes: {
        rightHand: { size: [0.34, 0.34, 0.40], offset: [0, 0, 0.12] },
        leftHand:  { size: [0.34, 0.34, 0.40], offset: [0, 0, 0.12] },
        rightFoot: { size: [0.30, 0.26, 0.45], offset: [0, 0.05, 0.15] },
      },
    }, 0.45),

  // 2. Green cap rushdown — dark green body, cyan goggles, sneakers.
  cap: mk(
    { id: 'cap', name: 'Cap', archetype: 'Agile Rushdown', glb: '/models/cap.glb',
      heightM: 1.55, wingspanM: 1.35, walkSpeed: 3.6, walkBackMul: 0.8, maxHealth: 900 },
    0.70,
    {
      hurtboxes: {
        head:  { size: [0.85, 0.75, 0.80], offset: [0, 0.05, 0] },
        torso: { size: [0.65, 0.40, 0.50], offset: [0, 0, 0] },
        legL:  { size: [0.20, 0.34, 0.20], offset: [0, 0.16, 0] },
        legR:  { size: [0.20, 0.34, 0.20], offset: [0, 0.16, 0] },
      },
      hitboxes: {
        rightHand: { size: [0.26, 0.26, 0.34], offset: [0, 0, 0.10] },
        leftHand:  { size: [0.26, 0.26, 0.34], offset: [0, 0, 0.10] },
        rightFoot: { size: [0.28, 0.24, 0.55], offset: [0, 0.05, 0.22] },
      },
    }, 0.4),

  // 3. Grey antenna zoner — long reach via orange arm-blocks and big flat feet.
  antenna: mk(
    { id: 'antenna', name: 'Antenna', archetype: 'Long-Reach Zoner', glb: '/models/antenna.glb',
      heightM: 1.95, wingspanM: 1.9, walkSpeed: 2.9, walkBackMul: 0.9, maxHealth: 950 },
    0.62,
    {
      hurtboxes: {
        head:  { size: [0.85, 0.75, 0.80], offset: [0, 0.05, 0] },
        torso: { size: [0.70, 0.45, 0.50], offset: [0, 0, 0] },
        legL:  { size: [0.20, 0.45, 0.20], offset: [0, 0.22, 0] },
        legR:  { size: [0.20, 0.45, 0.20], offset: [0, 0.22, 0] },
      },
      hitboxes: {
        rightHand: { size: [0.30, 0.22, 0.65], offset: [0, 0, 0.30] },
        leftHand:  { size: [0.30, 0.22, 0.65], offset: [0, 0, 0.30] },
        rightFoot: { size: [0.34, 0.20, 0.75], offset: [0, 0.04, 0.30] },
      },
    }, 0.65),

  // 4. Red mohawk brawler — oversized head, black torso, club/backpack on right side.
  mohawk: mk(
    { id: 'mohawk', name: 'Mohawk', archetype: 'Grappler', glb: '/models/mohawk.glb',
      heightM: 1.6, wingspanM: 1.4, walkSpeed: 2.4, walkBackMul: 0.65, maxHealth: 1200 },
    0.68,
    {
      hurtboxes: {
        head:  { size: [0.95, 0.85, 0.90], offset: [0, 0.05, 0] },
        torso: { size: [0.80, 0.45, 0.60], offset: [0, 0, 0] },
        legL:  { size: [0.24, 0.36, 0.24], offset: [0, 0.17, 0] },
        legR:  { size: [0.24, 0.36, 0.24], offset: [0, 0.17, 0] },
      },
      hitboxes: {
        rightHand: { size: [0.40, 0.40, 0.45], offset: [0, 0, 0.14] }, // enlarged fist
        leftHand:  { size: [0.36, 0.36, 0.40], offset: [0, 0, 0.12] },
        rightFoot: { size: [0.30, 0.26, 0.42], offset: [0, 0.05, 0.14] },
      },
    }, 0.45),

  // 5. Teal propeller evasive — light frame, hovering hat gives aerial mobility.
  prop: mk(
    { id: 'prop', name: 'Prop', archetype: 'Evasive Aerialist', glb: '/models/prop.glb',
      heightM: 1.75, wingspanM: 1.5, walkSpeed: 3.2, walkBackMul: 1.0, maxHealth: 850 },
    0.62,
    {
      hurtboxes: {
        head:  { size: [0.85, 0.75, 0.80], offset: [0, 0.05, 0] },
        torso: { size: [0.65, 0.40, 0.50], offset: [0, 0, 0] },
        legL:  { size: [0.18, 0.40, 0.18], offset: [0, 0.20, 0] },
        legR:  { size: [0.18, 0.40, 0.18], offset: [0, 0.20, 0] },
      },
      hitboxes: {
        rightHand: { size: [0.26, 0.26, 0.40], offset: [0, 0, 0.14] },
        leftHand:  { size: [0.26, 0.26, 0.40], offset: [0, 0, 0.14] },
        rightFoot: { size: [0.26, 0.22, 0.55], offset: [0, 0.05, 0.22] },
      },
    }, 0.45),
};
