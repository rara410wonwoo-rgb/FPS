// Server-authoritative combat: fire rate, ammo, reloading, hitscan, damage
import { WEAPONS, HIT_RADIUS, MUZZLE_OFFSET, ADS_SPREAD_MULT, MOVEMENT } from '../shared/config.js';
import { raycastObstacles, rayCircle } from '../shared/collision.js';

export function currentWeapon(p) {
  return p.weapons[p.slot] ?? null;
}

export function startReload(match, p) {
  const w = currentWeapon(p);
  if (!w || !p.alive || p.reloadT > 0) return false;
  const def = WEAPONS[w.type];
  if (w.mag >= def.magSize || w.reserve <= 0) return false;
  p.reloadT = def.reloadTime;
  p.reloadTotal = def.reloadTime;
  match.emit({ type: 'reload', p: p.id });
  return true;
}

export function updateReload(p, dt) {
  if (p.reloadT <= 0) return;
  p.reloadT -= dt;
  if (p.reloadT <= 0) {
    p.reloadT = 0;
    const w = currentWeapon(p);
    if (!w) return;
    const def = WEAPONS[w.type];
    const take = Math.min(def.magSize - w.mag, w.reserve);
    w.mag += take;
    w.reserve -= take;
  }
}

// Called every tick. Fire rate uses server time, independent of rendering frames.
export function updateFiring(match, p, dt) {
  const w = currentWeapon(p);
  const def = w ? WEAPONS[w.type] : null;
  if (def) p.bloom = Math.max(0, p.bloom - def.bloomRecover * dt);
  if (!p.control.fire || !p.alive || !w) {
    p.fireCd = Math.max(0, p.fireCd - dt);
    p.dryFired = false;
    return 0;
  }
  p.fireCd -= dt;
  let shots = 0;
  while (p.fireCd <= 0) {
    if (p.reloadT > 0) { p.fireCd = 0; break; }
    if (w.mag <= 0) {
      if (!p.dryFired) { match.emit({ type: 'dry', p: p.id }); p.dryFired = true; }
      p.fireCd = 0;
      startReload(match, p);
      break;
    }
    fireShot(match, p, w, def);
    shots++;
    p.fireCd += def.fireInterval;
  }
  return shots;
}

export function damageMultiplier(def, dist) {
  const start = def.range * def.falloffStart;
  if (dist <= start) return 1;
  const k = Math.min(1, (dist - start) / (def.range - start));
  return 1 + (def.falloffMin - 1) * k;
}

export function fireShot(match, p, w, def) {
  w.mag -= 1;
  const moving = p.moving;
  let spread = def.spread + p.bloom + (moving ? def.spreadMove : 0);
  if (p.control.ads) spread *= ADS_SPREAD_MULT;
  if ((p.y ?? 0) > 0.02 || (p.slideT ?? 0) > 0) spread *= MOVEMENT.airSpreadMult;
  else if (p.crouch) spread *= MOVEMENT.crouchSpreadMult;
  p.bloom = Math.min(def.bloomMax, p.bloom + def.bloomPerShot);
  p.lastShotAt = match.time;

  const ox = p.x;
  const oz = p.z;
  const hitsByTarget = new Map();
  const tracers = [];
  for (let i = 0; i < def.pellets; i++) {
    const a = p.control.aim + (match.rand() * 2 - 1) * spread;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    // The ray starts at the character center. Even if the muzzle is inside a wall, the wall hit comes first, so shooting through walls is impossible.
    const wall = raycastObstacles(match.map.index, ox, oz, dx, dz, def.range);
    let bestT = wall ? wall.t : def.range;
    let target = null;
    for (const o of match.players.values()) {
      if (o === p || !o.alive) continue;
      const t = rayCircle(ox, oz, dx, dz, o.x, o.z, HIT_RADIUS, bestT);
      if (t !== null && t < bestT) { bestT = t; target = o; }
    }
    const startT = Math.min(MUZZLE_OFFSET, bestT);
    tracers.push({
      x0: round(ox + dx * startT), z0: round(oz + dz * startT),
      x1: round(ox + dx * bestT), z1: round(oz + dz * bestT),
      h: target ? 1 : wall ? 2 : 0,
    });
    if (target) {
      const dmg = def.damage * damageMultiplier(def, bestT);
      hitsByTarget.set(target, (hitsByTarget.get(target) ?? 0) + dmg);
    }
  }
  match.emit({ type: 'shot', p: p.id, w: w.type, tr: tracers });
  for (const [target, dmg] of hitsByTarget) applyDamage(match, target, dmg, p, w.type);
}

export function applyDamage(match, target, amount, attacker, cause) {
  if (!target.alive || amount <= 0) return;
  target.hp -= amount;
  target.lastHitAt = match.time;
  if (attacker) attacker.damageDealt += amount;
  match.emit({ type: 'hit', t: target.id, by: attacker ? attacker.id : null, dmg: Math.round(amount), x: round(target.x), z: round(target.z), kill: target.hp <= 0 });
  if (target.hp <= 0) match.killPlayer(target, attacker, cause);
}

function round(v) {
  return Math.round(v * 100) / 100;
}
