// 3D battlefield: HDRI/physical sky + IBL, PBR materials, detailed buildings, trees and grass, gas wall, post-processing.
// Collision and hits use the server AABBs (shared/collision.js) as-is; this file only dresses them up.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD_HALF, QUALITY_PRESETS } from '../../shared/config.js';
import { mulberry32 } from '../../shared/collision.js';
import { texSet, leafTexture } from './textures.js';
import { ASSETS, modelParts } from './assets.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const PALETTE = {
  fog: 0xb4c4d2,
  zone: new THREE.Color(0xff4a1c),
  zoneNext: 0xffffff,
};

// Sun direction: use the one found in the HDRI if available (updated when GameScene is created)
const SUN_DIR = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 40), THREE.MathUtils.degToRad(215));

// Procedural fallback textures used when the Poly Haven textures are missing
const FALLBACK = {
  sparse_grass: 'ground', dirt_floor: 'ground', rocky_terrain_02: 'rock', rock_face_03: 'rock', plastered_wall_04: 'plaster',
  red_brick_03: 'brick', concrete_wall_008: 'concrete', asphalt_02: 'asphalt', bark_brown_02: 'bark', wood_planks_grey: 'wood',
  corrugated_iron_02: 'metal',
};
function tex(name) {
  return ASSETS.tex[name] ?? texSet(FALLBACK[name] ?? name);
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

function instanced(geo, mat, items, fill, { shadow = true, receive = true, colors = false } = {}) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  mesh.count = items.length;
  items.forEach((it, i) => {
    fill(it, i, tmpP, tmpQ, tmpS, tmpC);
    tmpM.compose(tmpP, tmpQ, tmpS);
    mesh.setMatrixAt(i, tmpM);
    if (colors) mesh.setColorAt(i, tmpC);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = shadow;
  mesh.receiveShadow = receive;
  mesh.computeBoundingSphere();
  return mesh;
}

// World-space box-projected UVs: constant texture density on structures of any (scaled/instanced) size.
const WORLD_UV_CHUNK = (scale) => /* glsl */`
  {
    mat4 pzM = modelMatrix;
    #ifdef USE_INSTANCING
      pzM = modelMatrix * instanceMatrix;
    #endif
    vec3 pzW = (pzM * vec4(position, 1.0)).xyz;
    vec3 pzN = abs(normalize(mat3(pzM) * normal));
    vec2 pzUV = pzN.y > max(pzN.x, pzN.z) ? pzW.xz : (pzN.x > pzN.z ? pzW.zy : pzW.xy);
    pzUV *= ${scale.toFixed(4)};
    #ifdef USE_MAP
      vMapUv = pzUV;
    #endif
    #ifdef USE_NORMALMAP
      vNormalMapUv = pzUV;
    #endif
    #ifdef USE_ROUGHNESSMAP
      vRoughnessMapUv = pzUV;
    #endif
  }
`;

function worldMat(name, scale, params = {}) {
  const t = tex(name);
  const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, roughness: 1, ...params });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>\n${WORLD_UV_CHUNK(scale)}`);
  };
  m.customProgramCacheKey = () => `wuv${scale}`;
  return m;
}

// glTF model instancing: fit(item) → { x, y, z, rot, sx, sy, sz } (scale relative to the original size)
function instancedModel(name, items, fit, { shadow = true } = {}) {
  const info = modelParts(name);
  if (!info || !items.length) return null;
  const group = new THREE.Group();
  const toBase = new THREE.Matrix4().makeTranslation(-info.center.x, -info.box.min.y, -info.center.z);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  // Spatial batches allow both the view and shadow frusta to reject distant geometry.
  const cells = new Map();
  items.forEach((it, i) => {
    const f = fit(it, info.size, i);
    const key = `${Math.floor(f.x / 40)},${Math.floor(f.z / 40)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(f);
  });
  const meshes = [];
  for (const entries of cells.values()) {
    const batch = info.parts.map(part => {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, entries.length);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      return mesh;
    });
    entries.forEach((f, i) => {
      q.setFromAxisAngle(UP, f.rot ?? 0);
      const world = new THREE.Matrix4().compose(new THREE.Vector3(f.x, f.y ?? 0, f.z), q, new THREE.Vector3(f.sx, f.sy, f.sz)).multiply(toBase);
      info.parts.forEach((part, k) => batch[k].setMatrixAt(i, m.copy(world).multiply(part.matrix)));
    });
    for (const mesh of batch) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh); meshes.push(mesh);
    }
  }
  group.userData.meshes = meshes;
  return group;
}

function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

// Wind-swayed grass and leaves: sway grows with vertex height
function addWind(mat, uniforms, strength = 0.12, heightKey = 'position.y') {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
        {
          vec3 pzBase = vec3(0.0);
          #ifdef USE_INSTANCING
            pzBase = instanceMatrix[3].xyz;
          #endif
          float pzH = max(0.0, ${heightKey});
          float pzW = sin(uTime * 1.7 + pzBase.x * 0.35 + pzBase.z * 0.27) * 0.6 + sin(uTime * 3.1 + pzBase.x * 0.9) * 0.25;
          transformed.x += pzW * pzH * ${strength.toFixed(3)};
          transformed.z += pzW * pzH * ${(strength * 0.6).toFixed(3)};
        }`);
  };
  mat.customProgramCacheKey = () => `wind${strength}`;
}

// Final color grade: contrast, saturation, warm highlights, vignette, film grain, gas tint
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGas: { value: 0 },
    uDamage: { value: 0 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.012 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uGas; uniform float uDamage; uniform float uVignette; uniform float uGrain;
    varying vec2 vUv;
    float rnd(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 37.0) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      // very subtle chromatic aberration (edges only)
      float ca = 0.0015 * r2 * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + c * ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - c * ca).b;
      // contrast and saturation
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, 1.12);
      col = (col - 0.5) * 1.07 + 0.5;
      // warm highlights · cool shadows
      col += vec3(0.012, 0.006, -0.004) * smoothstep(0.5, 1.0, l);
      col += vec3(-0.01, 0.0, 0.015) * (1.0 - smoothstep(0.0, 0.35, l));
      // inside the gas: pulsing orange haze
      float pulse = 0.85 + 0.15 * sin(uTime * 5.0);
      col = mix(col, vec3(0.95, 0.45, 0.18) * (0.5 + l), uGas * 0.45 * pulse);
      // red edges when hit
      col = mix(col, vec3(0.55, 0.02, 0.02), uDamage * smoothstep(0.08, 0.35, r2));
      // vignette
      col *= 1.0 - uVignette * smoothstep(0.12, 0.6, r2);
      // grain
      col += (rnd(vUv * 900.0) - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

export class GameScene {
  constructor(container, map, quality = 'medium') {
    this.map = map;
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
    // Neutral tone mapping keeps the sky blue and saturated (ACES washes a bright sky to grey/purple)
    this.renderer.info.autoReset = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    if (ASSETS.sunDir) SUN_DIR.copy(ASSETS.sunDir);
    this.scene = new THREE.Scene();
    // Clear day: only light blue aerial perspective (distant hills stay crisp, like the references)
    this.scene.fog = new THREE.FogExp2(PALETTE.fog, 0.0019);
    this.baseFog = { color: new THREE.Color(PALETTE.fog), density: 0.0019 };
    this.windUniforms = { uTime: { value: 0 } };
    this.gas = 0;
    this.damage = 0;
    this.firstPerson = false;

    // Scene just for the first-person weapon (separate depth so it never clips through walls)
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(55, 1, 0.01, 10);

    this.buildSky();
    this.buildLights();

    this.occluders = []; // structures faded out in top-down view
    this.solidMeshes = []; // raycast targets for aim line and bullet holes (visual only)
    this.buildGround();
    this.buildRoads();
    this.buildObstacles();
    this.buildTrees();
    this.buildGrass();
    this.buildBorder();
    this.buildSkyline();
    this.buildZone();
    this.setQuality(quality);
    this.resize();
  }

  // ---------------- sky and lighting ----------------
  buildSky() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    if (ASSETS.hdr) {
      // Photoreal HDRI sky (Poly Haven, CC0): background + lighting (IBL) + reflections
      this.scene.background = ASSETS.hdr;
      this.scene.backgroundIntensity = 1.0;
      this.scene.backgroundBlurriness = 0;
      this.envMap = pmrem.fromEquirectangular(ASSETS.hdr).texture;
      this.sky = null;
    } else {
      const sky = new Sky();
      sky.scale.setScalar(1200);
      const u = sky.material.uniforms;
      u.turbidity.value = 4;
      u.rayleigh.value = 1.2;
      u.mieCoefficient.value = 0.004;
      u.mieDirectionalG.value = 0.8;
      u.sunPosition.value.copy(SUN_DIR);
      u.cloudCoverage.value = 0.42;
      u.cloudDensity.value = 0.55;
      u.cloudScale.value = 0.00025;
      u.cloudElevation.value = 0.45;
      this.sky = sky;
      this.scene.add(sky);
      const envScene = new THREE.Scene();
      const envSky = new Sky();
      envSky.scale.setScalar(100);
      for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) envSky.material.uniforms[k].value = u[k].value;
      envSky.material.uniforms.sunPosition.value.copy(SUN_DIR);
      envScene.add(envSky);
      this.envMap = pmrem.fromScene(envScene, 0.04).texture;
    }
    pmrem.dispose();
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.8;
    this.viewScene.environment = this.envMap;
    this.viewScene.environmentIntensity = 0.9;
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xcfd8e0, 0x6a5a3a, 0.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0dc, 2.2);
    this.sun.position.copy(SUN_DIR).multiplyScalar(90);
    const sc = this.sun.shadow.camera;
    sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60;
    sc.near = 5; sc.far = 220;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);

    // viewmodel lighting: same direction as the world sun + a soft rim light
    const vSun = new THREE.DirectionalLight(0xffe2b8, 2.2);
    vSun.position.copy(SUN_DIR);
    this.viewSun = vSun;
    this.viewHemi = new THREE.HemisphereLight(0xcfd8e0, 0x4a3f2a, 0.5);
    this.viewScene.add(vSun, this.viewHemi);
  }

  setQuality(name) {
    const q = QUALITY_PRESETS[name] ?? QUALITY_PRESETS.medium;
    this.quality = name;
    this.q = q;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(Math.min(dpr, q.pixelRatio));
    this.renderer.shadowMap.enabled = q.shadows;
    this.sun.castShadow = q.shadows;
    if (q.shadows) {
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
      this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    }
    if (this.grass) for (const g of this.grass) g.count = Math.floor(g.userData.max * (q.grass ?? 0.5));
    this.scene.traverse((o) => { if (o.material) { const mats = Array.isArray(o.material) ? o.material : [o.material]; mats.forEach((m) => { m.needsUpdate = true; }); } });
    this.disposeComposer();
    this.resize();
  }

  disposeComposer() {
    if (!this.composer) return;
    this.composer.dispose?.();
    this.composer.renderTarget1?.dispose();
    this.composer.renderTarget2?.dispose();
    for (const pass of this.composer.passes) pass.dispose?.();
    this.composer = null;
    this.aoPass = null;
  }

  buildComposer(camera) {
    const q = this.q;
    if (!q.post) return null;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.msaa ?? 4 });
    const composer = new EffectComposer(this.renderer, rt);
    this.worldPass = new RenderPass(this.scene, camera);
    composer.addPass(this.worldPass);
    if (q.ao) {
      const ao = new GTAOPass(this.scene, camera, size.x, size.y);
      ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.0, samples: 12 });
      ao.blendIntensity = 0.85;
      composer.addPass(ao);
      this.aoPass = ao;
    }
    const vp = new RenderPass(this.viewScene, this.viewCamera);
    vp.clear = false;
    vp.clearDepth = true;
    composer.addPass(vp);
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.28, 0.55, 0.92));
    composer.addPass(new OutputPass());
    this.gradePass = new ShaderPass(GradeShader);
    composer.addPass(this.gradePass);
    composer.setPixelRatio(this.renderer.getPixelRatio());
    composer.setSize(this.container.clientWidth || window.innerWidth, this.container.clientHeight || window.innerHeight);
    return composer;
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.aspect = w / h;
    this.viewCamera.aspect = this.aspect;
    this.viewCamera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  }

  // ---------------- terrain ----------------
  buildGround() {
    // The play area is flat (y=0); hills and rocky ridges rise outside it to form the horizon.
    const size = 1600;
    const seg = 220;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const rand = mulberry32(5);
    const offs = Array.from({ length: 6 }, () => [rand() * 100, rand() * 100]);
    const noise = (x, z) => {
      let s = 0;
      let a = 1;
      let f = 0.006;
      for (let i = 0; i < 5; i++) {
        s += (Math.sin(x * f + offs[i % 6][0]) * Math.cos(z * f * 1.13 + offs[i % 6][1])) * a;
        a *= 0.5;
        f *= 2.1;
      }
      return s;
    };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const edge = Math.max(Math.abs(x), Math.abs(z));
      const t = THREE.MathUtils.smoothstep(edge, WORLD_HALF + 10, WORLD_HALF + 240);
      // cliff look: terraced heights
      let hgt = t * (22 + (noise(x, z) * 0.5 + 0.5) * 80);
      const step = 7;
      hgt = THREE.MathUtils.lerp(hgt, Math.floor(hgt / step) * step + THREE.MathUtils.smoothstep(hgt % step, 0, step * 0.25) * step, 0.28 * t);
      if (edge > WORLD_HALF + 4) hgt += Math.max(0, noise(x * 3, z * 3)) * 2.5 * THREE.MathUtils.smoothstep(edge, WORLD_HALF + 4, WORLD_HALF + 30);
      pos.setY(i, hgt);
    }
    geo.computeVertexNormals();
    // steep slopes = rock (computed per vertex on the CPU)
    const nrm = geo.attributes.normal;
    const rock = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) rock[i] = Math.max(THREE.MathUtils.smoothstep(1 - nrm.getY(i), 0.04, 0.16), THREE.MathUtils.smoothstep(pos.getY(i), 3, 22) * 0.85);
    geo.setAttribute('rockAmt', new THREE.BufferAttribute(rock, 1));

    const grass = tex('sparse_grass');
    const dirt = tex('dirt_floor');
    const rockT = tex('rock_face_03');
    const mat = new THREE.MeshStandardMaterial({ map: grass.map, normalMap: grass.normalMap, roughnessMap: grass.roughnessMap, roughness: 1, envMapIntensity: 0.7 });
    const uniforms = { uDirt: { value: dirt.map }, uDirtN: { value: dirt.normalMap }, uRock: { value: rockT.map }, uRockN: { value: rockT.normalMap } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float rockAmt;\nvarying float vRock;\nvarying vec3 vPzW;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\n${WORLD_UV_CHUNK(1 / 4)}\nvRock = rockAmt;\nvPzW = (modelMatrix * vec4(position, 1.0)).xyz;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', /* glsl */`#include <common>
          uniform sampler2D uDirt; uniform sampler2D uDirtN; uniform sampler2D uRock; uniform sampler2D uRockN;
          varying float vRock; varying vec3 vPzW;
          float pzH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float pzN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(pzH(i), pzH(i + vec2(1, 0)), f.x), mix(pzH(i + vec2(0, 1)), pzH(i + vec2(1, 1)), f.x), f.y); }
          float pzF(vec2 p) { return pzN(p) * 0.55 + pzN(p * 2.3) * 0.3 + pzN(p * 5.1) * 0.15; }
          float pzDirt; float pzRock;`)
        .replace('#include <map_fragment>', /* glsl */`
          vec2 pzUvD = vPzW.xz / 5.0;
          vec2 pzUvR = vec2(vPzW.x + vPzW.z, vPzW.y) / 9.0;
          vec4 pzG = texture2D(map, vMapUv);
          vec4 pzD = texture2D(uDirt, pzUvD);
          vec4 pzR = texture2D(uRock, pzUvR);
          // dirt patches: low-frequency noise + dirt texture brightness for rough edges
          float pzM = pzF(vPzW.xz * 0.035) + (pzD.r - 0.45) * 0.5;
          pzDirt = smoothstep(0.48, 0.6, pzM);
          pzRock = smoothstep(0.25, 0.6, vRock + (pzR.r - 0.5) * 0.6);
          vec4 pzC = mix(pzG, pzD, pzDirt);
          pzC = mix(pzC, pzR * vec4(0.72, 0.75, 0.73, 1.0), pzRock);
          // broad color variation hides texture tiling
          pzC.rgb *= 0.85 + 0.3 * pzF(vPzW.xz * 0.008);
          diffuseColor *= pzC;`)
        .replace('#include <normal_fragment_maps>', /* glsl */`
          #ifdef USE_NORMALMAP_TANGENTSPACE
            vec3 pzNG = texture2D(normalMap, vNormalMapUv).xyz;
            vec3 pzND = texture2D(uDirtN, vPzW.xz / 5.0).xyz;
            vec3 pzNR = texture2D(uRockN, vec2(vPzW.x + vPzW.z, vPzW.y) / 9.0).xyz;
            vec3 mapN = mix(mix(pzNG, pzND, pzDirt), pzNR, pzRock) * 2.0 - 1.0;
            mapN.xy *= normalScale * (1.0 + pzRock);
            normal = normalize(tbn * mapN);
          #endif`);
    };
    mat.customProgramCacheKey = () => 'terrain-splat';
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.ground = ground;

    // central plaza: concrete
    const plaza = new THREE.Mesh(new THREE.PlaneGeometry(36, 36).rotateX(-Math.PI / 2), worldMat('concrete_wall_008', 1 / 3, { color: 0xd8d2c4 }));
    plaza.position.y = 0.02;
    plaza.receiveShadow = true;
    this.scene.add(plaza);
    const curb = [];
    for (const [x, z, w, d] of [[0, -18, 36.4, 0.4], [0, 18, 36.4, 0.4], [-18, 0, 0.4, 36.4], [18, 0, 0.4, 36.4]]) curb.push(box(w, 0.14, d, x, 0.07, z));
    const curbMesh = new THREE.Mesh(mergeGeometries(curb), worldMat('concrete_wall_008', 1 / 2));
    curbMesh.receiveShadow = true;
    this.scene.add(curbMesh);
  }

  buildRoads() {
    // main roads = asphalt, loop roads = dirt tracks with tire ruts
    const parts = { main: [], loop: [] };
    const curbs = [];
    for (const r of this.map.roads) {
      const w = r.maxX - r.minX;
      const d = r.maxZ - r.minZ;
      const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
      g.translate((r.minX + r.maxX) / 2, r.kind === 'main' ? 0.035 : 0.03, (r.minZ + r.maxZ) / 2);
      // normalize uv.x = across the road, uv.y = along it (for the dirt road shader)
      if (w > d) {
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) { const u = uv.getX(i); uv.setXY(i, uv.getY(i), u); }
      }
      parts[r.kind].push(g);
      if (r.kind !== 'main') continue;
      // curbs along the asphalt (except at the plaza)
      const horizontal = w > d;
      for (const side of [-1, 1]) {
        if (horizontal) {
          const z = side < 0 ? r.minZ - 0.15 : r.maxZ + 0.15;
          for (const [a, b] of [[r.minX, -18.5], [18.5, r.maxX]]) if (b > a) curbs.push(box(b - a, 0.12, 0.3, (a + b) / 2, 0.06, z));
        } else {
          const x = side < 0 ? r.minX - 0.15 : r.maxX + 0.15;
          for (const [a, b] of [[r.minZ, -18.5], [18.5, r.maxZ]]) if (b > a) curbs.push(box(0.3, 0.12, b - a, x, 0.06, (a + b) / 2));
        }
      }
    }
    const asphalt = new THREE.Mesh(mergeGeometries(parts.main), worldMat('asphalt_02', 1 / 3, { envMapIntensity: 0.5 }));
    asphalt.receiveShadow = true;
    this.scene.add(asphalt);
    // dirt road: alpha fade at the edges to blend into grass + two tire ruts
    const dirtMat = worldMat('dirt_floor', 1 / 4, { color: 0xe6d6bc, transparent: true, depthWrite: false });
    const prev = dirtMat.onBeforeCompile;
    dirtMat.onBeforeCompile = (sh) => {
      prev(sh);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vRoadUv;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvRoadUv = uv;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vRoadUv;')
        .replace('#include <alphamap_fragment>', /* glsl */`#include <alphamap_fragment>
          float pzAcross = abs(vRoadUv.x - 0.5) * 2.0;
          diffuseColor.a *= 1.0 - smoothstep(0.7, 1.0, pzAcross);
          float pzTrack = smoothstep(0.08, 0.0, abs(pzAcross - 0.45));
          diffuseColor.rgb *= 1.0 - pzTrack * 0.22;`);
    };
    dirtMat.customProgramCacheKey = () => 'dirt-road';
    const dirtRoads = new THREE.Mesh(mergeGeometries(parts.loop), dirtMat);
    dirtRoads.receiveShadow = true;
    dirtRoads.renderOrder = 1;
    this.scene.add(dirtRoads);
    const curbMesh = new THREE.Mesh(mergeGeometries(curbs), worldMat('concrete_wall_008', 1 / 2, { color: 0xcfcabb }));
    curbMesh.receiveShadow = true;
    curbMesh.castShadow = true;
    this.scene.add(curbMesh);

    // lane markings (center dashes)
    const dashes = [];
    for (const r of this.map.roads) {
      if (r.kind !== 'main') continue;
      const horizontal = r.maxX - r.minX > r.maxZ - r.minZ;
      const len = horizontal ? r.maxX - r.minX : r.maxZ - r.minZ;
      const cx = (r.minX + r.maxX) / 2;
      const cz = (r.minZ + r.maxZ) / 2;
      for (let s = -len / 2 + 2; s < len / 2; s += 6) {
        const x = horizontal ? cx + s : cx;
        const z = horizontal ? cz : cz + s;
        if (Math.abs(x) < 19 && Math.abs(z) < 19) continue;
        dashes.push({ x, z, rot: horizontal ? 0 : Math.PI / 2 });
      }
    }
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xe6dcb8, roughness: 0.7 });
    this.scene.add(instanced(new THREE.PlaneGeometry(2.6, 0.18).rotateX(-Math.PI / 2), lineMat, dashes, (d, i, p, q, s) => {
      p.set(d.x, 0.045, d.z); q.setFromAxisAngle(UP, d.rot); s.set(1, 1, 1);
    }, { shadow: false }));
  }

  // ---------------- structures ----------------
  buildObstacles() {
    const obs = this.map.obstacles;
    const homes=this.map.houses ?? [];
    const floor=instanced(new THREE.BoxGeometry(1,1,1),worldMat('wood_planks_grey',0.65,{color:0xc2b7a3,roughness:0.88}),homes,(h,i,p,q,s)=>{
      p.set((h.minX+h.maxX)/2,0.01,(h.minZ+h.maxZ)/2);q.identity();s.set(h.maxX-h.minX,0.08,h.maxZ-h.minZ);
    },{shadow:false});this.scene.add(floor);
    const roof=instanced(new THREE.BoxGeometry(1,1,1),worldMat('corrugated_iron_02',0.7,{color:0x959d9b,metalness:0.6,roughness:0.6}),homes,(h,i,p,q,s)=>{
      p.set((h.minX+h.maxX)/2,h.h+0.1,(h.minZ+h.maxZ)/2);q.identity();s.set(h.maxX-h.minX+0.4,0.2,h.maxZ-h.minZ+0.4);
    });this.scene.add(roof);this.solidMeshes.push(roof);
    const unit = new THREE.BoxGeometry(1, 1, 1);
    unit.translate(0, 0.5, 0);
    const details = { frames: [], glass: [], foundation: [] };
    const detailBox = (bucket,w,h,d,x,y,z) => {
      const g = new THREE.BoxGeometry(w,h,d);g.translate(x,y,z);details[bucket].push(g);
    };
    for (const h of this.map.houses ?? []) {
      const cx=(h.minX+h.maxX)/2, cz=(h.minZ+h.maxZ)/2;
      const w=h.maxX-h.minX,d=h.maxZ-h.minZ;
      // Recessed-looking opaque glazing, frame rails and sills on solid rear walls.
      for(const x of [cx-w*0.25,cx+w*0.25]) {
        const z=h.minZ-0.045;
        detailBox('glass',1.35,1.15,0.035,x,1.9,z);
        for(const dx of [-0.74,0,0.74]) detailBox('frames',0.07,1.3,0.1,x+dx,1.9,z-0.025);
        for(const y of [1.25,2.55]) detailBox('frames',1.55,0.09,0.16,x,y,z-0.04);
        detailBox('foundation',1.65,0.12,0.3,x,1.22,z-0.09);
      }
      // Door jambs retain the original 2.2m walkable opening.
      for(const dx of [-1.17,1.17]) detailBox('frames',0.1,3.35,0.16,cx+dx,1.67,h.maxZ+0.04);
      detailBox('frames',2.5,0.12,0.2,cx,3.33,h.maxZ+0.05);
      detailBox('foundation',w+0.1,0.25,0.12,cx,0.12,h.minZ-0.03);
      for(const x of [h.minX-0.03,h.maxX+0.03]) detailBox('foundation',0.12,0.25,d,x,0.12,cz);
      for(const z of [h.minZ-0.12,h.maxZ+0.12]) detailBox('frames',w+0.5,0.16,0.16,cx,h.h,z);
    }
    const detailMats={frames:worldMat('wood_planks_grey',1,{color:0x777c73}),glass:new THREE.MeshStandardMaterial({color:0x263d49,roughness:0.18,metalness:0.65}),foundation:worldMat('concrete_wall_008',0.5,{color:0x8b8780})};
    for(const [key,parts] of Object.entries(details)) if(parts.length){
      const mesh=new THREE.Mesh(mergeGeometries(parts),detailMats[key]);mesh.castShadow=key!=='glass';mesh.receiveShadow=true;this.scene.add(mesh);parts.forEach(g=>g.dispose());
    }
    const rand = mulberry32(321);
    const glassMatBase = { color: 0x1b2a33, metalness: 0.6, roughness: 0.06, envMapIntensity: 1.6 };
    const roofUnits = [];

    for (const o of obs) {
      if (o.kind !== 'building' && o.kind !== 'tower') continue;
      const w = o.maxX - o.minX;
      const d = o.maxZ - o.minZ;
      const cx = (o.minX + o.maxX) / 2;
      const cz = (o.minZ + o.maxZ) / 2;
      const tower = o.kind === 'tower';
      const style = tower ? 'concrete_wall_008' : ['plastered_wall_04', 'red_brick_03', 'plastered_wall_04', 'concrete_wall_008'][(o.tone ?? 0) + (o.h > 6 ? 1 : 0) * ((o.tone ?? 0) === 2 ? 1 : 0)];
      // grey, blue-grey and beige walls (village mood of the references)
      const tint = tower ? 0xbab4a6 : style === 'red_brick_03' ? 0xffffff : [0xffffff, 0xdce6f2, 0xfff0d6, 0xeeeeea][Math.floor(rand() * 4)];
      const gable = !tower && Math.min(w, d) <= 10.5 && o.h < 6.5;
      const body = new THREE.Mesh(unit, worldMat(style, style === 'red_brick_03' ? 1 / 2 : 1 / 3, { color: tint, transparent: false }));
      body.position.set(cx, 0, cz);
      body.scale.set(w, o.h, d);
      body.castShadow = true;
      body.receiveShadow = true;
      body.userData.fade = 1;
      body.userData.size = { w, h: o.h, d };
      this.scene.add(body);
      this.occluders.push(body);
      this.solidMeshes.push(body);

      // concrete details: plinth, floor bands, roof parapet, window and door frames
      const det = [];
      const glass = [];
      det.push(box(w + 0.12, 0.5, d + 0.12, cx, 0.25, cz)); // plinth
      det.push(box(w + 0.05, 0.12, d + 0.05, cx, o.h + 0.06, cz)); // roof slab
      if (!gable) {
        const pt = 0.22;
        const ph = 0.7;
        det.push(box(w + 0.3, ph, pt, cx, o.h + ph / 2, o.minZ - 0.04));
        det.push(box(w + 0.3, ph, pt, cx, o.h + ph / 2, o.maxZ + 0.04));
        det.push(box(pt, ph, d + 0.3, o.minX - 0.04, o.h + ph / 2, cz));
        det.push(box(pt, ph, d + 0.3, o.maxX + 0.04, o.h + ph / 2, cz));
      }
      const floorH = 3.0;
      const floors = Math.max(1, Math.floor(o.h / floorH));
      for (let f = 1; f < floors; f++) det.push(box(w + 0.16, 0.16, d + 0.16, cx, f * floorH, cz));
      const winY = (f) => f * floorH + 1.55;
      const addWin = (x, y, z, alongX) => {
        if (rand() < 0.08) return; // some stay blank wall
        const ww = 1.1;
        const wh = 1.25;
        if (alongX) {
          const s = z < cz ? -1 : 1;
          glass.push(box(ww, wh, 0.04, x, y, z + s * 0.02));
          det.push(box(ww + 0.22, 0.12, 0.22, x, y - wh / 2 - 0.06, z + s * 0.08)); // sill
          det.push(box(ww + 0.12, 0.08, 0.1, x, y + wh / 2 + 0.04, z + s * 0.04));
          det.push(box(0.08, wh, 0.1, x - ww / 2 - 0.04, y, z + s * 0.04));
          det.push(box(0.08, wh, 0.1, x + ww / 2 + 0.04, y, z + s * 0.04));
          det.push(box(0.05, wh, 0.06, x, y, z + s * 0.05)); // mullion
        } else {
          const s = x < cx ? -1 : 1;
          glass.push(box(0.04, wh, ww, x + s * 0.02, y, z));
          det.push(box(0.22, 0.12, ww + 0.22, x + s * 0.08, y - wh / 2 - 0.06, z));
          det.push(box(0.1, 0.08, ww + 0.12, x + s * 0.04, y + wh / 2 + 0.04, z));
          det.push(box(0.1, wh, 0.08, x + s * 0.04, y, z - ww / 2 - 0.04));
          det.push(box(0.1, wh, 0.08, x + s * 0.04, y, z + ww / 2 + 0.04));
          det.push(box(0.06, wh, 0.05, x + s * 0.05, y, z));
        }
      };
      for (let f = 0; f < floors; f++) {
        const y = winY(f);
        if (y + 0.8 > o.h) break;
        const nx = Math.floor((w - 1.2) / 2.4);
        for (let i = 0; i < nx; i++) {
          const x = cx - ((nx - 1) * 2.4) / 2 + i * 2.4;
          if (!tower && f === 0 && Math.abs(x - cx) < 1.4) continue; // front door spot
          addWin(x, y, o.minZ, true);
          addWin(x, y, o.maxZ, true);
        }
        const nz = Math.floor((d - 1.2) / 2.4);
        for (let i = 0; i < nz; i++) {
          const z = cz - ((nz - 1) * 2.4) / 2 + i * 2.4;
          addWin(o.minX, y, z, false);
          addWin(o.maxX, y, z, false);
        }
      }
      if (!tower) {
        // front door + awning
        det.push(box(1.6, 0.14, 0.12, cx, 2.35, o.maxZ + 0.06));
        det.push(box(0.14, 2.3, 0.12, cx - 0.8, 1.15, o.maxZ + 0.06));
        det.push(box(0.14, 2.3, 0.12, cx + 0.8, 1.15, o.maxZ + 0.06));
        det.push(box(2.4, 0.1, 1.1, cx, 2.75, o.maxZ + 0.55));
        glass.push(box(1.45, 2.2, 0.04, cx, 1.1, o.maxZ + 0.02));
        // rooftop units (flat roofs only)
        const n = gable ? 0 : 1 + Math.floor(rand() * 3);
        for (let i = 0; i < n; i++) {
          roofUnits.push({ x: cx + (rand() - 0.5) * (w - 2.5), z: cz + (rand() - 0.5) * (d - 2.5), y: o.h + 0.12, s: 0.8 + rand() * 0.7, r: Math.floor(rand() * 4) * Math.PI / 2 });
        }
      }
      const detMesh = new THREE.Mesh(mergeGeometries(det), worldMat('concrete_wall_008', 1 / 2.5, { color: 0xd0cabd, transparent: false }));
      detMesh.castShadow = true;
      detMesh.receiveShadow = true;
      this.scene.add(detMesh);
      const linked = [detMesh];
      if (glass.length) {
        const gm = new THREE.Mesh(mergeGeometries(glass), new THREE.MeshStandardMaterial({ ...glassMatBase }));
        this.scene.add(gm);
        linked.push(gm);
      }
      if (gable) {
        // gable roof: corrugated iron slopes (Poly Haven corrugated_iron_02) + gable ends in the wall material
        const alongX = w >= d;
        const span = (alongX ? d : w) + 0.7;
        const len = (alongX ? w : d) + 0.7;
        const rise = Math.min(span * 0.36, 2.6);
        const shape = new THREE.Shape();
        shape.moveTo(-span / 2, 0); shape.lineTo(span / 2, 0); shape.lineTo(0, rise); shape.closePath();
        const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
        roofGeo.translate(0, 0, -len / 2);
        if (alongX) roofGeo.rotateY(Math.PI / 2);
        roofGeo.translate(cx, o.h + 0.1, cz);
        const roofMat = worldMat('corrugated_iron_02', 1 / 2, { color: [0x8a8f94, 0x7d6a58, 0x6c7a74][Math.floor(rand() * 3)], metalness: 0.6, transparent: false });
        const capMat = worldMat(style, 1 / 3, { color: tint, transparent: false });
        const roof = new THREE.Mesh(roofGeo, [capMat, roofMat]);
        roof.castShadow = true;
        roof.receiveShadow = true;
        this.scene.add(roof);
        linked.push(roof);
      }
      body.userData.linked = linked;
    }

    // rooftop AC units (metal)
    const acGeo = mergeGeometries([box(1.2, 0.8, 0.9, 0, 0.4, 0), box(0.9, 0.06, 0.6, 0, 0.83, 0), box(0.12, 0.6, 0.12, 0.4, 1.1, 0.2)]);
    this.scene.add(instanced(acGeo, worldMat('metal', 1 / 1.5, { metalness: 0.7, color: 0xbfc4c0 }), roofUnits, (it, i, p, q, s) => {
      p.set(it.x, it.y, it.z); q.setFromAxisAngle(UP, it.r); s.setScalar(it.s);
    }));

    // tall walls (central L walls): concrete
    const walls = obs.filter((o) => o.kind === 'wall');
    const tall = walls.filter((o) => o.h >= 2);
    const houseFor = o => (this.map.houses ?? []).findIndex(h=>o.minX>=h.minX-0.01&&o.maxX<=h.maxX+0.01&&o.minZ>=h.minZ-0.01&&o.maxZ<=h.maxZ+0.01);
    for(let tone=0;tone<3;tone++){
      const subset=tall.filter(o=>houseFor(o)>=0&&houseFor(o)%3===tone);
      const material=worldMat(tone===1?'red_brick_03':'plastered_wall_04',tone===1?0.5:0.33,{color:[0xddd7c7,0xe2d6c7,0xb8c2c0][tone],roughness:0.88});
      const mesh=instanced(unit,material,subset,(o,i,p,q,s)=>{p.set((o.minX+o.maxX)/2,0,(o.minZ+o.maxZ)/2);q.identity();s.set(o.maxX-o.minX,o.h,o.maxZ-o.minZ);});
      this.scene.add(mesh);this.solidMeshes.push(mesh);
    }
    const exposed=tall.filter(o=>houseFor(o)<0);
    const wallMesh = instanced(unit, worldMat('concrete_wall_008', 1 / 2.5, { color: 0xd4cfc4 }), exposed, (o, i, p, q, s) => {
      p.set((o.minX + o.maxX) / 2, 0, (o.minZ + o.maxZ) / 2); q.identity(); s.set(o.maxX - o.minX, o.h, o.maxZ - o.minZ);
    });
    this.scene.add(wallMesh);
    this.solidMeshes.push(wallMesh);
    this.scene.add(instanced(unit, worldMat('concrete_wall_008', 1 / 2, { color: 0xa9a394 }), tall, (o, i, p, q, s) => {
      p.set((o.minX + o.maxX) / 2, o.h, (o.minZ + o.maxZ) / 2); q.identity(); s.set(o.maxX - o.minX + 0.12, 0.1, o.maxZ - o.minZ + 0.12);
    }));

    // low cover walls: staggered sandbags
    const bags = [];
    const br = mulberry32(55);
    for (const o of walls.filter((x) => x.h < 2)) {
      const alongX = o.maxX - o.minX >= o.maxZ - o.minZ;
      const len = alongX ? o.maxX - o.minX : o.maxZ - o.minZ;
      const thick = alongX ? o.maxZ - o.minZ : o.maxX - o.minX;
      const rows = Math.max(3, Math.round(o.h / 0.27));
      const bagL = 0.62;
      for (let r = 0; r < rows; r++) {
        const n = Math.floor(len / (bagL * 0.92));
        const off = (r % 2) * bagL * 0.46;
        for (let k = 0; k < n; k++) {
          const t = -len / 2 + bagL / 2 + k * (len - bagL) / Math.max(1, n - 1) + (k < n - 1 ? off : 0);
          for (const depth of thick > 0.6 ? [-0.18, 0.18] : [0]) {
            const cx = (o.minX + o.maxX) / 2;
            const cz = (o.minZ + o.maxZ) / 2;
            bags.push({
              x: alongX ? cx + t : cx + depth, z: alongX ? cz + depth : cz + t, y: 0.13 + r * (o.h - 0.1) / rows,
              rot: (alongX ? 0 : Math.PI / 2) + (br() - 0.5) * 0.12, c: br(), s: 0.92 + br() * 0.16,
            });
          }
        }
      }
    }
    const bagGeo = new RoundedBoxGeometry(0.62, 0.27, 0.36, 3, 0.12);
    {
      // bulging sack shape
      const p = bagGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        const z = p.getZ(i);
        const k = 1 - (x / 0.31) ** 2 * 0.25;
        p.setY(i, y * k);
        p.setZ(i, z * (0.9 + 0.1 * k));
      }
      bagGeo.computeVertexNormals();
    }
    const fabric = texSet('fabric', 3, 3);
    const bagMesh = instanced(bagGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, normalMap: fabric.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.95 }), bags, (b, i, p, q, s, c) => {
      p.set(b.x, b.y, b.z); q.setFromAxisAngle(UP, b.rot); s.set(b.s, 1, 1);
      c.set(b.c < 0.33 ? 0xb3a27e : b.c < 0.66 ? 0xa39572 : 0x9b9a78);
    }, { colors: true });
    this.scene.add(bagMesh);
    this.solidMeshes.push(bagMesh);

    // crates: stack the military crate model (Poly Haven) 2–4 high to fit the collision box
    const crates = obs.filter((o) => o.kind === 'crate');
    const stack = [];
    for (const o of crates) {
      const w = o.maxX - o.minX;
      const d = o.maxZ - o.minZ;
      const layers = Math.max(2, Math.round(o.h / 0.5));
      const r = mulberry32(o.id * 13 + 1);
      for (let l = 0; l < layers; l++) {
        stack.push({ x: (o.minX + o.maxX) / 2 + (r() - 0.5) * 0.08, z: (o.minZ + o.maxZ) / 2 + (r() - 0.5) * 0.08, y: (o.h / layers) * l, w, d, h: o.h / layers, rot: (l % 2) * Math.PI / 2 + (r() - 0.5) * 0.1 });
      }
    }
    const crateModel = instancedModel('wooden_military_crate', stack, (it, size) => {
      const swap = Math.abs(Math.sin(it.rot)) > 0.5;
      const w = swap ? it.d : it.w;
      const d = swap ? it.w : it.d;
      return { x: it.x, y: it.y, z: it.z, rot: it.rot, sx: w / size.x, sy: it.h / size.y, sz: d / size.z };
    });
    if (crateModel) {
      this.scene.add(crateModel);
      this.solidMeshes.push(...crateModel.userData.meshes);
    } else {
      const crateMesh = instanced(unit, worldMat('wood_planks_grey', 1 / 1.3), crates, (o, i, p, q, s) => {
        p.set((o.minX + o.maxX) / 2, 0, (o.minZ + o.maxZ) / 2); q.identity(); s.set(o.maxX - o.minX, o.h, o.maxZ - o.minZ);
      });
      this.scene.add(crateMesh);
      this.solidMeshes.push(crateMesh);
    }

    // rocks: scanned rock models (boulder_01 for large, rock_07 for small)
    const rocks = obs.filter((o) => o.kind === 'rock');
    const fitRock = (o, size) => {
      const r = mulberry32(o.seed ?? o.id);
      const rot = Math.floor(r() * 4) * Math.PI / 2;
      const swap = Math.abs(Math.sin(rot)) > 0.5;
      const w = (swap ? o.maxZ - o.minZ : o.maxX - o.minX) * 1.15;
      const d = (swap ? o.maxX - o.minX : o.maxZ - o.minZ) * 1.15;
      return { x: (o.minX + o.maxX) / 2, y: -0.15, z: (o.minZ + o.maxZ) / 2, rot, sx: w / size.x, sy: (o.h * 1.15) / size.y, sz: d / size.z };
    };
    const big = rocks.filter((o) => (o.maxX - o.minX) * (o.maxZ - o.minZ) > 7);
    const small = rocks.filter((o) => !big.includes(o));
    let rockDone = false;
    for (const [name, list] of [['boulder_01', big], ['rock_07', small]]) {
      const m = instancedModel(name, list, fitRock);
      if (m) { this.scene.add(m); this.solidMeshes.push(...m.userData.meshes); rockDone = true; }
    }
    if (!rockDone) {
      const rockGeo = new THREE.IcosahedronGeometry(0.62, 2);
      const rockMesh = instanced(rockGeo, worldMat('rock_face_03', 1 / 1.8), rocks, (o, i, p, q, s) => {
        p.set((o.minX + o.maxX) / 2, o.h * 0.36, (o.minZ + o.maxZ) / 2); q.identity(); s.set(o.maxX - o.minX, o.h * 1.15, o.maxZ - o.minZ);
      });
      this.scene.add(rockMesh);
      this.solidMeshes.push(rockMesh);
    }

    // abandoned cars (covered car, Poly Haven)
    const cars = obs.filter((o) => o.kind === 'car');
    const carModel = instancedModel('covered_car', cars, (o, size) => {
      const along = o.along === 'x';
      const len = along ? o.maxX - o.minX : o.maxZ - o.minZ;
      const k = len / size.z;
      return { x: (o.minX + o.maxX) / 2, y: 0, z: (o.minZ + o.maxZ) / 2, rot: (along ? Math.PI / 2 : 0) + (o.flip ? Math.PI : 0), sx: k, sy: (o.h / size.y), sz: k };
    });
    if (carModel) {
      this.scene.add(carModel);
      this.solidMeshes.push(...carModel.userData.meshes);
    } else {
      const carMesh = instanced(unit, worldMat('corrugated_iron_02', 1, { color: 0x556066 }), cars, (o, i, p, q, s) => {
        p.set((o.minX + o.maxX) / 2, 0, (o.minZ + o.maxZ) / 2); q.identity(); s.set(o.maxX - o.minX, o.h, o.maxZ - o.minZ);
      });
      this.scene.add(carMesh);
      this.solidMeshes.push(carMesh);
    }

    // decoration: barrels against building walls and shrubs (no collision)
    const pr = mulberry32(808);
    const barrels = [];
    for (const o of obs.filter((x) => x.kind === 'building')) {
      const n = Math.floor(pr() * 3);
      for (let i = 0; i < n; i++) {
        const side = Math.floor(pr() * 4);
        const t = pr() - 0.5;
        const x = side < 2 ? (o.minX + o.maxX) / 2 + t * (o.maxX - o.minX - 1) : side === 2 ? o.minX - 0.32 : o.maxX + 0.32;
        const z = side >= 2 ? (o.minZ + o.maxZ) / 2 + t * (o.maxZ - o.minZ - 1) : side === 0 ? o.minZ - 0.32 : o.maxZ + 0.32;
        barrels.push({ x, z, r: pr() * 6, c: pr() });
      }
    }
    const barrelModel = instancedModel('Barrel_01', barrels, (b) => ({ x: b.x, z: b.z, rot: b.r, sx: 1.05, sy: 1.05, sz: 1.05 }));
    if (barrelModel) this.scene.add(barrelModel);
  }

  buildTrees() {
    const trees = this.map.trees;
    const bark = tex('bark_brown_02');
    const trunk = new THREE.CylinderGeometry(0.16, 0.3, 1, 8, 1);
    trunk.translate(0, 0.5, 0);
    this.scene.add(instanced(trunk, worldMat('bark_brown_02', 1 / 1.2, { color: 0xd8ccbc }), trees, (t, i, p, q, s) => {
      p.set(t.x, 0, t.z); q.setFromAxisAngle(UP, i); s.set(1, t.height * 0.62, 1);
    }));

    // leaves: several deformed sphere clumps + alpha-tested leaf cards for volume
    // merge to indexed vertices so normals stay smooth after deforming (no faceted low-poly look)
    const blob = mergeVertices(new THREE.IcosahedronGeometry(1, 2).deleteAttribute('normal').deleteAttribute('uv'));
    {
      const p = blob.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        v.multiplyScalar(1 + Math.sin(v.x * 5.3 + v.y * 2.1) * Math.cos(v.z * 4.7) * 0.18 + Math.sin(v.y * 11.0) * 0.05);
        p.setXYZ(i, v.x, v.y, v.z);
      }
      blob.computeVertexNormals();
    }
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
    addWind(leafMat, this.windUniforms, 0.04);
    const crowns = [];
    const rand = mulberry32(77);
    const leafColors = [0x3f5a2a, 0x4a6530, 0x35502a, 0x56703a];
    trees.forEach((t, i) => {
      if (t.crown === 'cone') return;
      for (let k = 0; k < 5; k++) {
        const a = rand() * Math.PI * 2;
        const off = k === 0 ? 0 : t.crownSize * 0.55;
        crowns.push({ x: t.x + Math.cos(a) * off, y: t.height * 0.68 + (rand() - 0.3) * t.crownSize * 0.6, z: t.z + Math.sin(a) * off, sx: t.crownSize * (k === 0 ? 1 : 0.7), sy: t.crownSize * (k === 0 ? 0.85 : 0.6), c: leafColors[(i + k) % 4], r: rand() * 6 });
      }
    });
    // Layered tapered branches replace round crowns on conifers.
    // One instanced geometry keeps distant silhouettes inexpensive.
    const tiers = [];
    for (let k = 0; k < 7; k++) {
      const radius = 1 - k * 0.125;
      const tier = new THREE.ConeGeometry(radius, 0.3, 12, 2, true);
      const a = tier.attributes.position;
      for (let j = 0; j < a.count; j++) {
        const angle = Math.atan2(a.getZ(j), a.getX(j));
        const ragged = 1 + 0.13 * Math.sin(angle * 7 + k * 2.3);
        a.setXYZ(j, a.getX(j) * ragged, a.getY(j), a.getZ(j) * ragged);
      }
      tier.translate(0, 0.36 + k * 0.085, 0);
      tier.computeVertexNormals();
      tiers.push(tier);
    }
    const pineGeometry = mergeGeometries(tiers);
    tiers.forEach(g => g.dispose());
    const pineMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.95 });
    addWind(pineMaterial, this.windUniforms, 0.015);
    this.scene.add(instanced(pineGeometry, pineMaterial, trees.filter(t => t.crown === 'cone'), (t, i, p, q, s, col) => {
      p.set(t.x, 0, t.z); q.setFromAxisAngle(UP, i * 2.4); s.set(t.crownSize, t.height, t.crownSize);
      col.set([0x354b35, 0x405638, 0x4c6040][i % 3]);
    }, { colors: true }));
    this.scene.add(instanced(blob, leafMat, crowns, (c, i, p, q, s, col) => {
      p.set(c.x, c.y, c.z); q.setFromAxisAngle(UP, c.r); s.set(c.sx, c.sy, c.sx);
      col.set(c.c);
    }, { colors: true }));

    const cards = [];
    for (const c of crowns) {
      for (let k = 0; k < 3; k++) cards.push({ x: c.x, y: c.y, z: c.z, s: c.sx * 2.3, r: c.r + k * 1.05, t: (k - 1) * 0.5 });
    }
    // Broken branch silhouettes using the existing leaf-card batch (no extra draw call).
    for (const t of trees.filter(t => t.crown === 'cone')) {
      for (let layer = 0; layer < 6; layer++) for (let branch = 0; branch < 3; branch++) {
        const angle = branch * 2.094 + layer * 1.7;
        const reach = t.crownSize * (0.8 - layer * 0.1);
        cards.push({x:t.x + Math.cos(angle)*reach*0.7, y:t.height*(0.36+layer*0.085),
          z:t.z + Math.sin(angle)*reach*0.7, s:reach*1.5, r:angle, t:0.35});
      }
    }
    const cardMat = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, color: 0xd8e0c8 });
    addWind(cardMat, this.windUniforms, 0.05);
    this.scene.add(instanced(new THREE.PlaneGeometry(1, 1), cardMat, cards, (c, i, p, q, s) => {
      p.set(c.x, c.y, c.z); q.setFromEuler(new THREE.Euler(c.t, c.r, 0)); s.set(c.s, c.s, c.s);
    }));

    // shrubs (Poly Haven shrub_02): around tree bases and building corners
    const sr = mulberry32(4242);
    const shrubs = [];
    for (const t of trees) if (sr() < 0.35) shrubs.push({ x: t.x + (sr() - 0.5) * 2.5, z: t.z + (sr() - 0.5) * 2.5, s: 0.35 + sr() * 0.3, r: sr() * 6 });
    for (const o of this.map.obstacles.filter((x) => x.kind === 'building')) {
      if (sr() < 0.5) shrubs.push({ x: sr() < 0.5 ? o.minX - 0.6 : o.maxX + 0.6, z: sr() < 0.5 ? o.minZ - 0.6 : o.maxZ + 0.6, s: 0.3 + sr() * 0.25, r: sr() * 6 });
    }
    const shrubModel = instancedModel('shrub_02', shrubs, (b) => ({ x: b.x, z: b.z, y: 0, rot: b.r, sx: b.s, sy: b.s, sz: b.s }), { shadow: true });
    if (shrubModel) this.scene.add(shrubModel);
  }

  buildGrass() {
    // grass tufts: instanced clumps of 12 thin triangle blades, swayed by wind in the shader
    const blades = [];
    const r = mulberry32(17);
    for (let i = 0; i < 12; i++) {
      const a = r() * Math.PI * 2;
      const d = r() * 0.28;
      const h = 0.22 + r() * 0.32;
      const w = 0.016 + r() * 0.014;
      const lean = (r() - 0.5) * 0.25;
      const bx = Math.cos(a) * d;
      const bz = Math.sin(a) * d;
      const g = new THREE.BufferGeometry();
      const ca = Math.cos(a + Math.PI / 2) * w;
      const sa = Math.sin(a + Math.PI / 2) * w;
      g.setAttribute('position', new THREE.Float32BufferAttribute([bx - ca, 0, bz - sa, bx + ca, 0, bz + sa, bx + Math.cos(a) * lean, h, bz + Math.sin(a) * lean], 3));
      const nx = Math.cos(a + Math.PI / 2) * 0.7;
      const nz = Math.sin(a + Math.PI / 2) * 0.7;
      g.setAttribute('normal', new THREE.Float32BufferAttribute([nx, 0.7, nz, nx, 0.7, nz, nx * 0.5, 0.85, nz * 0.5], 3));
      const dark = [0.12, 0.13, 0.05];
      const tip = [0.4, 0.38, 0.18];
      g.setAttribute('color', new THREE.Float32BufferAttribute([...dark, ...dark, ...tip], 3));
      blades.push(g);
    }
    const clump = mergeGeometries(blades);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 });
    addWind(mat, this.windUniforms, 0.18);

    const blocked = (x, z) => this.map.roads.some((rd) => x > rd.minX - 0.3 && x < rd.maxX + 0.3 && z > rd.minZ - 0.3 && z < rd.maxZ + 0.3)
      || (Math.abs(x) < 18.5 && Math.abs(z) < 18.5)
      || this.map.obstacles.some((o) => o.kind !== 'tree' && x > o.minX - 0.2 && x < o.maxX + 0.2 && z > o.minZ - 0.2 && z < o.maxZ + 0.2);
    const rand = mulberry32(7);
    const tufts = [];
    const max = 26000;
    for (let i = 0; i < max * 2 && tufts.length < max; i++) {
      const x = (rand() * 2 - 1) * (WORLD_HALF + 20);
      const z = (rand() * 2 - 1) * (WORLD_HALF + 20);
      // cluster into patches: skip spots where the low-frequency noise is low
      const patch = Math.sin(x * 0.11) * Math.cos(z * 0.09) + Math.sin((x - z) * 0.05);
      if (patch < -0.6 && rand() < 0.8) continue;
      if (!blocked(x, z)) tufts.push({ x, z, s: 0.7 + rand() * 0.8, r: rand() * 6, c: rand() });
    }
    // shuffle so lowering the count for quality settings keeps an even spread
    for (let i = tufts.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [tufts[i], tufts[j]] = [tufts[j], tufts[i]]; }
    const mesh = instanced(clump, mat, tufts, (t, i, p, q, s, c) => {
      p.set(t.x, 0, t.z); q.setFromAxisAngle(UP, t.r); s.set(t.s, t.s * (0.8 + t.c * 0.5), t.s);
      c.setRGB(0.85 + t.c * 0.25, 0.9 + t.c * 0.15, 0.8);
    }, { shadow: false, colors: true });
    mesh.userData.max = tufts.length;
    mesh.frustumCulled = false;
    this.grass = [mesh];
    this.scene.add(mesh);
  }

  buildBorder() {
    // boundary: concrete Jersey barriers + wire fence posts
    const barriers = [];
    const step = 3.2;
    for (let s = -WORLD_HALF; s <= WORLD_HALF; s += step) {
      barriers.push({ x: s, z: -WORLD_HALF - 0.8, r: 0 }, { x: s, z: WORLD_HALF + 0.8, r: 0 }, { x: -WORLD_HALF - 0.8, z: s, r: Math.PI / 2 }, { x: WORLD_HALF + 0.8, z: s, r: Math.PI / 2 });
    }
    const shape = new THREE.Shape();
    shape.moveTo(-0.35, 0); shape.lineTo(0.35, 0); shape.lineTo(0.18, 0.3); shape.lineTo(0.1, 0.85); shape.lineTo(-0.1, 0.85); shape.lineTo(-0.18, 0.3); shape.closePath();
    const bGeo = new THREE.ExtrudeGeometry(shape, { depth: 3.0, bevelEnabled: false });
    bGeo.translate(0, 0, -1.5);
    bGeo.rotateY(Math.PI / 2);
    this.scene.add(instanced(bGeo, worldMat('concrete_wall_008', 1 / 2, { color: 0xd4cec0 }), barriers, (it, i, p, q, s) => {
      p.set(it.x, 0, it.z); q.setFromAxisAngle(UP, it.r); s.set(1, 1, 1);
    }));
    const posts = [];
    for (let s = -WORLD_HALF; s <= WORLD_HALF; s += 6.4) {
      posts.push({ x: s, z: -WORLD_HALF - 1.8 }, { x: s, z: WORLD_HALF + 1.8 }, { x: -WORLD_HALF - 1.8, z: s }, { x: WORLD_HALF + 1.8, z: s });
    }
    const metal = worldMat('metal', 1, { metalness: 0.8, color: 0x8a8a84 });
    this.scene.add(instanced(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6).translate(0, 1.2, 0), metal, posts, (it, i, p, q, s) => {
      p.set(it.x, 0, it.z); q.identity(); s.set(1, 1, 1);
    }, { shadow: false }));
    const wireMat = new THREE.MeshStandardMaterial({ color: 0x6d6d68, metalness: 0.8, roughness: 0.5 });
    for (const y of [0.8, 1.4, 2.0, 2.35]) {
      for (const [x, z, w, d] of [[0, -WORLD_HALF - 1.8, WORLD_HALF * 2, 0.02], [0, WORLD_HALF + 1.8, WORLD_HALF * 2, 0.02], [-WORLD_HALF - 1.8, 0, 0.02, WORLD_HALF * 2], [WORLD_HALF + 1.8, 0, 0.02, WORLD_HALF * 2]]) {
        const wire = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), wireMat);
        wire.position.set(x, y, z);
        this.scene.add(wire);
      }
    }
  }

  // distant buildings and power poles outside the boundary: silhouette and depth (no collision)
  buildSkyline() {
    const rand = mulberry32(909);
    const blocks = [];
    for (let i = 0; i < 140; i++) {
      const a = rand() * Math.PI * 2;
      const d = WORLD_HALF + 35 + rand() * 170;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const edge = Math.max(Math.abs(x), Math.abs(z));
      if (edge < WORLD_HALF + 25) continue;
      const big = rand() < 0.2;
      blocks.push({ x, z, w: 6 + rand() * 12, d: 6 + rand() * 12, h: big ? 14 + rand() * 30 : 4 + rand() * 9, r: rand() * Math.PI, c: rand() });
    }
    const groundAt = (x, z) => {
      // roughly match the buildGround hill height and sink a little into the ground
      const edge = Math.max(Math.abs(x), Math.abs(z));
      return THREE.MathUtils.smoothstep(edge, WORLD_HALF + 12, WORLD_HALF + 260) * 18 - 2;
    };
    void blocks; // distant building boxes looked flat, so they were removed (hills and trees form the horizon)

    // line of power poles
    const poles = [];
    for (let s = -WORLD_HALF - 120; s <= WORLD_HALF + 120; s += 28) poles.push({ x: s, z: -WORLD_HALF - 14 }, { x: WORLD_HALF + 14, z: s });
    const pole = mergeGeometries([new THREE.CylinderGeometry(0.12, 0.16, 9, 6).translate(0, 4.5, 0), box(2.2, 0.12, 0.12, 0, 8.4, 0)]);
    this.scene.add(instanced(pole, new THREE.MeshStandardMaterial({ color: 0x5a4a38, roughness: 0.9 }), poles, (it, i, p, q, s) => {
      p.set(it.x, groundAt(it.x, it.z) + 2, it.z); q.setFromAxisAngle(UP, it.z === -WORLD_HALF - 14 ? 0 : Math.PI / 2); s.set(1, 1, 1);
    }, { shadow: false }));
  }

  // ---------------- zone (gas) ----------------
  buildZone() {
    this.zoneUniforms = {
      uCenter: { value: new THREE.Vector2(0, 0) },
      uRadius: { value: 135 },
      uTime: { value: 0 },
      uColor: { value: PALETTE.zone.clone() },
    };
    const toxicMat = new THREE.ShaderMaterial({
      uniforms: this.zoneUniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */`
        varying vec2 vXZ;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vXZ = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */`
        uniform vec2 uCenter; uniform float uRadius; uniform float uTime; uniform vec3 uColor;
        varying vec2 vXZ;
        void main() {
          float d = distance(vXZ, uCenter);
          if (d < uRadius) discard;
          float edge = smoothstep(uRadius + 8.0, uRadius, d);
          float n = 0.5 + 0.5 * sin(vXZ.x * 0.21 + uTime * 0.7) * sin(vXZ.y * 0.17 - uTime * 0.5);
          gl_FragColor = vec4(uColor * (0.7 + 0.3 * n), 0.18 + 0.1 * n + edge * 0.2);
        }`,
    });
    const toxic = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2), toxicMat);
    toxic.position.y = 0.1;
    toxic.renderOrder = 2;
    this.scene.add(toxic);

    // huge gas wall: flowing noise, fading toward the top
    const wallMat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.zoneUniforms.uTime, uColor: this.zoneUniforms.uColor },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        varying vec2 vUv; varying vec3 vW;
        void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */`
        uniform float uTime; uniform vec3 uColor; varying vec2 vUv; varying vec3 vW;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += n(p) * a; p *= 2.1; a *= 0.5; } return s; }
        void main() {
          vec2 p = vec2(vUv.x * 220.0, vUv.y * 9.0 - uTime * 0.25);
          float f = fbm(p + vec2(uTime * 0.15, 0.0));
          float top = 1.0 - smoothstep(0.05, 0.75, vUv.y);
          float bottom = smoothstep(0.0, 0.02, vUv.y);
          float a = (0.18 + f * 0.42) * top * top * bottom;
          vec3 col = mix(uColor * 0.75, vec3(1.0, 0.72, 0.45), f * 0.6);
          // denser when closer (based on camera distance)
          float d = length(vW.xz - cameraPosition.xz);
          // faint from afar (so the sky doesn't turn red), a thick gas wall up close
          a *= mix(1.0, 0.1, smoothstep(20.0, 120.0, d));
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.zoneWall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 70, 256, 1, true).translate(0, 35, 0), wallMat);
    this.zoneWall.renderOrder = 3;
    this.zoneWall.frustumCulled = false;
    this.scene.add(this.zoneWall);

    // next safe zone line: shader plane drawing a white band of fixed world width on the ground
    this.nextUniforms = { uNext: { value: new THREE.Vector3(0, 0, 0) }, uTime: this.zoneUniforms.uTime };
    this.nextRing = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      uniforms: this.nextUniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */`
        varying vec2 vXZ;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vXZ = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */`
        uniform vec3 uNext; uniform float uTime; varying vec2 vXZ;
        void main() {
          float d = abs(distance(vXZ, uNext.xy) - uNext.z);
          float w = fwidth(d) * 1.5 + 0.35;
          float a = 1.0 - smoothstep(0.0, w, d);
          if (a < 0.01) discard;
          gl_FragColor = vec4(1.0, 1.0, 1.0, a * (0.65 + 0.2 * sin(uTime * 3.0)));
        }`,
    }));
    this.nextRing.position.y = 0.12;
    this.nextRing.renderOrder = 4;
    this.scene.add(this.nextRing);
  }

  updateZone(z, time) {
    if (!z) return;
    this.zoneUniforms.uCenter.value.set(z.cx, z.cz);
    this.zoneUniforms.uRadius.value = Math.max(0.01, z.r);
    this.zoneUniforms.uTime.value = time;
    this.windUniforms.uTime.value = time;
    if (this.sky) this.sky.material.uniforms.time.value = time;
    this.zoneWall.position.set(z.cx, 0, z.cz);
    this.zoneWall.scale.set(Math.max(0.01, z.r), 1, Math.max(0.01, z.r));
    this.zoneWall.visible = z.r > 0.05;
    const showNext = z.nr < z.r - 0.5 && z.nr > 0;
    this.nextRing.visible = showNext;
    if (showNext) this.nextUniforms.uNext.value.set(z.nx, z.nz, z.nr);
    this.time = time;
  }

  // feed whether the camera is in the gas (0–1) and hit intensity into post-processing and fog
  setExposure(gas, damage) {
    this.gas += (gas - this.gas) * 0.1;
    this.damage = damage;
    const fog = this.scene.fog;
    fog.color.copy(this.baseFog.color).lerp(PALETTE.zone, this.gas * 0.7);
    fog.density = this.baseFog.density + this.gas * 0.035;
  }

  // The viewmodel lives in camera space, so rotate sun, sky light and reflections with the camera
  syncViewCamera(camera) {
    const inv = camera.quaternion.clone().invert();
    this.viewSun.position.copy(SUN_DIR).applyQuaternion(inv);
    this.viewHemi.position.set(0, 1, 0).applyQuaternion(inv);
    this.viewScene.environmentRotation.setFromQuaternion(camera.quaternion);
    // darken the viewmodel in shade (including gas)
    this.viewSun.intensity = 2.2 * (1 - this.gas * 0.5);
  }

  setFirstPerson(v) {
    if (v === this.firstPerson) return;
    this.firstPerson = v;
    if (v) for (const m of this.occluders) this.applyFade(m, 1);
  }

  // keep the shadow camera around the player (shadow resolution independent of map size)
  followSun(x, z) {
    const texel = 120 / (this.q?.shadowMapSize || 1024);
    const sx = Math.round(x / texel) * texel;
    const sz = Math.round(z / texel) * texel;
    this.sun.position.set(sx + SUN_DIR.x * 100, SUN_DIR.y * 100, sz + SUN_DIR.z * 100);
    this.sun.target.position.set(sx, 0, sz);
  }

  applyFade(m, next) {
    m.userData.fade = next;
    const transparent = next < 0.99;
    for (const mesh of [m, ...(m.userData.linked ?? [])]) {
      mesh.material.opacity = next;
      if (mesh.material.transparent !== transparent) { mesh.material.transparent = transparent; mesh.material.needsUpdate = true; }
      mesh.material.depthWrite = !transparent;
    }
  }

  // top-down only: make large structures between camera and character translucent
  updateOcclusion(camera, target, dt, raycaster) {
    if (this.firstPerson) return;
    const dir = new THREE.Vector3().subVectors(target, camera.position);
    const dist = dir.length();
    dir.normalize();
    raycaster.set(camera.position, dir);
    raycaster.far = dist - 0.5;
    const hits = new Set(raycaster.intersectObjects(this.occluders, false).map((h) => h.object));
    for (const m of this.occluders) {
      const sz = m.userData.size;
      const near = Math.abs(m.position.x - target.x) < sz.w / 2 + 2 && m.position.z - sz.d / 2 > target.z - 0.5 && m.position.z - sz.d / 2 < target.z + sz.h * 0.9;
      const want = hits.has(m) || near ? 0.25 : 1;
      const cur = m.userData.fade;
      const next = cur + (want - cur) * Math.min(1, dt * 10);
      if (Math.abs(next - cur) < 0.001 && cur === want) continue;
      this.applyFade(m, next);
    }
  }

  adaptResolution(dt, time) {
    if (document.hidden || dt <= 0 || dt >= 0.1) return;
    this.frameEMA = (this.frameEMA ?? dt) * 0.96 + dt * 0.04;
    if (this.nextResolutionAt === undefined) { this.nextResolutionAt = time + 8; return; }
    if (time < this.nextResolutionAt) return;
    this.nextResolutionAt = time + 3;
    const cap = Math.min(window.devicePixelRatio || 1, this.q.pixelRatio);
    const ratio = this.renderer.getPixelRatio();
    const next = this.frameEMA > 0.023 ? Math.max(Math.min(cap, 0.65), ratio - 0.1)
      : this.frameEMA < 0.0175 ? Math.min(cap, ratio + 0.05) : ratio;
    if (Math.abs(next - ratio) < 0.01) return;
    this.renderer.setPixelRatio(next);
    this.resize();
  }

  render(camera) {
    this.renderer.info.reset();
    if (this.sky) this.sky.position.copy(camera.position);
    if (this.q.post) {
      if (!this.composer) this.composer = this.buildComposer(camera);
      this.worldPass.camera = camera;
      if (this.aoPass) this.aoPass.camera = camera;
      this.gradePass.uniforms.uTime.value = performance.now() / 1000;
      this.gradePass.uniforms.uGas.value = this.gas;
      this.gradePass.uniforms.uDamage.value = this.damage;
      this.composer.render();
    } else {
      this.renderer.autoClear = false;
      this.renderer.clear();
      this.renderer.render(this.scene, camera);
      this.renderer.clearDepth();
      this.renderer.render(this.viewScene, this.viewCamera);
      this.renderer.autoClear = true;
    }
  }
}
