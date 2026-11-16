# Kimchi build plan: farm risk and rotation dashboard

**Written Nov 15, 2026, 5:45 pm Eastern. Submission deadline: Nov 15, 11:59 pm.** The time zone of the deadline was not confirmed. The checkpoints below assume Eastern time. If your event uses an earlier zone, move every checkpoint earlier by the difference.

> **Status update, 9:05 pm.** See §8 for progress against the timeline, the new round-3 timeline, and the new freeze at **10:00 pm**. §11 adds the **three detail levels** (Simple / Moderate / Complete), and §12 covers **data coverage and the risk from unused resources**. Each person's file in `team/` now starts with their **round 3** tasks. Live site: https://kevindurantbr.github.io/kimchi/

This file replaces the earlier "evidence viewer only" direction. Each teammate's AI prompt is in [`team/`](team/). Give your AI this file **and** your own prompt.

| Person | Prompt | Owns |
|---|---|---|
| 1 | [team/P1_data_backend.md](team/P1_data_backend.md) | Live NASA and USDA fetchers, precomputed history files, the farmer-data store |
| 2 | [team/P2_analysis_engine.md](team/P2_analysis_engine.md) | All calculations: the four factors, normals, recurrence, trends, rotation fit |
| 3 | [team/P3_dashboard.md](team/P3_dashboard.md) | The web app: map, time slider, left and right panels, farm-records screen, public URL |
| 4 | [team/P4_recommendations_submission.md](team/P4_recommendations_submission.md) | Crop and action libraries, top-3 recommendation scoring, season report, write-up and video |

---

## 1. What we are building and why

**Official challenge: "Field Shift: Adapting Farms with NASA Data."** The objective, quoted from the team's Google Doc:

> Combine NASA Earth observations with local agricultural information to create an app, model, interactive map, or other decision-support tool. The goal is to help farmers explore crop-rotation options that may improve soil health and strengthen resilience to changing weather and water conditions. [...] You may compare at least three rotation strategies, including the existing rotation. For each strategy, you may explain why it was suggested, what evidence supports it, what benefits it may offer, where information gaps exist, and any risks that would need local review. [...] The intended outcome is a supportive tool [...] that does not replace farmer judgment or local agricultural expertise.

**Our product, in one sentence:** a map-based dashboard where a farmer draws or selects their fields. It pulls live and historical NASA data for four factors and shows where each risk is, how severe it is, and how often it recurs. It combines that with the farmer's own season records and suggests the top 3 actions and rotation options, with evidence for each.

**Demo story:** an irrigated corn field in Sheridan 6, western Kansas. The farm sits on the declining Ogallala aquifer and has a limited water allocation. The farmer asks: *"With limited water and hotter summers, should I keep continuous corn, or switch to corn–sorghum or corn–wheat? What should I do this season?"*

## 2. Decisions already made (do not reopen tonight)

| Topic | Decision |
|---|---|
| Factors analysed | **1. Water balance. 2. Temperature (extremes + accumulated heat). 3. Soil moisture. 4. Crop condition.** Crop rotation is the *decision* these factors feed, not a factor. |
| Required output | Rotation comparison (current rotation plus at least 2 alternatives), plus a **what-if** mode where the farmer picks any sequence from the crop library. |
| Recommendations | **Top 3 actions, ranked by a visible rule-based score**: severity × farmer priority × evidence strength × timing. Every card shows its score breakdown, live and historical evidence, benefits, risks, information gaps, and "check with a local expert". There is **no machine-learning model** and no "best/optimal rotation" label. |
| Farmer data | Stored **in the farmer's browser** (localStorage) with **Export/Import as JSON**. There are no accounts and no server database, and farmer data never goes to GitHub. |
| Map time slider | **Two scales.** Region view: NASA POWER grid cells across western Kansas, animated **by year from 1981 to now**. Field view: MODIS satellite greenness (NDVI) pixels around the field, animated **by 16-day period**. |
| Fields | The farmer can **draw any field** in the contiguous US, and the 3 demo fields (`fld01`–`fld03`) are preloaded. |
| Live data | The browser calls NASA POWER and USDA Soil Data Access **directly**; both send `Access-Control-Allow-Origin: *`, checked Nov 15. Long history is precomputed to static JSON for speed and so the demo works offline. |
| Backend | Precompute scripts run in Node, and the app is static. There is no server to run tonight, and the static output counts as our "small backend". |
| Deferred | OpenET, GRACE-FO, SMAP, GPM IMERG, ECOSTRESS, PRISM, NLDAS, NAIP, SRTM, NWIS, AMS, QuickStats, GAEZ. List them in the write-up as next steps. OpenET needs only a free account (account.etdata.org/register); the adapter already exists in `research/deliverables/weather-water/`. |
| Language | Everything new is plain JavaScript ES modules (browser and Node 18+). No build step and no npm install for the app. |
| Hosting | GitHub Pages, deployed from `dashboard/` by a GitHub Actions workflow (Person 3). Fallback: Netlify Drop. The old ChatGPT Site stays private and is not the submission link. |

## 3. The four factors: what we compute and show

| Factor | Data (source → variable) | Computed indicators | Headline on the card |
|---|---|---|---|
| **Water balance** | POWER `PRECTOTCORR`, plus `T2M_MAX`, `T2M_MIN`, `RH2M`, `WS2M`, `ALLSKY_SFC_SW_DWN` for reference ET; farmer irrigation entries; SSURGO available water storage | FAO-56 reference ET (ET₀); crop demand = ET₀ × Kc; season rain minus crop demand; root-zone depletion bucket; peak demand vs well capacity | "Season deficit 212 mm: drier than 84% of seasons since 1991" |
| **Temperature** | POWER `T2M_MAX`, `T2M_MIN` | Growing degree days (GDD, 10/30 °C); hot days ≥ 35 °C; heat above 30 °C during the crop's sensitive window; last spring and first fall frost | "Hot days during pollination: 9 (normal 4). Happened in 11 of 45 years" |
| **Soil moisture** | POWER `GWETROOT`, `GWETTOP` (model-based 0–1 wetness, MERRA-2) + the bucket model + SSURGO capacity | Percentile vs same date 1991–2020; days below the 25th percentile | "Root zone drier than 90% of mid-July dates" |
| **Crop condition** | MODIS MOD13Q1 NDVI, 250 m, 16-day (ORNL DAAC web service) | NDVI vs this field's 2001–2025 median for the same period; months with low greenness (green-cover calendar) | "Greenness 18% below normal for late July" |

For **every** factor, the dashboard answers the farmer's four questions:
- **Now:** status vs normal, as a percentile.
- **Where:** field view or region view.
- **How often and when:** recurrence by month or season over 1981–now.
- **Getting worse or better:** a trend (Mann-Kendall test with Sen's slope), shown only when the record is at least 30 years.

## 4. Data workflow: public data + private farm data → dashboard

```mermaid
flowchart LR
  subgraph PUBLIC["PUBLIC DATA (pulled by our code)"]
    direction TB
    P1["NASA POWER daily API<br/>live, ~3-day lag<br/>temp, rain, humidity, wind, sun, soil wetness<br/>1981 to now"]
    P2["MODIS NDVI (ORNL DAAC)<br/>250 m, 16-day, 2000 to now"]
    P3["USDA SSURGO (Soil Data Access)<br/>water-holding capacity, drainage"]
    P4["USDA CDL crop history<br/>(demo fields, already in repo)"]
  end

  subgraph PRIVATE["PRIVATE FARM DATA (stays in the farmer's browser)"]
    direction TB
    F1["Field boundary<br/>(drawn on map)"]
    F2["Season records: crop, planting date,<br/>irrigation applied, nitrogen, yield"]
    F3["Constraints: well capacity,<br/>water allocation, equipment, markets"]
    F4["Priorities slider:<br/>save water / protect soil / income"]
  end

  subgraph PREP["DATA LAYER (Person 1)"]
    S1["sources.mjs<br/>live fetch + clean (-999 → null)"]
    S2["precompute.mjs<br/>history, normals, region grid → static JSON"]
    S3["farmStore.mjs<br/>localStorage + export/import JSON"]
  end

  subgraph ENGINE["ANALYSIS ENGINE (Person 2, runs in browser)"]
    A1["4 factor indicators"]
    A2["Normals, percentiles,<br/>recurrence, trend"]
    A3["Factor interactions:<br/>compound stress, cause check"]
    A4["Rotation fit for any sequence"]
  end

  subgraph REC["DECISION SUPPORT (Person 4)"]
    R1["Score = severity × priority<br/>× evidence × timing"]
    R2["Top 3 actions + rotation cards<br/>+ season/quarter report"]
  end

  subgraph UI["DASHBOARD (Person 3)"]
    U1["Center: map + time slider<br/>(region by year / field by 16 days)"]
    U2["Left panel: factor cards<br/>+ charts + tables"]
    U3["Right panel: top 3 actions,<br/>rotation what-if, report"]
    U4["My farm records:<br/>entry form + trends"]
  end

  P1 --> S1 & S2
  P2 --> S2
  P3 --> S1 & S2
  P4 --> S2
  F1 & F2 & F3 & F4 --> S3
  S1 & S2 --> A1
  S3 --> A1
  A1 --> A2 --> A3 --> A4
  A1 & A2 & A3 & A4 --> R1 --> R2
  A1 & A2 --> U1 & U2
  A3 --> U2
  R2 --> U3
  S3 <--> U4
```

**What happens when a farmer opens the app:**

```mermaid
sequenceDiagram
  participant B as Browser (dashboard)
  participant S as Static JSON (precomputed)
  participant N as NASA POWER (live)
  participant L as localStorage (farm records)
  B->>S: load region_grid, demo fields, history, NDVI, crops, actions
  B->>L: load farm records (or the demo farm)
  B->>N: fetch Jan 1 this year → today for the field centre
  N-->>B: daily values (last ~3 days are -999 → treated as missing)
  B->>B: analysis: 4 factors vs 1991–2020 normals, recurrence, trend
  B->>B: recommend: score actions, top 3, rotation fit
  B-->>B: render map, cards, charts, recommendations
  Note over B,N: If POWER fails, show the precomputed history with a "live data unavailable" banner. Never invent values.
```

The privacy rule is visible in the UI: "Your farm records are stored only in this browser. Export to keep a copy."

## 5. How the factors influence each other, and how the dashboard shows it

The factors are linked, and the linked insights are the strongest part of the product.

```mermaid
flowchart LR
  T["Temperature<br/>(hot days, GDD)"] -->|"hotter, drier air<br/>raises ET₀"| W["Water balance<br/>(rain + irrigation − crop demand)"]
  T -->|"GDD sets the crop stage,<br/>i.e. WHEN the crop is sensitive"| C["Crop condition<br/>(NDVI)"]
  W -->|"deficit drains"| M["Soil moisture"]
  M -->|"dry soil heats faster"| T
  M -->|"1–3 week lag"| C
  SOIL["Soil water-holding capacity<br/>(SSURGO)"] -->|"how fast a deficit<br/>becomes stress"| M
  ROT["Rotation choice"] -->|"shifts WHEN demand happens<br/>(wheat: spring, corn/sorghum: summer)"| W
  ROT -->|"green-cover and<br/>bare months"| C
  FARM["Farmer irrigation<br/>+ well capacity"] -->|"adds supply,<br/>limits peak"| W
```

| Interaction | Insight it creates | How the dashboard shows it | Owner |
|---|---|---|---|
| Heat × crop stage | A hot week matters most when it coincides with corn pollination (silking at roughly 750–800 °C·days after planting, ≈ 1,350–1,450 °F GDD; the exact value per hybrid is in `crops.json`) | **Stage-aligned heat strip:** the season timeline with crop stages shaded, hot days marked, and the sensitive window highlighted | P2 computes, P3 draws |
| Heat × dry soil | **Compound stress**: hot days while the root zone is below the 25th percentile are the most damaging | **Compound-stress calendar:** month × year heatmap, colour = number of stressors active (0–3) | P2, P3 |
| Temperature → water demand | A hot, windy, dry month raises crop water demand even with normal rain | **Supply vs demand chart:** stacked rain + irrigation bars vs a crop demand line, with the gap shaded | P2, P3 |
| Peak demand vs well capacity | Season totals can look fine while the well cannot keep up in July | **Capacity gauge:** peak 7-day demand (mm/day) vs well capacity converted to mm/day from gpm and acres | P2, P3 |
| Greenness drop × water/heat | Greenness alone does not show *why* a crop is stressed | **Cause-check grid:** low NDVI + dry + hot → "likely water/heat"; low NDVI + normal water and heat → "not explained by weather: scout for pests, nutrients, or hail" | P2, P4 |
| Rotation × rain timing | Wheat uses spring water and frees summer; corn and sorghum compete for July–August water | **Demand calendar per rotation:** monthly crop demand over two years vs median rain | P2, P3 |
| Soil capacity × deficit | Low-storage soils hit stress sooner | Depletion bucket line with the "stress starts" threshold (FAO-56 p = 0.55 for maize) | P2 |
| Farm records × conditions | "Your yield dropped in the years with the most July hot days" | **Scatter** of yield vs hot days (or season deficit) for the farmer's own years, with the label "n years: pattern, not proof" | P2, P3 |

## 6. Dashboard layout (from the team's Google Doc)

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ Kimchi  [Field ▾] [Water | Temperature | Soil moisture | Crop condition]       │
│         [Field view | Region view]   [My farm records]   [Season report]       │
├───────────────┬──────────────────────────────────────────────┬─────────────────┤
│ LEFT (toggle) │                 MAP (center)                 │ RIGHT (toggle)  │
│ 4 factor cards│ satellite basemap, fields, drawn boundaries  │ Top 3 actions   │
│ status/normal │ region grid OR NDVI pixels for selected time │ (score + why)   │
│ charts:       │                                              │ Rotation cards: │
│  - this year  │ ◀ ▶ ═══════●══════════ 1981 … 2026  ▶ play   │ current + 2 alt │
│    vs normal  │                                              │ + what-if picker│
│  - recurrence │ legend: drier ◼◼◼◼◼ wetter                   │ evidence, gaps, │
│  - trend      │                                              │ risks, "check   │
│ [Advanced ▸]  │                                              │ with local      │
│ tables, method│                                              │ expert"         │
└───────────────┴──────────────────────────────────────────────┴─────────────────┘
```

There are three depth levels: glance (cards + map), explore (charts + slider), advanced (exact tables, formulas, sources, CSV download).

## 7. Shared contracts (everyone codes against these)

All new code lives in `dashboard/`. **Each file has exactly one owner**, which prevents merge conflicts.

```
dashboard/
  index.html  app.js  styles.css  ui/*.mjs                ← P3
  lib/sources.mjs  lib/farmStore.mjs                      ← P1
  lib/analysis.mjs  lib/analysis.test.mjs                 ← P2
  lib/recommend.mjs  lib/recommend.test.mjs  lib/report.mjs ← P4
  data/region_grid.json  data/site_history.json           ← P1
  data/fields_ndvi.json  data/demo_fields.geojson         ← P1
  data/demo_farm.json  data/sources.json                  ← P1
  data/crops.json  data/actions.json                      ← P4
scripts/precompute.mjs                                     ← P1
.github/workflows/pages.yml                               ← P3
submission/                                               ← P4
```

### 7.1 Data files (P1 writes; P2, P3 and P4 read)

Null means missing. Never use 0 for missing. Every file has a top-level `"generated_at"` (ISO time) and `"source_ids": [...]` that resolve in `data/sources.json`.

```jsonc
// data/site_history.json — one entry per POWER location (demo: one cell covers all 3 fields)
{ "generated_at": "...", "source_ids": ["NASA_POWER_DAILY"],
  "sites": [{ "site_id": "power_39.40_-100.68", "lat": 39.3976, "lon": -100.6783,
    "start": "1981-01-01", "end": "2026-11-12",
    "daily": { "date": ["1981-01-01", "..."],            // ISO dates, equal-length arrays
               "t2m_max": [..], "t2m_min": [..], "prectotcorr": [..], "rh2m": [..],
               "ws2m": [..], "allsky_sw_dwn": [..], "gwetroot": [..], "gwettop": [..] } }] }

// data/region_grid.json — annual indicators per POWER cell for the region slider
{ "generated_at": "...", "source_ids": ["NASA_POWER_DAILY"], "bbox": [-102.0, 38.5, -99.0, 40.5],
  "cell_size_deg": [0.625, 0.5], "years": [1981, "...", 2025],
  "indicators": {                       // name -> {unit, label}
    "season_precip_mm": {"unit": "mm", "label": "May–Sep rain"},
    "season_deficit_mm": {"unit": "mm", "label": "May–Sep rain minus corn demand"},
    "hot_days_35c": {"unit": "days", "label": "Days ≥ 35 °C (Jun–Aug)"},
    "gdd_may_sep": {"unit": "°C·day", "label": "Growing degree days May–Sep"},
    "gwetroot_jul": {"unit": "0–1", "label": "July root-zone wetness"} },
  "cells": [{ "cell_id": "c_39.25_-100.625", "polygon": [[lon,lat], ...],
              "values": { "hot_days_35c": [3, 5, null, ...] } }] }   // aligned with years

// data/fields_ndvi.json — MODIS NDVI pixels around each demo field
{ "generated_at": "...", "source_ids": ["MODIS_MOD13Q1_ORNL"],
  "fields": [{ "field_id": "fld01", "pixel_size_m": 231.66, "nrows": 9, "ncols": 9,
    "pixel_polygons": [[[lon,lat], ...]],            // nrows*ncols, row-major
    "dates": ["2001-01-01", "..."],
    "field_mean": [0.21, null, ...],                 // mean of pixels whose centre is inside the field
    "pixels": [[0.2, 0.22, ...], ...] }] }           // one array per date, scaled 0–1, null = bad QA

// data/demo_fields.geojson — fld01..fld03 copied from research/deliverables/fields-soils/fields.geojson
//   plus properties: area_ha, soil {aws_0_150_cm, aws_coverage, drainage, hydgrp}, crop_history [{year, crop}]
```

### 7.2 Farm records (P1's `farmStore.mjs`; P3's form; P2/P4 read)

```jsonc
{ "schema": "kimchi.farm.1", "farm_name": "Demo farm (synthetic)", "synthetic": true,
  "priorities": { "water": 0.5, "soil": 0.3, "income": 0.2 },   // sums to 1
  "constraints": { "annual_allocation_mm": 280, "equipment": ["pivot", "no-till drill"], "markets": ["corn", "sorghum", "wheat"] },
  "fields": [{ "field_id": "fld01", "name": "North pivot", "geometry": { /* GeoJSON Polygon */ },
    "area_ha": 50.2, "well_capacity_gpm": 600,
    "records": [{ "year": 2025, "period": "season",  // "season" | "Q1".."Q4"
      "crop": "corn", "planting_date": "2025-04-28", "harvest_date": "2025-10-10",
      "irrigation_mm": 330, "nitrogen_kg_ha": 200, "yield": 210, "yield_unit": "bu/ac", "notes": "" }] }] }
```

API: `loadFarm()`, `saveFarm(farm)`, `exportFarm(farm) → Blob`, `importFarm(file) → Promise<farm>` (validates the schema), `upsertRecord(farm, field_id, record)`, `loadDemoFarm()`. localStorage key: `kimchi.farm.v1`.

### 7.3 Analysis output (P2's `analysis.mjs`; P3 and P4 read)

`analyzeField({ daily, liveDaily, ndvi, soil, farmField, crops, rotation, today })` returns:

```jsonc
{ "factors": {
    "water":       { "status": {...}, "series": {...}, "recurrence": {...}, "trend": {...} },
    "temperature": { ... }, "soil_moisture": { ... }, "crop_condition": { ... } },
  "interactions": { "compound_calendar": {...}, "cause_check": {...}, "capacity": {...}, "stage_heat": {...} },
  "rotation_fit": [ /* one per rotation evaluated */ ],
  "data_quality": { "live_through": "2026-11-12", "missing_days": 3, "notes": [...] } }
```

Each `status` = `{ value, unit, normal_median, percentile, direction: "adverse"|"favourable"|"normal", severity: 0..1, label, source_ids }`. The exact shapes are in P2's prompt. P2 commits `dashboard/lib/fixtures/analysis_sample.json` **in the first hour** so P3 and P4 can build before the real engine is ready.

### 7.4 Recommendation output (P4's `recommend.mjs`; P3 renders)

`recommend({ analysis, farm, field_id, crops, actions, focus? }) → { top3: [card], all: [card], rotations: [rotationCard] }`

`card = { id, title, category, score, score_parts: {severity, priority, evidence, timing}, why: [text], evidence: [{text, value, source_ids}], benefits, risks, gaps, expert_check, when }`

## 8. Timeline (Eastern time)

| Time | Checkpoint (everyone pushes to their branch; the owner merges to `main`) |
|---|---|
| **6:00 pm** | Everyone has read PLAN.md and their prompt, and created a branch `p1-data`, `p2-analysis`, `p3-dashboard` or `p4-recs`. |
| **6:45 pm** | **Fixtures:** P1 commits a small real `site_history.json` (demo site); P2 commits `analysis_sample.json`; P4 commits draft `crops.json` and `actions.json`; P3 has the map and panels rendering fixtures. |
| **8:00 pm** | **Real data + engine:** all P1 data files are real; P2's `analyzeField` passes its tests; P4's `recommend` returns top 3; P3 shows the factor cards and slider. **First merge to `main`.** |
| **9:00 pm** | **Integrated:** live POWER fetch, farm records, drawing a field, recommendations, report. Deployed to the public URL. |
| **9:30 pm** | **Feature freeze.** After this, only bug fixes and text changes. P4 records the video using the live URL. |
| **10:45 pm** | Video, write-up and screenshots done. Final QA on desktop and phone. |
| **11:15 pm** | **Submit.** The 45 minutes after that are buffer for upload problems. |

### Progress against this timeline (checked 9:00 pm)

| Checkpoint | Planned | Actual | Status |
|---|---|---|---|
| Branches + prompts read | 6:00 | ~6:00 | ✅ |
| Fixtures (P1 site history, P2 sample, P4 libraries, P3 skeleton) | 6:45 | 6:01–6:13 | ✅ early |
| Real data + engine + first merge to `main` | 8:00 | 7:01 (PRs #10–#14) | ✅ early |
| Deployed to a public URL | 9:00 | ~7:10 (PR #15, Pages) | ✅ |
| Round 2, P1: 2026 demo season, NDVI gap-fill tool, POWER refresh, DATA.md | 8:15 | 8:36 (PR #18) | ✅, but **the gap fill was not run**: Jul–Nov 2025 NDVI is still missing |
| Round 2, P3: faster load, live cards, number format | 8:45 | 7:19 (PRs #16, #17) | ✅ |
| Round 2, P3: remove sample-data fallback, slider, error messages | QA review | not started | ❌ |
| Round 2, P2: fallback, as-of dates, heat metric, **direction-aware labels** | 8:15 | **no PR** | ❌ the live site still says "Drier than 5% of years" for a wetter-than-normal soil |
| Round 2, P4: recommendations on real analysis, card text | 8:30 | PR #20 open, **not merged** | ⚠️ |
| Submission: write-up and video | 9:30–11:15 | draft only | ⏳ |
| Bug found by the owner: collapsing the left panel makes the map disappear | n/a | open | ❌ (fix in P3 round 3) |

### Round-3 timeline (replaces the 9:30 freeze)

| Time | Checkpoint |
|---|---|
| **9:05 pm** | Everyone reads their round-3 block at the top of their `team/` file. P3 merges PR #20 now. |
| **9:45 pm** | All round-3 code PRs open; P3 merges them as they pass `node --test dashboard/lib/*.test.mjs`. |
| **10:00 pm** | **Feature freeze.** Only bug fixes and text changes after this. |
| **10:00–10:45 pm** | P4 records the video from the live site in **Simple** view; P1–P3 do QA on desktop and phone. |
| **11:00 pm** | Write-up final, with the live URL, DATA.md, ANALYSIS.md and the data-coverage statement (§12). |
| **11:15 pm** | **Submit.** The time after that is buffer. |

If something is late at 8:00 pm, cut scope in this order: the HLS stretch goal, then drawing new fields (keep the demo fields), then the region grid (keep a single-site chart), then the season report. **Never cut** the four factor cards, the rotation comparison, or the top-3 actions.

## 9. Guardrails (they keep the claims honest, and judges notice them)

1. Missing data stays missing (null, shown as "unavailable"), never 0.
2. POWER is about 50 km per cell, so it is regional context, not a field measurement. Say so on the map.
3. Root-zone wetness from POWER is **model-based** (MERRA-2 reanalysis), not a satellite measurement.
4. Our estimated crop water demand is ET₀ × Kc. It is not metered pumping and not OpenET.
5. NDVI shows greenness, not cause. Low greenness can be water, heat, pests, nutrients or hail.
6. Trends are shown only with at least 30 years of data. Recurrence is stated as "X of N years".
7. Top-3 ranking applies to **actions**, with the score shown. Rotations get fit indicators, never "best".
8. No numeric yield or profit predictions. The farmer's own yields are shown as their records.
9. Every recommendation ends with "Check with your agronomist / K-State Extension before acting."
10. The demo farm is labelled **synthetic**. Real farmer data never goes in the repo.

## 10. What already exists and is reused

- `research/deliverables/agronomy/agronomy.json`: 21 sources and 15 rules on corn–corn, corn–sorghum and corn–wheat under limited irrigation. P4 builds actions and rotation text from these.
- `research/deliverables/fields-soils/`: 3 demo field outlines, 2021–2025 crop history, and SSURGO water storage.
- `research/deliverables/weather-water/`: POWER retrieval code and the 2021–2025 weather, with methods to reuse.
- `interface/` and `prototype/`: the first read-only viewer and comparison layer. **Leave them untouched tonight**; the new app is in `dashboard/`.
- PR #5's crop-fraction correction does not change the dominant crop per year, which is all the new app uses. Open PRs #6–#8 are superseded by this plan; take ideas from them, but do not merge them tonight.

## 11. Three detail levels: Simple / Moderate / Complete (added 9:05 pm)

A segmented control in the top bar reads **View: [Simple] [Moderate] [Complete]**. It defaults to **Simple** and the choice is remembered in localStorage, wrapped in try/catch. The farmer can see every number at Complete, but never has to.

| Area | **Simple** (default; for any farmer) | **Moderate** (wants the reasons) | **Complete** (agronomist / judge: everything) |
|---|---|---|---|
| Top bar | Field picker, view level, My farm records, Season report | + factor tabs, Field/Region view | + data-source strip, UTC clock, theme |
| Factor tiles | 4 tiles: icon, **status word** (Good / Normal / Watch / Concern / No new data), **one plain sentence**, and "happens about N years in 10". °F and inches next to °C and mm | + value with unit, the normal value, "as of" date | + percentile bar p0–p100, p-value, recurrence detail |
| Charts | None. The map and tiles tell the story | **One** chart per factor: this season vs the normal band | All charts: bucket, capacity gauge, frost dates, compound calendar, cause check, trend + Mann-Kendall |
| Map + slider | Field outline coloured by status; slider "Play 1981 → 2026" with a one-line caption per year | + Region view and NDVI pixels | + raw/percentile toggle, legend detail |
| Top 3 actions | Title + one sentence + "Ask your agronomist" | + Why (values) + benefits / risks / gaps | + score and its 4 parts, evidence chips with source IDs |
| Rotations | **One comparison table**: current + 2 alternatives × (short on water X of N, heat at pollination X of N, months with low green cover, main benefit, main risk) | + per-rotation cards (why suggested, evidence, gaps) + what-if builder | + every `rotationFit` metric and notes |
| Your farm | "This season: corn · irrigation 255 of 280 mm used" + yield sparkline + **Add this season** | + records table, trends | + yield vs heat scatter, export/import details |
| Data limits | One footer line: "Weather is regional (~50 km). Estimates, not meters. Check locally." | + data-quality notes | + Advanced: exact values, sources, CSV |

How to build it: `body` gets the class `level-1`, `level-2` or `level-3`. UI elements carry `data-min-level="2"` or `"3"`, and CSS hides any element whose `data-min-level` is above the current level. Internal codes (F-01, W-1, D-01, Q-00) only appear at `level-3`. Plain sentences come from P2's `status.plain`, and the short recommendation text comes from P4's `card.short`.

**The challenge requires these, so they stay visible at Simple:**
- the rotation comparison (current + 2 alternatives);
- one benefit and one risk per rotation;
- the green-cover / bare months;
- the farmer's inputs;
- the expert-check line;
- the data-limits line.

## 12. Data coverage: what we use vs the Resources tab, and the risk (added 9:05 pm)

| Used tonight | What for |
|---|---|
| **NASA POWER** (live + 1981–now history + 25-cell grid) | Temperature, heat, frost, rain, reference ET, model soil wetness |
| **NASA MODIS MOD13Q1 NDVI** (250 m, 2001–now) | Crop condition, green-cover months, field pixel map |
| **USDA SSURGO** (live for drawn fields) | Soil water-holding capacity for the water bucket |
| **USDA CDL** (2021–2025, demo fields) | Current-rotation suggestion, which the farmer confirms |
| K-State / USDA agronomy sources, FAO-56 | Crop parameters, actions, rotation evidence |

So we are **not only using POWER**: there are 2 NASA products and 2 USDA products. But we use 2 of the roughly 9 NASA datasets the challenge names. What we miss, and how much it matters:

| Not used | What it would add | Risk of missing it | Plan |
|---|---|---|---|
| **SMAP** soil moisture (9 km, satellite-observed) | Observed soil moisture instead of POWER's model value. The challenge lists it first | **Medium-high**: judges may ask "where is SMAP?", and our soil-moisture factor is model-only | Write-up: name it as the first next step (needs an Earthdata login). Label POWER soil wetness as "model" everywhere |
| **Observed ET**: MODIS MOD16 / OpenET / ECOSTRESS | Measured crop water use to check our modelled demand (ET₀ × Kc) | **Medium-high**: our water balance has no observed ET | **MOD16 monthly ET for fld01–03 (2021–2025) already exists on branch `codex/et-pathway` (PR #8, no key, from ORNL).** P1 round 3 adds it as a comparison line at Complete level if done by 9:45; otherwise it's the first item in next steps. OpenET needs only a free account |
| **GPM IMERG** rain (10 km, hours) | Finer, faster rain and storm extremes (erosion) | Medium | Next step |
| **Landsat / HLS / Sentinel-2** (10–30 m) | Within-field zones (MODIS gives about 8 pixels per field) | Medium for visuals; low for decisions | Next step |
| **SRTM** elevation | Slope, runoff and erosion zones | Low-medium (erosion isn't one of our 4 factors) | Next step |
| **GRACE / GRACE-FO** + **NWIS wells** | Aquifer decline context (the Ogallala story) | Low for decisions, good for the story | Mention in the write-up; next step |
| **PRISM / NLDAS / GLDAS / ERA5** | Finer or alternative weather | Low (POWER covers the need) | Not needed |
| **NASS QuickStats / AMS Market News** | County yields and prices for the "income" priority | Medium for the income priority | Next step: the income priority currently has no data, so say so |
| NAIP, NLCD, LANDFIRE, GEDI, GAEZ, CoCoRaHS, Ag Data Commons | Context or validation | Low | Listed as deferred in DATA.md |

**Bottom line:** the decisions we support (the 4 factors → actions and rotation fit) are covered by real, verified data. The risks are (1) **judging on breadth of NASA data use**, and (2) **soil moisture and ET being modelled, not observed**. Mitigation tonight: honest labels, MOD16 if it lands by 9:45, and a clear "next datasets" section in the write-up. Don't start SMAP tonight, because the Earthdata login plus processing is too risky in under an hour.
