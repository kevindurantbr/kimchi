# Kimchi: project context, data facts and guardrails

**Updated Nov 15, 2026, 6:00 pm Eastern.** The **current build plan is [PLAN.md](PLAN.md)**, and the teammate prompts are in [team/](team/). This file keeps only what is still needed:
- what was decided;
- the facts about the data we already have;
- the scientific guardrails;
- the Git workflow.

Earlier material (the original handoffs, the integration review, the first interface) remains in `research/` and `interface/` as history. The full previous version of this file is in Git history at commit `b6d0dde`.

## 1. Purpose and status

The challenge is "Field Shift: Adapting Farms with NASA Data" (NASA Space Apps 2026). Its objective: help farmers explore crop-rotation options that may improve soil health and strengthen resilience to changing weather and water conditions. Tools should compare at least three rotation strategies, including the existing one, and explain the why, evidence, benefits, gaps and risks. They should support, not replace, farmer judgement.

**Our product:** a map dashboard built on four factors:
1. Water balance
2. Temperature (extremes + accumulated heat)
3. Soil moisture
4. Crop condition

It covers live and historical NASA data, farmer-entered season records, top-3 actions ranked by a transparent score, rotation comparison and what-if, and a season report. See PLAN.md.

| Area | State at 6:00 pm Nov 15 |
|---|---|
| Agronomy evidence | Done: 21 sources and 15 rules for continuous corn, corn–sorghum and corn–winter wheat under limited irrigation (`research/deliverables/agronomy/`). |
| Demo fields + soils | Done: 3 approximate pivot fields (`fld01`–`fld03`), 2021–2025 crop history, SSURGO water storage (`research/deliverables/fields-soils/`). |
| NASA POWER weather | Done for 2021–2025 (`research/deliverables/weather-water/`). Tonight extends it to 1981–now plus live data. |
| New dashboard | **Being built tonight** in `dashboard/`, per PLAN.md. |
| First interface | `interface/` is a read-only evidence viewer, merged in PR #9 and kept for reference only. Its hosted preview is owner-private and is not the submission link. |
| Open PRs #5–#8 | Not merged. #5 corrects the 2022–2023 crop *fractions* (dominant crops are unchanged). #6–#8 (live weather, scenarios, ET path) are superseded by PLAN.md, so reuse ideas from them without merging tonight. |

## 2. Decisions

| Topic | Decision |
|---|---|
| Region | Irrigated western Kansas, Sheridan 6 (demo). Farmers can draw any field in the contiguous US. |
| Factors | Water balance, temperature, soil moisture, crop condition. Rotation is the decision they feed. |
| Recommendations | Top-3 **actions**, rule-based score = severity × priority × evidence × timing, with the breakdown shown. Rotations get fit metrics, never a "best" label. This replaces the earlier "no ranking at all" rule. |
| Farmer data | Kept in the browser's localStorage plus JSON export/import. No accounts, never committed. |
| Map slider | Region view: POWER grid by year, 1981–now. Field view: MODIS NDVI by 16-day period. |
| Live data | NASA POWER and USDA Soil Data Access, fetched from the browser (both allow CORS, checked Nov 15). POWER lags about 3 days. |
| Deferred | OpenET (needs a free account at account.etdata.org; the adapter exists in `research/deliverables/weather-water/t3_water_data.py`), GRACE-FO, SMAP, GPM IMERG, ECOSTRESS, PRISM, NLDAS and others. See PLAN.md §2. |
| Still unconfirmed | Deadline time zone; official submission requirements (P4 checks); no farmer or expert validation; no code license chosen. |

## 3. Data facts to keep straight

### Demo fields (`research/deliverables/fields-soils/fields.geojson`)

The fields are approximately 400 m-radius circles at PLSS quarter-section centres, in WGS84 with longitude first. They are **analysis areas, not surveyed boundaries**, and irrigation status is "likely".

| ID | Centre (lat, lon) | Area | Dominant crop 2021 → 2025 (CDL, 30 m) | Soil water storage 0–150 cm |
|---|---|---|---|---|
| `fld01` | 39.39758, −100.67829 | 50.2 ha | Corn → Corn → Corn → Corn → Corn | 30.78 cm (92.8% coverage; 7.2% "Water" map unit) |
| `fld02` | 39.39029, −100.66931 | 50.2 ha | Corn → Corn → Sorghum → Sorghum → Winter wheat | 31.29 cm |
| `fld03` | 39.41925, −100.69729 | 50.0 ha | Corn → Winter wheat → Winter wheat → Corn → Winter wheat | 29.92 cm |

Notes:
- **Crop history is satellite-inferred and needs farmer confirmation.** Don't quote the 2022–2023 crop *fractions* until PR #5 is reviewed.
- Soil water storage is in **cm of water**, cumulative from 0 to the stated depth. Don't add depths together. TAW in mm = cm × 10. It describes capacity, not current moisture.

### NASA POWER

- **Resolution:** about 0.5° × 0.625° (~50 km). All three demo fields share one cell, so present it as regional context.
- **Missing values:** the fill value is −999, which becomes null, never 0. Daily solar radiation starts in 1984.
- **Units:** precipitation `PRECTOTCORR` in mm/day, temperatures in °C.
- **Soil wetness:** `GWETROOT` and `GWETTOP` are **model-based** (MERRA-2) on a 0–1 scale, not satellite measurements.
- **History:** POWER daily data back to 1981 allows 1991–2020 normals and trends over at least 30 years. The 2021–2025 file alone is too short for trends.

### Other facts

- **Water use:** crop water demand (ET₀ × Kc) is an estimate. It is not metered pumping and not OpenET actual ET.
- **SD-6 LEMA:** being inside the designated area does not establish a water right, allocation, or current pumping.

## 4. Scientific and product guardrails

1. Missing, partial and unavailable are different from zero. Show them as such.
2. Rank **actions** only, by a visible score. Never label a rotation "best" or "optimal", and never output numeric yield or profit predictions.
3. ET is not pumping. Rain minus ET is partial accounting (storage, runoff and drainage are ignored).
4. Seasonal water volume is different from peak capacity. Check the well's mm/day against peak demand.
5. Soil capacity is not soil state.
6. A crop classification is an inference that the farmer confirms.
7. NDVI shows greenness, not cause, and low greenness is not the same as bare soil (residue looks similar).
8. Chronology matters: winter wheat is sown in autumn of year 1 and harvested in year 2.
9. There are no automatic ecological credits. Corn, sorghum and wheat are all grasses, so there is no automatic "family break" or nitrogen credit.
10. Cover crops can protect soil but also use water. Never add one automatically.
11. Use no thresholds without a source. Prefer percentiles against the field's own history.
12. Research transfer is conditional; the cited trials have geography and treatment limits.
13. Every recommendation ends with "check with your agronomist / K-State Research and Extension".
14. Label the demo farm data **synthetic**.

## 5. Git workflow tonight

- **Branches:** each person works on their own branch (`p1-data`, `p2-analysis`, `p3-dashboard`, `p4-recs`) and edits **only the files PLAN.md §7 assigns to them**. Push small and often.
- **Merging:** open a PR to `main`; the owner merges. Don't force-push `main`.
- **Secrets and private data:** never commit keys, `.env` files, or real farmer data. `.gitignore` already excludes `.env*`, `*.private.json` and raw rasters.
- **Pages:** the owner enables Settings → Pages → Source: GitHub Actions, for P3's workflow.
