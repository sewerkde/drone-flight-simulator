import * as THREE from 'three';
import {
  TilesRenderer,
  GoogleCloudAuthPlugin,
  ReorientationPlugin,
  GLTFExtensionsPlugin,
  DRACOLoader,
} from '../vendor/3d-tiles.bundle.js';
import { addSky } from './world.js';
import { lang } from './i18n.js';

// Hazır kalkış yerleri (açık alanlar, koordinatlar OpenStreetMap'ten). Derece.
// Google'ın 3D verisi büyük şehirlerde ve ünlü noktalarda en detaylı.
// group: near | wonders | beauty | tr | eu | am | asia (t('pg.' + group)); name = Türkçe ad (kayıtlı ayarlar bununla eşleşir), names = diğer diller
// face: başlangıçta bakılan nokta; g3d: Google'da fotogerçekçi 3B bina modeli var mı (yaklaşık)
export const PLACES = [
  // varsayılan: belediye binasının önündeki açık meydan (Rathausvorplatz), binaya bakar.
  // Willy-Brandt-Platz'ın doğu ucu: iki ağaç sırasının arasından, ~100 m ötedeki kuleye bakar. Google 3D yakından
  // (25 m) cepheleri erimiş gösteriyordu; uzaktan bina bütün ve net görünür. Uydu fotoğrafıyla seçildi.
  { group: 'near', name: 'Lünen · Belediye Binası', lat: 51.61432, lon: 7.52245, face: [51.614214, 7.520984], g3d: true,
    names: { en: 'Lünen · Town Hall', de: 'Lünen · Rathaus' } },
  // gölün güney ucundaki açık futbol sahası; kuzeye, 560 m'lik göl boyunca bakar
  { group: 'near', name: 'Lünen · Cappenberger See', lat: 51.63073, lon: 7.53658, face: [51.634, 7.5368], g3d: true },
  // stadyumun ortası; Sarı Duvar'a (güney tribünü) bakar
  { group: 'near', name: 'Dortmund · Signal Iduna Park', lat: 51.4926, lon: 7.4519, face: [51.4917, 7.4518], g3d: true },
  // Dünyanın 7 yeni harikası + Giza; yanındaki açık alanda (meydan, teras, köprü), yapıya bakarak yerden başlar
  { group: 'wonders', name: 'Çin Seddi · Mutianyu', lat: 40.43479, lon: 116.56381, face: [40.44052, 116.56013], g3d: false, names: { en: 'Great Wall · Mutianyu', de: 'Chinesische Mauer · Mutianyu' } },
  { group: 'wonders', name: 'Petra · El Hazne', lat: 30.322, lon: 35.4519, face: [30.32208, 35.45153], g3d: false, names: { en: 'Petra · The Treasury', de: 'Petra · Schatzhaus' } },
  { group: 'wonders', name: 'Rio · Kurtarıcı İsa Heykeli', lat: -22.95208, lon: -43.21016, face: [-22.95192, -43.21046], g3d: true, names: { en: 'Rio · Christ the Redeemer', de: 'Rio · Cristo Redentor' } },
  { group: 'wonders', name: 'Machu Picchu', lat: -13.16434, lon: -72.54501, face: [-13.1556, -72.5466], g3d: false },
  { group: 'wonders', name: 'Chichén Itzá · El Castillo', lat: 20.68405, lon: -88.56864, face: [20.68297, -88.56864], g3d: false },
  // arena ortası bulanık ve kapalı görünüyordu: batıdaki yaya meydanından, Kolezyum'a bakarak başla
  { group: 'wonders', name: 'Roma · Kolezyum', lat: 41.89045, lon: 12.49065, face: [41.89026, 12.49237], g3d: true,
    names: { en: 'Rome · Colosseum', de: 'Rom · Kolosseum' } },
  { group: 'wonders', name: 'Agra · Tac Mahal', lat: 27.17231, lon: 78.04235, face: [27.17501, 78.0421], g3d: false, names: { en: 'Agra · Taj Mahal', de: 'Agra · Taj Mahal' } },
  { group: 'wonders', name: 'Giza · Piramitler', lat: 29.97097, lon: 31.12492, face: [29.97606, 31.13079], g3d: false, names: { en: 'Giza · Pyramids', de: 'Gizeh · Pyramiden' } },
  // 3B (fotogerçekçi) kapsamı olan en güzel yerler
  { group: 'beauty', name: 'Niagara Şelalesi', lat: 43.079, lon: -79.0786, face: [43.07841, -79.07433], g3d: true, names: { en: 'Niagara Falls', de: 'Niagarafälle' } },
  { group: 'beauty', name: 'Hong Kong · Victoria Limanı', lat: 22.2936, lon: 114.1694, face: [22.2852, 114.159], g3d: true, names: { en: 'Hong Kong · Victoria Harbour', de: 'Hongkong · Victoria Harbour' } },
  { group: 'beauty', name: 'Singapur · Marina Bay', lat: 1.2868, lon: 103.8545, face: [1.2837, 103.86072], g3d: true, names: { en: 'Singapore · Marina Bay', de: 'Singapur · Marina Bay' } },
  { group: 'beauty', name: 'Las Vegas · Bellagio', lat: 36.1129, lon: -115.1722, face: [36.11279, -115.17413], g3d: true },
  { group: 'beauty', name: 'Amsterdam · Kanallar', lat: 52.3742, lon: 4.8848, face: [52.37455, 4.88399], g3d: true, names: { en: 'Amsterdam · Canals', de: 'Amsterdam · Grachten' } },
  { group: 'beauty', name: 'Prag · Karlov Köprüsü ve Kale', lat: 50.0865, lon: 14.4114, face: [50.09081, 14.40052], g3d: true, names: { en: 'Prague · Charles Bridge & Castle', de: 'Prag · Karlsbrücke & Burg' } },
  { group: 'beauty', name: 'Neuschwanstein Şatosu', lat: 47.55535, lon: 10.75086, face: [47.55755, 10.7497], g3d: true, names: { en: 'Neuschwanstein Castle', de: 'Schloss Neuschwanstein' } },
  { group: 'tr', name: 'İstanbul · Ortaköy Camii ve Boğaz Köprüsü', lat: 41.04729, lon: 29.02677, g3d: true,
    names: { en: 'Istanbul · Ortaköy Mosque & Bosphorus Bridge', de: 'Istanbul · Ortaköy-Moschee & Bosporus-Brücke' } },
  { group: 'tr', name: 'İstanbul · Sultanahmet Meydanı', lat: 41.0058, lon: 28.9768, g3d: true,
    names: { en: 'Istanbul · Sultanahmet Square', de: 'Istanbul · Sultanahmet-Platz' } },
  { group: 'tr', name: 'Kapadokya · Göreme', lat: 38.6431, lon: 34.8289, g3d: false,
    names: { en: 'Cappadocia · Göreme', de: 'Kappadokien · Göreme' } },
  { group: 'tr', name: 'Ankara · Anıtkabir', lat: 39.9251, lon: 32.8369, g3d: true },
  { group: 'eu', name: 'Berlin · Brandenburg Kapısı', lat: 52.51636, lon: 13.37868, face: [52.51627, 13.3777], g3d: true,
    names: { en: 'Berlin · Brandenburg Gate', de: 'Berlin · Brandenburger Tor' } },
  { group: 'eu', name: 'Münih · Marienplatz', lat: 48.13714, lon: 11.5754, g3d: true,
    names: { en: 'Munich · Marienplatz', de: 'München · Marienplatz' } },
  { group: 'eu', name: 'Paris · Eyfel Kulesi (Champ de Mars)', lat: 48.8556, lon: 2.2986, face: [48.85826, 2.2945], g3d: true,
    names: { en: 'Paris · Eiffel Tower (Champ de Mars)', de: 'Paris · Eiffelturm (Champ de Mars)' } },
  { group: 'eu', name: 'Londra · Big Ben (Parliament Square)', lat: 51.50022, lon: -0.12667, face: [51.50069, -0.12457], g3d: true,
    names: { en: 'London · Big Ben (Parliament Square)', de: 'London · Big Ben (Parliament Square)' } },
  { group: 'eu', name: 'Venedik · San Marco Meydanı', lat: 45.43426, lon: 12.33867, g3d: true,
    names: { en: "Venice · St Mark's Square", de: 'Venedig · Markusplatz' } },
  { group: 'eu', name: 'Barselona · Sagrada Família', lat: 41.40448, lon: 2.17549, face: [41.4035, 2.17443], g3d: true,
    names: { en: 'Barcelona · Sagrada Família', de: 'Barcelona · Sagrada Família' } },
  { group: 'am', name: 'New York · Times Square', lat: 40.75701, lon: -73.98597, g3d: true },
  { group: 'am', name: 'New York · Battery Park (Özgürlük Heykeli)', lat: 40.70279, lon: -74.01577, face: [40.68925, -74.04455], g3d: true,
    names: { en: 'New York · Battery Park (Statue of Liberty)', de: 'New York · Battery Park (Freiheitsstatue)' } },
  { group: 'am', name: 'New York · Central Park', lat: 40.7812, lon: -73.9665, g3d: true },
  { group: 'am', name: 'San Francisco · Golden Gate (Crissy Field)', lat: 37.8046, lon: -122.46661, face: [37.8188, -122.4786], g3d: true },
  { group: 'am', name: 'Chicago · Millennium Park', lat: 41.88258, lon: -87.62254, g3d: true },
  { group: 'am', name: 'Grand Canyon · Mather Point', lat: 36.06172, lon: -112.10903, g3d: false },
  { group: 'am', name: 'Rio · Copacabana Plajı', lat: -22.9757, lon: -43.18662, g3d: true,
    names: { en: 'Rio · Copacabana Beach', de: 'Rio · Copacabana-Strand' } },
  { group: 'asia', name: 'Tokyo · Shibuya Kavşağı', lat: 35.6595, lon: 139.7005, g3d: true,
    names: { en: 'Tokyo · Shibuya Crossing', de: 'Tokio · Shibuya-Kreuzung' } },
  { group: 'asia', name: 'Dubai · Burj Khalifa (Burj Park)', lat: 25.19417, lon: 55.27339, face: [25.19703, 55.27413], g3d: true },
  { group: 'asia', name: 'Sidney · Opera Binası manzarası', lat: -33.85971, lon: 151.22257, face: [-33.8572, 151.21512], g3d: true,
    names: { en: 'Sydney · Opera House view', de: 'Sydney · Blick auf das Opernhaus' } },
];

// Seçili dilde yer adı. Kayıtlı ayarlardaki eski nesneler için koordinatla listeden bulunur.
export function placeLabel(p) {
  if (!p) return '';
  const known = PLACES.find((q) => q.lat === p.lat && q.lon === p.lon) || p;
  const l = lang();
  return (l !== 'tr' && known.names?.[l]) || known.name;
}

const DEG = Math.PI / 180;
// Ekran hatası hedefi (piksel): küçük = daha keskin, daha çok indirme.
export const QUALITY = { normal: 16, high: 8, ultra: 2 }; // ultra: çekim için en ince ayrıntı (ücret oturum başına, karo başına değil)
const DOWN = new THREE.Vector3(0, -1, 0);

// Google Photorealistic 3D Tiles. Seçilen nokta 0,0'da, zemin y≈0, -z kuzey, +x doğu.
// url verilirse Google yerine kendi karo setimiz (NRW) yüklenir: kimlik eklentisi yok, telif satırı credit, tür kind
export function buildGoogleWorld(scene, renderer, camera, { key, url, credit = 'Google', kind = 'google', lat, lon, quality = 'high' }) {
  addSky(scene, 2000, 12000);
  camera.far = 15000;
  camera.updateProjectionMatrix();

  const tiles = url ? new TilesRenderer(url) : new TilesRenderer();
  if (!url) tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: key, autoRefreshToken: true }));
  const draco = new DRACOLoader().setDecoderPath('./vendor/draco/');
  tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
  tiles.registerPlugin(new ReorientationPlugin({ lat: lat * DEG, lon: lon * DEG, height: 0, recenter: true }));
  const targetError = QUALITY[quality] ?? QUALITY.high;
  tiles.errorTarget = 24; // A aşamasında (3,5 km'den bakış) kaba yükle, hızlı otursun
  // yüksek kalitede daha çok karo bellekte kalsın, inişte yeniden indirilmesin
  tiles.lruCache.minSize = 3000;
  tiles.lruCache.maxSize = 8000;
  tiles.lruCache.minBytesSize = 0.8 * 2 ** 30;
  tiles.lruCache.maxBytesSize = 1.5 * 2 ** 30;
  tiles.downloadQueue.maxJobs = 20;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);

  // Eklenti nesne çerçevesi: +z kuzey, +x batı. 180° çevirince -z kuzey, +x doğu olur.
  const holder = new THREE.Group();
  holder.rotation.y = Math.PI;
  holder.add(tiles.group);
  scene.add(holder);

  // Fotogrametri ışığı zaten içinde: ışıksız malzemeyle orijinal renkler korunur.
  tiles.addEventListener('load-model', ({ scene: s }) => {
    s.traverse((o) => {
      if (!o.isMesh) return;
      const old = o.material;
      if (old.map) old.map.anisotropy = maxAniso; // eğik bakışta zemin dokusu keskin kalsın
      if (url) {
        // NRW mesh: dokuda gölge yok (ortofoto), cepheler düz kalıyor → normal hesapla, gök + güneşle hafif gölgele
        if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
        o.material = new THREE.MeshLambertMaterial({ map: old.map || null, color: old.map ? 0xffffff : old.color });
      } else o.material = new THREE.MeshBasicMaterial({ map: old.map || null, color: old.map ? 0xffffff : old.color });
      o.material.toneMapped = false;
      old.dispose();
    });
  });

  const state = {
    phase: 'yükleniyor', // yükleniyor | zemin | detay | hazır | hata
    error: null,
    ground0: null,
    stable: 0,
    lastProbe: 0,
    stage: 'A',
    firstHit: 0,
  };
  tiles.addEventListener('load-root-tileset', () => {
    state.rootLoaded = true;
  });
  tiles.addEventListener('load-error', ({ error, url }) => {
    const msg = String(error?.message || error).replace(/key=[^&\s]+/g, 'key=***');
    if (String(url || '').includes('root.json') || /403|401|400/.test(msg)) {
      state.phase = 'hata';
      state.error = msg;
    }
  });

  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;
  let rayMs = 0;
  let rays = 0;
  const cast = (origin, dir, far) => {
    const t0 = performance.now();
    ray.set(origin, dir);
    ray.near = 0;
    ray.far = far;
    const hit = ray.intersectObject(tiles.group, true)[0] || null;
    rayMs += performance.now() - t0;
    rays++;
    return hit;
  };

  // Başlangıç zemini, iki aşamada:
  // A) Kamera 3,5 km yukarıda aşağı bakar. İlk gelen kaba karolar düz kirişlerdir ve gerçek
  //    arazinin yüzlerce metre altında kalabilir (Münih'te -203 m ölçüldü). Ölçüm oturana kadar beklenir.
  // B) Zemin 0'a alınır, kamera kalkış noktasının çevresinde alçaktan döner, ince karolar iner.
  const _o = new THREE.Vector3();
  function probeStart(now) {
    // C) Kalkış noktası bulundu: kamera yerde başlangıç bakışında, ince karolar tam inene kadar bekle
    //    (en fazla 15 sn), sonra hazır: kalite için birkaç saniye beklemeye değer.
    if (state.phase === 'detay') {
      if (tiles.loadProgress >= 0.995) state.fullSince ||= now;
      else state.fullSince = 0;
      if ((state.fullSince && now - state.fullSince > 1200) || now - state.detailAt > 15000) state.phase = 'hazır';
      return;
    }
    if (state.phase === 'hazır' || state.phase === 'hata' || now - state.lastProbe < 300) return;
    state.lastProbe = now;
    const hit = cast(_o.set(0, 9000, 0), DOWN, 20000);
    if (!hit) return;
    const h = hit.point.y - holder.position.y; // karo çerçevesindeki yükseklik
    const tol = state.stage === 'A' ? 1 : 0.3;
    if (state.ground0 !== null && Math.abs(h - state.ground0) < tol) state.stable++;
    else state.stable = 0;
    state.ground0 = h;
    state.phase = 'zemin';
    if (!state.firstHit) state.firstHit = now;
    if (state.stage === 'A') {
      const loaded = tiles.loadProgress >= 0.95 || now - state.firstHit > 9000;
      if (state.stable >= 3 && loaded) {
        holder.position.y = -h;
        holder.updateMatrixWorld(true);
        state.stage = 'B';
        state.stable = 0;
        tiles.errorTarget = targetError;
        state.groundAt = now;
      }
      return;
    }
    holder.position.y = -h;
    holder.updateMatrixWorld(true);
    const settled = tiles.loadProgress >= 0.9 || now - state.groundAt > 6000;
    if (state.stable >= 3 && settled) {
      pickOpenSpot();
      state.phase = 'detay';
      state.detailAt = now;
      state.fullSince = 0;
    }
  }

  // Adres çoğu zaman çatının üstüne düşer. Başlangıç noktası çevresinden belirgin yüksekse (çatı),
  // 25 m içindeki en yakın sokak/bahçe seviyesine taşı. Uçurum ve kanyonları (40 m'den derin) yok say.
  function pickOpenSpot() {
    const samples = [];
    for (let i = -3; i <= 3; i++) {
      for (let j = -3; j <= 3; j++) {
        const hit = cast(_o.set(i * 8, 500, j * 8), DOWN, 3000);
        if (hit) samples.push({ x: i * 8, z: j * 8, y: hit.point.y, d: Math.hypot(i, j) });
      }
    }
    const origin = samples.find((s) => s.d === 0);
    if (!origin) return;
    const near = samples.filter((s) => s.y > origin.y - 40);
    const heights = near.map((s) => s.y).sort((a, b) => a - b);
    const ground = heights[Math.floor(heights.length * 0.3)];
    const spot =
      origin.y - ground < 2
        ? origin
        : near.filter((s) => Math.abs(s.y - ground) < 1.5).sort((a, b) => a.d - b.d)[0] || origin;
    holder.position.x -= spot.x;
    holder.position.z -= spot.z;
    holder.position.y -= spot.y;
    holder.updateMatrixWorld(true);
    state.spot = { x: spot.x, z: spot.z, roofAtOrigin: +(origin.y - ground).toFixed(1) };
  }

  // Yer yüksekliği: dronun hemen üstünden aşağı ışın, önbellekli.
  let gCache = { x: 1e9, z: 1e9, y: 0, t: 0 };
  function groundAt(x, z, y) {
    const now = performance.now();
    if (Math.hypot(x - gCache.x, z - gCache.z) < 0.4 && now - gCache.t < 100) return gCache.y;
    const hit = cast(_o.set(x, y + 1, z), DOWN, 3000);
    gCache = { x, z, y: hit ? hit.point.y : gCache.y, t: now };
    return gCache.y;
  }

  // Engel: son kontrol noktasından şimdiye ışın (30 Hz). Zemin/çatı groundAt'te.
  const sweepFrom = new THREE.Vector3();
  let sweepT = 0;
  let sweepInit = false;
  const _d = new THREE.Vector3();
  const _n = new THREE.Vector3();
  function resolve(p, v, r) {
    const now = performance.now();
    if (!sweepInit) {
      sweepFrom.copy(p);
      sweepInit = true;
      return null;
    }
    if (now - sweepT < 33) return null;
    sweepT = now;
    _d.subVectors(p, sweepFrom);
    const len = _d.length();
    if (len < 0.01) return null;
    _d.divideScalar(len);
    const hit = cast(sweepFrom, _d, len + r);
    sweepFrom.copy(p);
    if (!hit || !hit.face) return null;
    _n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    if (_n.dot(_d) > 0) _n.negate();
    if (_n.y > 0.7) return null; // yatay yüzey: zemin mantığı halleder
    p.copy(hit.point).addScaledVector(_d, -r);
    sweepFrom.copy(p);
    const vn = v.dot(_n);
    if (vn < 0) v.addScaledVector(_n, -vn);
    return { speed: vn < 0 ? -vn : 0, kind: 'building', top: false };
  }

  function resetSweep() {
    sweepInit = false;
    gCache.t = 0;
  }

  let creditText = '';
  let creditT = 0;
  function credits(now) {
    if (now - creditT > 1000) {
      creditT = now;
      const list = tiles.getAttributions().filter((a) => a.type === 'string').map((a) => a.value);
      creditText = [credit, ...list].join(' · ');
    }
    return creditText;
  }

  function update(cam, now) {
    tiles.setCamera(cam);
    tiles.setResolutionFromRenderer(cam, renderer);
    cam.updateMatrixWorld();
    tiles.update();
    probeStart(now);
  }

  function stats() {
    const s = { phase: state.phase, progress: +tiles.loadProgress.toFixed(2), ground0: state.ground0, spot: state.spot, rays, rayMs: rays ? +(rayMs / rays).toFixed(2) : 0, error: state.error };
    rayMs = 0;
    rays = 0;
    return s;
  }

  return {
    kind,
    get ready() {
      return state.phase === 'hazır';
    },
    get phase() {
      return state.phase;
    },
    get stage() {
      return state.stage;
    },
    get error() {
      return state.error;
    },
    get progress() {
      return tiles.loadProgress;
    },
    // yükleme ekranı için 0..1 aşama bilgisi
    get loading() {
      return {
        connected: !!state.rootLoaded,
        tiles: tiles.loadProgress,
        ground:
          state.phase === 'hazır' || state.phase === 'detay' ? 1 : state.stage === 'B' ? 0.5 + 0.5 * Math.min(1, state.stable / 3) : state.phase === 'zemin' ? 0.4 * Math.min(1, state.stable / 3) : 0,
        detail: state.phase === 'hazır' ? 1 : state.phase === 'detay' ? Math.min(0.97, tiles.loadProgress) : 0,
      };
    },
    rings: [],
    mapData: { houses: [], trees: [], rings: [] },
    course: { next: 0, startAt: null, lastTime: null },
    towerLight: null,
    resolve,
    groundAt,
    resetSweep,
    isWater: () => false,
    checkRings: () => null,
    resetCourse: () => {},
    update,
    credits,
    stats,
    setQuality(q) {
      if (state.stage === 'B') tiles.errorTarget = QUALITY[q] ?? QUALITY.high;
    },
  };
}
