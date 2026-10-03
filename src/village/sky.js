// Gökyüzü dokusu (equirect): dikey gradyan + güneş parıltısı + yumuşak bulutlar.
// Hepsi arka plan dokusuna boyanır: ek çizim çağrısı yok, bulutlar sonsuz uzakta.
// Equirect eşlemesi (three): u = atan2(z, x) / 2π + 0.5, v = asin(y) / π + 0.5; tuvalin üstü v = 1.

const W = 1024;
const H = 512;
const BOTTOM = [190, 199, 214];

const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function skyCanvas({ horizon, sun, clouds = 0, random = Math.random }) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#2a66b8');
  grad.addColorStop(0.32, '#7fb0e0');
  grad.addColorStop(0.5, horizon);
  grad.addColorStop(1, horizon);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  // güneş: çekirdek + hale + geniş aydınlık (piksel başına açı)
  if (sun) {
    const img = g.getImageData(0, 0, W, H / 2 + 8);
    const d = img.data;
    const cosAz = new Float32Array(W);
    const sinAz = new Float32Array(W);
    for (let i = 0; i < W; i++) {
      const az = ((i + 0.5) / W - 0.5) * Math.PI * 2;
      cosAz[i] = Math.cos(az);
      sinAz[i] = Math.sin(az);
    }
    const warm = [255, 247, 228];
    for (let j = 0; j < img.height; j++) {
      const el = (0.5 - (j + 0.5) / H) * Math.PI;
      const ce = Math.cos(el);
      const se = Math.sin(el);
      const fade = smooth(-0.03, 0.05, el);
      for (let i = 0; i < W; i++) {
        const dot = ce * cosAz[i] * sun.x + se * sun.y + ce * sinAz[i] * sun.z;
        const th = Math.acos(Math.min(1, Math.max(-1, dot)));
        let k = Math.exp(-((th / 0.016) ** 2)) + 0.5 * Math.exp(-th / 0.07) + 0.24 * Math.exp(-th / 0.42);
        k = Math.min(1, k) * fade;
        if (k < 0.003) continue;
        const p = (j * W + i) * 4;
        for (let ch = 0; ch < 3; ch++) d[p + ch] += (warm[ch] - d[p + ch]) * k;
      }
    }
    g.putImageData(img, 0, 0);
  }

  // bulutlar: ~1.2 km yükseklikte düzlemde kümeler; her küme birçok yumuşak top
  const hz = hex(horizon);
  const ALT = 1300;
  for (let n = 0; n < clouds; n++) {
    // azimutta eşit aralık + sapma: gökyüzünün her yönünde birkaç bulut
    const az = ((n + random() * 0.8) / clouds) * Math.PI * 2;
    const D = 1700 + random() ** 0.8 * 7500;
    const L = 520 + random() * 1100;
    const T = L * (0.22 + random() * 0.14);
    const yaw = random() * Math.PI;
    const cx = Math.cos(az) * D;
    const cz = Math.sin(az) * D;
    const puffs = [];
    const count = 16 + ((random() * 16) | 0);
    for (let k = 0; k < count; k++) {
      const a = (random() - 0.5) * L;
      const b = (random() - 0.5) * L * 0.45;
      const top = 1 - (2 * a / L) ** 2;
      const y = random() * T * Math.max(0.15, top);
      const r = L * (0.1 + random() * 0.12) * (0.7 + 0.5 * top);
      puffs.push({
        x: cx + a * Math.cos(yaw) - b * Math.sin(yaw),
        z: cz + a * Math.sin(yaw) + b * Math.cos(yaw),
        y: ALT + y,
        r,
        lit: y / T,
      });
    }
    // önce alttaki (gölgeli) toplar, üstteki aydınlıklar en son
    puffs.sort((p, q) => p.lit - q.lit);
    for (const p of puffs) {
      const dist = Math.hypot(p.x, p.y, p.z);
      const el = Math.asin(p.y / dist);
      const u = Math.atan2(p.z, p.x) / (Math.PI * 2) + 0.5;
      const px = u * W;
      const py = (0.5 - el / Math.PI) * H;
      const ry = (p.r / dist) * (H / Math.PI);
      const sx = 1 / Math.cos(el);
      const haze = 1 - smooth(0.05, 0.32, el);
      // tepe beyaz, taban mavimsi gri; ufka yakın olanlar pusa karışır
      const lit = p.lit ** 0.7;
      const col = BOTTOM.map((v, i) => {
        const s = v + (255 - v) * lit;
        return Math.round(s + (hz[i] - s) * haze * 0.55);
      });
      const alpha = (0.5 + 0.22 * p.lit) * smooth(0.025, 0.1, el);
      for (const ox of [0, -W, W]) {
        const x = px + ox;
        if (x + ry * sx < 0 || x - ry * sx > W) continue;
        g.save();
        g.translate(x, py);
        g.scale(sx, 1);
        const rg = g.createRadialGradient(0, 0, 0, 0, 0, ry);
        rg.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${alpha})`);
        rg.addColorStop(0.55, `rgba(${col[0]},${col[1]},${col[2]},${alpha * 0.6})`);
        rg.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
        g.fillStyle = rg;
        g.beginPath();
        g.arc(0, 0, ry, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }
  }
  return c;
}
