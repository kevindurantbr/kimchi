import importlib.util
import json
import unittest
from collections import defaultdict

import compare

spec = importlib.util.spec_from_file_location("modis_et", compare.ROOT / "research/deliverables/weather-water/modis_et.py")
modis = importlib.util.module_from_spec(spec)
spec.loader.exec_module(modis)


def year(y, value, leap=False):
    return {"A%d%03d" % (y, d): value for d in range(1, 367 if leap else 366, 8)}


def months(composites, start, end):
    return dict(modis.monthly_et(composites, start, end))


class ModisConversionTests(unittest.TestCase):
    def test_last_composite_is_five_days_or_six_in_a_leap_year(self):
        self.assertEqual(modis.composite_days("A2021361")[1], 5)
        self.assertEqual(modis.composite_days("A2024361")[1], 6)
        # 80 -> 8.0 mm: 1 mm/day for 8-day composites; the last one spreads 8.0 mm over 5 or 6 days.
        dec21 = months(year(2021, 80), "2021-12-01", "2021-12-31")["2021-12"]
        dec24 = months(year(2024, 80, leap=True), "2024-12-01", "2024-12-31")["2024-12"]
        self.assertEqual(dec21, 26 * 1.0 + 8.0)   # Dec 1-26 at 1 mm/day, Dec 27-31 share 8 mm
        self.assertEqual(dec24, 25 * 1.0 + 8.0)   # leap: Dec 26-31 share 8 mm
        self.assertEqual(len(months(year(2024, 80, leap=True), "2024-01-01", "2024-12-31")), 12)

    def test_month_split_across_two_composites(self):
        comps = year(2021, 80)
        comps["A2021025"] = 160   # Jan 25 - Feb 1 at 2 mm/day: 7 days in January, 1 in February
        got = months(comps, "2021-01-01", "2021-02-28")
        self.assertEqual(got["2021-01"], 24 * 1.0 + 7 * 2.0)
        self.assertEqual(got["2021-02"], 2.0 + 27 * 1.0)

    def test_fill_or_absent_composite_makes_month_null_not_zero(self):
        for bad in (32761, 32767, -1, None, 1.5):
            comps = year(2021, 80)
            comps["A2021025"] = bad
            got = months(comps, "2021-01-01", "2021-03-31")
            self.assertEqual((got["2021-01"], got["2021-02"], got["2021-03"]), (None, None, 31.0), bad)
        comps = year(2021, 0)
        del comps["A2021361"]
        got = months(comps, "2021-11-01", "2021-12-31")
        self.assertEqual((got["2021-11"], got["2021-12"]), (0.0, None))   # a real zero stays zero

    def test_rounding_and_bad_keys(self):
        comps = {k: 1 for k in year(2021, 1)}   # 0.1 mm per composite
        self.assertEqual(months(comps, "2021-01-01", "2021-01-31")["2021-01"], 0.4)   # 0.3875 -> 0.4
        for key in ("A2021002", "2021001", "A2021369"):
            with self.subTest(key=key), self.assertRaises(ValueError):
                modis.composite_days(key)

    def test_committed_output_rebuilds_and_conserves_annual_totals(self):
        folder = compare.ROOT / "research/deliverables/weather-water"
        raw = json.loads((folder / "mod16_raw.json").read_text())
        fields = json.loads((compare.ROOT / compare.INPUTS["fields"]).read_text())
        committed = json.loads((folder / "et_modis.json").read_text())
        rebuilt = modis.convert(raw, fields, committed["sources"][0]["raw_file_sha256"])
        self.assertEqual(rebuilt, committed)
        monthly = defaultdict(float)
        for r in committed["rows"]:
            self.assertIsNotNone(r["et_mm"])
            monthly[(r["field_id"], r["month"][:4])] += r["et_mm"]
        for fid, rec in raw["fields"].items():
            for y in range(2021, 2026):
                total = sum(v for k, v in rec["composites"].items() if k[1:5] == str(y)) / 10
                self.assertAlmostEqual(monthly[(fid, str(y))], total, delta=12 * 0.05 + 1e-9)


if __name__ == "__main__":
    unittest.main()
