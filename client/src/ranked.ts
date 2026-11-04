/** Client mirror of the server's ladder tiers (server/src/rating.ts) for badges and progress. */

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

export function tierProgress(points: number): number {
  const idx = TIERS.findIndex((t) => t.id === tierOf(points));
  if (idx === TIERS.length - 1) return 1;
  const lo = TIERS[idx].min, hi = TIERS[idx + 1].min;
  return Math.min(1, Math.max(0, (points - lo) / Math.max(1, hi - lo)));
}
