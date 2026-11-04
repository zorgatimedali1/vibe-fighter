/**
 * Persistent player + match storage.
 *
 * Uses Node's built-in `node:sqlite` (no native build step). The whole ranked ladder lives here:
 * one row per account, one row per settled match. `recordRanked` is idempotent per match id, so a
 * duplicated settlement, a reconnect race or a server restart mid-settlement can never double-count
 * a result.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  applyResult, POINTS_START, RATING_START, tierOf, type MatchOutcome, type PlayerStats,
} from './rating.ts';

export interface PlayerRow {
  pid: string;
  provider: string;
  providerId: string;
  handle: string;
  avatar: string | null;
  rating: number;
  points: number;
  wins: number;
  losses: number;
  streak: number;
  bestStreak: number;
  createdAt: number;
  updatedAt: number;
}

export interface RankedSettlement {
  matchId: string;
  winnerPid: string;
  /** Per-player outcome keyed by pid, with the ladder positions after the update. */
  sides: Record<string, {
    handle: string;
    avatar: string | null;
    ratingBefore: number; ratingAfter: number; ratingDelta: number;
    pointsBefore: number; pointsAfter: number; pointsDelta: number;
    streak: number; wins: number; losses: number;
    rank: number; tier: string;
  }>;
}

export interface LeaderboardRow {
  rank: number;
  pid: string;
  handle: string;
  avatar: string | null;
  points: number;
  rating: number;
  wins: number;
  losses: number;
  streak: number;
  tier: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA busy_timeout = 4000;');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS players (
        pid         TEXT PRIMARY KEY,
        provider    TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        handle      TEXT NOT NULL,
        avatar      TEXT,
        rating      INTEGER NOT NULL,
        points      INTEGER NOT NULL,
        wins        INTEGER NOT NULL DEFAULT 0,
        losses      INTEGER NOT NULL DEFAULT 0,
        streak      INTEGER NOT NULL DEFAULT 0,
        best_streak INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS players_identity ON players(provider, provider_id);
      CREATE INDEX IF NOT EXISTS players_points ON players(points DESC, wins DESC);

      CREATE TABLE IF NOT EXISTS matches (
        match_id     TEXT PRIMARY KEY,
        mode         TEXT NOT NULL,
        p1           TEXT NOT NULL,
        p2           TEXT NOT NULL,
        winner       TEXT,
        reason       TEXT,
        p1_rounds    INTEGER,
        p2_rounds    INTEGER,
        p1_rating    INTEGER,
        p2_rating    INTEGER,
        p1_delta     INTEGER,
        p2_delta     INTEGER,
        p1_points    INTEGER,
        p2_points    INTEGER,
        created_at   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS matches_p1 ON matches(p1, created_at DESC);
      CREATE INDEX IF NOT EXISTS matches_p2 ON matches(p2, created_at DESC);
    `);
  }

  /* ------------------------------- players ------------------------------- */

  /** Find or create a player for an external identity (x:123, dev:abc, …). */
  ensurePlayer(pid: string, provider: string, providerId: string, handle: string, avatar: string | null = null): PlayerRow {
    const now = Date.now();
    const existing = this.getPlayer(pid);
    if (existing) {
      // Keep the display name/avatar fresh without ever touching ladder numbers.
      if (existing.handle !== handle || existing.avatar !== avatar) {
        this.db.prepare('UPDATE players SET handle = ?, avatar = ?, updated_at = ? WHERE pid = ?')
          .run(handle, avatar, now, pid);
        return { ...existing, handle, avatar, updatedAt: now };
      }
      return existing;
    }
    this.db.prepare(`INSERT INTO players
      (pid, provider, provider_id, handle, avatar, rating, points, wins, losses, streak, best_streak, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)`)
      .run(pid, provider, providerId, handle, avatar, RATING_START, POINTS_START, now, now);
    return this.getPlayer(pid)!;
  }

  getPlayer(pid: string): PlayerRow | null {
    const r = this.db.prepare('SELECT * FROM players WHERE pid = ?').get(pid) as Record<string, unknown> | undefined;
    return r ? toPlayer(r) : null;
  }

  getByProvider(provider: string, providerId: string): PlayerRow | null {
    const r = this.db.prepare('SELECT * FROM players WHERE provider = ? AND provider_id = ?').get(provider, providerId) as Record<string, unknown> | undefined;
    return r ? toPlayer(r) : null;
  }

  rankOf(pid: string): number {
    const p = this.getPlayer(pid);
    if (!p) return 0;
    const r = this.db.prepare(`SELECT COUNT(*) AS n FROM players
      WHERE points > ? OR (points = ? AND wins > ?)`).get(p.points, p.points, p.wins) as { n: number };
    return Number(r.n) + 1;
  }

  countPlayers(): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM players').get() as { n: number }).n);
  }

  /* ----------------------------- leaderboard ----------------------------- */

  leaderboard(limit = 50): LeaderboardRow[] {
    const rows = this.db.prepare(`SELECT pid, handle, avatar, points, rating, wins, losses, streak
      FROM players ORDER BY points DESC, wins DESC, updated_at ASC LIMIT ?`)
      .all(Math.max(1, Math.min(200, limit))) as Record<string, unknown>[];
    return rows.map((r, i) => ({
      rank: i + 1,
      pid: String(r.pid),
      handle: String(r.handle),
      avatar: r.avatar == null ? null : String(r.avatar),
      points: Number(r.points),
      rating: Number(r.rating),
      wins: Number(r.wins),
      losses: Number(r.losses),
      streak: Number(r.streak),
      tier: tierOf(Number(r.points)),
    }));
  }

  /* -------------------------------- matches ------------------------------- */

  /**
   * Apply one ranked result. Returns null when the match was already settled (idempotent) or a
   * player row is missing — the caller treats that as "no ladder change".
   */
  recordRanked(input: {
    matchId: string; winnerPid: string; loserPid: string;
    rounds: [number, number]; reason: string;
  }): RankedSettlement | null {
    const { matchId, winnerPid, loserPid, rounds, reason } = input;
    if (winnerPid === loserPid) return null;

    const already = this.db.prepare('SELECT 1 FROM matches WHERE match_id = ?').get(matchId);
    if (already) return null;

    const winner = this.getPlayer(winnerPid);
    const loser = this.getPlayer(loserPid);
    if (!winner || !loser) return null;

    const outcome: MatchOutcome = applyResult(
      toStats(winner), toStats(loser),
    );

    this.db.exec('BEGIN IMMEDIATE');
    try {
      // The unique match_id turns a concurrent duplicate into a no-op instead of a double payout.
      const ins = this.db.prepare(`INSERT OR IGNORE INTO matches
        (match_id, mode, p1, p2, winner, reason, p1_rounds, p2_rounds, p1_rating, p2_rating, p1_delta, p2_delta, p1_points, p2_points, created_at)
        VALUES (?, 'ranked', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const res = ins.run(
        matchId, winner.pid, loser.pid, winner.pid, reason, rounds[0], rounds[1],
        outcome.winner.ratingBefore, outcome.loser.ratingBefore,
        outcome.winner.ratingDelta, outcome.loser.ratingDelta,
        outcome.winner.pointsDelta, outcome.loser.pointsDelta, Date.now(),
      );
      if (Number(res.changes) === 0) { this.db.exec('ROLLBACK'); return null; }

      const upd = this.db.prepare(`UPDATE players SET rating = ?, points = ?, wins = ?, losses = ?,
        streak = ?, best_streak = ?, updated_at = ? WHERE pid = ?`);
      const now = Date.now();
      upd.run(outcome.winner.ratingAfter, outcome.winner.pointsAfter,
        winner.wins + 1, winner.losses, outcome.winner.streak,
        Math.max(winner.bestStreak, outcome.winner.streak), now, winner.pid);
      upd.run(outcome.loser.ratingAfter, outcome.loser.pointsAfter,
        loser.wins, loser.losses + 1, 0, loser.bestStreak, now, loser.pid);

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    const sides: RankedSettlement['sides'] = {};
    for (const [pid, out] of [[winner.pid, outcome.winner], [loser.pid, outcome.loser]] as const) {
      const after = this.getPlayer(pid)!;
      sides[pid] = {
        handle: after.handle,
        avatar: after.avatar,
        ratingBefore: out.ratingBefore, ratingAfter: out.ratingAfter, ratingDelta: out.ratingDelta,
        pointsBefore: out.pointsBefore, pointsAfter: out.pointsAfter, pointsDelta: out.pointsDelta,
        streak: out.streak, wins: after.wins, losses: after.losses,
        rank: this.rankOf(pid), tier: tierOf(after.points),
      };
    }
    return { matchId, winnerPid, sides };
  }

  close() { this.db.close(); }
}

function toPlayer(r: Record<string, unknown>): PlayerRow {
  return {
    pid: String(r.pid),
    provider: String(r.provider),
    providerId: String(r.provider_id),
    handle: String(r.handle),
    avatar: r.avatar == null ? null : String(r.avatar),
    rating: Number(r.rating),
    points: Number(r.points),
    wins: Number(r.wins),
    losses: Number(r.losses),
    streak: Number(r.streak),
    bestStreak: Number(r.best_streak),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function toStats(p: PlayerRow): PlayerStats {
  return { rating: p.rating, points: p.points, wins: p.wins, losses: p.losses, streak: p.streak };
}
