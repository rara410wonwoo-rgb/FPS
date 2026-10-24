// In-browser local transport: runs the same authoritative simulation (RoomManager) inside the page.
// Provides solo play as a static website without a Node server; no remote players or phone controller.
import { RoomManager } from '../../server/rooms.js';
import { TICK_DT } from '../../shared/config.js';

function randomBytes(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

function randomInt(max) {
  const lim = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < lim) return buf[0] % max;
  }
}

const browserDeps = {
  randomToken: (bytes) => btoa(String.fromCharCode(...randomBytes(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  randomInt,
  hash: (s) => s, // single-page session with no network, so no hashing needed
  safeEqual: (a, b) => a === b,
  now: () => performance.now(),
  seed: () => randomInt(2147483646) + 1,
};

export class LocalTransport {
  constructor() {
    this.kind = 'local';
    this.listeners = new Map();
    this.mgr = new RoomManager(browserDeps);
    this.client = {
      id: 'local-client',
      ip: 'local',
      emit: (ev, data) => {
        const fns = this.listeners.get(ev);
        if (fns) queueMicrotask(() => { for (const fn of fns) fn(data); });
      },
      disconnect: () => {},
    };
    this.mgr.connect(this.client);
    const tickMs = TICK_DT * 1000;
    let last = performance.now();
    let acc = 0;
    setInterval(() => {
      const now = performance.now();
      acc += Math.min(now - last, 250);
      last = now;
      while (acc >= tickMs) { this.mgr.tick(TICK_DT); acc -= tickMs; }
    }, 5);
  }

  onStatus(fn) { fn('local'); }

  on(ev, fn) {
    if (!this.listeners.has(ev)) this.listeners.set(ev, []);
    this.listeners.get(ev).push(fn);
  }

  emit(ev, data, ack) {
    const payload = data === undefined ? undefined : structuredClone(data);
    queueMicrotask(() => this.mgr.handle(this.client, ev, payload, ack));
  }
}
