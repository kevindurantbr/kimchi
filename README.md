# Kimchi

NASA Space Apps 2026: **Field Shift: Adapting Farms with NASA Data.**

Kimchi is a map-based dashboard for farmers. It pulls live and historical NASA data for four factors: **water balance, temperature (extremes + accumulated heat), soil moisture and crop condition**. For each one it shows:
- where the risk is and how severe it is now;
- how often it recurs, and in which season;
- whether it is getting worse.

It combines this with the farmer's own season records (water, fertilizer, yield) to suggest the **top 3 actions** and compare **crop rotations** (the current rotation + alternatives + what-if), with the evidence for each. The tool supports farmer judgement; it does not replace it.

Demo region: irrigated fields in Sheridan 6, western Kansas (Ogallala aquifer, limited water allocation). Farmers can also draw their own fields.

## Start here

| If you are… | Read |
|---|---|
| Anyone on the team | **[PLAN.md](PLAN.md)**: scope, decisions, data workflow, factor interactions, contracts, timeline |
| Person 1: data backend | [team/P1_data_backend.md](team/P1_data_backend.md) |
| Person 2: analysis engine | [team/P2_analysis_engine.md](team/P2_analysis_engine.md) |
| Person 3: dashboard | [team/P3_dashboard.md](team/P3_dashboard.md) |
| Person 4: recommendations + submission | [team/P4_recommendations_submission.md](team/P4_recommendations_submission.md) |
| Looking for data facts and guardrails | [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) |

## Repository layout

```text
PLAN.md                 the build plan (current)
team/                   one AI prompt per teammate
dashboard/              the new app (being built tonight; static, deploys to GitHub Pages)
scripts/                data precompute scripts for dashboard/data/
research/deliverables/  sourced research: agronomy evidence, demo fields + soils, NASA POWER weather
interface/, prototype/  first read-only viewer and comparison layer (kept for reference, not extended)
submission/             write-up, video script, screenshots
```

## Run the dashboard locally

```bash
python3 -m http.server 8080 --directory dashboard
```

Then open http://localhost:8080. No install is needed. The app calls NASA POWER and USDA Soil Data Access from the browser.

## Data handling

- Missing values are `null`, never zero.
- Every data file carries its source ids and retrieval date.
- Farmer records stay in the farmer's browser (export/import as JSON) and are never committed.
- Do not commit API keys.
- Original code has no open-source license selected yet; external datasets keep their own terms.
