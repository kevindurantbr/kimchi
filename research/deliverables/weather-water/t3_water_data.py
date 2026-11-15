#!/usr/bin/env python3
"""
Teammate 3 - weather summaries and a reusable OpenET ET adapter.

NASA Space Apps crop-rotation prototype, Sheridan 6 (western Kansas).
Standard library only (Python 3.8+). No API keys are ever written to disk or printed.

Sub-commands
------------
  weather       Download NASA POWER daily data (or rebuild from a saved daily CSV)
                and write weather.json (monthly) + weather_daily.csv (daily min/max kept).
  et            Monthly OpenET ensemble ET for every Polygon/MultiPolygon in a
                fields GeoJSON, keeping each feature's `field_id`. Needs OPENET_API_KEY.
  check-openet  Report whether the OpenET API accepts the current credentials.
  selftest      Offline tests of the parsing, geometry, envelope and secret handling.

Examples
--------
  python3 t3_water_data.py weather --out-dir .
  python3 t3_water_data.py weather --from-daily-csv weather_daily.csv \
          --provenance T3_power_provenance.json --out-dir .
  export OPENET_API_KEY=...            # never commit or share this value
  python3 t3_water_data.py et --fields fields.geojson --start 2021-01-01 --end 2025-12-31 --out et.json
  python3 t3_water_data.py et --fields fields_test01.geojson --start 2021-01-01 --end 2025-12-31 \
          --out et_sample.json --dry-run
"""

import argparse
import calendar
import csv
import datetime as dt
import hashlib
import io
import json
import math
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from decimal import Decimal, ROUND_HALF_UP

SCHEMA_VERSION = "1.0"

# ----------------------------------------------------------------------------
# NASA POWER (weather)
# ----------------------------------------------------------------------------
POWER_ENDPOINT = "https://power.larc.nasa.gov/api/temporal/daily/point"
POWER_DOCS = "https://power.larc.nasa.gov/docs/services/api/temporal/daily/"
POWER_PARAMS = ["PRECTOTCORR", "T2M", "T2M_MIN", "T2M_MAX"]
POWER_COMMUNITY = "AG"
DEFAULT_LON, DEFAULT_LAT = -100.64, 39.36
DEFAULT_START, DEFAULT_END = "2021-01-01", "2025-12-31"
REGION_ID = "regional_sample"
WEATHER_SOURCE_ID = "T3_NASA_POWER_DAILY"
DAILY_COLUMNS = ["date", "precipitation_mm", "t2m_mean_c", "t2m_min_c", "t2m_max_c"]
PARAM_TO_COLUMN = {"PRECTOTCORR": "precipitation_mm", "T2M": "t2m_mean_c",
                   "T2M_MIN": "t2m_min_c", "T2M_MAX": "t2m_max_c"}

# ----------------------------------------------------------------------------
# OpenET (evapotranspiration)
# ----------------------------------------------------------------------------
OPENET_BASE = "https://openet-api.org"
OPENET_POLYGON = OPENET_BASE + "/raster/timeseries/polygon"
OPENET_DOCS = "https://openet.gitbook.io/docs/reference/api-reference/raster"
OPENET_KEY_ENV = "OPENET_API_KEY"
ET_SOURCE_ID = "T3_OPENET_ENSEMBLE_MONTHLY"
ET_UNC_SOURCE_ID = "T3_OPENET_ENSEMBLE_MAD_RANGE"
GEOMETRY_STATUSES = ("documented", "test")


class AccessError(RuntimeError):
    """Credentials missing or refused (401/403). Stop: do not substitute data."""


class OpenETResponseError(RuntimeError):
    """Response could not be interpreted; raw body is saved for inspection."""


def utc_now():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def envelope(sources, rows):
    return {"schema_version": SCHEMA_VERSION, "sources": sources, "rows": rows}


def write_json(obj, path):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def q2(value):
    """Round a Decimal to 2 dp, ties away from zero; return float."""
    return float(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def parse_date(text):
    return dt.date.fromisoformat(text)


def iter_days(start, end):
    d = start
    while d <= end:
        yield d
        d += dt.timedelta(days=1)


# ---------------------------------------------------------------- weather ---
def power_request_url(lon, lat, start, end):
    query = {
        "parameters": ",".join(POWER_PARAMS),
        "community": POWER_COMMUNITY,
        "longitude": lon,
        "latitude": lat,
        "start": start.strftime("%Y%m%d"),
        "end": end.strftime("%Y%m%d"),
        "format": "JSON",
    }
    return POWER_ENDPOINT + "?" + urllib.parse.urlencode(query, safe=",")


def fetch_power(url, timeout=120):
    req = urllib.request.Request(url, headers={"accept": "application/json",
                                               "User-Agent": "spaceapps-t3/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
    return raw, json.loads(raw.decode("utf-8"))


def daily_from_power_json(doc):
    """Return {date: {column: float|None}} with fill values turned into None."""
    fill = doc.get("header", {}).get("fill_value", -999)
    params = doc["properties"]["parameter"]
    missing = [p for p in POWER_PARAMS if p not in params]
    if missing:
        raise ValueError("POWER response lacks parameters: %s" % missing)
    out = {}
    for p in POWER_PARAMS:
        for key, val in params[p].items():
            day = dt.date(int(key[:4]), int(key[4:6]), int(key[6:8]))
            rec = out.setdefault(day, {c: None for c in DAILY_COLUMNS[1:]})
            ok = val is not None and not (isinstance(val, float) and math.isnan(val)) \
                and float(val) != float(fill)
            rec[PARAM_TO_COLUMN[p]] = float(val) if ok else None
    return out


def write_daily_csv(daily, path):
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(DAILY_COLUMNS)
        for day in sorted(daily):
            rec = daily[day]
            w.writerow([day.isoformat()] + ["" if rec[c] is None else "%.2f" % rec[c]
                                            for c in DAILY_COLUMNS[1:]])


def read_daily_csv(path):
    daily = {}
    with open(path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            daily[parse_date(row["date"])] = {
                c: (None if row[c].strip() == "" else float(row[c])) for c in DAILY_COLUMNS[1:]}
    return daily


def monthly_weather_rows(daily, start, end):
    """Monthly totals/means with explicit partial-month handling.

    days_expected : calendar days of the month inside [start, end]
    days_observed : days with BOTH a valid precipitation and a valid mean temperature
    precipitation_mm : sum of daily values only when every expected day has valid
                       precipitation; otherwise null (a partial sum would be biased low)
    mean_temperature_c : mean of valid daily T2M values (null if none)
    quality : complete | partial | missing
    """
    rows = []
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        first = max(dt.date(y, m, 1), start)
        last = min(dt.date(y, m, calendar.monthrange(y, m)[1]), end)
        expected = (last - first).days + 1
        p_vals, t_vals, both = [], [], 0
        for d in iter_days(first, last):
            rec = daily.get(d)
            p = rec["precipitation_mm"] if rec else None
            t = rec["t2m_mean_c"] if rec else None
            if p is not None:
                p_vals.append(Decimal(repr(p)))
            if t is not None:
                t_vals.append(Decimal(repr(t)))
            if p is not None and t is not None:
                both += 1
        precip = q2(sum(p_vals, Decimal(0))) if len(p_vals) == expected else None
        temp = q2(sum(t_vals, Decimal(0)) / len(t_vals)) if t_vals else None
        quality = "complete" if both == expected else ("partial" if both > 0 else "missing")
        rows.append({
            "region_id": REGION_ID,
            "month": "%04d-%02d" % (y, m),
            "precipitation_mm": precip,
            "mean_temperature_c": temp,
            "days_observed": both,
            "days_expected": expected,
            "source_ids": [WEATHER_SOURCE_ID],
            "quality": quality,
        })
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return rows


def weather_source(prov):
    hdr = prov.get("power_header", {})
    api = hdr.get("api", {})
    return {
        "source_id": WEATHER_SOURCE_ID,
        "title": "NASA POWER Daily API, point request: PRECTOTCORR, T2M, T2M_MIN, T2M_MAX",
        "url": POWER_DOCS,
        "request_without_secrets": prov["request_url"],
        "product_version": "%s %s; header.sources=%s; title='%s'; time_standard=%s" % (
            api.get("name", "POWER Daily API"), api.get("version", "unknown"),
            ",".join(hdr.get("sources", [])), hdr.get("title", ""), hdr.get("time_standard", "")),
        "retrieved_date": prov["retrieved_utc"][:10],
        "spatial_support": (
            "Single POWER meteorology grid cell containing lon %s, lat %s "
            "(MERRA-2-based, source native resolution, about 0.5 deg lat x 0.625 deg lon, "
            "i.e. tens of km). Regional context only; not a field or LEMA value."
            % (prov.get("longitude"), prov.get("latitude"))),
        "limitations": (
            "Modelled/reanalysis weather, not a gauge or on-farm measurement. PRECTOTCORR is "
            "bias-corrected model precipitation (mm/day); daily values are Local Solar Time days. "
            "Five years (2021-2025) are historical examples, not climate normals or a trend. "
            "Fill value %s is treated as missing (null); monthly precipitation is null unless "
            "every day is valid." % hdr.get("fill_value", -999)),
    }


def cmd_weather(args):
    start, end = parse_date(args.start), parse_date(args.end)
    os.makedirs(args.out_dir, exist_ok=True)
    if args.from_daily_csv:
        if not args.provenance:
            sys.exit("--from-daily-csv also needs --provenance (written by a previous download)")
        with open(args.provenance, encoding="utf-8") as fh:
            prov = json.load(fh)
        daily = read_daily_csv(args.from_daily_csv)
    else:
        url = power_request_url(args.lon, args.lat, start, end)
        print("GET", url)
        raw, doc = fetch_power(url)
        prov = {
            "request_url": url,
            "longitude": args.lon,
            "latitude": args.lat,
            "retrieved_utc": utc_now().isoformat().replace("+00:00", "Z"),
            "raw_sha256": hashlib.sha256(raw).hexdigest(),
            "raw_bytes": len(raw),
            "power_header": doc.get("header", {}),
            "power_parameters": doc.get("parameters", {}),
            "power_geometry": doc.get("geometry", {}),
            "power_messages": doc.get("messages", []),
        }
        with open(os.path.join(args.out_dir, "T3_power_daily_raw.json"), "wb") as fh:
            fh.write(raw)
        write_json(prov, os.path.join(args.out_dir, "T3_power_provenance.json"))
        daily = daily_from_power_json(doc)
        write_daily_csv(daily, os.path.join(args.out_dir, "weather_daily.csv"))
    rows = monthly_weather_rows(daily, start, end)
    out = envelope([weather_source(prov)], rows)
    path = os.path.join(args.out_dir, "weather.json")
    write_json(out, path)
    n_complete = sum(r["quality"] == "complete" for r in rows)
    print("wrote %s: %d months (%d complete)" % (path, len(rows), n_complete))


# --------------------------------------------------------------------- ET ---
def _check_ring(ring, fid):
    if len(ring) < 4:
        raise ValueError("%s: ring needs >= 3 distinct vertices plus closing point" % fid)
    for lon, lat, *_ in ring:
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            raise ValueError("%s: coordinate out of WGS84 range: %s, %s" % (fid, lon, lat))
    if list(ring[0][:2]) != list(ring[-1][:2]):
        raise ValueError("%s: ring is not closed (first != last position)" % fid)


def load_fields(path, default_status=None):
    """Read a GeoJSON Feature or FeatureCollection; return list of field dicts.

    Every feature must carry properties.field_id. geometry_status comes from
    properties.geometry_status, else --geometry-status; it must be documented|test.
    """
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    feats = doc["features"] if doc.get("type") == "FeatureCollection" else [doc]
    fields, seen = [], set()
    for i, f in enumerate(feats):
        if f.get("type") != "Feature":
            raise ValueError("item %d is not a GeoJSON Feature" % i)
        props = f.get("properties") or {}
        fid = props.get("field_id")
        if not fid:
            raise ValueError("feature %d has no properties.field_id (IDs are never invented)" % i)
        if fid in seen:
            raise ValueError("duplicate field_id %s" % fid)
        seen.add(fid)
        status = props.get("geometry_status") or default_status
        if status not in GEOMETRY_STATUSES:
            raise ValueError("%s: geometry_status must be one of %s (set it in properties or "
                             "pass --geometry-status)" % (fid, GEOMETRY_STATUSES))
        geom = f.get("geometry") or {}
        gtype = geom.get("type")
        if gtype == "Polygon":
            polys = [geom["coordinates"]]
        elif gtype == "MultiPolygon":
            polys = geom["coordinates"]
        else:
            raise ValueError("%s: geometry must be Polygon or MultiPolygon, got %s" % (fid, gtype))
        for poly in polys:
            for ring in poly:
                _check_ring(ring, fid)
        fields.append({"field_id": fid, "geometry_status": status, "geometry": geom,
                       "polygons": polys})
    return fields


def ring_area_m2(ring):
    """Approximate geodesic area of a lon/lat ring on a sphere (same method as geojson-area)."""
    r = 6378137.0
    total = 0.0
    n = len(ring)
    for i in range(n - 1):
        lon1, lat1 = math.radians(ring[i][0]), math.radians(ring[i][1])
        lon2, lat2 = math.radians(ring[i + 1][0]), math.radians(ring[i + 1][1])
        total += (lon2 - lon1) * (2 + math.sin(lat1) + math.sin(lat2))
    return abs(total * r * r / 2.0)


def polygon_area_m2(poly):
    return max(ring_area_m2(poly[0]) - sum(ring_area_m2(h) for h in poly[1:]), 0.0)


def flat_geometry(poly):
    """Exterior ring as the documented flat [lon, lat, ...] list (closing point dropped)."""
    ring = poly[0][:-1]
    return [round(float(c), 7) for lon_lat in ring for c in lon_lat[:2]]


def openet_body(geometry_part, start, end, variable, version, mode):
    body = {
        "date_range": [start, end],
        "interval": "monthly",
        "model": "ensemble",
        "variable": variable,
        "reference_et": "gridmet",
        "reducer": "mean",
        "units": "mm",
        "file_format": "json",
        "version": version,
    }
    if mode == "flat":
        body["geometry"] = flat_geometry(geometry_part)
    else:
        body["geojson"] = {"type": "FeatureCollection", "features": [
            {"type": "Feature", "properties": {},
             "geometry": {"type": "Polygon", "coordinates": geometry_part}}]}
    return body


def http_post_json(url, body, api_key, timeout=180):
    data = json.dumps(body).encode("utf-8")
    headers = {"accept": "application/json", "Content-Type": "application/json",
               "User-Agent": "spaceapps-t3/1.0"}
    if api_key:
        headers["Authorization"] = api_key
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


DATE_KEYS = ("time", "date", "Date", "DateTime", "datetime", "month")


def parse_openet_monthly(raw, variable):
    """Return {YYYY-MM: float|None}. The 200 schema is undocumented, so this accepts the
    common list-of-records shape and refuses anything else (raw is kept by the caller)."""
    try:
        doc = json.loads(raw.decode("utf-8"))
    except ValueError as exc:
        raise OpenETResponseError("response is not JSON: %s" % exc)
    if isinstance(doc, dict):
        for k in ("data", "results", "timeseries"):
            if isinstance(doc.get(k), list):
                doc = doc[k]
                break
    if not isinstance(doc, list) or not doc or not all(isinstance(r, dict) for r in doc):
        raise OpenETResponseError("unexpected response shape: %s" % type(doc).__name__)
    out = {}
    for rec in doc:
        dkey = next((k for k in DATE_KEYS if k in rec), None)
        vkey = next((k for k in rec if k.lower() == variable.lower()), None)
        if vkey is None:
            others = [k for k in rec if k != dkey]
            vkey = others[0] if len(others) == 1 else None
        if dkey is None or vkey is None:
            raise OpenETResponseError("cannot find date/value columns in record keys %s"
                                      % sorted(rec))
        month = str(rec[dkey])[:7]
        if not (len(month) == 7 and month[4] == "-" and month[:4].isdigit()
                and month[5:].isdigit()):
            raise OpenETResponseError("date column %r is not ISO (YYYY-MM...): %r"
                                      % (dkey, rec[dkey]))
        val = rec[vkey]
        if val is None or (isinstance(val, float) and math.isnan(val)) or val == "":
            out[month] = None
        else:
            out[month] = float(val)
    return out


def month_list(start, end):
    s, e = parse_date(start), parse_date(end)
    y, m, out = s.year, s.month, []
    while (y, m) <= (e.year, e.month):
        out.append("%04d-%02d" % (y, m))
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def query_field(field, args, variable, api_key, post, raw_dir):
    """Monthly series for one field. MultiPolygon parts (or holes) are handled explicitly."""
    polys = field["polygons"]
    has_holes = any(len(p) > 1 for p in polys)
    mode = args.geom_mode
    if mode == "auto":
        mode = "geojson" if has_holes else "flat"
    parts = []
    for idx, poly in enumerate(polys):
        body = openet_body(poly, args.start, args.end, variable, args.version, mode)
        status, raw = post(OPENET_POLYGON, body, api_key)
        tag = "%s_%s_part%d" % (field["field_id"], variable, idx)
        if raw_dir:
            with open(os.path.join(raw_dir, tag + ".json"), "wb") as fh:
                fh.write(raw)
        if status in (401, 403):
            raise AccessError("OpenET refused the request (HTTP %d): %s"
                              % (status, raw[:200].decode("utf-8", "replace")))
        if status == 429:
            raise AccessError("OpenET quota/rate limit reached (HTTP 429)")
        if status != 200:
            raise OpenETResponseError("HTTP %d for %s: %s"
                                      % (status, tag, raw[:300].decode("utf-8", "replace")))
        parts.append((polygon_area_m2(poly), parse_openet_monthly(raw, variable)))
    months = month_list(args.start, args.end)
    series = {}
    for mth in months:
        vals = [(a, s.get(mth)) for a, s in parts]
        if len(parts) == 1:
            series[mth] = vals[0][1]
        elif any(v is None for _, v in vals):
            series[mth] = None  # never fill a missing part with zero
        else:
            tot = sum(a for a, _ in vals)
            series[mth] = sum(a * v for a, v in vals) / tot if tot > 0 else None
    return series, len(parts), mode


def et_source(args, request_example, retrieved, status_note):
    return {
        "source_id": ET_SOURCE_ID,
        "title": "OpenET Ensemble monthly actual ET (API raster/timeseries/polygon, reducer=mean)",
        "url": OPENET_DOCS,
        "request_without_secrets": "POST %s with header Authorization: $%s (value not stored); "
                                   "body=%s" % (OPENET_POLYGON, OPENET_KEY_ENV,
                                                json.dumps(request_example, separators=(",", ":"))),
        "product_version": "OpenET image collection version %s requested (API default 2.1 per "
                           "OpenAPI 3.2 spec); %s" % (args.version, status_note),
        "retrieved_date": retrieved,
        "spatial_support": "Mean of 30 m OpenET pixels inside each supplied field polygon; "
                           "MultiPolygon parts are queried separately and area-weighted.",
        "limitations": (
            "Modelled actual ET (ensemble mean of up to six satellite models after MAD outlier "
            "removal), not a measurement and not pumped irrigation: it includes water from rain, "
            "irrigation and shallow groundwater. High ET is not automatically crop stress; rain "
            "minus ET is only a partial water-balance indicator. The 200-response schema is "
            "undocumented; the parser accepts list-of-records JSON and saves raw responses. "
            "The OpenAPI spec lists no per-month quality-flag variable for this endpoint, so "
            "row quality only says reported/missing/area_weighted_from_parts. The product's own "
            "spread indicator is the ensemble MAD range (variables et_mad_min/et_mad_max, "
            "requested with --with-uncertainty)."),
    }


def cmd_et(args, post=http_post_json):
    fields = load_fields(args.fields, args.geometry_status)
    api_key = os.environ.get(OPENET_KEY_ENV, "").strip()
    example = openet_body(fields[0]["polygons"][0], args.start, args.end, "et", args.version,
                          "geojson" if args.geom_mode == "geojson" else "flat")
    print("fields:", ", ".join("%s(%s)" % (f["field_id"], f["geometry_status"]) for f in fields))
    if args.dry_run or not api_key:
        reason = "dry run" if args.dry_run else "%s is not set" % OPENET_KEY_ENV
        print("not contacting OpenET (%s). Example request body (no secrets):" % reason)
        print(json.dumps(example, indent=2))
        write_json(envelope([et_source(args, example, utc_now().date().isoformat(),
                                       "NOT RETRIEVED: %s" % reason)], []), args.out)
        print("wrote %s with empty rows (status: unavailable)" % args.out)
        return 2
    raw_dir = args.raw_dir
    if raw_dir:
        os.makedirs(raw_dir, exist_ok=True)
    rows, unc_rows = [], []
    retrieved = utc_now().date().isoformat()
    try:
        for f in fields:
            series, nparts, mode = query_field(f, args, "et", api_key, post, raw_dir)
            for mth, val in series.items():
                rows.append({
                    "field_id": f["field_id"],
                    "month": mth,
                    "et_mm": None if val is None else round(val, 2),
                    "source_ids": [ET_SOURCE_ID],
                    "quality": ("missing" if val is None else
                                "reported" if nparts == 1 else "area_weighted_from_parts"),
                    "geometry_status": f["geometry_status"],
                })
            if args.with_uncertainty:
                lo, _, _ = query_field(f, args, "et_mad_min", api_key, post, raw_dir)
                hi, _, _ = query_field(f, args, "et_mad_max", api_key, post, raw_dir)
                for mth in series:
                    unc_rows.append({
                        "field_id": f["field_id"], "month": mth,
                        "et_mad_min_mm": None if lo.get(mth) is None else round(lo[mth], 2),
                        "et_mad_max_mm": None if hi.get(mth) is None else round(hi[mth], 2),
                        "source_ids": [ET_UNC_SOURCE_ID],
                        "geometry_status": f["geometry_status"]})
    except AccessError as exc:
        print("STOP:", exc)
        write_json(envelope([et_source(args, example, retrieved, "NOT RETRIEVED: %s" % exc)],
                            []), args.out)
        return 3
    except OpenETResponseError as exc:
        print("STOP: response not usable (raw bodies kept in %s): %s" % (raw_dir, exc))
        write_json(envelope([et_source(args, example, retrieved,
                                       "NOT RETRIEVED: unusable response: %s" % exc)], []),
                   args.out)
        return 4
    write_json(envelope([et_source(args, example, retrieved, "retrieved %s" % retrieved)], rows),
               args.out)
    print("wrote %s: %d rows for %d fields" % (args.out, len(rows), len(fields)))
    if unc_rows:
        upath = os.path.splitext(args.out)[0] + "_mad_range.json"
        src = dict(et_source(args, example, retrieved, "retrieved %s" % retrieved),
                   source_id=ET_UNC_SOURCE_ID,
                   title="OpenET ensemble MAD range (variables et_mad_min, et_mad_max)")
        write_json(envelope([src], unc_rows), upath)
        print("wrote", upath)
    return 0


def cmd_check_openet(args):
    api_key = os.environ.get(OPENET_KEY_ENV, "").strip()
    body = openet_body([[[-100.6447, 39.3564], [-100.6353, 39.3564], [-100.6353, 39.3636],
                         [-100.6447, 39.3636], [-100.6447, 39.3564]]],
                       "2021-01-01", "2021-03-31", "et", args.version, "flat")
    status, raw = http_post_json(OPENET_POLYGON, body, api_key)
    print("key present:", bool(api_key), "| HTTP", status, "|", raw[:300].decode("utf-8", "replace"))
    return 0 if status == 200 else 1


# --------------------------------------------------------------- selftest ---
def cmd_selftest(_args):
    import tempfile
    secret = "SELFTEST_SECRET_DO_NOT_LEAK"
    failures = []

    def check(cond, msg):
        print(("ok   " if cond else "FAIL ") + msg)
        if not cond:
            failures.append(msg)

    # weather: fill values, partial months, rounding
    doc = {"header": {"fill_value": -999},
           "properties": {"parameter": {p: {} for p in POWER_PARAMS}}}
    for d in iter_days(dt.date(2021, 1, 1), dt.date(2021, 2, 28)):
        k = d.strftime("%Y%m%d")
        for p in POWER_PARAMS:
            doc["properties"]["parameter"][p][k] = 1.25
    doc["properties"]["parameter"]["PRECTOTCORR"]["20210210"] = -999
    daily = daily_from_power_json(doc)
    rows = monthly_weather_rows(daily, dt.date(2021, 1, 1), dt.date(2021, 3, 31))
    check(rows[0]["precipitation_mm"] == 38.75 and rows[0]["quality"] == "complete",
          "complete month sums precipitation")
    check(rows[1]["precipitation_mm"] is None and rows[1]["days_observed"] == 27
          and rows[1]["quality"] == "partial", "fill value -> null precip, partial month")
    check(rows[2]["precipitation_mm"] is None and rows[2]["mean_temperature_c"] is None
          and rows[2]["quality"] == "missing", "month with no data -> nulls, never zero")
    check(q2(Decimal("-2.345")) == -2.35 and q2(Decimal("2.345")) == 2.35,
          "ties round away from zero")

    with tempfile.TemporaryDirectory() as tmp:
        fc = {"type": "FeatureCollection", "features": [
            {"type": "Feature", "properties": {"field_id": "fld01"},
             "geometry": {"type": "Polygon", "coordinates": [[[-100.65, 39.35], [-100.64, 39.35],
                                                              [-100.64, 39.36], [-100.65, 39.35]]]}},
            {"type": "Feature", "properties": {"field_id": "fld02", "geometry_status": "test"},
             "geometry": {"type": "MultiPolygon", "coordinates": [
                 [[[-100.70, 39.30], [-100.69, 39.30], [-100.69, 39.31], [-100.70, 39.31],
                   [-100.70, 39.30]]],
                 [[[-100.60, 39.30], [-100.58, 39.30], [-100.58, 39.31], [-100.60, 39.31],
                   [-100.60, 39.30]]]]}},
            {"type": "Feature", "properties": {"field_id": "fld03"},
             "geometry": {"type": "Polygon", "coordinates": [
                 [[-100.50, 39.40], [-100.48, 39.40], [-100.48, 39.42], [-100.50, 39.42],
                  [-100.50, 39.40]],
                 [[-100.495, 39.405], [-100.485, 39.405], [-100.485, 39.415],
                  [-100.495, 39.405]]]}}]}
        fpath = os.path.join(tmp, "fields.geojson")
        write_json(fc, fpath)
        calls = []

        def fake_post(url, body, key):
            calls.append((body, key))
            if body.get("geometry") and body["geometry"][0] > -100.65:   # second MP part
                vals = [20.0, None, 30.0]
            else:
                vals = [10.0, None, 30.0]
            return 200, json.dumps([{"time": "2021-%02d-01" % (i + 1), body["variable"]: v}
                                    for i, v in enumerate(vals)]).encode()

        os.environ[OPENET_KEY_ENV] = secret
        out = os.path.join(tmp, "et.json")
        ns = argparse.Namespace(fields=fpath, start="2021-01-01", end="2021-03-31",
                                out=out, dry_run=False, version=2.1, geom_mode="auto",
                                geometry_status="documented", with_uncertainty=True,
                                raw_dir=os.path.join(tmp, "raw"))
        rc = cmd_et(ns, post=fake_post)
        res = json.load(open(out))
        ids = sorted({r["field_id"] for r in res["rows"]})
        check(rc == 0 and ids == ["fld01", "fld02", "fld03"], "supplied field_ids retained")
        check(all(k in res for k in ("schema_version", "sources", "rows")), "envelope keys")
        check(res["sources"][0]["source_id"].startswith("T3_"), "source_id has T3_ prefix")
        r_jan = [r for r in res["rows"] if r["field_id"] == "fld02" and r["month"] == "2021-01"][0]
        check(r_jan["quality"] == "area_weighted_from_parts" and 13.0 < r_jan["et_mm"] < 18.0,
              "MultiPolygon parts area-weighted (got %s)" % r_jan["et_mm"])
        r_feb = [r for r in res["rows"] if r["field_id"] == "fld01" and r["month"] == "2021-02"][0]
        check(r_feb["et_mm"] is None and r_feb["quality"] == "missing", "missing ET stays null")
        check({r["geometry_status"] for r in res["rows"] if r["field_id"] == "fld02"} == {"test"},
              "per-feature geometry_status kept")
        check(any("geojson" in b for b, _ in calls), "polygon with hole sent as GeoJSON")
        check(all(k == secret for _, k in calls), "key only travels in the request header")
        leaked = []
        for root, _, files in os.walk(tmp):
            for name in files:
                if secret in open(os.path.join(root, name), encoding="utf-8",
                                  errors="ignore").read():
                    leaked.append(name)
        check(not leaked, "no secret in any output file %s" % leaked)

        def refuse(url, body, key):
            return 403, b'{"detail":"Not authenticated"}'

        rc = cmd_et(ns, post=refuse)
        res = json.load(open(out))
        check(rc == 3 and res["rows"] == [] and "NOT RETRIEVED" in
              res["sources"][0]["product_version"], "403 -> stop with empty rows")
        del os.environ[OPENET_KEY_ENV]

        bad = {"type": "Feature", "properties": {},
               "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}}
        write_json(bad, fpath)
        try:
            load_fields(fpath, "test")
            check(False, "feature without field_id rejected")
        except ValueError:
            check(True, "feature without field_id rejected")
    print("selftest: %d failure(s)" % len(failures))
    return 1 if failures else 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    w = sub.add_parser("weather", help="NASA POWER daily -> weather.json + weather_daily.csv")
    w.add_argument("--lon", type=float, default=DEFAULT_LON)
    w.add_argument("--lat", type=float, default=DEFAULT_LAT)
    w.add_argument("--start", default=DEFAULT_START)
    w.add_argument("--end", default=DEFAULT_END)
    w.add_argument("--out-dir", default=".")
    w.add_argument("--from-daily-csv", help="rebuild monthly rows offline from a saved daily CSV")
    w.add_argument("--provenance", help="T3_power_provenance.json from the original download")

    e = sub.add_parser("et", help="OpenET monthly ET for fields.geojson")
    e.add_argument("--fields", required=True, help="WGS84 GeoJSON with properties.field_id")
    e.add_argument("--start", required=True, help="YYYY-MM-DD")
    e.add_argument("--end", required=True, help="YYYY-MM-DD")
    e.add_argument("--out", default="et.json")
    e.add_argument("--version", type=float, default=2.1, choices=[2.0, 2.1])
    e.add_argument("--geom-mode", default="auto", choices=["auto", "flat", "geojson"],
                   help="auto: documented flat list; GeoJSON only for polygons with holes")
    e.add_argument("--geometry-status", choices=GEOMETRY_STATUSES,
                   help="used when a feature lacks properties.geometry_status")
    e.add_argument("--with-uncertainty", action="store_true",
                   help="also request et_mad_min/et_mad_max (2 extra queries per field part)")
    e.add_argument("--raw-dir", default="openet_raw", help="where raw responses are kept")
    e.add_argument("--dry-run", action="store_true", help="print the request; contact nothing")

    c = sub.add_parser("check-openet", help="report whether OpenET accepts current credentials")
    c.add_argument("--version", type=float, default=2.1)

    sub.add_parser("selftest", help="offline tests")
    args = ap.parse_args(argv)
    if args.cmd == "weather":
        return cmd_weather(args)
    if args.cmd == "et":
        return cmd_et(args)
    if args.cmd == "check-openet":
        return cmd_check_openet(args)
    return cmd_selftest(args)


if __name__ == "__main__":
    sys.exit(main())
