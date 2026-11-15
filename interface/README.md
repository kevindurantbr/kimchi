# Kimchi · Field Notes

First read-only interface for the reviewed `prototype/demo_bundle.json`. Select an approximate field, inspect regional weather and field soil/crop history, and compare three whole-field rotation sequences. Source details remain one click away.

Weather is **live on open**: after the reviewed bundle renders, the page requests NASA POWER for the same regional point and appends any months newer than the reviewed snapshot, labelled *Live · provisional* (see [live weather](#live-weather)).

**Confirm your field** lets a farmer confirm or correct the crop history, state the intended continuation (the baseline), and add dated sowing-calendar or plant-back constraints. Each sequence then shows its state with reasons, using the same rules as `prototype/compare.py` (see [scenario inputs](#scenario-inputs)). Entries stay in page memory only.

Private hosted preview: https://kimchi-field-notes.bingxuanuniversity.chatgpt.site

The hosted Site starts owner-private. Teammates can run the same interface locally from this repository; GitHub visibility does not grant access to the private Site. No farm records, API keys, or user entries are collected.

## Run locally

From the repository root:

```sh
python3 prototype/compare.py --check
python3 interface/build.py
python3 -m http.server 8765 --bind 127.0.0.1 --directory interface/dist
```

Open http://127.0.0.1:8765/ in a browser. Use HTTP rather than opening the HTML file directly, because the interface fetches its JSON bundle. No package installation is required. The only third-party request is the live NASA POWER weather call (`power.larc.nasa.gov`, no key); without network access the page shows the reviewed snapshot. Stop the server with Ctrl+C.

`build.py` checks the bundle's input hashes and copies it byte-for-byte alongside the static assets. Generated `dist/` is ignored by Git. Rebuild after changing source or regenerating the bundle; reload the browser to see the change.

## Verify

```sh
node --test interface/test_*.mjs
node --check interface/app.js && node --check interface/scenario.mjs
python3 interface/fixtures/make_scenario_fixtures.py --check
python3 -m unittest discover -s prototype -v
```

Use Node.js with the built-in test runner. Eight live-weather tests use a recorded-shape POWER response (no network): fill values become null, a partial current month withholds its rain total, a dry month stays zero, reviewed months are never overwritten, a differing overlap is reported, and HTTP/network failures reject. Six presentation-model tests cover separate field histories, soil units/depth/coverage, zero vs missing rain, incomplete annual summaries, priority references, changed evidence states, and safe source links. Scenario tests check `scenario.mjs` against `fixtures/scenario_parity.json`: 20 **synthetic** cases that `make_scenario_fixtures.py` runs through `compare.py` (missing inputs, exclusions, priority changes, a UI-only baseline, and every validation error). Regenerate the fixture after any change to `compare.py`. Existing Python integration tests remain the source-data checks.

Browser QA completed at 1440 × 1000 and 390 × 844: dropdown and keyboard map selection, weather variable/year, soil depth, priority questions, rotation expansion, winter-wheat sowing chronology, source modal open/close, all 31 sources, and mobile overflow. No browser warnings/errors were reported during those flows. Missing/partial weather and changed evidence states were tested in the presentation model. The live module was also run against the real POWER API from a cross-origin page on 2026-11-15: the 12 overlapping 2025 months matched the reviewed snapshot exactly, and 2026-01 to 2026-10 were added as complete with 2026-11 partial (data through Nov 12).

## Interpretation contract

- Three field outlines are plotted directly from the bundle's GeoJSON using a local geographic projection. The view has **no imagery basemap**, surveyed boundaries, verified farm ownership, or current water-right data. Approximate status is visible.
- Weather is **one shared regional NASA POWER series**. Year/variable controls do not imply field-scale measurements or forecasts. Annual precipitation requires all 12 complete months; annual mean temperature is day-weighted. Missing or partial annual coverage produces “Unavailable,” never zero.
- Live weather rows are **unreviewed and provisional**. Reviewed months are never replaced; if live values for overlapping months differ, the page says so and keeps the reviewed values. Live months are marked in the chart tooltip and table, and their request is listed as source `T3_NASA_POWER_LIVE`.
- Soil storage retains **cm water**, profile depth, and valid coverage. `fld01` has 92.8% coverage. Categorical soil shares are labelled separately from numeric valid-data coverage. Soil storage is not current moisture.
- Crop shares are classified pixel fractions, not probabilities of correctness. Histories always require confirmation; baseline remains unconfirmed.
- Field ET is NASA MODIS (500 m satellite pixel at field centre), labelled as such; it may underestimate irrigated crop water use. Empty ET stays **Data unavailable**. ET is not pumping. See [ET display](#et-display).
- All candidate suitability remains unknown and conditional. Priorities change the questions surfaced, never candidate order or performance ranking. Benefits, risks, references, treatment differences, calendars and unresolved inputs come directly from the agronomy bundle.
- Wheat sowing and harvest years are distinct. Calendar windows remain regional/historical examples, not local planting deadlines.
- Yield, profit and pumping savings are not predicted. Entered baselines and constraints are labelled *Supplied by you · not verified* (see [scenario inputs](#scenario-inputs)).

## Files and publication

`index.html`, `styles.css`, `app.js`, `model.mjs`, `live_weather.mjs`, `scenario.mjs`, `et_view.mjs` and `icon.svg` are the static application source. The model module contains presentation transforms only. Dynamic data text is escaped, source links accept only HTTP(S), and a bundle/schema failure shows an error instead of substitute evidence.

`.openai/hosting.json` stores the existing Site ID and static output configuration. Reuse that ID for future publication. A separate temporary Site checkout holds a deployment snapshot of these assets and `dist/`; the canonical source and research remain in this GitHub repository. Sites credentials must stay in memory/stdin, never in tracked files. Preserve the Site's private audience unless the team explicitly changes it.

## Live weather

`live_weather.mjs` takes the coordinate from the reviewed `T3_NASA_POWER_DAILY` request, fetches daily PRECTOTCORR/T2M/T2M_MIN/T2M_MAX from January of the last reviewed year to today, and builds monthly rows with the same rules as `research/deliverables/weather-water/weather.json` (rain total only when every day is valid; mean temperature over valid days; ties rounded away from zero). The re-fetched last reviewed year is an overlap check only. Recent POWER days come from near-real-time products (`header.sources` lists GEOSIT) and the latest few days are usually missing, so the current month shows as partial. The in-progress month counts every calendar day, including days after today, so it stays partial with no rain total until the month is over. The request has a 20 s timeout; any failure leaves the reviewed snapshot with a *Live update unavailable* note. The hosted Site must allow requests to `power.larc.nasa.gov` for live months to appear there. ET is not fetched live: the reviewed MODIS series is bundled, and OpenET needs an API key, which must never be shipped in a static page.

## Scenario inputs

`scenario.mjs` ports `compare()` from `prototype/compare.py`: the same field, priority and constraints give the same states, reasons and validation messages.

- **States.** Every sequence starts *Conditional*, because other farm inputs are unknown. There is no eligible, approved or ranked state. A sequence becomes *Excluded for your supplied schedule* only when a constraint is confirmed **and** has evidence, and either the earliest sowing date is after the validated window end with no feasible adjustment (`T1_R06`) or a verified plant-back conflict is stated (`T1_R09`). The exclusion applies to that supplied schedule only.
- **Unresolved inputs.** A constraint without confirmation or evidence is listed as unresolved and changes nothing. Unknown never becomes zero or favourable.
- **Checked constraints.** A confirmed constraint whose dates fit, or that allows an adjustment, is shown as *Checked · no exclusion*.
- **Priority.** Priority changes only the questions shown first; it never changes a state.
- **Baseline.** The baseline needs both a checked history (confirmed, or corrected with a note) and an intended continuation. It labels the matching sequence for reference only. `compare()` has no baseline input, and the bundle's `baseline` stays `null` (`validateBundle` still enforces this).
- **Privacy.** Entries are kept per field in page memory, with no storage and no network. *Clear all my entries* removes them, and so does reloading the page. Real farm inputs must never be added to tracked files; keep them in ignored `*.private.json` scenarios for `compare.py`.
- **Limits.** Water, equipment and market availability are not constraint kinds in `compare.py`, so they stay as open questions on each card.

## ET display

`et_view.mjs` accepts a field's ET only as `unavailable` (the reviewed panel stays exactly as is) or in the exact `available` shape `prototype/compare.py` emits after validating OpenET adapter or NASA MODIS output: monthly mm, one `T3_OPENET*` or `T3_MODIS*` source present in the bundle, adapter row fields, `et_mm` finite and ≥ 0 or null, `missing` exactly when null, rows inside the recorded period, and coverage that matches the rows. Anything else, and any source whose text says SYNTHETIC, stops the page from loading the bundle. The bundle schema has no synthetic flag, so only tests can opt in. Available ET shows the provider (*NASA MODIS (500 m satellite pixel at field centre)* or *OpenET (30 m field-boundary mean)*), the coverage line (“N of M months”), units, period, source, the interpretation, a monthly table with null months as *No value*, and the OpenET MAD range when the bundle carries it. ET is never converted to pumping, irrigation or savings. `test_et.mjs` builds its bundles by running `compare.py` (needs `python3`) on the SYNTHETIC OpenET fixture in `prototype/fixtures/` and on the empty `et_sample.json`, and checks the committed MODIS bundle never says OpenET.

Next interface work: reviewed calendars, plus water, market and equipment gates once `compare.py` defines them, then a first reviewed real OpenET bundle (needs an API key run locally). See the [integration review](../research/integration_review.md) for the research prerequisites.
