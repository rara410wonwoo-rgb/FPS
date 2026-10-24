// Phone controller (CODM-style touch layout): movement joystick on the left, drag-to-look on the right, fire/ADS/jump/crouch buttons.
// Movement is converted from view (yaw) space to a world vector before sending. If input stops for 300ms the server halts the player.
import { io } from 'socket.io-client';
import { C2S, S2C } from '../shared/protocol.js';

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = 'polyzone.controller';
const SEND_MS = 33; // at most 30Hz
const HEARTBEAT_MS = 100; // shorter than the server timeout (300ms)
const DEAD = 0.15;

const state = { mx: 0, mz: 0, aim: 0, fire: false, ads: false, reload: false, interact: false, swap: false, jump: false, crouch: false, sprint: false };
const stickV = { x: 0, y: 0 }; // stick value in screen space (up = forward)
let yaw = 0;
let yawSynced = false;
let lastLookAt = 0;
let lastGameState = null;
const LOOK_SENS = 0.0065; // rad/px
let paired = false;
let lastSent = '';
let lastSentAt = 0;
let wakeLock = null;
let started = false;

const socket = io({ transports: ['websocket', 'polling'], reconnectionDelay: 500, reconnectionDelayMax: 3000 });

function setConn(text, cls) { const el = $('st-conn'); el.textContent = text; el.className = cls; }

socket.on('connect', () => {
  setConn('Connected to server', 'warn');
  let token = null;
  try { token = sessionStorage.getItem(TOKEN_KEY); } catch { token = null; }
  if (token && started) {
    socket.emit(C2S.CONTROLLER_RESUME, { token }, (r) => {
      if (r?.ok) onPaired(r); else { paired = false; showStart(r?.reason ?? 'Please pair again.'); }
    });
  }
});
socket.on('disconnect', () => { paired = false; neutral(); setConn('Disconnected — reconnecting', 'bad'); });
socket.on('connect_error', () => setConn('Cannot reach the server', 'bad'));
socket.on(S2C.CONTROLLER_KICKED, (d) => { paired = false; neutral(); try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } showStart(d?.reason ?? 'The connection was closed.'); });
socket.on(S2C.CONTROLLER_STATE, (d) => {
  // Sync the view to the server aim at match start or if we haven't synced yet
  if (typeof d.aim === 'number' && (!yawSynced || (d.state !== lastGameState && d.state === 'COUNTDOWN'))) { yaw = d.aim; yawSynced = true; }
  lastGameState = d.state;
  $('hp-text').textContent = d.alive ? `HP ${d.hp}` : 'Eliminated';
  $('hp-fill').style.width = `${Math.max(0, Math.min(100, d.hp))}%`;
  if (d.weapon) $('weapon-label').textContent = `${d.weapon.toUpperCase()} ${d.mag}/${d.reserve}`;
  const prevHp = lastHp;
  lastHp = d.hp;
  if (prevHp !== null && d.hp < prevHp && navigator.vibrate) navigator.vibrate(40);
  $('st-game').textContent = !d.pcConnected ? 'PC disconnected' : d.state === 'PLAYING' || d.state === 'COUNTDOWN'
    ? `${d.alive ? `HP ${d.hp}` : 'Eliminated'} · ${d.weapon ?? '-'} ${d.mag}/${d.reserve}${d.reloading ? ' (reloading)' : ''}`
    : d.state === 'FINISHED' ? 'Match over' : '';
});
let lastHp = null;

setInterval(() => {
  if (!socket.connected) return;
  const t0 = performance.now();
  socket.timeout(2000).emit(C2S.PING, undefined, (err) => { if (!err) $('st-ping').textContent = `${Math.round(performance.now() - t0)}ms`; });
}, 2000);

function onPaired(r) {
  paired = true;
  try { sessionStorage.setItem(TOKEN_KEY, r.controllerToken); } catch { /* ignore */ }
  setConn(`Connected · ${r.name}`, 'ok');
  $('start').hidden = true;
}

function showStart(msg) {
  $('start').hidden = false;
  $('msg').textContent = msg ?? '';
}

// ───────── Start button: request fullscreen, orientation lock and wake lock inside the user gesture ─────────
const caps = $('caps');
function cap(text) { const li = document.createElement('li'); li.textContent = text; caps.append(li); }

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return 'Keep screen on: not supported in this browser';
  if (!window.isSecureContext) return 'Keep screen on: unavailable without HTTPS (LAN http address)';
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    return 'Keep screen on: enabled';
  } catch (e) {
    return `Keep screen on: failed (${e.name})`;
  }
}

$('go').addEventListener('click', async () => {
  started = true;
  caps.textContent = '';
  const el = document.documentElement;
  if (el.requestFullscreen) {
    try { await el.requestFullscreen({ navigationUI: 'hide' }); cap('Fullscreen: on'); } catch (e) { cap(`Fullscreen: failed (${e.name})`); }
  } else cap('Fullscreen: not supported in this browser (iPhone Safari, etc.)');
  if (screen.orientation?.lock) {
    try { await screen.orientation.lock('landscape'); cap('Landscape lock: on'); } catch (e) { cap(`Landscape lock: unavailable (${e.name}) — please rotate the phone yourself`); }
  } else cap('Landscape lock: not supported — please rotate the phone yourself');
  cap(await requestWakeLock());

  const code = $('code').value.replace(/[\s-]/g, '').toUpperCase();
  if (code.length !== 8) { $('msg').textContent = 'Enter the 8-character code.'; return; }
  if (!socket.connected) { $('msg').textContent = 'Not connected to the server. Check that you are on the same Wi-Fi as the PC and that the address is the PC IP.'; return; }
  $('msg').textContent = 'Pairing…';
  socket.timeout(5000).emit(C2S.CONTROLLER_PAIR, { code }, (err, r) => {
    if (err) { $('msg').textContent = 'Server timed out'; return; }
    if (r?.ok) onPaired(r); else $('msg').textContent = r?.reason ?? 'Pairing failed';
  });
});

const urlCode = new URLSearchParams(location.search).get('code');
if (urlCode) $('code').value = urlCode.slice(0, 4) + (urlCode.length > 4 ? `-${urlCode.slice(4, 8)}` : '');

// Opened from the QR code: pair right away without a button. Fullscreen, landscape lock and wake lock
// need a touch by browser policy, so they are requested on the first tap.
let autoTried = false;
function autoPair() {
  if (autoTried || paired || !urlCode || !socket.connected) return;
  autoTried = true;
  const code = urlCode.replace(/[\s-]/g, '').toUpperCase();
  $('msg').textContent = 'Connecting automatically…';
  socket.timeout(5000).emit(C2S.CONTROLLER_PAIR, { code }, (err, r) => {
    if (err) { autoTried = false; $('msg').textContent = 'Server timed out — press Connect.'; return; }
    if (r?.ok) {
      started = true;
      onPaired(r);
      $('tap-full').hidden = false;
    } else $('msg').textContent = `${r?.reason ?? 'Pairing failed'} — show a new QR code on the PC.`;
  });
}
socket.on('connect', autoPair);
if (socket.connected) autoPair();
window.addEventListener('pointerdown', async function firstTouch() {
  if (!paired || $('tap-full').hidden) return;
  $('tap-full').hidden = true;
  window.removeEventListener('pointerdown', firstTouch, true);
  try { await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }); } catch { /* unsupported */ }
  try { await screen.orientation?.lock?.('landscape'); } catch { /* unsupported */ }
  await requestWakeLock();
}, true);

// ───────── Release input (pointercancel / blur / visibilitychange) ─────────
function neutral() {
  state.mx = state.mz = 0;
  stickV.x = stickV.y = 0;
  state.fire = state.ads = state.jump = state.sprint = false;
  stick.id = null; look.id = null;
  for (const b of buttons.values()) { b.id = null; b.el.classList.remove('on'); }
  send(true);
}
window.addEventListener('blur', neutral);
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) neutral();
  else if (started && (!wakeLock || wakeLock.released)) { const r = await requestWakeLock(); if (!r.includes('enabled')) wakeLock = null; }
});

function capture(el, e) { try { el.setPointerCapture(e.pointerId); } catch { /* synthetic events, etc. */ } }

// Screen-space stick → world movement vector relative to the view
function updateMove() {
  const fwd = -stickV.y;
  const strafe = stickV.x;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  let mx = c * fwd - s * strafe;
  let mz = s * fwd + c * strafe;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  state.mx = mx;
  state.mz = mz;
  state.aim = Math.atan2(Math.sin(yaw), Math.cos(yaw));
  // Pushing the stick all the way forward sprints
  state.sprint = fwd > 0.92 && Math.abs(strafe) < 0.45;
  $('sprintlock').classList.toggle('on', state.sprint);
}

// ───────── Movement joystick (left; floating stick that starts where you touch) ─────────
const stickCanvas = $('stick');
const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0, max: 70 };
const moveZone = $('movezone');
moveZone.addEventListener('pointerdown', (e) => {
  if (stick.id !== null) return;
  const r = moveZone.getBoundingClientRect();
  stick.id = e.pointerId;
  stick.ox = e.clientX - r.left; stick.oy = e.clientY - r.top;
  stick.x = stick.ox; stick.y = stick.oy;
  stick.max = Math.min(80, Math.max(50, r.height * 0.18));
  capture(moveZone, e);
  e.preventDefault();
});
moveZone.addEventListener('pointermove', (e) => {
  if (e.pointerId !== stick.id) return;
  const r = moveZone.getBoundingClientRect();
  stick.x = e.clientX - r.left; stick.y = e.clientY - r.top;
  let dx = (stick.x - stick.ox) / stick.max;
  let dy = (stick.y - stick.oy) / stick.max;
  const len = Math.hypot(dx, dy);
  if (len > 1) { dx /= len; dy /= len; }
  const mag = Math.hypot(dx, dy);
  if (mag < DEAD) { stickV.x = 0; stickV.y = 0; } else {
    const k = (mag - DEAD) / (1 - DEAD) / mag;
    stickV.x = dx * k; stickV.y = dy * k;
  }
  updateMove();
});
const endStick = (e) => { if (e.pointerId !== stick.id) return; stick.id = null; stickV.x = stickV.y = 0; updateMove(); send(true); };
moveZone.addEventListener('pointerup', endStick);
moveZone.addEventListener('pointercancel', endStick);

// ───────── Look (drag on the right side) ─────────
const lookZone = $('lookzone');
const look = { id: null, x: 0, y: 0 };
function rotate(dx, dy = 0) {
  state.pitch = Math.max(-1.4, Math.min(1.4, (state.pitch ?? 0) - dy * LOOK_SENS * (state.ads ? 0.55 : 1)));
  yaw += dx * LOOK_SENS * (state.ads ? 0.55 : 1);
  lastLookAt = performance.now();
  updateMove();
}
lookZone.addEventListener('pointerdown', (e) => { if (look.id !== null) return; look.id = e.pointerId; look.x = e.clientX; look.y = e.clientY; capture(lookZone, e); e.preventDefault(); });
lookZone.addEventListener('pointermove', (e) => {
  if (e.pointerId !== look.id) return;
  rotate(e.clientX - look.x, e.clientY - look.y);
  look.x = e.clientX; look.y = e.clientY;
});
const endLook = (e) => { if (e.pointerId === look.id) look.id = null; };
lookZone.addEventListener('pointerup', endLook);
lookZone.addEventListener('pointercancel', endLook);

// ───────── Buttons (one pointer ID per button). Dragging while holding fire also turns the view ─────────
const buttons = new Map();
const BUTTONS = [['fire', 'hold'], ['fire2', 'hold'], ['ads', 'toggle'], ['jump', 'hold'], ['crouch', 'toggle'], ['reload', 'tap'], ['interact', 'tap'], ['swap', 'tap']];
for (const [id, kind] of BUTTONS) {
  const el = $(id);
  const b = { el, id: null, kind, lx: 0 };
  buttons.set(id, b);
  el.addEventListener('pointerdown', (e) => {
    if (b.id !== null) return;
    b.id = e.pointerId;
    b.lx = e.clientX; b.ly = e.clientY;
    capture(el, e);
    el.classList.add('on');
    if (id === 'fire' || id === 'fire2') state.fire = true;
    else if (id === 'jump') { state.jump = true; state.crouch = false; $('crouch').classList.remove('toggled'); }
    else if (id === 'ads') { state.ads = !state.ads; el.classList.toggle('toggled', state.ads); }
    else if (id === 'crouch') { state.crouch = !state.crouch; el.classList.toggle('toggled', state.crouch); }
    else state[id] = true;
    if (navigator.vibrate && (id === 'fire' || id === 'fire2')) navigator.vibrate(8);
    send(true);
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== b.id || !(id === 'fire' || id === 'fire2')) return;
    rotate(e.clientX - b.lx, e.clientY - b.ly);
    b.lx = e.clientX; b.ly = e.clientY;
  });
  const up = (e) => {
    if (e.pointerId !== b.id) return;
    b.id = null;
    el.classList.remove('on');
    if (id === 'fire' || id === 'fire2') state.fire = buttons.get(id === 'fire' ? 'fire2' : 'fire').id !== null;
    if (id === 'jump') state.jump = false;
    send(true);
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => { if (e.target.tagName !== 'INPUT') e.preventDefault(); }, { passive: false });

// ───────── Sending (30Hz loop separate from rendering, change detection + heartbeat) ─────────
function send(force = false) {
  if (!paired || !socket.connected) return;
  updateMove();
  const msg = {
    mx: round(state.mx), mz: round(state.mz), aim: round(state.aim), pitch: round(state.pitch ?? 0), fire: state.fire, ads: state.ads,
    reload: state.reload, interact: state.interact, swap: state.swap, jump: state.jump, crouch: state.crouch, sprint: state.sprint,
  };
  const key = JSON.stringify(msg);
  const now = performance.now();
  if (!force && key === lastSent && now - lastSentAt < HEARTBEAT_MS) return;
  socket.emit(C2S.CONTROLLER_INPUT, msg);
  lastSent = key;
  lastSentAt = now;
  state.reload = state.interact = state.swap = false;
}
function round(v) { return Math.round(v * 1000) / 1000; }
setInterval(() => send(false), SEND_MS);

// ───────── Rendering: joystick + mini compass ─────────
function fit(c) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = c.clientWidth * dpr;
  const h = c.clientHeight * dpr;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return dpr;
}
function draw() {
  requestAnimationFrame(draw);
  let dpr = fit(stickCanvas);
  let g = stickCanvas.getContext('2d');
  const W = stickCanvas.clientWidth;
  const H = stickCanvas.clientHeight;
  g.clearRect(0, 0, stickCanvas.width, stickCanvas.height);
  g.save();
  g.scale(dpr, dpr);
  // Joystick: drawn at its default lower-left spot when not touched
  const ox = stick.id !== null ? stick.ox : W * 0.32;
  const oy = stick.id !== null ? stick.oy : H * 0.68;
  const R = stick.max || 70;
  g.fillStyle = 'rgba(255,255,255,0.10)';
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 2;
  g.beginPath(); g.arc(ox, oy, R, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = state.sprint ? 'rgba(240,184,74,0.85)' : 'rgba(255,255,255,0.75)';
  g.beginPath(); g.arc(ox + stickV.x * R, oy + stickV.y * R, 26, 0, Math.PI * 2); g.fill();
  g.restore();

  dpr = fit($('lookpad'));
  g = $('lookpad').getContext('2d');
  const LW = $('lookpad').clientWidth;
  g.clearRect(0, 0, $('lookpad').width, $('lookpad').height);
  g.save();
  g.scale(dpr, dpr);
  // Heading (north = -Z)
  const bearing = ((((yaw + Math.PI / 2) * 180) / Math.PI) % 360 + 360) % 360;
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.font = '700 12px system-ui';
  g.textAlign = 'center';
  g.fillText(`${String(Math.round(bearing) % 360).padStart(3, '0')}°`, LW * 0.42, 40);
  if (look.id !== null) {
    g.strokeStyle = 'rgba(240,184,74,0.7)'; g.lineWidth = 2;
    const r = $('lookpad').getBoundingClientRect();
    g.beginPath(); g.arc(look.x - r.left, look.y - r.top, 28, 0, Math.PI * 2); g.stroke();
  }
  g.restore();
}
requestAnimationFrame(draw);
