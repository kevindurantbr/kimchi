# Round 2 tasks (7:15 pm → 9:30 pm feature freeze)

**Written Nov 15, 7:05 pm Eastern**, after merging all four branches locally and running the combined app in a headless browser at 1440 × 900. Give your AI this file, `PLAN.md` and your original prompt in `team/`. File ownership is unchanged from PLAN.md §7.

## What round 1 delivered

| Person | PR | Delivered | Self-reported gaps |
|---|---|---|---|
| P1 data | [#11](https://github.com/kevindurantbr/kimchi/pull/11) (`claude/new-session-tp0ohw`) | POWER 1981-01-01 → 2026-11-12; 25-cell × 45-year region grid; MODIS NDVI for fld01–fld03; SSURGO fetcher (matches the research values); farm store; synthetic demo farm; 54 sources + 19 deferred | ORNL unreachable from the cloud, so NDVI came from Planetary Computer, which is **missing 11 composites, incl. Jul–Nov 2025**. ORNL browser CORS is unverified. The hot/dry years are 2022 and 2024, not 2023. |
| P2 analysis | [#13](https://github.com/kevindurantbr/kimchi/pull/13) (`p2-analysis`) | All factors, interactions and `rotationFit`; real-data fixture; ANALYSIS.md; 23 tests | Browser timing unverified (Node takes 0.6–0.75 s, so it's fine). |
| P3 dashboard | [#12](https://github.com/kevindurantbr/kimchi/pull/12) (`p3-dashboard`) | Full app, Pages workflow, keyboard field entry, mobile layout | Needs merges to `main` plus Pages enabled. |
| P4 recs + submission | [#10](https://github.com/kevindurantbr/kimchi/pull/10) (`claude/new-session-ncadlb`) | crops, 12 actions, `recommend`, report, write-up draft, video script, 20 tests | Field names in `deriveContext()` were guessed. **The 2025 rules limit the video to 30 s (or 7 slides)**; confirm for 2026. |

**Integration result:** all four branches merge into `main` with **no conflicts**. 43 of 43 tests pass, there are no JavaScript errors, and the "sample data" chip reads 0 of 10, so everything is real data.

## New issues found in the integrated app (these drive round 2)

| # | Severity | Issue | Root cause | Owner |
|---|---|---|---|---|
| 1 | **Blocker for the demo** | On the default load (fld01, today), **all four factor cards say "Status unavailable for this field"**. | `analyzeField` needs a crop record for the current year (2026). The demo farm stops at 2025, so the crop is null and every status is null. A drawn field with no records hits the same problem. | P2 (fallback) + P1 (2026 demo records) |
| 2 | High | Soil moisture and crop condition stay unavailable even when a 2026 crop exists. | Status reads the value *on today's date*. POWER lags about 3 days and the last NDVI composite is Oct 16, so both are null "today". | P2 |
| 3 | High | The top-3 card says "**Above-normal** heat in the sensitive window: **33 of 35 years**", which is impossible. | `rotationFit.sensitive_heat_years` counts years with **any** hot day in the window (value > 0), but P4 labels it "above normal". | P2 (add an above-normal metric) + P4 (label) |
| 4 | Medium | Card text shows "28 of 35 years seasons" and an unrounded value, "108.45232154626308". | Template grammar; no number formatting. | P4 (+ P3 formats every number on display) |
| 5 | Medium | Labels like "Drier than 28% of years" appear when the field is actually *wetter* than 72%, which reads as alarming. | The label wording ignores the direction. | P2 |
| 6 | Medium | No NDVI for the 2025 growing season (Jul–Nov 2025 missing), so crop condition can't be shown for the last full season. | Planetary Computer catalogue gaps. ORNL *does* work from a normal internet connection: PR #8's teammate pulled MOD16 from it. | P1 |
| 7 | Medium | First load takes about 10 s before the panels fill. | Everything waits for the live POWER fetch. | P3 |
| 8 | Ops | Nothing is on `main`, PLAN.md included, and GitHub Pages isn't enabled, so there's no public URL yet. | Merges are pending. | P3 + repo owner |

## Timeline for round 2

| Time | Checkpoint |
|---|---|
| **7:15 pm** | P3 merges to `main` in this order: plan branch `claude/charming-mccarthy-sg5dya` → #11 → #13 → #10 → #12. The owner enables Pages. **Everyone rebases on the new `main`.** |
| **8:15 pm** | Fixes for issues 1–6 pushed as small PRs; P3 merges them as they arrive. |
| **8:45 pm** | Public URL shows the full demo path with real data and no "unavailable" on the default view. |
| **9:30 pm** | **Feature freeze.** P4 records the video from the public URL; everyone else does QA and fixes text only. |
| **11:15 pm** | P4 submits. |

---

## Person 1: data (round 2)

You own the same files as before. Use a new branch from the updated `main`: `p1-round2`.

1. **(by 7:45) Add a 2026 season to `dashboard/data/demo_farm.json`.** This fixes issue 1 for the demo.
   - Add one `"period": "season"` record for 2026 to each field, labelled synthetic like the rest:
     - fld01: `corn`, planted `2026-04-28`, harvested `2026-10-08`.
     - fld02: `corn` (after 2025 wheat), planted `2026-05-02`, harvested `2026-10-12`.
     - fld03: `corn`, planted `2026-04-30`, harvested `2026-10-10`.
   - Use plausible irrigation and nitrogen values, and leave yield `null` (not harvested data yet) or plausible; mark it synthetic either way.
   - Keep `validateFarm` passing.
2. **(by 8:15) Fill the NDVI gaps from ORNL (issue 6).** Run this from your own laptop, not the cloud:
   ```bash
   node scripts/smoke.mjs --ndvi
   ```
   - If ORNL answers, re-run `node scripts/precompute.mjs ndvi --ndvi-source=ornl` **only for the missing composites** (2023 ×1, 2024 ×2, Jul–Nov 2025 ×8, and anything after 2026-10-16). Merge them into `fields_ndvi.json` in date order.
   - Record the source per composite (`MODIS_MOD13Q1_ORNL` vs `MODIS_MOD13Q1_PC`), or a top-level note listing which dates came from which source.
   - Don't change existing values.
3. **(by 8:30) Check whether ORNL allows browser calls.** Open a page on `http://localhost` and call `fetchModisNdvi` from the browser console. Tell P3 the yes/no answer:
   - yes: drawn fields can show crop condition;
   - no: keep the "unavailable for new fields tonight" message.
4. **(by 8:45) Refresh the live data.** Re-run `precompute site` so `site_history.json` ends at the latest available POWER day. Re-run the `fields` sub-command only if needed.
5. **(9:00–10:30) Help the submission.** Write `submission/DATA.md`: one table of every dataset used, with product/version, resolution, period, latency, access method and retrieval date, plus the deferred list with reasons. P4 links it from the write-up. This is a new file; P1 owns it.

---

## Person 2: analysis engine (round 2)

You own the same files as before. Branch: `p2-round2`.

1. **(by 7:50) Crop-independent fallback (issue 1).** When the current year has no crop record, `analyzeField` must still return statuses for everything that doesn't need a crop:
   - Temperature: hot days Jun–Aug season-to-date, GDD from May 1, and frost dates.
   - Soil moisture: `gwetroot`.
   - Crop condition: NDVI.
   - Water: rain minus ET₀ with Kc = 1.0 from May 1. Label it "**reference** water balance (no crop selected)".

   Set `analysis.crop_context = { crop: null, mode: "crop_independent", prompt: "Enter this season's crop in My farm records for crop-specific demand and stage heat." }`. When a crop exists, set `mode: "crop_specific"`. Add tests.
2. **(by 8:00) Use the latest valid value, with an "as of" date (issue 2).** For soil moisture use the last non-null value ≤ 7 days before `today`; for NDVI use the latest composite ≤ 32 days before `today`. Compare it with the climatology **for that as-of date**. Add `as_of` to every status. If nothing is that recent, keep null with the reason "latest value is older than N days".
3. **(by 8:10) Out-of-season view.** If `today` is after the crop's harvest date, or between Nov 1 and Mar 31, return the **completed-season summary** for this year as the headline (the season deficit, hot days in the window, etc.) with `period: "2026 season (completed)"`, instead of comparing "this date". P3 shows `period` on each card.
4. **(by 8:15) Fix the heat metric (issue 3).** In `rotationFit`, add `sensitive_heat_above_normal_years`: years where hot days in the sensitive window exceed that window's 1991–2020 median, given as "X of N years". Keep `sensitive_heat_years` but **rename its meaning in ANALYSIS.md** to "years with at least one hot day in the window". Expose `interactions.stage_heat.recurrence = { text, share, definition }` using the above-normal definition. P4 reads this path.
5. **(by 8:20) Direction-aware labels (issue 5).**
   - Water balance or soil moisture above the median: "Wetter than 72% of years for this date".
   - Below the median: "Drier than 84% of years…".
   - Hot days: "More hot days than 71% of years" when above the median, "Fewer hot days than 89% of years" when below.
   - Update the tests.
6. **(by 8:25) Contract check with P4.** P4's PR #10 lists the fields `deriveContext()` reads: `interactions.capacity.{peak_mm_day, well_mm_day, shortfall_mm_day, ok, text}`, `interactions.stage_heat.recurrence`, `factors.crop_condition.green_cover_calendar.mean_low_months_per_year`, and `rotation_fit[].rotation_id`. Make sure each one exists in your real output, or agree a rename with P4 in chat. Then regenerate `analysis_sample.json` from real data **for today**.
7. Add `display` strings, or round numeric outputs that the UI shows, to 1 decimal place (mm, days) or 2 (NDVI, wetness), so values like 108.45232154626308 can't reach the screen.

---

## Person 3: dashboard + integration (round 2)

You own the same files as before. Branch: `p3-round2`. **You do the merges.**

1. **(7:15) Merge to `main`** in order: the plan branch (`claude/charming-mccarthy-sg5dya`: PLAN.md, `team/`, updated README/PROJECT_CONTEXT) → #11 → #13 → #10 → #12.
   - They merge cleanly; this was tested locally.
   - Ask the owner to enable **Settings → Pages → Source: GitHub Actions**.
   - Confirm the workflow deploys and post the URL in the team chat.
   - Then merge round-2 PRs as they arrive, running `node --test dashboard/lib/*.test.mjs` before each merge.
2. **(by 8:00) Faster first paint (issue 7).**
   - Render the map, the cards (from `site_history` + the precomputed data) and the recommendations immediately.
   - Run the live POWER fetch in the background; when it lands, re-run analysis, then update the chip and panels.
   - Show a small "updating with live data…" indicator.
   - Target under 3 s to first useful screen.
3. **(by 8:20) Show P2's new fields.**
   - Each card shows the `period` and `as_of` date, e.g. "2026 season (completed) · as of Nov 12".
   - When `crop_context.mode === "crop_independent"`, show a banner on the water card: "No crop entered for this season: showing reference water balance. [Enter this season's crop]". The link opens My farm records with the field preselected.
   - Format every number through one `fmt()` helper (issue 4).
4. **(by 8:30) Delete `dashboard/ui/_fixtures/`** once everything is real, and confirm the sample-data chip disappears or reads "all real data".
5. **(by 8:45) Make the demo path solid**, because P4 records it at 9:30:
   1. Default view: fld01, water balance.
   2. Region view: play the slider 1981 → 2025 for hot days.
   3. Field view: crop condition, NDVI pixels playing through 2025.
   4. Right panel: top 3 + "Why this score" + one focus chip.
   5. Rotation cards + what-if slider.
   6. My farm records → add a 2026 record → the cards update.
   7. Season report → print preview.

   Click through all of it on the **public URL** at 1440 × 900 and on a phone, fix anything broken, and give P4 a one-line "go" message.
6. **(after 9:30) Bug fixes only.**

---

## Person 4: recommendations + submission (round 2)

You own the same files as before. Branch: `p4-round2`. **Protect 9:30–11:15 for the submission.**

1. **(by 7:45) Confirm the 2026 rules.**
   - Open the official 2026 Space Apps submission form or guide and confirm: the video length (the 2025 limit was **30 s**) or the 7-slide alternative, subtitles, required fields, the AI-use disclosure wording, and **the deadline time zone**.
   - Post them in the team chat. If the deadline is earlier than 11:59 pm Eastern, tell everyone immediately.
2. **(by 8:15) Wire `recommend` to the real analysis.**
   - Rebase on `main`, then run `recommend` on the **real** `analyzeField` output (real data files, today's date). Use P2's regenerated fixture, or call `analyzeField` in a test.
   - Fix `deriveContext()` to read P2's actual paths (see P2 task 6 for the list).
   - Add one integration test: real data in, 3 cards out, no `undefined`/`NaN`/unrounded numbers in any text.
3. **(by 8:20) Fix the card text (issues 3 and 4).**
   - T1 must use P2's `stage_heat.recurrence` (above-normal definition) and say "Above-normal heat during pollination in X of N years". If only `sensitive_heat_years` exists, say "At least one ≥ 35 °C day during pollination in X of N years".
   - Fix "28 of 35 years seasons" to read "28 of 35 seasons".
   - Round every value you interpolate: mm and days to whole numbers, NDVI to 2 decimals.
4. **(by 8:30) Out-of-season wording.** In November, in-season actions (W1, W2, C1, C2) shouldn't fill the top 3 unless they are about the completed season. Make sure planning actions come first; your timing weight probably already does this, so verify it on today's real output.
5. **(8:30–9:30) Finish `submission/WRITEUP.md`.**
   - Fill every `[[FILL]]`.
   - Link `submission/DATA.md` (P1) and `dashboard/lib/ANALYSIS.md` (P2).
   - Add the public URL from P3.
   - Add a short "What we found" box with 3 real numbers from the app, for example "Continuous corn would have run short under a 280 mm allocation in 28 of 35 seasons". Use the numbers the app actually shows at 9:30.
6. **(9:30–10:45) Record the video to the confirmed limit**, following P3's demo path, with English subtitles. Take 6 screenshots into `submission/screenshots/`. Use the 7-slide fallback if recording fails.
7. **(by 11:15) Submit:** demo URL, repo URL, video/slides and write-up. Post the confirmation screenshot in the team chat.

---

## Not in round 2 (don't start these tonight)

- OpenET.
- MODIS ET (MOD16) from PR #8 in the new dashboard. It's a good next step, and the write-up can mention it.
- SMAP, IMERG, HLS 30 m.
- Merging the old PRs #5–#8 into `interface/`.
