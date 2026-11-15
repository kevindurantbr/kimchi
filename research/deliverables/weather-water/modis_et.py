#!/usr/bin/env python3
"""NASA MODIS MOD16A2GF v061 8-day ET (ORNL DAAC subset, one pixel per field) -> monthly ET rows.

Standard library only. Output uses the ET adapter's envelope and row shape, so
prototype/compare.py validates it like OpenET output. No key is involved.

  python3 modis_et.py           # rebuild et_modis.json from mod16_raw.json
  python3 modis_et.py --check   # fail if et_modis.json is stale

Rules: value x 0.1 = mm over the composite. Composites are 8 days, except the last of each
year (day 361 to year end: 5 days, 6 in a leap year). Each value is spread evenly over its
days and summed per calendar month, rounded half-up to 0.1 mm. A month with any day lacking
a valid composite (absent, or outside the valid range 0-32700, e.g. fill >= 32761) is null
with quality "missing", never zero.
"""
import argparse
import calendar
import datetime as dt
import hashlib
import json
import sys
from fractions import Fraction
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE_ID = "T3_MODIS_MOD16A2GF"
API = "https://modis.ornl.gov/rst/api/v1/"
START, END = "2021-01-01", "2025-12-31"
VALID_MAX = 32700   # MOD16A2GF ET_500m valid range 0-32700; 32761-32767 are fill/special classes
SPATIAL = "one 500 m MODIS pixel containing the field centroid; not a field-boundary average"


def composite_days(key):
    """'A2021361' -> (first day, number of days the composite covers)."""
    if not (isinstance(key, str) and len(key) == 8 and key[0] == "A" and key[1:].isdigit()):
        raise ValueError("bad composite key %r" % (key,))
    year, doy = int(key[1:5]), int(key[5:])
    length = 366 if calendar.isleap(year) else 365
    if not 1 <= doy <= length or (doy - 1) % 8:
        raise ValueError("composite %s does not start an 8-day period" % key)
    return dt.date(year, 1, 1) + dt.timedelta(doy - 1), min(8, length - doy + 1)


def valid(value):
    return type(value) is int and 0 <= value <= VALID_MAX


def monthly_et(composites, start=START, end=END, scale=Fraction(1, 10)):
    """{composite key: raw value} -> [(YYYY-MM, mm or None)] for every month in the period."""
    daily = {}
    for key, value in composites.items():
        first, days = composite_days(key)
        for i in range(days):
            daily[first + dt.timedelta(i)] = Fraction(value) * scale / days if valid(value) else None
    s, e = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    out, y, m = [], s.year, s.month
    while (y, m) <= (e.year, e.month):
        days = [dt.date(y, m, d) for d in range(1, calendar.monthrange(y, m)[1] + 1)]
        vals = [daily.get(d) for d in days]
        if any(v is None for v in vals):
            out.append(("%04d-%02d" % (y, m), None))
        else:
            tenths = int(sum(vals) * 10 + Fraction(1, 2))   # half-up; ET is never negative
            out.append(("%04d-%02d" % (y, m), float(Fraction(tenths, 10))))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def convert(raw, fields_doc, raw_sha256=None):
    boundary = {f["properties"]["field_id"]: f for f in fields_doc["features"]}
    rows, points = [], {}
    for fid in sorted(raw["fields"]):
        if fid not in boundary:
            raise ValueError("raw field %s is not in fields.geojson" % fid)
        rec, meta = raw["fields"][fid], raw["meta"][fid]
        ring = boundary[fid]["geometry"]["coordinates"][0]
        if not (min(p[0] for p in ring) <= rec["lon"] <= max(p[0] for p in ring)
                and min(p[1] for p in ring) <= rec["lat"] <= max(p[1] for p in ring)):
            raise ValueError("%s: requested point is outside the field" % fid)
        if meta.get("band") != "ET_500m" or Fraction(str(meta.get("scale"))) != Fraction(1, 10) \
                or meta.get("units") != "kg/m^2/8day":
            raise ValueError("%s: unexpected band/scale/units %r" % (fid, meta))
        points[fid] = dict({"latitude": rec["lat"], "longitude": rec["lon"]},
                           **{k: meta[k] for k in ("xllcorner", "yllcorner", "cellsize") if k in meta})
        status = boundary[fid]["properties"]["boundary_status"]
        for month, mm in monthly_et(rec["composites"]):
            rows.append({"field_id": fid, "month": month, "et_mm": mm, "source_ids": [SOURCE_ID],
                         "quality": "missing" if mm is None else "reported", "geometry_status": status})
    cell = {round(float(p["cellsize"]), 1) for p in points.values() if "cellsize" in p}
    source = {
        "source_id": SOURCE_ID,
        "title": "NASA MODIS MOD16A2GF v061 evapotranspiration (ORNL DAAC subset)",
        "url": API,
        "request_without_secrets": "No key. GET %s per composite date and field; points in requested_points." % raw["request_template"],
        "raw_file_sha256": raw_sha256,
        "product": "MOD16A2GF", "collection": "061", "band": "ET_500m",
        "pixel_size_m": "~463 (sinusoidal grid cell %s m)" % ", ".join(str(c) for c in sorted(cell)) if cell else "~463",
        "requested_points": points,
        "product_version": "MOD16A2GF collection 061, gap-filled 8-day composites, retrieved %s" % raw["retrieved"],
        "retrieved_date": raw["retrieved"][:10],
        "monthly_output": {"date_range": [START, END], "interval": "monthly", "variable": "et", "units": "mm"},
        "spatial_support": SPATIAL[0].upper() + SPATIAL[1:] + ".",
        "limitations": (
            "Satellite model estimate of actual ET (crop water use: evaporation plus transpiration from rain, "
            "irrigation and soil water). Not pumping and not irrigation applied. Coarser than OpenET (30 m "
            "field-boundary means): the pixel can include land outside the field. Values x 0.1 = mm per composite; "
            "8-day composites (last of each year 5 or 6 days) are spread evenly over their days and summed per "
            "calendar month, rounded to 0.1 mm. A month is null (missing) if any day lacks a valid composite; "
            "missing is never zero. MOD16 has no irrigation input, so it may underestimate irrigated crop water use. "
            "Gap-filled annual reprocessing; not a forecast."),
    }
    return {"schema_version": "1.0", "sources": [source], "rows": rows}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--raw", type=Path, default=HERE / "mod16_raw.json")
    ap.add_argument("--fields", type=Path, default=HERE.parent / "fields-soils/fields.geojson")
    ap.add_argument("--out", type=Path, default=HERE / "et_modis.json")
    ap.add_argument("--check", action="store_true", help="fail if --out differs from a rebuild")
    args = ap.parse_args(argv)
    raw = args.raw.read_bytes()
    doc = convert(json.loads(raw), json.loads(args.fields.read_text()), hashlib.sha256(raw).hexdigest())
    text = json.dumps(doc, indent=2, ensure_ascii=False) + "\n"
    if args.check:
        if args.out.read_text() != text:
            sys.exit("%s is stale; run modis_et.py" % args.out)
        print("%s is current (%d rows)" % (args.out.name, len(doc["rows"])))
    else:
        args.out.write_text(text)
        print("wrote %s (%d rows)" % (args.out, len(doc["rows"])))


if __name__ == "__main__":
    main()
