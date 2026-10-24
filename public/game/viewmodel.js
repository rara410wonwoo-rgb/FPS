// First-person weapon viewmodel: arms, gloves and three original guns. Drawn in camera space (viewScene).
// Walk bob, mouse-look sway, recoil, ADS, reload/swap animations, shell ejection, muzzle flash.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { texSet, flashSprite } from './textures.js';

const M = {};
function mats() {
  if (M.polymer) return M;
  const metal = texSet('metal');
  const camo = texSet('camo', 2, 2);
  const fabric = texSet('fabric', 3, 3);
  const wood = texSet('wood');
  M.polymer = new THREE.MeshStandardMaterial({ color: 0x232422, roughness: 0.55, metalness: 0.1, normalMap: fabric.normalMap, normalScale: new THREE.Vector2(0.15, 0.15) });
  M.tan = new THREE.MeshStandardMaterial({ color: 0x8f7d5b, roughness: 0.7, metalness: 0.05 });
  M.metal = new THREE.MeshStandardMaterial({ color: 0x3b3e40, roughness: 0.32, metalness: 0.92, roughnessMap: metal.roughnessMap, normalMap: metal.normalMap, normalScale: new THREE.Vector2(0.3, 0.3) });
  M.darkMetal = new THREE.MeshStandardMaterial({ color: 0x1c1d1e, roughness: 0.4, metalness: 0.85 });
  M.wood = new THREE.MeshStandardMaterial({ map: wood.map, normalMap: wood.normalMap, roughness: 0.6, color: 0xb08a60 });
  M.sleeve = new THREE.MeshStandardMaterial({ map: camo.map, normalMap: camo.normalMap, roughness: 0.95 });
  M.glove = new THREE.MeshStandardMaterial({ color: 0x2c2a26, roughness: 0.75, normalMap: fabric.normalMap, normalScale: new THREE.Vector2(0.4, 0.4) });
  M.lens = new THREE.MeshStandardMaterial({ color: 0x6a8a90, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.35 });
  M.dot = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.3, 0.2) });
  M.brass = new THREE.MeshStandardMaterial({ color: 0xc9a046, roughness: 0.25, metalness: 1 });
  return M;
}

function rbox(w, h, d, mat, x, y, z, r = 0.008) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2)), mat);
  m.position.set(x, y, z);
  return m;
}
function cyl(r, len, mat, x, y, z, seg = 14) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

// Gun models: barrel points -Z. userData records sight height, muzzle, ejection port and magazine
function buildWeapon(type) {
  const m = mats();
  const g = new THREE.Group();
  let mag;
  if (type === 'breaker') {
    g.add(rbox(0.05, 0.07, 0.26, m.darkMetal, 0, 0, 0));
    g.add(cyl(0.013, 0.62, m.metal, 0, 0.018, -0.42));
    g.add(cyl(0.012, 0.5, m.darkMetal, 0, -0.016, -0.36)); // tube magazine
    const pump = rbox(0.052, 0.045, 0.18, m.wood, 0, -0.016, -0.3, 0.012);
    g.add(pump);
    g.userData.pump = pump;
    const stock = rbox(0.045, 0.09, 0.26, m.wood, 0, -0.03, 0.25, 0.015);
    stock.rotation.x = 0.12;
    g.add(stock);
    const grip = rbox(0.04, 0.09, 0.05, m.wood, 0, -0.065, 0.11, 0.01);
    grip.rotation.x = 0.4;
    g.add(grip);
    g.add(rbox(0.008, 0.012, 0.012, m.dot, 0, 0.042, -0.7, 0.002)); // bead sight
    g.add(rbox(0.03, 0.012, 0.02, m.darkMetal, 0, 0.042, 0.07, 0.003));
    g.userData = { ...g.userData, sightY: 0.045, muzzle: new THREE.Vector3(0, 0.018, -0.74), eject: new THREE.Vector3(0.03, 0.01, -0.02), adsZ: -0.3 };
    mag = pump;
  } else if (type === 'hornet') {
    g.add(rbox(0.048, 0.07, 0.24, m.polymer, 0, 0, 0));
    g.add(rbox(0.05, 0.035, 0.2, m.darkMetal, 0, 0.045, -0.01, 0.004));
    g.add(rbox(0.044, 0.05, 0.12, m.polymer, 0, -0.005, -0.18, 0.01));
    g.add(cyl(0.012, 0.1, m.metal, 0, 0.012, -0.28));
    g.add(cyl(0.018, 0.12, m.darkMetal, 0, 0.012, -0.36)); // suppressor-style muzzle
    mag = rbox(0.03, 0.17, 0.045, m.polymer, 0, -0.11, -0.02, 0.006);
    g.add(mag);
    const grip = rbox(0.036, 0.09, 0.045, m.polymer, 0, -0.07, 0.08, 0.01);
    grip.rotation.x = 0.3;
    g.add(grip);
    g.add(rbox(0.012, 0.04, 0.2, m.darkMetal, 0.018, -0.01, 0.22, 0.004)); // folding stock frame
    g.add(rbox(0.012, 0.04, 0.2, m.darkMetal, -0.018, -0.01, 0.22, 0.004));
    g.add(rbox(0.05, 0.07, 0.02, m.polymer, 0, -0.01, 0.32, 0.006));
    // holo sight
    g.add(rbox(0.045, 0.006, 0.05, m.darkMetal, 0, 0.066, 0.0, 0.002));
    g.add(rbox(0.006, 0.04, 0.05, m.darkMetal, 0.021, 0.085, 0.0, 0.002));
    g.add(rbox(0.006, 0.04, 0.05, m.darkMetal, -0.021, 0.085, 0.0, 0.002));
    g.add(rbox(0.045, 0.006, 0.05, m.darkMetal, 0, 0.105, 0.0, 0.002));
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.036, 0.034), m.lens);
    lens.position.set(0, 0.086, -0.01);
    g.add(lens);
    const dot = new THREE.Mesh(new THREE.RingGeometry(0.0022, 0.0034, 20), m.dot);
    dot.position.set(0, 0.086, -0.012);
    g.add(dot);
    g.userData = { sightY: 0.086, muzzle: new THREE.Vector3(0, 0.012, -0.43), eject: new THREE.Vector3(0.028, 0.03, -0.02), adsZ: -0.22 };
  } else {
    // Kestrel assault rifle: upper/lower receiver, railed handguard, curved magazine, red dot
    g.add(rbox(0.05, 0.05, 0.3, m.darkMetal, 0, 0.022, -0.02, 0.005)); // upper
    g.add(rbox(0.046, 0.05, 0.22, m.polymer, 0, -0.025, 0.0)); // lower
    const hg = rbox(0.056, 0.06, 0.28, m.tan, 0, 0.01, -0.3, 0.012); // handguard
    g.add(hg);
    for (let i = 0; i < 6; i++) g.add(rbox(0.06, 0.01, 0.02, m.darkMetal, 0, 0.045, -0.2 - i * 0.035, 0.002)); // rail
    for (let i = 0; i < 4; i++) g.add(rbox(0.058, 0.012, 0.03, m.darkMetal, 0, -0.015, -0.22 - i * 0.05, 0.003)); // cooling slots
    g.add(cyl(0.011, 0.2, m.metal, 0, 0.018, -0.52));
    g.add(cyl(0.017, 0.06, m.darkMetal, 0, 0.018, -0.63)); // flash hider
    for (let i = 0; i < 3; i++) g.add(rbox(0.036, 0.004, 0.006, m.polymer, 0, 0.034, -0.61 - i * 0.012, 0.001));
    // curved magazine (three angled pieces)
    mag = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const p = rbox(0.032, 0.075, 0.06, m.polymer, 0, -0.035 - i * 0.065, -0.005 - i * i * 0.012, 0.006);
      p.rotation.x = -i * 0.18;
      mag.add(p);
    }
    mag.position.set(0, -0.03, -0.08);
    g.add(mag);
    const grip = rbox(0.036, 0.1, 0.048, m.polymer, 0, -0.08, 0.07, 0.012);
    grip.rotation.x = 0.35;
    g.add(grip);
    g.add(rbox(0.03, 0.022, 0.08, m.polymer, 0, -0.05, 0.02, 0.004)); // trigger guard
    // buffer tube + stock
    g.add(cyl(0.016, 0.14, m.darkMetal, 0, 0.012, 0.16));
    const stock = rbox(0.046, 0.085, 0.13, m.tan, 0, -0.008, 0.27, 0.014);
    g.add(stock);
    g.add(rbox(0.048, 0.09, 0.02, m.polymer, 0, -0.01, 0.34, 0.008));
    // red dot sight
    g.add(rbox(0.036, 0.012, 0.07, m.darkMetal, 0, 0.053, -0.04, 0.003));
    const housing = cyl(0.02, 0.06, m.darkMetal, 0, 0.078, -0.04, 18);
    g.add(housing);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.016, 20), m.lens);
    lens.position.set(0, 0.078, -0.008);
    g.add(lens);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0018, 10), m.dot);
    dot.position.set(0, 0.078, -0.066);
    g.add(dot);
    g.userData = { sightY: 0.078, muzzle: new THREE.Vector3(0, 0.018, -0.67), eject: new THREE.Vector3(0.028, 0.03, -0.03), adsZ: -0.2 };
  }
  g.userData.mag = mag;
  g.userData.magHome = mag.position.clone();
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return g;
}

// arm from shoulder to hand (sleeve + glove)
function buildArm(shoulder, hand) {
  const m = mats();
  const g = new THREE.Group();
  const dir = new THREE.Vector3().subVectors(hand, shoulder);
  const len = dir.length();
  const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, len * 0.75, 6, 12), m.sleeve);
  sleeve.position.y = len * 0.4;
  g.add(sleeve);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.04, 0.05, 12), m.glove);
  cuff.position.y = len * 0.82;
  g.add(cuff);
  const palm = rbox(0.06, 0.07, 0.085, m.glove, 0, len * 0.95, 0.01, 0.02);
  g.add(palm);
  const fingers = rbox(0.055, 0.035, 0.07, m.glove, 0, len * 0.97, 0.05, 0.015);
  fingers.rotation.x = 0.6;
  g.add(fingers);
  g.position.copy(shoulder);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return g;
}

export class ViewModel {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group(); // sway and recoil
    this.holder = new THREE.Group(); // weapon + arms
    this.root.add(this.holder);
    scene.add(this.root);
    this.type = null;
    this.weapon = null;
    this.hip = new THREE.Vector3(0.14, -0.15, -0.42);
    this.holder.scale.setScalar(0.82); // slightly smaller so it blocks less of the screen
    this.adsT = 0;
    this.bob = 0;
    this.bobAmt = 0;
    this.recoil = 0;
    this.recoilYaw = 0;
    this.sway = new THREE.Vector2();
    this.swapT = 0;
    this.reloadT = 0;
    this.visible = true;

    this.flashMat = new THREE.SpriteMaterial({ map: flashSprite(), color: new THREE.Color(5, 3.6, 2.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.flash = new THREE.Sprite(this.flashMat);
    this.flash.visible = false;
    this.flashLife = 0;
    this.light = new THREE.PointLight(0xffb060, 0, 2.5, 2);
    scene.add(this.light);

    const m = mats();
    const shellGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.022, 8);
    this.shells = Array.from({ length: 14 }, () => {
      const s = new THREE.Mesh(shellGeo, m.brass);
      s.visible = false;
      s.userData = { v: new THREE.Vector3(), life: 0, spin: new THREE.Vector3() };
      scene.add(s);
      return s;
    });
    this.si = 0;
    this.setWeapon('kestrel');
  }

  setWeapon(type) {
    if (!type || type === this.type) return;
    const first = this.type === null;
    this.type = type;
    this.holder.clear();
    this.weapon = buildWeapon(type);
    this.holder.add(this.weapon);
    this.weapon.add(this.flash);
    this.flash.position.copy(this.weapon.userData.muzzle);
    // right hand on the grip, left hand on the handguard/pump
    const gripZ = type === 'breaker' ? 0.11 : type === 'hornet' ? 0.08 : 0.07;
    const foreZ = type === 'breaker' ? -0.3 : type === 'hornet' ? -0.17 : -0.3;
    this.holder.add(buildArm(new THREE.Vector3(0.13, -0.36, 0.42), new THREE.Vector3(0.012, -0.09, gripZ + 0.01)));
    this.holder.add(buildArm(new THREE.Vector3(-0.26, -0.4, 0.2), new THREE.Vector3(-0.022, -0.045, foreZ)));
    if (!first) this.swapT = 1;
  }

  setVisible(v) {
    this.visible = v;
    this.root.visible = v;
    if (!v) { this.flash.visible = false; this.light.intensity = 0; for (const s of this.shells) s.visible = false; }
  }

  fire() {
    const kind = this.type;
    this.recoil = Math.min(1.4, this.recoil + (kind === 'breaker' ? 1.3 : kind === 'hornet' ? 0.38 : 0.5));
    this.recoilYaw = (Math.random() - 0.5) * (kind === 'breaker' ? 0.04 : 0.02);
    this.flash.visible = true;
    this.flashLife = 0.045;
    this.flash.material.rotation = Math.random() * Math.PI;
    const s = kind === 'breaker' ? 0.32 : 0.2;
    this.flash.scale.set(s * (0.8 + Math.random() * 0.5), s * (0.8 + Math.random() * 0.5), 1);
    this.light.intensity = 6;
    // eject a shell (shotgun: on pump)
    const sh = this.shells[this.si++ % this.shells.length];
    this.weapon.updateWorldMatrix(true, false);
    sh.position.copy(this.weapon.userData.eject).applyMatrix4(this.weapon.matrixWorld);
    sh.userData.v.set(0.9 + Math.random() * 0.5, 0.9 + Math.random() * 0.4, 0.2 + Math.random() * 0.2);
    sh.userData.spin.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
    sh.userData.life = 0.6;
    sh.visible = true;
    if (kind === 'breaker') this.pumpT = 0.55;
  }

  // muzzle position from camera space → world space (tracer start)
  muzzleWorld(camera, out) {
    this.weapon.updateWorldMatrix(true, false);
    out.copy(this.weapon.userData.muzzle).applyMatrix4(this.weapon.matrixWorld);
    return out.applyMatrix4(camera.matrixWorld);
  }

  update(dt, { ads = false, speed = 0, lookDX = 0, lookDY = 0, reloading = false, reloadProgress = 0, alive = true, sprint = false } = {}) {
    if (!this.visible) return;
    this.adsT += ((ads ? 1 : 0) - this.adsT) * Math.min(1, dt * 14);
    const a = this.adsT;
    const moving = Math.min(1, speed / 7);
    this.bobAmt += (moving - this.bobAmt) * Math.min(1, dt * 8);
    this.bob += dt * (6 + speed * 0.9);
    // mouse-look sway
    this.sway.x += (THREE.MathUtils.clamp(-lookDX * 0.0009, -0.05, 0.05) - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += (THREE.MathUtils.clamp(lookDY * 0.0009, -0.05, 0.05) - this.sway.y) * Math.min(1, dt * 10);
    this.recoil = Math.max(0, this.recoil - dt * (4 + this.recoil * 6));
    this.recoilYaw *= Math.exp(-dt * 12);
    this.swapT = Math.max(0, this.swapT - dt * 2.5);
    const r = this.recoil;
    const bobK = this.bobAmt * (1 - a * 0.85);

    const ud = this.weapon.userData;
    const adsPos = new THREE.Vector3(0, -ud.sightY, ud.adsZ);
    const pos = this.hip.clone().lerp(adsPos, a);
    pos.x += Math.sin(this.bob * 0.5) * 0.014 * bobK + this.sway.x * (1 - a * 0.7);
    pos.y += -Math.abs(Math.cos(this.bob * 0.5)) * 0.012 * bobK + this.sway.y * (1 - a * 0.7);
    pos.z += r * 0.05;
    // Reload: tilt and lower the gun, magazine out → in
    let reloadTilt = 0;
    if (reloading) {
      const p = reloadProgress;
      const k = Math.sin(Math.min(1, p) * Math.PI);
      reloadTilt = k;
      pos.y -= k * 0.06;
      const mag = ud.mag;
      if (mag && this.type !== 'breaker') {
        const out = p < 0.5 ? Math.min(1, p / 0.25) : Math.max(0, 1 - (p - 0.5) / 0.3);
        mag.position.copy(ud.magHome).add(new THREE.Vector3(0, -0.25 * out, 0.02 * out));
        mag.visible = out < 0.95;
      }
    } else if (ud.mag && this.type !== 'breaker') {
      ud.mag.position.copy(ud.magHome);
      ud.mag.visible = true;
    }
    if (this.type === 'breaker' && ud.pump) {
      this.pumpT = Math.max(0, (this.pumpT ?? 0) - dt);
      const k = this.pumpT > 0 && this.pumpT < 0.35 ? Math.sin((this.pumpT / 0.35) * Math.PI) : 0;
      ud.pump.position.z = -0.3 + k * 0.08;
    }
    // Swap: lower then raise
    pos.y -= this.swapT * 0.35;
    if (!alive) pos.y -= 0.6;
    if (sprint) pos.x += 0.02;

    this.root.position.copy(pos);
    this.root.rotation.set(
      r * 0.09 + this.sway.y * 0.6 + reloadTilt * 0.25 - this.swapT * 0.6,
      this.recoilYaw + this.sway.x * 0.8,
      reloadTilt * 0.7 + Math.sin(this.bob * 0.5) * 0.02 * bobK,
    );

    // muzzle flash and light
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      if (this.flashLife <= 0) this.flash.visible = false;
    }
    this.weapon.updateWorldMatrix(true, false);
    this.light.position.copy(ud.muzzle).applyMatrix4(this.weapon.matrixWorld);
    this.light.intensity = Math.max(0, this.light.intensity - dt * 160);

    for (const s of this.shells) {
      if (!s.visible) continue;
      const u = s.userData;
      u.life -= dt;
      u.v.y -= 6 * dt;
      s.position.addScaledVector(u.v, dt);
      s.rotation.x += u.spin.x * dt;
      s.rotation.y += u.spin.y * dt;
      s.rotation.z += u.spin.z * dt;
      if (u.life <= 0) s.visible = false;
    }
  }
}
