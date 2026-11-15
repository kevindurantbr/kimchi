#!/usr/bin/env bash
# Re-download every input used by extract_fields.py. Run from the package root.
# Large rasters go to raw/ (ignored by Git); small vector sources go to src/.
set -euo pipefail
mkdir -p raw src

# 1. SD-6 boundary (Kansas Biological Survey, KU), WGS84 GeoJSON
curl -s "https://services2.arcgis.com/ZOdjAzAQ2B0f85zi/ArcGIS/rest/services/Sheridan6_LEMA_sections_dissolve/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson" \
  -o src/sd6_lema_boundary.geojson

# 2. SD-6 legal description (2018-2022 Order of Designation, GMD4 copy; scanned, read page 8)
curl -sL "https://gmd4.org/New/Sheridan%206%20LEMA%20Order%20of%20Designation.pdf" -o src/gmd4_sd6_order_of_designation.pdf

# 3. BLM PLSS sections over the SD-6 extent
curl -s -G "https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer/2/query" \
  --data-urlencode "geometry=-100.78,39.30,-100.44,39.49" --data-urlencode "geometryType=esriGeometryEnvelope" \
  --data-urlencode "inSR=4326" --data-urlencode "spatialRel=esriSpatialRelIntersects" --data-urlencode "outFields=*" \
  --data-urlencode "outSR=4326" --data-urlencode "f=geojson" -o src/plss_sections.geojson

# 4. CDL 2021-2025, Sheridan County (FIPS 20179). The service returns a cache URL; retry if it times out.
for yr in 2021 2022 2023 2024 2025; do
  for try in 1 2 3; do
    u=$(curl -s -m 90 "https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLFile?year=$yr&fips=20179" \
        | sed -n 's/.*<returnURL>\(.*\)<\/returnURL>.*/\1/p') || true
    [ -n "${u:-}" ] && curl -s -m 300 "$u" -o "raw/cdl_${yr}_20179.tif" && break
    sleep 5
  done
done

# 5. CDL Kansas metadata (2024 and 2025 pages were not found on the NASS site at retrieval time)
for y in 21 22 23; do
  curl -sL "https://www.nass.usda.gov/Research_and_Science/Cropland/metadata/metadata_ks$y.htm" -o "raw/cdl_meta_ks$y.htm"
done

# 6. SSURGO is queried live from Soil Data Access inside extract_fields.py (no download step).
echo "done"
