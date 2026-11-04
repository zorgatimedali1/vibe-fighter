/**
 * Tiny synthesized SFX kit — no audio files, no network.
 * Everything is built from oscillators + a noise buffer so the whole soundtrack is a few hundred bytes.
 * Browsers require a user gesture before audio starts; `unlock()` is called from the first click/keypress.
 */

type HitKind = 'light' | 'heavy' | 'spell';

class Sfx {
  muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  constructor() {
    try { this.muted = localStorage.getItem('vf-muted') === '1'; } catch { /* private mode */ }
    addEventListener('pointerdown', this.unlock, { passive: true });
    addEventListener('keydown', this.unlock);
  }

  private unlock = () => {
    this.ensure();
    removeEventListener('pointerdown', this.unlock);
    removeEventListener('keydown', this.unlock);
  };

  setMuted(v: boolean) {
    this.muted = v;
    if (this.master) this.master.gain.value = v ? 0 : 0.5;
    try { localStorage.setItem('vf-muted', v ? '1' : '0'); } catch { /* ignore */ }
  }

  private ensure(): AudioContext | null {
    if (typeof AudioContext === 'undefined') return null;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private noise(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuf) return this.noiseBuf;
    const len = Math.floor(ctx.sampleRate * 0.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    return buf;
  }

  /** Filtered noise burst: the "crack" of an impact. */
  private burst(freq: number, dur: number, gain: number, type: BiquadFilterType = 'bandpass', q = 1) {
    const ctx = this.ensure(); if (!ctx || !this.master) return;
    const src = ctx.createBufferSource(); src.buffer = this.noise(ctx);
    const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  /** Pitched blip with an exponential decay. */
  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', slideTo?: number) {
    const ctx = this.ensure(); if (!ctx || !this.master) return;
    const osc = ctx.createOscillator(); osc.type = type;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  hit(kind: HitKind = 'light') {
    if (kind === 'light') {
      this.burst(2200, 0.09, 0.55, 'bandpass', 1.2);
      this.tone(150, 0.09, 0.35, 'sine', 70);
    } else if (kind === 'heavy') {
      this.burst(1200, 0.16, 0.7, 'bandpass', 0.8);
      this.tone(95, 0.18, 0.55, 'sine', 45);
      this.tone(320, 0.06, 0.18, 'square', 120);
    } else {
      this.burst(900, 0.3, 0.6, 'lowpass', 0.7);
      this.tone(70, 0.35, 0.5, 'sawtooth', 30);
    }
  }

  block() {
    this.burst(3400, 0.06, 0.4, 'highpass', 1);
    this.tone(520, 0.05, 0.16, 'square', 380);
  }

  whoosh() { this.burst(700, 0.14, 0.18, 'bandpass', 2.5); }

  spell() {
    this.tone(180, 0.45, 0.3, 'sawtooth', 900);
    this.burst(1600, 0.4, 0.35, 'bandpass', 1.5);
    this.tone(660, 0.3, 0.18, 'triangle', 1320);
  }

  ko() {
    this.tone(220, 0.9, 0.4, 'sawtooth', 40);
    this.burst(400, 0.7, 0.35, 'lowpass', 0.6);
  }

  beep(high = false) { this.tone(high ? 880 : 520, 0.12, 0.22, 'square'); }

  ui() { this.tone(640, 0.05, 0.12, 'square', 720); }
}

export const audio = new Sfx();
