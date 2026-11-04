/**
 * Practice-room overlay: dummy control, spawn reset, a live input history and the last exchange's
 * numbers. It is deliberately small and pointer-driven so it never fights the game for the keyboard.
 */

const CSS = `
.vf-train{position:fixed;right:14px;bottom:14px;z-index:13;display:flex;flex-direction:column;gap:8px;
  width:236px;padding:11px;border:3px solid #14100e;border-radius:12px;background:rgba(7,6,26,.9);
  color:#f7f2ea;font-family:'Archivo',system-ui,sans-serif;backdrop-filter:blur(8px);
  box-shadow:0 6px 0 rgba(7,6,26,.7),0 18px 40px rgba(0,0,0,.4);pointer-events:auto}
.vf-train h4{margin:0;font-family:'Bungee',Impact,system-ui,sans-serif;font-size:12px;letter-spacing:.08em;
  color:#d9ff3f;display:flex;justify-content:space-between;align-items:center}
.vf-train h4 span{font-family:'Archivo',system-ui,sans-serif;font-size:9px;letter-spacing:.1em;color:#8f97b8}
.vf-train-row{display:flex;gap:5px;flex-wrap:wrap}
.vf-train button{flex:1 1 auto;min-width:44px;padding:6px 7px;border:2.5px solid #14100e;border-radius:8px;
  background:#f7f2ea;color:#14100e;font:inherit;font-size:10px;font-weight:800;letter-spacing:.05em;
  text-transform:uppercase;cursor:pointer;box-shadow:0 3px 0 rgba(20,16,14,.6)}
.vf-train button:hover{background:#fff}
.vf-train button.on{background:#d9ff3f}
.vf-train button:active{transform:translateY(2px);box-shadow:none}
.vf-train .hint{font-size:10px;line-height:1.35;color:#a8b0c8;margin:0}
.vf-train .input{display:flex;gap:2px;min-height:20px;align-items:center;flex-wrap:wrap}
.vf-train .input i{font-style:normal;font-size:9px;font-weight:800;padding:2px 3px;border-radius:4px;
  background:rgba(247,242,234,.12);color:#d9d2c4;letter-spacing:.02em}
.vf-train .input i.now{background:#d9ff3f;color:#14100e}
.vf-train .readout{font-size:11px;font-weight:800;letter-spacing:.02em;color:#9ad7ff;min-height:15px}
.vf-train .readout b{color:#ffd166}
`;

const GLYPH: [number, string][] = [
  [1 << 0, '←'], [1 << 1, '→'], [1 << 2, '↑'], [1 << 3, '↓'],
  [1 << 4, 'J'], [1 << 5, 'K'], [1 << 6, 'I'], [1 << 7, 'U'],
  [1 << 8, 'BLK'], [1 << 9, 'Q'], [1 << 12, 'E'], [1 << 10, 'H'], [1 << 11, 'DASH'],
];

export type DummyMode = 'stand' | 'block' | 'jump' | 'jab' | 'walk';

export interface TrainingOptions {
  onDummy: (d: DummyMode) => void;
  onReset: () => void;
  onHitbox: (on: boolean) => void;
  hitboxOn?: boolean;
}

export class TrainingPanel {
  private el: HTMLElement;
  private inputEl!: HTMLElement;
  private readoutEl!: HTMLElement;
  private history: number[] = [];
  private hitbox = false;

  constructor(parent: HTMLElement, private opts: TrainingOptions) {
    if (!document.getElementById('vf-train-css')) {
      const s = document.createElement('style');
      s.id = 'vf-train-css'; s.textContent = CSS;
      document.head.appendChild(s);
    }
    this.hitbox = !!opts.hitboxOn;
    this.el = document.createElement('div');
    this.el.className = 'vf-train';
    this.el.innerHTML = `
      <h4>TRAINING <span>LAB</span></h4>
      <div class="vf-train-row">
        ${(['stand', 'block', 'jump', 'jab', 'walk'] as DummyMode[])
          .map((d) => `<button type="button" data-dummy="${d}" class="${d === 'stand' ? 'on' : ''}">${d}</button>`).join('')}
      </div>
      <div class="vf-train-row">
        <button type="button" data-act="reset">reset</button>
        <button type="button" data-act="hitbox" class="${this.hitbox ? 'on' : ''}">hitbox</button>
      </div>
      <div class="input"></div>
      <div class="readout">—</div>
      <p class="hint">Infinite mana &amp; EX. Tap L just before a hit to perfect-guard it.</p>`;
    parent.appendChild(this.el);

    this.inputEl = this.el.querySelector('.input')!;
    this.readoutEl = this.el.querySelector('.readout')!;

    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!t) return;
      if (t.dataset.dummy) {
        this.el.querySelectorAll<HTMLElement>('[data-dummy]').forEach((b) =>
          b.classList.toggle('on', b === t));
        this.opts.onDummy(t.dataset.dummy as DummyMode);
      } else if (t.dataset.act === 'reset') {
        this.opts.onReset();
        this.readoutEl.textContent = 'reset';
      } else if (t.dataset.act === 'hitbox') {
        this.hitbox = !this.hitbox;
        t.classList.toggle('on', this.hitbox);
        this.opts.onHitbox(this.hitbox);
      }
    });
  }

  /** Called once per fixed tick with the held action mask. */
  setInput(held: number) {
    this.history.push(held);
    if (this.history.length > 14) this.history.shift();
    const html: string[] = [];
    for (const mask of this.history) {
      const glyph = GLYPH.filter(([bit]) => mask & bit).map(([, g]) => g).join('') || '·';
      html.push(`<i class="${mask === held && mask ? 'now' : ''}">${glyph}</i>`);
    }
    this.inputEl.innerHTML = html.join('');
  }

  /** Show the numbers behind the last exchange. */
  event(text: string) { this.readoutEl.innerHTML = text; }

  dispose() { this.el.remove(); }
}
