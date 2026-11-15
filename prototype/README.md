# Comparison data layer

This is the first integrated, offline prototype. Python 3.8+ standard library only. It produces evidence for the [first read-only interface](../interface/README.md). No validated crop-response model is included.

From the repository root:

```sh
python3 prototype/compare.py --check
python3 -m unittest discover -s prototype -v
python3 research/deliverables/weather-water/t3_water_data.py selftest
python3 prototype/compare.py --field fld01 --priority water
python3 prototype/compare.py --field fld02 --priority soil
```

The last commands print JSON. `--build` regenerates the committed `demo_bundle.json` from the five input files listed in `compare.py`; `--check` rejects a stale bundle. The bundle contains source hashes, all three fields, crop classifications, soils, 60 regional weather months, three research candidates, 15 evidence rules, and source metadata. Original teammate deliverables remain the authoritative inputs.

## What consumers must preserve

- Every field boundary is approximate. Irrigation is likely, not confirmed. LEMA inclusion was checked against an earlier order and a third-party boundary; current designation is not independently verified.
- Crop history is satellite classification. A 97% crop share is not 97% confidence. All inferred crop histories need farmer confirmation, even when the source's additional ambiguity flag is false.
- Baseline is null until the farmer confirms both history and the intended continuation. `fld01` has five corn-dominant years; that alone is not a future plan. All three research sequences remain visible for each field.
- NASA POWER weather is regional and shared across fields. It supplies historical context, not field-specific stress or future weather. Five years do not establish climate normals.
- SSURGO storage is in **cm of water** over an explicit soil depth, not current moisture. Preserve 92.8% valid coverage on `fld01`; do not fill the remainder with zero. Categorical soil coverage is the winning category's area share, unlike numeric AWS valid-data coverage.
- OpenET rows are empty and unavailable. An empty collection is not zero ET. Observed ET would still not be pumping or predicted rotation water use.
- Candidate evidence and calendar references are regional. No local suitability, winner, numerical yield, profit, or pumping savings is inferred.
- Priority changes the evidence questions displayed first. It cannot create a numerical performance score or override a confirmed exclusion.

## Constraint contract

Optional `--scenario path.private.json` accepts `synthetic` (boolean) and `constraints` (list). Private scenario files are ignored by Git. A constraint requires a known `candidate_id`, a `kind` (`calendar` or `plantback`), a boolean `confirmed`, and an `evidence` explanation. The caller is responsible for actual verification; setting a boolean is not verification by this software.

Calendar constraints additionally carry ISO `earliest_sowing_date`, `validated_window_end`, and boolean `no_feasible_adjustment`. They exclude only the supplied scheduled instance when the first date exceeds the second and no adjustment is feasible. Plant-back constraints require boolean `conflict: true`. Missing confirmation/evidence remains unresolved. Unexcluded candidates remain conditional because other farm inputs are unknown.

Tests include a **synthetic** late wheat handoff. Its dates are arbitrary test inputs and must never become local agronomic cutoffs. Full evaluated calendars, input forms, baseline confirmation, and market/equipment gates remain future work.

## ET pathway

The committed `et_sample.json` is empty, so every field's ET stays `unavailable` and `demo_bundle.json` is unchanged (a test asserts byte identity). No successful authenticated OpenET response has been tested yet.

To bring in real ET, set `OPENET_API_KEY` in your shell environment only (never in Git, chat, or a tracked file) and run the teammate adapter from the repository root. Check the live response format and units first with a short period (e.g. `--end 2021-03-31`), then run the full period:

```sh
python3 research/deliverables/weather-water/t3_water_data.py et --fields research/deliverables/fields-soils/fields.geojson \
  --start 2021-01-01 --end 2025-12-31 --out research/deliverables/weather-water/et.json
python3 prototype/compare.py --build --et research/deliverables/weather-water/et.json
```

The adapter writes `et.json`, also `et_mad_range.json` if you add `--with-uncertainty`, and raw responses in the ignored `openet_raw/`. `--et` must name a file inside the repository so its hash is recorded; pass the same `--et` to `--check`. A MAD range file beside it is carried only if present; no uncertainty is invented.

Nonempty ET is rejected unless: every `field_id` is a bundle field; `geometry_status` matches that field's boundary (`approximate`; `test` geometry never joins); each month lies in the recorded request period; units, interval and variable are recorded as `mm`, `monthly`, `et`; `et_mm` is a finite number ≥ 0 or null; `quality` is `reported`, `area_weighted_from_parts`, or `missing` (missing exactly when null); sources resolve to `T3_OPENET*` records in the same file; retrieval is recorded; and no field-month repeats. Fields with rows become `available` with `units`, `interval`, `period`, `coverage` (months with values vs. expected, missing months listed), `uncertainty`, and `interpretation`. Fields without rows stay `unavailable`. Null stays null, never zero.

Tests use only **SYNTHETIC** adapter output in `fixtures/`, regenerated by `fixtures/make_synthetic_et.py` through the adapter with a fake HTTP post. Sources labelled SYNTHETIC are refused for the demo bundle. The interface still rejects any ET state other than `unavailable`; it needs a display update before an ET bundle can be shown.
