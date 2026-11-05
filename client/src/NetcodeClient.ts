import * as THREE from 'three';
import { Action } from './InputManager';
import { FIGHT, type BotDifficulty, type MoveName } from './moves';
import { WSSocket, type GameSocket } from './transport';

/* ---------- Wire protocol (matches server/src/server.ts + CombatRoom.ts) ----------
 * s->c 'auth_challenge' {message,dev}   c->s 'auth' {address,signature?,matchId,fighter,bot}
 * s->c 'auth_ok' {address,waiting?} | 'auth_error' {reason} | 'verifying_escrow'
 * s->c 'match_start' {players,fighters,rounds,round,roundsToWin,dev}
 * s->c 'round_start' {round,p1Rounds,p2Rounds,fight} | 'timer' | 'round_over' | 'match_settled'
 * c->s 'input' {seq,tick,actions}   s->c 'snapshot' {tick,ackSeq,phase,round,players,projectiles}
 * s->c 'hit_confirmed' | 'block_confirmed' | 'clash' | 'move_start' | 'spell_cast' | 'spell_clash'
 * s->c 'dash' | 'land' | 'no_mana' | 'opponent_disconnected' | 'opponent_reconnected'
 * s->c 'rtt' (t0, ack) — client must ack immediately so the server can measure RTT for lag compensation.
 */
export interface InputPacket { seq: number; tick: number; actions: number }
export interface PlayerSnap { x: number; y: number; facing: 1 | -1; state: string; move: MoveName | null; hp: number; mana: number; guard: number; overdrive: number }
export interface ProjectileSnap { id: number; owner: number; x: number; y: number }
export interface Snapshot { tick: number; ackSeq: number; phase: string; round: number; players: Record<string, PlayerSnap>; projectiles: ProjectileSnap[] }
export interface HitEvent {
  attackerId: string; defenderId: string; damage: number; hurt: string; knockback: number;
  hitstunFrames: number; move: MoveName; combo: number; x: number; y: number; knockdown: boolean;
  armored?: boolean;
}
export interface BlockEvent { attackerId: string; defenderId: string; chip: number; guard: number; blockstunFrames: number; x: number; y: number }
export interface GuardBreakEvent { attackerId: string; defenderId: string; x: number; y: number }
export interface PerfectGuardEvent { attackerId: string; defenderId: string; guard: number; x: number; y: number }

/** Ranked ladder rows, mirrored from server/src/rating.ts + db.ts. */
export interface RankedSide {
  handle: string; avatar: string | null;
  ratingBefore: number; ratingAfter: number; ratingDelta: number;
  pointsBefore: number; pointsAfter: number; pointsDelta: number;
  streak: number; wins: number; losses: number; rank: number; tier: string;
}
export interface RankedPayload {
  cancelled?: boolean;
  winnerPid?: string;
  sides?: Record<string, RankedSide>;
}
export interface MatchSettled {
  matchId: string; winner: string; p1Rounds: number; p2Rounds: number;
  deadline: number; signature: string; dev: boolean; reason: string;
  ranked?: RankedPayload | null;
}
export interface QueueMatched {
  matchId: string; fighter: string;
  opponent: { handle: string; points: number; tier: string; rating: number };
}
export interface QueueState { size: number; waitedMs: number }
export interface LeaderboardEntry {
  rank: number; pid: string; handle: string; avatar: string | null;
  points: number; rating: number; wins: number; losses: number; streak: number; tier: string;
}
export interface PlayerProfile {
  pid: string; handle: string; avatar: string | null;
  points: number; rating: number; wins: number; losses: number; streak: number;
  rank: number; tier: string;
}
export interface MatchStart {
  matchId: string; players: [string, string]; fighters: [string, string];
  rounds: [number, number]; round: number; roundsToWin: number; dev: boolean;
  difficulty?: BotDifficulty;
  /** Practice room: no clock, no rounds, a controllable dummy. */
  training?: boolean;
}

export interface NetHandlers {
  onMatchStart?: (e: MatchStart) => void;
  onSnapshot?: (s: Snapshot) => void;
  onHit?: (e: HitEvent) => void;
  onBlock?: (e: BlockEvent) => void;
  onGuardBreak?: (e: GuardBreakEvent) => void;
  onPerfectGuard?: (e: PerfectGuardEvent) => void;
  onThrowTech?: (e: { x: number; y: number }) => void;
  onClash?: () => void;
  onMoveStart?: (e: { playerId: string; move: MoveName }) => void;
  onSpellCast?: (e: { playerId: string; x: number; facing: 1 | -1; spell?: string; ex?: boolean }) => void;
  onSpellClash?: (e: { x: number; y: number }) => void;
  onDash?: (e: { playerId: string; dir: -1 | 1 }) => void;
  onLand?: (e: { playerId: string }) => void;
  onNoMana?: (e: { need: number; have: number }) => void;
  onNoOverdrive?: (e: { need: number; have: number }) => void;
  onRoundStart?: (e: { round: number; p1Rounds: number; p2Rounds: number; fight: boolean }) => void;
  onRoundOver?: (e: { winnerId: string | null; reason: string; p1Rounds: number; p2Rounds: number }) => void;
  onTimer?: (secondsLeft: number) => void;
  onSettled?: (e: MatchSettled) => void;
  /* ---- ranked queue / ladder ---- */
  onQueueJoined?: (e: { waitedMs: number; size: number }) => void;
  onQueueState?: (e: QueueState) => void;
  onQueueMatched?: (e: QueueMatched) => void;
  onQueueTimeout?: (e: { waitedMs: number }) => void;
  onQueueError?: (e: { reason: string }) => void;
  onQueueLeft?: () => void;
  onProfile?: (p: PlayerProfile) => void;
  onLeaderboard?: (e: { players: LeaderboardEntry[]; total: number }) => void;
  onStatus?: (text: string) => void;
}

export interface ConnectOptions {
  url: string; matchId: string; fighter: string; bot: boolean;
  /** Practice room: no clock, no rounds, a controllable dummy. */
  training?: boolean;
  /** Signed session token from /auth/x (ranked ladder identity). */
  session?: string;
  /** Hold the socket in the matchmaking queue instead of routing straight into a room. */
  queue?: boolean;
  /** Practice-bot skill tier (ignored for human matches). */
  difficulty?: BotDifficulty;
  /** Wallet login (production). Omit for dev guests. */
  wallet?: (message: string) => Promise<{ address: string; signature: string }>;
}

/** Anything that changes the server's movement state locks predicted walking. */
const LOCK_MASK =
  Action.LightPunch | Action.LightKick | Action.HeavyPunch | Action.HeavyKick |
  Action.Block | Action.Spell | Action.Overdrive | Action.Grab | Action.Dash | Action.Up | Action.Down;

/** Deterministic movement shared by prediction and replay. Must mirror the server's integrator. */
export function stepMovement(x: number, actions: number, facing: 1 | -1, dt = 1 / 60): number {
  if (actions & LOCK_MASK) return x;
  const dir = ((actions & Action.Right) ? 1 : 0) - ((actions & Action.Left) ? 1 : 0);
  if (!dir) return x;
  const speed = FIGHT.walkSpeed * (dir === facing ? 1 : FIGHT.walkBackMul);
  return THREE.MathUtils.clamp(x + dir * speed * dt, -FIGHT.arenaHalf, FIGHT.arenaHalf);
}

export class NetcodeClient {
  socket: GameSocket = null!;
  /** True on the Cloudflare build (native WebSocket); false in dev (socket.io). */
  wsMode = false;
  playerId = '';
  phase = 'WAITING';
  /** Predicted local position (x). y comes from the server (jumps are not predicted). */
  readonly localPos = new THREE.Vector3(-FIGHT.spawnX, 0, 0);
  readonly remoteTarget = new THREE.Vector3(FIGHT.spawnX, 0, 0);
  readonly localServer = { y: 0, state: 'IDLE', hp: 100, mana: 30, guard: 100, overdrive: 0, move: null as MoveName | null };
  readonly remoteState = { state: 'IDLE', facing: -1 as 1 | -1, hp: 100, mana: 30, guard: 100, overdrive: 0, move: null as MoveName | null };

  private seq = 0;
  private pending: InputPacket[] = [];
  private facing: 1 | -1 = 1;
  hitstopFrames = 0;
  /** Round-trip time measured from the server's 2 s probe (ms). */
  pingMs = 0;

  private constructor(private o: ConnectOptions, private h: NetHandlers, private onShake: (a: number, d: number) => void) {}

  /** Connects, authenticates (wallet signature or dev guest) and resolves with the bound player id. */
  static async connect(o: ConnectOptions, h: NetHandlers, onShake: (a: number, d: number) => void): Promise<NetcodeClient> {
    const n = new NetcodeClient(o, h, onShake);
    if (import.meta.env.DEV) {
      // Node dev server: real socket.io
      const { io } = await import('socket.io-client');
      n.socket = io(o.url, { transports: ['websocket'] });
    } else {
      // Cloudflare build: native WebSocket against the Queue/Room Durable Objects.
      n.wsMode = true;
      n.socket = new WSSocket(o.url, { matchId: o.matchId, queue: !!o.queue });
      n.socket.onRerouteRequested = (matchId) => n.reroute(matchId);
    }
    return new Promise((resolve, reject) => {
      const s = n.socket;
      s.on('connect_error', () => reject(new Error('Cannot reach the game server.')));
      s.on('auth_challenge', async (p: { message: string }) => {
        try {
          const id = o.wallet ? await o.wallet(p.message) : { address: guestId(), signature: undefined };
          s.emit('auth', {
            ...id, matchId: o.matchId, fighter: o.fighter, bot: o.bot,
            difficulty: o.difficulty, training: o.training, session: o.session, queue: o.queue,
          });
        } catch (e) { reject(e); }
      });
      s.on('verifying_escrow', () => h.onStatus?.('Verifying both stakes on-chain…'));
      s.on('auth_ok', (p: { address: string; waiting?: boolean }) => {
        n.playerId = p.address;
        h.onStatus?.(p.waiting ? 'Waiting for an opponent. Share this room code.' : 'Connected.');
        resolve(n);
      });
      s.on('auth_error', (p: { reason: string }) => reject(new Error(p.reason)));
      n.bind();
    });
  }

  /** Ranked reroute (native WS path): leave the QueueDO socket and join the matched RoomDO. */
  private reroute(matchId: string) {
    this.o.matchId = matchId;
    this.o.queue = false;
    (this.socket as WSSocket).reroute({ matchId });
  }

  private bind() {
    const s = this.socket, h = this.h;
    s.on('rtt', (t0: number, ack: () => void) => { ack(); this.pingMs = Date.now() - t0; });
    s.on('match_start', (e: MatchStart) => h.onMatchStart?.(e));
    s.on('snapshot', (snap: Snapshot) => this.reconcile(snap));
    s.on('hit_confirmed', (e: HitEvent) => { this.impact(e.damage, false); h.onHit?.(e); });
    s.on('block_confirmed', (e: BlockEvent) => { this.impact(e.chip, true); h.onBlock?.(e); });
    s.on('guard_break', (e: GuardBreakEvent) => { this.hitstopFrames = 4; this.onShake(0.2, 0.3); h.onGuardBreak?.(e); });
    s.on('perfect_guard', (e: PerfectGuardEvent) => { this.hitstopFrames = 3; this.onShake(0.06, 0.12); h.onPerfectGuard?.(e); });
    s.on('throw_tech', (e: { x: number; y: number }) => { this.hitstopFrames = 3; this.onShake(0.07, 0.14); h.onThrowTech?.(e); });
    s.on('clash', () => { this.hitstopFrames = 4; this.onShake(0.08, 0.12); h.onClash?.(); });
    s.on('move_start', (e: { playerId: string; move: MoveName }) => h.onMoveStart?.(e));
    s.on('spell_cast', (e: { playerId: string; x: number; facing: 1 | -1; spell?: string; ex?: boolean }) => h.onSpellCast?.(e));
    s.on('spell_clash', (e: { x: number; y: number }) => { this.onShake(0.1, 0.18); h.onSpellClash?.(e); });
    s.on('dash', (e: { playerId: string; dir: -1 | 1 }) => h.onDash?.(e));
    s.on('land', (e: { playerId: string }) => h.onLand?.(e));
    s.on('no_mana', (e: { need: number; have: number }) => h.onNoMana?.(e));
    s.on('no_overdrive', (e: { need: number; have: number }) => h.onNoOverdrive?.(e));
    s.on('round_start', (e) => h.onRoundStart?.(e));
    s.on('round_over', (e) => h.onRoundOver?.(e));
    s.on('timer', (e: { secondsLeft: number }) => h.onTimer?.(e.secondsLeft));
    s.on('match_settled', (e: MatchSettled) => h.onSettled?.(e));
    s.on('queue:joined', (e: { waitedMs: number; size: number }) => h.onQueueJoined?.(e));
    s.on('queue:state', (e: QueueState) => h.onQueueState?.(e));
    s.on('queue:matched', (e: QueueMatched) => h.onQueueMatched?.(e));
    s.on('queue:timeout', (e: { waitedMs: number }) => h.onQueueTimeout?.(e));
    s.on('queue:error', (e: { reason: string }) => h.onQueueError?.(e));
    s.on('queue:left', () => h.onQueueLeft?.());
    s.on('profile', (p: PlayerProfile) => h.onProfile?.(p));
    s.on('leaderboard:data', (e: { players: LeaderboardEntry[]; total: number }) => h.onLeaderboard?.(e));
    s.on('opponent_disconnected', () => h.onStatus?.('Opponent disconnected. Waiting up to 15 s…'));
    s.on('opponent_reconnected', () => h.onStatus?.(''));
    s.on('disconnect', () => h.onStatus?.('Connection lost. Reconnecting…'));
  }

  setFacing(f: 1 | -1) { this.facing = f; }

  /** Bot matches only: genuinely freezes the server loop (online matches ignore this). */
  setPaused(paused: boolean) { this.socket.emit('pause', { paused }); }

  /** Practice room: switch the dummy behaviour. */
  setTrainingDummy(dummy: 'stand' | 'block' | 'jump' | 'jab' | 'walk') { this.socket.emit('training_dummy', { dummy }); }

  /** Practice room: put both fighters back on their spawn marks. */
  resetTraining() { this.socket.emit('training_reset'); }

  /* ------------------------------ ranked queue ------------------------------ */

  /** Enter the matchmaking queue for this fighter. Resolves the match via `match_start`. */
  queueJoin(fighter: string) { this.socket.emit('queue:join', { fighter }); }

  /** Leave the queue (cancel). Safe to call when not queued. */
  queueLeave() { this.socket.emit('queue:leave'); }

  /**
   * Once per fixed tick. `actions` goes to the server untouched; `predicted` (default: same) is what the
   * local fighter is allowed to do right now (e.g. zero while attacking), so prediction matches the server.
   */
  sendInput(tick: number, actions: number, predicted = actions): InputPacket {
    const pkt: InputPacket = { seq: ++this.seq, tick, actions };
    this.localPos.x = stepMovement(this.localPos.x, predicted, this.facing);
    this.pending.push({ ...pkt, actions: predicted });
    if (this.pending.length > 120) this.pending.shift();
    this.socket.emit('input', pkt);
    return pkt;
  }

  /** Adopt authoritative state, drop acked inputs, replay the rest (server reconciliation). */
  private reconcile(s: Snapshot) {
    this.phase = s.phase;
    const me = s.players[this.playerId];
    if (me) {
      this.pending = this.pending.filter((p) => p.seq > s.ackSeq);
      let x = me.x;
      for (const p of this.pending) x = stepMovement(x, p.actions, this.facing);
      const err = Math.abs(x - this.localPos.x);
      this.localPos.x = err > 0.25 ? x : THREE.MathUtils.lerp(this.localPos.x, x, 0.35);
      Object.assign(this.localServer, { y: me.y, state: me.state, hp: me.hp, mana: me.mana, guard: me.guard, overdrive: me.overdrive, move: me.move });
    }
    for (const [id, p] of Object.entries(s.players)) {
      if (id === this.playerId) continue;
      this.remoteTarget.set(p.x, p.y, 0);
      Object.assign(this.remoteState, { state: p.state, facing: p.facing, hp: p.hp, mana: p.mana, guard: p.guard, overdrive: p.overdrive, move: p.move });
    }
    this.h.onSnapshot?.(s);
  }

  /** Frame-rate-independent smoothing of the remote fighter. */
  smoothRemote(position: THREE.Vector3, dt: number) { position.lerp(this.remoteTarget, 1 - Math.exp(-18 * dt)); }

  /** 4-frame hitstop (2 on block) + camera shake, mirroring the server's global freeze. */
  private impact(amount: number, block: boolean) {
    this.hitstopFrames = block ? 2 : 4;
    this.onShake(block ? 0.05 : Math.min(0.1 + amount / 60, 0.35), block ? 0.1 : 0.2);
  }
  tickHitstop(): boolean { if (this.hitstopFrames <= 0) return false; this.hitstopFrames--; return true; }

  dispose() { this.socket.disconnect(); }
}

function guestId(): string {
  let id = sessionStorage.getItem('vf-guest');
  if (!id) { id = 'dev:' + (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)).slice(0, 12); sessionStorage.setItem('vf-guest', id); }
  return id;
}
