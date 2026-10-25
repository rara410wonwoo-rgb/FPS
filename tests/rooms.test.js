import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { C2S, S2C } from '../shared/protocol.js';
import { MAX_HP, INPUT_TIMEOUT_MS } from '../shared/config.js';
import { fakeManager } from './helpers.js';

const inp = (seq, extra = {}) => ({ seq, mx: 0, mz: 0, aim: 0, fire: false, ads: false, ...extra });

// A bot-free room with one human ends instantly as 'last survivor', so add one dummy player
function startedRoom(f) {
  const { c, r } = createRoom(f);
  const guest = f.makeClient('10.9.9.9');
  assert.equal(guest.send(C2S.JOIN, { code: r.roomCode, name: 'Dummy' }).ok, true);
  assert.equal(c.send(C2S.START).ok, true);
  return { c, r, guest };
}

function createRoom(f, name = 'Host', solo = false) {
  const c = f.makeClient();
  const r = c.send(C2S.CREATE, { name, solo });
  assert.equal(r.ok, true, r.reason);
  return { c, r };
}

describe('rooms and sessions', () => {
  it('solo: 1 player + 11 bots, countdown starts immediately', () => {
    const f = fakeManager({ countdown: 4 });
    const { c, r } = createRoom(f, 'Solo', true);
    const room = f.mgr.rooms.get(r.roomCode);
    assert.equal(room.match.players.size, 12);
    assert.equal([...room.match.players.values()].filter((p) => p.bot).length, 11);
    assert.equal(room.match.state, 'COUNTDOWN');
    assert.ok(c.last(S2C.FULL));
    f.advance(5000);
    assert.equal(room.match.state, 'PLAYING');
  });

  it('solo with a phone (wait): stays in the lobby, phone pairs, host starts', () => {
    const f = fakeManager({ countdown: 4 });
    const c = f.makeClient();
    const r = c.send(C2S.CREATE, { name: 'Solo', solo: true, wait: true });
    assert.equal(r.ok, true, r.reason);
    const room = f.mgr.rooms.get(r.roomCode);
    assert.equal(room.match, null, 'no match until Start');
    const pair = c.send(C2S.PAIR_CREATE);
    assert.equal(pair.ok, true, pair.reason);
    const phone = f.makeClient('10.0.0.7');
    assert.equal(phone.send(C2S.CONTROLLER_PAIR, { code: pair.code }).ok, true);
    assert.equal(room.match, null, 'pairing does not start the match');
    assert.equal(c.send(C2S.START).ok, true);
    assert.equal(room.match.state, 'COUNTDOWN');
    assert.equal(room.match.players.size, 12);
  });

  it('two PC sessions receive the same match state (same tick and positions)', () => {
    const f = fakeManager();
    const { c: a, r } = createRoom(f);
    const b = f.makeClient('10.0.0.2');
    assert.equal(b.send(C2S.JOIN, { code: r.roomCode, name: 'Guest' }).ok, true);
    assert.equal(b.send(C2S.START).ok, false, 'only the host can start');
    assert.equal(a.send(C2S.START).ok, true);
    f.advance(500);
    const sa = a.last(S2C.SNAPSHOT);
    const sb = b.last(S2C.SNAPSHOT);
    assert.equal(sa.tick, sb.tick);
    assert.deepEqual(sa.players, sb.players);
    assert.equal(sa.players.filter((p) => !p.b).length, 2);
    assert.notEqual(sa.you.id, sb.you.id);
  });

  it('different rooms are isolated', () => {
    const f = fakeManager({ bots: false });
    const { c: a } = startedRoom(f);
    const { c: b } = startedRoom(f);
    f.advance(300);
    const ids = (c) => c.last(S2C.SNAPSHOT).players.map((p) => p.id);
    assert.equal(ids(a).length, 2);
    assert.equal(ids(b).length, 2);
    assert.equal(a.last(S2C.SNAPSHOT).state, 'PLAYING');
    assert.ok(!ids(a).some((id) => ids(b).includes(id)));
    assert.notDeepEqual(ids(a), ids(b));
    // A's input does not affect room B
    const bp = f.mgr.rooms.get(b.last(S2C.ROOM_STATE).code).match.players.values().next().value;
    const ap = f.mgr.rooms.get(a.last(S2C.ROOM_STATE).code).match.players.get(a.last(S2C.SNAPSHOT).you.id);
    const bx = bp.x;
    const ax = ap.x;
    for (let i = 1; i < 20; i++) { a.send(C2S.INPUT, inp(i, { mx: 1 })); f.advance(34); }
    assert.equal(bp.x, bx);
    assert.ok(Math.abs(ap.x - ax) > 1, 'the player in room A moved');
  });

  it('cannot join a match in progress, and the reason is given', () => {
    const f = fakeManager();
    const { c: a, r } = createRoom(f);
    a.send(C2S.START);
    const b = f.makeClient('10.0.0.3');
    const res = b.send(C2S.JOIN, { code: r.roomCode, name: 'Late' });
    assert.equal(res.ok, false);
    assert.match(res.reason, /in progress/);
  });

  it('at most 4 humans', () => {
    const f = fakeManager();
    const { r } = createRoom(f);
    for (let i = 0; i < 3; i++) assert.equal(f.makeClient(`10.1.0.${i}`).send(C2S.JOIN, { code: r.roomCode, name: `P${i}` }).ok, true);
    const res = f.makeClient('10.1.0.9').send(C2S.JOIN, { code: r.roomCode, name: 'P5' });
    assert.equal(res.ok, false);
  });

  it('restart creates a completely new match state', () => {
    const f = fakeManager();
    const { c, r } = createRoom(f, 'Solo', true);
    const room = f.mgr.rooms.get(r.roomCode);
    f.advance(2000);
    const old = room.match;
    const me = old.players.get(r.playerId);
    me.hp = 3; old.items.clear(); old.elapsed = 200;
    assert.equal(c.send(C2S.RESTART).ok, false, 'cannot restart while alive');
    old.killPlayer(me, null, 'test');
    assert.equal(c.send(C2S.RESTART).ok, true);
    assert.notEqual(room.match, old);
    const fresh = room.match.players.get(r.playerId);
    assert.equal(fresh.hp, MAX_HP);
    assert.equal(fresh.alive, true);
    assert.equal(fresh.kills, 0);
    assert.equal(room.match.elapsed, 0);
    assert.ok(room.match.items.size > 30);
    assert.equal(room.match.players.size, 12);
    assert.equal(c.last(S2C.FULL).matchNo, 2);
  });

  it('reconnect: reclaim the same player with a token and receive the full state', () => {
    const f = fakeManager();
    const { c, r } = createRoom(f, 'Solo', true);
    f.advance(1000);
    c.disconnect();
    f.advance(2000);
    const c2 = f.makeClient();
    assert.equal(c2.send(C2S.RESUME, { playerId: r.playerId, token: 'x'.repeat(32) }).ok, false, 'wrong token rejected');
    const res = c2.send(C2S.RESUME, { playerId: r.playerId, token: r.token });
    assert.equal(res.ok, true);
    const full = c2.last(S2C.FULL);
    assert.equal(full.you.id, r.playerId);
    assert.equal(full.players.length, 12);
    assert.ok(full.zone && full.items);
  });

  it('disconnected players are cleaned up after a grace period and empty rooms are deleted', () => {
    const f = fakeManager();
    const { c, r } = createRoom(f, 'Solo', true);
    c.disconnect();
    f.advance(61000);
    assert.equal(f.mgr.rooms.has(r.roomCode), false);
    assert.equal(f.mgr.sessions.size, 0);
  });

  it('when the host leaves, the next player becomes host', () => {
    const f = fakeManager();
    const { c: a, r } = createRoom(f);
    const b = f.makeClient('10.0.0.5');
    const rb = b.send(C2S.JOIN, { code: r.roomCode, name: 'B' });
    a.send(C2S.LEAVE);
    assert.equal(f.mgr.rooms.get(r.roomCode).hostId, rb.playerId);
  });
});

describe('input validation and security', () => {
  it('bad numbers, types and extra fields are rejected', () => {
    const f = fakeManager({ bots: false });
    const { c, r } = startedRoom(f);
    f.advance(100);
    const p = f.mgr.rooms.get(r.roomCode).match.players.get(r.playerId);
    const x = p.x;
    c.send(C2S.INPUT, inp(1, { mx: 1 }));
    f.advance(100);
    assert.notEqual(p.x, x, 'valid input is applied');
    const x2 = p.x;
    f.advance(400);
    const bad = [
      { seq: 1, mx: NaN, mz: 0, aim: 0 },
      { seq: 2, mx: 5, mz: 0, aim: 0 },
      { seq: 3, mx: 1, mz: 0, aim: Infinity },
      { seq: 4, mx: '1', mz: 0, aim: 0 },
      { seq: 5, mx: 1, mz: 0, aim: 0, hp: 9999 },
      { seq: 6, mx: 1, mz: 0, aim: 0, fire: 'yes' },
      { seq: -1, mx: 1, mz: 0, aim: 0 },
      [1, 2, 3],
      'x'.repeat(5000),
      null,
    ];
    for (const b of bad) c.send(C2S.INPUT, b);
    f.advance(200);
    assert.equal(p.x, x2);
    assert.equal(p.queue.length, 0);
  });

  it('forged HP/kill messages are ignored', () => {
    const f = fakeManager();
    const { c, r } = createRoom(f, 'Solo', true);
    const p = f.mgr.rooms.get(r.roomCode).match.players.get(r.playerId);
    p.hp = 50;
    const res = c.send('setHp', { hp: 100 });
    c.send('player:update', { kills: 99, hp: 100 });
    assert.equal(res.ok, false);
    assert.equal(p.hp, 50);
    assert.equal(p.kills, 0);
  });

  it('excessive input is rate limited and persistent abuse disconnects', () => {
    const f = fakeManager({ bots: false });
    const { c, r } = startedRoom(f);
    const p = f.mgr.rooms.get(r.roomCode).match.players.get(r.playerId);
    for (let i = 1; i <= 100; i++) c.send(C2S.INPUT, inp(i, { mx: 1 }));
    assert.ok(p.lastQueuedSeq <= 20, `accepted ${p.lastQueuedSeq}`);
    assert.ok(c.last(S2C.RATE_LIMITED));
    assert.equal(c.disconnected, true);
  });

  it('join attempt limit', () => {
    const f = fakeManager();
    const c = f.makeClient('9.9.9.9');
    let blocked = false;
    for (let i = 0; i < 30; i++) {
      f.clock.t += 2000; // the event bucket refills but the per-minute join limit holds
      const res = c.send(C2S.JOIN, { code: 'ZZZZZ', name: 'x' });
      if (res.reason?.includes('Too many')) blocked = true;
    }
    assert.ok(blocked);
  });
});

describe('phone controller pairing', () => {
  function setup() {
    const f = fakeManager({ bots: false });
    const { c: pc, r } = startedRoom(f);
    f.advance(100);
    const room = f.mgr.rooms.get(r.roomCode);
    const player = room.match.players.get(r.playerId);
    return { f, pc, r, room, player };
  }

  it('a room code alone cannot control another player (wrong pairing code rejected)', () => {
    const { f, r, player } = setup();
    const phone = f.makeClient('10.0.0.50');
    assert.equal(phone.send(C2S.CONTROLLER_PAIR, { code: r.roomCode }).ok, false);
    assert.equal(phone.send(C2S.CONTROLLER_PAIR, { code: 'ABCDEFGH' }).ok, false);
    const x = player.x;
    for (let i = 0; i < 10; i++) { phone.send(C2S.CONTROLLER_INPUT, { mx: 1, mz: 0, aim: 0, fire: true }); f.advance(34); }
    assert.equal(player.x, x);
    assert.equal(player.control.fire, false);
  });

  it('with the right code the player moves, and stops 300ms after input ends', () => {
    const { f, pc, player } = setup();
    const code = pc.send(C2S.PAIR_CREATE).code;
    const phone = f.makeClient('10.0.0.51');
    const res = phone.send(C2S.CONTROLLER_PAIR, { code });
    assert.equal(res.ok, true);
    assert.equal(pc.last(S2C.CONTROLLER_STATUS).connected, true);
    assert.equal(f.makeClient('10.0.0.52').send(C2S.CONTROLLER_PAIR, { code }).ok, false, 'codes are single use');
    const x0 = player.x;
    for (let i = 0; i < 10; i++) { phone.send(C2S.CONTROLLER_INPUT, { mx: 1, mz: 0, aim: 0, fire: false }); f.advance(34); }
    assert.ok(player.x > x0 + 1, 'moves with controller input');
    phone.send(C2S.CONTROLLER_INPUT, { mx: 1, mz: 0, aim: Math.PI / 2, fire: true });
    f.advance(34);
    assert.equal(player.control.fire, true);
    phone.disconnect();
    assert.equal(pc.last(S2C.CONTROLLER_STATUS).connected, false);
    f.advance(INPUT_TIMEOUT_MS + 100);
    const x1 = player.x;
    f.advance(500);
    assert.equal(player.x, x1);
    assert.equal(player.control.fire, false);
  });

  it('neutral 300ms after controller input stops (socket still open)', () => {
    const { f, pc, player } = setup();
    const code = pc.send(C2S.PAIR_CREATE).code;
    const phone = f.makeClient('10.0.0.53');
    phone.send(C2S.CONTROLLER_PAIR, { code });
    phone.send(C2S.CONTROLLER_INPUT, { mx: 1, mz: 0, aim: 0, fire: true });
    f.advance(34);
    assert.equal(player.control.fire, true);
    f.advance(400);
    assert.equal(player.control.fire, false);
    const x = player.x;
    f.advance(300);
    assert.equal(player.x, x);
  });

  it('duplicate policy: a new controller replaces the old one', () => {
    const { f, pc } = setup();
    const p1 = f.makeClient('10.0.0.60');
    p1.send(C2S.CONTROLLER_PAIR, { code: pc.send(C2S.PAIR_CREATE).code });
    const p2 = f.makeClient('10.0.0.61');
    assert.equal(p2.send(C2S.CONTROLLER_PAIR, { code: pc.send(C2S.PAIR_CREATE).code }).ok, true);
    assert.ok(p1.last(S2C.CONTROLLER_KICKED));
  });

  it('PC movement input is ignored while a controller is connected', () => {
    const { f, pc, player } = setup();
    const phone = f.makeClient('10.0.0.70');
    phone.send(C2S.CONTROLLER_PAIR, { code: pc.send(C2S.PAIR_CREATE).code });
    const x = player.x;
    for (let i = 1; i < 10; i++) { pc.send(C2S.INPUT, inp(i, { mx: 1 })); f.advance(34); }
    assert.equal(player.x, x);
  });

  it('can reconnect with the controller token', () => {
    const { f, pc } = setup();
    const phone = f.makeClient('10.0.0.80');
    const res = phone.send(C2S.CONTROLLER_PAIR, { code: pc.send(C2S.PAIR_CREATE).code });
    phone.disconnect();
    const phone2 = f.makeClient('10.0.0.80');
    assert.equal(phone2.send(C2S.CONTROLLER_RESUME, { token: res.controllerToken }).ok, true);
    assert.equal(pc.last(S2C.CONTROLLER_STATUS).connected, true);
  });
});
