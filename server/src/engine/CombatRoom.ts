import {
  Action, ACTION_MASK,
  type BotDifficulty, type BoundingBox, type FighterState, type FrameData, type HistoryEntry,
  type InputPayload, type MatchResult, type MoveId, type Phase, type PlayerState, type Snapshot,
} from '../types/combat.ts';
import {
  ARENA_HALF, BACK_STEP, BODY, CANCEL_WINDOW, COMBO_SCALE, COMBO_TIMEOUT, COUNTDOWN_TICKS,
  DASH_CANCEL_FRAME, DASH_FRAMES, DASH_STEP, DOUBLE_TAP_WINDOW, GRAVITY, GUARD_BREAK_FRAMES,
  GUARD_BREAK_RECOVER, GUARD_MAX, GUARD_REGEN_DELAY, GUARD_REGEN_PER_TICK, HISTORY_TICKS,
  INPUT_BUFFER_FRAMES, JUMP_VY, MANA_ON_BLOCK, MANA_ON_HIT, MANA_REGEN_PER_TICK, MAX_MANA,
  MAX_PROJECTILES_PER_PLAYER, MAX_RTT_COMP_MS, MAX_STEP, MOVES, OD_COST, OD_MAX, OD_ON_BLOCK,
  OD_ON_GUARD_BREAK, OD_ON_HIT, OD_ON_PERFECT, OD_ON_TAKE, PERFECT_GUARD_FRAMES,
  PERFECT_GUARD_PUNISH, PROJECTILE_CLASH_RADIUS, PUSH_DIST, RECONNECT_GRACE_MS, ROUND_END_TICKS,
  ROUND_SECONDS, ROUNDS_TO_WIN, SNAPSHOT_EVERY, SPAWN_X, START_HP, START_MANA, TICK_MS, TICK_RATE,
  WALK_STEP, moveData, spellFor,
  type OverdriveDef, type SpellDef,
} from './moves.ts';
import { makeBot } from './Bot.ts';

export interface RoomHooks {
  emitTo(addr: string, event: string, payload: unknown): void;
  emitAll(event: string, payload: unknown): void;
  /** Called exactly once when a winner is decided (sign + emit match_settled here). */
  settle(result: MatchResult): void;
  /** Room is finished or abandoned; remove it from routing. */
  closed(): void;
  /** Called when a client sends malformed or abusive input. */
  strike?(addr: string, reason: string): void;
}

interface Projectile {
  id: number; owner: number; x: number; y: number; vx: number; vy: number; gravity: number;
  framesLeft: number; state: 'ACTIVE' | 'DEAD';
  /** Remaining connections for multi-hit spells (Cap's Gale Slash). */
  hitsLeft: number;
  /** Tick before which this projectile may not connect again. */
  nextHit: number;
  /** Slot this crescent is riding after its first cut, so the follow-up always lands. */
  stuckTo: number | null;
  /** The caster's spell data, so each projectile keeps its own damage/block rules. */
  def: SpellDef | OverdriveDef;
}

interface Slot {
  addr: string; fighter: string; isBot: boolean; connected: boolean;
  s: PlayerState;
  queue: InputPayload[];
  held: number; prevHeld: number;
  /** Attack presses drained during hitstop, re-applied on the first simulated tick. */
  latch: number;
  buf: { bit: number; expire: number } | null;
  lastTap: { dir: -1 | 1; tick: number } | null;
  lastSeqSeen: number; ackSeq: number;
  rttMs: number;
  brain?: ReturnType<typeof makeBot>;
  grace?: ReturnType<typeof setTimeout>;
}

const FREE: ReadonlySet<FighterState> = new Set(['IDLE', 'WALK_FORWARD', 'WALK_BACKWARD', 'CROUCH', 'BLOCK']);
/** States that may start a new attack. JUMP is included so air normals can begin mid-air. */
const ACTIONABLE: ReadonlySet<FighterState> = new Set(['IDLE', 'WALK_FORWARD', 'WALK_BACKWARD', 'CROUCH', 'BLOCK', 'JUMP']);
const PRESS_BITS = [
  Action.LightPunch, Action.LightKick, Action.HeavyPunch, Action.HeavyKick,
  Action.Spell, Action.Overdrive, Action.Grab, Action.Dash,
];
const ATTACK_BITS = PRESS_BITS.reduce((a, b) => a | b, 0);
const MAX_QUEUE = 10;

/** Practice-room dummy behaviour. */
export type TrainingDummy = 'stand' | 'block' | 'jump' | 'jab' | 'walk';

const fresh = (x: number, facing: 1 | -1): PlayerState => ({
  x, y: 0, vy: 0, facing, state: 'IDLE', move: null, timer: 0, hp: START_HP,
  mana: START_MANA, overdrive: 0, guard: GUARD_MAX, guardAt: 0, parryUntil: 0, guarded: false,
  hasHit: false,
  crouching: false, kbVx: 0, kbFrames: 0, dashVx: 0, airAttackUsed: false, castFired: false,
  combo: 0, comboExpire: 0, cancelUntil: 0,
});

export class CombatRoom {
  phase: Phase = 'WAITING';
  tick = 0;
  round = 1;
  rounds: [number, number] = [0, 0];
  secondsLeft = ROUND_SECONDS;

  private slots: [Slot, Slot];
  private projectiles: Projectile[] = [];
  private projSeq = 0;
  private timerTicks = 0;
  private phaseTicks = 0;
  private hitstop = 0;
  private paused = false;
  private started = false;
  private settled = false;
  private history: HistoryEntry[][] = Array.from({ length: HISTORY_TICKS }, () => []);
  private loop?: ReturnType<typeof setInterval>;
  private acc = 0;
  private last = 0;

  readonly matchId: string;
  private hooks: RoomHooks;

  constructor(
    matchId: string, players: [string, string], hooks: RoomHooks,
    opts: {
      botIndex?: 0 | 1; botFighter?: string; difficulty?: BotDifficulty; dev?: boolean;
      /** Practice room: no timer, no rounds, infinite meter, a controllable dummy. */
      mode?: 'versus' | 'training' | 'ranked';
    } = {},
  ) {
    this.matchId = matchId; this.hooks = hooks;
    this.dev = !!opts.dev;
    this.training = opts.mode === 'training';
    this.difficulty = opts.difficulty ?? 'normal';
    this.slots = players.map((addr, i) => ({
      addr, fighter: 'ram', isBot: opts.botIndex === i, connected: opts.botIndex === i,
      s: fresh(i === 0 ? -SPAWN_X : SPAWN_X, i === 0 ? 1 : -1),
      queue: [], held: 0, prevHeld: 0, latch: 0, buf: null, lastTap: null,
      lastSeqSeen: 0, ackSeq: 0, rttMs: 60,
      brain: undefined,
    })) as unknown as [Slot, Slot];
    if (opts.botIndex !== undefined) {
      const bot = this.slots[opts.botIndex];
      bot.fighter = opts.botFighter ?? 'cap';
      bot.brain = makeBot(this.difficulty, spellFor(bot.fighter).manaCost ?? 50);
    }
  }
  readonly difficulty: BotDifficulty;
  readonly dev: boolean;
  readonly training: boolean;
  private dummy: TrainingDummy = 'stand';

  get players() { return this.slots.map((s) => s.addr) as [string, string]; }
  has(addr: string) { return this.slots.some((s) => s.addr === addr); }
  private idx(addr: string) { return this.slots.findIndex((s) => s.addr === addr); }

  /* ------------------------------ lifecycle ------------------------------ */

  markConnected(addr: string, fighter?: string) {
    const i = this.idx(addr); if (i < 0) return;
    const sl = this.slots[i];
    sl.connected = true;
    // A reconnect must not swap a fighter mid-match; the choice is locked once the bell rings.
    if (fighter && !this.started) sl.fighter = fighter;
    if (sl.grace) { clearTimeout(sl.grace); sl.grace = undefined; }

    if (this.slots.every((s) => s.connected)) {
      if (!this.started) { this.started = true; this.hooks.emitAll('match_start', this.startInfo()); this.beginRound(); this.run(); }
      else {
        this.paused = false;
        this.hooks.emitTo(addr, 'match_start', this.startInfo());
        this.hooks.emitAll('opponent_reconnected', {});
      }
    }
  }

  markDisconnected(addr: string) {
    const i = this.idx(addr); if (i < 0) return;
    const sl = this.slots[i];
    sl.connected = false; sl.queue.length = 0;
    if (!this.started || this.phase === 'COMPLETED') return;
    this.paused = true;                               // freeze the world; nobody loses HP to a dropped socket
    this.hooks.emitAll('opponent_disconnected', { graceMs: RECONNECT_GRACE_MS });
    sl.grace = setTimeout(() => this.forfeit(i), RECONNECT_GRACE_MS);
  }

  private forfeit(loser: number) {
    if (this.phase === 'COMPLETED') return;
    const winner = 1 - loser;
    if (!this.slots[winner].connected) { this.stop(); this.hooks.closed(); return; } // both gone: no settlement
    this.rounds[winner] = ROUNDS_TO_WIN;
    this.finish(winner, 'forfeit');
  }

  private startInfo() {
    return {
      matchId: this.matchId, players: this.players, fighters: this.slots.map((s) => s.fighter),
      roundsToWin: ROUNDS_TO_WIN, dev: this.dev, rounds: this.rounds, round: this.round,
      difficulty: this.difficulty, training: this.training,
    };
  }

  /** Drift-corrected fixed-timestep driver. Tests call step() directly instead. */
  private run() {
    this.last = performance.now();
    this.loop = setInterval(() => {
      const now = performance.now();
      this.acc = Math.min(this.acc + (now - this.last), 250); // cap catch-up to avoid a spiral of death
      this.last = now;
      while (this.acc >= TICK_MS) { this.acc -= TICK_MS; if (!this.paused) this.step(); }
    }, 4);
  }
  stop() { if (this.loop) clearInterval(this.loop); this.loop = undefined; this.slots.forEach((s) => s.grace && clearTimeout(s.grace)); }

  /** Bot matches can be paused by their human player; PvP is never paused by request. */
  setPaused(v: boolean): boolean {
    if (!this.slots.some((s) => s.isBot)) return false;
    this.paused = v;
    if (!v) this.slots.forEach((sl) => { sl.queue.length = 0; sl.buf = null; sl.prevHeld = 0; });
    return true;
  }

  /* ------------------------------- inputs -------------------------------- */

  /** Validates and queues an input. Returns false (and reports a strike) if it is malformed. */
  pushInput(addr: string, raw: unknown): boolean {
    const i = this.idx(addr); if (i < 0) return false;
    const sl = this.slots[i];
    const p = raw as Partial<InputPayload> | null;
    if (!p || !Number.isSafeInteger(p.seq) || !Number.isSafeInteger(p.tick) || !Number.isSafeInteger(p.actions)) {
      this.hooks.strike?.(addr, 'malformed input'); return false;
    }
    const { seq, tick } = p as InputPayload; let { actions } = p as InputPayload;
    if (seq <= sl.lastSeqSeen) return false;                      // replay / out-of-order
    if (seq - sl.lastSeqSeen > 600) { this.hooks.strike?.(addr, 'seq jump'); return false; }
    if (tick < 0 || actions < 0 || actions > ACTION_MASK) { this.hooks.strike?.(addr, 'out-of-range input'); return false; }
    sl.lastSeqSeen = seq;
    if ((actions & Action.Left) && (actions & Action.Right)) actions &= ~(Action.Left | Action.Right); // SOCD: cancel
    if ((actions & Action.Up) && (actions & Action.Down)) actions &= ~Action.Down;                    // up wins
    if (sl.queue.length >= MAX_QUEUE) {                           // overflow: fold the oldest into the next so no press is lost
      const old = sl.queue.shift()!; sl.queue[0].actions |= old.actions & ATTACK_BITS;
    }
    sl.queue.push({ seq, tick, actions });
    return true;
  }

  setRtt(addr: string, ms: number) {
    const i = this.idx(addr); if (i < 0 || !Number.isFinite(ms)) return;
    const sl = this.slots[i];
    sl.rttMs = 0.7 * sl.rttMs + 0.3 * Math.min(Math.max(ms, 0), 1000);
  }

  private nextActions(sl: Slot, me: PlayerState, foe: PlayerState): number {
    if (sl.isBot) return this.training ? this.dummyActions(me, foe) : sl.brain!(me, foe, this.tick);
    if (sl.queue.length > 4) {                                    // catch up after a stall; keep every attack press
      const dropped = sl.queue.splice(0, sl.queue.length - 2);
      const presses = dropped.reduce((a, d) => a | (d.actions & ATTACK_BITS), 0);
      sl.queue[0].actions |= presses;
    }
    const inp = sl.queue.shift();
    if (inp) { sl.held = inp.actions; sl.ackSeq = inp.seq; }      // no input this tick: keep holding the last state
    return sl.held;
  }

  /** Practice dummy: a predictable partner for labbing, not an opponent. */
  private dummyActions(me: PlayerState, foe: PlayerState): number {
    const toward = foe.x >= me.x ? Action.Right : Action.Left;
    switch (this.dummy) {
      case 'block': return Action.Block;
      case 'jump': return this.tick % 70 < 3 ? Action.Up : 0;
      case 'jab': return this.tick % 48 === 0 ? Action.LightPunch : 0;
      case 'walk': return Math.floor(this.tick / 90) % 2 === 0 ? toward : (toward === Action.Right ? Action.Left : Action.Right);
      default: return 0;
    }
  }

  /* ------------------------------ simulation ----------------------------- */

  step() {
    this.tick++;
    // The round clock runs on real ticks, hitstop included (freezing it used to stretch rounds).
    if (this.phase === 'FIGHTING' && !this.training) this.tickClock();
    if (this.hitstop > 0) {
      // Freeze the world, but keep the input queues drained: inputs pushed during hitstop used to
      // pile up and never drain, which left every later press arriving several frames late. Presses
      // that happen during the freeze are latched and replayed on the first simulated tick.
      for (const sl of this.slots) {
        while (sl.queue.length) {
          const inp = sl.queue.shift()!;
          sl.latch |= inp.actions & ATTACK_BITS;
          sl.held = inp.actions; sl.ackSeq = inp.seq;
        }
      }
      this.hitstop--; this.record(); return;                        // global hit freeze
    }

    const [a, b] = this.slots;
    const inputs: [number, number] = [this.nextActions(a, a.s, b.s), this.nextActions(b, b.s, a.s)];
    for (let i = 0; i < 2; i++) {
      const sl = this.slots[i];
      if (!sl.latch) continue;
      inputs[i] |= sl.latch;                                        // a press made during hitstop still counts
      sl.latch = 0;
    }

    if (this.phase === 'COUNTDOWN') {
      if (--this.phaseTicks <= 0) { this.phase = 'FIGHTING'; this.hooks.emitAll('round_start', this.roundInfo(true)); }
    } else if (this.phase === 'ROUND_END') {
      if (--this.phaseTicks <= 0) { this.round++; this.beginRound(); }
    } else if (this.phase === 'FIGHTING') {
      this.simulate(inputs);
    }
    this.slots.forEach((sl, i) => { sl.prevHeld = inputs[i]; });
    this.record();
    if (this.tick % SNAPSHOT_EVERY === 0) this.broadcastSnapshots();
  }

  private simulate(inputs: [number, number]) {
    this.slots.forEach((sl, i) => this.updatePlayer(i, inputs[i]));
    this.separate();
    this.updateProjectiles();
    this.resolveCombat();

    if (this.training) {
      // Practice room: no clock, no round end. Getting KO'd just refills you.
      for (const sl of this.slots) {
        if (sl.s.hp <= 0) { sl.s.hp = START_HP; sl.s.state = 'IDLE'; sl.s.timer = 0; sl.s.move = null; }
      }
      return;
    }

    const [h0, h1] = [this.slots[0].s.hp, this.slots[1].s.hp];
    if (h0 <= 0 || h1 <= 0) this.endRound(h0 <= 0 && h1 <= 0 ? null : h0 <= 0 ? 1 : 0, 'ko');
    else if (this.secondsLeft <= 0) this.endRound(h0 === h1 ? null : h0 > h1 ? 0 : 1, 'time');
  }

  private tickClock() {
    if (++this.timerTicks < TICK_RATE) return;
    this.timerTicks = 0; this.secondsLeft = Math.max(0, this.secondsLeft - 1);
    this.hooks.emitAll('timer', { secondsLeft: this.secondsLeft });
  }

  private updatePlayer(i: number, actions: number) {
    const sl = this.slots[i], s = sl.s, foe = this.slots[1 - i].s;

    // Was the fighter already guarding when this tick began? A perfect guard must be a fresh tap,
    // so holding (or mashing) block cannot re-open the parry window while already in guard.
    s.guarded = s.state === 'BLOCK' || s.state === 'BLOCKSTUN';

    s.mana = Math.min(MAX_MANA, s.mana + MANA_REGEN_PER_TICK);
    if (this.training) { s.mana = MAX_MANA; s.overdrive = OD_MAX; s.guard = GUARD_MAX; }
    if (s.combo > 0 && this.tick > s.comboExpire) s.combo = 0;

    // Guard meter: refills only after a short delay and never while guarding. An empty meter breaks.
    if (s.state !== 'BLOCK' && s.state !== 'BLOCKSTUN' && this.tick > s.guardAt + GUARD_REGEN_DELAY) {
      s.guard = Math.min(GUARD_MAX, s.guard + GUARD_REGEN_PER_TICK);
    }

    // Server-side 6-frame buffer: a press is remembered until the fighter is free to act.
    const pressed = actions & ~sl.prevHeld;
    for (const bit of PRESS_BITS) if (pressed & bit) sl.buf = { bit, expire: this.tick + INPUT_BUFFER_FRAMES };
    if (sl.buf && this.tick > sl.buf.expire) sl.buf = null;

    // Double-tap dash (Shift is the explicit button; this is the classic alternative).
    for (const [bit, dir] of [[Action.Left, -1], [Action.Right, 1]] as const) {
      if (!(pressed & bit)) continue;
      if (sl.lastTap && sl.lastTap.dir === dir && this.tick - sl.lastTap.tick <= DOUBLE_TAP_WINDOW && FREE.has(s.state) && s.y <= 0.05) {
        this.startDash(sl, dir);
        sl.lastTap = null;
      } else sl.lastTap = { dir, tick: this.tick };
    }

    if (s.kbFrames > 0) { s.x = this.clampX(s.x + s.kbVx); s.kbFrames--; }

    // Gravity applies whenever airborne — including mid-air attacks.
    if (s.y > 0 || s.vy > 0) {
      s.y += s.vy / TICK_RATE; s.vy -= GRAVITY / TICK_RATE;
      if (s.y <= 0) {
        const wasAirAttack = s.state.startsWith('ATTACK') && !!s.move && !!MOVES[s.move].air;
        s.y = 0; s.vy = 0; s.airAttackUsed = false;
        if (s.state === 'JUMP') s.state = 'IDLE';
        else if (wasAirAttack) { s.state = 'ATTACK_RECOVERY'; s.timer = Math.max(s.timer, 8); s.cancelUntil = 0; }
        this.hooks.emitAll('land', { playerId: sl.addr });
      }
    }

    // Timed states (frame-data state machine). Entering a state sets its timer; no decrement on the entry tick.
    switch (s.state) {
      case 'ATTACK_STARTUP':
        if (--s.timer <= 0) {
          const mv = moveData(s.move!, sl.fighter);
          s.state = 'ATTACK_ACTIVE'; s.timer = mv.active;
          const special = s.move === 'Spell' || s.move === 'Overdrive';
          if (special && !s.castFired) {
            s.castFired = true;
            this.hooks.emitAll('spell_cast', {
              playerId: sl.addr, x: s.x, facing: s.facing, spell: sl.fighter, ex: s.move === 'Overdrive',
            });
            if (mv.projectile) this.spawnProjectile(i, s, mv as SpellDef | OverdriveDef);
            else if (mv.beam) this.fireBeam(i, s, mv);
            // Some spells shove the caster (Prop's Cyclone recoils away from the vortex).
            if (mv.selfPush) s.x = this.clampX(s.x + s.facing * mv.selfPush);
          }
        }
        break;
      case 'ATTACK_ACTIVE':
        if (--s.timer <= 0) { s.state = 'ATTACK_RECOVERY'; s.timer = moveData(s.move!, sl.fighter).recovery; }
        break;
      case 'ATTACK_RECOVERY':
        if (--s.timer <= 0) { s.state = 'IDLE'; s.move = null; s.cancelUntil = 0; }
        break;
      case 'DASH':
        s.x = this.clampX(s.x + s.dashVx);
        if (--s.timer <= 0) { s.state = 'IDLE'; s.dashVx = 0; }
        break;
      case 'HITSTUN': case 'BLOCKSTUN': case 'KNOCKDOWN':
        if (--s.timer <= 0) { s.state = 'IDLE'; s.combo = 0; }
        break;
      case 'GUARD_BREAK':
        // Punish window: no guard, no inputs. A share of the meter comes back so you are not stuck at 0.
        if (--s.timer <= 0) { s.state = 'IDLE'; s.combo = 0; s.guard = Math.round(GUARD_MAX * GUARD_BREAK_RECOVER); }
        break;
    }

    if (s.hp <= 0) return;

    // Recovery cancels: a normal that connected can be cancelled into a follow-up inside the window.
    if (s.state === 'ATTACK_RECOVERY' && sl.buf && this.tick <= s.cancelUntil && this.canCancel(s, sl.buf.bit)) {
      if (this.tryStartMove(sl, s, actions)) return;
    }

    const dashCancel = s.state === 'DASH' && DASH_FRAMES - s.timer >= DASH_CANCEL_FRAME;
    if (ACTIONABLE.has(s.state) || dashCancel) {
      if (this.tryStartMove(sl, s, actions)) return;
    }

    if (!FREE.has(s.state)) return;

    // Airborne fighters keep their momentum: no mid-air walking, blocking or double jumps.
    if (s.y > 0.05) { s.crouching = false; return; }

    s.facing = foe.x >= s.x ? 1 : -1;
    s.crouching = false;

    if (pressed & Action.Dash) { this.startDash(sl, ((actions & Action.Right) ? 1 : (actions & Action.Left) ? -1 : s.facing) as -1 | 1); return; }

    if (actions & Action.Block) {
      // A fresh tap while *not already* guarding arms a 3-frame parry window; held block does not.
      if ((pressed & Action.Block) && !s.guarded) s.parryUntil = this.tick + PERFECT_GUARD_FRAMES;
      s.state = 'BLOCK'; s.crouching = !!(actions & Action.Down); return;
    }
    if (actions & Action.Up) { s.state = 'JUMP'; s.vy = JUMP_VY; s.y = 0.0001; s.airAttackUsed = false; return; }
    if (actions & Action.Down) { s.state = 'CROUCH'; s.crouching = true; return; }

    const dir = ((actions & Action.Right) ? 1 : 0) - ((actions & Action.Left) ? 1 : 0);
    if (dir === 0) { s.state = 'IDLE'; return; }
    const forward = dir === s.facing;
    s.state = forward ? 'WALK_FORWARD' : 'WALK_BACKWARD';
    this.move(sl, dir * (forward ? WALK_STEP : BACK_STEP));
  }

  /** Resolve a buffered button into a concrete move and start it. */
  private tryStartMove(sl: Slot, s: PlayerState, actions: number): boolean {
    if (!sl.buf) return false;
    const bit = sl.buf.bit;
    const airborne = s.y > 0.05;
    let move: MoveId | null = null;
    if (bit === Action.Spell) move = 'Spell';
    else if (bit === Action.Overdrive) move = 'Overdrive';
    else if (bit === Action.Grab) move = 'Grab';
    else if (bit === Action.HeavyPunch) move = 'HeavyPunch';
    else if (bit === Action.HeavyKick) move = (actions & Action.Down) ? 'Sweep' : 'HeavyKick';
    else if (bit === Action.LightPunch) move = airborne ? 'AirPunch' : 'LightPunch';
    else if (bit === Action.LightKick) move = airborne ? 'AirKick' : 'LightKick';
    if (!move) return false;

    const mv = moveData(move, sl.fighter);
    if (!!mv.air !== airborne) return false;                     // air moves only in the air, ground moves only on the ground
    if (airborne && s.airAttackUsed) return false;               // one air normal per jump
    if (mv.grab && !FREE.has(s.state) && s.state !== 'ATTACK_RECOVERY') return false;
    if (mv.manaCost && s.mana < mv.manaCost) {
      sl.buf = null;
      this.hooks.emitTo(sl.addr, 'no_mana', { need: mv.manaCost, have: Math.floor(s.mana) });
      return false;
    }
    if (move === 'Overdrive') {
      // The EX spell spends the whole Overdrive bar instead of mana.
      if (s.overdrive < OD_COST) {
        sl.buf = null;
        this.hooks.emitTo(sl.addr, 'no_overdrive', { need: OD_COST, have: Math.floor(s.overdrive) });
        return false;
      }
      s.overdrive = 0;
    }
    if (mv.manaCost) s.mana = Math.max(0, s.mana - mv.manaCost);
    if (mv.air) s.airAttackUsed = true;

    s.move = move; s.state = 'ATTACK_STARTUP'; s.timer = mv.startup;
    s.hasHit = false; s.castFired = false; s.cancelUntil = 0;
    s.crouching = !airborne && !!(actions & Action.Down);
    s.dashVx = 0;
    sl.buf = null;
    this.hooks.emitAll('move_start', { playerId: sl.addr, move });
    return true;
  }

  /** Light normals gatling into each other and into heavies; anything that hit can cancel into a special. */
  private canCancel(s: PlayerState, bit: number): boolean {
    if (bit === Action.Spell || bit === Action.Overdrive) return true;
    if (s.move === 'LightPunch') {
      return bit === Action.LightKick || bit === Action.HeavyPunch || bit === Action.HeavyKick;
    }
    if (s.move === 'LightKick') {
      return bit === Action.LightPunch || bit === Action.HeavyPunch || bit === Action.HeavyKick;
    }
    return false;
  }

  private startDash(sl: Slot, dir: -1 | 1) {
    const s = sl.s;
    if (s.y > 0.05 || !FREE.has(s.state)) return;
    s.state = 'DASH'; s.timer = DASH_FRAMES; s.dashVx = dir * DASH_STEP;
    s.crouching = false;
    this.hooks.emitAll('dash', { playerId: sl.addr, dir });
  }

  /** All voluntary movement flows through here: velocity sanity check + arena clamp. */
  private move(sl: Slot, dx: number) {
    if (Math.abs(dx) > MAX_STEP) { this.hooks.strike?.(sl.addr, 'velocity'); dx = Math.sign(dx) * MAX_STEP; }
    sl.s.x = this.clampX(sl.s.x + dx);
  }
  private clampX(x: number) { return Math.min(ARENA_HALF, Math.max(-ARENA_HALF, x)); }

  /** Push boxes: grounded fighters cannot overlap. Jumping fighters pass over. */
  private separate() {
    const [a, b] = [this.slots[0].s, this.slots[1].s];
    if (a.y > 0.3 || b.y > 0.3) return;
    const dx = b.x - a.x, gap = Math.abs(dx);
    if (gap >= PUSH_DIST) return;
    const dir = dx === 0 ? 1 : Math.sign(dx), push = (PUSH_DIST - gap) / 2;
    a.x = this.clampX(a.x - dir * push); b.x = this.clampX(b.x + dir * push);
    const left = b.x - a.x;                                       // if a wall ate part of the push, re-apply to the other
    if (Math.abs(left) < PUSH_DIST) { if (a.x <= -ARENA_HALF) b.x = a.x + PUSH_DIST; else if (b.x >= ARENA_HALF) a.x = b.x - PUSH_DIST; }
  }

  /* ----------------------------- projectiles ----------------------------- */

  private spawnProjectile(i: number, s: PlayerState, mv: SpellDef | OverdriveDef) {
    const p = mv.projectile!;
    const live = this.projectiles.filter((pr) => pr.owner === i && pr.state === 'ACTIVE').length;
    if (live >= MAX_PROJECTILES_PER_PLAYER) return;
    this.projectiles.push({
      id: ++this.projSeq, owner: i,
      x: this.clampX(s.x + s.facing * 0.7), y: s.y + p.y,
      vx: s.facing * p.speed, vy: p.vy ?? 0, gravity: p.gravity ?? 0,
      framesLeft: p.lifetime, state: 'ACTIVE',
      hitsLeft: Math.max(1, p.hits ?? 1), nextHit: 0, stuckTo: null, def: mv,
    });
  }

  /** Hitscan beam: resolves once on the first active frame, along the caster's facing. */
  private fireBeam(i: number, s: PlayerState, mv: FrameData) {
    const beam = mv.beam!;
    const A = this.slots[i], d = 1 - i, D = this.slots[d];
    if (D.s.state === 'KNOCKDOWN' || D.s.hp <= 0) return;
    const x0 = s.x + s.facing * 0.45;
    const x1 = x0 + s.facing * beam.length;
    const box: BoundingBox = {
      min: { x: Math.min(x0, x1), y: s.y + beam.y - beam.halfH, z: -BODY.halfD },
      max: { x: Math.max(x0, x1), y: s.y + beam.y + beam.halfH, z: BODY.halfD },
    };
    if (!CombatRoom.overlap(box, this.rewound(A, D))) return;
    this.applyHit(i, d, 'Spell', 'torso', mv);
  }

  private updateProjectiles() {
    for (const pr of this.projectiles) {
      if (pr.state !== 'ACTIVE') continue;
      if (pr.stuckTo !== null) {
        // A multi-hit crescent rides its target so the follow-up cut cannot whiff on pushback.
        const tgt = this.slots[pr.stuckTo].s;
        pr.x = tgt.x; pr.y = Math.min(Math.max(tgt.y + 1.0, 0.45), 1.45);
      } else {
        pr.x += pr.vx / TICK_RATE;
        if (pr.gravity || pr.vy) {
          pr.y += pr.vy / TICK_RATE;
          pr.vy -= pr.gravity / TICK_RATE;
          if (pr.y <= 0.05) pr.state = 'DEAD';               // arcing shots splash on the floor
        }
      }
      if (--pr.framesLeft <= 0 || Math.abs(pr.x) > ARENA_HALF + 1.5) pr.state = 'DEAD';
    }
    // Projectile vs projectile: both pop, no damage. Y overlap matters for arcing shots.
    for (let a = 0; a < this.projectiles.length; a++) {
      const A = this.projectiles[a]; if (A.state !== 'ACTIVE') continue;
      const pa = A.def.projectile!;
      for (let b = a + 1; b < this.projectiles.length; b++) {
        const B = this.projectiles[b]; if (B.state !== 'ACTIVE' || B.owner === A.owner) continue;
        const pb = B.def.projectile!;
        const clashX = Math.max(PROJECTILE_CLASH_RADIUS * 2, pa.halfW + pb.halfW);
        const clashY = pa.halfH + pb.halfH + 0.2;
        if (Math.abs(A.x - B.x) < clashX && Math.abs(A.y - B.y) < clashY) {
          A.state = 'DEAD'; B.state = 'DEAD';
          this.hitstop = Math.max(this.hitstop, 3);
          this.hooks.emitAll('spell_clash', { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 });
        }
      }
    }
    // Projectile vs hurtbox.
    for (const pr of this.projectiles) {
      if (pr.state !== 'ACTIVE' || this.tick < pr.nextHit) continue;
      const d = 1 - pr.owner, D = this.slots[d];
      if (D.s.state === 'KNOCKDOWN' || D.s.hp <= 0) continue;
      const p = pr.def.projectile!;
      const box: BoundingBox = {
        min: { x: pr.x - p.halfW, y: pr.y - p.halfH, z: -BODY.halfD },
        max: { x: pr.x + p.halfW, y: pr.y + p.halfH, z: BODY.halfD },
      };
      if (!CombatRoom.overlap(box, this.hurtboxOf(D.s.x, D.s.y, D.s.crouching))) continue;
      // Multi-hit spells (Cap's Gale Slash) keep cutting: the crescent sticks to the target for a
      // frame or two and connects again instead of flying straight through it.
      pr.hitsLeft--;
      if (pr.hitsLeft > 0) {
        pr.stuckTo = d;
        pr.nextHit = this.tick + (p.hitGap ?? 8);
        pr.framesLeft = Math.max(pr.framesLeft, (p.hitGap ?? 8) + 2);
      } else pr.state = 'DEAD';
      this.applyHit(pr.owner, d, 'Spell', 'torso', pr.def);
    }
    this.projectiles = this.projectiles.filter((p) => p.state === 'ACTIVE');
  }

  /* ----------------------- hit detection / lag comp ---------------------- */

  private hurtboxOf(x: number, y: number, crouching: boolean): BoundingBox {
    const h = crouching ? BODY.crouchH : BODY.standH;
    return { min: { x: x - BODY.halfW, y, z: -BODY.halfD }, max: { x: x + BODY.halfW, y: y + h, z: BODY.halfD } };
  }
  private hitboxOf(p: PlayerState, fighter: string): BoundingBox {
    const hb = moveData(p.move!, fighter).hitbox;
    const x0 = p.x + p.facing * hb.startOffset, x1 = p.x + p.facing * (hb.startOffset + hb.reach);
    return { min: { x: Math.min(x0, x1), y: p.y + hb.yMin, z: -hb.halfDepth }, max: { x: Math.max(x0, x1), y: p.y + hb.yMax, z: hb.halfDepth } };
  }
  private static overlap(a: BoundingBox, b: BoundingBox) {
    return a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y && a.min.z <= b.max.z && a.max.z >= b.min.z;
  }

  /** Defender's body as the attacker saw it: rewound by RTT/2, clamped to 150 ms. */
  private rewound(attacker: Slot, defender: Slot): BoundingBox {
    const ticks = Math.round(Math.min(attacker.rttMs / 2, MAX_RTT_COMP_MS) / TICK_MS);
    const target = this.tick - ticks;
    const h = ticks > 0 ? this.history[target % HISTORY_TICKS]?.[this.slots.indexOf(defender)] : undefined;
    const d = h && h.tick === target ? h : defender.s;
    return this.hurtboxOf(d.x, d.y, d.crouching);
  }

  /**
   * Guard is universal: any strike, projectile or beam is stopped dead while guarding (zero damage).
   * Only grabs ignore guard. Guard is kept honest by the guard meter, which breaks under pressure.
   */
  private isBlocked(D: PlayerState, mv: FrameData): boolean {
    if (D.state !== 'BLOCK' && D.state !== 'BLOCKSTUN') return false;
    return !mv.grab;
  }

  private moveKey(sl: Slot): string {
    const m = sl.s.move;
    return m === 'Spell' || m === 'Overdrive' ? `${m}:${sl.fighter}` : (m ?? '');
  }

  private resolveCombat() {
    const hits: { a: number; d: number; move: MoveId; region: 'head' | 'torso' | 'legs' }[] = [];
    for (let a = 0; a < 2; a++) {
      const A = this.slots[a], As = A.s, d = 1 - a, D = this.slots[d];
      if (As.state !== 'ATTACK_ACTIVE' || As.hasHit || D.s.state === 'KNOCKDOWN') continue;
      const mv = moveData(As.move!, A.fighter);
      if (mv.projectile || mv.beam) continue;                      // resolved on the cast frame
      const hb = this.hitboxOf(As, A.fighter);
      if (!CombatRoom.overlap(hb, this.rewound(A, D))) continue;
      const cy = (hb.min.y + hb.max.y) / 2 - D.s.y;
      hits.push({ a, d, move: As.move!, region: cy > 1.2 ? 'head' : cy > 0.6 ? 'torso' : 'legs' });
    }
    if (hits.length === 2) {
      // Two grabs that meet are a tech, not a clash: nobody wins the exchange.
      if (MOVES[hits[0].move]?.grab && MOVES[hits[1].move]?.grab) { this.resolveThrowTech(); return; }
      if (this.moveKey(this.slots[0]) === this.moveKey(this.slots[1])) {
        // Clash: identical moves on the same tick cancel out. No damage, both pushed apart.
        for (const sl of this.slots) { sl.s.hasHit = true; sl.s.kbVx = -sl.s.facing * 0.05; sl.s.kbFrames = 8; }
        this.hitstop = 4; this.hooks.emitAll('clash', {}); return;
      }
    }
    for (const h of hits) this.applyHit(h.a, h.d, h.move, h.region);     // different moves: both land (trade)
  }

  /** Both fighters grabbed into each other: separate them, no damage, a beat of hitstop. */
  private resolveThrowTech() {
    const [A, D] = this.slots;
    for (const sl of [A, D]) {
      sl.s.state = 'IDLE'; sl.s.move = null; sl.s.timer = 0;
      sl.s.hasHit = false; sl.s.combo = 0; sl.s.crouching = false;
      sl.s.kbVx = 0; sl.s.kbFrames = 0;
    }
    A.s.x = this.clampX(A.s.x - A.s.facing * 0.45);
    D.s.x = this.clampX(D.s.x + D.s.facing * 0.45);
    this.hitstop = Math.max(this.hitstop, 6);
    this.hooks.emitAll('throw_tech', { x: (A.s.x + D.s.x) / 2, y: D.s.y + 1.0 });
  }

  private applyHit(a: number, d: number, move: MoveId, region: string, override?: FrameData) {
    const A = this.slots[a], D = this.slots[d], mv = override ?? moveData(move, A.fighter);
    A.s.hasHit = true;
    const away = A.s.facing;

    // Throw tech: two grabs that meet on the same tick cancel each other out.
    if (mv.grab && D.s.move === 'Grab' && (D.s.state === 'ATTACK_STARTUP' || D.s.state === 'ATTACK_ACTIVE')) {
      for (const sl of [A, D]) {
        sl.s.state = 'IDLE'; sl.s.move = null; sl.s.timer = 0;
        sl.s.hasHit = false; sl.s.combo = 0; sl.s.crouching = false;
      }
      A.s.x = this.clampX(A.s.x - A.s.facing * 0.45);
      D.s.x = this.clampX(D.s.x + D.s.facing * 0.45);
      A.s.kbVx = 0; A.s.kbFrames = 0; D.s.kbVx = 0; D.s.kbFrames = 0;
      this.hitstop = Math.max(this.hitstop, 6);
      this.hooks.emitAll('throw_tech', { x: (A.s.x + D.s.x) / 2, y: D.s.y + 1.0 });
      return;
    }

    const blocked = this.isBlocked(D.s, mv);

    if (blocked) {
      // Perfect guard: a fresh tap timed into the hit negates the guard cost, refunds the defender's
      // blockstun entirely (so they can punish the recovery) and builds Overdrive.
      const perfect = this.tick <= D.s.parryUntil;
      if (perfect) {
        D.s.parryUntil = 0;
        D.s.guard = Math.min(GUARD_MAX, D.s.guard + 4);
        D.s.overdrive = Math.min(OD_MAX, D.s.overdrive + OD_ON_PERFECT);
        D.s.state = 'IDLE'; D.s.timer = 0; D.s.move = null; D.s.hasHit = false;
        D.s.kbVx = 0; D.s.kbFrames = 0;
        A.s.cancelUntil = 0;                       // you cannot cancel your way out of a perfect guard
        this.hitstop = Math.max(this.hitstop, 6);
        this.hooks.emitAll('perfect_guard', {
          attackerId: A.addr, defenderId: D.addr, guard: Math.round(D.s.guard),
          x: D.s.x, y: D.s.y + 1.0,
        });
        return;
      }

      // Guard: zero damage. The guard meter absorbs the pressure instead, and can break.
      D.s.guard = Math.max(0, D.s.guard - Math.max(1, Math.round(mv.guardDamage ?? mv.damage)));
      D.s.guardAt = this.tick;
      D.s.kbVx = away * (mv.knockback * 0.5 / 8); D.s.kbFrames = 8;
      D.s.mana = Math.min(MAX_MANA, D.s.mana + MANA_ON_BLOCK);
      D.s.overdrive = Math.min(OD_MAX, D.s.overdrive + OD_ON_BLOCK);
      A.s.mana = Math.min(MAX_MANA, A.s.mana + MANA_ON_BLOCK);
      A.s.overdrive = Math.min(OD_MAX, A.s.overdrive + OD_ON_BLOCK);
      A.s.cancelUntil = this.tick + CANCEL_WINDOW;

      if (D.s.guard <= 0) {
        // Guard break: the shield is gone and the defender is wide open. No damage this hit.
        D.s.state = 'GUARD_BREAK'; D.s.timer = GUARD_BREAK_FRAMES;
        D.s.move = null; D.s.hasHit = false; D.s.crouching = false;
        D.s.guard = 0;
        D.s.overdrive = Math.min(OD_MAX, D.s.overdrive + OD_ON_GUARD_BREAK);
        this.hitstop = Math.max(this.hitstop, 8);
        this.hooks.emitAll('guard_break', {
          attackerId: A.addr, defenderId: D.addr, x: D.s.x, y: D.s.y + 1.0,
        });
        return;
      }

      D.s.state = 'BLOCKSTUN'; D.s.timer = mv.blockstun;
      this.hitstop = Math.max(this.hitstop, 2);
      this.hooks.emitAll('block_confirmed', {
        attackerId: A.addr, defenderId: D.addr, chip: 0, guard: Math.round(D.s.guard),
        blockstunFrames: mv.blockstun, x: D.s.x, y: D.s.y + 1.0,
      });
      return;
    }

    // Damage scaling: combos reward you but cannot delete a round.
    const scale = COMBO_SCALE[Math.min(A.s.combo, COMBO_SCALE.length - 1)];
    const damage = Math.max(1, Math.round(mv.damage * scale));
    A.s.combo += 1;
    A.s.comboExpire = this.tick + COMBO_TIMEOUT;

    // Super armour: the defender keeps attacking through the hit but still takes damage.
    const defMove = D.s.move ? moveData(D.s.move, D.fighter) : null;
    const armored = !!defMove?.armor && !mv.grab &&
      (D.s.state === 'ATTACK_STARTUP' || D.s.state === 'ATTACK_ACTIVE');

    D.s.hp = Math.max(0, D.s.hp - damage);
    A.s.overdrive = Math.min(OD_MAX, A.s.overdrive + OD_ON_HIT * damage);
    D.s.overdrive = Math.min(OD_MAX, D.s.overdrive + OD_ON_TAKE * damage);
    if (armored && D.s.hp > 0) {
      D.s.crouching = false;                            // stay in the current attack state
    } else {
      D.s.move = null; D.s.hasHit = false; D.s.crouching = false;
      D.s.combo = 0;                                   // getting hit drops your own streak
      if (D.s.hp <= 0) { D.s.state = 'KNOCKDOWN'; D.s.timer = 60; }
      else if (mv.knockdown) { D.s.state = 'KNOCKDOWN'; D.s.timer = 40; }
      else { D.s.state = 'HITSTUN'; D.s.timer = mv.hitstun; }
      D.s.kbVx = away * (mv.knockback / 8); D.s.kbFrames = 8;
    }
    A.s.mana = Math.min(MAX_MANA, A.s.mana + MANA_ON_HIT);
    A.s.cancelUntil = this.tick + CANCEL_WINDOW;
    this.hitstop = Math.max(this.hitstop, mv.hitstop);
    this.hooks.emitAll('hit_confirmed', {
      attackerId: A.addr, defenderId: D.addr, damage, hurt: region,
      knockback: mv.knockback, hitstunFrames: mv.hitstun, move, armored,
      combo: A.s.combo, x: D.s.x, y: D.s.y + (region === 'head' ? 1.45 : region === 'torso' ? 1.0 : 0.45),
      knockdown: D.s.state === 'KNOCKDOWN',
    });
  }

  private record() {
    this.history[this.tick % HISTORY_TICKS] = this.slots.map((sl) => ({
      tick: this.tick, x: sl.s.x, y: sl.s.y, crouching: sl.s.crouching,
    }));
  }

  /* ---------------------------- rounds & result --------------------------- */

  private roundInfo(fight = false) {
    return { round: this.round, p1Rounds: this.rounds[0], p2Rounds: this.rounds[1], fight };
  }

  private beginRound() {
    this.slots.forEach((sl, i) => {
      sl.s = fresh(i === 0 ? -SPAWN_X : SPAWN_X, i === 0 ? 1 : -1);
      sl.buf = null; sl.lastTap = null; sl.queue.length = 0; sl.held = 0; sl.prevHeld = 0;
    });
    this.projectiles = [];
    this.secondsLeft = ROUND_SECONDS; this.timerTicks = 0; this.hitstop = 0;
    this.phase = 'COUNTDOWN';
    this.phaseTicks = this.training ? 1 : COUNTDOWN_TICKS;     // the practice room skips the countdown
    this.hooks.emitAll('round_start', this.roundInfo(false));
    this.hooks.emitAll('timer', { secondsLeft: this.secondsLeft });
  }

  /* ------------------------------ training ------------------------------- */

  setTrainingDummy(dummy: TrainingDummy) {
    if (this.training) this.dummy = dummy;
  }

  /** Snap both fighters back to spawn with full resources (practice room reset). */
  trainingReset() {
    if (!this.training) return;
    this.slots.forEach((sl, i) => {
      sl.s = fresh(i === 0 ? -SPAWN_X : SPAWN_X, i === 0 ? 1 : -1);
      sl.buf = null; sl.lastTap = null; sl.queue.length = 0; sl.held = 0; sl.prevHeld = 0;
    });
    this.projectiles = [];
    this.hitstop = 0;
    this.phase = 'FIGHTING';
    this.hooks.emitAll('training_reset', {});
  }

  /** winner === null is a draw: nobody scores and the round is replayed. */
  private endRound(winner: 0 | 1 | null, reason: 'ko' | 'time') {
    if (winner !== null) this.rounds[winner]++;
    this.hooks.emitAll('round_over', {
      winnerId: winner === null ? null : this.slots[winner].addr, reason,
      p1Rounds: this.rounds[0], p2Rounds: this.rounds[1],
    });
    if (winner !== null && this.rounds[winner] >= ROUNDS_TO_WIN) { this.finish(winner, reason); return; }
    if (winner === null) this.round--;                            // replayed round keeps its number
    this.phase = 'ROUND_END'; this.phaseTicks = ROUND_END_TICKS;
  }

  private finish(winner: number, reason: MatchResult['reason']) {
    if (this.settled) return;
    this.settled = true; this.phase = 'COMPLETED';
    this.broadcastSnapshots();
    this.stop();
    this.hooks.settle({ matchId: this.matchId, winner: this.slots[winner].addr, p1Rounds: this.rounds[0], p2Rounds: this.rounds[1], reason });
    this.hooks.closed();
  }

  private broadcastSnapshots() {
    const players: Snapshot['players'] = {};
    for (const sl of this.slots) {
      const s = sl.s;
      players[sl.addr] = {
        x: +s.x.toFixed(3), y: +s.y.toFixed(3), facing: s.facing, state: s.state,
        move: s.move, hp: s.hp, mana: Math.floor(s.mana), guard: Math.round(s.guard),
        overdrive: Math.round(s.overdrive),
      };
    }
    const projectiles = this.projectiles.map((p) => ({ id: p.id, owner: p.owner, x: +p.x.toFixed(3), y: +p.y.toFixed(3) }));
    for (const sl of this.slots) {
      if (sl.isBot || !sl.connected) continue;
      const snap: Snapshot = { tick: this.tick, ackSeq: sl.ackSeq, phase: this.phase, round: this.round, players, projectiles };
      this.hooks.emitTo(sl.addr, 'snapshot', snap);
    }
  }

  /* test helpers */
  get state() { return this.slots.map((s) => s.s) as [PlayerState, PlayerState]; }
  get liveProjectiles() { return this.projectiles.map((p) => ({ ...p })); }
}
