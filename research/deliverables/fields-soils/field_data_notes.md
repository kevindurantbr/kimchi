# Field history and soil data notes (Teammate 2)

Retrieved and processed on 2026-11-14. Package: `fields.geojson`, `field_observations.json`, `scripts/`, `src/`, this file. Supporting evidence: `field_check_imagery.jpg`, `extraction_log.json`.

## Result

Three approximate pivot-circle fields inside the Sheridan 6 LEMA, each with CDL 2021–2025 crop fractions and SSURGO available water storage. fld01 was extracted end to end first; fld02 and fld03 use the same script unchanged.

| field_id | PLSS quarter | Centroid (lon, lat) | Area (ha) | CDL 2021–2025 dominant class | Irrigation | LEMA |
| --- | --- | --- | --- | --- | --- | --- |
| fld01 | KS060070S0300W0SN33 SW | -100.678315, 39.397453 | 50.2 | Corn (0.97) → Corn (0.98) → Corn (0.96) → Corn (0.96) → Corn (0.95) | likely | verified |
| fld02 | KS060080S0300W0SN04 NE | -100.669317, 39.390414 | 50.2 | Corn (0.99) → Corn (0.95) → Sorghum (0.92) → Sorghum (1.00) → Winter Wheat (0.95) | likely | verified |
| fld03 | KS060070S0300W0SN29 NW | -100.697438, 39.419264 | 50.0 | Corn (0.97) → Winter Wheat (0.93) → Winter Wheat (0.98) → Corn (0.99) → Winter Wheat (0.98) | likely | verified |

The numbers in brackets are the dominant class's share of the valid pixels in that year.

## Field geometry

- **Method:** each boundary is a circle centred on a BLM PLSS quarter-section centroid and clipped to that quarter. The radius search (300–400 m, 20 m rings, stop when the per-year dominant crop share in the ring drops below 0.5) reached the 400 m cap for all three fields. A full-quarter pivot is about 390–400 m, so 400 m is consistent, but the CDL ring test cannot tell a pivot edge from a square field edge at 30 m.
- **Status:** `boundary_status = approximate` for all fields. These are analysis boundaries, not surveyed field edges, legal parcels, crop masks or ownership records.
- **Imagery check:** `field_check_imagery.jpg` overlays the three outlines on USGS NAIP. Each outline sits on a visible centre pivot. The first render was misregistered (an aspect-ratio error in my export request, not in the data). The second render uses the extent the server returned and lines up.
- **Irrigation:** `likely` for all three. Evidence: a visible pivot in NAIP, plus irrigated-style crop histories (5 years of corn in fld01, corn and sorghum in fld02, corn every other year in fld03). This is not proof. No water-right point of diversion or metered-use record was checked (see Gaps).

## LEMA membership

- **Legal description used:** Order of Designation 001-DWR-LEMA-2017 (2018–2022), Section VII, page 8, GMD4-hosted copy. It lists T7S R30W Sections 19–36 and T8S R30W Sections 1–18. fld01 (T7S R30W S33), fld02 (T8S R30W S4) and fld03 (T7S R30W S29) are all in the listed sections.
- **Polygon check:** all three fields also fall inside the Kansas Biological Survey SD-6 polygon (ArcGIS item 90041416…, Jan 2023). That polygon covers about 98–99 square miles, which matches the order's 99 sections: T7S R28W 9, T7S R29W 27, T7S R30W 18, T8S R29W 18, T8S R30W 18, and T8S R31W (Thomas County) 9.
- **Caveat:** the 2023–2027 Consolidated Order and the 2028–2032 renewal documents on agriculture.ks.gov return HTTP 403 to scripts. I did not read them. The boundary is assumed unchanged since 2018. A human can confirm it by opening the Consolidated Order on the KDA Sheridan 6 LEMA page.
- **Do not use** the GMD4 renewal PDF from the brief (`Renewal Request Offical 20220216.pdf`) for SD-6 membership. It is the **Greater GMD 4 LEMA** (whole townships across the district), not SD-6.

## Crop history (CDL)

- **Source:** USDA NASS CDL county clips for Sheridan County (FIPS 20179), 2021–2025, from the CropScape cache. 30 m pixels, Albers Equal Area (NAD83), the same parameters as EPSG:5070.
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

- **fld01 note:** 7.2% of fld01 is mapped as `9999 Water` (mukey 1150015), with no soil properties. CDL shows 95–98% corn across the field every year, so this is probably a small playa or depression that is farmed in most years. AWS coverage for fld01 is therefore 0.928. Check it locally before you treat this spot as cropped soil.

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
4. Python 3.13 with `numpy`, `shapely` 2.x, `pyproj`, `tifffile` (plus `pillow` only for the imagery check).

## Gaps and blockers

- **2023–2027 SD-6 order not read:** KDA returns 403 to scripts. Fix: a person opens it on the KDA page and confirms that T7S R30W and T8S R30W are unchanged.
- **Irrigation not documented:** fix by checking Kansas WIMAS water-right points of diversion inside each field. This would move `irrigation_status` to `documented` only for the water right, not for current use.
- **CDL 2024–2025 Kansas accuracy tables not located.**
- **Pivot boundaries are approximate:** the centre and radius may be off by tens of metres. Corners outside the circle are excluded on purpose.
- **No farmer names, parcels or ownership records** were collected or needed.

## Sources

- `T2_SD6_BOUNDARY`: [Sheridan 6 LEMA boundary (Kansas Biological Survey, University of Kansas)](https://services2.arcgis.com/ZOdjAzAQ2B0f85zi/ArcGIS/rest/services/Sheridan6_LEMA_sections_dissolve/FeatureServer/0) — ArcGIS item 90041416e6d7427d839d3e0d55229082, modified 2023-01-04
- `T2_SD6_ORDER`: [Order of Designation, Sheridan 6 LEMA Management Plan 2018-2022 (KDA DWR, 001-DWR-LEMA-2017), copy hosted by GMD4](https://gmd4.org/New/Sheridan%206%20LEMA%20Order%20of%20Designation.pdf) — Order dated 2017 for 2018-2022; Section VII lists boundary sections
- `T2_PLSS`: [BLM National PLSS CadNSDI, PLSS Section layer](https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer/2) — MapServer 11.5 (as served)
- `T2_FIELD_DIGITIZED`: [Approximate pivot-circle analysis boundaries (this package)](scripts/extract_fields.py) — 1.0
- `T2_NAIP`: [USGS NAIP imagery (ImageServer), visual check of pivot geometry](https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer) — Most recent mosaic served on retrieval date; acquisition year not read
- `T2_CDL`: [USDA NASS Cropland Data Layer 2021-2025, Sheridan County KS (FIPS 20179)](https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLFile?year={year}&fips=20179) — CDL 2021, 2022, 2023, 2024, 2025 county clips from CropScape cache (30 m, Albers NAD83)
- `T2_CDL_META`: [CDL Kansas metadata 2021-2023 (NASS)](https://www.nass.usda.gov/Research_and_Science/Cropland/metadata/metadata_ks23.htm) — metadata_ks21/22/23 (publication dates 2022-02-14, 2023-01-30, 2024-01-31)
- `T2_SSURGO`: [USDA NRCS SSURGO via Soil Data Access, survey area KS179 (Sheridan County)](https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest) — SDA live database as queried (mupolygon, mapunit, muaggatt)

## Integration clarification

`lema_membership` is now `historical_boundary_verified_current_unverified` in the fields and extraction script. The earlier legal description and supplied KU polygon support historical inclusion; the current full order was not independently retrieved. This does not confirm current water-right participation or an allocation. All geometry remains approximate. See `../../integration_review.md`.
