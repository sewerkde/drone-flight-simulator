// Gamepad API kaynağı: standart oyun kolu (Xbox/PlayStation) ve USB joystick modundaki
// RC vericileri (EdgeTX/OpenTX: RadioMaster, Jumper…). serve.py gerekmez.
// Eşleme saf fonksiyonlardadır; tarayıcısız test edilir (tools/controllers.test.mjs).

// Çıkış Mode 2: lh = yaw, lv = gaz, rh = roll, rv = pitch; sağ/yukarı/ileri = +1.
// Eksen tanımı: [indeks, işaret]. Gamepad API'de çubuk aşağı = +1, bu yüzden standart kolda dikeyler ters.
export const PRESETS = {
  standard: {
    label: 'Gamepad',
    axes: { lh: [0, 1], lv: [1, -1], rh: [2, 1], rv: [3, -1] },
    radial: true, // çubuk başına dairesel ölü bölge (kolların merkezi oynak)
    deadzone: 0.12,
    wheel: { up: 7, down: 6 }, // RT gimbal yukarı, LT aşağı (analog tetikler)
    buttons: { 0: 'takeoff', 1: 'land', 2: 'rth', 3: 'view', 4: 'modeDown', 5: 'modeUp' },
  },
  // RC vericileri: kanal sırası = eksen sırası. Gaz yaylı değil; tüm aralık -1..1 olduğu gibi aktarılır.
  aetr: {
    label: 'RC · AETR',
    axes: { rh: [0, 1], rv: [1, 1], lv: [2, 1], lh: [3, 1] },
    radial: false,
    deadzone: 0.02,
    wheel: null,
    buttons: {},
  },
  taer: {
    label: 'RC · TAER',
    axes: { lv: [0, 1], rh: [1, 1], rv: [2, 1], lh: [3, 1] },
    radial: false,
    deadzone: 0.02,
    wheel: null,
    buttons: {},
  },
};

// EdgeTX/OpenTX joystick kimlikleri. 1209:4f54 = pid.codes OpenTX/EdgeTX USB joystick.
// Chrome: "EdgeTX RadioMaster TX16S Joystick (Vendor: 1209 Product: 4f54)", Firefox: "1209-4f54-…".
const RC_ID = /edgetx|opentx|radiomaster|jumper|frsky|taranis|horus|betafpv|literadio|flysky|expresslrs|\belrs\b|1209\W{1,12}(?:product:\s*)?4f54/i;

export const clamp1 = (v) => (v > 1 ? 1 : v < -1 ? -1 : v);

// Eksen başına ölü bölge; dışı yeniden ölçeklenir (dz → 0, 1 → 1).
export function deadzone(v, dz) {
  v = Number.isFinite(v) ? v : 0;
  const a = Math.abs(v);
  if (a <= dz) return 0;
  return clamp1((Math.sign(v) * (a - dz)) / (1 - dz));
}

// Çubuk başına dairesel ölü bölge: yön korunur, büyüklük yeniden ölçeklenir.
export function radialDeadzone(x, y, dz) {
  x = Number.isFinite(x) ? x : 0;
  y = Number.isFinite(y) ? y : 0;
  const m = Math.hypot(x, y);
  if (m <= dz) return [0, 0];
  const k = (m - dz) / (1 - dz) / m;
  return [clamp1(x * k), clamp1(y * k)];
}

const btnValue = (b) => (typeof b === 'number' ? b : b ? (b.value ?? (b.pressed ? 1 : 0)) : 0);
const btnPressed = (b) => (typeof b === 'number' ? b > 0.5 : !!b && (b.pressed || b.value > 0.5));

// Hazır ayar seçimi: geçerli bir ad verilmişse o; yoksa kimlikten tahmin.
export function pickPreset(pad, override = 'auto') {
  if (override && override !== 'auto' && PRESETS[override]) return override;
  if (RC_ID.test(pad?.id || '')) return 'aetr'; // EdgeTX varsayılan kanal sırası
  return 'standard';
}

// Okunur ad: tarayıcının eklediği "(Vendor: … Product: …)" ve Firefox ön ekleri atılır.
export function padName(id = '') {
  const s = id
    .replace(/\((?:STANDARD GAMEPAD\s*)?Vendor:[^)]*\)/gi, ' ')
    .replace(/^[0-9a-f]{1,4}-[0-9a-f]{1,4}-/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s || 'Gamepad';
}

// Bağlı kollardan birini seçer: indeks verildiyse o, yoksa ≥4 eksenli ilk kol, yoksa ilk kol.
export function choosePad(pads, index = null) {
  const list = Array.from(pads || []).filter((p) => p && p.connected !== false);
  if (index != null) return list.find((p) => p.index === index) || null;
  return list.find((p) => (p.axes?.length || 0) >= 4) || list[0] || null;
}

// Tek kol okuması → { sticks, buttons }. pad: { axes: number[], buttons: (GamepadButton | number)[] }.
// opts.deadzone ve opts.buttons ({ indeks: ad }) hazır ayarı ezer.
export function mapGamepad(pad, preset, opts = {}) {
  const p = typeof preset === 'string' ? PRESETS[preset] : preset;
  const ax = pad?.axes || [];
  const bt = pad?.buttons || [];
  const dz = opts.deadzone ?? p.deadzone;
  const raw = (k) => {
    const [i, sign] = p.axes[k];
    const v = ax[i];
    return Number.isFinite(v) ? v * sign || 0 : 0; // -0 olmasın
  };
  const sticks = { lh: 0, lv: 0, rh: 0, rv: 0, wheel: 0 };
  if (p.radial) {
    [sticks.lh, sticks.lv] = radialDeadzone(raw('lh'), raw('lv'), dz);
    [sticks.rh, sticks.rv] = radialDeadzone(raw('rh'), raw('rv'), dz);
  } else {
    for (const k of ['lh', 'lv', 'rh', 'rv']) sticks[k] = deadzone(raw(k), dz);
  }
  if (p.wheel) sticks.wheel = deadzone(btnValue(bt[p.wheel.up]) - btnValue(bt[p.wheel.down]), 0.05);

  const map = opts.buttons || p.buttons;
  const buttons = {};
  for (const [i, name] of Object.entries(map)) buttons[name] = buttons[name] || btnPressed(bt[i]);
  return { sticks, buttons };
}

// Basıldığı an (false → true) olan tuş adları.
export function buttonEdges(prev, now) {
  const out = [];
  for (const k of Object.keys(now || {})) if (now[k] && !prev?.[k]) out.push(k);
  return out;
}

export class GamepadSource {
  // opts: { preset: 'auto'|'standard'|'aetr'|'taer', deadzone, buttons: { indeks: ad }, index }
  constructor(opts = {}) {
    this.opts = opts;
    this.preset = opts.preset || 'auto';
    this.activePreset = null; // o an kullanılan hazır ayar
    this.sticks = { lh: 0, lv: 0, rh: 0, rv: 0, wheel: 0 };
    this.buttons = {};
    this.rawButtons = null;
    this.pad = null; // { index, id, mapping }
    this.onButton = null; // (ad) => void, basıldığı an bir kez
    this.status = 'oyun kolu yok';
  }

  get supported() {
    return typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';
  }

  get connected() {
    return !!this.pad;
  }

  // Kol takılıysa canlı: yaylı çubuklarda 0 da geçerli bir değer.
  get live() {
    return !!this.pad;
  }

  get name() {
    if (!this.pad) return '';
    const n = padName(this.pad.id);
    return this.activePreset === 'standard' ? n : `${n} · ${PRESETS[this.activePreset].label}`;
  }

  setPreset(name) {
    this.preset = name || 'auto';
  }

  // Her karede çağrılır (Gamepad API olay değil, yoklama ister).
  poll() {
    if (!this.supported) return;
    let pads = [];
    try {
      pads = navigator.getGamepads();
    } catch {} // izin politikası engelleyebilir
    const gp = choosePad(pads, this.opts.index ?? null);
    if (!gp) {
      if (this.pad) this._reset();
      return;
    }
    const fresh = !this.pad || this.pad.index !== gp.index || this.pad.id !== gp.id;
    const preset = pickPreset(gp, this.preset);
    const r = mapGamepad(gp, preset, this.opts);
    Object.assign(this.sticks, r.sticks);
    // Yeni takılan kolda ilk okuma kenar sayılmaz (Chrome kolu ancak bir tuşa basılınca gösterir).
    if (!fresh && preset === this.activePreset) {
      for (const n of buttonEdges(this.buttons, r.buttons)) this.onButton?.(n);
    }
    this.buttons = r.buttons;
    this.activePreset = preset;
    this.pad = { index: gp.index, id: gp.id, mapping: gp.mapping };
    this.status = `bağlı: ${padName(gp.id)} (${PRESETS[preset].label})`;
  }

  _reset() {
    this.pad = null;
    this.activePreset = null;
    Object.assign(this.sticks, { lh: 0, lv: 0, rh: 0, rv: 0, wheel: 0 });
    this.buttons = {};
    this.status = 'oyun kolu yok';
  }
}
