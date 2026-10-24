// Visual effects (cosmetic only, no gameplay impact): HDR tracers, muzzle flash sprites, smoke, dust and sparks, bullet hole decals, blood.
import * as THREE from 'three';
import { radialSprite, flashSprite, bulletHoleTexture } from './textures.js';

const tmp = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

export class Effects {
  constructor(scene) {
    this.scene = scene;

    // Tracers: long light streaks. Colors above 1 so bloom picks them up
    const tg = new THREE.BoxGeometry(1, 1, 1);
    tg.translate(0, 0, 0.5);
    this.tracers = [];
    for (let i = 0; i < 80; i++) {
      const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 4.2, 1.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      m.visible = false;
      m.userData = { life: 0, maxLife: 0, from: new THREE.Vector3(), to: new THREE.Vector3() };
      scene.add(m);
      this.tracers.push(m);
    }

    const flashTex = flashSprite();
    this.flashes = [];
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: new THREE.Color(5, 3.5, 2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      s.visible = false;
      s.userData.life = 0;
      scene.add(s);
      this.flashes.push(s);
    }
    this.light = new THREE.PointLight(0xffb060, 0, 12, 2);
    scene.add(this.light);

    // smoke/dust/blood puffs (shared pool)
    const puffTex = radialSprite('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)');
    this.puffs = [];
    for (let i = 0; i < 140; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false;
      s.userData = { life: 0, maxLife: 1, v: new THREE.Vector3(), grow: 1, alpha: 0.5 };
      scene.add(s);
      this.puffs.push(s);
    }

    // sparks and debris
    this.sparks = [];
    const sg = new THREE.BoxGeometry(0.03, 0.03, 0.12);
    for (let i = 0; i < 160; i++) {
      const m = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, fog: false }));
      m.visible = false;
      m.userData = { life: 0, v: new THREE.Vector3() };
      scene.add(m);
      this.sparks.push(m);
    }

    // bullet hole decals
    const holeMat = new THREE.MeshStandardMaterial({ map: bulletHoleTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1 });
    const holeGeo = new THREE.PlaneGeometry(0.12, 0.12);
    this.holes = [];
    for (let i = 0; i < 120; i++) {
      const m = new THREE.Mesh(holeGeo, holeMat);
      m.visible = false;
      scene.add(m);
      this.holes.push(m);
    }
    this.ti = 0; this.fi = 0; this.si = 0; this.pi = 0; this.hi = 0;
  }

  // 3D tracer: a light streak flying briefly from → to
  tracer3(from, to) {
    const m = this.tracers[this.ti++ % this.tracers.length];
    const len = from.distanceTo(to);
    if (len < 0.1) return;
    m.userData.from.copy(from);
    m.userData.to.copy(to);
    m.userData.len = len;
    m.userData.life = Math.min(0.12, 0.03 + len / 600);
    m.userData.maxLife = m.userData.life;
    m.position.copy(from);
    m.lookAt(to);
    m.scale.set(0.022, 0.022, Math.min(len, 6));
    m.visible = true;
  }

  // legacy API: horizontal tracer
  tracer(x0, z0, x1, z1, y = 1.25) {
    this.tracer3(tmp.set(x0, y, z0).clone(), new THREE.Vector3(x1, y, z1));
  }

  flash(pos, aim) {
    const s = this.flashes[this.fi++ % this.flashes.length];
    s.position.copy(pos);
    s.material.rotation = Math.random() * Math.PI;
    s.scale.setScalar(0.5 + Math.random() * 0.4);
    s.material.opacity = 1;
    s.userData.life = 0.05;
    s.visible = true;
    this.light.position.copy(pos);
    this.light.intensity = 40;
    this.smoke(pos, 1, 0.18);
    if (aim !== undefined) { /* direction unused for sprites — kept for signature compatibility */ }
  }

  puff(pos, color, { size = 0.4, grow = 2, life = 0.8, alpha = 0.45, vel = null, blend = THREE.NormalBlending } = {}) {
    const s = this.puffs[this.pi++ % this.puffs.length];
    s.position.copy(pos);
    s.material.color.set(color);
    s.material.blending = blend;
    s.material.opacity = alpha;
    s.material.rotation = Math.random() * Math.PI * 2;
    s.scale.setScalar(size);
    const u = s.userData;
    u.life = life; u.maxLife = life; u.grow = grow; u.alpha = alpha; u.base = size;
    if (vel) u.v.copy(vel); else u.v.set((Math.random() - 0.5) * 0.4, 0.3 + Math.random() * 0.3, (Math.random() - 0.5) * 0.4);
    s.visible = true;
  }

  smoke(pos, count = 2, size = 0.3) {
    for (let i = 0; i < count; i++) this.puff(pos, 0xb8b2a6, { size, grow: 2.5, life: 0.9 + Math.random() * 0.5, alpha: 0.22 });
  }

  // wall/ground impact: dust + sparks + bullet hole
  impact(point, normal, { hole = true } = {}) {
    for (let i = 0; i < 3; i++) {
      const v = normal.clone().multiplyScalar(0.8 + Math.random()).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.6, (Math.random() - 0.5) * 0.6));
      this.puff(point, 0xa89c84, { size: 0.15, grow: 3.5, life: 0.6 + Math.random() * 0.4, alpha: 0.5, vel: v });
    }
    for (let i = 0; i < 5; i++) {
      const m = this.sparks[this.si++ % this.sparks.length];
      m.position.copy(point);
      m.material.color.setRGB(4, 2.6, 1.2);
      m.userData.v.copy(normal).multiplyScalar(2 + Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4));
      m.userData.life = 0.15 + Math.random() * 0.15;
      m.userData.maxLife = m.userData.life;
      m.visible = true;
    }
    if (hole) {
      const h = this.holes[this.hi++ % this.holes.length];
      h.position.copy(point).addScaledVector(normal, 0.01);
      h.quaternion.setFromUnitVectors(Z, normal);
      h.rotateZ(Math.random() * Math.PI);
      h.scale.setScalar(0.7 + Math.random() * 0.6);
      h.visible = true;
    }
  }

  blood(x, y, z, kill = false) {
    const n = kill ? 6 : 3;
    for (let i = 0; i < n; i++) {
      this.puff(new THREE.Vector3(x, y, z), 0x7a0d08, { size: 0.25, grow: 2.2, life: 0.4 + Math.random() * 0.3, alpha: 0.75, vel: new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.2, (Math.random() - 0.5) * 2) });
    }
  }

  // legacy API: debris burst (red color = blood, otherwise dust)
  burst(x, y, z, color, count = 8, speed = 4) {
    const c = new THREE.Color(color);
    if (c.r > c.g * 1.6) { this.blood(x, y, z, count > 10); return; }
    this.impact(new THREE.Vector3(x, y, z), new THREE.Vector3(0, 1, 0), { hole: false });
    if (speed > 4) this.smoke(new THREE.Vector3(x, y, z), 2, 0.5);
  }

  update(dt) {
    for (const m of this.tracers) {
      if (!m.visible) continue;
      const u = m.userData;
      u.life -= dt;
      const t = 1 - Math.max(0, u.life / u.maxLife);
      const segLen = Math.min(u.len, 6);
      // the streak head travels from → to
      const head = Math.min(u.len, t * u.len + segLen * 0.5);
      const tail = Math.max(0, head - segLen);
      m.position.copy(u.from).lerp(u.to, tail / u.len);
      m.scale.z = Math.max(0.01, head - tail);
      m.material.opacity = 0.9;
      if (u.life <= 0) m.visible = false;
    }
    for (const s of this.flashes) {
      if (!s.visible) continue;
      s.userData.life -= dt;
      s.material.opacity = Math.max(0, s.userData.life / 0.05);
      if (s.userData.life <= 0) s.visible = false;
    }
    this.light.intensity = Math.max(0, this.light.intensity - dt * 800);
    for (const s of this.puffs) {
      if (!s.visible) continue;
      const u = s.userData;
      u.life -= dt;
      const k = Math.max(0, u.life / u.maxLife);
      s.position.addScaledVector(u.v, dt);
      u.v.multiplyScalar(Math.exp(-dt * 2.5));
      s.scale.setScalar(u.base * (1 + (1 - k) * u.grow));
      s.material.opacity = u.alpha * k;
      if (u.life <= 0) s.visible = false;
    }
    for (const m of this.sparks) {
      if (!m.visible) continue;
      const u = m.userData;
      u.life -= dt;
      u.v.y -= 9.8 * dt;
      m.position.addScaledVector(u.v, dt);
      if (m.position.y < 0.02) { m.position.y = 0.02; u.v.y *= -0.3; }
      m.lookAt(tmp.copy(m.position).add(u.v));
      m.material.opacity = Math.max(0, u.life / u.maxLife);
      if (u.life <= 0) m.visible = false;
    }
  }

  clear() {
    for (const list of [this.tracers, this.flashes, this.sparks, this.puffs, this.holes]) for (const m of list) m.visible = false;
    this.light.intensity = 0;
  }

  static muzzleFallback(x, z, aim) {
    return tmp.set(x + Math.cos(aim) * 0.9, 1.3, z + Math.sin(aim) * 0.9);
  }
}
