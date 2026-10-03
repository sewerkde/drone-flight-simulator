import * as THREE from 'three';

// Diğer pilotların araçları: model + isim etiketi, 120 ms geriden iki kayıt arası yumuşatılır.
const DELAY = 120;

// Her pilotun rengi: mini haritadaki işaret ile 3B isim etiketi aynı renkte
const PALETTE = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#da77f2', '#ff922b', '#3bc9db', '#f783ac'];
export const colorFor = (id) => PALETTE[Math.abs(Number(id) || 0) % PALETTE.length];

function labelSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.font = '600 30px -apple-system, system-ui, sans-serif';
  const tw = Math.min(196, g.measureText(text).width);
  const w = tw + 58;
  const x0 = (256 - w) / 2;
  g.fillStyle = 'rgba(14,16,20,0.72)';
  g.beginPath();
  g.roundRect(x0, 10, w, 44, 12);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.arc(x0 + 22, 32, 7, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(text, x0 + 38, 33, 196);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
  s.scale.set(0.16, 0.04, 1);
  s.renderOrder = 10;
  return s;
}

export class Ghosts {
  // buildModel(vehicleId) → { root, body, props, ... }; sizeOf(vehicleId) → etiket yüksekliği (m)
  constructor(scene, buildModel, sizeOf) {
    this.scene = scene;
    this.build = buildModel;
    this.sizeOf = sizeOf;
    this.items = new Map();
    this._p = new THREE.Vector3();
    this._qa = new THREE.Quaternion();
    this._qb = new THREE.Quaternion();
  }

  update(net, now, dt) {
    if (!net) return this.clear();
    net.prune(now);
    for (const p of net.peers.values()) {
      if (!p.buf.length) continue;
      let g = this.items.get(p.id);
      if (!g || p.changed) {
        if (g) this._dispose(g);
        g = this._create(p);
        this.items.set(p.id, g);
        p.changed = false;
      }
      // iki kayıt arası: geride kalan zaman noktasında konum ve yön
      const tR = now - DELAY;
      const buf = p.buf;
      let a = buf[0];
      let b = buf[buf.length - 1];
      for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i].t <= tR && buf[i + 1].t >= tR) {
          a = buf[i];
          b = buf[i + 1];
          break;
        }
      }
      const k = b.t > a.t ? Math.min(1, Math.max(0, (tR - a.t) / (b.t - a.t))) : 1;
      this._p.set(a.p[0], a.p[1], a.p[2]).lerp(new THREE.Vector3(b.p[0], b.p[1], b.p[2]), k);
      this._qa.set(a.q[0], a.q[1], a.q[2], a.q[3]);
      this._qb.set(b.q[0], b.q[1], b.q[2], b.q[3]);
      const root = g.model.root;
      root.position.copy(this._p);
      root.quaternion.slerpQuaternions(this._qa, this._qb, k);
      for (const pr of g.model.props) {
        pr.prop.rotation.y += pr.dir * b.pr * 60 * dt;
        pr.disc.material.opacity = b.pr * 0.35;
        pr.blade.visible = b.pr < 0.5;
      }
      g.label.position.copy(this._p);
      g.label.position.y += g.h;
    }
    for (const [id, g] of this.items) {
      if (!net.peers.has(id)) {
        this._dispose(g);
        this.items.delete(id);
      }
    }
  }

  _create(p) {
    const model = this.build(p.vehicle);
    // hayaletler her görünümde görünsün: katman 0; kokpit içi (katman 2) gizli
    model.root.traverse((o) => {
      if (!o.isMesh) return;
      if (o.layers.isEnabled(2) && !o.layers.isEnabled(1)) o.visible = false;
      o.layers.set(0);
    });
    model.root.rotation.order = 'YXZ';
    model.body.rotation.set(0, 0, 0);
    this.scene.add(model.root);
    const color = colorFor(p.id);
    const label = labelSprite(p.name, color);
    this.scene.add(label);
    return { model, label, h: this.sizeOf(p.vehicle), id: p.id, name: p.name, color };
  }

  _dispose(g) {
    this.scene.remove(g.model.root);
    this.scene.remove(g.label);
    g.label.material.map.dispose();
    g.label.material.dispose();
  }

  // Mini harita (radar) için: konum, yön, ad, renk
  radar() {
    const out = [];
    for (const g of this.items.values()) {
      const r = g.model.root;
      _f.set(0, 0, -1).applyQuaternion(r.quaternion);
      out.push({ id: g.id, name: g.name, color: g.color, x: r.position.x, y: r.position.y, z: r.position.z, yaw: Math.atan2(-_f.x, -_f.z) });
    }
    return out;
  }

  clear() {
    for (const g of this.items.values()) this._dispose(g);
    this.items.clear();
  }

  get count() {
    return this.items.size;
  }
}

const _f = new THREE.Vector3();
