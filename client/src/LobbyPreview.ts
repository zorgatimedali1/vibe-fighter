import * as THREE from 'three';
import { CHARACTERS } from './characters';
import { FighterModel } from './FighterModel';
import { AnimationController } from './AnimationController';
import type { AnimState } from './AnimationController';

/**
 * Live 3D character preview for the lobby: one fighter idling on the arena,
 * swapped in place when the lobby selection changes. Hidden during a match.
 */
export class LobbyPreview {
  private group = new THREE.Group();
  private model: FighterModel | null = null;
  private anim: AnimationController | null = null;
  private loadedId: string | null = null;
  private seq = 0;

  constructor(scene: THREE.Scene, private onState?: (s: 'loading' | 'ready' | 'error') => void) {
    this.group.position.set(0, 0, 0);
    this.group.rotation.y = -0.42;                  // slight three-quarter face toward the camera
    scene.add(this.group);
  }

  /** Swap the displayed fighter. The previous model stays up until the new one resolves. */
  setFighter(id: string) {
    const spec = CHARACTERS[id];
    if (!spec || this.loadedId === id) { this.onState?.('ready'); return; }
    const mine = ++this.seq;
    this.onState?.('loading');
    FighterModel.load(spec).then((model) => {
      if (mine !== this.seq) return;                // a newer selection already claimed the slot
      if (this.anim) this.anim.mixer.stopAllAction();
      if (this.model) this.model.root.removeFromParent();
      this.model = model; this.loadedId = spec.id;
      this.group.add(model.root);
      this.anim = new AnimationController(model.model, model.clips);
      this.onState?.('ready');
    }).catch((e: unknown) => {
      console.warn(`[preview] ${id} failed to load`, e);
      if (mine === this.seq) this.onState?.('error');
    });
  }

  /** Play a one-off flourish (visible through the lobby stage). */
  play(name: Extract<AnimState, 'Block' | 'LightPunch' | 'HeavyKick'>) {
    this.anim?.play(name, true);
  }

  update(dt: number) { this.anim?.update(dt); }

  hide() { this.group.visible = false; }
  show() { this.group.visible = true; }

  dispose() {
    this.anim?.mixer.stopAllAction();
    this.model?.root.removeFromParent();
    this.group.removeFromParent();
  }
}
