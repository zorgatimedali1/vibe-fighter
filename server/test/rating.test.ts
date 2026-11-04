// Unit tests: node --experimental-strip-types test/rating.test.ts
import assert from 'node:assert/strict';
import {
  applyResult, eloDelta, expectedScore, pointsDelta, tierOf, tierProgress,
  K_FACTOR, LOSS_POINTS, POINTS_START, PROVISIONAL_K, RATING_START, WIN_POINTS,
} from '../src/rating.ts';

// Elo expectations
{
  assert.equal(expectedScore(1200, 1200), 0.5);
  assert.ok(expectedScore(1400, 1200) > 0.7, 'higher rating is favoured');
  assert.equal(eloDelta(1200, 1200, 1), Math.round(K_FACTOR * 0.5));
  assert.equal(eloDelta(1200, 1200, 0), -Math.round(K_FACTOR * 0.5));
  assert.equal(eloDelta(1200, 1200, 1, 0), Math.round(PROVISIONAL_K * 0.5), 'provisional players move faster');
  assert.ok(eloDelta(1600, 1200, 1) < eloDelta(1200, 1200, 1), 'beating a weaker player is worth less');
  assert.ok(eloDelta(1200, 1600, 1) > eloDelta(1200, 1200, 1), 'upsets are worth more');
  console.log('ok  elo expectations');
}

// Points ladder
{
  assert.equal(pointsDelta(true, 1), WIN_POINTS);
  assert.equal(pointsDelta(true, 2), WIN_POINTS + 2);
  assert.equal(pointsDelta(true, 99), WIN_POINTS + 10, 'streak bonus is capped');
  assert.equal(pointsDelta(false, 0), -LOSS_POINTS);
  console.log('ok  points ladder');
}

// Full result
{
  const out = applyResult(
    { rating: 1200, points: POINTS_START, wins: 12, losses: 8, streak: 2 },
    { rating: 1200, points: POINTS_START, wins: 10, losses: 10, streak: 4 },
  );
  assert.ok(out.winner.ratingDelta > 0 && out.loser.ratingDelta < 0, 'winner up, loser down');
  assert.equal(out.winner.streak, 3, 'winner streak increments');
  assert.equal(out.loser.streak, 0, 'loser streak resets');
  assert.equal(out.winner.pointsDelta, WIN_POINTS + 4, 'streak bonus applies');
  assert.equal(out.loser.pointsDelta, -LOSS_POINTS);

  // Ratings cannot fall under the floor, points cannot go negative.
  const floor = applyResult(
    { rating: 100, points: 5, wins: 99, losses: 0, streak: 0 },
    { rating: 2400, points: 0, wins: 0, losses: 99, streak: 0 },
  );
  assert.ok(floor.loser.ratingAfter >= 100);
  assert.ok(floor.loser.pointsAfter >= 0);
  console.log('ok  applyResult');
}

// Tiers
{
  assert.equal(tierOf(0), 'Bronze');
  assert.equal(tierOf(999), 'Bronze');
  assert.equal(tierOf(1000), 'Silver');
  assert.equal(tierOf(1400), 'Gold');
  assert.equal(tierOf(1800), 'Platinum');
  assert.equal(tierOf(2200), 'Diamond');
  assert.equal(tierOf(2600), 'Master');
  assert.equal(tierOf(9999), 'Master');
  assert.ok(tierProgress(1000) === 0 && tierProgress(1399) > 0.9);
  assert.equal(tierProgress(3000), 1);
  console.log('ok  tiers');
}

void RATING_START;
console.log('RATING TESTS PASSED');
