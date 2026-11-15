# Kimchi data layer: scripts

Owner: Person 1 (data backend). Node 18+ only, no `npm install`. All outputs go to `dashboard/data/`.

## Commands

```bash
node scripts/smoke.mjs            # live check: POWER (7 days) + SSURGO for fld01  (~5 s)
node scripts/smoke.mjs --ndvi     # also tries the ORNL MODIS service
node scripts/precompute.mjs site      # → site_history.json        (~5 s)
node scripts/precompute.mjs fields    # → demo_fields.geojson      (<1 s, offline)
node scripts/precompute.mjs grid      # → region_grid.json         (~1.5 min, 25 POWER requests)
node scripts/precompute.mjs ndvi      # → fields_ndvi.json         (ORNL: unknown; Planetary Computer: ~6 min)
node scripts/precompute.mjs sources   # → sources.json             (<1 s, offline)
node scripts/precompute.mjs all
```

Options: `--end=YYYY-MM-DD` (default: today, UTC), `--ndvi-start=YYYY-MM-DD` (default 2001-01-01), and `--ndvi-source=auto|ornl|pc`. The default is `auto`: try ORNL first, then fall back to Planetary Computer.

`demo_farm.json` is hand-made synthetic data. It is not produced by a script; see below.

## Outputs

| File | What it holds | Retrieved |
|---|---|---|
| `site_history.json` | NASA POWER daily data for the demo site (centre of fld01, 39.39758, −100.67829), which is POWER cell (39.5, −100.625) and covers all three demo fields. Range 1981‑01‑01 to 2026‑11‑12. Parameters `t2m_max`, `t2m_min`, `prectotcorr`, `rh2m`, `ws2m`, `allsky_sw_dwn`, `gwetroot`, `gwettop`, as equal-length arrays aligned with `date`. Also `units` (as the API reports them), `elevation_m`, and `last_valid` per parameter. 0.9 MB. | 2026‑11‑15, POWER API v2.10.3 |
| `demo_fields.geojson` | fld01–fld03 outlines, copied from `research/deliverables/fields-soils/fields.geojson`, plus `name`, `area_ha`, `center`, `site_id`, `soil`, `crop_history`, `boundary_status: "approximate"` and `history_status: "satellite_inferred_needs_farmer_confirmation"`. `soil` holds AWS for 0–25/50/100/150 cm, coverage, and dominant drainage and hydrologic group with their area shares. `crop_history` is the dominant CDL crop per year, using P4's ids `corn`, `sorghum`, `winter_wheat`. | SSURGO and CDL research records of 2026‑11‑14 |
| `region_grid.json` | 25 native POWER cells (5 × 5, centres from lat 38.5 to 40.5 and lon −101.875 to −99.375) × 45 years (1981–2025). Five annual indicators: `season_precip_mm`, `season_deficit_mm`, `hot_days_35c`, `gdd_may_sep`, `gwetroot_jul`. 40 KB. | 2026‑11‑15 |
| `fields_ndvi.json` | MOD13Q1 v061 NDVI per demo field: a 9 × 9 pixel window (231.66 m pixels), 583 composites from 2001‑01‑01 to 2026‑10‑16. Includes `pixel_polygons` (lon/lat), `pixel_centers`, `pixels_in_field`, `field_mean` and `pixels`. Pixels are row-major from the north-west corner. 1.1 MB. | 2026‑11‑15, via Planetary Computer |
| `sources.json` | `{generated_at, sources: [...], deferred: [...]}`. Holds 7 data sources, the 8 `T2_*` field research records, the KSU and 21 `T1_*` agronomy sources, the 15 `T1_R*` agronomy rules, and 19 deferred resources, each with a reason. Every `source_ids` entry in the other data files resolves here. | n/a |
| `demo_farm.json` | **Synthetic** farm (`"synthetic": true`, "Demo farm (synthetic)") in schema `kimchi.farm.1`. Contains fld01–fld03 with 2021–2025 records whose crops match `crop_history`. Every value is invented and every record says `"notes": "synthetic demo value"`. | n/a |

## Methods

- **POWER:** the fill value `-999` (or `header.fill_value`) becomes `null`. Trailing days on which *every* parameter is missing are trimmed. Radiation is null for 1981–1983 (the series starts in 1984) and for the last few days, because radiation lags longer than the other parameters.
- **Grid cells:** these are the native POWER meteorology grid. Centres are on multiples of 0.5° lat and 0.625° lon; I checked this on 2026‑11‑15 by probing cell edges at lat 39.25 and lon −100.9375 / −100.3125. Every cell whose centre lies in the bbox [−102, 38.5, −99, 40.5] is included, so the outer ring of cells sticks out of the bbox by half a cell.
- **Grid indicators:** an indicator is null if any day it needs is missing.
  - `season_precip_mm`: May–Sep sum.
  - `hot_days_35c`: Jun–Aug count of days with t2m_max ≥ 35 °C.
  - `gdd_may_sep`: Σ max(0, (min(tmax,30) + max(tmin,10))/2 − 10).
  - `gwetroot_jul`: July mean.
  - `season_deficit_mm`: May–Sep rain − Σ ET₀ × 1.0, with Hargreaves ET₀ (FAO‑56 eq. 52, Ra from eq. 21). This is the same formula as P2's `et0Hargreaves`. Hargreaves is used for **every** year so that the 45-year series uses one method; P2's `et0()` switches to Penman–Monteith from 1984.
- **SSURGO for drawn fields** (`fetchSoilForPolygon`): each SDA `mupolygon` is clipped to the field (`STIntersection`), and the clipped areas are computed on a sphere in JS. Then `muaggatt.aws0150wta` is area-weighted, and `drclassdcd` and `hydgrpdcd` take the class covering the largest area. If the spatial query fails, the fallback is `SDA_Get_Mukey_from_intersection_with_WktWgs84` with a simple mean, and `method` says so. For fld01 the live result matches the research record (30.78 cm, coverage 0.928, Well drained 0.928, group C 0.745 vs 0.744).
- **NDVI:** value = raw × 0.0001. It is null for fill (−3000), for values outside −0.2..1, and when `pixel_reliability` ∉ {0, 1}. Pixel polygons are converted from MODIS sinusoidal (R = 6371007.181 m). `field_mean` is the mean of valid pixels whose centre is inside the field polygon (9, 9 and 8 pixels).

## Known gaps

1. **ORNL DAAC MODIS service:** this was not reachable from the cloud build environment on 2026‑11‑15: upstream connection failure from Node, and an untrusted certificate chain via curl. It also failed in headless Chromium there ("Failed to fetch"), so **browser CORS is unverified**. Run `node scripts/smoke.mjs --ndvi` on a normal machine to check. Until then, treat `fetchModisNdvi` as untested and **Node-only**. The app uses the precomputed `fields_ndvi.json`; a drawn field should show "crop condition: unavailable for new fields tonight".
2. **Planetary Computer catalogue gaps** (the source of tonight's NDVI): composites missing are 1 in 2023, 2 in 2024, and 8 in 2025 (none from July to mid-November 2025). These are simply absent from `dates`, not filled. Re-running with `--ndvi-source=ornl` from a machine that reaches ORNL should fill them.
3. **Planetary Computer route:** this is the same NASA MOD13Q1 v061 product, but it is hosted by Microsoft. It uses an anonymous SAS token, Node only. Its source id is `MODIS_MOD13Q1_PC`, not `MODIS_MOD13Q1_ORNL`.
4. **POWER scale:** POWER is ~50 km reanalysis, so it is regional context, not a field measurement. GWETROOT and GWETTOP are model-based.
5. **Demo farm:** the demo farm is synthetic. Yields are set lower in the **2022 and 2024** summers, which are the hot, dry ones in our POWER data (May–Sep rain 297 and 315 mm; 42 and 43 days ≥ 35 °C). 2023 was wetter (401 mm, 26 hot days), so only the 2023 *wheat* crop, grown over the 2022–23 winter, is set low. The 280 mm allocation is illustrative.

## Library API (for P2, P3 and P4)

- `dashboard/lib/sources.mjs` (browser and Node):
  - Fetchers: `fetchPowerDaily({lat, lon, start, end, params})`, `fetchSoilForPolygon(geometry)`, `fetchModisNdvi({...})` (Node-only until verified).
  - Lookups and constants: `SOURCES`, `loadSources()`, `POWER_PARAMS`, `lastValidDate(daily, key)`.
  - Geometry helpers: `polygonAreaHa`, `pointInPolygon`, `polygonCenter`, `fieldMeanSeries`.
  - Errors are thrown as `Error('POWER unavailable: …')`, `'SDA unavailable: …'` or `'MODIS unavailable: …'`.
- `dashboard/lib/farmStore.mjs`:
  - Storage: `loadFarm`, `saveFarm`, `clearFarm`, `loadDemoFarm`, `storageMode`. Saved farms carry `storage: "localStorage" | "memory"`.
  - Export and import: `exportFarm` (a Blob with `.filename`), `downloadFarm`, `importFarm`, `validateFarm`.
  - Editing: `newFarm`, `upsertRecord`, `deleteRecord`, `addField`, `removeField`. These return **new** farm objects, so call `saveFarm` to persist.
