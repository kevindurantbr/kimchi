# Comparison data layer

This is the first integrated, offline prototype. Python 3.8+ standard library only. It produces evidence for an interface; it does not yet include a web interface or validated crop-response model.

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

## ET next step

With an OpenET account, set `OPENET_API_KEY` locally without saving it in Git or chat, then run the teammate adapter on `research/deliverables/fields-soils/fields.geojson`. Begin with one field and a short period to verify the live response format and units. No successful authenticated response has been tested yet. The adapter now accepts `boundary_status: approximate`, preserves that status, rejects ambiguous value columns, and never substitutes missing ET with zero.

The bundle deliberately rejects nonempty ET input until integration code is extended to validate real field IDs, periods, units, geometry status, and coverage. Do not bypass that check by renaming synthetic data.
