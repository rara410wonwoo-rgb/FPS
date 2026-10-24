// Client network state: snapshot buffer and interpolation, local prediction and server reconciliation
import { INTERP_DELAY_MS, TICK_DT } from '../../shared/config.js';
import { stepMovement, copyMoveState, initMoveState } from '../../shared/movement.js';
import { lerpAngle } from '../../shared/collision.js';

export class ClientState {
  constructor(map) {
    this.map = map;
    this.reset();
    this.seq = 0;
  }

  reset() {
    this.snaps = [];
    this.offset = null;
    this.latest = null;
    this.you = null;
    this.youId = null;
    this.matchNo = -1;
    this.pred = null;
    this.pending = [];
    this.corr = { x: 0, z: 0 };
    this.ctrl = false;
  }

  onFull(data) {
    const keepSeq = this.seq;
    this.reset();
    this.seq = keepSeq;
    this.matchNo = data.matchNo;
    this.youId = data.you?.id ?? null;
    this.ingest(data);
    if (data.you) this.pred = this.serverPos();
  }

  onSnapshot(data) {
    if (data.matchNo !== this.matchNo) return false;
    this.ingest(data);
    this.reconcile();
    return true;
  }

  ingest(data) {
    const sample = data.t - performance.now();
    if (this.offset === null) this.offset = sample;
    else this.offset += (sample - this.offset) * (sample < this.offset ? 0.3 : 0.05);
    this.snaps.push(data);
    if (this.snaps.length > 40) this.snaps.shift();
    this.latest = data;
    this.you = data.you;
    this.ctrl = !!data.ctrl;
  }

  self() {
    return this.latest?.players.find((p) => p.id === this.youId) ?? null;
  }

  weaponType() {
    const w = this.you?.weapons?.[this.you.slot];
    return w ? w.type : null;
  }

  predicting() {
    const s = this.self();
    return !!(this.latest && this.latest.state === 'PLAYING' && s && s.al && !this.ctrl);
  }

  // Rewind to the server position, then re-apply unacknowledged inputs
  reconcile() {
    if (!this.you) return;
    this.pending = this.pending.filter((p) => p.seq > this.you.lastSeq);
    if (!this.predicting()) {
      this.pending.length = 0;
      this.pred = this.serverPos();
      this.corr.x = this.corr.z = 0;
      return;
    }
    const before = this.pred ? { ...this.pred } : null;
    const p = this.serverPos();
    const wt = this.weaponType();
    for (const inp of this.pending) stepMovement(this.map.index, p, inp, TICK_DT, wt);
    this.pred = p;
    if (before) {
      const ex = before.x - p.x;
      const ez = before.z - p.z;
      if (Math.hypot(ex, ez) > 3) { this.corr.x = 0; this.corr.z = 0; } else { this.corr.x += ex; this.corr.z += ez; }
    }
  }

  serverPos() {
    const p = initMoveState({ x: this.you.x, z: this.you.z });
    if (this.you.mv) copyMoveState(this.you.mv, p);
    return p;
  }

  predict(input) {
    if (!this.predicting() || !this.pred) return;
    this.pending.push(input);
    if (this.pending.length > 60) this.pending.shift();
    stepMovement(this.map.index, this.pred, input, TICK_DT, this.weaponType());
  }

  decayCorrection(dt) {
    const k = Math.exp(-dt * 12);
    this.corr.x *= k;
    this.corr.z *= k;
  }

  renderTime() {
    return performance.now() + (this.offset ?? 0) - INTERP_DELAY_MS;
  }

  // interpolated state of remote entities
  interpolated() {
    const n = this.snaps.length;
    if (!n) return { players: [], zone: null };
    const rt = this.renderTime();
    let a = this.snaps[0];
    let b = this.snaps[n - 1];
    if (rt >= b.t) { a = b; } else {
      for (let i = n - 1; i > 0; i--) {
        if (this.snaps[i - 1].t <= rt) { a = this.snaps[i - 1]; b = this.snaps[i]; break; }
      }
    }
    const k = a === b ? 0 : Math.min(1, Math.max(0, (rt - a.t) / (b.t - a.t)));
    const byId = new Map(a.players.map((p) => [p.id, p]));
    const players = b.players.map((pb) => {
      const pa = byId.get(pb.id) ?? pb;
      return {
        ...pb,
        x: pa.x + (pb.x - pa.x) * k,
        z: pa.z + (pb.z - pa.z) * k,
        y: (pa.y ?? 0) + ((pb.y ?? 0) - (pa.y ?? 0)) * k,
        a: lerpAngle(pa.a, pb.a, k),
        al: k < 0.5 ? pa.al : pb.al,
      };
    });
    const za = a.zone;
    const zb = b.zone;
    const zone = { ...zb, cx: za.cx + (zb.cx - za.cx) * k, cz: za.cz + (zb.cz - za.cz) * k, r: za.r + (zb.r - za.r) * k };
    return { players, zone };
  }
}
