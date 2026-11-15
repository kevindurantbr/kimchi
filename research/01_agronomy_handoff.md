# Teammate 1 crop rotation evidence

You are researching a NASA Space Apps prototype for an irrigated farmer in Sheridan 6, western Kansas. The app compares the existing rotation with two alternatives under constrained irrigation, while explaining soil-related tradeoffs. The main team handles interface, integration, scoring, and submission. Work independently from this brief; no ongoing conversation updates are needed.

## Assignment

Research corn, grain sorghum, and winter wheat, concentrating on continuous corn, corn–sorghum, and corn–winter wheat as candidate sequences. These are hypotheses to assess, not predetermined recommendations. Establish which claims are transferable from western Kansas research and which require local validation. Do not substitute dryland or eastern Kansas evidence without labeling the mismatch.

For each sequence, document the relative crop years, sowing and harvest windows, gaps between crops, planting-calendar conflicts, water-demand timing, residue implications, pest/disease or herbicide carryover concerns, and market/equipment prerequisites. Keep treatment differences such as irrigation level and tillage explicit. Distinguish annual water allocation from peak delivery capacity. Do not issue chemical-use directions or invent restrictions.

Start with these sources:

- K-State limited-irrigation trial summary: https://www.wkrec.com/about/locations/swrc-tribune/irrigation.html
- Peer-reviewed rotation study: https://acsess.onlinelibrary.wiley.com/doi/full/10.2134/agronj2015.0536
- K-State crop water-use reference: https://bookstore.ksre.ksu.edu/pubs/efficient-crop-water-use-in-kansas_MF3066.pdf
- Model structure reference: https://cwa2.engg.ksu.edu/
- Economic assumptions: https://agmanager.info/farm-budgets/2025-farm-management-guides-irrigated-crops
- Soil-water and cover-crop tradeoffs: https://www.ars.usda.gov/ARSUserFiles/30100500/Publications%202010-2019/22PDF%20Water%20Conundrum.pdf

## Required delivery

Return `agronomy.json` and a short `agronomy_findings.md`. JSON envelope: `{"schema_version":"1.0","sources":[],"candidates":[],"rules":[]}`.

Each source has `source_id` (prefix T1_), `title`, `url`, `publication_year`, `locator` (verified section/page/table), and `applicability_limit`.

Each candidate has `candidate_id` (corn_corn, corn_sorghum, corn_wheat), `sequence`, `evidence_status` (supported_candidate, conditional, unsupported), `benefits`, `risks`, `unknowns`, and `source_ids`. Each sequence phase has `crop`, `relative_harvest_year`, `sowing_window`, `harvest_window`, and `calendar_basis`; use null for unresolved values, not guessed dates. Winter wheat sowing may be in the preceding calendar year.

Each rule has `rule_id`, `input_needed`, `condition_description`, `effect` (flag, exclude, or explain), `rationale`, `source_ids`, and `validation_status`. If a numeric threshold has no defensible source, state the qualitative condition and leave the threshold absent.

## Acceptance and fallback

At least one complete, cited candidate and one reason it might be unsuitable must be delivered. Read original sources; AI summaries are leads, not evidence. Report contradictory results. Do not infer profit, pumping savings, nitrogen benefits, or disease reduction just from crop labels. Corn, sorghum, and wheat are all grasses; changing species is not automatically a crop-family break.

Do not wait for a farm boundary. Treat field suitability as unknown. Do not build the web app, contact experts, or expand beyond these three crops. If response functions are inaccessible, deliver a qualitative evidence table and identify exactly what prevents numerical estimates. After about 60–90 minutes, return the strongest usable result and unresolved items rather than pursuing an exhaustive literature review.
