# Prompt for Person 1: data backend (live fetchers, history files, farm-data store)

> Copy everything below this line into your AI assistant, together with the repository's `PLAN.md`.

---

You are helping build **Kimchi**, a NASA Space Apps 2026 project for the "Field Shift: Adapting Farms with NASA Data" challenge. Repository: https://github.com/kevindurantbr/kimchi. **Read `PLAN.md` first**; it is the source of truth for scope, contracts and the timeline. The deadline is **tonight, Nov 15, 11:59 pm Eastern**, and I need working output in stages, not a perfect system.

## Your role

You own the **data layer**: everything that pulls public data or stores the farmer's private data. Three other teammates code against your file formats at the same time, so **match the contracts in PLAN.md §7.1 and §7.2 exactly**. If you must change a field name, tell the team before you push.

You own these files and **must not edit any other file**:

```
dashboard/lib/sources.mjs        live fetch functions (browser + Node)
dashboard/lib/farmStore.mjs      farmer records in localStorage + export/import
dashboard/data/site_history.json
dashboard/data/region_grid.json
dashboard/data/fields_ndvi.json
dashboard/data/demo_fields.geojson
dashboard/data/demo_farm.json
dashboard/data/sources.json
scripts/precompute.mjs           Node 18+ script that writes the data files
scripts/README.md                how to re-run it
```

Rules: plain JavaScript ES modules, no npm dependencies (use the built-in `fetch`), Node 18+. Missing values are `null`, never `0`. Never commit API keys or real farmer data.

## Step 0: set up (5 min)

```bash
git clone https://github.com/kevindurantbr/kimchi.git && cd kimchi
git switch -c p1-data
node --version   # must be >= 18
```

Read: `PLAN.md`, `research/deliverables/weather-water/water_data_notes.md` (how POWER was handled before), `research/deliverables/fields-soils/fields.geojson`, `research/deliverables/fields-soils/field_observations.json`.

## Step 1: `dashboard/lib/sources.mjs` (by 6:30 pm)

Export these functions. Each must work in **both** the browser and Node.

1. `fetchPowerDaily({ lat, lon, start, end, params = POWER_PARAMS }) → Promise<{ site_id, lat, lon, start, end, daily: { date: [...], <param_lowercase>: [...] }, retrieved_at, api_version }>`
   - Endpoint: `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=${params.join(',')}&community=AG&longitude=${lon}&latitude=${lat}&start=YYYYMMDD&end=YYYYMMDD&format=JSON`
   - `POWER_PARAMS = ['T2M_MAX','T2M_MIN','PRECTOTCORR','RH2M','WS2M','ALLSKY_SFC_SW_DWN','GWETROOT','GWETTOP']`
   - Convert `-999` (and any value equal to `header.fill_value`) to `null`. Output keys are lowercase: `t2m_max`, `prectotcorr`, `allsky_sw_dwn` (rename `ALLSKY_SFC_SW_DWN` to this), `gwetroot`, and so on. Dates become ISO `YYYY-MM-DD`.
   - We checked on Nov 15 that the API sends `Access-Control-Allow-Origin: *` (browser calls work) and that data lags about 3 days, with radiation lagging longer. The trailing days come back as -999, so they become null.
   - Timeout of 45 s, with a clear `Error('POWER unavailable: ...')` on failure. **Never return made-up values.**
   - Daily solar radiation starts in 1984, so 1981–1983 radiation is null. That's expected; P2 falls back to the Hargreaves method.
2. `fetchSoilForPolygon(geojsonPolygon) → Promise<{ aws_0_150_cm, aws_coverage, drainage, hydgrp, mukeys, source_ids }>`
   - Endpoint: `POST https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest`, body `{"query": "...", "format": "JSON+COLUMNNAME"}`. CORS is allowed (checked Nov 15).
   - Use `SDA_Get_Mukey_from_intersection_with_WktWgs84('<WKT polygon>')` to get the mukeys, then join `muaggatt` (`aws0150wta`, `drclassdcd`, `hydgrpdcd`) and area-weight by intersected area if you can do it quickly. Otherwise use a simple mean over mukeys, and **say so** in a `method` field.
   - This is used for fields the farmer draws. Demo fields already have soil data.
3. `fetchModisNdvi({ lat, lon, startDate, endDate, kmAboveBelow = 1, kmLeftRight = 1 })`
   - ORNL DAAC MODIS web service: `https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset?latitude=..&longitude=..&band=250m_16_days_NDVI&startDate=AYYYYDDD&endDate=AYYYYDDD&kmAboveBelow=1&kmLeftRight=1`, header `Accept: application/json`. The API returns at most about 10 dates per request, so loop over date chunks (get the dates first from `/rst/api/v1/MOD13Q1/dates?latitude=..&longitude=..`).
   - Scale: NDVI = raw × 0.0001. Treat fill or invalid values (-3000, or outside -0.2..1) as null. If time allows, also fetch band `250m_16_days_pixel_reliability` and null out pixels whose reliability is not 0 or 1.
   - **Test this first, from your own machine.** We could not verify its TLS or CORS from our cloud environment. If the browser call is blocked by CORS, that's fine: this function then runs only in `precompute.mjs` under Node, and the app uses the precomputed `fields_ndvi.json`. Tell P3 which case applies.
   - Fallback if ORNL is down: NASA AppEEARS (needs an Earthdata login; do it in Node only, never put credentials in the browser), or ship NDVI for the demo fields only and label drawn fields "crop condition: unavailable for new fields tonight".
4. `export const SOURCES` mirrors `data/sources.json` (below).

Add a small `node scripts/smoke.mjs` that calls `fetchPowerDaily` for 7 days and `fetchSoilForPolygon` for fld01, and prints a summary. Run it.

## Step 2: first real data file by **6:45 pm**

Write `scripts/precompute.mjs` with sub-commands so you can run the parts separately:

```bash
node scripts/precompute.mjs site      # → dashboard/data/site_history.json
node scripts/precompute.mjs fields    # → dashboard/data/demo_fields.geojson
node scripts/precompute.mjs ndvi      # → dashboard/data/fields_ndvi.json
node scripts/precompute.mjs grid      # → dashboard/data/region_grid.json
node scripts/precompute.mjs all
```

1. **`site`:** one POWER daily request for the demo site (centre of fld01: lat 39.39758, lon -100.67829) from `19810101` to today. All 3 demo fields fall in the same POWER cell, so they share one site; give each field a `site_id` property pointing to it. Shape: PLAN.md §7.1. Check the file size, which should be about 3–6 MB. If it's over 8 MB, round values to 2 decimals.
   **Push this immediately.** P2 and P3 are waiting for it.
2. **`fields`:** copy `fld01`–`fld03` from `research/deliverables/fields-soils/fields.geojson` and add these properties:
   - `area_ha`;
   - `site_id`;
   - `soil` from `field_observations.json`: `aws_0_150_cm`, the numeric coverage, the drainage and hydrologic-group dominant conditions, and their area shares;
   - `crop_history`: `[{year, crop}]` with the **dominant** crop per harvest year 2021–2025 (fld01: corn ×5; fld02: corn, corn, sorghum, sorghum, winter wheat; fld03: corn, winter wheat, winter wheat, corn, winter wheat);
   - `boundary_status: "approximate"` and `history_status: "satellite_inferred_needs_farmer_confirmation"`.

## Step 3: `dashboard/lib/farmStore.mjs` + `dashboard/data/demo_farm.json` (by 7:15 pm)

1. `farmStore.mjs` exports `loadFarm()`, `saveFarm(farm)`, `loadDemoFarm()` (fetches `data/demo_farm.json`), `exportFarm(farm) → Blob` (pretty JSON, filename `kimchi-farm-YYYY-MM-DD.json`), `importFarm(file) → Promise<farm>`, `upsertRecord(farm, field_id, record)`, `deleteRecord(...)`, `addField(farm, {name, geometry})` (computes `area_ha` with a spherical polygon-area formula, no library), and `validateFarm(obj) → {ok, errors[]}`. localStorage key: `kimchi.farm.v1`. **Wrap every localStorage call in try/catch**, because private browser windows can throw; fall back to in-memory storage and set a `storage: "memory"` flag the UI can show.
2. `demo_farm.json`: the schema from PLAN.md §7.2, with `"synthetic": true` and `farm_name: "Demo farm (synthetic)"`. Include fld01–fld03 with records for 2021–2025 whose crops match the crop history above. Use **plausible but clearly invented** irrigation, nitrogen and yield values for western Kansas irrigated crops; for example corn around 180–230 bu/ac and irrigation around 250–380 mm. Make 2022 and 2023 (hot/dry years in our POWER data) somewhat lower. Add `"notes": "synthetic demo value"` to each record. Use well capacity 500–700 gpm and `annual_allocation_mm` 280 (SD-6 averaged roughly 11 inches per year; describe it as "illustrative").

## Step 4: region grid + NDVI (by 8:00 pm)

1. **`grid`:** bbox lon -102.0 to -99.0, lat 38.5 to 40.5, on the POWER grid (0.625° lon × 0.5° lat, so about 5 × 4 = 20 cells). For each cell centre, make one POWER daily request for 1981–2025 (sequential, about 1 s delay between requests, retry once). Compute **annual** indicators per cell and year as defined in PLAN.md §7.1:
   - `season_precip_mm`: May–Sep sum, null if any day is missing.
   - `hot_days_35c`: Jun–Aug count of days with t2m_max ≥ 35.
   - `gdd_may_sep`: Σ max(0, (min(tmax,30) + max(tmin,10))/2 − 10).
   - `gwetroot_jul`: July mean.
   - `season_deficit_mm`: May–Sep rain minus Σ(ET₀ × 1.0). **Import P2's `et0` function from `dashboard/lib/analysis.mjs` if it's ready**; otherwise use Hargreaves, ET₀ = 0.0023 × Ra × (Tmean+17.8) × √(Tmax−Tmin), with Ra from latitude and day of year. Write `"et0_method"` in the file.

   Cell polygons are `[[lon,lat],...]` closed rings. Keep the file under 2 MB; don't store daily data. If you run short of time, ship the grid with just `season_precip_mm`, `hot_days_35c` and `gdd_may_sep`.
2. **`ndvi`:** for each demo field, MOD13Q1 NDVI 2001–2025 (plus 2026 to date) on a 3 × 3 km window (`kmAboveBelow=1, kmLeftRight=1`, about 9 × 9 pixels). Compute pixel polygons from the response's `xllcorner`, `yllcorner`, `cellsize`, `nrows`, `ncols`. These are in the MODIS sinusoidal projection: convert to lon/lat with sinusoidal R = 6371007.181, lon = x / (R·cos(lat)), lat = y / R (radians to degrees). `field_mean` = mean of pixels whose centre lies inside the field polygon (point-in-polygon). If ORNL is too slow, do 2015–2026 first and extend later.

## Step 5: `dashboard/data/sources.json` (whenever you have 10 min)

Make an array of `{ id, name, provider, url, resolution, period, latency, license_or_terms, notes }`. Include at least:
- `NASA_POWER_DAILY`
- `MODIS_MOD13Q1_ORNL`
- `USDA_SSURGO_SDA`
- `USDA_CDL` (copy details from `research/deliverables/fields-soils/`)
- `FAO56` (method reference, for P2)

Also add the agronomy sources P4 uses: copy the `T1_*` source records from `research/deliverables/agronomy/agronomy.json`, keeping their ids. Then add a `deferred` list of the resources from the team's Resources tab that we are **not** using tonight, each with one line of why:
- OpenET: needs an account; it's the next step.
- GRACE-FO: about 300 km and monthly, regional context only.
- SMAP: needs an Earthdata login.
- GPM IMERG, ECOSTRESS, PRISM, NLDAS, NAIP, SRTM, NWIS, AMS Market News, NASS QuickStats, GAEZ, CoCoRaHS, NLCD, LANDFIRE, GEDI, Sentinel-2, ERA5: give each a short reason.

P4 uses this list in the write-up.

## Step 6: hand-off

Write `scripts/README.md` covering: commands, run time, what each output contains, known gaps, and exact retrieval dates. Then open a PR from `p1-data` to `main` titled "Data layer: POWER, MODIS NDVI, SSURGO, farm store". In the PR body, list exactly what's real, what's partial, and what failed. **Push after every step**; small, early pushes matter more than polish.

## Acceptance checklist

- [ ] `site_history.json` covers 1981-01-01 through the latest available day, with nulls (not zeros) for missing values. Pushed by 6:45 pm.
- [ ] `fetchPowerDaily` works from a browser page served over `http://localhost` (test with `python3 -m http.server`).
- [ ] `farmStore` round-trips: save, reload, export, import gives identical JSON; a private window falls back to memory.
- [ ] `demo_farm.json` is labelled synthetic everywhere.
- [ ] `region_grid.json` has 20 cells × 45 years for at least 3 indicators.
- [ ] `fields_ndvi.json` has fld01–fld03, or the PR states clearly why not and what the fallback is.
- [ ] No secrets and no real farmer data committed.
