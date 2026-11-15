# Kimchi · Field Notes

First read-only interface for the reviewed `prototype/demo_bundle.json`. Select an approximate field, inspect regional weather and field soil/crop history, and compare three whole-field rotation sequences. Source details remain one click away.

Weather is **live on open**: after the reviewed bundle renders, the page requests NASA POWER for the same regional point and appends any months newer than the reviewed snapshot, labelled *Live · provisional* (see [live weather](#live-weather)).

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
node --test interface/test_model.mjs interface/test_live_weather.mjs
node --check interface/app.js
python3 -m unittest discover -s prototype -v
```

Use Node.js with the built-in test runner. Seven live-weather tests use a recorded-shape POWER response (no network): fill values become null, a partial current month withholds its rain total, a dry month stays zero, reviewed months are never overwritten, a differing overlap is reported, and HTTP/network failures reject. Six presentation-model tests cover separate field histories, soil units/depth/coverage, zero vs missing rain, incomplete annual summaries, priority references, changed evidence states, and safe source links. Existing Python integration tests remain the source-data checks.

Browser QA completed at 1440 × 1000 and 390 × 844: dropdown and keyboard map selection, weather variable/year, soil depth, priority questions, rotation expansion, winter-wheat sowing chronology, source modal open/close, all 31 sources, and mobile overflow. No browser warnings/errors were reported during those flows. Missing/partial weather and changed evidence states were tested in the presentation model. The live module was also run against the real POWER API from a cross-origin page on 2026-11-15: the 12 overlapping 2025 months matched the reviewed snapshot exactly, and 2026-01 to 2026-10 were added as complete with 2026-11 partial (data through Nov 12).

## Interpretation contract

- Three field outlines are plotted directly from the bundle's GeoJSON using a local geographic projection. The view has **no imagery basemap**, surveyed boundaries, verified farm ownership, or current water-right data. Approximate status is visible.
- Weather is **one shared regional NASA POWER series**. Year/variable controls do not imply field-scale measurements or forecasts. Annual precipitation requires all 12 complete months; annual mean temperature is day-weighted. Missing or partial annual coverage produces “Unavailable,” never zero.
- Live weather rows are **unreviewed and provisional**. Reviewed months are never replaced; if live values for overlapping months differ, the page says so and keeps the reviewed values. Live months are marked in the chart tooltip and table, and their request is listed as source `T3_NASA_POWER_LIVE`.
- Soil storage retains **cm water**, profile depth, and valid coverage. `fld01` has 92.8% coverage. Categorical soil shares are labelled separately from numeric valid-data coverage. Soil storage is not current moisture.
- Crop shares are classified pixel fractions, not probabilities of correctness. Histories always require confirmation; baseline remains unconfirmed.
- Empty ET stays **Data unavailable**. ET is not pumping.
- All candidate suitability remains unknown and conditional. Priorities change the questions surfaced, never candidate order or performance ranking. Benefits, risks, references, treatment differences, calendars and unresolved inputs come directly from the agronomy bundle.
- Wheat sowing and harvest years are distinct. Calendar windows remain regional/historical examples, not local planting deadlines.
- Yield, profit and pumping savings are not predicted. This interface has no schedule-exclusion form or baseline-confirmation form yet; the Python comparison layer remains available for explicitly supplied constraint scenarios.

## Files and publication

`index.html`, `styles.css`, `app.js`, `model.mjs`, `live_weather.mjs` and `icon.svg` are the static application source. The model module contains presentation transforms only. Dynamic data text is escaped, source links accept only HTTP(S), and a bundle/schema failure shows an error instead of substitute evidence.

`.openai/hosting.json` stores the existing Site ID and static output configuration. Reuse that ID for future publication. A separate temporary Site checkout holds a deployment snapshot of these assets and `dist/`; the canonical source and research remain in this GitHub repository. Sites credentials must stay in memory/stdin, never in tracked files. Preserve the Site's private audience unless the team explicitly changes it.

## Live weather

`live_weather.mjs` takes the coordinate from the reviewed `T3_NASA_POWER_DAILY` request, fetches daily PRECTOTCORR/T2M/T2M_MIN/T2M_MAX from January of the last reviewed year to today, and builds monthly rows with the same rules as `research/deliverables/weather-water/weather.json` (rain total only when every day is valid; mean temperature over valid days; ties rounded away from zero). The re-fetched last reviewed year is an overlap check only. Recent POWER days come from near-real-time products (`header.sources` lists GEOSIT) and the latest few days are usually missing, so the current month shows as partial. The request has a 20 s timeout; any failure leaves the reviewed snapshot with a *Live update unavailable* note. The hosted Site must allow requests to `power.larc.nasa.gov` for live months to appear there. ET stays unavailable: OpenET needs an API key, which must never be shipped in a static page.

Next interface work: a reviewed baseline-confirmation flow and dated constraint inputs, then validated ET ingestion. See the [integration review](../research/integration_review.md) for the research prerequisites.
