/** Keyboard + Gamepad input with a 6-frame press buffer. Poll once per fixed 60 Hz tick. */

export const Action = {
  Left: 1 << 0, Right: 1 << 1, Up: 1 << 2, Down: 1 << 3,
  LightPunch: 1 << 4, LightKick: 1 << 5, HeavyPunch: 1 << 6, HeavyKick: 1 << 7,
  Block: 1 << 8, Spell: 1 << 9, Grab: 1 << 10, Dash: 1 << 11,
  Overdrive: 1 << 12,
} as const;
export type ActionBit = (typeof Action)[keyof typeof Action];

/** MUST match server/src/types/combat.ts. */
export const ACTION_MASK = 0b1111111111111;

/**
 * Default layout (rebindable later):
 *   move A/D · jump W · crouch S · J jab · K quick kick · I haymaker · U low kick
 *   L block · Q spell · E overdrive (EX) · H grab · Shift dash · S + U sweep · J/K in the air
 */
const KEYMAP: Record<string, number> = {
  KeyA: Action.Left, ArrowLeft: Action.Left,
  KeyD: Action.Right, ArrowRight: Action.Right,
  KeyW: Action.Up, ArrowUp: Action.Up,
  KeyS: Action.Down, ArrowDown: Action.Down,
  KeyJ: Action.LightPunch,
  KeyK: Action.LightKick,
  KeyI: Action.HeavyPunch,
  KeyU: Action.HeavyKick,
  KeyL: Action.Block,
  KeyQ: Action.Spell,
  KeyE: Action.Overdrive,
  KeyH: Action.Grab,
  ShiftLeft: Action.Dash, ShiftRight: Action.Dash,
};

const BUFFER_FRAMES = 6;
const DEADZONE = 0.35;
const PRESS_BITS = [
  Action.LightPunch, Action.LightKick, Action.HeavyPunch, Action.HeavyKick,
  Action.Spell, Action.Overdrive, Action.Grab, Action.Dash, Action.Up,
];

interface BufferedPress { bit: number; tick: number }

const typing = (e: Event) => {
  const t = e.target as HTMLElement | null;
  return !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
};

export class InputManager {
  private keys = 0;
  private prevHeld = 0;
  /** Presses that went down and up between two polls (or during hitstop) — never lose a tap. */
  private pressLatch = 0;
  private buffer: BufferedPress[] = [];
  /** Held bitmask for the most recent poll. */
  held = 0;
  /** Set when the browser loses focus so held keys cannot stick. */
  onBlur?: () => void;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (typing(e)) return;                       // lobby inputs (room codes, names) must accept keystrokes
      const b = KEYMAP[e.code];
      if (b === undefined) return;
      e.preventDefault();
      if (e.repeat) return;                        // auto-repeat is not a new press
      this.keys |= b;
      this.pressLatch |= b;
    });
    target.addEventListener('keyup', (e) => {
      if (typing(e)) return;
      const b = KEYMAP[e.code];
      if (b !== undefined) this.keys &= ~b;
    });
    target.addEventListener('blur', () => { this.keys = 0; this.prevHeld = 0; this.pressLatch = 0; this.buffer = []; this.onBlur?.(); });
  }

  private readPad(): number {
    let m = 0;
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad || !pad.connected) continue;
      const [ax = 0, ay = 0] = pad.axes;
      const b = (i: number) => !!pad.buttons[i]?.pressed;
      if (b(14) || ax < -DEADZONE) m |= Action.Left;
      if (b(15) || ax > DEADZONE) m |= Action.Right;
      if (b(12) || ay < -DEADZONE) m |= Action.Up;
      if (b(13) || ay > DEADZONE) m |= Action.Down;
      if (b(2)) m |= Action.LightPunch;                    // X / Square
      if (b(1)) m |= Action.LightKick;                     // B / Circle
      if (b(3)) m |= Action.HeavyPunch;                    // Y / Triangle
      if (b(0)) m |= Action.HeavyKick;                     // A / Cross
      if (b(5) || b(7)) m |= Action.Block;                 // RB / RT
      if (b(4)) m |= Action.Spell;                         // LB
      if (b(9)) m |= Action.Overdrive;                     // View / Back (EX)
      if (b(6)) m |= Action.Grab;                          // LT
      if (b(11)) m |= Action.Dash;                         // R3 click
    }
    return m;
  }

  /** Sample devices, record fresh presses into the buffer, return the held mask. */
  poll(tick: number): number {
    this.held = (this.keys | this.readPad()) & ACTION_MASK;
    const pressed = ((this.held & ~this.prevHeld) | this.pressLatch) & ACTION_MASK;
    this.pressLatch = 0;
    for (const bit of PRESS_BITS) if (pressed & bit) this.buffer.push({ bit, tick });
    this.prevHeld = this.held;
    this.buffer = this.buffer.filter((p) => tick - p.tick <= BUFFER_FRAMES);
    return this.held;
  }

  /** True (and consumes the press) if `bit` was pressed within the last 6 ticks. */
  consume(bit: ActionBit, tick: number): boolean {
    const i = this.buffer.findIndex((p) => p.bit === bit && tick - p.tick <= BUFFER_FRAMES);
    if (i < 0) return false;
    this.buffer.splice(i, 1);
    return true;
  }

  /** Peek without consuming (useful for chaining checks). */
  has(bit: ActionBit, tick: number): boolean {
    return this.buffer.some((p) => p.bit === bit && tick - p.tick <= BUFFER_FRAMES);
  }

  /** Drop every buffered press (round transitions, menus). */
  flush() { this.buffer = []; this.prevHeld = 0; this.pressLatch = 0; }
}
