"""Build fields.geojson and field_observations.json for Teammate 2 (field history and soils).

Inputs (see field_data_notes.md for retrieval steps):
  src/sd6_lema_boundary.geojson   KBS/KU SD-6 boundary (ArcGIS FeatureServer export)
  src/plss_sections.geojson       BLM CadNSDI PLSS sections (layer 2) for the SD-6 extent
  raw/cdl_<year>_20179.tif        USDA NASS CDL, Sheridan County (FIPS 20179), 30 m, EPSG:5070-equivalent
Network: Soil Data Access (SDA) REST for SSURGO map units and muaggatt.

Each CDL file carries its own grid. The 2022 and 2023 county clips start one pixel east and north
of the 2021, 2024 and 2025 clips, so the origin is read from every file and never assumed.

Run: python scripts/extract_fields.py   (needs numpy, shapely, pyproj, tifffile)
"""
import json, urllib.request, datetime
import numpy as np
from cdl_grid import PIX, read_cdl
from pyproj import Transformer
from shapely import transform as shp_transform
from shapely.geometry import shape, mapping, Point, box
from shapely.ops import unary_union
from shapely import wkt as shp_wkt

TODAY = datetime.date.today().isoformat()  # SSURGO is queried live on each run
FILES_RETRIEVED = "2026-11-14"             # CDL, PLSS, KU boundary, NAIP and the 2018 order copy
ORDER_READ = "2026-11-15"                  # 2023-2027 Consolidated Order read on the KDA site
YEARS = range(2021, 2026)
LIB = {1: "Corn", 4: "Sorghum", 24: "Winter Wheat"}
CDL_NAMES = {0: "Background/outside county", 1: "Corn", 4: "Sorghum", 5: "Soybeans", 6: "Sunflower",
             21: "Barley", 23: "Spring Wheat", 24: "Winter Wheat", 26: "Dbl Crop WinWht/Soybeans",
             28: "Oats", 36: "Alfalfa", 37: "Other Hay/Non Alfalfa", 59: "Sod/Grass Seed",
             61: "Fallow/Idle Cropland", 111: "Open Water", 121: "Developed/Open Space",
             122: "Developed/Low Intensity", 123: "Developed/Med Intensity", 131: "Barren",
             141: "Deciduous Forest", 152: "Shrubland", 176: "Grassland/Pasture", 190: "Woody Wetlands",
             195: "Herbaceous Wetlands", 205: "Triticale", 225: "Dbl Crop WinWht/Corn",
             236: "Dbl Crop WinWht/Sorghum", 238: "Dbl Crop WinWht/Cotton"}
MIN_ROW = 0.01        # classes below 1% of valid pixels are pooled into "Other"
CONFIRM_BELOW = 0.85  # dominant-class share below this -> confirmation_needed
LOW_ACCURACY = {4}    # Sorghum: Kansas 2023 producer's accuracy 81.0% (<85%), often confused with corn -> confirmation_needed

FIELDS = [  # PLSS quarter sections chosen by scripts/select_fields.py (pivot-like CDL pattern)
    dict(field_id="fld01", sec="KS060070S0300W0SN33", q="SW", label="T7S R30W Sec 33 SW quarter (approx. pivot circle)", irrigation="likely"),
    dict(field_id="fld02", sec="KS060080S0300W0SN04", q="NE", label="T8S R30W Sec 4 NE quarter (approx. pivot circle)", irrigation="likely"),
    dict(field_id="fld03", sec="KS060070S0300W0SN29", q="NW", label="T7S R30W Sec 29 NW quarter (approx. pivot circle)", irrigation="likely"),
]

to5070 = Transformer.from_crs(4326, 5070, always_xy=True)
to4326 = Transformer.from_crs(5070, 4326, always_xy=True)
p5070 = lambda g: shp_transform(g, lambda xy: np.column_stack(to5070.transform(xy[:, 0], xy[:, 1])))
p4326 = lambda g: shp_transform(g, lambda xy: np.column_stack(to4326.transform(xy[:, 0], xy[:, 1])))

lema = p5070(unary_union([shape(f["geometry"]) for f in json.load(open("src/sd6_lema_boundary.geojson"))["features"]]))
secs = {f["properties"]["FRSTDIVID"]: p5070(shape(f["geometry"])) for f in json.load(open("src/plss_sections.geojson"))["features"]}
cdl = {y: read_cdl(f"raw/cdl_{y}_20179.tif") for y in YEARS}   # year -> (array, x0, y0)
GRID_LOG = {y: dict(x0=x0, y0=y0, rows=a.shape[0], cols=a.shape[1]) for y, (a, x0, y0) in cdl.items()}

def pixel_values(geom, year):
    """Nearest-neighbour sampling: every 30 m pixel whose centre lies inside geom (no resampling)."""
    arr, X0, Y0 = cdl[year]
    H, W = arr.shape
    minx, miny, maxx, maxy = geom.bounds
    c0, c1 = int((minx - X0) // PIX), int((maxx - X0) // PIX) + 1
    r0, r1 = int((Y0 - maxy) // PIX), int((Y0 - miny) // PIX) + 1
    vals = [arr[r, c] for r in range(max(r0, 0), min(r1, H)) for c in range(max(c0, 0), min(c1, W))
            if geom.contains(Point(X0 + PIX * c + PIX / 2, Y0 - PIX * r - PIX / 2))]
    return np.array(vals, dtype=np.uint8)

def quarter(sec_geom, q):
    minx, miny, maxx, maxy = sec_geom.bounds
    mx, my = (minx + maxx) / 2, (miny + maxy) / 2
    b = {"NW": (minx, my, mx, maxy), "NE": (mx, my, maxx, maxy), "SW": (minx, miny, mx, my), "SE": (mx, miny, maxx, my)}[q]
    return box(*b).intersection(sec_geom)

def fit_radius(center, qgeom):
    """Pick the pivot radius where the per-year dominant crop share in a 20 m ring falls below 0.5."""
    radii = list(range(300, 441, 20))
    best = radii[0]
    for r in radii:
        ring = center.buffer(r + 20, 64).difference(center.buffer(r, 64))
        shares = []
        for y in YEARS:
            core = pixel_values(center.buffer(300, 64), y); dom = np.bincount(core).argmax()
            v = pixel_values(ring, y); shares.append((v == dom).mean() if len(v) else 0)
        if np.mean(shares) >= 0.5: best = r + 20
        else: break
    return min(best, 400)

def sda(query):
    req = urllib.request.Request("https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest",
                                 data=json.dumps({"query": query, "format": "JSON+COLUMNNAME"}).encode(),
                                 headers={"Content-Type": "application/json"})
    t = json.load(urllib.request.urlopen(req, timeout=120)).get("Table", [])
    return [dict(zip(t[0], row)) for row in t[1:]] if t else []

SOURCES = [
    dict(source_id="T2_SD6_BOUNDARY", title="Sheridan 6 LEMA boundary (Kansas Biological Survey, University of Kansas)",
         url="https://services2.arcgis.com/ZOdjAzAQ2B0f85zi/ArcGIS/rest/services/Sheridan6_LEMA_sections_dissolve/FeatureServer/0",
         retrieved_date=FILES_RETRIEVED, product_version="ArcGIS item 90041416e6d7427d839d3e0d55229082, modified 2023-01-04",
         method="FeatureServer query, outSR=4326, f=geojson. Dissolved PLSS sections from Kansas DASC.",
         limitations="Third-party reconstruction, not a DWR file. Its 99 sections match the T2_SD6_ORDER legal description exactly (section-by-section check against T2_PLSS)."),
    dict(source_id="T2_SD6_ORDER", title="Consolidated Order of Decision and Designation Renewing Sheridan 6 LEMA for 2023-2027 (KDA DWR)",
         url="https://www.agriculture.ks.gov/home/showpublisheddocument/4946/638466570231300000",
         retrieved_date=ORDER_READ, product_version="Signed by the Chief Engineer 2022-10-14; in effect 2023-01-01 to 2027-12-31",
         method="Read in a browser from the official Sheridan 6 LEMA page. Section VII (pages 7-8) designates T7S R28W 19-21, 28-33; T7S R29W 4-9, 16-36; T7S R30W 19-36; T8S R29W 1-18; T8S R30W 1-18; Thomas County T8S R31W 22-27, 34-36 (99 sections). Findings of fact item 1 (page 6) lists the same sections.",
         limitations="Section membership of an approximate field only. Does not show water-right enrolment, allocation or compliance. A 2026 renewal proceeding (001-DWR-LEMA-2026) proposes adding area to the LEMA; the boundary after 2027-12-31 is not verified."),
    dict(source_id="T2_SD6_ORDER_2018", title="Order of Designation, Sheridan 6 LEMA Management Plan 2018-2022 (KDA DWR, 001-DWR-LEMA-2017), copy hosted by GMD4",
         url="https://gmd4.org/New/Sheridan%206%20LEMA%20Order%20of%20Designation.pdf",
         retrieved_date=FILES_RETRIEVED, product_version="Order dated 2017 for 2018-2022; Section VII lists boundary sections",
         method="Read the scanned PDF, page 8: T7S R30W Sections 19-36; T8S R30W Sections 1-18 (plus other townships).",
         limitations="Historical. Superseded by T2_SD6_ORDER; kept to show the boundary is unchanged since 2018."),
    dict(source_id="T2_PLSS", title="BLM National PLSS CadNSDI, PLSS Section layer",
         url="https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer/2",
         retrieved_date=FILES_RETRIEVED, product_version="MapServer 11.5 (as served)",
         method="Envelope query over the SD-6 extent, outSR=4326. Quarter sections split at the section bounding-box midpoints.",
         limitations="Survey grid, not field edges or legal parcels. Quarter split is geometric, not a surveyed aliquot line."),
    dict(source_id="T2_FIELD_DIGITIZED", title="Approximate pivot-circle analysis boundaries (this package)",
         url="scripts/extract_fields.py", retrieved_date=FILES_RETRIEVED, product_version="1.1",
         method="Circle centred on the PLSS quarter-section centroid. Radius fitted from the CDL radial crop pattern (300-400 m).",
         limitations="Approximate. Not a surveyed field, parcel, or confirmed pivot. Center and radius may be off by tens of metres."),
    dict(source_id="T2_NAIP", title="USGS NAIP imagery (ImageServer), visual check of pivot geometry",
         url="https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer",
         retrieved_date=FILES_RETRIEVED, product_version="Most recent mosaic served on retrieval date; acquisition year not read",
         method="exportImage in EPSG:3857 over the three fields; outlines drawn on top (field_check_imagery.jpg).",
         limitations="Visual evidence only. A pivot circle shows equipment geometry, not current irrigation, water rights or ownership."),
    dict(source_id="T2_CDL", title="USDA NASS Cropland Data Layer 2021-2025, Sheridan County KS (FIPS 20179)",
         url="https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLFile?year={year}&fips=20179",
         retrieved_date=FILES_RETRIEVED, product_version="CDL 2021, 2022, 2023, 2024, 2025 county clips from CropScape cache (30 m, Albers NAD83)",
         method="Pixel-centre-in-polygon counts, no resampling or interpolation. Fractions over valid (non-zero) pixels. Grid origin and CRS GeoKeys read and checked per file: 2022 and 2023 tiepoint (-404175, 1848585), 2021/2024/2025 tiepoint (-404205, 1848555).",
         limitations="Classification error applies per pixel. Kansas producer's accuracy 2023: corn 90.6%, sorghum 81.0%, winter wheat 88.5% (metadata_ks23). 2024 and 2025 Kansas metadata pages were not found on the NASS site. From 2024 NASS produces the CDL at 10 m; the 2024 and 2025 county clips used here are 30 m files, so edge pixels can differ from the 10 m product."),
    dict(source_id="T2_CDL_META", title="CDL Kansas metadata 2021-2023 (NASS)",
         url="https://www.nass.usda.gov/Research_and_Science/Cropland/metadata/metadata_ks23.htm",
         retrieved_date=FILES_RETRIEVED, product_version="metadata_ks21/22/23 (publication dates 2022-02-14, 2023-01-30, 2024-01-31)",
         method="Read the accuracy tables for codes 1, 4, 24.", limitations="State-level accuracy; not field-specific. 2024-2025 not located."),
    dict(source_id="T2_SSURGO", title="USDA NRCS SSURGO via Soil Data Access, survey area KS179 (Sheridan County)",
         url="https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest",
         retrieved_date=TODAY, product_version="SDA live database as queried (mupolygon, mapunit, muaggatt)",
         method="Spatial intersection of each field polygon with mupolygon; clipped areas computed in EPSG:5070; muaggatt.aws* (component-weighted average) area-weighted across map units.",
         limitations="Available water storage is a soil property estimate, not current soil moisture. Map-unit averages hide within-unit variation."),
]

features, crop_rows, soil_rows, notes = [], [], [], {}
for f in FIELDS:
    qg = quarter(secs[f["sec"]], f["q"])
    c = qg.centroid
    r = fit_radius(c, qg)
    field5070 = c.buffer(r, 64).intersection(qg)
    field4326 = p4326(field5070)
    inside = lema.buffer(1).contains(field5070)
    features.append({"type": "Feature", "geometry": mapping(field4326), "properties": {
        "field_id": f["field_id"], "label": f["label"], "boundary_status": "approximate",
        "irrigation_status": f["irrigation"], "lema_membership": "verified_2023_2027_order" if inside else "unverified",
        "source_ids": ["T2_FIELD_DIGITIZED", "T2_PLSS", "T2_SD6_BOUNDARY", "T2_SD6_ORDER", "T2_CDL", "T2_NAIP"],
        "plss_quarter": f'{f["sec"]} {f["q"]}', "radius_m": r, "area_ha": round(field5070.area / 1e4, 1)}})
    notes[f["field_id"]] = dict(radius_m=r, area_ha=round(field5070.area / 1e4, 1), inside_lema=inside,
                                centroid=[round(v, 6) for v in field4326.centroid.coords[0]])

    # --- CDL crop history
    hist = {}
    for y in YEARS:
        v = pixel_values(field5070, y); n_all = len(v); valid = v[v != 0]; n = len(valid)
        cls, cnt = np.unique(valid, return_counts=True)
        frac = sorted(zip(cls.tolist(), (cnt / n).tolist()), key=lambda t: -t[1])
        dom_code, dom_share = frac[0]
        confirm = dom_share < CONFIRM_BELOW or dom_code not in LIB or dom_code in LOW_ACCURACY
        other = sum(s for k, s in frac if s < MIN_ROW)
        rows = [(CDL_NAMES.get(k, f"CDL class {k}"), s) for k, s in frac if s >= MIN_ROW]
        if other > 0: rows.append(("Other (classes <1% each)", other))
        for name, s in rows:
            crop_rows.append(dict(field_id=f["field_id"], year=y, crop=name, crop_fraction=round(s, 3),
                                  valid_coverage_fraction=round(n / n_all, 3), confirmation_needed=bool(confirm),
                                  source_ids=["T2_CDL", "T2_CDL_META"]))
        hist[y] = dict(pixels=n_all, valid=n, top=[(CDL_NAMES.get(k, k), round(s, 3)) for k, s in frac[:3]], confirm=confirm)
    notes[f["field_id"]]["cdl"] = hist

    # --- SSURGO
    wkt = field4326.wkt
    q = f"""SELECT mu.mukey, mu.musym, mu.muname, l.areasymbol,
      mp.mupolygongeo.STIntersection(geometry::STGeomFromText('{wkt}', 4326)).STAsText() AS clip_wkt,
      ma.aws025wta, ma.aws050wta, ma.aws0100wta, ma.aws0150wta, ma.hydgrpdcd, ma.drclassdcd
    FROM mupolygon mp JOIN mapunit mu ON mu.mukey = mp.mukey JOIN legend l ON l.lkey = mu.lkey
    LEFT JOIN muaggatt ma ON ma.mukey = mu.mukey
    WHERE mp.mupolygongeo.STIntersects(geometry::STGeomFromText('{wkt}', 4326)) = 1"""
    units = {}
    for row in sda(q):
        a = p5070(shp_wkt.loads(row["clip_wkt"])).area
        u = units.setdefault(row["mukey"], dict(row, area=0.0)); u["area"] += a
    total = field5070.area
    mus = sorted(units.values(), key=lambda u: -u["area"])
    notes[f["field_id"]]["ssurgo"] = [dict(mukey=u["mukey"], musym=u["musym"], muname=u["muname"], areasymbol=u["areasymbol"],
                                           share=round(u["area"] / total, 3), aws0150_cm=u["aws0150wta"], hydgrp=u["hydgrpdcd"],
                                           drainage=u["drclassdcd"]) for u in mus]
    for prop, col, bot in [("available_water_storage", "aws025wta", 25), ("available_water_storage", "aws050wta", 50),
                           ("available_water_storage", "aws0100wta", 100), ("available_water_storage", "aws0150wta", 150)]:
        have = [(u["area"], float(u[col])) for u in mus if u[col] not in (None, "")]
        cov = sum(a for a, _ in have) / total
        val = round(sum(a * v for a, v in have) / sum(a for a, _ in have), 2) if have else None
        soil_rows.append(dict(field_id=f["field_id"], property=prop, value=val, unit="cm water", depth_top_cm=0,
                              depth_bottom_cm=bot, coverage_fraction=round(cov, 3),
                              aggregation_method="Area-weighted mean over SSURGO map units clipped to the field; each map-unit value is SSURGO muaggatt component-percent-weighted average",
                              source_ids=["T2_SSURGO"]))
    for prop, col in [("hydrologic_group_dominant_condition", "hydgrpdcd"), ("drainage_class_dominant_condition", "drclassdcd")]:
        have = {}
        for u in mus:
            if u[col]: have[u[col]] = have.get(u[col], 0) + u["area"]
        top = max(have.items(), key=lambda t: t[1]) if have else (None, 0)
        soil_rows.append(dict(field_id=f["field_id"], property=prop, value=top[0], unit=None, depth_top_cm=None,
                              depth_bottom_cm=None, coverage_fraction=round(top[1] / total, 3),
                              aggregation_method="Category covering the largest field area (muaggatt dominant-condition value per map unit)",
                              source_ids=["T2_SSURGO"]))

json.dump({"type": "FeatureCollection", "features": features}, open("fields.geojson", "w"), indent=1)
json.dump({"schema_version": "1.0", "sources": SOURCES, "crop_history": crop_rows, "soils": soil_rows},
          open("field_observations.json", "w"), indent=1)
notes["cdl_grids"] = GRID_LOG
json.dump(notes, open("extraction_log.json", "w"), indent=1, default=str)
print(json.dumps(notes, indent=1, default=str))
