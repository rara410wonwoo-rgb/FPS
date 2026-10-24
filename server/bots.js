// Bot AI: roam → look for items → detect enemies → fight → move to the safe zone
// Bots only notice enemies by sight (FOV + obstacle occlusion) and gunfire (rough position).
import { BOT, WORLD_HALF, PLAYER_RADIUS, WEAPONS, PICKUP_RANGE, MAX_HP } from '../shared/config.js';
import { pointBlocked, segmentBlocked, wrapAngle, lerpAngle } from '../shared/collision.js';
import { findFreePoint } from '../shared/map.js';
import { currentWeapon } from './combat.js';

// ---------- grid A* ----------
export class NavGrid {
  constructor(map, cell = 1) {
    this.cell = cell;
    this.size = Math.ceil((WORLD_HALF * 2) / cell);
    this.blocked = new Uint8Array(this.size * this.size);
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const [x, z] = this.toWorld(c, r);
        if (pointBlocked(map.index, x, z, PLAYER_RADIUS + 0.2)) this.blocked[r * this.size + c] = 1;
      }
    }
    const n = this.size * this.size;
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.came = new Int32Array(n);
    this.openStamp = new Uint32Array(n);
    this.closedStamp = new Uint32Array(n);
    this.stamp = 0;
    this.heap = new Int32Array(n);
  }

  toCell(x, z) {
    const c = Math.max(0, Math.min(this.size - 1, Math.floor((x + WORLD_HALF) / this.cell)));
    const r = Math.max(0, Math.min(this.size - 1, Math.floor((z + WORLD_HALF) / this.cell)));
    return [c, r];
  }

  toWorld(c, r) {
    return [-WORLD_HALF + (c + 0.5) * this.cell, -WORLD_HALF + (r + 0.5) * this.cell];
  }

  free(c, r) {
    return c >= 0 && r >= 0 && c < this.size && r < this.size && !this.blocked[r * this.size + c];
  }

  nearestFree(c, r) {
    if (this.free(c, r)) return [c, r];
    for (let rad = 1; rad < 8; rad++) {
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
          if (this.free(c + dc, r + dr)) return [c + dc, r + dr];
        }
      }
    }
    return null;
  }

  // whether a straight line between grid cells is walkable (for path shortcuts)
  lineFree(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(d / (this.cell * 0.5));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const [c, r] = this.toCell(ax + (bx - ax) * t, az + (bz - az) * t);
      if (!this.free(c, r)) return false;
    }
    return true;
  }

  findPath(sx, sz, gx, gz, maxNodes = 6000) {
    const s0 = this.toCell(sx, sz);
    const g0 = this.toCell(gx, gz);
    const s = this.nearestFree(s0[0], s0[1]);
    const g = this.nearestFree(g0[0], g0[1]);
    if (!s || !g) return null;
    const N = this.size;
    const start = s[1] * N + s[0];
    const goal = g[1] * N + g[0];
    this.stamp++;
    if (this.stamp > 0xfffffff0) { this.openStamp.fill(0); this.closedStamp.fill(0); this.stamp = 1; }
    const st = this.stamp;
    const heap = this.heap;
    let hs = 0;
    const f = this.f;
    const push = (i) => {
      let k = hs++;
      heap[k] = i;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (f[heap[p]] <= f[heap[k]]) break;
        const t = heap[p]; heap[p] = heap[k]; heap[k] = t; k = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      heap[0] = heap[--hs];
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < hs && f[heap[l]] < f[heap[m]]) m = l;
        if (r < hs && f[heap[r]] < f[heap[m]]) m = r;
        if (m === k) break;
        const t = heap[m]; heap[m] = heap[k]; heap[k] = t; k = m;
      }
      return top;
    };
    const h = (i) => {
      const dx = Math.abs((i % N) - g[0]);
      const dz = Math.abs(((i / N) | 0) - g[1]);
      return Math.max(dx, dz) + 0.41421356 * Math.min(dx, dz);
    };
    this.g[start] = 0;
    f[start] = h(start);
    this.came[start] = -1;
    this.openStamp[start] = st;
    push(start);
    let expanded = 0;
    let found = false;
    while (hs > 0) {
      const cur = pop();
      if (this.closedStamp[cur] === st) continue;
      this.closedStamp[cur] = st;
      if (cur === goal) { found = true; break; }
      if (++expanded > maxNodes) break;
      const cc = cur % N;
      const cr = (cur / N) | 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nc = cc + dc;
          const nr = cr + dr;
          if (!this.free(nc, nr)) continue;
          if (dr && dc && (!this.free(cc + dc, cr) || !this.free(cc, cr + dr))) continue; // no corner cutting
          const ni = nr * N + nc;
          if (this.closedStamp[ni] === st) continue;
          const ng = this.g[cur] + (dr && dc ? 1.41421356 : 1);
          if (this.openStamp[ni] === st && ng >= this.g[ni]) continue;
          this.openStamp[ni] = st;
          this.g[ni] = ng;
          f[ni] = ng + h(ni);
          this.came[ni] = cur;
          push(ni);
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let i = goal; i !== -1; i = this.came[i]) cells.push(i);
    cells.reverse();
    const pts = cells.map((i) => this.toWorld(i % N, (i / N) | 0));
    // string pulling
    const out = [];
    let anchor = [sx, sz];
    let k = 0;
    while (k < pts.length) {
      let far = k;
      for (let j = pts.length - 1; j > k; j--) {
        if (this.lineFree(anchor[0], anchor[1], pts[j][0], pts[j][1])) { far = j; break; }
      }
      out.push({ x: pts[far][0], z: pts[far][1] });
      anchor = pts[far];
      k = far + 1;
    }
    return out;
  }
}

export function getNav(map) {
  if (!map.nav) map.nav = new NavGrid(map);
  return map.nav;
}

// ---------- bot brains ----------
const PREFERRED_RANGE = { rifle: 16, smg: 9, shotgun: 5 };

export class BotDirector {
  constructor(match) {
    this.match = match;
    this.brains = new Map();
    let i = 0;
    for (const p of match.players.values()) {
      if (!p.bot) continue;
      this.brains.set(p.id, this.makeBrain(i++));
    }
    this._nav = null;
  }

  get nav() {
    if (!this._nav) this._nav = getNav(this.match.map);
    return this._nav;
  }

  makeBrain(i) {
    const rand = this.match.rand;
    return {
      state: 'WANDER', goal: null, path: null, pathIdx: 0, repathT: 0,
      perceiveT: rand() * BOT.perceptionInterval,
      target: null, targetVisible: false, lastSeen: null, lastSeenT: -99,
      reactionT: 0, aimErr: BOT.aimErrorStart, jitterSeed: rand() * 100,
      strafeDir: rand() < 0.5 ? -1 : 1, strafeT: 0,
      stuckT: 0, lastPos: null, nudgeT: 0, nudge: null,
      investigate: null, investigateT: 0,
      wanderT: 0, zoneGoalPhase: -1,
      skill: 0.8 + rand() * 0.4,
      lootId: null, idx: i,
    };
  }

  think(dt) {
    for (const [id, b] of this.brains) {
      const p = this.match.players.get(id);
      if (!p || !p.alive) continue;
      this.thinkOne(p, b, dt);
    }
  }

  perceive(p, b) {
    const m = this.match;
    let best = null;
    let bestD = Infinity;
    for (const o of m.players.values()) {
      if (o === p || !o.alive) continue;
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      if (d > BOT.sightRange || d >= bestD) continue;
      if (d > BOT.closeAwareness) {
        const ang = Math.atan2(o.z - p.z, o.x - p.x);
        if (Math.abs(wrapAngle(ang - p.aim)) > BOT.fov / 2) continue;
      }
      if (segmentBlocked(m.map.index, p.x, p.z, o.x, o.z)) continue;
      best = o;
      bestD = d;
    }
    if (best) {
      if (b.target !== best || !b.targetVisible) {
        if (b.target !== best) b.aimErr = BOT.aimErrorStart / b.skill;
        b.reactionT = (BOT.reactionMin + m.rand() * (BOT.reactionMax - BOT.reactionMin)) / b.skill;
      }
      b.target = best;
      b.targetVisible = true;
      b.lastSeen = { x: best.x, z: best.z };
      b.lastSeenT = m.time;
    } else {
      b.targetVisible = false;
      if (b.target && (!b.target.alive || m.time - b.lastSeenT > 4)) b.target = null;
    }
    if (!b.target) {
      for (const n of m.noise) {
        if (n.p === p.id) continue;
        if (Math.hypot(n.x - p.x, n.z - p.z) < BOT.hearingRange) {
          b.investigate = { x: n.x + (m.rand() * 2 - 1) * 4, z: n.z + (m.rand() * 2 - 1) * 4 };
          b.investigateT = 6;
          break;
        }
      }
    }
  }

  chooseLoot(p, b) {
    const m = this.match;
    const w = currentWeapon(p);
    const def = w ? WEAPONS[w.type] : null;
    const needHeal = p.hp < 70;
    const needAmmo = w && w.mag + w.reserve < def.magSize * 1.5;
    const needWeapon = p.weapons.some((x) => !x);
    let best = null;
    let bestScore = Infinity;
    for (const it of m.items.values()) {
      if (it.type === 'medkit' && !needHeal) continue;
      if (it.type === 'ammo' && !needAmmo) continue;
      if (it.type === 'crate' && !needWeapon) continue;
      const d = Math.hypot(it.x - p.x, it.z - p.z);
      if (d > 24) continue;
      if (d > 8 && segmentBlocked(m.map.index, p.x, p.z, it.x, it.z)) continue;
      const score = d * (it.type === 'medkit' && p.hp < 40 ? 0.5 : 1);
      if (score < bestScore) { bestScore = score; best = it; }
    }
    return best;
  }

  thinkOne(p, b, dt) {
    const m = this.match;
    const c = p.control;
    b.perceiveT -= dt;
    if (b.perceiveT <= 0) {
      b.perceiveT = BOT.perceptionInterval;
      this.perceive(p, b);
    }
    if (b.investigateT > 0) { b.investigateT -= dt; if (b.investigateT <= 0) b.investigate = null; }

    const z = m.zoneState;
    const distCur = Math.hypot(p.x - z.cx, p.z - z.cz);
    const distNext = Math.hypot(p.x - z.nx, p.z - z.nz);
    const outside = distCur > z.r - 2;
    const urgent = (z.stage === 'SHRINK' || (z.stage === 'WAIT' && z.left < 14) || z.stage === 'FINAL') && distNext > z.nr - 2;

    const w = currentWeapon(p);
    const def = w ? WEAPONS[w.type] : null;
    let moveTo = null;
    let faceMove = true;
    c.fire = false;
    c.ads = false;

    if (b.target && b.target.alive) {
      const t = b.target;
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      if (b.targetVisible) {
        b.state = 'ENGAGE';
        faceMove = false;
        b.reactionT -= dt;
        b.aimErr = Math.max(BOT.aimErrorMin / b.skill, b.aimErr * Math.exp(-BOT.aimErrorDecay * dt));
        const jitter = Math.sin(m.time * 3.1 + b.jitterSeed) * b.aimErr + Math.sin(m.time * 7.3 + b.jitterSeed * 2) * b.aimErr * 0.4;
        const want = Math.atan2(t.z - p.z, t.x - p.x) + jitter;
        c.aim = lerpAngle(c.aim, want, Math.min(1, dt * 9));
        if (def) {
          const range = def.range * 0.95;
          b.burstT = (b.burstT ?? 0) - dt;
          if (b.burstT <= 0) { b.bursting = !b.bursting; b.burstT = (b.bursting ? BOT.burstOn : BOT.burstOff) * (0.7 + m.rand() * 0.6); }
          c.fire = b.bursting && b.reactionT <= 0 && d <= range && w.mag > 0 && p.reloadT <= 0;
          c.ads = d > 16 && def.kind === 'rifle';
          // decide whether to swap weapons
          const other = p.weapons[(p.slot + 1) % p.weapons.length];
          if (other && other.mag + other.reserve > 0) {
            const odef = WEAPONS[other.type];
            if ((w.mag === 0 && w.reserve === 0)
              || (d < 7 && odef.kind === 'shotgun' && def.kind !== 'shotgun')
              || (d > 14 && def.kind === 'shotgun')) p.pending.swap = true;
          }
          if (w.mag === 0) p.pending.reload = true;
          const pref = PREFERRED_RANGE[def.kind] ?? 12;
          b.strafeT -= dt;
          if (b.strafeT <= 0) { b.strafeT = 0.7 + m.rand() * 0.9; b.strafeDir *= -1; }
          const ang = Math.atan2(t.z - p.z, t.x - p.x);
          let mx = -Math.sin(ang) * b.strafeDir * 0.8;
          let mz = Math.cos(ang) * b.strafeDir * 0.8;
          const retreat = p.hp < 35 && d > 6;
          if (retreat) { mx = -Math.cos(ang) + mx * 0.5; mz = -Math.sin(ang) + mz * 0.5; c.fire = c.fire && d < 14; }
          else if (d > pref + 5) { mx += Math.cos(ang); mz += Math.sin(ang); } else if (d < pref - 3) { mx -= Math.cos(ang); mz -= Math.sin(ang); }
          if (outside || urgent) {
            const za = Math.atan2(z.nz - p.z, z.nx - p.x);
            mx = Math.cos(za); mz = Math.sin(za);
            moveTo = { x: z.nx, z: z.nz };
          } else {
            c.mx = mx; c.mz = mz;
            this.applyNudge(p, b, dt, true);
            return;
          }
        }
      } else {
        b.state = 'CHASE';
        moveTo = b.lastSeen;
        if (b.lastSeen && Math.hypot(b.lastSeen.x - p.x, b.lastSeen.z - p.z) < 1.5) b.target = null;
      }
    }

    if (!moveTo) {
      if (outside || urgent) {
        b.state = 'ZONE';
        if (b.zoneGoalPhase !== z.phase || !b.goal) {
          b.zoneGoalPhase = z.phase;
          b.goal = this.pointIn(z.nx, z.nz, Math.max(1, z.nr * 0.5));
          b.path = null;
        }
        moveTo = b.goal;
      } else {
        const loot = this.chooseLoot(p, b);
        if (loot) {
          b.state = 'LOOT';
          moveTo = { x: loot.x, z: loot.z };
          if (Math.hypot(loot.x - p.x, loot.z - p.z) < PICKUP_RANGE * 0.8) p.pending.interact = true;
        } else if (b.investigate) {
          b.state = 'INVESTIGATE';
          moveTo = b.investigate;
          if (Math.hypot(b.investigate.x - p.x, b.investigate.z - p.z) < 2) b.investigate = null;
        } else {
          b.state = 'WANDER';
          b.wanderT -= dt;
          const arrived = b.goal && Math.hypot(b.goal.x - p.x, b.goal.z - p.z) < 1.5;
          if (arrived && !(b.idleT > 0)) b.idleT = 2 + m.rand() * 5; // on arrival, stay alert for a moment
          if (b.idleT > 0) {
            b.idleT -= dt;
            c.mx = 0; c.mz = 0;
            c.aim = wrapAngle(c.aim + dt * 0.9 * b.strafeDir);
            if (b.idleT <= 0) b.goal = null;
            if (w && def && w.mag < def.magSize && w.reserve > 0) p.pending.reload = true;
            this.applyNudge(p, b, dt, false);
            return;
          }
          if (!b.goal || b.wanderT <= 0) {
            // pick a point inside the next safe zone near the current position (up to 25)
            const zr = Math.max(4, Math.min(z.r, z.nr + 8) * 0.8);
            let gx = p.x + (m.rand() * 2 - 1) * 25;
            let gz = p.z + (m.rand() * 2 - 1) * 25;
            const dd = Math.hypot(gx - z.nx, gz - z.nz);
            if (dd > zr) { gx = z.nx + ((gx - z.nx) / dd) * zr; gz = z.nz + ((gz - z.nz) / dd) * zr; }
            b.goal = this.pointIn(gx, gz, 6);
            b.wanderT = 10 + m.rand() * 8;
            b.path = null;
          }
          moveTo = b.goal;
          b.walk = true;
          if (w && def && w.mag < def.magSize * 0.5 && w.reserve > 0) p.pending.reload = true;
        }
      }
    }

    if (moveTo) this.follow(p, b, moveTo, dt);
    else { c.mx = 0; c.mz = 0; }
    if (b.walk) { c.mx *= 0.55; c.mz *= 0.55; b.walk = false; } // patrol at walking speed
    if (faceMove && (c.mx || c.mz)) c.aim = lerpAngle(c.aim, Math.atan2(c.mz, c.mx), Math.min(1, dt * 6));
    this.applyNudge(p, b, dt, false);
  }

  pointIn(x, z, r) {
    try {
      return findFreePoint(this.match.map, this.match.rand, PLAYER_RADIUS, { area: { x, z, r }, margin: 4 });
    } catch {
      return { x, z };
    }
  }

  follow(p, b, goal, dt) {
    const m = this.match;
    const c = p.control;
    b.repathT -= dt;
    const goalMoved = !b.pathGoal || Math.hypot(b.pathGoal.x - goal.x, b.pathGoal.z - goal.z) > 3;
    const d = Math.hypot(goal.x - p.x, goal.z - p.z);
    if (d < 12 && !segmentBlocked(m.map.index, p.x, p.z, goal.x, goal.z)) {
      b.path = null;
      this.steer(p, goal.x, goal.z);
      return;
    }
    if (!b.path || goalMoved || b.repathT <= 0) {
      b.path = this.nav.findPath(p.x, p.z, goal.x, goal.z) ?? [{ x: goal.x, z: goal.z }];
      b.pathIdx = 0;
      b.pathGoal = { x: goal.x, z: goal.z };
      b.repathT = BOT.repathInterval * (0.8 + m.rand() * 0.4);
    }
    let wp = b.path[b.pathIdx];
    while (wp && Math.hypot(wp.x - p.x, wp.z - p.z) < 0.8 && b.pathIdx < b.path.length - 1) {
      b.pathIdx++;
      wp = b.path[b.pathIdx];
    }
    if (!wp) { c.mx = 0; c.mz = 0; return; }
    this.steer(p, wp.x, wp.z);
  }

  steer(p, x, z) {
    const dx = x - p.x;
    const dz = z - p.z;
    const l = Math.hypot(dx, dz);
    if (l < 0.3) { p.control.mx = 0; p.control.mz = 0; return; }
    p.control.mx = dx / l;
    p.control.mz = dz / l;
  }

  // stuck detection: if barely moved for 1s, re-path and sidestep
  applyNudge(p, b, dt, engaged) {
    const c = p.control;
    if (b.nudgeT > 0) {
      b.nudgeT -= dt;
      c.mx = b.nudge.x; c.mz = b.nudge.z;
      return;
    }
    b.stuckT += dt;
    if (b.stuckT >= 1) {
      const moved = b.lastPos ? Math.hypot(p.x - b.lastPos.x, p.z - b.lastPos.z) : 9;
      const trying = Math.hypot(c.mx, c.mz) > 0.3;
      if (trying && moved < 0.6) {
        const a = this.match.rand() * Math.PI * 2;
        b.nudge = { x: Math.cos(a), z: Math.sin(a) };
        b.nudgeT = 0.5;
        b.path = null;
        if (engaged) b.strafeDir *= -1;
      }
      b.stuckT = 0;
      b.lastPos = { x: p.x, z: p.z };
    }
    if (p.hp < MAX_HP * 0.3 && b.state === 'ENGAGE' && this.match.rand() < 0.002) b.strafeDir *= -1;
  }
}
