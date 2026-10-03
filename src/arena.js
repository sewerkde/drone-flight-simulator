import * as THREE from 'three';

// Lazer arena (oyun mekaniği): lazer çizgileri, isabet geometrisi, kısa sentez sesler.
// Ağ katmanı net.js'de; skorları sunucu tutar. Burada yalnız görsel/ses ve kendi üstümüzdeki isabet hesabı var.

export const RANGE = 150; // m, lazer menzili
export const LIVES = 3; // sabit: 3 isabette düşüş
export const FIRE_MS = 250; // yerel ateş aralığı
export const RESPAWN_MS = 3000; // düşüşten yeniden başlamaya
export const SHIELD_MS = 3000; // yeniden başlayınca dokunulmazlık
const TRACE_MS = 220; // ince izin sönme süresi
const BOLT_LEN = 22; // m, parlak mermi parçasının boyu
const BOLT_SPEED = 520; // m/sn
const SPARK_MS = 350; // isabet kıvılcımlarının ömrü
const SPARK_N = 22;
const POOL = 12; // aynı anda görünebilecek atış

// Araç ölçüsüne göre isabet küresi yarıçapı (m): küçük drone 0.5, Cinema sınıfı 1.5
export const hitRadius = (scale = 1) => Math.min(1.5, Math.max(0.5, 0.6 * scale));

// Işın (p başlangıç, d birim yön) küreye (c merkez, r yarıçap) max mesafe içinde değiyor mu? Değiyorsa mesafe, yoksa -1.
export function rayHitsSphere(p, d, c, r, max = RANGE) {
  const ox = c[0] - p[0];
  const oy = c[1] - p[1];
  const oz = c[2] - p[2];
  const t = ox * d[0] + oy * d[1] + oz * d[2]; // küre merkezinin ışın üzerindeki izdüşümü
  if (t < 0 || t > max) return -1;
  const px = ox - d[0] * t;
  const py = oy - d[1] * t;
  const pz = oz - d[2] * t;
  return px * px + py * py + pz * pz <= r * r ? t : -1;
}

// Yumuşak kenarlı beyaz nokta: namlu alevi, mermi ucu ve kıvılcımlar için
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.75)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Mermi gövdesi: +Z yönünde 0..1 uzanan silindir (uçlara doğru incelir), ölçekle boy verilir
function boltGeometry(radius) {
  const g = new THREE.CylinderGeometry(radius * 0.35, radius, 1, 10, 1, true);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, 0.5);
  return g;
}

const beamMat = (color, opacity, additiveBlend) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: additiveBlend ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide });

export class Lasers {
  // Her şey hayaletler gibi katman 0'da (FPV ve takip görünümünde görünür), toplamalı karışım: arka plan ne olursa olsun parlar.
  constructor(scene) {
    this.scene = scene;
    this.glow = glowTexture();
    this.coreGeo = boltGeometry(0.035);
    this.haloGeo = boltGeometry(0.11);
    this.pool = [];
    this.active = [];
    this.sparks = [];
    this._v = new THREE.Vector3();
  }

  _make() {
    const group = new THREE.Group();
    const core = new THREE.Mesh(this.coreGeo, beamMat('#ffffff', 0.85, true));
    const halo = new THREE.Mesh(this.haloGeo, beamMat('#ffffff', 0.6, false)); // renkli dış katman normal karışımla: açık gökte de rengini korur
    core.renderOrder = 9;
    halo.renderOrder = 8;
    group.add(halo, core);
    group.frustumCulled = false;
    core.frustumCulled = halo.frustumCulled = false;
    // tam menzil boyunca ince iz: atış yönü bir an için okunur
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const trace = new THREE.Line(geo, new THREE.LineBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    trace.frustumCulled = false;
    trace.renderOrder = 7;
    const sprite = () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.renderOrder = 10;
      return s;
    };
    return { group, core, halo, trace, muzzle: sprite(), tip: sprite(), t0: 0, p: [0, 0, 0], d: [0, 0, 1], len: RANGE };
  }

  // p: [x,y,z] başlangıç, d: birim yön, color: '#rrggbb' (pilotun rengi), len: ışının gideceği mesafe (isabette kısalır)
  fire(p, d, color, now = performance.now(), len = RANGE) {
    let b = this.pool.pop();
    if (!b) {
      if (this.active.length >= POOL) {
        b = this.active.shift();
        this._hide(b);
      } else b = this._make();
    }
    this.scene.add(b.group, b.trace, b.muzzle, b.tip);
    b.p = p;
    b.d = d;
    b.len = len;
    b.t0 = now;
    b.group.position.set(p[0], p[1], p[2]);
    b.group.lookAt(p[0] + d[0], p[1] + d[1], p[2] + d[2]);
    b.halo.material.color.set(color);
    b.trace.material.color.set(color);
    b.muzzle.material.color.set(color);
    b.tip.material.color.set(color);
    const a = b.trace.geometry.attributes.position.array;
    a[0] = p[0];
    a[1] = p[1];
    a[2] = p[2];
    a[3] = p[0] + d[0] * len;
    a[4] = p[1] + d[1] * len;
    a[5] = p[2] + d[2] * len;
    b.trace.geometry.attributes.position.needsUpdate = true;
    b.muzzle.position.set(p[0], p[1], p[2]);
    this.active.push(b);
    this._step(b, now);
  }

  // İsabet noktasında kıvılcım demeti + parlama (vurulan taraf kendi üstünde çağırır)
  impact(at, color, now = performance.now()) {
    const pos = new Float32Array(SPARK_N * 3);
    const vel = new Float32Array(SPARK_N * 3);
    for (let i = 0; i < SPARK_N; i++) {
      pos[i * 3] = at[0];
      pos[i * 3 + 1] = at[1];
      pos[i * 3 + 2] = at[2];
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const sp = 1.5 + Math.random() * 3;
      vel[i * 3] = Math.sin(ph) * Math.cos(th) * sp;
      vel[i * 3 + 1] = Math.cos(ph) * sp + 1;
      vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ map: this.glow, color, size: 0.07, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 10;
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    flash.position.set(at[0], at[1], at[2]);
    flash.renderOrder = 10;
    this.scene.add(pts, flash);
    this.sparks.push({ pts, flash, vel, t0: now, last: now });
  }

  _hide(b) {
    this.scene.remove(b.group, b.trace, b.muzzle, b.tip);
  }

  // Mermi başlangıçtan menzile doğru uçar; namlu alevi hızla, iz daha yavaş söner
  _step(b, now) {
    const t = (now - b.t0) / 1000;
    const head = Math.min(b.len, t * BOLT_SPEED);
    const tail = Math.max(0, head - BOLT_LEN);
    const L = head - tail;
    b.group.visible = L > 0.05 && head < b.len + 0.01 && (head < b.len || tail < b.len - 0.05);
    if (b.group.visible) {
      b.group.position.set(b.p[0] + b.d[0] * tail, b.p[1] + b.d[1] * tail, b.p[2] + b.d[2] * tail);
      b.core.scale.set(1, 1, L);
      b.halo.scale.set(1, 1, L);
      b.tip.visible = true;
      b.tip.position.set(b.p[0] + b.d[0] * head, b.p[1] + b.d[1] * head, b.p[2] + b.d[2] * head);
      b.tip.scale.set(0.35, 0.35, 1);
    } else b.tip.visible = false;
    const km = Math.min(1, (now - b.t0) / 90);
    b.muzzle.material.opacity = 1 - km;
    const ms = 0.35 * (1 - km) + 0.12;
    b.muzzle.scale.set(ms, ms, 1);
    const kt = Math.min(1, (now - b.t0) / TRACE_MS);
    b.trace.material.opacity = 0.55 * (1 - kt);
  }

  update(now, dt = 0.016) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      const flight = (b.len + BOLT_LEN) / BOLT_SPEED;
      if (now - b.t0 > Math.max(TRACE_MS, flight * 1000)) {
        this._hide(b);
        this.active.splice(i, 1);
        this.pool.push(b);
        continue;
      }
      this._step(b, now);
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      const k = (now - s.t0) / SPARK_MS;
      if (k >= 1) {
        this.scene.remove(s.pts, s.flash);
        s.pts.geometry.dispose();
        s.pts.material.dispose();
        s.flash.material.dispose();
        this.sparks.splice(i, 1);
        continue;
      }
      const step = Math.min(0.05, (now - s.last) / 1000);
      s.last = now;
      const a = s.pts.geometry.attributes.position.array;
      for (let j = 0; j < SPARK_N; j++) {
        s.vel[j * 3 + 1] -= 9.81 * step;
        a[j * 3] += s.vel[j * 3] * step;
        a[j * 3 + 1] += s.vel[j * 3 + 1] * step;
        a[j * 3 + 2] += s.vel[j * 3 + 2] * step;
      }
      s.pts.geometry.attributes.position.needsUpdate = true;
      s.pts.material.opacity = 1 - k * k;
      s.flash.material.opacity = Math.max(0, 1 - k * 4);
      const fs = 0.9 * (1 - k) + 0.2;
      s.flash.scale.set(fs, fs, 1);
    }
  }
}

// ---- sesler: main.js chime() kalıbı; ses bağlamı yoksa ya da kapalıysa sessiz
// Lazer "zap": hızlı inen testere dişi + kısa tıkırtı
export function zapSound(ctx, vol) {
  if (!ctx || ctx.state !== 'running' || !(vol > 0)) return;
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(1600, t0);
  o.frequency.exponentialRampToValueAtTime(220, t0 + 0.12);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.22 * vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + 0.16);
}

// Vuruldu: gürültü patlaması + alçak gümbürtü
export function hitSound(ctx, vol) {
  if (!ctx || ctx.state !== 'running' || !(vol > 0)) return;
  const t0 = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * 0.12);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const n = ctx.createBufferSource();
  n.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 900;
  bp.Q.value = 0.8;
  const ng = ctx.createGain();
  ng.gain.value = 0.35 * vol;
  n.connect(bp).connect(ng).connect(ctx.destination);
  n.start(t0);
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(140, t0);
  o.frequency.exponentialRampToValueAtTime(50, t0 + 0.2);
  g.gain.setValueAtTime(0.3 * vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + 0.26);
}
