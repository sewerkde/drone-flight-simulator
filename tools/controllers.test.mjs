// Kumanda eşleme birim testleri (tarayıcısız). Çalıştır: node --test tools/controllers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

// rc-bridge.js EventSource ister; Node'da yok → sahte sınıf. Testler mesajı elle _msg ile verir.
class FakeEventSource {
  constructor(url) {
    this.url = url;
  }
}
globalThis.EventSource = FakeEventSource;

const {
  PRESETS, deadzone, radialDeadzone, pickPreset, padName, choosePad, mapGamepad, buttonEdges, GamepadSource,
} = await import('../src/gamepad.js');
const { stickVector, shouldShowTouch, TouchSource } = await import('../src/touch.js');
const { decodeDjiButtons, pickSource, createControllers, BUTTON_NAMES } = await import('../src/controllers.js');
const { BridgeRc } = await import('../src/rc-bridge.js');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const btn = (pressed, value = pressed ? 1 : 0) => ({ pressed, value });
const pad = (axes = [0, 0, 0, 0], pressed = [], extra = {}) => ({
  index: 0,
  id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)',
  mapping: 'standard',
  connected: true,
  axes,
  buttons: Array.from({ length: 17 }, (_, i) => btn(pressed.includes(i))),
  ...extra,
});

// ---------------------------------------------------------------- ölü bölge

test('deadzone: içi 0, dışı yeniden ölçeklenir, uçlar korunur', () => {
  assert.equal(deadzone(0.05, 0.1), 0);
  assert.equal(deadzone(-0.1, 0.1), 0);
  assert.equal(deadzone(1, 0.1), 1);
  assert.equal(deadzone(-1, 0.1), -1);
  near(deadzone(0.55, 0.1), 0.5);
  near(deadzone(-0.55, 0.1), -0.5);
  assert.equal(deadzone(1.3, 0.1), 1); // taşma kırpılır
  assert.equal(deadzone(NaN, 0.1), 0);
  assert.equal(deadzone(undefined, 0.1), 0);
});

test('radialDeadzone: küçük vektör 0, yön korunur, eksen başına kırpılır', () => {
  assert.deepEqual(radialDeadzone(0.08, 0.08, 0.12), [0, 0]); // |v| = 0.113
  const [x, y] = radialDeadzone(0.6, 0, 0.2);
  near(x, 0.5);
  assert.equal(y, 0);
  const [a, b] = radialDeadzone(0.5, 0.5, 0.1);
  near(a, b); // köşegen yönü korunur
  assert.ok(a > 0.4 && a < 0.5);
  const [c, d] = radialDeadzone(1, 1, 0.1); // kare kapılı kolun köşesi
  assert.equal(c, 1);
  assert.equal(d, 1);
});

// ---------------------------------------------------------------- hazır ayarlar

test('standard: Mode 2, dikeyler ters (yukarı = +1)', () => {
  const r = mapGamepad(pad([0.5, 0, 0, 1]), 'standard');
  near(r.sticks.lh, (0.5 - 0.12) / 0.88, 1e-6); // sol sağa → yaw +
  assert.equal(r.sticks.lv, 0);
  assert.equal(r.sticks.rh, 0);
  near(r.sticks.rv, -1, 1e-6); // sağ çubuk aşağı → geri
  near(mapGamepad(pad([0, -1, 0, 0]), 'standard').sticks.lv, 1, 1e-6); // sol çubuk yukarı → gaz +
  // köşegende dairesel ölü bölge yönü korur, iki eksen de büyür
  const d = mapGamepad(pad([0.5, -1, 0, 0]), 'standard').sticks;
  assert.ok(d.lh > 0.5 && d.lh < 0.52 && d.lv === 1);
  const r2 = mapGamepad(pad([0, 0, -1, -0.02]), 'standard');
  near(r2.sticks.rh, -1, 1e-6);
  near(r2.sticks.rv, 0, 0.03);
});

test('standard: tetikler gimbal tekerleği (RT yukarı, LT aşağı)', () => {
  const p = pad();
  p.buttons[7] = btn(true, 0.8);
  near(mapGamepad(p, 'standard').sticks.wheel, (0.8 - 0.05) / 0.95, 1e-6);
  p.buttons[7] = btn(false, 0);
  p.buttons[6] = btn(true, 1);
  near(mapGamepad(p, 'standard').sticks.wheel, -1);
  p.buttons[6] = btn(false, 0.03); // hafif dokunuş ölü bölgede
  assert.equal(mapGamepad(p, 'standard').sticks.wheel, 0);
});

test('standard: tuş adları A/B/X/Y/LB/RB', () => {
  const names = (pressed) => Object.entries(mapGamepad(pad([0, 0, 0, 0], pressed), 'standard').buttons)
    .filter(([, v]) => v)
    .map(([k]) => k);
  assert.deepEqual(names([0]), ['takeoff']);
  assert.deepEqual(names([1]), ['land']);
  assert.deepEqual(names([2]), ['rth']);
  assert.deepEqual(names([3]), ['view']);
  assert.deepEqual(names([4]), ['modeDown']);
  assert.deepEqual(names([5]), ['modeUp']);
  assert.deepEqual(names([6, 7, 8, 9]), []); // tetikler/menü tuşları olay değil
  // analog tuş: value > 0.5 da basılı sayılır; sayı dizisi de kabul edilir
  assert.equal(mapGamepad({ axes: [0, 0, 0, 0], buttons: [0.7] }, 'standard').buttons.takeoff, true);
  assert.equal(mapGamepad({ axes: [0, 0, 0, 0], buttons: [0.3] }, 'standard').buttons.takeoff, false);
});

test('AETR: kanal sırası, gaz tam aralık olduğu gibi (yaylı değil)', () => {
  const dz = PRESETS.aetr.deadzone;
  const r = mapGamepad({ axes: [0.5, -0.4, -1, 0.9] }, 'aetr');
  near(r.sticks.rh, (0.5 - dz) / (1 - dz), 1e-6); // A → roll
  near(r.sticks.rv, -(0.4 - dz) / (1 - dz), 1e-6); // E → pitch
  near(r.sticks.lv, -1); // T → gaz, en alt = -1
  near(r.sticks.lh, (0.9 - dz) / (1 - dz), 1e-6); // R → yaw
  assert.equal(mapGamepad({ axes: [0, 0, 1, 0] }, 'aetr').sticks.lv, 1); // en üst = +1
  assert.equal(mapGamepad({ axes: [0, 0, 0, 0] }, 'aetr').sticks.lv, 0); // orta = 0
  assert.equal(mapGamepad({ axes: [0, 0, 0.01, 0] }, 'aetr').sticks.lv, 0);
  assert.equal(mapGamepad({ axes: [0, 0, 0, 0] }, 'aetr').sticks.wheel, 0);
  assert.deepEqual(mapGamepad({ axes: [0, 0, 0, 0], buttons: [btn(true)] }, 'aetr').buttons, {});
});

test('TAER: kanal sırası', () => {
  const r = mapGamepad({ axes: [1, -1, 0.5, -0.5] }, 'taer');
  assert.equal(r.sticks.lv, 1); // T
  assert.equal(r.sticks.rh, -1); // A
  assert.ok(r.sticks.rv > 0.48 && r.sticks.rv < 0.5); // E
  assert.ok(r.sticks.lh < -0.48 && r.sticks.lh > -0.5); // R
});

test('mapGamepad: ölü bölge ve tuş eşlemesi seçenekle ezilir', () => {
  assert.equal(mapGamepad({ axes: [0.05, 0, 0, 0] }, 'aetr', { deadzone: 0 }).sticks.rh, 0.05);
  const r = mapGamepad({ axes: [0, 0, 0, 0], buttons: [0, 0, btn(true)] }, 'aetr', { buttons: { 2: 'takeoff' } });
  assert.deepEqual(r.buttons, { takeoff: true });
  // eksik eksenler 0
  assert.deepEqual(mapGamepad({ axes: [] }, 'taer').sticks, { lh: 0, lv: 0, rh: 0, rv: 0, wheel: 0 });
});

test('pickPreset: kimlikten tahmin, adla ezme', () => {
  assert.equal(pickPreset(pad()), 'standard');
  assert.equal(pickPreset({ id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)' }), 'standard');
  assert.equal(pickPreset({ id: 'EdgeTX RadioMaster TX16S Joystick (Vendor: 1209 Product: 4f54)' }), 'aetr');
  assert.equal(pickPreset({ id: 'OpenTX Jumper T-Lite Joystick (Vendor: 1209 Product: 4f54)' }), 'aetr');
  assert.equal(pickPreset({ id: '1209-4f54-EdgeTX Joystick' }), 'aetr'); // Firefox biçimi
  assert.equal(pickPreset({ id: 'Joystick (Vendor: 1209 Product: 4f54)' }), 'aetr'); // yalnız USB kimliği
  assert.equal(pickPreset({ id: 'Generic USB Joystick (Vendor: 0079 Product: 0006)' }), 'standard');
  assert.equal(pickPreset({ id: 'EdgeTX RadioMaster Pocket' }, 'taer'), 'taer');
  assert.equal(pickPreset(pad(), 'aetr'), 'aetr');
  assert.equal(pickPreset(pad(), 'auto'), 'standard');
  assert.equal(pickPreset(pad(), 'bilinmeyen'), 'standard'); // geçersiz ad → otomatik
  assert.equal(pickPreset(null), 'standard');
});

test('padName: tarayıcı ekleri atılır', () => {
  assert.equal(padName('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)'), 'Xbox Wireless Controller');
  assert.equal(padName('EdgeTX RadioMaster TX16S Joystick (Vendor: 1209 Product: 4f54)'), 'EdgeTX RadioMaster TX16S Joystick');
  assert.equal(padName('1209-4f54-EdgeTX Joystick'), 'EdgeTX Joystick');
  assert.equal(padName(''), 'Gamepad');
});

test('choosePad: boşlar atlanır, indeks, ≥4 eksen tercihi', () => {
  const a = { index: 0, id: 'a', connected: true, axes: [0, 0] };
  const b = { index: 1, id: 'b', connected: true, axes: [0, 0, 0, 0] };
  assert.equal(choosePad([null, a, b]), b);
  assert.equal(choosePad([a]), a);
  assert.equal(choosePad([a, b], 0), a);
  assert.equal(choosePad([a, b], 5), null);
  assert.equal(choosePad([null, null]), null);
  assert.equal(choosePad([{ ...b, connected: false }]), null);
  assert.equal(choosePad(undefined), null);
});

test('buttonEdges: yalnız basıldığı an', () => {
  assert.deepEqual(buttonEdges({ a: false, b: true }, { a: true, b: true }), ['a']);
  assert.deepEqual(buttonEdges({ a: true }, { a: false }), []); // bırakma olay değil
  assert.deepEqual(buttonEdges({}, { a: true, b: false }), ['a']);
  assert.deepEqual(buttonEdges(null, { x: true }), ['x']);
});

// ---------------------------------------------------------------- GamepadSource (sahte navigator.getGamepads)

let pads = [];
navigator.getGamepads = () => pads;

test('GamepadSource: ilk okuma kenar değil, sonraki basışlar olay, çıkarınca sıfırlanır', () => {
  const g = new GamepadSource();
  const ev = [];
  g.onButton = (n) => ev.push(n);
  assert.equal(g.live, false);
  pads = [null, pad([0, -1, 0, 0], [0], { index: 1 })]; // A basılıyken görünür oldu
  g.poll();
  assert.equal(g.live, true);
  assert.equal(g.activePreset, 'standard');
  assert.deepEqual(ev, []);
  near(g.sticks.lv, 1, 1e-6);
  pads = [null, pad([0, 0, 0, 0], [], { index: 1 })];
  g.poll();
  pads = [null, pad([0, 0, 0, 0], [0, 5], { index: 1 })];
  g.poll();
  g.poll(); // basılı kalmak tekrar olay üretmez
  assert.deepEqual(ev, ['takeoff', 'modeUp']);
  assert.equal(g.name, 'Xbox Wireless Controller');
  pads = [null, null];
  g.poll();
  assert.equal(g.live, false);
  assert.deepEqual(g.sticks, { lh: 0, lv: 0, rh: 0, rv: 0, wheel: 0 });
});

test('GamepadSource: RC verici otomatik AETR, adla TAER', () => {
  const g = new GamepadSource();
  pads = [{ index: 0, id: 'EdgeTX RadioMaster TX16S Joystick (Vendor: 1209 Product: 4f54)', mapping: '', connected: true, axes: [0, 0, -1, 0, 0, 0, 0, 0], buttons: [] }];
  g.poll();
  assert.equal(g.activePreset, 'aetr');
  assert.equal(g.sticks.lv, -1);
  assert.equal(g.name, 'EdgeTX RadioMaster TX16S Joystick · RC · AETR');
  g.setPreset('taer');
  g.poll();
  assert.equal(g.activePreset, 'taer');
  assert.equal(g.sticks.lv, 0);
  assert.equal(g.sticks.rv, -1);
  pads = [];
});

// ---------------------------------------------------------------- dokunmatik

test('stickVector: merkez 0, yukarı +, kare kapı, kırpma', () => {
  assert.deepEqual(stickVector(0, 0, 40), { x: 0, y: 0 });
  assert.deepEqual(stickVector(40, 0, 40), { x: 1, y: 0 });
  assert.deepEqual(stickVector(0, -40, 40), { x: 0, y: 1 }); // ekranda yukarı = +1
  assert.deepEqual(stickVector(0, 20, 40), { x: 0, y: -0.5 });
  assert.deepEqual(stickVector(80, -80, 40), { x: 1, y: 1 }); // köşede ikisi birden tam
  assert.deepEqual(stickVector(-200, 200, 40), { x: -1, y: -1 });
  assert.deepEqual(stickVector(10, 10, 0), { x: 0, y: 0 });
});

test('shouldShowTouch: masaüstünde gizli', () => {
  assert.equal(shouldShowTouch({ maxTouchPoints: 0, coarse: false }), false); // Mac
  assert.equal(shouldShowTouch({ maxTouchPoints: 10, coarse: false }), false); // dokunmatik dizüstü, fare birincil
  assert.equal(shouldShowTouch({ maxTouchPoints: 0, coarse: true }), false);
  assert.equal(shouldShowTouch({ maxTouchPoints: 5, coarse: true }), true); // telefon/tablet
  assert.equal(shouldShowTouch({ force: true }), true);
  assert.equal(shouldShowTouch(), false);
  assert.equal(new TouchSource().live, false); // Node = masaüstü sayılır
});

// ---------------------------------------------------------------- DJI tuş çözümü + birleşik kumanda

test('decodeDjiButtons: rc-bridge.js ile birebir aynı', () => {
  const b = new BridgeRc('/rc');
  const ev = [];
  const modes = [];
  b.onButton = (n) => ev.push(n);
  b.onMode = (m) => modes.push(m);
  for (const hi of [0x00, 0x10, 0x20, 0x13, 0x30]) {
    for (let lo = 0; lo < 256; lo++) {
      const v = (hi << 8) | lo;
      b._msg({ live: true, lh: 0, lv: 0, rh: 0, rv: 0, wheel: 0, raw: '00', btn: v, status: 'bağlı' });
      const d = decodeDjiButtons(v);
      assert.deepEqual(d.buttons, b.buttons, `v=${v.toString(16)}`);
      if (d.mode) assert.equal(d.mode, b.switchMode);
    }
  }
  assert.deepEqual(decodeDjiButtons(0x1000), { mode: 'N', buttons: { photo: false, rth: false, camera: false, fn: false } });
  assert.deepEqual(decodeDjiButtons(0x2080).buttons.rth, true); // C modunda da RTH (rc.js maskesi kaçırırdı)
  assert.equal(decodeDjiButtons(0x3000).mode, null);
});

test('pickSource: öncelik ve devre dışı', () => {
  assert.equal(pickSource({ bridge: true, serial: true, gamepad: true, touch: true }), 'bridge');
  assert.equal(pickSource({ bridge: false, serial: true, gamepad: true, touch: true }), 'serial');
  assert.equal(pickSource({ gamepad: true, touch: true }), 'gamepad');
  assert.equal(pickSource({ touch: true }), 'touch');
  assert.equal(pickSource({}), 'none');
  assert.equal(pickSource({ bridge: true, gamepad: true }, ['bridge']), 'gamepad');
});

test('Controllers: BridgeRc arayüzü + öncelik + olaylar', () => {
  const c = createControllers({ loop: false, serialAuto: false });
  for (const k of ['sticks', 'buttons', 'rawButtons', 'live', 'connected', 'status', 'supported', 'onButton', 'onChange', 'onMode', 'source', 'sourceName']) {
    assert.ok(k in c, `eksik: ${k}`);
  }
  assert.deepEqual(Object.keys(c.buttons), BUTTON_NAMES);
  const log = [];
  c.onButton = (n) => log.push(`btn:${n}`);
  c.onChange = (l) => log.push(`live:${l}`);
  c.onMode = (m) => log.push(`mode:${m}`);
  c.onSource = (s, n) => log.push(`src:${s}:${n}`);
  const sticks = c.sticks;

  c.update();
  assert.equal(c.source, 'none');
  assert.equal(c.live, false);
  assert.equal(c.supported, true);

  // oyun kolu takıldı
  pads = [pad([0, -1, 1, 0])];
  c.update();
  assert.equal(c.source, 'gamepad');
  assert.equal(c.live, true);
  assert.equal(c.connected, true);
  near(c.sticks.lv, 1, 1e-6);
  near(c.sticks.rh, 1, 1e-6);
  assert.equal(c.sticks, sticks); // aynı nesne yerinde güncellenir (hud/input referans tutabilir)
  pads = [pad([0, 0, 0, 0], [2])];
  c.update();
  assert.equal(c.buttons.rth, true);

  // köprü canlı veri getirdi → öncelik onda
  c.bridge._msg({ live: true, lh: 0.25, lv: -0.5, rh: 0, rv: 0.75, wheel: 0.1, raw: 'ab', btn: 0x2002, status: 'bağlı' });
  c.update();
  assert.equal(c.source, 'bridge');
  assert.equal(c.sourceName, 'DJI RC (serve.py)');
  assert.equal(c.status, 'bağlı');
  assert.deepEqual({ ...c.sticks }, { lh: 0.25, lv: -0.5, rh: 0, rv: 0.75, wheel: 0.1 });
  assert.equal(c.buttons.fn, true);
  assert.equal(c.buttons.rth, false); // oyun kolunun tuş durumu artık görünmez
  assert.deepEqual([...c.rawButtons], [0xab]);

  // oyun kolu tuşu köprü etkinken de iletilir
  pads = [pad([0, 0, 0, 0], [2, 3])];
  c.update();

  // gerçek kumandayı sustur (testlerde serve.py verisi gibi)
  c.setEnabled('bridge', false);
  assert.equal(c.source, 'gamepad');
  c.bridge._msg({ live: true, lh: 0, lv: 0, rh: 0, rv: 0, wheel: 0, raw: 'ab', btn: 0x2082, status: 'bağlı' });

  pads = [];
  c.update();
  assert.equal(c.source, 'none');
  assert.deepEqual({ ...c.sticks }, { lh: 0, lv: 0, rh: 0, rv: 0, wheel: 0 });
  assert.equal(c.connected, false); // köprü sahte, bağlı değil; kapalı kaynak sayılmaz

  assert.deepEqual(log, [
    'src:gamepad:Xbox Wireless Controller', 'live:true',
    'btn:rth',
    'src:bridge:DJI RC (serve.py)', // köprünün onChange'i hemen günceller
    'mode:C', 'btn:fn', // köprü ilk mesajı: anahtar + Fn
    'btn:view',
    'src:gamepad:Xbox Wireless Controller',
    'src:none:', 'live:false',
  ]);
  c.destroy();
});

test('Controllers: Web Serial kaynağı köprünün altında, tuşlar ham bayttan', () => {
  const c = createControllers({ loop: false, serialAuto: false, gamepad: false });
  const log = [];
  c.onButton = (n) => log.push(`btn:${n}`);
  c.onMode = (m) => log.push(`mode:${m}`);
  const raw = (v) => {
    const r = new Uint8Array(45);
    r[17] = v >> 8;
    r[18] = v & 0xff;
    return r;
  };
  // DjiRc yerine sahte port (connectSerial gerçek cihaz ister)
  c.serial = { live: true, connected: true, status: 'bağlı', disconnect() {}, sticks: { lh: 0.1, lv: 0.2, rh: 0.3, rv: 0.4, wheel: 0 }, rawButtons: raw(0x0000) };
  c.update();
  assert.equal(c.source, 'serial');
  assert.equal(c.sourceName, 'DJI RC (USB)');
  assert.equal(c.status, 'USB: bağlı');
  assert.equal(c.sticks.rv, 0.4);
  c.serial.rawButtons = raw(0x0080); // S modunda RTH
  c.update();
  c.update(); // aynı çerçeve tekrar okunmaz
  c.serial.rawButtons = raw(0x0080);
  c.update(); // yeni çerçeve, hâlâ basılı → olay yok
  c.serial.rawButtons = raw(0x2000);
  c.update();
  assert.deepEqual(log, ['mode:S', 'btn:rth', 'mode:C']);

  // köprü canlı → seri olaylar iletilmez (aynı kumanda iki kez sayılmasın)
  c.bridge._msg({ live: true, lh: 0, lv: 0, rh: 0, rv: 0, wheel: 0, raw: '00', btn: 0x2000, status: 'bağlı' });
  c.serial.rawButtons = raw(0x2004);
  c.update();
  assert.equal(c.source, 'bridge');
  assert.deepEqual(log, ['mode:S', 'btn:rth', 'mode:C', 'mode:C']); // son 'mode:C' köprünün ilk mesajı
  c.destroy();
});
