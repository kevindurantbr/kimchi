# Live-site QA review (https://kevindurantbr.github.io/kimchi/)

Tested Nov 15, 8:50 pm Eastern, on `main` at `a53463d`, with headless Chromium at 1440 × 900 against the live URL, plus independent recalculation from the NASA POWER API.

## 1. Which data is pulled from where, and where it is shown

| Data | How it arrives | File / endpoint | Where it shows | Format on screen |
|---|---|---|---|---|
| **NASA POWER, this year** (temp, rain, humidity, wind, sun, soil wetness) | **Live**, from the browser on every page load (~43 KB) | `power.larc.nasa.gov/api/temporal/daily/point` | Top chip "LIVE NASA POWER THROUGH NOV 12"; the Water, Temperature and Soil-moisture cards; the left-panel charts | Numbers (mm, days, 0–1), line charts |
| **NASA POWER history, 1981 → last 3 days** | Precomputed by P1 | `data/site_history.json` | The normal range on every card (p25/p50/p75), "X of N years", the trend chart, rotation fit, recommendation evidence | Percentile bars, "28 of 35 years" text |
| **NASA POWER regional grid** (25 cells × 45 years) | Precomputed | `data/region_grid.json` | **Region view** map + time slider | Coloured squares by year |
| **MODIS NDVI** (greenness, 250 m, 583 images 2001 → Oct 16, 2026) | Precomputed (Planetary Computer + ORNL gap fill) | `data/fields_ndvi.json` | Crop-condition card; **Field view + Crop condition** pixel map + slider; low-green-cover calendar; recommendation S2/C3 | Coloured pixels, line chart, month strip |
| **Field outlines, SSURGO soil, CDL crop history** | Precomputed | `data/demo_fields.geojson` | Map outlines; soil water capacity in the bucket chart; "current rotation" | Dashed outlines; mm |
| **USDA soil for a drawn field** | **Live**, only when the farmer draws a field | `sdmdataaccess.sc.egov.usda.gov` | Banner after drawing; bucket chart | mm |
| **Farmer records** | Typed in, saved in the browser; demo = synthetic file | localStorage / `data/demo_farm.json` | My farm records; irrigation and planting date in recommendation evidence; well-capacity gauge | Table, trend charts, "farm record" chips |
| **Crop and action rules** | Static | `data/crops.json`, `data/actions.json`, `data/sources.json` | Rotation cards, top-3 actions, source chips | Cards, source codes |
| Satellite basemap | Live tiles | Esri World Imagery | Map background only; **not** analysed | Imagery |

## 2. Is the data accurate? (independently checked)

| Check | Result |
|---|---|
| `site_history.json` vs a fresh NASA POWER API call, every 2026 day × 4 variables | **1,264 values, 0 mismatches** |
| Same, all of 1995 (daily max temperature) | **365 / 365 match** |
| Temperature card "38 hot days" (≥35 °C, Apr 28 – Oct 8 corn season) | Recomputed from the API: **38** ✓ |
| Soil-moisture card 0.45, "p95" | API latest value 0.45 (Nov 12); my percentile vs 1991–2020 ±15 days = 93 ✓ (small method difference) |
| Region grid, 2012 hot days in the home cell | File 49, recomputed **49** ✓ |
| Missing values | Trailing days come back as −999 and are stored as null, never 0 ✓ |

**The numbers are real. The problems are in how they are worded, and in a fallback that can show made-up numbers (§3):**
- **Wrong-direction labels.**
  - Soil moisture is at p95, i.e. wetter than 95% of years, but the card says "**Drier than 5% of years**".
  - The water card is at p72 (better than normal) but says "**Drier than 28%**". A farmer will read both as alarms.
  - Fix: P2 round-2 task 5.
- **"Since 1991: 35 of 45 years".** The history starts in 1981, and the card doesn't say what is being counted. Fix the wording to, for example, "Drier than this in 35 of 45 years (1981–2025)".
- **Recommendation text.**
  - "28 of 35 years seasons" should read "28 of 35 seasons".
  - "about unavailable mm/day" leaks a missing value into a sentence.
  - The heat card says "above-normal … 33 of 35 years", but it actually counts any hot day (P2/P4 round-2 tasks 3–4).

**How the team can re-check before submitting:** open DevTools → Network, and confirm the `power.larc.nasa.gov` request returns 200. Then compare one value, for example the latest `GWETROOT`, with the card. Or run the Python check used here: fetch POWER for the site lat/lon and compare it with `site_history.json`.

## 3. What happens when data can't be pulled

| Failure (simulated) | What the user sees | Verdict |
|---|---|---|
| NASA POWER live API down | Top chip "LIVE POWER UNAVAILABLE", plus the banner "Live data unavailable, showing data through the last precomputed date (POWER unavailable: Failed to fetch)". Cards still work from history. | **Good** |
| `site_history.json` fails | Cards switch to **synthetic sample numbers** (water −111 mm, 9 hot days…). The only warning is a small "SAMPLE DATA · 3 OF 10" chip and "SAMPLE · FLD01". Recommendations then cite those numbers. | **Bad: shows made-up data as if real** |
| `actions.json` or `fields_ndvi.json` fails | Same pattern: falls back to sample files in `ui/_fixtures/` | **Bad** |
| CDN (Leaflet) fails | Page freezes on "LIVE POWER · CHECKING"; JS error `L is not defined`; no message | **Bad: silent failure** |
| A value is missing inside good data | Card says "Unavailable…" with the reason, e.g. "newest satellite composite is Oct 16" | **Good** |

**Required fix (P3, about 15 min):**
1. Remove the `ui/_fixtures` fallback in production. When a real file fails, show a red card: "Couldn't load NASA history (site_history.json). Showing nothing rather than estimates. Retry." Keep fixtures for tests only.
2. Add a global `window.onerror` / script `onerror` that shows "Map library couldn't load; check your connection and reload."

## 4. The time slider

**It isn't broken, and the data is there.** It only has frames in two modes:
- **Region view:** years 1981–2025 (tested: ◀/▶ and Play change the map colours).
- **Field view + Crop condition:** 583 greenness images 2001 → Oct 2026 (tested: Play runs).

In the **default view** (Field view + Water balance), and for Temperature and Soil moisture, it is **disabled with no explanation**, so it looks broken.

**Fix (P3, about 15 min). Choose one:**
- **(a) Recommended:** in Field view for Water, Temperature and Soil, give the slider the **years 1981–2026**. Each step colours the field by that year's season value (water deficit, hot days, July soil wetness) vs normal, and updates a one-line caption, e.g. "2012: 49 hot days, the hottest year on record here". The data is already in `site_history.json`, and P2's annual series gives it.
- **(b) Fastest:** when there are no frames, show the text "Press Region view (or Crop condition) to play history" next to the slider, and make the button switch for them.

## 5. Making the dashboard easier for farmers

**Current load: about 1,650 words on the first screen.** It also shows codes (F-01, W-1, D-01, Q-00), percentile jargon (p0/p25/p72), source IDs (`NASA_POWER_DAILY`, `FAO56`), score decimals (0.40) and a "0–1" unit. A farmer needs about 5 things at a glance.

### What each part shows now

| Area | Content now | Keep at first glance? |
|---|---|---|
| Top bar | data-source strip, live chip, UTC clock, field picker, 4 factor tabs, Field/Region, Draw, Records, Report, 3 panel toggles | Keep the field picker, factor tabs, Records and Report. Move the source strip, UTC clock and theme toggle to a small "ⓘ Data" menu |
| Left: 4 factor cards | value, label, p0–p100 bar, p-value, "Since 1991: X of N" | **Keep as simple tiles** (see below) |
| Left: W-1/W-2/W-3/X-1 charts, compound calendar, Advanced | supply vs demand, bucket, capacity gauge, trend, Mann-Kendall | **One chart per factor**; the rest behind "More detail" |
| Map | field outlines, colour by severity, slider | Keep. Make the slider always work |
| Right: top-3 actions | title, score 0.40, "why this score", why (3 bullets), evidence (repeated), source chips, benefits/risks/gaps, expert check | **Title + one-line why + expert check**; everything else behind "See evidence" |
| Right: rotation cards + what-if | metrics bars, benefits, risks, gaps, evidence | **One comparison table** (below); details expand |

### Proposed "Simple" view (default), with "Detailed" view = today's screen

1. **Four status tiles in plain words, with a colour and an icon** (not percentiles):
   - Water: **"Watch: drier than usual"**, "rain + irrigation was 314 mm short of what corn used; happens about 8 years in 10."
   - Heat: **"Normal"**, "38 days above 35 °C (95 °F) this season; normal is 27."
   - Soil moisture: **"Good: wetter than usual"**, "root zone 45% full; usually 39% in mid-November."
   - Crop greenness: **"No new image since Oct 16"**.
   - Show °F and inches next to °C and mm; US farmers think in inches and °F.
2. **"What should I consider?"**: 3 short cards, each a title plus one sentence. Example: "Continuous corn ran short of water in 28 of 35 past seasons under your 280 mm (11 in) allocation. Compare corn–sorghum or corn–wheat." Then "Ask your agronomist". Evidence, score and sources sit under "Why?".
3. **Rotation comparison as one table.** This is the core of the challenge: the current rotation + 2 alternatives, and it must stay visible.

   | | Continuous corn (now) | Corn–sorghum | Corn–wheat |
   |---|---|---|---|
   | Short on water (past 35 seasons) | 28 of 35 | x of 35 | x of 35 |
   | Heat during pollination | x of 35 | … | … |
   | Months with little green cover | … | … | … |
   | Main benefit / main risk | one line each | | |
   | Why suggested / what we don't know | "Details ▸" | | |

4. **"Your farm" strip:** this season's crop, irrigation used vs allocation (bar), and the last 5 yields (sparkline), with an "Add this season" button.
5. **Map + slider:** "Play 1981 → 2026" in plain words, with a caption sentence for the current year.

**Must stay visible to meet the challenge brief:**
- at least three rotation strategies, including the current one;
- a short why / benefit / risk / gap for each, plus "check locally";
- when fields are typically bare (the green-cover months row);
- the farmer's own inputs and priorities;
- data limits ("regional weather ~50 km", "estimate, not a meter").

**Can move to Detailed:** percentile bars, the bucket chart, the capacity gauge, Mann-Kendall, the compound calendar, source IDs, the score breakdown, and the exact values table.

## 6. Fix list by owner (before 9:30 pm freeze if possible; text-only fixes are fine after)

| Owner | Fix | Time |
|---|---|---|
| **P3** | Remove the `_fixtures` fallback; show an explicit error card plus a CDN-failure message (§3) | 15 min |
| **P3** | Slider: option (a), or at least (b) (§4) | 15–30 min |
| **P3** | Simple/Detailed toggle; Simple hides codes (F-01, W-1…), p-values, source IDs and score decimals, and shows the rotation table (§5) | 30–45 min |
| **P2** | Direction-aware labels; "X of N years (1981–2025)" wording | 10 min |
| **P4** | "28 of 35 seasons"; never put "unavailable" inside a sentence (drop the clause instead); heat-years label | 10 min |
| **P4** | Video: follow the Simple view so it fits 30 s | n/a |
