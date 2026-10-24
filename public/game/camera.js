// Camera rig
//  - 'tps': over-the-shoulder third person (default). Aims from behind the right shoulder
//  - 'fps': first person. Mouse-look yaw = server aim; pitch is visual only (hits are horizontal 2D)
//  - 'top': the classic angled top-down view (switch with V)
//  - spectating: chase camera behind the target
import * as THREE from 'three';

export const EYE_HEIGHT = 1.62;
const FPS_FOV = 74;

export class CameraRig {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(FPS_FOV, aspect, 0.08, 1500);
    this.mode = 'tps';
    this.tpsDist = 3.6;
    this.offset = new THREE.Vector3(0, 21, 13.5); // top-down: screen up = world -Z
    this.zoom = 1;
    this.target = new THREE.Vector3();
    this.focus = new THREE.Vector3();
    this.trauma = 0;
    this.baseFov = 50;
    this.bob = 0;
    this.bobAmt = 0;
    this.recoilPitch = 0;
    this.landDip = 0;
    this.chaseYaw = 0;
    this.camera.position.copy(this.offset);
    this.camera.lookAt(0, 0, 0);
  }

  setAspect(a) { this.camera.aspect = a; this.camera.updateProjectionMatrix(); }

  setMode(m) { this.mode = m; }

  addZoom(delta) { if (this.mode === 'top') this.zoom = Math.min(1.3, Math.max(0.75, this.zoom + delta)); }

  shake(amount) { this.trauma = Math.min(1, this.trauma + amount); }

  // Recoil: the view kicks up slightly and settles
  kick(amount) { this.recoilPitch = Math.min(0.08, this.recoilPitch + amount); }

  snap(x, z) {
    this.focus.set(x, 0, z);
    if (this.mode === 'top') this.camera.position.copy(this.focus).addScaledVector(this.offset, this.zoom);
  }

  setFov(fov, dt) {
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 12);
      this.camera.updateProjectionMatrix();
    }
  }

  shakeOffset(scale) {
    const t = performance.now() / 1000;
    const s = this.trauma * this.trauma * scale;
    return [Math.sin(t * 53) * s, Math.sin(t * 61 + 1) * s * 0.5, Math.sin(t * 47 + 2) * s];
  }

  // First person: eye height, head bob, recoil, narrower FOV when aiming
  updateFps(dt, x, z, yaw, pitch, { ads = false, speed = 0, adsFov = 55 } = {}) {
    this.focus.set(x, 0, z);
    this.trauma = Math.max(0, this.trauma - dt * 2.2);
    const moving = Math.min(1, speed / 7);
    this.bobAmt += (moving * (ads ? 0.25 : 1) - this.bobAmt) * Math.min(1, dt * 8);
    this.bob += dt * (6 + speed * 0.9);
    this.recoilPitch = Math.max(0, this.recoilPitch - dt * (0.25 + this.recoilPitch * 6));
    const by = Math.abs(Math.sin(this.bob)) * 0.045 * this.bobAmt;
    const bx = Math.cos(this.bob) * 0.03 * this.bobAmt;
    const [sx, sy, sz] = this.shakeOffset(0.06);
    const right = new THREE.Vector3(-Math.sin(yaw), 0, Math.cos(yaw));
    this.camera.position.set(x, EYE_HEIGHT + by + sy, z).addScaledVector(right, bx + sx);
    this.camera.position.z += sz * 0.3;
    const p = THREE.MathUtils.clamp(pitch + this.recoilPitch, -1.45, 1.45);
    const dir = new THREE.Vector3(Math.cos(yaw) * Math.cos(p), Math.sin(p), Math.sin(yaw) * Math.cos(p));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.camera.position.clone().add(dir));
    this.camera.rotateZ(Math.sin(this.bob * 0.5) * 0.004 * this.bobAmt + sx * 0.3);
    this.setFov(ads ? adsFov : FPS_FOV, dt);
  }

  // Over-the-shoulder third person: behind the right shoulder. collide(from, dir, dist) → distance to a wall (or null)
  updateTps(dt, x, y, z, yaw, pitch, { ads = false, crouch = false, speed = 0, adsFov = 50, collide = null } = {}) {
    this.focus.set(x, 0, z);
    this.trauma = Math.max(0, this.trauma - dt * 2.2);
    this.recoilPitch = Math.max(0, this.recoilPitch - dt * (0.25 + this.recoilPitch * 6));
    const pivotY = y + (crouch ? 1.15 : 1.6);
    const p = THREE.MathUtils.clamp(pitch + this.recoilPitch, -1.2, 1.25);
    const fwd = new THREE.Vector3(Math.cos(yaw) * Math.cos(p), Math.sin(p), Math.sin(yaw) * Math.cos(p));
    const right = new THREE.Vector3(-Math.sin(yaw), 0, Math.cos(yaw));
    const wantDist = ads ? 1.5 : this.tpsDist;
    const side = ads ? 0.6 : 0.85;
    const pivot = new THREE.Vector3(x, pivotY, z).addScaledVector(right, side);
    // Wall collision: pull the camera in if head → shoulder → camera is blocked
    let dist = wantDist;
    if (collide) {
      const head = new THREE.Vector3(x, pivotY, z);
      const sideHit = collide(head, right, side + 0.25);
      if (sideHit !== null) pivot.copy(head).addScaledVector(right, Math.max(0, sideHit - 0.25));
      const back = fwd.clone().negate();
      const hit = collide(pivot, back, wantDist + 0.3);
      if (hit !== null) dist = Math.max(0.4, hit - 0.3);
    }
    this.curDist = this.curDist === undefined ? dist : dist < this.curDist ? dist : this.curDist + (dist - this.curDist) * Math.min(1, dt * 5);
    const [sx, sy, sz] = this.shakeOffset(0.05);
    this.camera.position.copy(pivot).addScaledVector(fwd, -this.curDist);
    this.camera.position.x += sx; this.camera.position.y += sy; this.camera.position.z += sz;
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.camera.position.clone().add(fwd));
    this.bob += dt * (6 + speed * 0.9);
    this.setFov(ads ? adsFov : 70, dt);
  }

  // Spectate: follow from above and behind the target's aim
  updateChase(dt, x, z, aim) {
    this.focus.lerp(this.target.set(x, 0, z), 1 - Math.exp(-dt * 6));
    let d = aim - this.chaseYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.chaseYaw += d * Math.min(1, dt * 3);
    const back = new THREE.Vector3(-Math.cos(this.chaseYaw), 0, -Math.sin(this.chaseYaw));
    this.camera.position.copy(this.focus).addScaledVector(back, 5.5).add(new THREE.Vector3(0, 3.2, 0));
    this.camera.lookAt(this.focus.x + Math.cos(this.chaseYaw) * 4, 1.4, this.focus.z + Math.sin(this.chaseYaw) * 4);
    this.setFov(65, dt);
  }

  update(dt, x, z, aim, ads) {
    const lead = ads ? 4 : 1.5;
    this.target.set(x + Math.cos(aim) * lead, 0, z + Math.sin(aim) * lead);
    this.focus.lerp(this.target, 1 - Math.exp(-dt * 8));
    const pos = this.focus.clone().addScaledVector(this.offset, this.zoom * (ads ? 1.06 : 1));
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    const [sx, sy, sz] = this.shakeOffset(0.55);
    pos.x += sx; pos.y += sy; pos.z += sz;
    this.camera.position.copy(pos);
    this.camera.lookAt(this.focus.x, 0, this.focus.z - 0.5);
    this.setFov(ads ? 46 : this.baseFov, dt * 0.7);
  }
}
