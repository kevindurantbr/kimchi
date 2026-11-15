import datetime as dt
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import compare

spec = importlib.util.spec_from_file_location("water", compare.ROOT / "research/deliverables/weather-water/t3_water_data.py")
water = importlib.util.module_from_spec(spec)
spec.loader.exec_module(water)


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


if __name__ == "__main__":
    unittest.main()
