const KEY = 'dji-sim-settings-v1';

const DEFAULTS = {
  mode: 'N',
  wind: 0,
  battery: true,
  expo: 0.25,
  invert: { lv: false, lh: false, rv: false, rh: false, wheel: false },
  debug: false,
  view: 'chase', // yeni ziyaretçi drone'u sahnede görerek başlar
  best: null,
  world: 'sat', // sat (uydu 3B, varsayılan) | osm (açık harita, hafif) | google (kendi anahtarınla) | village
  gKey: '',
  place: { group: 'near', name: 'Lünen · Belediye Binası', lat: 51.61432, lon: 7.52245, face: [51.614214, 7.520984], g3d: true, names: { en: 'Lünen · Town Hall', de: 'Lünen · Rathaus' } },
  quality: 'high', // normal | high | ultra (gerçek dünya)
  drone: 'mini5', // mini4 | mini5 | air3s
  speedMul: 1, // 1 = fabrika hızı
  maxAlt: 120, // m, kalkış noktasına göre; 0 = sınırsız
  sound: true,
  volume: 0.6,
  lang: 'en', // en | tr | de (arayüz dili, varsayılan İngilizce)
  online: true, // online oda (rooms.py)
  pilotName: '',
  rcPanel: false, // uçuş ekranında kumanda paneli açık mı
  // kumanda ayarı (rc-setup.js). Eksen başına ölü bölge, expo (null = genel expo), hassasiyet çarpanı
  axes: {
    thr: { deadzone: 0.04, expo: null, rate: 1 },
    yaw: { deadzone: 0.04, expo: null, rate: 1 },
    pitch: { deadzone: 0.04, expo: null, rate: 1 },
    roll: { deadzone: 0.04, expo: null, rate: 1 },
    gimbal: { deadzone: 0.04, expo: null, rate: 1 },
  },
  rcCal: {}, // kaynak başına kalibrasyon: { bridge: { lh: { c, min, max }, …, at } }
  // mod başına hız çarpanları (yatay, dikey, dönüş)
  modeMul: { C: { h: 1, up: 1, yaw: 1 }, N: { h: 1, up: 1, yaw: 1 }, S: { h: 1, up: 1, yaw: 1 } },
  gamepadPreset: 'auto', // auto | standard | aetr | taer (gamepad.js PRESETS)
  v2: true,
  v3: true,
  v4: true,
};

// iki düzeyli birleştirme: eksik eksen/mod ve alanlar varsayılandan
const merge2 = (def, s) => Object.fromEntries(Object.entries(def).map(([k, v]) => [k, { ...v, ...(s?.[k] || {}) }]));

// kumanda ayarı varsayılanları (sıfırla düğmeleri için, kopya)
export const rcDefaults = () => structuredClone({ axes: DEFAULTS.axes, modeMul: DEFAULTS.modeMul });

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    // v2: gerçek dünya + Lünen varsayılan (eski kayıtlar bir kez taşınır)
    if (!s.v2) {
      s.world = DEFAULTS.world;
      s.place = DEFAULTS.place;
      s.v2 = true;
    }
    // v3: listeden çıkan eski yerler varsayılana döner
    if (!s.v3) {
      if (!s.place) s.place = DEFAULTS.place;
      s.v3 = true;
    }
    // v4: Lünen açılışı göl kıyısından belediye binası meydanına taşındı (bir kez)
    if (!s.v4) {
      if (!s.place || s.place.name === 'Lünen · Cappenberger See') s.place = DEFAULTS.place;
      s.v4 = true;
    }
    return {
      ...DEFAULTS,
      ...s,
      invert: { ...DEFAULTS.invert, ...(s.invert || {}) },
      axes: merge2(DEFAULTS.axes, s.axes),
      modeMul: merge2(DEFAULTS.modeMul, s.modeMul),
      rcCal: { ...(s.rcCal || {}) },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export const settings = load();

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
}
