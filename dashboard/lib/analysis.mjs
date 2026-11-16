// Pure, dependency-free calculations. See ANALYSIS.md for contracts and limits.
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const DAY = 86400000;
const months = Array.from({ length: 12 }, (_, i) => i + 1);
const stamp = (s) => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN;
  const t = Date.parse(s + "T00:00:00Z");
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s
    ? t
    : NaN;
};
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const yearOf = (s) => Number(s.slice(0, 4));
const sum = (a) =>
  Array.isArray(a) && a.length && a.every(finite)
    ? a.reduce((s, v) => s + v, 0)
    : null;
const mean = (a) => {
  const s = sum(a);
  return s === null ? null : s / a.length;
};
const pick = (d, indices) =>
  Object.fromEntries(
    Object.entries(d ?? {}).map(([k, v]) => [
      k,
      Array.isArray(v) ? indices.map((i) => v[i] ?? null) : v,
    ]),
  );
const between = (d, start, end) =>
  pick(
    d,
    (d?.date ?? []).flatMap((s, i) => (s >= start && s <= end ? [i] : [])),
  );
const daysBetween = (start, end) =>
  Math.round((stamp(end) - stamp(start)) / DAY);
const dateRange = (start, end) => {
  const n = daysBetween(start, end);
  return Number.isFinite(n) && n >= 0
    ? Array.from({ length: n + 1 }, (_, i) => iso(stamp(start) + i * DAY))
    : [];
};

/** UTC day of year, 1–366; invalid or missing dates return null. */
export function doy(dateStr) {
  const t = stamp(dateStr);
  return Number.isFinite(t)
    ? Math.floor((t - Date.UTC(yearOf(dateStr), 0, 1)) / DAY) + 1
    : null;
}

/** Inclusive calendar slice; year is the planting year when the season crosses January. */
export function seasonSlice(daily, fromMMDD, toMMDD, year) {
  if (!daily || !fromMMDD || !toMMDD || !finite(year)) return null;
  return between(
    daily,
    `${year}-${fromMMDD}`,
    `${year + (toMMDD < fromMMDD ? 1 : 0)}-${toMMDD}`,
  );
}

/** Group aligned daily arrays by calendar year without mutating input. */
export function groupByYear(daily) {
  if (!daily) return null;
  const groups = {};
  (daily.date ?? []).forEach((s, i) => {
    if (s) (groups[yearOf(s)] ??= []).push(i);
  });
  return Object.fromEntries(
    Object.entries(groups).map(([y, indices]) => [y, pick(daily, indices)]),
  );
}

/** Daily growing degree days (°C·day), with both temperatures clamped to base/cap. */
export function gddDaily(tmax, tmin, base = 10, cap = 30) {
  if (![tmax, tmin, base, cap].every(finite) || cap < base) return null;
  return (clamp(tmax, base, cap) + clamp(tmin, base, cap)) / 2 - base;
}

/** Aligned cumulative °C·days since planting; a missing day invalidates later totals. */
export function cumulativeGdd(daily, plantDate, base = 10, cap = 30) {
  if (!daily || !plantDate) return null;
  let total = 0,
    previous = null;
  return (daily.date ?? []).map((s, i) => {
    if (s < plantDate) return null;
    const v = gddDaily(daily.t2m_max?.[i], daily.t2m_min?.[i], base, cap);
    if (
      (previous === null && s !== plantDate) ||
      (previous && daysBetween(previous, s) !== 1)
    )
      total = null;
    previous = s;
    total = total === null || v === null ? null : total + v;
    return total;
  });
}

/** Number of days at or above the threshold (°C); incomplete samples return null. */
export function hotDays(tmaxArr, threshold = 35) {
  return finite(threshold) && Array.isArray(tmaxArr)
    ? sum(tmaxArr.map((v) => (finite(v) ? Number(v >= threshold) : null)))
    : null;
}

/** Sum of daily maximum temperature excess (°C·days); a heat proxy, not a yield model. */
export function heatDegreeDays(tmaxArr, threshold = 30) {
  return finite(threshold) && Array.isArray(tmaxArr)
    ? sum(tmaxArr.map((v) => (finite(v) ? Math.max(0, v - threshold) : null)))
    : null;
}

const vapour = (t) => 0.6108 * Math.exp((17.27 * t) / (t + 237.3));
function radiation(lat, day) {
  if (![lat, day].every(finite) || Math.abs(lat) > 90 || day < 1 || day > 366)
    return null;
  const phi = (lat * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * day) / 365);
  const delta = 0.409 * Math.sin((2 * Math.PI * day) / 365 - 1.39);
  const ws = Math.acos(clamp(-Math.tan(phi) * Math.tan(delta), -1, 1));
  return Math.max(
    0,
    ((24 * 60) / Math.PI) *
      0.082 *
      dr *
      (ws * Math.sin(phi) * Math.sin(delta) +
        Math.cos(phi) * Math.cos(delta) * Math.sin(ws)),
  );
}

/** FAO-56 daily grass reference ET₀ (mm/day). RH %, wind at 2 m in m/s, Rs MJ/m²/day. */
export function et0PenmanMonteith(input) {
  if (!input) return null;
  const { tmax, tmin, rh, ws2, rs_mj, lat, doy: day, elev_m = 850 } = input;
  if (
    ![tmax, tmin, rh, ws2, rs_mj, lat, day, elev_m].every(finite) ||
    tmax < tmin ||
    tmin <= -237.3 ||
    rh < 0 ||
    rh > 100 ||
    ws2 < 0 ||
    rs_mj < 0
  )
    return null;
  const ra = radiation(lat, day);
  const rso = ra === null ? null : (0.75 + 2e-5 * elev_m) * ra;
  if (!finite(rso) || rso <= 0) return null;
  const t = (tmax + tmin) / 2;
  const es = (vapour(tmax) + vapour(tmin)) / 2,
    ea = (es * rh) / 100;
  const delta = (4098 * vapour(t)) / (t + 237.3) ** 2;
  const pressure = 101.3 * ((293 - 0.0065 * elev_m) / 293) ** 5.26;
  const gamma = 0.000665 * pressure;
  const rnl =
    ((4.903e-9 * ((tmax + 273.16) ** 4 + (tmin + 273.16) ** 4)) / 2) *
    (0.34 - 0.14 * Math.sqrt(ea)) *
    (1.35 * clamp(rs_mj / rso, 0.3, 1) - 0.35);
  const rn = 0.77 * rs_mj - rnl;
  const value =
    (0.408 * delta * rn + ((gamma * 900) / (t + 273)) * ws2 * (es - ea)) /
    (delta + gamma * (1 + 0.34 * ws2));
  return finite(value) ? Math.max(0, value) : null;
}

/** FAO-56 eq. 52 ET₀ (mm/day), including Ra's 0.408 MJ-to-mm conversion. */
export function et0Hargreaves(input) {
  if (!input) return null;
  const { tmax, tmin, lat, doy: day } = input;
  const ra = radiation(lat, day);
  if (![tmax, tmin, ra].every(finite) || tmax < tmin) return null;
  return Math.max(
    0,
    0.0023 * ((tmax + tmin) / 2 + 17.8) * Math.sqrt(tmax - tmin) * ra * 0.408,
  );
}

/** Aligned ET₀ and method labels. Missing humidity/wind/radiation falls back to Hargreaves. */
export function et0(daily, lat) {
  if (!daily) return { values: [], method_per_day: [] };
  const unit =
    daily.units?.allsky_sw_dwn ??
    daily.parameters?.ALLSKY_SFC_SW_DWN?.units ??
    "MJ/m^2/day";
  const multiplier = /kwh|kw-hr/i.test(unit)
    ? 3.6
    : /^MJ/i.test(unit)
      ? 1
      : null;
  const method_per_day = [];
  const values = (daily.date ?? []).map((s, i) => {
    const input = {
      tmax: daily.t2m_max?.[i],
      tmin: daily.t2m_min?.[i],
      rh: daily.rh2m?.[i],
      ws2: daily.ws2m?.[i],
      rs_mj:
        finite(daily.allsky_sw_dwn?.[i]) && multiplier !== null
          ? daily.allsky_sw_dwn[i] * multiplier
          : null,
      lat,
      doy: doy(s),
      elev_m: daily.elev_m === undefined ? 850 : daily.elev_m,
    };
    let v = et0PenmanMonteith(input),
      method = "penman_monteith";
    if (v === null) {
      v = et0Hargreaves(input);
      method = "hargreaves";
    }
    method_per_day.push(v === null ? null : method);
    return v;
  });
  return { values, method_per_day };
}

/** FAO single crop coefficient by elapsed calendar days; zero outside its stage schedule. */
export function kcCurve(crop, plantDate, dates) {
  if (!Array.isArray(dates)) return null;
  const k = crop?.kc,
    lengths = k?.stage_days;
  if (
    !k ||
    ![k.ini, k.mid, k.end].every(finite) ||
    !Array.isArray(lengths) ||
    lengths.length !== 4 ||
    !lengths.every((v) => finite(v) && v >= 0) ||
    !Number.isFinite(stamp(plantDate))
  )
    return dates.map(() => null);
  const [ini, dev, mid, end] = lengths,
    total = ini + dev + mid + end;
  return dates.map((s) => {
    const day = daysBetween(plantDate, s);
    if (!finite(day)) return null;
    if (day < 0 || day >= total) return 0;
    if (day < ini) return k.ini;
    if (day < ini + dev) return k.ini + ((k.mid - k.ini) * (day - ini)) / dev;
    if (day < ini + dev + mid) return k.mid;
    return k.mid + ((k.end - k.mid) * (day - ini - dev - mid)) / end;
  });
}

/** Elementwise estimated crop demand ET₀ × Kc in mm/day; null never becomes zero. */
export function cropDemand(etValues, kc) {
  if (!Array.isArray(etValues) || !Array.isArray(kc)) return null;
  return etValues.map((v, i) =>
    finite(v) && finite(kc[i]) ? v * kc[i] : null,
  );
}

/** Season supply minus demand (mm). Any missing component invalidates its total. */
export function seasonWaterBalance(daily, etValues, kc, irrigationMm = 0) {
  const rain_mm = sum(daily?.prectotcorr),
    demand_mm = sum(cropDemand(etValues, kc));
  const irrigation_mm = Array.isArray(irrigationMm)
    ? sum(irrigationMm)
    : finite(irrigationMm)
      ? irrigationMm
      : null;
  return {
    rain_mm,
    irrigation_mm,
    demand_mm,
    balance_mm: [rain_mm, irrigation_mm, demand_mm].every(finite)
      ? rain_mm + irrigation_mm - demand_mm
      : null,
  };
}

/** Simplified FAO-56 depletion bucket (mm), initially at field capacity; RAW = p × TAW. */
export function rootZoneBucket(input = {}) {
  const { dates = [], rain, demand, irrigation, taw_mm, p } = input ?? {};
  const valid = finite(taw_mm) && taw_mm > 0 && finite(p) && p >= 0 && p <= 1;
  let dr = valid ? 0 : null,
    count = 0,
    first = null;
  const depletion_mm = dates.map((s, i) => {
    const r = rain?.[i],
      d = demand?.[i],
      irr = irrigation?.[i];
    if (
      dr === null ||
      ![r, d, irr].every((v) => finite(v) && v >= 0) ||
      (i > 0 && daysBetween(dates[i - 1], s) !== 1)
    ) {
      dr = null;
      return null;
    }
    dr = clamp(dr + d - r - irr, 0, taw_mm);
    if (dr > p * taw_mm) {
      count++;
      first ??= s;
    }
    return dr;
  });
  return {
    depletion_mm,
    stress_days: dates.length && depletion_mm.every(finite) ? count : null,
    first_stress_date: first,
    taw_mm: valid ? taw_mm : null,
    raw_mm: valid ? p * taw_mm : null,
    method: "simplified: no runoff, no capillary rise",
  };
}

/** Continuous gross well capacity (mm/day), US gallons/minute and field hectares. */
export function wellCapacityMmDay(gpm, area_ha) {
  return finite(gpm) && gpm >= 0 && finite(area_ha) && area_ha > 0
    ? (gpm * 1440 * 3.785) / (area_ha * 10000)
    : null;
}

function rolling(values, window) {
  if (!Array.isArray(values) || !Number.isInteger(window) || window < 1)
    return [];
  return values
    .slice(window - 1)
    .map((_, i) => mean(values.slice(i, i + window)));
}

/** Maximum complete rolling mean demand (mm/day); incomplete windows are excluded. */
export function peakDemand(demand, window = 7) {
  const valid = rolling(demand, window).filter(finite);
  return valid.length ? Math.max(...valid) : null;
}

/** Gross well-capacity comparison; unknown capacity is not a passing result. */
export function capacityCheck(peakDemandMmDay, wellMmDay) {
  if (![peakDemandMmDay, wellMmDay].every((v) => finite(v) && v >= 0))
    return {
      shortfall_mm_day: null,
      ok: null,
      text: "Capacity comparison unavailable",
    };
  const shortfall_mm_day = Math.max(0, peakDemandMmDay - wellMmDay);
  return {
    shortfall_mm_day,
    ok: shortfall_mm_day === 0,
    text:
      shortfall_mm_day > 0
        ? `Peak demand exceeds well capacity by ${shortfall_mm_day.toFixed(2)} mm/day`
        : "Gross well capacity meets the estimated peak demand",
  };
}

const clean = (a) => (Array.isArray(a) ? a.filter(finite) : []);
function quantile(sample, p) {
  const sorted = clean(sample).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * p,
    lo = Math.floor(pos),
    hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
const median = (sample) => quantile(sample, 0.5);
function distribution(sample) {
  const n = clean(sample).length;
  return {
    n,
    ...Object.fromEntries(
      [10, 25, 50, 75, 90].map((p) => [
        `p${p}`,
        n >= 10 ? quantile(sample, p / 100) : null,
      ]),
    ),
  };
}

/** Empirical Weibull percentile 100·rank/(n+1), midranks for ties; at least 10 values. */
export function percentileRank(value, sample) {
  const values = clean(sample).sort((a, b) => a - b),
    n = values.length;
  if (!finite(value) || n < 10) return null;
  const less = values.filter((v) => v < value).length,
    equal = values.filter((v) => v === value).length;
  if (equal) return (100 * (less + (equal + 1) / 2)) / (n + 1);
  if (!less) return 0;
  if (less === n) return 100;
  return (
    (100 *
      (less + (value - values[less - 1]) / (values[less] - values[less - 1]))) /
    (n + 1)
  );
}

// Opposite comparison words, so the label follows the side of the median the value is on.
const OPPOSITE = {
  Drier: "Wetter",
  Wetter: "Drier",
  "More hot days": "Fewer hot days",
  "Fewer hot days": "More hot days",
  "Less green": "Greener",
  Greener: "Less green",
  Lower: "Higher",
  Higher: "Lower",
};
/** Plain status word for the Simple view (PLAN.md §11). */
function plainWord(st) {
  if (!finite(st?.percentile)) return "No new data";
  if (st.direction === "favourable") return "Good";
  if (Math.abs(st.percentile - 50) <= 25) return "Normal";
  return st.severity <= 0.5 ? "Watch" : "Concern";
}
const fmtPlain = (v) =>
  !finite(v) ? "unavailable" : Math.abs(v) >= 10 ? String(Math.round(v)) : String(Math.round(v * 100) / 100);

/**
 * Percentile status with adverse-tail severity, source IDs and an explicit unknown state.
 * `label` is the word for the adverse side ("Drier"); `opposite` is the word for the other side
 * ("Wetter"). The label uses whichever side of the median the value is on, so p72 for a
 * low-adverse factor reads "Wetter than 72% of years", never "Drier than 28%".
 * `plain` = { word, sentence, freq } for the Simple view; analyzeField refines sentence and freq.
 */
export function status(value, sample, options = {}) {
  const {
    adverseWhen = "low",
    unit = "",
    label = "Lower",
    source_ids = [],
  } = options ?? {};
  const opposite = options?.opposite ?? OPPOSITE[label] ?? `Not ${label.toLowerCase()}`;
  const highWord = adverseWhen === "high" ? label : opposite,
    lowWord = adverseWhen === "high" ? opposite : label;
  const percentile = percentileRank(value, sample);
  const result = {
    value: finite(value) ? value : null,
    unit,
    normal_median: median(sample),
    percentile,
    direction: "normal",
    severity: null,
    label: "Unavailable: need a value and at least 10 historical observations",
    source_ids: [...source_ids],
  };
  if (percentile === null) {
    result.direction = null;
    result.plain = {
      word: "No new data",
      sentence: finite(value)
        ? "Too few past years to compare with."
        : "No new reading for this date yet.",
      freq: null,
    };
    return result;
  }
  const adverse = adverseWhen === "low" ? percentile < 25 : percentile > 75;
  const favourable = adverseWhen === "low" ? percentile > 75 : percentile < 25;
  const rounded = Math.round(percentile);
  const out = {
    ...result,
    direction: adverse ? "adverse" : favourable ? "favourable" : "normal",
    severity: adverse ? clamp((Math.abs(percentile - 50) - 25) / 25, 0, 1) : 0,
    label:
      rounded === 50
        ? "Near the median for this date"
        : rounded >= 100
          ? `${highWord} than every past year for this date`
          : rounded <= 0
            ? `${lowWord} than every past year for this date`
            : percentile > 50
          ? `${highWord} than ${rounded}% of years for this date`
          : `${lowWord} than ${100 - rounded}% of years for this date`,
  };
  out.plain = {
    word: plainWord(out),
    sentence: `${fmtPlain(value)}${unit ? " " + unit : ""}; normal is ${fmtPlain(out.normal_median)}.`,
    freq: null,
  };
  return out;
}

const calendarDay = (s) => doy(`2000-${s.slice(5)}`);
/** Baseline p10/p25/p50/p75/p90 arrays, indexed by canonical leap-year day or month minus one. */
export function climatology(
  daily,
  field,
  { baseline = [1991, 2020], window = "doy", smooth = 15 } = {},
) {
  const size = window === "month" ? 12 : 366,
    bins = Array.from({ length: size }, () => []);
  (daily?.date ?? []).forEach((s, i) => {
    const v = daily[field]?.[i],
      y = yearOf(s);
    if (y < baseline[0] || y > baseline[1] || !finite(v)) return;
    const key =
      window === "month" ? Number(s.slice(5, 7)) - 1 : calendarDay(s) - 1;
    bins[key]?.push(v);
  });
  const summaries = bins.map((values, i) => {
    if (window === "month") return distribution(values);
    const pool = [];
    for (
      let offset = -Math.min(182, Math.max(0, smooth));
      offset <= Math.min(182, Math.max(0, smooth));
      offset++
    )
      pool.push(...bins[(i + offset + 366) % 366]);
    return distribution(pool);
  });
  return {
    window,
    baseline,
    ...Object.fromEntries(
      ["n", "p10", "p25", "p50", "p75", "p90"].map((k) => [
        k,
        summaries.map((s) => s[k]),
      ]),
    ),
  };
}

function annualPairs(values, years) {
  const groups = new Map();
  (values ?? []).forEach((v, i) => {
    if (finite(v) && finite(years?.[i])) {
      const y = years[i];
      if (!groups.has(y)) groups.set(y, []);
      groups.get(y).push(v);
    }
  });
  return [...groups]
    .sort((a, b) => a[0] - b[0])
    .map(([year, v]) => ({ year, value: mean(v) }));
}

/** Recurrence among valid annual observations; duplicates are averaged per year. */
export function recurrence(annualValues, years, predicate) {
  const pairs = annualPairs(annualValues, years),
    matching = pairs.filter((p) => predicate(p.value)).map((p) => p.year);
  return {
    count: matching.length,
    n: pairs.length,
    years_matching: matching,
    text: `${matching.length} of ${pairs.length} years`,
  };
}

// Abramowitz–Stegun normal tail approximation; two-sided p, continuity correction below.
function twoSidedP(z) {
  const x = Math.abs(z),
    t = 1 / (1 + 0.2316419 * x);
  return clamp(
    ((2 * Math.exp((-x * x) / 2)) / Math.sqrt(2 * Math.PI)) *
      (0.31938153 * t -
        0.356563782 * t * t +
        1.781477937 * t ** 3 -
        1.821255978 * t ** 4 +
        1.330274429 * t ** 5),
    0,
    1,
  );
}

/** Two-sided Mann–Kendall test with tie correction; input order is chronological. */
export function mannKendall(values) {
  const v = clean(values),
    n = v.length;
  if (n < 2) return { S: null, z: null, p: null, trend: "no clear trend" };
  let S = 0;
  const ties = new Map();
  for (let i = 0; i < n; i++) {
    ties.set(v[i], (ties.get(v[i]) ?? 0) + 1);
    for (let j = i + 1; j < n; j++) S += Math.sign(v[j] - v[i]);
  }
  const correction = [...ties.values()].reduce(
    (s, t) => s + t * (t - 1) * (2 * t + 5),
    0,
  );
  const variance = (n * (n - 1) * (2 * n + 5) - correction) / 18;
  const z =
      variance === 0 || S === 0 ? 0 : (S - Math.sign(S)) / Math.sqrt(variance),
    p = z === 0 ? 1 : twoSidedP(z);
  return {
    S,
    z,
    p,
    trend: p < 0.05 ? (S > 0 ? "increasing" : "decreasing") : "no clear trend",
  };
}

/** Median pairwise annual slope, expressed per decade; equal-year pairs are collapsed. */
export function senSlope(values, years) {
  const pairs = annualPairs(values, years),
    slopes = [];
  for (let i = 0; i < pairs.length; i++)
    for (let j = i + 1; j < pairs.length; j++)
      slopes.push(
        (10 * (pairs[j].value - pairs[i].value)) /
          (pairs[j].year - pairs[i].year),
      );
  return median(slopes);
}

/** Show trend only for at least 30 distinct years with numeric observations. */
export function trend(values, years) {
  const pairs = annualPairs(values, years);
  if (pairs.length < 30) return { shown: false, reason: "need ≥ 30 years" };
  return {
    shown: true,
    n: pairs.length,
    ...mannKendall(pairs.map((p) => p.value)),
    slope_per_decade: senSlope(
      pairs.map((p) => p.value),
      pairs.map((p) => p.year),
    ),
  };
}

function complete(d, start, end, fields = []) {
  const dates = d?.date ?? [];
  return (
    dates.length === dateRange(start, end).length &&
    dates[0] === start &&
    dates.at(-1) === end &&
    dates.every((s, i) => i === 0 || daysBetween(dates[i - 1], s) === 1) &&
    fields.every(
      (k) =>
        Array.isArray(d[k]) &&
        d[k].length === dates.length &&
        d[k].every(finite),
    )
  );
}

/** Last frost before July 1 and first frost after July 1; missing half-years are unknown. */
export function frostDates(daily, year, threshold = 0) {
  if (!daily || !finite(year) || !finite(threshold))
    return { last_spring: null, first_fall: null, frost_free_days: null };
  const spring = between(daily, `${year}-01-01`, `${year}-06-30`),
    fall = between(daily, `${year}-07-02`, `${year}-12-31`);
  const frost = (d) => d.date.filter((_, i) => d.t2m_min[i] <= threshold);
  const last_spring = complete(spring, `${year}-01-01`, `${year}-06-30`, [
    "t2m_min",
  ])
    ? (frost(spring).at(-1) ?? null)
    : null;
  const first_fall = complete(fall, `${year}-07-02`, `${year}-12-31`, [
    "t2m_min",
  ])
    ? (frost(fall)[0] ?? null)
    : null;
  return {
    last_spring,
    first_fall,
    frost_free_days:
      last_spring && first_fall
        ? daysBetween(last_spring, first_fall) - 1
        : null,
  };
}

const monthBounds = (y, m) => [
  `${y}-${String(m).padStart(2, "0")}-01`,
  iso(Date.UTC(y, m, 0)),
];
function monthGroups(daily) {
  const groups = new Map();
  (daily?.date ?? []).forEach((s, i) => {
    const key = s.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  });
  return [...groups].map(([key, indices]) => ({
    year: Number(key.slice(0, 4)),
    month: Number(key.slice(5)),
    daily: pick(daily, indices),
    indices,
  }));
}

/** Monthly share of complete years whose metric is >= threshold (or satisfies a predicate). */
export function monthlyRecurrence(daily, metricFn, threshold) {
  const groups = monthGroups(daily);
  return months.map((month) => {
    const entries = groups
      .filter((g) => g.month === month)
      .map((g) => ({
        year: g.year,
        value: complete(g.daily, ...monthBounds(g.year, month))
          ? metricFn(g.daily)
          : null,
      }));
    const r = recurrence(
      entries.map((e) => e.value),
      entries.map((e) => e.year),
      typeof threshold === "function"
        ? threshold
        : (v) => finite(threshold) && v >= threshold,
    );
    return { month, ...r, share: r.n ? r.count / r.n : null };
  });
}

const composite = (s) => Math.floor((doy(s) - 1) / 16);
function ndviSample(fieldNdvi, date) {
  return (fieldNdvi?.dates ?? []).flatMap((s, i) =>
    yearOf(s) >= 2001 &&
    yearOf(s) <= 2025 &&
    yearOf(s) !== yearOf(date) &&
    composite(s) === composite(date) &&
    finite(fieldNdvi.field_mean?.[i])
      ? [fieldNdvi.field_mean[i]]
      : [],
  );
}

/** NDVI status for the current 16-day composite versus 2001–2025, excluding target year. */
export function ndviStatus(fieldNdvi, date) {
  const index = (fieldNdvi?.dates ?? []).findIndex(
    (s) =>
      s <= date &&
      yearOf(s) === yearOf(date) &&
      composite(s) === composite(date),
  );
  return status(
    index < 0 ? null : fieldNdvi.field_mean?.[index],
    date ? ndviSample(fieldNdvi, date) : [],
    {
      adverseWhen: "low",
      unit: "NDVI",
      label: "Less green",
      source_ids: ndviSources(fieldNdvi),
    },
  );
}

const ndviSources = (d) =>
  d?.source_ids ?? [
    /Planetary Computer/i.test(d?.source ?? "")
      ? "MODIS_MOD13Q1_PC"
      : "MODIS_MOD13Q1_ORNL",
  ];

/** Per-year/month observed mean NDVI below threshold; missing months stay null. */
export function greenCoverCalendar(fieldNdvi, threshold = 0.3) {
  const groups = monthGroups({
    date: fieldNdvi?.dates ?? [],
    ndvi: fieldNdvi?.field_mean ?? [],
  });
  const years = [...new Set(groups.map((g) => g.year))].sort((a, b) => a - b);
  return {
    label: "low green cover",
    years,
    months: [...months],
    low_cover: years.map((y) =>
      months.map((m) => {
        const g = groups.find((g) => g.year === y && g.month === m),
          v = mean(g?.daily.ndvi);
        return v === null || !finite(threshold) ? null : v < threshold;
      }),
    ),
  };
}

/** Co-occurrence scouting clue, never proof of cause. Missing evidence has its own code. */
export function causeCheck({
  ndviStatus,
  soilStatus,
  heatStatus,
  waterStatus,
} = {}) {
  const known = (s) => s && s.direction !== null && finite(s.severity),
    adverse = (s) => known(s) && s.direction === "adverse";
  if (!known(ndviStatus))
    return { code: "unavailable", text: "Greenness evidence is unavailable" };
  if (!adverse(ndviStatus))
    return {
      code: "none",
      text: "Greenness is not in the adverse historical tail",
    };
  if (adverse(waterStatus) || adverse(soilStatus))
    return {
      code: "water",
      text: "Low greenness coincides with adverse water or soil conditions; this is a scouting clue, not proof of cause.",
    };
  if (adverse(heatStatus))
    return {
      code: "heat",
      text: "Low greenness coincides with heat; this is a scouting clue, not proof of cause.",
    };
  if (![soilStatus, waterStatus, heatStatus].every(known))
    return {
      code: "unavailable",
      text: "Weather evidence is incomplete; the cause of low greenness is unknown",
    };
  return {
    code: "not_weather",
    text: "Weather doesn't explain this; scout for pests, nutrients, hail, or equipment issues",
  };
}

/** Monthly 0–3 stressor count against 1991–2020 monthly distributions; incomplete cells are null. */
export function compoundCalendar(daily, etValues, { years } = {}) {
  const groups = monthGroups({
    ...daily,
    et_values: Array.isArray(etValues) ? etValues : (etValues?.values ?? []),
  }).map((g) => {
    const full = complete(g.daily, ...monthBounds(g.year, g.month));
    const hot = full ? hotDays(g.daily.t2m_max) : null,
      wet = full ? mean(g.daily.gwetroot) : null;
    const rain = full ? sum(g.daily.prectotcorr) : null,
      demand = full ? sum(g.daily.et_values) : null;
    return {
      ...g,
      hot,
      wet,
      deficit: finite(rain) && finite(demand) ? rain - demand : null,
    };
  });
  const normals = months.map((m) => {
    const g = groups.filter(
      (g) => g.month === m && g.year >= 1991 && g.year <= 2020,
    );
    return {
      soil: distribution(g.map((g) => g.wet)).p25,
      water: distribution(g.map((g) => g.deficit)).p25,
    };
  });
  years =
    years ?? [...new Set(groups.map((g) => g.year))].sort((a, b) => a - b);
  const detail = years.map((y) =>
    months.map((m) => {
      const g = groups.find((g) => g.year === y && g.month === m),
        n = normals[m - 1];
      const hot = finite(g?.hot) ? g.hot >= 3 : null,
        dry_soil = finite(g?.wet) && finite(n.soil) ? g.wet < n.soil : null,
        water_deficit =
          finite(g?.deficit) && finite(n.water) ? g.deficit < n.water : null;
      return { year: y, month: m, hot, dry_soil, water_deficit };
    }),
  );
  return {
    years,
    months: [...months],
    counts: detail.map((row) =>
      row.map((d) =>
        [d.hot, d.dry_soil, d.water_deficit].some((v) => v === null)
          ? null
          : Number(d.hot) + Number(d.dry_soil) + Number(d.water_deficit),
      ),
    ),
    detail,
  };
}

const POWER = ["NASA_POWER_DAILY"],
  WATER = ["NASA_POWER_DAILY", "FAO56"];
function stageWindow(
  daily,
  crop,
  plantDate,
  upper = crop?.sensitive_window?.gdd_to,
) {
  const w = crop?.sensitive_window;
  const empty = {
    name: w?.name ?? null,
    start: null,
    end: null,
    hot_days: null,
    heat_degree_days: null,
    complete: false,
    progress: null,
  };
  if (
    plantDate &&
    w?.date_from &&
    w?.date_to &&
    finite(crop.heat_threshold_c)
  ) {
    const py = yearOf(plantDate),
      harvestYear = py + (crop.season?.plant > crop.season?.harvest ? 1 : 0);
    const start = `${harvestYear}-${w.date_from}`,
      end = `${harvestYear}-${w.date_to}`;
    const s = between(daily, start, end),
      full = complete(s, start, end, ["t2m_max"]);
    return {
      ...empty,
      start: s.date?.[0] ?? null,
      end: full ? end : null,
      hot_days: full ? hotDays(s.t2m_max, crop.heat_threshold_c) : null,
      heat_degree_days: full ? heatDegreeDays(s.t2m_max) : null,
      complete: full,
      method: "calendar",
    };
  }
  if (
    !plantDate ||
    ![
      w?.gdd_from,
      w?.gdd_to,
      upper,
      crop?.gdd_base_c,
      crop?.gdd_cap_c,
      crop?.heat_threshold_c,
    ].every(finite) ||
    w.gdd_to < w.gdd_from
  )
    return empty;
  const py = yearOf(plantDate),
    harvest = crop.season?.harvest ?? "12-31",
    end = `${py + (harvest < plantDate.slice(5) ? 1 : 0)}-${harvest}`;
  const d = between(daily, plantDate, end),
    gd = cumulativeGdd(d, plantDate, crop.gdd_base_c, crop.gdd_cap_c) ?? [];
  const endIndex = gd.findIndex((v) => finite(v) && v >= upper);
  const last = endIndex >= 0 ? endIndex : gd.length - 1;
  if (last < 0 || !finite(gd[last])) return empty;
  const indices = gd.flatMap((v, i) =>
    i <= last && finite(v) && v >= w.gdd_from && v <= upper ? [i] : [],
  );
  if (!indices.length) return { ...empty, progress: gd[last] };
  const tx = indices.map((i) => d.t2m_max[i]);
  return {
    name: w.name,
    start: d.date[indices[0]],
    end: endIndex >= 0 ? d.date[indices.at(-1)] : null,
    hot_days: hotDays(tx, crop.heat_threshold_c),
    heat_degree_days: heatDegreeDays(tx),
    complete: endIndex >= 0,
    progress: Math.min(gd[last], upper),
  };
}

/** Heat within crop GDD window versus 1991–2020 at equivalent GDD progress. */
export function stageHeat(daily, crop, plantDate, year) {
  const current = stageWindow(daily, crop, plantDate),
    historical = [];
  if (
    (finite(current.progress) || current.method === "calendar") &&
    current.start
  )
    for (let y = 1991; y <= 2020; y++) {
      if (y === year) continue;
      const pd = `${y - (year - yearOf(plantDate))}-${plantDate.slice(5)}`;
      const h = stageWindow(daily, crop, pd, current.progress);
      if (h.complete) historical.push({ year: y, ...h });
    }
  return {
    ...current,
    status: status(
      current.hot_days,
      historical.map((h) => h.hot_days),
      {
        adverseWhen: "high",
        unit: "days",
        label: "More hot days",
        source_ids: POWER,
      },
    ),
    normal_heat_degree_days: median(historical.map((h) => h.heat_degree_days)),
    historical,
  };
}

function spearman(points, key) {
  const pairs = points.filter((p) => finite(p[key]) && finite(p.yield));
  if (new Set(pairs.map((p) => p.year)).size < 5) return null;
  const rank = (v) =>
    v.map(
      (x) =>
        v.filter((t) => t < x).length +
        (v.filter((t) => t === x).length + 1) / 2,
    );
  const x = rank(pairs.map((p) => p[key])),
    y = rank(pairs.map((p) => p.yield)),
    mx = mean(x),
    my = mean(y);
  const cov = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0),
    vx = sum(x.map((v) => (v - mx) ** 2)),
    vy = sum(y.map((v) => (v - my) ** 2));
  return vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : null;
}

/** Match farmer season yields to weather indicators; Spearman associations are pattern, not proof. */
export function farmSensitivity(records, annualIndicators) {
  const indicators = Array.isArray(annualIndicators) ? annualIndicators : [];
  const points = (records ?? [])
    .filter((r) => finite(r.yield) && (r.period ?? "season") === "season")
    .flatMap((r) => {
      const indicator = indicators.find((v) => v.year === r.year);
      return indicator
        ? [
            {
              year: r.year,
              crop: r.crop ?? null,
              yield: r.yield,
              yield_unit: r.yield_unit ?? null,
              hot_days: indicator.hot_days ?? null,
              season_deficit_mm: indicator.season_deficit_mm ?? null,
            },
          ]
        : [];
    });
  const note = "pattern, not proof";
  if (new Set(points.map((p) => p.year)).size < 5)
    return { pattern: "too few years to judge", points, note };
  const comparable =
    new Set(points.map((p) => `${p.crop}|${p.yield_unit}`)).size === 1 &&
    points.every((p) => p.crop && p.yield_unit) &&
    new Set(points.map((p) => p.year)).size === points.length;
  return {
    pattern: comparable
      ? "association only"
      : "incomparable crops, yield units, or duplicate years",
    points,
    rho: {
      hot_days: comparable ? spearman(points, "hot_days") : null,
      season_deficit_mm: comparable
        ? spearman(points, "season_deficit_mm")
        : null,
    },
    note,
  };
}

function mergeDaily(history, live, today) {
  const keys = [
    ...new Set([
      "t2m_max",
      "t2m_min",
      "prectotcorr",
      "rh2m",
      "ws2m",
      "allsky_sw_dwn",
      "gwetroot",
      "gwettop",
      ...Object.keys(history ?? {}),
      ...Object.keys(live ?? {}),
    ]),
  ].filter(
    (k) =>
      k !== "date" &&
      (Array.isArray(history?.[k]) ||
        Array.isArray(live?.[k]) ||
        [
          "t2m_max",
          "t2m_min",
          "prectotcorr",
          "rh2m",
          "ws2m",
          "allsky_sw_dwn",
          "gwetroot",
          "gwettop",
        ].includes(k)),
  );
  const rows = new Map();
  for (const source of [history, live])
    (source?.date ?? []).forEach((s, i) => {
      if (!Number.isFinite(stamp(s)) || s > today) return;
      const row = rows.get(s) ?? {};
      for (const key of keys)
        if (Array.isArray(source[key]))
          row[key] = finite(source[key][i]) ? source[key][i] : null;
      rows.set(s, row);
    });
  const first = [...rows.keys()].sort()[0];
  const date = first ? dateRange(first, today) : [];
  return {
    ...history,
    ...live,
    date,
    ...Object.fromEntries(
      keys.map((k) => [k, date.map((s) => rows.get(s)?.[k] ?? null)]),
    ),
  };
}
function cumulative(values) {
  let total = 0;
  return (values ?? []).map((v) => {
    total = finite(v) && total !== null ? total + v : null;
    return total;
  });
}
function cropList(crops) {
  return Array.isArray(crops) ? crops : (crops?.crops ?? []);
}
function fieldLatitude(field) {
  if (finite(field?.lat)) return field.lat;
  if (finite(field?.center?.lat)) return field.center.lat;
  const geometry = field?.geometry,
    coords =
      geometry?.type === "Polygon"
        ? geometry.coordinates.flat()
        : geometry?.type === "MultiPolygon"
          ? geometry.coordinates.flat(2)
          : [];
  const lats = coords.map((p) => p[1]).filter(finite);
  return lats.length ? (Math.min(...lats) + Math.max(...lats)) / 2 : null;
}
function seasonDates(crop, harvestYear, plantOverride) {
  if (crop?.id === "fallow")
    return { plant: `${harvestYear}-01-01`, harvest: `${harvestYear}-12-31` };
  const plant = crop?.season?.plant,
    harvest = crop?.season?.harvest;
  if (
    !plant ||
    !harvest ||
    !Number.isFinite(stamp(`2000-${plant}`)) ||
    !Number.isFinite(stamp(`2000-${harvest}`))
  )
    return null;
  return {
    plant:
      plantOverride ?? `${harvestYear - (plant > harvest ? 1 : 0)}-${plant}`,
    harvest: `${harvestYear}-${harvest}`,
  };
}
function seasonalSummary(d, crop, plant, end) {
  const s = between(d, plant, end),
    kc =
      crop?.id === "fallow"
        ? s.date.map(() => (finite(crop.kc?.ini) ? crop.kc.ini : null))
        : kcCurve(crop, plant, s.date),
    demand = cropDemand(s.et_values ?? [], kc);
  const full = complete(s, plant, end),
    rain = full ? sum(s.prectotcorr) : null,
    total = full ? sum(demand) : null;
  const gd = crop
    ? cumulativeGdd(s, plant, crop.gdd_base_c, crop.gdd_cap_c)
    : null;
  return {
    daily: s,
    demand,
    rain,
    demand_mm: total,
    balance: finite(rain) && finite(total) ? rain - total : null,
    hot_days: full ? hotDays(s.t2m_max, crop?.heat_threshold_c ?? 35) : null,
    gdd: full ? (gd?.at(-1) ?? null) : null,
    rain_cum: full ? cumulative(s.prectotcorr) : s.date.map(() => null),
    demand_cum: full ? cumulative(demand) : s.date.map(() => null),
  };
}
function irrigationSeries(record, dates, today) {
  const entries = record?.irrigation;
  if (Array.isArray(entries)) {
    const byDate = new Map();
    for (const e of entries)
      if (e?.date)
        byDate.set(
          e.date,
          finite(e.mm) && e.mm >= 0 ? (byDate.get(e.date) ?? 0) + e.mm : null,
        );
    const daily = dates.map((s) => (byDate.has(s) ? byDate.get(s) : 0));
    return {
      daily,
      cumulative: cumulative(daily),
      total: sum(daily),
      timed: true,
    };
  }
  const futureTotal =
    record?.harvest_date > today && !(record?.as_of && record.as_of <= today);
  const total =
    !futureTotal && finite(record?.irrigation_mm) && record.irrigation_mm >= 0
      ? record.irrigation_mm
      : null;
  const daily = dates.map(() => (total === 0 ? 0 : null));
  const cum = dates.map((_, i) =>
    total === 0 ? 0 : i === dates.length - 1 ? total : null,
  );
  return { daily, cumulative: cum, total, timed: total === 0 };
}
function alignedNormal(history, dates, field) {
  return dates.map((s) =>
    distribution(
      history.map((h) => {
        const i = h.daily.date.findIndex((d) => d.slice(5) === s.slice(5));
        if (i < 0) return null;
        const r = h.rain_cum[i],
          demand = h.demand_cum[i];
        return field === "balance" && finite(r) && finite(demand)
          ? r - demand
          : null;
      }),
    ),
  );
}
function frostNormal(history, key) {
  const n = median(history.map((f) => (f[key] ? calendarDay(f[key]) : null)));
  return n === null ? null : iso(Date.UTC(2000, 0, Math.round(n))).slice(5);
}

/**
 * How often past years were at least as extreme as this one, on the side of the median this year
 * is on. `phrases` = { high, low } completes "In X of N years (1981–2025), ...".
 * `text` stays "X of N years (span)" so parsers that read "X of N" keep working.
 */
function comparisonRecurrence(values, years, current, phrases) {
  const pairs = annualPairs(values, years),
    span = pairs.length ? `${pairs[0].year}–${pairs.at(-1).year}` : "";
  if (!finite(current))
    return {
      count: null,
      n: pairs.length,
      years_matching: [],
      text: `unavailable (${pairs.length} past years)`,
      reason: "Current indicator unavailable",
    };
  const side = current >= median(pairs.map((p) => p.value)) ? "high" : "low";
  const r = recurrence(values, years, (v) =>
    side === "high" ? v >= current : v <= current,
  );
  const phrase = phrases?.[side] ?? (side === "high" ? "the value was at least this high" : "the value was at least this low");
  return {
    ...r,
    side,
    span,
    text: `${r.text} (${span})`,
    label: `Years when ${phrase}`,
    sentence: `In ${r.count} of ${r.n} years (${span}), ${phrase}.`,
    definition: `Counts past years (${span}) whose value for the same dates was ${side === "high" ? "at least" : "at most"} this year's value.`,
  };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "mid-November" style phrase for an ISO date. */
function timeOfYear(s) {
  const day = Number(s.slice(8, 10)),
    m = MONTHS[Number(s.slice(5, 7)) - 1];
  return `${day <= 10 ? "early" : day <= 20 ? "mid" : "late"}-${m}`;
}
const inches = (mm) => (mm / 25.4).toFixed(1);
const waterPhrase = (v) =>
  v < 0
    ? `${Math.round(-v)} mm (${inches(-v)} in) short`
    : `${Math.round(v)} mm (${inches(v)} in) to spare`;
/** "This happens about N years in 10." from a recurrence. */
function freqText(r) {
  if (!finite(r?.count) || !r?.n) return null;
  const n = Math.round((10 * r.count) / r.n);
  return n < 1
    ? "This happens less than 1 year in 10."
    : n >= 10
      ? "This happens almost every year."
      : `This happens about ${n} year${n === 1 ? "" : "s"} in 10.`;
}
/** Replace the generic plain sentence with a factor-specific one, and attach the frequency. */
function withPlain(st, sentence, rec) {
  if (!st) return st;
  const word = st.plain?.word ?? plainWord(st);
  st.plain = {
    word,
    sentence: word === "No new data" ? (st.plain?.sentence ?? sentence) : sentence,
    freq: word === "No new data" ? null : freqText(rec),
  };
  return st;
}

/** Four factors and interactions for a field, with reproducible as-of date and missing-data notes. */
export function analyzeField({
  daily,
  liveDaily,
  ndvi,
  soil,
  farmField,
  crops,
  today,
  site,
  rotation,
  farm,
} = {}) {
  today = today ?? liveDaily?.date?.at(-1) ?? daily?.date?.at(-1);
  if (!Number.isFinite(stamp(today)))
    throw new TypeError(
      "analyzeField requires an ISO today date or dated daily input",
    );
  const year = yearOf(today),
    d = mergeDaily(daily, liveDaily, today),
    lat = site?.lat ?? daily?.lat ?? fieldLatitude(farmField);
  d.units = liveDaily?.units ?? site?.units ?? d.units;
  d.elev_m = site?.elev_m ?? site?.elevation_m ?? d.elev_m;
  const evaporation = et0(d, lat);
  d.et_values = evaporation.values;
  const notes = [
    "POWER is regional context (~50 km), not a field measurement; root-zone wetness is model-based MERRA-2.",
    "Crop demand is ET₀ × Kc, not metered pumping or OpenET.",
    "Historical water and heat comparisons hold the current crop and planting calendar fixed. Water status compares rain minus demand before irrigation.",
  ];
  const record =
    farmField?.records?.find(
      (r) => r.year === year && (r.period ?? "season") === "season",
    ) ?? (farmField?.crop ? farmField : null);
  const crop = cropList(crops).find((c) => c.id === record?.crop),
    bounds = seasonDates(crop, year, record?.planting_date);
  if (!crop)
    notes.push(
      "Current crop is unconfirmed; crop demand and stage calculations are unavailable.",
    );
  const plant = bounds?.plant ?? `${year}-01-01`,
    end = bounds?.harvest && bounds.harvest < today ? bounds.harvest : today;
  const current = seasonalSummary(d, crop, plant, end),
    dates = current.daily.date;
  const irrigation = irrigationSeries(record, dates, today);
  if (!irrigation.timed)
    notes.push(
      "Daily irrigation timing is unavailable; no daily bucket is inferred from a seasonal total. A reported total appears only at the final chart date.",
    );
  if (crop?.verify?.length)
    notes.push(...crop.verify.map((v) => `Crop parameter verification: ${v}`));
  const years = [...new Set(d.date.map(yearOf))].filter((y) => y < year);
  const historical = years.map((y) => {
    const py = y - (year - yearOf(plant)),
      ey = y - (year - yearOf(end));
    return {
      year: y,
      ...seasonalSummary(
        d,
        crop,
        `${py}-${plant.slice(5)}`,
        `${ey}-${end.slice(5)}`,
      ),
    };
  });
  const normals = historical.filter((h) => h.year >= 1991 && h.year <= 2020),
    normalsSeries = alignedNormal(normals, dates, "balance");
  const waterStatus = status(
    current.balance,
    normals.map((h) => h.balance),
    { unit: "mm", label: "Drier", source_ids: WATER },
  );
  const heatStatus = status(
    current.hot_days,
    normals.map((h) => h.hot_days),
    {
      adverseWhen: "high",
      unit: "days",
      label: "More hot days",
      source_ids: POWER,
    },
  );
  const soilNormals = climatology(d, "gwetroot"),
    soilIndices = dates.map(calendarDay);
  const soilSample = years
    .filter((y) => y >= 1991 && y <= 2020)
    .map((y) => {
      const target = `${y}-${today.slice(5)}`,
        i = d.date.indexOf(target);
      return i < 0 ? null : d.gwetroot[i];
    });
  const todayIndex = d.date.indexOf(today),
    soilValue = todayIndex < 0 ? null : d.gwetroot[todayIndex];
  const soilStatus = status(soilValue, soilSample, {
    unit: "0–1",
    label: "Drier",
    source_ids: POWER,
  });
  const fieldNdvi = ndvi?.fields
    ? ndvi.fields.find((f) => f.field_id === farmField?.field_id)
    : ndvi;
  const visibleNdvi = {
    source_ids: ndvi?.source_ids ?? ndviSources(fieldNdvi),
    dates: [],
    field_mean: [],
  };
  (fieldNdvi?.dates ?? []).forEach((s, i) => {
    if (s <= today) {
      visibleNdvi.dates.push(s);
      visibleNdvi.field_mean.push(fieldNdvi.field_mean?.[i] ?? null);
    }
  });
  // As-of rule: if no composite covers today, use the newest composite up to 32 days old
  // (one 16-day composite plus processing lag), compared with the same period in past years.
  let cropStatus = ndviStatus(visibleNdvi, today),
    ndviAsOf = finite(cropStatus.percentile) ? today : null;
  if (!finite(cropStatus.percentile)) {
    const latest = visibleNdvi.dates.findLast(
      (s, i) => finite(visibleNdvi.field_mean[i]) && daysBetween(s, today) <= 32,
    );
    if (latest) {
      const st = ndviStatus(visibleNdvi, latest);
      if (finite(st.percentile)) {
        cropStatus = { ...st, label: st.label.replace("for this date", `for ${MONTHS[Number(latest.slice(5, 7)) - 1].slice(0, 3)} ${Number(latest.slice(8, 10))}`) };
        ndviAsOf = latest;
      }
    } else if (visibleNdvi.dates.length)
      cropStatus.reason = `latest value is older than 32 days (${visibleNdvi.dates.at(-1)})`;
  }
  cropStatus.as_of = ndviAsOf;
  const ndviCurrent = visibleNdvi.dates.flatMap((s, i) =>
      yearOf(s) === year ? [i] : [],
    );
  const ndviNormals = ndviCurrent.map((i) =>
    distribution(ndviSample(visibleNdvi, visibleNdvi.dates[i])),
  );
  const capacity = capacityCheck(
    peakDemand(current.demand),
    wellCapacityMmDay(farmField?.well_capacity_gpm, farmField?.area_ha),
  );
  const stage = stageHeat(d, crop, bounds?.plant, year);
  const frostHistory = years
    .filter((y) => y >= 1991 && y <= 2020)
    .map((y) => frostDates(d, y));
  const currentFrost = frostDates(d, year);
  const annualIndicators = (farmField?.records ?? [])
    .filter((r) => r.year < year && (r.period ?? "season") === "season")
    .map((r) => {
      const rc = cropList(crops).find((c) => c.id === r.crop),
        rb = seasonDates(rc, r.year, r.planting_date);
      const h = rb
        ? seasonalSummary(d, rc, rb.plant, r.harvest_date ?? rb.harvest)
        : null;
      return {
        year: r.year,
        hot_days: h?.hot_days ?? null,
        season_deficit_mm: finite(h?.balance) ? -h.balance : null,
      };
    });
  const currentYearIndices = d.date.flatMap((s, i) =>
    yearOf(s) === year ? [i] : [],
  );
  const required = ["t2m_max", "t2m_min", "prectotcorr", "gwetroot"];
  const missing = dateRange(`${year}-01-01`, today).filter((s) => {
    const i = d.date.indexOf(s);
    return i < 0 || required.some((k) => !finite(d[k]?.[i]));
  }).length;
  const methodShare = Object.fromEntries(
    ["penman_monteith", "hargreaves", "unavailable"].map((method) => [
      method,
      currentYearIndices.length
        ? currentYearIndices.filter(
            (i) => (evaporation.method_per_day[i] ?? "unavailable") === method,
          ).length / currentYearIndices.length
        : null,
    ]),
  );
  const lastAvailable =
    d.date.findLast((_, i) => required.every((k) => finite(d[k]?.[i]))) ?? null;
  const gdd = current.gdd,
    stageNow =
      !finite(gdd) || !crop
        ? null
        : finite(crop.gdd_to_maturity_c) && gdd >= crop.gdd_to_maturity_c
          ? "maturity"
          : finite(crop.sensitive_window?.gdd_from) &&
              finite(crop.sensitive_window?.gdd_to) &&
              gdd >= crop.sensitive_window.gdd_from &&
              gdd <= crop.sensitive_window.gdd_to
            ? crop.sensitive_window.name
            : finite(crop.gdd_to_silking_c) && gdd >= crop.gdd_to_silking_c
              ? "post-silking"
              : finite(crop.gdd_to_silking_c)
                ? "vegetative"
                : null;
  const waterRec = comparisonRecurrence(
    historical.map((h) => h.balance),
    years,
    current.balance,
    { high: "the season was at least this wet", low: "the season was at least this dry" },
  );
  const heatRec = comparisonRecurrence(
    historical.map((h) => h.hot_days),
    years,
    current.hot_days,
    { high: "there were at least this many hot days", low: "there were this few hot days or fewer" },
  );
  const soilRec = comparisonRecurrence(
    years.map((y) => {
      const i = d.date.indexOf(`${y}-${today.slice(5)}`);
      return i < 0 ? null : (d.gwetroot[i] ?? null);
    }),
    years,
    soilValue,
    { high: "the root zone was at least this wet on this date", low: "the root zone was at least this dry on this date" },
  );
  // Plain sentences for the Simple view (PLAN.md §11): units, °F / inches, no percentiles or codes.
  const when = timeOfYear(today),
    thr = crop?.heat_threshold_c ?? 35;
  if (!crop && waterStatus.plain)
    waterStatus.plain.sentence = "Enter this season's crop in My farm records to see crop water use.";
  withPlain(
    waterStatus,
    `Rain minus crop water use this season: ${waterPhrase(current.balance)}; a normal season is ${waterPhrase(waterStatus.normal_median)}.`,
    waterRec,
  );
  withPlain(
    heatStatus,
    `${Math.round(current.hot_days)} days above ${thr} °C (${Math.round(thr * 1.8 + 32)} °F) this season; normal is ${Math.round(heatStatus.normal_median)}.`,
    heatRec,
  );
  withPlain(
    soilStatus,
    `Root-zone wetness is ${Math.round(soilValue * 100)}%; usually ${Math.round(soilStatus.normal_median * 100)}% in ${when}.`,
    soilRec,
  );
  if (cropStatus && !finite(cropStatus.percentile) && cropStatus.plain)
    cropStatus.plain.sentence = visibleNdvi.dates.length
      ? `No satellite greenness image for this period yet; the newest is from ${visibleNdvi.dates.at(-1)}.`
      : "No satellite greenness images for this field.";
  withPlain(
    cropStatus,
    `Field greenness${ndviAsOf && ndviAsOf !== today ? ` in ${timeOfYear(ndviAsOf)} was` : " is"} ${finite(cropStatus?.value) ? cropStatus.value.toFixed(2) : "unavailable"}; usually ${finite(cropStatus?.normal_median) ? cropStatus.normal_median.toFixed(2) : "unavailable"} for that time of year.`,
    null,
  );
  waterStatus.as_of = finite(waterStatus.value) ? end : null;
  heatStatus.as_of = finite(heatStatus.value) ? end : null;
  soilStatus.as_of = finite(soilValue) ? today : null;
  const annual = annualSeries(d, [...historical, { year, ...current }]);
  return {
    annual,
    factors: {
      water: {
        status: waterStatus,
        series: {
          dates,
          rain_cum: current.rain_cum,
          demand_cum: current.demand_cum,
          irrigation_cum: irrigation.cumulative,
          normal_p25: normalsSeries.map((s) => s.p25),
          normal_p50: normalsSeries.map((s) => s.p50),
          normal_p75: normalsSeries.map((s) => s.p75),
        },
        recurrence: waterRec,
        trend: trend(
          historical.map((h) => h.balance),
          years,
        ),
        bucket: rootZoneBucket({
          dates,
          rain: current.daily.prectotcorr,
          demand: current.demand,
          irrigation: irrigation.daily,
          taw_mm: finite(soil?.aws_0_150_cm) ? soil.aws_0_150_cm * 10 : null,
          p: crop?.p_depletion,
        }),
        capacity,
        source_ids: WATER,
      },
      temperature: {
        status: heatStatus,
        gdd: {
          to_date: gdd,
          normal_p50: median(normals.map((h) => h.gdd)),
          stage_now: stageNow,
        },
        frost: {
          ...currentFrost,
          normal_last_spring: frostNormal(frostHistory, "last_spring"),
          normal_first_fall: frostNormal(frostHistory, "first_fall"),
        },
        stage_heat: stage,
        recurrence: heatRec,
        trend: trend(
          historical.map((h) => h.hot_days),
          years,
        ),
        source_ids: POWER,
      },
      soil_moisture: {
        status: soilStatus,
        series: {
          dates,
          gwetroot: current.daily.gwetroot ?? dates.map(() => null),
          p25: soilIndices.map((i) => soilNormals.p25[i - 1]),
          p50: soilIndices.map((i) => soilNormals.p50[i - 1]),
          p75: soilIndices.map((i) => soilNormals.p75[i - 1]),
        },
        recurrence: soilRec,
        source_ids: POWER,
      },
      crop_condition: {
        status: cropStatus,
        series: {
          dates: ndviCurrent.map((i) => visibleNdvi.dates[i]),
          field_mean: ndviCurrent.map((i) => visibleNdvi.field_mean[i]),
          p25: ndviNormals.map((s) => s.p25),
          p50: ndviNormals.map((s) => s.p50),
          p75: ndviNormals.map((s) => s.p75),
        },
        green_cover_calendar: greenCoverCalendar(visibleNdvi),
        source_ids: ndviSources(visibleNdvi),
      },
    },
    interactions: {
      compound_calendar: compoundCalendar(d, evaporation.values, {}),
      cause_check: causeCheck({
        ndviStatus: cropStatus,
        soilStatus,
        heatStatus,
        waterStatus,
      }),
      capacity,
      stage_heat: stage,
      farm_sensitivity: farmSensitivity(farmField?.records, annualIndicators),
    },
    rotation_fit: rotation
      ? (Array.isArray(rotation) ? rotation : [rotation]).map((r) =>
          rotationFit({
            rotation: r,
            crops,
            daily: { ...d, lat },
            soil,
            farmField,
            farm,
          }),
        )
      : [],
    data_quality: {
      live_through: lastAvailable,
      missing_days: missing,
      missing_days_this_year: missing,
      et0_method_share: methodShare,
      notes,
    },
  };
}

/**
 * Year-by-year series for the field-view slider, using the same crop calendar as this season.
 * water_deficit_mm = crop demand minus rain (positive = short), null when no crop is entered.
 */
function annualSeries(d, rows) {
  const years = rows.map((r) => r.year);
  const water_deficit_mm = rows.map((r) =>
    finite(r.balance) ? Math.round(-r.balance) : null,
  );
  const hot_days = rows.map((r) => (finite(r.hot_days) ? r.hot_days : null));
  const gwetroot_jul = years.map((y) => {
    const v = clean(
      d.date.flatMap((s, i) => (s.startsWith(`${y}-07`) ? [d.gwetroot?.[i]] : [])),
    );
    return v.length >= 25 ? Math.round(mean(v) * 100) / 100 : null;
  });
  const first = years[0];
  let maxHot = -Infinity,
    maxDef = -Infinity;
  const caption = years.map((y, i) => {
    const h = hot_days[i],
      w = water_deficit_mm[i];
    if (!finite(h) && !finite(w)) return `${y}: data incomplete.`;
    const parts = [];
    if (finite(h)) {
      parts.push(`${h} hot day${h === 1 ? "" : "s"}${i > 0 && h > maxHot ? `, the most since ${first}` : ""}`);
      maxHot = Math.max(maxHot, h);
    }
    if (finite(w)) {
      parts.push(
        w > 0
          ? `${w} mm short of crop demand${i > 0 && w > maxDef ? `, the driest since ${first}` : ""}`
          : "rain covered crop demand",
      );
      maxDef = Math.max(maxDef, w);
    }
    return `${y}: ${parts.join("; ")}.`;
  });
  return { years, water_deficit_mm, hot_days, gwetroot_jul, caption };
}

function rotationCalendar(sequence) {
  return sequence.map((crop, i) => ({
    phase: i,
    crop_id: crop?.id ?? null,
    planting_year: crop?.season
      ? i + 1 - (crop.season.plant > crop.season.harvest ? 1 : 0)
      : null,
    plant: crop?.id === "fallow" ? "01-01" : (crop?.season?.plant ?? null),
    harvest_year: i + 1,
    harvest: crop?.id === "fallow" ? "12-31" : (crop?.season?.harvest ?? null),
  }));
}
function lowCoverMonths(sequence) {
  if (!sequence.length || sequence.some((c) => !c?.season)) return null;
  const n = sequence.length,
    start = "2001-01-01",
    end = `${2000 + n}-12-31`,
    dates = dateRange(start, end);
  const spans = [];
  for (let repeat = -1; repeat <= 1; repeat++)
    sequence.forEach((crop, i) => {
      if (crop.id === "fallow") return;
      const b = seasonDates(crop, 2001 + i + repeat * n);
      spans.push(b);
    });
  const uncovered = dates.filter(
    (s) => !spans.some((b) => s >= b.plant && s <= b.harvest),
  ).length;
  return (12 * uncovered) / dates.length;
}

/** Compare rotation phases over identical harvest years; estimates fit, never yield or profit. */
export function rotationFit({
  rotation,
  crops,
  daily,
  soil,
  farmField,
  farm,
  years = [1991, 2025],
} = {}) {
  const library = cropList(crops),
    ids = rotation?.sequence ?? [],
    sequence = ids.map((id) => library.find((c) => c.id === id));
  const notes = [
    "Each phase uses the same harvest-year weather range; annual metrics average phases, not separate phase-specific year subsets.",
    "Demand is potential ET₀ × Kc. Supply is rain plus the annual allocation; no application losses or stored soil water are credited.",
    "Calendar low-cover months are equivalent months outside crop dates, not observed bare soil. Residue and winter dormancy are not inferred.",
  ];
  const empty = {
    rotation_id: rotation?.id ?? null,
    metrics: {
      shortfall_years: null,
      median_shortfall_mm: null,
      median_irrigation_need_mm: null,
      peak_capacity_short_years: null,
      sensitive_heat_years: null,
      frost_risk_years: null,
      low_cover_months_per_year: null,
      demand_by_month: Array(12).fill(null),
    },
    calendar: rotationCalendar(sequence),
    seasons: [],
    annual: [],
    notes,
  };
  if (
    !ids.length ||
    sequence.some((c) => !seasonDates(c, 2000)) ||
    !Array.isArray(years) ||
    years.length !== 2 ||
    !years.every(Number.isInteger) ||
    years[1] < years[0]
  ) {
    notes.push(
      "Rotation, crop calendar, or year range unavailable; no fit metrics evaluated.",
    );
    return empty;
  }
  const evaluationYears = Array.from(
    { length: years[1] - years[0] + 1 },
    (_, i) => years[0] + i,
  );
  const last = daily?.date?.at(-1),
    d = last ? mergeDaily(daily, null, last) : { date: [] };
  const lat = daily?.lat ?? fieldLatitude(farmField) ?? farm?.lat;
  d.et_values = et0(d, lat).values;
  if (!finite(lat))
    notes.push(
      "Latitude is unavailable; supply daily.lat, field geometry, or farm.lat for ET calculations.",
    );
  const allocation = farm?.constraints?.annual_allocation_mm;
  const well = wellCapacityMmDay(
    farmField?.well_capacity_gpm,
    farmField?.area_ha,
  );
  if (!finite(allocation))
    notes.push(
      "Annual irrigation allocation unknown; shortfall is not evaluated.",
    );
  if (!finite(well))
    notes.push("Well capacity unknown; peak-capacity risk is not evaluated.");
  if (sequence.some((c) => c.season.plant > c.season.harvest))
    notes.push(
      "Autumn-sown winter crops use prior-year weather; frost-free duration is not a valid winter-survival model, so winter frost risk is unavailable. Calendar Kc does not model vernalization or winter dormancy.",
    );
  for (const crop of sequence)
    if (crop.verify?.length)
      notes.push(...crop.verify.map((v) => `${crop.id}: ${v}`));
  const seasons = [];
  for (const y of evaluationYears)
    sequence.forEach((crop, phase) => {
      const b = seasonDates(crop, y),
        summary = seasonalSummary(d, crop, b.plant, b.harvest),
        s = summary.daily;
      const full = complete(s, b.plant, b.harvest),
        need = finite(summary.balance) ? Math.max(0, -summary.balance) : null;
      const shortfall =
        finite(need) && finite(allocation) && allocation >= 0
          ? Math.max(0, need - allocation)
          : null;
      const windows = rolling(summary.demand, 7),
        capacityDays =
          full && windows.length && windows.every(finite) && finite(well)
            ? windows.filter((v) => v > well).length
            : null;
      const heat = stageWindow(d, crop, b.plant),
        f = frostDates(d, y);
      const frostRisk =
        crop.season.plant <= crop.season.harvest &&
        finite(crop.frost_free_days_needed) &&
        finite(f.frost_free_days)
          ? Number(f.frost_free_days < crop.frost_free_days_needed)
          : null;
      const monthly = months.map((m) => {
        const values = s.date.flatMap((date, i) =>
          Number(date.slice(5, 7)) === m ? [summary.demand?.[i] ?? null] : [],
        );
        return !full ? null : values.length ? sum(values) : 0;
      });
      seasons.push({
        year: y,
        phase,
        crop_id: crop.id,
        planting_date: b.plant,
        harvest_date: b.harvest,
        rain_mm: summary.rain,
        demand_mm: summary.demand_mm,
        irrigation_need_mm: need,
        shortfall_mm: shortfall,
        capacity_shortfall_days: capacityDays,
        sensitive_hot_days: heat.complete ? heat.hot_days : null,
        frost_risk: frostRisk,
        demand_by_month: monthly,
      });
    });
  const annual = evaluationYears.map((y) => {
    const phases = seasons.filter((s) => s.year === y);
    return {
      year: y,
      shortfall_mm: mean(phases.map((s) => s.shortfall_mm)),
      irrigation_need_mm: mean(phases.map((s) => s.irrigation_need_mm)),
      capacity_shortfall_days: mean(
        phases.map((s) => s.capacity_shortfall_days),
      ),
      sensitive_hot_days: mean(phases.map((s) => s.sensitive_hot_days)),
      frost_risk: mean(phases.map((s) => s.frost_risk)),
      demand_by_month: months.map((_, m) =>
        mean(phases.map((s) => s.demand_by_month[m])),
      ),
    };
  });
  const recur = (key) => {
    const values = annual.map((a) => a[key]);
    return values.some(finite)
      ? recurrence(values, evaluationYears, (v) => v > 0).text
      : null;
  };
  for (const key of [
    "shortfall_mm",
    "capacity_shortfall_days",
    "sensitive_hot_days",
    "frost_risk",
  ]) {
    const n = annual.filter((a) => finite(a[key])).length;
    if (n < evaluationYears.length)
      notes.push(
        `${key}: ${n} of ${evaluationYears.length} requested years evaluated; incomplete years are excluded, not zero.`,
      );
  }
  const calendar = rotationCalendar(sequence);
  for (let i = 0; i < sequence.length; i++) {
    const next = sequence[(i + 1) % sequence.length],
      harvest = seasonDates(sequence[i], 2001 + i).harvest;
    const nextPlant = seasonDates(next, 2001 + i + 1).plant;
    if (nextPlant <= harvest)
      notes.push(
        `${sequence[i].id} → ${next.id}: calendar overlap; planting precedes the previous harvest. Confirm or adjust planting dates before using this sequence.`,
      );
  }
  return {
    rotation_id: rotation.id,
    metrics: {
      shortfall_years: recur("shortfall_mm"),
      median_shortfall_mm: median(annual.map((a) => a.shortfall_mm)),
      median_irrigation_need_mm: median(
        annual.map((a) => a.irrigation_need_mm),
      ),
      peak_capacity_short_years: recur("capacity_shortfall_days"),
      sensitive_heat_years: recur("sensitive_hot_days"),
      frost_risk_years: recur("frost_risk"),
      low_cover_months_per_year: lowCoverMonths(sequence),
      demand_by_month: months.map((_, m) => {
        const values = annual.map((a) => a.demand_by_month[m]);
        return mean(clean(values));
      }),
    },
    calendar,
    seasons,
    annual,
    notes,
  };
}
