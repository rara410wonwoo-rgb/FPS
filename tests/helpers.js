// shared test helpers
import { makeMap } from '../shared/map.js';
import { Match } from '../server/simulation.js';
import { RoomManager } from '../server/rooms.js';
import { nodeDeps } from '../server/node-deps.js';
import { TICK_DT } from '../shared/config.js';

export const DT = TICK_DT;

// build a bot-free match on an empty map (only the needed obstacles)
export function emptyMatch(obstacles = [], humans = ['A', 'B'], opts = {}) {
  const map = makeMap(obstacles);
  const m = new Match({ map, seed: opts.seed ?? 7, humans: humans.map((n) => ({ playerId: n, name: n })), bots: false, countdown: 0, ...opts });
  m.items.clear();
  m.step(DT, 0); // COUNTDOWN(0) → PLAYING
  return m;
}

export function place(m, id, x, z, aim = 0) {
  const p = m.players.get(id);
  p.x = x; p.z = z; p.aim = aim; p.control.aim = aim;
  return p;
}

export function stepN(m, n, nowRef, input) {
  for (let i = 0; i < n; i++) {
    nowRef.t += DT * 1000;
    if (input) input(i);
    m.step(DT, nowRef.t);
  }
}

export function fakeManager(opts = {}) {
  const clock = { t: 1_000_000 };
  const deps = { ...nodeDeps, now: () => clock.t };
  const mgr = new RoomManager(deps, { bots: opts.bots ?? true, countdown: opts.countdown ?? 0, ...opts });
  let n = 0;
  const makeClient = (ip = '10.0.0.1') => {
    const c = {
      id: `c${++n}`, ip, inbox: [], disconnected: false,
      emit(ev, data) { this.inbox.push({ ev, data }); },
      disconnect() { this.disconnected = true; mgr.disconnect(this); },
      last(ev) { for (let i = this.inbox.length - 1; i >= 0; i--) if (this.inbox[i].ev === ev) return this.inbox[i].data; return undefined; },
      send(ev, payload) { let r; mgr.handle(this, ev, payload, (x) => { r = x; }); return r; },
    };
    mgr.connect(c);
    return c;
  };
  const advance = (ms) => {
    const ticks = Math.round(ms / (DT * 1000));
    for (let i = 0; i < ticks; i++) { clock.t += DT * 1000; mgr.tick(DT); }
  };
  return { mgr, clock, makeClient, advance };
}
