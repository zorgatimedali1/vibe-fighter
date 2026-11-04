// Unit tests: node --experimental-strip-types test/matchmaking.test.ts
import assert from 'node:assert/strict';
import { Matchmaker, QUEUE_BASE_WINDOW, QUEUE_MAX_WINDOW, QUEUE_TIMEOUT_MS, type QueueEntry } from '../src/matchmaker.ts';

const entry = (key: string, rating: number, joinedAt = 0, fighter = 'ram'): QueueEntry =>
  ({ key, rating, fighter, handle: key.toUpperCase(), joinedAt, socketId: `s-${key}` });

// Duplicate joins are rejected, not stacked.
{
  const m = new Matchmaker();
  assert.deepEqual(m.join(entry('a', 1200)), { ok: true });
  assert.deepEqual(m.join(entry('a', 1200)), { ok: false, reason: 'already-queued' });
  assert.equal(m.size, 1);
  assert.ok(m.leave('a'));
  assert.equal(m.size, 0);
  console.log('ok  duplicate joins rejected');
}

// A single player never pairs with themselves.
{
  const m = new Matchmaker();
  m.join(entry('a', 1200));
  assert.equal(m.pair(0).length, 0);
  console.log('ok  no self-pair');
}

// Close ratings pair immediately; far ratings wait until the window opens.
{
  const m = new Matchmaker();
  m.join(entry('a', 1200, 0));
  m.join(entry('b', 1260, 0));
  const pairs = m.pair(0);
  assert.equal(pairs.length, 1);
  assert.deepEqual([pairs[0].a.key, pairs[0].b.key].sort(), ['a', 'b']);
  assert.equal(m.size, 0, 'paired players leave the queue');
}
{
  const m = new Matchmaker();
  m.join(entry('a', 1200, 0));
  m.join(entry('b', 2100, 0));
  assert.equal(m.pair(0).length, 0, 'far ratings cannot pair instantly');
  assert.equal(m.pair(60_000).length, 0, 'even a fully-open window cannot close a 900-point gap');
  assert.equal(m.windowFor(m.get('a')!, 60_000), QUEUE_MAX_WINDOW, 'window caps out');
  assert.equal(m.size, 2, 'both players stay queued');
  console.log('ok  rating window');
}

// Window expands with wait time.
{
  const m = new Matchmaker();
  m.join(entry('a', 1200, 0));
  const a = m.get('a')!;
  const w0 = m.windowFor(a, 0);
  const w1 = m.windowFor(a, 10_000);
  assert.equal(w0, QUEUE_BASE_WINDOW);
  assert.ok(w1 > w0 && w1 <= QUEUE_MAX_WINDOW);
  console.log('ok  window growth');
}

// Longest waiter picks the closest of several opponents.
{
  const m = new Matchmaker();
  m.join(entry('veteran', 1200, 0));
  m.join(entry('near', 1230, 1000));
  m.join(entry('far', 1500, 900));
  const pairs = m.pair(1000);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].a.key, 'veteran', 'oldest entry pairs first');
  assert.equal(pairs[0].b.key, 'near', 'closest rating wins');
  console.log('ok  closest opponent');
}

// Three players: one pair, one left waiting.
{
  const m = new Matchmaker();
  for (const [k, r] of [['a', 1200], ['b', 1210], ['c', 1400]] as const) m.join(entry(k, r));
  const pairs = m.pair(0);
  assert.equal(pairs.length, 1);
  assert.equal(m.size, 1);
  assert.equal(m.all()[0].key, 'c');
  console.log('ok  odd queue');
}

// Stale entries expire and are removed.
{
  const m = new Matchmaker();
  m.join(entry('a', 1200, 0));
  const expired = m.expire(QUEUE_TIMEOUT_MS + 1);
  assert.equal(expired.length, 1);
  assert.equal(expired[0].key, 'a');
  assert.equal(m.size, 0);
  console.log('ok  expiry');
}

console.log('MATCHMAKING TESTS PASSED');
