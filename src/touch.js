// Dokunmatik kaynak: iki sanal çubuk (sol = gaz/yaw, sağ = pitch/roll; bırakınca ortaya döner)
// ve küçük Kalkış / İniş / RTH / Görünüm tuşları. Yalnız dokunmatik cihazlarda görünür.
// DOM ve CSS bu modülde üretilir; style.css'e dokunulmaz. Pointer Events ile çoklu dokunuş.

const TRAVEL = 44; // px, çubuğun tam sapması
const LABELS = { takeoff: 'Takeoff', land: 'Land', rth: 'RTH', view: 'View', fire: 'Fire' };

// Dokunmatik arayüz gösterilsin mi? Masaüstünde (fare/trackpad birincil işaretçi) hayır.
export function shouldShowTouch({ maxTouchPoints = 0, coarse = false, force = false } = {}) {
  if (force) return true;
  return maxTouchPoints > 0 && coarse;
}

export function touchEnv() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return { maxTouchPoints: 0, coarse: false };
  return {
    maxTouchPoints: navigator.maxTouchPoints || 0,
    coarse: !!window.matchMedia?.('(pointer: coarse)').matches,
  };
}

// Parmağın başlangıç noktasına göre kayması → çubuk değeri. Kare kapı (gerçek gimbal gibi),
// eksen başına -1..1; ekran y'si aşağı arttığı için dikey ters.
export function stickVector(dx, dy, radius = TRAVEL) {
  if (!(radius > 0)) return { x: 0, y: 0 };
  const c = (v) => (v > 1 ? 1 : v < -1 ? -1 : v);
  return { x: c(dx / radius) || 0, y: c(-dy / radius) || 0 };
}

const CSS = `
.djt{position:fixed;inset:0;pointer-events:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;
  font:600 12px/1 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:#f4f6f8}
.djt.djt-off{display:none}
.djt-zone{position:absolute;bottom:max(6px,env(safe-area-inset-bottom));width:190px;height:190px;pointer-events:auto;touch-action:none}
.djt-zone.l{left:max(6px,env(safe-area-inset-left))}
.djt-zone.r{right:max(6px,env(safe-area-inset-right))}
.djt-base{position:absolute;left:50%;top:50%;width:116px;height:116px;margin:-58px 0 0 -58px;border-radius:26px;
  background:rgba(14,16,20,.36);border:1px solid rgba(255,255,255,.22);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.djt-base::before,.djt-base::after{content:'';position:absolute;background:rgba(255,255,255,.14)}
.djt-base::before{left:50%;top:12px;bottom:12px;width:1px}
.djt-base::after{top:50%;left:12px;right:12px;height:1px}
.djt-knob{position:absolute;left:50%;top:50%;width:50px;height:50px;margin:-25px 0 0 -25px;border-radius:50%;
  background:rgba(244,246,248,.82);box-shadow:0 2px 10px rgba(0,0,0,.35)}
.djt-zone.on .djt-base{border-color:rgba(47,140,255,.85);background:rgba(14,16,20,.5)}
.djt-cap{position:absolute;left:0;right:0;top:6px;text-align:center;font-size:10px;letter-spacing:.06em;color:rgba(244,246,248,.6)}
.djt-btns{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(max(6px,env(safe-area-inset-bottom)) + 64px);
  display:flex;gap:6px;pointer-events:none}
.djt-btns button{pointer-events:auto;touch-action:none;min-width:58px;height:34px;padding:0 10px;margin:0;border-radius:10px;
  border:1px solid rgba(255,255,255,.22);background:rgba(14,16,20,.62);color:inherit;font:inherit;letter-spacing:.02em;cursor:pointer}
.djt-btns button.on{background:#2f8cff;border-color:#2f8cff}
@media (max-aspect-ratio:1/1){.djt-btns{bottom:calc(max(6px,env(safe-area-inset-bottom)) + 214px)}}
.djt-fire{position:absolute;right:max(10px,env(safe-area-inset-right));bottom:calc(max(6px,env(safe-area-inset-bottom)) + 204px);
  width:66px;height:66px;margin:0;padding:0;border-radius:50%;pointer-events:auto;touch-action:none;
  border:2px solid rgba(255,75,62,.8);background:rgba(14,16,20,.62);color:inherit;font:inherit;font-size:12px;letter-spacing:.04em;cursor:pointer}
.djt-fire.on{background:rgba(255,75,62,.85);border-color:#ff4b3e}
.djt-fire[hidden]{display:none}
@media (max-aspect-ratio:1/1){.djt-fire{bottom:calc(max(6px,env(safe-area-inset-bottom)) + 268px)}}
`;

export class TouchSource {
  // opts: { force: masaüstünde de göster (test), labels: {takeoff, land, rth, view},
  //         before: bu seçicinin önüne eklenir (varsayılan '#start': açılış ekranı çubukların üstünde kalır),
  //         parent: before bulunamazsa eklenecek öğe (varsayılan body) }
  constructor(opts = {}) {
    this.opts = opts;
    this.sticks = { lh: 0, lv: 0, rh: 0, rv: 0, wheel: 0 };
    this.buttons = { takeoff: false, land: false, rth: false, view: false, fire: false };
    this.rawButtons = null;
    this.onButton = null; // (ad) => void, basıldığı an bir kez
    this.enabled = shouldShowTouch({ ...touchEnv(), force: !!opts.force });
    this.visible = false;
    this.fireOn = false; // lazer arena: ekranda ateş düğmesi
    this.root = null;
    this._labels = { ...LABELS, ...(opts.labels || {}) };
    this._release = [];
    this.status = this.enabled ? 'dokunmatik çubuklar' : 'dokunmatik değil';
  }

  get supported() {
    return this.enabled;
  }

  get connected() {
    return this.enabled;
  }

  // Dokunmatik cihazda her zaman canlı: bırakılmış çubuk = 0, klavye de çalışmaya devam eder.
  get live() {
    return this.enabled;
  }

  setVisible(v) {
    v = !!v && this.enabled;
    if (v && !this.root) this._build();
    if (!v) this._releaseAll();
    this.root?.classList.toggle('djt-off', !v);
    this.visible = v;
  }

  setLabels(labels) {
    Object.assign(this._labels, labels);
    this.root?.querySelectorAll('[data-djt]').forEach((b) => (b.textContent = this._labels[b.dataset.djt]));
  }

  // Ateş düğmesi yalnız lazer arenada görünür (serbest uçuşta yok)
  setFire(on) {
    on = !!on;
    if (on === this.fireOn) return;
    this.fireOn = on;
    const b = this.root?.querySelector('.djt-fire');
    if (b) b.hidden = !on;
  }

  destroy() {
    this._releaseAll();
    this.root?.remove();
    this.root = null;
    this.visible = false;
  }

  _releaseAll() {
    this._release.forEach((f) => f());
  }

  _build() {
    if (!document.getElementById('djt-style')) {
      const st = document.createElement('style');
      st.id = 'djt-style';
      st.textContent = CSS;
      document.head.append(st);
    }
    const root = document.createElement('div');
    root.className = 'djt djt-off';
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.append(this._stick('l', 'THR · YAW'), this._stick('r', 'PITCH · ROLL'));

    const row = document.createElement('div');
    row.className = 'djt-btns';
    for (const name of ['takeoff', 'land', 'rth', 'view']) row.append(this._button(name));
    root.append(row);
    const fire = this._button('fire');
    fire.className = 'djt-fire';
    fire.hidden = !this.fireOn;
    root.append(fire);

    const before = document.querySelector(this.opts.before ?? '#start');
    if (before) before.before(root);
    else (this.opts.parent || document.body).append(root);
    this.root = root;
  }

  _stick(side, caption) {
    const zone = document.createElement('div');
    zone.className = `djt-zone ${side}`;
    zone.innerHTML = `<div class="djt-cap"></div><div class="djt-base"><div class="djt-knob"></div></div>`;
    zone.firstChild.textContent = caption;
    const base = zone.querySelector('.djt-base');
    const knob = zone.querySelector('.djt-knob');
    const s = this.sticks;
    const st = { id: null, ox: 0, oy: 0 };

    const set = (x, y) => {
      if (side === 'l') {
        s.lh = x;
        s.lv = y;
      } else {
        s.rh = x;
        s.rv = y;
      }
      knob.style.transform = x || y ? `translate(${x * TRAVEL}px, ${-y * TRAVEL}px)` : '';
    };
    const release = () => {
      st.id = null;
      base.style.transform = '';
      zone.classList.remove('on');
      set(0, 0);
    };

    zone.addEventListener('pointerdown', (e) => {
      if (st.id !== null) return; // bu çubukta zaten bir parmak var
      e.preventDefault();
      st.id = e.pointerId;
      try {
        zone.setPointerCapture(e.pointerId);
      } catch {}
      // Taban parmağın değdiği yere taşınır: dokunuşta sıçrama olmaz, ilk değer 0.
      const r = zone.getBoundingClientRect();
      st.ox = e.clientX;
      st.oy = e.clientY;
      base.style.transform = `translate(${e.clientX - (r.left + r.width / 2)}px, ${e.clientY - (r.top + r.height / 2)}px)`;
      zone.classList.add('on');
      set(0, 0);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== st.id) return;
      const v = stickVector(e.clientX - st.ox, e.clientY - st.oy, TRAVEL);
      set(v.x, v.y);
    });
    const end = (e) => {
      if (e.pointerId === st.id) release();
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);
    this._release.push(release);
    return zone;
  }

  _button(name) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.djt = name;
    b.textContent = this._labels[name];
    const ids = new Set();
    const up = (e) => {
      if (!ids.delete(e.pointerId)) return;
      if (!ids.size) {
        this.buttons[name] = false;
        b.classList.remove('on');
      }
    };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      ids.add(e.pointerId);
      try {
        b.setPointerCapture(e.pointerId);
      } catch {}
      if (this.buttons[name]) return;
      this.buttons[name] = true;
      b.classList.add('on');
      this.onButton?.(name);
    });
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    this._release.push(() => {
      ids.clear();
      this.buttons[name] = false;
      b.classList.remove('on');
    });
    return b;
  }
}
