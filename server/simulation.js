// Server-authoritative match simulation: state machine, input, items, zone damage, win/loss
import {
  MAX_HP, MATCH_SIZE, COUNTDOWN_SEC, PLAYER_RADIUS, INPUT_TIMEOUT_MS, MAX_INPUT_QUEUE,
  WEAPONS, WEAPON_IDS, START_WEAPON, ITEMS, PICKUP_RANGE, BOT, WEAPON_SLOTS,
} from '../shared/config.js';
import { mulberry32, wrapAngle } from '../shared/collision.js';
import { findFreePoint } from '../shared/map.js';
import { stepMovement, initMoveState, needsStep, stanceOf, isBusy, MOVE_KEYS } from '../shared/movement.js';
import { Zone } from './zone.js';
import { updateFiring, updateReload, startReload, currentWeapon, applyDamage } from './combat.js';
import { BotDirector } from './bots.js';

const NEUTRAL = Object.freeze({ mx: 0, mz: 0, fire: false, ads: false, jump: false, crouch: false, sprint: false });

function makeWeapon(type) {
  const def = WEAPONS[type];
  return { type, mag: def.magSize, reserve: def.reserveStart };
}

export class Match {
  constructor({ map, seed = 1, humans = [], totalPlayers = MATCH_SIZE, bots = true, countdown = COUNTDOWN_SEC }) {
    this.map = map;
    this.seed = seed;
    this.rand = mulberry32(seed);
    this.time = 0;
    this.tick = 0;
    this.elapsed = 0;
    this.state = 'COUNTDOWN';
    this.countdown = countdown;
    this.players = new Map();
    this.items = new Map();
    this.nextItemId = 1;
    this.events = [];
    this.eventSeq = 0;
    this.killfeed = [];
    this.noise = [];
    this.results = null;
    this.deathsThisTick = [];
    this.zone = new Zone(this.rand, map);
    this.zoneState = this.zone.state(0);
    this.lastZoneKey = `${this.zoneState.phase}:${this.zoneState.stage}`;

    const spawned = [];
    let variant = 0;
    for (const h of humans) {
      const p = this.createPlayer(h.playerId, h.name, false, variant++ % 4, spawned);
      spawned.push(p);
    }
    if (bots) {
      const names = [...BOT.names];
      let i = 0;
      while (this.players.size < totalPlayers) {
        const name = names[i % names.length] + (i >= names.length ? `-${Math.floor(i / names.length) + 1}` : '');
        const p = this.createPlayer(`bot-${i + 1}`, name, true, variant++ % 4, spawned);
        spawned.push(p);
        i++;
      }
    }
    this.spawnItems();
    this.botDirector = new BotDirector(this);
  }

  createPlayer(id, name, bot, variant, avoid) {
    const pos = findFreePoint(this.map, this.rand, PLAYER_RADIUS, { avoid, minDist: 32, margin: 8 });
    const p = {
      id, name, bot, variant,
      x: pos.x, z: pos.z, aim: this.rand() * Math.PI * 2 - Math.PI,
      hp: MAX_HP, alive: true, kills: 0, damageDealt: 0,
      weapons: [makeWeapon(START_WEAPON), ...new Array(WEAPON_SLOTS - 1).fill(null)],
      slot: 0, reloadT: 0, reloadTotal: 0, fireCd: 0, bloom: 0, dryFired: false,
      control: { mx: 0, mz: 0, aim: 0, fire: false, ads: false, jump: false, crouch: false, sprint: false },
      queue: [], lastSeq: 0, lastQueuedSeq: 0, lastInputAt: -Infinity,
      source: 'pc', held: null, heldAt: -Infinity,
      pending: { reload: false, interact: false, swap: false },
      moving: false, placement: null, deathTime: null, killedBy: null, survival: 0,
      lastShotAt: -99, lastHitAt: -99,
    };
    p.control.aim = p.aim;
    initMoveState(p);
    this.players.set(id, p);
    return p;
  }

  spawnItems() {
    const placed = [];
    for (const [type, def] of Object.entries(ITEMS)) {
      for (let i = 0; i < def.count; i++) {
        const pos = findFreePoint(this.map, this.rand, 0.6, { avoid: placed, minDist: 7, margin: 5 });
        this.addItem(type, pos.x, pos.z);
        placed.push(pos);
      }
    }
  }

  addItem(type, x, z) {
    const id = this.nextItemId++;
    this.items.set(id, { id, type, x, z });
    return id;
  }

  emit(ev) {
    ev.id = ++this.eventSeq;
    this.events.push(ev);
    if (ev.type === 'shot') {
      const p = this.players.get(ev.p);
      if (p) this.noise.push({ x: p.x, z: p.z, t: this.time, p: p.id });
    }
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  aliveCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.alive) n++;
    return n;
  }

  // ---- input ----
  queueInput(id, input, nowMs) {
    const p = this.players.get(id);
    if (!p || p.bot) return false;
    if (input.seq <= p.lastQueuedSeq) return false; // reject resent or out-of-order input
    p.lastQueuedSeq = input.seq;
    p.queue.push(input);
    if (p.queue.length > MAX_INPUT_QUEUE) {
      const dropped = p.queue.shift();
      p.lastSeq = Math.max(p.lastSeq, dropped.seq);
    }
    p.lastInputAt = nowMs;
    this.takeEdges(p, input);
    return true;
  }

  setControllerInput(id, input, nowMs) {
    const p = this.players.get(id);
    if (!p || p.bot) return false;
    p.held = input;
    p.heldAt = nowMs;
    this.takeEdges(p, input);
    return true;
  }

  takeEdges(p, input) {
    if (input.reload) p.pending.reload = true;
    if (input.interact) p.pending.interact = true;
    if (input.swap) p.pending.swap = true;
  }

  setInputSource(id, source) {
    const p = this.players.get(id);
    if (!p) return;
    p.source = source;
    this.neutralize(id);
  }

  neutralize(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.queue.length = 0;
    p.lastSeq = Math.max(p.lastSeq, p.lastQueuedSeq);
    p.held = null;
    p.heldAt = -Infinity;
    p.lastInputAt = -Infinity;
    Object.assign(p.control, NEUTRAL);
    p.pending.reload = p.pending.interact = p.pending.swap = false;
  }

  applyControl(p, inp) {
    p.control.mx = inp.mx;
    p.control.mz = inp.mz;
    p.control.aim = wrapAngle(inp.aim);
    p.control.fire = inp.fire;
    p.control.ads = inp.ads;
    p.control.jump = !!inp.jump;
    p.control.crouch = !!inp.crouch;
    p.control.sprint = !!inp.sprint;
  }

  // ---- simulation ----
  step(dt, nowMs) {
    this.tick++;
    this.time += dt;
    if (this.state === 'FINISHED') return;
    const frozen = this.state === 'COUNTDOWN';
    if (frozen) {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.state = 'PLAYING';
        this.countdown = 0;
        this.emit({ type: 'start' });
      }
    } else {
      this.elapsed += dt;
      this.zoneState = this.zone.state(this.elapsed);
      const key = `${this.zoneState.phase}:${this.zoneState.stage}`;
      if (key !== this.lastZoneKey) {
        this.lastZoneKey = key;
        this.emit({ type: 'zone', phase: this.zoneState.phase, stage: this.zoneState.stage });
      }
      this.botDirector.think(dt);
    }
    this.deathsThisTick = [];

    for (const p of this.players.values()) {
      const weaponType = currentWeapon(p)?.type;
      let moved = false;
      if (p.bot) {
        if (p.alive && !frozen) moved = stepMovement(this.map.index, p, p.control, dt, weaponType);
      } else if (p.source === 'controller') {
        if (p.held && nowMs - p.heldAt <= INPUT_TIMEOUT_MS) {
          this.applyControl(p, p.held);
          if (p.alive && !frozen) moved = stepMovement(this.map.index, p, p.held, dt, weaponType);
        } else {
          Object.assign(p.control, NEUTRAL);
        }
      } else {
        const n = p.queue.length > 4 ? 3 : p.queue.length > 0 ? 1 : 0;
        for (let i = 0; i < n; i++) {
          const inp = p.queue.shift();
          p.lastSeq = inp.seq;
          this.applyControl(p, inp);
          if (p.alive && !frozen && stepMovement(this.map.index, p, inp, dt, weaponType)) moved = true;
        }
        if (n === 0 && nowMs - p.lastInputAt > INPUT_TIMEOUT_MS) Object.assign(p.control, NEUTRAL);
        // keep airborne/slide/vault motion going even with no input
        if (n === 0 && p.alive && !frozen && needsStep(p)) {
          if (stepMovement(this.map.index, p, { ...p.control, jump: false }, dt, weaponType)) moved = true;
        }
      }
      p.moving = moved;
      if (!p.alive) continue;
      p.aim = p.control.aim;
      if (frozen) { p.control.fire = false; continue; }

      if (p.pending.swap) { p.pending.swap = false; this.swapWeapon(p); }
      if (p.pending.reload) { p.pending.reload = false; startReload(this, p); }
      if (isBusy(p)) p.control.fire = false; // no firing while vaulting
      if (p.pending.interact) { p.pending.interact = false; this.tryPickup(p); }
      updateReload(p, dt);
      updateFiring(this, p, dt);
    }

    if (!frozen) {
      const z = this.zoneState;
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        if (Math.hypot(p.x - z.cx, p.z - z.cz) > z.r) applyDamage(this, p, z.dps * dt, null, 'zone');
      }
      this.noise = this.noise.filter((n) => this.time - n.t < 0.6);
      const alive = this.aliveCount();
      if (alive === 0 && this.deathsThisTick.length) {
        for (const p of this.deathsThisTick) p.placement = 1;
      }
      if (alive <= 1) this.finish();
    }
  }

  swapWeapon(p) {
    const other = (p.slot + 1) % WEAPON_SLOTS;
    if (!p.weapons[other]) return false;
    p.slot = other;
    p.reloadT = 0;
    p.fireCd = Math.max(p.fireCd, 0.25);
    p.bloom = 0;
    this.emit({ type: 'swap', p: p.id, w: p.weapons[other].type });
    return true;
  }

  nearestItem(p) {
    let best = null;
    let bestD = PICKUP_RANGE;
    for (const it of this.items.values()) {
      const d = Math.hypot(it.x - p.x, it.z - p.z);
      if (d <= bestD) { bestD = d; best = it; }
    }
    return best;
  }

  tryPickup(p) {
    const it = this.nearestItem(p);
    if (!it || !this.items.has(it.id)) return false;
    const result = this.applyItem(p, it);
    if (!result.ok) {
      this.emit({ type: 'pickfail', p: p.id, item: it.type, reason: result.reason });
      return false;
    }
    this.items.delete(it.id);
    this.emit({ type: 'pickup', p: p.id, item: it.type, itemId: it.id, w: result.weapon ?? null });
    return true;
  }

  applyItem(p, it) {
    if (it.type === 'medkit') {
      if (p.hp >= MAX_HP) return { ok: false, reason: 'HP is already full' };
      p.hp = Math.min(MAX_HP, p.hp + ITEMS.medkit.heal);
      return { ok: true };
    }
    if (it.type === 'ammo') {
      const order = [p.slot, ...p.weapons.map((_, i) => i).filter((i) => i !== p.slot)];
      for (const i of order) {
        const w = p.weapons[i];
        if (!w) continue;
        const def = WEAPONS[w.type];
        if (w.reserve < def.reserveMax) {
          w.reserve = Math.min(def.reserveMax, w.reserve + def.magSize * 2);
          return { ok: true };
        }
      }
      return { ok: false, reason: 'Reserve ammo is already full' };
    }
    if (it.type === 'crate') {
      const held = new Set(p.weapons.filter(Boolean).map((w) => w.type));
      const options = WEAPON_IDS.filter((t) => !held.has(t));
      if (!options.length) {
        for (const w of p.weapons) if (w) w.reserve = WEAPONS[w.type].reserveMax;
        return { ok: true };
      }
      const type = options[Math.floor(this.rand() * options.length)];
      const empty = p.weapons.findIndex((w) => !w);
      const slot = empty >= 0 ? empty : p.slot;
      p.weapons[slot] = makeWeapon(type);
      p.slot = slot;
      p.reloadT = 0;
      p.fireCd = Math.max(p.fireCd, 0.2);
      return { ok: true, weapon: type };
    }
    return { ok: false, reason: 'unknown' };
  }

  killPlayer(p, attacker, cause) {
    if (!p.alive) return;
    p.alive = false;
    p.hp = 0;
    p.deathTime = this.elapsed;
    p.survival = this.elapsed;
    p.killedBy = attacker ? attacker.id : null;
    p.reloadT = 0;
    p.queue.length = 0;
    Object.assign(p.control, NEUTRAL);
    if (attacker && attacker !== p) attacker.kills++;
    p.placement = this.aliveCount() + 1;
    this.deathsThisTick.push(p);
    // drop an ammo box where the player died
    this.addItem('ammo', p.x, p.z);
    const entry = { t: this.elapsed, k: attacker ? attacker.id : null, kn: attacker ? attacker.name : null, v: p.id, vn: p.name, w: cause };
    this.killfeed.push(entry);
    if (this.killfeed.length > 30) this.killfeed.shift();
    this.emit({ type: 'kill', ...entry });
  }

  finish() {
    if (this.state === 'FINISHED') return;
    this.state = 'FINISHED';
    let winner = null;
    for (const p of this.players.values()) {
      if (p.alive) { winner = p; p.placement = 1; p.survival = this.elapsed; }
    }
    const rows = [...this.players.values()]
      .map((p) => ({ id: p.id, name: p.name, bot: p.bot, placement: p.placement ?? 1, kills: p.kills, survival: Math.round(p.survival * 10) / 10 }))
      .sort((a, b) => a.placement - b.placement || b.kills - a.kills);
    this.results = { winnerId: winner ? winner.id : null, winnerName: winner ? winner.name : null, draw: !winner, duration: Math.round(this.elapsed), rows };
    this.emit({ type: 'end', winner: this.results.winnerId, draw: this.results.draw });
  }

  allHumansDead() {
    let humans = 0;
    for (const p of this.players.values()) {
      if (p.bot) continue;
      humans++;
      if (p.alive) return false;
    }
    return humans > 0;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.alive && this.state !== 'FINISHED') {
      if (this.state === 'COUNTDOWN') { this.players.delete(id); return; }
      this.killPlayer(p, null, 'left');
      if (this.aliveCount() <= 1 && this.state === 'PLAYING') this.finish();
    }
  }

  // ---- serialization ----
  publicState(nowMs) {
    const players = [];
    for (const p of this.players.values()) {
      const w = currentWeapon(p);
      players.push({
        id: p.id, n: p.name, b: p.bot, v: p.variant,
        x: r2(p.x), z: r2(p.z), a: r3(p.aim),
        hp: Math.ceil(p.hp), al: p.alive, w: w ? w.type : null,
        ads: p.control.ads && p.alive, rl: p.reloadT > 0, mv: p.moving, k: p.kills,
        y: r2(p.y ?? 0), st: stanceOf(p), sp: !!p.sprint,
      });
    }
    const items = [];
    for (const it of this.items.values()) items.push({ id: it.id, t: it.type, x: r2(it.x), z: r2(it.z) });
    const z = this.zoneState;
    return {
      t: nowMs, tick: this.tick, state: this.state,
      countdown: r2(this.countdown), elapsed: r2(this.elapsed),
      alive: this.aliveCount(), total: this.players.size,
      zone: { cx: r2(z.cx), cz: r2(z.cz), r: r2(z.r), nx: r2(z.nx), nz: r2(z.nz), nr: r2(z.nr), phase: z.phase, total: z.totalPhases, stage: z.stage, sudden: z.sudden, left: r2(z.timeLeft), dps: z.dps },
      players, items,
      results: this.results,
    };
  }

  personal(id) {
    const p = this.players.get(id);
    if (!p) return null;
    return {
      id: p.id, slot: p.slot,
      weapons: p.weapons.map((w) => (w ? { type: w.type, mag: w.mag, reserve: w.reserve } : null)),
      reloadT: r2(p.reloadT), reloadTotal: p.reloadTotal, lastSeq: p.lastSeq,
      placement: p.placement, killedBy: p.killedBy, bloom: r3(p.bloom), source: p.source,
      x: p.x, z: p.z,
      mv: Object.fromEntries(MOVE_KEYS.map((k) => [k, p[k]])),
    };
  }
}

function r2(v) { return Math.round(v * 100) / 100; }
function r3(v) { return Math.round(v * 1000) / 1000; }
