// Birleşik kumanda: BridgeRc (rc-bridge.js) ile aynı arayüz, birden çok kaynaktan okur.
// Öncelik: serve.py köprüsü (canlı veri varsa) > Web Serial ile DJI RC > oyun kolu / RC verici > dokunmatik.
// Kullanım (main.js): `const rc = createControllers();` — `new BridgeRc()` yerine.
//
// Arayüz: sticks {lh, lv, rh, rv, wheel} (-1..1), buttons, rawButtons, live, connected, status, supported,
// onButton(ad), onChange(live), onMode('C'|'N'|'S'); ek olarak source, sourceName, onSource, connectSerial().

import { BridgeRc } from './rc-bridge.js';
import { DjiRc } from './rc.js';
import { GamepadSource, buttonEdges } from './gamepad.js';
import { TouchSource } from './touch.js';

export const SOURCES = ['bridge', 'serial', 'gamepad', 'touch'];
// Bugünkü DJI adları + yeni kaynakların adları
export const BUTTON_NAMES = ['photo', 'rth', 'camera', 'fn', 'takeoff', 'land', 'view', 'modeUp', 'modeDown'];
const SOURCE_NAMES = { bridge: 'DJI RC (serve.py)', serial: 'DJI RC (USB)', touch: 'Touch', none: '' };

const blankButtons = () => Object.fromEntries(BUTTON_NAMES.map((n) => [n, false]));

// DJI 0x27 yanıtı, bayt 28-29 → v = (hi << 8) | lo. rc-bridge.js ile aynı çözüm (03.10 ölçümü):
// üst bayt 0x30 bitleri = C/N/S anahtarı (00 S, 10 N, 20 C), alt bayt = tuşlar (mod bitinden bağımsız).
export function decodeDjiButtons(v) {
  const mode = { 0x00: 'S', 0x10: 'N', 0x20: 'C' }[(v >> 8) & 0x30] || null;
  const lo = v & 0xff;
  return {
    mode,
    buttons: {
      photo: (lo & 0x60) === 0x60,
      rth: (lo & 0x80) !== 0,
      camera: (lo & 0x04) !== 0,
      fn: (lo & 0x02) !== 0,
    },
  };
}

// Öncelik sırasına göre canlı ilk kaynak; yoksa 'none'.
export function pickSource(live, disabled = []) {
  for (const s of SOURCES) if (live[s] && !disabled.includes(s)) return s;
  return 'none';
}

export class Controllers {
  // opts: { bridge: true | false | '/rc' (SSE adresi), serialAuto: true (izinli DJI portuna sormadan bağlan,
  //         yalnız serve.py yoksa), gamepad: false | { preset, deadzone, buttons, index },
  //         touch: false | { force, labels, before, parent }, disable: ['bridge', …], loop: true }
  constructor(opts = {}) {
    this.sticks = { lh: 0, lv: 0, rh: 0, rv: 0, wheel: 0 };
    this.buttons = blankButtons();
    this.rawButtons = null;
    this.onButton = null; // (ad) => void, basıldığı an bir kez
    this.onChange = null; // (live) => void
    this.onMode = null; // ('C' | 'N' | 'S') => void, mod anahtarı değişince
    this.onSource = null; // (source, sourceName) => void, etkin kaynak değişince
    this.switchMode = null;
    this.disabled = new Set(opts.disable || []);
    this._source = 'none';
    this._live = false;
    this._serialRaw = null;
    this._serialBtn = null;
    this._serialMode = null;
    this._dead = false;

    this.bridge = opts.bridge === false ? null : new BridgeRc(typeof opts.bridge === 'string' ? opts.bridge : '/rc');
    this.serial = null; // DjiRc: connectSerial() ya da otomatik bağlantı ile
    this.gamepad = opts.gamepad === false ? null : new GamepadSource(opts.gamepad || {});
    this.touch = opts.touch === false ? null : new TouchSource(opts.touch || {});

    if (this.bridge) {
      this.bridge.onButton = (n) => {
        if (!this.disabled.has('bridge')) this._emit(n);
      };
      this.bridge.onMode = (m) => {
        if (this.disabled.has('bridge')) return;
        this.switchMode = m;
        this.onMode?.(m);
      };
      this.bridge.onChange = () => this.update();
    }
    // Oyun kolu ayrı bir cihaz: tuşları etkin kaynak başkası olsa da iletilir (sticks yalnız etkin kaynaktan).
    if (this.gamepad) this.gamepad.onButton = (n) => !this.disabled.has('gamepad') && this._emit(n);
    if (this.touch) this.touch.onButton = (n) => !this.disabled.has('touch') && this._emit(n);

    if (opts.loop !== false) {
      if (typeof requestAnimationFrame === 'function') {
        const f = () => {
          if (this._dead) return;
          this.update();
          requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      }
      // rAF arka planda durur; durum geçişleri (onChange) için seyrek yedek
      this._timer = setInterval(() => this.update(), 250);
    }

    // serve.py çalışıyorsa portu o tutar; ikinci okuyucu açılmaz. Yoksa daha önce izin verilmiş portu dene.
    if (opts.serialAuto !== false && typeof navigator !== 'undefined' && 'serial' in navigator) {
      this._autoTimer = setTimeout(() => {
        if (!this.bridge?.connected && !this.serial) this._autoSerial();
      }, 2500);
    }
  }

  get supported() {
    return true;
  }

  get serialSupported() {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  // O anki etkin kaynak (öncelik sırasıyla ilk canlı olan).
  get source() {
    return pickSource(
      {
        bridge: !!this.bridge?.live,
        serial: !!this.serial?.live,
        gamepad: !!this.gamepad?.live,
        touch: !!this.touch?.live,
      },
      [...this.disabled],
    );
  }

  get sourceName() {
    const s = this.source;
    return s === 'gamepad' ? this.gamepad.name : SOURCE_NAMES[s];
  }

  get live() {
    return this.source !== 'none';
  }

  // Herhangi bir kanal açık mı (sunucu, seri port, takılı kol ya da dokunmatik ekran).
  get connected() {
    const on = (k, o) => !!o?.connected && !this.disabled.has(k);
    return on('bridge', this.bridge) || on('serial', this.serial) || on('gamepad', this.gamepad) || on('touch', this.touch);
  }

  get status() {
    switch (this.source) {
      case 'bridge':
        return this.bridge.status;
      case 'serial':
        return `USB: ${this.serial.status}`;
      case 'gamepad':
        return this.gamepad.status;
      case 'touch':
        return this.touch.status;
    }
    if (this.bridge?.connected) return this.bridge.status; // sunucu var, kumanda yok
    if (this.serial) return `USB: ${this.serial.status}`;
    return this.bridge ? this.bridge.status : 'kumanda yok';
  }

  // DJI RC'ye Web Serial ile bağlan (Chrome/Edge masaüstü). Kullanıcı hareketi (tıklama) içinden çağrılmalı.
  async connectSerial() {
    if (this.serial?.connected) return true;
    const r = this.serial || new DjiRc();
    await r.connect(); // ilk await requestPort: tıklama izni korunur; hata mesajı yukarı iletilir
    this.serial = r;
    this.update();
    return true;
  }

  async disconnectSerial() {
    await this.serial?.disconnect();
    this.serial = null;
    this._serialRaw = this._serialBtn = this._serialMode = null;
    this.update();
  }

  setGamepadPreset(name) {
    this.gamepad?.setPreset(name);
  }

  // Bir kaynağı aç/kapat (testlerde gerçek kumandayı susturmak için de).
  setEnabled(source, on) {
    if (on) this.disabled.delete(source);
    else this.disabled.add(source);
    this.update();
  }

  // Kaynakları yoklar, etkin kaynağın değerlerini kopyalar. Döngü kendiliğinden çağırır.
  update() {
    if (this.gamepad && !this.disabled.has('gamepad')) this.gamepad.poll();
    const src = this.source;
    this._pollSerial(src);

    const o = this._view(src);
    const s = this.sticks;
    s.lh = o?.sticks.lh || 0;
    s.lv = o?.sticks.lv || 0;
    s.rh = o?.sticks.rh || 0;
    s.rv = o?.sticks.rv || 0;
    s.wheel = o?.sticks.wheel || 0;
    const b = this.buttons;
    for (const n of BUTTON_NAMES) b[n] = !!o?.buttons?.[n];
    this.rawButtons = o?.rawButtons || null;

    if (src !== this._source) {
      this._source = src;
      this.touch?.setVisible(src === 'touch');
      this.onSource?.(src, this.sourceName);
    }
    const live = src !== 'none';
    if (live !== this._live) {
      this._live = live;
      this.onChange?.(live);
    }
  }

  destroy() {
    this._dead = true;
    clearInterval(this._timer);
    clearTimeout(this._autoTimer);
    this.touch?.destroy();
    this.serial?.disconnect();
  }

  _view(src) {
    if (src === 'bridge') return this.bridge;
    if (src === 'serial') return { sticks: this.serial.sticks, buttons: this._serialBtn, rawButtons: this.serial.rawButtons };
    if (src === 'gamepad') return this.gamepad;
    if (src === 'touch') return this.touch;
    return null;
  }

  // rc.js'in kendi tuş maskeleri mod bitine bağlı; köprüyle aynı çözüm için ham baytlar burada okunur.
  _pollSerial(src) {
    const r = this.serial;
    if (!r?.live || this.disabled.has('serial')) return;
    const raw = r.rawButtons; // 0x27 çerçevesinin 11..55 baytları → bayt 28-29 = indeks 17-18
    if (!raw || raw === this._serialRaw || raw.length < 19) return;
    this._serialRaw = raw;
    const d = decodeDjiButtons((raw[17] << 8) | raw[18]);
    const prev = this._serialBtn;
    this._serialBtn = d.buttons;
    if (src !== 'serial') return; // köprü aynı kumandayı okuyorsa olaylar iki kez gelmesin
    if (d.mode && d.mode !== this._serialMode) {
      this._serialMode = d.mode;
      this.switchMode = d.mode;
      this.onMode?.(d.mode);
    }
    if (prev) for (const n of buttonEdges(prev, d.buttons)) this._emit(n);
  }

  async _autoSerial() {
    try {
      const r = new DjiRc();
      if (await r.autoConnect()) {
        this.serial = r;
        this.update();
      }
    } catch {}
  }

  _emit(n) {
    this.onButton?.(n);
  }
}

export function createControllers(options = {}) {
  return new Controllers(options);
}
