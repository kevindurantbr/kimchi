# Kimchi: field risk and rotation explorer

> **Draft for the Space Apps project form.** Each `##` heading below is one form field; paste the text under it.
> Lines marked **[[FILL]]** need a value from the live app, P1's `sources.json`, or the team. Don't submit with any **[[FILL]]** left in.
> Requirements checked from the 2025 Space Apps Project Submission Guide (the 2026 form must be checked against these): demo = **video ≤ 30 s with English subtitles, or ≤ 7 slides**, hosted publicly (YouTube / Google Drive); all required fields in English; AI use disclosed; no NASA logos in our materials.

**Challenge:** Field Shift: Adapting Farms with NASA Data
**Team:** Kimchi, [[FILL: member names]]
**Demo (≤ 30 s video):** [[FILL: YouTube/Drive link]]
**Final project:** [[FILL: public GitHub Pages URL]] · Code: https://github.com/kevindurantbr/kimchi

---

## High-level summary

Kimchi is a map-based decision-support dashboard for farmers on limited irrigation. A farmer selects or draws a field, and Kimchi pulls live and historical NASA data on four factors: water balance, temperature, soil moisture and crop condition. For each factor it shows the current status against normal, where on the map the risk is, how often it has recurred since 1981, and whether it is getting worse. It combines that with the farmer's own season records and priorities to suggest the top 3 actions, each with a visible score, evidence, benefits, risks and information gaps. It also compares the field's current rotation with at least two alternatives (continuous corn, corn–sorghum, corn–winter wheat) on the same weather years. Our demo is an irrigated corn pivot in the Sheridan 6 LEMA in western Kansas, on the declining Ogallala aquifer. The tool supports the farmer's judgement and never replaces it: every card ends with "Review with your agronomist or K-State Research and Extension before acting."

## Project details

### The problem

In western Kansas, groundwater from the Ogallala aquifer is falling and allocations are tight. Summers bring more hot days at the moment corn pollinates. Farmers asking *"Should I keep continuous corn, or switch to corn–sorghum or corn–wheat? What should I do this season?"* face scattered data: weather here, soils there, satellite greenness somewhere else, and research trials in PDFs. Kimchi brings these together for one field and is honest about what the data can and can't say.

### What it does

1. **Four factors, four questions each.** For water balance, temperature, soil moisture and crop condition, the left panel answers:
   - **Now:** this season's value vs the 1991–2020 normal, as a percentile and a plain-language label ("Root zone drier than 88% of mid-July dates").
   - **Where:** a field view of MODIS 250 m greenness pixels every 16 days, and a region view of NASA POWER cells across western Kansas animated by year from 1981.
   - **How often and when:** recurrence stated as "X of N years", and the months when the problem repeats.
   - **Getting worse or better:** a Mann-Kendall trend with Sen's slope, shown only when there are at least 30 years of data.
2. **Factor interactions** (see below), such as heat during pollination, compound heat + dry soil, and peak demand vs well capacity.
3. **Top 3 actions** (right panel) from a library of 12 sourced actions, ranked by a rule-based score that's shown on every card:
   `score = severity × farmer priority × evidence strength × timing`.
   The farmer can **focus** on one factor. If fewer than 3 actions apply, the list is filled with "watch" items that say why they didn't trigger.
4. **Rotation comparison:** the current rotation (from the farmer's records, or USDA CDL satellite crop history flagged "please confirm") plus alternatives, each with fit indicators over the same weather years, why it was suggested, supporting evidence, benefits, risks, information gaps and prerequisites. There's also a **what-if** picker for any crop sequence and a slider for the water allocation.
5. **My farm records:** crop, planting and harvest dates, irrigation, nitrogen, yield, well capacity, allocation, and the farmer's priorities (save water / protect soil / income). Records are stored **only in the farmer's browser**, with JSON export and import.
6. **Season or quarter report**, printable, in 8 sections: at a glance; what is in danger; how often; top 3 actions; rotation outlook; your records; data and limits; "review with your agronomist".

### How it answers the challenge

| Challenge asks | Where Kimchi does it |
|---|---|
| Combine NASA Earth observations with local agricultural information | NASA POWER + MODIS NDVI combined with USDA SSURGO soils, USDA CDL crop history, K-State trial evidence and the farmer's own records |
| Explore crop-rotation options that may improve soil health and resilience to weather and water | Rotation cards and what-if mode, with water shortfall, peak-capacity, heat-in-sensitive-window, frost and low-green-cover indicators |
| **Compare at least three rotation strategies, including the existing rotation** | Current rotation + 2 alternatives from {continuous corn, corn–sorghum, corn–winter wheat}. If the current rotation is unknown, all three are shown alongside a "please confirm" card |
| **For each: why suggested, evidence, benefits, information gaps, risks needing local review** | Each rotation card has `why_suggested`, metrics from the farmer's weather record, benefits, risks, gaps/unknowns and prerequisites from 21 cited K-State/USDA sources; each action card has why, evidence with real values, benefits, risks, gaps and an expert check |
| **Highlight times when fields are typically bare** | Green-cover calendar from MODIS NDVI, labelled "low green cover" rather than "bare soil" (dead residue looks the same to NDVI), plus low-cover months per rotation |
| **Farmer inputs and priorities** | My farm records; priorities weight the action score; allocation and well capacity drive the water indicators |
| **Support, not replace, farmer judgment and local expertise** | No "best rotation" label, no yield or profit prediction, a visible score, and "Review with your agronomist or K-State Research and Extension before acting" on every card and report |

### How it works (methods)

Full formulas, units and citations are in [`dashboard/lib/ANALYSIS.md`](../dashboard/lib/ANALYSIS.md) [[FILL: confirm P2 merged it]].

- **Reference ET₀:** FAO-56 Penman-Monteith from POWER daily temperature, humidity, wind and solar radiation, falling back to Hargreaves where radiation is missing (before 1984 and in the most recent days). **Crop demand** = ET₀ × Kc, using FAO-56 crop coefficients and stage lengths from `dashboard/data/crops.json`.
- **Root-zone bucket:** daily depletion, following FAO-56 chapter 8 (simplified: no runoff, no capillary rise). Total available water comes from SSURGO 0–150 cm available water storage, and stress starts at p = 0.55.
- **Temperature:** growing degree days (10/30 °C, from planting), hot days ≥ 35 °C, heat-degree-days above 30 °C (Schlenker & Roberts 2009), and frost dates. Corn silking and maturity come from K-State values for a 110-day hybrid (1,500 and 2,670 °F GDU).
- **Normals and percentiles:** a 1991–2020 baseline with a ±15-day window. Severity is 0 between the 25th and 75th percentiles and rises to 1 in the adverse tail.
- **Rotation fit:** each rotation is simulated over the same historical years, so every strategy is compared on the same weather. Winter wheat is sown in autumn of year 1 and harvested in year 2.
- **Recommendation score:** severity (from the analysis) × priority (the farmer's sliders, floored at 0.2 so nothing is zeroed out) × evidence (A trial = 1.0, B extension guidance = 0.7, C rule of thumb = 0.4) × timing (in season = 1.0, within 3 months = 0.6, otherwise 0.3). At most 2 of the top 3 actions come from the same factor. A missing value never triggers an action.
- **Stack:** plain JavaScript ES modules (no build step), static hosting on GitHub Pages, precompute scripts in Node. The browser calls NASA POWER and USDA Soil Data Access directly; long history is precomputed so the demo also works offline.

### How the factors influence each other

| Interaction | What the farmer sees |
|---|---|
| Heat × crop stage: a hot week matters most at corn pollination (about 835 °C·days after planting) | Stage-aligned heat strip, plus "above-normal heat in the sensitive window in X of N years" |
| Heat × dry soil: compound stress | Month × year compound-stress calendar (0–3 stressors) |
| Temperature → water demand | Supply (rain + irrigation) vs crop demand chart, with the gap shaded |
| Peak demand vs well capacity: season totals can look fine while July can't be met | Capacity gauge: peak 7-day demand vs well output in mm/day |
| Greenness drop × water/heat | Cause check: "likely water/heat" vs "not explained by weather: scout for pests, nutrients, hail" |
| Rotation × rain timing: wheat uses spring water, corn and sorghum compete for July–August | Monthly demand calendar per rotation |
| Soil capacity × deficit | Depletion line with the "stress starts" threshold |
| Farm records × conditions | The farmer's yield vs hot days or deficit, labelled "n years: pattern, not proof" |

### Limitations and guardrails

1. Missing data stays missing ("unavailable"), never 0.
2. NASA POWER is about 50 km per cell: regional context, not a field measurement.
3. POWER root-zone wetness is model-based (MERRA-2 reanalysis), not a satellite measurement.
4. Crop water demand is ET₀ × Kc. It is not metered pumping and not OpenET.
5. NDVI shows greenness, not cause.
6. Trends need at least 30 years; recurrence is always "X of N years".
7. The ranking applies to actions, with the score shown. Rotations get fit indicators, never "best".
8. No yield, profit or water-saving predictions. The agronomy evidence explicitly rules these out without verified response functions and farm costs.
9. Corn, sorghum and wheat are all grasses, so rotating them earns no automatic "family break", nitrogen or disease credit.
10. Phase-split pivots (two crops on one pivot in the same year) are not modelled; we compare whole-field sequences.
11. The demo farm's records are **synthetic** and labelled so. Demo field boundaries are approximate, and their crop history is satellite-inferred and needs farmer confirmation.
12. Several crop parameters are null where we couldn't source them tonight (for example sorghum GDD to flowering). Null means "not evaluated", never a guessed value.

### Benefits and intended impact

A farmer or advisor gets, in one view, how this season compares with 45 years of weather on their field, which risks keep coming back, and a short, explained list of things to check, all traceable to NASA data and K-State research. Groundwater districts and extension agents could use the same view to discuss rotation options with growers under LEMA allocations.

### Next steps

- **OpenET** field-scale actual ET. It needs only a free account (account.etdata.org), and our adapter already exists in `research/deliverables/weather-water/`.
- **NASA SMAP** soil moisture (needs an Earthdata login) to check the model-based root-zone wetness.
- **NASA GPM IMERG** precipitation, at a finer resolution than POWER.
- **HLS** (Harmonized Landsat Sentinel-2) at 30 m for within-field crop condition.
- **Validation with farmers and K-State experts:** confirm crop histories, hybrid maturity, well output and allocation accounting, and test whether the top-3 actions are the ones advisors would raise.

## NASA data

| Dataset | How we used it |
|---|---|
| **NASA POWER daily point API** (Prediction Of Worldwide Energy Resources), AG community, 1981–present: `T2M_MAX`, `T2M_MIN`, `PRECTOTCORR`, `RH2M`, `WS2M`, `ALLSKY_SFC_SW_DWN`, `GWETROOT`, `GWETTOP` | Live this-season weather fetched in the browser (about 3-day lag), and 1981–now history for normals, recurrence and trends. Inputs to FAO-56 reference ET, growing degree days, hot days, frost dates, root-zone wetness percentiles, and the region slider grid across western Kansas |
| **NASA MODIS MOD13Q1** NDVI, 250 m, 16-day (via the ORNL DAAC MODIS web service) | Field-view greenness pixels with a time slider; crop condition vs the field's own 2001–2025 normal; the green-cover calendar that highlights low-cover months |
| [[FILL: NASA MODIS MOD16A2GF ET if P1/P3 kept it]] | [[FILL]] |

## Space agency partner and other data

| Dataset | How we used it |
|---|---|
| USDA NRCS **SSURGO** via Soil Data Access | Available water storage 0–150 cm sets the size of the root-zone bucket; also drainage class and hydrologic group |
| USDA NASS **Cropland Data Layer** (2021–2025) | Satellite-inferred crop history for the demo fields, flagged for farmer confirmation (CDL sorghum accuracy is 81% in Kansas) |
| **FAO-56** (Allen et al. 1998) | Reference ET, crop coefficients, stage lengths, rooting depth, depletion fraction |
| **K-State Research and Extension** limited-irrigation rotation trials and guides (21 sources in `research/deliverables/agronomy/agronomy.json`) | Benefits, risks and unknowns for each rotation; crop calendars; action evidence levels |
| Kansas Sheridan 6 LEMA order, KBS SD-6 boundary | Confirms that the demo fields lie in the LEMA |

**Considered but deferred tonight**, with reasons [[FILL: sync with P1's `dashboard/data/sources.json` `deferred` list]]:
- OpenET: needs an account (next step).
- GRACE-FO: about 300 km and monthly, so regional context only.
- SMAP: needs an Earthdata login.
- GPM IMERG, ECOSTRESS, PRISM, NLDAS, NAIP, SRTM, USGS NWIS, AMS Market News, NASS QuickStats, GAEZ, CoCoRaHS, NLCD, LANDFIRE, GEDI, Sentinel-2, ERA5: [[FILL: one-line reasons from P1]].

## Use of Artificial Intelligence

We used AI coding assistants (Claude Code, and ChatGPT/Codex for earlier research packages [[FILL: confirm which tools each teammate used]]) to help write code, structure data files, and draft documentation and this write-up. AI suggested starting parameter values, which we kept only where we could trace them to a cited source (FAO-56, K-State, USDA); otherwise the value is set to null and listed for verification. The scoring rules, guardrails and rotation evidence come from the team's research package with source IDs. AI-assisted code and data files say so in their headers and metadata (`ai_assistance`). No AI-generated images or video are used [[FILL: if any are, watermark them as AI-generated]]. The app itself uses **no machine-learning model**: recommendations are a transparent rule-based score.

## References

- Allen, R.G., Pereira, L.S., Raes, D., Smith, M. (1998). *Crop evapotranspiration: guidelines for computing crop water requirements.* FAO Irrigation and Drainage Paper 56. https://www.fao.org/4/x0490e/x0490e00.htm
- NASA POWER. https://power.larc.nasa.gov/
- ORNL DAAC MODIS/VIIRS land product subsets (MOD13Q1). https://modis.ornl.gov/
- USDA NRCS Soil Data Access. https://sdmdataaccess.sc.egov.usda.gov/
- USDA NASS Cropland Data Layer. https://www.nass.usda.gov/Research_and_Science/Cropland/
- *Limited irrigation of corn-based no-till crop rotations in west central Great Plains* (2016). *Agronomy Journal* (K-State SWREC trial). https://acsess.onlinelibrary.wiley.com/doi/full/10.2134/agronj2015.0536
- Schlegel, A.J. and Bond, H.D. (2021). Alternative cropping systems with limited irrigation. Kansas Agricultural Experiment Station Research Reports.
- USDA ARS: Productivity and profitability of four crop rotations under limited irrigation. https://www.ars.usda.gov/research/publications/publication/?seqNo115=405022
- K-State: *Efficient Crop Water Use in Kansas*, MF3066. https://bookstore.ksre.ksu.edu/pubs/efficient-crop-water-use-in-kansas_MF3066.pdf
- K-State Agronomy eUpdate: Late planting of corn, hybrid maturity and GDD. https://eupdate.agronomy.ksu.edu/article/late-planting-of-corn-how-location-and-hybrid-maturity-affect-probability-of-success-634-1
- K-State: *Sorghum Growth and Development*, MF3234. https://bookstore.ksre.ksu.edu/pubs/MF3234.pdf
- K-State Agronomy eUpdate: Effects of high temperatures on wheat. https://eupdate.agronomy.ksu.edu/article/effects-of-high-temperatures-on-wheat-494
- Schlenker, W. and Roberts, M.J. (2009). Nonlinear temperature effects indicate severe damages to U.S. crop yields under climate change. *PNAS* 106(37).
- USDA ARS: The water conundrum of planting cover crops in the Great Plains. https://www.ars.usda.gov/ARSUserFiles/30100500/Publications%202010-2019/22PDF%20Water%20Conundrum.pdf
- All 21 agronomy sources, with locators and transfer limits: `research/deliverables/agronomy/agronomy.json`.
