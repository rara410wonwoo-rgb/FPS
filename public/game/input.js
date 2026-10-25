// PC keyboard and mouse input.
//  - Look modes: pointer-lock mouse look (yaw/pitch). WASD is converted to a world vector relative to the view
//  - Top-down: aim at the point where the mouse ray hits the ground (muzzle-height plane)
import * as THREE from 'three';

const AIM_PLANE_Y = 1.25;

export class InputManager {
  constructor(canvas, { onMenu, onHelp, onZoom, onView } = {}) {
    this.canvas = canvas;
    this.firstPerson = true;
    this.yaw = 0;
    this.pitch = 0;
    this.lookDX = 0;
    this.lookDY = 0;
    this.sensitivity = 0.0022;
    this.locked = false;
    this.lockFailed = false; // pointer lock unavailable → turn using plain mouse movement
    this.onMenu = onMenu;
    document.addEventListener('pointerlockerror', () => { this.lockFailed = true; });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      // Open the menu when the user releases pointer lock with Esc (the browser may swallow the Esc keydown)
      if (was && !this.locked && this.enabled && this.firstPerson) onMenu?.(true);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled || !this.firstPerson) return;
      // Use pointer lock when available; otherwise turn from mouse movement with the cursor visible
      if (!this.locked && !this.lockFailed) return;
      if (!this.locked && e.target !== canvas) return; // without lock, only over the game view
      const dx = Math.max(-200, Math.min(200, e.movementX || 0));
      const dy = Math.max(-200, Math.min(200, e.movementY || 0));
      const k = this.sensitivity;
      this.yaw += dx * k;
      this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch - dy * k));
      this.lookDX += dx;
      this.lookDY += dy;
    });
    this.keys = new Set();
    this.mouse = new THREE.Vector2(0, 0);
    this.mousePx = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.fire = false;
    this.ads = false;
    this.edges = { reload: false, interact: false, swap: false };
    this.enabled = true;
    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -AIM_PLANE_Y);
    this.aimPoint = new THREE.Vector3();

    const isTyping = (e) => {
      const t = e.target;
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
    };
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      if (e.code === 'Escape') { onMenu?.(this.firstPerson && this.enabled ? true : undefined); e.preventDefault(); return; }
      if (e.code === 'KeyH') onHelp?.();
      if (e.code === 'KeyV' && !e.repeat) onView?.();
      if (!this.enabled) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyC', 'ControlLeft'].includes(e.code)) e.preventDefault();
      if (!e.repeat) {
        if (e.code === 'KeyR') this.edges.reload = true;
        if (e.code === 'KeyE') this.edges.interact = true;
        if (e.code === 'KeyQ' || e.code === 'Digit1' || e.code === 'Digit2') this.edges.swap = true;
      }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });

    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    // Mouse events fire for each button in a chord; pointerdown only fires for the first.
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (this.firstPerson && !this.locked && !this.lockFailed) { this.requestLock(); return; }
      if (e.button === 0) this.fire = true;
      if (e.button === 2) this.ads = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this.ads = false;
    });
    canvas.addEventListener('pointercancel', () => this.releaseAll());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); onZoom?.(Math.sign(e.deltaY) * 0.06); }, { passive: false });
  }

  onMove(e) {
    const r = this.canvas.getBoundingClientRect();
    this.mousePx.x = e.clientX;
    this.mousePx.y = e.clientY;
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  releaseAll() {
    this.keys.clear();
    this.fire = false;
    this.ads = false;
    this.edges.reload = this.edges.interact = this.edges.swap = false;
  }

  setEnabled(v) {
    this.enabled = v;
    if (!v) {
      this.releaseAll();
      if (this.locked) document.exitPointerLock?.();
    }
  }

  // Must be called directly inside a click (user gesture). The unadjustedMovement option is unsupported
  // on macOS and others, and a retry after failure is outside the gesture and gets refused, so request without options.
  requestLock() {
    if (!this.canvas.requestPointerLock) { this.lockFailed = true; return; }
    try {
      const r = this.canvas.requestPointerLock();
      r?.catch?.(() => { this.lockFailed = true; });
    } catch { this.lockFailed = true; }
  }

  // Arrow keys ←→↑↓ turn the view (so you can turn without a mouse)
  updateLook(dt) {
    if (!this.enabled || !this.firstPerson) return;
    const k = this.keys;
    const turn = (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0);
    const tilt = (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0);
    if (turn) { this.yaw += turn * 2.4 * dt; this.lookDX += turn * 6; }
    if (tilt) this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + tilt * 1.4 * dt));
  }

  setFirstPerson(v) {
    this.firstPerson = v;
    if (!v && this.locked) document.exitPointerLock?.();
  }

  // Take the mouse movement accumulated this frame (for viewmodel sway)
  takeLook() {
    const out = [this.lookDX, this.lookDY];
    this.lookDX = 0;
    this.lookDY = 0;
    return out;
  }

  // Find the aim point with a Three.js Raycaster (visual feedback + aim angle)
  aimFrom(camera, px, pz) {
    this.raycaster.setFromCamera(this.mouse, camera);
    if (!this.raycaster.ray.intersectPlane(this.plane, this.aimPoint)) return null;
    return Math.atan2(this.aimPoint.z - pz, this.aimPoint.x - px);
  }

  sample() {
    if (!this.enabled) return { mx: 0, mz: 0, fire: false, ads: false, reload: false, interact: false, swap: false, jump: false, crouch: false, sprint: false };
    const k = this.keys;
    // In look modes arrows turn and WASD moves; in top-down the arrows move too
    const arrows = !this.firstPerson;
    let mx = (k.has('KeyD') || (arrows && k.has('ArrowRight')) ? 1 : 0) - (k.has('KeyA') || (arrows && k.has('ArrowLeft')) ? 1 : 0);
    let mz = (k.has('KeyS') || (arrows && k.has('ArrowDown')) ? 1 : 0) - (k.has('KeyW') || (arrows && k.has('ArrowUp')) ? 1 : 0);
    if (this.firstPerson) {
      // Relative to the view: forward = (cos yaw, sin yaw), right = (-sin yaw, cos yaw)
      const fwd = -mz;
      const strafe = mx;
      const c = Math.cos(this.yaw);
      const s = Math.sin(this.yaw);
      mx = c * fwd - s * strafe;
      mz = s * fwd + c * strafe;
    }
    // The server only accepts |mx|,|mz| ≤ 1, so normalize diagonals before sending
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const out = {
      mx, mz, fire: this.fire, ads: this.ads, reload: this.edges.reload, interact: this.edges.interact, swap: this.edges.swap,
      jump: k.has('Space'), crouch: k.has('KeyC') || k.has('ControlLeft'), sprint: k.has('ShiftLeft') || k.has('ShiftRight'),
    };
    this.edges.reload = this.edges.interact = this.edges.swap = false;
    return out;
  }
}
