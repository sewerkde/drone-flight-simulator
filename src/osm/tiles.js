// Karo matematiği ve nazik indirme kuyruğu (ücretsiz servisler: en çok 4 eşzamanlı istek, bellekte önbellek).

export const Z = 14; // OpenFreeMap en çok z14 verir; arazi de aynı ızgarada
const EARTH = 40075016.686; // ekvator çevresi (m)
const DEG = Math.PI / 180;

export const TERRAIN_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';

// Enlem/boylam → kesirli karo koordinatı (Web Mercator, y güneye artar)
export function lonLatToTile(lon, lat, z = Z) {
  const n = 2 ** z;
  const r = lat * DEG;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n,
  };
}

// Yerel çerçeve: başlangıç noktası 0,0; +x doğu, +z güney (-z kuzey). Birim metre.
// Mercator ölçeği başlangıç enleminde sabit alınır (birkaç km'de hata binde birin altında).
export function makeFrame(lat, lon, z = Z) {
  const o = lonLatToTile(lon, lat, z);
  const tileM = (EARTH * Math.cos(lat * DEG)) / 2 ** z;
  return {
    z,
    tx0: o.x,
    ty0: o.y,
    tileM,
    // karo birimi (tx, ty) → yerel metre
    x: (tx) => (tx - o.x) * tileM,
    zz: (ty) => (ty - o.y) * tileM,
    // yarıçap R (m) kare penceresine giren karolar, başlangıca yakından uzağa sıralı
    tilesAround(R) {
      const x0 = Math.floor(o.x - R / tileM);
      const x1 = Math.floor(o.x + R / tileM);
      const y0 = Math.floor(o.y - R / tileM);
      const y1 = Math.floor(o.y + R / tileM);
      const list = [];
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          // karonun başlangıca en yakın noktası (karo biriminde)
          const dx = Math.max(x - o.x, 0, o.x - (x + 1));
          const dy = Math.max(y - o.y, 0, o.y - (y + 1));
          list.push({ x, y, near: Math.hypot(dx, dy) * tileM });
        }
      }
      list.sort((a, b) => a.near - b.near);
      return { list, x0, x1, y0, y1 };
    },
  };
}

export const tileUrl = (tpl, z, x, y) => tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y);

// ---- indirme kuyruğu
const MAX_ACTIVE = 4;
const cache = new Map(); // url → Promise (aynı karo ikinci kez istenmez)
const waiting = [];
let active = 0;
export const net = { requests: 0, failed: 0, bytes: 0, retries: 0 };

function pump() {
  while (active < MAX_ACTIVE && waiting.length) {
    const job = waiting.shift();
    active++;
    job().finally(() => {
      active--;
      pump();
    });
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Tek deneme + bir kez gecikmeli yeniden deneme. 404 boş sayılır (deniz, veri yok).
async function download(url, kind) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) {
      net.retries++;
      await wait(1500);
    }
    net.requests++;
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (res.status === 404 || res.status === 204) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = kind === 'json' ? await res.json() : kind === 'blob' ? await res.blob() : await res.arrayBuffer();
      net.bytes += body.size ?? body.byteLength ?? 0;
      return body;
    } catch (e) {
      if (attempt === 1) {
        net.failed++;
        throw new Error(`${e.message || e} (${url.replace(/^https?:\/\//, '').split('/')[0]})`);
      }
    }
  }
  return null;
}

export function fetchCached(url, kind = 'buffer') {
  let p = cache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      waiting.push(() => download(url, kind).then(resolve, reject));
      pump();
    });
    // hatalı istek önbellekte kalmasın (bir sonraki dünya kurulumunda yeniden denenebilsin)
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

// OpenFreeMap TileJSON → vektör karo adres şablonu (sürüm tarihli, oturum boyunca aynı)
let tplPromise = null;
export function vectorTemplate() {
  if (!tplPromise) {
    tplPromise = fetchCached(TILEJSON_URL, 'json').then((j) => {
      const tpl = j?.tiles?.[0];
      if (!tpl) throw new Error('TileJSON: karo adresi yok');
      return tpl;
    });
    tplPromise.catch(() => (tplPromise = null));
  }
  return tplPromise;
}

// Ana iş parçacığını kısa süre bırak (sekme arka plandayken setTimeout gibi kısılmaz)
const chan = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
const yieldQ = [];
if (chan) chan.port1.onmessage = () => yieldQ.shift()?.();
export function breathe() {
  if (!chan) return wait(0);
  return new Promise((r) => {
    yieldQ.push(r);
    chan.port2.postMessage(0);
  });
}
