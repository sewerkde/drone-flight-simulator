// DJI RC-N3 (RC-N1/N2 de) okuyucu: Web Serial + DUML.
// Kumanda alttaki USB-C portundan Mac'e bağlı olmalı.

const DJI_VENDOR = 0x2ca3;

function table(poly) {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ poly : c >>> 1;
    t[i] = c;
  }
  return t;
}
const T8 = table(0x8c);
const T16 = table(0x8408);

function crc8(bytes, n, seed = 0x77) {
  let c = seed;
  for (let i = 0; i < n; i++) c = T8[(bytes[i] ^ c) & 0xff];
  return c;
}

function crc16(bytes, n, seed = 0x3692) {
  let v = seed;
  for (let i = 0; i < n; i++) v = (v >>> 8) ^ T16[(bytes[i] ^ v) & 0xff];
  return v & 0xffff;
}

export function duml(cmdSet, cmdId, payload = []) {
  const len = 13 + payload.length;
  const p = new Uint8Array(len);
  p[0] = 0x55;
  p[1] = len & 0xff;
  p[2] = (len >> 8) | 0x04;
  p[3] = crc8(p, 3);
  p[4] = 0x0a; // gönderen: PC
  p[5] = 0x06; // alıcı: kumanda
  p[6] = 0xeb;
  p[7] = 0x34;
  p[8] = 0x40;
  p[9] = cmdSet;
  p[10] = cmdId;
  p.set(payload, 11);
  const c = crc16(p, len - 2);
  p[len - 2] = c & 0xff;
  p[len - 1] = c >> 8;
  return p;
}

const PKT_SIM_ON = duml(0x06, 0x24, [0x01]);
const PKT_STICKS = duml(0x06, 0x01);
const PKT_BUTTONS = duml(0x06, 0x27);

// 364..1024..1684 -> -1..1
function axis(lo, hi) {
  const v = lo | (hi << 8);
  return Math.max(-1, Math.min(1, (v - 1024) / 660));
}

export class DjiRc {
  constructor() {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.connected = false;
    this.lastFrameAt = 0;
    this.status = 'bağlı değil';
    // Mode 2: sol dikey = gaz, sol yatay = yaw, sağ dikey = ileri/geri, sağ yatay = sağa/sola
    this.sticks = { lh: 0, lv: 0, rh: 0, rv: 0, wheel: 0 };
    this.buttons = { photo: false, rth: false, camera: false, fn: false };
    this.rawButtons = null;
    this.onButton = null; // (ad) => void, basıldığı an bir kez
    this._buf = new Uint8Array(0);
    this._timers = [];
  }

  get supported() {
    return 'serial' in navigator;
  }

  get live() {
    return this.connected && performance.now() - this.lastFrameAt < 500;
  }

  // Daha önce izin verilmiş bir port varsa sormadan bağlan.
  async autoConnect() {
    if (!this.supported) return false;
    const ports = (await navigator.serial.getPorts()).filter(
      (p) => p.getInfo().usbVendorId === DJI_VENDOR,
    );
    for (const p of ports) {
      if (await this._tryPort(p)) return true;
    }
    return false;
  }

  async connect() {
    if (!this.supported) throw new Error('Bu tarayıcı Web Serial desteklemiyor, Chrome kullan.');
    const port = await navigator.serial.requestPort({ filters: [{ usbVendorId: DJI_VENDOR }] });
    if (!(await this._tryPort(port))) {
      throw new Error('Bu port yanıt vermedi. Tekrar bağlan ve listedeki diğer portu seç.');
    }
  }

  async disconnect() {
    this._timers.forEach(clearInterval);
    this._timers = [];
    this.connected = false;
    try { await this.reader?.cancel(); } catch {}
    try { this.reader?.releaseLock(); } catch {}
    try { this.writer?.releaseLock(); } catch {}
    try { await this.port?.close(); } catch {}
    this.port = this.reader = this.writer = null;
    this.status = 'bağlı değil';
  }

  async _tryPort(port) {
    await this.disconnect();
    this.status = 'bağlanıyor…';
    try {
      await port.open({ baudRate: 115200, bufferSize: 8192 });
    } catch (e) {
      this.status = 'port açılamadı';
      return false;
    }
    this.port = port;
    try {
      await port.setSignals({ dataTerminalReady: true, requestToSend: true });
    } catch {}
    this.writer = port.writable.getWriter();
    this.reader = port.readable.getReader();
    this.connected = true;
    this._readLoop();
    await this._send(PKT_SIM_ON);
    this._timers.push(setInterval(() => this._send(PKT_STICKS), 20));
    this._timers.push(setInterval(() => this._send(PKT_BUTTONS), 60));
    this._timers.push(setInterval(() => this._send(PKT_SIM_ON), 3000));

    const t0 = performance.now();
    while (performance.now() - t0 < 1500) {
      await new Promise((r) => setTimeout(r, 100));
      if (this.lastFrameAt > t0) {
        this.status = 'bağlı';
        return true;
      }
    }
    await this.disconnect();
    this.status = 'yanıt yok';
    return false;
  }

  async _send(pkt) {
    if (!this.writer) return;
    try {
      await this.writer.write(pkt);
    } catch {
      this._lost();
    }
  }

  _lost() {
    if (!this.connected) return;
    this.disconnect();
    this.status = 'bağlantı koptu';
  }

  async _readLoop() {
    const reader = this.reader;
    try {
      while (this.connected) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) this._feed(value);
      }
    } catch {
      this._lost();
    }
  }

  _feed(chunk) {
    const b = new Uint8Array(this._buf.length + chunk.length);
    b.set(this._buf);
    b.set(chunk, this._buf.length);
    let i = 0;
    while (true) {
      while (i < b.length && b[i] !== 0x55) i++;
      if (b.length - i < 4) break;
      const len = (b[i + 1] | (b[i + 2] << 8)) & 0x3ff;
      if (len < 13 || crc8(b.subarray(i), 3) !== b[i + 3]) {
        i++;
        continue;
      }
      if (b.length - i < len) break;
      const f = b.subarray(i, i + len);
      if ((f[len - 2] | (f[len - 1] << 8)) === crc16(f, len - 2)) {
        this._frame(f);
        i += len;
      } else {
        i++;
      }
    }
    this._buf = b.slice(i);
  }

  _frame(f) {
    const s = this.sticks;
    if (f.length === 38 && f[10] === 0x01) {
      s.rh = axis(f[13], f[14]);
      s.rv = axis(f[16], f[17]);
      s.lv = axis(f[19], f[20]);
      s.lh = axis(f[22], f[23]);
      s.wheel = axis(f[25], f[26]);
      this.lastFrameAt = performance.now();
    } else if (f.length === 21 && f[10] === 0x26) {
      s.rh = axis(f[11], f[12]);
      s.rv = axis(f[13], f[14]);
      s.lv = axis(f[15], f[16]);
      s.lh = axis(f[17], f[18]);
      this.lastFrameAt = performance.now();
    } else if (f.length === 58 && f[10] === 0x27) {
      this.rawButtons = f.slice(11, 56);
      const v = (f[28] << 8) | f[29];
      const now = {
        photo: (v & 0x1060) === 0x1060,
        rth: (v & 0x1080) === 0x1080,
        camera: (v & 0x1004) === 0x1004,
        fn: (v & 0x1002) === 0x1002,
      };
      for (const k of Object.keys(now)) {
        if (now[k] && !this.buttons[k]) this.onButton?.(k);
      }
      this.buttons = now;
    }
  }
}
