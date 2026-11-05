/**
 * QueueDO — singleton Durable Object ("queue" name) hosting the ranked matchmaking queue.
 *
 * Reuses `server/src/matchmaker.ts` (the pure queue class) VERBATIM. socket.io's 250 ms `setInterval`
 * becomes a Durable Object alarm (alarms are the only scheduler that survives without requests),
 * and player sockets are WS frames `{e, p}` like everywhere else.
 *
 * When a pair is drawn: emit `queue:matched` to both clients (they reroute their WS to the room),
 * then POST the ranked config into the RoomDO over its internal `/config` hook so the match is
 * ready before either player's rerouted socket arrives.
 */

import { Matchmaker, QUEUE_TICK_MS, type QueueEntry } from '../../server/src/matchmaker.ts';
import { isFighterId } from '../../server/src/types/combat.ts';
import { tierOf } from '../../server/src/rating.ts';
import { SessionCodec, randomHex } from './sessions.ts';
import { send, shortHandle } from './room-do.ts';
import { Store } from './store.ts';
import { isDev, type Env } from './types.ts';

export class QueueDO {
  private env: Env;
  private store: Store;
  private codec: SessionCodec;
  private storage: DurableObjectStorage;
  private matchmaker = new Matchmaker();
  private sockets = new Map<string, WebSocket>();

  constructor(state: DurableObjectState, env: Env) {
    this.env = env;
    this.storage = state.storage;
    this.store = new Store(env.DB as unknown as D1Database);
    this.codec = new SessionCodec(env);
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('the queue speaks WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const sock: WebSocket = pair[1];
    sock.accept();
    let addr = '';
    let authed = false;

    send(sock, 'auth_challenge', { message: `Voxel Fighter sign-in\nNonce: ${crypto.randomUUID()}`, dev: isDev(this.env) });

    const authTimer = setTimeout(() => { if (!authed) { try { sock.close(4000, 'auth timeout'); } catch { /* gone */ } } }, 15_000);

    sock.addEventListener('message', (m) => {
      let msg: { e?: string; p?: Record<string, unknown> };
      try { msg = JSON.parse(String((m as MessageEvent).data)); } catch { return; }
      const ev = msg.e, p = msg.p ?? {};

      if (ev === 'auth') {
        if (authed) return;
        authed = true;
        void this.onAuth(sock, p).then((a) => { addr = a; clearTimeout(authTimer); });
        return;
      }
      if (!addr) return;

      if (ev === 'queue:join') {
        void this.onJoin(addr, sock, p);
      } else if (ev === 'queue:leave') {
        this.matchmaker.leave(addr);
        this.sockets.delete(addr);
        send(sock, 'queue:left', {});
      } else if (ev === 'profile:get') {
        void this.profileOf(addr).then((prof) => send(sock, 'profile', prof));
      } else if (ev === 'leaderboard:get') {
        void this.leaderboardOf(Number(p.limit)).then((l) => send(sock, 'leaderboard:data', l));
      }
      // Unknown events are ignored (forward compatibility).
    });

    sock.addEventListener('close', () => {
      clearTimeout(authTimer);
      if (addr) this.matchmaker.leave(addr);
      if (!addr || this.sockets.get(addr) === sock) this.sockets.delete(addr);
      this.scheduleTick();
    });
    sock.addEventListener('error', () => { /* the close event runs the cleanup */ });

    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private async onAuth(sock: WebSocket, p: Record<string, unknown>): Promise<string> {
    const fail = (reason: string) => {
      send(sock, 'auth_error', { reason });
      try { sock.close(4001, reason); } catch { /* gone */ }
      throw new Error(reason);
    };
    try {
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
      send(sock, 'auth_ok', { address: addr, queue: true });
      send(sock, 'profile', await this.profileOf(addr));
      return addr;
    } catch (e) {
      if (e instanceof Error && e.message === 'sign in first') throw e;
      return fail('could not verify the session') as unknown as string;
    }
  }

  /** `queue:join` — ranked is account-only, mirrors the Node server's checks. */
  private async onJoin(addr: string, sock: WebSocket, p: Record<string, unknown>): Promise<void> {
    const inQueue = this.matchmaker.has(addr);
    if (!addr) { send(sock, 'queue:error', { reason: 'not-authenticated' }); return; }
    // Ranked is account-only: guests can practice and use room codes, but not climb the ladder.
    if (addr.startsWith('dev:')) { send(sock, 'queue:error', { reason: 'sign-in-required' }); return; }

    const fighter = isFighterId(p.fighter) ? p.fighter : 'ram';
    if (inQueue) { send(sock, 'queue:error', { reason: 'already-queued' }); return; }

    const player = await this.store.getPlayer(addr)
      ?? await this.store.ensurePlayer(addr, addr.startsWith('x:') ? 'x' : 'guest', addr, shortHandle(addr), null);
    const res = this.matchmaker.join({
      key: addr, rating: player.rating, fighter, handle: player.handle,
      joinedAt: Date.now(), socketId: addr,
    });
    if (!res.ok) { send(sock, 'queue:error', { reason: res.reason }); return; }

    this.sockets.set(addr, sock);
    send(sock, 'queue:joined', { waitedMs: 0, size: this.matchmaker.size });
    send(sock, 'queue:state', { size: this.matchmaker.size, waitedMs: 0 });
    await this.tick();                                               // pair immediately if someone waits
  }

  /* ------------------------------ pair loop (alarm) ------------------------------ */

  /** Reset the alarm while anyone queues (QUEUE_TICK_MS, same cadence as the Node server). */
  private scheduleTick(): void {
    if (this.matchmaker.size > 0) void this.storage.setAlarm(Date.now() + QUEUE_TICK_MS);
  }

  async alarm(): Promise<void> {
    await this.tick();
  }

  private async tick(): Promise<void> {
    const now = Date.now();

    for (const e of this.matchmaker.expire(now)) {
      const s = this.sockets.get(e.key);
      this.sockets.delete(e.key);
      send(s, 'queue:timeout', { waitedMs: now - e.joinedAt });
    }
    await this.tryMatch();

    for (const e of this.matchmaker.all()) {
      const s = this.sockets.get(e.key);
      if (s && s.readyState === WebSocket.OPEN) send(s, 'queue:state', { size: this.matchmaker.size, waitedMs: now - e.joinedAt });
    }
    this.scheduleTick();
  }

  /** Pair whoever can be paired, then start server-authoritative ranked rooms. */
  private async tryMatch(): Promise<void> {
    for (const pair of this.matchmaker.pair(Date.now())) {
      const sa = this.sockets.get(pair.a.key);
      const sb = this.sockets.get(pair.b.key);
      const saOk = !!sa && sa.readyState === WebSocket.OPEN;
      const sbOk = !!sb && sb.readyState === WebSocket.OPEN;
      if (!saOk || !sbOk) {
        const alive = saOk ? pair.a : sbOk ? pair.b : null;           // put the survivor back in line
        if (!saOk) this.sockets.delete(pair.a.key);
        if (!sbOk) this.sockets.delete(pair.b.key);
        if (alive) {
          this.matchmaker.join(alive);
          const s = this.sockets.get(alive.key);
          if (s && s.readyState === WebSocket.OPEN) send(s, 'queue:state', { size: this.matchmaker.size, waitedMs: Date.now() - alive.joinedAt });
        }
        continue;
      }

      await this.startRanked(pair.a, pair.b, sa!, sb!);
    }
  }

  /** `startRanked` from server.ts: create match id, tell both clients, configure the RoomDO. */
  private async startRanked(a: QueueEntry, b: QueueEntry, sa: WebSocket, sb: WebSocket): Promise<void> {
    const matchId = `r-${randomHex(5)}`;
    const pa = await this.store.getPlayer(a.key), pb = await this.store.getPlayer(b.key);
    const players = [a.key, b.key] as [string, string];
    const cfg = {
      matchId,
      players,
      mode: 'ranked' as const,
      ranked: {
        ratings: [a.rating, b.rating],
        handles: [pa?.handle ?? a.handle, pb?.handle ?? b.handle],
        points: [pa?.points ?? 0, pb?.points ?? 0],
        fighters: [a.fighter, b.fighter],
      },
    };

    const tell = (self: QueueEntry, selfSocket: WebSocket, other: QueueEntry, otherRow: { handle: string; points: number } | null) => {
      send(selfSocket, 'queue:matched', {
        matchId, fighter: self.fighter,
        opponent: {
          handle: otherRow?.handle ?? other.handle,
          points: otherRow?.points ?? 0,
          tier: tierOf(otherRow?.points ?? 0),
          rating: other.rating,
        },
      });
    };
    tell(a, sa, b, pb);
    tell(b, sb, a, pa);

    // Hand the ranked config to the room BEFORE either client reroutes its WebSocket there.
    const stub = this.env.ROOM.get(this.env.ROOM.idFromName(matchId));
    const appRes = await stub.fetch('https://room/config', {
      method: 'POST',
      headers: { 'x-vf-internal': this.env.SESSION_KEY || 'vf-dev-secret', 'content-type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    if (!appRes.ok) {
      // The room refused the config (never happens in practice): undo the matchmaking.
      this.matchmaker.leave(a.key); this.matchmaker.leave(b.key);
      send(sa, 'queue:error', { reason: 'match-failed' });
      send(sb, 'queue:error', { reason: 'match-failed' });
      return;
    }

    // Keep the queue sockets open; the clients close them as they reroute to the room DO.
    console.error(`[ranked] ${matchId}: ${a.key} (${a.rating}) vs ${b.key} (${b.rating})`);
  }

  private async profileOf(addr: string) {
    const p = await this.store.getPlayer(addr);
    if (!p) return { pid: addr, handle: shortHandle(addr), avatar: null, points: 0, rating: 0, wins: 0, losses: 0, streak: 0, rank: 0, tier: tierOf(0) };
    return {
      pid: p.pid, handle: p.handle, avatar: p.avatar, points: p.points, rating: p.rating,
      wins: p.wins, losses: p.losses, streak: p.streak, rank: await this.store.rankOf(p.pid), tier: tierOf(p.points),
    };
  }

  private async leaderboardOf(limit: number) {
    return { players: await this.store.leaderboard(Number.isFinite(limit) ? limit : 50), total: await this.store.countPlayers() };
  }
}
