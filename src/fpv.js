import * as THREE from 'three';
import { Drone, DRONES, GROUND, CRASH_KINDS } from './flight.js';
import { t } from './i18n.js';

// FPV drone. Anahtar C/N: açı modu (DJI Drone fiziği, kendini düzeltir).
// Anahtar S: Manuel/akro. Çubuklar dönüş hızı verir, drone kendini düzeltmez, takla atar.
const DEG = Math.PI / 180;
const G = 9.81;

export class FpvDrone extends Drone {
  constructor(world, id) {
    super(world);
    this.id = id;
    this.kind = 'fpv';
    this.quat = new THREE.Quaternion();
    this.rates = new THREE.Vector3();
    this.acro = false;
  }

  get spec() {
    return DRONES[this.id];
  }

  modeLabel(m = this.mode) {
    return this.spec.modeLabels[m];
  }

  modeName(m = this.mode) {
    return t(this.spec.modeNames[m]);
  }

  // Akroda kamera gövdeye sabit ve yukarı eğik; açı modunda gimbal teker ile eğilir.
  get camPitch() {
    return this.acro && this.airborne ? this.spec.acro.uptilt : this.gimbal;
  }

  reset() {
    super.reset();
    if (this.quat) {
      this.quat.identity();
      this.rates.set(0, 0, 0);
      this.acro = false;
    }
  }

  step(inp, dt, opt) {
    const wantAcro = this.mode === 'S';
    if (wantAcro !== this.acro) {
      this.acro = wantAcro;
      if (wantAcro) this.rates.set(0, 0, 0);
      else this.hold = null; // açı moduna dönünce Drone fiziği toparlar
      this.emit('info', 'toast.mode', { name: this.modeName() });
    }
    const acroFlight = this.acro && (this.state === 'flying' || this.state === 'landing');
    if (!acroFlight) {
      super.step(inp, dt, opt);
      this._quatFromTilt();
      return;
    }
    this._acroStep(inp, dt, opt);
  }

  _quatFromTilt() {
    _e.set(-this.tiltF * DEG, this.yaw, -this.tiltR * DEG, 'YXZ');
    this.quat.setFromEuler(_e);
  }

  _acroStep(inp, dt, opt) {
    const sp = this.spec.acro;
    this.time += dt;
    this.flightTime += dt;
    this.prevPos.copy(this.pos);
    this.prop = Math.min(1, this.prop + dt * 2);

    // gövde dönüş hızları: x burun yukarı +, y sola +, z sola yatış +
    const r = sp.rate * DEG;
    _t.set(-inp.pitch * r, -inp.yaw * sp.yawRate * DEG, -inp.roll * r);
    this.rates.lerp(_t, 1 - Math.exp(-dt / 0.04));
    const ang = this.rates.length() * dt;
    if (ang > 1e-7) {
      _dq.setFromAxisAngle(_axis.copy(this.rates).normalize(), ang);
      this.quat.multiply(_dq).normalize();
    }

    // itki: yaylı gaz çubuğu ortada = askıda kalma itkisi, yukarıda TWR katı, aşağıda sıfır
    const thrust = inp.thr >= 0 ? 1 + inp.thr * (sp.twr - 1) : 1 + inp.thr;
    const up = _u.set(0, 1, 0).applyQuaternion(this.quat);
    const vmax = sp.vmax * opt.speedMul;
    const k2 = (Math.sqrt(sp.twr * sp.twr - 1) * G) / (vmax * vmax);
    const v = this.vel.length();
    this.vel.addScaledVector(up, thrust * G * dt);
    this.vel.y -= G * dt;
    this.vel.multiplyScalar(Math.max(0, 1 - (k2 * v + 0.06) * dt));
    this.pos.addScaledVector(this.vel, dt);

    // harita oku ve diğer ekranlar için yön
    const f = _f.set(0, 0, -1).applyQuaternion(this.quat);
    if (Math.hypot(f.x, f.z) > 0.05) this.yaw = Math.atan2(-f.x, -f.z);

    if (opt.battery) {
      this.battery = Math.max(0, this.battery - (dt / (this.spec.flightMin * 60)) * (0.6 + 0.6 * Math.max(0, thrust - 1)));
      if (this.battery < 0.15 && !this.warned.b15) {
        this.warned.b15 = true;
        this.emit('warn', 'ev.battCritLand');
      }
      if (this.battery <= 0) return this._crash('crash.battery');
    }

    const hit = this.world.resolve(this.pos, this.vel, 0.14 * (this.spec.scale || 1));
    if (hit && hit.speed > 4) return this._crash('crash.' + (CRASH_KINDS.includes(hit.kind) ? hit.kind : 'building'));

    const floor = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y) + GROUND;
    if (this.pos.y < floor) {
      const upright = up.y > 0.7;
      if (this.vel.y < -4 || !upright) {
        this.pos.y = floor;
        return this._crash(upright ? 'crash.hard' : 'crash.flipped');
      }
      this.pos.y = floor;
      this.vel.set(0, 0, 0);
      this.rates.set(0, 0, 0);
      _e.set(0, this.yaw, 0, 'YXZ');
      this.quat.setFromEuler(_e);
      this.tiltF = this.tiltR = 0;
      this._touchdown();
    }
  }
}

const _e = new THREE.Euler();
const _t = new THREE.Vector3();
const _u = new THREE.Vector3();
const _f = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _dq = new THREE.Quaternion();
