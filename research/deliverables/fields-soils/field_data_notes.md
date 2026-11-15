# Field history and soil data notes (Teammate 2)

Retrieved and processed on 2026-11-14. Follow-up checks on 2026-11-15 (see "Follow-up 2026-11-15" below). Package: `fields.geojson`, `field_observations.json`, `scripts/`, `src/`, this file. Supporting evidence: `field_check_imagery.jpg`, `extraction_log.json`, `cdl_verification.json`.

## Result

Three approximate pivot-circle fields inside the Sheridan 6 LEMA, each with CDL 2021–2025 crop fractions and SSURGO available water storage. fld01 was extracted end to end first; fld02 and fld03 use the same script unchanged.

| field_id | PLSS quarter | Centroid (lon, lat) | Area (ha) | CDL 2021–2025 dominant class | Irrigation | LEMA |
| --- | --- | --- | --- | --- | --- | --- |
| fld01 | KS060070S0300W0SN33 SW | -100.678315, 39.397453 | 50.2 | Corn (0.97) → Corn (0.97) → Corn (0.97) → Corn (0.96) → Corn (0.95) | likely | in 2023–2027 order |
| fld02 | KS060080S0300W0SN04 NE | -100.669317, 39.390414 | 50.2 | Corn (0.99) → Corn (1.00) → Sorghum (0.98) → Sorghum (1.00) → Winter Wheat (0.95) | likely | in 2023–2027 order |
| fld03 | KS060070S0300W0SN29 NW | -100.697438, 39.419264 | 50.0 | Corn (0.97) → Winter Wheat (0.94) → Winter Wheat (0.99) → Corn (0.99) → Winter Wheat (0.98) | likely | in 2023–2027 order |

The numbers in brackets are the dominant class's share of the valid pixels in that year. The 2022 and 2023 values changed on 2026-11-15 after a grid correction; see "Follow-up 2026-11-15".

## Field geometry

- **Method:** each boundary is a circle centred on a BLM PLSS quarter-section centroid and clipped to that quarter. The radius search (300–400 m, 20 m rings, stop when the per-year dominant crop share in the ring drops below 0.5) reached the 400 m cap for all three fields. A full-quarter pivot is about 390–400 m, so 400 m is consistent, but the CDL ring test cannot tell a pivot edge from a square field edge at 30 m.
- **Status:** `boundary_status = approximate` for all fields. These are analysis boundaries, not surveyed field edges, legal parcels, crop masks or ownership records.
- **Imagery check:** `field_check_imagery.jpg` overlays the three outlines on USGS NAIP. Each outline sits on a visible centre pivot. The first render was misregistered (an aspect-ratio error in my export request, not in the data). The second render uses the extent the server returned and lines up.
- **Irrigation:** `likely` for all three. Evidence: a visible pivot in NAIP, plus irrigated-style crop histories (5 years of corn in fld01, corn and sorghum in fld02, corn every other year in fld03). This is not proof. No water-right point of diversion or metered-use record was checked (see Gaps).

## LEMA membership

- **Current legal description:** Consolidated Order of Decision and Designation Renewing Sheridan 6 LEMA for 2023–2027 (KDA DWR), signed 2022-10-14, in effect 2023-01-01 to 2027-12-31. Read on 2026-11-15 from the official KDA Sheridan 6 LEMA page in a browser. Section VII (pages 7–8) designates: Sheridan County T7S R28W 19–21 and 28–33; T7S R29W 4–9 and 16–36; T7S R30W 19–36; T8S R29W 1–18; T8S R30W 1–18; Thomas County T8S R31W 22–27 and 34–36. Findings of fact item 1 (page 6) lists the same sections. Page 8 is a scanned image; I read it visually.
- **Fields:** fld01 (T7S R30W S33), fld02 (T8S R30W S4) and fld03 (T7S R30W S29) are all in designated sections. `lema_membership` = `verified_2023_2027_order`.
- **Polygon check:** the Kansas Biological Survey SD-6 polygon (ArcGIS item 90041416…, Jan 2023) matches the legal description exactly. I compared each BLM PLSS section: 99 legal sections, 99 polygon sections (more than 50% area inside), no section in one list and not the other, no partial sections.
- **History:** the 2018–2022 order (001-DWR-LEMA-2017, GMD4 copy, page 8) lists the same T7S R30W and T8S R30W sections. The boundary did not change between the two periods.
- **What this does not show:** water-right enrolment, an allocation, or compliance for any field. It shows only that an approximate field lies in designated sections.
- **After 2027:** a 2026 renewal proceeding (001-DWR-LEMA-2026) is open on the KDA page. Its initial public hearing order mentions a proposed boundary expansion ("areas proposed to be newly added"). I did not read a final designation for 2028 onward. Membership after 2027-12-31 is not verified.
- **Do not use** the GMD4 renewal PDF from the brief (`Renewal Request Offical 20220216.pdf`) for SD-6 membership. It is the **Greater GMD 4 LEMA** (whole townships across the district), not SD-6.

## Crop history (CDL)

- **Source:** USDA NASS CDL county clips for Sheridan County (FIPS 20179), 2021–2025, from the CropScape cache. 30 m pixels, Albers Equal Area (NAD83), the same parameters as EPSG:5070.
- **Grid:** the script reads the origin, pixel size and CRS GeoKeys from every file and stops if one does not match (`scripts/cdl_grid.py`). The files do not share one grid. 2021, 2024 and 2025 start at (-404205, 1848555); 2022 and 2023 start at (-404175, 1848585), one pixel east and north. All five use NAD83 Albers with the EPSG:5070 parameters (standard parallels 29.5/45.5, origin 23 N 96 W, metres) and 30 m pixels.
- **10 m product from 2024:** NASS produces the CDL at 10 m from 2024. The 2024 and 2025 county clips used here are 30 m files. At class edges, a 30 m pixel can differ from the 10 m product at the same point (see `cdl_verification.json`, control mismatches).
- **Sampling:** a pixel is counted when its centre falls inside the field polygon. Class codes are read as stored, with no resampling or bilinear interpolation. Labels use the standard CDL class names.
- **Denominator:** `crop_fraction` = class pixels / valid pixels (non-zero codes inside the field). `valid_coverage_fraction` = valid pixels / all pixels with centres in the field. It is 1.0 for every field-year here.
- **Rows:** one row per class with at least 1% of valid pixels. Smaller classes are pooled into `Other (classes <1% each)`. Fractions per field-year sum to 1.000 ± 0.001 (rounding).
- **CDL year:** the year is the harvest year. A winter wheat year (for example fld03 2022) was planted in the previous autumn.
- **confirmation_needed = true** when any of these hold: the dominant class covers less than 85% of valid pixels; the dominant class is outside the crop library (corn, sorghum, winter wheat); or the dominant class is sorghum. Sorghum's 2023 Kansas producer's accuracy is 81.0%, and it is often confused with corn. Flagged: **fld02 2023 and 2024 (sorghum)**. Please ask the farmer or a local expert to confirm these.
- **Accuracy context (Kansas metadata 2023, producer's / user's accuracy):** corn 90.6% / 92.8%, sorghum 81.0% / 81.9%, winter wheat 88.5% / 87.4%. These are statewide pixel accuracies. They do not measure how accurate one field's history is.
- **Gap:** I could not find the Kansas CDL metadata pages for 2024 and 2025 on the NASS site (404, not listed in the metadata index). The rasters themselves exist.

## Soils (SSURGO)

- **Query:** Soil Data Access (live database), survey area KS179. Each field polygon is intersected with `mupolygon`. Clipped areas are measured in EPSG:5070.
- **Property:** `muaggatt.aws025wta`, `aws050wta`, `aws0100wta` and `aws0150wta`, available water storage for 0–25, 0–50, 0–100 and 0–150 cm, in **cm of water**. NRCS computes each value as the available water capacity times horizon thickness, then averages across components weighted by component percent (`comppct_r`).
- **Field aggregation:** an area-weighted mean over the map units clipped to the field. Map units with no value are excluded from the mean, and `coverage_fraction` reports the share of field area that has a value.
- **Categorical rows:** `hydrologic_group_dominant_condition` and `drainage_class_dominant_condition` are the category covering the largest field area. `value` is text, and `unit` and depths are null.
- **Not included:** current soil moisture (available water storage is a capacity, not a moisture state), current nitrogen, and soil-health scores.

### Map units by field

| field_id | mukey | musym | Map unit name | Share of field | AWS 0–150 cm (cm) | Hydrologic group | Drainage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fld01 | 2759231 | 1623 | Keith silt loam, 1 to 3 percent slopes, south | 0.633 | 31.42 | C | Well drained |
| fld01 | 1149991 | 1580 | Colby silt loam, 6 to 15 percent slopes | 0.163 | 31 | B | Well drained |
| fld01 | 1150000 | 1652 | Kuma silt loam, 0 to 1 percent slopes | 0.112 | 28.67 | C | Well drained |
| fld01 | 1150015 | 9999 | Water | 0.072 | null | null | null |
| fld01 | 2668749 | 1859 | Ulysses silt loam, 3 to 6 percent slopes | 0.021 | 20.85 | B | Well drained |
| fld02 | 2759231 | 1623 | Keith silt loam, 1 to 3 percent slopes, south | 0.987 | 31.42 | C | Well drained |
| fld02 | 2668749 | 1859 | Ulysses silt loam, 3 to 6 percent slopes | 0.013 | 20.85 | B | Well drained |
| fld03 | 2759231 | 1623 | Keith silt loam, 1 to 3 percent slopes, south | 0.547 | 31.42 | C | Well drained |
| fld03 | 1150000 | 1652 | Kuma silt loam, 0 to 1 percent slopes | 0.420 | 28.67 | C | Well drained |
| fld03 | 2668749 | 1859 | Ulysses silt loam, 3 to 6 percent slopes | 0.033 | 20.85 | B | Well drained |

- **fld01 note:** 7.2% of fld01 is mapped as `9999 Water` (mukey 1150015), with no soil properties. CDL shows 95–97% corn across the field every year, so this is probably a small playa or depression that is farmed in most years. AWS coverage for fld01 is therefore 0.928. Check it locally before you treat this spot as cropped soil.

### AWS summary

| field_id | 0–25 cm | 0–50 cm | 0–100 cm | 0–150 cm | coverage |
| --- | --- | --- | --- | --- | --- |
| fld01 | 5.19 | 10.33 | 20.53 | 30.78 | 0.928 |
| fld02 | 5.23 | 10.43 | 20.85 | 31.29 | 1.0 |
| fld03 | 4.94 | 9.82 | 19.79 | 29.92 | 1.0 |

Values are in cm of water.

## Reproduce

1. `bash scripts/fetch_sources.sh`: downloads the boundary, order PDF, PLSS sections, CDL rasters (into `raw/`, Git-ignored) and CDL metadata.
2. `python scripts/select_fields.py`: scores all LEMA quarter sections for a pivot-like CDL pattern (`raw/candidates.json`).
3. `python scripts/extract_fields.py`: writes `fields.geojson`, `field_observations.json` and `extraction_log.json`, querying SSURGO live.
4. `python scripts/verify_cdl.py`: independent CDL checks against the NASS point service and a separate re-count; writes `cdl_verification.json`.
5. Python 3.13 with `numpy`, `shapely` 2.x, `pyproj`, `tifffile` (plus `pillow` only for the imagery check).

## Gaps and blockers

- **SD-6 boundary after 2027 not verified:** the 2026 renewal proposes an expansion. Fix: read the final 2028+ designation order when KDA publishes it.
- **Irrigation not documented:** fix by checking Kansas WIMAS water-right points of diversion inside each field. This would move `irrigation_status` to `documented` only for the water right, not for current use.
- **CDL 2024–2025 Kansas accuracy tables not located.**
- **Pivot boundaries are approximate:** the centre and radius may be off by tens of metres. Corners outside the circle are excluded on purpose.
- **No farmer names, parcels or ownership records** were collected or needed.

## Sources

- `T2_SD6_BOUNDARY`: [Sheridan 6 LEMA boundary (Kansas Biological Survey, University of Kansas)](https://services2.arcgis.com/ZOdjAzAQ2B0f85zi/ArcGIS/rest/services/Sheridan6_LEMA_sections_dissolve/FeatureServer/0) — ArcGIS item 90041416e6d7427d839d3e0d55229082, modified 2023-01-04
- `T2_SD6_ORDER`: [Consolidated Order of Decision and Designation Renewing Sheridan 6 LEMA for 2023-2027 (KDA DWR)](https://www.agriculture.ks.gov/home/showpublisheddocument/4946/638466570231300000) — signed 2022-10-14; in effect 2023-01-01 to 2027-12-31
- `T2_SD6_ORDER_2018`: [Order of Designation, Sheridan 6 LEMA Management Plan 2018-2022 (KDA DWR, 001-DWR-LEMA-2017), copy hosted by GMD4](https://gmd4.org/New/Sheridan%206%20LEMA%20Order%20of%20Designation.pdf) — historical; superseded by `T2_SD6_ORDER`
- `T2_PLSS`: [BLM National PLSS CadNSDI, PLSS Section layer](https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer/2) — MapServer 11.5 (as served)
- `T2_FIELD_DIGITIZED`: [Approximate pivot-circle analysis boundaries (this package)](scripts/extract_fields.py) — 1.1
- `T2_NAIP`: [USGS NAIP imagery (ImageServer), visual check of pivot geometry](https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer) — Most recent mosaic served on retrieval date; acquisition year not read
- `T2_CDL`: [USDA NASS Cropland Data Layer 2021-2025, Sheridan County KS (FIPS 20179)](https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLFile?year={year}&fips=20179) — CDL 2021, 2022, 2023, 2024, 2025 county clips from CropScape cache (30 m, Albers NAD83)
- `T2_CDL_META`: [CDL Kansas metadata 2021-2023 (NASS)](https://www.nass.usda.gov/Research_and_Science/Cropland/metadata/metadata_ks23.htm) — metadata_ks21/22/23 (publication dates 2022-02-14, 2023-01-30, 2024-01-31)
- `T2_SSURGO`: [USDA NRCS SSURGO via Soil Data Access, survey area KS179 (Sheridan County)](https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest) — SDA live database as queried (mupolygon, mapunit, muaggatt)

## Integration clarification

On 2026-11-14 the integration review set `lema_membership` to `historical_boundary_verified_current_unverified`, because the current order had not been read. The follow-up below read it, and the value is now `verified_2023_2027_order`. This still does not confirm water-right participation or an allocation. All geometry remains approximate. See `../../integration_review.md`.

## Follow-up 2026-11-15

Work package from `integration_review.md`: verify the current SD-6 legal description, check every raster's geotransform and CRS, and repeat one field-year extraction.

- **SD-6 legal description:** verified against the 2023–2027 Consolidated Order. See "LEMA membership".
- **Raster grids, error found and fixed:** v1.0 used the 2021 origin for all five years. The 2022 and 2023 files start one pixel (30 m) east and north, so v1.0 read every 2022 and 2023 value from the pixel diagonally next to the correct one. v1.1 reads the origin from each file and checks the CRS GeoKeys. Only 2022 and 2023 rows changed. No dominant class and no `confirmation_needed` flag changed. The corrected shares are cleaner because the old offset reached past field edges, for example fld02 2022: corn 0.946 with 3.2% "Developed/Open Space" before, corn 0.998 now. Crop rows went from 45 to 40 because fewer minor classes now reach 1%. Geometry and soils did not change.
- **Independent server check:** at 24 random pixels (12 for 2022, 12 for 2023) where the old and corrected origins give different classes, the NASS CropScape `GetCDLValue` service matched the corrected origin 24 times and the old origin 0 times.
- **Control:** at 24 random class-edge pixels for 2021, 2024 and 2025, the server matched 21. All 3 mismatches are 2024 and 2025 edge pixels. Each one is explained by the 10 m product, because the server gives different classes at points inside the same 30 m pixel, and the local value is one of them.
- **Repeated extraction:** fld02 2023 re-counted with separate code (numpy ray casting on the published polygon; no shapely, no shared grid code): 556 pixels, 556 valid, sorghum 0.977, corn 0.013, winter wheat 0.011. Identical to `field_observations.json` and `extraction_log.json`.
- **Field selection re-run:** `select_fields.py` now uses the same per-file grids. fld01's quarter still ranks 1st of 356 candidates; fld02 ranks 11th and fld03 28th (they were chosen for their different rotations, not their rank).
- **Not repeated:** a fresh CDL download (the CropScape box statistics service did not answer in 120 s), and a field-year for 2024/2025 against the 10 m product.
- **Boundary uncertainty and missing soil coverage are unchanged:** all fields stay `approximate`, and fld01 AWS coverage stays 0.928.
