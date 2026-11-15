# Contribution review and next milestone

Review date: November 14–15, 2026. Working focus remains irrigated Sheridan 6 fields in western Kansas. This is an integration choice, not a confirmed final team scope or a farm recommendation.

## Decisions

Accept and integrate [weather PR #1](https://github.com/kevindurantbr/kimchi/pull/1), [agronomy PR #2](https://github.com/kevindurantbr/kimchi/pull/2), and [fields/soils PR #3](https://github.com/kevindurantbr/kimchi/pull/3), with the corrections below. All three provide usable evidence and distinguish uncertainty. Preserve each contributor's source package and authorship.

**Recommended first demo:** start with `fld01`, show the five corn-dominant classifications, then compare continuous corn, corn–grain sorghum, and corn–winter wheat. Ask the farmer to confirm the baseline and intended continuation. Keep the other two fields selectable to demonstrate different histories. Do not imply these are enrolled farms, named owners, verified irrigators, or consenting participants.

**Product focus:** explain what must be true for each rotation to work under limited irrigation. Show seasonal weather, soil storage, establishment timing, and operational tradeoffs. Defer automatic ranking and numerical savings until a validated response model and actual farm inputs exist. This is a stronger evidence-backed story than a score assembled from arbitrary weights.

## Review findings and disposition

| Finding | Action |
| --- | --- |
| ET adapter expected `geometry_status: documented/test`, while real field inputs carry `boundary_status: approximate`. | Accept the source property and preserve `approximate` through output. Tested on all three supplied field geometries. |
| ET parser could mistake a sole unrelated numeric column such as pixel count for ET, overwrite duplicate months, or accept infinity. | Require the requested variable or explicit `value`, validate months, reject duplicates and invalid numeric values. Keep missing observations null. |
| Forcing flat geometry could discard holes. Empty geometry was accepted. | Reject these cases; auto mode retains holes through GeoJSON. Full topology validation remains outside this standard-library adapter. |
| A partial calendar-month request could be labelled a complete monthly precipitation total. | Expect the full calendar month's days; incomplete monthly totals remain null. |
| `lema_membership: verified` relied on a historical order and an assumed unchanged current boundary. | Change to `historical_boundary_verified_current_unverified` in both data and extraction code. The [official SD-6 page](https://www.agriculture.ks.gov/divisions-programs/division-of-water-resources/managing-kansas-water-resources/local-enhanced-management-areas/sheridan-6-lema) lists the 2023–2027 order, but its full PDF returned HTTP 403 in this review. A search excerpt is insufficient to complete the legal-description check. No allocation is inferred. |
| The original handoff linked a Greater GMD4 renewal document. | Add a correction distinguishing it from Sheridan 6. |
| Monthly weather schema differs from the early access sample. | Adopt teammate schema (`days_observed`, `days_expected`, `source_ids`) and verify all 60 rain/temperature summaries match the original sample. |
| All fields use the same coarse NASA POWER point series. | Keep weather in one regional object, not three apparently independent field observations. |
| `fld01` AWS covers 92.8% of its area. | Preserve coverage and units. The remaining area is not zero storage or evidence of current standing water. |
| Crop fraction and classification confidence can be confused. | Preserve fractions and source ambiguity flags; require farmer confirmation for every inferred history. |
| Candidate sources use different trial treatments and overlapping reports. | Preserve treatment distinctions and avoid treating annual reports as independent replications. No universal yield uplift or economic ranking. |
| Current history does not establish a future baseline. | Keep baseline null for every field; continuous corn is a comparison candidate, even for `fld01`. |

The OpenET request fields were checked against the [official API reference](https://openet.gitbook.io/docs/reference/api-reference/raster). A successful authenticated response remains untested. No API key or synthetic ET was substituted. NASA remains central through regional seasonal weather, but this integration does not yet translate weather into validated crop-stage stress predictions.

## Delivered integration

- `prototype/compare.py`: deterministic bundle builder, cross-source validation, field-specific evidence, and qualitative constraint handling.
- `prototype/demo_bundle.json`: all three fields, 15 field-years of classified history, 18 soil rows, 60 weather months, three candidates, 15 evidence rules, and source metadata. Includes SHA-256 hashes of the five authoritative inputs.
- `prototype/test_compare.py`: regression tests covering absent data, incomplete soil coverage, source references, real-field adapter compatibility, malformed ET, priority changes, and a synthetic confirmed calendar failure.
- `prototype/README.md`: commands and consumer contract. There is no web interface yet.

Default candidates are conditional. A supplied confirmed conflict can exclude only the affected scheduled instance. Priorities change the questions shown first, not eligibility or invented performance scores. The system does not verify a caller's evidence automatically, and it does not yet implement every agronomy rule as a gate.

## Verification and limits

- Parsed the source JSON, checked unique source IDs/references, field IDs, complete 2021–2025 field/year coverage, rounded crop-share sums, soil units/coverage, weather dates, and wheat sowing-year chronology.
- Independently compared all 60 monthly precipitation/temperature values with the original NASA sample: identical.
- Ran the contributor's offline weather/ET selftest and the integration regression suite. Tests use fake ET responses only and label synthetic scheduling inputs explicitly.
- Inspected the supplied NAIP image: outlined approximate circles correspond to visible circular cropping patterns. This cannot prove current irrigation, ownership, or a surveyed boundary.
- Checked all supplied field vertices fall inside the supplied KU boundary with an independent point-in-polygon check. This is a limited geometry check, not a new legal or full GIS audit.
- Did **not** independently repeat the large CDL downloads, raster classification counts, or live SSURGO extraction. Reviewed scripts, metadata, outputs, and the extraction log. The extraction code hardcodes the documented 30 m raster grid; it needs per-file grid-tag validation before reuse on different downloads. Missing 2024–2025 state classification accuracy remains documented.
- Crop trials remain regional evidence, not local expert validation. No current farm irrigation, pumping, planting, market, herbicide, or cost records are available.

## Next work packages

These are proposed next tasks; they have not been sent to teammates or silently assigned.

| Work package | Concrete acceptance condition |
| --- | --- |
| Main integration: interface | Consume `demo_bundle.json`; field selector/map in center, regional weather and soil context left, three rotation comparisons right. Show missing ET and unconfirmed baseline. Display provenance beside claims. Read-only first; then add baseline confirmation and dated scenario inputs. |
| Agronomy follow-up | Validate a northwest-Kansas calendar for the corn-to-wheat handoff with primary sources or a qualified reviewer; identify transferable response functions with their inputs and validity domain. If none qualify, retain the qualitative fallback. |
| Fields/soils follow-up | Verify the full current SD-6 legal description; independently check all raster geotransforms/CRS and repeat one field-year extraction. Preserve field boundary uncertainty and missing-soil coverage. |
| Weather/water follow-up | Obtain OpenET access locally, run a short one-field request, verify the actual response schema and units, then retrieve 2021–2025 for all three fields. Record failures and missing months. Never put the key in Git or chat. |

The UI can proceed without ET. Numerical profit and withdrawal predictions cannot. The choice between whole-field alternation and concurrent phase-split acreage changes water-demand accounting; the first demo uses whole-field two-year sequences. Wheat is sown before its harvest calendar year. The registered event deadline and submission requirements still need confirmation before setting a final delivery schedule.
