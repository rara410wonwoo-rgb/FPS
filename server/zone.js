// Battle royale zone. Computed deterministically from server match time.
import { ZONE, WORLD_HALF } from '../shared/config.js';
import { pointBlocked } from '../shared/collision.js';

// Picking the next center from a disk of radius (r1 - r2) around the previous center keeps the next circle inside the previous one.
export function nextZone(prev, r2, rand) {
  const R = Math.max(0, prev.r - r2);
  const a = rand() * Math.PI * 2;
  const d = Math.sqrt(rand()) * R;
  return { x: prev.x + Math.cos(a) * d, z: prev.z + Math.sin(a) * d, r: r2 };
}

export class Zone {
  constructor(rand, map) {
    const steps = [...ZONE.phases, ZONE.suddenDeath];
    this.circles = [{ x: 0, z: 0, r: ZONE.initialRadius }];
    for (const step of steps) {
      const prev = this.circles[this.circles.length - 1];
      this.circles.push(this.pickNext(prev, step.radius, rand, map));
    }
    this.segments = [];
    let t = 0;
    this.segments.push({ start: 0, end: ZONE.firstWait, from: 0, to: 0, next: 1, phase: 0, stage: 'WAIT', dps: ZONE.initialDps });
    t = ZONE.firstWait;
    steps.forEach((step, i) => {
      const phase = i + 1;
      this.segments.push({ start: t, end: t + step.wait, from: i, to: i, next: i + 1, phase, stage: 'WAIT', dps: step.dps });
      t += step.wait;
      this.segments.push({ start: t, end: t + step.shrink, from: i, to: i + 1, next: i + 1, phase, stage: 'SHRINK', dps: step.dps });
      t += step.shrink;
    });
    const last = this.circles.length - 1;
    this.segments.push({ start: t, end: Infinity, from: last, to: last, next: last, phase: steps.length, stage: 'FINAL', dps: ZONE.suddenDeath.dps });
    this.totalPhases = ZONE.phases.length;
  }

  pickNext(prev, r2, rand, map) {
    if (r2 <= 0) return { x: prev.x, z: prev.z, r: 0 };
    const limit = WORLD_HALF - Math.min(r2, 30) - 4;
    for (let i = 0; i < 80; i++) {
      const c = nextZone(prev, r2, rand);
      if (Math.abs(c.x) > limit || Math.abs(c.z) > limit) continue;
      if (map && r2 < 45 && pointBlocked(map.index, c.x, c.z, 1.5)) continue;
      return c;
    }
    return { x: prev.x, z: prev.z, r: r2 };
  }

  segmentAt(elapsed) {
    for (const s of this.segments) if (elapsed < s.end) return s;
    return this.segments[this.segments.length - 1];
  }

  state(elapsed) {
    const seg = this.segmentAt(elapsed);
    const a = this.circles[seg.from];
    const b = this.circles[seg.to];
    let k = 0;
    if (seg.stage === 'SHRINK') k = Math.min(1, Math.max(0, (elapsed - seg.start) / (seg.end - seg.start)));
    const n = this.circles[seg.next];
    return {
      cx: a.x + (b.x - a.x) * k,
      cz: a.z + (b.z - a.z) * k,
      r: a.r + (b.r - a.r) * k,
      nx: n.x, nz: n.z, nr: n.r,
      phase: seg.phase,
      totalPhases: this.totalPhases,
      stage: seg.stage,
      sudden: seg.phase > this.totalPhases,
      timeLeft: Number.isFinite(seg.end) ? Math.max(0, seg.end - elapsed) : 0,
      dps: seg.dps,
    };
  }
}

export function outsideZone(z, x, zz) {
  return Math.hypot(x - z.cx, zz - z.cz) > z.r;
}
