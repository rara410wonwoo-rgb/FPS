// Rooms, sessions and controller pairing. Independent of the transport (Socket.IO or in-browser local).
// client object: { id, ip, emit(event, data), disconnect() }
import { stanceOf } from '../shared/movement.js';
import {
  MAX_HUMANS, MATCH_SIZE, RATE_LIMIT, RECONNECT_GRACE_MS, LOBBY_GRACE_MS, PAIR_CODE_TTL_MS,
  PAIR_CODE_LENGTH, ROOM_CODE_LENGTH, CODE_ALPHABET, TICK_DT, SNAPSHOT_EVERY_TICKS, MAP_SEED,
} from '../shared/config.js';
import {
  C2S, S2C, validateInput, validateName, validateRoomCode, validatePairCode, validateToken, validatePlayerId,
} from '../shared/protocol.js';
import { generateMap } from '../shared/map.js';
import { Match } from './simulation.js';
import { getNav } from './bots.js';

class TokenBucket {
  constructor(rate, burst) { this.rate = rate; this.burst = burst; this.tokens = burst; this.last = 0; }
  take(now) {
    if (this.last === 0) this.last = now;
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

class WindowLimiter {
  constructor(limit, windowMs) { this.limit = limit; this.windowMs = windowMs; this.hits = new Map(); }
  allow(key, now) {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.limit) { this.hits.set(key, arr); return false; }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }
  prune(now) {
    for (const [k, arr] of this.hits) if (!arr.some((t) => now - t < this.windowMs)) this.hits.delete(k);
  }
}

export class RoomManager {
  /**
   * deps: { randomToken(bytes) => base64url string, randomInt(max) => int, hash(str) => string,
   *         safeEqual(a, b) => bool, now() => ms, seed() => int }
   */
  constructor(deps, opts = {}) {
    this.deps = deps;
    this.map = opts.map ?? generateMap(MAP_SEED);
    getNav(this.map); // avoid a delay when the first match starts
    this.rooms = new Map();
    this.sessions = new Map(); // playerId -> { roomCode, tokenHash }
    this.clients = new Map(); // client.id -> { client, role, playerId, roomCode, buckets, violations }
    this.pairCodes = new Map(); // code -> { roomCode, playerId, expiresAt }
    this.controllerTokens = new Map(); // tokenHash -> playerId
    this.joinLimiter = new WindowLimiter(RATE_LIMIT.joinPerMin, 60000);
    this.pairLimiter = new WindowLimiter(RATE_LIMIT.pairPerMin, 60000);
    this.tickCount = 0;
    this.botsEnabled = opts.bots ?? true;
    this.countdown = opts.countdown;
  }

  now() { return this.deps.now(); }

  code(len) {
    let s = '';
    for (let i = 0; i < len; i++) s += CODE_ALPHABET[this.deps.randomInt(CODE_ALPHABET.length)];
    return s;
  }

  // ---------- connection ----------
  connect(client) {
    this.clients.set(client.id, {
      client, role: null, playerId: null, roomCode: null, violations: 0,
      inputBucket: new TokenBucket(RATE_LIMIT.inputPerSec, RATE_LIMIT.inputBurst),
      eventBucket: new TokenBucket(RATE_LIMIT.eventPerSec, RATE_LIMIT.eventBurst),
    });
  }

  violation(c, reason) {
    c.violations++;
    if (c.violations === 1 || c.violations % 20 === 0) c.client.emit(S2C.RATE_LIMITED, { reason });
    if (c.violations > RATE_LIMIT.maxViolations) c.client.disconnect();
  }

  handle(client, event, payload, ack) {
    const c = this.clients.get(client.id);
    if (!c) return;
    const now = this.now();
    const reply = typeof ack === 'function' ? ack : () => {};
    if (event === C2S.INPUT || event === C2S.CONTROLLER_INPUT) {
      if (!c.inputBucket.take(now)) { this.violation(c, 'input rate'); return; }
    } else if (event === C2S.PING) {
      if (!c.eventBucket.take(now)) { this.violation(c, 'event rate'); return; }
      reply({ t: now });
      return;
    } else if (!c.eventBucket.take(now)) {
      this.violation(c, 'event rate');
      reply({ ok: false, reason: 'Too many requests. Please try again shortly.' });
      return;
    }
    switch (event) {
      case C2S.CREATE: return reply(this.onCreate(c, payload));
      case C2S.JOIN: return reply(this.onJoin(c, payload));
      case C2S.RESUME: return reply(this.onResume(c, payload));
      case C2S.LEAVE: return reply(this.onLeave(c));
      case C2S.START: return reply(this.onStart(c));
      case C2S.RESTART: return reply(this.onRestart(c));
      case C2S.INPUT: return this.onInput(c, payload);
      case C2S.MENU: return this.onMenu(c, payload);
      case C2S.PAIR_CREATE: return reply(this.onPairCreate(c));
      case C2S.CONTROLLER_PAIR: return reply(this.onControllerPair(c, payload));
      case C2S.CONTROLLER_RESUME: return reply(this.onControllerResume(c, payload));
      case C2S.CONTROLLER_INPUT: return this.onControllerInput(c, payload);
      default:
        // Unknown events (e.g. a client trying to set its HP) are ignored and recorded as violations
        this.violation(c, `unknown event`);
        return reply({ ok: false, reason: 'unknown event' });
    }
  }

  disconnect(client) {
    const c = this.clients.get(client.id);
    if (!c) return;
    this.clients.delete(client.id);
    const room = c.roomCode ? this.rooms.get(c.roomCode) : null;
    if (!room) return;
    const h = room.humans.get(c.playerId);
    if (!h) return;
    if (c.role === 'pc' && h.client === client) {
      h.client = null;
      h.disconnectedAt = this.now();
      room.match?.neutralize(h.playerId);
      this.broadcastRoom(room);
    } else if (c.role === 'controller' && h.controller === client) {
      h.controller = null;
      this.setSource(room, h);
      this.notifyController(room, h);
      this.broadcastRoom(room);
    }
  }

  // ---------- sessions ----------
  issueSession(c, room, name) {
    const playerId = this.deps.randomToken(12);
    const token = this.deps.randomToken(24);
    const human = {
      playerId, name, client: c.client, controller: null, controllerTokenHash: null,
      disconnectedAt: null, joinedAt: this.now(),
    };
    room.humans.set(playerId, human);
    this.sessions.set(playerId, { roomCode: room.code, tokenHash: this.deps.hash(token) });
    c.role = 'pc';
    c.playerId = playerId;
    c.roomCode = room.code;
    return { playerId, token };
  }

  onCreate(c, payload) {
    const now = this.now();
    if (!this.joinLimiter.allow(c.client.ip ?? 'local', now)) return { ok: false, reason: 'Too many join attempts. Try again in a minute.' };
    const name = validateName(payload?.name);
    if (!name) return { ok: false, reason: 'Enter a name of 1–16 characters.' };
    const solo = payload?.solo === true;
    const wait = payload?.wait === true; // solo with a phone: stay in the lobby until the host presses Start
    if (c.playerId) this.onLeave(c);
    let code;
    do { code = this.code(ROOM_CODE_LENGTH); } while (this.rooms.has(code));
    const room = { code, solo, hostId: null, humans: new Map(), match: null, matchNo: 0, emptySince: null };
    this.rooms.set(code, room);
    const s = this.issueSession(c, room, name);
    room.hostId = s.playerId;
    if (solo && !wait) this.startMatch(room);
    this.broadcastRoom(room);
    if (room.match) this.sendFull(room, room.humans.get(s.playerId));
    return { ok: true, ...s, roomCode: code, solo };
  }

  onJoin(c, payload) {
    const now = this.now();
    if (!this.joinLimiter.allow(c.client.ip ?? 'local', now)) return { ok: false, reason: 'Too many join attempts. Try again in a minute.' };
    const name = validateName(payload?.name);
    if (!name) return { ok: false, reason: 'Enter a name of 1–16 characters.' };
    const code = validateRoomCode(payload?.code);
    const room = code ? this.rooms.get(code) : null;
    if (!room || room.solo) return { ok: false, reason: 'Room not found. Check the code.' };
    if (room.humans.size >= MAX_HUMANS) return { ok: false, reason: `The room is full (max ${MAX_HUMANS} players).` };
    if (room.match && room.match.state !== 'FINISHED') return { ok: false, reason: 'A match is already in progress. Join again after it ends.' };
    if (c.playerId) this.onLeave(c);
    const s = this.issueSession(c, room, name);
    this.broadcastRoom(room);
    if (room.match) this.sendFull(room, room.humans.get(s.playerId));
    return { ok: true, ...s, roomCode: room.code, solo: false };
  }

  onResume(c, payload) {
    const playerId = validatePlayerId(payload?.playerId);
    const token = validateToken(payload?.token);
    if (!playerId || !token) return { ok: false, reason: 'Invalid session data.' };
    const s = this.sessions.get(playerId);
    if (!s || !this.deps.safeEqual(s.tokenHash, this.deps.hash(token))) return { ok: false, reason: 'Your session has expired.' };
    const room = this.rooms.get(s.roomCode);
    const h = room?.humans.get(playerId);
    if (!room || !h) return { ok: false, reason: 'Your session has expired.' };
    if (h.client && h.client.id !== c.client.id) {
      h.client.emit(S2C.SESSION_REPLACED, { reason: 'You reconnected with the same session from another window.' });
      const old = this.clients.get(h.client.id);
      if (old) { old.playerId = null; old.roomCode = null; old.role = null; }
    }
    h.client = c.client;
    h.disconnectedAt = null;
    c.role = 'pc';
    c.playerId = playerId;
    c.roomCode = room.code;
    this.broadcastRoom(room);
    if (room.match) this.sendFull(room, h);
    return { ok: true, playerId, roomCode: room.code, solo: room.solo, resumed: true };
  }

  onLeave(c) {
    const room = c.roomCode ? this.rooms.get(c.roomCode) : null;
    if (room && c.role === 'pc') this.removeHuman(room, c.playerId);
    c.playerId = null;
    c.roomCode = null;
    c.role = null;
    return { ok: true };
  }

  removeHuman(room, playerId) {
    const h = room.humans.get(playerId);
    if (!h) return;
    room.humans.delete(playerId);
    this.sessions.delete(playerId);
    for (const [code, pc] of this.pairCodes) if (pc.playerId === playerId) this.pairCodes.delete(code);
    if (h.controllerTokenHash) this.controllerTokens.delete(h.controllerTokenHash);
    if (h.controller) h.controller.emit(S2C.CONTROLLER_KICKED, { reason: 'The PC player left the room.' });
    room.match?.removePlayer(playerId);
    if (room.humans.size === 0) { this.deleteRoom(room); return; }
    if (room.hostId === playerId) room.hostId = [...room.humans.keys()][0];
    this.broadcastRoom(room);
  }

  deleteRoom(room) {
    for (const h of room.humans.values()) {
      this.sessions.delete(h.playerId);
      if (h.controllerTokenHash) this.controllerTokens.delete(h.controllerTokenHash);
    }
    for (const [code, pc] of this.pairCodes) if (pc.roomCode === room.code) this.pairCodes.delete(code);
    room.match = null;
    this.rooms.delete(room.code);
  }

  pcContext(c) {
    if (c.role !== 'pc' || !c.playerId) return null;
    const room = this.rooms.get(c.roomCode);
    const h = room?.humans.get(c.playerId);
    if (!room || !h || h.client !== c.client) return null;
    return { room, h };
  }

  // ---------- match lifecycle ----------
  startMatch(room) {
    room.matchNo++;
    const humans = [...room.humans.values()].map((h) => ({ playerId: h.playerId, name: h.name }));
    room.match = new Match({
      map: this.map,
      seed: this.deps.seed(),
      humans,
      totalPlayers: MATCH_SIZE,
      bots: this.botsEnabled,
      countdown: this.countdown,
    });
    for (const h of room.humans.values()) {
      this.setSource(room, h);
      if (!h.client) room.match.neutralize(h.playerId);
    }
    room.snapTick = 0;
    for (const h of room.humans.values()) this.sendFull(room, h);
    this.broadcastRoom(room);
  }

  onStart(c) {
    const ctx = this.pcContext(c);
    if (!ctx) return { ok: false, reason: 'You are not in a room.' };
    const { room, h } = ctx;
    if (room.hostId !== h.playerId) return { ok: false, reason: 'Only the host can start.' };
    if (room.match && room.match.state !== 'FINISHED') return { ok: false, reason: 'A match is already in progress.' };
    this.startMatch(room);
    return { ok: true };
  }

  onRestart(c) {
    const ctx = this.pcContext(c);
    if (!ctx) return { ok: false, reason: 'You are not in a room.' };
    const { room, h } = ctx;
    if (room.hostId !== h.playerId) return { ok: false, reason: 'Only the host can restart.' };
    if (!room.match) return { ok: false, reason: 'No match has been played yet.' };
    if (room.match.state !== 'FINISHED' && !room.match.allHumansDead()) return { ok: false, reason: 'You can restart after the match ends or all human players are eliminated.' };
    this.startMatch(room); // brand-new Match object → timers, items, bots and input all reset
    return { ok: true };
  }

  // ---------- input ----------
  onInput(c, payload) {
    const ctx = this.pcContext(c);
    if (!ctx) return;
    const input = validateInput(payload);
    if (!input) { this.violation(c, 'invalid input'); return; }
    const { room, h } = ctx;
    if (!room.match || h.controller) return; // PC input is ignored while a controller is connected (policy)
    room.match.queueInput(h.playerId, input, this.now());
  }

  onMenu(c, payload) {
    const ctx = this.pcContext(c);
    if (!ctx || typeof payload?.open !== 'boolean') return;
    if (payload.open) ctx.room.match?.neutralize(ctx.h.playerId);
  }

  setSource(room, h) {
    room.match?.setInputSource(h.playerId, h.controller ? 'controller' : 'pc');
  }

  // ---------- controller pairing ----------
  onPairCreate(c) {
    const ctx = this.pcContext(c);
    if (!ctx) return { ok: false, reason: 'Join a room before pairing.' };
    for (const [code, pc] of this.pairCodes) if (pc.playerId === ctx.h.playerId) this.pairCodes.delete(code);
    let code;
    do { code = this.code(PAIR_CODE_LENGTH); } while (this.pairCodes.has(code));
    const expiresAt = this.now() + PAIR_CODE_TTL_MS;
    this.pairCodes.set(code, { roomCode: ctx.room.code, playerId: ctx.h.playerId, expiresAt });
    return { ok: true, code, expiresAt, ttlMs: PAIR_CODE_TTL_MS };
  }

  attachController(c, room, h) {
    if (h.controller && h.controller.id !== c.client.id) {
      // Policy: newest connection wins. The previous controller is told it was disconnected.
      h.controller.emit(S2C.CONTROLLER_KICKED, { reason: 'Another controller connected to this player.' });
      const old = this.clients.get(h.controller.id);
      if (old) { old.role = null; old.playerId = null; old.roomCode = null; }
    }
    if (h.controllerTokenHash) this.controllerTokens.delete(h.controllerTokenHash);
    const token = this.deps.randomToken(24);
    h.controllerTokenHash = this.deps.hash(token);
    this.controllerTokens.set(h.controllerTokenHash, h.playerId);
    h.controller = c.client;
    c.role = 'controller';
    c.playerId = h.playerId;
    c.roomCode = room.code;
    this.setSource(room, h);
    this.notifyController(room, h);
    this.broadcastRoom(room);
    return { ok: true, controllerToken: token, name: h.name, roomCode: room.code };
  }

  onControllerPair(c, payload) {
    const now = this.now();
    if (!this.pairLimiter.allow(c.client.ip ?? 'local', now)) return { ok: false, reason: 'Too many pairing attempts. Try again in a minute.' };
    const code = validatePairCode(payload?.code);
    const entry = code ? this.pairCodes.get(code) : null;
    if (!entry) { this.violation(c, 'bad pair code'); return { ok: false, reason: 'Invalid pairing code.' }; }
    this.pairCodes.delete(code); // single use
    if (entry.expiresAt < now) return { ok: false, reason: 'The pairing code expired. Create a new one on the PC.' };
    const room = this.rooms.get(entry.roomCode);
    const h = room?.humans.get(entry.playerId);
    if (!room || !h) return { ok: false, reason: 'No player to connect to.' };
    return this.attachController(c, room, h);
  }

  onControllerResume(c, payload) {
    const now = this.now();
    if (!this.pairLimiter.allow(c.client.ip ?? 'local', now)) return { ok: false, reason: 'Too many pairing attempts.' };
    const token = validateToken(payload?.token);
    const playerId = token ? this.controllerTokens.get(this.deps.hash(token)) : null;
    const s = playerId ? this.sessions.get(playerId) : null;
    const room = s ? this.rooms.get(s.roomCode) : null;
    const h = room?.humans.get(playerId);
    if (!h) return { ok: false, reason: 'The controller session expired. Pair again with a new code.' };
    return this.attachController(c, room, h);
  }

  onControllerInput(c, payload) {
    if (c.role !== 'controller') { this.violation(c, 'not paired'); return; }
    const room = this.rooms.get(c.roomCode);
    const h = room?.humans.get(c.playerId);
    if (!h || h.controller !== c.client) return;
    const input = validateInput(payload, { requireSeq: false });
    if (!input) { this.violation(c, 'invalid input'); return; }
    room.match?.setControllerInput(h.playerId, input, this.now());
  }

  notifyController(room, h) {
    h.client?.emit(S2C.CONTROLLER_STATUS, { connected: !!h.controller });
  }

  // ---------- broadcast ----------
  roomInfo(room) {
    return {
      code: room.code, solo: room.solo, hostId: room.hostId,
      humans: [...room.humans.values()].map((h) => ({
        playerId: h.playerId, name: h.name, connected: !!h.client, controller: !!h.controller, host: h.playerId === room.hostId,
      })),
      matchState: room.match ? room.match.state : 'LOBBY',
      maxHumans: MAX_HUMANS,
    };
  }

  broadcastRoom(room) {
    const info = this.roomInfo(room);
    for (const h of room.humans.values()) h.client?.emit(S2C.ROOM_STATE, { ...info, you: h.playerId });
  }

  sendFull(room, h) {
    if (!h?.client || !room.match) return;
    h.client.emit(S2C.FULL, {
      mapSeed: this.map.seed,
      matchNo: room.matchNo,
      killfeed: room.match.killfeed.slice(-6),
      ...room.match.publicState(this.now()),
      you: room.match.personal(h.playerId),
      ctrl: !!h.controller,
    });
  }

  tick(dt = TICK_DT) {
    const now = this.now();
    this.tickCount++;
    const snap = this.tickCount % SNAPSHOT_EVERY_TICKS === 0;
    for (const room of this.rooms.values()) {
      if (room.match) room.match.step(dt, now);
      if (snap && room.match) {
        const base = room.match.publicState(now);
        base.events = room.match.drainEvents();
        base.matchNo = room.matchNo;
        room.snapTick = (room.snapTick ?? 0) + 1;
        for (const h of room.humans.values()) {
          if (h.client) h.client.emit(S2C.SNAPSHOT, { ...base, you: room.match.personal(h.playerId), ctrl: !!h.controller });
          if (h.controller && room.snapTick % 3 === 0) {
            const p = room.match.players.get(h.playerId);
            const you = room.match.personal(h.playerId);
            const w = you?.weapons[you.slot];
            h.controller.emit(S2C.CONTROLLER_STATE, {
              state: room.match.state, hp: p ? Math.ceil(p.hp) : 0, alive: p ? p.alive : false,
              weapon: w?.type ?? null, mag: w?.mag ?? 0, reserve: w?.reserve ?? 0, reloading: (you?.reloadT ?? 0) > 0,
              pcConnected: !!h.client,
              aim: p ? Math.round(p.aim * 1000) / 1000 : 0,
              stance: p ? stanceOf(p) : 0,
            });
          }
        }
      }
    }
    if (this.tickCount % 30 === 0) this.cleanup(now);
  }

  cleanup(now) {
    for (const [code, pc] of this.pairCodes) if (pc.expiresAt < now) this.pairCodes.delete(code);
    for (const room of [...this.rooms.values()]) {
      for (const h of [...room.humans.values()]) {
        if (h.client || h.disconnectedAt === null) continue;
        const grace = room.match && room.match.state !== 'FINISHED' ? RECONNECT_GRACE_MS : LOBBY_GRACE_MS;
        if (now - h.disconnectedAt > grace) this.removeHuman(room, h.playerId);
      }
    }
    this.joinLimiter.prune(now);
    this.pairLimiter.prune(now);
  }
}
