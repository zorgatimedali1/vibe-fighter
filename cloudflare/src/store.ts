/**
 * D1 port of the ladder store (`server/src/db.ts`). Identical method surface — the ranked DO and
 * the worker call it the same way. `recordRanked` is idempotent per match id exactly like the
 * SQLite original, implemented over a D1 batch (all statements in a batch commit together).
 */

import {
  applyResult, POINTS_START, RATING_START, tierOf, type MatchOutcome, type PlayerStats, type SideResult,
} from '../../server/src/rating.ts';

export interface PlayerRow {
  pid: string; provider: string; providerId: string; handle: string; avatar: string | null;
  rating: number; points: number; wins: number; losses: number; streak: number; bestStreak: number;
  createdAt: number; updatedAt: number;
}

export interface RankedSettlement {
  matchId: string; winnerPid: string;
  sides: Record<string, {
    handle: string; avatar: string | null;
    ratingBefore: number; ratingAfter: number; ratingDelta: number;
    pointsBefore: number; pointsAfter: number; pointsDelta: number;
    streak: number; wins: number; losses: number; rank: number; tier: string;
  }>;
}

export interface LeaderboardRow {
  rank: number; pid: string; handle: string; avatar: string | null;
  points: number; rating: number; wins: number; losses: number; streak: number; tier: string;
}

type Row = Record<string, string | number | null>;

const SCORE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS players (
    pid TEXT PRIMARY KEY, provider TEXT NOT NULL, provider_id TEXT NOT NULL,
    handle TEXT NOT NULL, avatar TEXT,
    rating INTEGER NOT NULL, points INTEGER NOT NULL,
    wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0,
    streak INTEGER NOT NULL DEFAULT 0, best_streak INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS players_identity ON players(provider, provider_id);
  CREATE INDEX IF NOT EXISTS players_points ON players(points DESC, wins DESC);
  CREATE TABLE IF NOT EXISTS matches (
    match_id TEXT PRIMARY KEY, mode TEXT NOT NULL, p1 TEXT NOT NULL, p2 TEXT NOT NULL,
    winner TEXT, reason TEXT, p1_rounds INTEGER, p2_rounds INTEGER,
    p1_rating INTEGER, p2_rating INTEGER, p1_delta INTEGER, p2_delta INTEGER,
    p1_points INTEGER, p2_points INTEGER, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS matches_p1 ON matches(p1, created_at DESC);
  CREATE INDEX IF NOT EXISTS matches_p2 ON matches(p2, created_at DESC);
`;

export class Store {
  constructor(private db: D1Database) {}

  async migrate() {
    for (const stmt of SCORE_SCHEMA.split(';')) {
      const sql = stmt.trim();
      if (sql) await this.db.prepare(sql).run();
    }
  }

  async ensurePlayer(pid: string, provider: string, providerId: string, handle: string, avatar: string | null = null): Promise<PlayerRow> {
    const now = Date.now();
    const existing = await this.getPlayer(pid);
    if (existing) {
      if (existing.handle !== handle || existing.avatar !== avatar) {
        await this.db.prepare('UPDATE players SET handle = ?, avatar = ?, updated_at = ? WHERE pid = ?')
          .bind(handle, avatar, now, pid).run();
        return { ...existing, handle, avatar, updatedAt: now };
      }
      return existing;
    }
    await this.db.prepare(`INSERT INTO players
      (pid, provider, provider_id, handle, avatar, rating, points, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(pid, provider, providerId, handle, avatar, RATING_START, POINTS_START, now, now).run();
    return (await this.getPlayer(pid))!;
  }

  async getPlayer(pid: string): Promise<PlayerRow | null> {
    const r = await this.db.prepare('SELECT * FROM players WHERE pid = ?').bind(pid).first<Row>();
    return r ? toPlayer(r) : null;
  }

  async rankOf(pid: string): Promise<number> {
    const p = await this.getPlayer(pid);
    if (!p) return 0;
    const r = await this.db.prepare('SELECT COUNT(*) AS n FROM players WHERE points > ? OR (points = ? AND wins > ?)')
      .bind(p.points, p.points, p.wins).first<{ n: number }>();
    return Number(r?.n ?? 0) + 1;
  }

  async countPlayers(): Promise<number> {
    const r = await this.db.prepare('SELECT COUNT(*) AS n FROM players').first<{ n: number }>();
    return Number(r?.n ?? 0);
  }

  async leaderboard(limit = 50): Promise<LeaderboardRow[]> {
    const { results } = await this.db.prepare(`SELECT pid, handle, avatar, points, rating, wins, losses, streak
      FROM players ORDER BY points DESC, wins DESC, updated_at ASC LIMIT ?`)
      .bind(Math.max(1, Math.min(200, limit))).all<Row>();
    return (results ?? []).map((r, i) => ({
      rank: i + 1,
      pid: String(r.pid), handle: String(r.handle),
      avatar: r.avatar == null ? null : String(r.avatar),
      points: Number(r.points), rating: Number(r.rating),
      wins: Number(r.wins), losses: Number(r.losses), streak: Number(r.streak),
      tier: tierOf(Number(r.points)),
    }));
  }

  /**
   * Apply one ranked result. Returns null when the match was already settled (idempotent, per the
   * unique match_id) or a row is missing. The insert, both row updates and the guard-check run as
   * one D1 batch, so a concurrent duplicate settlement can never double-apply.
   */
  async recordRanked(input: {
    matchId: string; winnerPid: string; loserPid: string; rounds: [number, number]; reason: string;
  }): Promise<RankedSettlement | null> {
    const { matchId, winnerPid, loserPid, rounds, reason } = input;
    if (winnerPid === loserPid) return null;
    const winner = await this.getPlayer(winnerPid);
    const loser = await this.getPlayer(loserPid);
    if (!winner || !loser) return null;

    const already = await this.db.prepare('SELECT 1 AS hit FROM matches WHERE match_id = ?').bind(matchId).first();
    if (already) return null;

    const outcome: MatchOutcome = applyResult(toStats(winner), toStats(loser));
    const now = Date.now();
    const deltas = await this.db.batch([
      this.db.prepare(`INSERT OR IGNORE INTO matches
        (match_id, mode, p1, p2, winner, reason, p1_rounds, p2_rounds, p1_rating, p2_rating, p1_delta, p2_delta, p1_points, p2_points, created_at)
        VALUES (?, 'ranked', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(matchId, winner.pid, loser.pid, winner.pid, reason, rounds[0], rounds[1],
          outcome.winner.ratingBefore, outcome.loser.ratingBefore,
          outcome.winner.ratingDelta, outcome.loser.ratingDelta,
          outcome.winner.pointsDelta, outcome.loser.pointsDelta, now),
      this.db.prepare(`UPDATE players SET rating = ?, points = ?, wins = wins + 1, streak = ?,
        best_streak = CASE WHEN best_streak < ? THEN ? ELSE best_streak END, updated_at = ? WHERE pid = ?`)
        .bind(outcome.winner.ratingAfter, outcome.winner.pointsAfter, outcome.winner.streak,
          outcome.winner.streak, outcome.winner.streak, now, winner.pid),
      this.db.prepare(`UPDATE players SET rating = ?, points = ?, losses = losses + 1, streak = 0, updated_at = ? WHERE pid = ?`)
        .bind(outcome.loser.ratingAfter, outcome.loser.pointsAfter, now, loser.pid),
    ]);
    if (deltas.some((s: { meta: { changes: number } }) => s.meta.changes !== 1)) return null;

    // Ladder positions after the update (the client renders these on the settle screen).
    const wAfter = (await this.getPlayer(winner.pid)) ?? winner;
    const lAfter = (await this.getPlayer(loser.pid)) ?? loser;
    const [wRank, lRank] = await Promise.all([this.rankOf(winner.pid), this.rankOf(loser.pid)]);
    const side = (p: PlayerRow, o: SideResult, rank: number, wins: number, losses: number) => ({
      handle: p.handle, avatar: p.avatar,
      ratingBefore: o.ratingBefore, ratingAfter: o.ratingAfter, ratingDelta: o.ratingDelta,
      pointsBefore: o.pointsBefore, pointsAfter: o.pointsAfter, pointsDelta: o.pointsDelta,
      streak: o.streak, wins, losses, rank, tier: tierOf(o.pointsAfter),
    });
    return {
      matchId,
      winnerPid: winner.pid,
      sides: {
        [winner.pid]: side(winner, outcome.winner, wRank, wAfter.wins, wAfter.losses),
        [loser.pid]: side(loser, outcome.loser, lRank, lAfter.wins, lAfter.losses),
      },
    };
  }
}

function toPlayer(r: Row): PlayerRow {
  return {
    pid: String(r.pid), provider: String(r.provider), providerId: String(r.provider_id),
    handle: String(r.handle), avatar: r.avatar == null ? null : String(r.avatar),
    rating: Number(r.rating), points: Number(r.points),
    wins: Number(r.wins), losses: Number(r.losses),
    streak: Number(r.streak), bestStreak: Number(r.best_streak),
    createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
  };
}

function toStats(p: PlayerRow): PlayerStats {
  return { rating: p.rating, points: p.points, wins: p.wins, losses: p.losses, streak: p.streak };
}
