import type { HitName } from './characters';

/** Mirrors server/src/types/combat.ts. */
export type BotDifficulty = 'rookie' | 'easy' | 'normal' | 'hard' | 'insane' | 'nightmare';
export const BOT_DIFFICULTIES: readonly BotDifficulty[] = ['rookie', 'easy', 'normal', 'hard', 'insane', 'nightmare'];
export const DIFFICULTY_INFO: Record<BotDifficulty, { label: string; blurb: string }> = {
  rookie: { label: 'Rookie', blurb: 'A walking punching bag: barely guards, never punishes, rarely casts.' },
  easy: { label: 'Easy', blurb: 'Slow reactions, rare guards, almost never punishes.' },
  normal: { label: 'Normal', blurb: 'A fair sparring partner: guards, pokes and occasionally punishes.' },
  hard: { label: 'Hard', blurb: 'Fast reactions, frequent anti-airs and converts most openings.' },
  insane: { label: 'Insane', blurb: 'Near-instant reactions, airtight guard and relentless punishment.' },
  nightmare: { label: 'Nightmare', blurb: 'Frame-perfect reactions, no wasted attacks, punishes every gap.' },
};

/**
 * Mirrors server/src/engine/moves.ts. The server is authoritative; these timings only drive
 * animation, client-side prediction and the hitbox debug view. Keep them in sync.
 */
export const FIGHT = { walkSpeed: 3.0, walkBackMul: 0.8, arenaHalf: 9, spawnX: 2 } as const;

/** Mana meter (0–100). Same numbers on both sides. */
export const MAX_MANA = 100;
export const START_MANA = 30;
export const SPELL_COST = 50;
export const MANA_REGEN_PER_SEC = 6;

/** Guard meter (0–100). Blocked hits deal no damage but drain this; empty = guard break. */
export const GUARD_MAX = 100;
/** Perfect guard window: a fresh tap within this many frames of a hit parries it. */
export const PERFECT_GUARD_FRAMES = 3;
/** Overdrive (0–100): built by fighting, pays for the EX spell. */
export const OD_MAX = 100;
export const OD_COST = 100;

export type MoveName =
  | 'LightPunch' | 'LightKick' | 'HeavyPunch' | 'HeavyKick'
  | 'Sweep' | 'AirPunch' | 'AirKick' | 'Spell' | 'Overdrive' | 'Grab';

export type FxKind = 'punch' | 'kick' | 'heavy' | 'sweep' | 'air' | 'spell' | 'grab';

export interface ClientMove {
  hitbox: HitName;
  startup: number; active: number; recovery: number;
  fx: FxKind;
  /** Only usable while airborne. */
  air?: boolean;
  /** Shown in the move list / HOW TO PLAY. */
  label: string;
  input: string;
}

export const MOVES: Record<MoveName, ClientMove> = {
  LightPunch: { hitbox: 'rightHand', startup: 4, active: 3, recovery: 7, fx: 'punch', label: 'Jab', input: 'J' },
  LightKick: { hitbox: 'rightFoot', startup: 6, active: 3, recovery: 9, fx: 'kick', label: 'Quick kick', input: 'K' },
  HeavyPunch: { hitbox: 'rightHand', startup: 9, active: 4, recovery: 18, fx: 'heavy', label: 'Haymaker', input: 'I' },
  HeavyKick: { hitbox: 'rightFoot', startup: 12, active: 4, recovery: 20, fx: 'heavy', label: 'Low kick', input: 'U' },
  Sweep: { hitbox: 'rightFoot', startup: 11, active: 4, recovery: 22, fx: 'sweep', label: 'Sweep', input: 'S + U' },
  AirPunch: { hitbox: 'rightHand', startup: 5, active: 4, recovery: 10, fx: 'air', air: true, label: 'Air jab', input: 'J in air' },
  AirKick: { hitbox: 'rightFoot', startup: 7, active: 5, recovery: 12, fx: 'air', air: true, label: 'Dive kick', input: 'K in air' },
  Spell: { hitbox: 'rightHand', startup: 14, active: 1, recovery: 24, fx: 'spell', label: 'Spell', input: 'Q' },
  Overdrive: { hitbox: 'rightHand', startup: 12, active: 1, recovery: 30, fx: 'spell', label: 'Overdrive', input: 'E' },
  Grab: { hitbox: 'rightHand', startup: 12, active: 2, recovery: 20, fx: 'grab', label: 'Grab', input: 'H' },
};

export type MoveNameList = MoveName;
export const ATTACK_NAMES = Object.keys(MOVES) as MoveName[];

/** Overdrive ("EX") presentation + timing, mirrored from the server. */
export interface OverdriveTheme {
  name: string;
  glyph: string;
  kind: 'projectile' | 'beam' | 'melee';
  startup: number; active: number; recovery: number;
  damage: number;
  tagline: string;
}

/** Per-fighter spell mechanics, mirrored from server/src/engine/moves.ts. */
export interface SpellTheme {
  name: string;
  core: number; trail: number; glyph: string;
  vfx: 'wave' | 'slash' | 'beam' | 'uppercut' | 'cyclone';
  /** How the spell resolves: a thrown projectile, a hitscan lance or a melee blow. */
  kind: 'projectile' | 'beam' | 'melee';
  startup: number; active: number; recovery: number;
  cost: number;
  damage: number;
  /** Consecutive connections for multi-hit spells. */
  hits?: number;
  /** Guard meter drained when this spell is blocked. */
  guardDamage: number;
  /** Hard knockdown on hit. */
  knockdown?: boolean;
  armor?: boolean;
  /** The caster slides this far along its facing on release (negative = backwards). */
  selfPush?: number;
  /** Beam reach in metres (antenna only). */
  reach?: number;
  /** One-line mechanic summary shown in the lobby and the move list. */
  tagline: string;
  /** The EX version, paid for with a full Overdrive bar. */
  overdrive: OverdriveTheme;
}

/**
 * One signature spell per fighter, and each fighter can cast only its own. They are deliberately
 * different: Ram's rolling low wave, Cap's two-hit crescent, Antenna's duckable lance, Mohawk's
 * armoured reversal and Prop's self-recoiling arc.
 */
const SPELL_BASE: Record<string, Omit<SpellTheme, 'overdrive'>> = {
  ram: {
    name: 'Seismic Wave', core: 0xffd27a, trail: 0xb07a4a, glyph: '◈', vfx: 'wave', kind: 'projectile',
    startup: 18, active: 1, recovery: 26, cost: 42, damage: 14, guardDamage: 24, knockdown: true,
    tagline: 'Slow rolling shockwave that knocks down. Jump it or duck behind it.',
  },
  cap: {
    name: 'Gale Slash', core: 0xd6fff9, trail: 0x6fe8d8, glyph: '✦', vfx: 'slash', kind: 'projectile',
    startup: 9, active: 1, recovery: 20, cost: 32, damage: 6, hits: 2, guardDamage: 9,
    tagline: 'Cheap crescent that cuts twice — brutal on a guard meter.',
  },
  antenna: {
    name: 'Signal Beam', core: 0xffd9a0, trail: 0xf08a24, glyph: '▲', vfx: 'beam', kind: 'beam',
    startup: 18, active: 2, recovery: 34, cost: 55, damage: 18, guardDamage: 32, reach: 6.4,
    tagline: 'Head-height lance across the screen: crouch under it. Huge recovery.',
  },
  mohawk: {
    name: 'Magma Fist', core: 0xffb070, trail: 0xc8402a, glyph: '✹', vfx: 'uppercut', kind: 'melee',
    startup: 13, active: 4, recovery: 28, cost: 55, damage: 21, guardDamage: 30, armor: true, knockdown: true,
    tagline: 'Armoured rising uppercut with a hard knockdown. Beats one hit, loses to grabs.',
  },
  prop: {
    name: 'Cyclone', core: 0xa6f0a0, trail: 0x23907e, glyph: '◎', vfx: 'cyclone', kind: 'projectile',
    startup: 20, active: 1, recovery: 30, cost: 48, damage: 15, guardDamage: 26, selfPush: -0.45,
    tagline: 'Arcing overhead vortex; the gust shoves Prop backwards.',
  },
};
/** EX spells: one Overdrive bar, a much stronger and more committal version of the fighter's spell. */
const OVERDRIVES: Record<string, OverdriveTheme> = {
  ram: {
    name: 'Continental Rift', glyph: '◈◈', kind: 'projectile', startup: 16, active: 1, recovery: 26,
    damage: 16, tagline: 'Armoured double shockwave, knocks down twice.',
  },
  cap: {
    name: 'Tempest Barrage', glyph: '✦✦', kind: 'projectile', startup: 8, active: 1, recovery: 22,
    damage: 7, tagline: 'Three crescents; shreds a guard meter.',
  },
  antenna: {
    name: 'Orbital Lance', glyph: '▲▲', kind: 'beam', startup: 20, active: 2, recovery: 40,
    damage: 24, tagline: 'Full-height lance — block it or eat it.',
  },
  mohawk: {
    name: 'Volcanic Overdrive', glyph: '✹✹', kind: 'melee', startup: 10, active: 5, recovery: 30,
    damage: 30, tagline: 'Armoured 30-damage reversal.',
  },
  prop: {
    name: 'Eye of the Storm', glyph: '◎◎', kind: 'projectile', startup: 18, active: 1, recovery: 32,
    damage: 15, tagline: 'Slow double vortex that eats guard.',
  },
};

export const SPELLS: Record<string, SpellTheme> = Object.fromEntries(
  Object.entries(SPELL_BASE).map(([id, s]) => [id, { ...s, overdrive: OVERDRIVES[id] }]),
);

export const spellFor = (id: string): SpellTheme => SPELLS[id] ?? SPELLS.ram;

/** Specials resolve per fighter: the base spell and the EX version have their own frame data. */
function specialTiming(m: MoveName, fighter?: string) {
  if (!fighter) return null;
  if (m === 'Spell') {
    const s = spellFor(fighter);
    return { startup: s.startup, active: s.active, recovery: s.recovery };
  }
  if (m === 'Overdrive') {
    const o = spellFor(fighter).overdrive;
    return { startup: o.startup, active: o.active, recovery: o.recovery };
  }
  return null;
}

/** Total frames for a move; specials use the caster's own frame data. */
export const totalFrames = (m: MoveName, fighter?: string) => {
  const sp = specialTiming(m, fighter);
  return sp ? sp.startup + sp.active + sp.recovery : MOVES[m].startup + MOVES[m].active + MOVES[m].recovery;
};

/** Startup/active windows used by the client hitbox debug view. */
export const moveTiming = (m: MoveName, fighter?: string) => {
  const sp = specialTiming(m, fighter);
  return { startup: sp?.startup ?? MOVES[m].startup, active: sp?.active ?? MOVES[m].active, hitbox: MOVES[m].hitbox };
};

/** Stage affinity: the lobby preview and each fighter's home turf. */
export const STAGE_AFFINITY: Record<string, string> = {
  ram: 'lair', cap: 'airbase', antenna: 'courtyard', mohawk: 'pit', prop: 'castle',
};
