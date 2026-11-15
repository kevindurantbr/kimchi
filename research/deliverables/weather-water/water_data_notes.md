# Teammate 3: weather and evapotranspiration, delivery notes

Prepared 2026-11-14 (America/Panama), data retrieved 2026-11-15 UTC.
Context: NASA Space Apps crop-rotation prototype, Sheridan 6, western Kansas. Crops under investigation: corn, grain sorghum and winter wheat.

## Status at a glance

| Item | Status |
|---|---|
| Weather: monthly rainfall and mean temperature, 2021-01 to 2025-12 | **Delivered and verified.** 60/60 months complete; no fill values. |
| Daily min/max temperature kept for crop-calendar work | **Delivered** in `weather_daily.csv` (1,826 days). |
| OpenET monthly ET for the test geometry | **UNAVAILABLE.** The API returned HTTP 403 "Not authenticated" and there is no API key. `et_sample.json` has an empty `rows` array. No ET was substituted. |
| Callable ET downloader for `fields.geojson` plus a date range | **Delivered** (`t3_water_data.py et`). Offline tests pass. **Not yet run against the live API** because there is no key. |

## Files

| File | What it is |
|---|---|
| `weather.json` | Envelope `{"schema_version":"1.0","sources":[...],"rows":[...]}`. One row per month, `region_id` = `regional_sample`. |
| `weather_daily.csv` | Daily `precipitation_mm`, `t2m_mean_c`, `t2m_min_c`, `t2m_max_c`. A missing value would be an empty cell (none occur). |
| `T3_power_provenance.json` | Exact request, retrieval time, POWER header (API version, sources, fill value), SHA-256 of the raw response and of each year's daily data. |
| `et_sample.json` | Envelope with empty rows. The source entry records the intended request (no secrets) and the access failure. |
| `fields_test01.geojson` | Explicitly labeled test geometry `test01` (`geometry_status` = `test`). |
| `t3_water_data.py` | Retrieval script and ET adapter. Python 3.8+, standard library only. |

## 1. Weather (NASA POWER)

**Request** (no key needed):
`https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR,T2M,T2M_MIN,T2M_MAX&community=AG&longitude=-100.64&latitude=39.36&start=20210101&end=20251231&format=JSON`

**Response header:** POWER Daily API v2.10.3, sources `MERRA2`, `POWER`, `time_standard` LST, `fill_value` -999. The returned point elevation is 866.83 m.

**Units:** PRECTOTCORR is "Precipitation Corrected" in mm/day. T2M, T2M_MIN and T2M_MAX are in °C.

**How the monthly rows are built** (`monthly_weather_rows` in the script):

- **Expected days:** `days_expected` is the number of calendar days of the month inside the requested range.
- **Fill values:** -999, NaN and absent days are treated as missing, never as zero.
- **Observed days:** `days_observed` counts days with both a valid precipitation value and a valid mean temperature.
- **Precipitation:** `precipitation_mm` is the sum of the daily values, but only when every expected day is valid. Otherwise it is `null`, because a partial sum would read as a dry month.
- **Temperature:** `mean_temperature_c` is the mean of the valid daily T2M values, or `null` if there are none.
- **Quality:** `complete` if all expected days are valid, `partial` if some are, `missing` if none are.
- **Rounding:** 2 decimals, with ties rounded away from zero. Sums use exact decimal arithmetic.

**Verification:**

- Monthly values were computed twice, independently: once in the browser (JavaScript) and once in Python from the transferred daily data. All 60 months agree exactly.
- Each year's daily data was checked by SHA-256 against the browser's copy.
- The offline self-test covers fill values, partial months and empty months.

**Sample annual totals:** 2021: 495.9 mm, 2022: 362.9 mm, 2023: 499.9 mm, 2024: 495.7 mm, 2025: 566.0 mm. Treat these five years as historical examples, not climate normals and not a trend.

**Limitations:**

- POWER meteorology is reanalysis-based (MERRA-2), served at source native resolution, roughly 0.5° × 0.625°. One value covers tens of km, so it is regional context and not a field or LEMA measurement.
- PRECTOTCORR is bias-corrected model precipitation, not a gauge reading.
- The daily values use Local Solar Time days.

**Retrieval route note:** this workspace's network blocks power.larc.nasa.gov. The data was fetched in the browser on the user's computer, then transferred and checksum-verified. Anyone with internet can reproduce it with:

```
python3 t3_water_data.py weather --out-dir .
```

That run also saves `T3_power_daily_raw.json`. To rebuild the monthly file offline from the saved daily file:

```
python3 t3_water_data.py weather --from-daily-csv weather_daily.csv --provenance T3_power_provenance.json --out-dir .
```

## 2. OpenET access check: UNAVAILABLE

**What was tried (2026-11-15 UTC):**

- `POST https://openet-api.org/raster/timeseries/polygon` with a valid body and no `Authorization` header returned **HTTP 403 `{"detail":"Not authenticated"}`**.
- The OpenAPI spec (API version 3.2) confirms an `APIKeyHeader` scheme: the header `Authorization` carries the raw key.

**Why it stopped:** credentials are required, and Teammate 3 has no OpenET account or API key. Per the brief, work stopped here. `et_sample.json` has `rows: []` and no ET values were substituted.

**What unblocks it:**

1. Someone on the team creates a free OpenET account at <https://account.etdata.org/register>. Old etdata.org accounts must re-register for the API.
2. They copy an API key from Account Dashboard → API Keys.
3. On their own machine (never in chat, code or files): `export OPENET_API_KEY=<key>`, then `python3 t3_water_data.py check-openet`. It should print HTTP 200.
4. Run on the final fields:
   `python3 t3_water_data.py et --fields fields.geojson --start 2021-01-01 --end 2025-12-31 --out et.json`
   For the test sample instead: `--fields fields_test01.geojson --out et_sample.json`.

**Quota (free tier):** 100 queries per month per user, up to 50,000 acres per query. Each field (each MultiPolygon part) and each variable is one query.

- fld01–fld03 for 2021–2025: 3 queries.
- With `--with-uncertainty`: 9 queries.

**Not verified here:**

- The OpenET Data Explorer manual export at <https://etdata.org>. The FAQ says limited downloads are free, but I could not confirm the account requirements or test the export steps.
- The public Google Earth Engine collection, which the docs list for v2.0 monthly data through 2024. It needs an Earth Engine account and was not attempted.

## 3. ET adapter (`t3_water_data.py et`)

**Input:** WGS84 GeoJSON Feature or FeatureCollection, with `Polygon` or `MultiPolygon` geometry.

- **Field ID:** every feature must have `properties.field_id`. IDs are carried through unchanged (fld01–fld03, test01, …) and never invented. A missing or duplicate ID is an error.
- **Geometry status:** `geometry_status` comes from `properties.geometry_status`, or else from `--geometry-status`. It must be `documented` or `test`.
- **Validation:** checks closed rings, at least 3 distinct vertices (the API minimum) and WGS84 ranges.

**Request** (from the OpenAPI `Polygon` schema):
`model=ensemble`, `variable=et`, `interval=monthly`, `reference_et=gridmet`, `reducer=mean`, `units=mm`, `file_format=json`, `version=2.1`.

- **Geometry encoding:** a simple polygon goes as the documented flat `geometry` list `[lon, lat, …]`. A polygon with holes goes as `geojson`.
- **MultiPolygon:** each part is queried separately, then combined by area-weighted mean. If any part is missing a month, that month is `null`.
- **API key:** read only from `OPENET_API_KEY` and sent only in the header. The self-test confirms it never reaches an output file.

**Output:** the same envelope. Each row has `field_id`, `month`, `et_mm`, `source_ids` = `["T3_OPENET_ENSEMBLE_MONTHLY"]`, `quality` and `geometry_status`.

**`quality` values:** these describe how the value was handled, not a product flag. The OpenAPI spec lists no per-month quality flag for this endpoint.

- `reported`: a single-polygon value returned by the API.
- `area_weighted_from_parts`: a MultiPolygon combined from its parts.
- `missing`: null.

**Uncertainty:** `--with-uncertainty` also requests `et_mad_min` and `et_mad_max`, the ensemble's own MAD range, and writes `<out>_mad_range.json`. No uncertainty ranges are invented when they aren't requested or returned.

**Raw responses** are saved to `openet_raw/`. The 200-response format is not documented, so the parser accepts list-of-records JSON with a date column and a value column. It stops with a clear error on anything else rather than guessing.

**Check on the first live run:** open one raw file and confirm that the date and value columns were read correctly.

**Changelog note:** OpenET API v3.2.2 (2026-08-11) temporarily disabled the `multipolygon` endpoints. This adapter uses the `polygon` endpoint, which was not listed as disabled.

## 4. Interpretation guardrails (for the main team)

- OpenET is **modelled actual ET**: water moved to the atmosphere from rain, irrigation and shallow groundwater. It does **not** measure pumped irrigation and is not a meter replacement.
- High ET is **not automatically crop stress**.
- Rain minus ET is only a **partial** water-balance indicator. It ignores runoff, drainage, storage change and irrigation.
- No future crop-water predictions were made.
- No frost-injury classification was made. Daily `t2m_min_c` is available, but no universal threshold has been applied.
- POWER values are regional. Do not present them as Sheridan 6 or field measurements.

## 5. Remaining blockers

1. **OpenET API key.** Needed before any ET row can exist. It is the only blocker for ET.
2. **Final field boundaries** (fld01–fld03) come from the field teammate. The adapter is ready for them.
3. **Parser check** on the first live OpenET response, as described in section 3.

## Sources

- NASA POWER Daily API: <https://power.larc.nasa.gov/docs/services/api/temporal/daily/>
- NASA POWER parameters: <https://power.larc.nasa.gov/parameters/> (the page did not load during this session; parameter names and units are taken from the API response itself)
- OpenET API info and quotas: <https://old.etdata.org/api-info/>
- OpenET FAQ (interpretation, accuracy, pumping caveats): <https://old.etdata.org/faq/>
- OpenET API docs (quick start, raster endpoints, data availability, changelog): <https://openet.gitbook.io/docs/quick-start>
- OpenET OpenAPI spec (Polygon schema, auth scheme): <https://openet-api.org/openapi.json>
- NASA announcement of OpenET's 48-state expansion (2025-12-16): <https://science.nasa.gov/blogs/science-news/2025/12/16/expanding-crucial-water-tracking/>

## Integration update

The adapter now accepts the field team’s `boundary_status: approximate` and preserves it as `geometry_status`; no relabelling as documented is needed. Response parsing rejects duplicate/invalid months, nonfinite/negative values, and ambiguous columns (e.g. pixel counts instead of ET). Flat geometry cannot silently discard holes. Partial calendar-month requests no longer claim complete monthly precipitation. `prototype/test_compare.py` adds regression coverage. Authenticated live response parsing still needs verification.

## MODIS ET update (2026-11-15)

Keyless NASA ET now fills the field ET slot. `modis_et.py` converts `mod16_raw.json` (ORNL DAAC MODIS Web Service, MOD16A2GF collection 061, band `ET_500m`, 230 gap-filled 8-day composites per field, A2021001–A2025361, one 500 m pixel at each field centroid) into `et_modis.json`, using the same envelope and row shape as the OpenET adapter, with source `T3_MODIS_MOD16A2GF`.

- **Units:** value × 0.1 = mm per composite. Composites are 8 days, except the last of each year (5 days, 6 in a leap year). Each value is spread evenly over its days and summed per calendar month, rounded to 0.1 mm.
- **Missing data:** a month is null (`missing`) if any day lacks a valid composite (absent, or outside 0–32700, e.g. fill ≥ 32761). It is never zero. The current file has no fill values; all 180 field-months are reported.
- **Interpretation:** a satellite estimate of actual ET (crop water use) for one ~463 m pixel, which can include land outside the field. It is coarser than OpenET, and MOD16 has no irrigation input, so it may underestimate irrigated crop water use. It is not pumping and not irrigation applied.
- **Rebuild:** `python3 modis_et.py` regenerates the output; `--check` fails if it is stale. Tests are in `prototype/test_modis_et.py`.
