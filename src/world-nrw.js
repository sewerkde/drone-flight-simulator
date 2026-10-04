import { buildGoogleWorld } from './world-google.js';

// Şehir 3B paketleri: açık veriden gerçek 3B mesh (3D Tiles), anahtarsız. Google dünyasıyla aynı yükleyici;
// yalnız karo adresi ve telif satırı farklı. Karolar kendi depomuzdan gelir (yayında <meta name="nrw-tiles-base">).
// Lünen: RVR (Regionalverband Ruhr) 3d.ruhr 2025 mesh'i, eğik hava fotoğraflarından; lisans dl-de/by-2-0 (atıf şart).
// Ruhr dışı NRW için yedek yol: Geobasis NRW 3D-Mesh + LoD2 düzleştirme (research-nrw/tools, dl-de/zero-2-0).

// Hazır şehir paketleri: enlem/boylam kutusu (karo seti bu alanı kapsar)
export const NRW_AREAS = [
  { id: 'lunen', name: 'Lünen', lat: [51.578, 51.655], lon: [7.416, 7.592], credit: '3D: © RVR 2025 · dl-de/by-2-0' },
];

export function nrwArea(place) {
  if (!place || typeof place.lat !== 'number' || typeof place.lon !== 'number') return null;
  return NRW_AREAS.find((a) => place.lat >= a.lat[0] && place.lat <= a.lat[1] && place.lon >= a.lon[0] && place.lon <= a.lon[1]) || null;
}

export function nrwTilesUrl(area) {
  // yalnız yerelde deneme: ?tiles=<tileset.json adresi> (yayında yok sayılır)
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
    const q = new URLSearchParams(location.search).get('tiles');
    if (q) return q;
  }
  const base = document.querySelector('meta[name="nrw-tiles-base"]')?.content || './tiles';
  return `${base.replace(/\/+$/, '')}/${area.id}/tileset.json`;
}

export function buildNrwWorld(scene, renderer, camera, { lat, lon, quality }) {
  const area = nrwArea({ lat, lon });
  return buildGoogleWorld(scene, renderer, camera, { url: nrwTilesUrl(area), credit: area.credit, kind: 'nrw', lat, lon, quality });
}
