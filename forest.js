// forest.js — a deep, dark forest you can walk through to see the paintings
// ─────────────────────────────────────────────────────────────────────────────
// Everything (trees, ground, light) is generated in code — no 3D model files.
// The only dependency is three.js, vendored in vendor/three/.
//
// The mood: dusk under a closed canopy. Light only falls through a few gaps,
// and most of those gaps are right above a painting.
// Things you might want to tweak are collected in CONFIG right below.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "./vendor/three/three.module.min.js";

const isTouch = matchMedia("(pointer: coarse)").matches;
const CONFIG = {
  seed: 20261025,          // change to get a different (but stable) forest layout
  spacing: 8,              // metres of trail between two paintings
  eyeHeight: 1.62,
  walkSpeed: 2.2,          // m/s  (Shift = faster)
  maxTexture: 1024,        // px — paintings are downscaled to this for the GPU
  fogDensity: 0.062,       // higher = darker, closer forest
  ambient: 0.75,           // brightness between the light shafts
  shaftLight: 70,          // brightness of the light falling on a painting
  litPaintings: isTouch ? 3 : 4, // nearby paintings that get a real light at once
  extraShafts: 7,          // gaps in the canopy that don't hold a painting
  canopyY: 15,             // height of the canopy (metres)
  colors: {
    fog:     "#0f1b1b",
    skyHole: "#2e403d",    // what you see through the gaps in the canopy
    canopy:  "#070c0b",
    hemiSky: "#5b7479",
    hemiGround: "#1a1f13",
    beam:    "#ffe7bf",    // the light falling through the canopy
    soil:    ["#2a281b", "#2f2c1e", "#262418"],
    moss:    "#233621",
    needles: "#3a2e1f",
    path:    "#4a3f2e",
    trunk:   ["#2c241e", "#332a22", "#262019"],
    pine:    ["#18291f", "#1d3024", "#152419"],
    fern:    ["#24402a", "#2c4a2c", "#1f3825"],
    fungus:  "#bfeee0",
    wood:    "#3b2c20",
    plaque:  "#c9bc9c",
  },
};

const root = document.getElementById("forest-root");
const paintings = (window.__paintings || []).slice();
const IMG_DIR = "images/paintings/";

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
// colorFn(cx, cy, cz) may return a hex string per triangle (e.g. moss low on trunks)
function paint(geo, color, jitter = 0.06, colorFn = null) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  const p = geo.attributes.position, n = p.count;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i += 3) {
    const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
    const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    c.set((colorFn && colorFn(cx, cy, cz)) || color).offsetHSL((rand() - 0.5) * 0.02, 0, (rand() - 0.5) * jitter);
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
function radialTexture(stops, size = 128) {
  const cv = document.createElement("canvas"); cv.width = cv.height = size;
  const g = cv.getContext("2d"), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, c]) => gr.addColorStop(o, c));
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(cv);
}

// ── Renderer, scene, camera ──────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
root.prepend(renderer.domElement);

const scene = new THREE.Scene();
const C = CONFIG.colors;
scene.fog = new THREE.FogExp2(C.fog, CONFIG.fogDensity);
scene.background = new THREE.Color(C.fog);

const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 400);
camera.rotation.order = "YXZ";

// Sky dome: only visible through the gaps in the canopy
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(200, 24, 12),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(C.skyHole) }, bottom: { value: new THREE.Color(C.fog) } },
    vertexShader: `varying float vY; void main(){ vY = normalize(position).y;
      vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform vec3 top, bottom; varying float vY;
      void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(0.05, 0.6, vY)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
);
sky.frustumCulled = false;
scene.add(sky);

// Dim, cool light from above — the canopy swallows most of the evening sky
scene.add(new THREE.HemisphereLight(C.hemiSky, C.hemiGround, CONFIG.ambient));
const topLight = new THREE.DirectionalLight("#7f9aa3", 0.28);
topLight.position.set(0.3, 1, 0.2);
scene.add(topLight);

// Direction the light falls from (all shafts are parallel, like low sun)
const beamDir = new THREE.Vector3(0.32, 1, 0.18).normalize();

// ── Layout: a winding loop trail with the paintings scattered along it ──────
const N = Math.max(paintings.length, 1);
const trailR = Math.max(9, (N * CONFIG.spacing) / (Math.PI * 2));
const walkR = trailR * 1.32 + 5;
const worldR = walkR + 22;
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
  const rot = Math.atan2(a.x - x, a.y - z) + R(-0.35, 0.35); // face the trail
  return { x, z, rot, idx, p, i };
});

// ── Place things ─────────────────────────────────────────────────────────────
const obstacles = []; // circles {x, z, r} the visitor can't walk through
const placed = [];    // trees, for spacing checks and ground shading
function freeAt(x, z, minTree) {
  for (const s of spots) {
    if (Math.hypot(x - s.x, z - s.z) < 3.2) return false;
    const vx = s.x + Math.sin(s.rot) * 2.6, vz = s.z + Math.cos(s.rot) * 2.6;
    if (Math.hypot(x - vx, z - vz) < 1.8) return false;
  }
  for (const t of placed) if (Math.hypot(x - t.x, z - t.z) < minTree) return false;
  return true;
}

// Tree shapes: tall old trunks that vanish into the canopy, tall dark spruces,
// young firs in the undergrowth.
const mossy = (low) => (x, y) => (y < low && rand() < 0.45 ? C.moss : null);
function makeOldTrunk() {
  const parts = [];
  const r0 = R(0.42, 0.6);
  parts.push(paint(wobble(new THREE.CylinderGeometry(r0 * 0.7, r0, 24, 8, 8).translate(0, 11.6, 0), 0.08), pick(C.trunk), 0.07, mossy(3.2)));
  parts.push(paint(wobble(new THREE.ConeGeometry(r0 * 1.7, 1.4, 8, 1, true).translate(0, 0.45, 0), 0.15), pick(C.trunk), 0.07, mossy(2)));
  for (let k = 0; k < 4; k++) { // broken branch stubs
    const y = R(4, 13), a = R(0, 6.28), l = R(0.6, 1.6);
    parts.push(paint(new THREE.CylinderGeometry(0.03, 0.09, l, 5).rotateZ(R(0.9, 1.3)).translate(l * 0.45, y, 0).rotateY(a), pick(C.trunk)));
  }
  return merge(parts);
}
function makeTallSpruce() {
  const parts = [];
  parts.push(paint(new THREE.CylinderGeometry(0.12, 0.32, 20, 6).translate(0, 9.7, 0), pick(C.trunk), 0.06, mossy(2.5)));
  for (let k = 0; k < 6; k++) { // dead lower twigs
    const y = R(2.5, 7.5), a = R(0, 6.28), l = R(0.5, 1.2);
    parts.push(paint(new THREE.CylinderGeometry(0.01, 0.04, l, 4).rotateZ(R(1.1, 1.8)).translate(l * 0.45, y, 0).rotateY(a), "#2a241e"));
  }
  let y = 7.5, r = 2.4;
  const green = pick(C.pine);
  for (let i = 0; i < 6; i++) {
    const ch = 3.4 - i * 0.25;
    parts.push(paint(wobble(new THREE.ConeGeometry(r, ch, 8, 1).translate(0, y + ch / 2, 0), 0.35), green, 0.08));
    y += ch * 0.55; r *= 0.83;
  }
  return merge(parts);
}
function makeFir() {
  const parts = [paint(new THREE.CylinderGeometry(0.05, 0.1, 1, 5).translate(0, 0.4, 0), pick(C.trunk))];
  let y = 0.5, r = 0.9;
  const green = pick(C.pine);
  for (let i = 0; i < 3; i++) {
    parts.push(paint(wobble(new THREE.ConeGeometry(r, 1.3, 7, 1).translate(0, y + 0.65, 0), 0.15), green, 0.08));
    y += 0.75; r *= 0.72;
  }
  return merge(parts);
}
function makeFern() {
  const geo = new THREE.BufferGeometry(), pos = [], col = [];
  const base = new THREE.Color(pick(C.fern)), tip = base.clone().offsetHSL(0.02, 0, 0.07);
  const fronds = 7;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + R(-0.2, 0.2), len = R(0.6, 1.0), segs = 5;
    const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
    let prev = null;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs, d = t * len, h = Math.sin(t * Math.PI * 0.8) * 0.45 * len;
      const w = Math.sin(t * Math.PI) * 0.12;
      const cx = dx * d, cz = dz * d;
      const L = [cx + px * w, h, cz + pz * w], Rr = [cx - px * w, h, cz - pz * w];
      if (prev) {
        const c0 = base.clone().lerp(tip, (s - 1) / segs), c1 = base.clone().lerp(tip, s / segs);
        pos.push(...prev[0], ...prev[1], ...L, ...prev[1], ...Rr, ...L);
        [c0, c0, c1, c0, c1, c1].forEach((c) => col.push(c.r, c.g, c.b));
      }
      prev = [L, Rr];
    }
  }
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}
function makeFungi() {
  const parts = [];
  for (let k = 0; k < 5; k++) {
    const x = R(-0.15, 0.15), z = R(-0.15, 0.15), s = R(0.5, 1.1);
    parts.push(paint(new THREE.CylinderGeometry(0.012 * s, 0.016 * s, 0.09 * s, 5).translate(x, 0.045 * s, z), "#9fcfc2", 0));
    parts.push(paint(new THREE.SphereGeometry(0.035 * s, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1).translate(x, 0.09 * s, z), C.fungus, 0));
  }
  return merge(parts);
}
function makeRock() {
  return merge([paint(wobble(new THREE.DodecahedronGeometry(0.5, 0), 0.2).scale(1, 0.6, 0.8), "#3a3d36", 0.08,
    (x, y) => (y > 0.1 && rand() < 0.6 ? C.moss : null))]);
}

const variants = {
  old: [makeOldTrunk(), makeOldTrunk(), makeOldTrunk()],
  spruce: [makeTallSpruce(), makeTallSpruce(), makeTallSpruce()],
  fir: [makeFir(), makeFir()],
};
const instances = new Map(); // geometry or name -> list of matrices
function addInstance(key, x, z, s, sink = 0.05, tilt = 0.03) {
  if (!instances.has(key)) instances.set(key, []);
  instances.get(key).push(new THREE.Matrix4().compose(
    new THREE.Vector3(x, groundHeight(x, z) - sink, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(R(-tilt, tilt), R(0, 6.28), R(-tilt, tilt))),
    new THREE.Vector3(s, s * R(0.9, 1.15), s)
  ));
}

const maxTrees = isTouch ? 360 : 480;
for (let attempt = 0; attempt < 12000 && placed.length < maxTrees; attempt++) {
  const a = R(0, Math.PI * 2), r = Math.sqrt(rand()) * worldR;
  const x = Math.cos(a) * r, z = Math.sin(a) * r;
  const inner = r < walkR;
  if (inner && rand() > 0.55) continue;
  if (nearestOnTrail(x, z).d < 2.0) continue;                         // keep the trail clear
  if (Math.hypot(x - trail[0].x, z - trail[0].y) < 4.5) continue;
  if (!freeAt(x, z, inner ? 2.6 : 2.0)) continue;

  const roll = rand();
  const kind = roll < 0.4 ? "old" : roll < 0.78 ? "spruce" : "fir";
  const s = kind === "fir" ? R(0.7, 1.5) : R(0.85, 1.25);
  addInstance(pick(variants[kind]), x, z, s, 0.1);
  placed.push({ x, z, kind });
  if (r < walkR + 3) obstacles.push({ x, z, r: kind === "old" ? 0.6 * s : kind === "spruce" ? 0.35 * s : 0.55 * s });

  if (kind !== "fir" && rand() < 0.22) addInstance("fungi", x + R(-0.9, 0.9), z + R(-0.9, 0.9), R(0.8, 1.4), 0);
}
for (let i = 0; i < 55; i++) {
  const a = R(0, 6.28), r = Math.sqrt(rand()) * (walkR + 8), x = Math.cos(a) * r, z = Math.sin(a) * r;
  if (nearestOnTrail(x, z).d < 1.4 || !freeAt(x, z, 1.2)) continue;
  const s = R(0.5, 1.8);
  addInstance("rock", x, z, s, 0.12 * s, 0.3);
  if (r < walkR + 2 && s > 1) obstacles.push({ x, z, r: 0.45 * s });
}
const fernCount = isTouch ? 900 : 1500;
for (let i = 0; i < fernCount; i++) {
  const a = R(0, 6.28), r = Math.sqrt(rand()) * (walkR + 12), x = Math.cos(a) * r, z = Math.sin(a) * r;
  if (r > trailR * 0.6 && r < trailR * 1.45 && nearestOnTrail(x, z).d < 1.0) continue;
  if (spots.some((s) => Math.hypot(x - s.x, z - s.z) < 1.2)) continue;
  addInstance("fern", x, z, R(0.6, 1.5), 0, 0.15);
}

// A few fallen, mossy logs
const logs = [];
for (let i = 0, tries = 0; i < 4 && tries < 300; tries++) {
  const a = R(0, 6.28), r = R(trailR * 0.3, walkR - 2), x = Math.cos(a) * r, z = Math.sin(a) * r;
  if (nearestOnTrail(x, z).d < 3.2 || !freeAt(x, z, 3)) continue;
  const len = R(3, 5), rot = R(0, 3.14);
  logs.push({ x, z, len, rot });
  for (let k = -1; k <= 1; k++)
    obstacles.push({ x: x + Math.cos(rot) * k * len * 0.35, z: z - Math.sin(rot) * k * len * 0.35, r: 0.45 });
  placed.push({ x, z, kind: "log" });
  i++;
}

// ── Light shafts: one above every painting, plus a few empty ones ────────────
// Each shaft = a soft additive beam + a pool of light on the ground + a hole in
// the canopy. Nearby paintings also get a real spotlight (see the light pool).
const shafts = [];
spots.forEach((s) => shafts.push({ x: s.x + Math.sin(s.rot) * 0.6, z: s.z + Math.cos(s.rot) * 0.6, r: 1.25, spot: s }));
for (let i = 0, tries = 0; i < CONFIG.extraShafts && tries < 400; tries++) {
  const a = R(0, 6.28), r = Math.sqrt(rand()) * (walkR + 6), x = Math.cos(a) * r, z = Math.sin(a) * r;
  if (shafts.some((h) => Math.hypot(h.x - x, h.z - z) < 6)) continue;
  shafts.push({ x, z, r: R(0.8, 1.4), spot: null });
  i++;
}
shafts.forEach((h) => {
  h.y = groundHeight(h.x, h.z);
  const k = (CONFIG.canopyY - h.y) / beamDir.y;
  h.topX = h.x + beamDir.x * k;
  h.topZ = h.z + beamDir.z * k;
});

// ── Ground (shaded darker under trees, lighter in the light pools) ──────────
const grid = new Map(); // spatial hash of trees for quick lookups
placed.forEach((t) => {
  const k = Math.floor(t.x / 4) + "," + Math.floor(t.z / 4);
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(t);
});
function treeShade(x, z) {
  let s = 0;
  const gx = Math.floor(x / 4), gz = Math.floor(z / 4);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const list = grid.get(gx + i + "," + (gz + j));
    if (list) for (const t of list) s += Math.max(0, 1 - Math.hypot(x - t.x, z - t.z) / 2.6);
  }
  return Math.min(1, s);
}
let groundMesh;
{
  const size = worldR * 2 + 40, seg = isTouch ? 110 : 150;
  let geo = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, groundHeight(pos.getX(i), pos.getZ(i)));
  geo = geo.toNonIndexed();
  const p = geo.attributes.position, n = p.count;
  const col = new Float32Array(n * 3), c = new THREE.Color();
  const soil = C.soil.map((g) => new THREE.Color(g)), moss = new THREE.Color(C.moss),
    needles = new THREE.Color(C.needles), dirt = new THREE.Color(C.path), black = new THREE.Color("#080a07");
  for (let i = 0; i < n; i += 3) {
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
    const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    c.copy(soil[Math.floor(hash(cx, cz) * soil.length)]);
    c.lerp(moss, Math.max(0, noise(cx * 0.15, cz * 0.15) - 0.4) * 1.5);
    c.lerp(needles, Math.max(0, noise(cx * 0.3 + 40, cz * 0.3) - 0.55) * 1.6);
    const rr = Math.hypot(cx, cz);
    if (rr > trailR * 0.6 && rr < trailR * 1.45) {
      const d = nearestOnTrail(cx, cz).d;
      c.lerp(dirt, (1 - THREE.MathUtils.smoothstep(d, 0.5, 1.1 + noise(cx, cz) * 0.4)) * 0.9);
    }
    c.lerp(black, treeShade(cx, cz) * 0.45);
    c.offsetHSL(0, 0, (hash(cz, cx) - 0.5) * 0.025);
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  groundMesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  scene.add(groundMesh);
}

// ── Wind: a slow sway for the crowns and ferns (shader patch) ────────────────
const windUniform = { value: 0 };
function windy(mat, start = 6, amt = 0.012) {
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
       transformed.x += sin(uTime * 0.6 + ph) * sw;
       transformed.z += cos(uTime * 0.45 + ph * 1.7) * sw * 0.7;`
    );
  };
  return mat;
}

const baseGeos = { fungi: makeFungi(), rock: makeRock(), fern: makeFern() };
const treeMat = windy(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
const fernMat = windy(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true }), 0.05, 0.12);
const staticMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
// glowing fungi: unlit, so they shine faintly in the dark
const fungiMat = new THREE.MeshBasicMaterial({ vertexColors: true });

const tint = new THREE.Color();
for (const [key, mats] of instances) {
  const geo = typeof key === "string" ? baseGeos[key] : key;
  const mat = typeof key !== "string" ? treeMat : key === "fern" ? fernMat : key === "fungi" ? fungiMat : staticMat;
  const mesh = new THREE.InstancedMesh(geo, mat, mats.length);
  mats.forEach((m, i) => {
    mesh.setMatrixAt(i, m);
    tint.setHSL(0, 0, key === "fungi" ? R(0.6, 1) : R(0.85, 1.1));
    mesh.setColorAt(i, tint);
  });
  scene.add(mesh);
}
logs.forEach(({ x, z, len, rot }) => {
  const log = new THREE.Mesh(
    merge([paint(wobble(new THREE.CylinderGeometry(0.28, 0.34, len, 8, 3), 0.07).rotateZ(Math.PI / 2), pick(C.trunk), 0.08,
      (x, y) => (y > 0.05 && rand() < 0.65 ? C.moss : null))]),
    staticMat
  );
  log.position.set(x, groundHeight(x, z) + 0.2, z);
  log.rotation.y = rot;
  scene.add(log);
});

// ── Canopy: a dark ceiling of leaves with holes where the light comes in ─────
{
  const size = worldR * 2 + 60, S = 1024, half = size / 2;
  const cv = document.createElement("canvas"); cv.width = cv.height = S;
  const g = cv.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = "destination-out";
  const toPx = (m) => (m / size) * S;
  const hole = (x, z, r) => {
    for (let k = 0; k < 7; k++) {
      const a = R(0, 6.28), d = R(0, r * 0.6), rr = r * R(0.45, 0.8);
      g.beginPath();
      g.arc(toPx(x + half + Math.cos(a) * d), toPx(z + half + Math.sin(a) * d), toPx(rr), 0, Math.PI * 2);
      g.fill();
    }
  };
  shafts.forEach((h) => hole(h.topX, h.topZ, h.r * 1.5));
  for (let i = 0; i < 25; i++) hole(R(-half, half) * 0.7, R(-half, half) * 0.7, R(0.2, 0.6)); // tiny specks of sky
  const tex = new THREE.CanvasTexture(cv);
  const canopy = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: C.canopy, alphaMap: tex, alphaTest: 0.5, side: THREE.DoubleSide })
  );
  // rotateX(+90°) maps plane +y to world +z, so canvas rows run along +z — flip to match
  tex.flipY = false;
  canopy.position.y = CONFIG.canopyY;
  scene.add(canopy);
}

// Beam shader: soft at the edges and ends, faint drifting streaks
const beamMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { uTime: windUniform, color: { value: new THREE.Color(C.beam) }, strength: { value: 0.14 } },
  vertexShader: `
    uniform float uTime; varying float vH; varying float vEdge; varying float vDist; varying float vAng;
    attribute float hNorm;
    void main(){
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vec3 n = normalize(mat3(modelMatrix) * normal);
      vec3 v = normalize(cameraPosition - wp.xyz);
      vEdge = abs(dot(n, v));
      vH = hNorm;
      vAng = atan(position.z, position.x);
      vDist = length(cameraPosition - wp.xyz);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: `
    uniform vec3 color; uniform float strength; uniform float uTime;
    varying float vH; varying float vEdge; varying float vDist; varying float vAng;
    void main(){
      float ends = smoothstep(0.0, 0.18, vH) * (1.0 - smoothstep(0.75, 1.0, vH));
      float soft = pow(vEdge, 1.6);
      float streak = 0.65 + 0.35 * sin(vAng * 9.0 + uTime * 0.15 + vH * 2.0);
      float fade = exp(-vDist * 0.035);
      gl_FragColor = vec4(color * strength * ends * soft * streak * fade, 1.0);
    }`,
});
const poolTex = radialTexture([[0, "rgba(255,255,255,1)"], [0.35, "rgba(255,255,255,0.55)"], [1, "rgba(255,255,255,0)"]]);
const poolMat = new THREE.MeshBasicMaterial({
  map: poolTex, color: new THREE.Color(C.beam).multiplyScalar(0.55), transparent: true, depthWrite: false,
  blending: THREE.AdditiveBlending, fog: true, polygonOffset: true, polygonOffsetFactor: -2,
});
const up = new THREE.Vector3(0, 1, 0);
shafts.forEach((h) => {
  const len = Math.hypot(h.topX - h.x, CONFIG.canopyY - h.y, h.topZ - h.z);
  const geo = new THREE.CylinderGeometry(h.r * 0.9, h.r * 1.35, len, 28, 1, true);
  const hn = new Float32Array(geo.attributes.position.count);
  for (let i = 0; i < hn.length; i++) hn[i] = geo.attributes.position.getY(i) / len + 0.5;
  geo.setAttribute("hNorm", new THREE.BufferAttribute(hn, 1));
  const beam = new THREE.Mesh(geo, beamMat);
  beam.quaternion.setFromUnitVectors(up, beamDir);
  beam.position.set((h.x + h.topX) / 2, (h.y + CONFIG.canopyY) / 2, (h.z + h.topZ) / 2);
  beam.renderOrder = 2;
  scene.add(beam);

  // pool of light on the ground, following the terrain
  const r = h.r * 2.1, seg = 20, ring = 5, pos = [], uv = [], idx = [];
  for (let j = 0; j <= ring; j++) for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2, d = (j / ring) * r;
    const x = h.x + Math.cos(a) * d, z = h.z + Math.sin(a) * d;
    pos.push(x, groundHeight(x, z) + 0.03, z);
    uv.push(0.5 + (Math.cos(a) * d) / (2 * r), 0.5 + (Math.sin(a) * d) / (2 * r));
  }
  for (let j = 0; j < ring; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i, b = a + seg + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  pg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  pg.setIndex(idx);
  const pool = new THREE.Mesh(pg, poolMat);
  pool.renderOrder = 1;
  scene.add(pool);
});

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
  g.fillStyle = "#2a231c"; g.textAlign = "center";
  g.font = '500 44px "DM Sans", system-ui, sans-serif';
  let t = text;
  while (g.measureText(t).width > 470 && t.length > 4) t = t.slice(0, -2);
  if (t !== text) t = t.trimEnd() + "…";
  g.fillText(t, 256, 62);
  g.font = '300 28px "DM Sans", system-ui, sans-serif';
  g.fillStyle = "#5e5243";
  g.fillText(sub, 256, 104);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

function buildPainting(s, img) {
  const p = s.p;
  const aspect = img.width / img.height;
  const long = THREE.MathUtils.clamp(parseSize(p.format) || 1.3, 0.8, 1.8);
  const W = aspect >= 1 ? long : long * aspect;
  const H = aspect >= 1 ? long / aspect : long;
  const bottom = 0.72;

  const group = new THREE.Group();
  group.position.set(s.x, groundHeight(s.x, s.z), s.z);
  group.rotation.y = s.rot;

  // artwork texture, downscaled so 16+ paintings stay light on the GPU
  const cv = document.createElement("canvas");
  const k = Math.min(1, CONFIG.maxTexture / Math.max(img.width, img.height));
  cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
  cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;

  // a little self-glow so far-away paintings still read through the fog
  const artMat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.17 });
  const art = new THREE.Mesh(new THREE.PlaneGeometry(W, H), artMat);
  art.position.set(0, bottom + H / 2, 0.031);

  const board = new THREE.Mesh(new THREE.BoxGeometry(W + 0.07, H + 0.07, 0.06), woodMat);
  board.position.set(0, bottom + H / 2, 0);

  const postH = bottom + H * 0.8 + 0.5;
  [-1, 1].forEach((side) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, postH, 0.08), woodMat);
    post.position.set(side * (W / 2 - Math.min(0.15, W * 0.15)), postH / 2 - 0.5, -0.07);
    group.add(post);
  });

  const sub = [p.year, p.medium && p.medium.split(" on ")[0]].filter(Boolean).join(" · ");
  const plaque = new THREE.Mesh(
    new THREE.PlaneGeometry(0.46, 0.115),
    (() => { const t = makePlaque(p.title || p.file, sub); return new THREE.MeshLambertMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.3 }); })()
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
  for (let t = -1; t <= 1; t++)
    obstacles.push({ x: s.x + Math.cos(s.rot) * t * W * 0.4, z: s.z - Math.sin(s.rot) * t * W * 0.4, r: 0.32 });
}

const fontsReady = document.fonts ? document.fonts.load('500 44px "DM Sans"').catch(() => {}) : Promise.resolve();
spots.forEach((s) => {
  s.center = new THREE.Vector3(s.x, groundHeight(s.x, s.z) + 1.4, s.z);
  s.viewDist = 2.6;
  loader.load(IMG_DIR + s.p.file, (img) => fontsReady.then(() => buildPainting(s, img)));
});

// ── Real spotlights for the nearest paintings ────────────────────────────────
// A fixed pool of lights (cheap, and the shaders never need recompiling) that
// fade over to whichever paintings are closest to the visitor.
const lightPool = [];
for (let k = 0; k < Math.min(CONFIG.litPaintings, spots.length); k++) {
  const l = new THREE.SpotLight(C.beam, 0, 0, 0.3, 0.75, 1.2);
  l.userData = { spot: -1, level: 0 };
  scene.add(l, l.target);
  lightPool.push(l);
}
function aimLight(l, s) {
  const tx = s.center.x + Math.sin(s.rot) * 0.4, tz = s.center.z + Math.cos(s.rot) * 0.4;
  const ty = s.center.y - 0.35;
  const k = 11;
  l.position.set(tx + beamDir.x * k, ty + beamDir.y * k, tz + beamDir.z * k);
  l.target.position.set(tx, ty, tz);
}
function updateLights(dt, px, pz) {
  const near = spots.map((s, i) => [Math.hypot(s.x - px, s.z - pz), i]).sort((a, b) => a[0] - b[0])
    .slice(0, lightPool.length).map((e) => e[1]);
  const held = new Set(lightPool.map((l) => l.userData.spot));
  for (const l of lightPool) {
    const u = l.userData;
    const want = near.includes(u.spot);
    u.level = Math.max(0, Math.min(1, u.level + (want ? dt : -dt) * 1.2));
    if (!want && u.level === 0) {
      const free = near.find((i) => !held.has(i));
      if (free !== undefined) { u.spot = free; u.aimed = false; held.add(free); aimLight(l, spots[free]); }
    }
    if (u.spot >= 0 && !u.aimed && spots[u.spot].H) { aimLight(l, spots[u.spot]); u.aimed = true; }
    l.intensity = u.level * CONFIG.shaftLight;
  }
}

// ── Dust drifting inside the light shafts ────────────────────────────────────
const PER_SHAFT = 28, MOTES = shafts.length * PER_SHAFT;
const moteBase = new Float32Array(MOTES * 3), motePos = new Float32Array(MOTES * 3);
shafts.forEach((h, si) => {
  for (let k = 0; k < PER_SHAFT; k++) {
    const y = R(0.3, 7), a = R(0, 6.28), d = Math.sqrt(rand()) * h.r * 1.1;
    const along = (y - 0) / beamDir.y;
    moteBase.set([h.x + beamDir.x * along + Math.cos(a) * d, h.y + y, h.z + beamDir.z * along + Math.sin(a) * d], (si * PER_SHAFT + k) * 3);
  }
});
const moteGeo = new THREE.BufferGeometry();
moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({
  size: 0.05, map: radialTexture([[0, "rgba(255,248,225,1)"], [0.35, "rgba(255,238,200,0.45)"], [1, "rgba(255,230,180,0)"]], 64),
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: C.beam, opacity: 0.9,
}));
motes.frustumCulled = false;
scene.add(motes);

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
    motePos[o] = moteBase[o] + Math.sin(t * 0.13 + ph) * 0.25;
    motePos[o + 1] = moteBase[o + 1] + Math.sin(t * 0.09 + ph * 2.1) * 0.4;
    motePos[o + 2] = moteBase[o + 2] + Math.cos(t * 0.11 + ph) * 0.25;
  }
  moteGeo.attributes.position.needsUpdate = true;

  updateLights(dt, player.x, player.z);
  updateCaption();
  renderer.render(scene, camera);
  if (ui.loading && !ui.loading.classList.contains("is-hidden")) ui.loading.classList.add("is-hidden");
}
renderer.setAnimationLoop(frame);
