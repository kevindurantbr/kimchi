# Data used by Kimchi

Owner: P1 (data layer). Machine-readable registry: [`dashboard/data/sources.json`](../dashboard/data/sources.json). How to re-run every download: [`scripts/README.md`](../scripts/README.md). Times are UTC.

**Rule for every file:** missing stays `null` and is shown as "unavailable", never as 0. Nothing is gap-filled or invented. The only invented data is the demo farm, and it is labelled **synthetic**.

## Datasets in the app

| Dataset (source id) | Product / version | Resolution | Period in the app | Latency | Access method | Retrieved |
|---|---|---|---|---|---|---|
| **NASA POWER Daily** (`NASA_POWER_DAILY`) | POWER Daily API v2.10.3, AG community. Meteorology from MERRA-2 / GEOS-IT; solar from SRB, SYN1deg and FLASHFlux. Parameters `T2M_MAX`, `T2M_MIN`, `PRECTOTCORR`, `RH2M`, `WS2M`, `ALLSKY_SFC_SW_DWN`, `GWETROOT`, `GWETTOP` | One cell of ~0.5° lat × 0.625° lon (~50 km) for meteorology; ~1° for solar | 1981-01-01 to 2026-11-12. Solar radiation runs from 1984 to 2026-11-11 | ~3 days (radiation ~4–5 days) | REST JSON, no key, CORS allowed. Precomputed in `site_history.json`, and fetched live in the browser from Jan 1 to today | 2026-11-16T01:33Z |
| **NASA POWER region grid** (`NASA_POWER_DAILY`, method `FAO56`) | Same API; 25 native cells over western Kansas (lat 38.5–40.5, lon −101.875 to −99.375), annual indicators | ~50 km cells | 1981–2025 (45 years) | n/a (annual) | 25 point requests, precomputed in `region_grid.json` | 2026-11-15T23:11Z |
| **MODIS NDVI** (`MODIS_MOD13Q1_PC`) | NASA Terra MOD13Q1 collection 061, band `250m_16_days_NDVI` plus `pixel_reliability` (LP DAAC, doi:10.5067/MODIS/MOD13Q1.061) | 231.66 m pixels; 9 × 9 pixel window per field; 16-day composites | 2001-01-01 to 2026-10-16; 583 composites per field | ~2–4 weeks | Cloud-Optimized GeoTIFFs on Microsoft Planetary Computer, read with HTTP range requests (anonymous token, Node only), precomputed in `fields_ndvi.json` | 2026-11-15T23:16Z |
| **MODIS NDVI via ORNL** (`MODIS_MOD13Q1_ORNL`) | The same NASA product through the ORNL DAAC MODIS Web Service | Same | Used only to fill gaps (see below) | Same | REST JSON, no key. `fetchModisNdvi` in `sources.mjs` | Not reachable from our cloud build machine; gap fill is run from a laptop |
| **USDA SSURGO** (`USDA_SSURGO_SDA`) | NRCS Soil Data Access, live database: `mupolygon` + `muaggatt` (`aws0150wta`, `drclassdcd`, `hydgrpdcd`) | Soil map units (1:12,000–1:24,000) | Current survey | Annual refresh | SQL over REST, no key, CORS allowed. Demo fields are precomputed; drawn fields are fetched live, area-weighted by the clipped map-unit area | Demo fields 2026-11-14; drawn fields on demand |
| **USDA Cropland Data Layer** (`USDA_CDL`, research id `T2_CDL`) | NASS CDL 2021–2025, Sheridan County KS clip | 30 m | 2021–2025 harvest years | Released early the following year | CropScape `GetCDLFile`. Dominant class per field and year in `demo_fields.geojson` (`crop_history`), flagged "satellite-inferred, farmer must confirm" | 2026-11-14 |
| **Demo field outlines** (`T2_FIELD_DIGITIZED`, `T2_PLSS`, `T2_SD6_BOUNDARY`, `T2_SD6_ORDER`, `T2_NAIP`) | Approximate pivot circles on PLSS quarter sections inside the Sheridan 6 LEMA; checked visually on NAIP imagery | ~400 m radius circles (~50 ha) | n/a | n/a | ArcGIS / BLM services, done by the research team | 2026-11-14 |
| **Agronomy evidence** (`T1_*`, `T1_R*`, `KSU_*`) | 21 K-State / USDA-ARS / NASS sources and 15 rules from the team research package, plus 3 K-State extension pages cited in `crops.json` | n/a | Publications 2016–2025 | n/a | Read by the team; listed with ids in `sources.json` | 2026-11-14/15 |
| **FAO-56** (`FAO56`) | Allen et al. 1998, FAO Irrigation and Drainage Paper 56 | Method reference | n/a | n/a | Penman–Monteith and Hargreaves ET₀, Ra, Kc, depletion fraction | n/a |
| **Demo farm (synthetic)** | `demo_farm.json`, schema `kimchi.farm.1` | n/a | 2021–2026 seasons for fld01–fld03 | n/a | Hand-made; every record says "synthetic demo value". Crops follow the CDL history (2026 is corn on all three fields); yields, irrigation and nitrogen are invented | n/a |

## Known gaps and caveats

- **NDVI gaps:** 12 composites are missing from the Planetary Computer copy and are absent from `fields_ndvi.json`:
  - A2023049 (Feb 18 2023);
  - A2024225 and A2024353;
  - all of A2025193 to A2025305 (Jul 12 to Nov 1, 2025);
  - A2026305 (Nov 1 2026, not yet published).

  `node scripts/precompute.mjs ndvi --fill-gaps --ndvi-source=ornl` adds only the missing composites from ORNL, keeps every existing value, and records each composite's source in `composite_sources`. Each run is logged in `gap_fills`.
- **POWER scale:** POWER is regional reanalysis (~50 km), not a field measurement. `GWETROOT` / `GWETTOP` are model-based soil wetness, not satellite soil moisture.
- **Crop water demand** is estimated as ET₀ × Kc. It is not metered pumping and not OpenET. The region grid uses Hargreaves ET₀ with Kc = 1.0 for every year, so the 45-year series uses one method.
- **NDVI** shows greenness, not its cause.
- **Allocation:** the 280 mm (~11 in) annual allocation in the demo farm is illustrative, based on the Sheridan 6 LEMA average, not a real water right.

## Considered but deferred tonight

These are resources from the team's Resources tab that we did not use tonight, with the reason for each:

| Resource | Why it is deferred |
|---|---|
| OpenET | Field-scale (30 m) actual ET would replace our ET₀ × Kc estimate, but the API needs a free account and key. The adapter exists in `research/deliverables/weather-water/`. **Next step.** |
| NASA MODIS MOD16A2GF ET | 500 m 8-day actual ET for fld01–fld03 (2021–2025) was retrieved from ORNL in research PR #8 but is not wired into the new dashboard tonight. **Next step.** |
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
- **SSURGO:** Soil Survey Staff, Natural Resources Conservation Service, USDA. Soil Survey Geographic (SSURGO) Database, via Soil Data Access.
- **CDL:** USDA National Agricultural Statistics Service Cropland Data Layer, 2021–2025, via CropScape.
