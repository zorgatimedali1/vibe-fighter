/**
 * Vibe Fighter worker — the single entry point on Cloudflare:
 *   • WS upgrades (`/ws`) → QueueDO (`?q=1`) or the per-match RoomDO (`?m=<matchId>`);
 *   • ladder API (`/api/leaderboard`, `/api/me`;
 *   • X login (`/auth/x/*`) with a mock identity when unconfigured;
 *   • everything else → the static client (SPA fallback through the ASSETS binding).
 */

import { SessionCodec } from './sessions.ts';
import { beginXAuth, finishXAuth, mockProfile, xConfigured } from './xauth.ts';
import { tierOf } from '../../server/src/rating.ts';
import { Store } from './store.ts';
import { RoomDO } from './room-do.ts';
import { QueueDO } from './queue-do.ts';
import { isDev, type Env } from './types.ts';

export { RoomDO, QueueDO };

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*', ...headers },
  });

const store = (env: Env) => new Store(env.DB as unknown as D1Database);

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'authorization, content-type',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
        },
      });
    }

    /* --------------------------------- health --------------------------------- */
    if (path === '/health') return new Response('ok');

    /* ------------------------------ WS routing ------------------------------ */
    if (path === '/ws') {
      if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return json({ error: 'expected a WebSocket upgrade' }, 426);
      }
      if (url.searchParams.get('q')) {                                 // ranked: singleton queue
        return env.QUEUE.get(env.QUEUE.idFromName('queue')).fetch(req);
      }
      // Every other match id (bot-, room codes, r- reroutes) is one RoomDO instance.
      const matchId = (url.searchParams.get('m') ?? '').slice(0, 80);
      return env.ROOM.get(env.ROOM.idFromName(matchId || 'default')).fetch(req);
    }

    /* ------------------------------- ladder API ------------------------------- */
    if (path === '/api/leaderboard') {
      const limit = Number(url.searchParams.get('limit') ?? 50);
      const [players, total] = await Promise.all([
        store(env).leaderboard(Number.isFinite(limit) ? limit : 50),
        store(env).countPlayers(),
      ]);
      return json({ players, total });
    }

    if (path === '/api/me') {
      const auth = req.headers.get('authorization');
      const token = auth?.startsWith('Bearer ') ? auth.slice(7) : url.searchParams.get('session');
      const s = await new SessionCodec(env).verify(token);
      if (!s) return json({ error: 'not signed in' }, 401);
      const p = await store(env).getPlayer(s.pid);
      if (!p) return json({ error: 'unknown player' }, 404);
      return json({
        pid: p.pid, handle: p.handle, avatar: p.avatar,
        points: p.points, rating: p.rating, wins: p.wins, losses: p.losses, streak: p.streak,
        bestStreak: p.bestStreak, rank: await store(env).rankOf(p.pid), tier: tierOf(p.points),
      });
    }

    /* --------------------------------- X login -------------------------------- */
    if (path === '/auth/x/start') {
      const as = url.searchParams.get('as') ?? undefined;
      // No credentials (or dev mode): mint a stable mock identity so the ladder is playable.
      if (isDev(env) || !xConfigured(env)) {
        return mockLogin(env, as);
      }
      const cfg = { clientId: env.X_CLIENT_ID!, clientSecret: env.X_CLIENT_SECRET ?? '', redirectUri: env.X_REDIRECT_URI ?? `${url.origin}/auth/x/callback` };
      const to = await beginXAuth(env, cfg);
      if (!to) return json({ error: 'X login is not configured' }, 500);
      return redirect(to);
    }

    if (path === '/auth/x/callback') {
      const code = url.searchParams.get('code') ?? '';
      const state = url.searchParams.get('state') ?? '';
      const denied = url.searchParams.get('error');
      if (denied || !code || !state) return redirect('/#auth=denied');
      const cfg = { clientId: env.X_CLIENT_ID!, clientSecret: env.X_CLIENT_SECRET ?? '', redirectUri: env.X_REDIRECT_URI ?? `${url.origin}/auth/x/callback` };
      const profile = await finishXAuth(env, cfg, code, state);
      if (!profile) return redirect('/#auth=failed');
      return mockLoginFor(env, profile);
    }

    /* ------------------------------ static client ------------------------------ */
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;

/* ------------------------------- helpers ------------------------------- */

/** Issue a session token for a resolved profile and bounce to `/#session=…` (never logged). */
async function mockLoginFor(env: Env, profile: { id: string; handle: string; avatar: string | null }): Promise<Response> {
  const pid = `x:${profile.id}`;
  await store(env).ensurePlayer(pid, 'x', profile.id, profile.handle, profile.avatar);
  const token = await new SessionCodec(env).sign({ pid, handle: profile.handle, av: profile.avatar ?? undefined });
  return redirect(`/#session=${encodeURIComponent(token)}`);
}

function mockLogin(env: Env, as?: string): Promise<Response> {
  return mockLoginFor(env, mockProfile(as));
}

const redirect = (to: string) => new Response(null, { status: 302, headers: { Location: to, 'cache-control': 'no-store' } });
