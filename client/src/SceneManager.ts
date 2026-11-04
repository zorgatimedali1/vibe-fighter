import * as THREE from 'three';
import { Stage, THEMES, type StageTheme } from './stage/Stages';

/**
 * Renderer, side-view fight camera (tracks midpoint, zooms with separation), themed arena lighting,
 * camera shake. The arena itself is a `Stage` that rebuilds whenever `applyTheme` is called.
 */
export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly stage: Stage;

  private lookAt = new THREE.Vector3(0, 1.0, 0);
  private camPos = new THREE.Vector3(0, 1.4, 7);
  private shakeT = 0; private shakeDur = 0; private shakeAmp = 0;
  private readonly baseFov = 38;
  private lobby = true; private lobbyT = 0;

  private hemi!: THREE.HemisphereLight;
  private key!: THREE.DirectionalLight;
  private rim!: THREE.DirectionalLight;
  private spotL!: THREE.SpotLight;
  private spotR!: THREE.SpotLight;
  private theme: StageTheme = THEMES.foundry;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.background = new THREE.Color(THEMES.castle.skyBottom);
    // Fog starts well behind the fighting plane: a tight range swallowed the whole backdrop into
    // one flat colour and made every arena read as a dark smear.
    this.scene.fog = new THREE.Fog(THEMES.castle.fog, 30, 130);

    this.camera = new THREE.PerspectiveCamera(this.baseFov, 1, 0.1, 100);
    this.camera.position.copy(this.camPos);

    this.stage = new Stage(this.scene);
    this.buildLights();
    this.applyTheme(THEMES.castle);
    addEventListener('resize', this.resize);
    this.resize();
  }

  private buildLights() {
    this.hemi = new THREE.HemisphereLight(0xdfeaff, 0x2b3a4a, 0.72);
    this.scene.add(this.hemi);

    this.key = new THREE.DirectionalLight(0xfff1d6, 2.4);
    this.key.position.set(-4, 9, 6); this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    Object.assign(this.key.shadow.camera, { left: -11, right: 11, top: 7, bottom: -4, near: 1, far: 32 });
    this.key.shadow.bias = -0.0004;
    this.scene.add(this.key);

    this.rim = new THREE.DirectionalLight(0x7fd9ff, 1.5);   // cool rim from behind for silhouette pop
    this.rim.position.set(5, 4, -6);
    this.scene.add(this.rim);

    this.spotL = new THREE.SpotLight(0xff9a4d, 60, 20, 0.62, 0.6);
    this.spotR = new THREE.SpotLight(0x6ee7d0, 60, 20, 0.62, 0.6);
    this.spotL.position.set(-6, 5, 3);
    this.spotR.position.set(6, 5, 3);
    this.spotL.target.position.set(-2, 1, 0);
    this.spotR.target.position.set(2, 1, 0);
    this.scene.add(this.spotL, this.spotL.target, this.spotR, this.spotR.target);
  }

  /** Rebuild the arena and recolor every light for the given stage theme. */
  applyTheme(theme: StageTheme) {
    this.theme = theme;
    this.stage.build(theme);
    (this.scene.background as THREE.Color).setHex(theme.skyBottom);
    (this.scene.fog as THREE.Fog).color.setHex(theme.fog);
    this.hemi.color.setHex(theme.skyBottom);
    this.hemi.groundColor.setHex(theme.groundTop);
    const li = theme.lights ?? { hemi: 0.78, key: 2.5, rim: 1.9 };
    this.hemi.intensity = li.hemi;
    this.key.color.setHex(theme.key);
    this.key.intensity = li.key;
    this.rim.color.setHex(theme.rim);
    this.rim.intensity = li.rim;
    this.spotL.color.setHex(theme.accent);
    this.spotR.color.setHex(theme.rim);
    this.spotL.intensity = this.spotR.intensity = 70;
  }

  get themeId() { return this.theme.id; }
  get themeName() { return this.theme.name; }

  /** Midpoint tracking + distance-based zoom. Call once per render frame. */
  updateCamera(p1: THREE.Vector3, p2: THREE.Vector3, dt: number) {
    this.lobby = false;
    const mid = p1.clone().add(p2).multiplyScalar(0.5);
    const sep = Math.abs(p1.x - p2.x);
    const halfW = Math.max(sep * 0.5 + 2.0, 3.2);              // keep both fighters + margin in frame
    const dist = halfW / (Math.tan(THREE.MathUtils.degToRad(this.baseFov / 2)) * this.camera.aspect);
    const target = new THREE.Vector3(mid.x, 1.4, THREE.MathUtils.clamp(dist, 5.5, 11));
    const k = 1 - Math.exp(-6 * dt);                            // frame-rate independent smoothing
    this.camPos.lerp(target, k);
    this.lookAt.lerp(new THREE.Vector3(mid.x, 1.0, 0), k);

    this.camera.position.copy(this.camPos);
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const f = Math.max(this.shakeT / this.shakeDur, 0) ** 2 * this.shakeAmp;
      this.camera.position.x += (Math.random() - 0.5) * f;
      this.camera.position.y += (Math.random() - 0.5) * f;
    }
    this.camera.lookAt(this.lookAt);
    this.stage.update(dt, this.camera.position.x);
  }

  /** Lobby mode: a slow 3/4 shot framing one fighter at origin. Call once per render frame while the lobby is up. */
  updateLobbyCamera(dt: number) {
    this.lobby = true;
    this.lobbyT += dt;
    const drift = Math.sin(this.lobbyT * 0.35) * 0.55;
    const target = new THREE.Vector3(drift, 1.55, 6.2);
    const k = 1 - Math.exp(-4 * dt);
    this.camPos.lerp(target, k);
    this.lookAt.lerp(new THREE.Vector3(0, 0.95, 0), k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.lookAt);
    this.stage.update(dt, this.camera.position.x);
  }

  /** True when no fight is running (drives lobby-only effects). */
  get isLobby() { return this.lobby; }

  shake(amplitude = 0.18, duration = 0.18) {
    this.shakeAmp = amplitude; this.shakeDur = duration; this.shakeT = duration;
  }

  render() { this.renderer.render(this.scene, this.camera); }

  private resize = () => {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };
}
