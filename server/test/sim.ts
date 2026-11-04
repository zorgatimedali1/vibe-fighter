// Headless simulation test: node --experimental-strip-types test/sim.ts
import { CombatRoom, type RoomHooks } from '../src/engine/CombatRoom.ts';
import { Action, type BotDifficulty, type FighterId, type FrameData, type MoveId, type PlayerState } from '../src/types/combat.ts';
import {
  DASH_DISTANCE, GUARD_BREAK_FRAMES, GUARD_MAX, MAX_MANA, MOVES, OD_MAX, SPELLS, START_MANA,
  moveData, spellFor,
} from '../src/engine/moves.ts';
import { BOT_PROFILES, makeBot } from '../src/engine/Bot.ts';
import assert from 'node:assert/strict';

interface Ev { ev: string; p: any; to?: string }

function mk(fighterA: FighterId = 'ram', fighterB: FighterId = 'cap') {
  const events: Ev[] = [];
  let settled: any = null;
  const hooks: RoomHooks = {
    emitTo: (to, ev, p) => { if (ev !== 'snapshot' && ev !== 'rtt') events.push({ ev, p, to }); },
    emitAll: (ev, p) => events.push({ ev, p }),
    settle: (r) => { settled = r; },
    closed: () => {},
  };
  const room = new CombatRoom('t', ['A', 'B'], hooks, { dev: true });
  // Start without the wall-clock loop: connect, then stop it and drive step() by hand.
  room.markConnected('A', fighterA); room.markConnected('B', fighterB); room.stop();
  const seq = { A: 0, B: 0 };
  const send = (who: 'A' | 'B', actions: number) => room.pushInput(who, { seq: ++seq[who], tick: room.tick, actions });
  const run = (n: number, a = 0, b = 0) => { for (let i = 0; i < n; i++) { send('A', a); send('B', b); room.step(); } };
  const fightReady = () => { run(200); assert.equal(room.phase, 'FIGHTING'); };
  return { room, events, run, send, fightReady, settled: () => settled };
}
const hits = (ev: Ev[]) => ev.filter((e) => e.ev === 'hit_confirmed');
const has = (ev: Ev[], name: string) => ev.some((e) => e.ev === name);

/** Practice room: human + controllable dummy, driven by hand. */
function mkTraining(fighter: FighterId = 'cap') {
  const events: Ev[] = [];
  const hooks: RoomHooks = {
    emitTo: (to, ev, p) => { if (ev !== 'snapshot' && ev !== 'rtt') events.push({ ev, p, to }); },
    emitAll: (ev, p) => events.push({ ev, p }),
    settle: () => {}, closed: () => {},
  };
  const room = new CombatRoom('train', ['HUMAN', 'DUMMY'], hooks, { dev: true, botIndex: 1, mode: 'training' });
  room.markConnected('HUMAN'); room.stop();
  room.setTrainingDummy('stand');
  let seq = 0;
  const send = (a: number) => room.pushInput('HUMAN', { seq: ++seq, tick: room.tick, actions: a });
  const run = (n: number, a = 0) => { for (let i = 0; i < n; i++) { send(a); room.step(); } };
  run(150);
  return { room, events, run, send };
}

/** Button that starts each move (Sweep holds Down; air normals use the same punch/kick buttons). */
const PRESS: Record<MoveId, number> = {
  LightPunch: Action.LightPunch,
  LightKick: Action.LightKick,
  HeavyPunch: Action.HeavyPunch,
  HeavyKick: Action.HeavyKick,
  Sweep: Action.HeavyKick | Action.Down,
  AirPunch: Action.LightPunch,
  AirKick: Action.LightKick,
  Spell: Action.Spell,
  Overdrive: Action.Overdrive,
  Grab: Action.Grab,
};

// 1. Frame data: every move plays exactly its registered startup/active/recovery.
//    The spell resolves per fighter, so the reference data comes from `moveData(name, 'ram')`.
{
  for (const name of Object.keys(MOVES) as MoveId[]) {
    const mv: FrameData = moveData(name, 'ram');
    const t = mk(); t.fightReady();
    const [A, B] = t.room.state;
    A.x = 0; B.x = 6;                                // out of range: watch the state machine only
    if (mv.air) { A.y = 2.0; A.vy = 0; A.state = 'JUMP'; A.airAttackUsed = false; }
    if (name === 'Spell') A.mana = MAX_MANA;
    if (name === 'Overdrive') A.overdrive = OD_MAX;

    const seen: string[] = [];
    t.run(1, PRESS[name]); seen.push(A.state);
    const total = mv.startup + mv.active + mv.recovery;
    for (let i = 1; i <= total + 4; i++) { t.run(1); seen.push(A.state); }
    const count = (s: string) => seen.filter((x) => x === s).length;

    assert.equal(count('ATTACK_STARTUP'), mv.startup, `${name} startup :: ${seen.join(',')}`);
    assert.equal(count('ATTACK_ACTIVE'), mv.active, `${name} active :: ${seen.join(',')}`);
    assert.equal(count('ATTACK_RECOVERY'), mv.recovery, `${name} recovery :: ${seen.join(',')}`);
  }
  console.log(`ok  frame data for all ${Object.keys(MOVES).length} moves`);
}

// 2. Light punch connects for 8 damage, once, with hitstun.
{
  const t = mk(); t.fightReady();
  const [A, B] = t.room.state;
  A.x = -0.5; B.x = 0.5;
  t.run(1, Action.LightPunch); t.run(12);
  assert.equal(hits(t.events).length, 1);
  assert.equal(B.hp, 100 - MOVES.LightPunch.damage);
  console.log('ok  light punch = 8 dmg, single hit');
}

// 3. Guard: blocked hits deal zero damage, drain the guard meter and can break the guard.
{
  const t = mk(); t.fightReady();
  const [A, B] = t.room.state;
  A.x = -0.5; B.x = 0.5;
  t.run(1, 0, Action.Block);
  t.run(1, Action.LightPunch, Action.Block);
  t.run(14, 0, Action.Block);
  assert.equal(B.hp, 100, 'guard must block all damage');
  assert.ok(has(t.events, 'block_confirmed'));
  assert.equal(hits(t.events).length, 0);
  assert.ok(B.guard < GUARD_MAX, `guard meter ${B.guard}`);

  // Sustained heavy pressure empties the meter: guard break, no damage, long punish window.
  const u = mk(); u.fightReady();
  const [A2, B2] = u.room.state;
  A2.x = -0.5;
  u.run(1, 0, Action.Block);
  for (let i = 0; i < 10 && B2.state !== 'GUARD_BREAK'; i++) {
    B2.x = A2.x + 0.6;                               // stay in range through the pushback
    u.run(1, Action.HeavyPunch, Action.Block);
    u.run(38, 0, Action.Block);
  }
  assert.equal(B2.state, 'GUARD_BREAK', `guard break state (guard ${B2.guard})`);
  assert.ok(B2.timer > 20 && B2.timer <= GUARD_BREAK_FRAMES, `punish window ${B2.timer}`);
  assert.equal(B2.hp, 100, 'a guard break itself deals no damage');
  assert.ok(has(u.events, 'guard_break'));
  console.log('ok  guard blocks all damage, meter drains, guard break punishes');
}

// 4. Guard is universal: lows and overheads are blocked by a standing or crouching guard.
{
  for (const guard of [Action.Block, Action.Block | Action.Down]) {
    const t = mk(); t.fightReady();
    t.room.state[0].x = -0.5; t.room.state[1].x = 0.5;
    t.run(1, 0, guard);
    t.run(1, Action.HeavyKick, guard);
    t.run(24, 0, guard);
    assert.equal(t.room.state[1].hp, 100, 'low kick is blocked');
    assert.ok(has(t.events, 'block_confirmed'));

    const u = mk(); u.fightReady();
    const [A, B] = u.room.state;
    A.x = -0.6; B.x = 0.5; A.y = 0.8; A.vy = 0; A.state = 'JUMP'; A.airAttackUsed = false;
    u.run(1, 0, guard);
    u.run(1, Action.LightKick, guard);
    u.run(24, 0, guard);
    assert.equal(B.hp, 100, 'air kick is blocked');
    assert.ok(has(u.events, 'block_confirmed'));
  }

  // Grab is the one thing guard does not stop.
  const g = mk(); g.fightReady();
  g.room.state[0].x = -0.4; g.room.state[1].x = 0.4;
  g.run(1, 0, Action.Block);
  g.run(1, Action.Grab, Action.Block);
  g.run(20, 0, Action.Block);
  assert.equal(g.room.state[1].hp, 100 - MOVES.Grab.damage);
  console.log('ok  universal guard, grab remains unblockable');
}

// 5. Crouching dodges high punches but not lows.
{
  const t = mk(); t.fightReady();
  t.room.state[0].x = -0.5; t.room.state[1].x = 0.5;
  t.run(1, Action.LightPunch, Action.Down);
  t.run(12, 0, Action.Down);
  assert.equal(t.room.state[1].hp, 100);

  const u = mk(); u.fightReady();
  u.room.state[0].x = -0.5; u.room.state[1].x = 0.5;
  u.run(1, Action.HeavyKick | Action.Down, Action.Down);      // sweep
  u.run(24, 0, Action.Down);
  assert.equal(u.room.state[1].hp, 100 - MOVES.Sweep.damage);
  console.log('ok  crouch avoids highs, lows still hit');
}

// 6. Out of range whiffs.
{
  const t = mk(); t.fightReady();
  t.room.state[0].x = -2; t.room.state[1].x = 2;
  t.run(1, Action.HeavyKick); t.run(30);
  assert.equal(t.room.state[1].hp, 100);
  console.log('ok  whiff out of range');
}

// 7. Same-move clash = no damage; different moves = trade; faster move wins outright.
{
  const t = mk(); t.fightReady();
  t.room.state[0].x = -0.5; t.room.state[1].x = 0.5;
  t.run(1, Action.LightPunch, Action.LightPunch); t.run(12);
  assert.equal(t.room.state[0].hp + t.room.state[1].hp, 200);
  assert.ok(has(t.events, 'clash'));

  const u = mk(); u.fightReady();
  u.room.state[0].x = -0.5; u.room.state[1].x = 0.5;
  // Heavy kick active on t+12, light punch started 8 ticks later is active on t+12 too.
  u.run(1, Action.HeavyKick, 0);
  u.run(7);
  u.run(1, 0, Action.LightPunch);
  u.run(30);
  assert.ok(u.room.state[0].hp < 100 && u.room.state[1].hp < 100, `${u.room.state[0].hp}/${u.room.state[1].hp}`);

  const w = mk(); w.fightReady();
  w.room.state[0].x = -0.5; w.room.state[1].x = 0.5;
  w.run(1, Action.LightPunch, Action.HeavyKick); w.run(30);
  assert.equal(w.room.state[0].hp, 100);
  assert.equal(w.room.state[1].hp, 100 - MOVES.LightPunch.damage);
  console.log('ok  clash, trade, faster move wins');
}

// 8. Mana: starts at 30, +6/s, spell costs 50, gained on hit/block, capped at 100.
{
  const t = mk(); t.fightReady();
  const [A] = t.room.state;
  assert.equal(Math.floor(A.mana), START_MANA + 2);          // 20 simulated ticks during the countdown
  t.run(60);
  assert.equal(Math.floor(A.mana), START_MANA + 8);          // +6 in one second

  A.mana = 60;
  t.run(1, Action.Spell);
  assert.equal(A.state, 'ATTACK_STARTUP');
  assert.equal(A.move, 'Spell');
  const cost = spellFor('ram').manaCost!;
  assert.ok(Math.abs(A.mana - (60 - cost)) < 1.5, `mana after cast ${A.mana} (cost ${cost})`);

  const u = mk(); u.fightReady();
  const [A2] = u.room.state;
  A2.mana = 10;
  u.run(1, Action.Spell);
  assert.notEqual(A2.state, 'ATTACK_STARTUP');
  assert.ok(has(u.events, 'no_mana'));

  const v = mk(); v.fightReady();
  const [A3, B3] = v.room.state;
  A3.x = -0.5; B3.x = 0.5; A3.mana = 40;
  const before = A3.mana;
  v.run(1, Action.LightPunch); v.run(12);
  assert.ok(A3.mana >= before + 6, `mana on hit ${before} -> ${A3.mana}`);

  A3.mana = MAX_MANA - 0.01;
  v.run(2);
  assert.equal(Math.floor(A3.mana), MAX_MANA);
  console.log('ok  mana regen, cost, no-mana guard, hit gain, cap');
}

// 9. Spell projectile: spawn, travel, hit, block, expire, clash â€” using Ram's Seismic Wave.
{
  const ram = spellFor('ram');
  const t = mk(); t.fightReady();
  const [A, B] = t.room.state;
  A.x = -2; B.x = 2; A.mana = MAX_MANA;
  t.run(1, Action.Spell);
  t.run(20);
  assert.equal(t.room.liveProjectiles.length, 1);
  assert.ok(has(t.events, 'spell_cast'));
  t.run(70);
  assert.equal(B.hp, 100 - ram.damage);
  assert.equal(t.room.liveProjectiles.length, 0);

  const u = mk(); u.fightReady();
  const [A2, B2] = u.room.state;
  A2.x = -2; B2.x = 2; A2.mana = MAX_MANA;
  u.run(1, 0, Action.Block);
  u.run(1, Action.Spell, Action.Block);
  u.run(80, 0, Action.Block);
  assert.equal(B2.hp, 100, 'the spell is guarded like everything else');
  assert.ok(has(u.events, 'block_confirmed'));

  const v = mk(); v.fightReady();
  const [A3, B3] = v.room.state;
  A3.x = -2; B3.x = 2; A3.mana = MAX_MANA;
  v.run(1, Action.Spell); v.run(20);
  assert.equal(v.room.liveProjectiles.length, 1);
  (v.room as any).projectiles[0].framesLeft = 2;
  v.run(3);
  assert.equal(v.room.liveProjectiles.length, 0);
  assert.equal(B3.hp, 100);

  // Clash needs two spells at the same height: mirror-match Ram-vs-Ram.
  const w = mk('ram', 'ram'); w.fightReady();
  const [A4, B4] = w.room.state;
  A4.x = -3; B4.x = 3; A4.mana = MAX_MANA; B4.mana = MAX_MANA;
  w.run(1, Action.Spell, Action.Spell);
  w.run(60);
  assert.ok(has(w.events, 'spell_clash'));
  assert.equal(A4.hp, 100);
  assert.equal(B4.hp, 100);
  assert.equal(w.room.liveProjectiles.length, 0);
  console.log('ok  projectile cast/hit/block/expire/clash');
}

// 10. Cancels: a connected light normal can be cancelled into a heavy during recovery.
{
  const t = mk(); t.fightReady();
  t.room.state[0].x = -0.5; t.room.state[1].x = 0.5;
  t.run(1, Action.LightPunch);
  t.run(5);
  t.run(1, Action.HeavyPunch);
  t.run(40);
  const started = t.events.filter((e) => e.ev === 'move_start').map((e) => e.p.move);
  assert.deepEqual(started.slice(0, 2), ['LightPunch', 'HeavyPunch'], started.join(','));
  console.log('ok  light -> heavy cancel');
}

// 11. Grab: unblockable command grab, and it whiffs at range.
{
  const t = mk(); t.fightReady();
  t.room.state[0].x = -0.4; t.room.state[1].x = 0.4;
  t.run(1, 0, Action.Block);
  t.run(1, Action.Grab, Action.Block);
  t.run(20, 0, Action.Block);
  assert.equal(t.room.state[1].hp, 100 - MOVES.Grab.damage);
  assert.equal(t.room.state[1].state, 'KNOCKDOWN');

  const u = mk(); u.fightReady();
  u.room.state[0].x = -2; u.room.state[1].x = 2;
  u.run(1, Action.Grab); u.run(20);
  assert.equal(u.room.state[1].hp, 100);
  console.log('ok  grab beats block, whiffs at range');
}

// 12. Dash covers its registered distance and can be cancelled into an attack.
{
  const t = mk(); t.fightReady();
  const [A] = t.room.state;
  t.room.state[1].x = 6;
  A.x = -4;
  t.run(1, Action.Dash | Action.Right);
  assert.equal(A.state, 'DASH');
  t.run(14);
  assert.equal(A.state, 'IDLE');
  assert.ok(Math.abs(A.x - (-4 + DASH_DISTANCE)) < 0.02, `dash x ${A.x}`);

  const u = mk(); u.fightReady();
  const [A2] = u.room.state;
  u.room.state[1].x = 6;
  A2.x = -4;
  u.run(1, Action.Dash | Action.Right);
  u.run(8);
  u.run(1, Action.LightPunch);
  assert.equal(A2.state, 'ATTACK_STARTUP');
  assert.equal(A2.move, 'LightPunch');
  console.log('ok  dash distance + dash cancel');
}

// 13. Air normals: one per jump, reset on landing.
{
  const t = mk(); t.fightReady();
  const [A] = t.room.state;
  t.room.state[1].x = 6;
  A.x = 0; A.y = 2.0; A.vy = 0; A.state = 'JUMP'; A.airAttackUsed = false;
  t.run(1, Action.LightKick);
  assert.equal(A.state, 'ATTACK_STARTUP');
  assert.equal(A.move, 'AirKick');
  t.run(10);
  t.run(1, Action.LightPunch);
  assert.notEqual(A.move, 'AirPunch');
  t.run(40);
  assert.equal(A.y, 0);
  assert.equal(A.airAttackUsed, false);
  assert.equal(A.state, 'IDLE');
  console.log('ok  one air normal per jump');
}

// 14. Lag compensation: the defender walked out of range during the attacker's RTT/2; the rewind
//     still connects, while the same inputs without rewind whiff.
{
  const t = mk(); t.fightReady();
  t.room.state[0].x = -0.6; t.room.state[1].x = 0.6;
  (t.room as any).slots[0].rttMs = 150;                      // rewind 75 ms = 5 ticks
  for (let i = 0; i < 6; i++) { t.send('A', i === 0 ? Action.LightPunch : 0); t.send('B', Action.Right); t.room.step(); }
  t.run(10, 0, Action.Right);
  assert.equal(t.room.state[1].hp, 100 - MOVES.LightPunch.damage);

  const u = mk(); u.fightReady();
  u.room.state[0].x = -0.6; u.room.state[1].x = 0.6;
  (u.room as any).slots[0].rttMs = 0;
  for (let i = 0; i < 6; i++) { u.send('A', i === 0 ? Action.LightPunch : 0); u.send('B', Action.Right); u.room.step(); }
  u.run(10, 0, Action.Right);
  assert.equal(u.room.state[1].hp, 100);
  console.log('ok  lag comp');
}

// 15. Input sanitation against the 13-bit action mask.
{
  const t = mk();
  assert.equal(t.room.pushInput('A', { seq: 1, tick: 1, actions: 8192 }), false);
  assert.equal(t.room.pushInput('A', { seq: 2, tick: 1, actions: 8191 }), true);
  assert.equal(t.room.pushInput('A', { seq: 2, tick: 1, actions: 1 }), false);     // replay
  assert.equal(t.room.pushInput('A', { seq: 'x' as any, tick: 1, actions: 1 }), false);
  console.log('ok  input sanitation');
}

// 16. KO -> best of 3 -> settlement.
{
  const t = mk(); t.fightReady();
  for (let round = 0; round < 2; round++) {
    while (t.room.phase !== 'FIGHTING' && t.room.phase !== 'COMPLETED') t.run(1);
    if (t.room.phase === 'COMPLETED') break;
    const [A, B] = t.room.state;
    A.x = -0.5; B.x = 0.5; B.hp = 8;
    t.run(1, Action.LightPunch);
    t.run(20);
  }
  assert.equal(t.room.phase, 'COMPLETED');
  assert.equal(t.settled().winner, 'A');
  assert.equal(t.settled().p1Rounds, 2);
  console.log('ok  best-of-3 settlement ->', JSON.stringify(t.settled()));
}

// 17. Bot smoke test: a real match against a passive human must finish without throwing, and the
//     bot must win by KO or on time. This exercises jumps, dashes, spells, grabs and cancels.
{
  const events: Ev[] = [];
  let settled: any = null;
  const hooks: RoomHooks = {
    emitTo: (to, ev, p) => { if (ev !== 'snapshot' && ev !== 'rtt') events.push({ ev, p, to }); },
    emitAll: (ev, p) => events.push({ ev, p }),
    settle: (r) => { settled = r; },
    closed: () => {},
  };
  const room = new CombatRoom('bot-test', ['HUMAN', 'BOT'], hooks, { dev: true, botIndex: 1 });
  room.markConnected('HUMAN');
  room.stop();
  let seq = 0;
  let ticks = 0;
  while (room.phase !== 'COMPLETED' && ticks < 40_000) {
    room.pushInput('HUMAN', { seq: ++seq, tick: room.tick, actions: 0 });
    room.step();
    ticks++;
  }
  assert.equal(room.phase, 'COMPLETED', `bot match did not finish in ${ticks} ticks`);
  assert.equal(settled.winner, 'BOT');
  assert.ok(events.some((e) => e.ev === 'hit_confirmed'), 'bot never landed a hit');
  assert.ok(room.state[0].hp < 100, `human hp ${room.state[0].hp}`);
  console.log(`ok  bot match finished in ${ticks} ticks (${settled.reason}), human hp ${room.state[0].hp}`);
}

// 18. Every fighter casts only its own signature spell, with its own cost and frame data.
{
  const ids: FighterId[] = ['ram', 'cap', 'antenna', 'mohawk', 'prop'];
  const names = new Set<string>();
  for (const id of ids) {
    const t = mk(id, 'ram');
    t.fightReady();
    const [A, B] = t.room.state;
    A.x = -2; B.x = 2; A.mana = MAX_MANA;
    const before = A.mana;
    const def = spellFor(id);
    t.run(1, Action.Spell);
    const spent = before - A.mana;                 // read before regen / on-hit mana can muddy it
    assert.ok(Math.abs(spent - def.manaCost!) < 1.5, `${id} cost ${spent}`);
    t.run(def.startup + 3);
    const cast = t.events.find((e) => e.ev === 'spell_cast');
    assert.ok(cast, `${id} never cast a spell`);
    assert.equal(cast!.p.spell, id, `${id} cast ${cast!.p.spell}`);
    if (def.beam) assert.equal(t.room.liveProjectiles.length, 0, `${id} should fire a beam`);
    else if (def.projectile) {
      assert.equal(t.room.liveProjectiles.length, 1, `${id} should fire a projectile`);
      assert.equal(t.room.liveProjectiles[0].def.id, id);
      assert.equal(t.room.liveProjectiles[0].def.damage, def.damage);
    } else {
      assert.equal(t.room.liveProjectiles.length, 0, `${id} is a melee spell`);
    }
    names.add(def.name);
  }
  assert.equal(names.size, ids.length, 'every fighter has a distinct spell');

  // Mohawk's Magma Fist: melee reversal, hard knockdown, one hit of super armour.
  {
    const t = mk('mohawk', 'ram'); t.fightReady();
    const [A, B] = t.room.state;
    A.x = -0.5; B.x = 0.5; A.mana = MAX_MANA;
    t.run(1, Action.Spell); t.run(19);
    assert.equal(hits(t.events).length, 1, 'magma fist connects as a melee blow');
    assert.equal(B.hp, 100 - spellFor('mohawk').damage);
    assert.equal(B.state, 'KNOCKDOWN');

    const u = mk('mohawk', 'ram'); u.fightReady();
    const [A2, B2] = u.room.state;
    A2.x = -0.35; B2.x = 0.35; A2.mana = MAX_MANA;
    u.run(1, Action.Spell, 0);                 // armoured reversal starts
    u.run(1, 0, Action.LightPunch);            // the jab comes out during startup
    u.run(6, 0, 0);
    const armored = u.events.find((e) => e.ev === 'hit_confirmed' && e.p.defenderId === 'A');
    assert.ok(armored, 'the jab should land on the reversal');
    assert.equal(armored!.p.armored, true, 'super armour absorbs the stun');
    assert.equal(A2.state.startsWith('ATTACK'), true, `armour kept the attack going (${A2.state})`);
    assert.equal(A2.hp, 100 - MOVES.LightPunch.damage, 'armour still takes the damage');
    u.run(30, 0, 0);
    assert.ok(B2.hp < 100, 'the reversal still comes out');
  }
  console.log('ok  exclusive per-fighter spells');
}

// 19. Cap's Gale Slash is a two-hit crescent (multi-hit projectile).
{
  const t = mk('cap', 'ram'); t.fightReady();
  const [A, B] = t.room.state;
  A.x = -1.2; B.x = 1.2; A.mana = MAX_MANA;
  t.run(1, Action.Spell);
  t.run(40);
  assert.equal(hits(t.events).length, 2, 'Gale Slash cuts twice');
  const d1 = spellFor('cap').damage;
  const d2 = Math.round(d1 * 0.8);          // second hit is scaled by the combo counter
  assert.equal(B.hp, 100 - d1 - d2);
  console.log('ok  gale slash hits twice');
}

// 20. Antenna's Signal Beam: long lance, crouch under it, finite reach.
{
  const beam = spellFor('antenna');
  const t = mk('antenna', 'ram'); t.fightReady();
  const [A, B] = t.room.state;
  A.x = -3; B.x = 3; A.mana = MAX_MANA;
  t.run(1, Action.Spell); t.run(40);
  assert.equal(B.hp, 100 - beam.damage, 'beam hits a standing target at range');

  const u = mk('antenna', 'ram'); u.fightReady();
  const [A2, B2] = u.room.state;
  A2.x = -3; B2.x = 3; A2.mana = MAX_MANA;
  u.run(1, 0, Action.Down);
  u.run(1, Action.Spell, Action.Down);
  u.run(40, 0, Action.Down);
  assert.equal(B2.hp, 100, 'a crouching fighter ducks the lance');

  const v = mk('antenna', 'ram'); v.fightReady();
  const [A3, B3] = v.room.state;
  A3.x = -8; B3.x = 8; A3.mana = MAX_MANA;
  v.run(1, Action.Spell); v.run(40);
  assert.equal(B3.hp, 100, 'the lance has finite reach');
  console.log('ok  signal beam: reach + crouch dodge');
}

// 21. Prop's Cyclone recoils the caster and arcs an overhead projectile.
{
  const t = mk('prop', 'ram'); t.fightReady();
  const [A] = t.room.state;
  A.x = 0; A.mana = MAX_MANA;
  t.run(1, Action.Spell);
  t.run(spellFor('prop').startup + 2);
  assert.ok(A.x < -0.3, `cyclone recoil should push the caster back (x ${A.x})`);
  assert.equal(t.room.liveProjectiles[0]?.def.id, 'prop');
  console.log('ok  cyclone recoil + arc');
}

// 22. Guard meter refills once you stop guarding.
{
  const t = mk(); t.fightReady();
  const [A, B] = t.room.state;
  A.x = -0.5; B.x = 0.5;
  t.run(1, 0, Action.Block);
  t.run(1, Action.LightPunch, Action.Block);
  t.run(14, 0, Action.Block);
  const drained = B.guard;
  assert.ok(drained < GUARD_MAX, `drained ${drained}`);
  t.run(200, 0, 0);
  assert.ok(B.guard > drained, `guard should regenerate ${drained} -> ${B.guard}`);
  console.log('ok  guard meter regenerates');
}

// 23. Difficulty tiers: strictly harder, and the difficulty actually reaches the bot.
{
  const order: BotDifficulty[] = ['rookie', 'easy', 'normal', 'hard', 'insane', 'nightmare'];
  for (let i = 1; i < order.length; i++) {
    const lo = BOT_PROFILES[order[i - 1]], hi = BOT_PROFILES[order[i]];
    assert.ok(hi.guard > lo.guard, `guard ${order[i]}`);
    assert.ok(hi.punish > lo.punish, `punish ${order[i]}`);
    assert.ok(hi.combo > lo.combo, `combo ${order[i]}`);
    assert.ok(hi.spellRange >= lo.spellRange, `spell ${order[i]}`);
    assert.ok(hi.reactMin <= lo.reactMin && hi.reactMax <= lo.reactMax, `reaction ${order[i]}`);
  }

  // Defence is the real tell, and it is profile-driven: the same telegraphed attack makes a Rookie
  // block ~5% of the time and a Nightmare ~96%. Sample 200 reactions per tier.
  const state = (o: Partial<PlayerState>): PlayerState => ({
    x: 0, y: 0, vy: 0, facing: 1, state: 'IDLE', move: null, timer: 0, hp: 100, mana: 100,
    overdrive: 0, guard: GUARD_MAX, guardAt: 0, parryUntil: 0, guarded: false, hasHit: false,
    crouching: false, kbVx: 0, kbFrames: 0, dashVx: 0, airAttackUsed: false, castFired: false,
    combo: 0, comboExpire: 0, cancelUntil: 0, ...o,
  });
  const guardRate = (difficulty: BotDifficulty) => {
    const bot = makeBot(difficulty, 42);
    const me = state({});
    const foe = state({ x: 1.0, facing: -1, state: 'ATTACK_STARTUP', move: 'LightPunch' });
    let blocks = 0;
    for (let k = 0; k < 200; k++) if (bot(me, foe, k * 25) & Action.Block) blocks++;
    return blocks / 200;
  };
  const rookieGuard = guardRate('rookie');
  const nightmareGuard = guardRate('nightmare');
  assert.ok(nightmareGuard > 0.8, `nightmare guard rate ${nightmareGuard}`);
  assert.ok(rookieGuard < 0.3, `rookie guard rate ${rookieGuard}`);
  console.log(`ok  ${order.length} difficulty tiers (guard rate: rookie ${rookieGuard.toFixed(2)}, nightmare ${nightmareGuard.toFixed(2)})`);
}

// 24. Overdrive: builds from damage, pays for the EX spell, and refuses when empty.
{
  const t = mk('cap', 'ram'); t.fightReady();
  const [A, B] = t.room.state;
  A.x = -0.5; B.x = 0.5;
  assert.equal(A.overdrive, 0, 'the bar starts empty');
  t.run(1, Action.LightPunch); t.run(30);
  assert.ok(A.overdrive > 3, `attacker builds overdrive (${A.overdrive})`);
  assert.ok(B.overdrive > 3, `defender builds overdrive (${B.overdrive})`);

  // A full bar replaces mana as the cost.
  A.overdrive = OD_MAX; A.mana = 0; A.x = -2; B.x = 2;
  t.run(1, Action.Overdrive);
  assert.equal(A.state, 'ATTACK_STARTUP', 'EX starts');
  assert.equal(A.move, 'Overdrive');
  assert.equal(A.overdrive, 0, 'the whole bar is spent on start');
  t.run(spellFor('cap').overdrive.startup + 4);
  const pr = t.room.liveProjectiles[0];
  assert.ok(pr, 'the EX projectile exists');
  assert.equal(pr.def.name, 'Tempest Barrage');
  assert.equal(pr.hitsLeft, 3, 'cap EX is a three-hit crescent');

  // An empty bar is refused with a clear event.
  const u = mk(); u.fightReady();
  const [A2] = u.room.state;
  A2.overdrive = 0;
  u.run(1, Action.Overdrive);
  assert.notEqual(A2.move, 'Overdrive');
  assert.ok(has(u.events, 'no_overdrive'));
  console.log('ok  overdrive meter + EX spell');
}

// 25. Perfect guard: a timely fresh tap costs no guard and frees you instantly; held block does not.
{
  const t = mk('ram', 'cap'); t.fightReady();
  const [A, B] = t.room.state;
  A.x = -0.5; B.x = 0.5;
  t.run(4, 0, 0);
  t.run(1, Action.LightPunch, 0);         // T: jab starts, active on T+4
  t.run(1, 0, Action.Block);              // T+1: fresh tap, not previously guarding
  t.run(3, 0, Action.Block);              // T+2..T+4: the hit lands inside the parry window
  assert.ok(has(t.events, 'perfect_guard'), 'the tap should parry');
  assert.equal(B.hp, 100);
  assert.equal(B.guard, GUARD_MAX, 'a perfect guard costs no guard meter');
  assert.ok(!has(t.events, 'block_confirmed'), 'it is not an ordinary block');

  // Held guard is an ordinary block: meter drains, no parry.
  const u = mk('ram', 'cap'); u.fightReady();
  const [A2, B2] = u.room.state;
  A2.x = -0.5; B2.x = 0.5;
  u.run(8, 0, Action.Block);
  u.run(1, Action.LightPunch, Action.Block);
  u.run(6, 0, Action.Block);
  assert.ok(!has(u.events, 'perfect_guard'), 'holding block must not parry');
  assert.ok(has(u.events, 'block_confirmed'));
  assert.ok(B2.guard < GUARD_MAX);
  console.log('ok  perfect guard is a tap, not a hold');
}

// 26. Throw tech: two grabs that meet cancel out.
{
  const t = mk('mohawk', 'cap'); t.fightReady();
  const [A, B] = t.room.state;
  A.x = -0.5; B.x = 0.5;
  t.run(1, Action.Grab, Action.Grab);
  t.run(20);
  assert.ok(has(t.events, 'throw_tech'), 'grabs should tech');
  assert.equal(A.hp, 100);
  assert.equal(B.hp, 100);
  console.log('ok  throw tech');
}

// 27. Light chain: jab -> kick -> heavy inside one reversal window.
{
  const t = mk(); t.fightReady();
  t.room.state[0].x = -0.5; t.room.state[1].x = 0.5;
  t.run(1, Action.LightPunch); t.run(5);
  t.run(1, Action.LightKick); t.run(12);
  t.run(1, Action.HeavyPunch); t.run(40);
  const started = t.events.filter((e) => e.ev === 'move_start').map((e) => e.p.move);
  assert.deepEqual(started.slice(0, 3), ['LightPunch', 'LightKick', 'HeavyPunch'], started.join(','));
  console.log('ok  light chain');
}

// 28. Training room: no clock, no round end, infinite meter, switchable dummy, reset.
{
  const t = mkTraining('cap');
  const [A, B] = t.room.state;
  assert.equal(t.room.phase, 'FIGHTING');
  assert.equal(t.room.secondsLeft, 99, 'the practice clock does not run');
  assert.equal(Math.floor(A.mana), MAX_MANA, 'infinite mana');
  assert.equal(A.overdrive, OD_MAX, 'infinite overdrive');

  B.hp = 3; A.x = -0.5; B.x = 0.5;
  t.run(1, Action.LightPunch); t.run(16);
  assert.equal(t.room.phase, 'FIGHTING', 'a KO does not end a practice round');
  assert.equal(B.hp, 100, 'the dummy refills instead');
  assert.deepEqual(t.room.rounds, [0, 0]);

  t.room.setTrainingDummy('block');
  t.run(3, 0);
  assert.equal(B.state, 'BLOCK', 'dummy switch: block');
  t.room.setTrainingDummy('stand');
  t.run(3, 0);
  assert.notEqual(B.state, 'BLOCK', 'dummy switch: stand');

  A.x = 3.2;
  t.room.trainingReset();
  assert.ok(Math.abs(t.room.state[0].x + 2) < 0.01, `reset x ${t.room.state[0].x}`);
  assert.equal(t.room.state[0].hp, 100);
  console.log('ok  training room');
}


