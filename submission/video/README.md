# 30-second demo video

| File | What it is |
|---|---|
| `kimchi-demo-30s.mp4` | 29.5 s, 1920 × 1080, 30 fps, H.264. Burned-in English subtitles and an original synthesized music bed (tech, D minor). |
| `kimchi-demo-30s-silent.mp4` | The same picture with no audio track. |
| `kimchi-demo-30s.srt` | English caption track, if the upload form wants one separately. |
| `source/` | How it was made (see below). |

## Storyboard

| Time | Screen | Subtitle |
|---|---|---|
| 0–3.1 s | Hook over the blurred map | "Keep the corn, or switch? Kimchi answers with NASA data, field by field." |
| 3.2–7.4 s | Map; hovering FLD01 and FLD02 rolls out the factor badges | "Pick your field. Live NASA POWER weather and MODIS satellite data." |
| 7.4–11.6 s | Clicking through the four factor cards; the map layer changes | "Four plain checks: water, heat, soil moisture, crop condition." |
| 11.6–15.4 s | Play, 1981 → 2026 (sped up about 4×) | "Press play: how often each problem came back since 1981." |
| 15.4–19.9 s | Opening action #1 (the well vs peak demand chart) | "Top 3 actions with evidence: July peak 9.8 vs well 6.5 mm/day." |
| 19.9–23.5 s | Rotation table | "Compare rotations on the same past weather. None is ranked 'best'." |
| 23.5–26.1 s | Season report | "Every number sourced, in a season report you can print." |
| 26.1–29.5 s | End card: logo, URL, the agronomist line | "Supports your judgement. Check with K-State Extension before acting." |

Every number on screen is what the live app showed on Nov 16, 2026 (NASA POWER through Nov 12).

## Checked against the submission rules

- 30 seconds or less, with English subtitles burned in.
- Recorded from the public URL (https://kevindurantbr.github.io/kimchi/), not localhost.
- No NASA logos. "NASA POWER" and "MODIS" appear only as words.
- No AI-generated images or voice. The footage is a scripted Playwright browser driving the real app. The music is synthesized by the renderer from notes. It is not a generated recording. Use the silent copy if anyone is unsure.

## How it was made

Made with the `short-form-video` renderer from [marcosmodly/marketing-skill](https://github.com/marcosmodly/marketing-skill), using its "product demo" approach (the product's own screens, no presenter).

1. `source/record.js` drives the live app in Chromium at 1440 × 900 (2× pixels) and captures each interaction as frames with the DevTools screencast. A drawn cursor shows the clicks.
2. `source/tomp4.sh` writes an ffconcat list from each segment's frame timestamps. `source/shots.py` then trims each shot, speeds it up where needed and adds an eased camera push-in.
3. `source/page.html` lays out the shots, subtitles and end card using the skill's page conventions. Render it with:

   ```bash
   node <marketing-skill>/scripts/video/render.js page.html kimchi-demo-30s.mp4
   ```

   It expects the baked shots in `assets/` next to the page (`s0_hook.mp4` … `s6_report.mp4`) and `kimchi-logo-512.png` from `dashboard/brand/`.
