import { Action, type BotDifficulty, type PlayerState } from '../types/combat.ts';
import { SPELL_COST } from './moves.ts';

const LOW = new Set(['HeavyKick', 'Sweep']);
const OVERHEAD = new Set(['AirPunch', 'AirKick']);
const AIR = new Set(['AirPunch', 'AirKick']);

interface Profile {
  /** Frames the bot waits before reacting to a fresh attack (min/max). */
  reactMin: number; reactMax: number;
  /** Chance to guard an incoming attack once the reaction lands. */
  guard: number;
  guardHoldMin: number; guardHoldMax: number;
  /** How often neutral turns into forward pressure rather than a reset. */
  aggression: number;
  /** Chance to throw the spell at range / up close, and its cooldown in ticks. */
  spellRange: number; spellClose: number; spellGap: number;
  /** Chance to punish an attack in recovery. */
  punish: number;
  /** Chance to anti-air a jumping opponent. */
  antiAir: number;
  /** Chance to link a follow-up while the opponent is in hitstun. */
  combo: number;
  dash: number; jumpIn: number;
  /** Chance the neutral plan is a retreat instead of an approach. */
  retreat: number;
  /** Chance to grab a blocking opponent (otherwise sweep). */
  grab: number;
  /** Chance to cash in a low guard meter / guard break. */
  breakPunish: number;
  /**
   * Ticks the bot spends "thinking" between actions. This is what makes the low tiers feel human:
   * a weak bot does not re-roll a button every single tick, it simply does less, less often.
   */
  idleMin: number; idleMax: number;
  /** Chance that a close-range decision actually attacks (instead of hesitating). */
  attackRate: number;
  /** Chance that an attack is a heavy (low tiers mostly poke with lights). */
  heavy: number;
}

/**
 * Six clearly separated skill tiers. Reaction time is only half the story: `idle` + `attackRate`
 * control how much the bot actually *does*, so Easy is a slow, hesitant partner instead of a
 * frame-perfect pressure machine with the same inputs as a player.
 */
export const BOT_PROFILES: Record<BotDifficulty, Profile> = {
  rookie: {
    reactMin: 20, reactMax: 34, guard: 0.05, guardHoldMin: 5, guardHoldMax: 10,
    aggression: 0.18, spellRange: 0.10, spellClose: 0.02, spellGap: 300,
    punish: 0.02, antiAir: 0.0, combo: 0.02,
    dash: 0.002, jumpIn: 0.002, retreat: 0.08, grab: 0.05, breakPunish: 0.0,
    idleMin: 50, idleMax: 80, attackRate: 0.04, heavy: 0.05,
  },
  easy: {
    reactMin: 12, reactMax: 20, guard: 0.16, guardHoldMin: 8, guardHoldMax: 14,
    aggression: 0.34, spellRange: 0.16, spellClose: 0.04, spellGap: 210,
    punish: 0.10, antiAir: 0.05, combo: 0.08,
    dash: 0.008, jumpIn: 0.006, retreat: 0.14, grab: 0.16, breakPunish: 0.06,
    idleMin: 34, idleMax: 58, attackRate: 0.14, heavy: 0.18,
  },
  normal: {
    reactMin: 6, reactMax: 11, guard: 0.44, guardHoldMin: 10, guardHoldMax: 18,
    aggression: 0.58, spellRange: 0.50, spellClose: 0.20, spellGap: 100,
    punish: 0.38, antiAir: 0.26, combo: 0.38,
    dash: 0.035, jumpIn: 0.026, retreat: 0.22, grab: 0.42, breakPunish: 0.34,
    idleMin: 13, idleMax: 22, attackRate: 0.46, heavy: 0.50,
  },
  hard: {
    reactMin: 3, reactMax: 6, guard: 0.68, guardHoldMin: 12, guardHoldMax: 22,
    aggression: 0.72, spellRange: 0.75, spellClose: 0.35, spellGap: 70,
    punish: 0.62, antiAir: 0.52, combo: 0.62,
    dash: 0.070, jumpIn: 0.042, retreat: 0.25, grab: 0.52, breakPunish: 0.58,
    idleMin: 7, idleMax: 14, attackRate: 0.68, heavy: 0.72,
  },
  insane: {
    reactMin: 1, reactMax: 3, guard: 0.86, guardHoldMin: 14, guardHoldMax: 26,
    aggression: 0.86, spellRange: 0.90, spellClose: 0.45, spellGap: 52,
    punish: 0.85, antiAir: 0.80, combo: 0.86,
    dash: 0.100, jumpIn: 0.055, retreat: 0.28, grab: 0.60, breakPunish: 0.80,
    idleMin: 3, idleMax: 8, attackRate: 0.86, heavy: 0.88,
  },
  nightmare: {
    reactMin: 0, reactMax: 1, guard: 0.96, guardHoldMin: 16, guardHoldMax: 30,
    aggression: 0.94, spellRange: 0.97, spellClose: 0.55, spellGap: 38,
    punish: 0.96, antiAir: 0.94, combo: 0.96,
    dash: 0.130, jumpIn: 0.065, retreat: 0.30, grab: 0.70, breakPunish: 0.95,
    idleMin: 1, idleMax: 4, attackRate: 0.95, heavy: 0.95,
  },
};

/**
 * Practice opponent. Returns a held action bitmask each tick, exactly like a human's keyboard.
 * Presses must last a single tick, so every branch below is gated by a cooldown; the bot has no
 * access to privileged state and obeys the same frame data, mana costs and block rules.
 */
export function makeBot(difficulty: BotDifficulty = 'normal', spellCost = SPELL_COST) {
  const P = BOT_PROFILES[difficulty] ?? BOT_PROFILES.normal;
  let guardUntil = 0;
  let busyUntil = 0;
  let seenAt = 0;
  let seenMove: string | null = null;
  let plan: 'approach' | 'retreat' = 'approach';
  let planUntil = 0;
  let dashReady = 0;
  let spellReady = 0;
  let antiAirReady = 0;
  let punishReady = 0;
  let comboReady = 0;
  /** Next tick the bot is allowed to make a fresh offensive decision. */
  let nextDecision = 0;

  return (me: PlayerState, foe: PlayerState, tick: number): number => {
    const dx = foe.x - me.x;
    const dist = Math.abs(dx);
    const toward = dx >= 0 ? Action.Right : Action.Left;
    const away = dx >= 0 ? Action.Left : Action.Right;

    // React to a fresh attack after a tier-dependent delay.
    if (foe.state === 'ATTACK_STARTUP' && foe.move !== seenMove) {
      seenMove = foe.move;
      seenAt = tick + P.reactMin + Math.floor(Math.random() * (P.reactMax - P.reactMin + 1));
    } else if (foe.state !== 'ATTACK_STARTUP') {
      seenMove = null;
    }

    // Guard is universal now: one button stops every strike, spell and projectile â€” grabs still beat it.
    const guard = () => Action.Block;

    if (tick < guardUntil) return guard();

    const incoming = (foe.state === 'ATTACK_STARTUP' || foe.state === 'ATTACK_ACTIVE') &&
      (dist < 2.6 || foe.move === 'Spell');
    if (incoming && tick >= seenAt && Math.random() < P.guard) {
      guardUntil = tick + P.guardHoldMin + Math.floor(Math.random() * (P.guardHoldMax - P.guardHoldMin + 1));
      return guard();
    }

    // Anti-air: a jump-in is met with a rising heavy punch.
    const foeAirborne = foe.y > 0.35 || foe.state === 'JUMP';
    if (foeAirborne && dist < 2.7 && tick >= antiAirReady && Math.random() < P.antiAir) {
      antiAirReady = tick + 26;
      busyUntil = tick + 18;
      return Action.HeavyPunch;
    }

    // One air normal per jump, only when drifting into range.
    if (me.y > 0.35 && !me.airAttackUsed && dist < 2.0) return Action.LightKick;

    // Convert a hit: while the foe is still in hitstun, link a light or heavy.
    if (me.combo > 0 && foe.state === 'HITSTUN' && dist < 1.9 && tick >= comboReady && Math.random() < P.combo) {
      comboReady = tick + 18;
      busyUntil = tick + 16;
      return me.combo % 3 === 0 ? Action.HeavyPunch : Action.LightPunch;
    }

    if (tick < busyUntil) return plan === 'retreat' ? away : dist > 1.3 ? toward : 0;

    const foeBlocking = foe.state === 'BLOCK' || foe.state === 'BLOCKSTUN';
    const foeRecovering = foe.state === 'ATTACK_RECOVERY';

    // A broken guard (or a nearly empty meter) is the biggest opening in the game: cash in hard.
    if ((foe.state === 'GUARD_BREAK' || (foeBlocking && foe.guard < 22)) && dist < 2.1 &&
        tick >= punishReady && Math.random() < P.breakPunish) {
      punishReady = tick + 26;
      busyUntil = tick + 36;
      if (me.mana >= spellCost && Math.random() < 0.55) return Action.Spell;
      return Action.HeavyPunch;
    }

    // Punish a whiffed normal with a heavy or a grab.
    if (foeRecovering && dist < 1.9 && tick >= punishReady && Math.random() < P.punish) {
      punishReady = tick + 24;
      busyUntil = tick + 34;
      if (foeBlocking && Math.random() < P.grab) return Action.Grab;
      return Math.random() < 0.55 ? Action.HeavyPunch : Action.Grab;
    }

    // Zoning: the spell is only worth it at range.
    if (dist > 2.4 && me.mana >= spellCost && tick >= spellReady && Math.random() < P.spellRange) {
      spellReady = tick + P.spellGap;
      busyUntil = tick + 40;
      return Action.Spell;
    }

    // Offence runs on a decision beat: a weak bot does not re-roll a button every tick, it simply
    // acts less often. Reactions above (guard, anti-air, punish) stay responsive on every tick.
    if (tick < nextDecision) return dist > 1.25 ? toward : 0;
    nextDecision = tick + P.idleMin + Math.floor(Math.random() * (P.idleMax - P.idleMin + 1));

    if (dist < 1.45) {
      if (foeBlocking) {
        // Grab beats any guard; a sweep beats a standing guard.
        if (Math.random() < P.grab) { busyUntil = tick + 34; return Action.Grab; }
        busyUntil = tick + 38; return Action.HeavyKick | Action.Down;
      }
      if (me.mana >= spellCost && Math.random() < P.spellClose) { busyUntil = tick + 40; return Action.Spell; }
      if (Math.random() > P.attackRate) return 0;                      // hesitate: no free pressure
      // Low tiers poke with lights; heavies are what make the upper tiers scary.
      const r = Math.random();
      if (Math.random() < P.heavy) {
        if (r < 0.50) { busyUntil = tick + 31; return Action.HeavyPunch; }
        if (r < 0.85) { busyUntil = tick + 38; return Action.HeavyKick | Action.Down; }
        busyUntil = tick + 40; return Action.Spell;
      }
      if (r < 0.55) { busyUntil = tick + 14; return Action.LightPunch; }
      if (r < 0.92) { busyUntil = tick + 14; return Action.LightKick; }
      busyUntil = tick + 34; return Action.Grab;
    }

    // Neutral: approach, occasionally dash or jump in, sometimes reset spacing.
    if (tick >= planUntil) {
      planUntil = tick + 22 + Math.floor(Math.random() * 40);
      plan = Math.random() < P.aggression ? 'approach' : Math.random() < P.retreat ? 'retreat' : 'approach';
    }
    if (plan === 'retreat' && dist < 2.6) return away;
    if (dist > 2.2 && tick >= dashReady && Math.random() < P.dash) {
      dashReady = tick + 42;
      busyUntil = tick + 6;
      return Action.Dash | toward;
    }
    if (dist > 1.9 && dist < 3.4 && Math.random() < P.jumpIn) {
      busyUntil = tick + 10;
      return Action.Up | toward;
    }
    return dist > 1.25 ? toward : 0;
  };
}

/** Kept for readability at call sites: the bot's attack set is the same as a player's. */
export const BOT_MOVES = ['LightPunch', 'LightKick', 'HeavyPunch', 'HeavyKick', 'Sweep', 'AirPunch', 'AirKick', 'Spell', 'Grab'] as const;

export function isAirMove(move: string | null): boolean {
  return !!move && AIR.has(move);
}

