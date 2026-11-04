/** Input bitmask. MUST match client/src/InputManager.ts. */
export const Action = {
  Left: 1 << 0, Right: 1 << 1, Up: 1 << 2, Down: 1 << 3,
  LightPunch: 1 << 4, LightKick: 1 << 5, HeavyPunch: 1 << 6, HeavyKick: 1 << 7,
  Block: 1 << 8, Spell: 1 << 9, Grab: 1 << 10, Dash: 1 << 11,
  Overdrive: 1 << 12,
} as const;
export const ACTION_MASK = 0b1111111111111;   // 8191 — every bit above is reserved/rejected

export type FighterState =
  | 'IDLE' | 'WALK_FORWARD' | 'WALK_BACKWARD' | 'JUMP' | 'CROUCH'
  | 'ATTACK_STARTUP' | 'ATTACK_ACTIVE' | 'ATTACK_RECOVERY'
  | 'DASH'
  | 'BLOCK' | 'HITSTUN' | 'BLOCKSTUN' | 'GUARD_BREAK' | 'KNOCKDOWN';

export type MoveId =
  | 'LightPunch' | 'LightKick' | 'HeavyPunch' | 'HeavyKick'
  | 'Sweep' | 'AirPunch' | 'AirKick' | 'Spell' | 'Overdrive' | 'Grab';

export type Phase = 'WAITING' | 'COUNTDOWN' | 'FIGHTING' | 'ROUND_END' | 'COMPLETED';

/** The five playable fighters. Spells are keyed by these ids. */
export type FighterId = 'ram' | 'cap' | 'antenna' | 'mohawk' | 'prop';
export const FIGHTER_IDS: readonly FighterId[] = ['ram', 'cap', 'antenna', 'mohawk', 'prop'];
export const isFighterId = (v: unknown): v is FighterId => typeof v === 'string' && (FIGHTER_IDS as readonly string[]).includes(v);

/** Practice-bot skill tiers. Selected in the lobby and sent with auth. */
export type BotDifficulty = 'rookie' | 'easy' | 'normal' | 'hard' | 'insane' | 'nightmare';
export const BOT_DIFFICULTIES: readonly BotDifficulty[] = ['rookie', 'easy', 'normal', 'hard', 'insane', 'nightmare'];
export const isBotDifficulty = (v: unknown): v is BotDifficulty =>
  typeof v === 'string' && (BOT_DIFFICULTIES as readonly string[]).includes(v);

export interface Vec3 { x: number; y: number; z: number }
export interface BoundingBox { min: Vec3; max: Vec3 }

export interface FrameData {
  startup: number; active: number; recovery: number;   // frames @ 60 Hz
  damage: number;
  /** Legacy: guard is binary now (blocked hits deal zero damage). Kept for wire/data compatibility. */
  chipDamage: number;
  hitstun: number; blockstun: number;
  knockback: number;                                    // meters, applied to the defender
  hitstop: number;                                      // global freeze frames on hit
  /** Guard meter drained when this move is blocked (defaults to its damage). */
  guardDamage?: number;
  /** Attack volume, in the attacker's facing direction, relative to the attacker's feet. */
  hitbox: { startOffset: number; reach: number; yMin: number; yMax: number; halfDepth: number };

  /* --- optional move properties --- */
  /** Mana spent when the move starts (spell only). */
  manaCost?: number;
  /** Projectile spawned on the first active frame. `vy`/`gravity` make it arc. */
  projectile?: {
    speed: number; lifetime: number; halfW: number; halfH: number; y: number;
    /** Initial vertical velocity (m/s); negative arcs downward. */
    vy?: number;
    /** Downward acceleration (m/s²) applied to the projectile. */
    gravity?: number;
    /** How many times the projectile can connect before it dies (default 1). */
    hits?: number;
    /** Frames between consecutive hits of a multi-hit projectile (default 8). */
    hitGap?: number;
  };
  /** Hitscan beam fired along the attacker's facing on the first active frame. */
  beam?: { length: number; halfH: number; y: number };
  /** Super armour during startup/active frames: absorbs one hit's stun (damage still applies). */
  armor?: boolean;
  /** Hard knockdown on hit (sweep, heavy kick, grab). */
  knockdown?: boolean;
  /** Low profile: must be crouch-guarded / hits crouching fighters. Cosmetic while guard is universal. */
  low?: boolean;
  /** Overhead profile: hits crouching fighters. Cosmetic while guard is universal. */
  overhead?: boolean;
  /** Unblockable command grab. */
  grab?: boolean;
  /** Air normal: only usable while airborne, one per jump. */
  air?: boolean;
  /** Caster slides this many metres along its facing when the spell releases (negative = backwards). */
  selfPush?: number;
}

export interface InputPayload { seq: number; tick: number; actions: number }

export interface PlayerState {
  x: number; y: number; vy: number;
  facing: 1 | -1;
  state: FighterState;
  move: MoveId | null;
  timer: number;            // frames left in the current timed state
  hp: number;
  mana: number;
  /** Overdrive meter (0–OD_MAX). Built by dealing/taking damage; pays for the EX spell. */
  overdrive: number;
  /** Guard meter (0–GUARD_MAX). Blocked hits drain it; an empty meter breaks the guard. */
  guard: number;
  /** Tick of the last blocked hit, used to delay guard regeneration. */
  guardAt: number;
  /** Tick until which a fresh guard tap counts as a perfect guard (0 = no parry armed). */
  parryUntil: number;
  /** True when the fighter was already guarding at the start of this tick (no parry from held block). */
  guarded: boolean;
  hasHit: boolean;          // current attack already connected (one hit per attack)
  crouching: boolean;
  kbVx: number; kbFrames: number;
  dashVx: number;           // per-tick dash velocity (bypasses the walk-step sanity cap)
  airAttackUsed: boolean;   // one air normal per jump
  castFired: boolean;       // spell projectile already spawned
  combo: number;            // consecutive hits the attacker has landed
  comboExpire: number;      // tick after which the combo counter resets
  cancelUntil: number;      // tick until which recovery can be cancelled into a follow-up
}

export interface HistoryEntry { tick: number; x: number; y: number; crouching: boolean }

export interface PlayerSnapshot {
  x: number; y: number; facing: 1 | -1; state: FighterState; move: MoveId | null;
  hp: number; mana: number; guard: number; overdrive: number;
}

export interface ProjectileSnapshot { id: number; owner: number; x: number; y: number }

export interface Snapshot {
  tick: number; ackSeq: number; phase: Phase; round: number;
  players: Record<string, PlayerSnapshot>;
  projectiles: ProjectileSnapshot[];
}

export interface MatchResult {
  matchId: string; winner: string; p1Rounds: number; p2Rounds: number;
  reason: 'ko' | 'time' | 'forfeit';
}
