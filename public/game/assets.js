// CC0 asset loader: Poly Haven textures, HDRI sky and prop models + Quaternius soldier model.
// Anything that fails to load falls back to procedural textures/primitives (the game keeps working).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const BASE = new URL('assets/', document.baseURI).href;

export const TEXTURE_NAMES = ['dirt_floor', 'sparse_grass', 'rocky_terrain_02', 'rock_face_03', 'plastered_wall_04', 'red_brick_03',
  'concrete_wall_008', 'asphalt_02', 'bark_brown_02', 'wood_planks_grey', 'corrugated_iron_02'];
export const MODEL_NAMES = ['boulder_01', 'rock_07', 'wooden_military_crate', 'covered_car', 'ammo_box', 'medical_box', 'shrub_02', 'Barrel_01'];
const HDRI = 'kloofendal_48d_partly_cloudy_puresky';

export const ASSETS = {
  tex: {},       // name → { map, normalMap, roughnessMap }
  models: {},    // name → THREE.Group (original; clone before use)
  soldier: null, // { scene, animations }
  hdr: null,     // DataTexture (equirect)
  sunDir: null,  // sun direction found in the HDRI
  loaded: false,
};

export function loadAssets(onProgress = () => {}) {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (url, done, total) => onProgress(done / total);
  const texLoader = new THREE.TextureLoader(manager);
  const gltfLoader = new GLTFLoader(manager);
  const hdrLoader = new HDRLoader(manager);
  const jobs = [];
  const tex = (url, srgb) => new Promise((resolve) => {
    texLoader.load(url, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 8;
      resolve(t);
    }, undefined, () => resolve(null));
  });

  for (const name of TEXTURE_NAMES) {
    jobs.push(Promise.all([
      tex(`${BASE}textures/${name}/diff.jpg`, true),
      tex(`${BASE}textures/${name}/nor.jpg`, false),
      tex(`${BASE}textures/${name}/rough.jpg`, false),
    ]).then(([map, normalMap, roughnessMap]) => { if (map) ASSETS.tex[name] = { map, normalMap, roughnessMap }; }));
  }
  for (const name of MODEL_NAMES) {
    jobs.push(new Promise((resolve) => {
      gltfLoader.load(`${BASE}models/${name}/${name}.gltf`, (g) => { ASSETS.models[name] = g.scene; resolve(); }, undefined, () => resolve());
    }));
  }
  jobs.push(new Promise((resolve) => {
    gltfLoader.load(`${BASE}models/soldier.glb`, (g) => { ASSETS.soldier = g; resolve(); }, undefined, () => resolve());
  }));
  jobs.push(new Promise((resolve) => {
    hdrLoader.load(`${BASE}hdri/${HDRI}.hdr`, (t) => {
      t.mapping = THREE.EquirectangularReflectionMapping;
      ASSETS.hdr = t;
      ASSETS.sunDir = findSun(t);
      resolve();
    }, undefined, () => resolve());
  }));
  return Promise.all(jobs).then(() => { ASSETS.loaded = true; return ASSETS; });
}

// Find the brightest pixel (the sun) in the HDRI so shadows match the sky.
function findSun(t) {
  const { data, width, height } = t.image;
  if (!data) return null;
  const half = data instanceof Uint16Array;
  const f = half ? THREE.DataUtils.fromHalfFloat : (v) => v;
  const ch = data.length / (width * height);
  let best = -1;
  let bi = 0;
  for (let y = 0; y < height / 2; y++) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * ch;
      const l = f(data[i]) + f(data[i + 1]) + f(data[i + 2]);
      if (l > best) { best = l; bi = y * width + x; }
    }
  }
  const u = (bi % width) / width;
  const v = Math.floor(bi / width) / height;
  // three.js equirectUv: u = atan2(z, x)/2π + 0.5, v (top row = zenith) → θ = πv
  const phi = (u - 0.5) * Math.PI * 2;
  const theta = v * Math.PI;
  const dir = new THREE.Vector3(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
  // clamp too-high/too-low suns to a pleasing range (shadow length)
  const el = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
  const clamped = THREE.MathUtils.clamp(el, THREE.MathUtils.degToRad(28), THREE.MathUtils.degToRad(58));
  const h = Math.cos(clamped);
  const l = Math.hypot(dir.x, dir.z) || 1;
  return new THREE.Vector3((dir.x / l) * h, Math.sin(clamped), (dir.z / l) * h).normalize();
}

// glTF model → parts for instancing [{geometry, material, matrix}] + original size
export function modelParts(name) {
  const root = ASSETS.models[name];
  if (!root) return null;
  root.updateMatrixWorld(true);
  const parts = [];
  const box = new THREE.Box3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    parts.push({ geometry: o.geometry, material: o.material, matrix: o.matrixWorld.clone() });
    o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  return { parts, box, size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()) };
}
