#!/usr/bin/env python3
"""Offline evidence integration and qualitative comparison. Python standard library."""
import argparse
import calendar
import copy
import datetime as dt
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INPUTS = {
    "agronomy": "research/deliverables/agronomy/agronomy.json",
    "fields": "research/deliverables/fields-soils/fields.geojson",
    "observations": "research/deliverables/fields-soils/field_observations.json",
    "weather": "research/deliverables/weather-water/weather.json",
    "et": "research/deliverables/weather-water/et_sample.json",
}
PRIORITIES = {
    "water": ["T1_R02_ANNUAL_VS_PEAK", "T1_R03_ET_NOT_PUMPING", "T1_R05_WHEAT_HANDOFF"],
    "soil": ["T1_R12_RESIDUE_AND_RECHARGE", "T1_R10_NO_FAMILY_OR_N_CREDIT"],
    "operations": ["T1_R05_WHEAT_HANDOFF", "T1_R13_MARKET_AND_EQUIPMENT", "T1_R08_HERBICIDE_UNKNOWN"],
}
# OpenET adapter contract: research/deliverables/weather-water/t3_water_data.py (`et` sub-command).
ET_SOURCE_ID = "T3_OPENET_ENSEMBLE_MONTHLY"
ET_ROW_KEYS = {"field_id", "month", "et_mm", "source_ids", "quality", "geometry_status"}
ET_MAD_ROW_KEYS = {"field_id", "month", "et_mad_min_mm", "et_mad_max_mm", "source_ids", "geometry_status"}
ET_QUALITIES = {"reported", "area_weighted_from_parts", "missing"}
ET_INTERPRETATION = ("Modelled actual ET from rain, irrigation and shallow groundwater; not pumping, not crop "
                     "stress, not a prediction for another rotation. Null months are missing, never zero.")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def check_refs(obj, sources):
    if isinstance(obj, dict):
        for key, val in obj.items():
            if key == "source_ids":
                require(bool(val) and all(s in sources for s in val), "Unresolved source reference: %s" % val)
            else:
                check_refs(val, sources)
    elif isinstance(obj, list):
        for item in obj:
            check_refs(item, sources)


def is_depth(value):
    """A finite, non-negative number; booleans, strings and NaN are not water depths."""
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def month_range(start, end):
    s, e = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    require(s <= e, "ET period is reversed")
    return ["%04d-%02d" % (y, m) for y in range(s.year, e.year + 1) for m in range(1, 13)
            if (s.year, s.month) <= (y, m) <= (e.year, e.month)]


def recorded_request(source):
    """The adapter records the request body it sent (no secrets) after 'body='."""
    text = source.get("request_without_secrets") or ""
    require("body=" in text, "ET request (period/units) not recorded")
    try:
        return json.loads(text.split("body=", 1)[1])
    except ValueError:
        raise ValueError("ET request body is not parseable JSON")


def et_sources(doc, allow_synthetic):
    require(doc.get("schema_version") == "1.0", "Unexpected ET envelope schema")
    found = {s["source_id"]: s for s in doc["sources"]}
    for s in found.values():
        text = " ".join(str(s.get(k) or "") for k in ("title", "limitations", "product_version"))
        require(allow_synthetic or not doc["rows"] or "SYNTHETIC" not in text.upper(),
                "Synthetic ET fixture cannot enter the demo bundle")
    return found


def openet_ids(ids, sources):
    return isinstance(ids, list) and bool(ids) and all(
        isinstance(i, str) and i in sources and i.startswith("T3_OPENET") for i in ids)


def validate_et(data, boundary, allow_synthetic=False):
    """Validate adapter ET (plus its optional MAD range) and return each field's ET entry.

    An empty envelope, or a field without rows, stays unavailable. Missing months stay null."""
    et, mad = data["et"], data.get("et_mad")
    sources = et_sources(et, allow_synthetic)
    require(ET_SOURCE_ID in sources, "ET source record missing")
    blocks = {fid: {"status": "unavailable", "rows": [], "source_ids": [ET_SOURCE_ID]} for fid in boundary}
    if not et["rows"]:
        require(mad is None or not mad["rows"], "ET MAD range supplied without ET rows")
        return blocks
    source = sources[ET_SOURCE_ID]
    require(source.get("retrieved_date") and "NOT RETRIEVED" not in (source.get("product_version") or ""),
            "ET rows without a recorded retrieval")
    request = recorded_request(source)
    require((request.get("units"), request.get("interval"), request.get("variable")) == ("mm", "monthly", "et"),
            "ET request not recorded as monthly et in mm")
    period = request.get("date_range")
    require(isinstance(period, list) and len(period) == 2 and all(isinstance(d, str) for d in period),
            "ET period not recorded")
    months = month_range(*period)
    rows = defaultdict(list)
    for row in et["rows"]:
        require(isinstance(row, dict) and set(row) == ET_ROW_KEYS, "Unexpected ET row fields")
        fid, month, val = row["field_id"], row["month"], row["et_mm"]
        require(isinstance(fid, str) and fid in boundary, "Unknown field in ET: %r" % (fid,))
        require(row["geometry_status"] != "test", "Test geometry ET cannot join a field")
        require(row["geometry_status"] == boundary[fid], "ET geometry status does not match the field boundary")
        require(isinstance(month, str) and month in months, "ET month outside recorded period: %r" % (month,))
        require(all(r["month"] != month for r in rows[fid]), "Duplicate ET month: %s %s" % (fid, month))
        require(openet_ids(row["source_ids"], sources), "Unresolved ET source: %r" % (row["source_ids"],))
        require(val is None or is_depth(val), "Invalid ET value: %r" % (val,))
        require(row["quality"] in ET_QUALITIES, "Unknown ET quality")
        require((val is None) == (row["quality"] == "missing"), "ET quality contradicts its value")
        rows[fid].append(row)
    spread = defaultdict(list)
    if mad is not None and mad["rows"]:
        mad_sources = et_sources(mad, allow_synthetic)
        for row in mad["rows"]:
            require(isinstance(row, dict) and set(row) == ET_MAD_ROW_KEYS, "Unexpected MAD range row fields")
            fid, lo, hi = row["field_id"], row["et_mad_min_mm"], row["et_mad_max_mm"]
            require(any(r["month"] == row["month"] for r in rows.get(fid, [])), "MAD range row without ET row")
            require(row["geometry_status"] == boundary[fid], "MAD range geometry status does not match")
            require(all(r["month"] != row["month"] for r in spread[fid]), "Duplicate MAD range month")
            require(openet_ids(row["source_ids"], mad_sources), "Unresolved MAD range source")
            require(all(v is None or is_depth(v) for v in (lo, hi)), "Invalid MAD range value")
            require(lo is None or hi is None or lo <= hi, "MAD range minimum exceeds maximum")
            spread[fid].append(row)
    for fid, field_rows in rows.items():
        field_rows.sort(key=lambda r: r["month"])
        have = {r["month"] for r in field_rows if r["et_mm"] is not None}
        unc = sorted(spread.get(fid, []), key=lambda r: r["month"])
        blocks[fid] = {
            "status": "available", "rows": field_rows,
            "source_ids": sorted({i for r in field_rows for i in r["source_ids"]}),
            "units": "mm", "interval": "monthly", "period": {"start": period[0], "end": period[1]},
            "coverage": {"months_expected": len(months), "months_with_values": len(have),
                         "months_missing": [m for m in months if m not in have]},
            "uncertainty": {"status": "available", "kind": "OpenET ensemble MAD range; model spread, not a confidence interval",
                            "units": "mm", "source_ids": sorted({i for r in unc for i in r["source_ids"]}), "rows": unc}
            if unc else {"status": "unavailable", "rows": []},
            "interpretation": ET_INTERPRETATION,
        }
    return blocks


def validate(data, allow_synthetic_et=False):
    """Validate the frozen demonstration period and cross-workstream contracts."""
    sources = [s for doc in data.values() for s in doc.get("sources", [])]
    ids = [s["source_id"] for s in sources]
    require(len(ids) == len(set(ids)), "Duplicate source ID")
    check_refs(data, set(ids))
    fields = data["fields"]["features"]
    fids = [f["properties"]["field_id"] for f in fields]
    require(len(fids) == 3 and len(set(fids)) == 3, "Expected three distinct demo fields")
    for f in fields:
        require(f["properties"]["boundary_status"] == "approximate", "Demo geometry status changed")
        require(f["geometry"]["type"] == "Polygon", "Expected demo polygons")
        for ring in f["geometry"]["coordinates"]:
            require(len(ring) >= 4 and ring[0] == ring[-1], "Invalid polygon ring")
            require(all(-180 <= x <= 180 and -90 <= y <= 90 for x, y in ring), "Coordinates outside WGS84")
    groups = defaultdict(list)
    for row in data["observations"]["crop_history"]:
        require(row["field_id"] in fids, "Unknown field in crop history")
        require(0 <= row["crop_fraction"] <= 1 and 0 <= row["valid_coverage_fraction"] <= 1,
                "Invalid crop fraction")
        groups[(row["field_id"], row["year"])].append(row)
    require(set(groups) == {(f, y) for f in fids for y in range(2021, 2026)}, "Missing field/year crop history")
    for rows in groups.values():
        require(abs(sum(r["crop_fraction"] for r in rows) - 1) <= .005, "Crop shares do not sum to one")
    soils = data["observations"]["soils"]
    soil_keys = [(r["field_id"], r["property"], r["depth_bottom_cm"]) for r in soils]
    require(len(soil_keys) == len(set(soil_keys)), "Duplicate soil property")
    for row in soils:
        require(row["field_id"] in fids and 0 <= row["coverage_fraction"] <= 1, "Invalid soil field/coverage")
        if row["property"] == "available_water_storage":
            require(row["unit"] == "cm water" and row["depth_top_cm"] == 0, "Unexpected AWS units/depth")
            require(row["value"] is None or row["value"] >= 0, "Negative soil storage")
    months = {"%d-%02d" % (y, m) for y in range(2021, 2026) for m in range(1, 13)}
    weather = data["weather"]["rows"]
    require(len(weather) == 60 and {r["month"] for r in weather} == months, "Expected 60 unique weather months")
    for row in weather:
        y, m = map(int, row["month"].split("-"))
        require(row["days_expected"] == calendar.monthrange(y, m)[1], "Monthly coverage mismatch")
        require(0 <= row["days_observed"] <= row["days_expected"], "Invalid day count")
        if row["quality"] == "complete":
            require(row["days_observed"] == row["days_expected"] and row["precipitation_mm"] is not None
                    and row["mean_temperature_c"] is not None, "Incomplete month labelled complete")
        require(row["precipitation_mm"] is None or row["precipitation_mm"] >= 0, "Negative rain")
    et = validate_et(data, {f["properties"]["field_id"]: f["properties"]["boundary_status"] for f in fields},
                     allow_synthetic_et)
    candidates = data["agronomy"]["candidates"]
    require({c["candidate_id"] for c in candidates} == {"corn_corn", "corn_sorghum", "corn_wheat"},
            "Candidate library changed")
    for c in candidates:
        require(c["field_suitability"] is None, "Unvalidated candidate marked suitable")
        for phase in c["sequence"]:
            if phase["crop"] == "winter_wheat":
                require(phase["sowing_window"]["relative_calendar_year"] == phase["relative_harvest_year"] - 1,
                        "Winter wheat must be sown before its harvest year")
    return sources, groups, et


def input_paths(root=ROOT, et_path=None):
    """Inputs actually read. The adapter's optional <out>_mad_range.json is used only if present."""
    paths = dict(INPUTS)
    if et_path is not None:
        try:
            paths["et"] = (root / et_path).resolve().relative_to(root.resolve()).as_posix()
        except ValueError:
            raise ValueError("ET file must be inside the repository so its hash can be checked")
    et_file = root / paths["et"]
    mad = et_file.with_name(et_file.stem + "_mad_range.json")
    if mad.exists():
        paths["et_mad"] = mad.relative_to(root).as_posix()
    return paths


def load_inputs(root=ROOT, et_path=None):
    paths = input_paths(root, et_path)
    return paths, {key: json.loads((root / path).read_text()) for key, path in paths.items()}


def build_bundle(root=ROOT, et_path=None, allow_synthetic_et=False):
    paths, data = load_inputs(root, et_path)
    sources, groups, et = validate(data, allow_synthetic_et)
    fields = []
    for feature in data["fields"]["features"]:
        fid = feature["properties"]["field_id"]
        history = []
        for year in range(2021, 2026):
            rows = sorted(groups[(fid, year)], key=lambda r: -r["crop_fraction"])
            history.append({"year": year, "dominant_crop": rows[0]["crop"], "classes": rows,
                            "interpretation": "Satellite classification; farmer confirmation required. Fractions are not accuracy probabilities."})
        fields.append({"field_id": fid, "feature": feature, "history": history,
                       "baseline": None, "baseline_status": "Farmer-confirmed continuation plan missing",
                       "soils": [r for r in data["observations"]["soils"] if r["field_id"] == fid],
                       "et": et[fid]})
    return {
        "schema_version": "kimchi.demo.1", "scope": "Sheridan 6 working demo; not validated farm advice",
        "input_sha256": {p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in paths.values()},
        "sources": sources, "fields": fields,
        "regional_weather": {"scope": "One coarse regional POWER series shared by all fields; not field weather or climate normals",
                             "rows": data["weather"]["rows"]},
        "candidates": data["agronomy"]["candidates"], "rules": data["agronomy"]["rules"],
    }


def compare(bundle, field_id="fld01", priority="water", scenario=None):
    """Priorities change questions shown first, never unsupported performance rankings."""
    require(priority in PRIORITIES, "Unknown priority")
    matches = [f for f in bundle["fields"] if f["field_id"] == field_id]
    require(len(matches) == 1, "Unknown field_id")
    scenario = scenario or {}
    require(set(scenario) <= {"synthetic", "constraints"}, "Unknown scenario field")
    require(type(scenario.get("synthetic", False)) is bool, "synthetic must be boolean")
    constraints = scenario.get("constraints", [])
    require(isinstance(constraints, list), "constraints must be a list")
    known = {c["candidate_id"] for c in bundle["candidates"]}
    for item in constraints:
        require(item.get("candidate_id") in known, "Unknown candidate in constraint")
        require(item.get("kind") in {"calendar", "plantback"}, "Unknown constraint kind")
        require(type(item.get("confirmed", False)) is bool, "confirmed must be boolean")
        require(isinstance(item.get("evidence", ""), str), "evidence must be text")
    candidates = []
    for candidate in bundle["candidates"]:
        c = copy.deepcopy(candidate)
        c.update(status="conditional", exclusion_reasons=[], unresolved_constraints=[],
                 numeric_outputs={"yield": None, "profit": None, "pumping_savings": None},
                 numeric_status="No validated field response model; trial averages are not predictions")
        for item in constraints:
            if item["candidate_id"] != c["candidate_id"]:
                continue
            if item.get("confirmed") is not True or not item.get("evidence", "").strip():
                c["unresolved_constraints"].append(item)
                continue
            if item["kind"] == "calendar":
                ready = dt.date.fromisoformat(item["earliest_sowing_date"])
                end = dt.date.fromisoformat(item["validated_window_end"])
                conflict = ready > end and item.get("no_feasible_adjustment") is True
                rule = "T1_R06_CONFIRMED_CALENDAR_FAILURE"
            else:
                conflict = item.get("conflict") is True
                rule = "T1_R09_CONFIRMED_PLANTBACK_CONFLICT"
            if conflict:
                c["status"] = "excluded_for_supplied_schedule"
                c["exclusion_reasons"].append({"rule_id": rule, "supplied_evidence": item})
        candidates.append(c)
    return {"field": matches[0], "priority": priority,
            "scenario_status": "synthetic demonstration" if scenario.get("synthetic") else "supplied inputs; not independently verified",
            "priority_explanation": "Display focus only; no performance ranking or winner is computed",
            "questions_first": [r for rid in PRIORITIES[priority] for r in bundle["rules"] if r["rule_id"] == rid],
            "regional_weather": bundle["regional_weather"], "candidates": candidates,
            "sources": bundle["sources"], "winner": None}


def dumps(bundle):
    return json.dumps(bundle, indent=2, ensure_ascii=False, allow_nan=False) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", action="store_true", help="Write deterministic demo_bundle.json")
    parser.add_argument("--check", action="store_true", help="Check committed bundle matches source data")
    parser.add_argument("--et", type=Path, help="OpenET adapter output inside the repository (default: %s)" % INPUTS["et"])
    parser.add_argument("--field", default="fld01")
    parser.add_argument("--priority", choices=PRIORITIES, default="water")
    parser.add_argument("--scenario", type=Path, help="Optional local JSON constraints; keep real farm records private")
    args = parser.parse_args()
    bundle = build_bundle(et_path=args.et.resolve() if args.et else None)
    dest = Path(__file__).with_name("demo_bundle.json")
    payload = dumps(bundle)
    if args.check:
        require(dest.read_text() == payload, "Bundle is stale; run --build")
        print("Validated: 3 fields, 15 field-years, 60 weather months, 3 candidates; bundle current.")
    elif args.build:
        dest.write_text(payload)
        print("Wrote", dest)
    else:
        scenario = json.loads(args.scenario.read_text()) if args.scenario else None
        print(json.dumps(compare(bundle, args.field, args.priority, scenario), indent=2, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
