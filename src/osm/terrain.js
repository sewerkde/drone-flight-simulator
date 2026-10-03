import * as THREE from 'three';
import { TERRAIN_URL, tileUrl, fetchCached } from './tiles.js';

// AWS Terrain Tiles (Terrarium PNG): yükseklik = R*256 + G + B/256 - 32768 (m).
const PX = 256;

async function decodeTerrarium(blob) {
  const out = new Float32Array(PX * PX);
  if (!blob) return out; // veri yok (açık deniz): 0 m
  // renk yönetimi kapalı: piksel değerleri ham kalmalı
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(PX, PX) : Object.assign(document.createElement('canvas'), { width: PX, height: PX });
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  bmp.close?.();
  const d = g.getImageData(0, 0, PX, PX).data;
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = d[j] * 256 + d[j + 1] + d[j + 2] / 256 - 32768;
  return out;
}

// Pencere karolarının arazisini indir, tek mozaikte birleştir.
// onTile(): her karo bittiğinde (yükleme ekranı ilerlemesi için)
export async function loadTerrain(frame, win, onTile) {
  const nx = win.x1 - win.x0 + 1;
  const ny = win.y1 - win.y0 + 1;
  const W = nx * PX;
  const H = ny * PX;
  const mosaic = new Float32Array(W * H);
  await Promise.all(
    win.list.map(async (t) => {
      const blob = await fetchCached(tileUrl(TERRAIN_URL, frame.z, t.x, t.y), 'blob');
      const h = await decodeTerrarium(blob);
      const ox = (t.x - win.x0) * PX;
      const oy = (t.y - win.y0) * PX;
      for (let r = 0; r < PX; r++) mosaic.set(h.subarray(r * PX, r * PX + PX), (oy + r) * W + ox);
      onTile?.();
    }),
  );
  // DEM bir yüzey modelidir: yapı kümeleri tümsek olarak gelir. Hafif morfolojik açma
  // (önce min, sonra max süzgeci) ~60 m'den dar tümsekleri siler; büyük yapılar flattenUnder'da.
  const k = Math.max(1, Math.round(30 / (frame.tileM / PX)));
  morph(mosaic, W, H, k, Math.min);
  morph(mosaic, W, H, k, Math.max);
  smooth(mosaic, W, H);
  return { mosaic, W, H };
}

// Ayrık kare pencere (2k+1) min/max süzgeci: önce satırlar, sonra sütunlar
export function morph(a, W, H, k, op) {
  const tmp = new Float32Array(a.length);
  for (let y = 0; y < H; y++) {
    const o = y * W;
    for (let x = 0; x < W; x++) {
      let v = a[o + x];
      const x0 = Math.max(0, x - k);
      const x1 = Math.min(W - 1, x + k);
      for (let i = x0; i <= x1; i++) v = op(v, a[o + i]);
      tmp[o + x] = v;
    }
  }
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - k);
    const y1 = Math.min(H - 1, y + k);
    for (let x = 0; x < W; x++) {
      let v = tmp[y * W + x];
      for (let j = y0; j <= y1; j++) v = op(v, tmp[j * W + x]);
      a[y * W + x] = v;
    }
  }
}

// [1 2 1] ayrık bulanıklık: 25 m'lik DEM'in basamaklarını ve kentteki gürültüyü yumuşatır
function smooth(a, W, H) {
  const tmp = new Float32Array(a.length);
  for (let y = 0; y < H; y++) {
    const o = y * W;
    for (let x = 0; x < W; x++) {
      const l = a[o + Math.max(0, x - 1)];
      const r = a[o + Math.min(W - 1, x + 1)];
      tmp[o + x] = (l + 2 * a[o + x] + r) * 0.25;
    }
  }
  for (let y = 0; y < H; y++) {
    const u = Math.max(0, y - 1) * W;
    const d = Math.min(H - 1, y + 1) * W;
    const o = y * W;
    for (let x = 0; x < W; x++) a[o + x] = (tmp[u + x] + 2 * tmp[o + x] + tmp[d + x]) * 0.25;
  }
}

// Köşe ızgarası: karo başına SEG bölüm, tüm pencere tek kafes (karo kenarları dikişsiz).
// heightAt() ağın üçgenlerini birebir izler: dron yere tam oturur.
export function makeHeightField(frame, win, src, SEG) {
  const nx = win.x1 - win.x0 + 1;
  const ny = win.y1 - win.y0 + 1;
  const VW = nx * SEG + 1;
  const VH = ny * SEG + 1;
  const h = new Float32Array(VW * VH);
  const { mosaic, W, H } = src;
  // piksel merkezleri arasında çift doğrusal örnek (mozaik pikseli)
  const sample = (px, py) => {
    const fx = Math.min(W - 1, Math.max(0, px - 0.5));
    const fy = Math.min(H - 1, Math.max(0, py - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(W - 1, x0 + 1);
    const y1 = Math.min(H - 1, y0 + 1);
    const ax = fx - x0;
    const ay = fy - y0;
    const a = mosaic[y0 * W + x0] * (1 - ax) + mosaic[y0 * W + x1] * ax;
    const b = mosaic[y1 * W + x0] * (1 - ax) + mosaic[y1 * W + x1] * ax;
    return a * (1 - ay) + b * ay;
  };
  const step = PX / SEG;
  for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) h[j * VW + i] = sample(i * step, j * step);

  const cell = frame.tileM / SEG; // köşe aralığı (m)
  const X0 = frame.x(win.x0); // pencerenin batı kenarı (yerel m)
  const Z0 = frame.zz(win.y0); // kuzey kenarı
  const X1 = X0 + (VW - 1) * cell;
  const Z1 = Z0 + (VH - 1) * cell;

  // üçgen içi doğrusal: hücre (a b / c d), köşegen b–c (ağ indeksiyle aynı)
  function heightAt(x, z) {
    let u = (x - X0) / cell;
    let v = (z - Z0) / cell;
    u = Math.min(VW - 1.0001, Math.max(0, u));
    v = Math.min(VH - 1.0001, Math.max(0, v));
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = u - i;
    const fv = v - j;
    const k = j * VW + i;
    const a = h[k];
    const b = h[k + 1];
    const c = h[k + VW];
    if (fu + fv <= 1) return a + (b - a) * fu + (c - a) * fv;
    const d = h[k + VW + 1];
    return d + (c - d) * (1 - fu) + (b - d) * (1 - fv);
  }

  return { h, VW, VH, SEG, cell, X0, Z0, X1, Z1, heightAt, win };
}

// Bir karonun arazi ağı (yerel ham metre, y = deniz seviyesine göre yükseklik).
// uv: karo dokusuna 0..1 (v=0 kuzey kenarı; doku flipY=false)
export function tileTerrainGeometry(hf, tx, ty) {
  const { h, VW, SEG, cell, X0, Z0 } = hf;
  const i0 = (tx - hf.win.x0) * SEG;
  const j0 = (ty - hf.win.y0) * SEG;
  const N = SEG + 1;
  const pos = new Float32Array(N * N * 3);
  const nor = new Float32Array(N * N * 3);
  const uv = new Float32Array(N * N * 2);
  const VH = hf.VH;
  const H = (i, j) => h[Math.min(VH - 1, Math.max(0, j)) * VW + Math.min(VW - 1, Math.max(0, i))];
  let p = 0;
  let q = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const gi = i0 + i;
      const gj = j0 + j;
      pos[p] = X0 + gi * cell;
      pos[p + 1] = H(gi, gj);
      pos[p + 2] = Z0 + gj * cell;
      // normal: tüm pencere ızgarasında merkezi fark (karo kenarında dikiş olmaz)
      const dx = (H(gi + 1, gj) - H(gi - 1, gj)) / (2 * cell);
      const dz = (H(gi, gj + 1) - H(gi, gj - 1)) / (2 * cell);
      const l = Math.hypot(dx, 1, dz);
      nor[p] = -dx / l;
      nor[p + 1] = 1 / l;
      nor[p + 2] = -dz / l;
      uv[q] = i / SEG;
      uv[q + 1] = j / SEG;
      p += 3;
      q += 2;
    }
  }
  const idx = new Uint32Array(SEG * SEG * 6);
  let o = 0;
  for (let j = 0; j < SEG; j++) {
    for (let i = 0; i < SEG; i++) {
      const a = j * N + i;
      const b = a + 1;
      const c = a + N;
      const d = c + 1;
      idx[o++] = a;
      idx[o++] = c;
      idx[o++] = b;
      idx[o++] = b;
      idx[o++] = c;
      idx[o++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// Pencere dışı etek: kenar köşelerinden ufka doğru genişleyen halka (boşluk görünmesin).
// İç kenar arazi kenarıyla birebir, dış kenar ortalama kenar yüksekliğinde.
export function skirtGeometry(hf, reach) {
  const { h, VW, VH, cell, X0, Z0 } = hf;
  const ring = [];
  for (let i = 0; i < VW - 1; i++) ring.push([i, 0]);
  for (let j = 0; j < VH - 1; j++) ring.push([VW - 1, j]);
  for (let i = VW - 1; i > 0; i--) ring.push([i, VH - 1]);
  for (let j = VH - 1; j > 0; j--) ring.push([0, j]);
  const cx = X0 + ((VW - 1) * cell) / 2;
  const cz = Z0 + ((VH - 1) * cell) / 2;
  let avg = 0;
  for (const [i, j] of ring) avg += h[j * VW + i];
  avg /= ring.length;
  const n = ring.length;
  const pos = new Float32Array(n * 2 * 3);
  const half = ((VW - 1) * cell) / 2;
  ring.forEach(([i, j], k) => {
    const x = X0 + i * cell;
    const z = Z0 + j * cell;
    const y = h[j * VW + i];
    pos.set([x, y - 0.05, z], k * 6);
    const s = (reach + half) / half;
    pos.set([cx + (x - cx) * s, avg - 25, cz + (z - cz) * s], k * 6 + 3);
  });
  const idx = [];
  for (let k = 0; k < n; k++) {
    const a = k * 2;
    const b = ((k + 1) % n) * 2;
    // halka yukarıdan saat yönünde: iç a,b ; dış a+1,b+1 (üçgenler yukarı baksın)
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // dik iç kenarda normal bozulmasın: hepsi yukarı
  const nor = g.attributes.normal.array;
  for (let i = 0; i < nor.length; i += 3) {
    nor[i] = 0;
    nor[i + 1] = 1;
    nor[i + 2] = 0;
  }
  return { geometry: g, avg };
}
