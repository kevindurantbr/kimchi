# Prompt for Person 4: crop and action libraries, top-3 recommendations, season report, submission

> Copy everything below this line into your AI assistant, together with the repository's `PLAN.md`.

---

## ▶ ROUND 4: start here (9:55 pm → submit by 11:35)

Read PLAN.md §13. **You now own `dashboard/ui/recs.mjs`** (the cards) for tonight. Branch from the latest `main`: `p4-round4`.

1. **(9:55–10:10) Record a SAFETY video now** from the live site as it is (Simple view, following `submission/VIDEO_SCRIPT.md`), plus 6 screenshots. If round 4 breaks anything, this is what we submit.
2. **(by 10:30) Collapsible action cards at all three levels** (`ui/recs.mjs`). Each top-3 card is **collapsed by default** and shows on one line:
   - the factor icon and colour (PLAN.md §13 table);
   - the **problem** in ≤ 8 words;
   - the **result in bold**, e.g. "**28 of 35** seasons short of water".

   A click or Enter **expands** it (`aria-expanded`, keyboard accessible). The expansion contains:
   - **a chart first**: a Chart.js bar chart from P2's `analysis.charts`. W-actions get water shortfall by year with the normal line; T-actions get hot days by year; S-actions get soil by month; C-actions get greenness by month. **W4 and rotation actions** get a grouped bar comparing the current rotation and alternatives (from `rotationTable()`: short-on-water years, heat years, low-cover months);
   - then `card.short`, the benefits, risks and gaps;
   - then the "Ask your agronomist" line.

   Simple shows the chart + `card.short` + agronomist line. Moderate adds why, evidence and benefits/risks/gaps. Complete adds the score parts and source IDs.

   For **W4**, add a "Compare rotations ↓" link that scrolls to the rotation table, so the farmer no longer scrolls blindly. If a chart's data is missing, show "Chart unavailable: <reason>", never an empty canvas.
3. **(by 10:40) Write-up additions** in `submission/WRITEUP.md`. Add a short "How it works" section:
   - the analysis is code running in the browser on every visit, with no AI at runtime;
   - NASA POWER is pulled live, and a daily GitHub Action refreshes the history;
   - new fields pull 45 years of NASA data in ~2 s.

   Also add "Next steps: farmer accounts so each farmer's fields and records sync across their devices (hosted database); SMAP; observed ET (MOD16/OpenET); IMERG; HLS 30 m".
4. **(10:50–11:20)** If P3 says "go", re-record using the new collapsible cards and map icons. Otherwise use the safety take.
5. **(by 11:35) Submit**, and post the confirmation screenshot.

---


## ▶ ROUND 3: start here (9:05 pm → submit 11:15 pm)

Read PLAN.md §8 (status), §11 (detail levels) and §12 (data coverage). Your PR #20 is being merged by P3 at 9:05; if it needs a rebase, do that first. Branch: `p4-round3`.

1. **(by 9:30) Short text for the Simple view** (PLAN.md §11).
   - Add `card.short` to every recommendation: **one sentence**, under 25 words, with a number and no jargon. For example: "Continuous corn ran short of water in 28 of 35 past seasons under your 280 mm (11 in) allocation. Compare corn–sorghum or corn–wheat."
   - Keep `expert_check` on every card.
   - Never put "unavailable" inside a sentence; drop the clause instead, e.g. "about unavailable mm/day" must not appear.
2. **(by 9:40) `rotationTable({ rotations })`** in `recommend.mjs`. Return one row per metric for the current rotation + 2 alternatives:
   - short on water X of N;
   - heat at pollination X of N, using P2's above-normal metric if present, else "≥ 1 hot day at pollination X of N";
   - months with low green cover;
   - main benefit;
   - main risk;
   - what we don't know.

   P3 renders it in the Simple view. This is the challenge's core "compare ≥ 3 rotations including the current one", so it must be visible at the default level. Add a test.
3. **(9:45–10:00) Write-up.**
   - Add the §12 data-coverage paragraph to `submission/WRITEUP.md`: what we use, what we deferred, why, and what's next (SMAP, observed ET via MOD16/OpenET, IMERG, HLS, QuickStats).
   - Add the 3 detail levels as a design point: farmer-first, with the Complete view for experts.
   - Link the live URL, DATA.md and ANALYSIS.md.
   - Fill every `[[FILL]]`.
4. **(10:00–10:45) Record the video in Simple view** (30 s if the 2026 rules match 2025; confirm). Suggested beats:
   1. problem;
   2. pick the field → 4 tiles;
   3. slider playing 1981 → 2026;
   4. top-3 "What to consider";
   5. the rotation table;
   6. switch to Complete for 2 seconds ("every number and source is here");
   7. "Check with your agronomist".

   Take 6 screenshots.
5. **(by 11:15) Submit** and post the confirmation in the team chat.

---


You are helping build **Kimchi**, a NASA Space Apps 2026 project for the "Field Shift: Adapting Farms with NASA Data" challenge. Repository: https://github.com/kevindurantbr/kimchi. **Read `PLAN.md` first**; it is the source of truth for scope, contracts and the timeline. The deadline is **tonight, Nov 15, 11:59 pm Eastern**. You also own the **submission**, so protect 9:30–11:15 pm for the video and write-up.

## Your role

You turn the analysis into **decision support**: the top 3 actions, the rotation comparison cards, and the season/quarter report. Then you package the project for judging. The tool **supports** the farmer's judgement and never replaces it, and the challenge text says so explicitly.

You own these files and **must not edit any other file**:

```
dashboard/data/crops.json
dashboard/data/actions.json
dashboard/lib/recommend.mjs
dashboard/lib/recommend.test.mjs
dashboard/lib/report.mjs
submission/WRITEUP.md
submission/VIDEO_SCRIPT.md
submission/screenshots/*.png
```

Your inputs:
- P2's `analyzeField` output (`dashboard/lib/fixtures/analysis_sample.json` arrives first) and `rotationFit` output;
- P1's farm records (PLAN.md §7.2) and `data/sources.json`;
- the existing evidence base in `research/deliverables/agronomy/agronomy.json` (21 sources, 15 rules) and `agronomy_findings.md`. **Reuse its source ids (`T1_...`)**.

## Step 0: set up (5 min)

```bash
git clone https://github.com/kevindurantbr/kimchi.git && cd kimchi && git switch -c p4-recs
```

Read `research/deliverables/agronomy/agronomy_findings.md` (10 min). It explains why continuous corn, corn–sorghum and corn–winter wheat are the evidence-backed candidates under limited irrigation in western Kansas.

**Also now:** open the team's Space Apps project page or submission form and write down the **exact** submission requirements: required fields, video length limit, slides, demo link, AI-use disclosure, and the deadline with its time zone. Post them in the team chat. Everything in Step 5 depends on this.

## Step 1: `crops.json` (by **6:45 pm**)

Three crops plus fallow:
- `corn`
- `sorghum` (grain)
- `winter_wheat`
- `fallow` (no crop; demand = bare-soil evaporation, Kc ≈ 0.3, flagged as a rough value)

Shape (P2 codes against this; keep the keys):

```jsonc
{ "crops": [{
  "id": "corn", "name": "Corn (grain)", "family": "grass",
  "season": { "plant": "04-25", "harvest": "10-05", "plant_window": ["04-20","05-15"] },
  "gdd_base_c": 10, "gdd_cap_c": 30, "gdd_to_silking_c": 780, "gdd_to_maturity_c": 1500,
  "sensitive_window": { "name": "pollination", "gdd_from": 700, "gdd_to": 900 },
  "heat_threshold_c": 35,
  "kc": { "ini": 0.3, "mid": 1.2, "end": 0.6, "stage_days": [30, 40, 50, 30] },
  "root_depth_m": 1.5, "p_depletion": 0.55,
  "frost_free_days_needed": 140,
  "source_ids": ["FAO56", "..."], "verify": ["gdd_to_maturity_c depends on hybrid relative maturity"] }] }
```

Starting values to **verify or replace** with sources:
- **Kc:** FAO-56 Table 12 gives maize ini 0.3, mid 1.20, end 0.60; sorghum 0.3 / 1.00–1.10 / 0.55; winter wheat 0.4 / 1.15 / 0.25–0.4. For stage lengths, use the row in FAO-56 Table 11 closest to the US Great Plains.
- **GDD:** K-State corn guidance in °F, divided by 1.8 to get °C·days. Silking is about 1,400 °F GDD for a full-season hybrid.
- **Winter wheat:** sown late Sep to mid Oct and harvested late Jun to early Jul. Its sensitive window is flowering/grain fill in May–June. Use the agronomy package's calendar notes.
- **If you can't source a number, set it to `null`** and add it to `verify`. P2 treats a null as "not evaluated", which is better than a made-up value.

## Step 2: `actions.json` (by 7:15 pm)

About 12 actions. Each has a **trigger** evaluated against the analysis output:

```jsonc
{ "actions": [{
  "id": "W1_irrigation_timing", "factor": "water", "category": "in_season",
  "title": "Check irrigation timing: root zone is past the stress point",
  "trigger": { "all": [ { "path": "factors.water.bucket.stress_days", "op": ">", "value": 0 } ] },
  "severity_path": "factors.water.status.severity",
  "priority_tags": ["water"], "months": [5,6,7,8,9],
  "evidence_level": "A",                       // A = regional field trial / extension research; B = general extension guidance; C = rule of thumb
  "why_template": "Estimated root-zone depletion has passed the point where corn starts to lose yield (FAO-56 p = 0.55) on {stress_days} days this season.",
  "benefits": ["..."], "risks": ["..."], "gaps": ["Estimated from regional weather (~50 km) and SSURGO soil storage, not a probe in your field."],
  "expert_check": "Confirm with a soil probe or K-State KanSched before changing your schedule.",
  "source_ids": ["FAO56", "T1_..."] }] }
```

Write these (adjust the wording, and keep sources honest):

| id | Factor | Trigger idea | Category |
|---|---|---|---|
| W1 | water | bucket stress days > 0 this season | in-season |
| W2 | water | allocation is limited and the sensitive window is approaching: "prioritise water around pollination" | in-season |
| W3 | water | `capacity.ok == false`: the well can't meet peak demand, so consider fewer irrigated acres or a lower-peak crop on part of the pivot (flag that phase-split accounting isn't modelled) | planning |
| W4 | water | `rotation_fit` shortfall in ≥ 1/3 of years for the current rotation → compare corn–sorghum / corn–wheat | planning |
| T1 | temperature | `stage_heat` above normal in ≥ 1/3 of years: consider planting date or hybrid maturity to move pollination | planning |
| T2 | temperature | planting within the typical last-frost window, or soil too cold: wait or watch the forecast | in-season (Mar–May) |
| T3 | temperature | rotation includes wheat after corn: check that corn harvest leaves time for timely wheat sowing (agronomy rule on the wheat handoff) | planning |
| S1 | soil_moisture | root zone below p25 before planting: consider the pre-plant water decision and residue retention | in-season (Mar–May) |
| S2 | soil_moisture | long low-green-cover periods and dry topsoil: keep residue / no-till to cut evaporation and wind erosion | planning |
| C1 | crop_condition | `cause_check.code == "not_weather"`: scout for pests, nutrients, hail or irrigation uniformity | in-season |
| C2 | crop_condition | `cause_check.code` is `water` or `heat`: links back to W1/T1, "stress visible from space" | in-season |
| C3 | crop_condition | many low-green-cover months: consider a rotation with winter wheat; a cover crop **only after a water check**, because cover crops use water | planning |

**Never** promise a yield or water saving. Corn, sorghum and wheat are all grasses, so there's no automatic "family break" credit (see guardrail 10 in `PROJECT_CONTEXT.md`).

## Step 3: `recommend.mjs` (by **8:00 pm**)

```js
export function recommend({ analysis, farm, field_id, crops, actions, rotationsFit, focus = null, today = new Date() })
// → { top3: [card], all: [card], rotations: [rotationCard], generated_at }
```

1. **Evaluate triggers** with a tiny safe evaluator over `path` / `op` (`> >= < <= == != in`) / `value`, using `all` and `any`. **No `eval`.**
2. **Score each triggered action** = `severity × priority × evidence × timing`, where:
   - `severity` = the value at `severity_path` (0–1), or 0.5 if missing;
   - `priority` = max(0.2, Σ `farm.priorities[tag]` over `priority_tags`), so nothing is ever zeroed out;
   - `evidence` = A 1.0, B 0.7, C 0.4;
   - `timing` = 1.0 if the current month is in `months`, 0.6 if within the next 3 months, 0.3 otherwise.

   Keep all four parts in `score_parts`.
3. **Top 3:** sort by score, allowing at most 2 from the same factor unless `focus` is set. **`focus`** (`water`, `temperature`, `soil_moisture` or `crop_condition`) filters to that factor's actions; if fewer than 3 trigger, return the top non-triggered "watch" items with `status: "watch"` and the reason.
4. **Card:** `{ id, title, factor, category, score, score_parts, why: [filled why_template + the 2 strongest supporting numbers], evidence: [{ text, value, kind: "live"|"historical"|"farm_record", source_ids }], benefits, risks, gaps, expert_check, when }`. Evidence has to cite **actual values** from the analysis or the farmer's records. For example: "July root-zone wetness 0.31 (p12, NASA POWER, live through Nov 12)" and "Shortfall in 14 of 35 seasons under 280 mm allocation".
5. **Rotation cards:** the **current** rotation (from the farmer's records, else the confirmed crop history, else "unknown: please confirm") plus 2 alternatives from {continuous corn, corn–sorghum, corn–winter wheat}, excluding the current one. Each card combines P2's `rotationFit` metrics with the `benefits`, `risks` and unresolved inputs taken from the matching candidate in `agronomy.json`, along with its source ids. Add `why_suggested`, for example "Shifts part of the water demand to spring; addresses your recurring July shortfall (14 of 35 years)". **There's no winner field.**
6. **Tests:** `node --test dashboard/lib/recommend.test.mjs` should cover the trigger evaluator, score maths, the factor-diversity rule, focus filtering, "watch" fallback, and rotation card selection when the current rotation is unknown.

## Step 4: `report.mjs` (by 8:30 pm)

`buildReport({ analysis, recs, farm, field, period })` → `{ title, period, sections: [{ heading, items }] }`, which P3 renders and prints. Sections:
1. **This period at a glance:** the 4 factors, each with a label and severity.
2. **What is in danger:** factors with severity ≥ 0.5, with where and how severe.
3. **How often this happens:** recurrence and season.
4. **Top 3 recommended actions:** with evidence.
5. **Rotation outlook:** the rotation cards.
6. **Your records this period:** the farmer's entries.
7. **Data used and limits.**
8. **"Review with your agronomist or K-State Research and Extension before acting."**

## Step 5: submission (draft by 8:30 pm, final by 11:00 pm)

1. `submission/WRITEUP.md`, matching the official form's fields:
   - title: **Kimchi: field risk and rotation explorer**;
   - a one-paragraph summary;
   - the problem;
   - what it does: the 4 factors → now / where / how often / trend → top 3 actions + rotation comparison + farm records;
   - **NASA data used and how** (POWER, MODIS), plus partner and other data (USDA SSURGO, CDL);
   - the deferred datasets and why (from P1's `sources.json` `deferred` list; mention that OpenET needs only a free account and the adapter already exists);
   - methods (link `dashboard/lib/ANALYSIS.md`);
   - factor interactions (PLAN.md §5);
   - limitations and guardrails (PLAN.md §9);
   - next steps: OpenET, SMAP, IMERG, HLS 30 m, farmer and expert validation;
   - team;
   - an **AI-use disclosure** if the rules require it.

   Map the write-up to the challenge text explicitly: "compare at least three rotation strategies including the existing rotation", "why suggested / evidence / benefits / gaps / risks", "highlight times when fields are typically bare", "farmer inputs and priorities", "support, not replace, farmer judgment".
2. `submission/VIDEO_SCRIPT.md`: fit it to the official length limit, about 2 minutes if there is none. The storyboard:
   1. 10 s: the problem in western Kansas: a shrinking aquifer and hotter summers.
   2. 20 s: open the app; fld01; four factor cards.
   3. 20 s: region slider from 1981 to 2025 (hot days); NDVI field slider.
   4. 20 s: water tab: supply vs demand, capacity gauge, "14 of 35 years".
   5. 20 s: right panel: top 3 actions with score breakdown and evidence; focus chip.
   6. 20 s: rotation cards + what-if slider for the allocation.
   7. 10 s: farm records → season report.
   8. 10 s: honesty, i.e. data limits and "check with your agronomist".
3. **9:30 pm:** record from the **public URL** P3 gives you. Take 6 screenshots into `submission/screenshots/`.
4. **11:00 pm:** submit with the demo URL, repo URL, video and write-up. Then post a confirmation screenshot in the team chat.

Open a PR from `p4-recs` to `main` for the code by 8:30 pm. Push the submission files whenever they change.

## Acceptance checklist

- [ ] `crops.json` and `actions.json` pushed by 7:15 pm; every number has a source or is null with a `verify` note.
- [ ] `recommend` returns top 3 with score breakdowns, evidence quoting real values, and the expert-check line; focus works.
- [ ] Rotation cards cover the current rotation + 2 alternatives, with no winner label.
- [ ] The season report prints cleanly.
- [ ] The write-up explicitly answers every element of the challenge objective.
- [ ] Submitted before 11:15 pm, with the confirmation posted.
