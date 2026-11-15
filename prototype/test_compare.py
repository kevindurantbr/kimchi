import argparse
import contextlib
import datetime as dt
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

import compare

spec = importlib.util.spec_from_file_location("water", compare.ROOT / "research/deliverables/weather-water/t3_water_data.py")
water = importlib.util.module_from_spec(spec)
spec.loader.exec_module(water)
spec = importlib.util.spec_from_file_location("synthetic_et", compare.ROOT / "prototype/fixtures/make_synthetic_et.py")
synthetic_et = importlib.util.module_from_spec(spec)
spec.loader.exec_module(synthetic_et)
FIXTURE = "prototype/fixtures/et_synthetic.json"   # SYNTHETIC adapter output; never real ET
UNAVAILABLE = {"status": "unavailable", "rows": [], "source_ids": ["T3_OPENET_ENSEMBLE_MONTHLY"]}


class IntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bundle = compare.build_bundle()

    def test_unknowns_do_not_become_recommendations(self):
        result = compare.compare(self.bundle)
        self.assertIsNone(result["field"]["baseline"])
        self.assertIsNone(result["winner"])
        self.assertEqual(result["field"]["et"]["rows"], [])
        for c in result["candidates"]:
            self.assertEqual(c["status"], "conditional")
            self.assertTrue(all(v is None for v in c["numeric_outputs"].values()))

    def test_confirmed_calendar_failure_excludes_only_affected_candidate(self):
        scenario = {"synthetic": True, "constraints": [{"candidate_id": "corn_wheat", "kind": "calendar",
            "confirmed": True, "evidence": "Synthetic acceptance test, not a local planting cutoff",
            "earliest_sowing_date": "2027-10-15", "validated_window_end": "2027-10-01",
            "no_feasible_adjustment": True}]}
        result = compare.compare(self.bundle, scenario=scenario)
        states = {c["candidate_id"]: c["status"] for c in result["candidates"]}
        self.assertEqual(states["corn_wheat"], "excluded_for_supplied_schedule")
        self.assertEqual(states["corn_sorghum"], "conditional")
        self.assertEqual(result["scenario_status"], "synthetic demonstration")
        scenario["constraints"][0]["confirmed"] = False
        self.assertTrue(all(c["status"] == "conditional" for c in compare.compare(self.bundle, scenario=scenario)["candidates"]))

    def test_no_evidence_does_not_exclude(self):
        scenario = {"constraints": [{"candidate_id": "corn_wheat", "kind": "plantback", "confirmed": True, "conflict": True}]}
        self.assertTrue(all(c["status"] == "conditional" for c in compare.compare(self.bundle, scenario=scenario)["candidates"]))

    def test_priority_does_not_invent_a_ranking(self):
        a = compare.compare(self.bundle, priority="water")
        b = compare.compare(self.bundle, priority="soil")
        self.assertNotEqual(a["questions_first"], b["questions_first"])
        self.assertEqual(a["candidates"], b["candidates"])
        self.assertIsNone(b["winner"])

    def test_field_specific_history_and_coverage(self):
        a, b, c = self.bundle["fields"]
        self.assertEqual([h["dominant_crop"] for h in a["history"]], ["Corn"] * 5)
        self.assertEqual(b["history"][2]["dominant_crop"], "Sorghum")
        self.assertNotEqual(a["history"], c["history"])
        aws = next(r for r in a["soils"] if r["depth_bottom_cm"] == 150)
        self.assertEqual((aws["value"], aws["coverage_fraction"], aws["unit"]), (30.78, .928, "cm water"))

    def test_sources_must_resolve(self):
        data = {k: json.loads((compare.ROOT / p).read_text()) for k, p in compare.INPUTS.items()}
        data["observations"]["soils"][0]["source_ids"] = ["NOT_A_SOURCE"]
        with self.assertRaisesRegex(ValueError, "Unresolved source"):
            compare.validate(data)

    def test_unknown_field_and_candidate_rejected(self):
        with self.assertRaisesRegex(ValueError, "Unknown field"):
            compare.compare(self.bundle, field_id="test01")
        with self.assertRaisesRegex(ValueError, "Unknown candidate"):
            compare.compare(self.bundle, scenario={"constraints": [{"candidate_id": "typo"}]})

    def test_real_field_boundaries_work_without_relabelling(self):
        fields = water.load_fields(compare.ROOT / compare.INPUTS["fields"])
        self.assertEqual({f["field_id"] for f in fields}, {"fld01", "fld02", "fld03"})
        self.assertTrue(all(f["geometry_status"] == "approximate" for f in fields))

    def test_et_does_not_treat_count_as_water(self):
        with self.assertRaises(water.OpenETResponseError):
            water.parse_openet_monthly(b'[{"date":"2021-01-01","count":3}]', "et")
        self.assertEqual(water.parse_openet_monthly(b'[{"date":"2021-01-01","et":null}]', "et"), {"2021-01": None})

    def test_invalid_et_response_rejected(self):
        for rows in [[{"date": "2021-13", "et": 1}], [{"date": "2021-01", "et": -999}],
                     [{"date": "2021-01", "et": "Infinity"}],
                     [{"date": "2021-01", "et": 1}, {"date": "2021-01", "et": 2}]]:
            with self.subTest(rows=rows), self.assertRaises(water.OpenETResponseError):
                water.parse_openet_monthly(json.dumps(rows).encode(), "et")

    def test_empty_geometry_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "empty.geojson"
            p.write_text('{"type":"FeatureCollection","features":[]}')
            with self.assertRaisesRegex(ValueError, "empty"):
                water.load_fields(p)

    def test_partial_request_is_not_a_monthly_total(self):
        daily = {dt.date(2021, 1, day): {"precipitation_mm": 1.0, "t2m_mean_c": 10.0} for day in range(15, 32)}
        row = water.monthly_weather_rows(daily, dt.date(2021, 1, 15), dt.date(2021, 1, 31))[0]
        self.assertEqual(row["quality"], "partial")
        self.assertEqual((row["days_observed"], row["days_expected"]), (17, 31))
        self.assertIsNone(row["precipitation_mm"])


class ETPathwayTests(unittest.TestCase):
    """OpenET pathway, exercised only with SYNTHETIC fake-response adapter output."""

    def data(self, et_path=FIXTURE):
        return compare.load_inputs(et_path=et_path)[1]

    def rejected(self, pattern, mutate):
        data = self.data()
        mutate(data)
        with self.assertRaisesRegex(ValueError, pattern):
            compare.validate(data, allow_synthetic_et=True)

    def test_empty_envelope_keeps_committed_bundle_byte_identical(self):
        bundle = compare.build_bundle()
        self.assertEqual(compare.dumps(bundle).encode("utf-8"),
                         (compare.ROOT / "prototype/demo_bundle.json").read_bytes())
        self.assertEqual(compare.input_paths(), compare.INPUTS)
        self.assertTrue(all(f["et"] == UNAVAILABLE for f in bundle["fields"]))

    def test_adapter_without_key_stays_unavailable(self):
        data = self.data(compare.INPUTS["et"])
        with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stdout(io.StringIO()):
            out = Path(tmp, "et.json")
            ns = argparse.Namespace(fields=str(synthetic_et.FIELDS), start="2021-01-01", end="2025-12-31",
                                    out=str(out), dry_run=True, version=2.1, geom_mode="auto",
                                    geometry_status=None, with_uncertainty=False, raw_dir=tmp)
            self.assertEqual(water.cmd_et(ns), 2)
            data["et"] = json.loads(out.read_text())
        self.assertEqual(compare.validate(data)[2], {f: UNAVAILABLE for f in ("fld01", "fld02", "fld03")})

    def test_fixture_is_labelled_adapter_output(self):
        et, mad = synthetic_et.generate()
        self.assertEqual(et, json.loads((compare.ROOT / FIXTURE).read_text()))
        self.assertEqual(mad, json.loads((compare.ROOT / FIXTURE.replace(".json", "_mad_range.json")).read_text()))
        for s in et["sources"] + mad["sources"]:
            self.assertTrue(s["title"].startswith("SYNTHETIC") and s["limitations"].startswith("SYNTHETIC"))
        with self.assertRaisesRegex(ValueError, "Synthetic ET"):
            compare.build_bundle(et_path=FIXTURE)

    def test_accepted_rows_become_available_with_coverage(self):
        bundle = compare.build_bundle(et_path=FIXTURE, allow_synthetic_et=True)
        et = {f["field_id"]: f["et"] for f in bundle["fields"]}
        self.assertIn(FIXTURE, bundle["input_sha256"])
        self.assertIn("prototype/fixtures/et_synthetic_mad_range.json", bundle["input_sha256"])
        self.assertIn("T3_OPENET_ENSEMBLE_MAD_RANGE", {s["source_id"] for s in bundle["sources"]})
        for fid in ("fld01", "fld02", "fld03"):
            e = et[fid]
            self.assertEqual((e["status"], e["units"], e["interval"], e["source_ids"]),
                             ("available", "mm", "monthly", ["T3_OPENET_ENSEMBLE_MONTHLY"]))
            self.assertEqual(e["period"], {"start": "2021-01-01", "end": "2021-06-30"})
            self.assertEqual([r["month"] for r in e["rows"]], ["2021-%02d" % m for m in range(1, 7)])
            self.assertTrue(all(r["field_id"] == fid and r["geometry_status"] == "approximate" for r in e["rows"]))
            self.assertEqual(e["uncertainty"]["status"], "available")
        self.assertEqual(et["fld01"]["coverage"], {"months_expected": 6, "months_with_values": 6, "months_missing": []})
        self.assertEqual(et["fld02"]["coverage"], {"months_expected": 6, "months_with_values": 5, "months_missing": ["2021-03"]})
        self.assertEqual(et["fld01"]["rows"][0]["et_mm"], 11.0)
        self.assertEqual(et["fld01"]["uncertainty"]["rows"][0]["et_mad_max_mm"], 12.0)
        compare.dumps(bundle)   # finite JSON only

    def test_null_et_stays_null(self):
        bundle = compare.build_bundle(et_path=FIXTURE, allow_synthetic_et=True)
        fld02 = next(f["et"] for f in bundle["fields"] if f["field_id"] == "fld02")
        march = next(r for r in fld02["rows"] if r["month"] == "2021-03")
        self.assertEqual((march["et_mm"], march["quality"]), (None, "missing"))
        self.assertIsNone(fld02["uncertainty"]["rows"][2]["et_mad_min_mm"])

    def test_field_without_rows_stays_unavailable(self):
        data = self.data()
        for key in ("et", "et_mad"):
            data[key]["rows"] = [r for r in data[key]["rows"] if r["field_id"] != "fld03"]
        et = compare.validate(data, allow_synthetic_et=True)[2]
        self.assertEqual(et["fld03"], UNAVAILABLE)
        self.assertEqual(et["fld01"]["status"], "available")
        data["et_mad"]["rows"] = []
        self.assertEqual(compare.validate(data, allow_synthetic_et=True)[2]["fld01"]["uncertainty"]["status"], "unavailable")

    def test_unknown_field_and_test_geometry_rejected(self):
        self.rejected("Unknown field", lambda d: d["et"]["rows"][0].update(field_id="fld99"))
        self.rejected("Test geometry", lambda d: d["et"]["rows"][0].update(geometry_status="test"))
        self.rejected("geometry status", lambda d: d["et"]["rows"][0].update(geometry_status="documented"))
        test01 = synthetic_et.generate(compare.ROOT / "research/deliverables/weather-water/fields_test01.geojson")[0]
        self.rejected("Unknown field", lambda d: (d.update(et=test01), d.pop("et_mad")))

    def test_invalid_et_values_rejected(self):
        for bad in (-1.0, float("nan"), float("inf"), "12.5", True, [1.0]):
            with self.subTest(bad=bad):
                self.rejected("Invalid ET value", lambda d: d["et"]["rows"][0].update(et_mm=bad))
        self.rejected("contradicts", lambda d: d["et"]["rows"][0].update(et_mm=None))
        self.rejected("Unknown ET quality", lambda d: d["et"]["rows"][0].update(quality="estimated"))
        self.rejected("Unexpected ET row", lambda d: d["et"]["rows"][0].update(et_in=1.0))

    def test_duplicate_or_out_of_period_month_rejected(self):
        self.rejected("Duplicate ET month", lambda d: d["et"]["rows"].append(dict(d["et"]["rows"][0])))
        self.rejected("outside recorded period", lambda d: d["et"]["rows"][0].update(month="2021-07"))
        self.rejected("outside recorded period", lambda d: d["et"]["rows"][0].update(month="2021-1"))

    def test_unresolved_or_non_openet_source_rejected(self):
        self.rejected("Unresolved source", lambda d: d["et"]["rows"][0].update(source_ids=["NOT_A_SOURCE"]))
        self.rejected("Unresolved ET source", lambda d: d["et"]["rows"][0].update(source_ids=["T3_NASA_POWER_DAILY"]))
        self.rejected("Unresolved MAD", lambda d: d["et_mad"]["rows"][0].update(source_ids=["T3_OPENET_ENSEMBLE_MONTHLY"]))

    def test_units_period_and_retrieval_must_be_recorded(self):
        def edit(key, old, new):
            return lambda d: d["et"]["sources"][0].update({key: d["et"]["sources"][0][key].replace(old, new)})
        self.rejected("in mm", edit("request_without_secrets", '"units":"mm"', '"units":"in"'))
        self.rejected("not recorded", edit("request_without_secrets", "body=", "request="))
        self.rejected("recorded retrieval", edit("product_version", "SYNTHETIC", "NOT RETRIEVED"))
        with self.assertRaisesRegex(ValueError, "inside the repository"):
            compare.input_paths(et_path="/tmp/et.json")

    def test_mad_range_cannot_invent_or_invert(self):
        self.rejected("minimum exceeds", lambda d: d["et_mad"]["rows"][0].update(et_mad_min_mm=99.0))
        self.rejected("without ET row", lambda d: d["et"]["rows"].pop(0))
        self.rejected("without ET rows", lambda d: d["et"].update(rows=[]))


if __name__ == "__main__":
    unittest.main()
