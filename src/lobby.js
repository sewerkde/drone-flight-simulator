// Başlangıç ekranı lobisi: şu an online uçan pilotlar (rooms.py GET /rooms) + küçük dünya haritası.
// Gizlilik: yalnız hazır yerlerle eşleşen odaların konumu gösterilir; diğerleri "özel konum" olarak sayılır.
import { PLACES, placeLabel } from './world-google.js';
import { lang, t } from './i18n.js';

const POLL_MS = 5000;
const TIMEOUT_MS = 4000;
const MAX_ROWS = { wide: 3, narrow: 5 }; // fazlası "tümünü göster" ile açılır (geniş: harita boyu kadar)
const WIDE = 620; // lobby.css @container ile aynı
const MAX_NAMES = 3;

const TEXT = {
  en: {
    title: 'Online now',
    total: (n) => (n === 1 ? '1 pilot' : `${n} pilots`),
    loading: 'Looking for pilots…',
    empty: 'No one is flying online right now',
    emptyHint: 'Turn on Online before you start and other pilots will see you here.',
    offline: 'Online server unreachable · retrying',
    osm: 'Open map',
    sat: 'Satellite 3D',
    google: 'Google 3D',
    village: 'Village',
    custom: 'Custom location',
    join: 'Join',
    joinAria: (p) => `Join ${p}`,
    map: 'World map of online pilots',
    all: (n) => `Show all ${n}`,
    less: 'Show fewer',
    pilots: (n) => (n === 1 ? '1 pilot' : `${n} pilots`),
  },
  tr: {
    title: 'Şu an online',
    total: (n) => `${n} pilot`,
    loading: 'Pilotlara bakılıyor…',
    empty: 'Şu an online uçan kimse yok',
    emptyHint: 'Başlamadan önce Online seçeneğini aç, diğer pilotlar seni burada görsün.',
    offline: 'Online sunucusuna ulaşılamıyor · yeniden deneniyor',
    osm: 'Açık harita',
    sat: 'Uydu 3B',
    google: 'Google 3D',
    village: 'Köy',
    custom: 'Özel konum',
    join: 'Katıl',
    joinAria: (p) => `${p}: katıl`,
    map: 'Online pilotların dünya haritası',
    all: (n) => `Tümünü göster (${n})`,
    less: 'Daha az göster',
    pilots: (n) => `${n} pilot`,
  },
  de: {
    title: 'Jetzt online',
    total: (n) => (n === 1 ? '1 Pilot' : `${n} Piloten`),
    loading: 'Suche nach Piloten …',
    empty: 'Gerade fliegt niemand online',
    emptyHint: 'Schalte vor dem Start „Online“ ein, dann sehen dich andere Piloten hier.',
    offline: 'Online-Server nicht erreichbar · neuer Versuch läuft',
    osm: 'Offene Karte',
    sat: 'Satellit 3D',
    google: 'Google 3D',
    village: 'Dorf',
    custom: 'Eigener Ort',
    join: 'Mitfliegen',
    joinAria: (p) => `${p}: mitfliegen`,
    map: 'Weltkarte der Online-Piloten',
    all: (n) => `Alle ${n} anzeigen`,
    less: 'Weniger anzeigen',
    pilots: (n) => (n === 1 ? '1 Pilot' : `${n} Piloten`),
  },
};
const tx = () => TEXT[lang()] || TEXT.en;

// oda anahtarı → hazır yer ("51.6323,7.5370")
const PRESET = new Map(PLACES.map((p) => [`${p.lat.toFixed(4)},${p.lon.toFixed(4)}`, p]));

// ':arena' eki lazer arena odası (aynı yer, ayrı oda)
function classify(room) {
  const arena = room.endsWith(':arena');
  if (arena) room = room.slice(0, -':arena'.length);
  if (room === 'village') return { type: 'village', world: 'village', place: null, arena };
  const m = /^(osm|sat|google):(.+)$/.exec(room);
  const place = m && PRESET.get(m[2]);
  if (place) return { type: 'preset', world: m[1], place, arena };
  return { type: 'custom', world: m ? m[1] : null, place: null, arena };
}

// ws://host:8766 → http://host:8766/rooms
function httpUrl(ws) {
  try {
    const u = new URL(ws, location.href);
    if (u.protocol === 'wss:') u.protocol = 'https:';
    else if (u.protocol === 'ws:') u.protocol = 'http:';
    u.pathname = `${u.pathname.replace(/\/+$/, '')}/rooms`;
    u.search = '';
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

// kara verisi bir kez yüklenir (assets/world-land.json)
let landPromise = null;
function loadLand() {
  landPromise ||= fetch(new URL('../assets/world-land.json', import.meta.url))
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d && Array.isArray(d.p) ? d : null))
    .catch(() => null);
  return landPromise;
}

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// sunucu yanıtını süz: beklenmeyen alanlar yok sayılır
function parse(data) {
  const out = [];
  const list = Array.isArray(data?.rooms) ? data.rooms : [];
  for (const r of list) {
    if (!r || typeof r.room !== 'string') continue;
    const pilots = (Array.isArray(r.pilots) ? r.pilots : [])
      .map((p) => String(p?.name ?? '').slice(0, 20).trim())
      .filter(Boolean);
    const count = Math.max(Number(r.count) || 0, pilots.length);
    if (count > 0) out.push({ room: r.room, count, pilots });
  }
  const total = Number.isFinite(Number(data?.total)) ? Number(data.total) : out.reduce((a, r) => a + r.count, 0);
  return { rooms: out, total };
}

// liste satırları: hazır yer ve köy ayrı, özel konumlar tek satırda toplanır
function buildRows(rooms) {
  const rows = [];
  let custom = null;
  for (const r of rooms) {
    const c = classify(r.room);
    if (c.type === 'custom') {
      custom ||= { key: 'custom', type: 'custom', world: null, place: null, count: 0, pilots: [] };
      custom.count += r.count;
      custom.pilots.push(...r.pilots);
      continue;
    }
    rows.push({ key: r.room, ...c, count: r.count, pilots: r.pilots });
  }
  rows.sort((a, b) => b.count - a.count || (a.type === 'village') - (b.type === 'village'));
  if (custom) rows.push(custom);
  return rows;
}

export function createLobby({ el, roomsUrl, onJoin, onUpdate }) {
  const url = httpUrl(roomsUrl);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- iskelet
  el.textContent = '';
  const root = h('div', 'lb');
  const head = h('div', 'lb-head');
  const title = h('h3', 'lb-title');
  const totalBox = h('span', 'lb-total');
  const live = h('i', 'lb-live');
  const totalText = h('span');
  totalBox.append(live, totalText);
  head.append(title, totalBox);
  const body = h('div', 'lb-body');
  const mapBox = h('div', 'lb-map');
  const canvas = h('canvas');
  canvas.setAttribute('role', 'img');
  const tip = h('div', 'lb-tip');
  tip.hidden = true;
  mapBox.append(canvas, tip);
  const side = h('div', 'lb-side');
  const stateBox = h('div', 'lb-state');
  stateBox.setAttribute('aria-live', 'polite');
  const list = h('ul', 'lb-list');
  const moreBtn = h('button', 'lb-more');
  moreBtn.type = 'button';
  side.append(stateBox, list, moreBtn);
  body.append(mapBox, side);
  root.append(head, body);
  el.append(root);
  const ctx = canvas.getContext('2d');

  // ---- durum
  let status = 'loading'; // loading | ok | offline
  let fails = 0;
  let rows = [];
  let total = 0;
  let showAll = false;
  let wide = false;
  let running = false;
  let timer = 0;
  let seq = 0;
  let inflight = null;
  let land = null;
  let base = null; // kara noktaları (önbellek)
  let W = 0;
  let H = 0;
  let dpr = 1;
  let clusters = [];
  let clusterOf = new Map(); // satır anahtarı → küme
  let hot = null; // vurgulanan küme id
  let pinned = null; // dokunarak seçilen küme id
  let raf = 0;
  let lastFrame = 0;
  const rowEls = new Map();

  const css = getComputedStyle(root);
  const ACCENT = css.getPropertyValue('--accent').trim() || '#2f8cff';
  const MONO = css.getPropertyValue('--mono').trim() || 'ui-monospace, Menlo, monospace';

  // ---- harita
  let latS = -58;
  let latN = 84;
  const px = (lon) => ((lon + 180) / 360) * W;
  const py = (lat) => ((latN - lat) / (latN - latS)) * H;

  function buildBase() {
    base = null;
    if (!W || !H) return;
    base = document.createElement('canvas');
    base.width = Math.round(W * dpr);
    base.height = Math.round(H * dpr);
    if (!land) return;
    // kara maskesi CSS çözünürlüğünde, sonra nokta ızgarası
    const m = document.createElement('canvas');
    m.width = Math.ceil(W);
    m.height = Math.ceil(H);
    const c = m.getContext('2d', { willReadFrequently: true });
    const q = land.q || 10;
    c.fillStyle = '#fff';
    c.beginPath();
    for (const ring of land.p) {
      let x = ring[0];
      let y = ring[1];
      c.moveTo(px(x / q), py(y / q));
      for (let i = 2; i < ring.length; i += 2) {
        x += ring[i];
        y += ring[i + 1];
        c.lineTo(px(x / q), py(y / q));
      }
      c.closePath();
    }
    c.fill();
    const data = c.getImageData(0, 0, m.width, m.height).data;
    const s = Math.min(6, Math.max(3.4, W / 120));
    const r = s * 0.3;
    const b = base.getContext('2d');
    b.scale(dpr, dpr);
    b.fillStyle = 'rgba(255, 255, 255, 0.24)';
    b.beginPath();
    for (let y = s / 2; y < H; y += s) {
      for (let x = s / 2; x < W; x += s) {
        if (data[(Math.floor(y) * m.width + Math.floor(x)) * 4 + 3] > 100) {
          b.moveTo(x + r, y);
          b.arc(x, y, r, 0, Math.PI * 2);
        }
      }
    }
    b.fill();
  }

  // yakın odalar tek noktada toplanır (ör. İstanbul'daki iki yer, aynı yerde osm + google)
  function layout() {
    const rad = (n) => Math.min(15, 6.5 + 2.2 * Math.sqrt(n - 1));
    clusters = [];
    clusterOf = new Map();
    for (const row of rows) {
      if (row.type !== 'preset') continue;
      const x = px(row.place.lon);
      const y = py(row.place.lat);
      let c = clusters.find((k) => Math.hypot(k.x - x, k.y - y) < Math.max(14, k.r + rad(row.count) + 2));
      if (!c) {
        c = { id: row.key, x, y, count: 0, r: 0, rows: [], phase: clusters.length * 0.37 };
        clusters.push(c);
      }
      c.count += row.count;
      c.r = rad(c.count);
      c.rows.push(row);
      clusterOf.set(row.key, c);
    }
    if (hot && !clusters.some((c) => c.id === hot)) hot = null;
    if (pinned && !clusters.some((c) => c.id === pinned)) pinned = null;
  }

  function draw(now = performance.now()) {
    if (!W || !H) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (base) ctx.drawImage(base, 0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const c of clusters) {
      const on = c.id === hot;
      ctx.fillStyle = ACCENT;
      if (!reduceMotion) {
        // nabız halkası
        const k = (now / 2200 + c.phase) % 1;
        ctx.globalAlpha = 0.5 * (1 - k);
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r + 2 + k * 12, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = on ? 0.32 : 0.18;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r + (on ? 7 : 4), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fill();
      if (on) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.fillStyle = '#fff';
      ctx.font = `600 ${c.count > 9 ? 10 : 11}px ${MONO}`;
      ctx.fillText(String(c.count), c.x, c.y + 0.5);
    }
  }

  // nabız için hafif döngü (~30 fps), yalnız açıkken ve nokta varken
  function loop(now) {
    raf = 0;
    if (!running || !clusters.length || reduceMotion || document.visibilityState !== 'visible') return draw();
    if (now - lastFrame > 33) {
      lastFrame = now;
      draw(now);
    }
    raf = requestAnimationFrame(loop);
  }
  function kick() {
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function resize() {
    const wd = root.clientWidth >= WIDE;
    if (wd !== wide) {
      wide = wd;
      render();
    }
    const w = mapBox.clientWidth;
    const hh = mapBox.clientHeight;
    const d = Math.min(2, window.devicePixelRatio || 1);
    if (!w || !hh || (w === W && hh === H && d === dpr && base)) return;
    W = w;
    H = hh;
    dpr = d;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    buildBase();
    layout();
    draw();
    kick();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(mapBox);

  loadLand().then((d) => {
    if (!d) return;
    land = d;
    if (Array.isArray(d.lat)) [latS, latN] = d.lat;
    mapBox.style.aspectRatio = `360 / ${latN - latS}`;
    base = null;
    W = 0; // yeniden ölç
    resize();
  });

  // ---- vurgu: harita noktası ↔ liste satırı
  function setHot(id) {
    if (id === hot) return;
    hot = id;
    for (const [key, li] of rowEls) li.classList.toggle('is-hot', !!id && clusterOf.get(key)?.id === id);
    showTip();
    draw();
  }

  function showTip() {
    const c = clusters.find((k) => k.id === hot);
    if (!c) {
      tip.hidden = true;
      return;
    }
    const T = tx();
    tip.textContent = '';
    for (const row of c.rows) {
      const line = h('div', 'lb-tip-row');
      const tag = row.arena ? `${t('modeArena')} · ` : '';
      line.append(h('b', null, placeLabel(row.place)), h('span', null, `${tag}${T[row.world]} · ${T.pilots(row.count)}`));
      tip.append(line);
    }
    tip.hidden = false;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let top = c.y - c.r - 10 - th;
    if (top < 4) top = c.y + c.r + 10;
    tip.style.left = `${Math.max(4, Math.min(W - tw - 4, c.x - tw / 2))}px`;
    tip.style.top = `${Math.min(top, H - th - 4)}px`;
  }

  function hit(e) {
    const b = canvas.getBoundingClientRect();
    const x = e.clientX - b.left;
    const y = e.clientY - b.top;
    const pad = e.pointerType === 'mouse' ? 4 : 12;
    let best = null;
    let bd = Infinity;
    for (const c of clusters) {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d <= c.r + pad && d < bd) {
        best = c;
        bd = d;
      }
    }
    return best;
  }

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const c = hit(e);
    canvas.style.cursor = c ? 'pointer' : '';
    setHot(c ? c.id : pinned);
  });
  canvas.addEventListener('pointerleave', () => setHot(pinned));
  canvas.addEventListener('click', (e) => {
    const c = hit(e);
    pinned = c && c.id !== pinned ? c.id : null;
    setHot(pinned);
    if (pinned) {
      const li = rowEls.get(c.rows[0].key);
      if (li && li.isConnected) li.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  });

  // ---- liste
  function rowEl(row) {
    let li = rowEls.get(row.key);
    if (!li) {
      li = h('li', 'lb-row');
      const mark = h('i', 'lb-mark');
      const main = h('div', 'lb-main');
      main.append(h('b', 'lb-place'), h('span', 'lb-meta'));
      const count = h('span', 'lb-count');
      li.append(mark, main, count);
      if (row.type !== 'custom') {
        const btn = h('button', 'lb-join');
        btn.type = 'button';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const r = li._row;
          onJoin?.({ world: r.world, place: r.type === 'preset' ? r.place : null, arena: !!r.arena });
        });
        li.append(btn);
      }
      li.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'mouse') setHot(clusterOf.get(li._row.key)?.id ?? pinned);
      });
      li.addEventListener('pointerleave', (e) => {
        if (e.pointerType === 'mouse') setHot(pinned);
      });
      li.addEventListener('click', () => {
        const c = clusterOf.get(li._row.key);
        if (!c) return;
        pinned = pinned === c.id ? null : c.id;
        setHot(pinned);
      });
      rowEls.set(row.key, li);
    }
    li._row = row;
    const T = tx();
    li.className = `lb-row is-${row.type}${row.arena ? ' is-arena' : ''}`;
    li.classList.toggle('is-hot', !!hot && clusterOf.get(row.key)?.id === hot);
    const place = row.type === 'preset' ? placeLabel(row.place) : T[row.type];
    const names = row.pilots.slice(0, MAX_NAMES).join(', ');
    const extra = row.count - Math.min(MAX_NAMES, row.pilots.length);
    const who = names + (extra > 0 ? ` +${extra}` : '');
    li.querySelector('.lb-place').textContent = place;
    const meta = li.querySelector('.lb-meta');
    const tags = [row.arena ? t('modeArena') : '', row.type === 'preset' ? T[row.world] : ''].filter(Boolean);
    meta.textContent = [...tags, who].filter(Boolean).join(' · ');
    meta.title = row.pilots.join(', ');
    const cnt = li.querySelector('.lb-count');
    cnt.textContent = String(row.count);
    cnt.title = T.pilots(row.count);
    const btn = li.querySelector('.lb-join');
    if (btn) {
      btn.textContent = T.join;
      btn.setAttribute('aria-label', T.joinAria(place));
    }
    return li;
  }

  function render() {
    const T = tx();
    title.textContent = T.title;
    canvas.setAttribute('aria-label', T.map);
    totalBox.hidden = status !== 'ok';
    live.classList.toggle('on', status === 'ok' && total > 0);
    totalText.textContent = T.total(total);

    stateBox.textContent = '';
    stateBox.className = `lb-state is-${status}`;
    if (status === 'loading') stateBox.append(h('p', null, T.loading));
    else if (status === 'offline') stateBox.append(h('p', null, T.offline));
    else if (!rows.length) stateBox.append(h('p', null, T.empty), h('p', 'lb-hint', T.emptyHint));
    stateBox.hidden = !stateBox.childNodes.length;

    const max = wide ? MAX_ROWS.wide : MAX_ROWS.narrow;
    const visible = showAll || rows.length <= max + 1 ? rows : rows.slice(0, max);
    const keep = new Set(visible.map((r) => r.key));
    for (const [key, li] of rowEls) {
      if (!keep.has(key)) {
        li.remove();
        if (!rows.some((r) => r.key === key)) rowEls.delete(key);
      }
    }
    // yalnız yeri değişen satır taşınır (odak kaybolmasın)
    visible.forEach((row, i) => {
      const li = rowEl(row);
      if (list.children[i] !== li) list.insertBefore(li, list.children[i] || null);
    });
    list.hidden = !visible.length;
    const hiddenCount = rows.length - visible.length;
    moreBtn.hidden = rows.length <= max + 1;
    moreBtn.textContent = hiddenCount > 0 ? T.all(rows.length) : T.less;

    showTip(); // vurgulanan küme kaybolduysa ipucunu da gizler
  }

  moreBtn.addEventListener('click', () => {
    showAll = !showAll;
    render();
  });

  function apply(data) {
    const parsed = parse(data);
    rows = buildRows(parsed.rooms);
    total = parsed.total;
    onUpdate?.(total);
    status = 'ok';
    fails = 0;
    layout();
    render();
    draw();
    kick();
  }

  async function refresh() {
    const my = ++seq;
    inflight?.abort();
    const ac = new AbortController();
    inflight = ac;
    const to = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      if (!url) throw new Error('adres yok');
      const r = await fetch(url, { cache: 'no-store', signal: ac.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (my === seq) apply(data);
    } catch {
      if (my !== seq) return;
      fails++;
      // veri varken tek hata yanıp sönmesin: ikinci hatada çevrimdışı
      if (status !== 'ok' || fails >= 2) {
        status = 'offline';
        rows = [];
        total = 0;
        layout();
        render();
        draw();
      }
    } finally {
      clearTimeout(to);
      if (inflight === ac) inflight = null;
    }
  }

  async function tick() {
    if (!running) return;
    if (document.visibilityState === 'visible') await refresh();
    clearTimeout(timer);
    if (running) timer = setTimeout(tick, POLL_MS);
  }

  function onVisible() {
    if (!running || document.visibilityState !== 'visible') return;
    clearTimeout(timer);
    tick();
    kick();
  }

  function start() {
    if (running) return;
    running = true;
    document.addEventListener('visibilitychange', onVisible);
    resize();
    tick();
    kick();
  }

  function stop() {
    running = false;
    clearTimeout(timer);
    inflight?.abort();
    inflight = null;
    seq++;
    document.removeEventListener('visibilitychange', onVisible);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function setLang() {
    render();
  }

  render();
  return { refresh, start, stop, setLang };
}
