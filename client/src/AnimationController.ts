import * as THREE from 'three';
import { ATTACK_NAMES, type MoveName } from './moves';

export type AnimState =
  | 'Idle' | 'WalkForward' | 'WalkBackward'
  | 'JumpStart' | 'JumpApex' | 'Fall' | 'Land' | 'Jump' | 'Crouch' | 'Dash'
  | 'Block' | 'HitReact' | 'HitReactHigh' | 'HitReactLow' | 'Knockout' | 'GetUp' | 'Victory'
  | MoveName;

const ATTACKS: ReadonlySet<AnimState> = new Set<AnimState>(ATTACK_NAMES);
const REACTS: ReadonlySet<AnimState> = new Set<AnimState>(['HitReact', 'HitReactHigh', 'HitReactLow']);
const ONE_SHOT: ReadonlySet<AnimState> = new Set<AnimState>([
  ...ATTACK_NAMES, 'HitReact', 'HitReactHigh', 'HitReactLow', 'Knockout', 'Dash',
  'Land', 'GetUp', 'Victory',
]);

/** Blend time (s) when ENTERING a state. Attacks are snappy; locomotion is softer. */
const BLEND_IN: Record<AnimState, number> = {
  Idle: 0.18, WalkForward: 0.12, WalkBackward: 0.12,
  JumpStart: 0.06, JumpApex: 0.14, Fall: 0.14, Land: 0.05, Jump: 0.10,
  Crouch: 0.10, Dash: 0.05,
  Block: 0.08, HitReact: 0.03, HitReactHigh: 0.03, HitReactLow: 0.03,
  Knockout: 0.06, GetUp: 0.10, Victory: 0.12,
  LightPunch: 0.04, LightKick: 0.04, HeavyPunch: 0.05, HeavyKick: 0.05,
  Sweep: 0.05, AirPunch: 0.04, AirKick: 0.04, Spell: 0.06, Overdrive: 0.06, Grab: 0.06,
};

// Higher priority states cannot be interrupted by lower ones (except via `force`).
const PRIORITY: Record<AnimState, number> = {
  Idle: 0, WalkForward: 0, WalkBackward: 0,
  JumpStart: 1, JumpApex: 1, Fall: 1, Jump: 1, Land: 1, Crouch: 1, Block: 1,
  Dash: 2,
  LightPunch: 3, LightKick: 3, HeavyPunch: 3, HeavyKick: 3,
  Sweep: 3, AirPunch: 3, AirKick: 3, Spell: 3, Overdrive: 3, Grab: 3,
  HitReact: 4, HitReactHigh: 4, HitReactLow: 4, GetUp: 4, Victory: 4,
  Knockout: 5,
};

export class AnimationController {
  readonly mixer: THREE.AnimationMixer;
  private actions = new Map<AnimState, THREE.AnimationAction>();
  private current: AnimState = 'Idle';
  /** Smoothed vertical position, used to pick launch / float / fall without snapshot jitter. */
  private smoothY = 0;
  private lastY = 0;
  /** Called when a one-shot clip finishes naturally. */
  onAttackFinished?: () => void;

  constructor(model: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(model);
    for (const name of Object.keys(PRIORITY) as AnimState[]) {
      const clip = THREE.AnimationClip.findByName(clips, name);
      if (!clip) { console.warn(`Missing clip "${name}"`); continue; }
      const a = this.mixer.clipAction(clip);
      if (ONE_SHOT.has(name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      else a.setLoop(THREE.LoopRepeat, Infinity);
      this.actions.set(name, a);
    }
    this.mixer.addEventListener('finished', (e: any) => {
      const finished = [...this.actions.entries()].find(([, a]) => a === e.action)?.[0];
      if (!finished || finished !== this.current) return;
      // Transient clips hand control straight back; knockdowns and victory hold their pose.
      if (finished === 'Land' || finished === 'GetUp') { this.play('Idle', true); return; }
      if (finished === 'Victory') return;
      // Attacks and knockdowns hold their final pose until the server reports a new state.
      if (!ATTACKS.has(finished) && finished !== 'Knockout') this.onAttackFinished?.();
    });
    this.actions.get('Idle')?.play();
  }

  get state(): AnimState { return this.current; }
  get isAttacking() { return ATTACKS.has(this.current); }
  get isBusy() { return PRIORITY[this.current] >= 2; }

  /** Switch state with crossFadeTo. Returns false if blocked by a higher-priority state. */
  play(next: AnimState, force = false, tick = 0): boolean {
    if (next === this.current && !force) return true;
    if (!force && PRIORITY[next] < PRIORITY[this.current] && PRIORITY[this.current] >= 2) return false;
    const to = this.actions.get(next);
    const from = this.actions.get(this.current);
    if (!to) return false;

    to.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    if (from && from !== to) from.crossFadeTo(to, BLEND_IN[next], false);
    void tick;
    this.current = next;
    return true;
  }

  /**
   * Jump arc: launch pose while climbing out of the ground, tuck at the top, extended legs while
   * falling. Driven from the server's authoritative height.
   */
  airborne(y: number) {
    this.smoothY += (y - this.smoothY) * 0.45;
    const dy = y - this.lastY;
    this.lastY = y;
    const force = PRIORITY[this.current] >= 2;      // dash/attack -> jump must win
    if (dy < -0.004) this.play('Fall', force);
    else if (this.smoothY < 0.42) this.play('JumpStart', force);
    else this.play('JumpApex', force);
  }

  /** Touchdown: squash clip, then back to whatever locomotion asks for. */
  land() {
    this.lastY = 0; this.smoothY = 0;
    if (this.current === 'Land') return;
    this.play('Land', PRIORITY[this.current] >= 2);
  }

  /** Directional reaction picked from the height of the hit. */
  react(height: number) {
    const next: AnimState = height > 1.15 ? 'HitReactHigh' : height < 0.8 ? 'HitReactLow' : 'HitReact';
    this.play(next, true);
  }

  victory() { this.play('Victory', true); }
  getUp() { this.play('GetUp', true); }

  /** Map a server state string to the matching clip. Safe to call on every snapshot. */
  syncState(state: string, move: MoveName | null, tick = 0, y?: number) {
    // One-shot clips clamp on their final frame and keep a high priority. When the server says the
    // fighter is free again we must force our way out, otherwise HitReact/Knockout would stick.
    const forceInto = (next: AnimState) => PRIORITY[this.current] >= 2 && PRIORITY[next] < PRIORITY[this.current];
    switch (state) {
      case 'KNOCKDOWN': this.play('Knockout'); return;
      case 'GUARD_BREAK': this.play('HitReactHigh', true); return;   // shield shattered: full-body stagger
      case 'HITSTUN': if (!REACTS.has(this.current)) this.play('HitReact'); return;
      case 'BLOCKSTUN': case 'BLOCK': this.play('Block', forceInto('Block')); return;
      case 'DASH': this.play('Dash', forceInto('Dash')); return;
      case 'JUMP':
        if (y !== undefined) this.airborne(y);
        else this.play('Jump', forceInto('Jump'));
        return;
      case 'CROUCH': this.play('Crouch', forceInto('Crouch')); return;
      case 'WALK_FORWARD': this.play('WalkForward', forceInto('WalkForward')); return;
      case 'WALK_BACKWARD': this.play('WalkBackward', forceInto('WalkBackward')); return;
      case 'ATTACK_STARTUP': case 'ATTACK_ACTIVE': case 'ATTACK_RECOVERY':
        if (move && this.current !== move) this.play(move, true, tick);
        return;
      default:
        // Coming back from a knockdown: get up instead of snapping to the idle pose.
        if (this.current === 'Knockout' || this.current === 'GetUp') this.getUp();
        else this.play('Idle', forceInto('Idle'));
        return;
    }
  }

  /** Continuous locomotion; ignored while attacking / reacting. */
  setLocomotion(dir: -1 | 0 | 1, facing: 1 | -1, blocking: boolean, crouching = false, airborne = false) {
    if (this.isBusy) return;
    if (airborne) { this.play('Jump'); return; }
    if (crouching) { this.play('Crouch'); return; }
    if (blocking) { this.play('Block'); return; }
    if (dir === 0) this.play('Idle');
    else this.play(dir === facing ? 'WalkForward' : 'WalkBackward');
  }

  startAttack(name: MoveName, tick: number) { return this.play(name, true, tick); }

  /** Fit a clip's duration to the frame data so animation and hitbox windows agree. */
  fitClipToFrames(name: MoveName, total: number, fps = 60) {
    const a = this.actions.get(name);
    if (a) a.setDuration(total / fps);
  }

  /** Frames elapsed since the current one-shot began (60 fps). */
  attackFrame(fps = 60): number {
    const a = this.actions.get(this.current);
    return a ? Math.floor(a.time * fps / Math.max(a.timeScale, 1e-4)) : 0;
  }

  /** Hitstop: freeze animation mixer-wide (timeScale 0) or resume (1). */
  setFrozen(frozen: boolean) { this.mixer.timeScale = frozen ? 0 : 1; }

  update(dt: number) { this.mixer.update(dt); }
}
