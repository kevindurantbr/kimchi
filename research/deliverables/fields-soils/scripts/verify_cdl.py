"""Independent checks of the CDL extraction. Writes cdl_verification.json. Run from the package root.

This script does not import cdl_grid.py or extract_fields.py and does not use shapely.
1. Server check: at pixels where the per-file origin and the v1.0 hardcoded origin give different
   classes, compare both with the NASS CropScape GetCDLValue point service.
2. Control: at random class-edge pixels in the three-field area, compare local values with the server
   for the years whose origin did not change.
3. Re-count: count fld02 2023 again with numpy ray casting on the published polygon and compare with
   field_observations.json and extraction_log.json.
Needs numpy, pyproj, tifffile and network access.
"""
import json, re, time, random, urllib.request
import numpy as np, tifffile
from pyproj import Transformer

OLD_X0, OLD_Y0 = -404205.0, 1848555.0   # origin hardcoded for every year in extract_fields.py v1.0
AREA = (-401500, 1827500, -397400, 1832500)   # EPSG:5070 box around the three fields

def grid(path):
    with tifffile.TiffFile(path) as t:
        p = t.pages[0]; tie = p.tags["ModelTiepointTag"].value; sc = p.tags["ModelPixelScaleTag"].value
        return p.asarray(), tie[3], tie[4], sc[0]

def server_value(year, x, y):
    u = f"https://nassgeodata.gmu.edu/axis2/services/CDLService/GetCDLValue?year={year}&x={x}&y={y}"
    v = int(re.search(r"value:\s*(\d+)", urllib.request.urlopen(u, timeout=60).read().decode()).group(1))
    time.sleep(0.3)
    return v

random.seed(7)
report = {"server_check": {}, "control": {}, "recount": {}}

for year in (2022, 2023):
    a, x0, y0, pix = grid(f"raw/cdl_{year}_20179.tif")
    cands = []
    for r in range(int((y0 - AREA[3]) // pix), int((y0 - AREA[1]) // pix)):
        for c in range(int((AREA[0] - x0) // pix), int((AREA[2] - x0) // pix)):
            xc, yc = x0 + pix * c + pix / 2, y0 - pix * r - pix / 2
            ro, co = int((OLD_Y0 - yc) // pix), int((xc - OLD_X0) // pix)
            if a[ro, co] != a[r, c]: cands.append((xc, yc, int(a[r, c]), int(a[ro, co])))
    pts = random.sample(cands, min(12, len(cands)))
    res = [(x, y, server_value(year, x, y), vn, vo) for x, y, vn, vo in pts]
    report["server_check"][year] = dict(file_origin=[x0, y0], v1_origin=[OLD_X0, OLD_Y0], disagreeing_pixels=len(cands),
                                        sampled=len(res), server_equals_file_origin=sum(s == vn for _, _, s, vn, _ in res),
                                        server_equals_v1_origin=sum(s == vo for _, _, s, _, vo in res),
                                        points_x_y_server_fileorigin_v1origin=res)

for year in (2021, 2024, 2025):
    a, x0, y0, pix = grid(f"raw/cdl_{year}_20179.tif")
    rows = []
    while len(rows) < 8:
        r = random.randint(int((y0 - AREA[3]) // pix), int((y0 - AREA[1]) // pix))
        c = random.randint(int((AREA[0] - x0) // pix), int((AREA[2] - x0) // pix))
        if a[r, c] != a[r, c + 1] or a[r, c] != a[r + 1, c]:
            x, y = x0 + pix * c + pix / 2, y0 - pix * r - pix / 2
            s = server_value(year, x, y); row = dict(x=x, y=y, server=s, local=int(a[r, c]))
            if s != a[r, c]:   # probe four points inside the same 30 m pixel
                row["server_subpixel"] = [server_value(year, x + dx, y + dy) for dx, dy in [(-10, 10), (10, 10), (-10, -10), (10, -10)]]
            rows.append(row)
    report["control"][year] = dict(file_origin=[x0, y0], edge_points=len(rows), matches=sum(r["server"] == r["local"] for r in rows),
                                   mismatches=[r for r in rows if r["server"] != r["local"]])

to5070 = Transformer.from_crs(4326, 5070, always_xy=True)
feat = next(f for f in json.load(open("fields.geojson"))["features"] if f["properties"]["field_id"] == "fld02")
ring = np.array(feat["geometry"]["coordinates"][0]); px, py = to5070.transform(ring[:, 0], ring[:, 1])
a, x0, y0, pix = grid("raw/cdl_2023_20179.tif")
C, R = np.meshgrid(np.arange(int((px.min() - x0) // pix), int((px.max() - x0) // pix) + 1),
                   np.arange(int((y0 - py.max()) // pix), int((y0 - py.min()) // pix) + 1))
X, Y = x0 + pix * C + pix / 2, y0 - pix * R - pix / 2
inside = np.zeros(X.shape, bool)
for i in range(len(px) - 1):   # even-odd ray casting
    xa, ya, xb, yb = px[i], py[i], px[i + 1], py[i + 1]
    inside ^= ((ya > Y) != (yb > Y)) & (X < (xb - xa) * (Y - ya) / (yb - ya + 1e-12) + xa)
vals = a[R[inside], C[inside]]; valid = vals[vals != 0]
cls, cnt = np.unique(valid, return_counts=True)
log = json.load(open("extraction_log.json"))["fld02"]["cdl"]["2023"]
report["recount"] = dict(field_id="fld02", year=2023, pixels=int(inside.sum()), valid=int(len(valid)),
                         fractions_by_cdl_code={int(k): round(float(v) / len(valid), 3) for k, v in zip(cls, cnt)},
                         published_pixels=log["pixels"], published_valid=log["valid"],
                         published_rows={r["crop"]: r["crop_fraction"] for r in json.load(open("field_observations.json"))["crop_history"]
                                         if r["field_id"] == "fld02" and r["year"] == 2023})

json.dump(report, open("cdl_verification.json", "w"), indent=1)
for y, v in report["server_check"].items(): print(y, "server == file origin", v["server_equals_file_origin"], "/", v["sampled"], "| server == v1 origin", v["server_equals_v1_origin"])
for y, v in report["control"].items(): print(y, "control edge points", v["matches"], "/", v["edge_points"])
print("recount", report["recount"])
