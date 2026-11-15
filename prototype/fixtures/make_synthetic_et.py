#!/usr/bin/env python3
"""Regenerate the SYNTHETIC OpenET test fixtures through the team adapter's own `et` code path.

No network and no key: cmd_et runs on fields.geojson with a fake HTTP post returning canned
200 responses. The values are arbitrary patterned test numbers, NOT OpenET data. compare.py
refuses them for the demo bundle; only tests opt in. Run from anywhere:
    python3 prototype/fixtures/make_synthetic_et.py
"""
import argparse
import contextlib
import importlib.util
import io
import json
import os
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
FIELDS = ROOT / "research/deliverables/fields-soils/fields.geojson"
START, END = "2021-01-01", "2021-06-30"
FIXTURE_DATE = "2026-11-15"
FAKE_KEY = "SYNTHETIC_FAKE_KEY_NOT_A_SECRET"
NOTE = ("SYNTHETIC TEST FIXTURE: canned fake HTTP 200 responses passed through the adapter by "
        "prototype/fixtures/make_synthetic_et.py. Patterned test numbers, not OpenET values or "
        "measurements; retrieved_date is the fixture date. Must never enter the demo bundle. ")
NULL_MONTH = ("fld02", 3)   # one missing month, kept null by the adapter

spec = importlib.util.spec_from_file_location("t3_water", ROOT / "research/deliverables/weather-water/t3_water_data.py")
water = importlib.util.module_from_spec(spec)
spec.loader.exec_module(water)


def fake_values(field_id, variable):
    """Patterned values: field n, month m -> n*10 + m mm (MAD range +/- 1). Never real ET."""
    n = int(field_id[-1]) if field_id[-1].isdigit() else 9
    shift = {"et": 0, "et_mad_min": -1, "et_mad_max": 1}[variable]
    return [None if (field_id, m) == NULL_MONTH else float(n * 10 + m + shift) for m in range(1, 7)]


def generate(fields_path=FIELDS):
    """Return (et_envelope, mad_envelope) exactly as the adapter writes them, then labelled."""
    by_geometry = {json.dumps(water.flat_geometry(f["polygons"][0])): f["field_id"]
                   for f in water.load_fields(fields_path)}

    def fake_post(url, body, key):
        assert key == FAKE_KEY and url == water.OPENET_POLYGON
        fid = by_geometry[json.dumps(body["geometry"])]
        vals = fake_values(fid, body["variable"])
        return 200, json.dumps([{"time": "2021-%02d-01" % (i + 1), body["variable"]: v}
                                for i, v in enumerate(vals)]).encode()

    old = os.environ.get(water.OPENET_KEY_ENV)
    os.environ[water.OPENET_KEY_ENV] = FAKE_KEY
    try:
        with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stdout(io.StringIO()):
            out = os.path.join(tmp, "et_synthetic.json")
            ns = argparse.Namespace(fields=str(fields_path), start=START, end=END, out=out, dry_run=False,
                                    version=2.1, geom_mode="auto", geometry_status=None,
                                    with_uncertainty=True, raw_dir=os.path.join(tmp, "raw"))
            if water.cmd_et(ns, post=fake_post) != 0:
                raise RuntimeError("adapter did not accept the fake responses")
            for base, _, names in os.walk(tmp):
                for name in names:
                    if FAKE_KEY in Path(base, name).read_text(encoding="utf-8"):
                        raise RuntimeError("fake key leaked into " + name)
            docs = [json.loads(Path(out).read_text()),
                    json.loads(Path(tmp, "et_synthetic_mad_range.json").read_text())]
    finally:
        if old is None:
            del os.environ[water.OPENET_KEY_ENV]
        else:
            os.environ[water.OPENET_KEY_ENV] = old
    for doc in docs:
        for s in doc["sources"]:
            s["title"] = "SYNTHETIC TEST FIXTURE - " + s["title"]
            s["limitations"] = NOTE + s["limitations"]
            s["request_without_secrets"] = "NOT SENT (synthetic fixture): " + s["request_without_secrets"]
            s["product_version"] = s["product_version"].rsplit("; retrieved ", 1)[0] + \
                "; SYNTHETIC: fake responses, nothing retrieved from OpenET"
            s["retrieved_date"] = FIXTURE_DATE
    return docs


def main():
    et, mad = generate()
    for name, doc in (("et_synthetic.json", et), ("et_synthetic_mad_range.json", mad)):
        (HERE / name).write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print("wrote", HERE / name)


if __name__ == "__main__":
    main()
