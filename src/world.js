import * as THREE from 'three';
import { makeTerrain } from './village/terrain.js';
import { mergeGeos, treeTypes, bushGeo, roofGeo } from './village/geo.js';
import { skyCanvas } from './village/sky.js';

// Deterministik rastgele: dünya her açılışta aynı.
export function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Koordinatlar metre. Ev (kalkış pisti) 0,0. -z kuzey, +x doğu.
const SIZE = 1000;
export const ROAD_Z = 24;
export const VROAD_X = 150;
export const LAKE = { x: 40, z: 210, rx: 95, rz: 60 };
export const TOWER = { x: -260, z: -320, h: 70 };
const FOREST = { x: -220, z: -170, r: 130 };
const FARM = { x: -60, z: 60 };
// köy merkezi (avlu dokusuyla aynı dikdörtgen)
const CORE = { x: 194.5, z: -154.5, hw: 92, hd: 117 };
// main.js'teki SUN_DIR ile aynı olmalı (gökteki parıltı güneş ışığıyla tutarlı)
const SUN = new THREE.Vector3(-0.45, 0.8, 0.35).normalize();


export const FIELDS = [
  { x: -170, z: 110, w: 170, d: 120, rot: 0.08, color: '#b7a55c', row: 'rgba(95,75,30,0.28)' },
  { x: -360, z: 130, w: 140, d: 190, rot: -0.06, color: '#7b5c3d', row: 'rgba(45,30,18,0.35)' },
  { x: 310, z: 130, w: 190, d: 130, rot: 0.18, color: '#55802f', row: 'rgba(30,55,15,0.3)' },
  { x: 350, z: -340, w: 150, d: 150, rot: -0.12, color: '#c4b26b', row: 'rgba(100,80,35,0.25)' },
  { x: -40, z: -380, w: 220, d: 90, rot: 0.04, color: '#6d9140', row: 'rgba(35,60,20,0.3)' },
];

export const ROADS = [
  { x0: -500, z0: ROAD_Z, x1: 500, z1: ROAD_Z, w: 7, color: '#55575a', dash: true },
  { x0: VROAD_X, z0: ROAD_Z, x1: VROAD_X, z1: -500, w: 6, color: '#5a5c5f', dash: true },
  { x0: 0, z0: 4, x1: 0, z1: ROAD_Z, w: 3.5, color: '#9b8a68' },
];

// Arazi: yumuşak tepeler; pist, göl, yollar, köy merkezi ve çiftlik düz.
const terrain = makeTerrain({
  size: SIZE,
  lake: LAKE,
  roads: ROADS,
  flats: [{ x: FARM.x - 4, z: FARM.z, r: 34, blend: 40 }],
  rects: [{ ...CORE, blend: 45 }],
  grid: 80,
});
export const groundHeight = terrain.height;

const RING_PTS = [
  [0, 4, -45], [40, 8, -95], [95, 12, -120], [150, 25, -150],
  [110, 15, -255], [0, 10, -250], [-75, 7, -110], [-30, 3, -25],
];
const RING_R = 3.5;

function inField(x, z, m) {
  for (const f of FIELDS) {
    const dx = x - f.x;
    const dz = z - f.z;
    const a = dx * Math.cos(f.rot) + dz * Math.sin(f.rot);
    const b = -dx * Math.sin(f.rot) + dz * Math.cos(f.rot);
    if (Math.abs(a) < f.w / 2 + m && Math.abs(b) < f.d / 2 + m) return true;
  }
  return false;
}

export function isWater(x, z) {
  const a = (x - LAKE.x) / LAKE.rx;
  const b = (z - LAKE.z) / LAKE.rz;
  return a * a + b * b < 1;
}

function groundTexture(R, renderer) {
  const PX = 2048;
  const S = PX / SIZE;
  const X = (v) => (v + SIZE / 2) * S;
  const c = document.createElement('canvas');
  c.width = c.height = PX;
  const g = c.getContext('2d');

  g.fillStyle = '#5c7c3b';
  g.fillRect(0, 0, PX, PX);
  for (let i = 0; i < 30000; i++) {
    const light = R() < 0.5;
    g.fillStyle = light
      ? `rgba(130,150,80,${0.05 + R() * 0.08})`
      : `rgba(35,55,20,${0.05 + R() * 0.09})`;
    g.beginPath();
    g.arc(R() * PX, R() * PX, 0.6 + R() * 4, 0, Math.PI * 2);
    g.fill();
  }

  for (const f of FIELDS) {
    g.save();
    g.translate(X(f.x), X(f.z));
    g.rotate(f.rot);
    const w = f.w * S;
    const d = f.d * S;
    g.fillStyle = f.color;
    g.fillRect(-w / 2, -d / 2, w, d);
    g.strokeStyle = f.row;
    g.lineWidth = 1;
    for (let y = -d / 2 + 1; y < d / 2; y += 2.5) {
      g.beginPath();
      g.moveTo(-w / 2, y);
      g.lineTo(w / 2, y);
      g.stroke();
    }
    g.strokeStyle = 'rgba(60,70,30,0.6)';
    g.lineWidth = 2;
    g.strokeRect(-w / 2, -d / 2, w, d);
    g.restore();
  }

  // göl kıyısı, köy avlusu, pist çevresi
  g.fillStyle = '#b9ad84';
  g.beginPath();
  g.ellipse(X(LAKE.x), X(LAKE.z), (LAKE.rx + 6) * S, (LAKE.rz + 6) * S, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(150,150,120,0.30)';
  g.fillRect(X(112), X(-262), 165 * S, 215 * S);
  g.fillStyle = '#a49c86';
  g.beginPath();
  g.arc(X(0), X(0), 7 * S, 0, Math.PI * 2);
  g.fill();
  // çiftlik avlusu + ahırdan yola toprak yol
  g.fillStyle = 'rgba(150,128,90,0.5)';
  g.beginPath();
  g.ellipse(X(FARM.x - 2), X(FARM.z + 2), 24 * S, 30 * S, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(155,138,104,0.85)';
  g.lineWidth = 3 * S;
  g.beginPath();
  g.moveTo(X(FARM.x + 8), X(FARM.z));
  g.lineTo(X(-30), X(FARM.z));
  g.lineTo(X(-30), X(ROAD_Z));
  g.stroke();

  for (const r of ROADS) {
    g.strokeStyle = r.color;
    g.lineWidth = r.w * S;
    g.beginPath();
    g.moveTo(X(r.x0), X(r.z0));
    g.lineTo(X(r.x1), X(r.z1));
    g.stroke();
    if (r.dash) {
      g.strokeStyle = 'rgba(235,235,225,0.8)';
      g.lineWidth = 1;
      g.setLineDash([3 * S, 3 * S]);
      g.beginPath();
      g.moveTo(X(r.x0), X(r.z0));
      g.lineTo(X(r.x1), X(r.z1));
      g.stroke();
      g.setLineDash([]);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

// Yakından bakınca çim hissi: 2 m'de bir tekrarlanan gri gürültü, ana dokuyla çarpılır.
function detailTexture(R) {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(160,160,160)';
  g.fillRect(0, 0, N, N);
  for (let i = 0; i < 2600; i++) {
    const v = R() < 0.5 ? 110 + R() * 40 : 175 + R() * 50;
    g.strokeStyle = `rgba(${v},${v},${v},0.8)`;
    g.lineWidth = 1 + R();
    const x = R() * N;
    const y = R() * N;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (R() - 0.5) * 4, y - 3 - R() * 6);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function padTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#3a3d42';
  g.beginPath();
  g.arc(128, 128, 126, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#f2f2f2';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(128, 128, 104, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#f2f2f2';
  g.font = 'bold 130px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('H', 128, 136);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Duvar dokusu: iki kat pencere (kasa, kayıt, denizlik, isteğe bağlı panjur); ön yüzde kapı.
// Sıva lekeleri, saçak gölgesi ve alttaki kirlenme düz renk hissini kırar.
const TX = rng(77);
function canvasTex(c, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function wallTexture(color, { door = false, shutter = null, doorColor = '#6b4a2f' } = {}) {
  const W = 512;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = TX() < 0.5 ? `rgba(255,255,255,${0.03 + TX() * 0.05})` : `rgba(60,50,40,${0.03 + TX() * 0.05})`;
    g.fillRect(TX() * W, TX() * H, 1 + TX() * 4, 1 + TX() * 4);
  }
  const win = (cx, y, w, h) => {
    if (shutter) {
      g.fillStyle = shutter;
      g.fillRect(cx - w / 2 - w * 0.5, y - 2, w * 0.46, h + 4);
      g.fillRect(cx + w / 2 + w * 0.04, y - 2, w * 0.46, h + 4);
      g.fillStyle = 'rgba(0,0,0,0.2)';
      for (let k = y + 3; k < y + h; k += 5) {
        g.fillRect(cx - w / 2 - w * 0.5, k, w * 0.46, 1.5);
        g.fillRect(cx + w / 2 + w * 0.04, k, w * 0.46, 1.5);
      }
    }
    g.fillStyle = '#f2efe8';
    g.fillRect(cx - w / 2 - 3, y - 3, w + 6, h + 6);
    const gl = g.createLinearGradient(0, y, 0, y + h);
    gl.addColorStop(0, '#7890a3');
    gl.addColorStop(1, '#25303b');
    g.fillStyle = gl;
    g.fillRect(cx - w / 2, y, w, h);
    g.fillStyle = 'rgba(255,255,255,0.13)';
    g.beginPath();
    g.moveTo(cx - w / 2, y + h * 0.55);
    g.lineTo(cx - w / 2 + w * 0.45, y);
    g.lineTo(cx - w / 2 + w * 0.75, y);
    g.lineTo(cx - w / 2, y + h * 0.95);
    g.fill();
    g.fillStyle = '#f2efe8';
    g.fillRect(cx - 1.5, y, 3, h);
    g.fillRect(cx - w / 2, y + h * 0.36, w, 3);
    g.fillStyle = '#d6d2c8';
    g.fillRect(cx - w / 2 - 6, y + h + 3, w + 12, 5);
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.fillRect(cx - w / 2 - 6, y + h + 8, w + 12, 3);
  };
  if (door) {
    for (const x of [70, 163, 256, 349, 442]) win(x, 46, 40, 54);
    for (const x of [70, 163, 349, 442]) win(x, 140, 40, 56);
    // kapı: kasa, iki panel, kol, üstte küçük saçak
    const dx = 256;
    const dw = 50;
    const dy = 146;
    const dh = 96;
    g.fillStyle = '#e9e5dc';
    g.fillRect(dx - dw / 2 - 5, dy - 5, dw + 10, dh + 5);
    g.fillStyle = doorColor;
    g.fillRect(dx - dw / 2, dy, dw, dh);
    g.strokeStyle = 'rgba(0,0,0,0.28)';
    g.lineWidth = 2;
    g.strokeRect(dx - dw / 2 + 6, dy + 8, dw - 12, dh * 0.36);
    g.strokeRect(dx - dw / 2 + 6, dy + dh * 0.5, dw - 12, dh * 0.38);
    g.fillStyle = '#c9b77a';
    g.fillRect(dx + dw / 2 - 11, dy + dh * 0.47, 5, 5);
    g.fillStyle = '#55595e';
    g.fillRect(dx - dw / 2 - 16, dy - 16, dw + 32, 7);
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(dx - dw / 2 - 13, dy - 9, dw + 26, 5);
  } else {
    for (const x of [100, 256, 412]) {
      win(x, 46, 40, 54);
      win(x, 140, 40, 56);
    }
  }
  let gr = g.createLinearGradient(0, 0, 0, 24);
  gr.addColorStop(0, 'rgba(0,0,0,0.3)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, 24);
  gr = g.createLinearGradient(0, H - 36, 0, H);
  gr.addColorStop(0, 'rgba(70,60,45,0)');
  gr.addColorStop(1, 'rgba(70,60,45,0.28)');
  g.fillStyle = gr;
  g.fillRect(0, H - 36, W, 36);
  return canvasTex(c);
}

// Ahır: dikey tahtalar; ön yüzde büyük çift kanatlı kapı ve samanlık kapağı.
function barnTexture(front) {
  const W = 512;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#8e2f25';
  g.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x += 16) {
    g.fillStyle = `rgba(${TX() < 0.5 ? '255,255,255' : '0,0,0'},${0.03 + TX() * 0.06})`;
    g.fillRect(x, 0, 16, H);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(x, 0, 2, H);
  }
  const trim = (x, y, w, h) => {
    g.fillStyle = '#7a2820';
    g.fillRect(x, y, w, h);
    g.strokeStyle = '#e8e2d6';
    g.lineWidth = 7;
    g.strokeRect(x, y, w, h);
  };
  if (front) {
    trim(176, 78, 160, 182);
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(256, 78);
    g.lineTo(256, 256);
    for (const [a, b] of [[176, 256], [256, 336]]) {
      g.moveTo(a, 78);
      g.lineTo(b, 256);
      g.moveTo(b, 78);
      g.lineTo(a, 256);
    }
    g.stroke();
    trim(228, 16, 56, 44);
  } else {
    for (const x of [80, 200, 320, 440]) trim(x - 18, 70, 36, 30);
  }
  const gr = g.createLinearGradient(0, 0, 0, 24);
  gr.addColorStop(0, 'rgba(0,0,0,0.35)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, 24);
  return canvasTex(c);
}

// Kiremit: 1 m'lik tekrar eden doku, mahyaya paralel sıralar (renk malzemeden gelir).
function roofTexture() {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  g.fillStyle = '#e2e2e2';
  g.fillRect(0, 0, N, N);
  for (let i = 0; i < 4; i++) {
    const x = i * 32;
    const gr = g.createLinearGradient(x, 0, x + 32, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0.32)');
    gr.addColorStop(0.15, 'rgba(255,255,255,0.08)');
    gr.addColorStop(0.85, 'rgba(0,0,0,0.04)');
    gr.addColorStop(1, 'rgba(0,0,0,0.3)');
    g.fillStyle = gr;
    g.fillRect(x, 0, 32, N);
    g.fillStyle = 'rgba(0,0,0,0.2)';
    for (let y = (i % 2) * 12; y < N; y += 24) g.fillRect(x + 3, y, 26, 2);
  }
  for (let i = 0; i < 500; i++) {
    g.fillStyle = TX() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)';
    g.fillRect(TX() * N, TX() * N, 2 + TX() * 3, 2 + TX() * 3);
  }
  return canvasTex(c, true);
}

// Silo: oluklu galvaniz sac bantları
function siloTexture() {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 256;
  const g = c.getContext('2d');
  for (let y = 0; y < 256; y += 4) {
    g.fillStyle = (y / 4) % 2 ? '#c4c8cb' : '#aab0b4';
    g.fillRect(0, y, 16, 4);
  }
  for (let y = 0; y < 256; y += 40) {
    g.fillStyle = 'rgba(40,40,40,0.35)';
    g.fillRect(0, y, 16, 2);
  }
  return canvasTex(c);
}

function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#e9e9e9' : '#c8352b';
    g.fillRect(0, i * 16, 8, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Gökyüzü: dikey gradyan, ufukta sis rengiyle buluşur.
// extra = { sun: Vector3, clouds: sayı, random } verilirse güneş parıltısı ve bulutlar da boyanır.
export function addSky(scene, fogNear, fogFar, extra = null) {
  const HORIZON = '#cddfee';
  let c;
  if (extra) {
    c = skyCanvas({ horizon: HORIZON, sun: extra.sun, clouds: extra.clouds || 0, random: extra.random });
  } else {
    c = document.createElement('canvas');
    c.width = 4;
    c.height = 512;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#2a66b8');
    grad.addColorStop(0.32, '#7fb0e0');
    grad.addColorStop(0.5, HORIZON);
    grad.addColorStop(1, HORIZON);
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 512);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = t;
  scene.fog = new THREE.Fog(HORIZON, fogNear, fogFar);
}

export function buildWorld(scene, renderer) {
  const R = rng(20261003);
  const H = terrain.height;
  const boxes = [];
  const cyls = [];
  const mapData = { houses: [], trees: [], rings: [] };
  const std = (color, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  const v3 = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const eul = new THREE.Euler(0, 0, 0, 'YZX');

  addSky(scene, 280, 2300, { sun: SUN, clouds: 30, random: rng(4242) });

  // zemin: tepeli 1 km kare (12.5 m ızgara) + dışarıda düz çimen (üst üste binmesin diye delikli).
  // Arazi kenara doğru 0'a iner, dış halkayla dikişsiz birleşir.
  const groundMat = new THREE.MeshStandardMaterial({ map: groundTexture(R, renderer), roughness: 0.95 });
  const detail = detailTexture(R);
  detail.anisotropy = renderer.capabilities.getMaxAnisotropy();
  groundMat.onBeforeCompile = (sh) => {
    sh.uniforms.detailMap = { value: detail };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;')
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\ndiffuseColor.rgb *= texture2D(detailMap, vMapUv * 500.0).rgb * 1.595;',
      );
  };
  {
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, terrain.grid, terrain.grid);
    geo.rotateX(-Math.PI / 2);
    const pa = geo.attributes.position;
    for (let i = 0; i < pa.count; i++) pa.setY(i, H(pa.getX(i), pa.getZ(i)));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, groundMat);
    ground.receiveShadow = true;
    scene.add(ground);
  }
  {
    const B = 9000;
    const h = SIZE / 2;
    const outer = new THREE.Shape();
    outer.moveTo(-B, -B);
    outer.lineTo(B, -B);
    outer.lineTo(B, B);
    outer.lineTo(-B, B);
    outer.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-h, -h);
    hole.lineTo(-h, h);
    hole.lineTo(h, h);
    hole.lineTo(h, -h);
    hole.closePath();
    outer.holes.push(hole);
    const m = new THREE.Mesh(new THREE.ShapeGeometry(outer), std(0x5a7a3a, { roughness: 1 }));
    m.rotation.x = -Math.PI / 2;
    scene.add(m);
  }

  // kalkış pisti
  {
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(1.6, 48),
      new THREE.MeshStandardMaterial({ map: padTexture(), roughness: 0.8 }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.02;
    pad.receiveShadow = true;
    scene.add(pad);
  }

  // göl
  {
    const lake = new THREE.Mesh(
      new THREE.CircleGeometry(1, 64),
      new THREE.MeshStandardMaterial({ color: 0x356a88, roughness: 0.12, metalness: 0.1 }),
    );
    lake.rotation.x = -Math.PI / 2;
    lake.scale.set(LAKE.rx, LAKE.rz, 1);
    lake.position.set(LAKE.x, 0.06, LAKE.z);
    lake.receiveShadow = true;
    scene.add(lake);
  }

  // binalar: renk takımı = [sıva, panjur, kapı]. Ön yüz kapılı, yanlar pencereli, kalkan düz sıva.
  const PALETTE = [
    ['#e9e1cf', '#4d6b4f', '#5b3f2a'],
    ['#d8c6a6', '#7a5236', '#3f4f3a'],
    ['#f1efe9', '#5a6670', '#6b4a2f'],
    ['#cbb69c', null, '#4a3b2e'],
    ['#e3cdb4', '#6e3b2c', '#5b3f2a'],
    ['#d9d4c7', null, '#3d4d5c'],
    ['#c9a98a', '#4d6b4f', '#6b4a2f'],
  ];
  const wallSets = PALETTE.map(([c, shutter, doorColor]) => ({
    front: new THREE.MeshStandardMaterial({ map: wallTexture(c, { door: true, shutter, doorColor }), roughness: 0.9 }),
    side: new THREE.MeshStandardMaterial({ map: wallTexture(c, { shutter }), roughness: 0.9 }),
    plain: std(c, { roughness: 0.9 }),
  }));
  const roofTex = roofTexture();
  const roofMats = [0x8a3b2a, 0x6b2f25, 0x55575d, 0x7a4a2c, 0x9a4b30, 0x46494f]
    .map((c) => std(c, { map: roofTex, roughness: 0.75 }));
  const FACE = { px: 0, nx: 1, pz: 4, nz: 5 };
  const plinths = [];
  const chimneys = [];

  function addBuilding(x, z, w, d, h, set, roofMat, { kind = 'building', front = 'pz', chimney = false } = {}) {
    const base = terrain.baseOf(x, z, w, d);
    const grp = new THREE.Group();
    const mats = [set.side, set.side, set.plain, set.plain, set.side, set.side];
    mats[FACE[front]] = set.front;
    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
    walls.position.y = h / 2;
    walls.castShadow = walls.receiveShadow = true;
    const alongZ = d >= w;
    const span = alongZ ? w : d;
    const len = alongZ ? d : w;
    const rh = span * 0.45;
    // çatı: saçak ve kalkan taşmalı, kalkan üçgeni duvar renginde
    const roof = new THREE.Mesh(roofGeo(span, len, rh), [set.plain, roofMat]);
    roof.position.y = h;
    if (!alongZ) roof.rotation.y = Math.PI / 2;
    roof.castShadow = roof.receiveShadow = true;
    grp.add(walls, roof);
    grp.position.set(x, base, z);
    scene.add(grp);
    // taş temel: eğimde boşluk kalmasın
    plinths.push({ x, z, y: base - 1.5, w: w + 0.24, d: d + 0.24, h: 1.85 });
    // çarpışma: önce duvar kutusu (çatının alt kısmı dahil), sonra saçak taşması
    const ex = 0.55 * Math.cos(Math.atan2(rh, span / 2));
    const ox = alongZ ? ex : 0.45;
    const oz = alongZ ? 0.45 : ex;
    boxes.push({ x0: x - w / 2, x1: x + w / 2, y0: base - 1, y1: base + h + rh * 0.6, z0: z - d / 2, z1: z + d / 2, kind });
    boxes.push({
      x0: x - w / 2 - ox, x1: x + w / 2 + ox, y0: base + h - 0.5, y1: base + h + rh * 0.3,
      z0: z - d / 2 - oz, z1: z + d / 2 + oz, kind,
    });
    if (chimney) {
      const lat = (R() < 0.5 ? -1 : 1) * span * 0.16;
      const along = (R() - 0.5) * len * 0.5;
      const cx = alongZ ? x + lat : x + along;
      const cz = alongZ ? z + along : z + lat;
      const roofY = base + h + rh * (1 - Math.abs(lat) / (span / 2));
      chimneys.push({ x: cx, y: roofY - 0.6, z: cz });
      boxes.push({ x0: cx - 0.4, x1: cx + 0.4, y0: roofY - 0.6, y1: roofY + 2.75, z0: cz - 0.4, z1: cz + 0.4, kind });
    }
    mapData.houses.push({ x, z, w, d });
    return base;
  }

  const houseSpots = [[128, -80], [128, -130]];
  for (const z of [-70, -105, -140, -175]) for (const x of [172, 208, 244]) houseSpots.push([x, z]);
  const gardens = [];
  houseSpots.forEach(([sx, sz], i) => {
    let w = 8 + R() * 4;
    let d = 9 + R() * 4;
    if (R() < 0.5) [w, d] = [d, w];
    const x = sx + (R() - 0.5) * 4;
    const z = sz + (R() - 0.5) * 4;
    // kapı sokağa baksın
    const front = sx === 128 ? 'px' : sx === 172 ? 'nx' : sz === -70 || sz === -140 ? 'pz' : 'nz';
    const set = wallSets[(R() * wallSets.length) | 0];
    const roof = roofMats[(R() * roofMats.length) | 0];
    addBuilding(x, z, w, d, 5 + R() * 2.5, set, roof, { front, chimney: R() < 0.75 });
    if (i % 3 !== 2) gardens.push({ x, z, gx: Math.min(w / 2 + 4.5, 15), gz: Math.min(d / 2 + 4.5, 15), front, hedge: i % 3 === 1 });
  });

  // çiftlik: ahır + silo + çitli ağıl
  {
    const barn = {
      front: new THREE.MeshStandardMaterial({ map: barnTexture(true), roughness: 0.9 }),
      side: new THREE.MeshStandardMaterial({ map: barnTexture(false), roughness: 0.9 }),
      plain: std(0x8e2f25, { roughness: 0.9 }),
    };
    addBuilding(FARM.x, FARM.z, 14, 24, 7, barn, roofMats[2], { front: 'px' });
  }
  const SILO = { x: FARM.x - 13, z: FARM.z - 6, r: 2.8, h: 13 };
  {
    const base = H(SILO.x, SILO.z) - 0.3;
    const body = new THREE.CylinderGeometry(SILO.r, SILO.r, SILO.h, 24, 1, true).translate(0, SILO.h / 2, 0);
    const dome = new THREE.SphereGeometry(SILO.r * 1.03, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, SILO.h, 0);
    const silo = new THREE.Mesh(mergeGeos([[body, 0], [dome, 1]]), [
      new THREE.MeshStandardMaterial({ map: siloTexture(), roughness: 0.55, metalness: 0.35 }),
      std(0x9aa0a5, { roughness: 0.5, metalness: 0.35 }),
    ]);
    silo.position.set(SILO.x, base, SILO.z);
    silo.castShadow = silo.receiveShadow = true;
    scene.add(silo);
    cyls.push({ x: SILO.x, z: SILO.z, r: SILO.r + 0.05, y0: base, h: SILO.h + SILO.r, kind: 'building' });
    mapData.houses.push({ x: SILO.x, z: SILO.z, w: SILO.r * 2, d: SILO.r * 2 });
  }

  // kilise + çan kulesi
  addBuilding(215, -240, 12, 24, 9, wallSets[2], roofMats[2], { front: 'px' });
  {
    const base = H(215, -225);
    const s = wallSets[2];
    const tw = new THREE.Mesh(new THREE.BoxGeometry(5, 22, 5), [s.side, s.side, s.plain, s.plain, s.side, s.side]);
    tw.position.set(215, base + 11, -225);
    tw.castShadow = tw.receiveShadow = true;
    const spire = new THREE.Mesh(new THREE.ConeGeometry(3.6, 9, 4), roofMats[2]);
    spire.rotation.y = Math.PI / 4;
    spire.position.set(215, base + 26.5, -225);
    spire.castShadow = true;
    scene.add(tw, spire);
    boxes.push({ x0: 212.5, x1: 217.5, y0: base - 1, y1: base + 27, z0: -227.5, z1: -222.5, kind: 'building' });
    mapData.houses.push({ x: 215, z: -225, w: 5, d: 5 });
  }

  // bahçe çitleri ve budanmış çitler (eksene hizalı → kutu çarpışması)
  const posts = [];
  const rails = [];
  const trims = [];
  function fenceLine(x0, z0, x1, z1) {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(L / 2.4));
    let prev = null;
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n;
      const z = z0 + ((z1 - z0) * k) / n;
      const y = H(x, z);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
      posts.push({ x, y, z });
      if (prev) for (const ry of [0.45, 0.85]) rails.push({ a: prev, b: { x, y, z }, ry });
      prev = { x, y, z };
    }
    boxes.push({
      x0: Math.min(x0, x1) - 0.1, x1: Math.max(x0, x1) + 0.1, y0: lo - 0.5, y1: hi + 1.1,
      z0: Math.min(z0, z1) - 0.1, z1: Math.max(z0, z1) + 0.1, kind: 'fence',
    });
  }
  function hedgeLine(x0, z0, x1, z1) {
    const y = Math.min(H(x0, z0), H(x1, z1)) - 0.2;
    const hh = 1.3 + R() * 0.35;
    trims.push({ x: (x0 + x1) / 2, y, z: (z0 + z1) / 2, L: Math.hypot(x1 - x0, z1 - z0) + 0.8, h: hh, yaw: x0 === x1 ? Math.PI / 2 : 0 });
    boxes.push({
      x0: Math.min(x0, x1) - 0.45, x1: Math.max(x0, x1) + 0.45, y0: y - 0.5, y1: y + hh,
      z0: Math.min(z0, z1) - 0.45, z1: Math.max(z0, z1) + 0.45, kind: 'hedge',
    });
  }
  // dikdörtgen çevre; kapı tarafında ortada 3 m boşluk
  function enclose(x, z, gx, gz, gate, line) {
    const c = [[x - gx, z - gz], [x + gx, z - gz], [x + gx, z + gz], [x - gx, z + gz]];
    const sides = { nz: [0, 1], px: [1, 2], pz: [2, 3], nx: [3, 0] };
    for (const [s, [i, j]] of Object.entries(sides)) {
      const [ax, az] = c[i];
      const [bx, bz] = c[j];
      if (s !== gate) {
        line(ax, az, bx, bz);
        continue;
      }
      const L = Math.hypot(bx - ax, bz - az);
      const t = (L / 2 - 1.5) / L;
      line(ax, az, ax + (bx - ax) * t, az + (bz - az) * t);
      line(bx + (ax - bx) * t, bz + (az - bz) * t, bx, bz);
    }
  }
  for (const gdn of gardens) enclose(gdn.x, gdn.z, gdn.gx, gdn.gz, gdn.front, gdn.hedge ? hedgeLine : fenceLine);
  enclose(FARM.x - 3, FARM.z + 29, 14, 10, 'px', fenceLine);

  // radyo anteni
  let towerLight;
  {
    const base = H(TOWER.x, TOWER.z) - 0.5;
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 1.4, TOWER.h, 4),
      new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.6, metalness: 0.3 }),
    );
    mast.position.set(TOWER.x, base + TOWER.h / 2, TOWER.z);
    mast.castShadow = true;
    towerLight = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 12, 8),
      new THREE.MeshStandardMaterial({ color: 0xff2a1a, emissive: 0xff2a1a, emissiveIntensity: 2 }),
    );
    towerLight.position.set(TOWER.x, base + TOWER.h + 0.4, TOWER.z);
    scene.add(mast, towerLight);
    cyls.push({ x: TOWER.x, z: TOWER.z, r: 1.6, y0: base - 0.5, h: TOWER.h + 1.5, kind: 'tower' });
  }

  // halkalar: yükseklikleri yerel zeminin üstünde
  const rings = RING_PTS.map((p, i) => {
    const prev = i ? RING_PTS[i - 1] : [0, 0, 0];
    const next = RING_PTS[i + 1] || [0, 0, 0];
    const yaw = Math.atan2(next[0] - prev[0], next[2] - prev[2]);
    const y = p[1] + H(p[0], p[2]);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, transparent: true });
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.2, 10, 56), mat);
    mesh.position.set(p[0], y, p[2]);
    mesh.rotation.y = yaw;
    mesh.castShadow = true;
    scene.add(mesh);
    mapData.rings.push({ x: p[0], z: p[2] });
    return {
      c: new THREE.Vector3(p[0], y, p[2]),
      n: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)),
      u: new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)),
      mesh,
      mat,
    };
  });

  // ağaçlar
  const blocked = (x, z, m) => {
    if (Math.abs(x) > SIZE / 2 - 8 || Math.abs(z) > SIZE / 2 - 8) return true;
    if (Math.hypot(x, z) < 45) return true;
    if (Math.abs(z - ROAD_Z) < 5 + m) return true;
    if (Math.abs(x - VROAD_X) < 5 + m && z < ROAD_Z) return true;
    if (Math.abs(x) < 4 + m && z > 0 && z < ROAD_Z) return true;
    const lx = (x - LAKE.x) / (LAKE.rx + 8 + m);
    const lz = (z - LAKE.z) / (LAKE.rz + 8 + m);
    if (lx * lx + lz * lz < 1) return true;
    if (inField(x, z, m)) return true;
    if (Math.hypot(x - TOWER.x, z - TOWER.z) < 8 + m) return true;
    if (Math.hypot(x - SILO.x, z - SILO.z) < SILO.r + 3 + m) return true;
    for (const b of boxes) {
      if (x > b.x0 - 3 - m && x < b.x1 + 3 + m && z > b.z0 - 3 - m && z < b.z1 + 3 + m) return true;
    }
    for (const r of rings) if (Math.hypot(x - r.c.x, z - r.c.z) < 14) return true;
    return false;
  };

  const types = treeTypes();
  const trees = Object.fromEntries(Object.keys(types).map((k) => [k, []]));
  const plant = (x, z, type) => {
    if (blocked(x, z, 2)) return;
    const t = types[type];
    let s = 0.65 + R() * 0.7;
    if (R() < 0.08) s *= 1.3;
    const sy = s * (0.85 + R() * 0.35);
    const y = H(x, z) - 0.1;
    trees[type].push({ x, y, z, s, sy, rot: R() * Math.PI * 2 });
    cyls.push({ x, z, r: t.r * s * 0.85, y0: y, h: t.h * sy, kind: 'tree' });
    mapData.trees.push([x, z]);
  };
  for (let i = 0; i < 420; i++) {
    const a = R() * Math.PI * 2;
    const d = Math.sqrt(R()) * FOREST.r;
    const k = R();
    plant(FOREST.x + Math.cos(a) * d, FOREST.z + Math.sin(a) * d, k < 0.72 ? 'pine' : k < 0.88 ? 'leaf' : 'broad');
  }
  for (let i = 0; i < 260; i++) {
    const k = R();
    plant((R() - 0.5) * (SIZE - 30), (R() - 0.5) * (SIZE - 30),
      k < 0.25 ? 'pine' : k < 0.6 ? 'leaf' : k < 0.88 ? 'broad' : 'tall');
  }
  for (let x = -480; x <= 480; x += 22) {
    plant(x + R() * 4, ROAD_Z - 9, R() < 0.6 ? 'leaf' : 'broad');
    plant(x + 11 + R() * 4, ROAD_Z + 9, R() < 0.6 ? 'leaf' : 'broad');
  }
  // köy yolunda kavak sırası
  for (let z = ROAD_Z - 40; z > -480; z -= 16) {
    plant(VROAD_X - 8 + R(), z + R() * 3, 'tall');
    plant(VROAD_X + 8 + R(), z - 8 + R() * 3, 'tall');
  }

  const pick = (a) => a[0] + R() * (a[1] - a[0]);
  const trunkMat = std(0xffffff, { flatShading: true });
  for (const [type, list] of Object.entries(trees)) {
    if (!list.length) continue;
    const t = types[type];
    const trunk = new THREE.InstancedMesh(t.trunk, trunkMat, list.length);
    const crown = new THREE.InstancedMesh(t.crown, std(0xffffff, { flatShading: true }), list.length);
    list.forEach((tr, i) => {
      q.setFromAxisAngle(up, tr.rot);
      m4.compose(v3.set(tr.x, tr.y, tr.z), q, sc.set(tr.s, tr.sy, tr.s));
      trunk.setMatrixAt(i, m4);
      crown.setMatrixAt(i, m4);
      // ara sıra sararmış yaprak tonu
      const hue = R() < 0.06 && type !== 'pine' ? 0.13 + R() * 0.03 : pick(t.hue);
      col.setHSL(hue, pick(t.sat), pick(t.light), THREE.SRGBColorSpace);
      crown.setColorAt(i, col);
      col.setHSL(0.06 + R() * 0.04, 0.2 + R() * 0.15, 0.17 + R() * 0.1, THREE.SRGBColorSpace);
      trunk.setColorAt(i, col);
    });
    trunk.castShadow = crown.castShadow = true;
    crown.receiveShadow = true;
    scene.add(trunk, crown);
  }

  // çalılar (yol ve orman kenarı) ve tarla kenarındaki çit sıraları
  const bushes = [];
  const addBush = (x, z, s) => {
    if (blocked(x, z, 0.6)) return;
    const y = H(x, z) - 0.05;
    bushes.push({ x, y, z, s, sy: s * (0.8 + R() * 0.4), rot: R() * Math.PI * 2 });
    cyls.push({ x, z, r: 1.1 * s, y0: y, h: 1.15 * s, kind: 'tree' });
  };
  for (let x = -490; x < 490; x += 5 + R() * 9) {
    if (R() < 0.55) addBush(x, ROAD_Z + (R() < 0.5 ? -1 : 1) * (6 + R() * 2.5), 0.6 + R() * 0.7);
  }
  for (let z = ROAD_Z - 10; z > -490; z -= 5 + R() * 9) {
    if (R() < 0.45) addBush(VROAD_X + (R() < 0.5 ? -1 : 1) * (6 + R() * 2.5), z, 0.6 + R() * 0.7);
  }
  // orman kenarında öbek öbek
  for (let i = 0; i < 26; i++) {
    const a = R() * Math.PI * 2;
    const d = FOREST.r + 2 + R() * 12;
    const x = FOREST.x + Math.cos(a) * d;
    const z = FOREST.z + Math.sin(a) * d;
    for (let k = 0; k < 3; k++) addBush(x + (R() - 0.5) * 5, z + (R() - 0.5) * 5, 0.8 + R() * 0.8);
  }
  for (let i = 0; i < 30; i++) addBush((R() - 0.5) * (SIZE - 40), (R() - 0.5) * (SIZE - 40), 0.8 + R() * 0.8);

  const rows = [];
  const SIDES = [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]];
  FIELDS.forEach((f, fi) => {
    const c = Math.cos(f.rot);
    const s = Math.sin(f.rot);
    for (const side of SIDES[fi % SIDES.length]) {
      const alongA = side % 2 === 0;
      const L = alongA ? f.w : f.d;
      const off = (alongA ? f.d : f.w) / 2 + 3.2;
      const sign = side < 2 ? 1 : -1;
      const yaw = alongA ? -f.rot : -f.rot - Math.PI / 2;
      let skip = 0;
      for (let t = -L / 2; t <= L / 2; t += 2.8) {
        if (skip > 0) {
          skip--;
          continue;
        }
        if (R() < 0.035) skip = 1 + ((R() * 3) | 0);
        const a = alongA ? t : sign * off;
        const b = alongA ? sign * off : t;
        const x = f.x + a * c - b * s;
        const z = f.z + a * s + b * c;
        if (blocked(x, z, 0.3)) continue;
        const y = H(x, z) - 0.15;
        const k = 0.85 + R() * 0.5;
        rows.push({ x, y, z, sx: 1.2 + R() * 0.4, sy: k, sz: 0.9 + R() * 0.35, yaw: yaw + (R() - 0.5) * 0.4 });
        cyls.push({ x, z, r: 1.15, y0: y, h: 1.6 * k, kind: 'tree' });
      }
    }
  });

  const leafy = (inst, list, set, hue, light) => {
    list.forEach((o, i) => {
      set(o);
      inst.setMatrixAt(i, m4);
      col.setHSL(hue[0] + R() * (hue[1] - hue[0]), 0.35 + R() * 0.2, light[0] + R() * (light[1] - light[0]), THREE.SRGBColorSpace);
      inst.setColorAt(i, col);
    });
    inst.castShadow = inst.receiveShadow = true;
    scene.add(inst);
  };
  if (bushes.length) {
    leafy(new THREE.InstancedMesh(bushGeo(), std(0xffffff, { flatShading: true }), bushes.length), bushes, (b) => {
      q.setFromAxisAngle(up, b.rot);
      m4.compose(v3.set(b.x, b.y, b.z), q, sc.set(b.s, b.sy, b.s));
    }, [0.2, 0.3], [0.22, 0.33]);
  }
  if (rows.length) {
    const g = new THREE.IcosahedronGeometry(1, 0).scale(1.6, 0.85, 0.95).translate(0, 0.8, 0);
    leafy(new THREE.InstancedMesh(g, std(0xffffff, { flatShading: true }), rows.length), rows, (b) => {
      q.setFromAxisAngle(up, b.yaw);
      m4.compose(v3.set(b.x, b.y, b.z), q, sc.set(b.sx, b.sy, b.sz));
    }, [0.22, 0.3], [0.15, 0.24]);
  }
  if (trims.length) {
    const g = new THREE.BoxGeometry(1, 1, 0.85).translate(0, 0.5, 0);
    leafy(new THREE.InstancedMesh(g, std(0xffffff, { roughness: 1 }), trims.length), trims, (b) => {
      q.setFromAxisAngle(up, b.yaw);
      m4.compose(v3.set(b.x, b.y, b.z), q, sc.set(b.L, b.h, 1));
    }, [0.24, 0.3], [0.2, 0.26]);
  }

  // çit direkleri ve tahtaları (dikmeler arası eğimi izler)
  if (posts.length) {
    const wood = std(0xffffff, { roughness: 0.95 });
    const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1.2, 0.12).translate(0, 0.5, 0), wood, posts.length);
    posts.forEach((p, i) => {
      m4.makeTranslation(p.x, p.y, p.z);
      pm.setMatrixAt(i, m4);
      col.setHSL(0.08, 0.2 + R() * 0.1, 0.3 + R() * 0.1, THREE.SRGBColorSpace);
      pm.setColorAt(i, col);
    });
    const rm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.09, 0.05), wood, rails.length);
    rails.forEach((r, i) => {
      const dx = r.b.x - r.a.x;
      const dz = r.b.z - r.a.z;
      const hl = Math.hypot(dx, dz);
      eul.set(0, Math.atan2(-dz, dx), Math.atan2(r.b.y - r.a.y, hl));
      q.setFromEuler(eul);
      m4.compose(
        v3.set((r.a.x + r.b.x) / 2, (r.a.y + r.b.y) / 2 + r.ry, (r.a.z + r.b.z) / 2),
        q, sc.set(Math.hypot(hl, r.b.y - r.a.y) + 0.1, 1, 1),
      );
      rm.setMatrixAt(i, m4);
      col.setHSL(0.08, 0.18 + R() * 0.1, 0.32 + R() * 0.1, THREE.SRGBColorSpace);
      rm.setColorAt(i, col);
    });
    pm.castShadow = rm.castShadow = true;
    scene.add(pm, rm);
  }

  // bina temelleri ve bacalar (tek çizim çağrısı)
  {
    const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), std(0xffffff, { roughness: 0.95 }), plinths.length);
    plinths.forEach((p, i) => {
      m4.compose(v3.set(p.x, p.y, p.z), q.identity(), sc.set(p.w, p.h, p.d));
      pm.setMatrixAt(i, m4);
      const l = 0.42 + R() * 0.1;
      col.setRGB(l, l * 0.98, l * 0.94, THREE.SRGBColorSpace);
      pm.setColorAt(i, col);
    });
    pm.receiveShadow = true;
    scene.add(pm);
  }
  if (chimneys.length) {
    const g = mergeGeos([
      new THREE.BoxGeometry(0.62, 3.2, 0.62).translate(0, 1.6, 0),
      new THREE.BoxGeometry(0.8, 0.14, 0.8).translate(0, 3.27, 0),
    ]);
    const cm = new THREE.InstancedMesh(g, std(0xffffff, { roughness: 0.9 }), chimneys.length);
    chimneys.forEach((c, i) => {
      m4.makeTranslation(c.x, c.y, c.z);
      cm.setMatrixAt(i, m4);
      if (R() < 0.6) col.setHSL(0.03 + R() * 0.03, 0.4, 0.3 + R() * 0.08, THREE.SRGBColorSpace);
      else col.setHSL(0.1, 0.12, 0.62 + R() * 0.12, THREE.SRGBColorSpace);
      cm.setColorAt(i, col);
    });
    cm.castShadow = cm.receiveShadow = true;
    scene.add(cm);
  }

  // ufuktaki tepeler (çarpışma yok, uzakta): tek geometride, köşe renkleriyle
  {
    const parts = [];
    const tints = [];
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + R() * 0.1;
      const d = 1250 + R() * 1300;
      const rad = 320 + R() * 450;
      const hh = 40 + R() * 120;
      const g = new THREE.ConeGeometry(rad, hh, 7).translate(Math.cos(a) * d, hh / 2 - 2, Math.sin(a) * d);
      tints.push([new THREE.Color().setHSL(0.27 + R() * 0.05, 0.3, 0.26 + R() * 0.08), g.index.count]);
      parts.push(g);
    }
    const geo = mergeGeos(parts);
    const ca = new Float32Array(geo.attributes.position.count * 3);
    let o = 0;
    for (const [c, n] of tints) for (let k = 0; k < n; k++, o++) c.toArray(ca, o * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(ca, 3));
    scene.add(new THREE.Mesh(geo, std(0xffffff, { flatShading: true, vertexColors: true })));
  }

  // ---- çarpışma: küre (p, r) engellerden dışarı itilir, hız normal yönde sıfırlanır
  function resolve(p, v, r) {
    let impact = null;
    const hit = (nx, ny, nz, depth, kind) => {
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
      if (!impact || speed > impact.speed) impact = { speed, kind, top: ny > 0.7 };
    };
    for (const b of boxes) {
      if (p.x < b.x0 - r || p.x > b.x1 + r || p.y > b.y1 + r || p.y < b.y0 - r || p.z < b.z0 - r || p.z > b.z1 + r) continue;
      const cx = Math.max(b.x0, Math.min(b.x1, p.x));
      const cy = Math.max(b.y0, Math.min(b.y1, p.y));
      const cz = Math.max(b.z0, Math.min(b.z1, p.z));
      const dx = p.x - cx;
      const dy = p.y - cy;
      const dz = p.z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r * r) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        hit(dx / d, dy / d, dz / d, r - d, b.kind);
      } else {
        const opts = [
          [b.y1 + r - p.y, 0, 1, 0],
          [p.x - (b.x0 - r), -1, 0, 0],
          [b.x1 + r - p.x, 1, 0, 0],
          [p.z - (b.z0 - r), 0, 0, -1],
          [b.z1 + r - p.z, 0, 0, 1],
        ].sort((a, c) => a[0] - c[0]);
        hit(opts[0][1], opts[0][2], opts[0][3], opts[0][0], b.kind);
      }
    }
    for (const c of cyls) {
      const rr = c.r + r;
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const top = c.y0 + c.h;
      if (dx > rr || dx < -rr || dz > rr || dz < -rr || p.y > top + r || p.y < c.y0 - r) continue;
      const d = Math.hypot(dx, dz);
      if (d >= rr) continue;
      const topPen = top + r - p.y;
      const sidePen = rr - d;
      if (topPen < sidePen && topPen < 0.6) hit(0, 1, 0, topPen, c.kind);
      else if (d > 1e-6) hit(dx / d, 0, dz / d, sidePen, c.kind);
      else hit(1, 0, 0, sidePen, c.kind);
    }
    return impact;
  }

  // ---- halka parkuru
  const course = { next: 0, startAt: null, lastTime: null };
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();

  function paintRings() {
    rings.forEach((r, i) => {
      if (i < course.next) {
        r.mat.color.set(0x35c46a);
        r.mat.emissive.set(0x000000);
        r.mat.opacity = 0.35;
      } else if (i === course.next) {
        r.mat.color.set(0xff8a1a);
        r.mat.emissive.set(0xff6a00);
        r.mat.emissiveIntensity = 0.7;
        r.mat.opacity = 1;
      } else {
        r.mat.color.set(0xf4f4f4);
        r.mat.emissive.set(0x000000);
        r.mat.opacity = 0.85;
      }
    });
  }
  paintRings();

  function checkRings(prev, cur, now) {
    const r = rings[course.next];
    if (!r) return null;
    const z0 = tmpA.subVectors(prev, r.c).dot(r.n);
    const z1 = tmpB.subVectors(cur, r.c).dot(r.n);
    if (z0 === z1 || Math.sign(z0) === Math.sign(z1)) return null;
    const t = z0 / (z0 - z1);
    tmpA.copy(prev).lerp(cur, t).sub(r.c);
    const a = tmpA.dot(r.u);
    if (a * a + tmpA.y * tmpA.y > (RING_R - 0.15) ** 2) return null;
    if (course.next === 0) course.startAt = now;
    course.next++;
    let ev = { index: course.next, total: rings.length, done: false };
    if (course.next === rings.length) {
      course.lastTime = now - course.startAt;
      ev = { ...ev, done: true, time: course.lastTime };
      course.next = 0;
      course.startAt = null;
    }
    paintRings();
    return ev;
  }

  function resetCourse() {
    course.next = 0;
    course.startAt = null;
    paintRings();
  }

  return {
    kind: 'village',
    ready: true,
    boxes, cyls, rings, mapData, towerLight, resolve, isWater, course, checkRings, resetCourse,
    groundAt: (x, z) => H(x, z),
    resetSweep: () => {},
    update: () => {},
    credits: () => '',
  };
}
