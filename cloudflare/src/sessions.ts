/**
 * WebCrypto port of the server's session tokens (`server/src/auth/session.ts`).
 *
 * Same token format — `<base64url(json)>.<base64url(hmac-sha256)>` — so a session minted by the
 * Node dev server shape still works if the secret matches. The secret comes from the
 * SESSION_KEY secret (wrangler secret put SESSION_KEY).
 */

import type { Env } from './types.ts';

export interface SessionPayload {
  pid: string;
  handle: string;
  av?: string;
  iat: number;
  exp: number;
}

const te = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** Constant-time compare over equal-length byte arrays. */
function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export class SessionCodec {
  private ttlMs: number;
  constructor(private env: Env, ttlMs = 7 * 24 * 3600_000) {
    this.ttlMs = ttlMs;
  }
  private secret() { return this.env.SESSION_KEY || 'vf-dev-secret'; }

  async sign(p: { pid: string; handle: string; av?: string }, now = Date.now()): Promise<string> {
    const payload: SessionPayload = { ...p, iat: now, exp: now + this.ttlMs };
    const body = b64u(te.encode(JSON.stringify(payload)));
    const key = await hmacKey(this.secret());
    const mac = await crypto.subtle.sign('HMAC', key, te.encode(body));
    return `${body}.${b64u(mac)}`;
  }

  async verify(token: unknown, now = Date.now()): Promise<SessionPayload | null> {
    if (typeof token !== 'string' || token.length < 16 || token.length > 4096) return null;
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return null;
    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    try {
      const key = await hmacKey(this.secret());
      const expected = await crypto.subtle.sign('HMAC', key, te.encode(body));
      if (!safeEqual(fromB64u(sig), new Uint8Array(expected))) return null;
      const p = JSON.parse(new TextDecoder().decode(fromB64u(body))) as SessionPayload;
      if (!p || typeof p.pid !== 'string' || typeof p.handle !== 'string') return null;
      if (typeof p.exp !== 'number' || p.exp <= now) return null;
      return p;
    } catch {
      return null;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Stateless OAuth state: {nonce, verifier, iat} sealed with AES-GCM so
 * the callback can recover the PKCE verifier without server-side storage.
 * ------------------------------------------------------------------ */

const sealKey = async (secret: string) => {
  // SESSION_KEY may be any length (it's also the HMAC key); AES needs exactly 128/192/256 bits,
  // so derive a fixed 256-bit key from it.
  const bits = await crypto.subtle.digest('SHA-256', te.encode(secret));
  return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
};

export async function sealState(env: Env, value: { nonce: string; verifier: string; iat: number }): Promise<string> {
  const key = await sealKey(env.SESSION_KEY || 'vf-dev-secret');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(value)));
  return b64u(iv) + '.' + b64u(ct);
}

export async function unsealState(env: Env, token: string): Promise<{ nonce: string; verifier: string; iat: number } | null> {
  try {
    const [ivs, cts] = token.split('.');
    if (!ivs || !cts) return null;
    const key = await sealKey(env.SESSION_KEY || 'vf-dev-secret');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64u(ivs) }, key, fromB64u(cts));
    const v = JSON.parse(new TextDecoder().decode(pt)) as { nonce: string; verifier: string; iat: number };
    // State older than 15 minutes (or from the future) is dead.
    if (Date.now() - v.iat > 15 * 60_000) return null;
    return v;
  } catch {
    return null;
  }
}

/** Random hex string (replaces node:crypto randomBytes). */
export function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
