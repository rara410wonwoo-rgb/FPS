// Slab intersection in world metres; returns distance along normalized ray.
export function rayBox3(origin, dir, box, limit) {
  let lo = 0, hi = limit;
  for (const axis of ['x','y','z']) {
    const d = dir[axis], o = origin[axis], min = box[axis][0], max = box[axis][1];
    if (Math.abs(d) < 1e-9) { if (o < min || o > max) return null; continue; }
    const a = (min-o)/d, b = (max-o)/d;
    lo = Math.max(lo, Math.min(a,b)); hi = Math.min(hi, Math.max(a,b));
    if (lo > hi) return null;
  }
  return lo;
}
