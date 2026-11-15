# Teammate 2 field history and soil data

You are preparing data for a NASA Space Apps prototype comparing crop rotations for irrigated farms in Sheridan 6, western Kansas. Corn, grain sorghum, and winter wheat are the initial crop library. The main team owns product decisions, comparisons, and app integration. You own field selection and spatial evidence. Work independently from this brief.

## Assignment

Select one usable demonstration field first, then at most three nearby fields. Verify their relationship to the official Sheridan 6 boundary rather than treating all Sheridan County as the LEMA. Obtain a documented field polygon or digitize an approximate analysis boundary and label it as approximate. Field geometry, legal parcel boundaries, crop masks, and irrigation status are different things. A center-pivot shape alone is not proof of current irrigation or ownership.

Obtain 2021–2025 crop classifications using USDA CDL and summarize crop fractions by field and year. Read each year's metadata, preserve categorical labels, and avoid bilinear interpolation of crop classes. Do not equate pixel classification confidence with field-history accuracy. Identify mixed/uncertain years and request confirmation through a data flag.

Obtain SSURGO soil map units and a defensible available-water-storage/capacity summary. State units, depth interval, component weighting, missing coverage, and aggregation method. Available storage capacity is not current soil moisture. Prefer accurate polygons and field summaries to making many raster layers. Do not invent current nitrogen or measured soil-health scores.

## Starting sources

- Official district links, including Sheridan 6: https://www.agriculture.ks.gov/divisions-programs/division-of-water-resources/managing-kansas-water-resources/groundwater-management-districts/g-m-d-no-4
- District renewal map and description (historical document; verify applicability): https://gmd4.org/New/Renewal%20Request%20Offical%2020220216.pdf
- CDL viewer: https://croplandcros.scinet.usda.gov/
- CDL releases and metadata: https://www.nass.usda.gov/Research_and_Science/Cropland/Release/index.php
- SSURGO description: https://www.nrcs.usda.gov/resources/data-and-reports/soil-survey-geographic-database-ssurgo
- Soil Data Access API: https://sdmdataaccess.sc.egov.usda.gov/WebServiceHelp.aspx

## Required delivery

Return `fields.geojson`, `field_observations.json`, source files or reproducible retrieval steps, and `field_data_notes.md`.

GeoJSON: WGS84 longitude/latitude; Polygon or MultiPolygon; unique properties `field_id` (fld01, fld02, fld03), `label`, `boundary_status` (documented, approximate), `irrigation_status` (documented, likely, unknown), `lema_membership` (verified, unverified), `source_ids`.

Observations envelope: `{"schema_version":"1.0","sources":[],"crop_history":[],"soils":[]}`. Source records: `source_id` (T2_ prefix), `title`, `url`, `retrieved_date`, `product_version`, `method`, `limitations`.

Crop-history record: `field_id`, `year`, `crop`, `crop_fraction`, `valid_coverage_fraction`, `confirmation_needed`, `source_ids`. Return multiple rows for mixed crops. Fractions are 0–1; document the denominator.

Soil record: `field_id`, `property`, `value`, `unit`, `depth_top_cm`, `depth_bottom_cm`, `coverage_fraction`, `aggregation_method`, `source_ids`. Numeric unknowns are null. Include map-unit IDs in notes so results are traceable.

## Acceptance and fallback

Prove one end-to-end field extraction before adding fields. Geometry must open on a map in the expected location; IDs must join; years and units must be correct. A screenshot is supporting evidence, not a replacement for data. No farmer names or private ownership records are needed.

If a boundary or dataset is unavailable after a focused attempt, deliver the accessible subset and the blocker. A clearly labeled illustrative geometry is an acceptable UI fallback, but never attach fabricated history or claim verified LEMA membership. Do not wait for weather/ET or change the shared crop scope. After about 60–90 minutes, return one usable field package or a precise access failure report.

## Integration correction

The Greater GMD4 renewal document is not the Sheridan 6 designation. Use the [official Sheridan 6 page](https://www.agriculture.ks.gov/divisions-programs/division-of-water-resources/managing-kansas-water-resources/local-enhanced-management-areas/sheridan-6-lema) to locate the applicable SD-6 order. Current designation verification remains open; see `integration_review.md`.
