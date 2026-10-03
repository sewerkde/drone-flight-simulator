// Yumuşak tepeler: ucuz analitik yükseklik h(x, z).
// Ev pisti, göl, yollar, köy merkezi ve çiftlik düz kalır; kenarları yumuşakça harmanlanır.
// Dalga boyları 200–600 m, genlik birkaç metre: fizik her adımda çağırır, hafif olmalı.

const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// noktanın doğru parçasına uzaklığı
function segDist(x, z, r) {
  const dx = r.x1 - r.x0;
  const dz = r.z1 - r.z0;
  const L2 = dx * dx + dz * dz;
  const t = L2 ? Math.min(1, Math.max(0, ((x - r.x0) * dx + (z - r.z0) * dz) / L2)) : 0;
  return Math.hypot(x - (r.x0 + dx * t), z - (r.z0 + dz * t));
}

// kenar: dikdörtgene uzaklık (içeride 0)
function rectDist(x, z, q) {
  const dx = Math.max(0, Math.abs(x - q.x) - q.hw);
  const dz = Math.max(0, Math.abs(z - q.z) - q.hd);
  return Math.hypot(dx, dz);
}

// grid: zemin ağının hücre sayısı. height() ağın üçgenleriyle aynı enterpolasyonu yapar,
// böylece fizik, nesneler ve görünen zemin birebir örtüşür (harmanlama kenarlarında da).
export function makeTerrain({ size, lake, roads, flats = [], rects = [], grid = 100 }) {
  const half = size / 2;
  const minR = Math.min(lake.rx, lake.rz);

  // ham tepe alanı: birkaç uzun dalga, merkezden uzaklaştıkça biraz yükselir
  function raw(x, z) {
    const r = Math.hypot(x, z);
    const amp = 0.85 + 1.2 * smooth(150, 440, r);
    return amp * (
      2.4 * Math.sin(x * 0.0105 + 1.3) * Math.sin(z * 0.0087 + 0.4)
      + 2.1 * Math.sin((x * 0.8 + z * 0.6) * 0.0163 + 2.2)
      + 1.2 * Math.sin((-x * 0.5 + z * 0.87) * 0.029 + 0.7)
      + 0.4 * Math.sin(x * 0.047 - z * 0.029 + 1.9)
    ) + 1.5;
  }

  // 0: düz alan, 1: serbest tepe
  function mask(x, z) {
    let m = smooth(48, 95, Math.hypot(x, z));
    if (m === 0) return 0;
    const lx = (x - lake.x) / lake.rx;
    const lz = (z - lake.z) / lake.rz;
    m *= smooth(14, 70, (Math.sqrt(lx * lx + lz * lz) - 1) * minR);
    for (const r of roads) m *= smooth(r.w / 2 + 4, r.w / 2 + 34, segDist(x, z, r));
    for (const f of flats) m *= smooth(f.r, f.r + f.blend, Math.hypot(x - f.x, z - f.z));
    for (const q of rects) m *= smooth(0, q.blend, rectDist(x, z, q));
    m *= smooth(half, half - 75, Math.max(Math.abs(x), Math.abs(z)));
    return m;
  }

  function exact(x, z) {
    const m = mask(x, z);
    return m === 0 ? 0 : m * raw(x, z);
  }

  // köşe yükseklikleri (PlaneGeometry sırası: ix doğuya, iz güneye)
  const N = grid;
  const cell = size / N;
  const G = new Float32Array((N + 1) * (N + 1));
  for (let iz = 0; iz <= N; iz++) {
    for (let ix = 0; ix <= N; ix++) G[iz * (N + 1) + ix] = exact(-half + ix * cell, -half + iz * cell);
  }

  // PlaneGeometry üçgenleri: (a, b, d) ve (b, c, d); a=(ix,iz) b=(ix,iz+1) c=(ix+1,iz+1) d=(ix+1,iz)
  function height(x, z) {
    const gx = (x + half) / cell;
    const gz = (z + half) / cell;
    if (!(gx > 0 && gz > 0 && gx < N && gz < N)) return 0;
    const ix = gx | 0;
    const iz = gz | 0;
    const fx = gx - ix;
    const fz = gz - iz;
    const i = iz * (N + 1) + ix;
    const ha = G[i];
    const hd = G[i + 1];
    const hb = G[i + N + 1];
    const hc = G[i + N + 2];
    return fx + fz <= 1
      ? ha + (hd - ha) * fx + (hb - ha) * fz
      : hc + (hb - hc) * (1 - fx) + (hd - hc) * (1 - fz);
  }

  // dikdörtgen tabanın en alçak köşesi (bina/çit oturtmak için)
  function baseOf(x, z, w, d) {
    return Math.min(
      height(x - w / 2, z - d / 2), height(x + w / 2, z - d / 2),
      height(x - w / 2, z + d / 2), height(x + w / 2, z + d / 2), height(x, z),
    );
  }

  return { height, exact, baseOf, grid: N };
}
