// Kumanda test ve ayar ekranı: canlı çubuklar, kalibrasyon sihirbazı, eksen ayarı, mod hızları, gamepad eşlemesi.
// Kullanım: const rcSetup = createRcSetup({ rc, settings, save, onChange }); rcSetup.open();
// onChange(tür): 'invert' | 'axes' | 'rcCal' | 'modeMul' | 'gamepadPreset' (ayar değişip kaydedilince)
import { AXES, STICK_OF, AXIS_KEYS, axisConf, shape, rcAxes, shapeAll } from './input.js';
import { PRESETS, pickPreset, padName } from './gamepad.js';
import { DRONES, MODES, modeSpec } from './flight.js';
import { rcDefaults } from './settings.js';
import { lang, t } from './i18n.js';

const TEXT = {
  en: {
    title: 'Controller: test and tuning',
    close: 'Close',
    tabs: { test: 'Test', cal: 'Calibrate', tune: 'Tune', pad: 'Gamepad' },
    keyboard: 'Keyboard',
    touch: 'On-screen sticks',
    notLive: 'No controller · keyboard only',
    left: 'Left stick',
    right: 'Right stick',
    wheel: 'Wheel',
    legendRaw: 'raw',
    legendOut: 'output',
    axes: { thr: 'Throttle', yaw: 'Yaw', pitch: 'Pitch', roll: 'Roll', gimbal: 'Gimbal' },
    axesTitle: 'Axes',
    raw: 'Raw',
    out: 'Output',
    buttons: 'Buttons',
    noButtons: 'No buttons mapped on this controller',
    btn: { photo: 'Photo', camera: 'Record', fn: 'Fn', rth: 'RTH', takeoff: 'Takeoff', land: 'Land', view: 'View', modeUp: 'Mode +', modeDown: 'Mode −' },
    mode: 'Flight mode',
    kbTitle: 'Keyboard',
    kbHint: 'W S throttle · A D yaw · arrows pitch and roll · R F gimbal',
    calIntro: 'Fixes a stick that does not rest at zero or does not reach its ends. Stored for this controller only.',
    calNone: 'Connect a controller to calibrate it. The keyboard needs no calibration.',
    calTouch: 'On-screen sticks need no calibration.',
    calDone: (d) => `Calibrated · ${d}`,
    calFactory: 'Factory values',
    calStart: 'Start calibration',
    calReset: 'Reset to default',
    step: (n) => `Step ${n} of 2`,
    step1: 'Let go of the sticks',
    step1Hint: 'Leave both sticks and the wheel at rest, then record the centre.',
    record: 'Record centre',
    recording: 'Hold still…',
    step2: 'Move both sticks and the wheel to all ends',
    step2Hint: 'Circle each stick along its edge two or three times and roll the wheel fully both ways.',
    optional: 'optional',
    save: 'Save',
    restart: 'Start over',
    cancel: 'Cancel',
    saved: 'Calibration saved',
    lost: 'Controller changed · calibration cancelled',
    invert: 'Invert',
    deadzone: 'Deadzone',
    expo: 'Expo',
    rate: 'Rate',
    expoGlobal: 'Follows the general expo setting',
    stickOf: { lv: 'Left ↕', lh: 'Left ↔', rv: 'Right ↕', rh: 'Right ↔', wheel: 'Wheel' },
    resetAxes: 'Reset axes',
    speeds: 'Flight mode speeds',
    speedsHint: 'Multiplies the factory speeds of the selected aircraft in each mode.',
    speedsPlane: 'Mode speeds apply to drones; the selected aircraft is a plane.',
    acroNote: 'Manual mode uses its own rates.',
    h: 'Horizontal',
    v: 'Vertical',
    ys: 'Yaw',
    resetSpeeds: 'Reset speeds',
    padName: 'Device',
    mapping: 'Mapping',
    auto: (p) => `Automatic · ${p}`,
    padHint: 'For a radio in joystick mode, pick its channel order if the sticks move the wrong axes.',
    rawAxes: 'Raw axes',
    pressed: 'Pressed buttons',
    unmapped: 'not used',
  },
  tr: {
    title: 'Kumanda: test ve ayar',
    close: 'Kapat',
    tabs: { test: 'Test', cal: 'Kalibrasyon', tune: 'Ayar', pad: 'Gamepad' },
    keyboard: 'Klavye',
    touch: 'Ekran çubukları',
    notLive: 'Kumanda yok · yalnız klavye',
    left: 'Sol çubuk',
    right: 'Sağ çubuk',
    wheel: 'Teker',
    legendRaw: 'ham',
    legendOut: 'çıkış',
    axes: { thr: 'Gaz', yaw: 'Dönüş', pitch: 'İleri/geri', roll: 'Yan', gimbal: 'Gimbal' },
    axesTitle: 'Eksenler',
    raw: 'Ham',
    out: 'Çıkış',
    buttons: 'Tuşlar',
    noButtons: 'Bu kumandada eşlenmiş tuş yok',
    btn: { photo: 'Fotoğraf', camera: 'Video', fn: 'Fn', rth: 'Eve dön', takeoff: 'Kalkış', land: 'İniş', view: 'Görünüm', modeUp: 'Mod +', modeDown: 'Mod −' },
    mode: 'Uçuş modu',
    kbTitle: 'Klavye',
    kbHint: 'W S gaz · A D dönüş · oklar ileri/geri ve yan · R F gimbal',
    calIntro: 'Sıfırda durmayan ya da uca kadar gitmeyen çubuğu düzeltir. Yalnız bu kumanda için saklanır.',
    calNone: 'Kalibrasyon için bir kumanda bağla. Klavyenin kalibrasyonu yoktur.',
    calTouch: 'Ekran çubuklarının kalibrasyonu yoktur.',
    calDone: (d) => `Kalibre edildi · ${d}`,
    calFactory: 'Fabrika değerleri',
    calStart: 'Kalibrasyonu başlat',
    calReset: 'Varsayılana dön',
    step: (n) => `Adım ${n} / 2`,
    step1: 'Çubukları bırak',
    step1Hint: 'İki çubuğu ve tekeri serbest bırak, sonra merkezi kaydet.',
    record: 'Merkezi kaydet',
    recording: 'Kıpırdatma…',
    step2: 'İki çubuğu ve tekeri tüm uçlara götür',
    step2Hint: 'Her çubuğu kenarı boyunca iki üç tur çevir, tekeri iki yöne sonuna kadar çevir.',
    optional: 'isteğe bağlı',
    save: 'Kaydet',
    restart: 'Baştan',
    cancel: 'Vazgeç',
    saved: 'Kalibrasyon kaydedildi',
    lost: 'Kumanda değişti · kalibrasyon iptal',
    invert: 'Ters çevir',
    deadzone: 'Ölü bölge',
    expo: 'Expo',
    rate: 'Hassasiyet',
    expoGlobal: 'Genel expo ayarını izliyor',
    stickOf: { lv: 'Sol ↕', lh: 'Sol ↔', rv: 'Sağ ↕', rh: 'Sağ ↔', wheel: 'Teker' },
    resetAxes: 'Eksenleri sıfırla',
    speeds: 'Uçuş modu hızları',
    speedsHint: 'Seçili aracın her moddaki fabrika hızlarını çarpar.',
    speedsPlane: 'Mod hızları dronlar için; seçili araç bir uçak.',
    acroNote: 'Manuel mod kendi oranlarını kullanır.',
    h: 'Yatay',
    v: 'Dikey',
    ys: 'Dönüş',
    resetSpeeds: 'Hızları sıfırla',
    padName: 'Cihaz',
    mapping: 'Eşleme',
    auto: (p) => `Otomatik · ${p}`,
    padHint: 'Joystick modundaki RC vericide çubuklar yanlış ekseni oynatıyorsa kanal sırasını seç.',
    rawAxes: 'Ham eksenler',
    pressed: 'Basılı tuşlar',
    unmapped: 'kullanılmıyor',
  },
  de: {
    title: 'Fernsteuerung: Test und Einstellung',
    close: 'Schließen',
    tabs: { test: 'Test', cal: 'Kalibrieren', tune: 'Einstellen', pad: 'Gamepad' },
    keyboard: 'Tastatur',
    touch: 'Bildschirm-Sticks',
    notLive: 'Keine Fernsteuerung · nur Tastatur',
    left: 'Linker Stick',
    right: 'Rechter Stick',
    wheel: 'Rad',
    legendRaw: 'roh',
    legendOut: 'Ausgabe',
    axes: { thr: 'Gas', yaw: 'Gieren', pitch: 'Nicken', roll: 'Rollen', gimbal: 'Gimbal' },
    axesTitle: 'Achsen',
    raw: 'Roh',
    out: 'Ausgabe',
    buttons: 'Tasten',
    noButtons: 'Keine Tasten belegt',
    btn: { photo: 'Foto', camera: 'Video', fn: 'Fn', rth: 'RTH', takeoff: 'Start', land: 'Landen', view: 'Ansicht', modeUp: 'Modus +', modeDown: 'Modus −' },
    mode: 'Flugmodus',
    kbTitle: 'Tastatur',
    kbHint: 'W S Gas · A D Gieren · Pfeile Nicken und Rollen · R F Gimbal',
    calIntro: 'Korrigiert einen Stick, der nicht bei null ruht oder seine Enden nicht erreicht. Gilt nur für diese Fernsteuerung.',
    calNone: 'Verbinde eine Fernsteuerung, um sie zu kalibrieren. Die Tastatur braucht keine Kalibrierung.',
    calTouch: 'Bildschirm-Sticks brauchen keine Kalibrierung.',
    calDone: (d) => `Kalibriert · ${d}`,
    calFactory: 'Werkseinstellung',
    calStart: 'Kalibrierung starten',
    calReset: 'Zurücksetzen',
    step: (n) => `Schritt ${n} von 2`,
    step1: 'Sticks loslassen',
    step1Hint: 'Beide Sticks und das Rad in Ruhe lassen, dann die Mitte speichern.',
    record: 'Mitte speichern',
    recording: 'Nicht bewegen …',
    step2: 'Beide Sticks und das Rad an alle Enden bewegen',
    step2Hint: 'Jeden Stick zwei-, dreimal am Rand entlang kreisen und das Rad ganz in beide Richtungen drehen.',
    optional: 'optional',
    save: 'Speichern',
    restart: 'Neu beginnen',
    cancel: 'Abbrechen',
    saved: 'Kalibrierung gespeichert',
    lost: 'Fernsteuerung gewechselt · Kalibrierung abgebrochen',
    invert: 'Umkehren',
    deadzone: 'Totzone',
    expo: 'Expo',
    rate: 'Empfindlichkeit',
    expoGlobal: 'Folgt der allgemeinen Expo-Einstellung',
    stickOf: { lv: 'Links ↕', lh: 'Links ↔', rv: 'Rechts ↕', rh: 'Rechts ↔', wheel: 'Rad' },
    resetAxes: 'Achsen zurücksetzen',
    speeds: 'Geschwindigkeit je Flugmodus',
    speedsHint: 'Multipliziert die Werksgeschwindigkeiten des gewählten Fluggeräts je Modus.',
    speedsPlane: 'Gilt für Drohnen; gewählt ist ein Flugzeug.',
    acroNote: 'Der manuelle Modus nutzt eigene Raten.',
    h: 'Horizontal',
    v: 'Vertikal',
    ys: 'Gieren',
    resetSpeeds: 'Geschwindigkeiten zurücksetzen',
    padName: 'Gerät',
    mapping: 'Belegung',
    auto: (p) => `Automatisch · ${p}`,
    padHint: 'Bei einem Sender im Joystick-Modus die Kanalreihenfolge wählen, wenn die Sticks die falschen Achsen bewegen.',
    rawAxes: 'Rohachsen',
    pressed: 'Gedrückte Tasten',
    unmapped: 'nicht belegt',
  },
};
const tx = () => TEXT[lang()] || TEXT.en;

const STICKS = ['lh', 'lv', 'rh', 'rv', 'wheel'];
const AXIS_OF = Object.fromEntries(Object.entries(STICK_OF).map(([a, k]) => [k, a]));
const ZERO = { thr: 0, yaw: 0, pitch: 0, roll: 0, gimbal: 0 };
// kaynağa göre gösterilecek tuşlar (gamepad: etkin hazır ayarın eşlemesi)
const SOURCE_BUTTONS = { bridge: ['photo', 'camera', 'fn', 'rth'], serial: ['photo', 'camera', 'fn', 'rth'], touch: ['takeoff', 'land', 'rth', 'view'] };
const TRAIL = 36;
const CAL_REACH = 0.6; // merkezden her iki uca en az bu kadar
const CAL_SPAN = 1.4; // yaysız eksen (RC gazı): toplam aralık

const fmt = (v) => (v < 0 ? '−' : '+') + Math.abs(v).toFixed(2);
const r3 = (v) => Math.round(v * 1000) / 1000;

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// canvas'ı CSS boyutuna ve piksel oranına uydur; çizim bağlamı + boyut
function fit(cv) {
  const w = cv.clientWidth;
  const ht = cv.clientHeight;
  if (!w || !ht) return null;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = Math.round(w * dpr);
  const H = Math.round(ht * dpr);
  if (cv.width !== W || cv.height !== H) {
    cv.width = W;
    cv.height = H;
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, ht);
  return { ctx, w, h: ht };
}

export function createRcSetup({ rc, settings, save, onChange }) {
  const root = h('div', 'rcs');
  root.hidden = true;
  document.body.append(root);
  // kayıtlı gamepad eşlemesi baştan uygulanır
  if (settings.gamepadPreset) rc.setGamepadPreset?.(settings.gamepadPreset);

  let isOpen = false;
  let tab = 'test';
  let raf = 0;
  let last = 0;
  let refs = {};
  let accent = '#2f8cff';
  let calNote = ''; // sihirbaz sonrası kısa not: '' | 'saved' | 'lost'
  let cal = null; // { step: 1 | 'rec' | 2, src, t0, n, sum, c, min, max }
  let btnKey = '';
  let padKey = '';
  const kbDown = new Set();
  const kb = { ...ZERO };
  const trails = { L: [], R: [] };

  const commit = (kind) => {
    save();
    onChange?.(kind);
  };
  const srcNow = () => (rc.live ? rc.source || 'bridge' : 'none');
  const srcName = (src) =>
    ({ bridge: 'DJI RC-N3', serial: 'DJI RC-N3 (USB)', touch: tx().touch, none: tx().keyboard })[src] || rc.sourceName || src;

  // ---- klavye: açıkken uçuş kısayolları çalışmaz; eksen tuşları testte gösterilir
  function onKey(e) {
    if (!isOpen) return;
    const a = AXIS_KEYS[e.code];
    if (e.type === 'keyup') {
      if (a) kbDown.delete(a);
      return; // keyup geçer: Input'ta takılı tuş kalmasın
    }
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (a && !e.target.closest?.('input, select, textarea')) {
      kbDown.add(a);
      e.preventDefault();
    }
  }
  addEventListener('keydown', onKey, true);
  addEventListener('keyup', onKey, true);
  addEventListener('blur', () => kbDown.clear());

  function stepKb(dt) {
    const k = Math.min(1, dt * 5);
    const d = kbDown;
    const tt = (a, b) => (d.has(a) ? 1 : 0) - (d.has(b) ? 1 : 0);
    kb.thr += (tt('thrUp', 'thrDown') - kb.thr) * k;
    kb.yaw += (tt('yawR', 'yawL') - kb.yaw) * k;
    kb.pitch += (tt('fwd', 'back') - kb.pitch) * k;
    kb.roll += (tt('right', 'left') - kb.roll) * k;
    kb.gimbal = tt('gUp', 'gDown');
  }

  // o anki ham çubuklar, kalibre+ters eksenler, şekillendirilmiş çıkış
  function sample() {
    const src = srcNow();
    const raw = src === 'none' ? null : { ...rc.sticks };
    const rcv = raw ? rcAxes(raw, settings, src) : ZERO;
    const pre = {};
    for (const ax of AXES) pre[ax] = Math.abs(rcv[ax]) > Math.abs(kb[ax]) ? rcv[ax] : kb[ax];
    return { src, raw, rcv, pre, out: shapeAll(rcv, kb, settings) };
  }

  // ---- iskelet
  function build() {
    const T = tx();
    root.textContent = '';
    refs = { tabs: {}, panes: {} };
    accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2f8cff';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'rcsTitle');

    const back = h('div', 'rcs-back');
    back.onclick = close;
    const sheet = h('section', 'rcs-sheet');
    sheet.tabIndex = -1;
    refs.sheet = sheet;

    const head = h('header', 'rcs-head');
    const title = h('h3', null, T.title);
    title.id = 'rcsTitle';
    const src = h('span', 'rcs-src');
    refs.live = h('i', 'rcs-live');
    refs.srcName = h('span');
    src.append(refs.live, refs.srcName);
    const x = h('button', 'rcs-close');
    x.type = 'button';
    x.setAttribute('aria-label', T.close);
    x.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    x.onclick = close;
    head.append(title, src, x);

    const nav = h('nav', 'rcs-tabs');
    nav.setAttribute('role', 'tablist');
    for (const id of ['test', 'cal', 'tune', 'pad']) {
      const b = h('button', null, T.tabs[id]);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.onclick = () => setTab(id);
      refs.tabs[id] = b;
      nav.append(b);
    }

    const body = h('div', 'rcs-body');
    refs.body = body;
    refs.panes.test = buildTest(T);
    refs.panes.cal = buildCal(T);
    refs.panes.tune = buildTune(T);
    refs.panes.pad = buildPad(T);
    for (const p of Object.values(refs.panes)) {
      p.setAttribute('role', 'tabpanel');
      body.append(p);
    }

    sheet.append(head, nav, body);
    root.append(back, sheet);
    btnKey = padKey = '';
    setTab(tab);
    renderCal();
    syncTune();
  }

  function section(cls, title) {
    const s = h('div', `rcs-sec ${cls || ''}`);
    if (title) s.append(h('h4', null, title));
    return s;
  }

  function stickBox(label, sub) {
    const col = h('div', 'rcs-stick');
    const cv = h('canvas');
    cv.setAttribute('aria-hidden', 'true');
    const cap = h('p');
    cap.append(h('b', null, label), h('span', null, sub));
    col.append(cv, cap);
    return { col, cv };
  }

  function wheelBox(label) {
    const col = h('div', 'rcs-wheelcol');
    const w = h('div', 'rcs-wheel');
    const range = h('span', 'rcs-wrange');
    const raw = h('i', 'raw');
    const out = h('i', 'out');
    w.append(range, raw, out);
    col.append(w, h('p', null, label));
    return { col, range, raw, out };
  }

  // ---- Test
  function buildTest(T) {
    const pane = h('div', 'rcs-pane rcs-test');
    const left = h('div', 'rcs-test-sticks');
    const row = h('div', 'rcs-sticks');
    const L = stickBox(T.left, `${T.axes.thr} · ${T.axes.yaw}`);
    const W = wheelBox(T.wheel);
    const R = stickBox(T.right, `${T.axes.pitch} · ${T.axes.roll}`);
    row.append(L.col, W.col, R.col);
    const legend = h('p', 'rcs-legend');
    legend.append(h('i', 'ring'), h('span', null, T.legendRaw), h('i', 'dot'), h('span', null, T.legendOut));
    left.append(row, legend);
    refs.tL = L.cv;
    refs.tR = R.cv;
    refs.tW = W;

    const right = h('div', 'rcs-test-data');
    const axSec = section('', null);
    const tbl = h('div', 'rcs-table');
    const hd = h('div', 'rcs-tr rcs-th');
    hd.append(h('span', null, T.axesTitle), h('span', 'num', T.raw), h('span'), h('span', 'num', T.out));
    tbl.append(hd);
    refs.rows = {};
    for (const ax of AXES) {
      const r = h('div', 'rcs-tr');
      const name = h('span', 'rcs-axname');
      name.append(h('b', null, T.axes[ax]), h('small', null, STICK_OF[ax]));
      const raw = h('span', 'num');
      const bar = h('span', 'rcs-bar');
      const fill = h('i', 'fill');
      const tick = h('i', 'tick');
      bar.append(fill, tick);
      const out = h('span', 'num strong');
      r.append(name, raw, bar, out);
      tbl.append(r);
      refs.rows[ax] = { raw, fill, tick, out };
    }
    axSec.append(tbl);

    const btnSec = section('', T.buttons);
    refs.btnList = h('div', 'rcs-btns');
    btnSec.append(refs.btnList);

    const modeSec = section('rcs-modesec', T.mode);
    const modes = h('div', 'rcs-mode');
    refs.modeEls = {};
    for (const m of ['C', 'N', 'S']) {
      const e = h('span', null, m);
      refs.modeEls[m] = e;
      modes.append(e);
    }
    modeSec.append(modes);

    const kbSec = section('rcs-kb', T.kbTitle);
    kbSec.append(h('p', 'rcs-hint', T.kbHint));

    right.append(axSec, btnSec, modeSec, kbSec);
    pane.append(left, right);
    return pane;
  }

  function buttonNames(src) {
    if (src === 'gamepad') {
      const p = PRESETS[rc.gamepad?.activePreset] || null;
      return p ? [...new Set(Object.values(p.buttons))] : [];
    }
    return SOURCE_BUTTONS[src] || [];
  }

  function drawTest(s) {
    const T = tx();
    const { raw, out } = s;
    // sol: x = dönüş, y = gaz; sağ: x = yan, y = ileri/geri
    const pts = { L: [out.yaw, out.thr], R: [out.roll, out.pitch] };
    for (const k of ['L', 'R']) {
      const tr = trails[k];
      tr.push(pts[k]);
      if (tr.length > TRAIL) tr.shift();
    }
    const dz = (ax) => axisConf(settings, ax).deadzone;
    drawStick(refs.tL, {
      x: out.yaw,
      y: out.thr,
      raw: raw && [raw.lh, raw.lv],
      dz: [dz('yaw'), dz('thr')],
      trail: trails.L,
    });
    drawStick(refs.tR, {
      x: out.roll,
      y: out.pitch,
      raw: raw && [raw.rh, raw.rv],
      dz: [dz('roll'), dz('pitch')],
      trail: trails.R,
    });
    setWheel(refs.tW, out.gimbal, raw ? raw.wheel : null, null);

    for (const ax of AXES) {
      const r = refs.rows[ax];
      const rv = raw ? raw[STICK_OF[ax]] : null;
      r.raw.textContent = rv == null ? '—' : fmt(rv);
      r.out.textContent = fmt(out[ax]);
      setBar(r.fill, out[ax]);
      r.tick.hidden = rv == null;
      if (rv != null) r.tick.style.left = `${50 + Math.max(-1, Math.min(1, rv)) * 50}%`;
    }

    // tuşlar: kaynak ya da eşleme değişince yeniden kur
    const names = buttonNames(s.src);
    const key = `${s.src}|${names.join(',')}|${lang()}`;
    if (key !== btnKey) {
      btnKey = key;
      refs.btnList.textContent = '';
      refs.btnEls = {};
      if (!names.length) refs.btnList.append(h('p', 'rcs-hint', s.src === 'none' ? T.notLive : T.noButtons));
      for (const n of names) {
        const e = h('span', 'rcs-btn');
        e.append(h('i'), h('span', null, T.btn[n] || n));
        refs.btnEls[n] = e;
        refs.btnList.append(e);
      }
    }
    for (const [n, e] of Object.entries(refs.btnEls)) e.classList.toggle('on', !!rc.buttons?.[n]);

    const m = rc.switchMode || settings.mode;
    for (const [k, e] of Object.entries(refs.modeEls)) e.classList.toggle('on', k === m);
  }

  // çubuk kutusu: ızgara, ölü bölge, iz, ham halka, çıkış noktası (ya da kalibrasyon aralığı)
  function drawStick(cv, o) {
    const f = fit(cv);
    if (!f) return;
    const { ctx, w, h: H } = f;
    const pad = 12;
    const cx = w / 2;
    const cy = H / 2;
    const sx = w / 2 - pad;
    const sy = H / 2 - pad;
    const X = (v) => cx + Math.max(-1, Math.min(1, v)) * sx;
    const Y = (v) => cy - Math.max(-1, Math.min(1, v)) * sy;

    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + 0.5, pad - 4);
    ctx.lineTo(cx + 0.5, H - pad + 4);
    ctx.moveTo(pad - 4, cy + 0.5);
    ctx.lineTo(w - pad + 4, cy + 0.5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, sx, sy, 0, 0, Math.PI * 2);
    ctx.stroke();

    if (o.dz) {
      ctx.fillStyle = 'rgba(47,140,255,0.12)';
      const dx = o.dz[0] * sx;
      const dy = o.dz[1] * sy;
      ctx.fillRect(cx - dx, cy - dy, dx * 2, dy * 2);
    }
    if (o.range) {
      const r = o.range;
      ctx.fillStyle = 'rgba(47,140,255,0.08)';
      ctx.strokeStyle = 'rgba(47,140,255,0.6)';
      ctx.setLineDash([4, 3]);
      const x0 = X(r.x0);
      const y0 = Y(r.y1);
      ctx.fillRect(x0, y0, X(r.x1) - x0, Y(r.y0) - y0);
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, X(r.x1) - x0 - 1, Y(r.y0) - y0 - 1);
      ctx.setLineDash([]);
    }
    if (o.center) {
      ctx.strokeStyle = 'rgba(60,207,110,0.9)';
      ctx.lineWidth = 1.5;
      const px = X(o.center[0]);
      const py = Y(o.center[1]);
      ctx.beginPath();
      ctx.moveTo(px - 5, py);
      ctx.lineTo(px + 5, py);
      ctx.moveTo(px, py - 5);
      ctx.lineTo(px, py + 5);
      ctx.stroke();
    }
    const tr = o.trail;
    if (tr && tr.length > 1) {
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      for (let i = 1; i < tr.length; i++) {
        ctx.strokeStyle = `rgba(47,140,255,${((i / tr.length) * 0.55).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(X(tr[i - 1][0]), Y(tr[i - 1][1]));
        ctx.lineTo(X(tr[i][0]), Y(tr[i][1]));
        ctx.stroke();
      }
    }
    if (o.raw) {
      ctx.strokeStyle = 'rgba(244,246,248,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(X(o.raw[0]), Y(o.raw[1]), 7.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (o.x != null) {
      ctx.fillStyle = accent;
      ctx.shadowColor = 'rgba(47,140,255,0.8)';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(X(o.x), Y(o.y), 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // teker: çıkış noktası, ham çizgi, istenirse yakalanan aralık
  function setWheel(W, out, raw, range) {
    // uçlarda nokta taşmasın: 6 px iç boşluk
    const f = (v) => (1 - Math.max(-1, Math.min(1, v))) / 2;
    const pos = (v) => `calc(6px + ${f(v).toFixed(4)} * (100% - 12px))`;
    W.out.hidden = out == null;
    if (out != null) W.out.style.top = pos(out);
    W.raw.hidden = raw == null;
    if (raw != null) W.raw.style.top = pos(raw);
    W.range.hidden = !range;
    if (range) {
      W.range.style.top = pos(range[1]);
      W.range.style.bottom = `calc(6px + ${(1 - f(range[0])).toFixed(4)} * (100% - 12px))`;
    }
  }

  // ortadan dolan çubuk
  function setBar(fill, v) {
    const c = Math.max(-1, Math.min(1, v));
    fill.style.left = `${50 + Math.min(0, c) * 50}%`;
    fill.style.width = `${Math.abs(c) * 50}%`;
  }

  // ---- Kalibrasyon
  function buildCal(T) {
    const pane = h('div', 'rcs-pane rcs-cal');
    const info = h('div', 'rcs-cal-info');
    refs.calMsg = h('p', 'rcs-hint');
    refs.calState = h('p', 'rcs-cal-state');
    info.append(h('p', 'rcs-lead', T.calIntro), refs.calState, refs.calMsg);

    const wiz = h('div', 'rcs-wiz');
    refs.calStep = h('p', 'rcs-stepno');
    refs.calTitle = h('h4', 'rcs-wiz-title');
    refs.calHint = h('p', 'rcs-hint');
    const prog = h('div', 'rcs-prog');
    refs.calProg = h('i');
    prog.append(refs.calProg);
    refs.calProgBox = prog;
    wiz.append(refs.calStep, refs.calTitle, refs.calHint, prog);
    refs.wiz = wiz;

    const live = h('div', 'rcs-cal-live');
    const row = h('div', 'rcs-sticks small');
    const L = stickBox(T.left, `${STICK_OF.yaw} · ${STICK_OF.thr}`);
    const W = wheelBox(T.wheel);
    const R = stickBox(T.right, `${STICK_OF.roll} · ${STICK_OF.pitch}`);
    row.append(L.col, W.col, R.col);
    refs.cL = L.cv;
    refs.cR = R.cv;
    refs.cW = W;
    const list = h('div', 'rcs-cal-axes');
    refs.calAx = {};
    for (const k of STICKS) {
      const r = h('div', 'rcs-cal-ax');
      const name = h('span');
      name.append(h('b', null, tx().axes[AXIS_OF[k]]), h('small', null, k === 'wheel' ? T.optional : k));
      const bar = h('span', 'rcs-prog');
      const fill = h('i');
      bar.append(fill);
      r.append(name, bar);
      refs.calAx[k] = { r, fill };
      list.append(r);
    }
    live.append(row, list);
    refs.calLive = live;

    const acts = h('div', 'rcs-acts');
    const btn = (label, cls, fn) => {
      const b = h('button', cls, label);
      b.type = 'button';
      b.onclick = fn;
      acts.append(b);
      return b;
    };
    refs.bStart = btn(T.calStart, 'primary', startCal);
    refs.bRecord = btn(T.record, 'primary', recordCenter);
    refs.bSave = btn(T.save, 'primary', saveCal);
    refs.bRestart = btn(T.restart, '', startCal);
    refs.bCancel = btn(T.cancel, '', () => {
      cal = null;
      calNote = '';
      renderCal();
    });
    refs.bReset = btn(T.calReset, 'rcs-quiet', resetCal);

    pane.append(info, wiz, live, acts);
    return pane;
  }

  const calSupported = (src) => src === 'bridge' || src === 'serial' || src === 'gamepad';

  function startCal() {
    const src = srcNow();
    if (!calSupported(src)) return;
    cal = { step: 1, src };
    calNote = '';
    renderCal();
  }

  function recordCenter() {
    if (!cal) return;
    cal.step = 'rec';
    cal.t0 = performance.now();
    cal.n = 0;
    cal.sum = Object.fromEntries(STICKS.map((k) => [k, 0]));
    renderCal();
  }

  function calProg(k) {
    const c = cal.c[k];
    const lo = cal.min[k];
    const hi = cal.max[k];
    if (Math.abs(c) > 0.5) return Math.min(1, (hi - lo) / CAL_SPAN); // yaysız eksen
    return (Math.min(1, (c - lo) / CAL_REACH) + Math.min(1, (hi - c) / CAL_REACH)) / 2;
  }

  const calReady = () => cal?.step === 2 && ['lh', 'lv', 'rh', 'rv'].every((k) => calProg(k) >= 1);

  function saveCal() {
    if (!calReady()) return;
    const out = { at: Date.now() };
    for (const k of STICKS) {
      if (k === 'wheel' && calProg(k) < 1) continue; // teker yoksa ya da çevrilmediyse
      let c = cal.c[k];
      if (Math.abs(c) > 0.5) c = (cal.min[k] + cal.max[k]) / 2; // yaysız gaz: orta nokta
      out[k] = { c: r3(c), min: r3(cal.min[k]), max: r3(cal.max[k]) };
    }
    settings.rcCal = { ...(settings.rcCal || {}), [cal.src]: out };
    cal = null;
    calNote = 'saved';
    commit('rcCal');
    renderCal();
  }

  function resetCal() {
    const src = srcNow();
    if (!settings.rcCal?.[src]) return;
    const next = { ...settings.rcCal };
    delete next[src];
    settings.rcCal = next;
    cal = null;
    calNote = '';
    commit('rcCal');
    renderCal();
  }

  // sihirbaz metinleri ve düğmeleri (adım ya da kaynak değişince)
  function renderCal() {
    if (!refs.calState) return;
    const T = tx();
    const src = srcNow();
    const ok = calSupported(src);
    const saved = settings.rcCal?.[src];
    refs.calState.textContent = !ok
      ? src === 'touch' ? T.calTouch : T.calNone
      : saved
        ? T.calDone(new Date(saved.at || Date.now()).toLocaleString(lang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))
        : T.calFactory;
    refs.calState.classList.toggle('ok', ok && !!saved);
    refs.calMsg.textContent = calNote ? T[calNote] : '';
    refs.calMsg.hidden = !calNote;
    refs.calMsg.classList.toggle('warn', calNote === 'lost');
    refs.calLive.hidden = !ok;

    const step = cal?.step;
    refs.wiz.hidden = !cal;
    if (cal) {
      const two = step === 2;
      refs.calStep.textContent = T.step(two ? 2 : 1);
      refs.calTitle.textContent = two ? T.step2 : T.step1;
      refs.calHint.textContent = step === 'rec' ? T.recording : two ? T.step2Hint : T.step1Hint;
      refs.calProgBox.hidden = step === 1;
    }
    for (const r of Object.values(refs.calAx)) r.r.hidden = step !== 2;
    refs.bStart.hidden = !ok || !!cal;
    refs.bReset.hidden = !ok || !!cal;
    refs.bReset.disabled = !saved;
    refs.bRecord.hidden = step !== 1 && step !== 'rec';
    refs.bRecord.disabled = step === 'rec';
    refs.bSave.hidden = step !== 2;
    refs.bRestart.hidden = step !== 2;
    refs.bCancel.hidden = !cal;
    refs.calSrc = src;
  }

  function drawCal(s, now) {
    if (s.src !== refs.calSrc) {
      if (cal && cal.src !== s.src) {
        cal = null;
        calNote = 'lost';
      }
      renderCal();
    }
    if (!s.raw) return;
    const raw = s.raw;
    if (cal?.step === 'rec') {
      for (const k of STICKS) cal.sum[k] += raw[k] || 0;
      cal.n++;
      const p = Math.min(1, (now - cal.t0) / 1000);
      refs.calProg.style.width = `${p * 100}%`;
      if (p >= 1 && cal.n > 0) {
        cal.c = Object.fromEntries(STICKS.map((k) => [k, cal.sum[k] / cal.n]));
        cal.min = { ...cal.c };
        cal.max = { ...cal.c };
        cal.step = 2;
        renderCal();
      }
    } else if (cal?.step === 2) {
      for (const k of STICKS) {
        const v = raw[k] || 0;
        if (v < cal.min[k]) cal.min[k] = v;
        if (v > cal.max[k]) cal.max[k] = v;
      }
      let sum = 0;
      for (const k of STICKS) {
        const p = calProg(k);
        refs.calAx[k].fill.style.width = `${p * 100}%`;
        refs.calAx[k].r.classList.toggle('done', p >= 1);
        if (k !== 'wheel') sum += p;
      }
      refs.calProg.style.width = `${(sum / 4) * 100}%`;
      refs.bSave.disabled = !calReady();
    }

    // aralık: sihirbazda yakalanan, değilse kayıtlı kalibrasyon
    const saved = settings.rcCal?.[s.src];
    const rangeOf = (k) => (cal?.step === 2 ? [cal.min[k], cal.max[k]] : saved?.[k] ? [saved[k].min, saved[k].max] : null);
    const centerOf = (k) => (cal?.c ? cal.c[k] : saved?.[k] ? saved[k].c : null);
    const box = (kx, ky) => {
      const rx = rangeOf(kx);
      const ry = rangeOf(ky);
      return rx && ry ? { x0: rx[0], x1: rx[1], y0: ry[0], y1: ry[1] } : null;
    };
    const ctr = (kx, ky) => (centerOf(kx) != null && centerOf(ky) != null ? [centerOf(kx), centerOf(ky)] : null);
    drawStick(refs.cL, { x: raw.lh, y: raw.lv, range: box('lh', 'lv'), center: ctr('lh', 'lv') });
    drawStick(refs.cR, { x: raw.rh, y: raw.rv, range: box('rh', 'rv'), center: ctr('rh', 'rv') });
    setWheel(refs.cW, raw.wheel, null, rangeOf('wheel'));
  }

  // ---- Ayar
  function slider(label, min, max, step, onInput) {
    const wrap = h('label', 'rcs-slider');
    const line = h('span', 'rcs-sl-line');
    const val = h('b');
    line.append(h('span', null, label), val);
    const inp = h('input');
    inp.type = 'range';
    inp.min = String(min);
    inp.max = String(max);
    inp.step = String(step);
    inp.oninput = () => {
      onInput(Number(inp.value));
      paint(inp);
    };
    wrap.append(line, inp);
    return { wrap, inp, val };
  }
  const paint = (inp) => {
    const p = ((Number(inp.value) - Number(inp.min)) / (Number(inp.max) - Number(inp.min))) * 100;
    inp.style.setProperty('--p', `${p}%`);
  };

  function buildTune(T) {
    const pane = h('div', 'rcs-pane rcs-tune');
    const axSec = section('', T.axesTitle);
    refs.tune = {};
    for (const ax of AXES) {
      const k = STICK_OF[ax];
      const row = h('div', 'rcs-axis');
      const name = h('div', 'rcs-axis-name');
      const nm = h('span');
      nm.append(h('b', null, T.axes[ax]), h('small', null, T.stickOf[k]));
      const inv = h('label', 'rcs-inv');
      const sw = h('input', 'switch');
      sw.type = 'checkbox';
      sw.onchange = () => {
        settings.invert = { ...settings.invert, [k]: sw.checked };
        commit('invert');
      };
      inv.append(h('span', null, T.invert), sw);
      name.append(nm, inv);

      const cv = h('canvas', 'rcs-curve');
      cv.setAttribute('aria-hidden', 'true');
      const conf = () => settings.axes[ax];
      const dz = slider(T.deadzone, 0, 0.3, 0.01, (v) => {
        conf().deadzone = v;
        dz.val.textContent = v.toFixed(2);
      });
      const ex = slider(T.expo, 0, 0.8, 0.05, (v) => {
        conf().expo = v;
        ex.val.textContent = v.toFixed(2);
        ex.val.classList.remove('is-global');
        ex.val.removeAttribute('title');
      });
      const rt = slider(T.rate, 0.3, 1.5, 0.05, (v) => {
        conf().rate = v;
        rt.val.textContent = `×${v.toFixed(2)}`;
      });
      for (const s of [dz, ex, rt]) s.inp.onchange = () => commit('axes');
      const sl = h('div', 'rcs-axis-sliders');
      sl.append(dz.wrap, ex.wrap, rt.wrap);
      row.append(name, cv, sl);
      axSec.append(row);
      refs.tune[ax] = { sw, cv, dz, ex, rt };
    }
    const a1 = h('div', 'rcs-acts');
    const rA = h('button', 'rcs-quiet', T.resetAxes);
    rA.type = 'button';
    rA.onclick = () => {
      settings.axes = rcDefaults().axes;
      settings.invert = { lv: false, lh: false, rv: false, rh: false, wheel: false };
      commit('axes');
      onChange?.('invert');
      syncTune();
    };
    a1.append(rA);
    axSec.append(a1);

    const spSec = section('rcs-speeds', T.speeds);
    refs.spHint = h('p', 'rcs-hint');
    const grid = h('div', 'rcs-speed-grid');
    refs.sp = {};
    for (const m of ['C', 'N', 'S']) {
      const col = h('div', 'rcs-speed-col');
      const hd = h('p', 'rcs-speed-head');
      const note = h('small', 'rcs-hint');
      col.append(hd);
      const mm = () => settings.modeMul[m];
      const mk = (key, label) => {
        const s = slider(label, 0.5, 1.5, 0.05, (v) => {
          mm()[key] = v;
          speedLabels(m);
        });
        s.inp.onchange = () => commit('modeMul');
        col.append(s.wrap);
        return s;
      };
      refs.sp[m] = { hd, note, col, h: mk('h', T.h), up: mk('up', T.v), yaw: mk('yaw', T.ys) };
      col.append(note);
      grid.append(col);
    }
    const a2 = h('div', 'rcs-acts');
    const rS = h('button', 'rcs-quiet', T.resetSpeeds);
    rS.type = 'button';
    rS.onclick = () => {
      settings.modeMul = rcDefaults().modeMul;
      commit('modeMul');
      syncTune();
    };
    a2.append(rS);
    spSec.append(refs.spHint, grid, a2);

    pane.append(axSec, spSec);
    return pane;
  }

  // seçili drone'un mod adı ve hızları
  const droneSpec = () => DRONES[settings.drone] || null;
  function modeTitle(m) {
    const d = droneSpec();
    const lb = d?.modeLabels?.[m] || m;
    const nm = d?.modeNames?.[m] || MODES[m].name;
    return `${lb} · ${nm.startsWith('mode.') ? t(nm) : nm}`;
  }

  function speedLabels(m) {
    const r = refs.sp[m];
    const mm = settings.modeMul[m];
    const d = droneSpec();
    const sp = d && !(d.acro && m === 'S') ? modeSpec(settings.drone, m, settings.speedMul || 1, mm) : null;
    const lab = (s, v, extra) => (s.val.textContent = `×${v.toFixed(2)}${sp ? ` · ${extra}` : ''}`);
    lab(r.h, mm.h, sp && `${Math.round(sp.h * 3.6)} km/h`);
    lab(r.up, mm.up, sp && `${+sp.up.toFixed(1)} m/s`);
    lab(r.yaw, mm.yaw, sp && `${Math.round(sp.yaw)}°/s`);
  }

  // ayar sekmesini kayıtlı değerlere eşitle (açılış, dil, sıfırlama)
  function syncTune() {
    if (!refs.tune) return;
    const T = tx();
    for (const ax of AXES) {
      const r = refs.tune[ax];
      const c = axisConf(settings, ax);
      r.sw.checked = !!settings.invert?.[STICK_OF[ax]];
      r.dz.inp.value = String(c.deadzone);
      r.dz.val.textContent = c.deadzone.toFixed(2);
      r.ex.inp.value = String(c.expo);
      r.ex.val.textContent = c.expo.toFixed(2);
      const global = !Number.isFinite(settings.axes?.[ax]?.expo);
      r.ex.val.classList.toggle('is-global', global);
      if (global) r.ex.val.title = T.expoGlobal;
      else r.ex.val.removeAttribute('title');
      r.rt.inp.value = String(c.rate);
      r.rt.val.textContent = `×${c.rate.toFixed(2)}`;
      for (const s of [r.dz, r.ex, r.rt]) paint(s.inp);
    }
    const d = droneSpec();
    refs.spHint.textContent = d ? T.speedsHint : T.speedsPlane;
    for (const m of ['C', 'N', 'S']) {
      const r = refs.sp[m];
      const mm = settings.modeMul[m];
      r.hd.textContent = modeTitle(m);
      const acro = !!d?.acro && m === 'S';
      r.note.textContent = acro ? T.acroNote : '';
      r.note.hidden = !acro;
      for (const k of ['h', 'up', 'yaw']) {
        r[k].inp.value = String(mm[k]);
        r[k].inp.disabled = !d || acro;
        paint(r[k].inp);
      }
      r.col.classList.toggle('off', !d || acro);
      speedLabels(m);
    }
  }

  // tepki eğrisi: doğrusal referans, eğri, canlı nokta
  function drawCurve(cv, conf, vin) {
    const f = fit(cv);
    if (!f) return;
    const { ctx, w, h: H } = f;
    const p = 6;
    const X = (v) => p + ((v + 1) / 2) * (w - 2 * p);
    const Y = (v) => H - p - ((v + 1) / 2) * (H - 2 * p);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(X(0) + 0.5, p);
    ctx.lineTo(X(0) + 0.5, H - p);
    ctx.moveTo(p, Y(0) + 0.5);
    ctx.lineTo(w - p, Y(0) + 0.5);
    ctx.stroke();
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(X(-1), Y(-1));
    ctx.lineTo(X(1), Y(1));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 64; i++) {
      const v = -1 + (i / 64) * 2;
      const y = shape(v, conf);
      if (i) ctx.lineTo(X(v), Y(y));
      else ctx.moveTo(X(v), Y(y));
    }
    ctx.stroke();
    if (Math.abs(vin) > 0.001) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(X(vin), Y(shape(vin, conf)), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawTune(s) {
    for (const ax of AXES) drawCurve(refs.tune[ax].cv, axisConf(settings, ax), s.pre[ax]);
  }

  // ---- Gamepad eşlemesi
  function buildPad(T) {
    const pane = h('div', 'rcs-pane rcs-pad');
    const sec = section('', null);
    const r1 = h('div', 'rcs-field');
    refs.padName = h('b');
    r1.append(h('span', null, T.padName), refs.padName);
    const r2 = h('label', 'rcs-field');
    const sel = h('select');
    refs.padSel = sel;
    sel.onchange = () => {
      settings.gamepadPreset = sel.value;
      rc.setGamepadPreset?.(sel.value);
      commit('gamepadPreset');
      padKey = '';
    };
    r2.append(h('span', null, T.mapping), sel);
    sec.append(r1, r2, h('p', 'rcs-hint', T.padHint));

    const axSec = section('', T.rawAxes);
    refs.padAxes = h('div', 'rcs-table rcs-padaxes');
    axSec.append(refs.padAxes);
    const bSec = section('', T.pressed);
    refs.padBtns = h('p', 'rcs-padbtns');
    bSec.append(refs.padBtns);
    pane.append(sec, axSec, bSec);
    return pane;
  }

  function rawPad() {
    const idx = rc.gamepad?.pad?.index;
    if (idx == null) return null;
    try {
      return Array.from(navigator.getGamepads?.() || []).find((p) => p && p.index === idx) || null;
    } catch {
      return null;
    }
  }

  function drawPad() {
    const T = tx();
    const gp = rc.gamepad;
    const pad = rawPad();
    const auto = PRESETS[pickPreset(gp?.pad, 'auto')]?.label || '';
    const active = gp?.activePreset || pickPreset(gp?.pad, settings.gamepadPreset);
    const p = PRESETS[active];
    const nAxes = pad?.axes?.length || 0;
    const key = `${gp?.pad?.id}|${active}|${nAxes}|${lang()}|${settings.gamepadPreset}`;
    if (key !== padKey) {
      padKey = key;
      refs.padName.textContent = gp?.pad ? padName(gp.pad.id) : '—';
      const sel = refs.padSel;
      sel.textContent = '';
      const opt = (v, label) => {
        const o = h('option', null, label);
        o.value = v;
        sel.append(o);
      };
      opt('auto', T.auto(auto));
      for (const [k, v] of Object.entries(PRESETS)) opt(k, v.label);
      sel.value = PRESETS[settings.gamepadPreset] ? settings.gamepadPreset : 'auto';
      // ham eksen satırları: indeks → eşlenen eksen
      refs.padAxes.textContent = '';
      refs.padRows = [];
      for (let i = 0; i < nAxes; i++) {
        const hit = p && Object.entries(p.axes).find(([, [ix]]) => ix === i);
        const r = h('div', 'rcs-tr');
        const map = hit ? `${T.axes[AXIS_OF[hit[0]]]}${hit[1][1] < 0 ? ' (−)' : ''}` : T.unmapped;
        const nm = h('span', 'rcs-axname');
        nm.append(h('b', null, `#${i}`), h('small', hit ? null : 'dim', map));
        const bar = h('span', 'rcs-bar');
        const fill = h('i', 'fill');
        bar.append(fill);
        const val = h('span', 'num strong');
        r.append(nm, bar, val);
        refs.padAxes.append(r);
        refs.padRows.push({ fill, val });
      }
      if (!nAxes) refs.padAxes.append(h('p', 'rcs-hint', '—'));
    }
    if (pad) {
      refs.padRows.forEach((r, i) => {
        const v = Number(pad.axes[i]) || 0;
        setBar(r.fill, v);
        r.val.textContent = fmt(v);
      });
      const names = [];
      (pad.buttons || []).forEach((b, i) => {
        const on = typeof b === 'number' ? b > 0.5 : b?.pressed || b?.value > 0.5;
        if (!on) return;
        let n = p?.buttons?.[i] ? T.btn[p.buttons[i]] : '';
        if (p?.wheel?.up === i) n = `${T.axes.gimbal} +`;
        if (p?.wheel?.down === i) n = `${T.axes.gimbal} −`;
        names.push(n ? `#${i} ${n}` : `#${i}`);
      });
      refs.padBtns.textContent = names.join(' · ') || '—';
    }
  }

  // ---- sekmeler ve döngü
  function setTab(id) {
    if (id === 'pad' && srcNow() !== 'gamepad') id = 'test';
    tab = id;
    for (const [k, b] of Object.entries(refs.tabs)) {
      b.classList.toggle('on', k === id);
      b.setAttribute('aria-selected', String(k === id));
    }
    for (const [k, p] of Object.entries(refs.panes)) p.hidden = k !== id;
    if (id === 'tune') syncTune();
    if (id === 'cal') renderCal();
    if (refs.body) refs.body.scrollTop = 0;
  }

  function tick(now) {
    if (!isOpen) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    stepKb(dt);
    const s = sample();
    const T = tx();
    refs.live.classList.toggle('on', s.src !== 'none');
    refs.srcName.textContent = s.src === 'none' ? T.notLive : srcName(s.src);
    const isPad = s.src === 'gamepad';
    refs.tabs.pad.hidden = !isPad;
    if (tab === 'pad' && !isPad) setTab('test');
    if (tab === 'test') drawTest(s);
    else if (tab === 'cal') drawCal(s, now);
    else if (tab === 'tune') drawTune(s);
    else if (tab === 'pad') drawPad();
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    build();
    root.hidden = false;
    document.body.classList.add('rcs-open');
    refs.sheet.focus({ preventScroll: true });
    last = 0;
    trails.L.length = trails.R.length = 0;
    raf = requestAnimationFrame(tick);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    cancelAnimationFrame(raf);
    cal = null;
    calNote = '';
    kbDown.clear();
    Object.assign(kb, ZERO);
    if (root.contains(document.activeElement)) document.activeElement.blur();
    root.hidden = true;
    document.body.classList.remove('rcs-open');
  }

  function setLang() {
    if (isOpen) build();
  }

  return {
    open,
    close,
    setLang,
    get isOpen() {
      return isOpen;
    },
  };
}
