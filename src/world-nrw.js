import { buildGoogleWorld } from './world-google.js';

// NRW açık verisi (Geobasis NRW 3D-Mesh, 10 cm fotogrametri) → kendi 3D Tiles karolarımız, anahtarsız.
// Google dünyasıyla aynı yükleyici; yalnız karo adresi ve telif satırı farklı.
// Karolar research-nrw/tools/run_lunen.sh ile üretilir; yayında <meta name="nrw-tiles-base"> adresinden gelir.

export const NRW_CREDIT = 'Geodaten: © Geobasis NRW 2025 · dl-de/zero-2.0';

// Hazır şehir paketleri: enlem/boylam kutusu (karo seti bu alanı kapsar)
export const NRW_AREAS = [
  { id: 'lunen', name: 'Lünen', lat: [51.578, 51.651], lon: [7.464, 7.581] },
];

export function nrwArea(place) {
  if (!place || typeof place.lat !== 'number' || typeof place.lon !== 'number') return null;
  return NRW_AREAS.find((a) => place.lat >= a.lat[0] && place.lat <= a.lat[1] && place.lon >= a.lon[0] && place.lon <= a.lon[1]) || null;
}

export function nrwTilesUrl(area) {
  const base = document.querySelector('meta[name="nrw-tiles-base"]')?.content || './tiles';
  return `${base.replace(/\/+$/, '')}/${area.id}/tileset.json`;
}

export function buildNrwWorld(scene, renderer, camera, { lat, lon, quality }) {
  const area = nrwArea({ lat, lon });
  return buildGoogleWorld(scene, renderer, camera, { url: nrwTilesUrl(area), credit: NRW_CREDIT, kind: 'nrw', lat, lon, quality });
}
