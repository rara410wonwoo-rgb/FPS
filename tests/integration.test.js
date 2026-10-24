// Integration test that starts a real Express + Socket.IO server and connects with socket.io-client.
// Runs after npm install; skipped when the packages are missing.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { C2S, S2C } from '../shared/protocol.js';

let deps = null;
try {
  const [{ createGameServer }, { io }] = await Promise.all([import('../server/app.js'), import('socket.io-client')]);
  deps = { createGameServer, io };
} catch {
  deps = null;
}

const once = (s, ev, ms = 4000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`timeout waiting ${ev}`)), ms);
  s.once(ev, (d) => { clearTimeout(t); resolve(d); });
});
const call = (s, ev, payload) => new Promise((resolve) => s.emit(ev, payload, resolve));

describe('Socket.IO integration', { skip: deps ? false : 'express/socket.io not installed (run npm install)' }, () => {
  let server;
  let url;
  const sockets = [];
  const connect = (opts = {}) => {
    const s = deps.io(url, { transports: ['websocket'], forceNew: true, ...opts });
    sockets.push(s);
    return s;
  };

  before(async () => {
    server = deps.createGameServer({ managerOptions: { countdown: 0 } });
    await new Promise((r) => server.httpServer.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${server.httpServer.address().port}`;
  });

  after(async () => {
    for (const s of sockets) s.disconnect();
    await server.close();
    await new Promise((r) => server.httpServer.close(r));
  });

  test('index.html, controller.html and local three/socket.io bundles are served with HTTP 200', async () => {
    for (const path of ['/', '/controller.html', '/game.js', '/shared/config.js', '/vendor/three/three.module.js', '/vendor/three-addons/postprocessing/EffectComposer.js', '/vendor/socket.io/socket.io.esm.min.js', '/healthz']) {
      const res = await fetch(url + path);
      assert.equal(res.status, 200, path);
    }
    const html = await (await fetch(url)).text();
    assert.ok(!/https?:\/\/(cdn|unpkg|fonts)\./.test(html), 'no external CDN references');
    assert.equal((await fetch(`${url}/server/rooms.js`)).status, 404, 'server code is not exposed');
    assert.equal((await fetch(`${url}/package.json`)).status, 404);
  });

  test('create solo match → receive snapshots → move with input', async () => {
    const s = connect();
    await once(s, 'connect');
    const full = once(s, S2C.FULL);
    const r = await call(s, C2S.CREATE, { name: 'Tester', solo: true });
    assert.equal(r.ok, true);
    const f = await full;
    assert.equal(f.players.length, 12);
    const snap = await once(s, S2C.SNAPSHOT);
    const x0 = snap.you.x;
    for (let i = 1; i <= 15; i++) { s.emit(C2S.INPUT, { seq: i, mx: 1, mz: 0, aim: 0, fire: false, ads: false }); await new Promise((res) => setTimeout(res, 33)); }
    await new Promise((res) => setTimeout(res, 200));
    const later = await once(s, S2C.SNAPSHOT);
    assert.ok(later.you.x !== x0 || later.you.lastSeq > 0);
    s.disconnect();
  });

  test('reconnect: restore the session with a token and receive the full state again', async () => {
    const a = connect();
    await once(a, 'connect');
    const r = await call(a, C2S.CREATE, { name: 'Resume', solo: true });
    await once(a, S2C.SNAPSHOT);
    a.disconnect();
    const b = connect();
    await once(b, 'connect');
    const full = once(b, S2C.FULL);
    const rr = await call(b, C2S.RESUME, { playerId: r.playerId, token: r.token });
    assert.equal(rr.ok, true);
    assert.equal((await full).you.id, r.playerId);
  });

  test('controller pairing: wrong code rejected, right code connects', async () => {
    const pc = connect();
    await once(pc, 'connect');
    await call(pc, C2S.CREATE, { name: 'PC', solo: true });
    const pair = await call(pc, C2S.PAIR_CREATE);
    assert.equal(pair.ok, true);
    const phone = connect();
    await once(phone, 'connect');
    assert.equal((await call(phone, C2S.CONTROLLER_PAIR, { code: 'AAAAAAAA' })).ok, false);
    const status = once(pc, S2C.CONTROLLER_STATUS);
    assert.equal((await call(phone, C2S.CONTROLLER_PAIR, { code: pair.code })).ok, true);
    assert.equal((await status).connected, true);
  });

  test('oversized payloads disconnect (maxHttpBufferSize)', async () => {
    const s = connect({ reconnection: false });
    await once(s, 'connect');
    const gone = once(s, 'disconnect');
    s.emit(C2S.INPUT, { seq: 1, junk: 'x'.repeat(20000) });
    await gone;
  });
});
