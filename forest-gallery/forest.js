// forest.js — a small walkable forest that shows the paintings from paintings.yml
// ─────────────────────────────────────────────────────────────────────────────
// Everything (trees, ground, light) is generated in code — no 3D model files.
// The only dependency is three.js, vendored in vendor/three/.
//
// Things you might want to tweak are collected in CONFIG right below.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "./vendor/three/three.module.min.js";

const CONFIG = {
  seed: 20261025,          // change to get a different (but stable) forest layout
  spacing: 7.5,            // metres of trail between two paintings
  eyeHeight: 1.62,
  walkSpeed: 2.4,          // m/s  (Shift = faster)
  maxTexture: 1024,        // px — paintings are downscaled to this for the GPU
  autumn: 0.28,            // share of deciduous trees in autumn colours (0 … 1)
  colors: {
    zenith:  "#9cc6dc",
    horizon: "#efdcb4",    // also the fog colour
    sun:     "#ffd49a",
    hemiSky: "#d7e9f5",
    hemiGround: "#8f8c55",
    grass:   ["#6f9845", "#7ea64c", "#5f8a3d", "#8aae55"],
    moss:    "#58803a",
    path:    "#b89c6e",
    trunk:   "#6b4a33",
    pine:    ["#3e6d41", "#4b7c46", "#37623c"],
    leaf:    ["#5d8f3b", "#6e9e43", "#4f7f36"],
    autumn:  ["#d9873a", "#e2ad3e", "#c8662f"],
    birch:   ["#93b04a", "#b5bd4a", "#e0b84a"],
    wood:    "#7a5638",
    plaque:  "#efe6d2",
  },
};

const root = document.getElementById("forest-root");
const paintings = (window.__paintings || []).slice();
const IMG_DIR = "images/paintings/";
const isTouch = matchMedia("(pointer: coarse)").matches;

// ── Small helpers ────────────────────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(CONFIG.seed);
const R = (a, b) => a + (b - a) * rand();
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function groundHeight(x, z) {
  return (noise(x * 0.055, z * 0.055) - 0.5) * 2.4 + (noise(x * 0.2 + 9, z * 0.2) - 0.5) * 0.35;
}
function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Low-poly look: nudge vertices by a hash of their position (so shared corners
// stay together), give every triangle its own slightly varied colour.
function wobble(geo, amt) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const kx = Math.round(x * 1000) / 1000, ky = Math.round(y * 1000) / 1000, kz = Math.round(z * 1000) / 1000;
    p.setXYZ(i,
      x + (hash(kx * 3.1 + ky, kz * 1.7) - 0.5) * amt,
      y + (hash(ky * 2.3 + kz, kx * 4.1) - 0.5) * amt,
      z + (hash(kz * 5.7 + kx, ky * 2.9) - 0.5) * amt);
  }
  return geo;
}
function paint(geo, color, jitter = 0.06) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  const base = new THREE.Color(color), c = new THREE.Color();
  for (let i = 0; i < n; i += 3) {
    c.copy(base).offsetHSL((rand() - 0.5) * 0.02, 0, (rand() - 0.5) * jitter);
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.deleteAttribute("uv");
  return geo;
}
function merge(geos) {
  let n = 0;
  geos.forEach((g) => (n += g.attributes.position.count));
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  geos.forEach((g) => {
    pos.set(g.attributes.position.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}

// ── Renderer, scene, camera ──────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false; // the forest doesn't move, so render shadows once
root.prepend(renderer.domElement);

const scene = new THREE.Scene();
const C = CONFIG.colors;
scene.fog = new THREE.FogExp2(C.horizon, 0.028);

const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 500);
camera.rotation.order = "YXZ";

// Sky dome: soft gradient with a warm glow around the sun
const sunDir = new THREE.Vector3(-0.55, 0.36, -0.75).normalize();
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(300, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      zenith: { value: new THREE.Color(C.zenith) },
      horizon: { value: new THREE.Color(C.horizon) },
      sunCol: { value: new THREE.Color("#fff3d6") },
      sunDir: { value: sunDir },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position);
      vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform vec3 zenith, horizon, sunCol, sunDir; varying vec3 vDir;
      void main(){ float h = max(vDir.y, 0.0);
        vec3 col = mix(horizon, zenith, pow(smoothstep(0.0, 0.7, h), 0.8));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        col += sunCol * (pow(s, 12.0) * 0.45 + pow(s, 300.0) * 0.8);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
);
sky.frustumCulled = false;
scene.add(sky);

// Light: low, golden afternoon sun + sky/ground bounce
scene.add(new THREE.HemisphereLight(C.hemiSky, C.hemiGround, 1.65));
const sun = new THREE.DirectionalLight(C.sun, 2.5);
scene.add(sun, sun.target);

// ── Layout: a winding loop trail with the paintings scattered along it ──────
const N = Math.max(paintings.length, 1);
const trailR = Math.max(9, (N * CONFIG.spacing) / (Math.PI * 2));
const walkR = trailR * 1.32 + 5;
const worldR = walkR + 20;
const ph1 = R(0, 6.28), ph2 = R(0, 6.28);

const trail = [];
const TRAIL_SAMPLES = 240;
for (let i = 0; i < TRAIL_SAMPLES; i++) {
  const t = (i / TRAIL_SAMPLES) * Math.PI * 2;
  const r = trailR * (1 + 0.17 * Math.sin(3 * t + ph1) + 0.09 * Math.sin(5 * t + ph2));
  trail.push(new THREE.Vector2(Math.cos(t) * r, Math.sin(t) * r));
}
function nearestOnTrail(x, z) {
  let best = 1e9, idx = 0;
  for (let i = 0; i < TRAIL_SAMPLES; i++) {
    const a = trail[i], b = trail[(i + 1) % TRAIL_SAMPLES];
    const abx = b.x - a.x, abz = b.y - a.y;
    let t = ((x - a.x) * abx + (z - a.y) * abz) / (abx * abx + abz * abz);
    t = Math.max(0, Math.min(1, t));
    const dx = a.x + abx * t - x, dz = a.y + abz * t - z;
    const d = dx * dx + dz * dz;
    if (d < best) { best = d; idx = i; }
  }
  return { d: Math.sqrt(best), idx };
}

// Paintings: evenly-ish along the trail, random side, random distance & angle
const spots = paintings.map((p, i) => {
  const idx = Math.floor(((i + 0.5 + R(-0.25, 0.25)) / N) * TRAIL_SAMPLES) % TRAIL_SAMPLES;
  const a = trail[idx], b = trail[(idx + 1) % TRAIL_SAMPLES];
  const tx = b.x - a.x, tz = b.y - a.y, tl = Math.hypot(tx, tz);
  const side = rand() < 0.5 ? -1 : 1;
  const off = R(2.6, 3.8);
  const x = a.x + (-tz / tl) * off * side, z = a.y + (tx / tl) * off * side;
  // face the trail, slightly turned in the walking direction
  const rot = Math.atan2(a.x - x, a.y - z) + R(-0.35, 0.35);
  return { x, z, rot, idx, p, i };
});

// ── Ground ───────────────────────────────────────────────────────────────────
{
  const size = worldR * 2 + 40, seg = isTouch ? 110 : 150;
  let geo = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, groundHeight(pos.getX(i), pos.getZ(i)));
  geo = geo.toNonIndexed();
  const p = geo.attributes.position, n = p.count;
  const col = new Float32Array(n * 3), c = new THREE.Color();
  const grass = C.grass.map((g) => new THREE.Color(g)), moss = new THREE.Color(C.moss), dirt = new THREE.Color(C.path);
  for (let i = 0; i < n; i += 3) {
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
    const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    const nz = noise(cx * 0.15, cz * 0.15);
    c.copy(grass[Math.floor(hash(cx, cz) * grass.length)]).lerp(moss, Math.max(0, nz - 0.45) * 1.4);
    const rr = Math.hypot(cx, cz);
    if (rr > trailR * 0.6 && rr < trailR * 1.45) {
      const d = nearestOnTrail(cx, cz).d;
      const w = 1 - THREE.MathUtils.smoothstep(d, 0.55, 1.15 + noise(cx, cz) * 0.4);
      c.lerp(dirt, w * 0.92);
    }
    c.offsetHSL(0, 0, (hash(cz, cx) - 0.5) * 0.04);
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  ground.receiveShadow = true;
  ground.name = "ground";
  scene.add(ground);
  var groundMesh = ground;
}

// ── Wind: gentle sway for foliage (shader patch) ─────────────────────────────
const windUniform = { value: 0 };
function windy(mat, start = 1.4, amt = 0.022) {
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = windUniform;
    s.vertexShader = "uniform float uTime;\n" + s.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
       float ph = 0.0;
       #ifdef USE_INSTANCING
         ph = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.23;
       #endif
       float sw = max(0.0, position.y - ${start.toFixed(2)}) * ${amt.toFixed(3)};
       transformed.x += sin(uTime * 1.2 + ph) * sw;
       transformed.z += cos(uTime * 0.9 + ph * 1.7) * sw * 0.7;`
    );
  };
  return mat;
}

// ── Tree & plant geometry (generated) ────────────────────────────────────────
function makePine(tiers) {
  const parts = [], h = 8;
  const th = h * 0.3;
  parts.push(paint(new THREE.CylinderGeometry(0.11, 0.22, th + 1, 6).translate(0, (th + 1) / 2 - 0.3, 0), C.trunk));
  let y = th * 0.75, r = 1.9;
  const green = pick(C.pine);
  for (let i = 0; i < tiers; i++) {
    const ch = 3.0 - i * 0.25;
    parts.push(paint(wobble(new THREE.ConeGeometry(r, ch, 7, 1).translate(0, y + ch / 2, 0), 0.25), green, 0.09));
    y += ch * 0.52; r *= 0.74;
  }
  return merge(parts);
}
function makeRound(colors) {
  const parts = [];
  parts.push(paint(new THREE.CylinderGeometry(0.13, 0.24, 4.2, 6).translate(0, 1.8, 0), C.trunk));
  parts.push(paint(new THREE.CylinderGeometry(0.05, 0.08, 1.4, 5).rotateZ(0.8).translate(0.55, 3.0, 0), C.trunk));
  const leaf = pick(colors);
  const blobs = [[0, 4.6, 0, 1.9], [1.1, 4.0, 0.4, 1.3], [-0.9, 4.1, -0.5, 1.35], [0.2, 5.6, -0.2, 1.2]];
  blobs.forEach(([x, y, z, r]) =>
    parts.push(paint(wobble(new THREE.IcosahedronGeometry(r, 1), 0.35).translate(x, y, z), leaf, 0.1)));
  return merge(parts);
}
function makeBirch(colors) {
  const parts = [];
  const trunk = paint(new THREE.CylinderGeometry(0.07, 0.12, 6, 5, 6).translate(0, 2.8, 0), "#e9e5da", 0.04);
  const tc = trunk.attributes.color; // a few dark bark marks
  for (let i = 0; i < tc.count; i += 3) if (rand() < 0.18) for (let k = 0; k < 3; k++) tc.setXYZ(i + k, 0.13, 0.12, 0.11);
  parts.push(trunk);
  const leaf = pick(colors);
  [[0, 5.4, 0, 1.1], [0.5, 4.5, 0.3, 0.8], [-0.4, 4.7, -0.3, 0.85], [0.1, 6.2, 0.1, 0.7]].forEach(([x, y, z, r]) =>
    parts.push(paint(wobble(new THREE.IcosahedronGeometry(r, 1), 0.25).translate(x, y, z), leaf, 0.1)));
  return merge(parts);
}
function makeBush() {
  const g = pick(C.leaf);
  return merge([
    paint(wobble(new THREE.IcosahedronGeometry(0.75, 1), 0.25).scale(1, 0.75, 1).translate(0, 0.4, 0), g, 0.1),
    paint(wobble(new THREE.IcosahedronGeometry(0.5, 1), 0.2).scale(1, 0.8, 1).translate(0.55, 0.3, 0.2), g, 0.1),
  ]);
}
function makeMushroom() {
  return merge([
    paint(new THREE.CylinderGeometry(0.035, 0.05, 0.16, 6).translate(0, 0.08, 0), "#efe7d4", 0.03),
    paint(new THREE.SphereGeometry(0.12, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1).translate(0, 0.15, 0), "#c9412e", 0.05),
  ]);
}
function makeRock() {
  return merge([paint(wobble(new THREE.DodecahedronGeometry(0.5, 0), 0.2).scale(1, 0.6, 0.8), "#8d9183", 0.08)]);
}
function makeTuft() {
  const geo = new THREE.BufferGeometry(), pos = [], col = [];
  const dark = new THREE.Color("#4d7a32"), light = new THREE.Color("#9fbf5c");
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + rand(), w = 0.035, h = R(0.22, 0.42), lean = R(0.05, 0.16);
    const cx = Math.cos(a), cz = Math.sin(a);
    pos.push(-cz * w, 0, cx * w, cz * w, 0, -cx * w, cx * lean, h, cz * lean);
    col.push(dark.r, dark.g, dark.b, dark.r, dark.g, dark.b, light.r, light.g, light.b);
  }
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

// ── Place things ─────────────────────────────────────────────────────────────
const obstacles = []; // circles {x, z, r} the visitor can't walk through
const placed = [];    // for spacing checks
function freeAt(x, z, minTree) {
  for (const s of spots) {
    if (Math.hypot(x - s.x, z - s.z) < 3.2) return false;
    const vx = s.x + Math.sin(s.rot) * 2.6, vz = s.z + Math.cos(s.rot) * 2.6;
    if (Math.hypot(x - vx, z - vz) < 1.8) return false;
  }
  for (const t of placed) if (Math.hypot(x - t.x, z - t.z) < minTree) return false;
  return true;
}

const variants = {
  pine: [makePine(3), makePine(4), makePine(4)],
  round: [makeRound(C.leaf), makeRound(C.leaf), makeRound(C.autumn), makeRound(C.autumn)],
  birch: [makeBirch(C.birch), makeBirch(C.birch)],
  bush: [makeBush(), makeBush()],
};
const instances = new Map(); // geometry -> list of matrices
function addInstance(geo, x, z, s, sink = 0.05) {
  if (!instances.has(geo)) instances.set(geo, []);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, groundHeight(x, z) - sink, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(R(-0.04, 0.04), R(0, 6.28), R(-0.04, 0.04))),
    new THREE.Vector3(s, s * R(0.9, 1.15), s)
  );
  instances.get(geo).push(m);
}

const maxTrees = isTouch ? 320 : 420;
for (let attempt = 0; attempt < 9000 && placed.length < maxTrees; attempt++) {
  const a = R(0, Math.PI * 2), r = Math.sqrt(rand()) * worldR;
  const x = Math.cos(a) * r, z = Math.sin(a) * r;
  const inner = r < walkR;
  if (inner && rand() > 0.42) continue;                // more open inside the walkable area
  if (nearestOnTrail(x, z).d < 2.3) continue;           // keep the trail clear
  if (Math.hypot(x - trail[0].x, z - trail[0].y) < 6.5) continue;   // open view at the start
  if (!freeAt(x, z, inner ? 3.0 : 2.3)) continue;

  const roll = rand();
  let kind;
  if (!inner) kind = roll < 0.62 ? "pine" : roll < 0.85 ? "round" : "birch";
  else kind = roll < 0.3 ? "pine" : roll < 0.62 ? "round" : roll < 0.8 ? "birch" : "bush";
  let geo = pick(variants[kind]);
  if (kind === "round") geo = rand() < CONFIG.autumn ? pick(variants.round.slice(2)) : pick(variants.round.slice(0, 2));
  const s = kind === "bush" ? R(0.7, 1.3) : R(0.75, 1.35);
  addInstance(geo, x, z, s, kind === "bush" ? 0.15 : 0.05);
  placed.push({ x, z });
  if (r < walkR + 3) obstacles.push({ x, z, r: kind === "bush" ? 0.75 * s : 0.3 * s + 0.05 });

  // little things around tree bases
  if (kind !== "bush" && rand() < 0.22) {
    const k = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < k; i++) addInstance("mushroom", x + R(-1, 1), z + R(-1, 1), R(0.6, 1.4), 0.02);
  }
}
for (let i = 0; i < 45; i++) {
  const a = R(0, 6.28), r = Math.sqrt(rand()) * (walkR + 8), x = Math.cos(a) * r, z = Math.sin(a) * r;
  if (nearestOnTrail(x, z).d < 1.4 || !freeAt(x, z, 1.2)) continue;
  const s = R(0.5, 1.6);
  addInstance("rock", x, z, s, 0.12 * s);
  if (r < walkR + 2 && s > 1) obstacles.push({ x, z, r: 0.45 * s });
}
const tuftCount = isTouch ? 1800 : 3200;
for (let i = 0; i < tuftCount; i++) {
  const a = R(0, 6.28), r = Math.sqrt(rand()) * (walkR + 10), x = Math.cos(a) * r, z = Math.sin(a) * r;
  if (r > trailR * 0.6 && r < trailR * 1.45 && nearestOnTrail(x, z).d < 0.9) continue;
  addInstance("tuft", x, z, R(0.7, 1.5), 0);
}
for (let i = 0; i < 380; i++) {
  const a = R(0, 6.28), r = Math.sqrt(rand()) * (walkR + 4), x = Math.cos(a) * r, z = Math.sin(a) * r;
  if (r > trailR * 0.6 && r < trailR * 1.45 && nearestOnTrail(x, z).d < 0.8) continue;
  addInstance("flower", x, z, R(0.7, 1.3), 0);
}

const baseGeos = {
  mushroom: makeMushroom(),
  rock: makeRock(),
  tuft: makeTuft(),
  flower: merge([
    paint(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 3).translate(0, 0.11, 0), "#4f7a32", 0),
    paint(new THREE.IcosahedronGeometry(0.045, 0).translate(0, 0.23, 0), "#ffffff", 0),
  ]),
};
const flowerTints = ["#fff7e8", "#f4d34f", "#c9a6e8", "#f2a3b3", "#fff7e8"];
const treeMat = windy(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
const tuftMat = windy(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 0.05, 0.25);
const staticMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

const tint = new THREE.Color();
for (const [key, mats] of instances) {
  const geo = typeof key === "string" ? baseGeos[key] : key;
  const isTree = typeof key !== "string";
  const mat = isTree ? treeMat : key === "tuft" || key === "flower" ? tuftMat : staticMat;
  const mesh = new THREE.InstancedMesh(geo, mat, mats.length);
  mats.forEach((m, i) => {
    mesh.setMatrixAt(i, m);
    if (key === "flower") tint.set(pick(flowerTints));
    else tint.setHSL(0, 0, R(0.88, 1.08));
    mesh.setColorAt(i, tint);
  });
  mesh.castShadow = isTree || key === "rock";
  mesh.receiveShadow = key !== "tuft" && key !== "flower";
  scene.add(mesh);
}

// A couple of fallen logs to sit next to
for (let i = 0, tries = 0; i < 3 && tries < 200; tries++) {
  const a = R(0, 6.28), r = R(trailR * 0.3, walkR - 2), x = Math.cos(a) * r, z = Math.sin(a) * r;
  if (nearestOnTrail(x, z).d < 3.2 || !freeAt(x, z, 3)) continue;
  const len = R(2.6, 4), rot = R(0, 3.14);
  const log = new THREE.Mesh(
    merge([paint(wobble(new THREE.CylinderGeometry(0.26, 0.3, len, 8, 3), 0.06).rotateZ(Math.PI / 2), "#6e5139", 0.08)]),
    staticMat
  );
  log.position.set(x, groundHeight(x, z) + 0.18, z);
  log.rotation.y = rot;
  log.castShadow = log.receiveShadow = true;
  scene.add(log);
  for (let k = -1; k <= 1; k++)
    obstacles.push({ x: x + Math.cos(rot) * k * len * 0.35, z: z - Math.sin(rot) * k * len * 0.35, r: 0.45 });
  placed.push({ x, z });
  i++;
}

// ── Paintings ────────────────────────────────────────────────────────────────
const clickables = [];
const woodMat = new THREE.MeshLambertMaterial({ color: C.wood });
const loader = new THREE.ImageLoader();
const maxAniso = renderer.capabilities.getMaxAnisotropy();

function parseSize(format) {
  const nums = String(format || "").match(/\d+(\.\d+)?/g);
  if (!nums || nums.length < 2) return null;
  return Math.max(...nums.slice(0, 2).map(Number)) / 100; // metres, long side
}

function makePlaque(text, sub) {
  const cv = document.createElement("canvas");
  cv.width = 512; cv.height = 128;
  const g = cv.getContext("2d");
  g.fillStyle = C.plaque; g.fillRect(0, 0, 512, 128);
  g.fillStyle = "#3b3128"; g.textAlign = "center";
  g.font = '500 44px "DM Sans", system-ui, sans-serif';
  let t = text;
  while (g.measureText(t).width > 470 && t.length > 4) t = t.slice(0, -2);
  if (t !== text) t = t.trimEnd() + "…";
  g.fillText(t, 256, 62);
  g.font = '300 28px "DM Sans", system-ui, sans-serif';
  g.fillStyle = "#7a6a58";
  g.fillText(sub, 256, 104);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

function buildPainting(s, img) {
  const p = s.p;
  const aspect = img ? img.width / img.height : 0.7;
  const long = THREE.MathUtils.clamp(parseSize(p.format) || 1.3, 0.8, 1.8);
  const W = aspect >= 1 ? long : long * aspect;
  const H = aspect >= 1 ? long / aspect : long;
  const bottom = 0.72;

  const group = new THREE.Group();
  const y0 = groundHeight(s.x, s.z);
  group.position.set(s.x, y0, s.z);
  group.rotation.y = s.rot;

  // artwork texture, downscaled so 16+ paintings stay light on the GPU
  const cv = document.createElement("canvas");
  const k = Math.min(1, CONFIG.maxTexture / Math.max(img.width, img.height));
  cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
  cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;

  const art = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.22 })
  );
  art.position.set(0, bottom + H / 2, 0.031);
  art.receiveShadow = true;

  const board = new THREE.Mesh(new THREE.BoxGeometry(W + 0.07, H + 0.07, 0.06), woodMat);
  board.position.set(0, bottom + H / 2, 0);
  board.castShadow = board.receiveShadow = true;

  const postH = bottom + H * 0.8 + 0.5;
  [-1, 1].forEach((side) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, postH, 0.08), woodMat);
    post.position.set(side * (W / 2 - Math.min(0.15, W * 0.15)), postH / 2 - 0.5, -0.07);
    post.castShadow = true;
    group.add(post);
  });

  const sub = [p.year, p.medium && p.medium.split(" on ")[0]].filter(Boolean).join(" · ");
  const plaque = new THREE.Mesh(
    new THREE.PlaneGeometry(0.46, 0.115),
    new THREE.MeshLambertMaterial({ map: makePlaque(p.title || p.file, sub) })
  );
  plaque.position.set(0, bottom - 0.16, 0.045);
  const plaqueBack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.03), woodMat);
  plaqueBack.position.set(0, bottom - 0.16, 0.02);
  const plaquePost = new THREE.Mesh(new THREE.BoxGeometry(0.05, bottom, 0.05), woodMat);
  plaquePost.position.set(0, bottom / 2 - 0.2, 0.0);

  group.add(board, art, plaqueBack, plaque, plaquePost);
  [art, board].forEach((m) => { m.userData.painting = s.i; clickables.push(m); });
  scene.add(group);

  group.updateMatrixWorld(true);
  s.center = group.localToWorld(new THREE.Vector3(0, bottom + H / 2, 0));
  s.H = H; s.W = W;
  s.viewDist = Math.max(2.3, Math.max(H, W) * 1.45);
  // obstacles along the board so you can't walk through it
  for (let t = -1; t <= 1; t++)
    obstacles.push({ x: s.x + Math.cos(s.rot) * t * W * 0.4, z: s.z - Math.sin(s.rot) * t * W * 0.4, r: 0.32 });
  renderer.shadowMap.needsUpdate = true;
}

const fontsReady = document.fonts ? document.fonts.load('500 44px "DM Sans"').catch(() => {}) : Promise.resolve();
spots.forEach((s) => {
  s.center = new THREE.Vector3(s.x, groundHeight(s.x, s.z) + 1.4, s.z);
  s.viewDist = 2.6;
  loader.load(IMG_DIR + s.p.file, (img) => fontsReady.then(() => buildPainting(s, img)));
});

// ── Floating light motes in the sun ──────────────────────────────────────────
const MOTES = 260;
const moteBase = new Float32Array(MOTES * 3), motePos = new Float32Array(MOTES * 3);
for (let i = 0; i < MOTES; i++) {
  const a = R(0, 6.28), r = Math.sqrt(rand()) * walkR;
  moteBase.set([Math.cos(a) * r, R(0.4, 4.5), Math.sin(a) * r], i * 3);
}
const moteGeo = new THREE.BufferGeometry();
moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
const moteTex = (() => {
  const cv = document.createElement("canvas"); cv.width = cv.height = 64;
  const g = cv.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,248,220,1)"); gr.addColorStop(0.3, "rgba(255,236,180,0.5)"); gr.addColorStop(1, "rgba(255,230,170,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
})();
const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({
  size: 0.12, map: moteTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: "#fff0c0", opacity: 0.8,
}));
motes.frustumCulled = false;
scene.add(motes);

// Shadow camera covers the whole walkable area
sun.position.copy(sunDir).multiplyScalar(80);
sun.castShadow = true;
sun.shadow.mapSize.set(isTouch ? 1536 : 2048, isTouch ? 1536 : 2048);
const sc = sun.shadow.camera;
sc.left = sc.bottom = -(walkR + 8);
sc.right = sc.top = walkR + 8;
sc.near = 1; sc.far = 220;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.04;
renderer.shadowMap.needsUpdate = true;

// ── Visitor: walking, looking, clicking ──────────────────────────────────────
const player = { x: trail[0].x, z: trail[0].y, yaw: 0, pitch: -0.04, y: 0, bob: 0 };
{
  const a = trail[0], b = trail[6];
  player.yaw = Math.atan2(-(b.x - a.x), -(b.y - a.y)); // look along the trail
  player.y = groundHeight(player.x, player.z) + CONFIG.eyeHeight;
}

// Deep link: forest.html#<image file> starts in front of that painting
{
  const want = decodeURIComponent(location.hash.slice(1)).toLowerCase();
  const s = want && spots.find((s) => s.p.file.toLowerCase() === want);
  if (s) {
    player.x = s.x + Math.sin(s.rot) * 2.6; player.z = s.z + Math.cos(s.rot) * 2.6;
    player.yaw = s.rot; player.pitch = -0.02;
    player.y = groundHeight(player.x, player.z) + CONFIG.eyeHeight;
  }
}

const keys = new Set();
let route = [];        // auto-walk waypoints [{x,z}]
let finalLook = null;  // {yaw, pitch} to turn to on arrival
let onArrive = null;
let lastProgress = { t: 0, d: 0 };

function lightboxOpen() { return document.body.classList.contains("glightbox-open"); }

addEventListener("keydown", (e) => {
  if (lightboxOpen() || e.target.closest("input, textarea")) return;
  const k = e.key.toLowerCase();
  if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"].includes(k)) {
    keys.add(k);
    if (k !== "shift") { route = []; finalLook = null; onArrive = null; }
    if (k.startsWith("arrow")) e.preventDefault();
    hideHint();
  }
  if (k === "n" || k === "]") goToNeighbour(1);
  if (k === "p" || k === "[") goToNeighbour(-1);
  if ((k === "enter" || k === " ") && focused >= 0) { openPainting(focused); e.preventDefault(); }
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
addEventListener("blur", () => keys.clear());

const canvas = renderer.domElement;
canvas.style.touchAction = "none";
let drag = null;
const raycaster = new THREE.Raycaster();
const clock = { last: performance.now() / 1000, elapsedTime: 0 };
const ndc = new THREE.Vector2();

function hit(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects([...clickables, groundMesh], false);
  return hits[0] || null;
}

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
});
canvas.addEventListener("pointermove", (e) => {
  if (drag && drag.id === e.pointerId) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = e.clientX; drag.y = e.clientY;
    const sens = e.pointerType === "touch" ? 0.0055 : 0.0035;
    player.yaw += dx * sens;
    player.pitch = THREE.MathUtils.clamp(player.pitch + dy * sens, -1.1, 1.0);
    finalLook = null;
    if (drag.moved > 8) hideHint();
  } else if (e.pointerType === "mouse") {
    const h = hit(e.clientX, e.clientY);
    canvas.style.cursor = h && h.object.userData.painting !== undefined ? "pointer" : "grab";
  }
});
canvas.addEventListener("pointerup", (e) => {
  if (!drag) return;
  const wasClick = drag.moved < 8;
  drag = null;
  if (!wasClick) return;
  hideHint();
  const h = hit(e.clientX, e.clientY);
  if (!h) return;
  if (h.object.userData.painting !== undefined) {
    const i = h.object.userData.painting;
    if (isInFrontOf(i)) openPainting(i);
    else goToPainting(i);
  } else if (h.distance < 40) {
    walkTo([{ x: h.point.x, z: h.point.z }]);
  }
});
canvas.addEventListener("pointercancel", () => (drag = null));

function walkTo(points, look = null, arrive = null) {
  route = points; finalLook = look; onArrive = arrive;
  lastProgress = { t: clock.elapsedTime, d: Infinity };
}
function viewSpot(s) {
  return { x: s.x + Math.sin(s.rot) * s.viewDist, z: s.z + Math.cos(s.rot) * s.viewDist };
}
function isInFrontOf(i) {
  const s = spots[i], v = viewSpot(s);
  return Math.hypot(player.x - v.x, player.z - v.z) < 1.2;
}
function goToPainting(i) {
  const s = spots[i], v = viewSpot(s);
  const look = {
    yaw: s.rot,
    pitch: Math.atan2(s.center.y - (groundHeight(v.x, v.z) + CONFIG.eyeHeight), s.viewDist),
  };
  const points = [];
  if (Math.hypot(player.x - v.x, player.z - v.z) > 5) {
    // follow the trail, the short way round
    let from = nearestOnTrail(player.x, player.z).idx, to = s.idx;
    let fwd = (to - from + TRAIL_SAMPLES) % TRAIL_SAMPLES;
    const step = fwd <= TRAIL_SAMPLES / 2 ? 4 : -4;
    let steps = Math.floor((step > 0 ? fwd : TRAIL_SAMPLES - fwd) / 4);
    for (let k = 0; k <= steps; k++) {
      const t = trail[(from + k * step + TRAIL_SAMPLES * 4) % TRAIL_SAMPLES];
      points.push({ x: t.x, z: t.y });
    }
  }
  points.push(v);
  walkTo(points, look);
  current = i;
}
let current = -1;
function goToNeighbour(dir) {
  if (!spots.length) return;
  const order = spots.slice().sort((a, b) => a.idx - b.idx).map((s) => s.i);
  let pos;
  if (current >= 0) pos = order.indexOf(current);
  else {
    const here = nearestOnTrail(player.x, player.z).idx;
    pos = order.findIndex((i) => spots[i].idx > here);
    if (pos < 0) pos = 0;
    if (dir > 0) pos -= 1;
  }
  goToPainting(order[(pos + dir + order.length) % order.length]);
  hideHint();
}

// Lightbox (GLightbox is already loaded by the site for the grid gallery)
let lightbox = null;
function openPainting(i) {
  if (typeof GLightbox === "undefined") { window.open(IMG_DIR + paintings[i].file, "_blank"); return; }
  if (!lightbox) {
    lightbox = GLightbox({
      elements: paintings.map((p) => ({
        href: IMG_DIR + p.file, type: "image", title: p.title,
        description: [p.year, p.medium, p.format].filter(Boolean).join(" · "),
      })),
      loop: true, touchNavigation: true,
    });
  }
  keys.clear();
  lightbox.openAt(i);
}

function collide() {
  const pr = 0.35;
  for (const o of obstacles) {
    const dx = player.x - o.x, dz = player.z - o.z, d = Math.hypot(dx, dz), m = o.r + pr;
    if (d < m && d > 1e-4) { player.x = o.x + (dx / d) * m; player.z = o.z + (dz / d) * m; }
  }
  const r = Math.hypot(player.x, player.z);
  if (r > walkR) { player.x *= walkR / r; player.z *= walkR / r; }
}

// ── UI ───────────────────────────────────────────────────────────────────────
const ui = {
  caption: root.querySelector(".forest-caption"),
  title: root.querySelector(".forest-caption-title"),
  desc: root.querySelector(".forest-caption-desc"),
  hint: root.querySelector(".forest-hint"),
  loading: root.querySelector(".forest-loading"),
};
if (ui.hint) ui.hint.innerHTML = isTouch
  ? "Drag to look around · tap the ground to walk · tap a painting to visit it"
  : "Drag to look around · click the ground or use <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to walk · click a painting to visit it";
let hintHidden = false;
function hideHint() {
  if (hintHidden || !ui.hint) return;
  hintHidden = true;
  setTimeout(() => ui.hint.classList.add("is-hidden"), 2500);
}
root.querySelector(".forest-prev")?.addEventListener("click", () => goToNeighbour(-1));
root.querySelector(".forest-next")?.addEventListener("click", () => goToNeighbour(1));
ui.caption?.addEventListener("click", () => focused >= 0 && openPainting(focused));

let focused = -1;
function updateCaption() {
  let best = -1, bestD = 1e9;
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  spots.forEach((s, i) => {
    const dx = s.x - player.x, dz = s.z - player.z, d = Math.hypot(dx, dz);
    if (d > 6) return;
    if ((dx * fx + dz * fz) / d < 0.75) return;
    if (d < bestD) { bestD = d; best = i; }
  });
  if (best !== focused) {
    focused = best;
    if (best >= 0) {
      const p = paintings[best];
      ui.title.textContent = p.title || p.file;
      ui.desc.textContent = [p.year, p.medium, p.format].filter(Boolean).join(" · ");
      ui.caption.classList.add("is-visible");
    } else ui.caption.classList.remove("is-visible");
  }
}

function resize() {
  const header = document.getElementById("quarto-header");
  if (header) root.style.top = Math.max(0, header.getBoundingClientRect().bottom) + "px";
  const w = root.clientWidth, h = root.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 72 : 62;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(root);
addEventListener("resize", resize);
resize();

// ── Loop ─────────────────────────────────────────────────────────────────────
function frame(now) {
  now /= 1000;
  const dt = Math.min(now - clock.last, 0.05), t = (clock.elapsedTime += dt);
  clock.last = now;
  windUniform.value = t;

  let mx = 0, mz = 0;
  const speed = CONFIG.walkSpeed * (keys.has("shift") ? 1.8 : 1);
  if (keys.has("w") || keys.has("arrowup")) mz -= 1;
  if (keys.has("s") || keys.has("arrowdown")) mz += 1;
  if (keys.has("a")) mx -= 1;
  if (keys.has("d")) mx += 1;
  if (keys.has("arrowleft")) player.yaw += 1.8 * dt;
  if (keys.has("arrowright")) player.yaw -= 1.8 * dt;

  let moving = false;
  if (mx || mz) {
    const l = Math.hypot(mx, mz), sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
    player.x += ((mx * cy + mz * sy) / l) * speed * dt;
    player.z += ((-mx * sy + mz * cy) / l) * speed * dt;
    moving = true;
  } else if (route.length) {
    const w = route[0], dx = w.x - player.x, dz = w.z - player.z, d = Math.hypot(dx, dz);
    const last = route.length === 1;
    if (d < (last ? 0.08 : 0.9)) {
      route.shift();
      lastProgress = { t, d: Infinity };
      if (!route.length && onArrive) onArrive();
    } else {
      const v = Math.min(d, speed * 1.15 * dt);
      player.x += (dx / d) * v; player.z += (dz / d) * v;
      moving = true;
      // look where we're going, unless it's the final approach to a painting
      if (!(last && finalLook) && !drag) {
        const want = Math.atan2(-dx, -dz);
        player.yaw += angleDiff(player.yaw, want) * Math.min(1, dt * 3);
        player.pitch += (-0.05 - player.pitch) * Math.min(1, dt * 2);
      }
      // give up if something (a tree) blocks the way for a while
      if (d < lastProgress.d - 0.25) lastProgress = { t, d };
      else if (t - lastProgress.t > 1.2) { route = []; finalLook = null; }
    }
  }
  if (finalLook && !drag && (!route.length || route.length === 1)) {
    player.yaw += angleDiff(player.yaw, finalLook.yaw) * Math.min(1, dt * 3);
    player.pitch += (finalLook.pitch - player.pitch) * Math.min(1, dt * 3);
    if (!route.length && Math.abs(angleDiff(player.yaw, finalLook.yaw)) < 0.01) finalLook = null;
  }
  if (mx || mz) current = -1;

  collide();
  if (moving) player.bob += dt * 7.5;
  const targetY = groundHeight(player.x, player.z) + CONFIG.eyeHeight + (moving ? Math.sin(player.bob) * 0.025 : 0);
  player.y += (targetY - player.y) * Math.min(1, dt * 10);

  camera.position.set(player.x, player.y, player.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  sky.position.copy(camera.position);

  for (let i = 0; i < MOTES; i++) {
    const o = i * 3, ph = i * 1.37;
    motePos[o] = moteBase[o] + Math.sin(t * 0.21 + ph) * 0.9;
    motePos[o + 1] = moteBase[o + 1] + Math.sin(t * 0.33 + ph * 2.1) * 0.35;
    motePos[o + 2] = moteBase[o + 2] + Math.cos(t * 0.17 + ph) * 0.9;
  }
  moteGeo.attributes.position.needsUpdate = true;

  updateCaption();
  renderer.render(scene, camera);
  if (ui.loading && !ui.loading.classList.contains("is-hidden")) ui.loading.classList.add("is-hidden");
}
renderer.setAnimationLoop(frame);
