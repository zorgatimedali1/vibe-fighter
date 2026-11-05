/**
 * "Sign in with X" — WebCrypto port of `server/src/auth/x.ts`.
 *
 * Same OAuth 2.0 + PKCE flow, but stateless: the `state` cookie the server would have kept in
 * memory becomes an AES-GCM sealed token ({nonce, verifier, iat}) carried in the redirect URL
 * itself. The callback unseals it, which also proves it was minted by this worker (see sessions.ts).
 *
 * When X is not configured, `mockProfile()` gives a stable dev identity so the ladder is playable.
 */

import { sealState, unsealState } from './sessions.ts';
import { randomHex } from './sessions.ts';
import type { Env } from './types.ts';

export interface XProfile {
  id: string;
  handle: string;
  avatar: string | null;
}

const AUTHORIZE = 'https://twitter.com/i/oauth2/authorize';
const TOKEN = 'https://api.twitter.com/2/oauth2/token';
const ME = 'https://api.twitter.com/2/users/me?user.fields=profile_image_url,username';

export interface XConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Credentials present (checked by the caller, which decides mock mode from DEV_MODE). */
export function xConfigured(env: Env): boolean {
  return (env.X_CLIENT_ID ?? '').length > 0;
}

/** Build the authorize URL with a self-contained sealed state (nonce + PKCE verifier). */
export async function beginXAuth(env: Env, cfg: XConfig): Promise<string | null> {
  const nonce = randomHex(16);
  const verifier = randomHex(48);
  const challenge = b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));

  const url = new URL(AUTHORIZE);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('scope', 'users.read');
  url.searchParams.set('state', await sealState(env, { nonce, verifier, iat: Date.now() }));
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/** Exchange the code and read the profile. Returns null on any failure (bad state, X error, …). */
export async function finishXAuth(env: Env, cfg: XConfig, code: string, state: string): Promise<XProfile | null> {
  const unsealed = await unsealState(env, state);                   // one-shot by URL: no replay store needed
  if (!unsealed || !code || code.length > 4096) return null;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
    code_verifier: unsealed.verifier,
    client_id: cfg.clientId,
  });
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (cfg.clientSecret) {
    headers.authorization = `Basic ${btoa(`${cfg.clientId}:${cfg.clientSecret}`)}`;
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
 * Development identity. Stable per `as` value (default `devplayer`) so points persist between
 * logins instead of making a new account on every click.
 */
export function mockProfile(as?: string): XProfile {
  const name = (as || 'devplayer').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16) || 'devplayer';
  return { id: `mock-${name}`, handle: name, avatar: null };
}

function b64u(b: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(b)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
