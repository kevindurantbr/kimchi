# Teammate 3 weather and evapotranspiration

You are preparing environmental data for a NASA Space Apps crop-rotation comparison prototype in Sheridan 6, western Kansas. The crops under investigation are corn, grain sorghum, and winter wheat. The main team owns integration, recommendations, and UI. You own weather summaries and a reusable ET retrieval path. Work without waiting for the teammate choosing final fields.

## Fixed starting context

Use regional longitude -100.64, latitude 39.36 for access testing, and January 2021 through December 2025. This coordinate is not a verified field or LEMA boundary. NASA POWER daily data have already been downloaded successfully by the main team for PRECTOTCORR, T2M, T2M_MIN, and T2M_MAX. If those files are shared, reuse them. Otherwise retrieve the same small regional series from the documented API. Treat the five years as historical examples, not climate normals or a long-term climate trend.

The final field IDs will be fld01–fld03 in WGS84 GeoJSON. Build the ET adapter to accept any supplied Polygon/MultiPolygon and retain its `field_id`. Test independently with one documented public field or explicitly labeled test geometry; the main team can run it on final fields after delivery. Your test geometry does not choose the demo field.

## Assignment

1. Produce reproducible monthly rainfall totals and mean daily temperatures; keep daily min/max data available for later crop-calendar analysis. Handle fill values and partial months explicitly.
2. Check OpenET account access and extract one monthly ET time series successfully if possible. Record ensemble/product version, aggregation, dates, units, quality flags, and any uncertainty fields supplied by the product. Avoid adding new sensors unless this route fails.
3. Provide a callable downloader accepting `fields.geojson` and a date range, or clear manual export instructions if that is the only route that works. A link to API docs alone is not a verified extraction.

## Sources

- NASA POWER API: https://power.larc.nasa.gov/docs/services/api/temporal/daily/
- NASA POWER parameter documentation: https://power.larc.nasa.gov/parameters/
- OpenET access and documentation links: https://old.etdata.org/api-info/
- OpenET interpretation: https://old.etdata.org/faq/
- NASA expansion announcement: https://science.nasa.gov/blogs/science-news/2025/12/16/expanding-crucial-water-tracking/

## Required delivery

Return `weather.json`, `et_sample.json`, a retrieval script or manual steps, and `water_data_notes.md`. Each JSON envelope: `{"schema_version":"1.0","sources":[],"rows":[]}`. Sources have `source_id` (T3_ prefix), `title`, `url`, `request_without_secrets`, `product_version`, `retrieved_date`, `spatial_support`, and `limitations`.

Weather row: `region_id` = regional_sample, `month` (YYYY-MM), `precipitation_mm`, `mean_temperature_c`, `days_observed`, `days_expected`, `source_ids`, `quality`.

ET row: `field_id`, `month`, `et_mm`, `source_ids`, `quality`, `geometry_status` (documented, test). Label the sample field `test01`; the adapter must retain actual supplied IDs on subsequent runs. Use null for missing values, never zero. Do not make up quality flags or uncertainty ranges if unavailable.

## Acceptance and fallback

Keep tokens out of output files and code; use an environment variable or local unshared secret. Record access barriers and stop if credentials or approval are required. If OpenET is inaccessible, return verified weather plus `et_sample.json` with an empty rows array and an explicit unavailable status in notes. Do not substitute fabricated ET.

ET measures water transferred to the atmosphere from multiple sources; it does not directly measure pumped irrigation. High ET is not automatically crop stress. Rain minus ET is only a partial water-balance indicator. Do not generate future crop-water predictions or classify frost injury from an unsupported universal threshold.

After about 60–90 minutes, deliver one valid time series, a reproducible access route, and remaining blockers. Do not build the interface, choose final rotations, or wait for final field boundaries.
