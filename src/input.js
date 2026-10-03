// Kumanda + klavye → tek komut seti (Mode 2). Değerler -1..1.
export const AXIS_KEYS = {
  KeyW: 'thrUp', KeyS: 'thrDown', KeyA: 'yawL', KeyD: 'yawR',
  ArrowUp: 'fwd', ArrowDown: 'back', ArrowLeft: 'left', ArrowRight: 'right',
  KeyR: 'gUp', KeyF: 'gDown',
};

// Eksenler ve Mode 2'de bağlı oldukları çubuk
export const AXES = ['thr', 'yaw', 'pitch', 'roll', 'gimbal'];
export const STICK_OF = { thr: 'lv', yaw: 'lh', pitch: 'rv', roll: 'rh', gimbal: 'wheel' };

const clamp1 = (v) => (v > 1 ? 1 : v < -1 ? -1 : v);
const num = (v, d) => (Number.isFinite(v) ? v : d);

// Kalibrasyon: merkez kaydırılır, iki yön ayrı ölçeklenir (min → -1, max → 1). cal: { c, min, max }
export function calibrate(v, cal) {
  if (!cal) return v;
  const c = num(cal.c, 0);
  const d = v - c;
  const span = d >= 0 ? num(cal.max, 1) - c : c - num(cal.min, -1);
  return clamp1(span > 0.05 ? d / span : d);
}

// Eksen ayarı: settings.axes[ad], eksikler varsayılandan; expo null ise genel settings.expo.
export function axisConf(settings, axis) {
  const a = settings.axes?.[axis] || {};
  return {
    deadzone: Math.min(0.5, Math.max(0, num(a.deadzone, 0.04))),
    expo: num(a.expo, num(settings.expo, 0.25)),
    rate: num(a.rate, 1),
  };
}

// Ölü bölge (dışı yeniden ölçeklenir) + expo + hassasiyet; sonuç -1..1.
export function shape(v, conf) {
  const a = Math.abs(v);
  const dz = conf.deadzone;
  if (a < dz || !a) return 0;
  const x = Math.min(1, (a - dz) / (1 - dz));
  const e = conf.expo;
  return clamp1(Math.sign(v) * ((1 - e) * x + e * x * x * x) * conf.rate);
}

// Kumanda çubukları → eksenler: önce kaynağın kalibrasyonu, sonra ters çevirme.
export function rcAxes(sticks, settings, source) {
  const cal = settings.rcCal?.[source];
  const inv = settings.invert || {};
  const out = {};
  for (const ax of AXES) {
    const k = STICK_OF[ax];
    out[ax] = calibrate(sticks[k] || 0, cal?.[k]) * (inv[k] ? -1 : 1);
  }
  return out;
}

const pick = (a, b) => (Math.abs(a) > Math.abs(b) ? a : b);

// Kumanda + klavye eksenleri → uçuş komutu (eksen başına şekillendirilmiş).
export function shapeAll(rc, kb, settings) {
  const out = {};
  for (const ax of AXES) out[ax] = shape(pick(rc[ax], kb[ax]), axisConf(settings, ax));
  return out;
}

export class Input {
  constructor(rc, settings) {
    this.rc = rc;
    this.settings = settings;
    this.down = new Set();
    this.kb = { thr: 0, yaw: 0, pitch: 0, roll: 0 };
    this.onAction = null; // (code) => void

    addEventListener('keydown', (e) => {
      if (e.target.closest?.('input, select, textarea')) return;
      const a = AXIS_KEYS[e.code];
      if (a) {
        this.down.add(a);
        e.preventDefault();
      } else if (!e.repeat) {
        this.onAction?.(e.code, e);
      }
    });
    addEventListener('keyup', (e) => {
      const a = AXIS_KEYS[e.code];
      if (a) this.down.delete(a);
    });
    addEventListener('blur', () => this.down.clear());
  }

  read(dt) {
    const d = this.down;
    const k = Math.min(1, dt * 5);
    const t = (a, b) => (d.has(a) ? 1 : 0) - (d.has(b) ? 1 : 0);
    const kb = this.kb;
    kb.thr += (t('thrUp', 'thrDown') - kb.thr) * k;
    kb.yaw += (t('yawR', 'yawL') - kb.yaw) * k;
    kb.pitch += (t('fwd', 'back') - kb.pitch) * k;
    kb.roll += (t('right', 'left') - kb.roll) * k;
    const kbGimbal = t('gUp', 'gDown');

    const st = this.settings;
    const rc = this.rc.live
      ? rcAxes(this.rc.sticks, st, this.rc.source)
      : { thr: 0, yaw: 0, pitch: 0, roll: 0, gimbal: 0 };
    const o = shapeAll(rc, { thr: kb.thr, yaw: kb.yaw, pitch: kb.pitch, roll: kb.roll, gimbal: kbGimbal }, st);
    return { thr: o.thr, yaw: o.yaw, pitch: o.pitch, roll: o.roll, gimbal: o.gimbal, rc };
  }
}
