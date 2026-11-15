# Kimchi

Shared repository: https://github.com/kevindurantbr/kimchi

NASA Space Apps 2026 research and prototype for comparing farm crop rotations using NASA environmental data, local soils, crop characteristics, and farmer priorities.

Working focus: irrigated farms in Sheridan 6, western Kansas. The three research contributions now power a tested comparison data layer and the first read-only field interface. Research candidates are not validated farm recommendations.

**Start here: [Project context and collaborator guide](PROJECT_CONTEXT.md).** It records scope, decisions, data contracts, reproduction commands, scientific limits, verification, and the active PR dependencies. Read it before choosing a new task.

**Pending scientific correction:** [PR #5](https://github.com/kevindurantbr/kimchi/pull/5) corrects the 2022–2023 CDL raster-grid origins and crop fractions. The current bundle still contains the original fractions. Review that correction before using them in presentations or further calculations. Recent-weather, scenario, and ET features are proposed separately in PRs #6–#8; they are not part of the first deployed interface.

## Explore the interface

[Interface source and local setup](interface/README.md) · [Private hosted preview](https://kimchi-field-notes.bingxuanuniversity.chatgpt.site)

Select a field, inspect regional NASA weather and soil/crop context, and compare sourced rotation tradeoffs. Unconfirmed baselines, approximate boundaries, missing ET, and unknown suitability remain visible. The hosted preview is owner-private; teammates can run the same code locally.

```sh
python3 interface/build.py
python3 -m http.server 8765 --bind 127.0.0.1 --directory interface/dist
```

Open http://127.0.0.1:8765/.

## Team starting points

| Workstream | Brief | Suggested branch |
| --- | --- | --- |
| Crop and rotation evidence | [Agronomy brief](research/01_agronomy_handoff.md) | `codex/agronomy` |
| Field history and soils | [Field data brief](research/02_fields_soils_handoff.md) | `codex/fields-soils` |
| Weather and evapotranspiration | [Water data brief](research/03_weather_water_handoff.md) | `codex/weather-water` |
| Product and integration | [Research overview](research/README.md) | `codex/integration` |

These are the original briefs and delivery branches, retained as task history. Check the [current work packages and PR dependencies](PROJECT_CONTEXT.md#8-follow-up-branches-and-integration-order) before starting: use a fresh task branch rather than reusing a completed delivery branch. The integration lead maintains shared scope and combines work through pull requests. See [CONTRIBUTING.md](CONTRIBUTING.md) for the collaboration workflow.

## Available data

`research/deliverables/` contains three approximate fields, 2021–2025 satellite crop classifications, SSURGO soil properties, 60 monthly NASA POWER weather summaries, three sourced rotation candidates, and 15 evidence rules. OpenET is unavailable; no numerical farm prediction is produced.

Start with the [integration review and next tasks](research/integration_review.md) and the [runnable prototype](prototype/README.md).

```sh
python3 prototype/compare.py --check
python3 -m unittest discover -s prototype -v
python3 prototype/compare.py --field fld01 --priority water
```

`prototype/demo_bundle.json` is the deterministic interface input, with source hashes and limitations. `research/data/` retains the original NASA access sample for comparison.

Python 3 with its standard library is sufficient to re-download the raw weather sample:

```sh
python3 research/fetch_weather.py
```

The script requires internet access and overwrites the raw sample and provenance files. It does not regenerate `weather_monthly.json`; update derived files explicitly if the data period or processing changes.

## Repository structure

```text
research/
  README.md                  Research findings and integration plan
  01_agronomy_handoff.md      Teammate 1 brief
  02_fields_soils_handoff.md  Teammate 2 brief
  03_weather_water_handoff.md Teammate 3 brief
  fetch_weather.py           NASA POWER retrieval
  data/                      Small, sourced data samples
```

Add completed work in `research/deliverables/agronomy/`, `research/deliverables/fields-soils/`, or `research/deliverables/weather-water/` so workstreams do not overwrite one another. Preserve the filenames and schemas specified in the briefs inside those folders.

## Data handling

Keep source URLs, units, dates, methods, and limitations alongside data. Use null for unknown values. Clearly identify synthetic examples. Do not commit API tokens, passwords, or private farm records. Large satellite files belong outside Git; commit retrieval scripts and source metadata instead.

Original project code has no open-source license selected yet. External datasets and referenced publications retain their own terms and attribution requirements.
