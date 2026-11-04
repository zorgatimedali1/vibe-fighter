import * as THREE from 'three';
import type { SpellTheme } from '../moves';

const CSS = `
.vf-fx{position:fixed;inset:0;pointer-events:none;z-index:12;overflow:hidden;
  font-family:'Archivo','Segoe UI',system-ui,sans-serif}
.vf-dmg{position:absolute;left:0;top:0;font-weight:800;font-size:22px;color:#fff;
  text-shadow:0 2px 0 #14100e,0 0 12px rgba(0,0,0,.55);transform:translate(-50%,-50%);
  animation:vfDmg .8s cubic-bezier(.2,1.4,.4,1) forwards;white-space:nowrap;letter-spacing:-.02em}
.vf-dmg.heavy{font-size:32px;color:#ffd166}
.vf-dmg.chip{font-size:15px;color:#9ad7ff}
.vf-dmg.gain{font-size:15px;color:#b6ff6a}
@keyframes vfDmg{0%{opacity:0;transform:translate(-50%,-50%) scale(.45)}
  18%{opacity:1;transform:translate(-50%,-72%) scale(1.28)}
  100%{opacity:0;transform:translate(-50%,-150%) scale(1)}}
.vf-combo{position:absolute;left:50%;top:15%;transform:translate(-50%,0) scale(.6);opacity:0;
  font-family:'Bungee','Impact',system-ui,sans-serif;color:#d9ff3f;-webkit-text-stroke:6px #14100e;
  paint-order:stroke fill;font-size:clamp(28px,5vw,54px);letter-spacing:.02em;white-space:nowrap}
.vf-combo.on{animation:vfCombo .95s cubic-bezier(.2,1.5,.4,1) forwards}
@keyframes vfCombo{0%{opacity:0;transform:translate(-50%,0) scale(.5)}
  20%{opacity:1;transform:translate(-50%,-6px) scale(1.15)}
  70%{opacity:1;transform:translate(-50%,-10px) scale(1)}
  100%{opacity:0;transform:translate(-50%,-44px) scale(.95)}}
.vf-flash{position:absolute;inset:0;opacity:0;background:#fff;mix-blend-mode:screen}
.vf-flash.on{animation:vfFlash .24s ease-out forwards}
@keyframes vfFlash{0%{opacity:.45}100%{opacity:0}}
.vf-spellname{position:absolute;left:50%;bottom:23%;transform:translate(-50%,0);opacity:0;
  font-family:'Bungee','Impact',system-ui,sans-serif;font-size:clamp(18px,3vw,30px);
  color:#fff;-webkit-text-stroke:5px #14100e;paint-order:stroke fill;letter-spacing:.04em;white-space:nowrap}
.vf-spellname.on{animation:vfSpell 1.15s cubic-bezier(.2,1.4,.4,1) forwards}
@keyframes vfSpell{0%{opacity:0;transform:translate(-50%,14px) scale(.8)}
  18%{opacity:1;transform:translate(-50%,0) scale(1.06)}
  70%{opacity:1;transform:translate(-50%,0) scale(1)}
  100%{opacity:0;transform:translate(-50%,-14px) scale(1)}}
`;

interface Particle { mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number; max: number; spin: number }
interface Ring { mesh: THREE.Mesh; life: number; max: number; grow: number; mat: THREE.MeshBasicMaterial }
interface Ghost { obj: THREE.Object3D; life: number; max: number; mat: THREE.MeshBasicMaterial }
interface Bolt { group: THREE.Group; theme: SpellTheme; last: THREE.Vector3; target: THREE.Vector3 }

/**
 * Juice layer: voxel sparks, impact rings, damage numbers, combo counters, screen flashes and
 * dash afterimages. Everything is pooled or time-boxed so a long match never leaks.
 */
export class Fx {
  private layer: HTMLElement;
  private dmgLayer: HTMLElement;
  private comboEl: HTMLElement;
  private flashEl: HTMLElement;
  private spellEl: HTMLElement;

  private group = new THREE.Group();
  private parts: Particle[] = [];
  private rings: Ring[] = [];
  private ghosts: Ghost[] = [];
  private bolts = new Map<number, Bolt>();
  private pool: THREE.Mesh[] = [];
  private readonly geo = new THREE.BoxGeometry(1, 1, 1);
  private readonly mats = new Map<number, THREE.MeshStandardMaterial>();

  constructor(scene: THREE.Scene, private camera: THREE.Camera, parent: HTMLElement) {
    if (!document.getElementById('vf-fx-css')) {
      const s = document.createElement('style'); s.id = 'vf-fx-css'; s.textContent = CSS;
      document.head.appendChild(s);
    }
    this.layer = document.createElement('div'); this.layer.className = 'vf-fx';
    this.dmgLayer = document.createElement('div'); this.dmgLayer.className = 'vf-fx';
    this.comboEl = document.createElement('div'); this.comboEl.className = 'vf-combo';
    this.flashEl = document.createElement('div'); this.flashEl.className = 'vf-flash';
    this.spellEl = document.createElement('div'); this.spellEl.className = 'vf-spellname';
    this.layer.append(this.flashEl, this.spellEl, this.dmgLayer, this.comboEl);
    parent.appendChild(this.layer);
    scene.add(this.group);
  }

  /* ------------------------------- helpers -------------------------------- */

  private mat(color: number) {
    let m = this.mats.get(color);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.75, roughness: 0.4, flatShading: true });
      this.mats.set(color, m);
    }
    return m;
  }

  private project(pos: THREE.Vector3) {
    const v = pos.clone().project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, visible: v.z < 1 };
  }

  /* ------------------------------- effects -------------------------------- */

  /** Voxel spark burst. `power` scales the spread, `size` the chunk size. */
  burst(pos: THREE.Vector3, color: number, count = 10, power = 3.2, size = 0.07, life = 0.45) {
    const m = this.mat(color);
    for (let i = 0; i < count; i++) {
      const mesh = this.pool.pop() ?? new THREE.Mesh(this.geo, m);
      mesh.material = m;
      mesh.scale.setScalar(size * (0.55 + Math.random() * 0.9));
      mesh.position.copy(pos);
      mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      this.group.add(mesh);
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.15) * Math.PI * 0.7;
      const sp = power * (0.35 + Math.random() * 0.75);
      this.parts.push({
        mesh, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + 1.2, vz: Math.sin(a) * Math.cos(e) * sp,
        life, max: life, spin: (Math.random() - 0.5) * 14,
      });
    }
  }

  /** Expanding shock ring facing the camera. */
  ring(pos: THREE.Vector3, color: number, size = 0.5, life = 0.35) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 28), mat);
    mesh.position.copy(pos);
    mesh.scale.setScalar(size);
    this.group.add(mesh);
    this.rings.push({ mesh, life, max: life, grow: size * 2.4, mat });
  }

  /** Fast horizontal slash streak. */
  slash(pos: THREE.Vector3, color: number, dir: 1 | -1, size = 1) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.9 * size, 0.12 * size), mat);
    mesh.position.copy(pos);
    mesh.rotation.z = dir * 0.5;
    this.group.add(mesh);
    this.rings.push({ mesh, life: 0.16, max: 0.16, grow: 0, mat });
  }

  /** Damage number projected to screen space. */
  damage(pos: THREE.Vector3, text: string, kind: 'normal' | 'heavy' | 'chip' | 'gain' = 'normal') {
    const p = this.project(pos);
    if (!p.visible) return;
    const el = document.createElement('div');
    el.className = `vf-dmg ${kind === 'normal' ? '' : kind}`;
    el.textContent = text;
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    this.dmgLayer.appendChild(el);
    setTimeout(() => el.remove(), 850);
  }

  /** "3 HIT COMBO" popup; only shows for 2+ hits. */
  combo(n: number) {
    if (n < 2) return;
    this.comboEl.textContent = `${n} HIT COMBO`;
    this.comboEl.classList.remove('on');
    void this.comboEl.offsetWidth;
    this.comboEl.classList.add('on');
  }

  spellName(text: string) {
    this.spellEl.textContent = text;
    this.spellEl.classList.remove('on');
    void this.spellEl.offsetWidth;
    this.spellEl.classList.add('on');
  }

  flash(strength = 1) {
    this.flashEl.style.background = strength > 1 ? '#fff' : 'rgba(255,255,255,.9)';
    this.flashEl.classList.remove('on');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('on');
  }

  /** Full impact package: sparks + ring + slash + flash + camera-ready damage number. */
  impact(pos: THREE.Vector3, color: number, opts: { heavy?: boolean; dir?: 1 | -1; text?: string; kind?: 'normal' | 'heavy' | 'chip' } = {}) {
    const heavy = !!opts.heavy;
    this.burst(pos, color, heavy ? 18 : 9, heavy ? 4.6 : 3.0, heavy ? 0.085 : 0.06);
    this.ring(pos, color, heavy ? 0.62 : 0.42, heavy ? 0.4 : 0.3);
    if (opts.dir) this.slash(pos, color, opts.dir, heavy ? 1.4 : 1);
    if (heavy) this.flash(1.2);
    if (opts.text) this.damage(pos, opts.text, opts.kind ?? (heavy ? 'heavy' : 'normal'));
  }

  /** Translucent clone left behind by a dash or a heavy swing. */
  ghost(model: THREE.Object3D, color: number, life = 0.22) {    const obj = model.clone(true);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if ((o as THREE.LineSegments).isLineSegments) { o.visible = false; return; }
      if (m.isMesh) m.material = mat;
    });
    // The clone shares the live transform hierarchy; copy world matrices once, then freeze it.
    model.updateWorldMatrix(true, true);
    obj.matrixAutoUpdate = false;
    obj.matrix.copy(model.matrixWorld);
    obj.matrixWorldNeedsUpdate = true;
    this.group.add(obj);
    this.ghosts.push({ obj, life, max: life, mat });
  }

  /* ------------------------------ spell casts ------------------------------ */

  /**
   * Release VFX, one silhouette per fighter. The spell's mechanics are shared, so this is pure
   * presentation: a slam shockwave, a crescent, a beam, a rising flame or a cyclone.
   */
  cast(kind: string, pos: THREE.Vector3, theme: SpellTheme, facing: 1 | -1) {
    switch (kind) {
      case 'ram': {                                    // Seismic Wave — ground slam
        const ground = pos.clone().setY(0.06);
        this.ring(ground, theme.trail, 0.72, 0.5);
        this.ring(ground, theme.core, 0.44, 0.38);
        for (let i = 0; i < 3; i++) {
          this.burst(ground.clone().add(new THREE.Vector3((i - 1) * 0.35, 0.02, 0)), theme.core, 7, 2.4 + i * 0.8, 0.075, 0.5);
        }
        this.slash(pos, theme.trail, facing, 1.2);
        break;
      }
      case 'cap': {                                    // Gale Slash — crescent arcs
        for (let i = 0; i < 3; i++) {
          this.slash(pos.clone().add(new THREE.Vector3(facing * i * 0.16, i * 0.14, 0)), i === 1 ? theme.core : theme.trail, facing, 1.7 - i * 0.35);
        }
        this.burst(pos, theme.trail, 20, 4.4, 0.07, 0.45);
        this.ring(pos, theme.core, 0.5, 0.3);
        break;
      }
      case 'antenna': {                                // Signal Beam — a lance of light
        this.beam(pos, theme, facing);
        this.ring(pos, theme.core, 0.42, 0.3);
        this.burst(pos, theme.core, 12, 2.0, 0.055, 0.35);
        break;
      }
      case 'mohawk': {                                 // Magma Fist — rising flame
        for (let i = 0; i < 5; i++) {
          this.burst(pos.clone().setY(pos.y + i * 0.16), i % 2 ? theme.core : theme.trail, 6, 1.7, 0.085, 0.62);
        }
        this.ring(pos.clone().setY(0.1), theme.trail, 0.5, 0.42);
        this.slash(pos, theme.core, facing, 1.1);
        break;
      }
      default: {                                       // Cyclone — stacked spinning rings
        for (let i = 0; i < 4; i++) {
          this.ring(pos.clone().setY(0.18 + i * 0.34), i % 2 ? theme.trail : theme.core, 0.46 + i * 0.1, 0.46);
        }
        this.burst(pos, theme.core, 18, 3.6, 0.07, 0.5);
        this.slash(pos.clone().setY(0.7), theme.trail, facing, 1.3);
        break;
      }
    }
  }

  /** Short-lived horizontal energy lance, as long as the spell's actual reach. */
  private beam(pos: THREE.Vector3, theme: SpellTheme, facing: 1 | -1) {
    const len = theme.reach ?? 2.8;
    const mat = new THREE.MeshBasicMaterial({
      color: theme.core, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, 0.14, 0.14), mat);
    mesh.position.copy(pos).add(new THREE.Vector3(facing * len / 2, 0, 0));
    this.group.add(mesh);
    this.rings.push({ mesh, life: 0.2, max: 0.2, grow: 0, mat });
    const shell = new THREE.MeshBasicMaterial({
      color: theme.trail, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const glow = new THREE.Mesh(new THREE.BoxGeometry(len + 0.3, 0.34, 0.34), shell);
    glow.position.copy(mesh.position);
    this.group.add(glow);
    this.rings.push({ mesh: glow, life: 0.16, max: 0.16, grow: 0, mat: shell });
  }

  /* ----------------------------- projectiles ------------------------------ */

  /** Create/update/remove the glowing voxel bolts from the latest snapshot. */
  syncBolts(list: { id: number; owner: number; x: number; y: number }[], themes: [SpellTheme, SpellTheme]) {
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.id);
      let bolt = this.bolts.get(p.id);
      if (!bolt) {
        const theme = themes[p.owner] ?? themes[0];
        const group = new THREE.Group();
        const core = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), this.mat(theme.core));
        const shell = new THREE.Mesh(
          new THREE.BoxGeometry(0.52, 0.52, 0.52),
          new THREE.MeshBasicMaterial({ color: theme.trail, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false }),
        );
        group.add(core, shell);
        this.group.add(group);
        bolt = { group, theme, last: new THREE.Vector3(p.x, p.y, 0), target: new THREE.Vector3(p.x, p.y, 0) };
        this.bolts.set(p.id, bolt);
      }
      bolt.target.set(p.x, p.y, 0);
      bolt.group.position.lerp(bolt.target, 0.55);
      bolt.group.rotation.x += 0.25;
      bolt.group.rotation.y += 0.18;
      if (bolt.last.distanceToSquared(bolt.target) > 0.02) {
        this.burst(bolt.target.clone(), bolt.theme.trail, 1, 0.8, 0.055, 0.28);
        bolt.last.copy(bolt.target);
      }
    }
    for (const [id, bolt] of this.bolts) {
      if (seen.has(id)) continue;
      this.burst(bolt.group.position.clone(), bolt.theme.core, 10, 2.6, 0.06, 0.3);
      this.ring(bolt.group.position.clone(), bolt.theme.trail, 0.4, 0.25);
      bolt.group.removeFromParent();
      this.bolts.delete(id);
    }
  }

  /* -------------------------------- update -------------------------------- */

  update(dt: number) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.removeFromParent();
        this.pool.push(p.mesh);
        this.parts.splice(i, 1);
        continue;
      }
      p.vy -= 11 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.mesh.rotation.x += p.spin * dt;
      p.mesh.rotation.y += p.spin * dt * 0.7;
      const k = Math.max(p.life / p.max, 0);
      p.mesh.scale.multiplyScalar(1 - dt * 1.2);
      void k;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) {
        r.mesh.removeFromParent();
        (r.mesh.geometry as THREE.BufferGeometry).dispose();
        r.mat.dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const k = r.life / r.max;
      r.mat.opacity = 0.9 * k;
      if (r.grow) r.mesh.scale.addScalar(r.grow * dt);
    }
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.life -= dt;
      if (g.life <= 0) {
        g.obj.removeFromParent();
        g.mat.dispose();
        this.ghosts.splice(i, 1);
        continue;
      }
      g.mat.opacity = 0.4 * (g.life / g.max);
    }
    // Bolts are authored at 30 Hz; ease them toward the latest authoritative position every frame.
    const k = 1 - Math.exp(-26 * dt);
    for (const b of this.bolts.values()) b.group.position.lerp(b.target, k);
  }

  dispose() {
    this.layer.remove();
    this.group.removeFromParent();
    for (const p of this.parts) p.mesh.removeFromParent();
    for (const r of this.rings) { r.mesh.removeFromParent(); r.mat.dispose(); }
    for (const g of this.ghosts) { g.obj.removeFromParent(); g.mat.dispose(); }
    for (const b of this.bolts.values()) b.group.removeFromParent();
    this.parts = []; this.rings = []; this.ghosts = []; this.bolts.clear();
  }
}
