/**
 * Cloudflare bindings + runtime flags (mirrors the env reading in server/src/server.ts).
 * Global DO/D1/WS types come from @cloudflare/workers-types (see tsconfig.json).
 */

export interface Env {
  ROOM: DurableObjectNamespace;
  QUEUE: DurableObjectNamespace;
  DB: D1Database;
  ASSETS: { fetch(request: Request): Promise<Response> };
  // vars
  DEV_MODE: string | boolean;
  // secrets
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  X_REDIRECT_URI?: string;
  SESSION_KEY?: string;
}

export const isDev = (env: Env) => env.DEV_MODE === 'true' || env.DEV_MODE === true;
