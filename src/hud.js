import { MODES } from './flight.js';
import { ROADS, FIELDS, LAKE, TOWER } from './world.js';
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);

export const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
export const fmtLap = (s) => {
  s = Math.max(0, s);
  return `${fmtTime(s)}.${Math.floor((s % 1) * 10)}`;
};

// [başlık anahtarı, ipucu anahtarı, sınıf]
const STATE = {
  off: ['st.off', 'hint.off', ''],
  ground: ['st.ground', 'hint.ground', ''],
  flying: ['st.flying', '', ''],
  landing: ['st.landing', '', 'warn'],
  rth: ['st.rth', 'hint.rth', 'warn'],
  crashed: ['st.crashed', '', 'bad'],
};
const WIND = ['', 'wind1', 'wind2', 'wind3'];

export class Hud {
  constructor(world) {
    this.world = world;
    this.map = $('map').getContext('2d');
    this.lastState = null;
    this.tt = 0;
  }

  toast(text, kind = 'info', secs = 2.6) {
    const t = $('toast');
    t.textContent = text;
    t.className = `toast show ${kind === 'info' ? '' : kind}`;
    clearTimeout(this.tt);
    this.tt = setTimeout(() => t.classList.remove('show'), secs * 1000);
  }

  // Lazer arena skor paneli: üstte kalan can (3 kutu), altta pilotlar (renk noktası · ad · isabet · vuruluş)
  arena(a) {
    const box = $('arena');
    box.classList.toggle('hidden', !a);
    if (!a) {
      this.arenaSig = null;
      return;
    }
    $('arenaLives').querySelectorAll('i').forEach((el, i) => el.classList.toggle('off', i >= a.lives));
    const sig = a.rows.map((r) => `${r.id}:${r.name}:${r.k}:${r.d}`).join('|');
    if (sig === this.arenaSig) return;
    this.arenaSig = sig;
    const list = $('arenaRows');
    list.replaceChildren();
    for (const r of a.rows) {
      const li = document.createElement('li');
      if (r.me) li.className = 'me';
      const dot = document.createElement('i');
      dot.style.background = r.color;
      const name = document.createElement('span');
      name.textContent = r.name;
      const k = document.createElement('b');
      k.textContent = r.k;
      const d = document.createElement('em');
      d.textContent = r.d;
      li.append(dot, name, k, d);
      list.append(li);
    }
  }

  update({ d, rc, inp, opt, viewName, placeName, fps, recSecs, pilot, home, peers = [], arena = null }) {
    this.arena(arena);
    if (d.state !== this.lastState) {
      this.lastState = d.state;
      let [title, hint, cls] = STATE[d.state];
      if (d.kind === 'plane' && d.state === 'off') hint = 'hint.planeOff';
      if (d.kind === 'plane' && d.state === 'ground') [title, hint] = ['st.planeGround', 'hint.planeGround'];
      const s = $('state');
      s.className = `state ${cls}`;
      s.textContent = t(title);
      if (hint) {
        const small = document.createElement('span');
        small.style.cssText = 'color:var(--muted);font-weight:400;margin-left:8px';
        small.textContent = `· ${t(hint)}`;
        s.append(small);
      }
      $('crash').classList.toggle('hidden', d.state !== 'crashed');
      if (d.state === 'crashed') $('crashTitle').textContent = t(d.crash.text);
    }

    $('mode').textContent = d.modeLabel?.() ?? d.mode;
    $('mode').title = `${d.modeName?.() ?? MODES[d.mode].name} mod (1 / 2 / 3)`;
    const thr = d.throttle !== undefined;
    $('tThrBox').classList.toggle('hidden', !thr);
    if (thr) $('tThr').textContent = Math.round(d.throttle * 100);

    const live = rc.live;
    $('linkDot').className = `dot ${live ? 'ok' : ''}`;
    $('linkText').textContent = live ? (rc.source === 'touch' ? t('srcTouch') : rc.source === 'gamepad' ? rc.sourceName : t('controller')) : t('keyboard');

    const w = $('wind');
    w.classList.toggle('hidden', !opt.wind);
    w.textContent = WIND[opt.wind] ? t(WIND[opt.wind]) : '';

    const b = Math.round(d.battery * 100);
    $('battText').textContent = `${b}%`;
    const fill = $('battFill');
    fill.style.width = `${b}%`;
    fill.style.background = b < 15 ? 'var(--bad)' : b < 25 ? 'var(--warn)' : 'var(--ok)';
    $('ftime').textContent = fmtTime(d.flightTime);

    const hs = Math.hypot(d.vel.x, d.vel.z);
    $('tH').textContent = d.height.toFixed(1);
    $('tD').textContent = Math.round(Math.hypot(d.pos.x - d.home.x, d.pos.z - d.home.z));
    $('tHS').textContent = hs.toFixed(1);
    $('tVS').textContent = (d.motors ? d.vel.y : 0).toFixed(1);

    $('gimbalMark').style.top = `${((20 - d.gimbal) / 110) * 100}%`;
    $('gimbalText').textContent = `${Math.round(d.gimbal)}°`;

    const st = (el, x, y) => {
      el.style.left = `${50 + x * 42}%`;
      el.style.top = `${50 - y * 42}%`;
    };
    st($('stL'), inp.yaw, inp.thr);
    st($('stR'), inp.roll, inp.pitch);
    st($('stW'), 0, inp.gimbal);

    // kalkış/iniş tek yerde: havadayken İniş görünür
    const air = d.state === 'flying' || d.state === 'landing' || d.state === 'rth';
    $('btnTakeoff').classList.toggle('hidden', air);
    $('btnLand').classList.toggle('hidden', !air);

    // kumanda paneli başlığı + değerler (10 Hz yeter)
    $('rcpDot').className = `dot ${live ? 'ok' : ''}`;
    $('rcpName').textContent = $('linkText').textContent;
    $('rcpMode').textContent = d.modeLabel?.() ?? d.mode;
    const now = performance.now();
    if (!this.valT || now - this.valT > 100) {
      this.valT = now;
      const pct = (v) => `${v > 0.005 ? '+' : ''}${Math.round(v * 100)}`;
      $('vThr').textContent = pct(inp.thr);
      $('vYaw').textContent = pct(inp.yaw);
      $('vPitch').textContent = pct(inp.pitch);
      $('vRoll').textContent = pct(inp.roll);
      $('vGim').textContent = pct(inp.gimbal);
    }

    const c = this.world.course;
    const total = this.world.rings.length;
    let ct;
    if (!total) ct = !d.airborne || d.flightTime < 4 ? placeName || '' : ''; // kalkıştan 4 sn sonra yer adı gizlenir
    else if (c.startAt !== null) ct = t('course.ring', { n: c.next, total, time: fmtLap(d.time - c.startAt) });
    else if (c.lastTime !== null) ct = t('course.last', { time: fmtLap(c.lastTime) }) + (opt.best ? t('course.best', { time: fmtLap(opt.best) }) : '');
    else ct = opt.best ? t('course.bestOnly', { time: fmtLap(opt.best) }) : t('course.hint');
    $('course').textContent = ct;

    $('viewName').textContent = viewName;
    $('rec').classList.toggle('hidden', recSecs === null);
    if (recSecs !== null) $('recTime').textContent = fmtTime(recSecs);

    // ev işareti: yön + mesafe; eve dönüşte vurgulu
    const hm = $('homeMark');
    hm.classList.toggle('hidden', !home);
    if (home) {
      hm.style.left = `${home.x}px`;
      hm.style.top = `${home.y}px`;
      hm.classList.toggle('edge', !home.onScreen);
      hm.classList.toggle('rth', home.rth);
      hm.querySelector('.hm-arrow').style.transform = `rotate(${home.angle + Math.PI / 2}rad)`;
      $('homeDist').textContent = home.dist >= 1000 ? `${(home.dist / 1000).toFixed(2)} km` : `${Math.round(home.dist)} m`;
    }

    const pm = $('pilotMark');
    pm.classList.toggle('hidden', !pilot);
    if (pilot) {
      pm.style.left = `${pilot.x}px`;
      pm.style.top = `${pilot.y}px`;
      pm.querySelector('span').textContent = `${Math.round(pilot.dist)} m`;
    }

    const dbg = $('debug');
    dbg.classList.toggle('hidden', !opt.debug);
    if (opt.debug) {
      const s = rc.sticks;
      const raw = rc.rawButtons
        ? Array.from(rc.rawButtons).map((v, i) => `${String(i + 11).padStart(2)}:${v.toString(16).padStart(2, '0')}`).join(' ')
        : '-';
      dbg.textContent =
        `fps ${fps.toFixed(0)}  rc: ${rc.status}\n` +
        `left  x ${s.lh.toFixed(2)}  y ${s.lv.toFixed(2)}\n` +
        `right x ${s.rh.toFixed(2)}  y ${s.rv.toFixed(2)}  wheel ${s.wheel.toFixed(2)}\n` +
        `buttons ${JSON.stringify(rc.buttons)}\n` +
        `0x27 reply: ${raw}`;
    }

    this.drawMap(d, peers);
  }

  drawMap(d, peers = []) {
    const g = this.map;
    const W = 360;
    const s = 1.35;
    const cx = W / 2;
    const X = (x) => cx + (x - d.pos.x) * s;
    const Y = (z) => cx + (z - d.pos.z) * s;
    const TAU = Math.PI * 2;

    g.save();
    if (this.world.kind !== 'village') {
      // gerçek dünyada harita verisi yok: 50 m ızgara
      g.fillStyle = '#1d2228';
      g.fillRect(0, 0, W, W);
      g.strokeStyle = 'rgba(255,255,255,0.12)';
      g.lineWidth = 1;
      const step = 50 * s;
      const ox = (((-d.pos.x * s) % step) + step) % step;
      const oz = (((-d.pos.z * s) % step) + step) % step;
      for (let a = 0; a < W + step; a += step) {
        g.beginPath();
        g.moveTo(ox + a - step, 0);
        g.lineTo(ox + a - step, W);
        g.moveTo(0, oz + a - step);
        g.lineTo(W, oz + a - step);
        g.stroke();
      }
      // radar: menzil halkaları + dönen tarama
      this._radarRings(g, s, cx);
      if (g.createConicGradient) {
        const a = ((performance.now() / 3500) % 1) * TAU;
        const grad = g.createConicGradient(a, cx, cx);
        grad.addColorStop(0, 'rgba(60,207,110,0)');
        grad.addColorStop(0.86, 'rgba(60,207,110,0)');
        grad.addColorStop(1, 'rgba(60,207,110,0.26)');
        g.fillStyle = grad;
        g.fillRect(0, 0, W, W);
        g.strokeStyle = 'rgba(60,207,110,0.55)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(cx, cx);
        g.lineTo(cx + Math.cos(a) * W, cx + Math.sin(a) * W);
        g.stroke();
      }
      return this._mapOverlay(g, d, X, Y, W, cx, peers);
    }
    g.fillStyle = '#3f5a2c';
    g.fillRect(0, 0, W, W);
    g.globalAlpha = 0.75;
    for (const f of FIELDS) {
      g.save();
      g.translate(X(f.x), Y(f.z));
      g.rotate(f.rot);
      g.fillStyle = f.color;
      g.fillRect((-f.w * s) / 2, (-f.d * s) / 2, f.w * s, f.d * s);
      g.restore();
    }
    g.globalAlpha = 1;
    g.fillStyle = '#3d7598';
    g.beginPath();
    g.ellipse(X(LAKE.x), Y(LAKE.z), LAKE.rx * s, LAKE.rz * s, 0, 0, TAU);
    g.fill();
    g.strokeStyle = '#8d8f92';
    for (const r of ROADS) {
      g.lineWidth = Math.max(2, r.w * s);
      g.beginPath();
      g.moveTo(X(r.x0), Y(r.z0));
      g.lineTo(X(r.x1), Y(r.z1));
      g.stroke();
    }
    g.fillStyle = '#243d1d';
    for (const [x, z] of this.world.mapData.trees) {
      const px = X(x);
      const py = Y(z);
      if (px < -4 || py < -4 || px > W + 4 || py > W + 4) continue;
      g.beginPath();
      g.arc(px, py, 2.4, 0, TAU);
      g.fill();
    }
    g.fillStyle = '#d6d0c2';
    for (const h of this.world.mapData.houses) g.fillRect(X(h.x - h.w / 2), Y(h.z - h.d / 2), h.w * s, h.d * s);
    g.fillStyle = '#ff4b3e';
    g.beginPath();
    g.arc(X(TOWER.x), Y(TOWER.z), 4, 0, TAU);
    g.fill();

    const next = this.world.course.next;
    this.world.mapData.rings.forEach((r, i) => {
      g.fillStyle = i < next ? '#3ccf6e' : i === next ? '#ff8a1a' : '#f4f4f4';
      g.beginPath();
      g.arc(X(r.x), Y(r.z), i === next ? 5.5 : 3.5, 0, TAU);
      g.fill();
    });

    this._mapOverlay(g, d, X, Y, W, cx, peers);
  }

  _radarRings(g, s, cx) {
    g.strokeStyle = 'rgba(60,207,110,0.28)';
    g.fillStyle = 'rgba(60,207,110,0.6)';
    g.lineWidth = 1.5;
    g.font = '600 15px system-ui, sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'bottom';
    for (const m of [50, 100]) {
      g.beginPath();
      g.arc(cx, cx, m * s, 0, Math.PI * 2);
      g.stroke();
      g.fillText(`${m}`, cx + 4, cx - m * s - 2);
    }
  }

  // Diğer pilotlar: menzildeyse yönlü renkli üçgen + ad, dışındaysa kenarda ok + mesafe
  _mapPeers(g, d, X, Y, W, cx, peers) {
    const M = 16;
    for (const p of peers) {
      let px = X(p.x);
      let py = Y(p.z);
      const inside = px > M && py > M && px < W - M && py < W - M;
      g.save();
      if (inside) {
        g.translate(px, py);
        g.rotate(-p.yaw);
        g.fillStyle = p.color;
        g.strokeStyle = 'rgba(0,0,0,0.85)';
        g.lineWidth = 2.5;
        g.beginPath();
        g.moveTo(0, -11);
        g.lineTo(8, 8);
        g.lineTo(0, 4);
        g.lineTo(-8, 8);
        g.closePath();
        g.stroke();
        g.fill();
        g.restore();
        const dy = p.y - d.pos.y;
        const label = p.name.slice(0, 10) + (dy > 5 ? ' ▲' : dy < -5 ? ' ▼' : '');
        this._mapText(g, label, px, py + 13, p.color, 'top');
        continue;
      }
      // kenara sıkıştır (merkezden çıkan doğrultuda)
      const dx = px - cx;
      const dz = py - cx;
      const k = Math.min((cx - M) / Math.max(1e-6, Math.abs(dx)), (cx - M) / Math.max(1e-6, Math.abs(dz)));
      px = cx + dx * k;
      py = cx + dz * k;
      g.translate(px, py);
      g.rotate(Math.atan2(dz, dx) + Math.PI / 2);
      g.fillStyle = p.color;
      g.strokeStyle = 'rgba(0,0,0,0.85)';
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(0, -10);
      g.lineTo(8, 5);
      g.lineTo(-8, 5);
      g.closePath();
      g.stroke();
      g.fill();
      g.restore();
      const dist = Math.hypot(p.x - d.pos.x, p.z - d.pos.z);
      const txt = `${p.name.slice(0, 8)} ${dist >= 1000 ? (dist / 1000).toFixed(1) + ' km' : Math.round(dist) + ' m'}`;
      // metni kenardan içeri al
      const tx = Math.max(56, Math.min(W - 56, px));
      const ty = py > cx ? py - 14 : py + 14;
      this._mapText(g, txt, tx, ty, p.color, py > cx ? 'bottom' : 'top');
    }
  }

  _mapText(g, txt, x, y, color, base) {
    g.font = 'bold 17px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = base;
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    g.strokeText(txt, x, y);
    g.fillStyle = color;
    g.fillText(txt, x, y);
  }

  // ev çizgisi, H, diğer pilotlar, drone oku, kuzey işareti (her iki harita için ortak)
  _mapOverlay(g, d, X, Y, W, cx, peers = []) {
    const hx = X(d.home.x);
    const hy = Y(d.home.z);
    // eve dönüşte rota kalın ve akan çizgi, normalde ince kesikli
    const rth = d.state === 'rth';
    g.setLineDash(rth ? [14, 10] : [6, 6]);
    g.lineDashOffset = rth ? -((performance.now() / 25) % 24) : 0;
    g.strokeStyle = rth ? 'rgba(255,210,63,1)' : 'rgba(255,210,63,0.8)';
    g.lineWidth = rth ? 5 : 2;
    g.beginPath();
    g.moveTo(cx, cx);
    g.lineTo(hx, hy);
    g.stroke();
    g.setLineDash([]);
    g.lineDashOffset = 0;
    // ev noktası halkası (harita içindeyse)
    if (hx > 0 && hy > 0 && hx < W && hy < W) {
      g.strokeStyle = '#ffd23f';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(hx, hy, 15, 0, Math.PI * 2);
      g.stroke();
    }
    const ex = Math.max(14, Math.min(W - 14, hx));
    const ey = Math.max(14, Math.min(W - 14, hy));
    g.fillStyle = '#ffd23f';
    g.font = 'bold 24px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('H', ex, ey);
    if (peers.length) this._mapPeers(g, d, X, Y, W, cx, peers);

    g.translate(cx, cx);
    g.rotate(-d.yaw);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#000000';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(0, -14);
    g.lineTo(10, 11);
    g.lineTo(0, 5);
    g.lineTo(-10, 11);
    g.closePath();
    g.stroke();
    g.fill();
    g.restore();

    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.font = 'bold 18px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(t('mapNorth'), cx, 16);
  }
}
