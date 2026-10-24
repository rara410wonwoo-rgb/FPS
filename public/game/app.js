// Game client entry: menu/lobby/match screens, input sending, render loop, event effects
import * as THREE from 'three';
import { MAP_SEED, TICK_DT, INPUT_HEARTBEAT_MS, WEAPONS, ITEMS, PICKUP_RANGE, MAX_HUMANS } from '../../shared/config.js';
import { C2S, S2C } from '../../shared/protocol.js';
import { generateMap } from '../../shared/map.js';
import { wrapAngle } from '../../shared/collision.js';
import { GameScene } from './scene.js';
import { createSoldier, ItemView } from './entities.js';
import { stanceOf, needsStep } from '../../shared/movement.js';
import { CameraRig, EYE_HEIGHT } from './camera.js';
import { ViewModel } from './viewmodel.js';
import { loadAssets } from './assets.js';
import qrcode from 'qrcode-generator';
import { InputManager } from './input.js';
import { Effects } from './effects.js';
import { AudioEngine } from './audio.js';
import { Hud } from './hud.js';
import { ClientState } from './network.js';
import { BleControllerAdapter } from '../transports/bluetooth-transport.js';

const $ = (id) => document.getElementById(id);
const SESSION_KEY = 'polyzone.session';
const SETTINGS_KEY = 'polyzone.settings';

function store(kind, key, value) {
  try {
    const s = kind === 'session' ? window.sessionStorage : window.localStorage;
    if (value === undefined) return JSON.parse(s.getItem(key) ?? 'null');
    if (value === null) s.removeItem(key); else s.setItem(key, JSON.stringify(value));
  } catch { /* ignore when storage is unavailable */ }
  return null;
}

const NEUTRAL = { mx: 0, mz: 0, fire: false, ads: false, reload: false, interact: false, swap: false, jump: false, crouch: false, sprint: false };

export async function boot(opts) {
  // Load photoreal textures, models and the HDRI first (anything that fails falls back to procedural)
  const bar = document.getElementById('loading-fill');
  const label = document.getElementById('loading-text');
  try {
    await loadAssets((k) => {
      if (bar) bar.style.width = `${Math.round(k * 100)}%`;
      if (label) label.textContent = `Loading battlefield… ${Math.round(k * 100)}%`;
    });
  } catch (err) {
    console.warn('asset loading failed, using fallbacks', err);
  }
  document.getElementById('loading')?.remove();
  const app = new App(opts);
  window.__polyzone = app.debug;
  window.__pzApp = app; // for debugging
  app.start();
  return app;
}

class App {
  constructor({ createTransport, mode }) {
    this.mode = mode;
    this.map = generateMap(MAP_SEED);
    this.settings = { volume: 0.6, muted: false, quality: 'medium', name: '', view: 'tps', sens: 1, ...(store('local', SETTINGS_KEY) ?? {}) };
    this.gscene = new GameScene($('viewport'), this.map, this.settings.quality);
    this.rig = new CameraRig(this.gscene.aspect);
    this.viewmodel = new ViewModel(this.gscene.viewScene);
    this.dmgFlash = 0;
    this.effects = new Effects(this.gscene.scene);
    this.audio = new AudioEngine();
    this.audio.setVolume(this.settings.volume);
    this.audio.setMuted(this.settings.muted);
    this.hud = new Hud(this.map);
    this.net = new ClientState(this.map);
    this.input = new InputManager(this.gscene.renderer.domElement, {
      onMenu: (force) => this.toggleMenu(force),
      onHelp: () => this.hud.toggleHelp(),
      onZoom: (d) => this.rig.addZoom(d),
      onView: () => this.setView({ tps: 'fps', fps: 'top', top: 'tps' }[this.settings.view] ?? 'tps'),
    });
    this.input.sensitivity = 0.0022 * (this.settings.sens || 1);
    this.setView(this.settings.view);
    this.raycaster = new THREE.Raycaster();
    this.soldiers = new Map();
    this.itemViews = new Map();
    this.speedTrack = new Map();
    this.screen = 'main';
    this.menuOpen = false;
    this.room = null;
    this.status = mode === 'local' ? 'local' : 'connecting';
    this.ping = null;
    this.localAim = 0;
    this.lastSentAim = 0;
    this.lastSentAt = 0;
    this.wasActive = false;
    this.inputAcc = 0;
    this.lastFrame = performance.now();
    this.fpsFrames = 0;
    this.fpsAt = performance.now();
    this.hudAt = 0;
    this.deathShown = false;
    this.endShown = false;
    this.lastCountdown = -1;
    this.ble = null;
    this.debug = { frames: 0, fps: 0, screen: 'main', state: null, events: 0, shots: 0, mode, errors: [] };

    this.aimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xff4040, transparent: true, opacity: 0.55 }));
    this.aimLine.visible = false;
    this.gscene.scene.add(this.aimLine);

    this.transport = createTransport();
    this.bindTransport();
    this.bindUi();
    window.addEventListener('resize', () => { this.gscene.resize(); this.rig.setAspect(this.gscene.aspect); });
  }

  start() {
    this.showScreen('main');
    this.hud.setConnection(this.status, null);
    this.hud.setController(this.mode === 'local' ? 'unavailable' : 'none');
    setInterval(() => this.measurePing(), 2000);
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------- transport ----------------
  bindTransport() {
    const t = this.transport;
    t.onStatus((s) => {
      this.status = s;
      this.hud.setConnection(s, this.ping);
      const offline = s === 'offline' || s === 'reconnecting' || s === 'connecting';
      $('offline-overlay').hidden = !(offline && this.screen !== 'main');
      $('main-status').textContent = offline ? (s === 'connecting' ? 'Connecting to server…' : 'Lost connection to the server. Reconnecting…') : '';
      this.setMainButtons(!offline);
      if (s === 'online') this.tryResume();
      if (offline) this.input.releaseAll();
    });
    t.on(S2C.ROOM_STATE, (d) => this.onRoomState(d));
    t.on(S2C.FULL, (d) => this.onFull(d));
    t.on(S2C.SNAPSHOT, (d) => this.onSnapshot(d));
    t.on(S2C.CONTROLLER_STATUS, (d) => this.onControllerStatus(!!d.connected));
    t.on(S2C.SESSION_REPLACED, (d) => {
      store('session', SESSION_KEY, null);
      this.leaveToMain(d.reason);
    });
    t.on(S2C.RATE_LIMITED, () => this.hud.toast('Too many inputs — some were ignored'));
  }

  tryResume() {
    const s = store('session', SESSION_KEY);
    if (!s || this.mode === 'local') return;
    this.transport.emit(C2S.RESUME, { playerId: s.playerId, token: s.token }, (r) => {
      if (r?.ok) {
        this.hud.toast('Session restored');
        if (!r.solo) this.showScreen('lobby');
      } else {
        store('session', SESSION_KEY, null);
        if (this.screen !== 'main') this.leaveToMain(r?.reason ?? 'Could not restore your session.');
      }
    });
  }

  measurePing() {
    if (this.status !== 'online' && this.status !== 'local') return;
    const t0 = performance.now();
    this.transport.emit(C2S.PING, undefined, () => {
      this.ping = Math.round(performance.now() - t0);
      this.hud.setConnection(this.status, this.ping);
    });
  }

  isConnected() { return this.status === 'online' || this.status === 'local'; }

  onRoomState(d) {
    this.room = d;
    this.renderLobby();
    if (d.matchState === 'LOBBY' && this.screen !== 'lobby' && !d.solo) this.showScreen('lobby');
    if (this.endShown) this.renderResultsButtons();
  }

  onFull(d) {
    this.net.onFull(d);
    for (const s of this.soldiers.values()) s.dispose(this.gscene.scene);
    for (const v of this.itemViews.values()) v.dispose(this.gscene.scene);
    this.soldiers.clear();
    this.itemViews.clear();
    this.speedTrack.clear();
    this.effects.clear();
    this.hud.clearFeed();
    for (const k of d.killfeed ?? []) this.hud.addKill(k, this.net.youId);
    this.deathShown = false;
    this.endShown = false;
    this.lastCountdown = -1;
    $('results').hidden = true;
    $('death-panel').hidden = true;
    this.hud.setController(this.mode === 'local' ? 'unavailable' : d.ctrl ? 'connected' : 'none');
    this.showScreen('game');
    const me = d.you;
    if (me) this.rig.snap(me.x, me.z);
    const meSnap = d.players?.find?.((p) => p.id === this.net.youId);
    if (meSnap) { this.input.yaw = meSnap.a ?? 0; this.input.pitch = 0; this.localAim = this.input.yaw; }
    if (d.state === 'FINISHED') this.showResults(d.results);
  }

  onSnapshot(d) {
    if (!this.net.onSnapshot(d)) return;
    this.debug.state = d.state;
    for (const e of d.events ?? []) this.handleEvent(e);
    if (d.state === 'COUNTDOWN') {
      const c = Math.ceil(d.countdown);
      if (c !== this.lastCountdown && c > 0) { this.lastCountdown = c; this.hud.banner(String(c), 900, 'count'); this.audio.beep(false); }
    }
    const self = this.net.self();
    if (self && !self.al && !this.deathShown && d.state !== 'FINISHED') this.showDeath();
    if (d.state === 'FINISHED' && !this.endShown) this.showResults(d.results);
  }

  handleEvent(e) {
    const me = this.net.youId;
    this.debug.events++;
    const focus = this.rig.focus;
    switch (e.type) {
      case 'shot': {
        this.debug.shots++;
        const s = this.soldiers.get(e.p);
        const pl = this.net.latest.players.find((p) => p.id === e.p);
        const muzzle = new THREE.Vector3();
        const ownFps = e.p === me && this.isFirstPersonActive();
        const ownLook = e.p === me && this.isLookActive();
        if (ownLook && !ownFps) this.rig.kick(e.w === 'breaker' ? 0.04 : 0.008);
        if (ownFps) {
          this.viewmodel.fire();
          this.viewmodel.muzzleWorld(this.rig.camera, muzzle);
          this.rig.kick(e.w === 'breaker' ? 0.05 : e.w === 'hornet' ? 0.008 : 0.012);
          this.effects.light.position.copy(muzzle);
          this.effects.light.intensity = 25;
        } else {
          if (s && s.root.visible) { s.kick(); s.muzzleWorld(muzzle); } else if (pl) muzzle.copy(Effects.muzzleFallback(pl.x, pl.z, pl.a));
          if (pl) this.effects.flash(muzzle, pl.a);
        }
        for (const tr of e.tr) this.traceShot(tr, muzzle, ownLook);
        if (pl) this.audio.shot(e.w, Math.hypot(pl.x - focus.x, pl.z - focus.z), pl.x - focus.x);
        if (e.p === me) this.rig.shake(e.w === 'breaker' ? 0.35 : 0.06);
        else if (pl) this.hud.ping(pl.x, pl.z);
        break;
      }
      case 'hit':
        if (!(e.t === me && this.isFirstPersonActive())) this.effects.blood(e.x, 1.3, e.z, e.kill);
        if (e.by === me && e.t !== me) { this.hud.hitmarker(e.kill); this.audio.hitmarker(e.kill); }
        if (e.t === me) { this.hud.damage(e.dmg); this.audio.hurt(); this.rig.shake(0.3); this.dmgFlash = Math.min(1, this.dmgFlash + 0.35 + e.dmg / 60); }
        break;
      case 'kill':
        this.hud.addKill(e, me);
        if (e.k === me && e.v !== me) this.hud.banner(`Eliminated ${e.vn}`, 1500, 'kill');
        if (e.v === me && !this.deathShown) this.showDeath(e);
        break;
      case 'pickup':
        if (e.p === me) {
          this.audio.pickup();
          this.hud.toast(`Picked up ${ITEMS[e.item]?.label ?? e.item}${e.w ? ` — ${WEAPONS[e.w].name}` : ''}`);
        }
        break;
      case 'pickfail':
        if (e.p === me) { this.audio.denied(); this.hud.toast(e.reason); }
        break;
      case 'reload':
        if (e.p === me) this.audio.reload();
        break;
      case 'dry':
        if (e.p === me) { this.audio.dry(); this.hud.toast('Out of ammo — find an ammo box'); }
        break;
      case 'swap':
        if (e.p === me) this.hud.toast(WEAPONS[e.w].name);
        break;
      case 'zone':
        if (e.stage === 'SHRINK') { this.hud.banner(e.phase > 5 ? 'Final collapse — the zone is closing completely!' : `Zone shrinking (${e.phase}/5)`, 2600, 'warn'); this.audio.zoneAlarm(); }
        else if (e.stage === 'WAIT') this.hud.banner(e.phase > 5 ? 'Final zone collapse incoming' : `Next safe zone marked — zone ${e.phase}/5`, 2400);
        break;
      case 'start':
        this.hud.banner('Fight!', 1400, 'go');
        this.audio.beep(true);
        break;
      default:
        break;
    }
  }

  isFirstPersonActive() {
    return this.settings.view === 'fps' && !!this.net.self()?.al;
  }

  // Distance from `from` along `dir` to the nearest structure (null if none) — for camera collision and aim point
  rayDistance(from, dir, far) {
    this.raycaster.set(from, dir);
    this.raycaster.far = far;
    const hit = this.raycaster.intersectObjects(this.gscene.cameraBlockers ?? this.gscene.solidMeshes, true)[0];
    let d = hit ? hit.distance : null;
    // ground
    if (dir.y < -1e-3) {
      const g = (0.02 - from.y) / dir.y;
      if (g > 0 && g < far && (d === null || g < d)) d = g;
    }
    return d;
  }

  isLookActive() {
    return this.settings.view !== 'top' && !!this.net.self()?.al;
  }

  // Render the server's 2D trace (x0,z0 → x1,z1) in 3D: my own shots follow the camera pitch,
  // and wall hits raycast the real surface to leave a bullet hole. Hit results are the server's.
  traceShot(tr, muzzle, ownFps) {
    const dx = tr.x1 - tr.x0;
    const dz = tr.z1 - tr.z0;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return;
    let endY = tr.h === 1 ? 1.3 : 1.25;
    // My own shots: trace height follows the camera aim line (pitch)
    const cam = this.rig.camera.position;
    const camDir = this.rig.camera.getWorldDirection(new THREE.Vector3());
    const camSlope = camDir.y / Math.max(0.05, Math.hypot(camDir.x, camDir.z));
    if (ownFps && tr.h !== 1) endY = THREE.MathUtils.clamp(cam.y + camSlope * Math.hypot(tr.x1 - cam.x, tr.z1 - cam.z), -50, 60);
    const end = new THREE.Vector3(tr.x1, endY, tr.z1);
    let normal = null;
    if (ownFps && endY < 0 && tr.h !== 1) {
      // Shot at the ground: where the line meets the ground
      const hc = Math.hypot(tr.x0 - cam.x, tr.z0 - cam.z);
      const k = Math.max(0, (cam.y / -camSlope - hc) / dist);
      end.set(tr.x0 + dx * Math.min(1, k), 0.01, tr.z0 + dz * Math.min(1, k));
      normal = new THREE.Vector3(0, 1, 0);
    } else if (tr.h === 2) {
      const y0 = ownFps ? THREE.MathUtils.clamp(cam.y + camSlope * Math.hypot(tr.x0 - cam.x, tr.z0 - cam.z), 0.1, 10) : 1.25;
      const origin = new THREE.Vector3(tr.x0, y0, tr.z0);
      const dir = end.clone().sub(origin).normalize();
      this.raycaster.set(origin, dir);
      this.raycaster.far = origin.distanceTo(end) + 1.5;
      const hit = this.raycaster.intersectObjects(this.gscene.solidMeshes, false)[0];
      if (hit) {
        end.copy(hit.point);
        normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : dir.clone().negate();
        if (hit.instanceId !== undefined && hit.face) {
          const im = new THREE.Matrix4();
          hit.object.getMatrixAt(hit.instanceId, im);
          normal = hit.face.normal.clone().transformDirection(im).transformDirection(hit.object.matrixWorld);
        }
      } else {
        normal = dir.clone().negate();
      }
    }
    this.effects.tracer3(muzzle.clone(), end);
    if (normal) this.effects.impact(end, normal);
  }

  // ---------------- UI ----------------
  bindUi() {
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', (e) => {
      unlock();
      if (e.code === 'KeyM' && e.target?.tagName !== 'INPUT') this.setMuted(!this.settings.muted);
    }, { capture: true });

    $('name-input').value = this.settings.name || `Player${Math.floor(Math.random() * 900 + 100)}`;
    $('btn-solo').onclick = () => this.create(true);
    // Create a solo match and immediately show the phone QR code
    $('btn-solo-phone').onclick = () => this.create(true, () => this.openPhonePanel());
    $('btn-phone-hud').onclick = () => this.openPhonePanel();
    $('btn-phone-close').onclick = () => this.closePhonePanel();
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' && this.screen === 'game' && e.target?.tagName !== 'INPUT') { if (this.phonePanelOpen) this.closePhonePanel(); else this.openPhonePanel(); }
      if (e.code === 'Escape' && this.phonePanelOpen) { this.closePhonePanel(); e.stopImmediatePropagation(); }
    }, { capture: true });
    if (this.mode === 'local') { $('btn-solo-phone').hidden = true; $('btn-phone-hud').hidden = true; }
    $('btn-create').onclick = () => this.create(false);
    $('btn-join').onclick = () => this.join();
    $('code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.join(); });
    if (this.mode === 'local') {
      $('multi-section').hidden = true;
      $('local-note').hidden = false;
    }

    $('btn-start').onclick = () => this.transport.emit(C2S.START, undefined, (r) => { if (!r?.ok) this.hud.toast(r?.reason ?? 'Cannot start'); });
    $('btn-lobby-leave').onclick = () => this.leaveRoom();
    $('btn-lobby-pair').onclick = () => this.createPairCode('lobby-pair');

    $('btn-resume').onclick = () => this.toggleMenu(false);
    $('btn-menu-pair').onclick = () => this.createPairCode('menu-pair');
    $('btn-menu-leave').onclick = () => this.leaveRoom();
    $('btn-restart-menu').onclick = () => this.restart();

    $('vol').value = String(Math.round(this.settings.volume * 100));
    $('vol').oninput = (e) => { this.settings.volume = Number(e.target.value) / 100; this.audio.setVolume(this.settings.volume); this.saveSettings(); };
    $('mute').checked = this.settings.muted;
    $('mute').onchange = (e) => this.setMuted(e.target.checked);
    $('quality').value = this.settings.quality;
    $('quality').onchange = (e) => { this.settings.quality = e.target.value; this.gscene.setQuality(e.target.value); this.saveSettings(); };
    $('btn-help').onclick = () => this.hud.toggleHelp();
    $('view-mode').value = this.settings.view;
    $('view-mode').onchange = (e) => this.setView(e.target.value);
    $('sens').value = String(Math.round((this.settings.sens || 1) * 100));
    $('sens').oninput = (e) => { this.settings.sens = Number(e.target.value) / 100; this.input.sensitivity = 0.0022 * this.settings.sens; this.saveSettings(); };
    $('lock-hint').onclick = () => this.input.requestLock();
    $('btn-mute-hud').onclick = () => this.setMuted(!this.settings.muted);

    $('btn-spectate').onclick = () => { $('death-panel').hidden = true; };
    $('btn-death-restart').onclick = () => this.restart();
    $('btn-death-leave').onclick = () => this.leaveRoom();
    $('btn-results-restart').onclick = () => this.restart();
    $('btn-results-leave').onclick = () => this.leaveRoom();
    $('btn-results-close').onclick = () => { $('results').hidden = true; };

    // Optional extension: Web Bluetooth (BLE GATT peripheral controller)
    const bleBtn = $('btn-ble');
    if (!BleControllerAdapter.supported()) {
      bleBtn.disabled = true;
      $('ble-status').textContent = 'This browser does not support Web Bluetooth. Use the phone controller (Socket.IO) instead.';
    } else {
      bleBtn.onclick = async () => {
        if (this.ble?.connected) { this.ble.disconnect(); return; }
        this.ble = this.ble ?? new BleControllerAdapter({
          onStatus: (st, msg) => {
            $('ble-status').textContent = msg;
            bleBtn.textContent = st === 'connected' ? 'Disconnect BLE' : 'Connect BLE device';
            this.hud.setController(st === 'connected' ? 'ble' : this.mode === 'local' ? 'unavailable' : this.net.ctrl ? 'connected' : 'none');
          },
        });
        await this.ble.connect();
      };
    }
  }

  setMuted(m) {
    this.settings.muted = m;
    this.audio.setMuted(m);
    $('mute').checked = m;
    $('btn-mute-hud').textContent = m ? '🔇' : '🔊';
    this.saveSettings();
  }

  saveSettings() { store('local', SETTINGS_KEY, this.settings); }

  // View modes: 'tps' (over-the-shoulder third person, default) → 'fps' (first person) → 'top' (classic top-down)
  setView(view) {
    this.settings.view = ['tps', 'fps', 'top'].includes(view) ? view : 'tps';
    const look = this.settings.view !== 'top';
    this.rig.setMode(this.settings.view);
    this.input.setFirstPerson(look);
    this.gscene.setFirstPerson(look);
    this.rig.camera.fov = look ? 70 : 50;
    this.rig.camera.updateProjectionMatrix();
    document.body.classList.toggle('fps', look);
    if (this.hud) this.hud.toast({ tps: 'Third-person view (V to switch)', fps: 'First-person view (V to switch)', top: 'Top-down view (V to switch)' }[this.settings.view]);
    const sel = document.getElementById('view-mode');
    if (sel) sel.value = this.settings.view;
    this.saveSettings();
  }

  setMainButtons(enabled) {
    for (const id of ['btn-solo', 'btn-create', 'btn-join']) $(id).disabled = !enabled;
  }

  playerName() {
    const n = $('name-input').value.trim().slice(0, 16);
    this.settings.name = n;
    this.saveSettings();
    return n;
  }

  create(solo, then) {
    this.audio.unlock();
    const name = this.playerName();
    if (!name) { $('main-status').textContent = 'Enter a name.'; return; }
    $('main-status').textContent = solo ? 'Setting up solo match…' : 'Creating room…';
    this.transport.emit(C2S.CREATE, { name, solo }, (r) => {
      if (!r?.ok) { $('main-status').textContent = r?.reason ?? 'Something went wrong.'; return; }
      $('main-status').textContent = '';
      if (this.mode !== 'local') store('session', SESSION_KEY, { playerId: r.playerId, token: r.token, roomCode: r.roomCode });
      if (!solo) this.showScreen('lobby');
      if (then) setTimeout(then, 500); // run after the room info (ROOM_STATE) arrives
    });
  }

  join() {
    this.audio.unlock();
    const name = this.playerName();
    const code = $('code-input').value.trim().toUpperCase();
    if (!name || !code) { $('main-status').textContent = 'Enter a name and room code.'; return; }
    this.transport.emit(C2S.JOIN, { name, code }, (r) => {
      if (!r?.ok) { $('main-status').textContent = r?.reason ?? 'Could not join.'; return; }
      $('main-status').textContent = '';
      store('session', SESSION_KEY, { playerId: r.playerId, token: r.token, roomCode: r.roomCode });
      if (this.room?.matchState === 'FINISHED') this.showScreen('lobby');
      else this.showScreen('lobby');
    });
  }

  leaveRoom() {
    this.transport.emit(C2S.LEAVE, undefined, () => {});
    store('session', SESSION_KEY, null);
    this.leaveToMain();
  }

  leaveToMain(message) {
    this.room = null;
    this.net.reset();
    for (const s of this.soldiers.values()) s.dispose(this.gscene.scene);
    for (const v of this.itemViews.values()) v.dispose(this.gscene.scene);
    this.soldiers.clear();
    this.itemViews.clear();
    this.effects.clear();
    this.toggleMenu(false);
    $('results').hidden = true;
    $('death-panel').hidden = true;
    this.showScreen('main');
    $('main-status').textContent = message ?? '';
  }

  restart() {
    this.transport.emit(C2S.RESTART, undefined, (r) => { if (!r?.ok) this.hud.toast(r?.reason ?? 'Cannot restart'); });
  }

  showScreen(name) {
    this.screen = name;
    this.debug.screen = name;
    $('menu-main').hidden = name !== 'main';
    $('menu-lobby').hidden = name !== 'lobby';
    this.hud.show(name === 'game');
    this.input.setEnabled(name === 'game' && !this.menuOpen);
    document.body.classList.toggle('in-game', name === 'game');
    if (name !== 'game') { this.toggleMenu(false); $('offline-overlay').hidden = true; }
    this.renderLobby();
  }

  renderLobby() {
    const r = this.room;
    if (!r) return;
    $('lobby-code').textContent = r.code;
    const list = $('lobby-list');
    list.textContent = '';
    for (const h of r.humans) {
      const li = document.createElement('li');
      li.textContent = `${h.name}${h.host ? ' (host)' : ''}${h.playerId === r.you ? ' — you' : ''}`;
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = `${h.connected ? 'online' : 'disconnected'}${h.controller ? ' · 📱' : ''}`;
      li.append(tag);
      list.append(li);
    }
    const isHost = r.hostId === r.you;
    $('btn-start').hidden = !isHost;
    $('lobby-wait').hidden = isHost;
    $('lobby-count').textContent = `${r.humans.length}/${r.maxHumans ?? MAX_HUMANS} players · bots fill up to 12 at start`;
    $('lobby-state').textContent = r.matchState === 'LOBBY' ? 'Waiting' : r.matchState === 'FINISHED' ? 'Last match over — the host can start a new one' : 'Match in progress';
  }

  // The lobby and menu connect buttons open the same QR panel
  createPairCode() { this.openPhonePanel(); }

  // Phone panel: get a pairing code → show QR (controller URL + code) → closes itself once connected
  async openPhonePanel() {
    const panel = $('phone-panel');
    panel.hidden = false;
    this.phonePanelOpen = true;
    this.input.setEnabled(false);
    $('phone-qr').textContent = '';
    $('phone-code').textContent = '----';
    $('phone-url').textContent = '';
    $('phone-note').textContent = '';
    const status = $('phone-status');
    status.className = 'status';
    if (this.mode === 'local') {
      status.textContent = 'This web build runs solo inside the browser only, so a phone cannot connect. Use the server version (npm start) or the online address.';
      return;
    }
    if (!this.room) { status.textContent = 'Join a match or lobby first, then connect.'; return; }
    status.textContent = 'Creating code…';
    this.transport.emit(C2S.PAIR_CREATE, undefined, async (r) => {
      if (!r?.ok) { status.textContent = r?.reason ?? 'Could not create a pairing code.'; return; }
      let base = location.origin;
      const localHost = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
      if (localHost) {
        // On a phone, localhost is the phone itself, so build the QR with the PC's Wi-Fi address
        try {
          const info = await (await fetch('/api/info')).json();
          const lan = info.lan.find((ip) => ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) ?? info.lan[0];
          if (lan) base = `http://${lan}:${location.port || 80}`;
          $('phone-note').textContent = 'Your phone and PC must be on the same Wi-Fi. If it will not connect, allow Node through the PC firewall.';
        } catch { /* fall back to the current address if no LAN address is found */ }
      }
      const url = `${base}/controller.html?code=${r.code}`;
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      const img = document.createElement('img');
      img.alt = 'QR code to connect the phone controller';
      img.src = qr.createDataURL(6, 2);
      $('phone-qr').append(img);
      $('phone-code').textContent = `${r.code.slice(0, 4)}-${r.code.slice(4)}`;
      $('phone-url').textContent = url;
      status.textContent = 'Waiting for your phone… (code valid for 5 minutes)';
    });
  }

  closePhonePanel() {
    $('phone-panel').hidden = true;
    this.phonePanelOpen = false;
    this.input.setEnabled(this.screen === 'game' && !this.menuOpen);
  }

  onControllerStatus(connected) {
    this.hud.setController(connected ? 'connected' : 'none');
    $('btn-phone-hud').classList.toggle('connected', connected);
    $('btn-phone-hud').textContent = connected ? '📱 Phone connected' : '📱 Connect phone';
    if (connected && this.phonePanelOpen) {
      const status = $('phone-status');
      status.textContent = '✅ Phone connected! Control the game from your phone now.';
      status.className = 'status ok';
      this.audio.pickup();
      setTimeout(() => this.closePhonePanel(), 1400);
    } else if (connected) {
      this.hud.toast('📱 Phone controller connected');
    }
  }

  toggleMenu(force) {
    if (this.screen !== 'game') { this.menuOpen = false; $('menu-pause').hidden = true; return; }
    const open = force === undefined ? !this.menuOpen : force;
    if (open === this.menuOpen) return;
    this.menuOpen = open;
    $('menu-pause').hidden = !open;
    this.input.setEnabled(!open);
    if (!open && this.settings.view !== 'top') this.input.requestLock();
    this.transport.emit(C2S.MENU, { open });
    if (open) this.sendNeutral();
    const isHost = this.room?.hostId === this.room?.you;
    $('btn-restart-menu').hidden = !isHost;
  }

  sendNeutral() {
    if (!this.isConnected()) return;
    const msg = { ...NEUTRAL, aim: this.localAim, seq: ++this.net.seq };
    this.transport.emit(C2S.INPUT, msg);
    this.wasActive = false;
  }

  showDeath(e) {
    this.deathShown = true;
    const you = this.net.you;
    const killer = e?.kn ?? this.net.latest?.players.find((p) => p.id === you?.killedBy)?.n;
    $('death-title').textContent = `Eliminated — #${you?.placement ?? '?'}`;
    $('death-sub').textContent = killer ? `Killed by ${killer}` : e?.w === 'zone' ? 'Taken out by the zone' : 'You went down';
    const isHost = this.room?.hostId === this.room?.you;
    $('btn-death-restart').hidden = !isHost;
    $('death-panel').hidden = false;
    this.audio.stinger(false);
  }

  showResults(results) {
    if (!results) return;
    this.endShown = true;
    $('death-panel').hidden = true;
    const me = this.net.youId;
    const myRow = results.rows.find((r) => r.id === me);
    $('results-title').textContent = results.draw ? 'Draw — no survivors' : results.winnerId === me ? 'Last one standing! Victory' : `${results.winnerName} wins`;
    $('results-sub').textContent = myRow ? `Your place #${myRow.placement} · ${myRow.kills} kills · survived ${Math.floor(myRow.survival / 60)}m ${Math.round(myRow.survival % 60)}s` : '';
    const body = $('results-body');
    body.textContent = '';
    for (const r of results.rows) {
      const tr = document.createElement('tr');
      if (r.id === me) tr.className = 'me';
      for (const v of [`#${r.placement}`, `${r.name}${r.bot ? ' (bot)' : ''}`, r.kills, `${Math.floor(r.survival / 60)}:${String(Math.round(r.survival % 60)).padStart(2, '0')}`]) {
        const td = document.createElement('td');
        td.textContent = String(v);
        tr.append(td);
      }
      body.append(tr);
    }
    this.renderResultsButtons();
    $('results').hidden = false;
    this.audio.stinger(results.winnerId === me);
  }

  renderResultsButtons() {
    const isHost = this.room?.hostId === this.room?.you;
    $('btn-results-restart').hidden = !isHost;
    $('results-wait').hidden = isHost;
  }

  // ---------------- input ----------------
  inputTick() {
    if (this.screen !== 'game' || !this.net.latest || !this.isConnected()) return;
    if (this.net.ctrl && !this.ble?.connected) return; // the phone controller is in charge
    let s = this.menuOpen ? { ...NEUTRAL } : this.input.sample();
    let aim = this.localAim;
    const ble = this.ble?.connected ? this.ble.read() : null;
    if (ble && !this.menuOpen) { s = ble; aim = ble.aim; this.localAim = aim; }
    const active = !!(s.mx || s.mz || s.fire || s.ads || s.reload || s.interact || s.swap || s.jump || s.crouch || s.sprint)
      || !!(this.net.pred && needsStep(this.net.pred)); // send every tick while airborne/sliding (keeps prediction in sync with the server)
    const aimChanged = Math.abs(wrapAngle(aim - this.lastSentAim)) > 0.01;
    const now = performance.now();
    if (!(active || aimChanged || this.wasActive || now - this.lastSentAt > INPUT_HEARTBEAT_MS)) return;
    const msg = { seq: ++this.net.seq, mx: s.mx, mz: s.mz, aim: wrapAngle(aim), fire: s.fire, ads: s.ads, reload: s.reload, interact: s.interact, swap: s.swap, jump: !!s.jump, crouch: !!s.crouch, sprint: !!s.sprint };
    this.transport.emit(C2S.INPUT, msg);
    this.net.predict(msg);
    this.lastSentAt = now;
    this.lastSentAim = aim;
    this.wasActive = active;
  }

  // ---------------- frame ----------------
  frame(t) {
    requestAnimationFrame((tt) => this.frame(tt));
    const dt = Math.min(0.1, (t - this.lastFrame) / 1000);
    this.lastFrame = t;
    this.fpsFrames++;
    this.debug.frames++;
    if (t - this.fpsAt > 1000) {
      this.debug.fps = Math.round((this.fpsFrames * 1000) / (t - this.fpsAt));
      this.hud.setFps(this.debug.fps);
      this.fpsFrames = 0;
      this.fpsAt = t;
    }
    this.input.updateLook(dt);
    this.inputAcc += dt;
    let n = 0;
    while (this.inputAcc >= TICK_DT && n++ < 4) { this.inputAcc -= TICK_DT; this.inputTick(); }
    if (this.inputAcc > TICK_DT) this.inputAcc = 0;

    if (this.screen === 'game' && this.net.latest) this.renderGame(dt, t / 1000);
    else this.renderIdle(t / 1000);
    this.gscene.render(this.rig.camera);
  }

  renderIdle(time) {
    const a = time * 0.03;
    this.rig.camera.position.set(Math.cos(a) * 62, 14 + Math.sin(time * 0.1) * 3, Math.sin(a) * 62);
    this.rig.camera.lookAt(Math.cos(a + 1.2) * 15, 4, Math.sin(a + 1.2) * 15);
    if (this.rig.camera.fov !== 60) { this.rig.camera.fov = 60; this.rig.camera.updateProjectionMatrix(); }
    this.viewmodel.setVisible(false);
    this.gscene.setExposure(0, 0);
    this.hud.drawCompass(null);
    this.gscene.updateZone({ cx: 0, cz: 0, r: 135, nx: 0, nz: 0, nr: 135 }, time);
    this.effects.update(0);
  }

  renderGame(dt, time) {
    const net = this.net;
    const latest = net.latest;
    const { players, zone } = net.interpolated();
    net.decayCorrection(dt);
    const youId = net.youId;
    const selfSnap = players.find((p) => p.id === youId);
    let selfPos = null;
    let selfMove = null; // my movement state (height, stance): prefer the predicted value
    if (selfSnap) {
      if (net.predicting() && net.pred) { selfPos = { x: net.pred.x + net.corr.x, z: net.pred.z + net.corr.z }; selfMove = net.pred; }
      else { selfPos = { x: selfSnap.x, z: selfSnap.z }; selfMove = { y: selfSnap.y ?? 0, st: selfSnap.st ?? 0, sprint: selfSnap.sp }; }
    }
    const selfY = selfMove?.y ?? 0;
    const selfStance = selfMove ? (selfMove.st ?? stanceOf(selfMove)) : 0;
    const alive = !!selfSnap?.al;
    const usingKeyboard = alive && !net.ctrl && !this.menuOpen;
    const view = this.settings.view;
    const fps = view === 'fps';
    const tps = view === 'tps';
    const look = fps || tps;
    if (selfPos && usingKeyboard && !this.ble?.connected) {
      if (look) {
        this.localAim = wrapAngle(this.tpsAim ?? this.input.yaw);
        if (fps) this.localAim = wrapAngle(this.input.yaw);
      } else {
        const a = this.input.aimFrom(this.rig.camera, selfPos.x, selfPos.z);
        if (a !== null) { this.localAim = a; this.input.yaw = a; }
      }
    } else if (selfSnap && (net.ctrl || !alive || this.ble?.connected)) {
      // A controller aims: the camera smoothly follows the server aim angle
      const target = this.ble?.connected ? this.localAim : selfSnap.a;
      this.input.yaw += wrapAngle(target - this.input.yaw) * Math.min(1, dt * 12);
      this.input.pitch *= Math.exp(-dt * 4);
      if (!this.ble?.connected) this.localAim = selfSnap.a;
    }

    // characters
    const seen = new Set();
    const camQuat = this.rig.camera.quaternion;
    for (const p of players) {
      seen.add(p.id);
      let s = this.soldiers.get(p.id);
      if (!s) { s = createSoldier(p.v ?? 0, p.id === youId, this.gscene.scene); this.soldiers.set(p.id, s); }
      const isSelf = p.id === youId;
      const x = isSelf && selfPos ? selfPos.x : p.x;
      const z = isSelf && selfPos ? selfPos.z : p.z;
      const tr = this.speedTrack.get(p.id) ?? { x, z, v: 0, vx: 0, vz: 0 };
      const ivx = dt > 0 ? (x - tr.x) / dt : 0;
      const ivz = dt > 0 ? (z - tr.z) / dt : 0;
      const inst = Math.hypot(ivx, ivz);
      const kk = Math.min(1, dt * 10);
      tr.v += (Math.min(16, inst) - tr.v) * kk;
      tr.vx += (ivx - tr.vx) * kk;
      tr.vz += (ivz - tr.vz) * kk;
      tr.x = x; tr.z = z;
      this.speedTrack.set(p.id, tr);
      const near = Math.hypot(x - this.rig.focus.x, z - this.rig.focus.z) < 40;
      const aimA = isSelf && alive ? this.localAim : p.a;
      const backward = tr.v > 0.6 && (tr.vx * Math.cos(aimA) + tr.vz * Math.sin(aimA)) / tr.v < -0.3;
      s.update(dt, {
        x, z, y: isSelf ? selfY : p.y ?? 0, aim: aimA, alive: p.al, weapon: p.w,
        stance: isSelf ? selfStance : p.st ?? 0, sprint: isSelf ? !!selfMove?.sprint : !!p.sp, backward,
        ads: isSelf && usingKeyboard ? this.input.ads : p.ads, reloading: p.rl, hp: p.hp, speed: tr.v, showBar: near,
      }, camQuat);
    }
    for (const [id, s] of this.soldiers) if (!seen.has(id)) { s.dispose(this.gscene.scene); this.soldiers.delete(id); }
    // In first person, draw the viewmodel instead of my body
    const selfSoldier = this.soldiers.get(youId);
    if (selfSoldier && fps && alive) selfSoldier.root.visible = false;
    // Third person: hide my character when the camera is very close (against a wall) so it doesn't block the view
    else if (selfSoldier && alive) selfSoldier.root.visible = true;

    // items
    const itemIds = new Set();
    for (const it of latest.items) {
      itemIds.add(it.id);
      if (!this.itemViews.has(it.id)) this.itemViews.set(it.id, new ItemView(it, this.gscene.scene));
    }
    for (const [id, v] of this.itemViews) {
      if (!itemIds.has(id)) { v.dispose(this.gscene.scene); this.itemViews.delete(id); } else v.update(dt);
    }

    this.gscene.updateZone(zone, time);

    // Camera: follow me while alive; when dead, spectate my killer or another survivor
    let focus = selfPos;
    let spectating = null;
    if (!alive) {
      const kid = net.you?.killedBy;
      const target = players.find((p) => p.id === kid && p.al) ?? players.find((p) => p.al && p.id !== youId);
      if (target) { focus = { x: target.x, z: target.z }; spectating = target.n; }
    }
    const adsHeld = alive && (usingKeyboard ? this.input.ads : !!selfSnap?.ads);
    const selfSpeed = this.speedTrack.get(youId)?.v ?? 0;
    const wtype = net.weaponType() ?? 'kestrel';
    const [ldx, ldy] = this.input.takeLook();
    const crouched = selfStance === 1 || selfStance === 2;
    if (fps && alive && selfPos) {
      const adsFov = wtype === 'breaker' ? 62 : wtype === 'hornet' ? 58 : 52;
      this.rig.updateFps(dt, selfPos.x, selfPos.z, this.input.yaw, this.input.pitch, { ads: adsHeld, speed: selfSpeed, adsFov });
      // move eye height with crouch/jump
      this.eyeOff = (this.eyeOff ?? 0) + ((crouched ? -0.55 : 0) + selfY - (this.eyeOff ?? 0)) * Math.min(1, dt * 14);
      this.rig.camera.position.y += this.eyeOff;
      this.gscene.setFirstPerson(true);
    } else if (tps && alive && selfPos) {
      const adsFov = wtype === 'breaker' ? 58 : wtype === 'hornet' ? 54 : 48;
      this.rig.updateTps(dt, selfPos.x, selfY, selfPos.z, this.input.yaw, this.input.pitch, {
        ads: adsHeld, crouch: crouched, speed: selfSpeed, adsFov, collide: (from, dir, far) => this.rayDistance(from, dir, far),
      });
      // Aim the character at the point under the center crosshair (corrects shoulder parallax)
      const cdir = this.rig.camera.getWorldDirection(new THREE.Vector3());
      const hitD = this.rayDistance(this.rig.camera.position, cdir, 90);
      const tp = this.rig.camera.position.clone().addScaledVector(cdir, hitD ?? 60);
      const hd = Math.hypot(tp.x - selfPos.x, tp.z - selfPos.z);
      this.tpsAim = hd > 2.5 ? Math.atan2(tp.z - selfPos.z, tp.x - selfPos.x) : this.input.yaw;
      this.gscene.setFirstPerson(true);
    } else if (look && focus) {
      const t = players.find((p) => p.al && Math.abs(p.x - focus.x) < 0.01 && Math.abs(p.z - focus.z) < 0.01);
      this.rig.updateChase(dt, focus.x, focus.z, t?.a ?? this.rig.chaseYaw);
      this.gscene.setFirstPerson(true);
    } else if (focus) {
      this.gscene.setFirstPerson(false);
      this.rig.update(dt, focus.x, focus.z, alive ? this.localAim : 0, alive && usingKeyboard && this.input.ads);
    }
    // Evaluate after collision resolution, not using the previous frame's camera.
    // Hide the local mesh when cover pushes the lens into the shoulder/helmet.
    if (selfSoldier && alive) selfSoldier.root.visible = !fps && !(tps && this.rig.curDist < 1.35);
    // first-person weapon
    const showVm = fps && alive;
    if (showVm !== this.viewmodel.visible) this.viewmodel.setVisible(showVm);
    if (showVm) {
      this.viewmodel.setWeapon(wtype);
      const you = net.you;
      const reloading = (you?.reloadT ?? 0) > 0 && you.reloadTotal > 0;
      this.viewmodel.update(dt, { ads: adsHeld, speed: selfSpeed, lookDX: ldx / Math.max(dt, 0.001) * 0.016, lookDY: ldy / Math.max(dt, 0.001) * 0.016, reloading, reloadProgress: reloading ? 1 - you.reloadT / you.reloadTotal : 0, alive });
    }
    this.gscene.syncViewCamera(this.rig.camera);
    // When the camera is inside the gas, the screen gets an orange haze
    const cam = this.rig.camera.position;
    const inGas = zone && zone.r >= 0 ? (Math.hypot(cam.x - zone.cx, cam.z - zone.cz) > zone.r ? 1 : 0) : 0;
    this.dmgFlash = Math.max(0, this.dmgFlash - dt * 1.6);
    this.gscene.setExposure(inGas, this.dmgFlash * 0.8);
    this.gscene.followSun(this.rig.focus.x, this.rig.focus.z);
    this.gscene.updateOcclusion(this.rig.camera, new THREE.Vector3(this.rig.focus.x, 1, this.rig.focus.z), dt, this.raycaster);
    this.effects.update(dt);
    this.hud.drawCompass(look ? (alive ? this.input.yaw : this.rig.chaseYaw) : this.localAim);
    this.hud.setStance?.(alive ? selfStance : -1, !!selfMove?.sprint);
    $('lock-hint').hidden = !(look && usingKeyboard && !this.ble?.connected && !this.input.locked && !this.input.lockFailed && latest.state !== 'FINISHED');

    // ADS aim line (stops at walls via Raycaster — visual only)
    const ads = !look && alive && usingKeyboard && this.input.ads && selfPos;
    this.aimLine.visible = !!ads;
    if (ads) {
      const origin = new THREE.Vector3(selfPos.x, 1.25, selfPos.z);
      const dir = new THREE.Vector3(Math.cos(this.localAim), 0, Math.sin(this.localAim));
      const range = WEAPONS[net.weaponType()]?.range ?? 30;
      this.raycaster.set(origin, dir);
      this.raycaster.far = range;
      const hit = this.raycaster.intersectObjects(this.gscene.solidMeshes, false)[0];
      const end = origin.clone().addScaledVector(dir, hit ? hit.distance : range);
      const pos = this.aimLine.geometry.attributes.position;
      pos.setXYZ(0, origin.x + dir.x * 0.9, origin.y, origin.z + dir.z * 0.9);
      pos.setXYZ(1, end.x, end.y, end.z);
      pos.needsUpdate = true;
      this.aimLine.geometry.computeBoundingSphere();
    }

    // crosshair
    const w = net.you?.weapons?.[net.you.slot];
    const def = w ? WEAPONS[w.type] : null;
    const spread = def ? (def.spread + (net.you.bloom ?? 0)) * (this.input.ads ? 0.45 : 1) : 0;
    if (look) {
      // angular spread → screen pixels (at the current FOV)
      const pxPerRad = window.innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(this.rig.camera.fov / 2));
      this.hud.crosshair(window.innerWidth / 2, window.innerHeight / 2, spread * pxPerRad, alive && !adsHeld);
    } else {
      this.hud.crosshair(this.input.mousePx.x, this.input.mousePx.y, spread * 260, usingKeyboard && !this.ble?.connected);
    }

    // pickup prompt
    let prompt = null;
    if (alive && selfPos && latest.state === 'PLAYING') {
      let best = null;
      let bd = PICKUP_RANGE;
      for (const it of latest.items) {
        const d = Math.hypot(it.x - selfPos.x, it.z - selfPos.z);
        if (d <= bd) { bd = d; best = it; }
      }
      if (best) prompt = `${net.ctrl ? '[INTERACT]' : '[E]'} Pick up ${ITEMS[best.t].label}`;
    }
    this.hud.setPrompt(prompt);

    if (time - this.hudAt > 0.1) {
      this.hudAt = time;
      const view = { latest, you: net.you, self: selfSnap, zone, selfPos, spectating, players, selfAim: this.localAim, youId };
      this.hud.update(view);
      this.hud.drawMinimap(view);
      this.debug.selfAlive = alive;
      this.debug.selfPos = selfPos;
      this.debug.alive = latest.alive;
    }
  }
}
