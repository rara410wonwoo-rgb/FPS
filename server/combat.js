// Server-authoritative combat: fire rate, ammo, reloading, hitscan, damage
import { WEAPONS, HIT_RADIUS, MUZZLE_OFFSET, ADS_SPREAD_MULT, MOVEMENT, LANDING_PROTECTION_S } from '../shared/config.js';
import { eyeHeight } from '../shared/aim.js';
import { rayBox3 } from '../shared/ray3.js';

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
    const pitch = p.control.pitch ?? 0;
    const dx = Math.cos(a) * Math.cos(pitch), dz = Math.sin(a) * Math.cos(pitch), dy = Math.sin(pitch);
    const oy = eyeHeight(p.y ?? 0, p.crouch);
    const origin = {x:ox,y:oy,z:oz}, dir = {x:dx,y:dy,z:dz};
    // The ray starts at the character center. Even if the muzzle is inside a wall, the wall hit comes first, so shooting through walls is impossible.
    let bestT = def.range, wall = null, target = null;
    if (dy < -1e-9) bestT = Math.min(bestT, -oy / dy);
    for (const o of match.map.obstacles) {
      const t = rayBox3(origin, dir, {x:[o.minX,o.maxX],y:[0,o.h ?? 3],z:[o.minZ,o.maxZ]}, bestT);
      if (t !== null && t <= bestT) { bestT=t; wall=o; }
    }
    for (const h of match.map.houses ?? []) {
      const t=rayBox3(origin,dir,{x:[h.minX,h.maxX],y:[h.h,h.h+0.2],z:[h.minZ,h.maxZ]},bestT);
      if(t!==null && t<bestT){bestT=t;wall=h;}
    }
    for (const o of match.players.values()) {
      if (o === p || !o.alive) continue;
      const t = rayBox3(origin,dir,{x:[o.x-HIT_RADIUS,o.x+HIT_RADIUS],y:[o.y ?? 0,(o.y ?? 0)+(o.crouch?1.25:1.85)],z:[o.z-HIT_RADIUS,o.z+HIT_RADIUS]},bestT);
      if (t !== null && t < bestT) {bestT=t;target=o;}
    }
    const startT = Math.min(MUZZLE_OFFSET, bestT);
    tracers.push({
      y0: round(oy + dy * startT), y1: round(oy + dy * bestT),
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
  // Players can't shoot while parachuting, so they can't be shot then either, nor right after landing
  if (attacker && (target.drop || match.time - (target.landedAt ?? -Infinity) < LANDING_PROTECTION_S)) return;
  target.hp -= amount;
  target.lastHitAt = match.time;
  if (attacker) attacker.damageDealt += amount;
  match.emit({ type: 'hit', t: target.id, by: attacker ? attacker.id : null, dmg: Math.round(amount), x: round(target.x), z: round(target.z), kill: target.hp <= 0 });
  if (target.hp <= 0) match.killPlayer(target, attacker, cause);
}

function round(v) {
  return Math.round(v * 100) / 100;
}
