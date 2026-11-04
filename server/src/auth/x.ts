/**
 * "Sign in with X" — OAuth 2.0 authorization-code flow with PKCE, run entirely on the server so the
 * access token never reaches the browser.
 *
 * Flow:
 *   1. GET /auth/x/start  → 302 to X with a one-time `state` + S256 code challenge.
 *   2. GET /auth/x/callback?code&state → exchange the code, read /2/users/me, hand back a profile.
 *   3. The server issues its own session token and redirects to `/#session=…` (a fragment, so the
 *      token is never sent to any server or logged in a referrer).
 *
 * When X is not configured (local dev), `mockProfile()` lets the whole login → ladder path run
 * without credentials, which is what the tests and the local build use.
 */

import { createHash, randomBytes } from 'node:crypto';

export interface XConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Force the mock even when credentials exist (useful for demos). */
  mock: boolean;
}

export interface XProfile {
  id: string;
  handle: string;
  avatar: string | null;
}

const STATES = new Map<string, { verifier: string; createdAt: number }>();
const STATE_TTL_MS = 10 * 60_000;
const AUTHORIZE = 'https://twitter.com/i/oauth2/authorize';
const TOKEN = 'https://api.twitter.com/2/oauth2/token';
const ME = 'https://api.twitter.com/2/users/me?user.fields=profile_image_url,username';

/** Credentials present and not forced into mock mode. */
export function xConfigured(cfg: XConfig): boolean {
  return !cfg.mock && cfg.clientId.length > 0;
}

/** Build the authorize URL and remember the PKCE verifier for the callback. */
export function beginXAuth(cfg: XConfig, now = Date.now()): { url: string; state: string } | null {
  if (!xConfigured(cfg)) return null;
  for (const [k, v] of STATES) if (now - v.createdAt > STATE_TTL_MS) STATES.delete(k);
  const state = randomBytes(16).toString('hex');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  STATES.set(state, { verifier, createdAt: now });

  const url = new URL(AUTHORIZE);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('scope', 'users.read');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return { url: url.toString(), state };
}

/** Exchange the code and read the profile. Returns null on any failure (state replay, X error, …). */
export async function finishXAuth(cfg: XConfig, code: string, state: string, now = Date.now()): Promise<XProfile | null> {
  const entry = STATES.get(state);
  STATES.delete(state);                          // one-shot: a replayed state can never be reused
  if (!entry || now - entry.createdAt > STATE_TTL_MS) return null;
  if (!code || code.length > 4096) return null;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
    code_verifier: entry.verifier,
    client_id: cfg.clientId,
  });
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (cfg.clientSecret) {
    headers.authorization = `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`;
  }

  try {
    const tokRes = await fetch(TOKEN, { method: 'POST', headers, body });
    if (!tokRes.ok) return null;
    const tok = await tokRes.json() as { access_token?: string };
    if (!tok.access_token) return null;

    const meRes = await fetch(ME, { headers: { authorization: `Bearer ${tok.access_token}` } });
    if (!meRes.ok) return null;
    const me = await meRes.json() as {
      data?: { id: string; username?: string; name?: string; profile_image_url?: string };
    };
    const d = me.data;
    if (!d?.id) return null;
    return {
      id: d.id,
      handle: (d.username || d.name || `x${d.id}`).slice(0, 20),
      avatar: d.profile_image_url ? d.profile_image_url.replace('_normal', '_400x400') : null,
    };
  } catch {
    return null;
  }
}

/**
 * Local-development identity. Stable per `as` value (default `devplayer`) so points persist between
 * logins instead of making a new account on every click.
 */
export function mockProfile(as?: string): XProfile {
  const name = (as || 'devplayer').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16) || 'devplayer';
  return { id: `mock-${name}`, handle: name, avatar: null };
}

/** Only for tests: clear pending states. */
export function _clearStates() { STATES.clear(); }
