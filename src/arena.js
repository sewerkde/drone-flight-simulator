import * as THREE from 'three';

// Lazer arena (oyun mekaniği): lazer çizgileri, isabet geometrisi, kısa sentez sesler.
// Ağ katmanı net.js'de; skorları sunucu tutar. Burada yalnız görsel/ses ve kendi üstümüzdeki isabet hesabı var.

export const RANGE = 150; // m, lazer menzili
export const LIVES = 3; // sabit: 3 isabette düşüş
export const FIRE_MS = 250; // yerel ateş aralığı
export const RESPAWN_MS = 3000; // düşüşten yeniden başlamaya
export const SHIELD_MS = 3000; // yeniden başlayınca dokunulmazlık
const BEAM_MS = 150; // çizginin sönme süresi
const POOL = 12; // aynı anda görünebilecek çizgi

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

// Başlangıç parlaması: yumuşak kenarlı beyaz nokta
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Lasers {
  // Çizgiler hayaletler gibi katman 0'da: her görünümde (FPV, takip) görünür.
  constructor(scene) {
    this.scene = scene;
    this.glow = glowTexture();
    this.pool = [];
    this.active = [];
  }

  _make() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ transparent: true, depthWrite: false }));
    line.frustumCulled = false;
    line.renderOrder = 8;
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    flash.renderOrder = 9;
    return { line, flash, t0: 0 };
  }

  // p: [x,y,z] başlangıç, d: birim yön, color: '#rrggbb' (pilotun rengi)
  fire(p, d, color, now = performance.now()) {
    let b = this.pool.pop();
    if (!b) {
      if (this.active.length >= POOL) b = this.active.shift();
      else {
        b = this._make();
        this.scene.add(b.line, b.flash);
      }
    } else this.scene.add(b.line, b.flash);
    const a = b.line.geometry.attributes.position.array;
    a[0] = p[0];
    a[1] = p[1];
    a[2] = p[2];
    a[3] = p[0] + d[0] * RANGE;
    a[4] = p[1] + d[1] * RANGE;
    a[5] = p[2] + d[2] * RANGE;
    b.line.geometry.attributes.position.needsUpdate = true;
    b.line.material.color.set(color);
    b.flash.material.color.set(color);
    b.flash.position.set(p[0], p[1], p[2]);
    b.t0 = now;
    this.active.push(b);
  }

  update(now) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      const k = (now - b.t0) / BEAM_MS;
      if (k >= 1) {
        this.scene.remove(b.line, b.flash);
        this.active.splice(i, 1);
        this.pool.push(b);
        continue;
      }
      b.line.material.opacity = 1 - k * k;
      b.flash.material.opacity = 1 - k;
      const s = 0.9 * (1 - k) + 0.2;
      b.flash.scale.set(s, s, 1);
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
