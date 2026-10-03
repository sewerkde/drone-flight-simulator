import * as THREE from 'three';

// Basit geometri birleştirme (BufferGeometryUtils vendor'da yok).
// parts: [geometri, malzemeIndeksi] dizisi. Hepsi indekssize çevrilir; position + normal + uv
// birleştirilir, aynı malzemeli ardışık parçalar tek grupta toplanır. Girdi geometrileri atılır.
export function mergeGeos(parts) {
  const list = parts.map((p) => (Array.isArray(p) ? p : [p, 0]));
  const flat = list.map(([g, m]) => {
    const n = g.index ? g.toNonIndexed() : g;
    if (!n.attributes.normal) n.computeVertexNormals();
    return [n, m];
  });
  let count = 0;
  for (const [g] of flat) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const out = new THREE.BufferGeometry();
  let o = 0;
  let last = -1;
  for (const [g, m] of flat) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    if (m === last) out.groups[out.groups.length - 1].count += c;
    else out.addGroup(o, c, m);
    last = m;
    o += c;
  }
  for (const [g] of list) g.dispose();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

// Ağaç türleri: gövde + çok parçalı taç. r/h çarpışma silindiri (ölçek 1'de).
export function treeTypes() {
  const ico = (r, d, x, y, z, sx = 1, sy = 1, sz = 1) =>
    new THREE.IcosahedronGeometry(r, d).scale(sx, sy, sz).translate(x, y, z);
  const cone = (r, h, y, seg = 8) => new THREE.ConeGeometry(r, h, seg).translate(0, y, 0);
  // gövde: uçları toprakta ve taçta gizli → kapaksız
  const trunk = (r0, r1, h) => new THREE.CylinderGeometry(r0, r1, h, 6, 1, true).translate(0, h / 2 - 0.3, 0);
  return {
    // çam / ladin: üst üste üç koni
    pine: {
      trunk: trunk(0.14, 0.24, 2.6),
      crown: mergeGeos([cone(1.9, 3.6, 3.4, 7), cone(1.5, 3.0, 5.0, 6), cone(1.0, 2.6, 6.6, 6)]),
      r: 1.6, h: 8, hue: [0.30, 0.37], sat: [0.32, 0.45], light: [0.16, 0.24],
    },
    // geniş yapraklı: üç loblu yuvarlak taç
    leaf: {
      trunk: trunk(0.17, 0.3, 3.2),
      crown: mergeGeos([
        ico(2.3, 1, 0, 4.7, 0, 1, 0.9, 1),
        ico(1.7, 0, 1.4, 4.1, 0.5),
        ico(1.6, 0, -1.0, 5.4, -0.7),
      ]),
      r: 2.2, h: 7.2, hue: [0.2, 0.3], sat: [0.38, 0.55], light: [0.22, 0.34],
    },
    // iki loblu yayvan (meşe, ceviz)
    broad: {
      trunk: trunk(0.2, 0.34, 3.0),
      crown: mergeGeos([
        ico(2.6, 1, -0.6, 4.4, 0, 1, 0.72, 1),
        ico(2.0, 0, 1.5, 4.0, 0.6, 1, 0.8, 1),
        ico(1.5, 0, 0.3, 5.3, -0.9),
      ]),
      r: 2.6, h: 6.4, hue: [0.17, 0.26], sat: [0.35, 0.5], light: [0.2, 0.3],
    },
    // kavak: dar ve uzun, yol kenarında
    tall: {
      trunk: trunk(0.15, 0.24, 2.4),
      crown: mergeGeos([
        ico(1.3, 1, 0, 5.2, 0, 1, 2.6, 1),
        ico(0.9, 0, 0.3, 8.4, 0.1, 1, 1.6, 1),
      ]),
      r: 1.2, h: 10, hue: [0.22, 0.3], sat: [0.35, 0.5], light: [0.24, 0.32],
    },
  };
}

// Çalı: gövdesiz, üç küçük top (düşük poligon)
export function bushGeo() {
  return mergeGeos([
    new THREE.IcosahedronGeometry(0.9, 0).scale(1, 0.75, 1).translate(0, 0.5, 0),
    new THREE.IcosahedronGeometry(0.65, 0).translate(0.6, 0.45, 0.25),
    new THREE.IcosahedronGeometry(0.6, 0).translate(-0.45, 0.5, -0.4),
  ]);
}

// Çatı: kalınlıklı ters V (saçak + kalkan taşması) ve kalkan üçgeni, tek geometri iki grup:
// 0 = duvar rengi (kalkan), 1 = çatı. Mahya z ekseni boyunca, taban y=0.
export function roofGeo(span, len, rh, eave = 0.55, over = 0.45, T = 0.22) {
  const a = Math.atan2(rh, span / 2);
  const ex = eave * Math.cos(a);
  const ey = eave * Math.sin(a);
  const tv = T / Math.cos(a);
  const s = new THREE.Shape();
  s.moveTo(-span / 2 - ex, -ey);
  s.lineTo(0, rh);
  s.lineTo(span / 2 + ex, -ey);
  s.lineTo(span / 2 + ex, -ey + tv);
  s.lineTo(0, rh + tv);
  s.lineTo(-span / 2 - ex, -ey + tv);
  s.closePath();
  const roof = new THREE.ExtrudeGeometry(s, { depth: len + over * 2, bevelEnabled: false });
  roof.translate(0, 0, -(len + over * 2) / 2);
  const g = new THREE.Shape();
  g.moveTo(-span / 2, 0);
  g.lineTo(span / 2, 0);
  g.lineTo(0, rh);
  g.closePath();
  const gable = new THREE.ExtrudeGeometry(g, { depth: len - 0.02, bevelEnabled: false });
  gable.translate(0, 0, -(len - 0.02) / 2);
  return mergeGeos([[gable, 0], [roof, 1]]);
}
