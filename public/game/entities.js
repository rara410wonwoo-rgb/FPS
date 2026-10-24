// Original soldier and item models (rounded boxes/capsules + PBR materials, procedural camo)
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { texSet } from './textures.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { ASSETS, modelParts } from './assets.js';

const GEO = {
  box: new RoundedBoxGeometry(1, 1, 1, 3, 0.2),
  hard: new RoundedBoxGeometry(1, 1, 1, 2, 0.08),
  sphere: new THREE.SphereGeometry(1, 24, 16),
  half: new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 14),
  ring: new THREE.RingGeometry(0.62, 0.8, 28),
  plane: new THREE.PlaneGeometry(1, 1),
};
GEO.ring.rotateX(-Math.PI / 2);

// Material kinds: cloth (camo fabric), gear (nylon kit), skin, metal, basic (for UI)
const matCache = new Map();
function mat(color, opts = {}) {
  const kind = opts.basic ? 'basic' : opts.kind ?? 'gear';
  const key = `${color}|${kind}|${opts.emissive ?? ''}|${opts.opacity ?? 1}`;
  if (!matCache.has(key)) {
    let m;
    if (kind === 'basic') {
      m = new THREE.MeshBasicMaterial({ color, transparent: !!opts.transparent, opacity: opts.opacity ?? 1, depthWrite: !opts.transparent, fog: false });
    } else if (kind === 'cloth') {
      const t = texSet('camo', 1.5, 1.5);
      m = new THREE.MeshStandardMaterial({ color, map: t.map, normalMap: t.normalMap, roughness: 0.95 });
    } else if (kind === 'skin') {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
    } else if (kind === 'metal') {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.85 });
    } else {
      const t = texSet('fabric', 2, 2);
      m = new THREE.MeshStandardMaterial({ color, normalMap: t.normalMap, roughness: 0.8, emissive: opts.emissive ?? 0x000000 });
    }
    matCache.set(key, m);
  }
  return matCache.get(key);
}
const CLOTH = { kind: 'cloth' };
const SKIN = { kind: 'skin' };
const METAL = { kind: 'metal' };

function part(geo, color, sx, sy, sz, x, y, z, parent, opts) {
  const m = new THREE.Mesh(geo, mat(color, opts));
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

// Desert camo palettes (original combinations that only borrow the mood of the references)
export const VARIANTS = [
  { name: 'trooper_a', shirt: 0xb8a57a, pants: 0xa8925f, vest: 0x6f6a4a, head: 'helmet', goggles: true, skin: 0xc99a76, pack: false },
  { name: 'trooper_b', shirt: 0xc2b28b, pants: 0x9e8a5c, vest: 0x8c7350, head: 'helmet', goggles: false, skin: 0xa87452, pack: true },
  { name: 'trooper_c', shirt: 0xa9a48f, pants: 0x8f8b76, vest: 0x4f4f45, head: 'mask', goggles: false, skin: 0xe0b48f, pack: true },
  { name: 'trooper_d', shirt: 0xb39c6e, pants: 0xa38c5e, vest: 0x5b5a3c, head: 'cap', goggles: false, skin: 0x8a5a3c, pack: false },
];

const GEAR = 0x3a3a36;
const BOOT = 0x2e2a24;
const SELF_BAND = 0x37d0e6;
const ENEMY_BAND = 0xe4572e;

function buildGun(type) {
  const g = new THREE.Group();
  const dark = 0x2b2c2a;
  const metal = 0x4b4d4a;
  const P = (geo, color, ...rest) => part(geo === GEO.box ? GEO.hard : geo, color, ...rest, color === metal ? METAL : undefined);
  if (type === 'breaker') {
    P(GEO.box, dark, 0.1, 0.12, 0.5, 0, 0, 0.05, g);
    P(GEO.cyl, metal, 0.04, 0.55, 0.04, 0.03, 0.02, 0.5, g).rotation.x = Math.PI / 2;
    P(GEO.cyl, metal, 0.04, 0.55, 0.04, -0.03, 0.02, 0.5, g).rotation.x = Math.PI / 2;
    P(GEO.box, 0x6b4a2b, 0.09, 0.1, 0.28, 0, -0.03, -0.32, g);
    P(GEO.box, 0x6b4a2b, 0.1, 0.08, 0.22, 0, -0.05, 0.38, g);
  } else if (type === 'hornet') {
    P(GEO.box, dark, 0.09, 0.12, 0.42, 0, 0, 0.05, g);
    P(GEO.cyl, metal, 0.03, 0.22, 0.03, 0, 0.02, 0.36, g).rotation.x = Math.PI / 2;
    P(GEO.box, dark, 0.06, 0.26, 0.08, 0, -0.17, 0.08, g);
    P(GEO.box, dark, 0.05, 0.06, 0.24, 0, 0.02, -0.26, g);
  } else {
    P(GEO.box, dark, 0.08, 0.11, 0.56, 0, 0, 0.06, g);
    P(GEO.cyl, metal, 0.028, 0.34, 0.028, 0, 0.02, 0.5, g).rotation.x = Math.PI / 2;
    P(GEO.box, dark, 0.06, 0.2, 0.09, 0, -0.14, 0.12, g);
    P(GEO.box, 0x3d3f3a, 0.07, 0.12, 0.26, 0, -0.01, -0.3, g);
    P(GEO.box, metal, 0.05, 0.05, 0.16, 0, 0.09, 0.04, g);
  }
  g.userData.muzzle = type === 'breaker' ? 0.78 : type === 'hornet' ? 0.48 : 0.68;
  return g;
}

export class Soldier {
  constructor(variantIndex, isSelf, scene) {
    const v = VARIANTS[variantIndex % VARIANTS.length];
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    const b = this.body;

    // legs (hip joints)
    this.legs = [-1, 1].map((s) => {
      const hip = new THREE.Group();
      hip.position.set(0.12 * s, 0.92, 0);
      part(GEO.box, v.pants, 0.2, 0.46, 0.23, 0, -0.22, 0, hip, CLOTH);
      part(GEO.box, v.pants, 0.18, 0.4, 0.21, 0, -0.62, 0, hip, CLOTH);
      part(GEO.box, GEAR, 0.17, 0.14, 0.07, 0, -0.45, 0.12, hip); // knee pad
      part(GEO.box, BOOT, 0.21, 0.13, 0.32, 0, -0.86, 0.04, hip);
      b.add(hip);
      return hip;
    });
    part(GEO.box, v.pants, 0.44, 0.2, 0.27, 0, 0.96, 0, b, CLOTH);
    part(GEO.box, GEAR, 0.46, 0.06, 0.29, 0, 1.05, 0, b); // belt
    part(GEO.box, v.shirt, 0.48, 0.55, 0.28, 0, 1.33, 0, b, CLOTH);
    part(GEO.box, v.vest, 0.54, 0.4, 0.34, 0, 1.36, 0, b);
    for (const x of [-0.16, 0, 0.16]) part(GEO.box, v.vest === 0x4f4f45 ? 0x3d3d35 : 0x5e5640, 0.13, 0.15, 0.08, x, 1.25, 0.19, b); // pouches
    part(GEO.cyl, v.skin, 0.08, 0.12, 0.08, 0, 1.6, 0, b, SKIN); // neck
    if (v.pack) part(GEO.box, 0x5a5440, 0.4, 0.42, 0.18, 0, 1.36, -0.25, b);

    // head
    const head = new THREE.Group();
    head.position.set(0, 1.76, 0);
    part(GEO.sphere, v.skin, 0.15, 0.18, 0.16, 0, 0, 0, head, SKIN);
    if (v.head === 'helmet') {
      part(GEO.half, 0x5d5a45, 0.2, 0.17, 0.21, 0, 0.02, 0, head);
      if (v.goggles) part(GEO.box, 0x1f2326, 0.24, 0.06, 0.06, 0, 0.1, 0.14, head);
    } else if (v.head === 'mask') {
      part(GEO.half, 0x4e4c40, 0.2, 0.17, 0.21, 0, 0.03, 0, head);
      part(GEO.box, 0x2a2b28, 0.2, 0.13, 0.08, 0, -0.04, 0.14, head);
      part(GEO.cyl, 0x3a3b36, 0.05, 0.08, 0.05, 0, -0.08, 0.2, head).rotation.x = Math.PI / 2;
      part(GEO.box, 0x1b1d1f, 0.17, 0.05, 0.03, 0, 0.04, 0.17, head);
    } else {
      part(GEO.half, 0x3f4136, 0.18, 0.12, 0.18, 0, 0.05, 0, head);
    }
    b.add(head);
    this.head = head;

    // arms (shoulder joints, holding the gun)
    const band = isSelf ? SELF_BAND : ENEMY_BAND;
    this.arms = [-1, 1].map((s) => {
      const sh = new THREE.Group();
      sh.position.set(0.31 * s, 1.52, 0);
      part(GEO.box, v.shirt, 0.15, 0.32, 0.15, 0, -0.15, 0, sh, CLOTH);
      part(GEO.box, band, 0.15, 0.07, 0.15, 0, -0.12, 0, sh); // team armband
      part(GEO.box, v.shirt, 0.13, 0.3, 0.13, 0, -0.42, 0.02, sh, CLOTH);
      part(GEO.box, 0x2f2c27, 0.12, 0.1, 0.12, 0, -0.6, 0.03, sh); // glove
      b.add(sh);
      return sh;
    });
    this.arms[0].rotation.set(-1.25, 0, 0.35);
    this.arms[1].rotation.set(-1.1, 0, -0.25);

    this.gunHolder = new THREE.Group();
    this.gunHolder.position.set(0.05, 1.28, 0.3);
    b.add(this.gunHolder);
    this.gunType = null;
    this.setWeapon('kestrel');

    if (isSelf) {
      const ring = new THREE.Mesh(GEO.ring, mat(SELF_BAND, { basic: true, transparent: true, opacity: 0.85 }));
      ring.position.y = 0.05;
      this.root.add(ring);
    }

    // health bar (enemies only, kept facing the camera)
    if (!isSelf) {
      this.hpBar = new THREE.Group();
      const bg = new THREE.Mesh(GEO.plane, mat(0x111111, { basic: true, transparent: true, opacity: 0.6 }));
      bg.scale.set(1.0, 0.12, 1);
      this.hpFill = new THREE.Mesh(GEO.plane, mat(0xe4572e, { basic: true }));
      this.hpFill.scale.set(0.96, 0.08, 1);
      this.hpFill.position.z = 0.001;
      this.hpBar.add(bg, this.hpFill);
      this.hpBar.position.y = 2.35;
      this.hpBar.renderOrder = 5;
      this.root.add(this.hpBar);
    }

    this.walkPhase = 0;
    this.recoil = 0;
    this.deadT = -1;
    this.isSelf = isSelf;
    scene.add(this.root);
  }

  setWeapon(type) {
    if (!type || type === this.gunType) return;
    this.gunHolder.clear();
    this.gun = buildGun(type);
    this.gunHolder.add(this.gun);
    this.gunType = type;
  }

  muzzleWorld(out) {
    out.set(0, 0, this.gun.userData.muzzle);
    return this.gun.localToWorld(out);
  }

  kick() { this.recoil = Math.min(1, this.recoil + 0.7); }

  update(dt, s, camQuat) {
    this.root.position.set(s.x, 0, s.z);
    this.root.rotation.y = Math.PI / 2 - s.aim; // face the model's front (+Z) toward the aim
    this.setWeapon(s.weapon);

    if (!s.alive) {
      if (this.deadT < 0) this.deadT = 0;
      this.deadT += dt;
      const k = Math.min(1, this.deadT / 0.45);
      this.body.rotation.x = -k * Math.PI / 2;
      this.body.position.y = k * 0.15;
      this.body.position.z = -k * 0.4;
      if (this.hpBar) this.hpBar.visible = false;
      this.root.visible = this.deadT < 6;
      return;
    }
    if (this.deadT >= 0) { this.deadT = -1; this.body.rotation.set(0, 0, 0); this.body.position.set(0, 0, 0); this.root.visible = true; }

    const speed = s.speed ?? 0;
    const k = Math.min(1, speed / 7);
    this.walkPhase += dt * (4 + speed * 1.3);
    const sw = Math.sin(this.walkPhase) * 0.75 * k;
    this.legs[0].rotation.x = sw;
    this.legs[1].rotation.x = -sw;
    this.body.position.y = Math.abs(Math.cos(this.walkPhase)) * 0.06 * k;

    this.recoil = Math.max(0, this.recoil - dt * 7);
    const r = this.recoil;
    const ads = s.ads ? 1 : 0;
    this.gunHolder.position.set(0.05, 1.28 + ads * 0.12, 0.3 - r * 0.12);
    this.arms[0].rotation.x = -1.25 - ads * 0.2 + r * 0.25 + sw * 0.08;
    this.arms[1].rotation.x = -1.1 - ads * 0.25 + r * 0.25 - sw * 0.08;
    this.body.rotation.x = -r * 0.06;
    this.gunHolder.rotation.z = s.reloading ? Math.sin(performance.now() / 120) * 0.5 : 0;
    this.gunHolder.rotation.x = s.reloading ? 0.5 : 0;
    this.head.rotation.x = ads * 0.15;

    if (this.hpBar) {
      this.hpBar.visible = s.hp < 100 && s.showBar;
      this.hpBar.quaternion.copy(camQuat);
      this.hpBar.quaternion.premultiply(new THREE.Quaternion().copy(this.root.quaternion).invert());
      const f = Math.max(0, s.hp / 100);
      this.hpFill.scale.x = 0.96 * f;
      this.hpFill.position.x = -(0.96 - 0.96 * f) / 2;
    }
  }

  dispose(scene) { scene.remove(this.root); }
}

const ITEM_COLORS = { medkit: 0xf2f0ea, ammo: 0x5b6038, crate: 0x2f4a33 };
const RING_COLORS = { medkit: 0x5be37a, ammo: 0xf0c34a, crate: 0x6fb3ff };

export class ItemView {
  constructor(item, scene) {
    this.root = new THREE.Group();
    this.inner = new THREE.Group();
    this.root.add(this.inner);
    const modelName = { medkit: 'medical_box', ammo: 'ammo_box', crate: 'wooden_military_crate' }[item.t];
    const info = ASSETS.models[modelName] ? modelParts(modelName) : null;
    if (info) {
      // photoreal prop model: scale to the target size
      const target = { medkit: 0.75, ammo: 0.7, crate: 1.1 }[item.t];
      const k = target / Math.max(info.size.x, info.size.z, info.size.y);
      const m = ASSETS.models[modelName].clone();
      m.scale.setScalar(k);
      m.position.set(-info.center.x * k, -info.box.min.y * k - 0.35, -info.center.z * k);
      m.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
      this.inner.add(m);
    } else if (item.t === 'medkit') {
      part(GEO.box, ITEM_COLORS.medkit, 0.6, 0.35, 0.45, 0, 0, 0, this.inner);
      part(GEO.box, 0xd23b2e, 0.36, 0.37, 0.1, 0, 0, 0, this.inner);
      part(GEO.box, 0xd23b2e, 0.1, 0.37, 0.3, 0, 0, 0, this.inner);
    } else if (item.t === 'ammo') {
      part(GEO.box, ITEM_COLORS.ammo, 0.6, 0.32, 0.38, 0, 0, 0, this.inner);
      for (let i = 0; i < 4; i++) part(GEO.cyl, 0xd4a63c, 0.04, 0.22, 0.04, -0.2 + i * 0.13, 0.26, 0, this.inner);
    } else {
      part(GEO.box, ITEM_COLORS.crate, 1.0, 0.36, 0.42, 0, 0, 0, this.inner);
      part(GEO.box, 0xe0b23a, 1.02, 0.08, 0.44, 0, 0.06, 0, this.inner);
    }
    this.inner.position.y = 0.5;
    const ring = new THREE.Mesh(GEO.ring, mat(RING_COLORS[item.t], { basic: true, transparent: true, opacity: 0.7 }));
    ring.position.y = 0.04;
    this.root.add(ring);
    this.root.position.set(item.x, 0, item.z);
    this.phase = (item.id * 1.3) % 6;
    scene.add(this.root);
  }

  update(dt) {
    this.phase += dt;
    this.inner.position.y = 0.5 + Math.sin(this.phase * 2.2) * 0.08;
    this.inner.rotation.y += dt * 0.9;
  }

  dispose(scene) { scene.remove(this.root); }
}

// ───────────────────────── Animated soldier (Quaternius CC0 model) ─────────────────────────

// Camo palettes: [base, blotch 1, blotch 2]. Index 0 is my character (urban blue digital), the rest are enemy variants
const CAMO = [
  [0x7f8a99, 0x4d5a6c, 0x2e3542],
  [0xb3a07a, 0x8a7550, 0x5a4c34],
  [0x6f7550, 0x4f5536, 0x34382a],
  [0x8c8c86, 0x5f605c, 0x3a3b38],
  [0x9a8c6e, 0x6a5f47, 0x48402f],
];
const WEAPON_NODE = { kestrel: 'AK', hornet: 'SMG', breaker: 'Shotgun' };
const ALL_WEAPON_NODES = ['Revolver', 'Sniper', 'Revolver_Small', 'Pistol', 'SMG', 'GrenadeLauncher', 'ShortCannon', 'Shotgun', 'Sniper_2', 'RocketLauncher', 'AK', 'Shovel', 'Knife_1', 'Knife_2'];

// Draw a three-color camo pattern on clothing with object-space noise (sticks to the body even without UVs)
function camoMaterial(base, palette, seed, scale = 9) {
  const m = base.clone();
  m.roughness = 0.92;
  m.metalness = 0;
  m.color.set(0xffffff);
  const cols = palette.map((c) => new THREE.Color(c));
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uC0 = { value: cols[0] };
    sh.uniforms.uC1 = { value: cols[1] };
    sh.uniforms.uC2 = { value: cols[2] };
    sh.uniforms.uSeed = { value: seed };
    sh.uniforms.uScale = { value: scale };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', /* glsl */`#include <common>
        varying vec3 vObj; uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform float uSeed; uniform float uScale;
        float cH(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7)) + uSeed) * 43758.5453); }
        float cN(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(cH(i), cH(i + vec3(1,0,0)), f.x), mix(cH(i + vec3(0,1,0)), cH(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(cH(i + vec3(0,0,1)), cH(i + vec3(1,0,1)), f.x), mix(cH(i + vec3(0,1,1)), cH(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
        {
          vec3 q = vObj * uScale;
          float a = cN(q) * 0.65 + cN(q * 2.7) * 0.35;
          float b = cN(q * 1.7 + 11.0) * 0.6 + cN(q * 4.0 + 3.0) * 0.4;
          vec3 camo = a > 0.56 ? uC1 : uC0;
          camo = b > 0.62 ? uC2 : camo;
          // fabric grain: subtle brightness variation
          camo *= 0.9 + 0.2 * cN(vObj * uScale * 14.0);
          diffuseColor.rgb *= camo;
        }`);
  };
  m.customProgramCacheKey = () => 'camo';
  return m;
}

export class ModelSoldier {
  constructor(variantIndex, isSelf, scene) {
    const src = ASSETS.soldier;
    this.root = new THREE.Group();
    this.body = SkeletonUtils.clone(src.scene);
    this.root.add(this.body);
    // Normalize visible geometry rather than bone endpoints: the head/helmet
    // extends beyond the last bone and previously produced a ~2.6m avatar.
    const head = this.body.getObjectByName('Head');
    if (head) head.scale.multiplyScalar(0.8);
    this.body.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.body, true);
    const height = bounds.max.y - bounds.min.y;
    const k = Number.isFinite(height) && height > 0 ? 1.8 / height : 1;
    this.body.scale.multiplyScalar(k);
    this.body.position.y = Number.isFinite(bounds.min.y) ? -bounds.min.y * k : 0;

    const palette = CAMO[isSelf ? 0 : 1 + (variantIndex % 4)];
    const seed = (variantIndex * 7.31) % 10;
    this.nodes = {};
    this.body.traverse((o) => {
      if (o.name) this.nodes[o.name] = o;
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
      const name = o.material?.name ?? '';
      if (name === 'Character_Main' || name === 'Pants') {
        // mesh coordinate scale differs per model, so size the pattern by mesh height (~7 blotches over the body)
        o.geometry.computeBoundingBox();
        const sz = o.geometry.boundingBox.getSize(new THREE.Vector3());
        const span = Math.max(sz.x, sz.y, sz.z) || 1;
        o.material = camoMaterial(o.material, name === 'Pants' ? palette.map((c) => new THREE.Color(c).multiplyScalar(0.85).getHex()) : palette, seed + (name === 'Pants' ? 3 : 0), 7 / span);
      } else if (o.material) {
        o.material = o.material.clone();
        // gear colors: helmet/kit = olive/sand, hands = tactical gloves
        const gear = { Grey: isSelf ? 0x4a5260 : 0x5c5f4c, Grey2: 0x6b6a5a, LightGrey: 0x8a8775, DarkGrey: 0x3a3c36, Skin: 0x2e2b26 }[name];
        if (gear !== undefined && !ALL_WEAPON_NODES.includes(o.parent?.name) && !ALL_WEAPON_NODES.includes(o.name)) o.material.color.set(gear);
        o.material.roughness = name === 'Skin' ? 0.75 : 0.5;
        o.material.metalness = /Grey|Black/.test(name) ? 0.35 : 0;
        o.material.envMapIntensity = 0.8;
      }
    });

    this.mixer = new THREE.AnimationMixer(this.body);
    this.actions = {};
    for (const clip of src.animations) {
      const short = clip.name.split('|').pop();
      this.actions[short] = this.mixer.clipAction(clip);
    }
    for (const n of ['Death', 'Jump', 'Jump_Land', 'HitReact']) {
      const a = this.actions[n];
      if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    }
    this.current = null;
    this.play('Idle_Shoot', 0, 0.0001);

    // health bar (enemies only)
    if (!isSelf) {
      this.hpBar = new THREE.Group();
      const bg = new THREE.Mesh(GEO.plane, mat(0x111111, { basic: true, transparent: true, opacity: 0.6 }));
      bg.scale.set(0.9, 0.09, 1);
      this.hpFill = new THREE.Mesh(GEO.plane, mat(0xe4572e, { basic: true }));
      this.hpFill.scale.set(0.86, 0.06, 1);
      this.hpFill.position.z = 0.001;
      this.hpBar.add(bg, this.hpFill);
      this.hpBar.position.y = 2.15;
      this.hpBar.renderOrder = 5;
      this.root.add(this.hpBar);
    }
    this.isSelf = isSelf;
    this.gunType = null;
    this.setWeapon('kestrel');
    this.shootT = 0;
    this.deadT = -1;
    this.prevY = 0;
    this.landT = 0;
    this.lean = 0;
    scene.add(this.root);
  }

  play(name, fade = 0.18, timeScale = 1) {
    const a = this.actions[name] ?? this.actions.Idle;
    a.timeScale = timeScale;
    if (this.current === a) return;
    a.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (this.current) this.current.fadeOut(fade);
    this.current = a;
  }

  setWeapon(type) {
    if (!type || type === this.gunType) return;
    this.gunType = type;
    for (const n of ALL_WEAPON_NODES) if (this.nodes[n]) this.nodes[n].visible = n === WEAPON_NODE[type];
    this.gun = this.nodes[WEAPON_NODE[type]] ?? null;
  }

  muzzleWorld(out) {
    if (this.gun) {
      this.gun.getWorldPosition(out);
      const a = this.aim ?? 0;
      out.x += Math.cos(a) * 0.55;
      out.z += Math.sin(a) * 0.55;
      out.y += 0.05;
      return out;
    }
    return out.set(this.root.position.x, 1.35, this.root.position.z);
  }

  kick() { this.shootT = 0.18; }

  update(dt, s, camQuat) {
    this.root.position.set(s.x, s.y ?? 0, s.z);
    this.aim = s.aim;
    this.setWeapon(s.weapon);
    this.mixer.update(dt);

    if (!s.alive) {
      if (this.deadT < 0) { this.deadT = 0; this.play('Death', 0.1); }
      this.deadT += dt;
      if (this.hpBar) this.hpBar.visible = false;
      this.root.visible = this.deadT < 8;
      return;
    }
    if (this.deadT >= 0) { this.deadT = -1; this.root.visible = true; }

    // detect backpedaling from movement vs aim direction
    const speed = s.speed ?? 0;
    const stance = s.stance ?? 0; // 0 standing 1 crouching 2 sliding 3 vaulting 4 airborne
    this.shootT = Math.max(0, this.shootT - dt);
    const firing = this.shootT > 0 || s.ads;
    let targetLean = 0;
    if (stance === 3) this.play('Jump', 0.08, 1.4);
    else if (stance === 4) this.play(this.current === this.actions.Jump && this.current.isRunning() ? 'Jump' : 'Jump_Idle', 0.12);
    else if (stance === 2) { this.play('Duck', 0.08, 2.2); targetLean = -0.5; }
    else if (stance === 1) this.play('Duck', 0.15, speed > 0.5 ? 1.4 : 0.6);
    // gun always shouldered (lowered only while sprinting)
    else if (speed > 0.6) this.play(s.sprint && !firing ? 'Run' : 'Run_Gun', 0.15, Math.max(0.6, speed / 7) * (s.sprint ? 1.2 : 1) * (s.backward ? -1 : 1));
    else this.play('Idle_Shoot', 0.2, firing ? 1 : 0.0001);
    // landing dip
    if ((this.prevY ?? 0) > 0.05 && (s.y ?? 0) <= 0.01) this.landT = 0.2;
    this.prevY = s.y ?? 0;
    this.landT = Math.max(0, this.landT - dt);

    this.lean += (targetLean - this.lean) * Math.min(1, dt * 10);
    this.root.rotation.set(0, Math.PI / 2 - s.aim, 0);
    this.body.rotation.x = this.lean;
    this.body.position.z = this.lean * 0.4;

    if (this.hpBar) {
      this.hpBar.visible = s.hp < 100 && s.showBar;
      this.hpBar.quaternion.copy(camQuat);
      this.hpBar.quaternion.premultiply(new THREE.Quaternion().copy(this.root.quaternion).invert());
      const f = Math.max(0, s.hp / 100);
      this.hpFill.scale.x = 0.86 * f;
      this.hpFill.position.x = -(0.86 - 0.86 * f) / 2;
    }
  }

  dispose(scene) {
    this.mixer.stopAllAction();
    scene.remove(this.root);
  }
}

// use the animated model if it loaded, otherwise the primitive soldier
export function createSoldier(variantIndex, isSelf, scene) {
  return ASSETS.soldier ? new ModelSoldier(variantIndex, isSelf, scene) : new Soldier(variantIndex, isSelf, scene);
}
