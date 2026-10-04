# Third-party software and data

## Bundled libraries (`vendor/`)

| Library | Version | License |
|---|---|---|
| [three.js](https://github.com/mrdoob/three.js) | r170 | MIT |
| [3d-tiles-renderer](https://github.com/NASA-AMMOS/3DTilesRendererJS) (bundled with esbuild, includes three.js `GLTFLoader`/`DRACOLoader`) | 0.5.3 | Apache-2.0 (see `vendor/3d-tiles.LICENSE`) |
| [Draco decoder](https://github.com/google/draco) (`vendor/draco/`) | – | Apache-2.0 |
| [@mapbox/vector-tile](https://github.com/mapbox/vector-tile-js) + [pbf](https://github.com/mapbox/pbf) (`vendor/mvt.bundle.js`) | 2.0.5 / 4.0.2 | BSD-3-Clause |

## Map data and imagery (loaded at runtime, not included)

| Source | Used for | Terms |
|---|---|---|
| [Google Map Tiles API – Photorealistic 3D Tiles](https://developers.google.com/maps/documentation/tile) | "Google 3D" map, with the user's own API key | [Google Maps Platform Terms](https://cloud.google.com/maps-platform/terms) |
| [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) | "Satellite 3D" ground imagery | [Esri terms of use](https://www.esri.com/en-us/legal/terms/full-master-agreement); attribution shown in the app |
| [OpenFreeMap](https://openfreemap.org) / [OpenMapTiles](https://openmaptiles.org) vector tiles | buildings, roads, water, land use | Data © OpenStreetMap contributors ([ODbL](https://www.openstreetmap.org/copyright)), © OpenMapTiles |
| [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen Terrarium) | terrain heights | see the dataset's attribution list |
| [Natural Earth](https://www.naturalearthdata.com) 110m land (`assets/world-land.json`) | lobby world map | public domain |
| [Regionalverband Ruhr – 3d.ruhr](https://3d.ruhr) 3D mesh 2025 (Lünen) | "Lünen 3D" map, served from our own storage | © RVR 2025, [Datenlizenz Deutschland – Namensnennung – 2.0](https://www.govdata.de/dl-de/by-2-0); attribution shown in the app |
| [Geobasis NRW](https://www.bezreg-koeln.nrw.de/geobasis-nrw) 3D-Mesh, LoD2, DGM1 (research only, `research-nrw/`) | fallback pipeline for NRW cities outside the Ruhr | © Geobasis NRW, [dl-de/zero-2-0](https://www.govdata.de/dl-de/zero-2-0) |

The drone models in `assets/models/` are original low-poly models made with `tools/build_drones.py` (Blender).
