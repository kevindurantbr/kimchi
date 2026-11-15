# Farm rotation research and team handoffs

Prepared November 14, 2026, America/Detroit. This packet starts an evidence-based prototype for the NASA Space Apps farm-rotation challenge. It contains completed initial research, one downloaded NASA dataset, and three independent teammate briefs. It is not a validated farm recommendation engine.

## Working scope

Help an irrigated farmer in Sheridan 6, western Kansas, compare the current rotation with two locally plausible alternatives under constrained irrigation. Soil protection is a second objective. The region remains a working choice, not a user-confirmed final selection.

Keep product decisions, data integration, comparison logic, interface, and submission narrative in the main chat. Give each teammate their numbered brief. Each brief is self-contained and can be given to their AI assistant without this conversation. Teammates can return results once; they do not need to coordinate with one another. The weather/ET adapter accepts arbitrary field polygons, so final field selection does not block its development.

## Research findings that change the design

1. **Use concrete candidate sequences.** Kansas State's Tribune research tested continuous corn, continuous sorghum, corn–sorghum, and corn–winter wheat under limited irrigation. Its summary reports that results varied by crop and year; the multi-year corn result favored following wheat over following corn. This supports a candidate library, not a guaranteed ranking for Sheridan 6. See [K-State research summary](https://www.wkrec.com/about/locations/swrc-tribune/irrigation.html) and [2016 Agronomy Journal study](https://acsess.onlinelibrary.wiley.com/doi/full/10.2134/agronj2015.0536). Tribune is not Sheridan 6; differences in soils, weather, cultivars, and management limit transfer.
2. **Do not credit all local conservation to crop changes.** Deines et al. studied Sheridan 6 during 2013–2017. They attributed most estimated pumping reductions to reduced applications within existing crops, with a smaller contribution from switching crops. Rotation choice is one adaptation lever. The paper's historical percentage reductions must not become the prototype's predicted savings. See [Deines et al. 2019](https://doi.org/10.1088/1748-9326/aafe39).
3. **Economics require a response model and explicit costs.** [K-State Crop Water Allocator](https://cwa2.engg.ksu.edu/) demonstrates a comparison using irrigation-yield relationships and user assumptions. It is a reference for model structure and plausibility checks, not proof that its defaults apply to a selected field. If suitable response functions cannot be obtained and checked, omit numerical profit and water-saving predictions.
4. **Budget data exist.** [K-State's 2026 irrigated crop budgets](https://agmanager.info/farm-budgets/2025-farm-management-guides-irrigated-crops) provide a starting point. Select the appropriate region and distinguish budgets from actual farm accounts. Prices, yields, pumping costs, and machinery access remain explicit assumptions.
5. **A cover crop is conditional.** Great Plains evidence identifies a tradeoff between soil protection and consumption of stored water. Do not automatically add covers to a water-saving option. See [USDA discussion](https://www.ars.usda.gov/ARSUserFiles/30100500/Publications%202010-2019/22PDF%20Water%20Conundrum.pdf).

## Completed data access proof

- `data/power_regional_2021_2025.json`: unmodified NASA POWER response for longitude -100.64, latitude 39.36, January 2021 through December 2025.
- `data/power_provenance.json`: request, returned metadata, download time, missing counts, and limitations.
- `data/weather_monthly.json`: 60 monthly precipitation totals and mean daily temperatures.
- `fetch_weather.py`: reproducible raw download using Python standard library; run with your Python executable.

Verified all expected dates: 1,826 per variable, no fill values, nonnegative precipitation, and minimum temperature no greater than maximum temperature. Parameters are PRECTOTCORR, T2M, T2M_MAX, T2M_MIN. The coordinate is a regional access test, not a verified field or proof of inclusion in a LEMA boundary. POWER represents gridded regional conditions; these data do not resolve differences between adjacent fields. Five years is a comparison sample, not a climate normal. API documentation: https://power.larc.nasa.gov/docs/services/api/temporal/daily/

OpenET, CDL, SSURGO, field boundaries, and local crop response coefficients have not been downloaded or integrated. [OpenET API access](https://old.etdata.org/api-info/) requires an account/token and has quotas. A documented route is not yet a successful data-access test.

## Comparison design

The working candidate library is continuous corn, corn–grain sorghum, and corn–winter wheat. Show two complete crop years for these examples, including planting and harvest windows. They are research candidates. The actual baseline must come from confirmed history plus an explicit continuation assumption. If its current sequence differs, include that baseline and choose two distinct alternatives from the library. Do not label continuous corn as an observed field rotation until evidence supports it.

Use three output states: eligible for comparison, conditional on missing information, or excluded by a documented constraint. Unknown water, equipment, soil, or market values remain unknown; never convert them to zero or silently treat them as favorable. Farmer priorities can order feasible options, but cannot override a planting-calendar conflict or an unavailable crop market.

NASA data should identify historical seasonal rainfall/heat exposure and observed ET context. Crop-stage calendars and validated thresholds are needed before translating weather into a crop-specific warning. Observed ET does not predict the ET of an unplanted rotation. Rain minus ET is not a full irrigation requirement: storage changes, runoff, drainage, and delivery losses also matter.

## Integration and acceptance

1. Teammate 1 returns agronomy evidence and candidate rules; teammate 2 returns fields and spatial attributes; teammate 3 returns weather and a tested ET adapter.
2. Integrator checks units, periods, identifiers, sources, and evidence applicability, then runs the adapter on teammate 2's fields. This is a one-time join, not an ongoing teammate dependency.
3. Complete one field end to end before adding more layers. Test missing inputs, an infeasible option, and a priority change. A priority change need not change the winner if evidence says otherwise.
4. Every real observation, modeled estimate, farmer assumption, and synthetic demonstration value must be visibly distinguishable.
5. Freeze numerical claims if the underlying response model is unsupported. Deliver qualitative comparisons with transparent evidence instead.

First checkpoint: after roughly 60–90 minutes of teammate work, collect one usable result from each stream. This is a proposed work interval, not a verified competition deadline. Confirm the registered event's cutoff and submission requirements separately.
