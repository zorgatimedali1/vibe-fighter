import * as THREE from 'three';
import type { BoxDims, HitName, HurtName } from './characters';
import type { FighterModel } from './FighterModel';

interface Volume {
  name: string;
  bone: THREE.Object3D;
  dims: BoxDims;
  box: THREE.Box3;           // world-space AABB, refreshed each frame
  helper: THREE.Box3Helper;
  active: boolean;           // hitboxes only; hurtboxes are always true
}

const _c = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * Bone-attached volumes. Each frame the box centre is `bone.localToWorld(offset)`, so volumes follow
 * the animation. World AABBs (not OBBs) keep the debug Box3Helper exactly equal to what is tested.
 */
export class HitboxSystem {
  readonly hurtboxes = new Map<HurtName, Volume>();
  readonly hitboxes = new Map<HitName, Volume>();
  private hasHitThisAttack = false;
  private _debug = false;

  constructor(scene: THREE.Scene, private fighter: FighterModel, debug = false) {
    const { spec, bones } = fighter;
    const hurtBone: Record<HurtName, THREE.Object3D> = {
      head: bones.Head, torso: bones.Spine, legL: bones.LeftFoot, legR: bones.RightFoot,
    };
    (Object.keys(hurtBone) as HurtName[]).forEach((n) =>
      this.hurtboxes.set(n, this.make(scene, n, hurtBone[n], spec.hurtboxes[n], 0x22ff66, true)));

    const hitBone: Record<HitName, THREE.Object3D> = {
      rightHand: bones.RightHand, leftHand: bones.LeftHand, rightFoot: bones.RightFoot,
    };
    (Object.keys(hitBone) as HitName[]).forEach((n) =>
      this.hitboxes.set(n, this.make(scene, n, hitBone[n], spec.hitboxes[n], 0xff2244, false)));

    this.debugMode = debug;
  }

  private make(scene: THREE.Scene, name: string, bone: THREE.Object3D, dims: BoxDims, color: number, active: boolean): Volume {
    const box = new THREE.Box3();
    const helper = new THREE.Box3Helper(box, color);
    helper.visible = false;
    scene.add(helper);
    return { name, bone, dims, box, helper, active };
  }

  get debugMode() { return this._debug; }
  set debugMode(v: boolean) { this._debug = v; this.refreshHelperVisibility(); }
  toggleDebug() { this.debugMode = !this._debug; }

  private refreshHelperVisibility() {
    this.hurtboxes.forEach((v) => (v.helper.visible = this._debug));
    // Inactive hitboxes are hidden even in debug so only live frames flash red.
    this.hitboxes.forEach((v) => (v.helper.visible = this._debug && v.active));
  }

  /** Enable exactly one hitbox (or none). Resets the one-hit-per-attack latch on activation. */
  setActiveHitbox(name: HitName | null) {
    let changed = false;
    this.hitboxes.forEach((v, k) => {
      const on = k === name;
      if (v.active !== on) changed = true;
      v.active = on;
    });
    if (changed && name) this.hasHitThisAttack = false;
    this.refreshHelperVisibility();
  }

  /** Refresh world AABBs from bone transforms. Call after the mixer update, every frame. */
  update() {
    this.fighter.root.updateMatrixWorld(true);
    const refresh = (v: Volume) => {
      const [ox, oy, oz] = v.dims.offset;
      _c.set(ox, oy, oz);
      v.bone.localToWorld(_c);                       // bone-local offset -> world centre
      // Dimensions are authored in world meters, independent of bone scale.
      _s.set(...v.dims.size);
      v.box.setFromCenterAndSize(_c, _s);
    };
    this.hurtboxes.forEach(refresh);
    this.hitboxes.forEach((v) => { if (v.active || this._debug) refresh(v); });
  }

  /** Returns the hurtbox struck by this attacker's active hitbox (once per attack), else null. */
  testHit(defender: HitboxSystem): HurtName | null {
    if (this.hasHitThisAttack) return null;
    for (const hit of this.hitboxes.values()) {
      if (!hit.active) continue;
      for (const [name, hurt] of defender.hurtboxes) {
        if (hit.box.intersectsBox(hurt.box)) { this.hasHitThisAttack = true; return name; }
      }
    }
    return null;
  }

  dispose(scene: THREE.Scene) {
    [...this.hurtboxes.values(), ...this.hitboxes.values()].forEach((v) => { scene.remove(v.helper); v.helper.dispose(); });
  }
}
