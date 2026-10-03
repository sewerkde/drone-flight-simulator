import * as THREE from 'three';

// GPS modunda DJI drone: çubuk = hız komutu, bırakınca yerinde durur.
export const MODES = { C: { name: 'Cine' }, N: { name: 'Normal' }, S: { name: 'Sport' } };

// Fabrika değerleri (m/s), DJI teknik özelliklerinden. ~ işaretliler yayımlanmamış, tahmini.
// yaw °/s ve tau (tepki süresi, sn) uçuş hissi için seçildi.
export const DRONES = {
  neo: {
    name: 'Palm',
    tag: '135 g',
    group: 'DJI drone',
    type: 'drone',
    scale: 0.55,
    flightMin: 18,
    modes: {
      C: { h: 3, up: 2, down: 2, yaw: 40, tau: 0.9 }, // ~
      N: { h: 6, up: 2, down: 2, yaw: 80, tau: 0.5 }, // up/down ~
      S: { h: 8, up: 3, down: 3, yaw: 120, tau: 0.4 }, // up/down ~
    },
  },
  mini4: {
    name: 'Compact',
    tag: '249 g',
    group: 'DJI drone',
    type: 'drone',
    scale: 1,
    flightMin: 34,
    modes: {
      C: { h: 12, up: 3, down: 3, yaw: 40, tau: 1.0 },
      N: { h: 12, up: 5, down: 5, yaw: 90, tau: 0.55 },
      S: { h: 16, up: 5, down: 5, yaw: 150, tau: 0.35 },
    },
  },
  mini5: {
    name: 'Compact Pro',
    tag: '249 g',
    group: 'DJI drone',
    type: 'drone',
    scale: 1,
    flightMin: 36,
    modes: {
      C: { h: 12, up: 5, down: 5, yaw: 40, tau: 1.0 }, // h ~
      N: { h: 12, up: 5, down: 5, yaw: 90, tau: 0.55 }, // h ~
      S: { h: 18, up: 10, down: 6, yaw: 160, tau: 0.33 },
    },
  },
  air3s: {
    name: 'Travel',
    tag: '720 g',
    group: 'DJI drone',
    type: 'drone',
    scale: 1.35,
    flightMin: 45,
    modes: {
      C: { h: 12, up: 6, down: 6, yaw: 40, tau: 1.0 }, // ~
      N: { h: 12, up: 6, down: 6, yaw: 90, tau: 0.5 }, // ~
      S: { h: 21, up: 10, down: 10, yaw: 170, tau: 0.32 },
    },
  },
  mavic4: {
    name: 'Pro Camera',
    tag: '1 kg',
    group: 'DJI drone',
    type: 'drone',
    scale: 1.6,
    flightMin: 51,
    modes: {
      C: { h: 12, up: 5, down: 5, yaw: 40, tau: 1.0 }, // ~
      N: { h: 12, up: 6, down: 6, yaw: 90, tau: 0.5 }, // ~
      S: { h: 27, up: 10, down: 10, yaw: 170, tau: 0.32 },
    },
  },
  inspire3: {
    name: 'Cinema',
    tag: '4 kg',
    group: 'DJI drone',
    type: 'drone',
    scale: 2.6,
    flightMin: 28,
    modes: {
      C: { h: 12, up: 5, down: 5, yaw: 35, tau: 1.1 }, // ~
      N: { h: 15, up: 6, down: 6, yaw: 80, tau: 0.6 }, // ~
      S: { h: 26, up: 8, down: 8, yaw: 150, tau: 0.38 },
    },
  },
  // FPV: anahtar C/N = açı modu (Drone fiziği), S = Manuel (akro, fpv.js)
  avata2: {
    name: 'Cinewhoop',
    tag: 'FPV',
    group: 'FPV drone',
    type: 'fpv',
    model: 'whoop',
    scale: 1,
    flightMin: 23,
    modeLabels: { C: 'N', N: 'S', S: 'M' },
    modeNames: { C: 'Normal', N: 'Sport', S: 'mode.manualAcro' },
    modes: {
      C: { h: 8, up: 4, down: 4, yaw: 90, tau: 0.45 }, // up/down ~
      N: { h: 16, up: 6, down: 6, yaw: 150, tau: 0.3 }, // up/down ~
      S: { h: 16, up: 6, down: 6, yaw: 150, tau: 0.3 },
    },
    acro: { rate: 500, yawRate: 300, twr: 2.6, vmax: 27, uptilt: 15 },
  },
  racer5: {
    name: 'Racer 5″',
    tag: 'FPV',
    group: 'FPV drone',
    type: 'fpv',
    model: 'racer',
    scale: 1.1,
    flightMin: 5,
    modeLabels: { C: 'A', N: 'A+', S: 'M' },
    modeNames: { C: 'mode.angle', N: 'mode.fastAngle', S: 'mode.manualAcro' },
    modes: {
      C: { h: 15, up: 8, down: 8, yaw: 180, tau: 0.25 },
      N: { h: 25, up: 12, down: 12, yaw: 300, tau: 0.18 },
      S: { h: 25, up: 12, down: 12, yaw: 300, tau: 0.18 },
    },
    acro: { rate: 750, yawRate: 450, twr: 6, vmax: 42, uptilt: 30 },
  },
};
// Kart ve hız etiketi için en yüksek hız (m/s)
for (const d of Object.values(DRONES)) d.top = d.acro ? d.acro.vmax : d.modes.S.h;

const BATT_FACTOR = { C: 1.05, N: 1, S: 0.75 };

// Mod değerleri, istenirse hız çarpanıyla. mm: mod başına ayar çarpanları { h, up, yaw } (settings.modeMul[mod]).
export function modeSpec(droneId, mode, mul = 1, mm = null) {
  const d = DRONES[droneId] || DRONES.mini5;
  const m = d.modes[mode];
  const k = (v) => (Number.isFinite(v) ? v : 1);
  return {
    h: m.h * mul * k(mm?.h),
    up: m.up * mul * k(mm?.up),
    down: m.down * mul * k(mm?.up),
    yaw: m.yaw * (1 + (mul - 1) * 0.5) * k(mm?.yaw),
    tau: m.tau,
    batt: d.flightMin * 60 * BATT_FACTOR[mode],
  };
}

// çarpışma türleri (i18n 'crash.<tür>' anahtarları)
export const CRASH_KINDS = ['tree', 'tower', 'building', 'fence', 'hedge'];

export const GROUND = 0.07; // inişteyken gövde merkezinin yerden yüksekliği
const RADIUS_BASE = 0.16;
const RTH_ALT = 30;
const DEG = Math.PI / 180;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export class Drone {
  constructor(world) {
    this.world = world;
    this.mode = 'N';
    this.events = [];
    this.reset();
  }

  reset() {
    this.pos = new THREE.Vector3(0, this.world.groundAt(0, 0, 50) + GROUND, 0);
    this.prevPos = this.pos.clone();
    this.vel = new THREE.Vector3();
    this.home = new THREE.Vector3(0, this.pos.y - GROUND, 0);
    this.yaw = this.world.startYaw || 0;
    this.yawRate = 0;
    this.gimbal = this.world.startGimbal ?? -12;
    this.state = 'off'; // off | ground | flying | landing | rth | crashed
    this.battery = 1;
    this.flightTime = 0;
    this.tiltF = 0;
    this.tiltR = 0;
    this.prop = 0;
    this.cscTimer = 0;
    this.cscLatch = false;
    this.released = false;
    this.downTimer = 0;
    this.idleTimer = 0;
    this.autoStop = false;
    this.autoTakeoff = false;
    this.hold = null;
    this.rth = null;
    this.crash = null;
    this.warned = {};
    this.time = 0;
    // Gerçek dünyada yerden değil havada askıda başla: sokak seviyesinde 3B karolar erimiş görünür,
    // yukarıdan yer ve simge yapı net görünür. Ev noktası yine yerde.
    const alt = this.world.startAlt || 0;
    if (alt > 0) {
      this.pos.y += alt;
      this.state = 'flying';
      this.prop = 1;
      this.released = true;
    }
    this.prevPos = this.pos.clone();
    this.world.resetSweep();
  }

  get motors() {
    return this.state !== 'off' && this.state !== 'crashed';
  }

  get airborne() {
    return this.state === 'flying' || this.state === 'landing' || this.state === 'rth';
  }

  get height() {
    return this.pos.y - GROUND - this.home.y;
  }

  // text: i18n anahtarı (ekranda main.js çevirir), vars: yer tutucular
  emit(kind, text, vars) {
    this.events.push({ kind, text, vars });
  }

  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  right(out = new THREE.Vector3()) {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  // ---- komutlar
  startMotors() {
    if (this.state !== 'off') return;
    this.state = 'ground';
    this.released = false;
    this.idleTimer = 0;
    this.downTimer = 0;
    this.home.set(this.pos.x, this.pos.y - GROUND, this.pos.z);
    this.emit('info', 'ev.motorsOn');
  }

  stopMotors(text = 'ev.motorsOff') {
    if (this.state !== 'ground') return;
    this.state = 'off';
    this.autoStop = false;
    this.emit('info', text);
  }

  takeoff() {
    if (this.state === 'crashed') return;
    if (this.state === 'off') this.startMotors();
    if (this.state === 'ground') {
      this.state = 'flying';
      this.autoTakeoff = true;
      this.hold = null;
      this.emit('info', 'ev.autoTakeoff');
    }
  }

  land() {
    if (this.state === 'flying' || this.state === 'rth') {
      this.state = 'landing';
      this.rth = null;
      this.autoTakeoff = false;
      this.emit('info', 'ev.autoLand');
    }
  }

  toggleRth(reason) {
    if (this.state === 'rth') {
      this.state = 'flying';
      this.rth = null;
      this.hold = null;
      this.emit('info', 'ev.rthCancel');
      return;
    }
    if (this.state !== 'flying' && this.state !== 'landing') return;
    const d = Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z);
    this.rth = {
      phase: d < 20 ? 'descend' : 'climb',
      alt: Math.max(this.pos.y, this.home.y + RTH_ALT),
    };
    this.state = 'rth';
    this.autoTakeoff = false;
    this.emit('info', reason || 'ev.rth');
  }

  _crash(text) {
    this.state = 'crashed';
    this.rth = null;
    this.crash = {
      text,
      spin: new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 9),
      rot: new THREE.Euler(),
    };
    this.vel.multiplyScalar(0.35);
    this.emit('crash', text);
  }

  // ---- fizik adımı
  step(inp, dt, opt) {
    this.time += dt;
    this.prevPos.copy(this.pos);
    const m = modeSpec(opt.drone, this.mode, opt.speedMul, opt.modeMul?.[this.mode]);
    const RADIUS = RADIUS_BASE * (DRONES[opt.drone]?.scale || 1);
    this.gimbal = clamp(this.gimbal + inp.gimbal * 60 * dt, -90, 20);

    if (this.state === 'crashed') {
      this.vel.y -= 9.81 * dt;
      this.vel.multiplyScalar(1 - 0.4 * dt);
      this.pos.addScaledVector(this.vel, dt);
      this.world.resolve(this.pos, this.vel, RADIUS);
      const c = this.crash;
      const floor = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y) + GROUND;
      if (this.pos.y <= floor) {
        this.pos.y = floor;
        this.vel.set(0, 0, 0);
        c.spin.multiplyScalar(1 - 6 * dt);
      }
      c.rot.x += c.spin.x * dt;
      c.rot.y += c.spin.y * dt;
      c.rot.z += c.spin.z * dt;
      this.prop *= 1 - 3 * dt;
      return;
    }

    // CSC: iki çubuk aşağı ve içe (ya da dışa) → motor çalıştır / durdur
    const csc =
      inp.thr < -0.8 && inp.pitch < -0.8 &&
      Math.abs(inp.yaw) > 0.8 && Math.abs(inp.roll) > 0.8 &&
      Math.sign(inp.yaw) === -Math.sign(inp.roll);
    if (!csc) this.cscLatch = false;
    this.cscTimer = csc && !this.cscLatch ? this.cscTimer + dt : 0;
    const cscFired = this.cscTimer > 0.4;
    if (cscFired) {
      this.cscLatch = true;
      this.cscTimer = 0;
    }

    if (this.state === 'off') {
      this.vel.set(0, 0, 0);
      this.prop *= 1 - 3 * dt;
      this._tilt(dt, 0, 0);
      if (cscFired) this.startMotors();
      return;
    }

    this.prop = Math.min(1, this.prop + dt * 2);

    // batarya
    if (opt.battery) {
      const load = this.state === 'ground' ? 0.25 : 1 + 0.25 * (this.vel.length() / m.h);
      this.battery = Math.max(0, this.battery - (dt / m.batt) * load);
      if (this.airborne) {
        if (this.battery < 0.25 && !this.warned.b25) {
          this.warned.b25 = true;
          this.emit('warn', 'ev.batt25');
        }
        if (this.battery < 0.15 && !this.warned.b15 && this.state !== 'rth' && this.state !== 'landing') {
          this.warned.b15 = true;
          this.toggleRth('ev.battCritRth');
        }
        if (this.battery < 0.05 && !this.warned.b05) {
          this.warned.b05 = true;
          this.state = 'landing';
          this.rth = null;
          this.emit('warn', 'ev.battLand');
        }
      }
    }
    if (this.airborne) this.flightTime += dt;

    if (this.state === 'ground') {
      this.vel.set(0, 0, 0);
      this._tilt(dt, 0, 0);
      if (inp.thr > -0.3) this.released = true;
      this.idleTimer += dt;
      if (cscFired) return this.stopMotors();
      if (this.autoStop) {
        this.downTimer += dt;
        if (this.downTimer > 1.2) this.stopMotors('ev.landed');
        return;
      }
      if (inp.thr > 0.25) {
        this.state = 'flying';
        this.hold = null;
        this.idleTimer = 0;
      } else if (this.released && inp.thr < -0.6) {
        this.downTimer += dt;
        if (this.downTimer > 1.0) this.stopMotors();
      } else {
        this.downTimer = 0;
        if (this.idleTimer > 15) this.stopMotors('ev.noTakeoff');
      }
      return;
    }

    // ---- hedef hız
    const f = this.forward(_f);
    const r = this.right(_r);
    const tv = _tv.set(0, 0, 0);
    let vy = 0;
    let yawTarget = 0;
    const floor = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y) + GROUND;
    const agl = this.pos.y - floor;
    const toHome = _h.set(this.home.x - this.pos.x, 0, this.home.z - this.pos.z);
    const homeDist = toHome.length();

    if (this.state === 'rth') {
      const rt = this.rth;
      const altHold = clamp((rt.alt - this.pos.y) * 1.2, -3, 5);
      if (rt.phase === 'climb') {
        vy = altHold;
        if (Math.abs(rt.alt - this.pos.y) < 0.5) rt.phase = 'turn';
      } else if (rt.phase === 'turn' || rt.phase === 'cruise') {
        vy = altHold;
        const want = Math.atan2(-toHome.x, -toHome.z);
        const diff = angDiff(want, this.yaw);
        yawTarget = clamp(diff * 2.5, -90 * DEG, 90 * DEG);
        if (rt.phase === 'turn' && Math.abs(diff) < 0.06) rt.phase = 'cruise';
        if (rt.phase === 'cruise') {
          tv.copy(toHome).normalize().multiplyScalar(Math.min(10, homeDist * 0.6));
          if (homeDist < 0.6) rt.phase = 'descend';
        }
      } else {
        tv.copy(toHome).multiplyScalar(1.0);
        vy = agl > 10 ? -3 : agl > 1.5 ? -1.2 : -0.5;
      }
    } else {
      tv.addScaledVector(f, inp.pitch * m.h).addScaledVector(r, inp.roll * m.h);
      yawTarget = -inp.yaw * m.yaw * DEG;
      vy = inp.thr >= 0 ? inp.thr * m.up : inp.thr * m.down;

      const active = Math.abs(inp.pitch) > 0.03 || Math.abs(inp.roll) > 0.03;
      if (active) {
        this.hold = null;
      } else {
        if (!this.hold && Math.hypot(this.vel.x, this.vel.z) < 0.4) this.hold = this.pos.clone();
        if (this.hold) {
          tv.x += clamp((this.hold.x - this.pos.x) * 0.8, -2, 2);
          tv.z += clamp((this.hold.z - this.pos.z) * 0.8, -2, 2);
        }
      }

      if (this.state === 'landing') {
        vy = agl > 5 ? -2.5 : agl > 1 ? -1.0 : -0.5;
      } else if (this.autoTakeoff) {
        vy = 1.2;
        if (agl >= 1.2 || Math.abs(inp.thr) > 0.3) this.autoTakeoff = false;
      }
      // iniş koruması: yere yakın yavaşla
      if (agl < 0.6 && vy < -0.6) vy = -0.6;
    }

    // rüzgâr: GPS büyük kısmını telafi eder, sağanakta hafif sürüklenir
    const ws = [0, 3, 7, 11][opt.wind] || 0;
    if (ws) {
      const dir = 0.8 + Math.sin(this.time * 0.05) * 0.4;
      const gust = 0.55 + 0.45 * Math.sin(this.time * 0.7) * Math.sin(this.time * 1.3 + 1);
      const wx = Math.cos(dir) * ws * gust;
      const wz = Math.sin(dir) * ws * gust;
      this.vel.x += wx * 0.35 * dt;
      this.vel.z += wz * 0.35 * dt;
      if (this.hold === null) {
        tv.x += wx * 0.12;
        tv.z += wz * 0.12;
      }
    }

    // ---- dinamik
    const prevVel = _pv.copy(this.vel);
    const kh = 1 - Math.exp(-dt / m.tau);
    const kv = 1 - Math.exp(-dt / 0.35);
    this.vel.x += (tv.x - this.vel.x) * kh;
    this.vel.z += (tv.z - this.vel.z) * kh;
    this.vel.y += (vy - this.vel.y) * kv;
    this.yawRate += (yawTarget - this.yawRate) * (1 - Math.exp(-dt / 0.15));
    this.yaw += this.yawRate * dt;
    this.pos.addScaledVector(this.vel, dt);

    // irtifa sınırı (0 = sınırsız)
    const maxAlt = opt.maxAlt || Infinity;
    if (this.pos.y - this.home.y > maxAlt) {
      this.pos.y = this.home.y + maxAlt;
      this.vel.y = Math.min(0, this.vel.y);
      if (!this.warned.alt) {
        this.warned.alt = true;
        this.emit('warn', 'ev.maxAlt', { m: maxAlt });
      }
    } else if (this.pos.y - this.home.y < maxAlt - 5) {
      this.warned.alt = false;
    }

    // engeller
    const hit = this.world.resolve(this.pos, this.vel, RADIUS);
    if (hit) {
      const limit = hit.kind === 'tree' || hit.kind === 'hedge' ? 1.5 : 3;
      if (hit.speed > limit) {
        return this._crash('crash.' + (CRASH_KINDS.includes(hit.kind) ? hit.kind : 'building'));
      }
      if (hit.top && vy <= 0 && this.vel.length() < 0.6) return this._touchdown();
    }

    // zemin ve su
    if (this.world.isWater(this.pos.x, this.pos.z) && this.pos.y - this.world.groundAt(this.pos.x, this.pos.z, this.pos.y) < 0.4) return this._crash('crash.water');
    const floorNow = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y) + GROUND;
    if (this.pos.y < floorNow) {
      if (this.vel.y < -3.5) {
        this.pos.y = floorNow;
        return this._crash('crash.hard');
      }
      this.pos.y = floorNow;
      this.vel.y = Math.max(0, this.vel.y);
      if (vy <= 0) return this._touchdown();
    }

    // görsel eğim: ileri giderken burun aşağı
    const ax = (this.vel.x - prevVel.x) / dt;
    const az = (this.vel.z - prevVel.z) / dt;
    const vf = this.vel.x * f.x + this.vel.z * f.z;
    const vr = this.vel.x * r.x + this.vel.z * r.z;
    const af = ax * f.x + az * f.z;
    const ar = ax * r.x + az * r.z;
    this._tilt(dt, clamp(vf * 1.4 + af * 2.2, -28, 28), clamp(vr * 1.4 + ar * 2.2, -28, 28));
  }

  _touchdown() {
    const auto = this.state === 'rth' || this.state === 'landing';
    this.state = 'ground';
    this.vel.set(0, 0, 0);
    this.rth = null;
    this.hold = null;
    this.autoTakeoff = false;
    this.downTimer = 0;
    this.idleTimer = 0;
    this.released = true;
    this.autoStop = auto;
  }

  _tilt(dt, f, r) {
    const k = 1 - Math.exp(-dt / 0.12);
    this.tiltF += (f - this.tiltF) * k;
    this.tiltR += (r - this.tiltR) * k;
  }
}

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _tv = new THREE.Vector3();
const _h = new THREE.Vector3();
const _pv = new THREE.Vector3();
