-- Vibe Fighter ladder schema (D1) — mirrors server/src/db.ts.
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
