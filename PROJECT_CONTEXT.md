# Kimchi — project context and collaborator guide

**Updated November 15, 2026, America/Detroit.** This is the shared orientation document for people and AI assistants joining the project. Read it before starting a task, then read the relevant source package and implementation. It consolidates the original planning, research handoffs, integration review, first interface, and newly opened follow-up work.

**Version boundary matters:** the integrated research baseline was `c13f998` (PR #4). This guide accompanies the first interface on `codex/first-interface`. The reviewed data bundle in this change is still the PR #4 snapshot. Follow-up PRs #5–#8 exist but are **not treated as merged or independently validated by this guide**. Check their current status before acting. In particular, **PR #5 reports a real 2022–2023 raster-grid error and corrected crop fractions**; review that correction before relying on the existing fractions in a presentation or further calculation.

## Contents

1. [Purpose and current status](#1-purpose-and-current-status)
2. [Decisions, assumptions, and open choices](#2-decisions-assumptions-and-open-choices)
3. [Where to start and how to run it](#3-where-to-start-and-how-to-run-it)
4. [Repository and data flow](#4-repository-and-data-flow)
5. [Data inventory and interpretation](#5-data-inventory-and-interpretation)
6. [Agronomy and comparison logic](#6-agronomy-and-comparison-logic)
7. [First interface contract](#7-first-interface-contract)
8. [Follow-up branches and integration order](#8-follow-up-branches-and-integration-order)
9. [Next work packages and acceptance criteria](#9-next-work-packages-and-acceptance-criteria)
10. [Reproduction and updating data](#10-reproduction-and-updating-data)
11. [Validation record and limits](#11-validation-record-and-limits)
12. [Git, publication, privacy, and handoff](#12-git-publication-privacy-and-handoff)
13. [Scientific and product guardrails](#13-scientific-and-product-guardrails)
14. [Troubleshooting and unresolved decisions](#14-troubleshooting-and-unresolved-decisions)
15. [Maintaining this guide](#15-maintaining-this-guide)

## 1. Purpose and current status

Kimchi is a NASA Space Apps project exploring how environmental data and agronomic evidence can help a farmer compare crop rotations under constrained irrigation. The useful question is **“What would need to be true for this sequence to work on this field?”** The current implementation explains tradeoffs, uncertainty, and missing inputs; it does not calculate an optimal rotation.

The working demonstration uses three approximate pivot-circle analysis areas in western Kansas associated with Sheridan 6 (SD-6). It compares continuous corn, corn–grain sorghum, and corn–winter wheat. Water limitations are the primary framing, with soil protection and operational feasibility also important. The project name does not mean the present crop library contains kimchi vegetables.

The team consists of the project owner and three teammates. The owner reported that all three teammates have balanced skills and will also use AI assistance. Initial work was divided into independently executable agronomy, fields/soils, and weather/ET packages. The main integration work combines their outputs. Do not assume a particular person has accepted a new assignment merely because this guide lists a workstream.

The user explicitly requested that project updates go into GitHub. The shared repository is [kevindurantbr/kimchi](https://github.com/kevindurantbr/kimchi), verified public when this guide was prepared. Decisions should survive the chat: record them in a file or PR with evidence and limitations.

### Challenge references and what is not confirmed

- The owner's supplied challenge link is [Adapting Farms with NASA Data](https://www.spaceappschallenge.org/2026/challenges/adapting-farms-with-nasa-data/).
- Earlier research used the [Field Shift: Adapting Farms with NASA Data URL](https://www.spaceappschallenge.org/2026/challenges/field-shift-adapting-farms-with-nasa-data/).
- A fresh attempt to retrieve these pages on November 15 failed (unavailable/502). This guide therefore does **not** certify the current official wording, year-specific rules, judging rubric, deliverable format, or event cutoff.
- Confirm the registered event's instructions and deadline before setting a submission schedule. The handoffs' original 60–90 minute work interval was a suggested research checkpoint, not a competition deadline.

### Delivered versus still missing

| Area | State in this change |
| --- | --- |
| Agronomy | Three sourced candidate sequences; 21 agronomy sources; 15 qualitative evidence rules. Local suitability and validated calendars remain unknown. |
| Fields/crops | Three approximate geometries, five harvest years per field, 45 crop-class rows in the integrated snapshot. A correction to 2022–2023 fractions is pending in PR #5. |
| Soils | 18 rows: four available-water-storage depths and two categorical properties per field. Coverage and units retained. |
| NASA weather | Complete daily 2021–2025 regional sample and 60 reviewed monthly rows. No automatic refresh in the first interface. |
| ET | No real retrieved ET rows. Adapter exists and has offline tests; successful authenticated live parsing is unverified. PR #8 proposes the downstream ingestion/display path. |
| Comparison layer | Deterministic bundle plus a CLI with conditional candidates and two types of supplied constraint. No winner or numeric yield/profit/pumping outputs. |
| First interface | Field selection/map, crop history, weather year/variable, soil depth/coverage, priority questions, rotation evidence/calendars, and 31-source library. Read-only. |
| Publication | Owner-private [hosted preview](https://kimchi-field-notes.bingxuanuniversity.chatgpt.site). GitHub source is public; these are separate access settings. |
| Follow-ups | PR #5: fields correction/current order; #6: recent weather; #7: baseline/scenarios; #8: gated ET path. See the dependency table below. |

## 2. Decisions, assumptions, and open choices

The distinction between a user decision, an implementation choice, and a hypothesis prevents accidental scope drift.

| Topic | Status and consequence |
| --- | --- |
| GitHub as shared workspace | Explicit owner instruction. Commit project changes and explain material decisions in the repository. |
| First interface using the reviewed bundle | Explicit owner request. The interface must preserve missing-data and uncertainty labels. |
| Farming system and geography | **Working demo choice:** irrigated western Kansas/SD-6. The owner previously said the farming system was undecided; no explicit final scope confirmation is recorded. Do not describe this as a finalized competition commitment. |
| Primary user | Working persona: a farmer considering rotations under irrigation limits. We have no interviewed farmer or validated user study. |
| Demonstration field | `fld01` opens by default because all five dominant classifications are corn. This is a storytelling choice, not proof of the farmer's intended continuation. |
| Baseline | Unknown for every field. Past classifications and a future baseline are different. Continuous corn is a candidate, not an automatically confirmed baseline. |
| Three crops/sequences | Research-backed initial library. Do not quietly add crops, covers, fallow, or double cropping without revisiting evidence and chronology. |
| Two-year accounting | Whole-field alternation over two harvest years. Concurrent phase-split acreage is a different scenario and is not modelled. |
| Priority control | Presentation focus only. Water, soil, and operations surface different questions; they do not create scores, rankings, or eligibility changes. |
| Numerical claims | Qualitative fallback is active. Trial means and budget assumptions are not validated field response functions. |
| Farm data | No confirmed irrigation schedule, current moisture, ownership, measured pumping, herbicide history, farm costs, buyer terms, or current pest status has been obtained. |
| Expert validation | No completed local expert validation is recorded. Research does not substitute for it. |
| Sharing/licensing | Public repository; private Site. No original-code open-source license has been selected. External data/publications retain their own terms. |

## 3. Where to start and how to run it

For a new collaborator, the reading order is this guide, [CONTRIBUTING.md](CONTRIBUTING.md), [integration review](research/integration_review.md), then the relevant implementation/package. The three numbered handoffs are the **original assignments**, not a current backlog. Some original schema options and access statements were superseded; use the current code, source records, and this guide's version boundary.

### Standard setup

You need Git, Python 3.8+ for the comparison/adapter/build scripts, and Node.js with the built-in test runner for interface tests. The ordinary demo has no Python package-install or npm-install step. GIS extraction has additional dependencies; see section 10.

```sh
git clone https://github.com/kevindurantbr/kimchi.git
cd kimchi
git switch main
git pull --ff-only
python3 prototype/compare.py --check
python3 interface/build.py
python3 -m http.server 8765 --bind 127.0.0.1 --directory interface/dist
```

Open http://127.0.0.1:8765/ in a browser. Serve over HTTP; opening `index.html` directly can prevent its JSON fetch. Stop the server with Ctrl+C. If this interface change has not yet been merged, check out `codex/first-interface` instead; do not assume an older `main` contains `interface/`.

In another terminal, from the repository root:

```sh
python3 -m unittest discover -s prototype -v
python3 research/deliverables/weather-water/t3_water_data.py selftest
node --test interface/test_model.mjs
node --check interface/app.js
```

To inspect CLI comparison output:

```sh
python3 prototype/compare.py --field fld01 --priority water
python3 prototype/compare.py --field fld02 --priority soil
```

Both print JSON. Allowed priorities are `water`, `soil`, and `operations`. Neither command predicts a winning sequence.

## 4. Repository and data flow

| Location | Responsibility |
| --- | --- |
| `README.md` | Short project entry point and run commands. |
| `PROJECT_CONTEXT.md` | Shared context, current version boundary, dependencies, and work packages. |
| `CONTRIBUTING.md` / `.github/pull_request_template.md` | Branch/PR workflow and review expectations. |
| `research/README.md` | Original research rationale and integration plan; read its later updates. |
| `research/01_agronomy_handoff.md` | Original agronomy assignment. |
| `research/02_fields_soils_handoff.md` | Original spatial-data assignment; includes a correction to the initial LEMA reference. |
| `research/03_weather_water_handoff.md` | Original weather/ET assignment. |
| `research/deliverables/agronomy/` | Candidate library, rules, primary-source records, and research findings. |
| `research/deliverables/fields-soils/` | Geometries, crop/soil observations, source vectors, extraction scripts/log, and imagery check. |
| `research/deliverables/weather-water/` | Daily/monthly weather, provenance, empty ET envelope, test geometry, adapter, notes. |
| `research/data/` / `research/fetch_weather.py` | Earlier NASA access proof and raw retrieval script. Retained for provenance/comparison; not the interface's authoritative monthly input. |
| `prototype/compare.py` | Validation, joining, deterministic bundle generation, CLI comparison. |
| `prototype/demo_bundle.json` | Generated, tracked integration snapshot consumed by the interface. Do not hand-edit it. |
| `prototype/test_compare.py` | Integration and adapter regressions. |
| `interface/` | Static app source, presentation transforms/tests, build script, setup/QA notes, Site identity. |
| `interface/dist/` | Generated static output; Git-ignored. Contains an exact copy of the bundle. |

The main data path is:

```text
agronomy.json + fields.geojson + field_observations.json + weather.json + et_sample.json
                                  |
                         prototype/compare.py --build
                                  |
                       prototype/demo_bundle.json
                                  |
                         python3 interface/build.py
                                  |
                    interface/dist/ -> browser / private Site
```

`prototype/compare.py` records SHA-256 hashes of the five input files in `input_sha256`. `--check` compares the committed bundle with a fresh deterministic build. `interface/build.py` independently checks those input hashes before copying the bundle. If a source file changes, regenerate the bundle, review its diff, then rebuild the interface. Do not delete the checks to get a changed dataset to load.

There are **two comparison consumers**: the Python CLI applies supported constraints; the first browser interface only presents evidence. It does not call Python at runtime. The scenario follow-up ports those rules to JavaScript and proposes parity fixtures; it is separate work until integrated.

## 5. Data inventory and interpretation

### Versioned contracts

Contributor envelopes use `schema_version: "1.0"`. The joined bundle uses `schema_version: "kimchi.demo.1"`. These identify different contracts, not consecutive releases of one schema.

| Bundle element | Meaning |
| --- | --- |
| `sources` | 31 source records in this snapshot: 21 `T1_` agronomy, 8 `T2_` spatial/soil, and 2 `T3_` weather/ET. They are records, not 31 independent experiments. |
| `fields[]` | `field_id`, original `feature`, five `history` entries with class rows, `soils`, null `baseline`, baseline status, and ET availability block. |
| `regional_weather` | One scope description and monthly `rows`, not separate weather measurements for each field. |
| `candidates` | Three agronomy candidates including phases, benefits, risks, unresolved inputs, evidence status, and source IDs. |
| `rules` | Fifteen qualitative rules and input requirements. Most are evidence/question records, not implemented automatic gates. |
| `input_sha256` | Input-file paths and hashes for reproducibility. |

Preserve exact IDs: `fld01`, `fld02`, `fld03`; candidates `corn_corn`, `corn_sorghum`, `corn_wheat`; regional series `regional_sample`. Source references must resolve. Do not attach the `test01` geometry or synthetic fixtures to a real demonstration field.

### Fields and crop history

All geometries are WGS84 GeoJSON with longitude first. They are approximately 400 m radius circles fitted around PLSS quarter-section centres and clipped to the quarter. They are analysis areas, not surveyed boundaries, parcels, confirmed ownership, or proof of current irrigation.

| ID | PLSS location | Approx. area | Dominant classifications for harvest years 2021 → 2025 |
| --- | --- | --- | --- |
| `fld01` | T7S R30W, Sec 33 SW | 50.2 ha | Corn → Corn → Corn → Corn → Corn |
| `fld02` | T8S R30W, Sec 4 NE | 50.2 ha | Corn → Corn → Sorghum → Sorghum → Winter Wheat |
| `fld03` | T7S R30W, Sec 29 NW | 50.0 ha | Corn → Winter Wheat → Winter Wheat → Corn → Winter Wheat |

The crop sequences above are unchanged in the pending correction. **Exact 2022–2023 fractions in the baseline are superseded by proposed corrected values in PR #5; do not quote the old fractions as settled results.** The old extraction reused the 2021 raster origin for all years. The follow-up reports the 2022/2023 origin is one 30 m pixel east and north, and supplies independent checks. See section 8 for the review boundary.

The initial package contains 45 class rows across 15 field-years. Crop fraction is class pixels divided by valid nonzero pixels inside the analysis polygon. Valid coverage is valid pixels divided by all included pixel centres. Those quantities are distinct. Minor classes below 1% are pooled into “Other”; rounding can make sums slightly differ from 1.

`confirmation_needed` flags additional ambiguity: a dominant share below 85%, a dominant class outside the initial library, or sorghum. `fld02` 2023 and 2024 are flagged. A false flag does **not** mean farmer-confirmed history. All histories need confirmation. Statewide classification accuracy is not a field-level confidence probability.

The downloaded county clips are 30 m. The follow-up notes that 2024/2025 native CDL products are 10 m, with edge differences from these 30 m clips. Do not relabel the actual files as 10 m. The 2024–2025 Kansas accuracy tables were not located. Crop labels must not be interpolated bilinearly.

`irrigation_status` remains `likely` for every field. The integrated `lema_membership` is `historical_boundary_verified_current_unverified`. PR #5 proposes `verified_2023_2027_order` after reviewing the current legal description. Even after that verification, section inclusion does not establish water-right enrolment, allocation, current pumping, or compliance. Membership after 2027 is not established by that order.

### Soil properties

Soil Data Access/SSURGO supplies map-unit available water storage and dominant-condition categories. Field numeric means use clipped map-unit areas in EPSG:5070; map-unit values already reflect component weighting. Null map units are excluded from the mean and reported through coverage.

| Field | 0–25 cm | 0–50 cm | 0–100 cm | 0–150 cm | Numeric valid coverage |
| --- | ---: | ---: | ---: | ---: | ---: |
| `fld01` | 5.19 | 10.33 | 20.53 | 30.78 | 92.8% |
| `fld02` | 5.23 | 10.43 | 20.85 | 31.29 | 100% |
| `fld03` | 4.94 | 9.82 | 19.79 | 29.92 | 100% |

Values are **cm of water**, with the soil profile depth shown separately in the headings. They are cumulative 0-to-depth values: do not add the four depths together. Multiply by 10 only if explicitly converting cm water to mm water; keep units in the record and UI.

`fld01` has a 7.2% map-unit share labelled Water with no soil properties. That is not a zero-storage measurement and does not prove standing water today. A playa/depression explanation in the initial notes is a hypothesis requiring local confirmation. The pending crop-grid correction does not change the soil rows.

For categorical `hydrologic_group_dominant_condition` and `drainage_class_dominant_condition`, `value` is text and unit/depth are null. Their `coverage_fraction` is the area share of the winning category, **not** numeric-data completeness. The interface labels that difference. Available water storage is capacity/property context, not current moisture, root-accessible water today, nitrogen, or a soil-health score.

### NASA POWER weather

The reviewed request is longitude **−100.64**, latitude **39.36**, 2021-01-01 through 2025-12-31. It contains 1,826 daily dates for `PRECTOTCORR`, `T2M`, `T2M_MIN`, `T2M_MAX`. Precipitation is mm/day; temperatures are °C. Recorded response metadata uses Local Solar Time days and POWER Daily API v2.10.3 with MERRA2/POWER sources. This is retrieval metadata, not a promise about future API versions.

All 60 monthly rows in the delivered snapshot are complete. `weather_daily.csv` retains daily values for future calendar analysis. Fill −999, absent data, and handled missing values must not become zero. Monthly precipitation is a total only when the whole calendar month has valid precipitation. Mean temperature uses valid daily T2M values. `days_observed` counts dates with both valid rain and mean temperature. After integration, `days_expected` means **all days in the calendar month**, including for a partial requested window.

The first interface computes annual precipitation only for 12 complete months and a day-weighted annual mean temperature only with complete coverage. It provides exact monthly values/quality beneath the chart. All fields share the same regional series. Approximate source-native meteorology support is tens of kilometres (about 0.5° latitude × 0.625° longitude); the point is not a verified field or proof of LEMA inclusion. Five years are historical examples, not climate normals or a trend.

`research/data/weather_monthly.json` is the earlier access-proof schema (`days`, singular `source_id`). Current consumers use the teammate's `weather.json` (`days_observed`, `days_expected`, `source_ids`). Their 60 precipitation/temperature values were independently compared and match. Do not wire the older file into the interface without an explicit adapter.

PR #6 proposes appending newer, provisional data on page open. It does not make the original 2021–2025 snapshot live or independently field-specific. Its browser/API validation is contributor-reported until the follow-up is reviewed and deployed.

### OpenET status and adapter

`et_sample.json` currently contains `rows: []` and source metadata recording unavailable access. No actual ET has been retrieved into this project snapshot. The contributor's unauthenticated request returned HTTP 403. An API key is necessary, but **not the only integration step**: the first real response still needs parsing/unit/period verification, and downstream ingestion/display must be reviewed.

The adapter accepts Polygon/MultiPolygon features, retains `field_id`, and resolves status from `geometry_status`, then `boundary_status`, then an explicit default. Supported statuses after integration are `documented`, `approximate`, `test`. Actual demo fields stay `approximate`. It validates basic rings/ranges/positive area, but does not provide complete GIS topology validation.

The intended request is monthly ensemble actual ET, mean reducer, mm, OpenET collection version 2.1. Simple polygons use flat coordinates; auto mode uses GeoJSON for holes. Forced flat mode rejects holes. MultiPolygon parts are retrieved separately and area-weighted; a missing part makes that month's result null. The optional MAD min/max range is model spread, not an invented confidence interval.

Row quality (`reported`, `area_weighted_from_parts`, `missing`) describes adapter handling, not independently verified OpenET product quality. Parsing rejects ambiguous columns such as counts, invalid/duplicate months, and invalid numeric values. Empty/missing data are not zero. Access failure and response-shape failure produce empty output with an explicit retrieval failure record.

The original bundle builder intentionally rejects nonempty ET, and the first interface refuses changed evidence states until reviewed. PR #8 adds an explicit `--et` ingestion route and available-ET UI. Do not bypass the guard or copy synthetic fixture values into `demo_bundle.json`. Confirm current account terms/quota with OpenET; the original handoff's free-tier counts are dated access notes, not a guaranteed current entitlement.

## 6. Agronomy and comparison logic

The source package is [agronomy.json](research/deliverables/agronomy/agronomy.json), with a readable synthesis in [agronomy_findings.md](research/deliverables/agronomy/agronomy_findings.md). Sources include original experiments, extension material, budget assumptions, and documented access limits.

| Candidate | Why compare it | Key unresolved tradeoff |
| --- | --- | --- |
| `corn_corn` | Direct limited-irrigation comparison baseline; could fit existing equipment/markets. | Concentrated summer demand and repeated-corn pest/residue concerns. A seasonal allocation does not prove peak delivery sufficiency. |
| `corn_sorghum` | Direct two-year rotation evidence; historical economics justify considering it. | Less soil water before following corn in the cited experiment, overlapping summer demand, and sorghum maturity/market/equipment requirements. Drought tolerance is not stored-water conservation. |
| `corn_wheat` | Different seasonal demand and evidence for following-corn performance. | Corn harvest to timely wheat establishment, establishment water, volunteer/green-bridge disease risks, and whole-sequence economics. |

`supported_candidate` means evidence supports **including it in a comparison**. It is not “suitable for this field.” Candidate `field_suitability` and `locally_validated_calendar` remain null. All three start conditional in the CLI; the first interface displays suitability unknown.

The older trial and later studies differ in years, irrigation treatment, crop sets, and economics. Older rotated-corn phases received different water allocations; later results cannot be combined into a universal yield uplift. Annual reports from the same trial are not independent replications. One later economic source was read through an original USDA abstract, not its full methods. Some migrated publisher material was read as reproduced original text; the source records preserve those access limits.

Wheat in the two-year sequence is sown in autumn of calendar year 1 and harvested in year 2; subsequent corn is year 3. Historical statewide ranges include geography and management unlike this demo. A regional sowing target or trial date is not a validated local last planting date. Gaps between phases do not automatically refill the soil profile or imply an extra cover crop.

### Which rules actually execute

The 15 records cover unknown field inputs; annual versus peak water supply; ET versus pumping; matching trial treatments; wheat handoff; confirmed calendar failure; year/area accounting; unknown herbicide history; confirmed plant-back conflict; no automatic family/N credit; wheat health; residue/recharge; markets/equipment; numeric fallback; and whole-sequence economics.

Only two exclusion kinds are implemented by `compare()`:

| Kind | Required supplied conditions | Result |
| --- | --- | --- |
| `calendar` | Known candidate, `confirmed: true`, nonempty evidence, ISO earliest sowing date later than a locally validated window end, `no_feasible_adjustment: true`. | Exclude that supplied schedule via `T1_R06_CONFIRMED_CALENDAR_FAILURE`. |
| `plantback` | Known candidate, `confirmed: true`, nonempty evidence, `conflict: true`. | Exclude that supplied schedule via `T1_R09_CONFIRMED_PLANTBACK_CONFLICT`. |

Missing confirmation/evidence stays unresolved. Other candidates remain conditional. A caller checking “confirmed” is an assertion, not independent verification by the program. The CLI is not a complete farm-input validator; malformed required calendar fields can raise an error. It must not be presented as a production advisory system.

The CLI accepts `--scenario path.private.json` with top-level `synthetic` and `constraints`. See [prototype/README.md](prototype/README.md) for the exact contract. Test dates are explicitly synthetic, not local agronomic cutoffs. Baseline is not a `compare()` input. PR #7 adds a UI-only supplied baseline label; that does not change the reviewed bundle's null baseline.

Priorities select rule questions: water → annual/peak, ET/pumping, wheat handoff; soil → residue/recharge and no automatic family/N credit; operations → handoff, market/equipment, herbicide history. Candidate ordering and `winner: null` remain unchanged. `numeric_outputs` for yield, profit, and pumping savings remain null. Not every evidence rule has a computable threshold or automatic gate.

## 7. First interface contract

The static application uses ordinary HTML/CSS/JavaScript, an SVG field overview, and the reviewed JSON. No external framework, basemap tile service, backend database, secret, or runtime recommendation service is needed. Source details are available from each evidence block and the full library.

The first interface includes:

- Default `fld01`, year 2025, 0–150 cm soil depth, and water focus.
- Field selection from dropdown or keyboard-accessible map outlines; field-specific history, location, approximate area, and soil updates.
- Regional rainfall/temperature charts and exact monthly quality table; selectable 2021–2025 years.
- Soil-depth selection with numeric coverage, explicit missing area, and separate category shares.
- Three unranked sequence cards, research benefits/risks, two-year reference calendars, prerequisites, unknowns, and source records.
- Explicit unavailable ET, unconfirmed baseline, approximate boundaries, likely-but-unconfirmed irrigation, unknown suitability, and no numerical prediction labels.
- Error handling that shows no substitute evidence when the bundle cannot load or its supported states change.

The map is a local geographic view of actual supplied GeoJSON outlines, **not satellite imagery or a surveyed map**. The NAIP image in the research package is separate supporting evidence and is not used as a live georeferenced basemap.

The first interface does **not** fetch current weather, accept farmer entries, exclude scenarios interactively, store preferences, retrieve ET, run crop simulation, or rank outcomes. PRs #6–#8 propose some of those capabilities. Do not describe the hosted first-interface snapshot as already including their features.

## 8. Follow-up branches and integration order

This inventory was read from GitHub and fetched branches on November 15. Branches may advance. Before reviewing or merging, fetch again and inspect the exact head/base; do not cherry-pick an entire stack as if all files were a single contributor's new work.

| PR / branch / observed head | Base/dependency | Proposed change | Review state here |
| --- | --- | --- | --- |
| [#5](https://github.com/kevindurantbr/kimchi/pull/5), `codex/fields-soils-followup`, `1b8090d` | Integrated research baseline | Per-year CDL grid validation/correction; independent verification log; current SD-6 order evidence; regenerated observations/bundle. | Read its notes, data summary, and verification record. Full independent rerun not performed for this guide. High-priority scientific correction. |
| [#6](https://github.com/kevindurantbr/kimchi/pull/6), `codex/live-weather`, `ec8f8cf` | `codex/first-interface` | Fetch recent POWER data, append provisional months, retain reviewed overlap, show failure/partial-month status. | Contributor-reported tests/API/browser checks; not part of the first deployed interface. Later commit explicitly keeps the current month partial. |
| [#7](https://github.com/kevindurantbr/kimchi/pull/7), `codex/interface-scenarios`, `986c2fa` | `codex/live-weather` (#6) | In-memory baseline/history confirmation and dated constraints, JS/Python parity fixtures. | Contributor-reported tests; no independent full review or merge in this change. |
| [#8](https://github.com/kevindurantbr/kimchi/pull/8), `codex/et-pathway`, `50f0e1f` | `codex/interface-scenarios` (#7) | Validate optional real ET ingestion and available-ET display, with synthetic fixtures for tests. | Code/notes inspected for context, not accepted as a completed real-data retrieval. ET remains unavailable. |

Recommended order: finish the first-interface/context PR; review the scientific correction #5 promptly; then review the stacked chain #6 → #7 → #8 in dependency order. Retarget remaining PR bases to integrated `main` as appropriate and reconcile regenerated bundles and documentation. Do not delete a branch still serving as another PR's base without updating that dependency.

### Specific integration hazards

- **#5:** crop rows change 45 → 40 and source records 31 → 32 (historical order retained separately). Dominant crops, confirmation flags, geometry, and soils reportedly do not change. Example correction: `fld02` 2022 corn share 0.946 → 0.998; independent `fld02` 2023 recount gives sorghum 0.977. Review `cdl_verification.json`, the per-file origins and CRS checks, and the regenerated bundle together.
- **#5 UI wording:** the first interface hardcodes the historical/current-unverified LEMA wording. Accepting a new enum in the data is not enough: update UI text to “verified designated sections for 2023–2027,” preserve approximate geometry and water-right caveats, and update tests/docs. Do not infer 2028+ membership.
- **#6:** static first-interface build has no outbound weather requests. Review the new request/timeout, provisional source labels, current-month completeness, overlap conflict behavior, year selection, and hosted cross-origin access. A live response is not a reviewed source refresh.
- **#7:** baseline confirmation is a caller-supplied UI reference, not a change to the source bundle or automatic field approval. Entries are proposed to stay in page memory, clearing on reload; no private inputs should be committed. Verify parity fixtures after Python rule changes.
- **#8:** no key or real ET is added. Synthetic fixtures must remain isolated and labelled. The available-ET schema, builder, interface validator/display, source IDs, period/units, null coverage and optional MAD range must migrate together. The branch's prototype README still contains older wording that the interface rejects available ET; reconcile it with the branch's newer display code before merge.
- The stacks share interface files and README history. Merge deliberately rather than accepting an entire “ours/theirs” version that drops provenance, coverage warnings, current-month checks, or this guide.

## 9. Next work packages and acceptance criteria

These are suggested responsibilities, not assignments already accepted by named people. Inspect the PR table first to avoid duplicating proposed work.

| Workstream | Next useful action | Deliverable and acceptance |
| --- | --- | --- |
| Integration | Review #5 and the #6→#7→#8 stack; preserve a working `main`. | Explicit review per head, required code/docs/schema migrations, regenerated bundle, relevant tests, desktop/mobile checks, and redeployed matching source. |
| Agronomy | Validate northwest-Kansas calendars and identify usable response functions. | Primary-source locators, geography/treatment limits, full phase chronology, required inputs and domain of validity. No universal cutoff or uplift. If coefficients cannot be recovered, say so and retain qualitative comparison. |
| Fields/soils | Finish review of the grid/current-order follow-up; check remaining resolution/accuracy gaps. | Per-year geotransforms/CRS, independent field-year count, source metadata, correct membership period, approximate geometry, unchanged missing-soil treatment. Investigate 2024/2025 30 m vs native 10 m interpretation without silently substituting products. |
| Weather/ET | Obtain authorized local OpenET access and validate one small real response. | One real field/short-period output with secret-free request metadata, units, period, geometry, quality/nulls and optional spread; manually verified parser result. Only then retrieve all fields/years and integrate through a reviewed ET path. |
| Product/user validation | Confirm the demo farming system, baseline assumptions, user workflow and phase accounting. | Written decisions and realistic farm-input requirements. Do not contact farmers/experts or send messages on the owner's behalf without explicit authorization. |
| Submission | Confirm official challenge/rules/deadline and prepare the evidence-led story. | Verified official references, NASA data role, working demo path, source credits, limitation statement, and required submission assets. No invented deadline or claimed contest result. |

Interface development and a qualitative demonstration can proceed without real ET. Numerical profit, pumping savings, and crop-specific stress predictions cannot be justified merely by adding ET. They need an independently checked model and the inputs it requires: soil/rooting/current water, phase management, irrigation volume and peak capacity/efficiency, weather/phenology, yields, prices, costs, and consistent accounting boundaries.

## 10. Reproduction and updating data

Run data-changing commands on a dedicated branch and inspect outputs. Fresh source services can change; reproduce into a scratch directory when checking a method. Record request, retrieval time, product/version, units, resolution, missingness and applicability. Large rasters belong outside tracked Git.

### Weather rebuild without network

From the repository root, use a scratch output directory first:

```sh
python3 research/deliverables/weather-water/t3_water_data.py weather \
  --from-daily-csv research/deliverables/weather-water/weather_daily.csv \
  --provenance research/deliverables/weather-water/T3_power_provenance.json \
  --out-dir /tmp/kimchi-weather-check
```

Review the result against committed `weather.json`. The adapter can fetch POWER with `weather --out-dir PATH`; its defaults target the original coordinate and 2021–2025 period. The older `research/fetch_weather.py` overwrites the earlier raw sample/provenance and does **not** regenerate its monthly file. Avoid accidentally updating only half a pipeline.

### Spatial reproduction

Use the fields/soils package as the working directory. Its scripts use relative `raw/` and `src/` paths. Dependencies listed by the contributor are NumPy, Shapely 2.x, pyproj and tifffile; Pillow is only for the imagery check. These are not needed to run the ordinary demo.

```sh
cd research/deliverables/fields-soils
bash scripts/fetch_sources.sh
python3 scripts/select_fields.py
python3 scripts/extract_fields.py
```

**Do not use the baseline extraction as a fresh scientific result until #5's grid fix has been reviewed/applied.** That follow-up adds `cdl_grid.py` and `verify_cdl.py`. API downloads can be slow/unavailable, and a current SSURGO query may not reproduce historical values exactly. The baseline integration did not re-download all rasters or rerun live soil extraction.

### Real ET access

Use an OpenET key only through `OPENET_API_KEY` in a local environment. Do not paste it into chat, put it in a browser-delivered JS bundle, or commit it. An ignored `.env` is not automatically read by the adapter; its code reads the environment, so load it locally if that is your workflow.

Begin with one selected field and a short period, validate the raw response, then run the supplied three-field file for the full interval:

```sh
python3 research/deliverables/weather-water/t3_water_data.py et \
  --fields research/deliverables/fields-soils/fields.geojson \
  --start 2021-01-01 --end 2025-12-31 \
  --out research/deliverables/weather-water/et.json
```

This full command is a future retrieval step, **not evidence it has succeeded**. Raw replies default to ignored `openet_raw/`; inspect before sharing. `--with-uncertainty` adds requests and an output range file. Consult current service limits before a large run. `--dry-run` contacts nothing, writes an empty envelope, and exits with a nonzero unavailable status; that is not a successful ET extraction.

In the integrated baseline, nonempty ET still fails `compare.py` validation. After #8 is accepted, its proposed command is `python3 prototype/compare.py --build --et PATH`, with the same path supplied to `--check`. Do not run that flag against the older CLI and assume it exists.

### Regenerate the reviewed application bundle

After accepted source changes:

```sh
python3 prototype/compare.py --build
python3 prototype/compare.py --check
python3 -m unittest discover -s prototype -v
python3 interface/build.py
node --test interface/test_model.mjs
```

Review `git diff` before staging. For merged follow-ups, run their additional tests, including `node --test interface/test_*.mjs` and scenario-fixture freshness checks where those files exist. A changed schema requires corresponding consumer changes; do not just regenerate until a guard stops complaining.

## 11. Validation record and limits

The integrated data layer passed 12 regression tests and the weather/ET adapter selftest with zero failures. Those tests cover missing data, field joins, crop/soil context, source references, approximate geometry acceptance, malformed ET, priorities, and a synthetic confirmed calendar conflict. All 60 monthly weather values were compared against the earlier NASA sample and matched.

The first interface passed six presentation tests and a JS syntax check. Browser checks at 1440×1000 and 390×844 exercised field dropdown and keyboard map selection, year/metric controls, soil depth, priority questions, expanded wheat chronology, source modal open/close, and the 31-source library. No horizontal overflow at 390 px and no browser warnings/errors were observed in those flows. The hosted Site deployment succeeded; its owner-private sign-in gate is expected for a browser without the owner's ChatGPT session.

These are **software/data consistency checks**, not agronomic validation. In particular:

- Passing tests did not discover the original raster origin error; PR #5's additional geospatial checks did. This is why the pending correction is prominent here.
- The initial integration inspected the NAIP image and checked all field vertices against the supplied boundary. It did not complete a new legal or full topology audit.
- Initial crop counts and soil extraction were reviewed through scripts/outputs/logs, not independently repeated end-to-end.
- The follow-up PR authors report additional tests and live checks. This guide does not claim to have rerun their entire suites or authenticated OpenET.
- No farmer-confirmed baseline, current irrigation record, local response model, or local expert approval exists in the integrated data.

For future browser changes, test at least default `fld01` incomplete soil coverage, different `fld02` history/ambiguity, missing ET, unknown baseline, source links/modal, calendar year order, keyboard selection, and a narrow screen. If new live data or scenarios are added, test failure, partial periods, empty/null values, no secret exposure, and no unintended persistence.

## 12. Git, publication, privacy, and handoff

Start a fresh task branch from the intended integrated base. Prefix branches `codex/` by convention. Use a unique descriptive suffix; the original `codex/agronomy`, `codex/fields-soils`, and `codex/weather-water` branches already represent completed initial deliveries.

```sh
git switch main
git pull --ff-only
git switch -c codex/your-specific-task
```

Keep your working tree clean before switching/merging; commit or stash your own work first. Do not overwrite another person's changes or force-push `main`. Stage specific files, inspect the diff, commit, push, and open a PR. The repository documents review conventions; do not assume branch protection enforces them. Each teammate should use their own Git identity and authorized GitHub access.

The integration environment's GitHub connector could read but returned a write-permission error, and terminal push authentication was not configured. This is an environment limitation, not proof that collaborators lack repository write permission. Some integration commits were uploaded/merged through the owner's signed-in GitHub session, then fetched and compared byte-for-byte against tested local commits. Prefer a normal authenticated Git push on your own machine; do not copy credentials or another user's identity from a chat.

### Public repository versus private preview

- Repository: https://github.com/kevindurantbr/kimchi — public at this review.
- Private Site: https://kimchi-field-notes.bingxuanuniversity.chatgpt.site — requires owner access; sharing the URL alone does not grant teammate access.
- Site project ID: `appgprj_6af95e718a74819187308be284025820`, stored in `interface/.openai/hosting.json`. Reuse it; do not create a duplicate for every update.
- First deployed Site source snapshot: `133cfa0365a45303646628a344560c952e159f4c` in the separate Sites source repository. This is **not a GitHub commit SHA**. The code/assets were packaged from the tested first interface; publication does not auto-update when GitHub changes.
- Rebuild, synchronize the exact source to the Site repository, save/deploy that version, and verify success for later website updates. Preserve the existing private audience unless explicitly changed. Hosting credentials stay in memory/stdin, not tracked files.

Ignore rules exclude `.env`/secret variants, key files, raw raster formats, `research/data/raw/`, the fields package's `raw/`, `openet_raw/`, `*.private.json`, caches, dependencies and generated `dist/`. An ignore rule does not remove a secret already committed; inspect diffs and output files. Keep farmer names, private ownership/account records, API keys, and actual private scenarios out of this public repository.

### What each handoff/PR should contain

State the problem and resulting behavior; exact base/head; changed paths and schema fields; primary-source references/locators; units, temporal/spatial support and missing-data behavior; commands and tests actually run; unresolved blockers; and the next integration action. Distinguish contributor-reported verification from independent reproduction. Explain whether outputs are observations, model estimates, supplied assumptions, or synthetic tests. Never describe an access route or fake-response test as a successful real retrieval.

## 13. Scientific and product guardrails

1. **No fake completeness.** Missing, null, partial, unverified, and unavailable are different states; none automatically means zero or favourable.
2. **No unsourced winner.** Do not turn priority selections, crop names, or qualitative literature into numerical rankings.
3. **ET is not pumping.** Actual ET can use rainfall, irrigation, storage and groundwater. Observed ET is not the counterfactual ET of a new rotation.
4. **Rain minus ET is partial accounting.** Storage changes, runoff, drainage, losses and definitions matter. It is not automatically gross irrigation requirement or saved withdrawals.
5. **Volume and capacity differ.** Seasonal allocation does not prove supply at critical stages. Preserve area, time period, efficiency, and phase allocation.
6. **Soil capacity is not state.** SSURGO AWS is not current moisture or nutrient availability. Preserve depth/units/coverage and component/map-unit aggregation.
7. **Classification is inference.** Crop fraction is not accuracy probability or farmer-confirmed history. Keep product resolution and uncertainty explicit.
8. **Geometry is approximate.** A pivot-looking field is not a legal parcel or documented current irrigation. LEMA section inclusion is not a water right or allocation.
9. **Chronology matters.** Wheat sowing can precede its harvest year; whole-field alternation differs from simultaneous phase-split acreage.
10. **No automatic ecological credits.** Corn, sorghum and wheat are all grasses. No automatic family break, nitrogen benefit, disease reduction, carbon gain or water saving follows from switching names.
11. **Residue and live cover differ.** Retained dead residue can protect soil; living cover consumes water. Do not automatically add a cover crop or transfer dryland magnitudes to an irrigated field.
12. **No unsupported thresholds.** Do not classify frost injury, crop stress, safe planting deadlines or plant-back compatibility from generic numbers without applicable evidence and field inputs.
13. **Research transfer is conditional.** Tribune/eastern Kansas/dryland studies, different irrigation treatments and historic budgets have explicit applicability limits. Five weather years are not a climate normal.
14. **Whole-cycle economics.** Following-corn yield alone is not rotation profit. Include all phases, years, costs, prices and transition/equipment implications before making a numerical economic claim.

## 14. Troubleshooting and unresolved decisions

| Symptom / decision | Correct next step |
| --- | --- |
| `interface/` missing after clone | Check whether the first-interface PR has merged; fetch/check out its branch if necessary. |
| Interface cannot load evidence | Serve `interface/dist/` over HTTP; rebuild; inspect schema/state mismatch and browser errors. No substitute data should appear. |
| Bundle stale/hash mismatch | Identify the changed authoritative input; review it, regenerate with `compare.py --build`, check/test, then rebuild the interface. |
| A new ET bundle is rejected | Expected on the first interface. Review/merge the coordinated ET schema and consumer path rather than removing checks. |
| “Live” data/scenario forms expected but absent | Those are follow-up branches, not first-interface behavior. Check merge and deployment versions separately. |
| OpenET 403 | Check authorized local credentials/account access. Do not fabricate values or place the token in client-side code. |
| GIS script cannot find inputs | Run from its package directory; obtain required raw files/dependencies; apply/review the per-year grid correction first. |
| A source request fails | Record service/status/date, preserve previous evidence, and distinguish “not retrieved” from “does not exist.” |
| Hosted preview asks for login | It is owner-private. Run locally for team development or have the owner explicitly change sharing. Do not silently broaden access. |
| Local Git push fails | Use your own authorized GitHub authentication. Do not assume browser sign-in automatically authenticates terminal Git. |
| Scientific facts differ between notes and branches | Use the version table, inspect the proposed correction and underlying evidence, and update all consumers/docs together after review. |

Still requiring an explicit project decision or evidence: final farming system/region; actual target user validation; confirmed baseline/continuation; whole-field versus phase-split expansion; acceptable locally validated calendar/model sources; access to real ET; future privacy/persistence requirements; whether to broaden Site sharing; original-code license; and official submission/deadline requirements.

## 15. Maintaining this guide

Update this file in the PR that changes scope, data schema, source status, defaults, permissions, or a major milestone. Keep snapshot counts and the branch/PR table accurate; remove “pending” only after the corresponding review/merge, and distinguish deployment from merge. When #5 lands, revise the crop-row/source counts, provenance status and UI caveats. When #6–#8 land, revise current behavior, run/test instructions and the ET contract together.

The project documentation hierarchy is: current executable contracts and sourced records for exact behavior/data; this guide for shared context and state; package READMEs/notes for methods and caveats; integration review for the original audit; numbered handoffs for task history. This hierarchy resolves stale project descriptions; it does not override new owner instructions or excuse unsupported scientific claims.
