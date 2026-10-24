// Movement tests (sprint, crouch, slide, jump, vault)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMap } from '../shared/map.js';
import { stepMovement, initMoveState, stanceOf } from '../shared/movement.js';
import { TICK_DT, MOVEMENT } from '../shared/config.js';
import { validateInput } from '../shared/protocol.js';

const base = { mx: 1, mz: 0, aim: 0, fire: false, ads: false, jump: false, crouch: false, sprint: false };
const run = (map, p, input, ticks) => { for (let i = 0; i < ticks; i++) stepMovement(map.index, p, input, TICK_DT, 'kestrel'); };

test('sprinting is faster than walking, crouching is slower', () => {
  const map = makeMap([]);
  const walk = initMoveState({ x: -50, z: 0 });
  const sprint = initMoveState({ x: -50, z: 10 });
  const crouch = initMoveState({ x: -50, z: 20 });
  run(map, walk, base, 30);
  run(map, sprint, { ...base, sprint: true }, 30);
  run(map, crouch, { ...base, crouch: true }, 30);
  assert.ok(sprint.x - -50 > (walk.x - -50) * 1.3);
  assert.ok(crouch.x - -50 < (walk.x - -50) * 0.7);
});

test('crouching while sprinting slides: a short fast slide that ends crouched', () => {
  const map = makeMap([]);
  const p = initMoveState({ x: -50, z: 0 });
  run(map, p, { ...base, sprint: true }, 5);
  const x0 = p.x;
  stepMovement(map.index, p, { ...base, sprint: true, crouch: true }, TICK_DT, 'kestrel');
  assert.equal(stanceOf(p), 2);
  run(map, p, { ...base, sprint: true, crouch: true }, 10);
  const walked = initMoveState({ x: 0, z: 30 });
  run(map, walked, { ...base, sprint: true }, 11);
  assert.ok(p.x - x0 > walked.x - 0, 'slide is faster than sprint early on');
  run(map, p, { ...base, crouch: true }, 30);
  assert.equal(p.slideT, 0);
  assert.equal(stanceOf(p), 1);
});

test('a jump goes up and lands again (once per press)', () => {
  const map = makeMap([]);
  const p = initMoveState({ x: 0, z: 0 });
  let peak = 0;
  for (let i = 0; i < 60; i++) {
    stepMovement(map.index, p, { ...base, mx: 0, jump: true }, TICK_DT, 'kestrel');
    peak = Math.max(peak, p.y);
  }
  assert.ok(peak > 0.6 && peak < 1.4, `peak ${peak}`);
  assert.equal(p.y, 0);
});

test('jumping at a low wall vaults over it, a tall wall cannot be vaulted', () => {
  const low = makeMap([{ minX: 1, maxX: 1.7, minZ: -3, maxZ: 3, h: 1.35, kind: 'wall' }]);
  const p = initMoveState({ x: 0, z: 0 });
  stepMovement(low.index, p, { ...base, jump: true }, TICK_DT, 'kestrel');
  assert.equal(stanceOf(p), 3);
  run(low, p, base, Math.ceil(MOVEMENT.vaultTime / TICK_DT) + 2);
  assert.ok(p.x > 1.7, `landed at ${p.x}`);
  assert.equal(p.y, 0);

  const high = makeMap([{ minX: 1, maxX: 1.7, minZ: -3, maxZ: 3, h: 3, kind: 'building' }]);
  const q = initMoveState({ x: 0, z: 0 });
  run(high, q, { ...base, jump: true }, 40);
  assert.ok(q.x < 1, 'blocked by tall wall');
});

test('input validation: new buttons (jump/crouch/sprint) accept booleans only', () => {
  assert.ok(validateInput({ seq: 1, mx: 0, mz: 0, aim: 0, jump: true, crouch: false, sprint: true }));
  assert.equal(validateInput({ seq: 1, mx: 0, mz: 0, aim: 0, jump: 1 }), null);
});
