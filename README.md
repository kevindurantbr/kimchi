# Kimchi

Shared repository: https://github.com/kevindurantbr/kimchi

NASA Space Apps 2026 research and prototype for comparing farm crop rotations using NASA environmental data, local soils, crop characteristics, and farmer priorities.

Working focus: irrigated farms in Sheridan 6, western Kansas. The three research contributions are integrated into a tested offline comparison data layer. The web interface is the next milestone. Research candidates are not validated farm recommendations.

## Team starting points

| Workstream | Brief | Suggested branch |
| --- | --- | --- |
| Crop and rotation evidence | [Agronomy brief](research/01_agronomy_handoff.md) | `codex/agronomy` |
| Field history and soils | [Field data brief](research/02_fields_soils_handoff.md) | `codex/fields-soils` |
| Weather and evapotranspiration | [Water data brief](research/03_weather_water_handoff.md) | `codex/weather-water` |
| Product and integration | [Research overview](research/README.md) | `codex/integration` |

Each brief is self-contained. The integration lead maintains the shared scope and combines work through pull requests. See [CONTRIBUTING.md](CONTRIBUTING.md) for the collaboration workflow.

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
