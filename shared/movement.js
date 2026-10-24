// Movement shared by the server simulation and client prediction.
// Horizontal movement uses the 2D (XZ) collision; height (y) is only for jump/vault visuals and state.
//
// Movement state (stored on pos):
//   y, vy        height and vertical speed (jump)
//   crouch       crouching
//   slideT       remaining slide time, slideX/slideZ slide direction
//   vaultT       remaining vault time, vaultFX/FZ → vaultTX/TZ start and target, vaultH height cleared
//   sprint       whether this step was sprinting
//   prevCrouch   previous crouch button state (a slide only starts on the press)
import { MOVE_SPEED, ADS_SPEED_MULT, PLAYER_RADIUS, WEAPONS, MOVEMENT } from './config.js';
import { moveCircle, pointBlocked, raycastObstacles } from './collision.js';

export function normalizeMove(mx, mz) {
  const len = Math.hypot(mx, mz);
  if (len > 1) return [mx / len, mz / len];
  return [mx, mz];
}

export function moveSpeed(weaponId, ads) {
  const w = WEAPONS[weaponId];
  return MOVE_SPEED * (w ? w.moveSpeedMult : 1) * (ads ? ADS_SPEED_MULT : 1);
}

export function initMoveState(pos) {
  pos.y = 0; pos.vy = 0;
  pos.crouch = false; pos.prevCrouch = false; pos.prevJump = false;
  pos.slideT = 0; pos.slideX = 0; pos.slideZ = 0;
  pos.vaultT = 0; pos.vaultFX = 0; pos.vaultFZ = 0; pos.vaultTX = 0; pos.vaultTZ = 0; pos.vaultH = 0;
  pos.sprint = false;
  return pos;
}

// for syncing server → client prediction (included in the personal state)
export function copyMoveState(from, to) {
  for (const k of MOVE_KEYS) to[k] = from[k] ?? (typeof to[k] === 'boolean' ? false : 0);
  return to;
}
export const MOVE_KEYS = ['drop','y', 'vy', 'crouch', 'prevCrouch', 'prevJump', 'slideT', 'slideX', 'slideZ', 'vaultT', 'vaultFX', 'vaultFZ', 'vaultTX', 'vaultTZ', 'vaultH', 'sprint'];

// 0 standing, 1 crouching, 2 sliding, 3 vaulting, 4 airborne
export function stanceOf(p) {
  if (p.vaultT > 0) return 3;
  if (p.slideT > 0) return 2;
  if ((p.y ?? 0) > 0.02) return 4;
  return p.crouch ? 1 : 0;
}

export function isBusy(p) {
  return (p.vaultT ?? 0) > 0;
}

// Find low cover ahead and compute the landing point on the other side.
function findVault(index, pos, dx, dz) {
  const hit = raycastObstacles(index, pos.x, pos.z, dx, dz, PLAYER_RADIUS + MOVEMENT.vaultReach);
  if (!hit) return null;
  const o = hit.obstacle;
  if (!(o.h <= MOVEMENT.vaultMaxHeight) || o.kind === 'tree') return null;
  // distance at which the ray exits the obstacle (slab)
  const far = raycastExit(o, pos.x, pos.z, dx, dz);
  if (far === null || far - hit.t > MOVEMENT.vaultMaxDepth) return null;
  const land = far + PLAYER_RADIUS + 0.25;
  const tx = pos.x + dx * land;
  const tz = pos.z + dz * land;
  if (pointBlocked(index, tx, tz, PLAYER_RADIUS)) return null;
  return { tx, tz, h: o.h };
}

// distance at which a ray exits an AABB
function raycastExit(b, ox, oz, dx, dz) {
  let tmax = Infinity;
  if (Math.abs(dx) > 1e-9) tmax = Math.min(tmax, Math.max((b.minX - ox) / dx, (b.maxX - ox) / dx));
  if (Math.abs(dz) > 1e-9) tmax = Math.min(tmax, Math.max((b.minZ - oz) / dz, (b.maxZ - oz) / dz));
  return Number.isFinite(tmax) ? tmax : null;
}

// Move pos {x,z,...} for dt seconds according to input {mx,mz,aim,ads,fire,jump,crouch,sprint}.
// Returns true if it moved horizontally.
export function stepMovement(index, pos, input, dt, weaponId) {
  if (pos.drop) {
    if (pos.drop === 1) {
      pos.x += 24*dt;
      if (input.jump || pos.x > (pos.dropAt ?? 270)) pos.drop=2;
    } else {
      pos.y = Math.max(0,pos.y-(pos.drop===3?6:24)*dt);
      if (pos.y < 38 || input.jump) pos.drop=3;
      const [mx,mz]=normalizeMove(input.mx,input.mz);
      moveCircle(index,pos,mx*12*dt,mz*12*dt,PLAYER_RADIUS);
      if (pos.y === 0) {pos.drop=0;pos.vy=0;}
    }
    return true;
  }
  if (pos.y === undefined) initMoveState(pos);
  const M = MOVEMENT;
  const x0 = pos.x;
  const z0 = pos.z;
  const [nx, nz] = normalizeMove(input.mx, input.mz);
  const moving = nx !== 0 || nz !== 0;
  const crouchHeld = !!input.crouch;
  const crouchPressed = crouchHeld && !pos.prevCrouch;
  const jumpPressed = !!input.jump && !pos.prevJump;
  pos.prevCrouch = crouchHeld;
  pos.prevJump = !!input.jump;

  // ── Vault: move from start to landing point over a fixed time, ignoring collision ──
  if (pos.vaultT > 0) {
    pos.vaultT = Math.max(0, pos.vaultT - dt);
    const k = 1 - pos.vaultT / M.vaultTime;
    pos.x = pos.vaultFX + (pos.vaultTX - pos.vaultFX) * k;
    pos.z = pos.vaultFZ + (pos.vaultTZ - pos.vaultFZ) * k;
    pos.y = Math.sin(k * Math.PI) * (pos.vaultH + 0.15);
    if (pos.vaultT === 0) { pos.y = 0; pos.vy = 0; }
    pos.sprint = false;
    return true;
  }

  const grounded = pos.y <= 0;
  const aimX = Math.cos(input.aim ?? 0);
  const aimZ = Math.sin(input.aim ?? 0);
  const forward = moving && nx * aimX + nz * aimZ > 0.5;
  // Sprint: moving forward and not aiming, firing or crouching
  pos.sprint = !!input.sprint && forward && !input.ads && !input.fire && grounded && pos.slideT <= 0;

  // ── Jump / start vault ──
  if (jumpPressed && grounded) {
    const dirX = moving ? nx : aimX;
    const dirZ = moving ? nz : aimZ;
    const len = Math.hypot(dirX, dirZ) || 1;
    const v = findVault(index, pos, dirX / len, dirZ / len);
    if (v) {
      Object.assign(pos, { vaultT: M.vaultTime, vaultFX: pos.x, vaultFZ: pos.z, vaultTX: v.tx, vaultTZ: v.tz, vaultH: v.h, slideT: 0, crouch: false, sprint: false });
      return true;
    }
    pos.vy = M.jumpSpeed;
    pos.y = 0.001;
    pos.slideT = 0; // slide-cancel jump
    pos.crouch = false;
  }

  // ── Crouch / slide ──
  if (crouchPressed && grounded && pos.slideT <= 0 && (pos.sprint || (input.sprint && forward))) {
    pos.slideT = M.slideTime;
    pos.slideX = nx;
    pos.slideZ = nz;
    pos.sprint = false;
  }
  if (grounded) pos.crouch = crouchHeld || pos.slideT > 0;

  // ── Horizontal movement ──
  let dx = 0;
  let dz = 0;
  if (pos.slideT > 0) {
    const k = pos.slideT / M.slideTime; // 1 → 0
    const speed = M.slideEndSpeed + (M.slideStartSpeed - M.slideEndSpeed) * k;
    // allow only slight steering
    if (moving) {
      pos.slideX += (nx - pos.slideX) * Math.min(1, dt * 1.5);
      pos.slideZ += (nz - pos.slideZ) * Math.min(1, dt * 1.5);
      const l = Math.hypot(pos.slideX, pos.slideZ) || 1;
      pos.slideX /= l; pos.slideZ /= l;
    }
    dx = pos.slideX * speed * dt;
    dz = pos.slideZ * speed * dt;
    pos.slideT = Math.max(0, pos.slideT - dt);
  } else if (moving) {
    let speed = moveSpeed(weaponId, input.ads);
    if (pos.sprint) speed *= M.sprintMult;
    else if (pos.crouch && grounded) speed *= M.crouchMult;
    if (!grounded) speed *= M.airControl;
    dx = nx * speed * dt;
    dz = nz * speed * dt;
  }
  if (dx !== 0 || dz !== 0) moveCircle(index, pos, dx, dz, PLAYER_RADIUS);

  // ── Gravity ──
  if (!grounded || pos.vy > 0) {
    pos.vy -= M.gravity * dt;
    pos.y += pos.vy * dt;
    if (pos.y <= 0) { pos.y = 0; pos.vy = 0; }
  }
  return Math.abs(pos.x - x0) + Math.abs(pos.z - z0) > 1e-5;
}

// Whether movement must keep advancing without input (airborne, sliding, vaulting)
export function needsStep(p) {
  if (p.drop) return true;
  return (p.y ?? 0) > 0 || (p.slideT ?? 0) > 0 || (p.vaultT ?? 0) > 0;
}
