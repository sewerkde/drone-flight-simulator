// Kumandayı serve.py okur, /rc üzerinden (Server-Sent Events) buraya akıtır.
// Her tarayıcıda çalışır; port seçimi gerekmez.

export class BridgeRc {
  constructor(url = '/rc') {
    this.sticks = { lh: 0, lv: 0, rh: 0, rv: 0, wheel: 0 };
    this.buttons = { photo: false, rth: false, camera: false, fn: false };
    this.rawButtons = null;
    this.onButton = null; // (ad) => void, basıldığı an bir kez
    this.onChange = null; // (live) => void
    this.onMode = null; // ('C' | 'N' | 'S') => void, mod anahtarı değişince
    this.switchMode = null;
    this.connected = false; // sunucuya bağlı
    this.status = 'sunucu bekleniyor';
    this._live = false;
    this._lastMsg = 0;

    const es = new EventSource(url);
    es.onopen = () => {
      this.connected = true;
    };
    es.onerror = () => {
      this.connected = false;
      this.status = 'sunucuya ulaşılamıyor';
    };
    es.onmessage = (e) => this._msg(JSON.parse(e.data));
  }

  get supported() {
    return true;
  }

  get live() {
    return this._live && performance.now() - this._lastMsg < 1000;
  }

  _msg(m) {
    this._lastMsg = performance.now();
    this.status = m.status;
    if (m.live !== this._live) {
      this._live = m.live;
      this.onChange?.(m.live);
    }
    if (!m.live) return;
    const s = this.sticks;
    s.lh = m.lh;
    s.lv = m.lv;
    s.rh = m.rh;
    s.rv = m.rv;
    s.wheel = m.wheel;
    if (!m.raw) return; // tuş/anahtar yanıtı henüz gelmedi
    this.rawButtons = Uint8Array.from(m.raw.match(/../g).map((h) => parseInt(h, 16)));
    // 0x27 yanıtı, bayt 28-29. Üst bayt 0x30 bitleri = C/N/S anahtarı (03.10 ölçüldü: 00 S, 10 N, 20 C).
    // Alt bayt = tuşlar; mod bitinden bağımsız okunmalı.
    const v = m.btn;
    const sw = { 0x00: 'S', 0x10: 'N', 0x20: 'C' }[(v >> 8) & 0x30];
    if (sw && sw !== this.switchMode) {
      this.switchMode = sw;
      this.onMode?.(sw);
    }
    const lo = v & 0xff;
    const now = {
      photo: (lo & 0x60) === 0x60,
      rth: (lo & 0x80) !== 0,
      camera: (lo & 0x04) !== 0,
      fn: (lo & 0x02) !== 0,
    };
    for (const k of Object.keys(now)) {
      if (now[k] && !this.buttons[k]) this.onButton?.(k);
    }
    this.buttons = now;
  }
}
