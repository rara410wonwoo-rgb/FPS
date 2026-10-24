// Procedural PBR textures: albedo, roughness and normal maps generated with noise on a canvas, no image files.
// The same seed always gives the same result, so every client looks the same.
import * as THREE from 'three';

function hash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// tileable value noise (repeats every period)
function vnoise(x, y, period, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const m = (a) => ((a % period) + period) % period;
  const a = hash(m(xi), m(yi), seed);
  const b = hash(m(xi + 1), m(yi), seed);
  const c = hash(m(xi), m(yi + 1), seed);
  const d = hash(m(xi + 1), m(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, base, octaves, seed) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let p = base;
  for (let o = 0; o < octaves; o++) {
    sum += vnoise(x * p, y * p, p, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

// height(u,v) → 0..1, color(h,u,v,x,y) → [r,g,b] 0..255, rough(h,u,v) → 0..1
function generate({ size = 256, height, color, rough, normalStrength = 2 }) {
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) H[y * size + x] = height(x / size, y / size, x, y);

  const cc = makeCanvas(size);
  const rc = makeCanvas(size);
  const nc = makeCanvas(size);
  const cg = cc.getContext('2d');
  const rg = rc.getContext('2d');
  const ng = nc.getContext('2d');
  const ci = cg.createImageData(size, size);
  const ri = rg.createImageData(size, size);
  const ni = ng.createImageData(size, size);
  const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const h = H[y * size + x];
      const u = x / size;
      const v = y / size;
      const [r, g, b] = color(h, u, v, x, y);
      ci.data[i] = r; ci.data[i + 1] = g; ci.data[i + 2] = b; ci.data[i + 3] = 255;
      const ro = Math.max(0, Math.min(1, rough ? rough(h, u, v) : 0.85)) * 255;
      // three.js roughnessMap reads the G channel
      ri.data[i] = ro; ri.data[i + 1] = ro; ri.data[i + 2] = ro; ri.data[i + 3] = 255;
      const dx = (at(x + 1, y) - at(x - 1, y)) * normalStrength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * normalStrength;
      const len = Math.hypot(dx, dy, 1);
      ni.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      ni.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      ni.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      ni.data[i + 3] = 255;
    }
  }
  cg.putImageData(ci, 0, 0);
  rg.putImageData(ri, 0, 0);
  ng.putImageData(ni, 0, 0);
  const tex = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { map: tex(cc, true), roughnessMap: tex(rc, false), normalMap: tex(nc, false) };
}

const clamp255 = (v) => Math.max(0, Math.min(255, v));
const mix = (a, b, t) => a + (b - a) * t;
const mixRGB = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const shade = (c, k) => [clamp255(c[0] * k), clamp255(c[1] * k), clamp255(c[2] * k)];

const RECIPES = {
  // grass + dirt patches (ground)
  ground: () => generate({
    size: 512,
    height: (u, v) => fbm(u, v, 8, 5, 11) * 0.7 + fbm(u, v, 64, 2, 12) * 0.3,
    color: (h, u, v) => {
      const patch = fbm(u, v, 3, 4, 13);
      const grass = mixRGB([78, 92, 46], [118, 120, 66], fbm(u, v, 16, 3, 14));
      const dirt = mixRGB([112, 94, 66], [140, 122, 90], h);
      const c = mixRGB(grass, dirt, Math.max(0, Math.min(1, (patch - 0.52) * 5)));
      return shade(c, 0.78 + h * 0.4);
    },
    rough: (h) => 0.9 + h * 0.1,
    normalStrength: 3,
  }),
  asphalt: () => generate({
    size: 512,
    height: (u, v, x, y) => fbm(u, v, 32, 4, 21) * 0.6 + hash(x, y, 22) * 0.4,
    color: (h, u, v) => {
      const wear = fbm(u, v, 4, 3, 23);
      const c = mixRGB([46, 46, 45], [78, 76, 72], wear * 0.8 + h * 0.3);
      const crack = Math.abs(fbm(u, v, 6, 4, 24) - 0.5) < 0.008 ? 0.55 : 1;
      return shade(c, crack);
    },
    rough: (h) => 0.75 + h * 0.2,
    normalStrength: 4,
  }),
  concrete: () => generate({
    size: 256,
    height: (u, v, x, y) => fbm(u, v, 8, 5, 31) * 0.8 + hash(x, y, 32) * 0.2,
    color: (h, u, v) => {
      const stain = fbm(u, v, 2, 4, 33);
      const c = mixRGB([150, 146, 136], [118, 112, 100], stain);
      // rain streaks toward the bottom
      return shade(c, 0.85 + h * 0.3 - v * 0.08);
    },
    rough: (h) => 0.85 + h * 0.1,
    normalStrength: 3,
  }),
  plaster: () => generate({
    size: 256,
    height: (u, v, x, y) => fbm(u, v, 16, 4, 41) * 0.6 + hash(x, y, 42) * 0.4,
    color: (h, u, v) => {
      const dirt = fbm(u, v, 3, 4, 43);
      const c = mixRGB([214, 204, 182], [170, 156, 132], dirt * 0.9);
      return shade(c, 0.9 + h * 0.15);
    },
    rough: () => 0.92,
    normalStrength: 2.5,
  }),
  brick: () => generate({
    size: 256,
    height: (u, v, x, y) => {
      const rows = 16;
      const r = Math.floor(v * rows);
      const off = (r % 2) * 0.5;
      const bu = (u * 8 + off) % 1;
      const bv = (v * rows) % 1;
      const mortar = bu < 0.05 || bv < 0.1 ? 0 : 1;
      return mortar * (0.7 + fbm(u, v, 32, 2, 51) * 0.3) + hash(x, y, 52) * 0.05;
    },
    color: (h, u, v) => {
      if (h < 0.2) return [150, 144, 132];
      const r = Math.floor(v * 16);
      const tone = hash(Math.floor(u * 8 + (r % 2) * 0.5), r, 53);
      return shade(mixRGB([128, 70, 52], [160, 104, 76], tone), 0.8 + h * 0.3);
    },
    rough: (h) => (h < 0.2 ? 0.95 : 0.8),
    normalStrength: 5,
  }),
  wood: () => generate({
    size: 256,
    height: (u, v) => {
      const plank = (u * 4) % 1;
      const gap = plank < 0.04 ? 0 : 1;
      return gap * (0.6 + 0.4 * Math.sin(v * 80 + fbm(u, v, 4, 3, 61) * 20) * 0.5 + 0.2);
    },
    color: (h, u, v) => {
      const tone = hash(Math.floor(u * 4), 0, 62);
      const base = mixRGB([118, 84, 50], [150, 112, 70], tone);
      return shade(base, 0.6 + h * 0.5);
    },
    rough: () => 0.8,
    normalStrength: 3,
  }),
  metal: () => generate({
    size: 256,
    height: (u, v, x, y) => fbm(u, v, 8, 4, 71) * 0.5 + hash(x, y, 72) * 0.1,
    color: (h, u, v) => {
      const rust = Math.max(0, fbm(u, v, 4, 5, 73) - 0.55) * 3;
      return shade(mixRGB([96, 100, 98], [120, 76, 48], Math.min(1, rust)), 0.8 + h * 0.4);
    },
    rough: (h, u, v) => 0.45 + fbm(u, v, 4, 5, 73) * 0.5,
    normalStrength: 1.5,
  }),
  rock: () => generate({
    size: 256,
    height: (u, v) => fbm(u, v, 4, 6, 81),
    color: (h, u, v) => shade(mixRGB([110, 106, 98], [150, 144, 132], fbm(u, v, 8, 3, 82)), 0.6 + h * 0.6),
    rough: () => 0.9,
    normalStrength: 6,
  }),
  bark: () => generate({
    size: 128,
    height: (u, v) => Math.abs(Math.sin(u * 40 + fbm(u, v, 4, 3, 91) * 12)) * 0.7 + fbm(u, v, 16, 2, 92) * 0.3,
    color: (h) => shade([88, 66, 44], 0.55 + h * 0.6),
    rough: () => 0.95,
    normalStrength: 6,
  }),
  camo: () => generate({
    size: 256,
    height: (u, v, x, y) => hash(x, y, 101) * 0.3 + fbm(u, v, 64, 1, 102) * 0.7,
    color: (h, u, v) => {
      const a = fbm(u, v, 4, 3, 103);
      const b = fbm(u, v, 6, 3, 104);
      let c = [176, 160, 120];
      if (a > 0.55) c = [132, 116, 82];
      if (b > 0.62) c = [96, 90, 66];
      return shade(c, 0.85 + h * 0.25);
    },
    rough: () => 0.95,
    normalStrength: 1.5,
  }),
  fabric: () => generate({
    size: 128,
    height: (u, v, x, y) => (Math.sin(x * 1.6) * Math.sin(y * 1.6)) * 0.25 + 0.5 + hash(x, y, 111) * 0.2,
    color: (h) => shade([110, 108, 92], 0.8 + h * 0.3),
    rough: () => 0.95,
    normalStrength: 1.5,
  }),
};

const cache = new Map();

export function texSet(name, repeatX = 1, repeatY = repeatX) {
  if (!cache.has(name)) cache.set(name, RECIPES[name]());
  const base = cache.get(name);
  if (repeatX === 1 && repeatY === 1) return base;
  const out = {};
  for (const [k, t] of Object.entries(base)) {
    const c = t.clone();
    c.repeat.set(repeatX, repeatY);
    c.needsUpdate = true;
    out[k] = c;
  }
  return out;
}

// radial sprite for translucent smoke and flashes
export function radialSprite(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 64) {
  const c = makeCanvas(size);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// star-shaped muzzle flash
export function flashSprite(size = 128) {
  const c = makeCanvas(size);
  const g = c.getContext('2d');
  const cx = size / 2;
  g.translate(cx, cx);
  for (let i = 0; i < 7; i++) {
    g.rotate((Math.PI * 2) / 7 + hash(i, 1, 5) * 0.3);
    const grd = g.createLinearGradient(0, 0, cx, 0);
    grd.addColorStop(0, 'rgba(255,240,200,1)');
    grd.addColorStop(1, 'rgba(255,150,40,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(0, -size * 0.05);
    g.lineTo(cx * (0.6 + hash(i, 2, 5) * 0.4), 0);
    g.lineTo(0, size * 0.05);
    g.fill();
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  const grd = g.createRadialGradient(cx, cx, 0, cx, cx, cx * 0.45);
  grd.addColorStop(0, 'rgba(255,255,230,1)');
  grd.addColorStop(1, 'rgba(255,180,60,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// leaf cluster (for alpha testing)
export function leafTexture(size = 256) {
  const c = makeCanvas(size);
  const g = c.getContext('2d');
  for (let i = 0; i < 260; i++) {
    const x = hash(i, 1, 201) * size;
    const y = hash(i, 2, 201) * size;
    const r = 6 + hash(i, 3, 201) * 12;
    const d = Math.hypot(x - size / 2, y - size / 2) / (size / 2);
    if (d > 0.95) continue;
    const k = 0.6 + hash(i, 4, 201) * 0.5;
    g.fillStyle = `rgb(${Math.round(70 * k)},${Math.round(96 * k)},${Math.round(44 * k)})`;
    g.beginPath();
    g.ellipse(x, y, r, r * 0.5, hash(i, 5, 201) * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// bullet hole decals
export function bulletHoleTexture(size = 64) {
  const c = makeCanvas(size);
  const g = c.getContext('2d');
  const cx = size / 2;
  const grd = g.createRadialGradient(cx, cx, 0, cx, cx, cx);
  grd.addColorStop(0, 'rgba(10,10,10,1)');
  grd.addColorStop(0.25, 'rgba(25,22,20,0.95)');
  grd.addColorStop(0.5, 'rgba(60,55,50,0.5)');
  grd.addColorStop(1, 'rgba(60,55,50,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
