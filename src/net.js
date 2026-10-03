// Online odalar istemcisi: rooms.py'ye bağlanır, kendi durumunu ~10 Hz gönderir, diğer pilotları tutar.
// Oda = dünya + yer (aynı yerde uçanlar aynı koordinat sistemini paylaşır).
// Diğer pilotlardan gelen her şey güvenilmezdir: biçimi bozuk kayıt sessizce düşer (çizim döngüsünü kilitlememeli).
// Lazer arena (oda ':arena'): fire(p, d) ateşi yollar, hit(byId) "vuruldum" der; skorları sunucu tutar (k/d).

const num = (v, lim) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const vec = (a, n, lim) => Array.isArray(a) && a.length === n && a.every((v) => num(v, lim));
const STATES = new Set(['off', 'ground', 'flying', 'landing', 'rth', 'crashed']);
const MAX_PEERS = 60;
const score = (v) => (Number.isInteger(v) && v >= 0 && v <= 1e6 ? v : 0); // sunucudan gelen skor; bozuksa 0

export class NetClient {
  constructor({ url, room, name, vehicle, isVehicle = () => true }) {
    this.isVehicle = (v) => typeof v === 'string' && v.length <= 24 && isVehicle(v);
    this.url = url;
    this.room = room;
    this.name = name;
    this.vehicle = vehicle;
    this.peers = new Map(); // id → { id, name, vehicle, k, d, buf: [{t, p, q, pr, st}], seen, changed }
    this.connected = false;
    this.id = null;
    this.me = { k: 0, d: 0 }; // kendi arena skoru (sunucu söyler)
    this.onJoin = null; // (peer) => void
    this.onLeave = null; // (peer) => void
    this.onRemove = null; // (peer) => void, görsel temizlik için
    this.onFire = null; // (peer, p, d) => void, arena: başka pilot ateş etti
    this.onHit = null; // ({ id, by, k, d }) => void, arena: id vuruldu (by vurdu), güncel skorlar
    this.retry = 0;
    this.lastSend = 0;
    this.lastFire = 0;
    this.closed = false;
    this._connect();
  }

  _connect() {
    if (this.closed) return;
    let ws;
    try {
      ws = new WebSocket(`${this.url}/?room=${encodeURIComponent(this.room)}`);
    } catch {
      return this._later();
    }
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.retry = 0;
      ws.send(JSON.stringify({ t: 'hello', name: this.name, vehicle: this.vehicle }));
    };
    ws.onmessage = (e) => {
      try {
        this._msg(JSON.parse(e.data));
      } catch {}
    };
    ws.onclose = () => {
      this.connected = false;
      for (const id of [...this.peers.keys()]) this._remove(id);
      this._later();
    };
    ws.onerror = () => {};
  }

  _later() {
    if (this.closed) return;
    setTimeout(() => this._connect(), Math.min(15000, 1000 * 2 ** this.retry++));
  }

  _msg(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'welcome') {
      this.id = m.id;
      if (Array.isArray(m.peers)) m.peers.slice(0, MAX_PEERS).forEach((p) => this._add(p));
    } else if (m.t === 'join') {
      const p = this._add(m);
      if (p) this.onJoin?.(p);
    } else if (m.t === 'bye') {
      const p = this.peers.get(m.id);
      if (p) {
        this._remove(m.id);
        this.onLeave?.(p);
      }
    } else if (m.t === 's') {
      if (!vec(m.p, 3, 1e6) || !vec(m.q, 4, 1.5)) return;
      const p = this.peers.get(m.id) || this._add({ id: m.id, name: 'Pilot', vehicle: m.v });
      if (!p) return;
      const now = performance.now();
      // araç değişimi: yalnız bilinen araçlar, en çok 2 sn'de bir (sürekli model yeniden kurdurulamaz)
      if (this.isVehicle(m.v) && m.v !== p.vehicle && now - (p.vehT || 0) > 2000) {
        p.vehicle = m.v;
        p.vehT = now;
        p.changed = true;
      }
      const pr = num(m.pr, 1e3) ? Math.min(1, Math.max(0, m.pr)) : 0;
      p.buf.push({ t: now, p: m.p, q: m.q, pr, st: STATES.has(m.s) ? m.s : 'flying' });
      if (p.buf.length > 20) p.buf.shift();
      p.seen = performance.now();
    } else if (m.t === 'f') {
      if (!vec(m.p, 3, 1e6) || !vec(m.d, 3, 1.5)) return;
      const p = this.peers.get(m.id) || this._add({ id: m.id, name: 'Pilot' });
      if (!p) return;
      p.seen = performance.now();
      this.onFire?.(p, m.p, m.d);
    } else if (m.t === 'h') {
      // id vuruldu, by vurdu; k = vuranın, d = vurulanın güncel sayısı
      if (!Number.isInteger(m.id) || !Number.isInteger(m.by) || m.id === m.by) return;
      const k = score(m.k);
      const d = score(m.d);
      if (m.id === this.id) this.me.d = d;
      else {
        const v = this.peers.get(m.id);
        if (v) v.d = d;
      }
      if (m.by === this.id) this.me.k = k;
      else {
        const s = this.peers.get(m.by);
        if (s) s.k = k;
      }
      this.onHit?.({ id: m.id, by: m.by, k, d });
    }
  }

  _add(info) {
    if (!info || !Number.isInteger(info.id) || info.id === this.id) return null;
    if (!this.peers.has(info.id) && this.peers.size >= MAX_PEERS) return null;
    const p = {
      id: info.id,
      name: typeof info.name === 'string' && info.name.trim() ? info.name.slice(0, 20) : 'Pilot',
      vehicle: this.isVehicle(info.vehicle) ? info.vehicle : '',
      k: score(info.k),
      d: score(info.d),
      buf: [],
      seen: performance.now(),
      changed: true,
    };
    this.peers.set(info.id, p);
    return p;
  }

  _remove(id) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    this.onRemove?.(p);
  }

  // Kendi durumunu gönder (en fazla ~10 Hz)
  send(state) {
    const now = performance.now();
    if (!this.connected || now - this.lastSend < 95) return;
    this.lastSend = now;
    try {
      this.ws.send(JSON.stringify({ t: 's', ...state }));
    } catch {}
  }

  // Arena: ateş (p konum, d yön birim vektörü); en fazla 5/sn
  fire(p, d) {
    const now = performance.now();
    if (!this.connected || now - this.lastFire < 200 || !vec(p, 3, 1e6) || !vec(d, 3, 1.5)) return false;
    this.lastFire = now;
    try {
      this.ws.send(JSON.stringify({ t: 'f', p, d }));
      return true;
    } catch {
      return false;
    }
  }

  // Arena: "beni byId vurdu" (hile önlemi: yalnız vurulan bildirir; sunucu skorları günceller ve herkese yayar)
  hit(byId) {
    if (!this.connected || !Number.isInteger(byId) || byId === this.id || !this.peers.has(byId)) return false;
    try {
      this.ws.send(JSON.stringify({ t: 'h', by: byId }));
      return true;
    } catch {
      return false;
    }
  }

  // Bağlantısı kopan pilotu sunucu 'bye' ile bildirir. Sessiz ama bağlı pilot (arka plandaki sekme,
  // örtülü pencere) son yerinde kalsın; 60 sn hiç ses gelmezse düşür.
  prune(now) {
    for (const p of [...this.peers.values()]) if (now - p.seen > 60000) this._remove(p.id);
  }

  close() {
    this.closed = true;
    try {
      this.ws?.close();
    } catch {}
    for (const id of [...this.peers.keys()]) this._remove(id);
  }
}
