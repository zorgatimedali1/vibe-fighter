/**
 * Ranked matchmaking queue.
 *
 * Pure queue logic with an injected clock so it can be unit-tested, and defensive against the usual
 * queue bugs: duplicate joins, joining while already in a match (the caller checks rooms), stale
 * entries, reconnects and double-pairing. Pairing is greedy over the longest waiters and always
 * requires the ratings to sit inside the *smaller* of the two windows, so a player who has waited
 * a long time can be pulled up by a fresh player only within that fresh player's tighter window.
 */

export interface QueueEntry {
  /** Stable player id (socket address / account id). One queue slot per player. */
  key: string;
  /** Hidden Elo rating used for pairing. */
  rating: number;
  fighter: string;
  /** Display name for the "match found" payload. */
  handle: string;
  joinedAt: number;
  socketId: string;
}

export interface Pairing { a: QueueEntry; b: QueueEntry }

export const QUEUE_BASE_WINDOW = 80;
export const QUEUE_WINDOW_GROWTH = 18;      // rating points added per second waited
export const QUEUE_MAX_WINDOW = 700;
export const QUEUE_TIMEOUT_MS = 120_000;
export const QUEUE_TICK_MS = 250;

export class Matchmaker {
  private entries = new Map<string, QueueEntry>();

  get size() { return this.entries.size; }
  has(key: string) { return this.entries.has(key); }
  get(key: string) { return this.entries.get(key); }
  all(): QueueEntry[] { return [...this.entries.values()]; }

  /** Add a player. Rejects duplicates instead of silently stacking slots. */
  join(entry: QueueEntry): { ok: true } | { ok: false; reason: 'already-queued' } {
    if (this.entries.has(entry.key)) return { ok: false, reason: 'already-queued' };
    this.entries.set(entry.key, entry);
    return { ok: true };
  }

  leave(key: string): boolean { return this.entries.delete(key); }

  /** Current rating tolerance for an entry. */
  windowFor(entry: QueueEntry, now: number): number {
    const waited = Math.max(0, now - entry.joinedAt);
    return Math.min(QUEUE_MAX_WINDOW, QUEUE_BASE_WINDOW + (waited / 1000) * QUEUE_WINDOW_GROWTH);
  }

  /** Drop entries that have waited too long; the caller notifies them. */
  expire(now: number, ttl = QUEUE_TIMEOUT_MS): QueueEntry[] {
    const out: QueueEntry[] = [];
    for (const e of this.entries.values()) {
      if (now - e.joinedAt < ttl) continue;
      this.entries.delete(e.key);
      out.push(e);
    }
    return out;
  }

  /**
   * Greedy pairing: longest waiter picks the closest-rated opponent inside both windows, then both
   * leave the queue. Returns the new pairs; nothing else can pick them afterwards.
   */
  pair(now: number): Pairing[] {
    const list = [...this.entries.values()].sort((x, y) => x.joinedAt - y.joinedAt);
    const taken = new Set<string>();
    const pairs: Pairing[] = [];

    for (const a of list) {
      if (taken.has(a.key)) continue;
      let best: QueueEntry | null = null;
      let bestGap = Infinity;
      for (const b of list) {
        if (b.key === a.key || taken.has(b.key)) continue;
        const gap = Math.abs(a.rating - b.rating);
        const allowed = Math.min(this.windowFor(a, now), this.windowFor(b, now));
        if (gap > allowed) continue;
        if (gap < bestGap || (gap === bestGap && best !== null && b.joinedAt < best.joinedAt)) {
          best = b; bestGap = gap;
        }
      }
      if (best) { taken.add(a.key); taken.add(best.key); pairs.push({ a, b: best }); }
    }

    for (const p of pairs) { this.entries.delete(p.a.key); this.entries.delete(p.b.key); }
    return pairs;
  }
}
