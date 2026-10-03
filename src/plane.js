import * as THREE from 'three';
import { t } from './i18n.js';
import { CRASH_KINDS } from './flight.js';

// Sabit kanat: kaldırma, sürükleme, itki, stall. Gövde ekseni: ileri -z, yukarı +y, sağ +x.
// Mode 2: sol dikey = gaz (yaylı çubuk olduğu için gaz seviyesini artırır/azaltır), sol yatay = dümen,
// sağ dikey = irtifa dümeni, sağ yatay = kanatçık.
// C/N/S anahtarı: C acemi (kendini düzeltir, yatış/yunuslama sınırlı), N normal (kanatları düzeltir), S manuel.
const DEG = Math.PI / 180;
const G = 9.81;
const RHO = 1.225;

export const PLANES = {
  trainer: {
    name: 'RC eğitim uçağı',
    group: 'Uçak',
    type: 'plane',
    model: 'trainer',
    kind: 'rc',
    mass: 1.6, S: 0.32, CL0: 0.35, CLa: 4.6, CLmax: 1.3, CD0: 0.04, k: 0.07,
    T: 18, vProp: 35, rates: { roll: 150, pitch: 110, yaw: 60 }, tau: 0.12,
    gear: 0.13, radius: 0.35, flightMin: 12, top: 25, rthAlt: 60, start: 'hand',
  },
  extra: {
    name: 'RC akrobasi uçağı',
    group: 'Uçak',
    type: 'plane',
    model: 'extra',
    kind: 'rc',
    mass: 1.4, S: 0.28, CL0: 0.05, CLa: 4.5, CLmax: 1.25, CD0: 0.035, k: 0.08,
    T: 32, vProp: 48, rates: { roll: 420, pitch: 260, yaw: 140 }, tau: 0.06,
    gear: 0.12, radius: 0.3, flightMin: 8, top: 36, rthAlt: 60, start: 'hand',
  },
  glider: {
    name: 'RC planör',
    group: 'Uçak',
    type: 'plane',
    model: 'glider',
    kind: 'rc',
    mass: 1.2, S: 0.38, CL0: 0.4, CLa: 5.2, CLmax: 1.35, CD0: 0.018, k: 0.035,
    T: 10, vProp: 28, rates: { roll: 90, pitch: 90, yaw: 50 }, tau: 0.15,
    gear: 0.06, radius: 0.4, flightMin: 25, top: 22, rthAlt: 80, start: 'hand',
  },
  jet: {
    name: 'RC jet (EDF)',
    group: 'Uçak',
    type: 'plane',
    model: 'jet',
    kind: 'rc',
    mass: 3.5, S: 0.32, CL0: 0.1, CLa: 4.2, CLmax: 1.2, CD0: 0.022, k: 0.09,
    T: 45, vProp: 75, rates: { roll: 300, pitch: 180, yaw: 80 }, tau: 0.08,
    gear: 0.08, radius: 0.4, flightMin: 6, top: 55, rthAlt: 80, start: 'hand',
  },
  cessna: {
    name: 'Cessna 172',
    group: 'Uçak',
    type: 'plane',
    model: 'cessna',
    kind: 'real',
    mass: 1000, S: 16.2, CL0: 0.3, CLa: 5.0, CLmax: 1.6, CD0: 0.028, k: 0.054,
    T: 3300, vProp: 95, rates: { roll: 55, pitch: 25, yaw: 15 }, tau: 0.35,
    gear: 1.2, radius: 3, flightMin: 240, top: 60, rthAlt: 300, start: 'air', startAlt: 300, startSpeed: 52,
  },
};

const MODE_LABELS = { C: 'A', N: 'N', S: 'M' };
const MODE_NAMES = { C: 'mode.beginner', N: 'Normal', S: 'mode.manual' };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export class Plane {
  constructor(world, id) {
    this.world = world;
    this.id = id;
    this.kind = 'plane';
    this.mode = 'C';
    this.events = [];
    this.quat = new THREE.Quaternion();
    this.rates = new THREE.Vector3();
    this.reset();
  }

  get spec() {
    return PLANES[this.id];
  }

  modeLabel(m = this.mode) {
    return MODE_LABELS[m];
  }

  modeName(m = this.mode) {
    return t(MODE_NAMES[m]);
  }

  get vStall() {
    const s = this.spec;
    return Math.sqrt((2 * s.mass * G) / (RHO * s.S * s.CLmax));
  }

  get motors() {
    return this.state !== 'off' && this.state !== 'crashed';
  }

  get airborne() {
    return this.state === 'flying' || this.state === 'rth';
  }

  get height() {
    return this.pos.y - this.spec.gear - this.home.y;
  }

  emit(kind, text, vars) {
    this.events.push({ kind, text, vars });
  }

  forward(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this.quat);
  }

  reset() {
    const s = this.spec;
    const g = this.world.groundAt(0, 0, 50);
    this.home = new THREE.Vector3(0, g, 0);
    this.pos = new THREE.Vector3(0, g + s.gear, 0);
    this.prevPos = this.pos.clone();
    this.vel = new THREE.Vector3();
    this.quat.identity();
    this.rates.set(0, 0, 0);
    this.yaw = 0;
    this.gimbal = 0;
    this.throttle = 0;
    this.prop = 0;
    this.state = 'off'; // off | ground | flying | rth | crashed
    this.battery = 1;
    this.flightTime = 0;
    this.crash = null;
    this.warned = {};
    this.stallT = 0;
    this.time = 0;
    this.alpha = 0;
    this.world.resetSweep();
    if (s.start === 'air') this._airStart();
  }

  _airStart() {
    const s = this.spec;
    this.pos.set(0, this.home.y + s.startAlt, 0);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, -s.startSpeed);
    this.throttle = 0.75;
    this.prop = 1;
    this.state = 'flying';
  }

  // Kalkış: RC uçak elle fırlatılır; yerdeki gerçek uçakta tam gaz.
  takeoff() {
    if (this.state === 'crashed') return;
    if (this.spec.start === 'hand' && (this.state === 'off' || this.state === 'ground')) {
      // burun 10° yukarıda, ileri doğru fırlat
      _e.set(10 * DEG, this.yaw, 0, 'YXZ');
      this.quat.setFromEuler(_e);
      this.rates.set(0, 0, 0);
      this.pos.y += 1.6;
      this.vel.copy(this.forward(_f)).multiplyScalar(this.vStall * 1.5);
      this.launchT = 3;
      this.throttle = 0.75;
      this.state = 'flying';
      this.emit('info', 'ev.handLaunch');
    } else if (this.state === 'off' || this.state === 'ground') {
      this.throttle = 1;
      this.state = 'ground';
      this.emit('info', 'ev.fullThrottle');
    }
  }

  land() {
    this.throttle = 0;
    this.emit('info', 'ev.cutThrottle');
  }

  toggleRth() {
    if (this.state === 'rth') {
      this.state = 'flying';
      this.emit('info', 'ev.rthCancel');
    } else if (this.state === 'flying') {
      this.state = 'rth';
      this.emit('info', 'ev.planeRth');
    }
  }

  _crash(text) {
    this.state = 'crashed';
    this.throttle = 0;
    this.crash = { text };
    this.emit('crash', text);
  }

  step(inp, dt, opt) {
    const s = this.spec;
    this.time += dt;
    this.prevPos.copy(this.pos);
    this.launchT = Math.max(0, (this.launchT || 0) - dt);
    const mul = opt.speedMul || 1;

    const F = _f.set(0, 0, -1).applyQuaternion(this.quat);
    const U = _u.set(0, 1, 0).applyQuaternion(this.quat);
    const R = _r.set(1, 0, 0).applyQuaternion(this.quat);

    if (this.state === 'crashed') {
      this.vel.y -= G * dt;
      this.vel.multiplyScalar(1 - 0.5 * dt);
      this.pos.addScaledVector(this.vel, dt);
      const floor = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y) + s.gear * 0.5;
      if (this.pos.y < floor) {
        this.pos.y = floor;
        this.vel.set(0, 0, 0);
      }
      this.prop *= 1 - 3 * dt;
      return;
    }

    // CSC (iki çubuk aşağı-içe) da kalkış sayılır
    const csc = inp.thr < -0.8 && inp.pitch < -0.8 && Math.abs(inp.yaw) > 0.8 && Math.abs(inp.roll) > 0.8;
    if (csc && this.state === 'off' && !this.cscLatch) {
      this.cscLatch = true;
      this.takeoff();
    }
    if (!csc) this.cscLatch = false;

    if (this.state === 'off') {
      this.prop *= 1 - 3 * dt;
      return;
    }

    // gaz: yaylı çubukla seviye artır/azalt (saniyede %60)
    if (this.state !== 'rth') this.throttle = clamp(this.throttle + inp.thr * 0.6 * dt, 0, 1);
    this.prop += (this.throttle - this.prop) * Math.min(1, dt * 4);

    // ---- aerodinamik
    const va = this.vel;
    const V = va.length();
    const vhat = V > 0.1 ? _vh.copy(va).divideScalar(V) : _vh.copy(F);
    const u = va.dot(F);
    const w = va.dot(U);
    const alpha = V > 1 ? Math.atan2(-w, Math.max(u, 0.1)) : 0;
    const beta = V > 1 ? Math.asin(clamp(va.dot(R) / V, -1, 1)) : 0;
    this.alpha = alpha;
    const aStall = (s.CLmax - s.CL0) / s.CLa;
    let CL = clamp(s.CL0 + s.CLa * alpha, -s.CLmax * 0.8, s.CLmax);
    if (Math.abs(alpha) > aStall + 0.05) CL *= Math.max(0.35, 1 - (Math.abs(alpha) - aStall) * 3);
    const q = 0.5 * RHO * V * V;
    const acc = _a.set(0, -G, 0);

    // kaldırma: hava akışına dik, gövde yukarı yönünde
    const liftDir = _l.copy(U).addScaledVector(vhat, -U.dot(vhat));
    if (liftDir.lengthSq() > 1e-6) acc.addScaledVector(liftDir.normalize(), (q * s.S * CL) / s.mass);
    // sürükleme
    acc.addScaledVector(vhat, (-q * s.S * (s.CD0 + s.k * CL * CL + 0.5 * beta * beta)) / s.mass);
    // yan kuvvet: kaymayı azaltır
    acc.addScaledVector(R, (-q * s.S * 0.6 * beta) / s.mass);
    // itki: pervane hızla zayıflar
    const T = this.throttle * s.T * mul * Math.max(0, 1 - Math.max(u, 0) / (s.vProp * mul));
    acc.addScaledVector(F, T / s.mass);

    // ---- açısal: çubuk komutu (hava hızıyla etkinleşir) + kararlılık + otomatik modlar
    const qRef = 0.5 * RHO * (1.6 * this.vStall) ** 2;
    const auth = clamp(q / qRef, 0, 1.3);
    const bank = Math.asin(clamp(-R.y, -1, 1)); // sağa yatış +
    const pitchAng = Math.asin(clamp(F.y, -1, 1));
    const gamma = V > 1 ? Math.asin(clamp(va.y / V, -1, 1)) : 0;
    let wx = -inp.pitch * s.rates.pitch * DEG * auth;
    let wy = -inp.yaw * s.rates.yaw * DEG * auth;
    let wz = -inp.roll * s.rates.roll * DEG * auth;

    if (this.state === 'rth') {
      const toHome = Math.atan2(-(this.home.x - this.pos.x), -(this.home.z - this.pos.z));
      const dist = Math.hypot(this.home.x - this.pos.x, this.home.z - this.pos.z);
      const want = dist < 80 ? 25 * DEG : clamp(angDiff(this.yaw, toHome) * 1.5, -30 * DEG, 30 * DEG);
      wz = -2 * (want - bank);
      const gTarget = clamp((this.home.y + s.rthAlt - this.pos.y) * 0.03, -0.15, 0.2);
      wx = 1.5 * (gTarget - gamma);
      this.throttle += (0.6 - this.throttle) * Math.min(1, dt);
      if (Math.abs(inp.pitch) > 0.5 || Math.abs(inp.roll) > 0.5) this.toggleRth();
    } else if (this.mode !== 'S') {
      if (Math.abs(inp.roll) < 0.08) wz += (this.mode === 'C' ? 2.2 : 0.8) * bank;
      if (this.mode === 'C') {
        // acemi: çubuk bırakılınca gövde hafif burun yukarıda sabitlenir; gaz verince kendiliğinden tırmanır
        // fırlatmadan sonraki 3 sn kalkış yardımı: 15° tırmanış
        const trim = this.launchT > 0 ? 15 : 5;
        if (Math.abs(inp.pitch) < 0.08) wx += -2.0 * (pitchAng - trim * DEG);
        if (bank > 50 * DEG && wz < 0) wz = 0;
        if (bank < -50 * DEG && wz > 0) wz = 0;
        if (pitchAng > 30 * DEG && wx > 0) wx = 0;
        if (pitchAng < -30 * DEG && wx < 0) wx = 0;
      }
    }
    // koordineli dönüş (C/N) ve ok kararlılığı
    if (this.mode !== 'S' && V > 3) wy += -(G * Math.tan(clamp(bank, -1.3, 1.3)) / V) * Math.cos(bank);
    wx += -2.5 * alpha * auth;
    wy += -2.0 * beta * auth;
    _t.set(wx, wy, wz);
    this.rates.lerp(_t, 1 - Math.exp(-dt / s.tau));
    const ang = this.rates.length() * dt;
    if (ang > 1e-7) {
      _dq.setFromAxisAngle(_axis.copy(this.rates).normalize(), ang);
      this.quat.multiply(_dq).normalize();
    }

    // ---- entegrasyon
    this.vel.addScaledVector(acc, dt);
    this.pos.addScaledVector(this.vel, dt);
    const fNow = _f.set(0, 0, -1).applyQuaternion(this.quat);
    if (Math.hypot(fNow.x, fNow.z) > 0.05) this.yaw = Math.atan2(-fNow.x, -fNow.z);
    if (this.airborne) this.flightTime += dt;

    // stall uyarısı
    this.stallT -= dt;
    if (this.airborne && alpha > aStall * 0.9 && V < this.vStall * 1.25 && this.stallT <= 0) {
      this.stallT = 3;
      this.emit('warn', 'ev.stall');
    }

    if (opt.battery) {
      this.battery = Math.max(0, this.battery - (dt / (s.flightMin * 60)) * (0.3 + this.throttle));
      if (this.battery <= 0 && this.throttle > 0) {
        this.throttle = 0;
        this.emit('warn', s.kind === 'real' ? 'ev.fuelOut' : 'ev.battOutGlide');
      }
    }

    // ---- engel ve zemin
    const hit = this.world.resolve(this.pos, this.vel, s.radius);
    if (hit && hit.speed > 3) return this._crash('crash.' + (CRASH_KINDS.includes(hit.kind) ? hit.kind : 'building'));
    if (this.world.isWater(this.pos.x, this.pos.z) && this.pos.y - this.world.groundAt(this.pos.x, this.pos.z, this.pos.y) < 0.4) return this._crash('crash.water');
    const floor = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y) + s.gear;
    if (this.pos.y <= floor) {
      const bankNow = Math.asin(clamp(-_r.set(1, 0, 0).applyQuaternion(this.quat).y, -1, 1));
      const pitchNow = Math.asin(clamp(fNow.y, -1, 1));
      if (this.vel.y < -3.5 || Math.abs(bankNow) > 25 * DEG || pitchNow < -12 * DEG) {
        this.pos.y = floor;
        return this._crash(this.vel.y < -3.5 ? 'crash.hard' : 'crash.wing');
      }
      this.pos.y = floor;
      this.vel.y = Math.max(0, this.vel.y);
      // tekerlek: yana kaymaz, yuvarlanma sürtünmesi, dümenle yönlenir
      const fh = _vh.set(fNow.x, 0, fNow.z).normalize();
      const along = this.vel.dot(fh);
      const roll = Math.max(0, Math.abs(along) - (0.04 * G + (this.throttle < 0.05 ? 0.3 * G : 0)) * dt) * Math.sign(along);
      this.vel.set(fh.x * roll, this.vel.y, fh.z * roll);
      const steer = -inp.yaw * 40 * DEG * Math.min(1, Math.abs(along) / 5) * dt;
      _e.set(clamp(pitchNow, 0, 12 * DEG), this.yaw + steer, 0, 'YXZ');
      this.quat.setFromEuler(_e);
      this.rates.set(0, 0, 0);
      if (this.state === 'flying' || this.state === 'rth') {
        this.state = 'ground';
        this.emit('info', 'ev.wheelsDown');
      }
    } else if (this.state === 'ground' && this.pos.y > floor + 0.3) {
      this.state = 'flying';
    }
  }
}

const _f = new THREE.Vector3();
const _u = new THREE.Vector3();
const _r = new THREE.Vector3();
const _a = new THREE.Vector3();
const _l = new THREE.Vector3();
const _t = new THREE.Vector3();
const _vh = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _dq = new THREE.Quaternion();
const _e = new THREE.Euler();
