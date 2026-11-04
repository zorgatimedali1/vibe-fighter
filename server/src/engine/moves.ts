import type { FighterId, FrameData, MoveId } from '../types/combat.ts';

export const TICK_RATE = 60;
export const TICK_MS = 1000 / TICK_RATE;
export const SNAPSHOT_EVERY = 2;          // 30 Hz snapshots
export const ROUNDS_TO_WIN = 2;           // best of 3
export const ROUND_SECONDS = 99;
export const START_HP = 100;
export const COUNTDOWN_TICKS = 180;
export const ROUND_END_TICKS = 150;
export const INPUT_BUFFER_FRAMES = 6;
export const MAX_RTT_COMP_MS = 150;       // lag-comp rewind ceiling
export const HISTORY_TICKS = 60;
export const RECONNECT_GRACE_MS = 15_000;

export const ARENA_HALF = 9;
export const SPAWN_X = 2;
export const PUSH_DIST = 0.7;
export const WALK_STEP = 3.0 / TICK_RATE;       // m/tick
export const BACK_STEP = 2.4 / TICK_RATE;
export const MAX_STEP = 0.07;                   // sanity ceiling for voluntary movement (m/tick)
export const JUMP_VY = 6.0;
export const GRAVITY = 18.0;

export const BODY = { halfW: 0.35, halfD: 0.3, standH: 1.6, crouchH: 0.85 };

/* ------------------------------- meter ------------------------------- */
export const MAX_MANA = 100;
export const START_MANA = 30;
export const MANA_REGEN_PER_TICK = 6 / TICK_RATE;   // +6/s
export const MANA_ON_HIT = 6;
export const MANA_ON_BLOCK = 3;
/** Fallback cost for the generic `MOVES.Spell` entry; real fighters use `SPELLS[id].manaCost`. */
export const SPELL_COST = 50;

/* ------------------------------- guard ------------------------------- */
/** Guard meter: blocks are free (zero damage) but not unlimited. Empty meter = guard break. */
export const GUARD_MAX = 100;
export const GUARD_REGEN_PER_TICK = 15 / TICK_RATE;  // +15/s once you stop blocking
export const GUARD_REGEN_DELAY = 40;                 // ticks after the last blocked hit before regen
export const GUARD_BREAK_FRAMES = 55;                // punish window after a guard break
export const GUARD_BREAK_RECOVER = 0.45;             // share of the meter restored when the stun ends
/** Pressing guard within this many frames of an incoming hit is a perfect guard. */
export const PERFECT_GUARD_FRAMES = 3;
/** Perfect guard leaves the attacker stuck in extra blockstun — that is the reward. */
export const PERFECT_GUARD_PUNISH = 16;

/* ------------------------------ overdrive ----------------------------- */
/** Overdrive builds by fighting and pays for the EX spell. One full bar per round is a good pace. */
export const OD_MAX = 100;
export const OD_COST = 100;
export const OD_ON_HIT = 0.8;                        // per point of damage dealt
export const OD_ON_TAKE = 1.0;                       // per point of damage taken (comeback meter)
export const OD_ON_BLOCK = 2;                        // flat, blocked hit
export const OD_ON_PERFECT = 6;                      // perfect guard
export const OD_ON_GUARD_BREAK = 12;                 // the defender gets paid for being opened up

/* ------------------------------- dash -------------------------------- */
export const DASH_FRAMES = 12;
export const DASH_DISTANCE = 2.2;
export const DASH_STEP = DASH_DISTANCE / DASH_FRAMES;
export const DASH_CANCEL_FRAME = 8;                 // normals can interrupt the tail of a dash
export const DOUBLE_TAP_WINDOW = 12;                // ticks between two taps of the same direction

/* ------------------------------- combos ------------------------------ */
export const CANCEL_WINDOW = 10;                    // frames after a hit/block where recovery cancels
export const COMBO_TIMEOUT = 40;                    // frames without a hit before scaling resets
/** Damage multiplier by combo index: 1st hit 100%, 2nd 80%, 3rd 65%, 4th+ 50%. */
export const COMBO_SCALE = [1, 0.8, 0.65, 0.5] as const;

/* ----------------------------- projectiles --------------------------- */
export const MAX_PROJECTILES_PER_PLAYER = 1;
export const PROJECTILE_CLASH_RADIUS = 0.55;

/**
 * Server-side Move Registry. The client mirrors timings in client/src/moves.ts for animation only.
 * Normals are identical for every fighter; the spell is resolved per fighter through `SPELLS`.
 */
export const MOVES: Record<MoveId, FrameData> = {
  LightPunch: {
    startup: 4, active: 3, recovery: 7, damage: 8, chipDamage: 1,
    hitstun: 12, blockstun: 6, knockback: 0.35, hitstop: 4,
    hitbox: { startOffset: 0.2, reach: 0.75, yMin: 0.95, yMax: 1.35, halfDepth: 0.4 },
  },
  LightKick: {
    startup: 6, active: 3, recovery: 9, damage: 9, chipDamage: 1,
    hitstun: 13, blockstun: 7, knockback: 0.4, hitstop: 4,
    hitbox: { startOffset: 0.25, reach: 0.95, yMin: 0.45, yMax: 1.1, halfDepth: 0.4 },
  },
  HeavyPunch: {
    startup: 9, active: 4, recovery: 18, damage: 16, chipDamage: 2,
    hitstun: 20, blockstun: 12, knockback: 0.8, hitstop: 6,
    hitbox: { startOffset: 0.2, reach: 1.0, yMin: 0.9, yMax: 1.45, halfDepth: 0.4 },
  },
  HeavyKick: {
    startup: 12, active: 4, recovery: 20, damage: 20, chipDamage: 3,
    hitstun: 24, blockstun: 14, knockback: 1.0, hitstop: 7, low: true, knockdown: true,
    hitbox: { startOffset: 0.2, reach: 1.15, yMin: 0.02, yMax: 0.6, halfDepth: 0.4 },
  },
  Sweep: {
    startup: 11, active: 4, recovery: 22, damage: 12, chipDamage: 2,
    hitstun: 22, blockstun: 13, knockback: 0.9, hitstop: 5, low: true, knockdown: true,
    hitbox: { startOffset: 0.15, reach: 1.2, yMin: 0.02, yMax: 0.45, halfDepth: 0.45 },
  },
  AirPunch: {
    startup: 5, active: 4, recovery: 10, damage: 10, chipDamage: 1,
    hitstun: 14, blockstun: 8, knockback: 0.4, hitstop: 4, overhead: true, air: true,
    hitbox: { startOffset: 0.15, reach: 0.8, yMin: 0.1, yMax: 0.9, halfDepth: 0.45 },
  },
  AirKick: {
    startup: 7, active: 5, recovery: 12, damage: 13, chipDamage: 2,
    hitstun: 18, blockstun: 10, knockback: 0.7, hitstop: 5, overhead: true, air: true,
    hitbox: { startOffset: 0.2, reach: 1.0, yMin: 0.0, yMax: 0.85, halfDepth: 0.45 },
  },
  /** Generic fallback used by tooling. CombatRoom resolves the real spell from SPELLS[fighter]. */
  Spell: {
    startup: 14, active: 1, recovery: 24, damage: 14, chipDamage: 0,
    hitstun: 18, blockstun: 12, knockback: 0.7, hitstop: 5, manaCost: SPELL_COST,
    projectile: { speed: 6, lifetime: 90, halfW: 0.28, halfH: 0.22, y: 1.0 },
    hitbox: { startOffset: 0.2, reach: 0.6, yMin: 0.9, yMax: 1.3, halfDepth: 0.4 },
  },
  /** Generic fallback used by tooling. CombatRoom resolves the real EX from SPELLS[fighter].overdrive. */
  Overdrive: {
    startup: 12, active: 1, recovery: 30, damage: 20, chipDamage: 0,
    hitstun: 22, blockstun: 14, knockback: 0.9, hitstop: 7,
    hitbox: { startOffset: 0.2, reach: 0.6, yMin: 0.9, yMax: 1.3, halfDepth: 0.4 },
  },
  Grab: {
    startup: 12, active: 2, recovery: 20, damage: 10, chipDamage: 0,
    hitstun: 30, blockstun: 0, knockback: 1.4, hitstop: 8, grab: true, knockdown: true,
    hitbox: { startOffset: 0.1, reach: 0.85, yMin: 0.3, yMax: 1.3, halfDepth: 0.45 },
  },
};

/* ------------------------------- spells ------------------------------- */

/** Presentation + mechanics shared with the client. */
export interface SpellDef extends FrameData {
  id: FighterId;
  name: string;
  glyph: string;
  core: number;
  trail: number;
  vfx: 'wave' | 'slash' | 'beam' | 'uppercut' | 'cyclone';
  /** One-line mechanic summary for the lobby. */
  tagline: string;
  /** The EX version of this fighter's spell, paid for with a full Overdrive bar. */
  overdrive: OverdriveDef;
}

/** Overdrive ("EX") move: same resolution kinds as a spell, but stronger and more committal. */
export interface OverdriveDef extends FrameData {
  id: FighterId;
  name: string;
  tagline: string;
  vfx: SpellDef['vfx'];
}

/**
 * One signature spell per fighter, and each fighter can cast *only* its own: the server resolves
 * `SPELLS[slot.fighter]` whenever the Spell button starts a move, so frame data, cost, range and
 * hit behaviour are all per-character. Normals stay identical so the neutral game is fair.
 *
 * Balance axes are deliberately different per spell: Ram is a slow low knockdown, Cap is cheap
 * multi-hit pressure, Antenna is a long lance you must duck, Mohawk is an armoured reversal and
 * Prop is an arcing overhead that also pushes the caster away.
 */
const SPELL_BASE: Record<FighterId, Omit<SpellDef, 'overdrive'>> = {
  ram: {
    id: 'ram', name: 'Seismic Wave', glyph: '◈', core: 0xffd27a, trail: 0xb07a4a, vfx: 'wave',
    tagline: 'Slow rolling shockwave, knocks down. Jump it or duck behind it — 42 mana.',
    startup: 18, active: 1, recovery: 26, damage: 14, chipDamage: 0,
    hitstun: 22, blockstun: 14, knockback: 0.9, hitstop: 6, manaCost: 42, low: true, knockdown: true,
    guardDamage: 24,
    projectile: { speed: 4.6, lifetime: 100, halfW: 0.34, halfH: 0.28, y: 0.2 },
    hitbox: { startOffset: 0.2, reach: 0.6, yMin: 0.9, yMax: 1.3, halfDepth: 0.4 },
  },
  cap: {
    id: 'cap', name: 'Gale Slash', glyph: '✦', core: 0xd6fff9, trail: 0x6fe8d8, vfx: 'slash',
    tagline: 'Cheap two-hit crescent that hits twice on block. 32 mana.',
    startup: 9, active: 1, recovery: 20, damage: 6, chipDamage: 0,
    hitstun: 13, blockstun: 8, knockback: 0.4, hitstop: 4, manaCost: 32,
    guardDamage: 9,
    projectile: { speed: 9.5, lifetime: 50, halfW: 0.22, halfH: 0.16, y: 1.0, hits: 2, hitGap: 7 },
    hitbox: { startOffset: 0.2, reach: 0.6, yMin: 0.9, yMax: 1.3, halfDepth: 0.4 },
  },
  antenna: {
    id: 'antenna', name: 'Signal Beam', glyph: '▲', core: 0xffd9a0, trail: 0xf08a24, vfx: 'beam',
    tagline: 'Head-height lance across the screen: crouch under it. 18 damage, 55 mana, huge recovery.',
    startup: 18, active: 2, recovery: 34, damage: 18, chipDamage: 0,
    hitstun: 20, blockstun: 16, knockback: 0.6, hitstop: 6, manaCost: 55,
    guardDamage: 32,
    beam: { length: 6.4, halfH: 0.22, y: 1.15 },
    hitbox: { startOffset: 0.2, reach: 0.6, yMin: 0.9, yMax: 1.3, halfDepth: 0.4 },
  },
  mohawk: {
    id: 'mohawk', name: 'Magma Fist', glyph: '✹', core: 0xffb070, trail: 0xc8402a, vfx: 'uppercut',
    tagline: 'Armoured rising uppercut, hard knockdown. Beats one hit, loses to grabs. 55 mana.',
    startup: 13, active: 4, recovery: 28, damage: 21, chipDamage: 0,
    hitstun: 26, blockstun: 16, knockback: 1.15, hitstop: 8, manaCost: 55,
    knockdown: true, armor: true, guardDamage: 30,
    hitbox: { startOffset: 0.05, reach: 1.0, yMin: 0.15, yMax: 1.55, halfDepth: 0.45 },
  },
  prop: {
    id: 'prop', name: 'Cyclone', glyph: '◎', core: 0xa6f0a0, trail: 0x23907e, vfx: 'cyclone',
    tagline: 'Arcing overhead vortex that falls on you; the gust shoves Prop backwards. 48 mana.',
    startup: 20, active: 1, recovery: 30, damage: 15, chipDamage: 0,
    hitstun: 20, blockstun: 14, knockback: 0.8, hitstop: 6, manaCost: 48, overhead: true,
    guardDamage: 26, selfPush: -0.45,
    projectile: { speed: 5.0, lifetime: 80, halfW: 0.42, halfH: 0.36, y: 1.55, vy: -0.6, gravity: 1.5 },
    hitbox: { startOffset: 0.2, reach: 0.6, yMin: 0.9, yMax: 1.3, halfDepth: 0.4 },
  },
};

/**
 * EX spells: one full Overdrive bar buys a much stronger, much more committal version of the
 * fighter's identity. Each one is deliberately a different *shape* of move, not just bigger numbers.
 */
const OVERDRIVES: Record<FighterId, OverdriveDef> = {
  ram: {
    id: 'ram', name: 'Continental Rift', vfx: 'wave',
    tagline: 'Armoured double shockwave that knocks down twice. Absorbs one hit on the way out.',
    startup: 16, active: 1, recovery: 26, damage: 16, chipDamage: 0,
    hitstun: 24, blockstun: 16, knockback: 1.0, hitstop: 7, guardDamage: 34, low: true,
    knockdown: true, armor: true,
    projectile: { speed: 5.2, lifetime: 110, halfW: 0.5, halfH: 0.34, y: 0.22, hits: 2, hitGap: 10 },
    hitbox: { startOffset: 0.2, reach: 0.6, yMin: 0.9, yMax: 1.3, halfDepth: 0.4 },
  },
  cap: {
    id: 'cap', name: 'Tempest Barrage', vfx: 'slash',
    tagline: 'Three crescents in one breath. Nightmare on a guard meter.',
    startup: 8, active: 1, recovery: 22, damage: 7, chipDamage: 0,
    hitstun: 14, blockstun: 9, knockback: 0.5, hitstop: 4, guardDamage: 10,
    projectile: { speed: 11, lifetime: 60, halfW: 0.3, halfH: 0.2, y: 1.0, hits: 3, hitGap: 6 },
    hitbox: { startOffset: 0.2, reach: 0.6, yMin: 0.9, yMax: 1.3, halfDepth: 0.4 },
  },
  antenna: {
    id: 'antenna', name: 'Orbital Lance', vfx: 'beam',
    tagline: 'Full-height lance: standing or crouching, you must block it. 40 frames of recovery.',
    startup: 20, active: 2, recovery: 40, damage: 24, chipDamage: 0,
    hitstun: 24, blockstun: 18, knockback: 0.8, hitstop: 8, guardDamage: 42, knockdown: true,
    beam: { length: 7.0, halfH: 0.85, y: 0.85 },
    hitbox: { startOffset: 0.2, reach: 0.6, yMin: 0.9, yMax: 1.3, halfDepth: 0.4 },
  },
  mohawk: {
    id: 'mohawk', name: 'Volcanic Overdrive', vfx: 'uppercut',
    tagline: 'Thirty damage, armour, hard knockdown. The reversal you respect.',
    startup: 10, active: 5, recovery: 30, damage: 30, chipDamage: 0,
    hitstun: 30, blockstun: 16, knockback: 1.3, hitstop: 10, guardDamage: 34,
    knockdown: true, armor: true,
    hitbox: { startOffset: 0, reach: 1.15, yMin: 0.1, yMax: 1.7, halfDepth: 0.5 },
  },
  prop: {
    id: 'prop', name: 'Eye of the Storm', vfx: 'cyclone',
    tagline: 'A slow double vortex that eats guard, and the winds blow Prop away from it.',
    startup: 18, active: 1, recovery: 32, damage: 15, chipDamage: 0,
    hitstun: 20, blockstun: 14, knockback: 0.8, hitstop: 6, guardDamage: 40, overhead: true,
    selfPush: -0.9,
    projectile: { speed: 4.2, lifetime: 90, halfW: 0.55, halfH: 0.5, y: 1.35, vy: -0.5, gravity: 1.2, hits: 2, hitGap: 9 },
    hitbox: { startOffset: 0.2, reach: 0.6, yMin: 0.9, yMax: 1.3, halfDepth: 0.4 },
  },
};

/** The registry every system reads: base spell + its EX. */
export const SPELLS: Record<FighterId, SpellDef> = Object.fromEntries(
  (Object.keys(SPELL_BASE) as FighterId[]).map((id) => [id, { ...SPELL_BASE[id], overdrive: OVERDRIVES[id] }]),
) as Record<FighterId, SpellDef>;

export const spellFor = (fighter: string): SpellDef => SPELLS[fighter as FighterId] ?? SPELLS.ram;

/** Resolve the authoritative frame data for a move, using the caster's own spell / EX. */
export const moveData = (move: MoveId, fighter: string): FrameData =>
  move === 'Spell' ? spellFor(fighter)
    : move === 'Overdrive' ? spellFor(fighter).overdrive
      : MOVES[move];

/** Moves that may be cancelled into from a light normal (gatling). */
export const LIGHT_GATLING: readonly MoveId[] = ['LightPunch', 'LightKick', 'HeavyPunch', 'HeavyKick', 'Sweep'];
