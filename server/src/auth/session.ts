/**
 * Signed session tokens for logged-in players.
 *
 * Format: `<base64url(json payload)>.<base64url(hmac-sha256)>`. The payload carries the player id,
 * the display handle and an expiry, so the client can render the name without a round trip while
 * the server still rejects anything it did not sign. The secret lives in `data/session.key`
 * (created on first boot, chmod 600) so sessions survive a dev restart.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SessionPayload {
  pid: string;
  handle: string;
  /** Avatar URL (X profile image), optional. */
  av?: string;
  iat: number;
  exp: number;
}

const b64 = (b: Buffer) => b.toString('base64url');

/** Read (or create) the HMAC key. Never throws: a fresh in-memory key is the fallback. */
export function loadSessionSecret(file: string): Buffer {
  try {
    if (existsSync(file)) {
      const raw = readFileSync(file);
      if (raw.length >= 32) return raw.subarray(0, 32);
    }
  } catch { /* fall through */ }
  const secret = randomBytes(32);
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, secret, { mode: 0o600 });
  } catch { /* read-only fs: keep the in-memory key */ }
  return secret;
}

export class SessionCodec {
  private secret: Buffer;
  private ttlMs: number;

  constructor(secret: Buffer, ttlMs = 7 * 24 * 3600_000) {
    this.secret = secret;
    this.ttlMs = ttlMs;
  }

  sign(p: { pid: string; handle: string; av?: string }, now = Date.now()): string {
    const payload: SessionPayload = { ...p, iat: now, exp: now + this.ttlMs };
    const body = b64(Buffer.from(JSON.stringify(payload)));
    return `${body}.${b64(this.mac(body))}`;
  }

  verify(token: string, now = Date.now()): SessionPayload | null {
    if (typeof token !== 'string' || token.length < 16 || token.length > 4096) return null;
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return null;
    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = b64(this.mac(body));
    // Constant-time compare, but compare equal-length buffers only.
    if (sig.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    try {
      const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
      if (!p || typeof p.pid !== 'string' || typeof p.handle !== 'string') return null;
      if (typeof p.exp !== 'number' || p.exp <= now) return null;
      return p;
    } catch { return null; }
  }

  private mac(body: string): Buffer {
    return createHmac('sha256', this.secret).update(body).digest();
  }
}
