# Analysis engine: methods and integration

`analysis.mjs` is a dependency-free, pure ES module for Node 18+ and modern browsers. It does no fetching, storage, logging, or mutation of caller inputs. Run `node --test dashboard/lib/analysis.test.mjs` from the repository root.

## Contracts and important integration details

Use `PLAN.md` on the planning branch and the P2 brief. Only the four P2 files are changed. The implementation also supports P1/P4's subsequently published schemas.

- Daily input uses aligned arrays under `date`, `t2m_max`, `t2m_min`, `prectotcorr`, `rh2m`, `ws2m`, `allsky_sw_dwn`, `gwetroot`, and optionally `gwettop`. Pass `site.daily`, not the entire history file.
- Pass `site` to `analyzeField` for latitude, `elevation_m`/`elev_m`, and radiation `units`. `rotationFit` obtains latitude from `daily.lat`, the farm field's latitude/center/polygon bounds, or `farm.lat`. Prefer `{...site.daily, lat:site.lat, elev_m:site.elevation_m, units:site.units}` for rotation weather. Geometry fallback uses the bounding-box center, not a surveyed centroid.
- `crops` accepts either an array or `{crops:[...]}`. Farm records follow `kimchi.farm.1`; `record.year` is the harvest year. A flat `farmField.crop`/`planting_date` also works. The engine does **not** infer this year's crop from last year's record.
- `ndvi` accepts a selected field or the P1 `{source_ids, fields}` wrapper. For a selected field, retain `source_ids`; the published Planetary Computer `source` description is also recognized. Real P1 data use `MODIS_MOD13Q1_PC`, not the originally proposed ORNL source.
- `rotation_fit` is always an array. It is populated only when `analyzeField` receives `rotation` (one object or an array), with optional `farm` for allocation. Alternatively call `rotationFit` directly. This does not select or assume the farmer's baseline rotation.
- `data_quality.missing_days` and `missing_days_this_year` are aliases. Missing-day counts run from January 1 through `today`, requiring temperature extrema, rain and root-zone wetness. ET method shares use the same calendar-year rows. `live_through` means the last date with those four inputs, including static history; it is not proof of a successful live fetch.
- Status objects always contain `value`, `unit`, `normal_median`, `percentile`, `direction`, `severity`, `label`, and `source_ids`. Unknown direction/severity are **null**, never normal/zero. Consumers must render unavailable values instead of rounding/coercing them to zero.
- A known recurrence is `X of N years`. When the current comparison is missing, `count` is null, `text` says `Unavailable of N years`, and `reason` explains why. An unavailable comparison must not read as zero recurrence. Unknown cause checks use code `unavailable`; capacity uses `ok:null`.
- Water headline/normal curves represent **rain minus potential crop demand before irrigation**, isolating weather and avoiding invented historical irrigation. Rain, demand and reported irrigation are separate chart series. `seasonWaterBalance` is the API for a supplied irrigation-inclusive balance.
- Seasonal irrigation totals have no timing. Positive totals are shown only at the final chart date; other cumulative irrigation entries and the bucket are null. An explicit zero total means no irrigation. Optional `record.irrigation:[{date,mm}]` supplies a complete event ledger. A total on a record whose harvest lies after `today` is withheld unless a supplied `as_of <= today` identifies it as a current total.

## Missing data and chronology

Non-finite values are missing. Elementwise operations preserve nulls. Totals require complete numeric inputs; all-missing arrays do not sum to zero. Cumulative values remain unknown after the first gap. `analyzeField` fills absent calendar dates with null and applies explicitly supplied live columns over history, including live nulls. It ignores dates after `today`.

Rolling peaks exclude incomplete windows. Distributions skip null observations; they require at least ten observations for percentiles. Recurrence denominators contain valid years only. The bucket cannot regain certainty after a missing balance input. There is no silent weather interpolation or irrigation scheduling.

## Sources

- **FAO56:** Allen et al. (1998), [Crop evapotranspiration](https://www.fao.org/4/x0490e/x0490e00.htm): [meteorological quantities and radiation](https://www.fao.org/4/x0490e/x0490e07.htm), [reference ET and Example 18](https://www.fao.org/4/x0490e/x0490e08.htm), [single crop coefficient](https://www.fao.org/4/x0490e/x0490e0b.htm), [soil water balance](https://www.fao.org/4/x0490e/x0490e0e.htm).
- **NASA_POWER_DAILY:** [NASA POWER daily API](https://power.larc.nasa.gov/docs/services/api/temporal/daily/). On November 15, 2026, an AG daily request at 39.3976, −100.6783 for July 1 returned `ALLSKY_SFC_SW_DWN.units = "MJ/m^2/day"`. P1's actual history header confirms these units. Input metadata can explicitly request kWh conversion.
- **GDD:** [K-State corn maturity guidance](https://www.sunflower.k-state.edu/agronomy/corn/corn_maturity.html). Celsius base/cap are 10/30; Fahrenheit GDU quantities must be divided by 1.8 before use with Celsius totals. Crop-specific stage parameters remain P4's responsibility.
- **Heat interpretation:** [Schlenker & Roberts (2009), PNAS](https://doi.org/10.1073/pnas.0906865106). Their corn response threshold is approximately **29°C**, and their exposure method is not daily-maximum excess. Our ≥35°C hot-day and >30°C excess screens are project proxies, **not reproductions of that paper's fitted exposure model or yield response**.
- **Statistics:** [USGS Statistical Methods in Water Resources](https://pubs.usgs.gov/tm/04/a03/tm4a3.pdf) for rank associations, Mann–Kendall and Sen slope. Percentile display thresholds and sample-size gates below are project conventions, not validated agronomic decision thresholds.

## Function reference

### `doy(dateStr)`

UTC day of year (1–366), using Gregorian calendar arithmetic. Null/invalid dates return null. It does not shift dates with local daylight saving time.

### `seasonSlice(daily, fromMMDD, toMMDD, year)`

Inclusive selection preserving every aligned array. If harvest MM-DD precedes planting MM-DD, `year` is the planting year and harvest is in `year+1`. This helper selects existing rows; the caller must supply complete daily coverage for totals.

### `groupByYear(daily)`

Returns an object keyed by calendar year, with aligned subsets. It does not infer crop seasons or aggregate values.

### `gddDaily(tmax,tmin,base=10,cap=30)`

`(clamp(tmax,base,cap)+clamp(tmin,base,cap))/2-base`, in °C·days. K-State-style modified GDD; both endpoints are clamped as the P2 contract requires. Missing thresholds return null.

### `cumulativeGdd(daily,plantDate,base=10,cap=30)`

Aligned sum since planting, in °C·days. Dates before planting are null. Missing planting coverage, temperature, or a calendar day invalidates subsequent accumulation. It does not model vernalization.

### `hotDays(tmaxArr,threshold=35)`

Counts daily maxima ≥ threshold, in days. A single missing value makes the count unknown. The threshold is a screening choice, not a damage prediction.

### `heatDegreeDays(tmaxArr,threshold=30)`

Sum of `max(0,tmax-threshold)` in °C·days. See the Schlenker–Roberts distinction above. This cannot infer duration of heat within a day.

### `frostDates(daily,year,threshold=0)`

Last minimum ≤ threshold before July 1; first after July 1. Frost-free days are the strictly intervening dates. Both half-year inputs must be complete for their respective boundary; no observed frost is not treated as unlimited frost-free time. Northern Hemisphere calendar convention; first fall frost is conservative/unavailable before year-end.

### `et0PenmanMonteith(input)`

FAO-56 eq. 6, daily grass-reference mm/day, with zero daily soil heat flux. `Δ`, pressure/psychrometric constant, saturation/actual vapour pressure, solar geometry and net radiation follow FAO-56. RH is mean percent (eq. 19); wind is at 2 m. Inputs: °C, m/s, MJ/m²/day, latitude degrees, elevation metres. Default elevation 850 m is a demo assumption. Cloudiness radiation ratio is bounded to 0.3–1; negative ET is clipped to zero. Polar zero-radiation cases return null.

### `et0Hargreaves(input)`

`0.0023 × (Tmean+17.8) × sqrt(Tmax−Tmin) × 0.408Ra`, in mm/day (FAO-56 eq. 52). `Ra` starts in MJ/m²/day; 0.408 converts it to evaporation equivalent. This is a less data-intensive fallback requiring local calibration for quantitative irrigation use.

### `et0(daily,lat)`

Returns aligned `{values,method_per_day}`. Complete valid inputs use `penman_monteith`; otherwise temperature/latitude permit `hargreaves`; otherwise both are null. Explicit `kWh`/`kW-hr` radiation is multiplied by 3.6. Absent units mean the agreed AG MJ contract; unrecognized units disable the radiation-dependent method.

### `kcCurve(crop,plantDate,dates)`

FAO single-coefficient curve: constant initial, linear development, constant mid-season, linear late-season. Unitless; `stage_days` are calendar durations. Zero outside the specified schedule. Published regional stage lengths are not a calibrated crop-development model.

### `cropDemand(et0,kc)`

Elementwise product, mm/day. Both operands must be known, even if the coefficient is zero. Potential demand does not incorporate stress-reduced actual ET.

### `seasonWaterBalance(daily,et0,kc,irrigationMm=0)`

Returns complete season rain, irrigation, demand and `rain+irrigation−demand`, all mm. The standalone default explicitly describes a no-irrigation scenario. In field analysis, missing farmer irrigation remains unknown.

### `rootZoneBucket(input)`

`Dr[i]=clamp(Dr[i−1]+demand−rain−irrigation,0,TAW)`, initially at field capacity; stress when `Dr>p×TAW`. Field TAW is SSURGO `aws_0_150_cm×10` mm. Simplified FAO-56 water accounting: no runoff, capillary rise, dynamic roots or stress feedback. Excess supply is lost. Its initial condition and fixed 1.5 m storage are assumptions, not probe measurements.

### `wellCapacityMmDay(gpm,area_ha)`

`gpm×1440×3.785/(area_ha×10000)`, mm/day; 600 US gpm over 50.2 ha is about 6.51 mm/day. Gross continuous pumping assumes 24-hour operation and no conveyance/application losses.

### `peakDemand(demand,window=7)`

Maximum complete rolling arithmetic mean in mm/day. Needs at least one full window. It is not an estimate of instantaneous pump demand.

### `climatology(daily,field,options)`

Default baseline 1991–2020, ±15-day pooled window. Canonical leap-year month/day alignment prevents March shifts. Returns `n,p10,p25,p50,p75,p90` arrays; indices are canonical DOY−1 or month−1. Quantiles linearly interpolate sorted values at `(n−1)p`. Pooling weights daily observations, not years; the ten-observation minimum is not ten distinct years.

### `percentileRank(value,sample)`

Weibull plotting positions `100×rank/(n+1)`, midranks for ties, linear interpolation between observed values; outside the observed range returns 0/100. Minimum ten valid values. This descriptive rank is not a future-event probability.

### `status(value,sample,options)`

Adverse below p25 for low-is-bad, above p75 for high-is-bad. Severity is `clamp((abs(p−50)−25)/25,0,1)` only in that adverse tail. The other tail is favourable and quartile boundaries are normal, with severity zero. Units, wording and source IDs are carried through.

### `recurrence(annualValues,years,predicate)`

Counts valid annual values satisfying the caller's condition, with matching years and `X of N years`. Duplicate years are averaged first. Excluded years change the denominator and must not be interpreted as safe years.

### `mannKendall(values)`

`S=Σsign(xj−xi)`; variance `[n(n−1)(2n+5)−Σt(t−1)(2t+5)]/18`; continuity-corrected z and approximate two-sided normal p. Significant direction uses p<0.05. Nulls are skipped, all ties give p=1. No autocorrelation correction, seasonal test or multiple-testing adjustment; very short-sample p values are approximate.

### `senSlope(values,years)`

Median pairwise value change divided by actual year difference, multiplied by ten. Units are indicator units per decade. Duplicate years are averaged; null pairs excluded. No confidence interval is claimed.

### `trend(values,years)`

Combines the above methods only with at least 30 distinct numeric annual observations. Otherwise `{shown:false,reason:"need ≥ 30 years"}`. The display gate does not establish independence or causality.

### `monthlyRecurrence(daily,metricFn,threshold)`

Twelve entries with month, recurrence and share. Complete calendar months only. Callback receives aligned monthly daily arrays and must return null for an invalid metric. Numeric threshold means ≥; a predicate function is also accepted.

### `ndviStatus(fieldNdvi,date)`

Targets the current year/composite `floor((DOY−1)/16)`, comparing 2001–2025 and excluding the target year. Missing or stale current composites are not carried forward. P1 handles QA and scaling; mixed 250 m pixels are not plot-level crop diagnosis.

### `greenCoverCalendar(fieldNdvi,threshold=0.3)`

Per-year/month mean of supplied composites below threshold, in `low_cover[yearIndex][monthIndex]`. Missing months/composites stay unknown. Label is **low green cover**: NDVI cannot distinguish dead residue from bare soil, nor establish the duration of cover between composites.

### `compoundCalendar(daily,et0,{years})`

Counts hot (≥3 maxima ≥35°C), dry soil (monthly mean below baseline p25), and rain−ET₀ below baseline p25. Baseline monthly distributions are 1991–2020. Returns year/month grids and booleans in `detail`. Partial months or unknown stressors make the count null; this is co-occurrence, not a damage model.

### `causeCheck(statuses)`

Low greenness plus adverse water/soil → water; otherwise heat → heat; otherwise all weather known → not_weather; non-adverse greenness → none. Incomplete evidence → unavailable. These are rule-based scouting cues, not causal attribution.

### `stageHeat(daily,crop,plantDate,year)`

Counts hot days and >30°C excess within inclusive crop GDD bounds. Current partial GDD progress is compared with historical windows reaching equivalent progress. P4 wheat `date_from/date_to` instead uses the harvest year's calendar window; an incomplete calendar window stays unknown. Missing sorghum stage parameters are not guessed.

### `capacityCheck(peakDemandMmDay,wellMmDay)`

Shortfall `max(0,peak−well)` in mm/day; `ok` is true only with known sufficient capacity. Seasonal supply can be adequate while the seven-day peak exceeds gross capacity. Returns `{ peak_mm_day, well_mm_day, shortfall_mm_day, ok, text }`; peak and well are rounded to 0.1 mm/day and the shortfall to 0.01 (computed from unrounded inputs).

### `farmSensitivity(records,annualIndicators)`

Pairs season yields and weather by year; uses Pearson correlation of tied ranks (Spearman rho). Under five distinct years: too few years to judge. Mixed crops, units, or duplicate years suppress pooled correlations. Field analysis calculates each record's indicators using its own crop/dates. Always **pattern, not proof**; synthetic demo yields cannot substantiate real farmer sensitivity.

### `analyzeField(input)`

Returns four factors, interactions, optional rotations and quality notes. Uses as-of weather, supplied crop/farm state and fixed historical crop scenarios. It never falls back to another year's crop. Factor trends/recurrence describe comparable periods, with 1991–2020 normals. Soil-card status uses the exact month/day across years; its chart uses smoothed daily climatology. Missing NDVI stays unavailable even when earlier composites exist.

### `rotationFit(input)`

Default harvest years 1991–2025, all phases evaluated in every year. Per phase: need=max(0,demand−rain), shortfall=max(0,need−annual allocation); complete seven-day windows above capacity count shortfall days. Annual results average all phases; incomplete phases invalidate that annual metric. Reports medians and recurrence, with coverage notes. Monthly demand is the mean phase/year total in each calendar month.

Autumn wheat uses previous-autumn weather; a corn–wheat calendar shows wheat planting in year 1 and harvest in year 2. Overlapping harvest/next-plant dates generate an explicit feasibility note; this is not a sequenced operations simulation. Fallow uses calendar-year rough Kc, including leap day. Low cover is the fraction of days outside repeating crop spans ×12; no residue benefit is invented. Frost risk compares frost-free duration with a supplied requirement only for non-winter crops. No winter-survival, soil-storage carryover, yield, profit, or rotation winner is calculated.

## Verification and fixture provenance

The regression suite covers null handling, calendar gaps, leap dates, GDD clipping, FAO-56 Example 18 (about 3.88 mm/day using equivalent mean RH), Hargreaves radiation conversion, bucket bounds, 600-gpm conversion, percentile boundaries/ties, trend gating, all cause-check branches, live overrides, same-period rotations, autumn wheat, calendar-based wheat heat, fallow, and actual P1/P4 schema variations.

The generated fixture is `fixture:false` because its **outputs are computed**, not hand-written. It remains a demonstration using **synthetic farm management/yields**. Its `generated_from` records exact data/crop commits and the as-of date. Since round 2 it is computed for **today** (the last POWER day, 2026-11-12) on fld01, using P1's synthetic 2026 corn season and P4's three candidate rotations; `rotation_fit` keeps metrics, calendar and notes but drops the per-season arrays to keep the file small. Missing NDVI is preserved, not replaced with plausible numbers. The 2025-07-15 fixture is in commit `45649e2`; the initial synthetic mid-July-2026 one is in commit `eabd711`.

Real-data smoke checks used P1 commit `8354d5c795d716a596a9b4fa7a605de2d40c876c` and P4 commit `41461863e2d766d47b32d1f338787d44b0ff2d80`: 16,752 weather rows (1981-01-01 through 2026-11-12), four factors, three standard rotations, fallow and a four-phase what-if. Node 24 timings for real-data `analyzeField` were roughly 0.6–0.7 seconds; a synthetic 45-year integration test was roughly 0.4 seconds. These are local measurements, not browser claims.

**Browser <1.5 s acceptance remains unverified.** The in-app browser could not reach the local benchmark server. Native browser verification was stopped by Computer Use because it could not confidently determine the browser URL. No browser timing is reported as passing. To measure in the integrated dashboard, load input data first, run `const t=performance.now(); analyzeField(input); console.log(performance.now()-t);` in the application's development harness, and record browser/version and several runs separately from network loading.

## Round 3 additions (Nov 15, 9:30 pm)

- **Direction-aware labels.** `status()` takes `label` (the adverse word, e.g. "Drier") and an optional `opposite` ("Wetter"; common pairs are built in). Above the median the label uses the high-side word and the percentile ("Wetter than 72% of years for this date"); below it, the low-side word and 100 − percentile. At the rounded median it reads "Near the median for this date"; at p0/p100, "… than every past year".
- **Recurrence wording.** For water, hot days and soil, recurrence counts past years at least as extreme as this year **on the side of the median this year is on**. `text` = "X of N years (1981–2025)" (still parseable as "X of N"), `sentence` = "In X of N years (1981–2025), the season was at least this wet.", plus `label`, `side` and `definition`.
- **`status.plain` = { word, sentence, freq }** for the Simple view. `word`: no percentile → "No new data"; favourable → "Good"; |pct − 50| ≤ 25 → "Normal"; severity ≤ 0.5 → "Watch"; else "Concern". `sentence` is one line with units, adding inches for water and °F for heat. `freq` = round(10 × count / n) of the recurrence ("This happens about N years in 10").
- **As-of dates.** Every factor status has `as_of`. Water and heat: the end of the season window (harvest or today). Soil: today (round 2: the last value up to 7 days old, see below). Crop condition: if no 16-day composite covers today, the newest composite up to 32 days old is compared with the same composite period in past years, and the label names its date ("for Oct 16"). Older than 32 days → null, with `reason`.
- **`analysis.annual`** = { years, water_deficit_mm, hot_days, gwetroot_jul, caption } for 1981 → this year, using this season's crop calendar for every year. `water_deficit_mm` = crop demand − rain (positive = short; null without a crop). `gwetroot_jul` = July mean, needing at least 25 valid days. `caption[i]` is one sentence and flags the most hot days, or the largest deficit, recorded since 1981 up to that year.
- **Not done in round 3:** `sensitive_heat_above_normal_years` and `interactions.stage_heat.recurrence`. Both were added in the round-2 completion below.

## Round 2 completion (team/ROUND2.md, P2 tasks 1–7)

- **Crop-independent fallback.** When the season has no crop record (a drawn field, or a year not entered yet), `analyzeField` still returns all four statuses. Water is a **reference water balance (no crop selected)**: rain − ET₀ with Kc = 1.0 from May 1 to Sep 30. Hot days count only Jun 1–Aug 31 (≥ 35 °C, season to date; null before Jun 1, with `reason`). GDD use 10/30 °C from May 1. Frost dates, soil moisture and NDVI do not need a crop. Peak-demand capacity, stage heat and `stage_now` stay unavailable (they need a crop). A crop id missing from `crops.json` is treated the same way, with a note. The output carries `analysis.crop_context = { crop, mode: "crop_specific" | "crop_independent", season_year, period, completed, prompt }`; `prompt` is "Enter this season's crop in My farm records for crop-specific demand and stage heat." in crop-independent mode and null otherwise. `factors.water.basis` and `status.basis` give the water basis. `analysis.annual.water_deficit_mm` follows the same reference balance when there is no crop.
- **Season and harvest dates.** The season runs from the record's `planting_date` (or the crop default) to the record's `harvest_date` (or the crop default). Before round 2 the crop default harvest was used even when the record gave one.
- **As-of rule.** Soil moisture uses the last non-null `gwetroot` up to 7 days before `today`, compared with past years on **that** calendar date; the label names the date ("for Nov 9") when it is not today. Older → value null, `as_of` null, `reason` "latest value is older than 7 days (YYYY-MM-DD)". Water and heat likewise end at the last day with complete temperature and rain if `today` (or harvest) has no weather yet and the gap is ≤ 7 days, so POWER's ~3-day lag does not blank the cards. A gap *inside* the season still makes the total unknown. NDVI keeps its 32-day rule.
- **Out-of-season view.** The season is **completed** when `today` is after the harvest date (Sep 30 without a crop) or between Nov 1 and Mar 31. From Jan 1 to Mar 31 the headline season is last year's (its own crop record). Water and heat then compare the whole completed season with past whole seasons; the label ends "for the full season" instead of "for this date". Every status has `period`: water and heat "2026 season (completed)", "2026 season to date" or "2026 season (not started; begins May 1)" (heat adds ", hot days Jun 1–Aug 31" without a crop); soil "Latest daily value"; crop condition "Latest 16-day satellite image".
- **Heat recurrence (above normal).** `interactions.stage_heat.recurrence` (the same object as `factors.temperature.stage_heat.recurrence`) = `{ count, n, share, years_matching, median_hot_days, span, text: "X of N years", sentence, definition }`. A year counts when hot days (≥ the crop's heat threshold) in its **complete** sensitive window **exceed that window's 1991–2020 median**; all past years with a complete window are in N. Fewer than 10 baseline windows, or no crop → `count`/`text` null with `reason`. In `rotationFit`, `metrics.sensitive_heat_above_normal_years` uses the same definition per phase (each phase against its own crop's 1991–2020 median; a year counts if any phase is above normal). **`metrics.sensitive_heat_years` means "years with at least one hot day in the window"**, not above-normal heat: label it that way.
- **Direction-aware labels** were done in round 3 (above). The `status()` option `when` (default "for this date") sets the label's last words.
- **P4 contract.** Checked on real output for today: `interactions.capacity.{peak_mm_day, well_mm_day, shortfall_mm_day, ok, text}`, `interactions.stage_heat.recurrence`, `factors.crop_condition.green_cover_calendar.mean_low_months_per_year` (mean count of low-cover months over years with all 12 months observed, 0.1 precision; `years_complete` gives how many) and `rotation_fit[].rotation_id` all exist. A test asserts it.
- **Rounding for display.** `status.value` and `status.normal_median` are rounded to 0.1 for mm and days and 0.01 for NDVI and 0–1 wetness; percentiles and severities are computed from the unrounded values first. `status.display = { value, normal_median, percentile }` are strings ("-312.8 mm", "38 days", "0.45", "72"; "unavailable" when missing). `gdd.to_date` and `gdd.normal_p50` are rounded to 0.1 °C·days, and `gdd.from` gives the start date. `rotationFit` medians, `low_cover_months_per_year` and `demand_by_month` are rounded to 0.1.
- Node 24 timing on real data: `analyzeField` 0.6–0.8 s per field (the added heat recurrence costs about 0.05 s).

## Round 4 additions (team/P2_analysis_engine.md, PLAN.md §13)

- **`analysis.badges`**: one per factor, in the order water, temperature, soil_moisture, crop_condition: `{ factor, name, word, level, colour, icon, headline, detail, normal, as_of, period }`.
  - `level` maps `status.plain.word` exactly as in the PLAN.md §13 table: Good → `good`, Normal → `normal`, Watch → `watch`, Concern → `concern`. A status without a value or percentile is always `nodata` ("No new data"), never a good colour. `colour` is the table's hex (`nodata` is grey; the UI adds the hatching).
  - `icon`: 💧 water, 🌡 heat, 🟫 soil moisture, 🌱 greenness.
  - `headline` is the one number to focus on: "313 mm (12.3 in) short" / "61 mm (2.4 in) to spare", "38 days over 95 °F", "Root zone 45% wet", "Greenness 0.40". With nodata it is "No new data" and `detail` gives the reason.
  - `normal` is the same quantity for a normal year, as text; `detail` names the quantity and period.
- **`analysis.status_summary`** = `{ level, factor, colour }`: the worst known badge level (good < normal < watch < concern), for the field outline. It is `nodata` only when every factor is nodata.
- **`analysis.charts`** (all values rounded):
  - `water_by_year = { years, deficit_mm, normal_mm, normal_value, current_year, unit, label, reason }`: the last 35 seasons of crop (or reference) water use minus rain (positive = short), the same numbers as `annual.water_deficit_mm`. `normal_mm` repeats the 1991–2020 median so it draws as a line.
  - `heat_by_year = { years, hot_days, normal, normal_value, … }`: hot days in the crop season (Jun–Aug without a crop).
  - In season, past years are cut at the same calendar date (the label says so).
  - `soil_by_month = { months, this_year, normal, year, … }`: monthly mean GWETROOT for the calendar year of the soil as-of date (months with ≥ 10 valid days) against the 1991–2020 median of monthly means.
  - `green_by_month`: the same for field-mean NDVI against the 2001–2025 median.
  - `reason` is null when there is data, else why there is none ("No satellite greenness for this field yet: …").
- **Fields P3 already reads** (previously missing, so the UI showed "unavailable"):
  - `temperature.series = { dates, gdd_cum, normal_p25, normal_p50, normal_p75 }`: cumulative GDD from planting (May 1 without a crop) against past seasons aligned by month-day.
  - `stage_heat.hot_dates`, `hot_threshold_c`, `season_start` and `season_end` for the heat strip (no longer hard-coded corn dates). Without a crop, `hot_dates` covers Jun 1–Aug 31.
  - `frost.normal_range_spring` and `normal_range_fall` = 1991–2020 p25–p75 as `["MM-DD","MM-DD"]`; `frost.first_fall_note` = "No fall frost yet (through Nov 12)" when the fall has no frost so far.
  - `frostDates` now reports a first fall frost once it is observed after an unbroken run of valid days from Jul 2, without waiting for Dec 31. A gap before it, or no frost yet, stays null.
  - `soil_moisture.monthly_recurrence = { months, share, count, n, threshold, span, text }`: the share of past years whose monthly mean root-zone wetness was below one pooled threshold (the 25th percentile of all 1991–2020 monthly means), so seasonally dry months stand out. Complete months only; the current year is excluded.
  - `trend.years`, `trend.values` and `trend.unit` for the trend chart. Soil moisture now has a trend of July mean wetness. Crop condition has a July mean NDVI trend that stays hidden ("need ≥ 30 years; MODIS greenness has 25").
  - `capacity.peak_demand_mm_day` (alias of `peak_mm_day`), `green_cover_calendar.threshold`, `bucket.dates`, and `bucket.reason` / `bucket.note` explaining why the bucket is unavailable (no crop, no SSURGO water capacity, or irrigation without dates).
  - `crop_condition.status.reason` when no NDVI is supplied: "No satellite greenness for this field yet: new fields need a server-side NDVI download."
- **Pulled sites.** `analyzeField({ daily: site.daily, site, ndvi: null, soil, farmField: null, crops, today })` works for `fetchPowerDaily` / `pullFieldData` output at any US point. It was checked on a real POWER pull at 41.5, −93.6 (Iowa): 1981-01-01 → 2026-11-16, with the last 4 days unpublished and radiation missing before 1984 (those days use Hargreaves). The crop-independent fallback applies, the as-of rule handles the unpublished days, and crop condition is nodata with its reason. `site.lat`, `site.elevation_m` and `site.units` are used, not the demo site's.
- **Speed.** `distribution()` sorts once instead of once per percentile, and `complete()` checks the day count, endpoints and strictly increasing dates instead of building a date array. Real-data `analyzeField` dropped from ~0.85 s to ~0.4–0.5 s per field in Node 24, including the new outputs; a test asserts < 1.5 s on three pulled-site shapes.
