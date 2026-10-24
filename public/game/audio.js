// Sound effects synthesized with the Web Audio API (no recordings). Enabled after the first user input.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.6;
    this.muted = false;
    this.active = 0;
    this.lastHitTick = 0;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.comp = this.ctx.createDynamicsCompressor();
      this.master.connect(this.comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.6;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.applyVolume();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); this.applyVolume(); }
  setMuted(m) { this.muted = m; this.applyVolume(); }
  applyVolume() { if (this.master) this.master.gain.value = this.muted ? 0 : this.volume; }

  voice(dur) {
    if (!this.ready || this.muted || this.active > 24) return null;
    this.active++;
    setTimeout(() => { this.active--; }, dur * 1000 + 50);
    return this.ctx.currentTime;
  }

  // positional attenuation and panning: dx is the x offset from the listener, dist the distance
  spatial(dist = 0, dx = 0) {
    const g = this.ctx.createGain();
    g.gain.value = 1 / (1 + dist * 0.06);
    const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (pan) { pan.pan.value = Math.max(-0.9, Math.min(0.9, dx / 25)); g.connect(pan).connect(this.master); } else g.connect(this.master);
    return g;
  }

  noiseBurst(t, out, { gain, from, to, dur, rate = 1, type = 'lowpass' }) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate * (0.95 + Math.random() * 0.1);
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  tone(t, out, { type = 'sine', from, to, gain, dur, delay = 0 }) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t + delay);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + delay + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + delay);
    g.gain.exponentialRampToValueAtTime(gain, t + delay + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
    o.connect(g).connect(out);
    o.start(t + delay);
    o.stop(t + delay + dur + 0.02);
  }

  shot(weapon, dist = 0, dx = 0) {
    const t = this.voice(0.4);
    if (t === null) return;
    const out = this.spatial(dist, dx);
    const far = Math.min(1, dist / 45);
    if (weapon === 'breaker') {
      this.noiseBurst(t, out, { gain: 0.9, from: 1400 - far * 800, to: 120, dur: 0.32, rate: 0.7 });
      this.tone(t, out, { type: 'sine', from: 95, to: 38, gain: 0.9, dur: 0.18 });
    } else if (weapon === 'hornet') {
      this.noiseBurst(t, out, { gain: 0.45, from: 3200 - far * 2000, to: 400, dur: 0.09, rate: 1.2 });
      this.tone(t, out, { type: 'triangle', from: 190, to: 70, gain: 0.35, dur: 0.06 });
    } else {
      this.noiseBurst(t, out, { gain: 0.6, from: 2400 - far * 1500, to: 260, dur: 0.16 });
      this.tone(t, out, { type: 'sine', from: 140, to: 45, gain: 0.6, dur: 0.1 });
    }
  }

  hitmarker(kill) {
    const now = performance.now();
    if (!kill && now - this.lastHitTick < 45) return;
    this.lastHitTick = now;
    const t = this.voice(0.15);
    if (t === null) return;
    if (kill) {
      this.tone(t, this.master, { type: 'square', from: 1300, gain: 0.12, dur: 0.08 });
      this.tone(t, this.master, { type: 'square', from: 1750, gain: 0.1, dur: 0.12, delay: 0.07 });
    } else {
      this.tone(t, this.master, { type: 'square', from: 2300, gain: 0.08, dur: 0.035 });
    }
  }

  hurt() {
    const t = this.voice(0.25);
    if (t === null) return;
    this.tone(t, this.master, { type: 'sine', from: 160, to: 60, gain: 0.5, dur: 0.18 });
    this.noiseBurst(t, this.master, { gain: 0.2, from: 600, to: 150, dur: 0.12 });
  }

  reload() {
    const t = this.voice(1.2);
    if (t === null) return;
    this.noiseBurst(t, this.master, { gain: 0.25, from: 3000, to: 1500, dur: 0.05, type: 'highpass' });
    this.noiseBurst(t + 0.55, this.master, { gain: 0.3, from: 2600, to: 1200, dur: 0.06, type: 'highpass' });
    this.tone(t + 0.6, this.master, { type: 'square', from: 900, gain: 0.05, dur: 0.03 });
  }

  dry() {
    const t = this.voice(0.1);
    if (t === null) return;
    this.tone(t, this.master, { type: 'square', from: 1800, gain: 0.05, dur: 0.02 });
  }

  pickup() {
    const t = this.voice(0.4);
    if (t === null) return;
    [660, 880, 1320].forEach((f, i) => this.tone(t, this.master, { type: 'triangle', from: f, gain: 0.12, dur: 0.12, delay: i * 0.06 }));
  }

  denied() {
    const t = this.voice(0.3);
    if (t === null) return;
    this.tone(t, this.master, { type: 'square', from: 220, gain: 0.06, dur: 0.12 });
  }

  zoneAlarm() {
    const t = this.voice(1.2);
    if (t === null) return;
    for (let i = 0; i < 3; i++) {
      this.tone(t, this.master, { type: 'sawtooth', from: 440, gain: 0.06, dur: 0.16, delay: i * 0.32 });
      this.tone(t, this.master, { type: 'sawtooth', from: 330, gain: 0.06, dur: 0.16, delay: i * 0.32 + 0.16 });
    }
  }

  beep(high = false) {
    const t = this.voice(0.3);
    if (t === null) return;
    this.tone(t, this.master, { type: 'sine', from: high ? 1100 : 660, gain: 0.15, dur: high ? 0.3 : 0.12 });
  }

  stinger(win) {
    const t = this.voice(1.6);
    if (t === null) return;
    const notes = win ? [523, 659, 784, 1046] : [392, 311, 262];
    notes.forEach((f, i) => this.tone(t, this.master, { type: 'triangle', from: f, gain: 0.14, dur: 0.5, delay: i * 0.16 }));
  }
}
