# Prompt for Person 2: analysis engine (four factors, normals, recurrence, trends, interactions, rotation fit)

> Copy everything below this line into your AI assistant, together with the repository's `PLAN.md`.

---

## ▶ ROUND 3: start here (9:05 pm → 9:45 pm PR; freeze 10:00 pm)

Read PLAN.md §8 (status) and §11 (detail levels). Your round-2 PR never arrived, and the live site still has the wrong-direction labels, so tasks 1–2 come first. Branch from the latest `main`: `p2-round3`. Small PR by 9:30, a second one by 9:45 if needed.

1. **(by 9:20) Direction-aware labels.** These are live on the site now and alarm farmers.
   - Soil moisture at p95 must read "**Wetter than 95% of years** for this date", not "Drier than 5%". Water balance at p72 must read "Wetter than 72%".
   - Use "Drier than X%" only below the median, and the same for "More / Fewer hot days than X%".
   - Fix the recurrence wording: "Since 1991: 35 of 45 years" is wrong, because the series starts in 1981. Make it e.g. "In 35 of 45 years (1981–2025)", and say what was counted.
   - Add tests.
2. **(by 9:30) `status.plain` for the Simple view** (PLAN.md §11). Add to every status:
   ```js
   plain: { word: "Good"|"Normal"|"Watch"|"Concern"|"No new data",
            sentence: "Root zone is 45% full; usually 39% in mid-November.",
            freq: "This happens about 1 year in 10." }
   ```
   - `word` comes from severity and direction: favourable → Good; |pct−50| ≤ 25 → Normal; severity up to 0.5 → Watch; above 0.5 → Concern.
   - Each `sentence` is one plain line with units, and adds °F or inches in brackets for temperature and water: "38 days above 35 °C (95 °F); normal is 27."
   - No percentiles, codes or jargon.
3. **(by 9:40) Annual series for the field-view slider** (QA review §4a). Add `analysis.annual = { years: [1981..2026], water_deficit_mm: [...], hot_days: [...], gwetroot_jul: [...], caption: [...] }`.
   - Compute it with the same crop calendar as the current season.
   - `caption[i]` is one sentence, e.g. "2012: 49 hot days, the most since 1981".
   - P3 animates the field colour and caption with it.
4. **(by 9:45) The remaining round-2 items, if any time is left.**
   - As-of dates (a status uses the latest value ≤ 7 days old for soil and ≤ 32 days old for NDVI, and carries `as_of`).
   - `sensitive_heat_above_normal_years`, with `interactions.stage_heat.recurrence` as P4 expects.

   If you run out of time, list them in your PR as known gaps; P4 will word around them.
5. **(10:00–11:00)** Proofread `dashboard/lib/ANALYSIS.md` as the methods appendix for the write-up, then do QA on Moderate and Complete views.

---


You are helping build **Kimchi**, a NASA Space Apps 2026 project for the "Field Shift: Adapting Farms with NASA Data" challenge. Repository: https://github.com/kevindurantbr/kimchi. **Read `PLAN.md` first**; it is the source of truth for scope, contracts and the timeline. The deadline is **tonight, Nov 15, 11:59 pm Eastern**.

## Your role

You turn raw daily data into the numbers the farmer sees. Everything is **pure functions** in one ES module that runs in the browser and in Node 18+, with no dependencies. The dashboard (P3) and the recommendation engine (P4) both call your code.

You own these files and **must not edit any other file**:

```
dashboard/lib/analysis.mjs
dashboard/lib/analysis.test.mjs            (node --test)
dashboard/lib/fixtures/analysis_sample.json
dashboard/lib/ANALYSIS.md                  methods, formulas, citations, limits
```

Inputs come from P1, per PLAN.md §7.1 and §7.2: `site_history.json` daily arrays (null = missing), `fields_ndvi.json`, the demo field soil data, and farm records. Crop parameters come from P4's `dashboard/data/crops.json`. Until P4 pushes it, use this temporary shape and keep it in your fixture:

```jsonc
{ "crops": [{ "id": "corn", "name": "Corn (grain)", "season": {"plant": "04-25", "harvest": "10-05"},
    "gdd_base_c": 10, "gdd_cap_c": 30, "gdd_to_silking_c": 780, "gdd_to_maturity_c": 1500,
    "sensitive_window": {"name": "pollination", "gdd_from": 700, "gdd_to": 900},
    "heat_threshold_c": 35,
    "kc": {"ini": 0.3, "mid": 1.2, "end": 0.6, "stage_days": [30, 40, 50, 30]},   // FAO-56 Table 11/12
    "root_depth_m": 1.5, "p_depletion": 0.55 }] }
```

(`gdd_to_maturity_c` is a placeholder. P4 will replace it with the sourced value.)

## Step 0: set up (5 min)

```bash
git clone https://github.com/kevindurantbr/kimchi.git && cd kimchi && git switch -c p2-analysis
```

## Step 1: commit the fixture first (by **6:45 pm**)

Before writing real code, hand-write `dashboard/lib/fixtures/analysis_sample.json` in the **exact output shape** of `analyzeField` (Step 4), with plausible numbers for fld01 in mid-July 2026. Push it. P3 builds the whole UI against this file and P4 builds recommendations against it, so getting the *shape* right matters more than the values. Label it `"fixture": true`.

## Step 2: core functions (by 7:30 pm), each with unit tests

Write a JSDoc comment on every export. Any function receiving null input returns null for that element; it never treats null as 0.

1. **Time helpers:** `doy(dateStr)`, `seasonSlice(daily, fromMMDD, toMMDD, year)`, `groupByYear(daily)`.
2. **Temperature:**
   - `gddDaily(tmax, tmin, base=10, cap=30)`: min(tmax,cap) and max(tmin,base), clamping both to [base, cap], then mean − base.
   - `cumulativeGdd(daily, plantDate)`.
   - `hotDays(tmaxArr, threshold=35)`.
   - `heatDegreeDays(tmaxArr, threshold=30)`: Σ max(0, tmax − 30). This proxy follows the Schlenker & Roberts 2009 corn heat response; cite it.
   - `frostDates(daily, year, threshold=0)` → `{ last_spring, first_fall, frost_free_days }`. Last spring frost is the last date before Jul 1 with tmin ≤ 0; first fall frost is the first date after Jul 1 with tmin ≤ 0.
3. **Reference ET₀:**
   - `et0PenmanMonteith({tmax, tmin, rh, ws2, rs_mj, lat, doy, elev_m=850})`: FAO-56 eq. 6, with daily net radiation from eqs. 21–40. POWER `ALLSKY_SFC_SW_DWN` daily comes in **MJ/m²/day** for the AG community. Verify this against the POWER header units; if it's kWh/m²/day, multiply by 3.6.
   - `et0Hargreaves({tmax, tmin, lat, doy})`: FAO-56 eq. 52.
   - `et0(daily, lat)`: uses Penman-Monteith when all inputs exist, else Hargreaves. Returns `{ values, method_per_day }`.
   - Test against the FAO-56 worked example (Example 18, Brussels): ET₀ ≈ 3.9 mm/day.
4. **Crop demand:** `kcCurve(crop, plantDate, dates)` uses the FAO-56 single crop coefficient with linear interpolation between stages. `cropDemand(et0, kc)` multiplies them element-wise.
5. **Water balance + bucket:**
   - `seasonWaterBalance(daily, et0, kc, irrigationMm=0)` → `{ rain_mm, irrigation_mm, demand_mm, balance_mm }`.
   - `rootZoneBucket({ dates, rain, demand, irrigation, taw_mm, p })`: daily depletion Dr, using FAO-56 Ch. 8 simplified. Effective rain is the rain itself, with any amount above TAW lost. TAW (mm) = `aws_0_150_cm × 10` from SSURGO, and the stress threshold RAW = p × TAW. Returns `{ depletion_mm[], stress_days, first_stress_date }`. Mark the bucket `"simplified: no runoff, no capillary rise"` in its output.
   - `wellCapacityMmDay(gpm, area_ha)` = gpm × 1440 × 3.785 L / (area_ha × 10,000 m²) → mm/day. A test: 600 gpm on 50.2 ha ≈ 6.5 mm/day.
   - `peakDemand(demand, window=7)`: max rolling 7-day mean, in mm/day.
6. **Normals and comparison:**
   - `climatology(daily, field, { baseline: [1991, 2020], window: 'doy'|'month', smooth: 15 })` → percentiles p10, p25, p50, p75 and p90 per day of year (±15-day window) or per month.
   - `percentileRank(value, sample)` uses the empirical rank (Weibull), and returns null if the sample has fewer than 10 values.
   - `status(value, sample, { adverseWhen: 'low'|'high', unit, label })` → `{ value, unit, normal_median, percentile, direction, severity, label }`.
     - Compute `severity` = clamp((|pct − 50| − 25) / 25, 0, 1), applied **only** in the adverse direction, so anything between the 25th and 75th percentiles scores 0.
     - `label` is plain language: "Drier than 84% of years for this date".
7. **History:**
   - `recurrence(annualValues, years, predicate)` → `{ count, n, years_matching, text: "11 of 45 years" }`.
   - `mannKendall(values)` → `{ S, z, p, trend: 'increasing'|'decreasing'|'no clear trend' }`. Use p < 0.05 and skip nulls.
   - `senSlope(values, years)` → per decade.
   - `trend(values, years)` returns `{ shown: false, reason: "need ≥ 30 years" }` when there are fewer than 30 non-null values.
   - `monthlyRecurrence(daily, metricFn, threshold)`: for each calendar month, the share of years where the condition occurred. This answers "in what season does this problem repeat".
8. **Crop condition:**
   - `ndviStatus(fieldNdvi, date)`: compares to the same 16-day composite across 2001–2025 → `status()`.
   - `greenCoverCalendar(fieldNdvi, threshold=0.3)` gives months with low greenness per year. **Label it "low green cover", not "bare soil"**, because dead residue looks the same as bare soil to NDVI.

## Step 3: interactions (by 8:15 pm)

These are the insights that combine factors; see PLAN.md §5.

1. `compoundCalendar(daily, et0, {years})`: for each year × month, count how many of these were active:
   - (a) hot: ≥3 days ≥35 °C;
   - (b) dry soil: mean gwetroot < the month's p25;
   - (c) water deficit: rain − ET₀ below the month's p25.

   Output `{ years, months: 1..12, counts: [[...]], detail }`.
2. `causeCheck({ ndviStatus, soilStatus, heatStatus, waterStatus })` → `{ code, text }`:
   - NDVI adverse with water/soil adverse → `"water"`.
   - NDVI adverse with heat adverse → `"heat"`.
   - NDVI adverse with neither → `"not_weather"` ("Weather doesn't explain this; scout for pests, nutrients, hail, or equipment issues").
   - NDVI normal → `"none"`.
3. `stageHeat(daily, crop, plantDate, year)`: finds the dates of the sensitive window from cumulative GDD, then counts hot days and heat-degree-days *inside* it vs the 1991–2020 distribution.
4. `capacityCheck(peakDemandMmDay, wellMmDay)` → `{ shortfall_mm_day, ok, text }`.
5. `farmSensitivity(records, annualIndicators)`: for the farmer's own years, pair yield with hot days and season deficit; return the points and the Spearman rho. **If n < 5, return `{ pattern: "too few years to judge", points }`**, and always attach the text "pattern, not proof".

## Step 4: `analyzeField(...)` and `rotationFit(...)` (by 8:45 pm)

```js
export function analyzeField({ daily, liveDaily, ndvi, soil, farmField, crops, today, site })
// daily     = site_history daily arrays (1981→)
// liveDaily = optional fresh POWER fetch for this year (overrides overlapping dates; keep null for missing)
// farmField = the farm-record field (crop this year, planting_date, irrigation, well_capacity_gpm, area_ha), may be null
// returns the shape in PLAN.md §7.3:
{
  factors: {
    water: { status, series: { dates, rain_cum, demand_cum, irrigation_cum, normal_p25, normal_p50, normal_p75 },
             recurrence, trend, bucket, capacity, source_ids },
    temperature: { status /* hot days season-to-date */, gdd: { to_date, normal_p50, stage_now },
                   frost: { last_spring, first_fall, normal_last_spring, normal_first_fall },
                   stage_heat, recurrence, trend, source_ids },
    soil_moisture: { status, series: { dates, gwetroot, p25, p50, p75 }, recurrence, source_ids },
    crop_condition: { status, series: { dates, field_mean, p25, p50, p75 }, green_cover_calendar, source_ids }
  },
  interactions: { compound_calendar, cause_check, capacity, stage_heat, farm_sensitivity },
  data_quality: { live_through, missing_days_this_year, et0_method_share, notes: [] }
}

export function rotationFit({ rotation, crops, daily, soil, farmField, farm, years = [1991, 2025] })
// rotation = { id, name, sequence: ["corn","sorghum"] }  (repeats over N years; winter wheat sown in autumn of year 1, harvested year 2)
// For each year in history, simulate each phase with that year's weather:
//   - season demand (ET₀ × Kc) vs rain + allocation (farm.constraints.annual_allocation_mm) → shortfall_mm
//   - peak 7-day demand vs well capacity → capacity shortfall days
//   - hot days inside the sensitive window
//   - frost risk: share of years where the frost-free season < crop's required window
//   - months with low green cover (use the crop calendar: months between harvest and next planting)
// returns { rotation_id, metrics: { shortfall_years: "x of N", median_shortfall_mm, median_irrigation_need_mm,
//           peak_capacity_short_years, sensitive_heat_years, frost_risk_years, low_cover_months_per_year,
//           demand_by_month: [12 numbers, two-year average] }, notes: [...limits] }
```

A two-year rotation's metrics average both phases over the same years, so every rotation is compared over the **same period**. **Do not output yield or profit.**

## Step 5: tests and docs (all along; final by 9:00 pm)

`node --test dashboard/lib/analysis.test.mjs` must pass. At minimum, test:
- null handling, including that a null day is not a dry day;
- GDD clamping;
- ET₀ against the FAO-56 example;
- the bucket never goes below 0 or above TAW;
- the well-capacity conversion;
- percentile and severity at the 25/50/75 boundaries;
- Mann-Kendall on a strictly increasing series;
- `trend` refuses fewer than 30 years;
- `causeCheck` covers all branches;
- `rotationFit` on corn–wheat puts wheat sowing in autumn of year 1.

Also run `analyzeField` on the real `site_history.json` once P1 pushes it, and replace the fixture with that real output; keep `"fixture": false` plus a `generated_from` note.

Write `ANALYSIS.md`: one short section per function giving the formula, units, source (FAO-56 Irrigation and Drainage Paper 56; Schlenker & Roberts 2009 PNAS; K-State GDD guidance), and its limits. P4 uses it for the "Methods" section of the write-up.

Open a PR from `p2-analysis` to `main` titled "Analysis engine: four factors, interactions, rotation fit". **Push after every step.**

## Acceptance checklist

- [ ] Fixture with the full output shape pushed by 6:45 pm.
- [ ] `analyzeField` runs in under 1.5 s in the browser on 45 years of daily data (measure it).
- [ ] No null-to-zero bugs; tests prove it.
- [ ] Every status has `percentile`, `severity`, a plain-language `label` and `source_ids`.
- [ ] Trends are shown only with at least 30 years; recurrence is always given as "X of N years".
- [ ] `rotationFit` works for any sequence of crops in `crops.json`, including the farmer's what-if sequences.
