import test from "node:test";
import assert from "node:assert/strict";
import * as a from "./analysis.mjs";

function weather(start, end) {
  const date = [];
  for (let t = Date.parse(start); t <= Date.parse(end); t += 86400000)
    date.push(new Date(t).toISOString().slice(0, 10));
  return {
    date,
    t2m_max: date.map(() => 30),
    t2m_min: date.map(() => 10),
    prectotcorr: date.map(() => 2),
    rh2m: date.map(() => 60),
    ws2m: date.map(() => 2),
    allsky_sw_dwn: date.map(() => 20),
    gwetroot: date.map(() => 0.5),
  };
}
const corn = {
  id: "corn",
  season: { plant: "04-25", harvest: "10-05" },
  gdd_base_c: 10,
  gdd_cap_c: 30,
  gdd_to_silking_c: 780,
  gdd_to_maturity_c: 1500,
  sensitive_window: { name: "pollination", gdd_from: 700, gdd_to: 900 },
  heat_threshold_c: 35,
  kc: { ini: 0.3, mid: 1.2, end: 0.6, stage_days: [30, 40, 50, 44] },
  p_depletion: 0.55,
  frost_free_days_needed: 140,
};

test("invalid crop calendars and missing model parameters remain unavailable", () => {
  const d = { ...weather("1990-01-01", "1992-12-31"), lat: 39.4 };
  const invalid = { ...corn, season: { plant: null, harvest: null } };
  const r = a.rotationFit({
    rotation: { id: "bad", sequence: ["corn"] },
    crops: [invalid],
    daily: d,
    years: [1991, 1992],
  });
  assert.equal(r.metrics.median_irrigation_need_mm, null);
  const unknown = {
    ...corn,
    sensitive_window: { name: "unknown", gdd_from: null, gdd_to: null },
    gdd_to_maturity_c: null,
    gdd_to_silking_c: null,
  };
  const analysis = a.analyzeField({
    daily: d,
    site: { lat: 39.4 },
    crops: [unknown],
    farmField: { crop: "corn" },
    today: "1992-07-15",
  });
  assert.equal(analysis.factors.temperature.stage_heat.hot_days, null);
  assert.equal(analysis.factors.temperature.gdd.stage_now, null);
});

test("unknown current indicators are not reported as zero recurrence and future season totals are withheld", () => {
  const r = a.analyzeField({
    daily: weather("1981-01-01", "2026-07-15"),
    liveDaily: { date: ["2026-07-15"], prectotcorr: [null] },
    crops: [corn],
    farmField: {
      records: [
        {
          year: 2026,
          crop: "corn",
          planting_date: "2026-04-25",
          harvest_date: "2026-10-10",
          irrigation_mm: 300,
        },
      ],
    },
    site: { lat: 39.4 },
    today: "2026-07-15",
  });
  assert.equal(r.factors.water.recurrence.count, null);
  assert.equal(r.factors.water.series.irrigation_cum.at(-1), null);
  assert.equal(a.doy("2026-99-99"), null);
  assert.equal(a.doy("2026-02-30"), null);
});

test("P1 metadata and geometry provide correct sources, elevation and rotation location", () => {
  const d = weather("1990-01-01", "1992-12-31"),
    field = {
      field_id: "fld01",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-101, 39],
            [-100, 39],
            [-100, 40],
            [-101, 40],
            [-101, 39],
          ],
        ],
      },
    },
    crop = { ...corn };
  const ndvi = {
    source: "NASA MOD13Q1 on Microsoft Planetary Computer",
    dates: ["1992-07-11"],
    field_mean: [0.5],
  };
  const r = a.analyzeField({
    daily: d,
    site: {
      lat: 39.5,
      elevation_m: 900,
      units: { allsky_sw_dwn: "MJ/m^2/day" },
    },
    ndvi,
    farmField: field,
    today: "1992-07-15",
  });
  assert.deepEqual(r.factors.crop_condition.status.source_ids, [
    "MODIS_MOD13Q1_PC",
  ]);
  const fit = a.rotationFit({
    rotation: { id: "c", sequence: ["corn"] },
    crops: [crop],
    daily: d,
    farmField: field,
    years: [1991, 1992],
    farm: { constraints: { annual_allocation_mm: 100 } },
  });
  assert.ok(fit.metrics.median_irrigation_need_mm > 0);
});

test("P4 calendar-sensitive wheat and null-calendar fallow are supported without inventing GDD", () => {
  const d = { ...weather("1990-01-01", "1992-12-31"), lat: 39.4 };
  d.t2m_max.fill(35);
  const wheat = {
    ...corn,
    id: "winter_wheat",
    season: { plant: "09-25", harvest: "06-30" },
    gdd_base_c: 0,
    gdd_cap_c: null,
    sensitive_window: {
      name: "grain fill",
      gdd_from: null,
      gdd_to: null,
      date_from: "05-01",
      date_to: "06-15",
    },
    heat_threshold_c: 32,
  };
  const h = a.stageHeat(d, wheat, "1990-09-25", 1991);
  assert.equal(h.hot_days, 46);
  assert.equal(h.start, "1991-05-01");
  const fallow = {
    id: "fallow",
    season: { plant: null, harvest: null },
    kc: { ini: 0.3, mid: 0.3, end: 0.3, stage_days: [90, 90, 90, 95] },
  };
  const r = a.rotationFit({
    rotation: { id: "f", sequence: ["fallow"] },
    crops: [fallow],
    daily: d,
    years: [1991, 1992],
    farm: { constraints: { annual_allocation_mm: 0 } },
  });
  assert.equal(r.metrics.low_cover_months_per_year, 12);
  assert.ok(r.metrics.demand_by_month.every((v) => v > 0));
  assert.equal(r.seasons[1].harvest_date, "1992-12-31");
  assert.equal(r.metrics.sensitive_heat_years, null);
});

test("rotation evaluates every phase over the same harvest years and sows wheat the previous autumn", () => {
  const wheat = {
    ...corn,
    id: "winter_wheat",
    season: { plant: "10-10", harvest: "06-30" },
    kc: { ini: 0.4, mid: 1.15, end: 0.3, stage_days: [30, 120, 60, 54] },
    frost_free_days_needed: null,
  };
  const r = a.rotationFit({
    rotation: { id: "cw", sequence: ["corn", "winter_wheat"] },
    crops: [corn, wheat],
    daily: { ...weather("1990-01-01", "1993-12-31"), lat: 39.4 },
    farmField: { well_capacity_gpm: 600, area_ha: 50.2 },
    farm: { constraints: { annual_allocation_mm: 280 } },
    years: [1991, 1993],
  });
  assert.equal(r.rotation_id, "cw");
  assert.equal(r.seasons.length, 6);
  assert.deepEqual(
    r.seasons
      .filter((s) => s.crop_id === "winter_wheat")
      .map((s) => s.planting_date),
    ["1990-10-10", "1991-10-10", "1992-10-10"],
  );
  assert.deepEqual(r.calendar[1], {
    phase: 1,
    crop_id: "winter_wheat",
    planting_year: 1,
    plant: "10-10",
    harvest_year: 2,
    harvest: "06-30",
  });
  assert.match(r.metrics.shortfall_years, /of 3 years/);
  assert.equal(r.metrics.demand_by_month.length, 12);
  assert.equal(r.metrics.frost_risk_years, null);
  assert.ok(r.notes.some((n) => n.includes("winter")));
});

test("field totals reject truncated seasons and live nulls override historical observations", () => {
  const input = {
    daily: weather("2026-04-26", "2026-07-15"),
    crops: [corn],
    farmField: { crop: "corn", planting_date: "2026-04-25", irrigation_mm: 0 },
    site: { lat: 39.4 },
    today: "2026-07-15",
  };
  const r = a.analyzeField(input);
  assert.equal(r.factors.water.status.value, null);
  const liveDaily = {
    date: ["2026-07-15", "2026-07-16"],
    prectotcorr: [null, 999],
    gwetroot: [null, 0.9],
  };
  const withLive = a.analyzeField({
    ...input,
    daily: weather("2026-01-01", "2026-07-16"),
    liveDaily,
  });
  assert.equal(withLive.factors.water.status.value, null);
  assert.equal(withLive.factors.soil_moisture.status.value, null);
  assert.equal(withLive.data_quality.missing_days, 1);
  assert.equal(withLive.data_quality.live_through, "2026-07-14");
  assert.equal(withLive.factors.water.recurrence.n, 0);
  assert.equal(
    a.analyzeField({ today: "2026-07-15" }).factors.temperature.gdd.to_date,
    null,
  );
});

test("analyzeField returns four sourced factors with aligned historical comparisons and no input mutation", () => {
  const d = weather("1981-01-01", "2026-07-15"),
    snapshot = JSON.stringify(d);
  const r = a.analyzeField({
    daily: d,
    crops: { crops: [corn] },
    farmField: {
      area_ha: 50.2,
      well_capacity_gpm: 600,
      records: [
        {
          year: 2026,
          period: "season",
          crop: "corn",
          planting_date: "2026-04-25",
          irrigation_mm: 100,
        },
      ],
    },
    soil: { aws_0_150_cm: 20 },
    site: { lat: 39.4 },
    today: "2026-07-15",
  });
  assert.deepEqual(Object.keys(r.factors), [
    "water",
    "temperature",
    "soil_moisture",
    "crop_condition",
  ]);
  assert.equal(r.factors.temperature.gdd.to_date, 820);
  assert.equal(r.factors.water.trend.shown, true);
  assert.equal(r.factors.water.series.rain_cum.at(-1), 164);
  assert.equal(r.factors.water.series.irrigation_cum.at(-1), 100);
  assert.equal(r.factors.water.bucket.stress_days, null);
  assert.equal(r.data_quality.missing_days_this_year, 0);
  for (const f of Object.values(r.factors))
    assert.ok(f.status.source_ids.length);
  assert.equal(JSON.stringify(d), snapshot);
});

test("farm sensitivity pairs years and requires five comparable yields before reporting correlations", () => {
  const records = Array.from({ length: 5 }, (_, i) => ({
    year: 2000 + i,
    crop: "corn",
    yield: 100 - i * 10,
    yield_unit: "bu/ac",
    period: "season",
  }));
  const indicators = records.map((r, i) => ({
    year: r.year,
    hot_days: i,
    season_deficit_mm: i * 10,
  }));
  const r = a.farmSensitivity(records, indicators);
  near(r.rho.hot_days, -1);
  assert.equal(r.note, "pattern, not proof");
  assert.equal(
    a.farmSensitivity(records.slice(1), indicators).pattern,
    "too few years to judge",
  );
  assert.equal(
    a.farmSensitivity(
      [...records.slice(1), { ...records[0], yield_unit: "t/ha" }],
      indicators,
    ).rho.hot_days,
    null,
  );
});

test("stage heat counts only the GDD-sensitive window and compares equivalent stage progress", () => {
  const dates = [],
    max = [],
    min = [];
  for (let y = 1991; y <= 2026; y++)
    for (let day = 1; day <= 5; day++) {
      dates.push(`${y}-05-0${day}`);
      max.push(y === 2026 ? 36 : 30);
      min.push(10);
    }
  const crop = {
    gdd_base_c: 10,
    gdd_cap_c: 30,
    heat_threshold_c: 35,
    sensitive_window: { name: "flowering", gdd_from: 20, gdd_to: 40 },
    season: { harvest: "05-05" },
  };
  const r = a.stageHeat(
    daily(dates, { t2m_max: max, t2m_min: min }),
    crop,
    "2026-05-01",
    2026,
  );
  assert.equal(r.start, "2026-05-02");
  assert.equal(r.end, "2026-05-04");
  assert.equal(r.hot_days, 3);
  assert.equal(r.heat_degree_days, 18);
  assert.equal(r.status.normal_median, 0);
  max[dates.indexOf("2026-05-02")] = null;
  assert.equal(
    a.stageHeat(
      daily(dates, { t2m_max: max, t2m_min: min }),
      crop,
      "2026-05-01",
      2026,
    ).hot_days,
    null,
  );
});

test("compound calendar counts hot dry and deficit together and never turns missing months into zero stress", () => {
  const dates = [],
    t = [],
    rain = [],
    soil = [],
    ev = [];
  for (let y = 1991; y <= 2021; y++)
    for (let day = 1; day <= 31; day++) {
      dates.push(`${y}-07-${String(day).padStart(2, "0")}`);
      t.push(y === 2021 ? 36 : 25);
      rain.push(y === 2021 ? 0 : 4);
      soil.push(y === 2021 ? 0.1 : 0.5);
      ev.push(5);
    }
  const d = daily(dates, { t2m_max: t, prectotcorr: rain, gwetroot: soil });
  const r = a.compoundCalendar(d, ev, { years: [2021] });
  assert.equal(r.counts[0][6], 3);
  assert.equal(r.counts[0][0], null);
  rain[rain.length - 1] = null;
  assert.equal(a.compoundCalendar(d, ev, { years: [2021] }).counts[0][6], null);
});

test("cause check covers water, heat, other scouting, normal greenness and unknown evidence", () => {
  const normal = { direction: "normal", severity: 0 },
    bad = { direction: "adverse", severity: 0.8 };
  const input = {
    ndviStatus: bad,
    soilStatus: normal,
    waterStatus: normal,
    heatStatus: normal,
  };
  assert.equal(a.causeCheck({ ...input, waterStatus: bad }).code, "water");
  assert.equal(a.causeCheck({ ...input, soilStatus: bad }).code, "water");
  assert.equal(a.causeCheck({ ...input, heatStatus: bad }).code, "heat");
  assert.equal(a.causeCheck(input).code, "not_weather");
  assert.equal(a.causeCheck({ ...input, ndviStatus: normal }).code, "none");
  assert.equal(
    a.causeCheck({ ...input, waterStatus: null }).code,
    "unavailable",
  );
});

test("NDVI compares the same 16-day period and labels low greenness without claiming bare soil", () => {
  const ndvi = {
    dates: [
      ...Array.from({ length: 25 }, (_, i) => `${2001 + i}-07-12`),
      "2026-07-12",
    ],
    field_mean: [...Array(25).fill(0.7), 0.2],
  };
  const s = a.ndviStatus(ndvi, "2026-07-15");
  assert.equal(s.value, 0.2);
  assert.equal(s.normal_median, 0.7);
  assert.equal(s.direction, "adverse");
  assert.equal(a.ndviStatus(ndvi, "2026-08-20").value, null);
  const c = a.greenCoverCalendar(ndvi);
  assert.equal(c.label, "low green cover");
  assert.equal(c.low_cover.at(-1)[6], true);
  assert.equal(c.low_cover.at(-1)[7], null);
});

test("frost boundaries require complete half-years and monthly recurrence excludes missing months", () => {
  const dates = Array.from({ length: 365 }, (_, i) =>
    new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10),
  );
  const temps = dates.map((s) =>
    s === "2025-04-20" || s === "2025-10-10" ? -1 : 10,
  );
  const f = a.frostDates(daily(dates, { t2m_min: temps }), 2025);
  assert.equal(f.last_spring, "2025-04-20");
  assert.equal(f.first_fall, "2025-10-10");
  assert.equal(f.frost_free_days, 172);
  temps[0] = null;
  assert.equal(
    a.frostDates(daily(dates, { t2m_min: temps }), 2025).last_spring,
    null,
  );
  const r = a.monthlyRecurrence(
    daily(dates, { prectotcorr: dates.map(() => 1) }),
    (d) => d.prectotcorr.reduce((s, v) => s + v, 0),
    30,
  );
  assert.equal(r[0].text, "1 of 1 years");
  assert.equal(r[1].count, 0);
});

test("trend requires 30 distinct observed years and detects a monotonic decade slope", () => {
  const values = Array.from({ length: 30 }, (_, i) => i),
    years = values.map((i) => 1991 + i);
  const t = a.trend(values, years);
  assert.equal(t.shown, true);
  assert.equal(t.trend, "increasing");
  assert.ok(t.p < 0.05);
  assert.equal(t.slope_per_decade, 10);
  assert.equal(a.mannKendall([1, null, 2, 3]).S, 3);
  assert.equal(a.mannKendall(Array(30).fill(2)).p, 1);
  assert.equal(
    a.trend(values.slice(1), years.slice(1)).reason,
    "need ≥ 30 years",
  );
  assert.equal(a.trend(values, Array(30).fill(2000)).shown, false);
  assert.deepEqual(
    a.recurrence([0, null, 2], [2000, 2001, 2002], (v) => v > 1),
    { count: 1, n: 2, years_matching: [2002], text: "1 of 2 years" },
  );
});

test("climatology aligns month-days across leap years and excludes outside-baseline data", () => {
  const dates = Array.from({ length: 30 }, (_, i) => `${1991 + i}-03-01`);
  const d = daily([...dates, "2026-03-01"], {
    gwetroot: [...Array(30).fill(0.5), 0],
  });
  const c = a.climatology(d, "gwetroot", {
    baseline: [1991, 2020],
    window: "doy",
    smooth: 0,
  });
  assert.equal(c.p50[60], 0.5); // canonical leap-year March 1
  assert.equal(c.p50[59], null);
  assert.equal(a.climatology(d, "gwetroot", { window: "month" }).p50[2], 0.5);
});

test("Weibull ranks give zero severity at quartile boundaries and only penalize the adverse tail", () => {
  const sample = Array.from({ length: 99 }, (_, i) => i + 1);
  for (const value of [25, 50, 75]) {
    assert.equal(a.percentileRank(value, sample), value);
    assert.equal(
      a.status(value, sample, {
        adverseWhen: "low",
        unit: "mm",
        label: "Drier",
      }).severity,
      0,
    );
  }
  const dry = a.status(10, sample, {
    adverseWhen: "low",
    unit: "mm",
    label: "Drier",
  });
  near(dry.severity, 0.6);
  assert.match(dry.label, /90%/);
  assert.equal(a.status(90, sample, { adverseWhen: "low" }).severity, 0);
  assert.equal(a.percentileRank(1, [1, 2, null]), null);
  assert.equal(a.status(null, sample).severity, null);
  assert.equal(a.percentileRank(5, Array(20).fill(5)), 50);
});

test("well capacity is compared to a complete seven-day peak, not an isolated daily maximum", () => {
  near(a.wellCapacityMmDay(600, 50.2), 6.5, 0.02);
  assert.equal(a.wellCapacityMmDay(600, 0), null);
  assert.equal(a.wellCapacityMmDay(null, 50), null);
  const peak = a.peakDemand([20, 1, 1, 1, 1, 1, 1, 8]);
  near(peak, 26 / 7);
  assert.equal(a.peakDemand([null, 1, 1, 1, 1, 1, 1]), null);
  assert.equal(a.capacityCheck(8, 6).shortfall_mm_day, 2);
  assert.equal(a.capacityCheck(5, 6).ok, true);
  assert.equal(a.capacityCheck(8, null).ok, null);
});

test("root-zone depletion is bounded and cannot recover certainty after a missing day", () => {
  const input = {
    dates: ["2026-05-01", "2026-05-02", "2026-05-03"],
    rain: [0, 0, 500],
    demand: [60, 90, 0],
    irrigation: [0, 0, 0],
    taw_mm: 100,
    p: 0.55,
  };
  const b = a.rootZoneBucket(input);
  assert.deepEqual(b.depletion_mm, [60, 100, 0]);
  assert.equal(b.stress_days, 2);
  assert.equal(b.first_stress_date, "2026-05-01");
  assert.deepEqual(
    a.rootZoneBucket({ ...input, rain: [null, 0, 500] }).depletion_mm,
    [null, null, null],
  );
  assert.equal(
    a.rootZoneBucket({ ...input, rain: [null, 0, 500] }).stress_days,
    null,
  );
});

test("crop demand follows stage interpolation and keeps a missing rain day unknown", () => {
  const crop = {
    kc: { ini: 0.3, mid: 1.2, end: 0.6, stage_days: [2, 2, 2, 2] },
  };
  const dates = Array.from(
    { length: 9 },
    (_, i) => `2026-05-${String(i + 1).padStart(2, "0")}`,
  );
  const kc = a.kcCurve(crop, "2026-05-01", dates);
  assert.deepEqual(
    kc,
    [0.3, 0.3, 0.3, 0.75, 1.2, 1.2, 1.2, 0.8999999999999999, 0],
  );
  assert.deepEqual(a.cropDemand([10, null], [0.3, 1.2]), [3, null]);
  const b = a.seasonWaterBalance(
    { date: dates.slice(0, 2), prectotcorr: [null, 2] },
    [10, 10],
    [1, 1],
    5,
  );
  assert.equal(b.rain_mm, null);
  assert.equal(b.balance_mm, null);
  assert.equal(b.demand_mm, 20);
});

const daily = (date, extra = {}) => ({ date, ...extra });
test("ET switches methods per day and converts explicit kWh radiation units", () => {
  const d = daily(["2026-07-06", "2026-07-07", "2026-07-08"], {
    t2m_max: [21.5, 25, null],
    t2m_min: [12.3, 15, 15],
    rh2m: [70, null, 70],
    ws2m: [2, 2, 2],
    allsky_sw_dwn: [22, 22, 22],
  });
  const r = a.et0(d, 50.8);
  assert.deepEqual(r.method_per_day, ["penman_monteith", "hargreaves", null]);
  near(
    a.et0(
      {
        ...d,
        allsky_sw_dwn: [22 / 3.6, 22 / 3.6, 22 / 3.6],
        units: { allsky_sw_dwn: "kW-hr/m^2/day" },
      },
      50.8,
    ).values[0],
    r.values[0],
  );
  near(
    a.et0Hargreaves({ tmax: 21.5, tmin: 12.3, lat: 50.8, doy: 187 }),
    0.0023 * 34.7 * Math.sqrt(9.2) * 41.09 * 0.408,
    0.01,
  );
  assert.equal(r.values[2], null);
});
const near = (actual, expected, tolerance = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} ≈ ${expected}`,
  );

test("Penman–Monteith reproduces FAO-56 Brussels Example 18", () => {
  // Example ea=1.409 kPa, es≈1.997 kPa expressed as equivalent mean RH.
  const v = a.et0PenmanMonteith({
    tmax: 21.5,
    tmin: 12.3,
    rh: (100 * 1.409) / 1.997,
    ws2: 2.078,
    rs_mj: 22.07,
    lat: 50.8,
    doy: 187,
    elev_m: 100,
  });
  near(v, 3.88, 0.04);
  assert.equal(a.et0PenmanMonteith({ tmax: null }), null);
});

test("season helpers preserve aligned nulls, leap days and autumn-to-next-summer seasons", () => {
  const d = daily(
    ["2024-02-29", "2024-10-01", "2025-01-01", "2025-06-30", "2025-10-01"],
    { prectotcorr: [1, null, 3, 4, 5] },
  );
  assert.equal(a.doy("2024-03-01"), 61);
  assert.equal(a.doy(null), null);
  assert.deepEqual(a.seasonSlice(d, "10-01", "06-30", 2024).prectotcorr, [
    null,
    3,
    4,
  ]);
  assert.deepEqual(a.groupByYear(d)[2025].prectotcorr, [3, 4, 5]);
  assert.deepEqual(
    a.cumulativeGdd(
      daily(["2026-04-24", "2026-04-25", "2026-04-26", "2026-04-27"], {
        t2m_max: [25, 30, null, 30],
        t2m_min: [10, 10, 10, 10],
      }),
      "2026-04-25",
    ),
    [null, 10, null, null],
  );
  assert.equal(a.hotDays([34, 35, 36]), 2);
  assert.equal(a.hotDays([null, 35]), null);
  assert.equal(a.heatDegreeDays([29, 32, 35]), 7);
  assert.equal(a.heatDegreeDays([null]), null);
});

test("GDD clamps both temperatures and preserves missing observations", () => {
  assert.equal(a.gddDaily(40, 5), 10);
  assert.equal(a.gddDaily(5, -5), 0);
  assert.equal(a.gddDaily(40, 35), 20);
  assert.equal(a.gddDaily(null, 15), null);
  assert.equal(a.gddDaily(20, null), null);
});
