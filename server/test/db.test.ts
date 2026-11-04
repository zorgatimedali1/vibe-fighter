// Store tests (in-memory SQLite): node --experimental-strip-types test/db.test.ts
import assert from 'node:assert/strict';
import { Store } from '../src/db.ts';
import { POINTS_START, RATING_START } from '../src/rating.ts';

const store = new Store(':memory:');

// New players start at the ladder's entry values.
{
  const p = store.ensurePlayer('x:1', 'x', '1', 'first');
  assert.equal(p.rating, RATING_START);
  assert.equal(p.points, POINTS_START);
  assert.equal(p.wins, 0);
  assert.equal(store.ensurePlayer('x:1', 'x', '1', 'first').pid, 'x:1', 'ensurePlayer is idempotent');
  console.log('ok  player creation');
}

// A ranked result moves both players and records one match.
{
  store.ensurePlayer('x:2', 'x', '2', 'second');
  const s = store.recordRanked({ matchId: 'm1', winnerPid: 'x:1', loserPid: 'x:2', rounds: [2, 0], reason: 'ko' });
  assert.ok(s, 'settlement returned');
  const w = store.getPlayer('x:1')!, l = store.getPlayer('x:2')!;
  assert.equal(w.wins, 1);
  assert.equal(l.losses, 1);
  assert.ok(w.points > POINTS_START, 'winner gains points');
  assert.ok(l.points < POINTS_START, 'loser drops points');
  assert.equal(s!.sides['x:1'].pointsDelta, w.points - POINTS_START);
  assert.equal(s!.sides['x:1'].rank, 1);
  assert.equal(store.rankOf('x:2'), 2);
  console.log('ok  ranked settlement');
}

// Settlement is idempotent per match id: a duplicate can never double-count.
{
  const before = store.getPlayer('x:1')!;
  const again = store.recordRanked({ matchId: 'm1', winnerPid: 'x:1', loserPid: 'x:2', rounds: [2, 0], reason: 'ko' });
  assert.equal(again, null);
  assert.deepEqual(store.getPlayer('x:1'), before);
  console.log('ok  idempotent settlement');
}

// Self-matches and unknown players are refused.
{
  assert.equal(store.recordRanked({ matchId: 'm2', winnerPid: 'x:1', loserPid: 'x:1', rounds: [1, 0], reason: 'ko' }), null);
  assert.equal(store.recordRanked({ matchId: 'm3', winnerPid: 'x:1', loserPid: 'ghost', rounds: [1, 0], reason: 'ko' }), null);
  console.log('ok  invalid settlements refused');
}

// Leaderboard ordering + shape.
{
  store.ensurePlayer('x:3', 'x', '3', 'third');
  store.recordRanked({ matchId: 'm4', winnerPid: 'x:3', loserPid: 'x:2', rounds: [2, 1], reason: 'time' });
  const board = store.leaderboard(10);
  assert.equal(board.length, 3);
  assert.equal(board[0].rank, 1);
  assert.equal(board[0].pid, 'x:1', 'two wins leads the board');
  assert.deepEqual(board.map((b) => b.rank), [1, 2, 3]);
  for (let i = 1; i < board.length; i++) assert.ok(board[i - 1].points >= board[i].points, 'sorted by points');
  assert.ok(board.every((b) => typeof b.tier === 'string' && b.tier.length > 0));
  console.log('ok  leaderboard');
}

// Limits are clamped, so a hostile client cannot ask for a million rows.
{
  assert.ok(store.leaderboard(10_000).length <= 200);
  assert.equal(store.leaderboard(0).length, 1, 'limit 0 clamps to 1');
  console.log('ok  leaderboard limits');
}

store.close();
console.log('DB TESTS PASSED');
