# Data used by Kimchi

Owner: P1 (data layer). Machine-readable registry: [`dashboard/data/sources.json`](../dashboard/data/sources.json). How to re-run every download: [`scripts/README.md`](../scripts/README.md). Times are UTC.

**Rule for every file:** missing stays `null` and is shown as "unavailable", never as 0. Nothing is gap-filled or invented. The only invented data is the demo farm, and it is labelled **synthetic**.

## Datasets in the app

| Dataset (source id) | Product / version | Resolution | Period in the app | Latency | Access method | Retrieved |
|---|---|---|---|---|---|---|
| **NASA POWER Daily** (`NASA_POWER_DAILY`) | POWER Daily API v2.10.3, AG community. Meteorology from MERRA-2 / GEOS-IT; solar from SRB, SYN1deg and FLASHFlux. Parameters `T2M_MAX`, `T2M_MIN`, `PRECTOTCORR`, `RH2M`, `WS2M`, `ALLSKY_SFC_SW_DWN`, `GWETROOT`, `GWETTOP` | One cell of ~0.5° lat × 0.625° lon (~50 km) for meteorology; ~1° for solar | 1981-01-01 to 2026-11-12. Solar radiation runs from 1984 to 2026-11-11 | ~3 days (radiation ~4–5 days) | REST JSON, no key, CORS allowed. Precomputed in `site_history.json`, and fetched live in the browser from Jan 1 to today | 2026-11-16T01:33Z |
| **NASA POWER region grid** (`NASA_POWER_DAILY`, method `FAO56`) | Same API; 25 native cells over western Kansas (lat 38.5–40.5, lon −101.875 to −99.375), annual indicators | ~50 km cells | 1981–2025 (45 years) | n/a (annual) | 25 point requests, precomputed in `region_grid.json` | 2026-11-15T23:11Z |
| **MODIS NDVI** (`MODIS_MOD13Q1_PC`) | NASA Terra MOD13Q1 collection 061, band `250m_16_days_NDVI` plus `pixel_reliability` (LP DAAC, doi:10.5067/MODIS/MOD13Q1.061) | 231.66 m pixels; 9 × 9 pixel window per field; 16-day composites | 2001-01-01 to 2026-10-16; 594 composites per field (583 from Planetary Computer, 11 gap fills from ORNL, next row) | ~2–4 weeks | Cloud-Optimized GeoTIFFs on Microsoft Planetary Computer, read with HTTP range requests (anonymous token, Node only), precomputed in `fields_ndvi.json` | 2026-11-15T23:16Z |
| **MODIS NDVI via ORNL** (`MODIS_MOD13Q1_ORNL`) | The same NASA product through the ORNL DAAC MODIS Web Service | Same | 11 composites per field: 2023-02-18, 2024-08-12, 2024-12-18 and 2025-07-12 to 2025-11-01 (marked in `composite_sources`) | Same | REST JSON, no key, CORS allowed. `fetchModisNdvi` in `sources.mjs`, run by the gap-fill code from a browser (not reachable from our cloud build machine) | 2026-11-16T02:31Z |
| **MODIS actual ET** (`T3_MODIS_MOD16A2GF`) | NASA Terra MOD16A2GF collection 061 (gap-filled), band `ET_500m` (LP DAAC, doi:10.5067/MODIS/MOD16A2GF.061) | One 463 m pixel at each field centroid; 8-day composites summed to calendar months | 2021-01 to 2025-12 for fld01–fld03 (60 of 60 months each) | Gap-filled product is released after the year ends | ORNL DAAC MODIS Web Service, REST JSON, no key. Converted by `research/deliverables/weather-water/modis_et.py`; copied to `fields_et_modis.json`. Shown only at the Complete level | 2026-11-15T21:50Z |
| **USDA SSURGO** (`USDA_SSURGO_SDA`) | NRCS Soil Data Access, live database: `mupolygon` + `muaggatt` (`aws0150wta`, `drclassdcd`, `hydgrpdcd`) | Soil map units (1:12,000–1:24,000) | Current survey | Annual refresh | SQL over REST, no key, CORS allowed. Demo fields are precomputed; drawn fields are fetched live, area-weighted by the clipped map-unit area | Demo fields 2026-11-14; drawn fields on demand |
| **USDA Cropland Data Layer** (`USDA_CDL`, research id `T2_CDL`) | NASS CDL 2021–2025, Sheridan County KS clip | 30 m | 2021–2025 harvest years | Released early the following year | CropScape `GetCDLFile`. Dominant class per field and year in `demo_fields.geojson` (`crop_history`), flagged "satellite-inferred, farmer must confirm" | 2026-11-14 |
| **Demo field outlines** (`T2_FIELD_DIGITIZED`, `T2_PLSS`, `T2_SD6_BOUNDARY`, `T2_SD6_ORDER`, `T2_NAIP`) | Approximate pivot circles on PLSS quarter sections inside the Sheridan 6 LEMA; checked visually on NAIP imagery | ~400 m radius circles (~50 ha) | n/a | n/a | ArcGIS / BLM services, done by the research team | 2026-11-14 |
| **Agronomy evidence** (`T1_*`, `T1_R*`, `KSU_*`) | 21 K-State / USDA-ARS / NASS sources and 15 rules from the team research package, plus 3 K-State extension pages cited in `crops.json` | n/a | Publications 2016–2025 | n/a | Read by the team; listed with ids in `sources.json` | 2026-11-14/15 |
| **FAO-56** (`FAO56`) | Allen et al. 1998, FAO Irrigation and Drainage Paper 56 | Method reference | n/a | n/a | Penman–Monteith and Hargreaves ET₀, Ra, Kc, depletion fraction | n/a |
| **Demo farm (synthetic)** | `demo_farm.json`, schema `kimchi.farm.1` | n/a | 2021–2026 seasons for fld01–fld03 | n/a | Hand-made; every record says "synthetic demo value". Crops follow the CDL history (2026 is corn on all three fields); yields, irrigation and nitrogen are invented | n/a |

## Known gaps and caveats

- **NDVI gaps:** the Planetary Computer copy lacked 11 composites (A2023049; A2024225 and A2024353; all of A2025193 to A2025305, i.e. Jul 12 to Nov 1, 2025). They were filled from ORNL with `node scripts/precompute.mjs ndvi --fill-gaps --ndvi-source=ornl` logic, which adds only missing composites, keeps every existing value, records each composite's source in `composite_sources`, and logs the run in `gap_fills`. A2026305 (Nov 1, 2026) is still missing because it was not yet published.
- **POWER scale:** POWER is regional reanalysis (~50 km), not a field measurement. `GWETROOT` / `GWETTOP` are model-based soil wetness, not satellite soil moisture.
- **Crop water demand** is estimated as ET₀ × Kc. It is not metered pumping and not OpenET. MODIS MOD16 actual ET is shown beside it as a satellite comparison only: one 500 m pixel per field, and MOD16 has no irrigation input, so it may under-read irrigated crops. The region grid uses Hargreaves ET₀ with Kc = 1.0 for every year, so the 45-year series uses one method.
- **NDVI** shows greenness, not its cause.
- **Allocation:** the 280 mm (~11 in) annual allocation in the demo farm is illustrative, based on the Sheridan 6 LEMA average, not a real water right.

## How we verified the data

- **NASA POWER history:** on Nov 15, every 2026 day × 4 variables in `site_history.json` was compared with a fresh API call: 1,264 of 1,264 values matched.
- **Older years:** all of 1995 (daily maximum temperature) matched the API, 365 of 365.
- **Region grid:** 2012 hot days in the home cell were recomputed from the API: 49, the same as the file.
- **Card values:** the "38 hot days" temperature card was recomputed from the API (38), and missing days arrive as −999 and are stored as null, never 0 (team QA review, `team/QA_REVIEW.md` §2).
- **NDVI gap fill and MOD16:** all 583 existing NDVI composites per field were unchanged, value by value, after the ORNL fill; the 690 raw MOD16 composites were checked against per-field sums before conversion.

## Data coverage: what we use and what we don't

We use 3 NASA products (POWER, MODIS NDVI, MODIS ET) and 2 USDA products (SSURGO, CDL). The challenge names about 9 NASA datasets. What we don't use, and how much it matters:

| Not used | What it would add | Risk of missing it | Plan |
|---|---|---|---|
| **SMAP** soil moisture (9 km, satellite-observed) | Observed soil moisture instead of POWER's model value. The challenge lists it first | **Medium-high:** our soil-moisture factor is model-only | First next step (needs an Earthdata login). POWER soil wetness is labelled "model" everywhere |
| **OpenET / ECOSTRESS** (observed ET, 30–70 m) | Field-scale measured crop water use to check our modelled demand (ET₀ × Kc) | **Medium:** MOD16 now gives a coarse (500 m) observed comparison, but not field scale | OpenET needs only a free account; the adapter exists in `research/deliverables/weather-water/` |
| **GPM IMERG** rain (10 km, sub-daily) | Finer, faster rain and storm extremes (erosion) | Medium | Next step |
| **Landsat / HLS / Sentinel-2** (10–30 m) | Within-field zones (MODIS gives about 8 pixels per field) | Medium for visuals; low for decisions | Next step |
| **SRTM** elevation | Slope, runoff and erosion zones | Low-medium (erosion isn't one of our 4 factors) | Next step |
| **GRACE / GRACE-FO** + **NWIS wells** | Aquifer decline context (the Ogallala story) | Low for decisions, good for the story | Mentioned in the write-up; next step |
| **PRISM / NLDAS / GLDAS / ERA5** | Finer or alternative weather | Low (POWER covers the need) | Not needed |
| **NASS QuickStats / AMS Market News** | County yields and prices for the "income" priority | Medium for the income priority | Next step: the income priority currently has no data, and the app says so |
| NAIP, NLCD, LANDFIRE, GEDI, GAEZ, CoCoRaHS | Context or validation | Low | Listed as deferred below |

**Bottom line:** the decisions we support (the 4 factors → actions and rotation fit) rest on real, verified data. The remaining risks are breadth of NASA data use and soil moisture being modelled, not observed.

## How a new field gets its data

When a farmer draws or types a field, the browser calls `pullFieldData(geometry)` in `dashboard/ui/integrate.mjs`:
- **NASA POWER daily, 1981 to today**, at the field centroid: the same 8 parameters as the demo site, one request of about 1.8 s and 2.2 MB. Trailing days with no values are trimmed; −999 becomes null.
- **USDA SSURGO soil** for the field polygon, in parallel, area-weighted by the clipped map units.
- The result has the same shape as `site_history.json`, so the analysis runs on it exactly as for the demo fields. It is cached in the browser (IndexedDB, else localStorage, else memory only) under `kimchi.fielddata.<field_id>` with its retrieval time, and "Refresh data" pulls it again.
- **Crop greenness (NDVI)** is not pulled for new fields tonight: ORNL accepts browser calls (checked Nov 15), but a 2001-to-now history is about 1,200 requests per field, so it needs a server-side download. The crop-condition card says so.
- Any part that fails is listed as an error and shown as a red card. Nothing is estimated in its place.

## Automatic daily refresh

`.github/workflows/refresh-data.yml` runs every day at 09:17 UTC (about 4 am Eastern) and on demand:
- `node scripts/precompute.mjs site` refreshes `site_history.json` from NASA POWER.
- On Mondays, `node scripts/precompute.mjs ndvi --fill-gaps --ndvi-source=ornl` adds any new 16-day MODIS composites, keeping existing values.
- If anything changed, it commits "Daily data refresh" to `main` and starts the Pages deploy, so the public site updates itself with no person or AI involved. The analysis itself always runs in the visitor's browser, and this year's POWER data is also fetched live on every page load.

## Considered but deferred tonight

These are resources from the team's Resources tab that we did not use tonight, with the reason for each:

| Resource | Why it is deferred |
|---|---|
| OpenET | Field-scale (30 m) actual ET would replace our ET₀ × Kc estimate, but the API needs a free account and key. The adapter exists in `research/deliverables/weather-water/`. **Next step.** |
| GRACE-FO | Groundwater / total water storage at ~300 km, monthly: regional aquifer context only. It can't resolve a field or the LEMA. |
| SMAP | Satellite soil moisture (9–36 km), but downloads need an Earthdata login. POWER `GWETROOT` covers the factor tonight (model-based). |
| GPM IMERG | ~10 km precipitation, finer than POWER, but it needs an Earthdata login and HDF5/NetCDF processing. |
| ECOSTRESS | 70 m ET and surface temperature, but irregular overpasses and gaps make a field time series unreliable. It also needs an Earthdata login. |
| PRISM | 4 km US climate data, better than POWER for rain, but there is no simple CORS JSON point API, so it needs server-side downloads. |
| NLDAS | ~12 km hourly forcing and land-surface soil moisture; needs an Earthdata login and NetCDF processing. |
| NAIP | Aerial imagery, used only for a one-off visual check of the pivot outlines. A basemap at most. |
| SRTM | Elevation and slope are nearly flat at the demo fields; not needed for the four factors. |
| USGS NWIS | Groundwater-level wells exist near SD-6, but linking a well to a field needs local review. |
| USDA AMS Market News | Prices would support an income view, but we make no profit predictions. |
| USDA NASS QuickStats | County yields could benchmark the farmer's records; needs an API key and isn't needed for the four factors. |
| FAO GAEZ | Global ~9 km crop suitability: too coarse and not specific to irrigated western Kansas. |
| CoCoRaHS | Volunteer rain gauges: point data with gaps. A good later check on POWER rainfall. |
| NLCD | Land cover every 2–3 years at 30 m; CDL already gives the annual crop type. |
| LANDFIRE | Wildland fuel and vegetation layers; not relevant to irrigated cropland decisions. |
| GEDI | Lidar canopy structure in sparse footprints; not useful for annual crops at field scale. |
| Sentinel-2 | 10 m NDVI would be sharper than MODIS, but it's not a NASA product, only covers 2015 on, and needs cloud masking and tiling. NASA HLS (30 m) is the stretch goal. |
| ERA5 | ECMWF reanalysis similar to POWER (31 km). Not NASA, and needs a Copernicus account. |

## Citation lines

- **NASA POWER:** "These data were obtained from the NASA Langley Research Center (LaRC) POWER Project funded through the NASA Earth Science/Applied Science Program."
- **MODIS:** Didan, K. (2021). MODIS/Terra Vegetation Indices 16-Day L3 Global 250m SIN Grid V061. NASA EOSDIS Land Processes DAAC. doi:10.5067/MODIS/MOD13Q1.061. Accessed through Microsoft Planetary Computer and the ORNL DAAC MODIS Web Service.
- **MODIS ET:** Running, S., Mu, Q., Zhao, M., Moreno, A. (2021). MODIS/Terra Net Evapotranspiration Gap-Filled 8-Day L4 Global 500m SIN Grid V061. NASA EOSDIS Land Processes DAAC. doi:10.5067/MODIS/MOD16A2GF.061. Accessed through the ORNL DAAC MODIS Web Service.
- **SSURGO:** Soil Survey Staff, Natural Resources Conservation Service, USDA. Soil Survey Geographic (SSURGO) Database, via Soil Data Access.
- **CDL:** USDA National Agricultural Statistics Service Cropland Data Layer, 2021–2025, via CropScape.
