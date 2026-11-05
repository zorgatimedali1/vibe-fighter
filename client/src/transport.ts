/**
 * Dual transport for the netcode layer.
 *
 * • Dev (Node server): socket.io — imported dynamically inside NetcodeClient; never bundled here.
 * • Production (Cloudflare): a thin native-WebSocket shim exposing the same minimal surface
 *   (`on`/`emit`/`disconnect`) that NetcodeClient already uses. Frames are `{e, p}` JSON, byte-for-byte
 *   what the RoomDurableObject/QueueDO servers wrap. socket.io's callback ack for `rtt` becomes a
 *   `rtt_ack` reply transparently.
 *
 * Ranked reroute: the queue lives in its own Durable Object; once it sends `queue:matched` the client
 * reopens the socket against the matched room. The shim keeps the registered handlers so the
 * authentication handshake simply replays on the new connection.
 */

export interface GameSocket {
  /** Accepts typed handlers — the same loose contract socket.io's `on` has. */
  on(ev: string, fn: (payload: any, ...args: any[]) => void): void;
  emit(ev: string, payload?: unknown): void;
  disconnect(): void;
  /** Native-WS only: swaps the underlying connection to a new room (ranked pairing). */
  onRerouteRequested?: (matchId: string) => void;
}

export class WSSocket implements GameSocket {
  onRerouteRequested?: (matchId: string) => void;

  private ws: WebSocket | null = null;
  /** Enqueue outbound frames until the socket opens (matches socket.io's buffered sends). */
  private outbox: string[] = [];
  private handlers = new Map<string, Array<(payload: any, ...rest: any[]) => void>>();
  private keepAlive = false;
  private matchId: string;
  private queue: boolean;
  private attempts = 0;

  constructor(private base: string, opts: { matchId: string; queue: boolean }) {
    this.base = base.replace(/^http(s?):/, 'ws$1:').replace(/\/+$/, '');
    this.matchId = opts.matchId;
    this.queue = opts.queue;
    this.open();
  }

  /** Switch to a different Durable Object room with zero handler churn. */
  reroute(opts: { matchId: string }) {
    this.matchId = opts.matchId;
    this.queue = false;
    this.open();
  }

  private url(): string {
    const q = this.queue ? ['q=1'] : [`m=${encodeURIComponent(this.matchId)}`];
    return `${this.base}/ws?${q.join('&')}`;
  }

  private open() {
    const previous = this.ws;
    if (previous) { this.keepAlive &&= false; try { previous.onclose = null; previous.close(1000, 'reroute'); } catch { /* gone */ } }
    const ws = new WebSocket(this.url());
    this.ws = ws;
    this.keepAlive = true;

    ws.onopen = () => {
      this.attempts = 0;
      for (const f of this.outbox.splice(0)) { try { ws.send(f); } catch { /* died next tick */ } }
    };
    ws.onmessage = (m) => {
      let frame: { e?: string; p?: unknown };
      try { frame = JSON.parse(String(m.data)); } catch { return; }
      if (!frame.e) return;
      for (const h of this.handlers.get(frame.e) ?? []) h(frame.p ?? {});
    };
    ws.onclose = (ev) => {
      this.ws = null;
      for (const h of this.handlers.get('disconnect') ?? []) h({});
      // Abnormal drop (mobile switch, NAP blip): one retry, then give up — matches the server's
      // reconnect-grace window plenty closely. Deliberate closes (1000) and auth rejects never retry.
      const retryable = this.keepAlive && ev.code !== 1000 && !(ev.code >= 4001 && ev.code <= 4004);
      if (retryable) {
        if (this.attempts < 3) {
          this.attempts++;
          setTimeout(() => { if (this.keepAlive) this.open(); }, 800 * this.attempts);
        }
      }
    };
    ws.onerror = () => {
      for (const h of this.handlers.get('connect_error') ?? []) h({});
    };
  }

  on(ev: string, fn: (payload: any, ...rest: any[]) => void): void {
    if (ev === 'rtt') {
      // socket.io's `rtt(t0, ack)` ⇒ the DO sends `{t0}` and expects an immediate `rtt_ack` reply.
      this.handlers.set('rtt', [(p: unknown) => {
        const { t0 } = p as { t0: number };
        this.emit('rtt_ack', { t0 });
        fn(t0);
      }]);
      return;
    }
    let list = this.handlers.get(ev);
    if (!list) { list = []; this.handlers.set(ev, list); }

    // Ranked queue: once paired, hop over to the room DO.
    if (ev === 'queue:matched') {
      list.push((p: any) => {
        fn(p);
        const matchId = (p as { matchId?: string }).matchId;
        const hop = this.onRerouteRequested;
        if (matchId && hop) setTimeout(() => hop(matchId), 400);
      });
    } else {
      list.push(fn);
    }
  }

  emit(ev: string, payload?: unknown): void {
    const frame = JSON.stringify({ e: ev, p: payload });
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(frame);
    else this.outbox.push(frame);
  }

  disconnect(): void {
    this.keepAlive = false;
    try { this.ws?.close(1000, 'client left'); } catch { /* already closed */ }
    this.ws = null;
  }
}
