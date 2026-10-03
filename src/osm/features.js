import { VectorTile, Pbf, classifyRings } from '../../vendor/mvt.bundle.js';
import { tileUrl, fetchCached } from './tiles.js';

// OpenMapTiles şeması (OpenFreeMap) → sade nesneler. Koordinatlar karo biriminde (0..1,
// tampon payıyla biraz taşar): u doğu, v güney. Halkalar Float32Array [u0,v0,u1,v1,...].

const toRing = (pts, ext, closed) => {
  let n = pts.length;
  if (closed && n > 1 && pts[0].x === pts[n - 1].x && pts[0].y === pts[n - 1].y) n--;
  const a = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    a[i * 2] = pts[i].x / ext;
    a[i * 2 + 1] = pts[i].y / ext;
  }
  return a;
};

function polys(f, ext) {
  const out = [];
  for (const poly of classifyRings(f.loadGeometry())) {
    const rings = poly.map((r) => toRing(r, ext, true)).filter((r) => r.length >= 6);
    if (rings.length) out.push(rings);
  }
  return out;
}

function lines(f, ext) {
  return f.loadGeometry().map((l) => toRing(l, ext, false)).filter((l) => l.length >= 4);
}

export function parseTile(buf) {
  const out = { water: [], waterways: [], landcover: [], landuse: [], roads: [], areas: [], aeroway: [], buildings: [] };
  if (!buf) return out;
  const vt = new VectorTile(new Pbf(new Uint8Array(buf)));
  const each = (name, fn) => {
    const L = vt.layers[name];
    if (!L) return;
    for (let i = 0; i < L.length; i++) fn(L.feature(i), L.extent, L.feature(i).properties);
  };
  each('water', (f, ext, p) => {
    if (f.type !== 3 || p.brunnel === 'tunnel') return;
    for (const poly of polys(f, ext)) out.water.push({ cls: p.class, poly });
  });
  each('waterway', (f, ext, p) => {
    if (f.type !== 2 || p.brunnel === 'tunnel') return;
    for (const line of lines(f, ext)) out.waterways.push({ cls: p.class, line });
  });
  each('landcover', (f, ext, p) => {
    if (f.type !== 3) return;
    for (const poly of polys(f, ext)) out.landcover.push({ cls: p.class, sub: p.subclass, poly });
  });
  each('landuse', (f, ext, p) => {
    if (f.type !== 3) return;
    for (const poly of polys(f, ext)) out.landuse.push({ cls: p.class, poly });
  });
  each('transportation', (f, ext, p) => {
    if (p.brunnel === 'tunnel' || p.indoor === 1 || (p.level != null && p.level < 0)) return;
    if (f.type === 3) {
      for (const poly of polys(f, ext)) out.areas.push({ cls: p.class, sub: p.subclass, poly });
    } else if (f.type === 2) {
      for (const line of lines(f, ext))
        out.roads.push({ cls: p.class, sub: p.subclass, bridge: p.brunnel === 'bridge', unpaved: p.surface === 'unpaved', layer: p.layer || 0, line });
    }
  });
  each('aeroway', (f, ext, p) => {
    if (f.type === 3) for (const poly of polys(f, ext)) out.aeroway.push({ cls: p.class, poly });
    else if (f.type === 2) for (const line of lines(f, ext)) out.aeroway.push({ cls: p.class, line });
  });
  each('building', (f, ext, p) => {
    if (f.type !== 3) return;
    // planetiler aynı öznitelikli binaları çoklu poligonda birleştirir: tek tek ayrılır
    for (const poly of polys(f, ext))
      out.buildings.push({
        poly,
        h: Number(p.render_height) || 0,
        minH: Math.max(0, Number(p.render_min_height) || 0),
        hide: p.hide_3d === true || p.hide_3d === 'true',
        colour: typeof p.colour === 'string' ? p.colour : null,
      });
  });
  return out;
}

export async function loadVectorTile(tpl, z, x, y) {
  const buf = await fetchCached(tileUrl(tpl, z, x, y), 'buffer');
  return parseTile(buf);
}

// ---- poligon yardımcıları (düz dizi halkalar, herhangi bir birimde)

export function pointInRing(r, x, y) {
  let c = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2];
    const yi = r[i * 2 + 1];
    const xj = r[j * 2];
    const yj = r[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export function pointInPoly(poly, x, y) {
  if (!pointInRing(poly[0], x, y)) return false;
  for (let k = 1; k < poly.length; k++) if (pointInRing(poly[k], x, y)) return false;
  return true;
}

export function ringArea(r) {
  let a = 0;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) a += r[j * 2] * r[i * 2 + 1] - r[i * 2] * r[j * 2 + 1];
  return a / 2;
}

export function ringBox(r) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    const x = r[i];
    const y = r[i + 1];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

// Sutherland–Hodgman: halkayı [0,1]² karo karesine kırp (komşu karodaki parçayla birleşir)
export function clipRingUnit(r) {
  let pts = [];
  for (let i = 0; i < r.length; i += 2) pts.push([r[i], r[i + 1]]);
  const edges = [
    (p) => p[0] >= 0, (p) => p[0] <= 1, (p) => p[1] >= 0, (p) => p[1] <= 1,
  ];
  const cut = [
    (a, b) => { const t = (0 - a[0]) / (b[0] - a[0]); return [0, a[1] + (b[1] - a[1]) * t]; },
    (a, b) => { const t = (1 - a[0]) / (b[0] - a[0]); return [1, a[1] + (b[1] - a[1]) * t]; },
    (a, b) => { const t = (0 - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, 0]; },
    (a, b) => { const t = (1 - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, 1]; },
  ];
  let inside = true;
  for (let k = 0; k < r.length; k += 2) if (r[k] < 0 || r[k] > 1 || r[k + 1] < 0 || r[k + 1] > 1) inside = false;
  if (inside) return r;
  for (let e = 0; e < 4 && pts.length; e++) {
    const res = [];
    const keep = edges[e];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ia = keep(a);
      const ib = keep(b);
      if (ia) res.push(a);
      if (ia !== ib) res.push(cut[e](a, b));
    }
    pts = res;
  }
  if (pts.length < 3) return null;
  const out = new Float32Array(pts.length * 2);
  pts.forEach((p, i) => {
    out[i * 2] = p[0];
    out[i * 2 + 1] = p[1];
  });
  return Math.abs(ringArea(out)) > 1e-10 ? out : null;
}
