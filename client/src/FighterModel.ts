import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import type { BoneKey, CharacterSpec } from './characters';
import { buildProceduralFighter } from './ProceduralFighter';

let loader: GLTFLoader | null = null;
function getLoader(): GLTFLoader {
  if (loader) return loader;
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
  loader = new GLTFLoader().setDRACOLoader(draco);
  return loader;
}

export type BoneMap = Record<BoneKey, THREE.Object3D>;

/** Loads a .glb, normalizes it to spec height, and caches the six anatomical anchors. */
export class FighterModel {
  readonly root = new THREE.Group();       // positioned by gameplay; facing is applied here
  readonly model: THREE.Object3D;
  readonly clips: THREE.AnimationClip[];
  readonly bones: BoneMap;
  facing: 1 | -1 = 1;

  private constructor(public spec: CharacterSpec, gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }) {
    this.model = gltf.scene;
    this.clips = gltf.animations;
    this.root.add(this.model);

    // Normalize scale so every fighter matches its spec height and stands on y = 0.
    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3());
    const s = spec.heightM / Math.max(size.y, 1e-4);
    this.model.scale.multiplyScalar(s);
    box.setFromObject(this.model);
    this.model.position.y -= box.min.y;
    this.model.position.x -= (box.min.x + box.max.x) / 2;
    this.model.position.z -= (box.min.z + box.max.z) / 2;

    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
    });
    this.root.updateMatrixWorld(true);
    this.bones = this.cacheBones();
  }

  static async load(spec: CharacterSpec): Promise<FighterModel> {
    // Procedural voxel fighters ship in the box. Set VITE_USE_GLB=1 to load /models/<id>.glb instead
    // (falls back to procedural if the file is missing or fails to parse).
    if (import.meta.env.VITE_USE_GLB === '1') {
      try { return new FighterModel(spec, await getLoader().loadAsync(spec.glb)); }
      catch (e) { console.warn(`[${spec.id}] GLB failed, using procedural model`, e); }
    }
    return new FighterModel(spec, buildProceduralFighter(spec.id));
  }

  /** Traverses SkinnedMesh skeletons (and plain nodes) to find bones; falls back to proxy anchors. */
  private cacheBones(): BoneMap {
    const found: Partial<BoneMap> = {};
    const keys = Object.keys(this.spec.boneNames) as BoneKey[];
    const visit = (o: THREE.Object3D) => {
      for (const k of keys) if (!found[k] && this.spec.boneNames[k].test(o.name)) found[k] = o;
    };
    this.model.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) (o as THREE.SkinnedMesh).skeleton.bones.forEach(visit);
      visit(o);
    });
    for (const k of keys) {
      if (found[k]) continue;
      console.warn(`[${this.spec.id}] bone "${k}" not found; using fallback anchor`);
      const proxy = new THREE.Object3D();
      proxy.name = `proxy_${k}`;
      // Anchors are specified in root space (meters); convert into the model's local space.
      const [x, y, z] = this.spec.fallbackAnchors[k];
      const mp = this.model.position, sc = this.model.scale.x;
      proxy.position.set((x - mp.x) / sc, (y - mp.y) / sc, (z - mp.z) / sc);
      this.model.add(proxy);
      found[k] = proxy;
    }
    return found as BoneMap;
  }

  /** Side view: +x faces right. The model is assumed to face +Z in its bind pose. */
  setFacing(dir: 1 | -1) {
    this.facing = dir;
    this.root.rotation.y = dir === 1 ? Math.PI / 2 : -Math.PI / 2;
  }

  get position() { return this.root.position; }
}
