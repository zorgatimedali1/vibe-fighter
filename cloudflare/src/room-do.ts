/**
 * RoomDO — one Durable Object instance per match (DO name = matchId).
 *
 * Ports the room-routing half of `server/src/server.ts` (createEntry / attach / joinDev / settle)
 * with socket.io replaced by a native WebSocket: every socket frame is `{e, p}` JSON, exactly what
 * socket.io used to wrap. The 60 Hz simulation itself is `CombatRoom`, imported VERBATIM from the
 * Node server — only the transport hooks differ (no socket.io acks, so `rtt` becomes `rtt_ack`).
 *
 * Sources of config:
 *   • `/config`  — internal call from QueueDO when a ranked pair is drawn (players, ratings…).
 *   • self-config — `bot-…` / training matches and shared room codes configure on first auth.
 */

import { CombatRoom, type RoomHooks } from '../../server/src/engine/CombatRoom.ts';
import { isBotDifficulty, isFighterId, type BotDifficulty, type MatchResult } from '../../server/src/types/combat.ts';
import { tierOf } from '../../server/src/rating.ts';
import { SessionCodec } from './sessions.ts';
import { Store } from './store.ts';
import { isDev, type Env } from './types.ts';

const STRIKE_LIMIT = 8;
/** authMessage port (inline so the ethers-heavy verifier.ts is never bundled). */
const authMessage = (nonce: string) => `Voxel Fighter sign-in\nNonce: ${nonce}`;

interface RoomConfig {
  matchId: string;
  players: [string, string];
  botIndex?: 0 | 1;
  difficulty?: BotDifficulty;
  mode: 'versus' | 'training' | 'ranked';
  /** Present only on ranked rooms: the pairing metadata the settle screen shows. */
  ranked?: { ratings: [number, number]; handles: [string, string]; points: [number, number]; fighters: [string, string] };
}

export class RoomDO {
  private env: Env;
  private store: Store;
  private codec: SessionCodec;
  private storage: DurableObjectStorage;

  private sockets = new Map<string, WebSocket>();
  private strikes = new Map<string, number>();
  private buckets = new Map<string, () => boolean>();
  /** t0 of the last un-acked RTT probe, per player (drives lag compensation). */
  private rttPend = new Map<string, number>();

  private cfg: RoomConfig | null = null;
  private wait: { addr: string; fighter: string } | null = null;   // code-room lobby: first player waiting
  private room: CombatRoom | null = null;
  private rankedOn = false;
  private rttTimer?: ReturnType<typeof setInterval>;

  constructor(state: DurableObjectState, env: Env) {
    this.env = env;
    this.storage = state.storage;
    this.store = new Store(env.DB as unknown as D1Database);
    this.codec = new SessionCodec(env);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    /* ---- internal: QueueDO drops a ranked config into this room before the players arrive ---- */
    if (url.pathname === '/config') {
      const key = req.headers.get('x-vf-internal');
      if (key !== (this.env.SESSION_KEY || 'vf-dev-secret')) return new Response('forbidden', { status: 403 });
      const cfg = await req.json() as RoomConfig;
      await this.storage.put('cfg', cfg);
      return new Response('ok');
    }

    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('this room speaks WebSocket', { status: 426 });
    }
    return this.handleSocket(req);
  }

  /* ------------------------------- alarms (cleanup) ------------------------------- */

  async alarm(): Promise<void> {
    // Room closed (or a code lobby that never filled): drop state so a reused code gets a fresh
    // lobby, and close any lingering sockets. The instance idles out afterwards on its own.
    this.stopRtt();
    this.cfg = null;
    this.wait = null;
    this.room = null;
    this.rankedOn = false;
    for (const s of this.sockets.values()) { try { s.close(1000, 'room closed'); } catch { /* gone */ } }
    this.sockets.clear();
    await this.storage.deleteAll();
  }

  /* --------------------------------- WebSocket --------------------------------- */

  private async handleSocket(req: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const sock: WebSocket = pair[1];
    sock.accept();
    let addr = '';
    let authed = false;

    this.cfg = (await this.storage.get<RoomConfig>('cfg')) ?? null;
    send(sock, 'auth_challenge', { message: authMessage(crypto.randomUUID()), dev: isDev(this.env) });

    const authTimer = setTimeout(() => { if (!authed) { try { sock.close(4000, 'auth timeout'); } catch { /* gone */ } } }, 15_000);

    sock.addEventListener('message', (m) => {
      let msg: { e?: string; p?: Record<string, unknown> };
      try { msg = JSON.parse(String((m as MessageEvent).data)); } catch { return; }
      const ev = msg.e, p = msg.p ?? {};

      if (ev === 'auth') {
        if (authed) return;
        authed = true;
        void this.onAuth(sock, p).then((a) => { addr = a; clearTimeout(authTimer); }).catch(() => { /* fail already sent */ });
        return;
      }
      if (!addr) return;

      if (ev === 'input') {
        if (!this.bucket(addr)()) { this.onStrike(addr, 'rate limit'); return; }
        this.room?.pushInput(addr, p);
      } else if (ev === 'rtt_ack') {
        const t0 = this.rttPend.get(addr);
        if (t0 !== undefined) { this.rttPend.delete(addr); this.room?.setRtt(addr, Date.now() - t0); }
      } else if (ev === 'pause') {
        this.room?.setPaused(!!p.paused);
      } else if (ev === 'training_dummy') {
        const d = p.dummy;
        if (this.room?.training && (d === 'stand' || d === 'block' || d === 'jump' || d === 'jab' || d === 'walk')) {
          this.room.setTrainingDummy(d);
        }
      } else if (ev === 'training_reset') {
        this.room?.trainingReset();
      } else if (ev === 'profile:get') {
        void this.profileOf(addr).then((prof) => send(sock, 'profile', prof));
      }
      // Unknown events are ignored (forward compatibility).
    });

    sock.addEventListener('close', () => {
      clearTimeout(authTimer);
      if (addr && this.sockets.get(addr) === sock) {
        this.sockets.delete(addr);
        this.room?.markDisconnected(addr);
      }
    });
    sock.addEventListener('error', () => { /* the close event runs the cleanup */ });

    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /** Identity + room routing — the direct port of the auth handler in `io.on('connection')`. */
  private async onAuth(sock: WebSocket, p: Record<string, unknown>): Promise<string> {
    const fail = (reason: string) => {
      send(sock, 'auth_error', { reason });
      try { sock.close(4001, reason); } catch { /* gone */ }
      throw new Error(reason);
    };
    try {
      const fighter = isFighterId(p.fighter) ? p.fighter : 'ram';
      const difficulty: BotDifficulty = isBotDifficulty(p.difficulty) ? p.difficulty : 'normal';
      const matchId = String(p.matchId ?? '').slice(0, 80);

      // 1. Identity: a signed session (X login) wins, then dev guests (`dev:` addresses).
      const session = typeof p.session === 'string' && p.session.length > 0 ? await this.codec.verify(p.session) : null;
      let addr: string;
      if (session) {
        addr = session.pid;
        const provider = addr.startsWith('x:') ? 'x' : 'guest';
        await this.store.ensurePlayer(addr, provider, addr.slice(addr.indexOf(':') + 1), session.handle, session.av ?? null);
      } else if (isDev(this.env) && typeof p.address === 'string' && p.address.startsWith('dev:')) {
        addr = p.address.slice(0, 40);
        await this.store.ensurePlayer(addr, 'guest', addr, shortHandle(addr), null);
      } else {
        return fail('sign in first') as unknown as string;
      }

      if (!matchId) return fail('bad auth request') as unknown as string;

      /* 2. Pre-configured room (ranked, dropped in via /config) — only its players may join. */
      if (this.cfg) {
        if (!this.cfg.players.includes(addr)) return fail('this player is not in that match') as unknown as string;
        await this.attach(addr, fighter, sock);
        return addr;
      }

      /* 3. Bot / practice rooms configure themselves out of the auth payload. */
      if (matchId.startsWith('bot-') || p.bot) {
        const training = !!p.training;
        const cfg: RoomConfig = {
          matchId, players: [addr, `dev:bot-${matchId}`], botIndex: 1,
          difficulty: training ? 'rookie' : difficulty,
          mode: training ? 'training' : 'versus',
        };
        await this.storage.put('cfg', cfg);
        this.cfg = cfg;
        await this.attach(addr, fighter, sock);
        return addr;
      }

      /* 4. Shared room code: first player waits (10 min TTL), the second one starts the room. */
      if (!this.wait) {
        if (this.room) return fail('room is full') as unknown as string;
        this.wait = { addr, fighter };
        this.sockets.set(addr, sock);                                // register now: the starter attaches everyone
        send(sock, 'auth_ok', { address: addr, waiting: true });
        await this.storage.setAlarm(Date.now() + 10 * 60_000);
        return addr;
      }
      if (this.wait.addr === addr) return fail('already waiting in this room') as unknown as string;

      const first = this.wait;
      this.wait = null;
      await this.storage.deleteAlarm();
      const cfg: RoomConfig = { matchId, players: [first.addr, addr], mode: 'versus' };
      await this.storage.put('cfg', cfg);
      this.cfg = cfg;
      await this.attach(first.addr, first.fighter, this.sockets.get(first.addr));
      await this.attach(addr, fighter, sock);
      return addr;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('sign in first') || e instanceof Error && AUTH_REASONS.has(e.message)) throw e;
      return fail('could not verify the match') as unknown as string;
    }
  }

  /* ------------------------- attach + CombatRoom lifecycle ------------------------- */

  private async attach(addr: string, fighter: string, sock: WebSocket | undefined): Promise<void> {
    const old = this.sockets.get(addr);
    if (old && old !== sock) { try { old.close(4002, 'superseded'); } catch { /* gone */ } }
    if (sock) this.sockets.set(addr, sock);                          // newest connection wins (reconnect)
    send(this.sockets.get(addr) ?? sock, 'auth_ok', { address: addr });
    this.ensureRoom();
    this.rankedOn = this.cfg!.mode === 'ranked';
    this.room!.markConnected(addr, fighter);
    send(this.sockets.get(addr), 'profile', await this.profileOf(addr));
  }

  private ensureRoom(): void {
    if (this.room || !this.cfg) return;
    const cfg = this.cfg;
    const hooks: RoomHooks = {
      emitTo: (target, ev, payload) => this.emitTo(target, ev, payload),
      emitAll: (ev, payload) => this.emitAll(ev, payload),
      settle: (r: MatchResult) => void this.settle(r),
      closed: () => { this.stopRtt(); setTimeout(() => { void this.storage.setAlarm(Date.now() + 5_000); }, 100); },
      strike: (target, why) => this.onStrike(target, why),
    };
    this.room = new CombatRoom(cfg.matchId, cfg.players, hooks, {
      botIndex: cfg.botIndex, difficulty: cfg.difficulty, dev: isDev(this.env), mode: cfg.mode,
    });
    // RTT probe every 2 s drives the engine's lag compensation. Players answer with `rtt_ack`.
    this.rttTimer = setInterval(() => {
      for (const [addr, s] of this.sockets) {
        const t0 = Date.now();
        this.rttPend.set(addr, t0);
        send(s, 'rtt', { t0 });
      }
    }, 2_000);
  }

  private stopRtt(): void {
    if (this.rttTimer) { clearInterval(this.rttTimer); this.rttTimer = undefined; }
  }

  /* ------------------------------ settlement ------------------------------ */

  private async settle(r: MatchResult): Promise<void> {
    const deadline = Math.floor(Date.now() / 1000) + 24 * 3600;
    let ranked: { cancelled?: boolean; winnerPid?: string; sides?: Record<string, unknown> } | null = null;

    if (this.rankedOn && this.cfg) {
      const loser = this.cfg.players.find((p) => p !== r.winner) ?? '';
      const noContest = r.reason === 'forfeit' && (this.room?.tick ?? 0) < 240;
      if (noContest) ranked = { cancelled: true };
      else {
        try {
          const s = await this.store.recordRanked({
            matchId: r.matchId, winnerPid: r.winner, loserPid: loser,
            rounds: [r.p1Rounds, r.p2Rounds], reason: r.reason,
          });
          if (s) ranked = { winnerPid: s.winnerPid, sides: s.sides };
        } catch (e) { console.error('[ranked] settle failed', e); }
      }
    }

    // DEV_MODE: the escrow signer is absent, so the signature is the `0x` placeholder.
    const payload = { ...r, deadline, signature: '0x', dev: isDev(this.env), ranked };
    this.emitAll('match_settled', payload);
  }

  /* ------------------------------ small helpers ------------------------------ */

  private emitTo(addr: string, ev: string, payload: unknown): void {
    const s = this.sockets.get(addr);
    if (s && s.readyState === WebSocket.OPEN) s.send(JSON.stringify({ e: ev, p: payload }));
  }

  private emitAll(ev: string, payload: unknown): void {
    const frame = JSON.stringify({ e: ev, p: payload });
    for (const s of this.sockets.values()) if (s.readyState === WebSocket.OPEN) s.send(frame);
  }

  private onStrike(addr: string, why: string): void {
    const n = (this.strikes.get(addr) ?? 0) + 1;
    this.strikes.set(addr, n);
    if (n >= STRIKE_LIMIT) this.sockets.get(addr)?.close(4003, `kicked: ${why}`);
  }

  /** Token bucket per player: 60 inputs/s steady, burst 30 (identical to the Node server). */
  private bucket(addr: string): () => boolean {
    let fn = this.buckets.get(addr);
    if (!fn) {
      let tokens = 30, last = Date.now();
      fn = () => {
        const n = Date.now();
        tokens = Math.min(30, tokens + ((n - last) / 1000) * 75); last = n;
        if (tokens < 1) return false;
        tokens--;
        return true;
      };
      this.buckets.set(addr, fn);
    }
    return fn;
  }

  private async profileOf(addr: string) {
    const p = await this.store.getPlayer(addr);
    if (!p) {
      return { pid: addr, handle: shortHandle(addr), avatar: null, points: 0, rating: 0, wins: 0, losses: 0, streak: 0, rank: 0, tier: tierOf(0) };
    }
    return {
      pid: p.pid, handle: p.handle, avatar: p.avatar, points: p.points, rating: p.rating,
      wins: p.wins, losses: p.losses, streak: p.streak, rank: await this.store.rankOf(p.pid), tier: tierOf(p.points),
    };
  }
}

const AUTH_REASONS = new Set([
  'sign in first', 'bad auth request', 'this player is not in that match',
  'room is full', 'already waiting in this room',
]);

export const shortHandle = (addr: string): string =>
  (addr.startsWith('x:') ? addr.slice(2) : `GUEST-${addr.slice(4, 9).toUpperCase()}`);

/** Send one protocol frame; deaths of the socket are always non-fatal. */
export function send(ws: WebSocket | undefined, ev: string, payload: unknown): void {
  try { ws?.send(JSON.stringify({ e: ev, p: payload })); } catch { /* socket gone */ }
}
