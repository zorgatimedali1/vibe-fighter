/**
 * Ranked maths: a hidden Elo rating for fair matchmaking, and a visible point ladder players can
 * climb. Both are pure functions so they can be unit-tested and never depend on wall-clock state.
 */

export const RATING_START = 1200;
export const RATING_FLOOR = 100;
export const K_FACTOR = 28;
/** New accounts move faster for their first few games so they land at their real level quickly. */
export const PROVISIONAL_K = 40;
export const PROVISIONAL_GAMES = 10;

export const POINTS_START = 1000;
export const WIN_POINTS = 25;
export const LOSS_POINTS = 18;
export const STREAK_BONUS_MAX = 10;
export const STREAK_BONUS_STEP = 2;

export interface PlayerStats {
  rating: number;
  points: number;
  wins: number;
  losses: number;
  streak: number;
}

export interface SideResult {
  ratingBefore: number;
  ratingAfter: number;
  ratingDelta: number;
  pointsBefore: number;
  pointsAfter: number;
  pointsDelta: number;
  streak: number;
}

export interface MatchOutcome {
  winner: SideResult;
  loser: SideResult;
}

/** Standard Elo expectation: probability that `a` beats `b`. */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

/** Elo delta for one side. `score` is 1 for a win, 0 for a loss. */
export function eloDelta(ratingSelf: number, ratingOpponent: number, score: 0 | 1, gamesPlayed = PROVISIONAL_GAMES): number {
  const k = gamesPlayed < PROVISIONAL_GAMES ? PROVISIONAL_K : K_FACTOR;
  return Math.round(k * (score - expectedScore(ratingSelf, ratingOpponent)));
}

/** Visible points for a win (with a small streak bonus) or a loss. */
export function pointsDelta(won: boolean, streakAfterWin: number): number {
  if (!won) return -LOSS_POINTS;
  return WIN_POINTS + Math.min(STREAK_BONUS_MAX, Math.max(0, streakAfterWin - 1) * STREAK_BONUS_STEP);
}

const clamp = (v: number, lo: number, hi = Infinity) => Math.min(hi, Math.max(lo, v));

/**
 * Apply one ranked result to both players. Ratings are zero-sum (each side computes its own delta
 * from the same expectation, which keeps the pair balanced), points are not: the ladder is a grind,
 * and a loss always costs less than a win is worth.
 */
export function applyResult(winner: PlayerStats, loser: PlayerStats): MatchOutcome {
  const wDelta = eloDelta(winner.rating, loser.rating, 1, winner.wins + winner.losses);
  const lDelta = eloDelta(loser.rating, winner.rating, 0, loser.wins + loser.losses);

  const wStreak = winner.streak + 1;
  const wPoints = clamp(winner.points + pointsDelta(true, wStreak), 0);
  const lPoints = clamp(loser.points - LOSS_POINTS, 0);

  return {
    winner: {
      ratingBefore: winner.rating,
      ratingAfter: clamp(winner.rating + wDelta, RATING_FLOOR),
      ratingDelta: wDelta,
      pointsBefore: winner.points,
      pointsAfter: wPoints,
      pointsDelta: wPoints - winner.points,
      streak: wStreak,
    },
    loser: {
      ratingBefore: loser.rating,
      ratingAfter: clamp(loser.rating + lDelta, RATING_FLOOR),
      ratingDelta: lDelta,
      pointsBefore: loser.points,
      pointsAfter: lPoints,
      pointsDelta: lPoints - loser.points,
      streak: 0,
    },
  };
}

export type Tier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond' | 'Master';

export const TIERS: { id: Tier; min: number }[] = [
  { id: 'Bronze', min: 0 },
  { id: 'Silver', min: 1000 },
  { id: 'Gold', min: 1400 },
  { id: 'Platinum', min: 1800 },
  { id: 'Diamond', min: 2200 },
  { id: 'Master', min: 2600 },
];

export function tierOf(points: number): Tier {
  let tier: Tier = 'Bronze';
  for (const t of TIERS) if (points >= t.min) tier = t.id;
  return tier;
}

/** Progress (0–1) toward the next tier; 1 at the top tier. */
export function tierProgress(points: number): number {
  const idx = TIERS.findIndex((t) => t.id === tierOf(points));
  if (idx === TIERS.length - 1) return 1;
  const lo = TIERS[idx].min, hi = TIERS[idx + 1].min;
  return clamp((points - lo) / Math.max(1, hi - lo), 0, 1);
}
