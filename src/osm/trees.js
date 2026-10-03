import * as THREE from 'three';
import { pointInPoly, ringBox, ringArea } from './features.js';

// Ağaçlar: orman/park/mezarlık poligonlarına serpilir; karo başına tür başına bir InstancedMesh
// (karo dışı kalınca bütün grup kırpılır). Gövde + taç tek geometri, köşe renkli.

// m² başına ağaç (kalite çarpanı ayrıca uygulanır)
function density(kind, cls, sub) {
  if (kind === 'landcover') {
    if (cls === 'wood') return 1 / 55;
    if (sub === 'park' || sub === 'garden') return 1 / 420;
    if (sub === 'scrub') return 1 / 260;
    if (sub === 'allotments') return 1 / 500;
    if (sub === 'golf_course') return 1 / 900;
    return 0;
  }
  if (cls === 'park') return 1 / 380;
  if (cls === 'cemetery') return 1 / 200;
  if (cls === 'residential') return 1 / 2200;
  if (cls === 'school' || cls === 'hospital' || cls === 'university' || cls === 'kindergarten') return 1 / 1800;
  return 0;
}

// iğne yapraklı oranı
const coniferShare = (cls, sub) => (sub === 'forest' ? 0.5 : cls === 'wood' ? 0.25 : cls === 'cemetery' ? 0.35 : 0.08);

export function treeDemand(data, tileM) {
  let n = 0;
  const A = tileM * tileM;
  for (const l of data.landcover) n += Math.abs(ringArea(l.poly[0])) * A * density('landcover', l.cls, l.sub);
  for (const l of data.landuse) n += Math.abs(ringArea(l.poly[0])) * A * density('landuse', l.cls);
  return n;
}

// Karo içine (u,v ∈ [0,1)) ağaç noktaları. factor: talep/üst sınır ölçeği
export function scatterTrees(data, { tileM, mask, R, factor }) {
  const out = [];
  const A = tileM * tileM;
  const water = data.water.map((w) => w.poly);
  const run = (poly, dens, cShare) => {
    if (!dens) return;
    const area = Math.abs(ringArea(poly[0])) * A;
    const want = area * dens * factor;
    let n = Math.floor(want) + (R() < want % 1 ? 1 : 0);
    if (!n) return;
    const b = ringBox(poly[0]);
    const bx0 = Math.max(0, b.x0);
    const by0 = Math.max(0, b.y0);
    const bx1 = Math.min(1, b.x1);
    const by1 = Math.min(1, b.y1);
    if (bx1 <= bx0 || by1 <= by0) return;
    // kutunun karo dışındaki payı kadar azalt (komşu karo kendi payını diker)
    const full = (b.x1 - b.x0) * (b.y1 - b.y0);
    n = Math.round(n * Math.min(1, ((bx1 - bx0) * (by1 - by0)) / Math.max(full, 1e-12)));
    let tries = n * 3 + 10;
    while (n > 0 && tries-- > 0) {
      const u = bx0 + R() * (bx1 - bx0);
      const v = by0 + R() * (by1 - by0);
      if (!pointInPoly(poly, u, v) || !mask.free(u, v)) continue;
      if (water.length && water.some((w) => pointInPoly(w, u, v))) continue;
      const conifer = R() < cShare;
      const s = conifer ? 0.85 + R() * 0.7 : 0.75 + R() * 0.7;
      out.push({ u, v, conifer, s, rot: R() * Math.PI * 2, tint: R(), r: (conifer ? 2.1 : 3.0) * s, h: (conifer ? 12 : 10) * s });
      n--;
    }
  };
  for (const l of data.landcover) run(l.poly, density('landcover', l.cls, l.sub), coniferShare(l.cls, l.sub));
  for (const l of data.landuse) run(l.poly, density('landuse', l.cls), coniferShare(l.cls));
  return out;
}

// ---- geometriler (1 birim = 1 m, taban y=0)
function paint(g, color) {
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

function merge(parts) {
  const list = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

// Yuvarlak taç: yumuşak normal (merkezden dışa), düşük poligon ama düz yüzlü görünmez
function blob(r, x, y, z, sy = 1, detail = 1) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position;
  const n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    n.setXYZ(i, v.x, v.y * 0.8 + 0.2, v.z);
  }
  g.scale(1, sy, 1).translate(x, y, z);
  return g;
}

let geos = null;
export function treeGeometries() {
  if (geos) return geos;
  const trunk = (r0, r1, h) => paint(new THREE.CylinderGeometry(r0, r1, h, 5, 1, true).translate(0, h / 2 - 0.4, 0), '#5a4636');
  const leafCrown = paint(blob(2.6, 0, 6.2, 0, 0.95), '#4f7a35');
  const leafSide = paint(blob(1.8, 1.2, 5.2, 0.6, 1, 0), '#56813a');
  const leaf = merge([trunk(0.18, 0.3, 4.4), leafCrown, leafSide]);
  const cone = (r, h, y) => paint(new THREE.ConeGeometry(r, h, 7, 1, true).translate(0, y, 0), '#3d5e34');
  const conifer = merge([trunk(0.14, 0.24, 3), cone(2.1, 6, 4.6), cone(1.6, 5, 7.2), cone(1.0, 3.6, 9.8)]);
  geos = { leaf, conifer };
  return geos;
}

let mat = null;
export function treeMaterial() {
  if (!mat) mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  return mat;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

// Karo ağaçları → InstancedMesh listesi. place(u, v) → {x, y, z} ham yerel
export function buildTreeMeshes(trees, place) {
  const { leaf, conifer } = treeGeometries();
  const meshes = [];
  for (const [geo, isCon] of [[leaf, false], [conifer, true]]) {
    const list = trees.filter((t) => t.conifer === isCon);
    if (!list.length) continue;
    const m = new THREE.InstancedMesh(geo, treeMaterial(), list.length);
    list.forEach((t, i) => {
      const w = place(t.u, t.v);
      _p.set(w.x, w.y - 0.25, w.z);
      _q.setFromAxisAngle(UP, t.rot);
      const sx = t.s * (0.9 + t.tint * 0.2);
      _s.set(sx, t.s, sx);
      m.setMatrixAt(i, _m.compose(_p, _q, _s));
      const k = 0.78 + t.tint * 0.42;
      _c.setRGB(k * (isCon ? 0.95 : 1.02), k, k * (isCon ? 1 : 0.92));
      m.setColorAt(i, _c);
    });
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    m.userData.full = list.length;
    meshes.push(m);
  }
  return meshes;
}
