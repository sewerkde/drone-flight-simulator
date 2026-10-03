import * as THREE from 'three';
import { addSky, rng } from './world.js';
import { makeFrame, vectorTemplate, net, breathe } from './osm/tiles.js';
import { loadTerrain, makeHeightField, tileTerrainGeometry, skirtGeometry, morph } from './osm/terrain.js';
import { loadVectorTile, pointInPoly, pointInRing, ringBox } from './osm/features.js';
import { paintMask, paintGround } from './osm/ground.js';
import { buildTileBuildings, BuildingIndex, insideBuilding, nearestEdge, facadeTexture } from './osm/buildings.js';
import { treeDemand, scatterTrees, buildTreeMeshes } from './osm/trees.js';

// Açık "gerçek dünya": anahtar gerektirmeyen ücretsiz kaynaklar.
//  - Arazi: AWS Terrain Tiles (Terrarium PNG, Mapzen), z14
//  - Zemin, binalar, ağaçlar: OpenFreeMap vektör karoları (OpenMapTiles şeması, OSM verisi)
// Seçilen nokta 0,0'da, zemin y≈0, -z kuzey, +x doğu (Google dünyasıyla aynı çerçeve).

// radius: pencere yarıçapı (m, z14 karolarına yuvarlanır); seg: karo başına arazi bölümü;
// near/far: yakın/uzak karo dokusu (px); trees: ağaç üst sınırı
export const OSM_QUALITY = {
  normal: { radius: 1300, seg: 64, near: 2048, far: 1024, trees: 9000 },
  high: { radius: 1700, seg: 128, near: 2048, far: 1024, trees: 18000 },
  ultra: { radius: 2300, seg: 128, near: 2048, far: 2048, trees: 30000 },
};
export const OSM_CREDITS = 'OpenFreeMap © OpenMapTiles · Data © OpenStreetMap contributors · Terrain: Mapzen/AWS';
export const SAT_CREDITS = 'Imagery © Esri, Vantor, Earthstar Geographics, GIS User Community · © OpenMapTiles · © OpenStreetMap contributors · Terrain: Mapzen/AWS';
// Uydu görüntüsü: Esri World Imagery önbellekli XYZ karoları ({z}/{y}/{x})
const IMG_TILE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';

const NEAR_TEX = 700; // başlangıca bu kadar yakın karolar yüksek çözünürlüklü doku alır (m)

// Yakından bakınca zemin dokusu bulanık kalmasın: 4 m'de bir tekrar eden gri gürültü
function detailTexture(R) {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(160,160,160)';
  g.fillRect(0, 0, N, N);
  for (let i = 0; i < 2200; i++) {
    const v = R() < 0.5 ? 120 + R() * 30 : 180 + R() * 40;
    g.fillStyle = `rgba(${v},${v},${v},0.6)`;
    g.fillRect(R() * N, R() * N, 1 + R() * 3, 1 + R() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function buildOsmWorld(scene, renderer, camera, { lat, lon, quality = 'high', imagery = false }) {
  const Q = OSM_QUALITY[quality] ?? OSM_QUALITY.high;
  const R = rng(Math.round(lat * 1e4) * 31 + Math.round(lon * 1e4));
  const fogFar = Q.radius * 2.6;
  addSky(scene, Q.radius * 0.55, fogFar);
  camera.far = Math.max(camera.far, fogFar * 1.6);
  camera.updateProjectionMatrix();

  const frame = makeFrame(lat, lon);
  const win = frame.tilesAround(Q.radius);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  // ham yerel çerçeve (deniz seviyesi yükseklikleri) → holder kaydırması ile dünya çerçevesi
  const holder = new THREE.Group();
  holder.name = 'osm-world';
  scene.add(holder);
  const shift = holder.position; // dünya = ham + shift

  const state = {
    phase: 'yükleniyor', // yükleniyor | zemin | hazır | hata
    stage: 'A',
    error: null,
    connected: false,
    fetched: 0,
    built: 0,
    disposed: false,
    ms: {},
    spot: null,
  };
  const totalFetch = win.list.length * 2;
  const tiles = new Map(); // "x/y" → { data, mesh, ... }
  const index = new BuildingIndex();
  let hf = null;
  let treeCount = 0;
  const treeMeshes = [];

  const detail = detailTexture(R);
  detail.anisotropy = maxAniso;
  const plainGround = new THREE.MeshLambertMaterial({ color: 0x99a374 });
  // uydu modunda binalar pencere dokusu olmadan sade (zemin gerçek fotoğraf, tekrar eden pencereler sırıtıyordu)
  const buildingMat = imagery
    ? new THREE.MeshLambertMaterial({ vertexColors: true })
    : new THREE.MeshLambertMaterial({ vertexColors: true, map: facadeTexture(maxAniso) });
  const detailRepeat = frame.tileM / 4;
  function groundMaterial(tex) {
    const m = new THREE.MeshLambertMaterial({ map: tex });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.detailMap = { value: detail };
      sh.uniforms.detailRepeat = { value: detailRepeat };
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;\nuniform float detailRepeat;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>\ndiffuseColor.rgb *= mix(1.0, texture2D(detailMap, vMapUv * detailRepeat).r * 1.6, ${imagery ? '0.12' : '0.45'});`,
        );
    };
    m.customProgramCacheKey = () => (imagery ? 'osm-ground-sat' : 'osm-ground');
    return m;
  }

  const tileKey = (x, y) => `${x}/${y}`;

  async function start() {
    const t0 = performance.now();
    try {
      // TileJSON kuyrukta ilk sırada; arazi ve vektör karoları aynı 4'lü kuyruğu paylaşır
      const tplP = vectorTemplate().then((tpl) => {
        state.connected = true;
        return tpl;
      });
      const terrP = loadTerrain(frame, win, () => state.fetched++);
      const vecP = tplP.then((tpl) =>
        Promise.all(
          win.list.map((t) =>
            loadVectorTile(tpl, frame.z, t.x, t.y).then((data) => {
              state.fetched++;
              return data;
            }),
          ),
        ),
      );
      vecP.catch(() => {}); // arazi beklenirken düşen hata aşağıda yakalanır

      const src = await terrP;
      if (state.disposed) return;
      state.ms.terrain = Math.round(performance.now() - t0);
      hf = makeHeightField(frame, win, src, Q.seg);
      shift.set(0, -hf.heightAt(0, 0), 0);
      holder.updateMatrixWorld(true);
      for (const t of win.list) {
        const mesh = new THREE.Mesh(tileTerrainGeometry(hf, t.x, t.y), plainGround);
        mesh.name = 'osm-terrain';
        mesh.matrixAutoUpdate = false;
        mesh.receiveShadow = true;
        holder.add(mesh);
        tiles.set(tileKey(t.x, t.y), { ...t, mesh, data: null, waterBoxes: [] });
      }
      const skirt = skirtGeometry(hf, fogFar * 1.4);
      const skirtMesh = new THREE.Mesh(skirt.geometry, new THREE.MeshLambertMaterial({ color: 0x8e9a6c }));
      skirtMesh.name = 'osm-skirt';
      holder.add(skirtMesh);
      state.stage = 'B';
      state.phase = 'zemin';

      const datas = await vecP;
      if (state.disposed) return;
      state.ms.vector = Math.round(performance.now() - t0);
      win.list.forEach((t, i) => (tiles.get(tileKey(t.x, t.y)).data = datas[i]));

      // ağaç bütçesi: tüm pencerenin talebi üst sınıra ölçeklenir
      let demand = 0;
      for (const d of datas) demand += treeDemand(d, frame.tileM);
      const factor = Math.min(1, Q.trees / Math.max(1, demand));

      // 1) büyük yapıların altı düzlenir: DEM bir yüzey modelidir, stadyum/Kolezyum gibi yapılar
      //    tümsek olarak gelir ve çatıyı deler ya da iç avluyu yükseltir. İz altı tabana indirilir.
      const foot = [];
      for (const t of win.list) {
        const b = buildTileBuildings(tiles.get(tileKey(t.x, t.y)).data, { frame, tx: t.x, ty: t.y, heightAt: hf.heightAt, footprintsOnly: true });
        foot.push(...b.records, ...b.outlines);
      }
      if (flattenUnder(foot)) {
        for (const tile of tiles.values()) {
          tile.mesh.geometry.dispose();
          tile.mesh.geometry = tileTerrainGeometry(hf, tile.x, tile.y);
        }
        shift.y = -hf.heightAt(0, 0);
        holder.updateMatrixWorld(true);
      }
      await breathe();
      // 2) binalar (taban = düzlenmiş arazide iz altındaki en düşük nokta)
      for (const t of win.list) {
        if (state.disposed) return;
        buildTileBuildings_(tiles.get(tileKey(t.x, t.y)));
        state.built += 0.5;
        await breathe();
      }
      // 3) zemin dokusu + ağaçlar
      for (const t of win.list) {
        if (state.disposed) return;
        buildTileGround(tiles.get(tileKey(t.x, t.y)), factor);
        state.built += 0.5;
        await breathe();
      }
      pickOpenSpot();
      // uydu: yakın karoların fotoğrafı inmeden başlatma (en çok 15 sn)
      if (imagery) {
        state.phase = 'detay';
        const near = win.list.map((t) => tiles.get(tileKey(t.x, t.y))).filter((t) => t.near < NEAR_TEX);
        await Promise.race([Promise.all(near.map((t) => t.imgPromise)), new Promise((r) => setTimeout(r, 15000))]);
      }
      state.ms.ready = Math.round(performance.now() - t0);
      state.phase = 'hazır';
    } catch (e) {
      console.error('[osm]', e);
      state.phase = 'hata';
      state.error = String(e?.message || e);
    }
  }

  function buildTileBuildings_(tile) {
    const t0 = performance.now();
    const b = buildTileBuildings(tile.data, { frame, tx: tile.x, ty: tile.y, heightAt: hf.heightAt });
    for (const r of b.records) index.add(r);
    if (b.geometry) {
      const m = new THREE.Mesh(b.geometry, buildingMat);
      m.name = 'osm-buildings';
      m.matrixAutoUpdate = false;
      m.castShadow = m.receiveShadow = true;
      holder.add(m);
      tile.buildings = m;
    }
    tile.ms = Math.round(performance.now() - t0);
  }

  // Büyük yapıların çevresinde DEM tümseği: 200 m pencereli açma (yalnız yapı kutusu ±60 m'de,
  // dışa doğru yumuşak geçiş; doğal tepeler etkilenmez). İz içi ayrıca tabana indirilir.
  const BIG = 1200; // m²
  const REACH = 60; // m
  function flattenUnder(list) {
    const { h, VW, VH, cell, X0, Z0 } = hf;
    const big = list.filter((r) => r.area >= BIG && r.bottom < -1e8);
    if (!big.length) return false;
    const open = new Float32Array(h);
    const k = Math.max(1, Math.round(100 / cell));
    morph(open, VW, VH, k, Math.min);
    morph(open, VW, VH, k, Math.max);
    let changed = 0;
    for (const r of big) {
      const i0 = Math.max(0, Math.ceil((r.minx - REACH - X0) / cell));
      const i1 = Math.min(VW - 1, Math.floor((r.maxx + REACH - X0) / cell));
      const j0 = Math.max(0, Math.ceil((r.minz - REACH - Z0) / cell));
      const j1 = Math.min(VH - 1, Math.floor((r.maxz + REACH - Z0) / cell));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = X0 + i * cell;
          const z = Z0 + j * cell;
          const q = j * VW + i;
          const dx = Math.max(r.minx - x, 0, x - r.maxx);
          const dz = Math.max(r.minz - z, 0, z - r.maxz);
          let t = Math.min(1, Math.hypot(dx, dz) / REACH);
          t = t * t * (3 - 2 * t);
          let v = Math.min(h[q], open[q] + (h[q] - open[q]) * t);
          if (t === 0 && pointInRing(r.rings[0], x, z)) v = Math.min(v, r.base);
          if (v < h[q] - 0.01) {
            h[q] = v;
            changed++;
          }
        }
      }
    }
    state.flattened = changed;
    return changed > 0;
  }

  function placeholder() {
    const c = document.createElement('canvas');
    c.width = c.height = 4;
    const g = c.getContext('2d');
    g.fillStyle = '#7d8270';
    g.fillRect(0, 0, 4, 4);
    return c;
  }
  state.img = { done: 0, near: 0, nearDone: 0 };
  // Uydu fotoğrafı: Esri'nin önbellekli 256 px karoları paralel indirilip z14 karosu başına tek tuvalde
  // birleştirilir (tek büyük 'export' isteği 4096 px'te ~22 sn sürüyordu). Başlangıç karosu z18
  // (16×16 = 4096 px, ~0,37 m/px), yakınlar z17 (2048 px), uzaklar z16 (1024 px).
  const queue = [];
  let active = 0;
  const LIMIT = 16;
  function pump() {
    while (active < LIMIT && queue.length) {
      const job = queue.shift();
      active++;
      job().finally(() => {
        active--;
        pump();
      });
    }
  }
  const enqueue = (fn) =>
    new Promise((res) => {
      queue.push(() => fn().then(res, () => res(null)));
      pump();
    });
  async function fetchTileImg(z, x, y) {
    for (let attempt = 0; attempt < 3 && !state.disposed; attempt++) {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = `${IMG_TILE}/${z}/${y}/${x}`;
        await img.decode();
        return img;
      } catch {
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
    return null;
  }
  async function loadImagery(tile) {
    const isNear = tile.near < NEAR_TEX;
    const zoom = tile.near === 0 ? 18 : isNear ? 17 : 16;
    const k = 2 ** (zoom - frame.z);
    const px = 256 * k;
    if (isNear) state.img.near++;
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const g = c.getContext('2d');
    g.fillStyle = '#7d8270';
    g.fillRect(0, 0, px, px);
    const jobs = [];
    for (let j = 0; j < k; j++) {
      for (let i = 0; i < k; i++) {
        jobs.push(
          enqueue(() => fetchTileImg(zoom, tile.x * k + i, tile.y * k + j)).then((img) => {
            if (img) g.drawImage(img, i * 256, j * 256);
          }),
        );
      }
    }
    await Promise.all(jobs);
    if (state.disposed) return;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.anisotropy = maxAniso;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const old = tile.mesh.material.map;
    tile.mesh.material.map = tex;
    old?.dispose();
    state.img.done++;
    if (isNear) state.img.nearDone++;
  }

  function buildTileGround(tile, factor) {
    const { data, x: tx, y: ty } = tile;
    const t0 = performance.now();
    const place = (u, v) => {
      const x = frame.x(tx + u);
      const z = frame.zz(ty + v);
      return { x, y: hf.heightAt(x, z), z };
    };
    // ağaçlar (maske: yol, su, bina dışında)
    const mask = paintMask(data, frame.tileM);
    const trees = scatterTrees(data, { tileM: frame.tileM, mask, R, factor });
    // zemin dokusu (uydu modunda gri yer tutucu; fotoğraf ayrıca iner)
    const px = tile.near < NEAR_TEX ? Q.near : Q.far;
    const canvas = imagery ? placeholder() : paintGround(data, { px, tileM: frame.tileM, R, tx, ty, trees });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.anisotropy = maxAniso;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tile.mesh.material = groundMaterial(tex);
    if (imagery) tile.imgPromise = loadImagery(tile);
    for (const m of buildTreeMeshes(trees, place)) {
      m.name = 'osm-trees';
      m.matrixAutoUpdate = false;
      m.castShadow = true;
      holder.add(m);
      treeMeshes.push(m);
    }
    treeCount += trees.length;
    // su poligonları: hızlı kutu ön elemesi için
    tile.waterBoxes = data.water.map((w) => ({ poly: w.poly, box: ringBox(w.poly[0]) }));
    tile.ms = (tile.ms || 0) + Math.round(performance.now() - t0);
  }

  // Başlangıç bir binanın içine düştüyse (adres çoğu zaman çatıdadır) 200 m içindeki en yakın
  // açık noktaya kaydır: binalardan 4 m uzak, suda değil.
  function pickOpenSpot() {
    const blocked = (x, z) => {
      const list = index.query(x - 4, z - 4, x + 4, z + 4, _cand);
      for (const r of list) {
        if (r.top - r.base < 2.5) continue;
        if (insideBuilding(r, x, z) || nearestEdge(r, x, z).d < 4) return true;
      }
      return waterAtRaw(x, z);
    };
    const inside = index.query(-1, -1, 1, 1, _cand).some((r) => r.top - r.base >= 2.5 && insideBuilding(r, 0, 0));
    if (!inside) return;
    for (let d = 4; d <= 200; d += 4) {
      const n = Math.max(8, Math.round((d * Math.PI * 2) / 6));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        if (blocked(x, z)) continue;
        shift.set(-x, -hf.heightAt(x, z), -z);
        holder.updateMatrixWorld(true);
        state.spot = { x: +x.toFixed(1), z: +z.toFixed(1) };
        return;
      }
    }
  }

  // ---- sorgular (dünya çerçevesi → ham)
  const _cand = [];

  function waterAtRaw(x, z) {
    const fx = frame.tx0 + x / frame.tileM;
    const fy = frame.ty0 + z / frame.tileM;
    const tile = tiles.get(tileKey(Math.floor(fx), Math.floor(fy)));
    if (!tile?.waterBoxes.length) return false;
    const u = fx - tile.x;
    const v = fy - tile.y;
    for (const w of tile.waterBoxes) {
      if (u < w.box.x0 || u > w.box.x1 || v < w.box.y0 || v > w.box.y1) continue;
      if (pointInPoly(w.poly, u, v)) return true;
    }
    return false;
  }

  // Yer yüksekliği: arazi; bir binanın üstündeysek çatı
  function groundAt(x, z, y) {
    if (!hf) return 0;
    const rx = x - shift.x;
    const rz = z - shift.z;
    let g = hf.heightAt(rx, rz);
    if (index.list.length) {
      const ry = y - shift.y;
      for (const r of index.query(rx, rz, rx, rz, _cand)) {
        if (r.top > g && ry >= r.top - 0.75 && insideBuilding(r, rx, rz)) g = r.top;
      }
    }
    return g + shift.y;
  }

  // Küre (p, r) binalardan dışarı itilir; hız normal yönde sıfırlanır (world.js ile aynı sözleşme)
  function resolve(p, v, r) {
    if (!index.list.length) return null;
    let impact = null;
    const hit = (nx, ny, nz, depth) => {
      p.x += nx * depth;
      p.y += ny * depth;
      p.z += nz * depth;
      const vn = v.x * nx + v.y * ny + v.z * nz;
      const speed = vn < 0 ? -vn : 0;
      if (vn < 0) {
        v.x -= vn * nx;
        v.y -= vn * ny;
        v.z -= vn * nz;
      }
      if (!impact || speed > impact.speed) impact = { speed, kind: 'building', top: ny > 0.7 };
    };
    const list = index.query(p.x - shift.x - r, p.z - shift.z - r, p.x - shift.x + r, p.z - shift.z + r, _cand);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const rx = p.x - shift.x;
      const ry = p.y - shift.y;
      const rz = p.z - shift.z;
      if (ry - r > b.top || ry + r < b.bottom) continue;
      const q = nearestEdge(b, rx, rz);
      const d = q.d;
      if (insideBuilding(b, rx, rz)) {
        // içeride: en kısa çıkış (çatıya, yandan, köprü altından)
        const up = b.top + r - ry;
        let side = d + r;
        const down = b.bottom > -1e8 ? ry + r - b.bottom : Infinity;
        // bitişik nizam: yandan çıkış komşu binaya düşüyorsa o yol kapalı
        if (side < up && d > 1e-6 && insideOther(b, rx + ((q.x - rx) / d) * side, rz + ((q.z - rz) / d) * side, ry)) side = Infinity;
        if (up <= side && up <= down) hit(0, 1, 0, up);
        else if (down < side) hit(0, -1, 0, down);
        else if (d > 1e-6) hit((q.x - rx) / d, 0, (q.z - rz) / d, side);
        else hit(1, 0, 0, side);
        continue;
      }
      if (d >= r) continue;
      if (ry <= b.top && ry >= b.bottom) {
        if (d > 1e-6) hit((rx - q.x) / d, 0, (rz - q.z) / d, r - d);
        continue;
      }
      // çatı / taban kenarı: köşeden küresel itme
      const dy = ry > b.top ? ry - b.top : ry - b.bottom;
      const dist = Math.hypot(d, dy);
      if (dist < r && dist > 1e-6) hit((rx - q.x) / dist, dy / dist, (rz - q.z) / dist, r - dist);
    }
    return impact;
  }

  const _cand2 = [];
  function insideOther(self, x, z, ry) {
    for (const o of index.query(x, z, x, z, _cand2)) {
      if (o !== self && ry < o.top && ry > o.bottom && insideBuilding(o, x, z)) return true;
    }
    return false;
  }

  function isWater(x, z) {
    return waterAtRaw(x - shift.x, z - shift.z);
  }

  function setQuality(q) {
    const want = (OSM_QUALITY[q] ?? Q).trees;
    const frac = Math.min(1, want / Q.trees);
    for (const m of treeMeshes) m.count = Math.max(0, Math.floor(m.userData.full * frac));
  }

  function stats() {
    return {
      phase: state.phase,
      progress: +progress().toFixed(2),
      tiles: win.list.length,
      requests: net.requests,
      failed: net.failed,
      retries: net.retries,
      kb: Math.round(net.bytes / 1024),
      buildings: index.list.length,
      trees: treeCount,
      shift: shift.toArray().map((v) => +v.toFixed(1)),
      flattened: state.flattened,
      spot: state.spot,
      ms: state.ms,
      tileMs: [...tiles.values()].map((t) => t.ms ?? null),
      error: state.error,
    };
  }

  const progress = () => (state.fetched + state.built) / (totalFetch + win.list.length);

  function dispose() {
    state.disposed = true;
    scene.remove(holder);
    holder.traverse((o) => {
      if (o.geometry && !o.isInstancedMesh) o.geometry.dispose();
      if (o.material?.map) o.material.map.dispose();
      if (o.isInstancedMesh) o.dispose();
    });
  }

  start();

  return {
    kind: imagery ? 'sat' : 'osm',
    get ready() {
      return state.phase === 'hazır';
    },
    get phase() {
      return state.phase;
    },
    get stage() {
      return state.stage;
    },
    get error() {
      return state.error;
    },
    get progress() {
      return progress();
    },
    // yükleme ekranı için 0..1 aşama bilgisi
    get loading() {
      return {
        connected: state.connected,
        tiles: state.fetched / totalFetch,
        ground:
          state.phase === 'hazır' || state.phase === 'detay' ? 1 : state.stage === 'B' ? 0.5 + 0.5 * (state.built / win.list.length) : 0,
        ...(imagery ? { detail: state.phase === 'hazır' ? 1 : state.img.near ? Math.min(0.97, state.img.nearDone / state.img.near) : 0 } : {}),
      };
    },
    rings: [],
    mapData: { houses: [], trees: [], rings: [] },
    course: { next: 0, startAt: null, lastTime: null },
    towerLight: null,
    holder,
    resolve,
    groundAt,
    resetSweep: () => {},
    isWater,
    checkRings: () => null,
    resetCourse: () => {},
    update: () => {},
    credits: () => (imagery ? SAT_CREDITS : OSM_CREDITS),
    stats,
    setQuality,
    dispose,
    // deneme sayfası için iç yapılar
    _debug: { index, frame, win, tiles, get hf() { return hf; } },
  };
}
