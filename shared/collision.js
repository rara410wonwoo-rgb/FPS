// 2D (XZ plane) collision and ray tests. Server judgment and client prediction share this code.
import { WORLD_HALF } from './config.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Slab method. (dx,dz) is a unit vector. Returns hit distance t (≥ 0) or null.
export function rayAABB(ox, oz, dx, dz, b, maxT) {
  let tmin = 0;
  let tmax = maxT;
  if (Math.abs(dx) < 1e-9) {
    if (ox < b.minX || ox > b.maxX) return null;
  } else {
    let t1 = (b.minX - ox) / dx;
    let t2 = (b.maxX - ox) / dx;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (Math.abs(dz) < 1e-9) {
    if (oz < b.minZ || oz > b.maxZ) return null;
  } else {
    let t1 = (b.minZ - oz) / dz;
    let t2 = (b.maxZ - oz) / dz;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin;
}

// Ray-circle (ray-sphere seen from above). (dx,dz) is a unit vector.
export function rayCircle(ox, oz, dx, dz, cx, cz, r, maxT) {
  const mx = ox - cx;
  const mz = oz - cz;
  const b = mx * dx + mz * dz;
  const c = mx * mx + mz * mz - r * r;
  if (c > 0 && b > 0) return null;
  const disc = b * b - c;
  if (disc < 0) return null;
  let t = -b - Math.sqrt(disc);
  if (t < 0) t = 0;
  return t <= maxT ? t : null;
}

export function circleOverlapsAABB(x, z, r, b) {
  const cx = Math.max(b.minX, Math.min(x, b.maxX));
  const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
  const dx = x - cx;
  const dz = z - cz;
  return dx * dx + dz * dz < r * r;
}

// Push a circle out of an AABB. Returns true if it was overlapping.
export function resolveCircleAABB(p, r, b) {
  const cx = Math.max(b.minX, Math.min(p.x, b.maxX));
  const cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
  const dx = p.x - cx;
  const dz = p.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    p.x += (dx / d) * (r - d);
    p.z += (dz / d) * (r - d);
  } else {
    const left = p.x - b.minX;
    const right = b.maxX - p.x;
    const top = p.z - b.minZ;
    const bottom = b.maxZ - p.z;
    const m = Math.min(left, right, top, bottom);
    if (m === left) p.x = b.minX - r;
    else if (m === right) p.x = b.maxX + r;
    else if (m === top) p.z = b.minZ - r;
    else p.z = b.maxZ + r;
  }
  return true;
}

// uniform grid spatial index
export class SpatialIndex {
  constructor(obstacles, cellSize = 10) {
    this.obstacles = obstacles;
    this.cellSize = cellSize;
    this.cols = Math.ceil((WORLD_HALF * 2 + 20) / cellSize);
    this.offset = WORLD_HALF + 10;
    this.cells = new Array(this.cols * this.cols);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
    this.stamp = new Uint32Array(obstacles.length);
    this.stampId = 0;
    obstacles.forEach((o, i) => {
      const [c0, r0] = this.cellOf(o.minX, o.minZ);
      const [c1, r1] = this.cellOf(o.maxX, o.maxZ);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.cells[r * this.cols + c].push(i);
    });
  }

  cellOf(x, z) {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor((x + this.offset) / this.cellSize)));
    const r = Math.min(this.cols - 1, Math.max(0, Math.floor((z + this.offset) / this.cellSize)));
    return [c, r];
  }

  query(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    this.stampId = (this.stampId + 1) >>> 0;
    if (this.stampId === 0) { this.stamp.fill(0); this.stampId = 1; }
    const [c0, r0] = this.cellOf(minX, minZ);
    const [c1, r1] = this.cellOf(maxX, maxZ);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = this.cells[r * this.cols + c];
        for (let k = 0; k < cell.length; k++) {
          const i = cell[k];
          if (this.stamp[i] === this.stampId) continue;
          this.stamp[i] = this.stampId;
          out.push(this.obstacles[i]);
        }
      }
    }
    return out;
  }
}

const scratch = [];

// nearest obstacle hit: {t, obstacle} or null
export function raycastObstacles(index, ox, oz, dx, dz, maxT) {
  const ex = ox + dx * maxT;
  const ez = oz + dz * maxT;
  const cands = index.query(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez), scratch);
  let best = null;
  let bestT = maxT;
  for (let i = 0; i < cands.length; i++) {
    const t = rayAABB(ox, oz, dx, dz, cands[i], bestT);
    if (t !== null && t <= bestT) { bestT = t; best = cands[i]; }
  }
  return best ? { t: bestT, obstacle: best } : null;
}

export function segmentBlocked(index, ax, az, bx, bz) {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 1e-6) return false;
  return raycastObstacles(index, ax, az, (bx - ax) / len, (bz - az) / len, len) !== null;
}

export function clampToWorld(p, r) {
  const lim = WORLD_HALF - r;
  if (p.x < -lim) p.x = -lim; else if (p.x > lim) p.x = lim;
  if (p.z < -lim) p.z = -lim; else if (p.z > lim) p.z = lim;
}

const moveScratch = [];
// axis-separated movement + substeps (prevents tunneling)
export function moveCircle(index, p, dx, dz, r) {
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(dist / (r * 0.8)));
  const sx = dx / steps;
  const sz = dz / steps;
  for (let s = 0; s < steps; s++) {
    p.x += sx;
    let c = index.query(p.x - r, p.z - r, p.x + r, p.z + r, moveScratch);
    for (let i = 0; i < c.length; i++) resolveCircleAABB(p, r, c[i]);
    p.z += sz;
    c = index.query(p.x - r, p.z - r, p.x + r, p.z + r, moveScratch);
    for (let i = 0; i < c.length; i++) resolveCircleAABB(p, r, c[i]);
    clampToWorld(p, r);
  }
}

export function pointBlocked(index, x, z, r) {
  if (Math.abs(x) > WORLD_HALF - r || Math.abs(z) > WORLD_HALF - r) return true;
  const c = index.query(x - r, z - r, x + r, z + r, moveScratch);
  for (let i = 0; i < c.length; i++) if (circleOverlapsAABB(x, z, r, c[i])) return true;
  return false;
}

export function wrapAngle(a) {
  a = a % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  else if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function lerpAngle(a, b, t) {
  return a + wrapAngle(b - a) * t;
}
