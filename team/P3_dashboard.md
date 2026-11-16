# Prompt for Person 3: dashboard web app (map, time slider, panels, farm records, public URL)

> Copy everything below this line into your AI assistant, together with the repository's `PLAN.md`.

---

## ▶ ROUND 3: start here (9:05 pm → 9:45 pm; freeze 10:00 pm)

Read PLAN.md §8 (status), §11 (detail levels) and `team/QA_REVIEW.md`. Branch from the latest `main`: `p3-round3`. You keep merging; run `node --test dashboard/lib/*.test.mjs` before each merge. **Ownership change:** `ui/integrate.mjs` moves to P1 tonight.

1. **(9:05) Merge PR #20** (P4 round 2) if its tests pass.
2. **(by 9:15) Left-panel collapse bug** (reported by the owner). Collapsing the left panel makes the map **0 px wide**, and the decision panel jumps into the map's place. The cause: `.left{display:none}` removes a grid item, so `.mapwrap` and `.right` shift one column left. The fix in `styles.css`:
   ```css
   .console > .left { grid-column: 1; } .console > .mapwrap { grid-column: 2; } .console > .right { grid-column: 3; }
   ```
   (Mobile already uses one column, so leave that rule as it is.) Then call `map.invalidateSize()` about 50 ms after any panel toggle. Verify both panels collapse, separately and together, at 1440 px.
3. **(by 9:20) Error cards** (QA review §3). Render P1's `ctx.loadErrors` as red cards in the affected panel: "Couldn't load NASA history (site_history.json). Showing nothing rather than estimates. [Retry]". Add `onerror` handlers on the Leaflet and Chart.js `<script>` tags, plus a `window.onerror`, that show "The map library couldn't load. Check your connection and reload." This replaces the silent freeze on "CHECKING".
4. **(by 9:40) The detail-level filter, View: Simple / Moderate / Complete** (PLAN.md §11, the full table).
   - Put the segmented control in the top bar, defaulting to **Simple**, and remember it in localStorage inside try/catch.
   - Set `body` class `level-1/2/3`; tag elements with `data-min-level`.
   - Hide the codes (F-01, W-1, D-01, Q-00) below level 3.
   - In Simple, the tiles use P2's `status.plain`, the actions use P4's `card.short`, and the rotations use P4's `rotationTable()`.
   - Fall back to the current text if a field is missing; **never show `undefined`**.
   - **If time runs short**, ship Simple = hide `[data-min-level]` elements + the rotation table; Moderate and Complete = today's screen.
5. **(by 9:45) Slider** (QA review §4).
   - Field view for Water, Temperature and Soil moisture: use P2's `analysis.annual.years` as frames. Colour the field by that year's value vs normal and show `caption[i]` next to the slider.
   - Until that lands, or if it's missing, when the slider has no frames show "Press **Region view** or **Crop condition** to play history", and make that text a button that switches for them.
   - The slider must never look dead without explanation.
6. **(10:00–10:45)** Feature freeze. Run the QA list in QA_REVIEW.md on the live URL at 1440 px and on a phone, fix bugs only, and give P4 the "go" for recording in **Simple** view.

---


You are helping build **Kimchi**, a NASA Space Apps 2026 project for the "Field Shift: Adapting Farms with NASA Data" challenge. Repository: https://github.com/kevindurantbr/kimchi. **Read `PLAN.md` first**, especially §4 (data workflow), §5 (factor interactions), §6 (layout) and §7 (contracts). The deadline is **tonight, Nov 15, 11:59 pm Eastern**, and the video gets recorded from your app at **9:30 pm**, so a working app matters more than a perfect one.

## Your role

You build the farmer-facing web app and put it on a public URL. You are also the **integrator**: you import P1's data and modules, P2's `analyzeField`/`rotationFit`, and P4's `recommend`/report. Build against their fixtures first, and swap to the real files when they land.

You own these files and **must not edit any other file**:

```
dashboard/index.html
dashboard/app.js
dashboard/styles.css
dashboard/ui/*.mjs          (map.mjs, panels.mjs, charts.mjs, farmForm.mjs, report.mjs, slider.mjs ...)
dashboard/README.md
.github/workflows/pages.yml
```

Technology: plain HTML/CSS/JavaScript ES modules, with no build step and no npm. Libraries come from CDN with **exact versions**:
- Leaflet `https://unpkg.com/leaflet@1.9.4/dist/leaflet.js` (+ `.css`)
- Leaflet.draw `https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.js` (+ `.css`)
- Chart.js `https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js`

Basemap: Esri World Imagery (`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`, with attribution "Esri, Maxar, Earthstar Geographics"), plus an OpenStreetMap toggle.

## Step 0: set up (5 min)

```bash
git clone https://github.com/kevindurantbr/kimchi.git && cd kimchi && git switch -c p3-dashboard
python3 -m http.server 8080 --directory dashboard   # open http://localhost:8080
```

## Step 1: skeleton with fixtures (by **6:45 pm**)

Layout, from the team's Google Doc and PLAN.md §6:
- **Top bar:**
  - field selector;
  - factor tabs: **Water balance · Temperature · Soil moisture · Crop condition**;
  - view toggle: **Field view / Region view**;
  - buttons: **My farm records**, **Season report**, **Draw field**.
- **Center:** a full-height Leaflet map.
- **Left panel** (toggleable): the 4 factor cards, the charts for the selected factor, and an **Advanced ▸** expander.
- **Right panel** (toggleable): **Top 3 actions**, **Rotation options**, and the **What-if** picker.
- **Bottom of map:** the time slider with ◀ ▶ and ▶ Play.
- **Mobile (< 800 px):** the panels become bottom sheets, with no horizontal scroll.

Until real files exist, create **temporary** local fixtures under `dashboard/ui/_fixtures/` (yours to delete later):
- a copy of P2's `dashboard/lib/fixtures/analysis_sample.json` once pushed;
- a fake `recommend` output in the PLAN.md §7.4 shape.

Load the 3 demo fields from `research/deliverables/fields-soils/fields.geojson` until P1's `dashboard/data/demo_fields.geojson` exists. Copy it; don't reference paths outside `dashboard/`, because Pages serves only that folder.

## Step 2: the four factor cards (by 7:30 pm)

Each card shows: factor name, an icon, the headline `status.label`, the value + unit, a small **percentile bar** (p10–p90 band, median tick, a dot for now), coloured by `severity` (0 = neutral grey, up to 1 = strong orange/red), and "Since 1991: X of N years" from `recurrence.text`. Clicking a card selects that factor tab.

**Colour rules:**
- Use an accessible palette: diverging brown↔blue for water and soil, a sequential palette for heat, and a green ramp for NDVI.
- Never use colour alone; always show the text label too.
- Missing data shows grey hatching and "unavailable", never 0.

## Step 3: charts per factor in the left panel (by 8:15 pm)

Use the series from `analyzeField`. The interaction charts come from PLAN.md §5.

| Factor tab | Charts |
|---|---|
| Water balance | (1) **Supply vs demand:** cumulative rain + irrigation as stacked area vs crop demand line this season, with the normal p25–p75 band. (2) **Root-zone bucket:** depletion line with a dashed "stress starts" line (RAW). (3) **Capacity gauge:** peak 7-day demand vs well capacity in mm/day, with the shortfall text. |
| Temperature | (1) **Cumulative GDD** this year vs normal band, with crop-stage markers. (2) **Stage-aligned heat strip:** the season timeline, the sensitive window shaded, a mark on each hot day. (3) **Frost dates:** this year vs normal (dot + range). |
| Soil moisture | (1) `gwetroot` this year vs the p25/p50/p75 band. (2) **Monthly recurrence bars:** the share of years with dry root zone per month (answers "in which season does this repeat"). |
| Crop condition | (1) Field mean NDVI vs the normal band. (2) **Low-green-cover calendar:** a year × month strip. (3) **Cause check** badge: "likely water", "likely heat", or "not explained by weather: scout". |
| *All tabs* | A **compound-stress calendar** (year × month heatmap, 0–3 stressors) in a collapsible "How factors combine" section. Also a **trend line** with Sen's slope per decade **only if** `trend.shown`; otherwise show the reason. |

The **Advanced ▸** section holds: an exact values table, `data_quality` (live data through date, missing days, ET₀ method), formulas linking to `dashboard/lib/ANALYSIS.md` on GitHub, source list (from `data/sources.json`), and **Download CSV** for the selected series.

## Step 4: map + time slider (by 8:15 pm)

- **Field view:**
  - Show the field outlines, labelled **"approximate boundary"** for demo fields.
  - For Crop condition, draw `fields_ndvi.json` pixel polygons coloured by NDVI for the slider date (16-day steps, 2001 to now), with Play animating about 3 frames per second.
  - For the other factors, colour the field by its `status.severity` and show a note: "Weather data covers ~50 km; this colour is regional."
- **Region view:** draw `region_grid.json` cells coloured by the selected indicator for the slider year (1981–2025). Default colouring is the **percentile vs 1991–2020 for that cell**; a toggle switches to raw values. Pick the indicator per factor:
  - Water → `season_deficit_mm`;
  - Temperature → `hot_days_35c`, with a `gdd_may_sep` toggle;
  - Soil moisture → `gwetroot_jul`;
  - Crop condition → not available in region view (show a note).

  Add a legend, plus a hover/tap tooltip showing value, percentile and year.
- **Draw field** (Leaflet.draw polygon):
  1. Ask for a field name.
  2. Call P1's `farmStore.addField`.
  3. Fetch live POWER for the centroid with P1's `fetchPowerDaily` (1991 to today; show a spinner and "Pulling NASA POWER data…").
  4. Fetch soils with `fetchSoilForPolygon`.
  5. Run `analyzeField`.

  NDVI is "unavailable for new fields" unless P1 says the browser call works.

## Step 5: live data, farm records, recommendations (by 9:00 pm)

1. **Live data:**
   - On load, for the selected field's site, call `fetchPowerDaily` from Jan 1 this year to today and pass it as `liveDaily`.
   - Show a status chip: "Live NASA POWER through Nov 12, 2026 (~3-day delay)".
   - On failure, show a yellow banner: "Live data unavailable, showing data through <date>". **Never fill with fake values.**
2. **My farm records** (modal or full page):
   - The form for one record follows PLAN.md §7.2: year, period (season/Q1–Q4), crop, planting date, harvest date, irrigation (mm, **with an inches toggle**: 1 in = 25.4 mm), nitrogen (kg/ha, **with a lb/ac toggle**: 1 lb/ac = 1.121 kg/ha), yield + unit, and notes.
   - Field settings: name, well capacity (gpm). Farm settings: priorities slider (water / soil / income, normalised to sum to 1), annual allocation, equipment and markets checklists.
   - Add a table of past records with edit and delete.
   - Add **trend charts** of yield, irrigation and nitrogen over the years, plus P2's `farm_sensitivity` scatter (yield vs hot days), captioned "pattern, not proof".
   - Add buttons for **Export JSON**, **Import JSON** and **Load demo farm**. Show the banner "Stored only in this browser" (or "Not saved: private window" if `storage === "memory"`).
   - Re-run analysis and recommendations after every save.
3. **Right panel:** P4's `recommend(...)` output.
   - **Top 3 action cards:** title, score as a bar, and a "Why this score" popover showing the four `score_parts`. Then "Why", "Evidence" (each item shows its live/historical value + source chip), "Benefits", "Risks", "Information gaps", "When", and the **expert check** line in a distinct style.
   - A **"Focus on…" chip row** (Water / Temperature / Soil moisture / Crop condition / All). Selecting one re-calls `recommend({..., focus})` and shows the top 3 for that factor.
   - **Rotation options:** the current rotation (from the farmer's records or confirmed crop history) + 2 alternatives, shown as cards with the `rotationFit` metrics as small bar comparisons, plus each one's benefits, risks, gaps and evidence. There's **no "best" badge**.
   - **What-if:** the farmer builds a sequence (e.g. `corn → wheat → sorghum`) from `crops.json` and sees the same metrics next to the others. Add a slider "allocation: X mm" that re-runs `rotationFit` live.
4. **Season report** button: renders P4's `buildReport(...)` into a print-friendly page section, with `window.print()` producing the PDF.

## Step 6: deploy (by 9:15 pm), then QA

1. Write `.github/workflows/pages.yml`:
   - on push to `main`, use `actions/configure-pages@v5`, `actions/upload-pages-artifact@v3` with `path: dashboard`, and `actions/deploy-pages@v4`;
   - permissions `pages: write`, `id-token: write`.
   - The repo owner must enable **Settings → Pages → Source: GitHub Actions**. Ask them at 8:30 pm.
   - Fallback: drag the `dashboard/` folder into https://app.netlify.com/drop.
2. Give the URL to P4 by 9:15 pm.
3. **QA list:**
   - default load works at 1440 × 900 and 390 × 844;
   - all 4 factor tabs, both map views, and slider + play work;
   - drawing a field works end to end;
   - adding a record, export, reload, import works;
   - the live-data failure banner works (test offline in DevTools);
   - there are no console errors;
   - keyboard focus is visible;
   - no horizontal scroll on the phone.

Write `dashboard/README.md` covering how to run it locally, how to deploy, and the module map. Open a PR from `p3-dashboard` to `main`. **Push after every step.**

## Acceptance checklist

- [ ] The app loads on a public URL by 9:15 pm, and the default view is fld01 with water balance.
- [ ] The four factor cards show now vs normal, recurrence, and trend-or-reason.
- [ ] The time slider animates region cells by year and NDVI pixels by 16-day period.
- [ ] Farm records persist, export and import; the privacy banner is visible.
- [ ] Top 3 actions show score breakdowns and evidence; the focus chips work; rotation cards + what-if work.
- [ ] Missing data always shows as "unavailable", and there is a visible note that weather is regional (~50 km).
