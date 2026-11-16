# Kimchi dashboard

Static web app for the NASA Space Apps 2026 "Field Shift" challenge: field risk for four factors (water balance, temperature, soil moisture, crop condition), top 3 actions and rotation comparison. Plain HTML, CSS and ES modules. No build step and no npm.

## Run locally

From the repository root:

```bash
python3 -m http.server 8080 --directory dashboard
```

Open http://localhost:8080. Use HTTP, not `file://`, because the app fetches JSON and imports modules.

## Deploy

`.github/workflows/pages.yml` publishes `dashboard/` to GitHub Pages on every push to `main` that touches `dashboard/`.

1. The repository owner sets **Settings → Pages → Source: GitHub Actions** once.
2. Merge to `main`. The Actions tab shows the deploy and the public URL (`https://<owner>.github.io/kimchi/`).
3. Fallback: drag the `dashboard/` folder onto https://app.netlify.com/drop.

## How real data replaces the samples

`ui/integrate.mjs` looks for each teammate's files and uses them as soon as they exist. Until then it loads labelled samples from `ui/_fixtures/` and the **SAMPLE DATA** chip in the top strip lists exactly which parts are sample.

| Part | Real source (owner) | Sample until then |
|---|---|---|
| Live NASA POWER | `lib/sources.mjs` `fetchPowerDaily` (P1) | `ui/_fixtures/power.mjs`: same endpoint, real data |
| Soil for drawn fields | `lib/sources.mjs` `fetchSoilForPolygon` (P1) | none (shown as unavailable) |
| Farm records store | `lib/farmStore.mjs` (P1) | `ui/_fixtures/farmStore.mjs`: same API, localStorage |
| Demo fields | `data/demo_fields.geojson` (P1) | copy of `research/deliverables/fields-soils` (real outlines, soils, crop history) |
| History, region grid, NDVI | `data/site_history.json`, `data/region_grid.json`, `data/fields_ndvi.json` (P1) | synthetic values, marked `fixture` |
| Analysis | `lib/analysis.mjs` `analyzeField`, `rotationFit` (P2) | `lib/fixtures/analysis_sample.json`, else `ui/_fixtures/analysis_sample.json` |
| Recommendations | `lib/recommend.mjs` + `data/crops.json`, `data/actions.json` (P4) | `ui/_fixtures/recommend_sample.json` |
| Season report | `lib/report.mjs` `buildReport` (P4) | `ui/report.mjs` fallback with the same output shape |

The what-if rotation shows no numbers until P2's `rotationFit` and the POWER history are present. It never estimates without them.

Delete `ui/_fixtures/` once every row above is real. The browser console shows 404s for files that are not pushed yet; they stop when the files exist.

## Module map

| File | Role |
|---|---|
| `index.html` | Layout: top strip, command bar, left panel, map, right panel, dialogs. Pinned CDN libraries: Leaflet 1.9.4, Leaflet.draw 1.0.4, Chart.js 4.4.1. |
| `styles.css` | Theme tokens (dark and light), layout, mobile bottom sheets (< 800 px), print styles for the report. |
| `app.js` | State, boot, wiring, map layers and time slider logic, live data, drawing a field. |
| `ui/integrate.mjs` | Loads teammates' modules and data with sample fallbacks; records data status. |
| `ui/map.mjs` | Leaflet map: imagery and OSM basemaps, fields, region cells, NDVI pixels, drawing, cursor readout. |
| `ui/slider.mjs` | Time slider: previous, next, play (about 3 frames per second). |
| `ui/panels.mjs` | Factor cards and per-factor charts, compound-stress calendar, advanced section, CSV download. |
| `ui/charts.mjs` | Chart.js wrappers themed from CSS variables. |
| `ui/recs.mjs` | Top 3 action cards, rotation cards, what-if builder. |
| `ui/farmForm.mjs` | My farm records: record form with unit toggles, settings, table, trends, export and import. |
| `ui/report.mjs` | Season report dialog; fallback `buildReport`. |
| `ui/util.mjs` | Formatting, escaping, colour ramps. |

## Visual direction

Chosen by the team on Nov 15 from three options: "Satellite instrument", refined to an analyst-workstation look.

- Slate chrome (dark by default, light mode in the toolbar) so imagery and data colours carry the screen.
- One accent, amber, for selection, live state and the first-ranked action. Red-orange only for high severity. Data colours are separate ramps: brown to blue for dry to wet, yellow to red for heat, tan to green for NDVI.
- IBM Plex Mono for coordinates, dates and readouts so digits align. IBM Plex Sans Condensed for labels to fit narrow panels.
- Square corners, hairlines and corner brackets as the identity motif. Motion is limited to the slider's Play.

## Guardrails shown in the UI

- Missing values show "unavailable" or grey hatching, never 0.
- Weather is regional (about 50 km); the map says so in field view.
- Demo field boundaries are approximate (dashed outline). The demo farm is labelled synthetic.
- Farm records stay in the browser; the records screen says so.
- Rotations get fit indicators only, never a "best" label. Every action and rotation card ends with "Check with your agronomist / K-State Extension before acting."
