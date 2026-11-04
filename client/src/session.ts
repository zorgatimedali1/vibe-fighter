/**
 * Client-side session handling for "Sign in with X".
 *
 * The server redirects back to `/#session=<token>`; the fragment never reaches a server, and we
 * strip it from the URL immediately so a screenshot or a shared link cannot leak it. The token is
 * signed by the server, so the client only decodes it for display — it never trusts it for
 * anything but presentation.
 */

const KEY = 'vf-session';

export interface SessionInfo {
  token: string;
  pid: string;
  handle: string;
  avatar?: string;
  /** True for the local mock login (no X credentials configured on the server). */
  mock: boolean;
}

function decode(token: string): SessionInfo | null {
  try {
    const body = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    const padded = body + '='.repeat((4 - (body.length % 4)) % 4);
    const json = JSON.parse(atob(padded)) as { pid?: unknown; handle?: unknown; av?: unknown; exp?: unknown };
    if (typeof json.pid !== 'string' || typeof json.handle !== 'string') return null;
    if (typeof json.exp === 'number' && json.exp * 1000 < Date.now()) return null;
    const pid = json.pid;
    return {
      token, pid, handle: json.handle,
      avatar: typeof json.av === 'string' ? json.av : undefined,
      mock: pid.startsWith('x:mock-'),
    };
  } catch { return null; }
}

/** Read `#session=…` / `#auth=…` from the URL, persist a valid session and clean the address bar. */
export function captureSession(): { session: SessionInfo | null; authError: string | null } {
  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  if (!hash) return { session: getSession(), authError: null };
  const params = new URLSearchParams(hash);
  const token = params.get('session');
  const authError = params.get('auth');
  let session = getSession();
  if (token) {
    const parsed = decode(token);
    if (parsed) { saveSession(token); session = parsed; }
  }
  history.replaceState(null, '', location.pathname + location.search);
  return { session, authError };
}

export function saveSession(token: string) {
  try { localStorage.setItem(KEY, token); } catch { /* private mode */ }
}

export function getSession(): SessionInfo | null {
  try {
    const token = localStorage.getItem(KEY);
    return token ? decode(token) : null;
  } catch { return null; }
}

export function clearSession() {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
}

/** Where to send the browser to start the OAuth dance (server-side, so the token never hits JS). */
export function signInUrl(server: string, as?: string) {
  return `${server.replace(/\/$/, '')}/auth/x/start${as ? `?as=${encodeURIComponent(as)}` : ''}`;
}

/**
 * Stable per-browser demo name for the server's mock login. Keeps your points across reloads on
 * this browser profile, while a second profile (or an incognito window) becomes a second account —
 * which is exactly what you need to test the ranked queue against someone. Ignored when real X
 * credentials are configured.
 */
export function mockName(): string {
  const KEY = 'vf-mock-name';
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return saved;
    const name = `player-${Math.random().toString(36).slice(2, 6)}`;
    localStorage.setItem(KEY, name);
    return name;
  } catch {
    return `player-${Math.random().toString(36).slice(2, 6)}`;
  }
}
