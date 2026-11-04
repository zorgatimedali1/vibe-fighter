import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { Server, type Socket } from 'socket.io';
import { getAddress } from 'ethers';
import { CombatRoom, type RoomHooks } from './engine/CombatRoom.ts';
import { EscrowVerifier, VictorySigner, authMessage, verifyLogin, type LockedMatch } from './crypto/verifier.ts';
import { isBotDifficulty, isFighterId, type BotDifficulty, type MatchResult } from './types/combat.ts';
import { Store, type RankedSettlement } from './db.ts';
import { SessionCodec, loadSessionSecret } from './auth/session.ts';
import { beginXAuth, finishXAuth, mockProfile, xConfigured, type XConfig } from './auth/x.ts';
import { Matchmaker, QUEUE_TICK_MS, type QueueEntry } from './matchmaker.ts';
import { tierOf } from './rating.ts';

/* --------------------------------- config --------------------------------- */
const env = process.env;
const DEV = env.DEV_MODE === 'true';
const PORT = Number(env.PORT ?? 3000);
const CHAIN_ID = Number(env.CHAIN_ID ?? 1);
const ESCROW = env.ESCROW_ADDRESS ?? '';
const CLAIM_WINDOW_S = 24 * 3600;
const STRIKE_LIMIT = 8;
const DATA_DIR = path.resolve(import.meta.dirname, '../data');

const XCFG: XConfig = {
  clientId: env.X_CLIENT_ID ?? '',
  clientSecret: env.X_CLIENT_SECRET ?? '',
  redirectUri: env.X_REDIRECT_URI ?? `http://localhost:${PORT}/auth/x/callback`,
  // No credentials → the local mock identity, so the ladder is playable offline.
  mock: env.X_DEV_MOCK === 'true' || !env.X_CLIENT_ID,
};

let verifier: EscrowVerifier | null = null;
let signer: VictorySigner | null = null;
if (!DEV) {
  for (const k of ['RPC_URL', 'ESCROW_ADDRESS', 'SERVER_SIGNER_PK']) if (!env[k]) throw new Error(`Missing ${k} (set DEV_MODE=true for free practice mode)`);
  verifier = new EscrowVerifier({ rpcUrl: env.RPC_URL!, escrow: ESCROW, chainId: CHAIN_ID, confirmations: Number(env.CONFIRMATIONS ?? 2), minPot: BigInt(env.MIN_POT ?? 2_000_000) });
  signer = new VictorySigner(env.SERVER_SIGNER_PK!, CHAIN_ID, ESCROW);
  console.log(`[boot] production mode, result signer ${signer.address}`);
} else console.log('[boot] DEV_MODE: guests, bot matches, no chain. Do not use with real money.');

/* ------------------------------ persistence ------------------------------ */
const store = new Store(env.DB_PATH || path.join(DATA_DIR, 'voxel.db'));
const codec = new SessionCodec(loadSessionSecret(path.join(DATA_DIR, 'session.key')));
const matchmaker = new Matchmaker();
const queue = new Map<string, Socket>();                            // addr -> socket while queued
console.log(`[boot] ladder ready: ${store.countPlayers()} players on record${xConfigured(XCFG) ? '' : ' · X login is MOCKED (set X_CLIENT_ID/X_CLIENT_SECRET)'}`);

/* ---------------------------- static client (dist) ---------------------------- */
const DIST = path.resolve(import.meta.dirname, '../../client/dist');
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.json': 'application/json', '.svg': 'image/svg+xml' };
const CORS = env.CORS_ORIGIN ?? '*';

const json = (res: import('node:http').ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': CORS });
  res.end(JSON.stringify(body));
};
const redirect = (res: import('node:http').ServerResponse, to: string) => {
  res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' });
  res.end();
};

/** Session token from an `Authorization: Bearer` header or `?session=` (never logged). */
function sessionFrom(req: import('node:http').IncomingMessage) {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return codec.verify(auth.slice(7));
  const url = new URL(req.url ?? '/', 'http://localhost');
  const q = url.searchParams.get('session');
  return q ? codec.verify(q) : null;
}

const http = createServer(async (req, res) => {
  const rawUrl = req.url ?? '/';
  const url = rawUrl.split('?')[0];

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': CORS,
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    res.end();
    return;
  }

  if (url === '/health') { res.end('ok'); return; }
  if (url.startsWith('/socket.io')) return;                         // handled by socket.io

  /* ------------------------------- ladder API ------------------------------- */
  if (url === '/api/leaderboard') {
    const limit = Number(new URL(rawUrl, 'http://localhost').searchParams.get('limit') ?? 50);
    json(res, 200, { players: store.leaderboard(Number.isFinite(limit) ? limit : 50), total: store.countPlayers() });
    return;
  }
  if (url === '/api/me') {
    const s = sessionFrom(req);
    if (!s) { json(res, 401, { error: 'not signed in' }); return; }
    const p = store.getPlayer(s.pid);
    if (!p) { json(res, 404, { error: 'unknown player' }); return; }
    json(res, 200, {
      pid: p.pid, handle: p.handle, avatar: p.avatar,
      points: p.points, rating: p.rating, wins: p.wins, losses: p.losses, streak: p.streak,
      bestStreak: p.bestStreak, rank: store.rankOf(p.pid), tier: tierOf(p.points),
    });
    return;
  }

  /* --------------------------------- X login -------------------------------- */
  if (url === '/auth/x/start') {
    const as = new URL(rawUrl, 'http://localhost').searchParams.get('as') ?? undefined;
    if (!xConfigured(XCFG)) {
      // Local dev: mint a stable mock identity so the ladder is playable without X credentials.
      const profile = mockProfile(as);
      const pid = `x:${profile.id}`;
      store.ensurePlayer(pid, 'x', profile.id, profile.handle, profile.avatar);
      const token = codec.sign({ pid, handle: profile.handle, av: profile.avatar ?? undefined });
      redirect(res, `/#session=${encodeURIComponent(token)}`);
      return;
    }
    const begin = beginXAuth(XCFG);
    if (!begin) { json(res, 500, { error: 'X login is not configured' }); return; }
    redirect(res, begin.url);
    return;
  }
  if (url === '/auth/x/callback') {
    const u = new URL(rawUrl, 'http://localhost');
    const code = u.searchParams.get('code') ?? '';
    const state = u.searchParams.get('state') ?? '';
    const denied = u.searchParams.get('error');
    if (denied || !code || !state) { redirect(res, '/#auth=denied'); return; }
    const profile = await finishXAuth(XCFG, code, state);
    if (!profile) { redirect(res, '/#auth=failed'); return; }
    const pid = `x:${profile.id}`;
    store.ensurePlayer(pid, 'x', profile.id, profile.handle, profile.avatar);
    const token = codec.sign({ pid, handle: profile.handle, av: profile.avatar ?? undefined });
    // Session travels in the URL fragment so it never hits a server log or a Referer header.
    redirect(res, `/#session=${encodeURIComponent(token)}`);
    return;
  }

  /* ------------------------------ static client ----------------------------- */
  let file = path.join(DIST, path.normalize(url).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(DIST)) { res.statusCode = 403; res.end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  if (!existsSync(file)) { res.statusCode = 404; res.end('Client not built. Run: npm run build -w client (or use the Vite dev server).'); return; }
  res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream');
  createReadStream(file).pipe(res);
});

const io = new Server(http, {
  cors: { origin: env.CORS_ORIGIN?.split(',') ?? true },
  perMessageDeflate: { threshold: 256 },                            // compress snapshots
  maxHttpBufferSize: 4 * 1024,                                      // inputs are tiny; reject anything large
});

/* ------------------------------- room routing ------------------------------- */
interface RankedMeta {
  ratings: [number, number];
  handles: [string, string];
  points: [number, number];
  fighters: [string, string];
}
interface Entry { room: CombatRoom; sockets: Map<string, Socket>; rtt?: ReturnType<typeof setInterval>; ranked?: RankedMeta }
const entries = new Map<string, Entry>();
const lobbies = new Map<string, { addr: string; fighter: string; socket: Socket }[]>();   // dev: waiting for opponent
const lockCache = new Map<string, Promise<LockedMatch>>();

const norm = (a: string) => (a.startsWith('dev:') || a.startsWith('x:') ? a : getAddress(a));
const shortHandle = (addr: string) => (addr.startsWith('x:') ? addr.slice(2) : `GUEST-${addr.slice(4, 9).toUpperCase()}`);

function createEntry(
  matchId: string, players: [string, string],
  opts: { botIndex?: 0 | 1; difficulty?: BotDifficulty; mode?: 'versus' | 'training' | 'ranked' } = {},
): Entry {
  const sockets = new Map<string, Socket>();
  const roomName = `m:${matchId}`;
  const hooks: RoomHooks = {
    emitTo: (addr, ev, p) => sockets.get(addr)?.emit(ev, p),
    emitAll: (ev, p) => io.to(roomName).emit(ev, p),
    settle: (r: MatchResult) => void settle(entry, r),
    closed: () => { setTimeout(() => { clearInterval(entry.rtt); entries.delete(matchId); }, 5000); },
    strike: (addr, why) => strike(sockets.get(addr), why),
  };
  const room = new CombatRoom(matchId, players, hooks, { ...opts, dev: DEV });
  const entry: Entry = { room, sockets };
  entry.rtt = setInterval(() => {                                   // RTT probe drives lag compensation
    for (const [addr, s] of sockets) {
      const t0 = Date.now();
      s.timeout(2000).emit('rtt', t0, (err: unknown) => { if (!err) room.setRtt(addr, Date.now() - t0); });
    }
  }, 2000);
  entries.set(matchId, entry);
  return entry;
}

async function settle(entry: Entry, r: MatchResult) {
  const deadline = Math.floor(Date.now() / 1000) + CLAIM_WINDOW_S;
  let ranked: { cancelled?: boolean; winnerPid?: string; sides?: RankedSettlement['sides'] } | null = null;

  if (entry.ranked) {
    const loser = entry.room.players.find((p) => p !== r.winner) ?? '';
    // A forfeit before anyone threw a punch is a no-contest: no points, no rating damage.
    const noContest = r.reason === 'forfeit' && entry.room.tick < 240;
    if (noContest) ranked = { cancelled: true };
    else {
      try {
        const s = store.recordRanked({
          matchId: r.matchId, winnerPid: r.winner, loserPid: loser,
          rounds: [r.p1Rounds, r.p2Rounds], reason: r.reason,
        });
        if (s) ranked = { winnerPid: s.winnerPid, sides: s.sides };
      } catch (e) { console.error('[ranked] settle failed', e); }
    }
  }

  try {
    const signature = signer ? await signer.sign({ matchId: r.matchId, winner: r.winner, p1Rounds: r.p1Rounds, p2Rounds: r.p2Rounds, deadline }) : '0x';
    const payload = { ...r, deadline, signature, dev: DEV, ranked };
    for (const s of entry.sockets.values()) s.emit('match_settled', payload);
    console.log(`[settled] ${r.matchId} winner=${r.winner} ${r.p1Rounds}-${r.p2Rounds} (${r.reason})${ranked ? ' ranked' : ''}`);
  } catch (e) { console.error('[settle failed]', e); }
}

/* ------------------------------ abuse protection ------------------------------ */
const strikes = new WeakMap<Socket, number>();
function strike(s: Socket | undefined, why: string) {
  if (!s) return;
  const n = (strikes.get(s) ?? 0) + 1; strikes.set(s, n);
  if (n >= STRIKE_LIMIT) { console.warn(`[kick] ${s.id}: ${why}`); s.disconnect(true); }
}
/** Token bucket: 60 inputs/s steady, burst 30. Exceeding it drops packets and earns strikes. */
function bucket() {
  let tokens = 30, last = Date.now();
  return () => { const n = Date.now(); tokens = Math.min(30, tokens + ((n - last) / 1000) * 75); last = n; if (tokens < 1) return false; tokens--; return true; };
}

/* -------------------------------- matchmaking -------------------------------- */
function queueState(addr: string, now = Date.now()) {
  const e = matchmaker.get(addr);
  if (!e) return null;
  return { size: matchmaker.size, waitedMs: now - e.joinedAt, since: e.joinedAt };
}

/** Pair whoever can be paired, then start server-authoritative ranked rooms. */
function tryMatch() {
  for (const pair of matchmaker.pair(Date.now())) {
    // Re-check liveness: a socket can die between the pair decision and the room creation.
    if (!pair.a) continue;
    if (!pair.a.socketId || !pair.b.socketId) continue;
    const sa = queue.get(pair.a.key), sb = queue.get(pair.b.key);
    if (!sa?.connected || !sb?.connected) {
      const alive = sa?.connected ? pair.a : sb?.connected ? pair.b : null;
      if (alive && !matchmaker.has(alive.key)) matchmaker.join(alive);   // put the survivor back in line
      continue;
    }
    startRanked(pair.a, pair.b, sa, sb);
  }
}

function startRanked(a: QueueEntry, b: QueueEntry, sa: Socket, sb: Socket) {
  queue.delete(a.key); queue.delete(b.key);
  const matchId = `r-${randomBytes(5).toString('hex')}`;
  const pa = store.getPlayer(a.key), pb = store.getPlayer(b.key);
  const entry = createEntry(matchId, [a.key, b.key], { mode: 'ranked' });
  entry.ranked = {
    ratings: [a.rating, b.rating],
    handles: [pa?.handle ?? a.handle, pb?.handle ?? b.handle],
    points: [pa?.points ?? 0, pb?.points ?? 0],
    fighters: [a.fighter, b.fighter],
  };

  const tell = (self: QueueEntry, selfSocket: Socket, other: QueueEntry, otherRow: ReturnType<Store['getPlayer']>) => {
    selfSocket.emit('queue:matched', {
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

  for (const [q, s] of [[a, sa], [b, sb]] as const) {
    s.data.matchId = matchId;
    s.data.queueMode = false;
    s.data.fighter = q.fighter;
    attach(entry, matchId, q.key, q.fighter, s);
  }
  console.log(`[ranked] ${matchId}: ${a.key} (${a.rating}) vs ${b.key} (${b.rating})`);
}

setInterval(() => {
  const now = Date.now();
  for (const e of matchmaker.expire(now)) {
    queue.delete(e.key);
    io.sockets.sockets.get(e.socketId)?.emit('queue:timeout', { waitedMs: now - e.joinedAt });
  }
  tryMatch();
  for (const e of matchmaker.all()) {
    const s = queue.get(e.key);
    if (s?.connected) s.emit('queue:state', { size: matchmaker.size, waitedMs: now - e.joinedAt });
  }
}, QUEUE_TICK_MS);

/* ------------------------------- connections ------------------------------- */
io.on('connection', (socket) => {
  const message = authMessage(randomBytes(16).toString('hex'));
  let addr = '', entry: Entry | undefined;  // entry only used during auth routing
  const take = bucket();

  socket.emit('auth_challenge', { message, dev: DEV });
  const authTimer = setTimeout(() => socket.disconnect(true), 15_000);

  socket.on('auth', async (p: {
    session?: string; address?: string; signature?: string; matchId?: string; fighter?: string;
    bot?: boolean; difficulty?: string; training?: boolean; queue?: boolean;
  } = {}) => {
    if (addr) return;
    const fail = (reason: string) => { socket.emit('auth_error', { reason }); socket.disconnect(true); };
    try {
      const fighter = isFighterId(p.fighter) ? p.fighter : 'ram';
      const difficulty: BotDifficulty = isBotDifficulty(p.difficulty) ? p.difficulty : 'normal';

      // 1. Identity: a signed session (X login) wins, then dev guests, then a wallet signature.
      const session = typeof p.session === 'string' && p.session.length > 0 ? codec.verify(p.session) : null;
      if (session) {
        addr = session.pid;
        const provider = addr.startsWith('x:') ? 'x' : 'guest';
        store.ensurePlayer(addr, provider, addr.slice(addr.indexOf(':') + 1), session.handle, session.av ?? null);
        socket.data.signedIn = true;
      } else if (DEV && typeof p.address === 'string' && p.address.startsWith('dev:')) {
        addr = p.address.slice(0, 40);
        store.ensurePlayer(addr, 'guest', addr, shortHandle(addr), null);
      } else if (typeof p.address === 'string' && p.signature && verifyLogin(p.address, message, p.signature)) {
        addr = getAddress(p.address);
      } else {
        return fail('sign in first');
      }
      clearTimeout(authTimer);

      // 2a. Queue socket: no room yet, the matchmaker pairs it later.
      if (p.queue) {
        socket.data.authed = true;
        socket.data.queueMode = true;
        socket.data.fighter = fighter;
        socket.emit('auth_ok', { address: addr, queue: true });
        socket.emit('profile', profileOf(addr));
        return;
      }

      // 2b. Room routing (dev codes, bot practice, or a staked match).
      const matchId = String(p.matchId ?? '').slice(0, 80);
      if (!matchId) return fail('bad auth request');
      socket.data.matchId = matchId;
      socket.data.fighter = fighter;

      if (DEV) entry = joinDev(matchId, addr, fighter, socket, !!p.bot, difficulty, !!p.training);
      else {
        let lock = lockCache.get(matchId);
        if (!lock) { lock = verifier!.waitForLocked(matchId); lockCache.set(matchId, lock); lock.catch(() => lockCache.delete(matchId)); }
        socket.emit('verifying_escrow', { matchId });
        const l = await lock;
        if (![l.player1, l.player2].includes(addr)) return fail('this wallet is not a player in that match');
        entry = entries.get(matchId) ?? createEntry(matchId, [l.player1, l.player2]);
      }
      if (!entry) return;                                           // dev lobby: waiting for an opponent
      attach(entry, matchId, addr, fighter, socket);
    } catch (e) { console.error('[auth]', e); fail('could not verify the match'); }
  });

  /* ----------------------------- ranked queue ----------------------------- */
  socket.on('queue:join', (p: { fighter?: string } = {}) => {
    if (!addr) { socket.emit('queue:error', { reason: 'not-authenticated' }); return; }
    // Ranked is account-only: guests can practice and use room codes, but not climb the ladder.
    if (!socket.data.signedIn) { socket.emit('queue:error', { reason: 'sign-in-required' }); return; }
    if (entries.has((socket.data.matchId as string) ?? '') && entries.get(socket.data.matchId as string)?.sockets.get(addr) === socket) {
      socket.emit('queue:error', { reason: 'in-match' }); return;
    }
    const fighter = isFighterId(p.fighter) ? p.fighter : (socket.data.fighter as string) ?? 'ram';
    if (matchmaker.has(addr)) { socket.emit('queue:error', { reason: 'already-queued' }); return; }

    const player = store.getPlayer(addr) ?? store.ensurePlayer(addr, addr.startsWith('x:') ? 'x' : 'guest', addr, shortHandle(addr), null);
    const res = matchmaker.join({
      key: addr, rating: player.rating, fighter, handle: player.handle,
      joinedAt: Date.now(), socketId: socket.id,
    });
    if (!res.ok) { socket.emit('queue:error', { reason: res.reason }); return; }

    queue.set(addr, socket);
    socket.data.fighter = fighter;
    socket.emit('queue:joined', { waitedMs: 0, size: matchmaker.size });
    socket.emit('queue:state', { size: matchmaker.size, waitedMs: 0 });
    tryMatch();
  });

  socket.on('queue:leave', () => {
    if (!addr) return;
    matchmaker.leave(addr);
    queue.delete(addr);
    socket.emit('queue:left', {});
  });

  /* ---------------------------- ladder on demand ---------------------------- */
  socket.on('leaderboard:get', (p: { limit?: number } = {}) => {
    const limit = Number.isFinite(Number(p.limit)) ? Number(p.limit) : 50;
    socket.emit('leaderboard:data', { players: store.leaderboard(limit), total: store.countPlayers() });
  });
  socket.on('profile:get', () => { if (addr) socket.emit('profile', profileOf(addr)); });

  socket.on('input', (payload) => {
    const en = entries.get(socket.data.matchId as string);          // resolved per packet: lobby players get their room later
    if (!en || !addr) return;
    if (!take()) { strike(socket, 'rate limit'); return; }
    en.room.pushInput(addr, payload);
  });

  socket.on('pause', (p: { paused?: boolean }) => {
    const en = entries.get(socket.data.matchId as string);
    if (en && addr) en.room.setPaused(!!p?.paused);
  });

  /* Practice room: change the dummy, or reset both fighters to spawn. */
  socket.on('training_dummy', (p: { dummy?: string }) => {
    const en = entries.get(socket.data.matchId as string);
    const d = p?.dummy;
    if (!en || !addr || !en.room.training) return;
    if (d === 'stand' || d === 'block' || d === 'jump' || d === 'jab' || d === 'walk') en.room.setTrainingDummy(d);
  });
  socket.on('training_reset', () => {
    const en = entries.get(socket.data.matchId as string);
    if (en && addr) en.room.trainingReset();
  });

  socket.on('disconnect', () => {
    if (addr) { matchmaker.leave(addr); queue.delete(addr); }
    const w = lobbies.get(socket.data.lobby);
    if (w) lobbies.set(socket.data.lobby, w.filter((j) => j.socket !== socket));
    const en = entries.get(socket.data.matchId as string);
    if (en && en.sockets.get(addr) === socket) en.room.markDisconnected(addr);              // ignore superseded sockets
  });
});

function profileOf(addr: string) {
  const p = store.getPlayer(addr);
  if (!p) return { pid: addr, handle: shortHandle(addr), avatar: null, points: 0, rating: 0, wins: 0, losses: 0, streak: 0, rank: 0, tier: 'Bronze' };
  return {
    pid: p.pid, handle: p.handle, avatar: p.avatar, points: p.points, rating: p.rating,
    wins: p.wins, losses: p.losses, streak: p.streak, rank: store.rankOf(p.pid), tier: tierOf(p.points),
  };
}

function attach(entry: Entry, matchId: string, addr: string, fighter: string, socket: Socket) {
  const old = entry.sockets.get(addr);
  if (old && old !== socket) old.disconnect(true);                  // newest connection wins (reconnect)
  entry.sockets.set(addr, socket);
  socket.join(`m:${matchId}`);
  // Queue sockets already authenticated: a second `auth_ok` would make clients re-run auth logic.
  if (!socket.data.authed) { socket.data.authed = true; socket.emit('auth_ok', { address: addr }); }
  entry.room.markConnected(addr, fighter);
}

/** DEV matchmaking: same room code pairs two players; ?bot=1 pairs you with the practice bot instantly. */
function joinDev(
  matchId: string, addr: string, fighter: string, socket: Socket,
  bot: boolean, difficulty: BotDifficulty = 'normal', training = false,
): Entry | undefined {
  const existing = entries.get(matchId);
  if (existing) { if (!existing.room.has(addr)) { socket.emit('auth_error', { reason: 'room is full' }); socket.disconnect(true); return; } return existing; }
  if (bot) {
    return createEntry(matchId, [addr, `dev:bot-${matchId}`], {
      botIndex: 1, difficulty: training ? 'rookie' : difficulty, mode: training ? 'training' : 'versus',
    });
  }
  const waiting = lobbies.get(matchId) ?? [];
  if (waiting.some((j) => j.addr === addr)) { socket.emit('auth_error', { reason: 'already waiting in this room' }); socket.disconnect(true); return; }
  socket.data.lobby = matchId;
  waiting.push({ addr, fighter, socket }); lobbies.set(matchId, waiting);
  if (waiting.length < 2) { socket.emit('auth_ok', { address: addr, waiting: true }); return; }
  lobbies.delete(matchId);
  const [a, b] = waiting;
  const e = createEntry(matchId, [a.addr, b.addr]);
  attach(e, matchId, a.addr, a.fighter, a.socket);
  e.sockets.set(a.addr, a.socket);
  return e;                                                         // caller attaches the second player
}

http.listen(PORT, () => console.log(`[boot] listening on :${PORT}${existsSync(DIST) ? ' (serving client/dist)' : ''}`));
