# Kimchi demo video script

**Limit: 30 seconds, with English subtitles**, or up to 7 slides including the title slide. Host it publicly on YouTube or Google Drive; it can't be uploaded to the Space Apps site. (Checked Nov 15, 8:40 pm ET from the 2025 guide plus search results for the 2026 page; spaceappschallenge.org itself returned 503. Glance at the form before uploading.) **Deadline: 11:59 pm in our Local Event's time zone; late saves aren't judged.** Use the 2-minute version at the bottom only if the form clearly allows it.

Rules for the recording:
- Record from the **public URL**, not localhost, so judges see what they can open.
- Do **not** show NASA logos (Space Apps branding rule). Say "NASA POWER" and "NASA MODIS" in words.
- No AI-generated images or voice. If any are used, they need a visible "AI-generated" watermark.
- Burn in the subtitles (the lines below), or upload them as an English caption track.
- **[[28 of 35]]** is what the engine gives for fld01 on Nov 15 (corn, 280 mm). Check it on the live app at 9:30 pm and change it if the app shows something else. **Never read a number the app doesn't show.**

## Safety take (recorded 10:00 pm, ready to upload)

`kimchi_safety_30s.mp4`: 30 s, 1440 × 900, Simple view of the live site (round 3), burned-in English subtitles, no audio. It was recorded by a scripted browser (Playwright) on the real app; nothing in it is AI-generated imagery. Screenshots `01`–`07` in `screenshots/` come from the same run. Upload this one if the round-4 re-take isn't ready by 11:20.

## Round-4 re-take (only after P3's "go"): collapsible cards and map icons

| Time | Screen | Subtitle |
|---|---|---|
| 0–4 s | Map with status icons on the pivots | "Western Kansas: the aquifer is shrinking and summers are hotter." |
| 4–8 s | Pick North pivot (fld01); colour-coded tiles | "Pick your field. NASA satellite and weather data give four plain checks." |
| 8–12 s | Press Play, 1981 → 2026 | "See how often each problem came back since 1981." |
| 12–19 s | Top 3 collapsed cards → open #1 (well vs peak chart) | "Your well can't keep up with July demand: [[9.8 vs 6.5]] mm/day." |
| 19–24 s | Open the "28 of 35 seasons short of water" card (rotation chart) → "Compare rotations ↓" | "Continuous corn ran short in [[28 of 35]] seasons. Compare it with corn–sorghum and corn–wheat." |
| 24–27 s | The rotation table, then View → Complete for 2 s | "Benefits, risks, unknowns, and every number and source." |
| 27–30 s | Back to Simple, the agronomist line | "It supports your judgement. Check with K-State before acting." |

## Safety take script (round 3, Simple view)
: record in **View: Simple**

Record from the public URL https://kevindurantbr.github.io/kimchi/ at 1440 × 900 after P3's "go" (10:00 pm freeze).

| Time | Screen | Subtitle / voice-over (≈ 75 words total) |
|---|---|---|
| 0–4 s | Map of western Kansas pivots; title "Kimchi: field risk and rotation explorer" | "Western Kansas: the aquifer is shrinking and summers are hotter." |
| 4–8 s | Field picker → North pivot (fld01); the 4 Simple tiles appear | "Pick your field. NASA satellite and weather data give four plain checks." |
| 8–12 s | Press Play: slider runs 1981 → 2026 | "See how often each problem came back since 1981." |
| 12–18 s | Right panel "What to consider": the 3 one-sentence actions | "Here: corn ran short of water in [[28 of 35]] seasons, and July demand beats the well." |
| 18–24 s | Scroll to the rotation table (current + 2 alternatives) | "Compare your rotation with corn–sorghum and corn–wheat: water, heat, bare months, risks." |
| 24–27 s | Switch View to **Complete** for 2 s | "Every number and source is one click away." |
| 27–30 s | Back to Simple; the "Check with your agronomist" line | "It supports your judgement. Check with K-State before acting." |

Shot list (one take each, then cut):
1. Title over the map (no NASA logo).
2. Field picker → fld01; hold 2 s on the four tiles.
3. Press Play; let it run about 4 s.
4. Right panel, top 3 sentences visible.
5. The rotation table, all three columns readable.
6. View → Complete (2 s) → back to Simple.
7. The expert-check / data-limits line.

**Check before recording:** the numbers on screen. On Nov 15, 9:20 pm the engine gave: continuous corn short in **28 of 35** seasons under 280 mm; peak demand above the well in 35 of 35 seasons (3.3 mm/day in 2026); about **6.9** low-green-cover months a year (satellite). If the screen shows something else, say the screen's number.

## 7-slide fallback (if the video fails to upload)

1. **Title:** Kimchi: field risk and rotation explorer. Team Kimchi, [[member names]]. Challenge: Field Shift: Adapting Farms with NASA Data.
2. **Problem:** limited water on the Ogallala, hotter summers, scattered data. The farmer's question: "Keep continuous corn, or switch? What do I do this season?"
3. **Data:** NASA POWER (1981–now, live) + NASA MODIS NDVI + USDA SSURGO + USDA CDL + the farmer's records → four factors (diagram from PLAN.md §4).
4. **Screenshot:** Simple view: four tiles + map with the time slider (`screenshots/02_factors.png`, `03_slider.png`).
5. **Screenshot:** top 3 actions with the score breakdown and evidence (`05_actions.png`).
6. **Screenshot:** the rotation comparison table, current + 2 alternatives × water, heat, bare months, benefit, risk, unknowns (`06_rotations.png`).
7. **Honesty and next steps:** data limits; no yield or profit predictions; "Review with your agronomist or K-State Research and Extension"; next: OpenET, SMAP, IMERG, HLS 30 m, farmer validation. Code and demo links.

## Screenshots to take (into `submission/screenshots/`, from the public URL)

| File | What it shows |
|---|---|
| `01_map.png` | Map with the 3 demo fields and the region grid |
| `02_factors.png` | Left panel: four factor cards for fld01 |
| `03_slider.png` | Region slider mid-animation (hot days) or the NDVI field slider |
| `04_water.png` | Water tab: supply vs demand + capacity gauge + recurrence |
| `05_actions.png` | Right panel in Simple view: the top 3 one-sentence actions |
| `06_rotations.png` | Rotation comparison table (Simple) |
| `07_complete.png` | Same screen in Complete view: score parts, sources |
| (optional) `07_report.png` | Printed season report |

Use deviceScaleFactor 2 or a retina screen; crop to the app and hide bookmarks and personal tabs.

## 2-minute version (only if the official limit allows it)

1. 10 s: the problem in western Kansas: a shrinking aquifer and hotter summers.
2. 20 s: open the app; fld01; the four factor cards.
3. 20 s: the region slider from 1981 to 2025 (hot days); the NDVI field slider.
4. 20 s: the water tab: supply vs demand, the capacity gauge, "[[28 of 35]] seasons".
5. 20 s: the right panel: top 3 actions with the score breakdown and evidence; the focus chip.
6. 20 s: the rotation cards + the what-if slider for the allocation.
7. 10 s: farm records → the season report.
8. 10 s: honesty: data limits and "check with your agronomist".
