// Seed-based battlefield generation. Server collision data and client visuals share the same definition.
import { WORLD_HALF, MAP_SEED } from './config.js';
import { mulberry32, SpatialIndex, pointBlocked } from './collision.js';

const ROAD_MAIN_W = 8;
const ROAD_LOOP_W = 6;
const LOOP = 55;
const PLAZA = 18;

export function buildRoads() {
  const H = WORLD_HALF;
  return [
    { minX: -H, maxX: H, minZ: -ROAD_MAIN_W / 2, maxZ: ROAD_MAIN_W / 2, kind: 'main' },
    { minX: -ROAD_MAIN_W / 2, maxX: ROAD_MAIN_W / 2, minZ: -H, maxZ: H, kind: 'main' },
    { minX: -LOOP - ROAD_LOOP_W / 2, maxX: LOOP + ROAD_LOOP_W / 2, minZ: -LOOP - ROAD_LOOP_W / 2, maxZ: -LOOP + ROAD_LOOP_W / 2, kind: 'loop' },
    { minX: -LOOP - ROAD_LOOP_W / 2, maxX: LOOP + ROAD_LOOP_W / 2, minZ: LOOP - ROAD_LOOP_W / 2, maxZ: LOOP + ROAD_LOOP_W / 2, kind: 'loop' },
    { minX: -LOOP - ROAD_LOOP_W / 2, maxX: -LOOP + ROAD_LOOP_W / 2, minZ: -LOOP, maxZ: LOOP, kind: 'loop' },
    { minX: LOOP - ROAD_LOOP_W / 2, maxX: LOOP + ROAD_LOOP_W / 2, minZ: -LOOP, maxZ: LOOP, kind: 'loop' },
  ];
}

function boxesOverlap(a, b, gap) {
  return a.minX - gap < b.maxX && a.maxX + gap > b.minX && a.minZ - gap < b.maxZ && a.maxZ + gap > b.minZ;
}

function box(cx, cz, w, d) {
  return { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 };
}

// For tests: build a map from just a list of obstacles.
export function makeMap(obstacles, extra = {}) {
  obstacles.forEach((o, i) => { o.id = i; if (o.h === undefined) o.h = 3; if (!o.kind) o.kind = 'wall'; });
  const map = {
    seed: extra.seed ?? 0,
    obstacles,
    trees: extra.trees ?? [],
    roads: extra.roads ?? [],
    index: new SpatialIndex(obstacles),
  };
  return map;
}

export function generateMap(seed = MAP_SEED) {
  const rand = mulberry32(seed);
  const R = (a, b) => a + rand() * (b - a);
  const roads = buildRoads();
  const obstacles = [];
  const trees = [];
  const H = WORLD_HALF;

  const fits = (b, gap, avoidRoads = true) => {
    if (b.minX < -H + 3 || b.maxX > H - 3 || b.minZ < -H + 3 || b.maxZ > H - 3) return false;
    if (avoidRoads && roads.some((r) => boxesOverlap(b, r, 1.2))) return false;
    if (obstacles.some((o) => boxesOverlap(b, o, gap))) return false;
    return true;
  };
  const inPlaza = (b) => boxesOverlap(b, { minX: -PLAZA, maxX: PLAZA, minZ: -PLAZA, maxZ: PLAZA }, 0);
  const outskirts = (x, z) => Math.max(Math.abs(x), Math.abs(z)) > 72;
  const add = (b, kind, h, extra = {}) => { obstacles.push({ ...b, kind, h, ...extra }); };

  // Central structure: watchtower + four L-shaped walls (open where the roads pass)
  add(box(0, 0, 5, 5), 'tower', 6.5);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      add({ minX: Math.min(sx * 5, sx * 12), maxX: Math.max(sx * 5, sx * 12), minZ: sz * 12 - 0.4, maxZ: sz * 12 + 0.4 }, 'wall', 2.4);
      add({ minX: sx * 12 - 0.4, maxX: sx * 12 + 0.4, minZ: Math.min(sz * 5, sz * 11.6), maxZ: Math.max(sz * 5, sz * 11.6) }, 'wall', 2.4);
      add(box(sx * 8, sz * 8, 1.6, 1.6), 'crate', 1.4);
    }
  }

  // buildings
  let placed = 0;
  for (let i = 0; i < 900 && placed < 34; i++) {
    const x = R(-92, 92);
    const z = R(-92, 92);
    if (outskirts(x, z) && rand() > 0.35) continue;
    const w = R(6, 13);
    const d = R(6, 13);
    const b = box(x, z, w, d);
    if (inPlaza(b) || !fits(b, 4)) continue;
    add(b, 'building', R(3.5, 7.5), { tone: Math.floor(rand() * 3) });
    placed++;
  }

  // low cover walls
  placed = 0;
  for (let i = 0; i < 600 && placed < 22; i++) {
    const x = R(-90, 90);
    const z = R(-90, 90);
    const len = R(4, 8);
    const b = rand() < 0.5 ? box(x, z, len, 0.7) : box(x, z, 0.7, len);
    if (inPlaza(b) || !fits(b, 2.2)) continue;
    add(b, 'wall', 1.35);
    placed++;
  }

  // crates
  placed = 0;
  for (let i = 0; i < 800 && placed < 55; i++) {
    const x = R(-94, 94);
    const z = R(-94, 94);
    const s = R(1.4, 2.0);
    const b = box(x, z, s, s);
    if (!fits(b, 1.8, rand() < 0.8)) continue;
    add(b, 'crate', R(1.2, 1.7), { rot: Math.floor(rand() * 4) });
    placed++;
  }

  // rocks
  placed = 0;
  for (let i = 0; i < 900 && placed < 40; i++) {
    const x = R(-94, 94);
    const z = R(-94, 94);
    if (!outskirts(x, z) && rand() > 0.4) continue;
    const w = R(1.6, 4);
    const d = R(1.6, 4);
    const b = box(x, z, w, d);
    if (inPlaza(b) || !fits(b, 2)) continue;
    add(b, 'rock', R(1.0, 2.4), { seed: Math.floor(rand() * 1e6) });
    placed++;
  }

  // trees: only the trunk collides; the crown is visual
  placed = 0;
  for (let i = 0; i < 1500 && placed < 110; i++) {
    const x = R(-95, 95);
    const z = R(-95, 95);
    if (!outskirts(x, z) && rand() > 0.3) continue;
    const b = box(x, z, 0.7, 0.7);
    if (inPlaza(b) || !fits(b, 2.4)) continue;
    const height = R(3.5, 6.5);
    add(b, 'tree', height);
    trees.push({ x, z, height, crown: rand() < 0.55 ? 'cone' : 'sphere', crownSize: R(1.0, 1.6), obstacleIndex: obstacles.length - 1 });
    placed++;
  }

  // abandoned cars by the road (vaultable height)
  placed = 0;
  for (let i = 0; i < 400 && placed < 14; i++) {
    const r = roads[Math.floor(rand() * roads.length)];
    const horizontal = r.maxX - r.minX > r.maxZ - r.minZ;
    const t = R(0.08, 0.92);
    const side = rand() < 0.5 ? -1 : 1;
    let b;
    if (horizontal) {
      const x = r.minX + (r.maxX - r.minX) * t;
      const z = side < 0 ? r.minZ - 1.6 : r.maxZ + 1.6;
      b = box(x, z, 4.4, 1.9);
    } else {
      const z = r.minZ + (r.maxZ - r.minZ) * t;
      const x = side < 0 ? r.minX - 1.6 : r.maxX + 1.6;
      b = box(x, z, 1.9, 4.4);
    }
    if (inPlaza(b) || !fits(b, 2.5, false) || roads.some((rd) => boxesOverlap(b, rd, 0.2))) continue;
    add(b, 'car', 1.7, { along: horizontal ? 'x' : 'z', flip: rand() < 0.5 });
    placed++;
  }

  obstacles.forEach((o, i) => { o.id = i; });
  return { seed, obstacles, trees, roads, index: new SpatialIndex(obstacles) };
}

// Find a position that does not overlap obstacles or the boundary.
export function findFreePoint(map, rand, radius, opts = {}) {
  const margin = opts.margin ?? 4;
  const avoid = opts.avoid ?? [];
  const minDist = opts.minDist ?? 0;
  const area = opts.area; // {x,z,r}
  for (let attempt = 0; attempt < 400; attempt++) {
    let x;
    let z;
    if (area) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * area.r;
      x = area.x + Math.cos(a) * d;
      z = area.z + Math.sin(a) * d;
    } else {
      x = -WORLD_HALF + margin + rand() * (WORLD_HALF - margin) * 2;
      z = -WORLD_HALF + margin + rand() * (WORLD_HALF - margin) * 2;
    }
    if (Math.abs(x) > WORLD_HALF - margin || Math.abs(z) > WORLD_HALF - margin) continue;
    if (pointBlocked(map.index, x, z, radius + 0.35)) continue;
    const relax = attempt > 300 ? 0.5 : 1;
    if (avoid.some((p) => Math.hypot(p.x - x, p.z - z) < minDist * relax)) continue;
    return { x, z };
  }
  // last resort: grid scan
  for (let x = -WORLD_HALF + margin; x < WORLD_HALF - margin; x += 1.5) {
    for (let z = -WORLD_HALF + margin; z < WORLD_HALF - margin; z += 1.5) {
      if (!pointBlocked(map.index, x, z, radius + 0.35)) return { x, z };
    }
  }
  throw new Error('free point not found');
}
