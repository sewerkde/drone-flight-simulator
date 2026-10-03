import * as THREE from 'three';
import { clipRingUnit, ringArea, pointInRing } from './features.js';

// Binalar: render_height / render_min_height ile yükseltilmiş taban izleri. Karo başına tek
// BufferGeometry (tek çizim çağrısı). Duvarlar çatıdan açık, dipte hafif koyu (temas gölgesi).

const ROOF_SMALL = ['#8e5b4b', '#7d5546', '#9a6a55', '#6c6866', '#5f5b58', '#875f4f', '#77706a'];
const ROOF_LARGE = ['#8d8c88', '#9a9893', '#7e7d7a', '#a7a49d', '#8a8680', '#6f6e6c'];
const WALL = ['#ddd6c8', '#d3cabb', '#e4ded2', '#cbc2b3', '#c7c0b6', '#d8cfc0', '#e0d8cb', '#c9c4bc'];
const DEFAULT_H = 8;
const BAY = 7; // cephe dokusu: 2 pencere aralığı (m)
const FLOORS = 6; // 2 kat (m)
const PLAIN = 0.015; // dokunun penceresiz köşesi (çatı, kulübe duvarı)

// Cephe dokusu: beyaz duvar üzerinde 2x2 pencere; köşe rengiyle çarpılır
let facade = null;
export function facadeTexture(anisotropy = 4) {
  if (facade) return facade;
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, N, N);
  for (let fy = 0; fy < 2; fy++) {
    for (let fx = 0; fx < 2; fx++) {
      const x = fx * 128 + 36;
      const y = fy * 128 + 30;
      g.fillStyle = 'rgba(0,0,0,0.08)';
      g.fillRect(x - 5, y - 5, 66, 80);
      g.fillStyle = fx === fy ? '#6f7c87' : '#66737e';
      g.fillRect(x, y, 56, 70);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(x, y, 56, 22);
      g.fillStyle = '#ece9e2';
      g.fillRect(x + 26, y, 4, 70);
      g.fillRect(x - 4, y + 70, 64, 5);
    }
    // kat silmesi
    g.fillStyle = 'rgba(0,0,0,0.07)';
    g.fillRect(0, fy * 128 + 124, N, 4);
  }
  facade = new THREE.CanvasTexture(c);
  facade.colorSpace = THREE.SRGBColorSpace;
  facade.wrapS = facade.wrapT = THREE.RepeatWrapping;
  facade.anisotropy = anisotropy;
  return facade;
}

const _c = new THREE.Color();
const _w = new THREE.Color();

// küçük kararlı karma (bina köşesinden), renk seçimi karo sınırında da aynı kalsın
const hash2 = (x, z) => {
  let h = Math.imul(Math.round(x * 10) | 0, 73856093) ^ Math.imul(Math.round(z * 10) | 0, 19349663);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// data.buildings → { geometry, records }. Koordinatlar yerel ham metre (holder çerçevesi).
// heightAt(x, z): ham arazi yüksekliği
export function buildTileBuildings(data, { frame, tx, ty, heightAt, footprintsOnly = false }) {
  const pos = [];
  const nor = [];
  const col = [];
  const uvs = [];
  const idx = [];
  const records = [];
  const outlines = []; // hide_3d dış hatları: çizilmez, çarpışmaz; yalnız arazi düzlemede kullanılır
  const toLocal = (r) => {
    const out = new Float64Array(r.length);
    for (let i = 0; i < r.length; i += 2) {
      out[i] = frame.x(tx + r[i]);
      out[i + 1] = frame.zz(ty + r[i + 1]);
    }
    return out;
  };
  // kırpılmış halkada karo kenarı üzerindeki kenar (komşu karodaki parçayla bitişik): duvar yok
  const onEdge = (a0, b0, a1, b1) =>
    (a0 === 0 && a1 === 0) || (a0 === 1 && a1 === 1) || (b0 === 0 && b1 === 0) || (b0 === 1 && b1 === 1);

  for (const b of data.buildings) {
    const outerU = clipRingUnit(b.poly[0]);
    if (!outerU) continue;
    const holesU = [];
    for (let k = 1; k < b.poly.length; k++) {
      const h = clipRingUnit(b.poly[k]);
      if (h) holesU.push(h);
    }
    const ringsU = [outerU, ...holesU];
    const rings = ringsU.map(toLocal);
    // yön: dış halka alan > 0, delikler < 0 (duvar normali hep binanın dışına)
    rings.forEach((r, k) => {
      const a = ringArea(r);
      if ((k === 0 && a < 0) || (k > 0 && a > 0)) {
        reverseRing(r);
        reverseRing(ringsU[k]);
      }
    });
    const outer = rings[0];
    const area = ringArea(outer);
    if (area < 4) continue; // kulübe altı kırıntılar

    // taban: iz altındaki en düşük arazi
    let base = Infinity;
    let minx = Infinity;
    let maxx = -Infinity;
    let minz = Infinity;
    let maxz = -Infinity;
    let cx = 0;
    let cz = 0;
    const n0 = outer.length / 2;
    for (let i = 0; i < outer.length; i += 2) {
      const x = outer[i];
      const z = outer[i + 1];
      base = Math.min(base, heightAt(x, z));
      minx = Math.min(minx, x);
      maxx = Math.max(maxx, x);
      minz = Math.min(minz, z);
      maxz = Math.max(maxz, z);
      cx += x / n0;
      cz += z / n0;
    }
    base = Math.min(base, heightAt(cx, cz));
    if (b.hide || footprintsOnly) {
      (b.hide ? outlines : records).push({ rings: [outer], minx, maxx, minz, maxz, bottom: b.minH > 0 ? 0 : -1e9, top: base + (b.h || DEFAULT_H), base, area });
      continue;
    }
    let h = b.h > 0 ? b.h : DEFAULT_H;
    const minH = b.minH;
    if (h <= minH + 0.5) h = minH + 3;
    const top = base + h;
    const bottom = minH > 0 ? base + minH : base - 1.2;

    // renkler: küçük binada kiremit/koyu, büyükte gri düz çatı; duvar açık, hafif çeşitlilik
    const r0 = hash2(outer[0], outer[1]);
    const r1 = hash2(outer[1], outer[0]);
    const big = area > 600 || h > 18;
    _c.set((big ? ROOF_LARGE : ROOF_SMALL)[Math.floor(r0 * 7) % (big ? 6 : 7)]);
    const osmColour = cleanColour(b.colour);
    if (osmColour) {
      _w.set(osmColour);
      _w.lerp(_c.set(WALL[0]), 0.45);
      _c.set((big ? ROOF_LARGE : ROOF_SMALL)[Math.floor(r0 * 7) % (big ? 6 : 7)]);
    } else _w.set(WALL[Math.floor(r1 * WALL.length)]);
    const k = 0.92 + r1 * 0.16;
    _c.multiplyScalar(k);
    _w.multiplyScalar(0.94 + r0 * 0.1);
    const wallH = top - bottom;

    // duvarlar: kenar başına dörtgen, düz normal
    const windows = h >= 4.5 && minH === 0;
    const v0w = (bottom - base) / FLOORS;
    const v1w = (top - base) / FLOORS;
    for (let ri = 0; ri < rings.length; ri++) {
      const r = rings[ri];
      const u = ringsU[ri];
      const n = r.length / 2;
      let run = 0; // halka boyunca biriken uzunluk: pencereler köşede kesintisiz akar
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (onEdge(u[i * 2], u[i * 2 + 1], u[j * 2], u[j * 2 + 1])) continue;
        const x0 = r[i * 2];
        const z0 = r[i * 2 + 1];
        const x1 = r[j * 2];
        const z1 = r[j * 2 + 1];
        const dx = x1 - x0;
        const dz = z1 - z0;
        const len = Math.hypot(dx, dz);
        if (len < 0.05) continue;
        const ua = run / BAY;
        run += len;
        const ub = run / BAY;
        if (windows) uvs.push(ua, v0w, ub, v0w, ub, v1w, ua, v1w);
        else uvs.push(PLAIN, PLAIN, PLAIN, PLAIN, PLAIN, PLAIN, PLAIN, PLAIN);
        const nx = dz / len;
        const nz = -dx / len;
        // yöne göre hafif ton farkı (güneşe bakan / bakmayan yüz ayrımı ışıkla zaten gelir)
        const v = pos.length / 3;
        // alt köşeler dipte koyu: temas gölgesi (yüksek binada daha kısa geçiş)
        const ao = Math.max(0.62, 0.8 - 2 / Math.max(wallH, 3));
        pos.push(x0, bottom, z0, x1, bottom, z1, x1, top, z1, x0, top, z0);
        for (let q = 0; q < 4; q++) nor.push(nx, 0, nz);
        col.push(_w.r * ao, _w.g * ao, _w.b * ao, _w.r * ao, _w.g * ao, _w.b * ao, _w.r, _w.g, _w.b, _w.r, _w.g, _w.b);
        idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
      }
    }

    // çatı: delikli üçgenleme (three'nin Earcut'u)
    const contour = [];
    for (let i = 0; i < outer.length; i += 2) contour.push(new THREE.Vector2(outer[i], outer[i + 1]));
    const holes = rings.slice(1).map((r) => {
      const a = [];
      for (let i = 0; i < r.length; i += 2) a.push(new THREE.Vector2(r[i], r[i + 1]));
      return a;
    });
    const all = contour.concat(...holes);
    const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
    const v0 = pos.length / 3;
    for (const p of all) {
      pos.push(p.x, top, p.y);
      nor.push(0, 1, 0);
      uvs.push(PLAIN, PLAIN);
      col.push(_c.r, _c.g, _c.b);
    }
    for (const [a, bb, c] of faces) {
      const A = all[a];
      const B = all[bb];
      const C = all[c];
      // yukarı bakan üçgen: (B-A)×(C-A) y bileşeni > 0 olmalı (x doğu, z güney)
      const cy = (B.y - A.y) * (C.x - A.x) - (B.x - A.x) * (C.y - A.y);
      if (cy > 0) idx.push(v0 + a, v0 + bb, v0 + c);
      else idx.push(v0 + a, v0 + c, v0 + bb);
    }

    records.push({ rings, minx, maxx, minz, maxz, bottom: minH > 0 ? bottom : -1e9, top, base, area });
  }

  if (!pos.length) return { geometry: null, records, outlines };
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return { geometry: g, records, outlines };
}

// OSM building:colour serbest metin: '#rrggbb', 'rrggbb' ya da CSS adı olabilir
function cleanColour(c) {
  if (!c) return null;
  const v = c.trim().toLowerCase();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(v)) return v;
  if (/^([0-9a-f]{3}|[0-9a-f]{6})$/.test(v)) return '#' + v;
  return v in THREE.Color.NAMES ? v : null;
}

function reverseRing(r) {
  const n = r.length / 2;
  for (let i = 0; i < n / 2; i++) {
    const j = n - 1 - i;
    const x = r[i * 2];
    const y = r[i * 2 + 1];
    r[i * 2] = r[j * 2];
    r[i * 2 + 1] = r[j * 2 + 1];
    r[j * 2] = x;
    r[j * 2 + 1] = y;
  }
}

// ---- çarpışma dizini: 32 m hücreli ızgara, bina kayıtları ham yerel metrede
export class BuildingIndex {
  constructor(cell = 32) {
    this.cell = cell;
    this.grid = new Map();
    this.list = [];
    this.stamp = new Uint32Array(0);
    this.tick = 0;
  }
  key(i, j) {
    return (i + 32768) * 65536 + (j + 32768);
  }
  add(rec) {
    const id = this.list.length;
    this.list.push(rec);
    const c = this.cell;
    for (let j = Math.floor(rec.minz / c); j <= Math.floor(rec.maxz / c); j++) {
      for (let i = Math.floor(rec.minx / c); i <= Math.floor(rec.maxx / c); i++) {
        const k = this.key(i, j);
        let a = this.grid.get(k);
        if (!a) this.grid.set(k, (a = []));
        a.push(id);
      }
    }
  }
  // (x0..x1, z0..z1) kutusuna değen binalar (tekrarsız)
  query(x0, z0, x1, z1, out) {
    out.length = 0;
    if (this.stamp.length < this.list.length) this.stamp = new Uint32Array(this.list.length + 1024);
    const t = ++this.tick;
    const c = this.cell;
    for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
      for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) {
        const a = this.grid.get(this.key(i, j));
        if (!a) continue;
        for (const id of a) {
          if (this.stamp[id] === t) continue;
          this.stamp[id] = t;
          const r = this.list[id];
          if (r.maxx < x0 || r.minx > x1 || r.maxz < z0 || r.minz > z1) continue;
          out.push(r);
        }
      }
    }
    return out;
  }
}

export function insideBuilding(rec, x, z) {
  if (x < rec.minx || x > rec.maxx || z < rec.minz || z > rec.maxz) return false;
  if (!pointInRing(rec.rings[0], x, z)) return false;
  for (let k = 1; k < rec.rings.length; k++) if (pointInRing(rec.rings[k], x, z)) return false;
  return true;
}

// en yakın kenar noktası (tüm halkalar): { d, x, z }
const _near = { d: 0, x: 0, z: 0 };
export function nearestEdge(rec, x, z) {
  let best = Infinity;
  for (const r of rec.rings) {
    const n = r.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = r[j * 2];
      const az = r[j * 2 + 1];
      const bx = r[i * 2];
      const bz = r[i * 2 + 1];
      const ex = bx - ax;
      const ez = bz - az;
      const l2 = ex * ex + ez * ez;
      let t = l2 > 0 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + ex * t;
      const pz = az + ez * t;
      const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d2 < best) {
        best = d2;
        _near.x = px;
        _near.z = pz;
      }
    }
  }
  _near.d = Math.sqrt(best);
  return _near;
}
