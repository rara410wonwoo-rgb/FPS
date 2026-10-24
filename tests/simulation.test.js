import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap, findFreePoint } from '../shared/map.js';
import { pointBlocked, mulberry32, circleOverlapsAABB } from '../shared/collision.js';
import { stepMovement, normalizeMove } from '../shared/movement.js';
import { MOVE_SPEED, ZONE, TICK_DT, PLAYER_RADIUS, MAX_HP, INPUT_TIMEOUT_MS, WORLD_HALF } from '../shared/config.js';
import { Match } from '../server/simulation.js';
import { Zone, nextZone } from '../server/zone.js';
import { NavGrid } from '../server/bots.js';
import { emptyMatch, place, stepN, DT } from './helpers.js';

const map = generateMap();
const inp = (seq, mx, mz, extra = {}) => ({ seq, mx, mz, aim: 0, fire: false, ads: false, reload: false, interact: false, swap: false, ...extra });

describe('map', () => {
  it('the same seed makes the same map', () => {
    const a = generateMap(123);
    const b = generateMap(123);
    assert.deepEqual(a.obstacles.map((o) => [o.minX, o.minZ, o.kind]), b.obstacles.map((o) => [o.minX, o.minZ, o.kind]));
    assert.notDeepEqual(generateMap(124).obstacles.slice(20, 25).map((o) => o.minX), a.obstacles.slice(20, 25).map((o) => o.minX));
  });
  it('has buildings, rocks, trees, roads and the central structure', () => {
    const kinds = new Set(map.obstacles.map((o) => o.kind));
    for (const k of ['rock', 'tree', 'crate', 'wall', 'tower']) assert.ok(kinds.has(k), k);
    assert.ok(map.houses.length > 20);
    assert.ok(map.roads.length >= 4);
    for (const o of map.obstacles) assert.ok(o.minX >= -WORLD_HALF && o.maxX <= WORLD_HALF && o.minZ >= -WORLD_HALF && o.maxZ <= WORLD_HALF);
  });
  it('players and items never spawn inside obstacles (several matches)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const m = new Match({ map, seed });
      for (const p of m.players.values()) {
        assert.ok(!pointBlocked(map.index, p.x, p.z, PLAYER_RADIUS), `player ${p.id} seed ${seed}`);
      }
      for (const it of m.items.values()) {
        assert.ok(!map.obstacles.some((o) => circleOverlapsAABB(it.x, it.z, 0.6, o)), `item seed ${seed}`);
      }
      assert.equal(m.players.size, 12);
    }
  });
});

describe('movement', () => {
  it('diagonal input is normalized and does not increase speed', () => {
    const [x, z] = normalizeMove(1, 1);
    assert.ok(Math.abs(Math.hypot(x, z) - 1) < 1e-9);
    const m = emptyMatch();
    const a = place(m, 'A', 0, 0);
    const before = { x: a.x, z: a.z };
    const now = { t: 0 };
    stepN(m, 30, now, (i) => m.queueInput('A', inp(i + 1, 1, 1), now.t));
    const dist = Math.hypot(a.x - before.x, a.z - before.z);
    assert.ok(Math.abs(dist - MOVE_SPEED) < 0.05, `distance in 1s: ${dist}`);
  });
  it('cannot move through walls', () => {
    const m = emptyMatch([{ minX: 3, maxX: 3.5, minZ: -10, maxZ: 10, h: 3 }]);
    const a = place(m, 'A', 0, 0);
    const now = { t: 0 };
    for (let i = 1; i <= 20; i++) m.queueInput('A', inp(i, 1, 0), now.t);
    stepN(m, 20, now);
    for (let i = 21; i <= 40; i++) m.queueInput('A', inp(i, 1, 0), now.t);
    stepN(m, 20, now);
    assert.ok(a.x <= 3 - PLAYER_RADIUS + 1e-6, `x=${a.x}`);
  });
  it('fast movement does not tunnel through thin walls', () => {
    const m = emptyMatch([{ minX: 1, maxX: 1.1, minZ: -5, maxZ: 5 }]);
    const pos = { x: 0, z: 0 };
    stepMovement(m.map.index, pos, { mx: 1, mz: 0, ads: false }, 2, 'kestrel'); // 14 units in one step
    assert.ok(pos.x < 1);
  });
  it('firing and movement go neutral 300ms after input stops', () => {
    const m = emptyMatch();
    const a = place(m, 'A', 0, 0);
    place(m, 'B', 40, 40);
    const now = { t: 0 };
    m.queueInput('A', inp(1, 1, 0, { fire: true, aim: Math.PI / 2 }), now.t);
    stepN(m, 1, now);
    assert.equal(a.control.fire, true);
    stepN(m, Math.ceil((INPUT_TIMEOUT_MS + 50) / (DT * 1000)), now);
    assert.equal(a.control.fire, false);
    const x = a.x;
    stepN(m, 10, now);
    assert.equal(a.x, x);
  });
  it('the input buffer has a limit', () => {
    const m = emptyMatch();
    const a = m.players.get('A');
    for (let i = 1; i <= 200; i++) m.queueInput('A', inp(i, 1, 0), 0);
    assert.ok(a.queue.length <= 20);
    assert.equal(m.queueInput('A', inp(50, 1, 0), 0), false, 'out-of-order seq rejected');
  });
});

describe('zone', () => {
  it('the next circle is always inside the previous one', () => {
    const rand = mulberry32(42);
    for (let i = 0; i < 5000; i++) {
      const prev = { x: rand() * 40 - 20, z: rand() * 40 - 20, r: 20 + rand() * 100 };
      const n = nextZone(prev, prev.r * rand(), rand);
      assert.ok(Math.hypot(n.x - prev.x, n.z - prev.z) + n.r <= prev.r + 1e-9);
    }
    for (let seed = 1; seed <= 50; seed++) {
      const z = new Zone(mulberry32(seed), map);
      for (let i = 1; i < z.circles.length; i++) {
        const a = z.circles[i - 1];
        const b = z.circles[i];
        assert.ok(Math.hypot(a.x - b.x, a.z - b.z) + b.r <= a.r + 1e-9, `seed ${seed} step ${i}`);
      }
    }
  });
  it('schedule: start 135, 30s wait, 5 phases (20+25), final 12', () => {
    const z = new Zone(mulberry32(3), map);
    assert.equal(z.state(0).r, ZONE.initialRadius);
    assert.equal(z.state(29.9).r, ZONE.initialRadius);
    assert.equal(z.state(29.9).stage, 'WAIT');
    assert.equal(z.state(31).stage, 'WAIT');
    assert.equal(z.state(31).phase, 1);
    const mid = z.state(30 + 20 + 12.5);
    assert.equal(mid.stage, 'SHRINK');
    assert.ok(mid.r < ZONE.initialRadius && mid.r > ZONE.phases[0].radius);
    assert.equal(z.state(30 + 45 * 5 - 0.001).r.toFixed(2), String(ZONE.phases[4].radius.toFixed(2)));
    assert.ok(Math.abs(z.state(30 + 45 * 5).r - 12) < 1e-6);
  });
  it('outside the safe zone, damage is based on delta time', () => {
    const m = emptyMatch([], ['A', 'B']);
    const a = place(m, 'A', WORLD_HALF-1, WORLD_HALF-1); // outside the radius-135 circle (diagonal distance 140)
    place(m, 'B', 0, 0);
    const now = { t: 0 };
    stepN(m, 60, now); // 2s × 1 dps
    assert.ok(Math.abs(MAX_HP - a.hp - 2) < 0.05, `hp=${a.hp}`);
    const b = m.players.get('B');
    assert.equal(b.hp, MAX_HP);
  });
});

describe('full match loop', () => {
  it('a 12-bot match ends with a winner', () => {
    for (const seed of [11, 12, 13]) {
      const m = new Match({ map, seed });
      let now = 0;
      let shots = 0;
      let kills = 0;
      while (m.state !== 'FINISHED' && m.elapsed < 700) {
        m.step(TICK_DT, now); now += 1000 / 30;
        for (const e of m.drainEvents()) { if (e.type === 'shot') shots++; if (e.type === 'kill') kills++; }
      }
      assert.equal(m.state, 'FINISHED', `seed ${seed}`);
      assert.ok(shots > 50 && kills === 11, `shots ${shots} kills ${kills}`);
      assert.ok(m.results.winnerId || m.results.draw);
      const placements = m.results.rows.map((r) => r.placement).sort((a, b) => a - b);
      assert.equal(placements[0], 1);
    }
  });
  it('draw when everyone is eliminated', () => {
    const m = emptyMatch([], ['A', 'B']);
    const a = place(m, 'A', WORLD_HALF-1, WORLD_HALF-1);
    const b = place(m, 'B', -WORLD_HALF+1, -WORLD_HALF+1);
    a.hp = 0.5; b.hp = 0.5;
    stepN(m, 30, { t: 0 });
    assert.equal(m.state, 'FINISHED');
    assert.equal(m.results.draw, true);
    assert.equal(a.placement, 1);
    assert.equal(b.placement, 1);
  });
  it('items: range check, no double pickup, healing', () => {
    const m = emptyMatch();
    const a = place(m, 'A', 0, 0);
    place(m, 'B', 50, 50);
    a.hp = 40;
    const id = m.addItem('medkit', 1.5, 0);
    const far = m.addItem('medkit', 10, 0);
    assert.equal(m.tryPickup(a), true);
    assert.equal(a.hp, 85);
    assert.equal(m.items.has(id), false);
    assert.equal(m.tryPickup(a), false, 'no second pickup (the remaining box is far away)');
    assert.equal(m.items.has(far), true);
  });
  it('a weapon crate puts a new weapon in the empty slot and swapping works', () => {
    const m = emptyMatch();
    const a = place(m, 'A', 0, 0);
    place(m, 'B', 50, 50);
    m.addItem('crate', 1, 0);
    assert.equal(m.tryPickup(a), true);
    assert.ok(a.weapons[1] && a.weapons[1].type !== 'kestrel');
    assert.equal(a.slot, 1);
    assert.equal(m.swapWeapon(a), true);
    assert.equal(a.slot, 0);
  });
  it('bot pathfinding (A*) routes around walls', () => {
    const nav = new NavGrid(map);
    let found = 0;
    const rand = mulberry32(5);
    for (let i = 0; i < 30; i++) {
      const s = findFreePoint(map, rand, PLAYER_RADIUS);
      const g = findFreePoint(map, rand, PLAYER_RADIUS);
      const path = nav.findPath(s.x, s.z, g.x, g.z, 40000);
      if (!path) continue;
      found++;
      let prev = s;
      for (const wpt of path) { assert.ok(nav.lineFree(prev.x, prev.z, wpt.x, wpt.z) || Math.hypot(prev.x - wpt.x, prev.z - wpt.z) < 1.5); prev = wpt; }
    }
    assert.ok(found >= 27, `found ${found}/30`);
  });
});
