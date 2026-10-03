import * as THREE from 'three';
import { createControllers } from './controllers.js';
import { Input } from './input.js';
import { buildWorld } from './world.js';
import { buildGoogleWorld, PLACES, placeLabel } from './world-google.js';
import { buildOsmWorld } from './world-osm.js';
import { Drone, MODES, DRONES } from './flight.js';
import { FpvDrone } from './fpv.js';
import { Plane, PLANES } from './plane.js';
import { buildDroneModel, buildFpvModel, buildPlaneModel, loadDroneModels, hasGlbDrone, buildGlbDrone } from './model.js';
import { Hud, fmtLap } from './hud.js';
import { settings, save } from './settings.js';
import { MotorSound } from './sound.js';
import { t, applyStatic, lang } from './i18n.js';
import { NetClient } from './net.js';
import { Ghosts, colorFor } from './ghosts.js';
import { Lasers, rayHitsSphere, hitRadius, zapSound, hitSound, RANGE, LIVES, FIRE_MS, RESPAWN_MS, SHIELD_MS } from './arena.js';
import { createLobby } from './lobby.js';
import { createRcSetup } from './rc-setup.js';

applyStatic();

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;

// ---- sahne
const canvas = $('view');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    logarithmicDepthBuffer: true,
    powerPreference: 'high-performance',
  });
} catch (e) {
  $('startMsg').textContent = t('webglOff');
  $('startRc').disabled = true;
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 6000);
camera.rotation.order = 'YXZ';

scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x4f5f33, 1.1));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
const SUN_DIR = new THREE.Vector3(-0.45, 0.8, 0.35).normalize();
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 400 });
sun.shadow.camera.layers.enable(1);
sun.shadow.camera.layers.enable(3);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

// Kayıtlı hazır yer listede güncellendiyse (koordinat, bakış yönü) yeni hâlini kullan
const freshPlace = PLACES.find((p) => p.name === settings.place?.name);
if (freshPlace && JSON.stringify(freshPlace) !== JSON.stringify(settings.place)) {
  settings.place = freshPlace;
  save();
}
// Dünya: açık harita (OSM, varsayılan, anahtarsız) | Google 3D (kendi anahtarınla) | köy (internetsiz)
const useGoogle = settings.world === 'google' && settings.gKey && settings.place;
const useOsm = (settings.world === 'osm' || settings.world === 'sat') && settings.place;
const worldOpts = { lat: settings.place?.lat, lon: settings.place?.lon, quality: settings.quality };
const world = useGoogle
  ? buildGoogleWorld(scene, renderer, camera, { ...worldOpts, key: settings.gKey })
  : useOsm
    ? buildOsmWorld(scene, renderer, camera, { ...worldOpts, imagery: settings.world === 'sat' })
    : buildWorld(scene, renderer);
const realWorld = world.kind !== 'village';
// Kalkış her zaman yerden; flight.js reset'teki askıda başlama kapalı
world.startAlt = 0;
// gerçek dünyada gimbal başta neredeyse düz: öndeki bulanık zemin yerine meydan ve simge yapı görünsün
world.startGimbal = realWorld ? -3 : -12;
// Başlangıç yönü: yerin 'face' noktasına bak (-z kuzey, +x doğu; yaw 0 = kuzey, artı = sola)
world.startYaw = 0;
if (realWorld && settings.place?.face) {
  const [fLat, fLon] = settings.place.face;
  const dx = (fLon - settings.place.lon) * 111320 * Math.cos((settings.place.lat * Math.PI) / 180);
  const dz = -(fLat - settings.place.lat) * 110540;
  world.startYaw = Math.atan2(-dx, -dz);
}
renderer.shadowMap.enabled = world.kind === 'village';
// ---- ses (tarayıcı ilk tıklama/tuşta açar)
const sound = new MotorSound();
sound.volume = settings.volume;
sound.muted = !settings.sound;
// iOS Safari sesi yalnız dokunma bitişinde (touchend/click) açar; 'playback' oturumu sessiz anahtarına rağmen çalar
try {
  if (navigator.audioSession) navigator.audioSession.type = 'playback';
} catch {}
for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) addEventListener(ev, () => sound.unlock(), { capture: true, passive: true });
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && sound.ctx && sound.unlock());

// ---- araçlar: DJI drone, FPV drone, uçak
// Yalnız drone'lar (DJI + FPV). Uçaklar 03.10'da listeden çıkarıldı; plane.js ve modelleri geri eklemek için duruyor.
const VEHICLES = { ...DRONES };
if (!VEHICLES[settings.drone]) settings.drone = 'mini5';
let drone;
let model;
function setCraft(id) {
  const v = VEHICLES[id];
  const prev = drone;
  if (model) scene.remove(model.root);
  drone = v.type === 'plane' ? new Plane(world, id) : v.type === 'fpv' ? new FpvDrone(world, id) : new Drone(world);
  drone.kind ??= 'drone';
  drone.mode = MODES[settings.mode] ? settings.mode : 'N';
  // Uçarken araç değişirse yeni araç aynı yerde, aynı yön ve hızla havada askıda devam eder
  // (önceden yeni araç kalkış noktasında motorları kapalı başlıyordu, düşmüş gibi görünüyordu)
  if (prev?.airborne) {
    drone.pos.copy(prev.pos);
    drone.prevPos.copy(prev.pos);
    drone.vel.copy(prev.vel);
    drone.home.copy(prev.home);
    drone.yaw = prev.yaw;
    drone.gimbal = prev.gimbal;
    drone.battery = prev.battery;
    drone.flightTime = prev.flightTime;
    drone.time = prev.time;
    drone.state = 'flying';
    drone.prop = 1;
    drone.released = true;
    drone.quat?.setFromEuler(new THREE.Euler(0, drone.yaw, 0, 'YXZ'));
  }
  model = buildModelFor(id);
  scene.add(model.root);
  sound.setVehicle(id);
}

// Araç modeli (kendi aracımız ve online odadaki diğer pilotlar için)
function buildModelFor(id) {
  if (!Object.hasOwn(VEHICLES, id)) id = 'mini5'; // ağdan gelen kimlik: yalnız bilinen araçlar
  const v = VEHICLES[id];
  const m =
    v.type === 'plane'
      ? buildPlaneModel(v.model, v.gear)
      : v.type === 'fpv'
        ? buildFpvModel(v.model)
        : hasGlbDrone(id)
          ? buildGlbDrone(id)
          : buildDroneModel();
  m.root.rotation.order = 'YXZ';
  m.body.rotation.order = 'YXZ';
  // Blender modelleri gerçek ölçüde; basit modeller ölçeklenir
  m.root.scale.setScalar(v.type === 'plane' || m.glb ? 1 : v.scale || 1);
  return m;
}
await loadDroneModels();
setCraft(settings.drone);

const kmh = (ms) => Math.round(ms * 3.6);
const speedLabel = () => (settings.speedMul === 1 ? `×1 ${t('stock')}` : `×${settings.speedMul.toFixed(2).replace(/0$/, '')}`);
const durLabel = (min) => (min >= 120 ? `${Math.round(min / 60)} ${t('hours')}` : `${min} ${t('min')}`);
const vehName = (id) => (t('veh.' + id) !== 'veh.' + id ? t('veh.' + id) : VEHICLES[id].name);
const GROUP_KEY = { 'DJI drone': 'grp.dji', 'FPV drone': 'grp.fpv', Uçak: 'grp.plane' };

// Araç önizlemeleri: her model ayrı küçük bir WebGL bağlamında bir kez çizilir, sonra bağlam kapatılır.
const thumbs = {};
function renderThumbs() {
  let r;
  try {
    r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return;
  }
  const W = 440;
  const H = 300;
  r.setSize(W, H, false);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.05;
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(0xe4ecff, 0x2a2f38, 2.2));
  const keyL = new THREE.DirectionalLight(0xffffff, 2.8);
  keyL.position.set(-2, 4, -3);
  const rimL = new THREE.DirectionalLight(0x9cc4ff, 1.6);
  rimL.position.set(3, 2, 4);
  sc.add(keyL, rimL);
  const cam = new THREE.PerspectiveCamera(26, W / H, 0.005, 50);
  cam.layers.enableAll();
  cam.layers.disable(2); // kokpit içi
  const dir = new THREE.Vector3(-0.75, 0.42, -1).normalize(); // önden-soldan, hafif yukarıdan
  const box = new THREE.Box3();
  const _tb = new THREE.Box3();
  const _hd = new THREE.Vector3();
  const sphere = new THREE.Sphere();
  for (const id of Object.keys(VEHICLES)) {
    try {
      const m = buildModelFor(id);
      for (const p of m.props || []) {
        if (p.disc) p.disc.visible = false;
        if (p.blade) p.blade.visible = true;
      }
      sc.add(m.root);
      m.root.updateMatrixWorld(true);
      // yalnız görünen parçalar (gizli yardımcılar ve pervane diskleri kadrajı büyütmesin)
      box.makeEmpty();
      m.root.traverseVisible((o) => {
        if (!o.isMesh || !o.geometry) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        box.union(_tb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
      });
      box.getBoundingSphere(sphere);
      cam.position.copy(sphere.center).addScaledVector(dir, (sphere.radius / Math.sin(THREE.MathUtils.degToRad(13))) * 0.82);
      cam.lookAt(sphere.center);
      r.render(sc, cam);
      thumbs[id] = r.domElement.toDataURL('image/png');
      // karşılama ekranı için büyük, alçaktan bakan görsel
      if (id === 'mini5') {
        r.setSize(W * 2, H * 2, false);
        cam.position.copy(sphere.center).addScaledVector(_hd.set(-0.9, 0.18, -1).normalize(), (sphere.radius / Math.sin(THREE.MathUtils.degToRad(13))) * 0.78);
        cam.lookAt(sphere.center);
        r.render(sc, cam);
        thumbs.hero = r.domElement.toDataURL('image/png');
        r.setSize(W, H, false);
      }
      sc.remove(m.root);
    } catch {}
  }
  r.dispose();
  r.forceContextLoss();
}
renderThumbs();

// Kumanda kaynakları: serve.py köprüsü (yerel DJI) > USB/Web Serial DJI (Chrome) > gamepad/RC verici > dokunmatik.
// Yayında köprü yoksa: <meta name="rc-bridge" content="off">
const rc = createControllers({
  // yerel USB köprüsü (serve.py) yalnız localhost'ta; yayında Web Serial / gamepad / klavye
  bridge: document.querySelector('meta[name="rc-bridge"]')?.content !== 'off' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname),
  gamepad: { preset: settings.gamepadPreset },
  touch: { labels: { takeoff: t('takeoff'), land: t('land'), rth: t('rth'), view: t('viewBtn'), fire: t('arena.fire') } },
});
const srcLabel = () =>
  ({ bridge: 'DJI RC-N3', serial: 'DJI RC-N3 (USB)', touch: t('srcTouch') })[rc.source] || rc.sourceName;
rc.onSource = (src) => document.body.classList.toggle('touch-ui', src === 'touch');
const input = new Input(rc, settings);
const hud = new Hud(world);

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---- görünüm
const VIEWS = ['fpv', 'chase'];
const viewName = () =>
  t(view === 'chase' ? 'view.chase' : drone.kind === 'plane' ? (VEHICLES[settings.drone].kind === 'real' ? 'view.cockpit' : 'view.nose') : 'view.drone');
// her uçuş drone'u sahnede gösteren takip kamerasıyla başlar (V ile değişir)
let view = 'chase';
const chasePos = new THREE.Vector3(0, 0.42, 1.0);
const _v = new THREE.Vector3();

// Kalkış (ev) noktası: yerde sarı H pisti + uzaktan görünen ince ışık sütunu
function makeHomePad() {
  const g = new THREE.Group();
  const flat = (mesh) => {
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 2;
    return mesh;
  };
  const mat = (opt) =>
    new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, ...opt });
  g.add(flat(new THREE.Mesh(new THREE.CircleGeometry(0.62, 40), mat({ color: 0x14171c, opacity: 0.55 }))));
  g.add(flat(new THREE.Mesh(new THREE.RingGeometry(0.62, 0.74, 48), mat({ color: 0xffd23f, opacity: 0.95 }))));
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#ffd23f';
  x.font = 'bold 104px system-ui, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('H', 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  g.add(flat(new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), mat({ map: tex }))));
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 60, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  beam.position.y = 30;
  g.add(beam);
  g.userData.beam = beam;
  return g;
}
const homePad = makeHomePad();
scene.add(homePad);
const _hp = new THREE.Vector3();
// Ekrandaki ev işareti: görünüyorsa yerinde, değilse ekran kenarında yön oku
function homeMarker() {
  const d = drone;
  const dist = Math.hypot(d.pos.x - d.home.x, d.pos.z - d.home.z);
  if (!started || dist < 8) return null;
  _hp.set(d.home.x, d.home.y + 1, d.home.z).project(camera);
  const W = innerWidth;
  const H = innerHeight;
  let x = (_hp.x * 0.5 + 0.5) * W;
  let y = (-_hp.y * 0.5 + 0.5) * H;
  const behind = _hp.z > 1;
  if (behind) {
    x = W - x;
    y = H - y;
  }
  const m = 46;
  const onScreen = !behind && x > m && x < W - m && y > m + 40 && y < H - m;
  let angle = 0;
  if (!onScreen) {
    const dx = x - W / 2;
    const dy = y - H / 2;
    angle = Math.atan2(dy, dx);
    const k = Math.min((W / 2 - m) / Math.max(1e-6, Math.abs(dx)), (H / 2 - m - 30) / Math.max(1e-6, Math.abs(dy)));
    x = W / 2 + dx * k;
    y = H / 2 + dy * k;
  }
  return { x, y, onScreen, angle, dist, rth: d.state === 'rth' };
}
const _w = new THREE.Vector3();

// Görünüm geçişi: kamera eski yerinden yenisine yumuşak kayar (ani sıçrama yok)
const camFrom = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 55, t0: -1 };
const CAM_BLEND = 0.6; // sn
const _tq = new THREE.Quaternion();
function cycleView() {
  if (started) {
    camFrom.pos.copy(camera.position).sub(drone.pos); // araca göre: hızlı uçarken geride kalmasın
    camFrom.quat.copy(camera.quaternion);
    camFrom.fov = camera.fov;
    camFrom.t0 = performance.now();
  }
  view = VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length];
  settings.view = view;
  save();
}

const _dir = new THREE.Vector3();
const chaseDir = new THREE.Vector3(0, 0, -1);
let camYaw = 0;
let camLift = 1.5;
let detailT0 = 0;
// Gerçek DJI kamera açısı: 82° çapraz → 16:9 ekranda yaklaşık 46° dikey. FPV geniş, kokpit orta.
// ---- bölgeyi önceden yükle (video çekimi için): kamera kalkış noktası çevresinde genişleyen spiral çizer,
// ayrıntılı karolar belleğe iner. Aynı sekmede çekim yapılır (karolar diske kalıcı kaydedilmez).
const WARM_MS = 75000;
let warm = null;
function startWarm(record = false) {
  if (!started || !realWorld) return hud.toast(t('warmNeedsReal'), 'warn', 3);
  toggleSettings(false);
  warm = { t0: performance.now(), last: -1, record };
  // tur videosu: kaydı tur başlarken aç, bitince kapat (dosya kendiliğinden iner); yalnız 3B görüntü kaydedilir
  if (record && !rec) toggleVideo();
}
function stopWarm(done) {
  const record = warm?.record;
  warm = null;
  if (record && rec) toggleVideo();
  hud.toast(t(done ? 'warmDone' : 'warmStopped'), 'info', done ? 6 : 3);
}
function warmCamera() {
  const k = (performance.now() - warm.t0) / WARM_MS;
  if (k >= 1) return stopWarm(true), false;
  const p = Math.floor(k * 100);
  if (p !== warm.last && p % 5 === 0) {
    warm.last = p;
    hud.toast(t('warmRunning', { p }), 'info', 2);
  }
  const h = drone.home;
  const r = 60 + 540 * k;
  const a = k * Math.PI * 6; // üç tur
  camera.layers.disable(1);
  camera.position.set(h.x + Math.sin(a) * r, h.y + 40 + 160 * k, h.z + Math.cos(a) * r);
  camera.lookAt(h.x + Math.sin(a + 0.6) * r * 0.5, h.y, h.z + Math.cos(a + 0.6) * r * 0.5);
  camera.fov = 60;
  camera.updateProjectionMatrix();
  return true;
}

function updateCamera(dt) {
  if (warm && warmCamera()) return;
  const d = drone;
  const f = d.forward(_v);
  const vSpec = VEHICLES[settings.drone];
  const sc = vSpec.type === 'plane' ? 1 : vSpec.scale || 1;
  if (!started && realWorld && !world.ready && world.stage === 'A') {
    camera.layers.disable(1);
    camera.position.set(0.01, 3500, 0);
    camera.lookAt(0, 0, 0);
    camera.fov = 55;
    camera.updateProjectionMatrix();
    return;
  }
  if (!started && realWorld && world.phase === 'detay') {
    // ayrıntı yüklenirken kamera kalkış noktasının çevresinde 90 m yarıçapta, 50 m yukarıda yavaşça döner
    // (40 sn'de bir tur, kalkış yönünün arkasından başlar). Google 3D yukarıdan net görünür; dönüş çevreyi de yükler.
    if (!detailT0) detailT0 = performance.now();
    const a = (world.startYaw || 0) + ((performance.now() - detailT0) / 40000) * Math.PI * 2;
    const g0 = world.groundAt(0, 0, 50);
    camera.layers.disable(1);
    camera.position.set(Math.sin(a) * 90, g0 + 50, Math.cos(a) * 90);
    camera.lookAt(0, g0 + 8, 0);
    camera.fov = 55;
    camera.updateProjectionMatrix();
    return;
  }
  if (!started && realWorld) {
    const a = performance.now() / 1000 * 0.12;
    camera.layers.enable(1);
    camera.layers.enable(3);
    camera.position.set(Math.sin(a) * 70, d.home.y + 45, Math.cos(a) * 70);
    camera.lookAt(0, d.home.y + 4, 0);
    camera.fov = 55;
    camera.updateProjectionMatrix();
    return;
  }
  const crashedQuad = d.state === 'crashed' && d.kind !== 'plane';
  if (view === 'fpv' && d.kind === 'drone') {
    // DJI: kamera burnun altında gimbalde; ufuk hep düz, yön dönüşleri yumuşak takip
    camera.layers.disable(1);
    camera.layers.disable(2);
    camera.layers.disable(3);
    camYaw += Math.atan2(Math.sin(d.yaw - camYaw), Math.cos(d.yaw - camYaw)) * (1 - Math.exp(-dt / 0.12));
    camera.position.copy(d.pos).addScaledVector(f, 0.1 * sc);
    camera.position.y -= 0.03 * sc;
    camera.rotation.set(d.gimbal * DEG, camYaw, 0);
    // Gerçek dünya modelleri (Google, OSM arazisi) engebeli ve yer seviyesinde yakından bulanık: yerdeyken kamera
    // göz hizasında (1,5 m), havadayken en az 0,45 m yukarıda; geçiş yumuşak.
    if (realWorld) {
      camLift += ((d.airborne ? 0.45 : 1.5) - camLift) * (1 - Math.exp(-dt / 0.6));
      camera.position.y = Math.max(camera.position.y, world.groundAt(camera.position.x, camera.position.z, camera.position.y + 2) + camLift);
    }
    if (crashedQuad) {
      camera.rotation.x += d.crash.rot.x;
      camera.rotation.z = d.crash.rot.z;
    }
    camera.fov = 46;
  } else if (view === 'fpv' && !crashedQuad) {
    // gövdeye bağlı: FPV'de yukarı eğik geniş açı, uçakta kokpit / burun.
    // Uçakta kanat ve pervane görünür (gövdenin içi arka yüz olduğu için çizilmez), Cessna'da kokpit de.
    if (d.kind === 'plane') camera.layers.enable(1);
    else camera.layers.disable(1);
    camera.layers.enable(2);
    camera.layers.disable(3);
    const real = d.kind === 'plane' && vSpec.kind === 'real';
    if (d.kind === 'plane') _dir.set(real ? -0.35 : 0, real ? 0.72 : 0.12, real ? -1.0 : -0.42);
    else _dir.set(0, 0.012 * sc, -0.09 * sc);
    camera.position.copy(d.pos).add(_dir.applyQuaternion(d.quat));
    camera.quaternion.copy(d.quat);
    camera.rotateX((d.kind === 'plane' ? (real ? -6 : -3) : d.camPitch) * DEG);
    camera.fov = d.kind === 'fpv' ? 85 : real ? 62 : 60;
    camYaw = d.yaw;
  } else {
    // takip: aracın arkasından, ufuk düz, yumuşak gecikmeli
    camera.layers.enable(1);
    camera.layers.disable(2);
    camera.layers.enable(3);
    const real = d.kind === 'plane' && vSpec.kind === 'real';
    // Mesafe sabit, yalnız yön yumuşatılır; böylece hız arttıkça kamera geride kalmaz.
    const dist = d.kind === 'plane' ? (real ? 26 : 3.8) : 2.4 * sc;
    const up = d.kind === 'plane' ? (real ? 6.5 : 1.0) : 0.8 * sc;
    const heading = d.kind === 'plane' ? d.forward(_dir) : _dir.copy(f);
    heading.y = d.kind === 'plane' ? heading.y * 0.5 : 0;
    heading.normalize();
    chaseDir.lerp(heading, 1 - Math.exp(-dt / 0.3)).normalize();
    _w.copy(d.pos).addScaledVector(chaseDir, -dist);
    _w.y += up;
    _w.y = Math.max(_w.y, world.groundAt(_w.x, _w.z, _w.y) + 0.4);
    chasePos.copy(_w);
    camera.position.copy(_w);
    camera.up.set(0, 1, 0);
    camera.lookAt(_w.copy(d.pos).addScaledVector(chaseDir, dist * 0.5).setY(d.pos.y + up * 0.3));
    camera.fov = 55;
    camYaw = d.yaw;
  }
  if (camFrom.t0 >= 0) {
    const k = Math.min(1, (performance.now() - camFrom.t0) / (CAM_BLEND * 1000));
    if (k >= 1) camFrom.t0 = -1;
    else {
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; // yavaş başla, yavaş bitir
      camera.position.lerpVectors(_w.copy(camFrom.pos).add(d.pos), camera.position, e);
      _tq.copy(camera.quaternion);
      camera.quaternion.slerpQuaternions(camFrom.quat, _tq, e);
      camera.fov = camFrom.fov + (camera.fov - camFrom.fov) * e;
      // kendi araç geçişin çoğunda görünsün (kameranın içinden geçtiği son anda gizlenir)
      if (e < 0.85) camera.layers.enable(1);
    }
  }
  // arena: vurulunca kısa sarsıntı (konum titremesi + hafif yatış)
  if (arena.shake > 0.01) {
    const s = arena.shake * (vSpec.scale || 1);
    camera.position.x += (Math.random() - 0.5) * 0.12 * s;
    camera.position.y += (Math.random() - 0.5) * 0.12 * s;
    camera.position.z += (Math.random() - 0.5) * 0.12 * s;
    camera.rotateZ((Math.random() - 0.5) * 0.05 * arena.shake);
  }
  camera.updateProjectionMatrix();
}


function updateModel(dt, t) {
  const d = drone;
  model.root.position.copy(d.pos);
  if (d.state === 'crashed' && d.kind !== 'plane') {
    model.root.rotation.set(d.crash.rot.x, d.yaw + d.crash.rot.y, d.crash.rot.z);
    model.body.rotation.set(0, 0, 0);
  } else if (d.kind === 'drone') {
    model.root.rotation.set(0, d.yaw, 0);
    model.body.rotation.set(-d.tiltF * DEG, 0, -d.tiltR * DEG);
  } else {
    model.root.quaternion.copy(d.quat);
    model.body.rotation.set(0, 0, 0);
  }
  if (model.gimbal) model.gimbal.rotation.x = (d.gimbal + d.tiltF) * DEG;
  for (const p of model.props) {
    p.prop.rotation.y += p.dir * d.prop * (d.kind === 'plane' ? 45 : 70) * dt;
    // içeriden bakınca pervane diski neredeyse görünmez (gerçekte de öyle)
    const onboard = view === 'fpv' && started && d.kind === 'plane';
    p.disc.material.opacity = d.prop * (onboard ? 0.05 : 0.35);
    p.blade.visible = d.prop < 0.5;
  }
  if (model.ledBack) model.ledBack.emissiveIntensity = Math.sin(t * 7) > 0 ? 2.5 : 0.15;
  if (world.towerLight) world.towerLight.material.emissiveIntensity = Math.sin(t * 3) > 0 ? 2.5 : 0.2;
}

// ---- eylemler
function setMode(m) {
  drone.mode = m;
  settings.mode = m;
  save();
  hud.toast(t('toast.mode', { name: drone.modeName?.(m) ?? MODES[m].name }));
}

function reset() {
  drone.reset();
  world.resetCourse();
  chasePos.set(0, 0.42, 1.0);
  chaseDir.set(-Math.sin(drone.yaw), 0, -Math.cos(drone.yaw));
  hud.toast(t('toast.restarted'));
  arenaRespawn();
}

// ---- lazer arena (yalnız settings.arena açık ve odaya bağlıyken; serbest uçuşta hiçbir şey değişmez)
const lasers = new Lasers(scene);
const arena = { hits: 0, shieldUntil: 0, respawnAt: 0, lastFire: 0, shake: 0 };
const arenaActive = () => !!net && settings.arena;
const _aim = new THREE.Vector3();
const _aq = new THREE.Quaternion();
const _ax = new THREE.Vector3(1, 0, 0);
// Bakış yönü: DJI drone'da yön + gimbal eğimi; FPV'de gövde quat'ı + kamera eğimi (updateCamera ile aynı)
function aimDir(out) {
  const d = drone;
  if (d.kind === 'fpv' && d.quat) {
    _aq.setFromAxisAngle(_ax, (d.camPitch ?? d.gimbal) * DEG);
    return out.set(0, 0, -1).applyQuaternion(_aq).applyQuaternion(d.quat).normalize();
  }
  const g = d.gimbal * DEG;
  return out.set(-Math.sin(d.yaw) * Math.cos(g), Math.sin(g), -Math.cos(d.yaw) * Math.cos(g));
}
// Ateş: yalnız havadayken; 250 ms yerel aralık. Gönderildiyse kendi çizgimiz + ses; true döner.
function fire() {
  const now = performance.now();
  if (!arenaActive() || !drone.airborne || now - arena.lastFire < FIRE_MS) return false;
  const r = (x, n) => Math.round(x * n) / n;
  const dir = aimDir(_aim);
  const p = [r(drone.pos.x, 100), r(drone.pos.y, 100), r(drone.pos.z, 100)];
  const d = [r(dir.x, 1e4), r(dir.y, 1e4), r(dir.z, 1e4)];
  if (!net.fire(p, d)) return false;
  arena.lastFire = now;
  lasers.fire(p, d, colorFor(net.id), now);
  arena.shake = Math.max(arena.shake, 0.22); // hafif geri tepme
  if (settings.sound) zapSound(sound.ctx, settings.volume);
  return true;
}
// Başka pilot ateş etti: çizgi + ses; ışın bizim küremize değiyorsa (havada, dokunulmaz değil) sunucuya "vuruldum"
function onPeerFire(peer, p, d) {
  const now = performance.now();
  const color = colorFor(peer.id);
  const dist = Math.hypot(p[0] - drone.pos.x, p[1] - drone.pos.y, p[2] - drone.pos.z);
  if (settings.sound) zapSound(sound.ctx, settings.volume * Math.min(1, 30 / Math.max(1, dist)));
  // 2 m'den yakından (aynı kalkış pistinde iç içe dururken) isabet sayılmaz
  const radius = hitRadius(VEHICLES[settings.drone]?.scale || 1);
  const can = peer.id !== net.id && drone.airborne && now >= arena.shieldUntil && dist >= 2;
  const t = can ? rayHitsSphere(p, d, [drone.pos.x, drone.pos.y, drone.pos.z], radius, RANGE) : -1;
  if (t < 0) return lasers.fire(p, d, color, now);
  // ışın bizde biter: mermi gövdemize kadar gelir, isabet noktasında kıvılcım
  lasers.fire(p, d, color, now, t);
  if (!net.hit(peer.id)) return;
  lasers.impact([p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t], color, now);
  arena.hits++;
  arena.shake = 1;
  const fl = $('hitFlash');
  fl.classList.add('on');
  requestAnimationFrame(() => requestAnimationFrame(() => fl.classList.remove('on')));
  if (settings.sound) hitSound(sound.ctx, settings.volume);
  if (arena.hits >= LIVES) {
    drone._crash('crash.laser');
    arena.respawnAt = now + RESPAWN_MS;
  }
}
// Yeniden başlayınca: sayaç sıfır, kısa dokunulmazlık (serbest uçuşta etkisiz)
function arenaRespawn() {
  arena.hits = 0;
  arena.respawnAt = 0;
  arena.shieldUntil = arenaActive() ? performance.now() + SHIELD_MS : 0;
}
// Skor satırları: isabete göre sıralı, en çok 8, ben hep listede
function arenaRows() {
  const me = { id: net.id, name: pilotName(), k: net.me.k, d: net.me.d, me: true };
  const rows = [me, ...[...net.peers.values()].map((p) => ({ id: p.id, name: p.name, k: p.k, d: p.d, me: false }))];
  rows.sort((a, b) => b.k - a.k || a.d - b.d || a.id - b.id);
  const top = rows.slice(0, 8);
  if (!top.includes(me)) top[top.length - 1] = me;
  for (const r of top) r.color = colorFor(r.id);
  return top;
}

let photoPending = false;
let rec = null;
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function savePhoto() {
  canvas.toBlob((b) => b && download(b, `drone-foto-${stamp()}.jpg`), 'image/jpeg', 0.92);
  const fl = $('flash');
  fl.classList.add('on');
  requestAnimationFrame(() => requestAnimationFrame(() => fl.classList.remove('on')));
}

function toggleVideo() {
  if (rec) {
    rec.r.stop();
    return;
  }
  const type = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find((t) =>
    MediaRecorder.isTypeSupported(t),
  );
  if (!type) return hud.toast(t('toast.noVideo'), 'warn');
  const chunks = [];
  const r = new MediaRecorder(canvas.captureStream(60), { mimeType: type, videoBitsPerSecond: 20e6 });
  r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  r.onstop = () => {
    download(new Blob(chunks, { type }), `drone-video-${stamp()}.${type.startsWith('video/mp4') ? 'mp4' : 'webm'}`);
    rec = null;
    hud.toast(t('toast.videoSaved'));
  };
  r.start(1000);
  rec = { r, t0: performance.now() };
}

const ACTIONS = {
  KeyT: () => drone.takeoff(),
  KeyL: () => drone.land(),
  KeyH: () => drone.toggleRth(),
  KeyV: cycleView,
  Digit1: () => setMode('C'),
  Digit2: () => setMode('N'),
  Digit3: () => setMode('S'),
  KeyP: () => (photoPending = true),
  Space: fire, // yalnız lazer arenada; serbest uçuşta etkisiz
  KeyK: toggleVideo,
  KeyM: () => {
    settings.sound = !settings.sound;
    sound.muted = !settings.sound;
    $('setSound').checked = settings.sound;
    save();
    hud.toast(t(settings.sound ? 'toast.soundOn' : 'toast.soundOff'));
  },
  Enter: reset,
  Escape: () => (warm ? stopWarm(false) : toggleSettings()),
  Backquote: () => {
    settings.debug = !settings.debug;
    $('setDebug').checked = settings.debug;
    save();
    if (settings.debug) setRcPanel(true, false);
  },
  KeyC: () => setRcPanel(!settings.rcPanel, true),
  // video modu: tüm göstergeler ve H pisti gizlenir (Google/OSM telif satırı kalır)
  KeyU: () => {
    const on = document.body.classList.toggle('clean');
    homePad.visible = !on;
  },
};
input.onAction = (code, e) => {
  if (!$('start').classList.contains('hidden')) return;
  if (code === 'Space' && arenaActive()) e?.preventDefault(); // odaklı HUD düğmesi tetiklenmesin
  ACTIONS[code]?.();
};

// Kumanda test ve ayar ekranı (Ayarlar > Kumanda, başlangıç ekranındaki kumanda rozeti, uçuştaki kumanda paneli)
const rcSetup = createRcSetup({
  rc,
  settings,
  save,
  onChange: (kind) => {
    if (kind === 'invert') document.querySelectorAll('[data-inv]').forEach((el) => (el.checked = settings.invert[el.dataset.inv]));
  },
});
for (const id of ['openRcSetup', 'rcBadge']) $(id).onclick = () => rcSetup.open();

rc.onMode = (m) => {
  if (rcSetup.isOpen) return; // test sırasında anahtar oynatılınca mod değişmesin
  if (drone.mode !== m) setMode(m);
};
rc.onButton = (b) => {
  if (!started || rcSetup.isOpen) return;
  if (b === 'fn') drone.state === 'crashed' ? reset() : cycleView();
  else if (b === 'rth') drone.state === 'crashed' ? reset() : drone.toggleRth();
  else if (b === 'photo') arenaActive() ? fire() : (photoPending = true); // kumandada fotoğraf tuşu arenada ateş
  else if (b === 'fire') fire(); // dokunmatik ateş düğmesi
  else if (b === 'camera') toggleVideo();
  else if (b === 'takeoff') drone.state === 'crashed' ? reset() : drone.takeoff();
  else if (b === 'land') drone.land();
  else if (b === 'view') cycleView();
  else if (b === 'modeUp' && arenaActive()) fire(); // oyun kolu: RB (tetikler gimbal tekeri olduğundan) arenada ateş
  else if (b === 'modeUp' || b === 'modeDown') {
    const order = ['C', 'N', 'S'];
    const i = order.indexOf(drone.mode) + (b === 'modeUp' ? 1 : -1);
    setMode(order[Math.max(0, Math.min(2, i))]);
  }
};

// ---- kalkış rehberi: kaynağa göre (kumanda / klavye / dokunmatik) nasıl kalkılır
let coachDone = false;
const KEYCAP = (k) => `<kbd>${k}</kbd>`;
function renderCoach() {
  const src = rc.live ? rc.source : 'keyboard';
  let html;
  if (src === 'touch') html = `<p>${t('coachTouch')}</p>`;
  else if (src === 'keyboard')
    html =
      `<ul class="coach-keys">` +
      `<li>${KEYCAP('T')}<span>${t('coachKeyT')}</span></li>` +
      `<li>${KEYCAP('W')}${KEYCAP('S')}<span>${t('coachKeyWS')}</span></li>` +
      `<li>${KEYCAP('A')}${KEYCAP('D')}<span>${t('coachKeyAD')}</span></li>` +
      `<li>${KEYCAP('↑')}${KEYCAP('↓')}${KEYCAP('←')}${KEYCAP('→')}<span>${t('coachKeyArrows')}</span></li>` +
      `<li>${KEYCAP('L')}${KEYCAP('H')}<span>${t('coachKeyLH')}</span></li></ul>`;
  else
    html =
      `<div class="coach-csc"><svg viewBox="0 0 160 70" aria-hidden="true">` +
      `<rect x="4" y="4" width="62" height="62" rx="10"/><rect x="94" y="4" width="62" height="62" rx="10"/>` +
      `<circle cx="35" cy="35" r="5" class="dot0"/><circle cx="125" cy="35" r="5" class="dot0"/>` +
      `<path d="M35 35 L52 54" class="arr"/><path d="M125 35 L108 54" class="arr"/>` +
      `<circle cx="52" cy="54" r="7" class="dot1"/><circle cx="108" cy="54" r="7" class="dot1"/></svg>` +
      `<p>${t('coachRc')}</p></div><p class="coach-or">${t('coachOr')}</p>`;
  $('coachBody').innerHTML = html;
}

// ---- sesli uyarı (DJI Fly gibi): kısa bip + seçili dilde konuşma; ses kapalıysa sessiz
const SPOKEN = new Set(['ev.autoTakeoff', 'ev.autoLand', 'ev.rth', 'ev.landed', 'ev.batt25', 'ev.battLand', 'ev.battCritLand', 'ev.rthCancel']);
function chime() {
  const c = sound.ctx;
  if (!c || c.state !== 'running') return;
  const t0 = c.currentTime;
  for (const [f, dt] of [[880, 0], [1320, 0.13]]) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t0 + dt);
    g.gain.linearRampToValueAtTime(0.18 * settings.volume, t0 + dt + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.22);
    o.connect(g).connect(c.destination);
    o.start(t0 + dt);
    o.stop(t0 + dt + 0.25);
  }
}
function announce(key, vars) {
  if (!settings.sound || !SPOKEN.has(key)) return;
  chime();
  if (!('speechSynthesis' in window)) return;
  const code = { tr: 'tr-TR', en: 'en-US', de: 'de-DE' }[lang()] || 'en-US';
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.replace('_', '-').startsWith(code.slice(0, 2)));
  const u = new SpeechSynthesisUtterance(t(key, vars));
  u.lang = code;
  u.voice = voices.find((v) => /premium|enhanced|siri|natural/i.test(v.name)) || voices.find((v) => v.lang.replace('_', '-') === code) || voices[0] || null;
  u.volume = Math.min(1, settings.volume + 0.2);
  u.rate = 1.02;
  setTimeout(() => {
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }, 300);
}

// kumanda paneli (sağ alt): çubuklar, değerler, ayrıntı; başlığa tıkla ya da C
function setRcPanel(open, toast) {
  settings.rcPanel = open;
  save();
  $('rcPanel').classList.toggle('open', open);
  $('setRcPanel').checked = open;
  if (toast) hud.toast(t(open ? 'toast.rcPanelOn' : 'toast.rcPanelOff'), 'info', 2);
}
$('rcPanel').classList.toggle('open', !!settings.rcPanel);
$('setRcPanel').checked = !!settings.rcPanel;
$('setRcPanel').onchange = (e) => setRcPanel(e.target.checked, false);
$('rcPanelHead').onclick = () => setRcPanel(!settings.rcPanel, false);

$('btnTakeoff').onclick = () => drone.takeoff();
$('btnLand').onclick = () => drone.land();
$('btnRth').onclick = () => drone.toggleRth();
$('btnView').onclick = cycleView;
$('btnReset').onclick = reset;
$('mode').onclick = () => setMode({ C: 'N', N: 'S', S: 'C' }[drone.mode]);

// ---- başlangıç ekranı
const startMsg = (text, ok = false) => {
  const m = $('startMsg');
  m.textContent = text;
  m.className = `msg ${ok ? 'ok' : ''}`;
};

let started = false;
function begin() {
  // ad alanında kalan odak klavye kumandasını yutmasın
  if (document.activeElement?.closest?.('input, select, textarea')) document.activeElement.blur();
  $('welcome').classList.add('hidden');
  $('start').classList.add('hidden');
  $('loading').classList.add('hidden');
  lobby.stop();
  renderCoach();
  document.body.classList.remove('prestart');
  started = true;
  if (realWorld) hud.toast(t('toast.welcome', { city: placeLabel(settings.place).split(' · ')[0] }), 'info', 4);
  setOnline(settings.online);
}

// ---- online odalar (rooms.py). Yayında <meta name="rooms-url" content="wss://..."> ile adres verilir.
const ROOMS_URL =
  document.querySelector('meta[name="rooms-url"]')?.content ||
  (/^(localhost|127\.0\.0\.1|\[::1\])?$/.test(location.hostname)
    ? `ws://${location.hostname || 'localhost'}:8766`
    : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/rooms`);
// Hazır yerlerde oda adı koordinattır (lobide gösterilir). Kendi konumu / elle girilen koordinatta
// gerçek konum paylaşılmasın diye yalnız koordinattan üretilen kısa bir kod kullanılır.
const isPreset = (p) => PLACES.some((q) => q.lat === p?.lat && q.lon === p?.lon);
function placeCode(p) {
  let h = 0x811c9dc5;
  for (const ch of `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}
// Lazer arena açıksa oda adı ':arena' ile biter (köy dahil): aynı yer, ayrı oda
const roomName = () =>
  (world.kind === 'village'
    ? 'village'
    : isPreset(settings.place)
      ? `${world.kind}:${settings.place.lat.toFixed(4)},${settings.place.lon.toFixed(4)}`
      : `${world.kind}:c${placeCode(settings.place)}`) + (settings.arena ? ':arena' : '');
let net = null;
const ghosts = new Ghosts(scene, (id) => buildModelFor(id), (id) => {
  const v = VEHICLES[id] || VEHICLES.mini5;
  return v.type === 'plane' ? (v.kind === 'real' ? 4 : 0.7) : 0.35 * (v.scale || 1);
});
function pilotName() {
  if (!settings.pilotName) {
    settings.pilotName = `Pilot ${100 + Math.floor(Math.random() * 900)}`;
    save();
  }
  return settings.pilotName;
}
function setOnline(on) {
  if (!on || !started) {
    net?.close();
    net = null;
    ghosts.clear();
    return;
  }
  if (net) return;
  net = new NetClient({ url: ROOMS_URL, room: roomName(), name: pilotName(), vehicle: settings.drone, isVehicle: (v) => Object.hasOwn(VEHICLES, v) });
  net.onJoin = (p) => hud.toast(t('toast.joined', { name: p.name }), 'info', 3);
  net.onLeave = (p) => hud.toast(t('toast.left', { name: p.name }), 'info', 3);
  // lazer arena: başkasının ateşi (çizgi + isabet), isabet bildirimi (skorlar net.me / peers'ta güncel)
  net.onFire = (p, pos, dir) => {
    if (settings.arena) onPeerFire(p, pos, dir);
  };
  net.onHit = (h) => {
    if (!settings.arena) return;
    const nameOf = (id) => (id === net.id ? pilotName() : net.peers.get(id)?.name || 'Pilot');
    if (h.id === net.id) hud.toast(t('arena.hitYou', { name: nameOf(h.by) }), 'bad', 2);
    else if (h.by === net.id) hud.toast(t('arena.youHit', { name: nameOf(h.id) }), 'info', 2);
    else hud.toast(t('arena.hit', { a: nameOf(h.by), b: nameOf(h.id) }), 'info', 2);
  };
  arenaRespawn();
}
const _nq = new THREE.Quaternion();
function sendOnline() {
  if (!net) return;
  // görünen yön: kök (yön/takla) × gövde (eğim)
  _nq.copy(model.root.quaternion).multiply(model.body.quaternion);
  const r = (x, n) => Math.round(x * n) / n;
  net.send({
    p: [r(drone.pos.x, 100), r(drone.pos.y, 100), r(drone.pos.z, 100)],
    q: [r(_nq.x, 1e4), r(_nq.y, 1e4), r(_nq.z, 1e4), r(_nq.w, 1e4)],
    pr: r(drone.state === 'crashed' ? 0 : drone.prop, 100),
    s: drone.state,
    v: settings.drone,
  });
}

// Sayfa arka plandayken (başka sekme / örtülü pencere) tarayıcı çizimi durdurur; diğer pilotlar bizi
// kaybetmesin diye saniyede bir son durumu yolla
setInterval(() => {
  if (started && net && document.hidden) sendOnline();
}, 1000);

// ---- yükleme ekranı (gerçek dünya hazırlanırken)
const TIPS = ['tip1', 'tip2', 'tip3', 'tip4', 'tip5', 'tip6', 'tip7'];
let tipIdx = Math.floor(Math.random() * TIPS.length);
let tipT = 0;
let ldShown = 0; // ilerleme çubuğu geri gitmesin
function showLoading(on) {
  $('loading').classList.toggle('hidden', !on);
  $('start').classList.toggle('hidden', on);
  if (!on) return;
  const [city, spot] = placeLabel(settings.place).split(' · ');
  $('ldPlace').textContent = city;
  $('ldSpot').textContent = spot || '';
  ldShown = 0;
}
function refreshLoading(now) {
  if ($('loading').classList.contains('hidden')) return;
  const err = world.phase === 'hata';
  $('ldError').classList.toggle('hidden', !err);
  $('ldTip').classList.toggle('hidden', err);
  $('ldFix').classList.toggle('hidden', !err);
  const osmLike = world.kind === 'osm' || world.kind === 'sat';
  if (err) $('ldError').textContent = t(osmLike ? 'ldErrorOsm' : 'ldError', { err: world.error });
  document.querySelector('.ld-steps [data-step=connected]').textContent = t(osmLike ? 'stepConnectOsm' : 'stepConnect');
  $('ldFix').classList.toggle('hidden', !err || world.kind !== 'google');
  const L = world.loading || { connected: true, tiles: 1, ground: 1 };
  const detail = L.detail ?? 1;
  const pct = err ? ldShown : 0.1 * (L.connected ? 1 : 0.3) + 0.5 * (L.connected ? L.tiles : 0) + 0.2 * L.ground + 0.2 * detail;
  ldShown = Math.max(ldShown, pct);
  $('ldFill').style.width = `${Math.round(ldShown * 100)}%`;
  const done = { connected: L.connected, tiles: L.connected && L.ground >= 0.5, ground: L.ground >= 1, detail: detail >= 1 };
  let activeSet = false;
  document.querySelectorAll('.ld-steps li').forEach((li) => {
    const d = done[li.dataset.step];
    li.classList.toggle('done', d);
    li.classList.toggle('active', !d && !activeSet && !err);
    li.classList.toggle('fail', !d && !activeSet && err);
    if (!d) activeSet = true;
  });
  $('loading').classList.toggle('dim', !L.connected || world.phase === 'yükleniyor' || err);
  if (now - tipT > 4500) {
    tipT = now;
    $('ldTip').textContent = t(TIPS[tipIdx++ % TIPS.length]);
  }
}
$('ldCancel').onclick = () => {
  wantStart = false;
  showLoading(false);
};
$('ldFix').onclick = () => {
  wantStart = false;
  showLoading(false);
  pick.world = 'google';
  $('keyForm').classList.remove('hidden');
  $('gKey').focus();
};

// "Yükle ve başla" sayfayı yeniler; yenilenince hazır olur olmaz kendiliğinden başlar.
const AUTOSTART = 'dji-sim-autostart';
let wantStart = false;
let autoArena = false; // yalnız "Yükle ve başla" yenilemesinde, kullanıcının o oturumda seçtiği lazer arena korunur
try {
  const v = sessionStorage.getItem(AUTOSTART);
  if (v) {
    sessionStorage.removeItem(AUTOSTART);
    wantStart = true;
    autoArena = v === 'arena';
  }
} catch {}

// Seçim Başla'ya basınca uygulanır.
const pick = { world: settings.world, place: settings.place };
// Adımlar: önce araç, sonra konum seçilmeden Başla açılmaz (otomatik başlatmada seçim zaten yapılmış)
const steps = { vehicle: wantStart, place: wantStart };
function markStep(name) {
  steps[name] = true;
  document.querySelectorAll('.l-tabs button').forEach((b) => b.classList.toggle('done', !!steps[b.dataset.tab]));
  refreshStart();
}
const samePlace = (a, b) => !!a && !!b && a.lat === b.lat && a.lon === b.lon;

const segBtns = document.querySelectorAll('button[data-world]');
function renderWorld() {
  segBtns.forEach((b) => b.classList.toggle('on', b.dataset.world === pick.world));
  $('realBox').classList.toggle('hidden', pick.world === 'village');
  // açıklama yalnız köyde (gerçek dünyada yer listesi zaten görünür)
  $('villageNote').textContent = pick.world === 'village' ? t('villageNote') : pick.world === 'google' ? t('googleNote') : '';
  renderKey();
  renderSummary();
}

// sağdaki özet: seçili araç, yer, harita
function renderSummary() {
  const v = VEHICLES[settings.drone];
  $('sumImg').src = thumbs[settings.drone] || '';
  $('sumImg').alt = vehName(settings.drone);
  $('sumName').textContent = vehName(settings.drone);
  $('sumSpec').textContent = `${kmh(v.top * settings.speedMul)} ${t('kmh')} ${t('maxSpeed')} · ${durLabel(v.flightMin)}`;
  $('sumPlace').textContent = pick.world === 'village' ? t('worldVillage') : placeLabel(pick.place);
  $('sumMap').textContent = t({ village: 'worldVillage', osm: 'worldOsm', sat: 'worldSat', google: 'worldGoogle' }[pick.world] || 'worldOsm');
  $('sumMap').parentElement.classList.toggle('hidden', pick.world === 'village');
  $('sumModeRow').classList.toggle('hidden', !settings.arena);
  $('sumMode').textContent = t('modeArena');
  // sekme başlıklarında güncel seçim
  $('tabVehicle').textContent = vehName(settings.drone).replace('DJI ', '');
  $('tabPlace').textContent = pick.world === 'village' ? t('worldVillage') : placeLabel(pick.place).split(' · ')[0];
}
segBtns.forEach((b) => {
  b.onclick = () => {
    pick.world = b.dataset.world;
    renderWorld();
    renderPlaces();
    if (pick.world === 'village') markStep('place');
    refreshStart();
  };
});

const lower = (txt) => txt.toLocaleLowerCase('tr');
const PLACE_GROUPS = [...new Set(PLACES.map((p) => p.group))];
let placeTab = PLACE_GROUPS.includes(pick.place?.group) ? pick.place.group : PLACE_GROUPS[0];
function renderPlaceTabs(searching) {
  $('dimLegend').classList.toggle('hidden', pick.world !== 'google');
  const tabs = $('placeTabs');
  tabs.replaceChildren();
  tabs.classList.toggle('hidden', searching);
  for (const g of PLACE_GROUPS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = g === placeTab ? 'on' : '';
    b.textContent = t('pg.' + g);
    const n = document.createElement('em');
    n.textContent = PLACES.filter((p) => p.group === g).length;
    b.append(n);
    b.onclick = () => {
      placeTab = g;
      renderPlaces();
    };
    tabs.append(b);
  }
}
function renderPlaces() {
  const q = lower($('placeSearch').value.trim());
  const grid = $('placeGrid');
  grid.replaceChildren();
  renderPlaceTabs(!!q);
  renderSummary();
  let group = null;
  let shown = 0;
  for (const p of PLACES) {
    const label = placeLabel(p);
    if (q && !lower(`${label} ${p.name} ${t('pg.' + p.group)}`).includes(q)) continue;
    if (!q && p.group !== placeTab) continue;
    if (q && p.group !== group) {
      group = p.group;
      const h = document.createElement('h3');
      h.textContent = t('pg.' + group);
      grid.append(h);
    }
    const [city, spot] = label.split(' · ');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `place${samePlace(p, pick.place) ? ' on' : ''}`;
    const nameEl = document.createElement('b');
    nameEl.textContent = city;
    const sub = document.createElement('span');
    sub.textContent = spot || '';
    btn.append(nameEl, sub);
    // Google 3D seçiliyken: fotogerçekçi bina modeli var mı (3D) yoksa arazi + uydu mu (2D)
    if (pick.world === 'google' && p.g3d !== undefined) {
      const b3 = document.createElement('i');
      b3.className = `dim-badge ${p.g3d ? 'd3' : 'd2'}`;
      b3.textContent = p.g3d ? '3D' : '2D';
      btn.append(b3);
    }
    btn.onclick = () => {
      pick.place = p;
      placeTab = p.group;
      markStep('place');
      $('coord').value = '';
      renderPlaces();
      refreshStart();
    };
    grid.append(btn);
    shown++;
  }
  if (!shown) {
    const e = document.createElement('p');
    e.className = 'place-empty';
    e.textContent = t('placeEmpty');
    grid.append(e);
  }
}
$('placeSearch').oninput = renderPlaces;

// Kendi konumundan başla: izin yalnız düğmeye basınca istenir, konum yalnız bu tarayıcıda saklanır
$('myLocBtn').onclick = () => {
  const msg = $('locMsg');
  if (!navigator.geolocation) {
    msg.textContent = t('locFailed');
    return;
  }
  msg.textContent = t('locLocating');
  $('myLocBtn').disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      $('myLocBtn').disabled = false;
      msg.textContent = '';
      const r = (v) => Math.round(v * 1e5) / 1e5;
      pick.place = {
        group: 'custom',
        name: 'Konumum',
        names: { en: 'My location', de: 'Mein Standort' },
        mine: true,
        lat: r(pos.coords.latitude),
        lon: r(pos.coords.longitude),
      };
      if (pick.world === 'village') pick.world = 'sat';
      $('coord').value = '';
      markStep('place');
      renderWorld();
      renderPlaces();
      refreshStart();
    },
    (err) => {
      $('myLocBtn').disabled = false;
      msg.textContent = t(err.code === 1 ? 'locDenied' : 'locFailed');
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
  );
};
if (!PLACES.some((p) => samePlace(p, settings.place))) {
  $('coord').value = `${settings.place.lat}, ${settings.place.lon}`;
  $('coord').closest('details').open = true;
}
$('coord').oninput = () => {
  const m = $('coord').value.match(/(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
  pick.place = { group: 'custom', name: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, lat, lon };
  markStep('place');
  renderPlaces();
  refreshStart();
};

function renderKey() {
  // anahtar yalnız Google 3D için
  const google = pick.world === 'google';
  document.querySelector('.key-row').classList.toggle('hidden', !google);
  // anahtar yoksa ya da değiştirilirken rehber görünür
  $('keyGuide').classList.toggle('hidden', !google || (!!settings.gKey && $('keyForm').classList.contains('hidden')));
  if (google && !settings.gKey) $('keyGuide').open = true;
  if (!google) return $('keyForm').classList.add('hidden');
  const has = !!settings.gKey;
  $('keyState').textContent = t(has ? 'keySaved' : 'keyNeeded');
  $('keyEdit').classList.toggle('hidden', !has);
  $('keyForm').classList.toggle('hidden', has && world.phase !== 'hata');
}
$('keyEdit').onclick = () => {
  $('keyForm').classList.remove('hidden');
  $('keyGuide').classList.remove('hidden');
  $('gKey').focus();
};
$('gKey').oninput = () => refreshStart();

const typedKey = () => $('gKey').value.trim() || settings.gKey;
function needsReload() {
  if (pick.world !== world.kind) return true;
  if (pick.world !== 'village') return !samePlace(pick.place, settings.place) || (pick.world === 'google' && typedKey() !== settings.gKey);
  return false;
}

$('serialBtn').onclick = () => rc.connectSerial().catch(() => {});
$('startRc').onclick = () => {
  if (pick.world === 'google' && !typedKey()) {
    startMsg(t('keyEnter'));
    $('keyForm').classList.remove('hidden');
    return $('gKey').focus();
  }
  if (needsReload()) {
    settings.world = pick.world;
    settings.place = pick.place;
    settings.gKey = typedKey();
    save();
    try {
      sessionStorage.setItem(AUTOSTART, settings.arena ? 'arena' : '1');
    } catch {}
    return location.reload();
  }
  if (world.ready) begin();
  else {
    wantStart = true;
    showLoading(true);
  }
};

function statusText() {
  if (realWorld && world.phase === 'hata' && !needsReload()) {
    return [t(world.kind === 'osm' || world.kind === 'sat' ? 'status.loadFailOsm' : 'status.loadFail', { err: world.error }), false];
  }
  if (needsReload()) {
    return [pick.world !== 'village' ? t('status.willLoad', { place: placeLabel(pick.place).replace(' · ', ', ') }) : t('status.villageWillLoad'), true];
  }
  if (realWorld && !world.ready) {
    return [t(world.phase === 'detay' ? 'status.detail' : world.phase === 'zemin' ? 'status.preparing' : 'status.loading'), false];
  }
  if (!rc.live) {
    if (rc.bridge?.connected) return [t('status.noRc'), false]; // yerel sunucu var, DJI kumanda takılı değil
    return [t(rc.serialSupported ? 'status.noRcSerial' : 'status.noRcPublic'), false];
  }
  return [t('status.readyWith', { name: srcLabel() }), true];
}

function refreshStart() {
  if (started) return;
  const [text, ok] = statusText();
  startMsg(text, ok);
  const reload = needsReload();
  const loading = !reload && !world.ready;
  const btn = $('startRc');
  btn.textContent = t(reload ? 'loadAndStart' : loading && wantStart ? 'startsWhenReady' : 'start');
  btn.disabled = loading && wantStart;
  btn.classList.toggle('ready', steps.vehicle && steps.place);
  if (!wantStart && !(steps.vehicle && steps.place)) {
    btn.textContent = t(steps.vehicle ? 'pickPlaceFirst' : 'pickFirst');
    btn.disabled = true;
  }
  if (wantStart && world.ready && !reload) begin();
  const badge = $('rcBadge');
  badge.classList.toggle('ok', rc.live);
  badge.querySelector('.dot').className = `dot ${rc.live ? 'ok' : ''}`;
  badge.querySelector('span').textContent = rc.live ? srcLabel() : t('rcNotFound');
  // köprü yokken Chrome'da DJI kumandayı USB'den bağlama düğmesi
  $('serialBtn').classList.toggle('hidden', !(rc.serialSupported && !rc.live && !rc.bridge?.connected));
  if (world.phase === 'hata' && world.kind === 'google') $('keyForm').classList.remove('hidden');
}
setInterval(() => {
  refreshStart();
  refreshLoading(performance.now());
}, 300);
if (wantStart && realWorld && !world.ready) showLoading(true);
renderWorld();
renderPlaces();

// Şu an online uçanlar: liste + dünya haritası; Katıl = o dünya ve yeri seçip başla
// Başlangıç ekranı sekmeleri: her bölüm tek ekrana sığar, kaydırma gerekmez
function setTab(name) {
  document.querySelectorAll('.l-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('.l-main .pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === name));
}
document.querySelectorAll('.l-tabs button').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
// adım düğmeleri: Araç → Devam (konuma geç), Konum → Burada uç (Başla açılır)
$('nextVehicle').onclick = () => {
  markStep('vehicle');
  setTab('place');
};
$('nextPlace').onclick = () => {
  markStep('place');
  if (!steps.vehicle) return setTab('vehicle');
  $('startRc').focus();
};

const lobby = createLobby({
  el: $('lobby'),
  roomsUrl: ROOMS_URL,
  onUpdate: (n) => ($('tabOnline').textContent = n ? t('pilotsOnline', { n }) : '—'),
  onJoin: ({ world: w, place, arena }) => {
    pick.world = w;
    if (place) {
      pick.place = place;
      placeTab = place.group;
    }
    setArena(!!arena);
    if (!settings.online) onOnline(true);
    steps.vehicle = steps.place = true;
    renderWorld();
    renderPlaces();
    refreshStart();
    $('startRc').click();
  },
});
if (!wantStart) lobby.start();
renderKey();

rc.onChange = (live) => {
  if (started) hud.toast(t(live ? 'toast.rcOn' : 'toast.rcOff'), live ? 'info' : 'warn', 3);
};

// ---- dil (varsayılan İngilizce): sayfayı yenilemeden uygula
function setLang(l) {
  settings.lang = l;
  save();
  applyStatic();
  document.querySelectorAll('.lang-seg button').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang()));
  $('setLang').value = lang();
  renderHello();
  buildVehicleCards();
  syncDroneUi();
  renderPlaces();
  renderWorld();
  hud.lastState = null;
  lobby.setLang();
  rcSetup.setLang();
  rc.touch?.setLabels({ takeoff: t('takeoff'), land: t('land'), rth: t('rth'), view: t('viewBtn'), fire: t('arena.fire') });
  refreshStart();
}
document.querySelectorAll('.lang-seg button').forEach((b) => (b.onclick = () => setLang(b.dataset.lang)));
$('setLang').onchange = (e) => setLang(e.target.value);
document.querySelectorAll('.lang-seg button').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang()));

// ---- ilk açılış: pilot adı (online odada da görünür)
function renderHello() {
  $('subtitle').textContent = settings.pilotName ? t('helloSub', { name: settings.pilotName }) : t('subtitle');
}
renderHello();
// otomatik verilen "Pilot 123" adı seçilmiş sayılmaz
const autoName = /^Pilot \d{3}$/.test(settings.pilotName || '');
if ((!settings.pilotName || autoName) && !wantStart) {
  $('welcomeImg').src = thumbs.hero || thumbs.mini5 || '';
  $('welcome').classList.remove('hidden');
  $('start').classList.add('hidden');
  setTimeout(() => $('welcomeName').focus(), 50);
}
$('welcomeForm').onsubmit = () => {
  const name = $('welcomeName').value.trim().slice(0, 20);
  if (!name) {
    $('welcomeMsg').textContent = t('nameNeeded');
    return false;
  }
  settings.pilotName = name;
  save();
  $('pilotName').value = name;
  renderHello();
  $('welcome').classList.add('hidden');
  $('start').classList.remove('hidden');
  return false;
};
$('setLang').value = lang();

// online seçenekleri (başlangıç ekranı ve ayarlar)
$('onlineChk').checked = settings.online;
$('setOnline').checked = settings.online;
$('pilotName').value = settings.pilotName || '';
const onOnline = (on) => {
  settings.online = on;
  $('onlineChk').checked = on;
  $('setOnline').checked = on;
  save();
  setOnline(on);
};
$('onlineChk').onchange = (e) => onOnline(e.target.checked);
// online mod: serbest uçuş / lazer arena (oda adına ':arena' eklenir)
const arenaBtns = document.querySelectorAll('#arenaSeg button');
function setArena(on) {
  settings.arena = !!on;
  save();
  arenaBtns.forEach((b) => b.classList.toggle('on', (b.dataset.arena === '1') === settings.arena));
  $('arenaNote').classList.toggle('hidden', !settings.arena);
  renderSummary();
}
arenaBtns.forEach((b) => (b.onclick = () => setArena(b.dataset.arena === '1')));
// açılış hep serbest uçuş; arena yalnız bu sekmede seçilir (ya da seçildikten sonraki otomatik yenilemede sürer)
setArena(autoArena);
$('setOnline').onchange = (e) => onOnline(e.target.checked);
$('pilotName').oninput = (e) => {
  settings.pilotName = e.target.value.trim().slice(0, 20);
  save();
  renderHello();
};

// ---- ayarlar
function toggleSettings(show) {
  const p = $('settings');
  p.classList.toggle('hidden', show === undefined ? !p.classList.contains('hidden') : !show);
}
$('btnSettings').onclick = () => toggleSettings();
$('warmBtn').onclick = () => startWarm(false);
$('warmRecBtn').onclick = () => startWarm(true);
$('settingsClose').onclick = () => toggleSettings(false);
$('setWind').value = String(settings.wind);
$('setWind').onchange = (e) => {
  settings.wind = Number(e.target.value);
  save();
};
$('setBattery').checked = settings.battery;
$('setBattery').onchange = (e) => {
  settings.battery = e.target.checked;
  if (!settings.battery) drone.battery = 1;
  save();
};
$('setExpo').value = String(settings.expo);
$('expoVal').textContent = settings.expo.toFixed(2);
$('setExpo').oninput = (e) => {
  settings.expo = Number(e.target.value);
  $('expoVal').textContent = settings.expo.toFixed(2);
  save();
};
document.querySelectorAll('[data-inv]').forEach((el) => {
  el.checked = settings.invert[el.dataset.inv];
  el.onchange = () => {
    settings.invert[el.dataset.inv] = el.checked;
    save();
  };
});
// araç seçimi + hız (başlangıç ekranı ve ayarlar aynı değeri gösterir)
function syncDroneUi() {
  $('setDrone').value = settings.drone;
  for (const id of ['speedMul', 'setSpeed']) $(id).value = String(settings.speedMul);
  $('speedVal').textContent = `${speedLabel()} · ${kmh(VEHICLES[settings.drone].top * settings.speedMul)} ${t('kmh')}`;
  $('setSpeedVal').textContent = speedLabel();
  document.querySelectorAll('.drone-card').forEach((c) => c.classList.toggle('on', c.dataset.id === settings.drone));
  renderSummary();
}
function setDroneId(id) {
  if (id === settings.drone) return;
  const wasPlane = VEHICLES[settings.drone].type === 'plane';
  settings.drone = id;
  const isPlane = VEHICLES[id].type === 'plane';
  if (isPlane !== wasPlane) {
    view = isPlane ? 'chase' : 'fpv';
    settings.view = view;
  }
  save();
  setCraft(id);
  chasePos.copy(drone.pos);
  syncDroneUi();
  if (started) hud.toast(t('toast.selected', { name: vehName(id) }));
}
// araç kartları ve ayarlardaki liste (dil değişince yeniden kurulur)
function buildVehicleCards() {
  $('droneCards').replaceChildren();
  $('setDrone').replaceChildren();
  const selGroups = {};
  for (const [id, v] of Object.entries(VEHICLES)) {
    if (!selGroups[v.group]) {
      selGroups[v.group] = document.createElement('optgroup');
      selGroups[v.group].label = t(GROUP_KEY[v.group] || 'grp.dji');
      $('setDrone').append(selGroups[v.group]);
    }
    selGroups[v.group].append(new Option(vehName(id), id));
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'drone-card';
    card.dataset.id = id;
    const name = document.createElement('b');
    name.textContent = vehName(id).replace('DJI ', '');
    const info = document.createElement('span');
    info.textContent = `${kmh(v.top)} ${t('kmh')} · ${durLabel(v.flightMin)}`;
    const tag = document.createElement('i');
    tag.textContent = v.tag || (v.type === 'fpv' ? 'FPV' : '');
    if (thumbs[id]) {
      const img = document.createElement('img');
      img.src = thumbs[id];
      img.alt = '';
      card.append(img);
    }
    card.append(tag, name, info);
    card.onclick = () => {
      setDroneId(id);
      markStep('vehicle');
    };
    $('droneCards').append(card);
  }
}
buildVehicleCards();
$('setDrone').onchange = (e) => setDroneId(e.target.value);
for (const id of ['speedMul', 'setSpeed']) {
  $(id).oninput = (e) => {
    settings.speedMul = Number(e.target.value);
    save();
    syncDroneUi();
  };
}
syncDroneUi();

$('setSound').checked = settings.sound;
$('setSound').onchange = (e) => {
  settings.sound = e.target.checked;
  sound.muted = !settings.sound;
  save();
};
$('setVolume').value = String(settings.volume);
$('setVolume').oninput = (e) => {
  settings.volume = Number(e.target.value);
  sound.volume = settings.volume;
  save();
};
$('setMaxAlt').value = String(settings.maxAlt);
$('setMaxAlt').onchange = (e) => {
  settings.maxAlt = Number(e.target.value);
  save();
};
$('setQuality').value = settings.quality;
$('setQuality').onchange = (e) => {
  settings.quality = e.target.value;
  save();
  world.setQuality?.(settings.quality);
};
$('setDebug').checked = settings.debug;
$('setDebug').onchange = (e) => {
  settings.debug = e.target.checked;
  save();
};

// ---- döngü
const STEP = 1 / 120;
let acc = 0;
let last = performance.now();
let fps = 60;
let worldWasReady = false;
let soundHint = false;

// Yerel geliştirmede durum günlüğü (anahtar asla gönderilmez): serve.py → logs/client.log.
// Yayında (localhost değilken) hiçbir şey gönderilmez.
const IS_LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
if (realWorld && IS_LOCAL) {
  setInterval(() => {
    const body = JSON.stringify({ ...world.stats(), fps: Math.round(fps), state: drone.state, place: settings.place.name, h: +drone.height.toFixed(1), ua: navigator.userAgent.slice(-40) });
    fetch('/log', { method: 'POST', body }).catch(() => {});
  }, 2000);
}

function onRing(ev) {
  if (!ev.done) return hud.toast(t('toast.ring', { n: ev.index, total: ev.total }), 'info', 1.2);
  const best = settings.best === null || ev.time < settings.best;
  if (best) {
    settings.best = ev.time;
    save();
  }
  hud.toast(t('toast.courseDone', { time: fmtLap(ev.time) }) + (best ? t('toast.newRecord') : ''), 'info', 4);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;

  const inp = input.read(dt);
  // kumanda test ekranı açıkken çubuk hareketleri drone'u uçurmasın
  if (rcSetup.isOpen) inp.thr = inp.yaw = inp.pitch = inp.roll = inp.gimbal = 0;
  if (world.ready && !worldWasReady) {
    worldWasReady = true;
    drone.reset();
    chaseDir.set(-Math.sin(drone.yaw), 0, -Math.cos(drone.yaw));
  }
  if (started && world.ready) {
    acc += dt;
    while (acc >= STEP) {
      drone.step(inp, STEP, settings);
      if (drone.airborne) {
        const ev = world.checkRings(drone.prevPos, drone.pos, drone.time);
        if (ev) onRing(ev);
      }
      acc -= STEP;
    }
  }
  for (const e of drone.events.splice(0)) {
    hud.toast(t(e.text, e.vars), e.kind === 'crash' ? 'bad' : e.kind);
    announce(e.text, e.vars);
  }
  // kalkış rehberi: ilk kalkışa kadar (yerdeyken) görünür
  if (drone.airborne) coachDone = true;
  $('coach').classList.toggle('hidden', !(started && !coachDone && (drone.state === 'off' || drone.state === 'ground')));

  const tSec = now / 1000;
  updateModel(dt, tSec);
  // arena: lazerler, düşüşten sonra otomatik yeniden başlama, dokunulmazlıkta yanıp sönme, sarsıntı sönümü
  lasers.update(now, dt);
  arena.shake *= Math.exp(-dt / 0.12);
  if (arena.respawnAt && now >= arena.respawnAt) {
    arena.respawnAt = 0;
    if (drone.state === 'crashed') reset();
  }
  const shielded = arenaActive() && now < arena.shieldUntil;
  model.root.visible = !shielded || Math.floor(now / 110) % 2 === 0;
  rc.touch?.setFire(arenaActive());
  sendOnline();
  // diğer pilotlarla ilgili bir hata kendi uçuşumuzu ve çizimi asla durdurmasın
  try {
    ghosts.update(net, now, dt);
  } catch (e) {
    console.warn('[ghosts]', e);
  }
  {
    const ob = $('onlineBox');
    ob.classList.toggle('hidden', !net);
    if (net) {
      $('onlineDot').className = `dot ${net.connected ? 'ok' : 'bad'}`;
      $('onlineText').textContent = net.connected ? t('onlineCount', { n: net.peers.size + 1 }) : t('onlineOff');
    }
  }
  updateCamera(dt);
  homePad.position.set(drone.home.x, drone.home.y + 0.03, drone.home.z);
  homePad.userData.beam.visible = Math.hypot(drone.pos.x - drone.home.x, drone.pos.z - drone.home.z) > 25;
  sun.position.copy(drone.pos).addScaledVector(SUN_DIR, 150);
  sun.target.position.copy(drone.pos);
  world.update(camera, now);
  {
    const d = drone;
    let load = 0.1;
    if (d.kind === 'plane') load = d.throttle;
    else if (d.state === 'flying' || d.state === 'landing' || d.state === 'rth') {
      load = Math.min(1, Math.max(0, 0.45 + 0.35 * inp.thr + 0.3 * Math.hypot(inp.pitch, inp.roll) + 0.1 * Math.abs(inp.yaw)));
    }
    const dist = view === 'fpv' && started ? 0.3 : camera.position.distanceTo(d.pos);
    sound.update(d.state === 'crashed' || !started ? 0 : d.prop, load, dist);
    if (started && settings.sound && !soundHint && sound.ctx?.state !== 'running' && d.prop > 0.5) {
      soundHint = true;
      hud.toast(t('toast.clickSound'), 'info', 5);
    }
  }
  $('credits').textContent = world.credits(now);

  renderer.render(scene, camera);
  if (photoPending) {
    photoPending = false;
    savePhoto();
  }

  hud.update({
    d: drone,
    rc,
    inp,
    opt: settings,
    viewName: viewName(),
    placeName: placeLabel(settings.place),
    fps,
    recSecs: rec ? (performance.now() - rec.t0) / 1000 : null,
    pilot: null,
    home: homeMarker(),
    peers: net ? ghosts.radar() : [],
    arena: arenaActive() ? { lives: Math.max(0, LIVES - arena.hits), rows: arenaRows() } : null,
  });
}
requestAnimationFrame(frame);

// test ve hata ayıklama için
window.sim = { pickDone: () => { steps.vehicle = steps.place = true; refreshStart(); }, get lasers() { return lasers; }, get drone() { return drone; }, get model() { return model; }, get peers() { return ghosts.radar(); }, get net() { return net; }, THREE, setCraft: (id) => setDroneId(id), rc, world, settings, camera, renderer, fire, get arena() { return { ...arena, active: arenaActive(), lives: Math.max(0, LIVES - arena.hits), beams: lasers.active.length }; } };
