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

Shortfall `max(0,peak−well)` in mm/day; `ok` is true only with known sufficient capacity. Seasonal supply can be adequate while the seven-day peak exceeds gross capacity.

### `farmSensitivity(records,annualIndicators)`

Pairs season yields and weather by year; uses Pearson correlation of tied ranks (Spearman rho). Under five distinct years: too few years to judge. Mixed crops, units, or duplicate years suppress pooled correlations. Field analysis calculates each record's indicators using its own crop/dates. Always **pattern, not proof**; synthetic demo yields cannot substantiate real farmer sensitivity.

### `analyzeField(input)`

Returns four factors, interactions, optional rotations and quality notes. Uses as-of weather, supplied crop/farm state and fixed historical crop scenarios. It never falls back to another year's crop. Factor trends/recurrence describe comparable periods, with 1991–2020 normals. Soil-card status uses the exact month/day across years; its chart uses smoothed daily climatology. Missing NDVI stays unavailable even when earlier composites exist.

### `rotationFit(input)`

Default harvest years 1991–2025, all phases evaluated in every year. Per phase: need=max(0,demand−rain), shortfall=max(0,need−annual allocation); complete seven-day windows above capacity count shortfall days. Annual results average all phases; incomplete phases invalidate that annual metric. Reports medians and recurrence, with coverage notes. Monthly demand is the mean phase/year total in each calendar month.

Autumn wheat uses previous-autumn weather; a corn–wheat calendar shows wheat planting in year 1 and harvest in year 2. Overlapping harvest/next-plant dates generate an explicit feasibility note; this is not a sequenced operations simulation. Fallow uses calendar-year rough Kc, including leap day. Low cover is the fraction of days outside repeating crop spans ×12; no residue benefit is invented. Frost risk compares frost-free duration with a supplied requirement only for non-winter crops. No winter-survival, soil-storage carryover, yield, profit, or rotation winner is calculated.

## Verification and fixture provenance

The regression suite covers null handling, calendar gaps, leap dates, GDD clipping, FAO-56 Example 18 (about 3.88 mm/day using equivalent mean RH), Hargreaves radiation conversion, bucket bounds, 600-gpm conversion, percentile boundaries/ties, trend gating, all cause-check branches, live overrides, same-period rotations, autumn wheat, calendar-based wheat heat, fallow, and actual P1/P4 schema variations.

The generated fixture is `fixture:false` because its **outputs are computed**, not hand-written. It remains a demonstration using **synthetic farm management/yields**. Its `generated_from` records exact data/crop commits and a historical as-of date of 2025-07-15, since P1's farm records stop in 2025. Missing NDVI is preserved, not replaced with plausible numbers. The initial synthetic mid-July-2026 fixture remains available in commit `eabd711`.

Real-data smoke checks used P1 commit `8354d5c795d716a596a9b4fa7a605de2d40c876c` and P4 commit `41461863e2d766d47b32d1f338787d44b0ff2d80`: 16,752 weather rows (1981-01-01 through 2026-11-12), four factors, three standard rotations, fallow and a four-phase what-if. Node 24 timings for real-data `analyzeField` were roughly 0.6–0.7 seconds; a synthetic 45-year integration test was roughly 0.4 seconds. These are local measurements, not browser claims.

**Browser <1.5 s acceptance remains unverified.** The in-app browser could not reach the local benchmark server. Native browser verification was stopped by Computer Use because it could not confidently determine the browser URL. No browser timing is reported as passing. To measure in the integrated dashboard, load input data first, run `const t=performance.now(); analyzeField(input); console.log(performance.now()-t);` in the application's development harness, and record browser/version and several runs separately from network loading.
