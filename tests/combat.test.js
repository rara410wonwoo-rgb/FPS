import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rayAABB, rayCircle, resolveCircleAABB } from '../shared/collision.js';
import { WEAPONS, MAX_HP, LANDING_PROTECTION_S } from '../shared/config.js';
import { applyDamage } from '../server/combat.js';
import { emptyMatch, place, stepN } from './helpers.js';

const fireInput = (m, id) => { const p = m.players.get(id); p.queue.push({ seq: ++p.lastQueuedSeq, mx: 0, mz: 0, aim: p.control.aim, fire: true, ads: false }); p.lastInputAt = Infinity; };
const holdFire = (m, id, aim = 0) => { const p = m.players.get(id); p.lastInputAt = Number.MAX_SAFE_INTEGER; p.control.fire = true; p.control.aim = aim; };

describe('geometry', () => {
  it('ray-AABB slab: direct hit and miss', () => {
    const b = { minX: 4, maxX: 5, minZ: -1, maxZ: 1 };
    assert.equal(rayAABB(0, 0, 1, 0, b, 100), 4);
    assert.equal(rayAABB(0, 2, 1, 0, b, 100), null);
    assert.equal(rayAABB(0, 0, -1, 0, b, 100), null);
    assert.equal(rayAABB(0, 0, 1, 0, b, 3), null);
  });
  it('ray-circle', () => {
    assert.ok(Math.abs(rayCircle(0, 0, 1, 0, 10, 0, 1, 100) - 9) < 1e-9);
    assert.equal(rayCircle(0, 0, 1, 0, 10, 3, 1, 100), null);
    assert.equal(rayCircle(0, 0, 1, 0, -10, 0, 1, 100), null);
  });
  it('circle-AABB push out', () => {
    const p = { x: 4.8, z: 0 };
    resolveCircleAABB(p, 0.5, { minX: 5, maxX: 6, minZ: -1, maxZ: 1 });
    assert.ok(p.x <= 4.5 + 1e-9);
  });
});

describe('combat', () => {
  it('ADS ignores accumulated spread for long range precision', () => {
    const m = emptyMatch();
    const a = place(m, 'A', 0, 0, 0); const b = place(m, 'B', 35, 0);
    holdFire(m, 'A', 0); a.control.ads = true; a.bloom = 1;
    stepN(m, 10, { t: 0 });
    assert.ok(b.hp < MAX_HP);
  });

  it('enemies behind walls cannot be hit', () => {
    const m = emptyMatch([{ minX: 4, maxX: 5, minZ: -2, maxZ: 2, h: 3 }]);
    place(m, 'A', 0, 0, 0); const b = place(m, 'B', 9, 0);
    holdFire(m, 'A', 0);
    stepN(m, 30, { t: 0 });
    assert.equal(b.hp, MAX_HP);
    const shots = m.drainEvents().filter((e) => e.type === 'shot');
    assert.ok(shots.length > 3);
    for (const s of shots) assert.ok(s.tr[0].x1 <= 4 + 1e-6, 'the trace stops at the wall');
  });

  it('no damage from players while parachuting or just after landing', () => {
    const m = emptyMatch();
    const a = place(m, 'A', 0, 0, 0); const b = place(m, 'B', 9, 0);
    b.drop = 3;
    applyDamage(m, b, 30, a, 'kestrel');
    assert.equal(b.hp, MAX_HP, 'parachuting');
    b.drop = 0; b.landedAt = m.time;
    applyDamage(m, b, 30, a, 'kestrel');
    assert.equal(b.hp, MAX_HP, 'just landed');
    b.landedAt = m.time - LANDING_PROTECTION_S - 0.1;
    applyDamage(m, b, 30, a, 'kestrel');
    assert.equal(b.hp, MAX_HP - 30, 'protection over');
  });

  it('without a wall, shots deal damage', () => {
    const m = emptyMatch();
    place(m, 'A', 0, 0, 0); const b = place(m, 'B', 9, 0);
    holdFire(m, 'A', 0);
    stepN(m, 10, { t: 0 });
    assert.ok(b.hp < MAX_HP);
  });

  it('cannot hit through a wall even with the muzzle inside it', () => {
    // A hugs the wall (muzzle inside the wall), B is right behind it
    const m = emptyMatch([{ minX: 0.6, maxX: 1.6, minZ: -2, maxZ: 2, h: 3 }]);
    place(m, 'A', 0, 0, 0); const b = place(m, 'B', 2.4, 0);
    holdFire(m, 'A', 0);
    stepN(m, 30, { t: 0 });
    assert.equal(b.hp, MAX_HP);
  });

  it('0.12s fire interval: about 8–9 shots per second, magazine goes down', () => {
    const m = emptyMatch();
    const a = place(m, 'A', 0, 0, Math.PI / 2); place(m, 'B', 50, 50);
    holdFire(m, 'A', Math.PI / 2);
    stepN(m, 30, { t: 0 });
    const shots = m.drainEvents().filter((e) => e.type === 'shot').length;
    assert.ok(shots >= 8 && shots <= 9, `shots=${shots}`);
    assert.equal(a.weapons[0].mag, WEAPONS.kestrel.magSize - shots);
  });

  it('empty magazine: no infinite fire, auto reload 1.6s, no firing while reloading', () => {
    const m = emptyMatch();
    const a = place(m, 'A', 0, 0, Math.PI / 2); place(m, 'B', 50, 50);
    a.weapons[0].mag = 2;
    holdFire(m, 'A', Math.PI / 2);
    stepN(m, 10, { t: 0 });
    let ev = m.drainEvents();
    assert.equal(ev.filter((e) => e.type === 'shot').length, 2);
    assert.ok(a.reloadT > 0, 'reload started');
    stepN(m, 30, { t: 1000 }); // 1s: still reloading
    ev = m.drainEvents();
    assert.equal(ev.filter((e) => e.type === 'shot').length, 0);
    a.control.fire = false;
    a.lastInputAt = -Infinity;
    stepN(m, 30, { t: 2000 });
    assert.equal(a.reloadT, 0);
    assert.ok(a.weapons[0].mag > 0);
    assert.equal(a.weapons[0].mag + a.weapons[0].reserve, 96);
  });

  it('cannot reload without reserve ammo', () => {
    const m = emptyMatch();
    const a = place(m, 'A', 0, 0, Math.PI / 2); place(m, 'B', 50, 50);
    a.weapons[0].mag = 0; a.weapons[0].reserve = 0;
    holdFire(m, 'A', Math.PI / 2);
    stepN(m, 30, { t: 0 });
    assert.equal(m.drainEvents().filter((e) => e.type === 'shot').length, 0);
    assert.equal(a.reloadT, 0);
  });

  it('no moving or firing after death', () => {
    const m = emptyMatch([], ['A', 'B', 'C']);
    const a = place(m, 'A', 0, 0); place(m, 'B', 30, 30); place(m, 'C', -30, -30);
    a.hp = 1;
    m.killPlayer(a, null, 'test');
    m.drainEvents();
    const x0 = a.x;
    m.queueInput('A', { seq: 100, mx: 1, mz: 0, aim: 0, fire: true, ads: false, reload: false, interact: false, swap: false }, 0);
    stepN(m, 10, { t: 0 });
    assert.equal(a.x, x0);
    assert.equal(m.drainEvents().filter((e) => e.type === 'shot').length, 0);
  });

  it('shotgun fires 8 pellets, high damage up close', () => {
    const m = emptyMatch();
    const a = place(m, 'A', 0, 0, 0); const b = place(m, 'B', 3, 0);
    a.weapons[0] = { type: 'breaker', mag: 6, reserve: 18 };
    holdFire(m, 'A', 0);
    stepN(m, 10, { t: 0 });
    const shot = m.drainEvents().find((e) => e.type === 'shot');
    assert.equal(shot.tr.length, 8);
    assert.ok(MAX_HP - b.hp >= 40, `damage ${MAX_HP - b.hp}`);
  });

  it('kills: kill count, placement, kill feed', () => {
    const m = emptyMatch([], ['A', 'B', 'C']);
    const a = place(m, 'A', 0, 0, 0); const b = place(m, 'B', 5, 0); place(m, 'C', -40, -40);
    b.hp = 5;
    holdFire(m, 'A', 0);
    stepN(m, 3, { t: 0 });
    assert.equal(b.alive, false);
    assert.equal(a.kills, 1);
    assert.equal(b.placement, 3);
    assert.equal(m.killfeed.at(-1).kn, 'A');
  });
});
