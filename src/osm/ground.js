// Zemin dokusu: OpenMapTiles vektör karosu tuvale çizilir (su, örtü, kullanım, yol, bina izi).
// Doğal ama hafif stilize renkler; gürültü katmanları düzlüğü kırar. Bina ve ağaç gölgeleri
// main.js'teki güneş yönüyle (SUN_DIR) uyumlu olarak dokuya pişirilir.

// main.js SUN_DIR (-0.45, 0.8, 0.35): gölge güneşin tersine, yatayda yükseklik başına bu kadar kayar
export const SHADOW = { x: 0.45 / 0.8, z: -0.35 / 0.8 };

const BASE = '#98a07b';

const LANDCOVER = {
  farmland: ['#c4b981', '#adb06c', '#bba872', '#a9a463', '#c9bf8c'],
  wood: '#4f733a',
  grass: '#88a462',
  wetland: '#7f9a72',
  sand: '#d9cda2',
  rock: '#a9a397',
  ice: '#eef2f3',
};
const LANDCOVER_SUB = {
  scrub: '#7a9256', heath: '#93986a', allotments: '#9cae6b', flowerbed: '#a4b36a', golf_course: '#86b05a',
  park: '#89ad5f', garden: '#93ad66', beach: '#ddd0a4', bare_rock: '#a39d92', scree: '#aaa598',
};
const LANDUSE = {
  residential: '#b8b1a4', suburb: '#b8b1a4', neighbourhood: '#b8b1a4', quarter: '#b8b1a4',
  commercial: '#bdb3a6', retail: '#c0b5a7', industrial: '#aea89e', garages: '#aaa59c', railway: '#a7a093',
  cemetery: '#8fa676', hospital: '#bfb5a8', school: '#bdb4a6', university: '#bdb4a6', college: '#bdb4a6',
  kindergarten: '#bdb4a6', library: '#bdb4a6', stadium: '#b2ac9f', pitch: '#6c9d52', track: '#b7765c',
  playground: '#b5ad86', theme_park: '#a4ad78', zoo: '#a4ad78', park: '#8aad60', military: '#ada897',
  quarry: '#bdb6a5', dam: '#b5afa3', pier: '#b5ada0', bus_station: '#a9a49c', retail_park: '#c0b5a7',
};
// yol genişliği (m) ve renk
const ROAD = {
  motorway: [20, '#5d5f62'], trunk: [16, '#606265'], primary: [13, '#636567'], secondary: [11, '#65676a'],
  tertiary: [9, '#68696b'], minor: [7, '#6b6c6d'], service: [4.5, '#727272'], raceway: [10, '#5f6062'],
  busway: [7, '#6b6c6d'], track: [3, '#a58f6b'], path: [1.8, '#c8bb9e'], bridge: [6, '#6b6c6d'],
  rail: [3.2, '#6c6760'], transit: [3, '#6c6760'], ferry: [0, null], pier: [3, '#b4ab9c'],
};
const SIDEWALK = { primary: 1, secondary: 1, tertiary: 1, minor: 1, trunk: 0.6 };
const WATER = '#456f8c';
const WATERWAY = { river: 14, canal: 10, stream: 3, drain: 1.6, ditch: 1.4 };

const pick = (v, k) => (Array.isArray(v) ? v[k % v.length] : v);

// Basit karma: poligonun ilk köşesinden kararlı sayı (karo sınırında aynı renk kalsın diye
// yalnız kendi geometrisinden)
const hashPoly = (r) => {
  const a = Math.round(r[0] * 4096) * 73856093;
  const b = Math.round(r[1] * 4096) * 19349663;
  return Math.abs((a ^ b) | 0);
};

function tracePoly(g, poly, S) {
  for (const r of poly) {
    g.moveTo(r[0] * S, r[1] * S);
    for (let i = 2; i < r.length; i += 2) g.lineTo(r[i] * S, r[i + 1] * S);
    g.closePath();
  }
}

function traceLine(g, l, S) {
  g.moveTo(l[0] * S, l[1] * S);
  for (let i = 2; i < l.length; i += 2) g.lineTo(l[i] * S, l[i + 1] * S);
}

function fillPoly(g, poly, S, color) {
  g.fillStyle = color;
  g.beginPath();
  tracePoly(g, poly, S);
  g.fill('evenodd');
}

const mk = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h ?? w;
  return c;
};

// ortak gürültü kaynakları (bir kez üretilir)
let noiseFine = null;
let stripes = null;
function noiseSources(R) {
  if (noiseFine) return;
  noiseFine = mk(256);
  let g = noiseFine.getContext('2d');
  let img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (R() - 0.5) * 90;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // tarla sıraları: koyu ince çizgi
  stripes = mk(1, 6);
  g = stripes.getContext('2d');
  g.fillStyle = 'rgba(60,50,25,0.55)';
  g.fillRect(0, 0, 1, 2);
  g.fillStyle = 'rgba(255,250,220,0.18)';
  g.fillRect(0, 3, 1, 1);
}

// Geniş leke gürültüsü: küresel kafes noktalarından (karo kenarında komşuyla aynı değer, dikiş yok).
// Kafes aralığı karo/CN; tuval CN+1 nokta, çizimde yarım hücre taşırılır ki merkezler kafese otursun.
const CN = 48;
function coarseNoise(tx, ty) {
  const c = mk(CN + 1);
  const g = c.getContext('2d');
  const img = g.createImageData(CN + 1, CN + 1);
  for (let j = 0; j <= CN; j++) {
    for (let i = 0; i <= CN; i++) {
      let h = Math.imul((tx * CN + i) | 0, 374761393) + Math.imul((ty * CN + j) | 0, 668265263);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      const r = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
      const v = 128 + (r - 0.5) * 120;
      const o = (j * (CN + 1) + i) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
const drawCoarse = (g, c, px) => {
  const cell = px / CN;
  g.drawImage(c, -cell / 2, -cell / 2, px + cell, px + cell);
};

// Ağaç/engel maskesi: düşük çözünürlük, 255 = boş zemin. Su, yol, ray ve binalar dolu.
export function paintMask(data, tileM, N = 512) {
  const c = mk(N);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff';
  g.fillRect(0, 0, N, N);
  const S = N;
  const m = N / tileM;
  g.fillStyle = '#000';
  g.strokeStyle = '#000';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  for (const w of data.water) tracePoly(g, w.poly, S);
  for (const b of data.buildings) tracePoly(g, b.poly, S);
  for (const a of data.areas) tracePoly(g, a.poly, S);
  for (const a of data.aeroway) if (a.poly) tracePoly(g, a.poly, S);
  g.fill('nonzero');
  for (const r of data.roads) {
    const spec = ROAD[r.cls];
    if (!spec || !spec[0]) continue;
    g.lineWidth = Math.max(1, (spec[0] + 3) * m);
    g.beginPath();
    traceLine(g, r.line, S);
    g.stroke();
  }
  for (const w of data.waterways) {
    g.lineWidth = Math.max(1, ((WATERWAY[w.cls] || 2) + 2) * m);
    g.beginPath();
    traceLine(g, w.line, S);
    g.stroke();
  }
  const d = g.getImageData(0, 0, N, N).data;
  const out = new Uint8Array(N * N);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4];
  return { N, data: out, free: (u, v) => out[Math.min(N - 1, Math.max(0, (v * N) | 0)) * N + Math.min(N - 1, Math.max(0, (u * N) | 0))] > 128 };
}

// Ana zemin dokusu. trees: [{u, v, r, h}] gölge için (karo biriminde konum, metre ölçü)
export function paintGround(data, { px, tileM, R, tx, ty, trees = [], buildingsBase = null }) {
  noiseSources(R);
  const coarse = coarseNoise(tx, ty);
  const c = mk(px);
  const g = c.getContext('2d');
  const S = px;
  const m = px / tileM; // metre → piksel
  g.lineCap = 'round';
  g.lineJoin = 'round';

  g.fillStyle = BASE;
  g.fillRect(0, 0, px, px);

  // kullanım alanları (geniş) önce, örtü üstte
  const order = (cls) => (cls === 'residential' || cls === 'suburb' || cls === 'neighbourhood' ? 0 : 1);
  const lu = [...data.landuse].sort((a, b) => order(a.cls) - order(b.cls));
  for (const l of lu) {
    const col = LANDUSE[l.cls];
    if (col) fillPoly(g, l.poly, S, col);
  }
  for (const l of data.landcover) {
    const col = LANDCOVER_SUB[l.sub] || LANDCOVER[l.cls];
    if (!col) continue;
    const k = hashPoly(l.poly[0]);
    fillPoly(g, l.poly, S, pick(col, k));
    if (l.cls === 'farmland') {
      // ekin sıraları: tarla başına rastgele yön
      const pat = g.createPattern(stripes, 'repeat');
      const a = ((k % 180) * Math.PI) / 180;
      const sc = Math.max(0.35, 2.6 * m / 6);
      pat.setTransform(new DOMMatrix().rotateSelf((a * 180) / Math.PI).scaleSelf(sc, sc));
      g.globalAlpha = 0.35;
      fillPoly(g, l.poly, S, pat);
      g.globalAlpha = 1;
    }
    if (l.cls === 'wood') {
      // orman tabanı: koyu lekeler
      g.save();
      g.beginPath();
      tracePoly(g, l.poly, S);
      g.clip('evenodd');
      g.globalAlpha = 0.5;
      g.globalCompositeOperation = 'multiply';
      g.imageSmoothingEnabled = true;
      drawCoarse(g, coarse, px);
      g.restore();
    }
  }
  // spor sahası çizgileri
  for (const l of data.landuse) {
    if (l.cls !== 'pitch') continue;
    g.strokeStyle = 'rgba(245,245,235,0.55)';
    g.lineWidth = Math.max(1, 0.25 * m);
    g.beginPath();
    tracePoly(g, l.poly, S);
    g.stroke();
  }

  // su
  for (const w of data.water) fillPoly(g, w.poly, S, w.cls === 'swimming_pool' ? '#5fa9c2' : WATER);
  g.strokeStyle = WATER;
  for (const w of data.waterways) {
    const wm = WATERWAY[w.cls];
    if (!wm) continue;
    g.lineWidth = Math.max(1, wm * m);
    g.beginPath();
    traceLine(g, w.line, S);
    g.stroke();
  }
  // kıyı: açık ince kenar
  g.strokeStyle = 'rgba(190,200,180,0.35)';
  g.lineWidth = Math.max(1, 1.2 * m);
  for (const w of data.water) {
    if (w.cls === 'swimming_pool') continue;
    g.beginPath();
    tracePoly(g, w.poly, S);
    g.stroke();
  }

  // yaya alanları, iskeleler, köprü alanları
  for (const a of data.areas) {
    const col = a.cls === 'pier' ? '#b4ab9c' : a.cls === 'bridge' ? '#8d8b87' : '#c3bcb0';
    fillPoly(g, a.poly, S, col);
  }
  // havaalanı
  for (const a of data.aeroway) {
    const col = a.cls === 'runway' ? '#6c6d6f' : a.cls === 'taxiway' ? '#77787a' : a.cls === 'apron' ? '#9a9a98' : '#8a8b8c';
    if (a.poly) fillPoly(g, a.poly, S, col);
    else {
      g.strokeStyle = col;
      g.lineWidth = Math.max(1, (a.cls === 'runway' ? 45 : 18) * m);
      g.beginPath();
      traceLine(g, a.line, S);
      g.stroke();
    }
  }

  // yollar: önce kaldırım/kenar, sonra asfalt, sonra şerit çizgisi; köprüler en üstte
  const roads = [...data.roads].sort((a, b) => (a.bridge ? 1 : 0) - (b.bridge ? 1 : 0) || a.layer - b.layer);
  const roadSpec = (r) => {
    const s = ROAD[r.cls];
    if (!s || !s[0]) return null;
    if (r.cls === 'path') {
      const w = r.sub === 'cycleway' ? 2.2 : r.sub === 'steps' ? 2 : r.sub === 'pedestrian' ? 4 : 1.6;
      return [w, r.sub === 'cycleway' ? '#b6a693' : '#cbbfa3'];
    }
    if (r.unpaved && r.cls !== 'track') return [s[0] * 0.8, '#a69273'];
    return s;
  };
  for (const pass of [0, 1]) {
    for (const r of roads) {
      const s = roadSpec(r);
      if (!s) continue;
      if (pass === 0) {
        const side = SIDEWALK[r.cls];
        if (!side && !r.bridge) continue;
        g.strokeStyle = r.bridge ? 'rgba(40,40,40,0.55)' : '#bdb6aa';
        g.lineWidth = Math.max(1.5, (s[0] + (side ? side * 4 : 2)) * m);
      } else {
        g.strokeStyle = s[1];
        g.lineWidth = Math.max(1, s[0] * m);
      }
      g.beginPath();
      traceLine(g, r.line, S);
      g.stroke();
    }
  }
  // demiryolu traversleri ve yol şeritleri
  g.lineCap = 'butt';
  for (const r of roads) {
    if (r.cls === 'rail' || r.cls === 'transit') {
      g.strokeStyle = 'rgba(70,58,45,0.75)';
      g.lineWidth = Math.max(1, 2.6 * m);
      g.setLineDash([Math.max(1, 0.25 * m), Math.max(1, 0.45 * m)]);
      g.beginPath();
      traceLine(g, r.line, S);
      g.stroke();
      g.setLineDash([]);
    } else if (r.cls === 'motorway' || r.cls === 'trunk' || r.cls === 'primary' || r.cls === 'secondary') {
      g.strokeStyle = 'rgba(236,234,224,0.6)';
      g.lineWidth = Math.max(0.8, 0.18 * m);
      g.setLineDash([3 * m, 6 * m]);
      g.beginPath();
      traceLine(g, r.line, S);
      g.stroke();
      g.setLineDash([]);
    }
  }
  g.lineCap = 'round';

  // gölgeler: ayrı tuvalde birleşim, yarım çözünürlükte (yumuşak kenar), sonra çarpımla
  const sh = mk(px >> 1);
  const sg = sh.getContext('2d');
  const S2 = px >> 1;
  const m2 = m / 2;
  sg.fillStyle = '#000';
  for (const b of data.buildings) {
    if (b.hide) continue;
    const h = Math.max(3, b.h || 8);
    const steps = Math.min(10, Math.max(2, Math.ceil((h * 0.71) / 3)));
    const dx = (SHADOW.x * h) / tileM;
    const dy = (SHADOW.z * h) / tileM;
    sg.beginPath();
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      sg.save();
      sg.translate(dx * t * S2, dy * t * S2);
      tracePoly(sg, [b.poly[0]], S2);
      sg.restore();
    }
    sg.fill('nonzero');
  }
  sg.beginPath();
  for (const t of trees) {
    const r = t.r * m2 * 0.85;
    const x = (t.u + (SHADOW.x * t.h * 0.6) / tileM) * S2;
    const y = (t.v + (SHADOW.z * t.h * 0.6) / tileM) * S2;
    sg.moveTo(x + r, y);
    sg.ellipse(x, y, r, r * 0.9, 0, 0, Math.PI * 2);
  }
  sg.fill();
  g.save();
  g.globalAlpha = 0.32;
  g.imageSmoothingEnabled = true;
  g.filter = 'blur(1px)';
  g.drawImage(sh, 0, 0, px, px);
  g.restore();

  // bina tabanı (dokuda; 3B kütle zaten üstte). Kenarda hafif koyu çizgi: temas gölgesi
  g.fillStyle = buildingsBase || '#8b857d';
  g.beginPath();
  for (const b of data.buildings) tracePoly(g, b.poly, S);
  g.fill('nonzero');

  // gürültü: ince taneli + geniş lekeler (düz renk hissini kırar)
  g.save();
  g.globalCompositeOperation = 'overlay';
  g.globalAlpha = 0.16;
  g.fillStyle = g.createPattern(noiseFine, 'repeat');
  g.fillRect(0, 0, px, px);
  g.globalCompositeOperation = 'soft-light';
  g.globalAlpha = 0.45;
  g.imageSmoothingEnabled = true;
  drawCoarse(g, coarse, px);
  g.restore();
  return c;
}
