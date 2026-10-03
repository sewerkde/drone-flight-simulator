import * as THREE from 'three';

// Mini sınıfı drone (~30 cm). root: konum + yön, body: eğim.
export function buildDroneModel() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const grey = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.45, metalness: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x25282c, roughness: 0.6 });

  const shell = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.05, 0.17), grey);
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.014, 0.12), dark);
  top.position.set(0, 0.031, 0.012);
  body.add(shell, top);

  const gimbal = new THREE.Group();
  gimbal.position.set(0, -0.006, -0.1);
  const cam = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.03, 0.03), dark);
  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.011, 0.011, 0.006, 16),
    new THREE.MeshStandardMaterial({ color: 0x0d1620, roughness: 0.1, metalness: 0.7 }),
  );
  lens.rotation.x = Math.PI / 2;
  lens.position.z = -0.017;
  cam.add(lens);
  gimbal.add(cam);
  body.add(gimbal);

  const ledFront = new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff2010, emissiveIntensity: 2.5 });
  const ledBack = new THREE.MeshStandardMaterial({ color: 0x30ff60, emissive: 0x20ff50, emissiveIntensity: 2.5 });
  const bladeGeo = new THREE.BoxGeometry(0.078, 0.002, 0.012);
  const props = [];

  for (const [sx, sz] of [[1, -1], [-1, -1], [1, 1], [-1, 1]]) {
    const from = new THREE.Vector3(sx * 0.03, 0, sz * 0.05);
    const to = new THREE.Vector3(sx * 0.11, 0.004, sz * 0.095);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.012, 1), dark);
    arm.position.copy(from).add(to).multiplyScalar(0.5);
    arm.scale.z = from.distanceTo(to);
    arm.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.02, 12), dark);
    motor.position.set(to.x, 0.012, to.z);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), sz < 0 ? ledFront : ledBack);
    led.position.set(to.x, -0.006, to.z);

    const prop = new THREE.Group();
    prop.position.set(to.x, 0.025, to.z);
    const blade = new THREE.Mesh(bladeGeo, dark);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.066, 28),
      new THREE.MeshBasicMaterial({ color: 0x2a2d31, transparent: true, opacity: 0, depthWrite: false }),
    );
    disc.rotation.x = -Math.PI / 2;
    prop.add(blade, disc);
    props.push({ prop, blade, disc, dir: sx * sz > 0 ? 1 : -1 });
    body.add(arm, motor, led, prop);
  }

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.layers.set(1);
    }
  });

  return { root, body, gimbal, props, ledBack };
}

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...extra });

function finish(root) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.layers.set(1);
    }
  });
}

function rotor(parent, x, y, z, radius, dir, bladeMat, axis = 'y') {
  const prop = new THREE.Group();
  prop.position.set(x, y, z);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(radius * 2, radius * 0.03, radius * 0.16), bladeMat);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 28),
    new THREE.MeshBasicMaterial({ color: 0x2a2d31, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
  );
  disc.rotation.x = -Math.PI / 2;
  prop.add(blade, disc);
  if (axis === 'z') prop.rotation.x = Math.PI / 2; // uçak pervanesi: ileri eksende döner
  parent.add(prop);
  return { prop, blade, disc, dir, axis };
}

// FPV: whoop (Avata 2, pervane korumalı) ya da yarış (karbon X gövde)
export function buildFpvModel(kind) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const dark = mat(0x22252a);
  const props = [];
  if (kind === 'whoop') {
    body.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.15), mat(0x3a3e45)));
    const duct = new THREE.TorusGeometry(0.058, 0.01, 8, 28);
    for (const [sx, sz] of [[1, -1], [-1, -1], [1, 1], [-1, 1]]) {
      const ring = new THREE.Mesh(duct, dark);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(sx * 0.075, 0, sz * 0.07);
      body.add(ring);
      props.push(rotor(body, sx * 0.075, 0.004, sz * 0.07, 0.05, sx * sz > 0 ? 1 : -1, dark));
    }
  } else {
    const carbon = mat(0x15171a, { roughness: 0.35 });
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.006, 0.3), carbon);
      arm.rotation.y = a;
      body.add(arm);
    }
    const battery = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.075), mat(0xd4572a));
    battery.position.y = 0.02;
    body.add(battery);
    for (const [sx, sz] of [[1, -1], [-1, -1], [1, 1], [-1, 1]]) {
      props.push(rotor(body, sx * 0.106, 0.012, sz * 0.106, 0.064, sx * sz > 0 ? 1 : -1, mat(0x7fd1ff, { transparent: true, opacity: 0.85 })));
    }
  }
  const cam = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.022, 0.02), dark);
  cam.position.set(0, 0.008, -0.085);
  body.add(cam);
  finish(root);
  return { root, body, props };
}

// ---- uçak modelleri: döndürülmüş profil gövde, profilli ve sivrilen kanatlar

// Gövde: uzunluk boyunca yarıçap profili (0 = burun, 1 = kuyruk), ileri -z.
function fuselageGeo(len, profile, wScale = 1, hScale = 1) {
  // profili eşit aralıklı örnekle: doku v koordinatı = boy oranı (0 burun, 1 kuyruk)
  const radius = (t) => {
    for (let i = 1; i < profile.length; i++) {
      const [t0, r0] = profile[i - 1];
      const [t1, r1] = profile[i];
      if (t <= t1) return r0 + ((r1 - r0) * (t - t0)) / Math.max(t1 - t0, 1e-6);
    }
    return profile[profile.length - 1][1];
  };
  // burundan kuyruğa: three.js bu sırayla yüzleri dışa çevirir; içeriden bakınca gövde çizilmez
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    pts.push(new THREE.Vector2(Math.max(radius(t), 0.0005), (0.5 - t) * len));
  }
  const g = new THREE.LatheGeometry(pts, 24);
  g.rotateX(-Math.PI / 2);
  g.scale(wScale, hScale, 1);
  return g;
}

// Kanat: kök/uç veter, kalınlık, ok açısı, dihedral. half=true ise kökten bir yana (dikey kuyruk için).
function wingGeo({ span, root, tip, thick, sweep = 0, dihedral = 0, half = false }) {
  const g = new THREE.BoxGeometry(span, 1, 1, 24, 2, 8);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const x = half ? (v.x / span + 0.5) * span : v.x;
    const t = half ? x / span : Math.abs(x) / (span / 2);
    const chord = root + (tip - root) * t;
    const c = v.z + 0.5; // 0 hücum kenarı, 1 firar kenarı
    const prof = Math.max(0, 2.6 * Math.sqrt(c) * (1 - c)); // basit kanat profili
    v.x = x;
    v.y = v.y * thick * chord * prof + Math.abs(x) * Math.tan(dihedral);
    v.z = (c - 0.25) * chord + sweep * t;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function addMesh(parent, geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function wheel(parent, r, w, x, y, z, m) {
  const g = new THREE.CylinderGeometry(r, r, w, 16);
  g.rotateZ(Math.PI / 2);
  return addMesh(parent, g, m, x, y, z);
}

export function buildPlaneModel(kind, gear = 0.1) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  let cockpit = null;
  let hull = null; // dış kabuk: kokpitten bakınca gizlenir (katman 3)
  const glass = mat(0x1a2633, { roughness: 0.08, metalness: 0.6 });
  const tire = mat(0x18191b, { roughness: 0.9 });
  const metal = mat(0xb9bec4, { metalness: 0.6, roughness: 0.3 });
  const props = [];
  const spinner = (z, r, color) => {
    const g = new THREE.ConeGeometry(r, r * 2.2, 16);
    g.rotateX(-Math.PI / 2);
    addMesh(body, g, mat(color, { metalness: 0.3 }), 0, 0, z);
  };

  if (kind === 'cessna') {
    const white = mat(0xf4f4f1, { roughness: 0.4 });
    const blue = mat(0x1e4d9b, { roughness: 0.4 });
    const L = 8.3;
    const skin = new THREE.MeshStandardMaterial({ map: cessnaSkin(), roughness: 0.35 });
    hull = addMesh(body, fuselageGeo(L, [[0, 0.32], [0.04, 0.55], [0.14, 0.62], [0.3, 0.66], [0.45, 0.6], [0.7, 0.36], [0.9, 0.2], [1, 0.12]], 0.95, 1.2), skin, 0, 0.1, 0);
    // kanat (yüksek), payanda, kuyruk
    addMesh(body, wingGeo({ span: 11, root: 1.6, tip: 1.15, thick: 0.13, dihedral: 0.03 }), white, 0, 0.92, -0.75);
    for (const sx of [-1, 1]) {
      const strut = addMesh(body, new THREE.CylinderGeometry(0.035, 0.035, 2.9, 8), metal, sx * 1.95, 0.2, -0.75);
      strut.rotation.z = sx * -1.1;
    }
    addMesh(body, wingGeo({ span: 3.4, root: 1.05, tip: 0.7, thick: 0.1 }), white, 0, 0.25, 3.55);
    addMesh(body, wingGeo({ span: 1.6, root: 1.5, tip: 0.75, thick: 0.1, sweep: 0.9, half: true }), blue, 0, 0.2, 3.3).rotation.z = Math.PI / 2;
    // iniş takımı
    for (const sx of [-1, 1]) {
      const leg = addMesh(body, new THREE.CylinderGeometry(0.04, 0.04, 1.2, 8), metal, sx * 0.85, -0.6, -0.35);
      leg.rotation.z = sx * 0.6;
      wheel(body, 0.3, 0.16, sx * 1.2, -gear + 0.3, -0.35, tire);
    }
    addMesh(body, new THREE.CylinderGeometry(0.04, 0.04, 0.8, 8), metal, 0, -0.65, -3.1);
    wheel(body, 0.24, 0.12, 0, -gear + 0.24, -3.1, tire);
    spinner(-4.35, 0.2, 0xd8d8d8);
    props.push(rotor(body, 0, 0.0, -4.2, 0.95, 1, mat(0x2a2a2a), 'z'));
    cockpit = cessnaCockpit();
    body.add(cockpit);
  } else if (kind === 'extra') {
    const white = mat(0xf6f6f6, { roughness: 0.35 });
    const red = mat(0xd22b24, { roughness: 0.35 });
    const navy = mat(0x14306e, { roughness: 0.35 });
    addMesh(body, fuselageGeo(1.1, [[0, 0.04], [0.06, 0.07], [0.2, 0.085], [0.4, 0.075], [0.75, 0.035], [1, 0.012]], 0.9, 1.1), white);
    addMesh(body, fuselageGeo(0.5, [[0, 0.041], [0.4, 0.088], [1, 0.07]], 0.92, 1.12), red, 0, 0, -0.33);
    const canopy = addMesh(body, new THREE.SphereGeometry(0.075, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, 0.06, -0.08);
    canopy.scale.set(0.8, 0.9, 2.2);
    addMesh(body, wingGeo({ span: 1.2, root: 0.32, tip: 0.18, thick: 0.15 }), red, 0, -0.05, -0.1);
    addMesh(body, wingGeo({ span: 1.18, root: 0.08, tip: 0.05, thick: 0.1 }), navy, 0, -0.035, -0.12);
    addMesh(body, wingGeo({ span: 0.42, root: 0.16, tip: 0.1, thick: 0.1 }), red, 0, 0.01, 0.47);
    addMesh(body, wingGeo({ span: 0.2, root: 0.2, tip: 0.12, thick: 0.1, sweep: 0.06, half: true }), red, 0, 0.02, 0.47).rotation.z = Math.PI / 2;
    // kuyruk tekerli (taildragger), tekerlek kaportası
    for (const sx of [-1, 1]) {
      const leg = addMesh(body, new THREE.BoxGeometry(0.012, 0.12, 0.03), white, sx * 0.08, -0.09, -0.2);
      leg.rotation.z = sx * 0.4;
      const pant = addMesh(body, new THREE.SphereGeometry(0.035, 12, 8), red, sx * 0.11, -gear + 0.032, -0.2);
      pant.scale.set(0.6, 0.9, 1.8);
    }
    wheel(body, 0.015, 0.01, 0, -0.035, 0.52, tire);
    spinner(-0.6, 0.04, 0xd22b24);
    props.push(rotor(body, 0, 0, -0.57, 0.15, 1, mat(0x222222), 'z'));
  } else if (kind === 'jet') {
    const grey = mat(0x6f7882, { roughness: 0.45, metalness: 0.2 });
    const dark = mat(0x343a42, { roughness: 0.5 });
    addMesh(body, fuselageGeo(1.4, [[0, 0.002], [0.12, 0.045], [0.3, 0.075], [0.6, 0.08], [0.9, 0.065], [1, 0.055]], 0.95, 1), grey);
    const canopy = addMesh(body, new THREE.SphereGeometry(0.05, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, 0.05, -0.33);
    canopy.scale.set(0.8, 0.8, 2.6);
    addMesh(body, wingGeo({ span: 1.1, root: 0.5, tip: 0.1, thick: 0.08, sweep: 0.3 }), grey, 0, -0.01, 0.02);
    addMesh(body, wingGeo({ span: 0.46, root: 0.18, tip: 0.07, thick: 0.08, sweep: 0.12 }), grey, 0, 0, 0.6);
    for (const sx of [-1, 1]) {
      const fin = addMesh(body, wingGeo({ span: 0.2, root: 0.22, tip: 0.09, thick: 0.08, sweep: 0.13, half: true }), dark, sx * 0.07, 0.04, 0.48);
      fin.rotation.z = Math.PI / 2 - sx * 0.25;
    }
    const nozzle = new THREE.CylinderGeometry(0.045, 0.05, 0.08, 16, 1, true);
    nozzle.rotateX(Math.PI / 2);
    addMesh(body, nozzle, mat(0x202020, { metalness: 0.7 }), 0, 0, 0.72);
  } else if (kind === 'glider') {
    const white = mat(0xf7f7f5, { roughness: 0.3 });
    const orange = mat(0xf0752a, { roughness: 0.35 });
    addMesh(body, fuselageGeo(0.45, [[0, 0.03], [0.15, 0.05], [0.5, 0.055], [1, 0.02]], 0.9, 1.1), white, 0, 0, -0.33);
    addMesh(body, fuselageGeo(0.75, [[0, 0.02], [1, 0.009]]), white, 0, 0.01, 0.25);
    const canopy = addMesh(body, new THREE.SphereGeometry(0.04, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, 0.035, -0.4);
    canopy.scale.set(0.8, 0.8, 2.4);
    addMesh(body, wingGeo({ span: 2.0, root: 0.17, tip: 0.08, thick: 0.12, dihedral: 0.07 }), white, 0, 0.045, -0.22);
    addMesh(body, wingGeo({ span: 0.12, root: 0.1, tip: 0.07, thick: 0.1 }), orange, -0.97, 0.045 + 0.97 * 0.07, -0.22);
    addMesh(body, wingGeo({ span: 0.12, root: 0.1, tip: 0.07, thick: 0.1 }), orange, 0.97, 0.045 + 0.97 * 0.07, -0.22);
    addMesh(body, wingGeo({ span: 0.17, root: 0.14, tip: 0.08, thick: 0.1, sweep: 0.06, half: true }), white, 0, 0.01, 0.58).rotation.z = Math.PI / 2;
    addMesh(body, wingGeo({ span: 0.34, root: 0.08, tip: 0.05, thick: 0.1 }), orange, 0, 0.18, 0.62);
    spinner(-0.58, 0.025, 0xbbbbbb);
    props.push(rotor(body, 0, 0, -0.56, 0.1, 1, mat(0x222222), 'z'));
  } else {
    // eğitim uçağı: yüksek kanat, burun tekerli
    const white = mat(0xf3f3ef, { roughness: 0.4 });
    const yellow = mat(0xf2c21b, { roughness: 0.4 });
    const red = mat(0xd3352b, { roughness: 0.4 });
    addMesh(body, fuselageGeo(1.15, [[0, 0.05], [0.06, 0.075], [0.25, 0.085], [0.45, 0.075], [0.8, 0.035], [1, 0.015]], 0.9, 1.15), white);
    const win = addMesh(body, new THREE.BoxGeometry(0.15, 0.05, 0.2), glass, 0, 0.06, -0.2);
    win.rotation.x = -0.15;
    addMesh(body, wingGeo({ span: 1.4, root: 0.25, tip: 0.2, thick: 0.15, dihedral: 0.05 }), yellow, 0, 0.1, -0.15);
    addMesh(body, wingGeo({ span: 0.5, root: 0.15, tip: 0.11, thick: 0.1 }), red, 0, 0.015, 0.5);
    addMesh(body, wingGeo({ span: 0.17, root: 0.17, tip: 0.09, thick: 0.1, sweep: 0.06, half: true }), red, 0, 0.03, 0.49).rotation.z = Math.PI / 2;
    for (const sx of [-1, 1]) {
      const leg = addMesh(body, new THREE.BoxGeometry(0.01, 0.1, 0.025), metal, sx * 0.07, -0.09, -0.12);
      leg.rotation.z = sx * 0.5;
      wheel(body, 0.03, 0.02, sx * 0.1, -gear + 0.03, -0.12, tire);
    }
    addMesh(body, new THREE.BoxGeometry(0.008, 0.09, 0.008), metal, 0, -0.09, -0.48);
    wheel(body, 0.025, 0.015, 0, -gear + 0.025, -0.48, tire);
    spinner(-0.62, 0.04, 0xd3352b);
    props.push(rotor(body, 0, 0, -0.59, 0.13, 1, mat(0x222222), 'z'));
  }
  finish(root);
  hull?.layers.set(3);
  // kokpit içi yalnız kokpit görünümünde (katman 2), gölge düşürmez
  cockpit?.traverse((o) => {
    if (o.isMesh) {
      o.layers.set(2);
      o.castShadow = false;
    }
  });
  return { root, body, props };
}

// Cessna gövde boyası: beyaz, yanlarda lacivert şerit, kabin camları. u = çevre (0 üst, .25 sağ), v = boy (0 burun).
function cessnaSkin() {
  const W = 512;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f4f1';
  g.fillRect(0, 0, W, H);
  const rect = (u0, u1, v0, v1, color) => {
    g.fillStyle = color;
    g.fillRect(u0 * W, (1 - v1) * H, (u1 - u0) * W, (v1 - v0) * H);
  };
  for (const [a, b] of [[0.235, 0.285], [0.715, 0.765]]) rect(a, b, 0.08, 0.93, '#1e4d9b'); // şerit
  for (const [a, b] of [[0.29, 0.31], [0.69, 0.71]]) rect(a, b, 0.1, 0.9, '#b3202a'); // ince kırmızı
  for (const [a, b] of [[0.13, 0.225], [0.775, 0.87]]) {
    rect(a, b, 0.16, 0.26, '#1a2633'); // ön kapı camı
    rect(a, b, 0.275, 0.36, '#1a2633'); // arka cam
  }
  rect(0, 0.11, 0.13, 0.19, '#1a2633'); // ön cam
  rect(0.89, 1, 0.13, 0.19, '#1a2633');
  rect(0, 0.05, 0.33, 0.4, '#1a2633'); // arka üst cam
  rect(0.95, 1, 0.33, 0.4, '#1a2633');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Cessna kokpiti: gösterge paneli, saatler, ön cam çerçevesi, lövye. Pilot gözü yaklaşık (-0.35, 1.05, -1.0).
function cessnaCockpit() {
  // pilot gözü yaklaşık (-0.35, 0.72, -1.0); panel göz hizasının altında
  const g = new THREE.Group();
  const dash = mat(0x2b2d31, { roughness: 0.8 });
  const frame = mat(0xd9d9d6, { roughness: 0.6 });
  addMesh(g, new THREE.BoxGeometry(1.15, 0.24, 0.3), dash, 0, 0.3, -1.85);
  addMesh(g, new THREE.BoxGeometry(1.18, 0.04, 0.32), dash, 0, 0.44, -1.86);
  const dial = new THREE.CircleGeometry(0.042, 24);
  const face = new THREE.MeshBasicMaterial({ color: 0x0f1012 });
  const ring = new THREE.MeshBasicMaterial({ color: 0xcfd2d6 });
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (let i = 0; i < 6; i++) {
    const x = -0.56 + (i % 3) * 0.11;
    const y = 0.36 - Math.floor(i / 3) * 0.1;
    addMesh(g, new THREE.RingGeometry(0.042, 0.048, 24), ring, x, y, -1.695);
    addMesh(g, dial, face, x, y, -1.696);
    const needle = addMesh(g, new THREE.PlaneGeometry(0.004, 0.034), white, x, y + 0.014, -1.694);
    needle.rotation.z = (i * 1.3) % 3;
  }
  for (const sx of [-1, 1]) {
    const post = addMesh(g, new THREE.BoxGeometry(0.03, 0.5, 0.03), frame, sx * 0.6, 0.66, -1.62);
    post.rotation.x = -0.65;
  }
  addMesh(g, new THREE.BoxGeometry(1.2, 0.04, 0.1), frame, 0, 0.88, -1.42);
  addMesh(g, new THREE.BoxGeometry(0.2, 0.025, 0.025), dash, -0.35, 0.33, -1.5);
  return g;
}


// ---- Blender'da üretilen DJI modelleri (assets/models/<id>.glb, tools/build_drones.py)
const GLB_IDS = ['neo', 'mini4', 'mini5', 'air3s', 'mavic4', 'inspire3'];
const glbCache = {};

export async function loadDroneModels() {
  const { GLTFLoader, DRACOLoader } = await import('../vendor/3d-tiles.bundle.js');
  const loader = new GLTFLoader();
  loader.setDRACOLoader(new DRACOLoader().setDecoderPath('./vendor/draco/')); // modeller Draco ile sıkıştırılmış
  await Promise.all(
    GLB_IDS.map((id) =>
      loader
        .loadAsync(`./assets/models/${id}.glb`)
        .then((g) => {
          glbCache[id] = g.scene;
        })
        .catch(() => {}), // eksikse basit modele düşülür
    ),
  );
  return Object.keys(glbCache);
}

export function hasGlbDrone(id) {
  return !!glbCache[id];
}

// Çalışma zamanı yapısı buildDroneModel ile aynı: root (konum+yön), body (eğim), gimbal, props, ledBack
export function buildGlbDrone(id) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const scene = glbCache[id].clone(true);
  body.add(scene);
  // en alt nokta (ayak) yerdeyken gövde merkezinin 7 cm altına denk gelsin (flight.js GROUND)
  const minY = new THREE.Box3().setFromObject(scene).min.y;
  if (minY < -0.07) scene.position.y = -0.07 - minY;
  const props = [];
  let gimbal = null;
  let ledBack = null;
  scene.traverse((o) => {
    if (o.name === 'gimbal') gimbal = o;
    const m = /^prop_(\d)$/.exec(o.name);
    if (m) {
      const box = new THREE.Box3().setFromObject(o);
      const r = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(r, 32),
        new THREE.MeshBasicMaterial({ color: 0x2a2d31, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
      );
      disc.rotation.x = -Math.PI / 2;
      o.add(disc);
      props.push({ prop: o, blade: o, disc, dir: Number(m[1]) % 3 === 0 ? 1 : -1, axis: 'y' });
    }
    if (o.isMesh) {
      if (o.material?.name === 'led_back') {
        o.material = o.material.clone();
        ledBack = o.material;
      }
      o.castShadow = true;
      o.layers.set(1);
    }
  });
  // pervane: blade görünürlüğü yerine kanat ağını gizlemek için ayrı tut
  for (const p of props) {
    p.blade = { set visible(v) { p.prop.children.forEach((c) => c !== p.disc && (c.visible = v)); if (p.prop.isMesh) p.prop.material.visible = v; } };
  }
  return { root, body, gimbal: gimbal || new THREE.Object3D(), props, ledBack, glb: true };
}
