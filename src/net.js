// Online odalar istemcisi: rooms.py'ye bağlanır, kendi durumunu ~10 Hz gönderir, diğer pilotları tutar.
// Oda = dünya + yer (aynı yerde uçanlar aynı koordinat sistemini paylaşır).

export class NetClient {
  constructor({ url, room, name, vehicle }) {
    this.url = url;
    this.room = room;
    this.name = name;
    this.vehicle = vehicle;
    this.peers = new Map(); // id → { id, name, vehicle, buf: [{t, p, q, pr, st}], seen, changed }
    this.connected = false;
    this.id = null;
    this.onJoin = null; // (peer) => void
    this.onLeave = null; // (peer) => void
    this.onRemove = null; // (peer) => void, görsel temizlik için
    this.retry = 0;
    this.lastSend = 0;
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
    if (m.t === 'welcome') {
      this.id = m.id;
      m.peers.forEach((p) => this._add(p));
    } else if (m.t === 'join') {
      this.onJoin?.(this._add(m));
    } else if (m.t === 'bye') {
      const p = this.peers.get(m.id);
      if (p) {
        this._remove(m.id);
        this.onLeave?.(p);
      }
    } else if (m.t === 's') {
      const p = this.peers.get(m.id) || this._add({ id: m.id, name: 'Pilot', vehicle: m.v });
      if (m.v && m.v !== p.vehicle) {
        p.vehicle = m.v;
        p.changed = true;
      }
      p.buf.push({ t: performance.now(), p: m.p, q: m.q, pr: m.pr || 0, st: m.s });
      if (p.buf.length > 20) p.buf.shift();
      p.seen = performance.now();
    }
  }

  _add(info) {
    const p = {
      id: info.id,
      name: info.name || 'Pilot',
      vehicle: info.vehicle || '',
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
