// AI disclosure: written with an AI coding assistant (Claude Code); the team is responsible for reviewing it (Space Apps AI rules).
// Kimchi decision support: top-3 actions and rotation comparison cards.
//
// Pure functions, no dependencies, browser + Node 18+. Owner: P4.
//
//   recommend({ analysis, farm, field_id, field, crops, actions, rotationsFit, focus, today })
//     → { top3: [card], all: [card], rotations: [rotationCard], generated_at, context }
//
// Rules this module keeps (PLAN.md §9):
//   - A missing value (null/undefined) never triggers an action and is never read as 0.
//   - The score is shown in parts: severity × priority × evidence × timing.
//   - Rotations get fit indicators and evidence, never a "best" or "winner" label, and are
//     listed current-first then in a fixed order, not sorted by any metric.
//   - Nothing here predicts yield, profit or a water saving.

export const FACTORS = ['water', 'temperature', 'soil_moisture', 'crop_condition'];
export const FACTOR_NAMES = {
  water: 'Water balance',
  temperature: 'Temperature',
  soil_moisture: 'Soil moisture',
  crop_condition: 'Crop condition',
};
export const EVIDENCE_WEIGHT = { A: 1.0, B: 0.7, C: 0.4 };
export const EXPERT_LINE = 'Review with your agronomist or K-State Research and Extension before acting.';
const DEFAULT_PRIORITIES = { water: 1 / 3, soil: 1 / 3, income: 1 / 3 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SOURCE_SHORT = {
  NASA_POWER_DAILY: 'NASA POWER',
  MODIS_MOD13Q1_ORNL: 'MODIS NDVI',
  USDA_SSURGO_SDA: 'USDA SSURGO',
  USDA_CDL: 'USDA CDL',
  FAO56: 'FAO-56',
};

/** Fallback rotation candidates (ids match agronomy.json) if actions.json has none. */
export const CANDIDATE_ROTATIONS = [
  { id: 'corn_corn', name: 'Continuous corn', sequence: ['corn'] },
  { id: 'corn_sorghum', name: 'Corn–grain sorghum', sequence: ['corn', 'sorghum'] },
  { id: 'corn_wheat', name: 'Corn–winter wheat', sequence: ['corn', 'winter_wheat'] },
];

// ───────────────────────────── small helpers ─────────────────────────────

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isMissing = (v) => v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v));
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const round = (v, d = 3) => (isNum(v) ? Math.round(v * 10 ** d) / 10 ** d : v);

/**
 * Read a dotted path ("factors.water.status.severity", "rotation_fit.0.metrics") from an object.
 * Returns undefined when any step is missing. Never evaluates code.
 */
export function getPath(obj, path) {
  if (!path) return undefined;
  let cur = obj;
  for (const key of String(path).split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, key)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** Format a value for display: numbers to at most 1 decimal, arrays joined, objects via .text. */
export function fmt(v) {
  if (isMissing(v)) return 'unavailable';
  if (isNum(v)) {
    if (Number.isInteger(v)) return String(v);
    // mm and days (|v| ≥ 10) → whole numbers; 1–10 (mm/day, months) → 1 decimal; < 1 (NDVI, wetness, p) → 2
    const a = Math.abs(v);
    return String(a >= 10 ? Math.round(v) : a >= 1 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100);
  }
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return v.map(fmt).join(', ');
  if (typeof v === 'object') return v.text ?? v.label ?? JSON.stringify(v);
  return String(v);
}

/** Parse "14 of 35" / "14 of 35 years" / {count, n} into { count, n, share, text }, else null. */
export function parseXofN(v, noun = 'years') {
  if (isMissing(v)) return null;
  const make = (count, n, extra = {}) => ({
    count, n, share: n > 0 ? count / n : null, core: `${count} of ${n}`, text: `${count} of ${n} ${noun}`, ...extra,
  });
  if (typeof v === 'object') {
    if (isNum(v.count) && isNum(v.n)) return make(v.count, v.n, { definition: v.definition ?? null });
    if (typeof v.text === 'string') {
      const p = parseXofN(v.text, noun);
      return p ? { ...p, definition: v.definition ?? null } : null;
    }
    return null;
  }
  if (typeof v === 'string') {
    const m = v.match(/(\d+)\s*of\s*(\d+)/);
    if (m) return make(Number(m[1]), Number(m[2]));
  }
  return null;
}

function mmdd(v) {
  // Accept "04-21", "2026-04-21", or a Date → "MM-DD"
  if (isMissing(v)) return null;
  if (v instanceof Date) return `${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  const s = String(v);
  const m = s.match(/(\d{2})-(\d{2})$/);
  return m ? `${m[1]}-${m[2]}` : null;
}
function doyOf(md) {
  if (!md) return null;
  const [m, d] = md.split('-').map(Number);
  const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return cum[m - 1] + d;
}
const prettyMD = (md) => (md ? `${MONTHS[Number(md.slice(0, 2)) - 1]} ${Number(md.slice(3))}` : 'unavailable');

function monthsLabel(months) {
  // Contiguous runs, wrapping the year: [11, 12, 1, 2] → "Nov–Feb"
  if (!months || !months.length) return '';
  const set = new Set(months);
  if (set.size >= 12) return 'all year';
  const prev = (m) => ((m + 10) % 12) + 1;
  let start = 1;
  while (!(set.has(start) && !set.has(prev(start)))) start++;
  const runs = [];
  for (let i = 0; i < 12; ) {
    const m = ((start - 1 + i) % 12) + 1;
    if (!set.has(m)) { i++; continue; }
    let len = 0;
    while (len < 12 && set.has(((m - 1 + len) % 12) + 1)) len++;
    const end = ((m - 1 + len - 1) % 12) + 1;
    runs.push(len === 1 ? MONTHS[m - 1] : `${MONTHS[m - 1]}–${MONTHS[end - 1]}`);
    i += len;
  }
  return runs.join(', ');
}

// ───────────────────────────── trigger evaluator ─────────────────────────────

const OPS = {
  '>': (a, b) => isNum(a) && isNum(b) && a > b,
  '>=': (a, b) => isNum(a) && isNum(b) && a >= b,
  '<': (a, b) => isNum(a) && isNum(b) && a < b,
  '<=': (a, b) => isNum(a) && isNum(b) && a <= b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
  in: (a, b) => Array.isArray(b) && b.includes(a),
};

/**
 * Evaluate one condition { path, op, value } against ctx.
 * Returns { ok: true|false, missing: bool, text }. A missing value gives ok=false, missing=true.
 */
export function evalCondition(cond, ctx) {
  const op = OPS[cond.op];
  if (!op) throw new Error(`Unknown trigger op: ${cond.op}`);
  const actual = getPath(ctx, cond.path);
  if (isMissing(actual)) {
    return { ok: false, missing: true, text: `${cond.path} is unavailable (not evaluated)` };
  }
  const ok = op(actual, cond.value);
  const want = Array.isArray(cond.value) ? `one of ${cond.value.join('/')}` : `${cond.op} ${fmt(cond.value)}`;
  return { ok, missing: false, text: `${cond.path} is ${fmt(actual)} (${ok ? 'meets' : 'needs'} ${want})` };
}

/**
 * Evaluate a trigger { all: [...] } / { any: [...] } (nestable) or a bare condition.
 * Returns { fired, missing: [paths], unmet: [text], met: [text] }.
 */
export function evalTrigger(trigger, ctx) {
  const res = { fired: false, missing: [], unmet: [], met: [] };
  if (!trigger) return res;
  if (trigger.path) {
    const r = evalCondition(trigger, ctx);
    res.fired = r.ok;
    (r.ok ? res.met : res.unmet).push(r.text);
    if (r.missing) res.missing.push(trigger.path);
    return res;
  }
  const parts = (trigger.all ?? trigger.any ?? []).map((t) => evalTrigger(t, ctx));
  for (const p of parts) {
    res.missing.push(...p.missing);
    res.unmet.push(...p.unmet);
    res.met.push(...p.met);
  }
  if (trigger.all) res.fired = parts.length > 0 && parts.every((p) => p.fired);
  else if (trigger.any) res.fired = parts.some((p) => p.fired);
  return res;
}

// ───────────────────────────── scoring ─────────────────────────────

/** 1.0 if month is in months, 0.6 if one of the next 3 months is, else 0.3. */
export function timingFactor(months, month) {
  if (!months || !months.length) return 0.6;
  if (months.includes(month)) return 1.0;
  for (let k = 1; k <= 3; k++) if (months.includes(((month - 1 + k) % 12) + 1)) return 0.6;
  return 0.3;
}

/** max(0.2, Σ priorities[tag]) so no action is ever zeroed out by the farmer's sliders. */
export function priorityFactor(tags, priorities) {
  const p = priorities ?? DEFAULT_PRIORITIES;
  const sum = (tags ?? []).reduce((s, t) => s + (isNum(p[t]) ? p[t] : 0), 0);
  return Math.max(0.2, sum);
}

/** Score = severity × priority × evidence × timing, with every part kept. */
export function scoreAction(action, ctx, priorities, month) {
  const sevRaw = action.severity_path ? getPath(ctx, action.severity_path) : undefined;
  const severity = isNum(sevRaw) ? clamp01(sevRaw) : 0.5;
  const priority = priorityFactor(action.priority_tags, priorities);
  const evidence = EVIDENCE_WEIGHT[action.evidence_level] ?? EVIDENCE_WEIGHT.C;
  const timing = timingFactor(action.months, month);
  return {
    score: round(severity * priority * evidence * timing),
    score_parts: {
      severity: round(severity),
      severity_source: isNum(sevRaw) ? action.severity_path : 'default 0.5 (no severity value)',
      priority: round(priority),
      evidence,
      evidence_level: action.evidence_level,
      timing,
    },
  };
}

// ───────────────────────────── rotations ─────────────────────────────

/** Normalise crop names from CDL, agronomy.json and farm records to crops.json ids. */
export function normCrop(c) {
  if (!c) return null;
  const s = String(c).toLowerCase().replace(/[\s-]+/g, '_');
  if (s.includes('sorghum')) return 'sorghum';
  if (s.includes('wheat')) return 'winter_wheat';
  if (s.includes('corn') || s.includes('maize')) return 'corn';
  if (s.includes('fallow') || s === 'none') return 'fallow';
  return s;
}

function sameCycle(seqA, seqB) {
  const a = [...new Set(seqA)].sort().join('|');
  const b = [...new Set(seqB)].sort().join('|');
  return a === b;
}

function isStrictCycle(history, sequence) {
  // Does history follow `sequence` repeated, from some offset?
  if (!history.length) return false;
  for (let off = 0; off < sequence.length; off++) {
    if (history.every((c, i) => c === sequence[(i + off) % sequence.length])) return true;
  }
  return false;
}

/**
 * Work out the field's current rotation.
 * Preference: farmer's records → field crop_history (satellite-inferred) → unknown.
 * Returns { id, name, sequence, history, basis, confirmed, matched_candidate, note }.
 */
export function inferCurrentRotation({ farm, field_id, field, candidates = CANDIDATE_ROTATIONS }) {
  const farmField = farm?.fields?.find((f) => f.field_id === field_id) ?? null;
  const recs = (farmField?.records ?? [])
    .filter((r) => r.crop && (r.period === 'season' || r.period === undefined || r.period === null))
    .sort((a, b) => a.year - b.year);
  let history = [];
  let basis = 'unknown';
  if (recs.length) {
    history = recs.map((r) => ({ year: r.year, crop: normCrop(r.crop) }));
    basis = farm?.synthetic ? 'farm_records_synthetic' : 'farm_records';
  } else {
    const ch = field?.properties?.crop_history ?? field?.crop_history ?? farmField?.crop_history ?? [];
    if (ch.length) {
      history = [...ch].sort((a, b) => a.year - b.year).map((r) => ({ year: r.year, crop: normCrop(r.crop) }));
      basis = 'satellite_inferred';
    }
  }
  const crops = history.map((h) => h.crop);
  const historyText = history.length ? history.map((h) => `${h.year} ${h.crop.replace('_', ' ')}`).join(' → ') : null;
  if (!history.length) {
    return {
      id: 'current_unknown', name: 'Unknown: please confirm your rotation', sequence: [], history: [],
      basis, confirmed: false, matched_candidate: null,
      note: 'No crop records or crop history for this field. Add your crops in My farm records.',
    };
  }
  const confirmed = basis.startsWith('farm_records');
  const match = candidates.find((c) => sameCycle(crops, c.sequence));
  if (match) {
    const strict = isStrictCycle(crops, match.sequence);
    return {
      id: match.id, name: match.name, sequence: match.sequence, history, basis, confirmed, matched_candidate: match.id,
      note: [
        `History: ${historyText}.`,
        strict ? null : `Your history uses the same crops but not a strict ${match.name.toLowerCase()} alternation.`,
        confirmed ? null : 'Inferred from USDA CDL satellite crop maps: please confirm.',
      ].filter(Boolean).join(' '),
    };
  }
  const seq = [...new Set(crops)];
  return {
    id: 'current_custom', name: `Your recent sequence (${seq.map((c) => c.replace('_', ' ')).join(', ')})`,
    sequence: crops.slice(-Math.min(crops.length, 4)), history, basis, confirmed, matched_candidate: null,
    note: [`History: ${historyText}.`, confirmed ? null : 'Inferred from USDA CDL satellite crop maps: please confirm.'].filter(Boolean).join(' '),
  };
}

/**
 * The rotations P3 should pass to P2's rotationFit: the current one (if it is not a candidate)
 * plus every candidate. Each is { id, name, sequence }.
 */
export function rotationsToEvaluate({ farm, field_id, field, actions }) {
  const candidates = candidateList(actions);
  const current = inferCurrentRotation({ farm, field_id, field, candidates });
  const list = candidates.map(({ id, name, sequence }) => ({ id, name, sequence }));
  if (current.id === 'current_custom') list.unshift({ id: current.id, name: current.name, sequence: current.sequence });
  return list;
}

function candidateList(actions) {
  const rc = actions?.rotation_candidates;
  return rc && rc.length ? rc : CANDIDATE_ROTATIONS;
}

function fitFor(rotationsFit, id) {
  return (rotationsFit ?? []).find((r) => r && (r.rotation_id === id || r.id === id)) ?? null;
}

const METRIC_LABELS = {
  shortfall_years: ['Seasons short of water under your allocation', ''],
  median_shortfall_mm: ['Median shortfall in those seasons', 'mm'],
  median_irrigation_need_mm: ['Median estimated irrigation need', 'mm'],
  peak_capacity_short_years: ['Seasons when peak demand exceeded the well', ''],
  sensitive_heat_above_normal_years: ['Seasons with above-normal heat in a sensitive window', ''],
  sensitive_heat_years: ['Seasons with at least one ≥ 35 °C day in a sensitive window', ''],
  frost_risk_years: ['Seasons with frost-free period shorter than the crop needs', ''],
  low_cover_months_per_year: ['Months a year with low green cover', 'months'],
};

function metricLines(metrics) {
  if (!metrics) return ['Fit indicators not computed yet for this rotation.'];
  return Object.entries(METRIC_LABELS)
    .filter(([k]) => k in metrics)
    .map(([k, [label, unit]]) => {
      const x = parseXofN(metrics[k]);
      const val = x ? x.core : isMissing(metrics[k]) ? 'not computed for this rotation' : fmt(metrics[k]);
      return `${label}: ${val}${unit && !isMissing(metrics[k]) ? ' ' + unit : ''}`;
    });
}

function compareLines(alt, cur) {
  if (!alt || !cur) return [];
  const out = [];
  for (const k of ['shortfall_years', 'peak_capacity_short_years', 'sensitive_heat_above_normal_years', 'sensitive_heat_years', 'frost_risk_years']) {
    const a = parseXofN(alt[k]);
    const c = parseXofN(cur[k]);
    if (a && c && a.count !== c.count) out.push(`${METRIC_LABELS[k][0]}: ${a.core} vs ${c.core} for your current rotation`);
  }
  for (const k of ['median_irrigation_need_mm', 'low_cover_months_per_year']) {
    if (isNum(alt[k]) && isNum(cur[k]) && alt[k] !== cur[k]) {
      out.push(`${METRIC_LABELS[k][0]}: ${fmt(alt[k])} vs ${fmt(cur[k])} ${METRIC_LABELS[k][1]} for your current rotation`);
    }
  }
  return out;
}

function whySuggested(cand, altMetrics, ctx) {
  const parts = [cand.why_suggested_base ?? ''];
  const d = ctx.derived;
  const curShort = d.current_rotation_shortfall;
  const altShort = parseXofN(altMetrics?.shortfall_years);
  const seq = cand.sequence ?? [];
  const shortsMore = altShort && curShort && altShort.count > curShort.count;
  if (seq.includes('winter_wheat') && curShort && curShort.share >= 1 / 3 && !shortsMore) {
    parts.push(`Shifts part of the water demand to spring; relevant to your recurring summer shortfall (${curShort.core} seasons).`);
  }
  if (altShort && curShort && altShort.count < curShort.count) {
    parts.push(`Fewer seasons short of water in the same weather record (${altShort.core} vs ${curShort.core}).`);
  } else if (shortsMore) {
    parts.push(`Note: in the same weather record it runs short of water more often (${altShort.core} vs ${curShort.core} seasons), so it is not a water fix on its own${seq.includes('winter_wheat') ? '; wheat moves part of the demand to spring rather than removing it' : ''}.`);
  }
  if (seq.includes('sorghum') && isNum(d.stage_heat_share) && d.stage_heat_share >= 1 / 3) {
    parts.push('Sorghum flowers later than corn, so its sensitive period falls at a different time than corn pollination; this does not mean less heat exposure.');
  }
  if (seq.includes('winter_wheat') && isNum(d.low_cover_months) && d.low_cover_months >= 4) {
    parts.push(`Adds green cover from autumn to early summer on a field with about ${fmt(d.low_cover_months)} low-green-cover months a year.`);
  }
  if (d.capacity_ok === false && seq.includes('winter_wheat')) {
    parts.push('Your well may not meet corn peak demand: in wheat years the field\'s peak moves to May–June, but corn years keep the corn peak (whole-field alternation does not split demand within a year).');
  }
  return parts.filter(Boolean).join(' ');
}

const agText = (items) => (items ?? []).map((b) => ({ text: b.topic ? `${b.topic}: ${b.finding}` : b.finding, source_ids: b.source_ids ?? [] }));

function rotationCard({ role, spec, cand, fit, ctx, current }) {
  const ag = cand?.agronomy ?? null;
  const metrics = fit?.metrics ?? null;
  const gaps = [
    ...(ag?.unknowns ?? []).map((t) => ({ text: t, source_ids: [] })),
    ...agText(ag?.gaps_and_calendar_conflicts),
    ...(fit?.notes ?? []).map((t) => ({ text: t, source_ids: [] })),
  ];
  if (spec.basis && !spec.confirmed && role === 'current') {
    gaps.unshift({ text: spec.note || 'Current rotation is not confirmed by the farmer.', source_ids: ['USDA_CDL'] });
  }
  const risks = [...agText(ag?.risks)];
  if (ag?.herbicide_carryover) risks.push({ text: `herbicide carryover: ${ag.herbicide_carryover.finding}`, source_ids: ag.herbicide_carryover.source_ids ?? [] });
  return {
    id: spec.id,
    name: spec.name,
    role,
    sequence: spec.sequence,
    basis: role === 'current' ? spec.basis : 'candidate',
    confirmed: role === 'current' ? spec.confirmed : null,
    note: role === 'current' ? spec.note : null,
    evidence_status: ag?.evidence_status ?? null,
    status_meaning: ag?.status_meaning ?? (role === 'current' && !ag ? 'Your own sequence: no regional trial matches it exactly.' : null),
    why_suggested: role === 'current'
      ? 'This is the rotation on this field now; every alternative is compared against it over the same weather years.'
      : whySuggested(cand, metrics, ctx),
    metrics,
    metrics_text: metricLines(metrics),
    comparison_to_current: role === 'current' ? [] : compareLines(metrics, current),
    benefits: agText(ag?.benefits),
    risks,
    gaps,
    prerequisites: ag?.market_equipment_prerequisites ?? [],
    residue: agText(ag?.residue_implications),
    treatment_basis: ag?.treatment_basis ?? null,
    short: cand?.short ?? (role === 'current' ? CUSTOM_SHORT[spec.id] ?? null : null),
    expert_check: EXPERT_LINE,
    source_ids: [...new Set([...(ag?.source_ids ?? []), 'NASA_POWER_DAILY', 'FAO56'])],
  };
}

const CUSTOM_SHORT = {
  current_custom: {
    benefit: 'Keeps the crops you already grow; no regional trial tested this exact sequence.',
    risk: 'Not assessed by the trials; ask your agronomist to review it.',
    unknown: 'Please confirm your past crops in My farm records.',
    source_ids: ['USDA_CDL'],
  },
  current_unknown: {
    benefit: 'Not known yet.',
    risk: 'Not known yet.',
    unknown: 'Your current rotation: add your crops in My farm records.',
    source_ids: [],
  },
};

/**
 * Rotation comparison table for the Simple view (PLAN.md §11): one row per metric,
 * one column per rotation (current first, then alternatives, in the cards' fixed order).
 *   rotationTable({ rotations }) → { columns: [{ id, name, role }], rows: [{ key, label, cells: [text] }], notes }
 * Missing values read "not computed", never 0. There is no winner row or highlight.
 */
export function rotationTable({ rotations }) {
  const cards = rotations ?? [];
  const columns = cards.map((c) => ({ id: c.id, name: c.role === 'current' ? `${c.name} (now)` : c.name, role: c.role }));
  const xofn = (v, noun) => { const p = parseXofN(v); return p ? `${p.core} ${noun}` : 'not computed'; };
  const aboveNormal = cards.some((c) => parseXofN(c.metrics?.sensitive_heat_above_normal_years));
  const heatKey = aboveNormal ? 'sensitive_heat_above_normal_years' : 'sensitive_heat_years';
  const rows = [
    { key: 'short_on_water', label: 'Short on water (past seasons)', cells: cards.map((c) => xofn(c.metrics?.shortfall_years, 'seasons')) },
    {
      key: 'heat_at_pollination',
      label: aboveNormal ? 'Above-normal heat at pollination / flowering' : '≥ 1 hot day (≥ 35 °C / 95 °F) at pollination / flowering',
      cells: cards.map((c) => xofn(c.metrics?.[heatKey], 'seasons')),
    },
    {
      key: 'low_green_cover_months',
      label: 'Months a year with no crop growing (crop calendar; low green cover)',
      cells: cards.map((c) => (isNum(c.metrics?.low_cover_months_per_year) ? `about ${fmt(c.metrics.low_cover_months_per_year)}` : 'not computed')),
    },
    { key: 'main_benefit', label: 'Main benefit', cells: cards.map((c) => c.short?.benefit ?? c.benefits?.[0]?.text ?? 'not assessed') },
    { key: 'main_risk', label: 'Main risk', cells: cards.map((c) => c.short?.risk ?? c.risks?.[0]?.text ?? 'not assessed') },
    { key: 'unknown', label: "What we don't know", cells: cards.map((c) => c.short?.unknown ?? c.gaps?.[0]?.text ?? 'not assessed') },
  ];
  return {
    columns,
    rows,
    heat_definition: aboveNormal ? 'above_normal' : 'any_hot_day',
    notes: [
      'Same weather years (NASA POWER) for every rotation, under your allocation and well. Estimates, not meter readings.',
      'Rotations are not ranked: weigh these with your agronomist or K-State Research and Extension.',
    ],
    source_ids: [...new Set(cards.flatMap((c) => c.short?.source_ids ?? []).concat(['NASA_POWER_DAILY', 'FAO56']))],
  };
}

/**
 * Build rotation cards: the current rotation + 2 alternatives from the candidates.
 * If the current rotation is unknown or does not match a candidate, all 3 candidates are shown.
 * Order is fixed (current, then candidate order); there is no winner or rank field.
 */
export function buildRotationCards({ ctx, actions, rotationsFit }) {
  const candidates = candidateList(actions);
  const cur = ctx.derived.current_rotation_spec;
  const curCand = candidates.find((c) => c.id === cur.matched_candidate) ?? null;
  const curFit = fitFor(rotationsFit, cur.id);
  const cards = [rotationCard({ role: 'current', spec: cur, cand: curCand, fit: curFit, ctx, current: null })];
  const alts = candidates.filter((c) => c.id !== cur.matched_candidate);
  const chosen = curCand ? alts.slice(0, 2) : alts;
  for (const c of chosen) {
    cards.push(rotationCard({ role: 'alternative', spec: c, cand: c, fit: fitFor(rotationsFit, c.id), ctx, current: curFit?.metrics ?? null }));
  }
  return cards;
}

// ───────────────────────────── derived context ─────────────────────────────

const toInches = (mm) => { const v = mm / 25.4; return v >= 10 ? Math.round(v) : Math.round(v * 10) / 10; };
/** For a low-side status (dry soil, low NDVI) below the median: "lower than N% of years". */
const drierThan = (st) => (isNum(st?.percentile) && st.percentile < 50 ? Math.round(100 - st.percentile) : null);

/**
 * Build the evaluation context: the analysis output plus a `derived` block of numbers that
 * triggers need but that combine analysis, farm records, crops and rotation fit.
 * Reads several plausible shapes defensively; anything it cannot find stays null.
 */
export function deriveContext({ analysis, farm, field_id, field, crops, actions, rotationsFit, today = new Date() }) {
  const a = analysis ?? {};
  const month = today.getMonth() + 1;
  const year = today.getFullYear();
  const farmField = farm?.fields?.find((f) => f.field_id === field_id) ?? null;
  const records = [...(farmField?.records ?? [])].sort((x, y) => x.year - y.year);
  const cropList = crops?.crops ?? crops ?? [];
  const candidates = candidateList(actions);

  const current = inferCurrentRotation({ farm, field_id, field, candidates });
  const thisRec = records.find((r) => r.year === year && r.crop) ?? null;
  const lastCrop = thisRec?.crop ?? current.history.at(-1)?.crop ?? 'corn';
  const cropId = normCrop(lastCrop);
  const crop = cropList.find((c) => c.id === cropId) ?? cropList.find((c) => c.id === 'corn') ?? null;

  const curFit = fitFor(rotationsFit, current.id);
  const curMetrics = curFit?.metrics ?? null;
  const shortfall = parseXofN(curMetrics?.shortfall_years);
  const allocation = farm?.constraints?.annual_allocation_mm;
  const allocation_mm = isNum(allocation) ? allocation : null;
  const need = curMetrics?.median_irrigation_need_mm;

  let allocation_limited = null;
  let allocation_pressure = null;
  if (allocation_mm !== null && isNum(need)) {
    allocation_limited = allocation_mm < need;
    allocation_pressure = need > 0 ? clamp01((need - allocation_mm) / need * 2) : 0;
  } else if (allocation_mm !== null && shortfall) {
    allocation_limited = shortfall.count > 0;
    allocation_pressure = shortfall.share;
  }

  // Sensitive window coming up: GDD-based if we have it, else typical months within the next 2.
  let sensitive_window_soon = null;
  const sw = crop?.sensitive_window ?? null;
  const gddNow = getPath(a, 'factors.temperature.gdd.to_date');
  if (sw && isNum(gddNow) && isNum(sw.gdd_from) && isNum(sw.gdd_to)) {
    sensitive_window_soon = gddNow >= sw.gdd_from - 300 && gddNow <= sw.gdd_to;
  } else if (sw?.months_typical?.length) {
    const next = [month, (month % 12) + 1, ((month + 1) % 12) + 1];
    sensitive_window_soon = sw.months_typical.some((m) => next.includes(m));
  }

  const cap = a.interactions?.capacity ?? a.factors?.water?.capacity ?? null;
  const capacity_ok = typeof cap?.ok === 'boolean' ? cap.ok : null;
  const peak = cap?.peak_mm_day ?? cap?.peak_demand_mm_day ?? null;
  const well = cap?.well_mm_day ?? cap?.capacity_mm_day ?? null;
  const short = isNum(cap?.shortfall_mm_day) ? cap.shortfall_mm_day : isNum(peak) && isNum(well) ? Math.max(0, peak - well) : null;
  // 25% of peak demand unmet → severity 1.
  const capacity_severity = isNum(short) && isNum(peak) && peak > 0 ? clamp01((4 * short) / peak) : null;

  // Capacity: this season's check if the analysis has it, else how often the current rotation's
  // simulated peak exceeded the well in the weather record.
  const capFit = parseXofN(curMetrics?.peak_capacity_short_years, 'seasons');

  // Stage heat. Prefer the above-normal definition (P2: interactions.stage_heat.recurrence, or
  // rotationFit sensitive_heat_above_normal_years). Fall back to "at least one hot day in the window",
  // and say so in the text: the two must never be confused (round-2 issue 3).
  const sh = a.interactions?.stage_heat ?? a.factors?.temperature?.stage_heat ?? null;
  const thr = crop?.heat_threshold_c ?? 35;
  const swName = crop?.sensitive_window?.name ?? 'the sensitive window';
  let shRec = parseXofN(sh?.recurrence) ?? parseXofN(curMetrics?.sensitive_heat_above_normal_years);
  let stage_heat_definition = shRec ? 'above_normal' : null;
  if (!shRec) {
    shRec = parseXofN(curMetrics?.sensitive_heat_years);
    if (shRec) stage_heat_definition = 'any_hot_day';
  }
  const stage_heat_sentence = !shRec ? null : stage_heat_definition === 'above_normal'
    ? `Above-normal heat during ${swName} in ${shRec.core} years`
    : `At least one ≥ ${thr} °C day during ${swName} in ${shRec.core} years`;

  const frost = a.factors?.temperature?.frost ?? {};
  const normalLast = mmdd(frost.normal_last_spring);
  const plannedRec = records.find((r) => r.year >= year && r.planting_date);
  const plannedMD = mmdd(plannedRec?.planting_date) ?? crop?.season?.plant ?? null;
  const planting_near_last_frost = normalLast && plannedMD ? doyOf(plannedMD) - doyOf(normalLast) <= 14 : null;

  const seq = current.sequence ?? [];
  const known = current.id !== 'current_unknown';
  const hasWheatAfterCorn = known ? seq.some((c, i) => c === 'corn' && seq[(i + 1) % seq.length] === 'winter_wheat') : null;
  const hasWheat = known ? seq.includes('winter_wheat') : null;

  const gcc = a.factors?.crop_condition?.green_cover_calendar ?? null;
  let low_cover_months = null;
  for (const k of ['mean_low_months_per_year', 'low_months_per_year', 'median_low_months', 'months_low_per_year']) {
    if (isNum(gcc?.[k])) { low_cover_months = gcc[k]; break; }
  }
  const grid = Array.isArray(gcc?.low_cover) ? gcc.low_cover : Array.isArray(gcc?.low) ? gcc.low : null;
  if (low_cover_months === null && grid?.length) {
    // Mean low-cover months per year over years with at least 10 observed months (null = no composite).
    const per = grid
      .filter((row) => Array.isArray(row) && row.filter((x) => x !== null && x !== undefined).length >= 10)
      .map((row) => {
        const seen = row.filter((x) => x !== null && x !== undefined);
        return (seen.filter((x) => x === true || x === 1).length / seen.length) * 12;
      });
    if (per.length) low_cover_months = per.reduce((s, v) => s + v, 0) / per.length;
  }
  if (low_cover_months === null && isNum(curMetrics?.low_cover_months_per_year)) low_cover_months = curMetrics.low_cover_months_per_year;

  const wheat = cropList.find((c) => c.id === 'winter_wheat');
  const corn = cropList.find((c) => c.id === 'corn');

  const derived = {
    month, year,
    crop: crop ? {
      id: crop.id, name: crop.name, p_depletion: crop.p_depletion, heat_threshold_c: crop.heat_threshold_c,
      sensitive_window_name: crop.sensitive_window?.name ?? 'sensitive',
    } : null,
    allocation_mm, allocation_limited, allocation_pressure: round(allocation_pressure),
    sensitive_window_soon,
    capacity_ok, capacity_peak_mm_day: peak, capacity_well_mm_day: well,
    capacity_severity: round(capacity_severity ?? (capacity_ok === null ? capFit?.share ?? null : null)),
    capacity_text: capacity_ok === null ? null : cap?.text ?? null,
    capacity_short_share: capFit?.share ?? null,
    capacity_short_text: capFit?.core ?? null,
    stage_heat_share: shRec?.share ?? null, stage_heat_text: shRec?.core ?? null,
    stage_heat_definition, stage_heat_sentence,
    // "Any hot day" happens almost every year, so it counts half as much as "above normal".
    stage_heat_severity: shRec ? round(stage_heat_definition === 'above_normal' ? shRec.share : shRec.share * 0.5) : null,
    normal_last_spring: normalLast ? prettyMD(normalLast) : null,
    planned_planting: plannedMD ? prettyMD(plannedMD) : null,
    planting_near_last_frost,
    current_rotation_spec: current,
    current_rotation_name: current.name,
    current_rotation_name_inline: current.name ? current.name.charAt(0).toLowerCase() + current.name.slice(1) : null,
    current_rotation: curMetrics,
    current_rotation_shortfall: shortfall,
    current_rotation_shortfall_share: shortfall?.share ?? null,
    current_rotation_shortfall_text: shortfall?.core ?? null,
    rotation_has_wheat_after_corn: hasWheatAfterCorn,
    rotation_has_wheat: hasWheat,
    low_cover_months: isNum(low_cover_months) ? round(low_cover_months, 1) : null,
    low_cover_severity: isNum(low_cover_months) ? round(clamp01((low_cover_months - 3) / 6)) : null,
    wheat_target: wheat?.season?.plant ? prettyMD(wheat.season.plant) : null,
    corn_harvest_window: corn?.season?.harvest_window ? corn.season.harvest_window.map(prettyMD).join(' – ') : null,
    live_through: a.data_quality?.live_through ?? null,
    // Plain-language helpers for card.short (inches next to mm; "drier than N% of years").
    allocation_in: isNum(allocation_mm) ? toInches(allocation_mm) : null,
    need_mm: isNum(need) ? Math.round(need) : null,
    need_in: isNum(need) ? toInches(need) : null,
    stage_heat_above_core: stage_heat_definition === 'above_normal' ? shRec.core : null,
    stage_heat_any_core: stage_heat_definition === 'any_hot_day' ? shRec.core : null,
    soil_drier_than_pct: drierThan(a.factors?.soil_moisture?.status),
    ndvi_lower_than_pct: drierThan(a.factors?.crop_condition?.status),
  };
  return { ...a, derived, _farmField: farmField, _records: records };
}

// ───────────────────────────── cards ─────────────────────────────

function sourcesText(ids) {
  const names = (ids ?? []).map((id) => SOURCE_SHORT[id]).filter(Boolean);
  return names.length ? [...new Set(names)].join(', ') : null;
}

const unitText = (u) => (!u ? '' : u === '0–1' || u === '0-1' ? ' on a 0–1 wetness scale' : ` ${u}`);

function statusEvidence(spec, ctx) {
  const s = getPath(ctx, spec.status);
  if (!s || isMissing(s.value)) return null;
  if (spec.only_if_adverse && s.direction !== 'adverse') return null;
  const bits = [];
  if (isNum(s.percentile)) bits.push(`p${Math.round(s.percentile)}`);
  if (!isMissing(s.normal_median)) bits.push(`normal ${fmt(s.normal_median)}${s.unit === '0–1' || s.unit === '0-1' ? '' : unitText(s.unit)}`);
  const src = sourcesText(s.source_ids);
  if (src) bits.push(src);
  if (s.period) bits.push(s.period);
  if (s.as_of) bits.push(`as of ${s.as_of}`);
  else if (spec.kind === 'live' && ctx.derived.live_through) bits.push(`live through ${ctx.derived.live_through}`);
  const head = s.label ?? 'Value';
  return { text: `${head}: ${fmt(s.value)}${unitText(s.unit)} (${bits.join(', ')})`, value: s.value, kind: spec.kind ?? 'live', source_ids: s.source_ids ?? [] };
}

function recurrenceEvidence(spec, ctx) {
  const r = getPath(ctx, spec.recurrence);
  const p = parseXofN(r) ?? parseXofN(r?.text);
  if (!p) return null;
  const what = r?.label ?? r?.description ?? null;
  return { text: `${what ? what + ': ' : 'Happened in '}${p.text}`, value: p.text, kind: 'historical', source_ids: r?.source_ids ?? ['NASA_POWER_DAILY'] };
}

function farmEvidence(spec, ctx) {
  if (spec.field_level) {
    const v = ctx._farmField?.[spec.farm];
    if (isMissing(v)) return null;
    return { text: `${spec.label}: ${fmt(v)}${spec.unit ? ' ' + spec.unit : ''}${ctx.derived && farmSynthetic(ctx) ? ' (synthetic demo value)' : ''}`, value: v, kind: 'farm_record', source_ids: [] };
  }
  const rec = [...(ctx._records ?? [])].reverse().find((r) => !isMissing(r[spec.farm]));
  if (!rec) return null;
  const v = rec[spec.farm];
  return {
    text: `${spec.label}, ${rec.year}${rec.crop ? ' ' + rec.crop.replace('_', ' ') : ''}: ${fmt(v)}${spec.unit ? ' ' + spec.unit : ''}${farmSynthetic(ctx) ? ' (synthetic demo value)' : ''}`,
    value: v, kind: 'farm_record', source_ids: [],
  };
}
const farmSynthetic = (ctx) => ctx._synthetic === true;

function pathEvidence(spec, ctx) {
  const v = getPath(ctx, spec.path);
  if (isMissing(v)) return null;
  let text = (spec.text ?? '{value}').replace('{value}', fmt(v));
  const src = sourcesText(spec.source_ids);
  const extra = [src, spec.kind === 'live' && ctx.derived.live_through ? `live through ${ctx.derived.live_through}` : null].filter(Boolean);
  if (extra.length) text += ` (${extra.join(', ')})`;
  return { text, value: v, kind: spec.kind ?? 'live', source_ids: spec.source_ids ?? [] };
}

/** Resolve an action's evidence specs into concrete, value-bearing evidence items. */
export function buildEvidence(action, ctx) {
  const out = [];
  for (const spec of action.evidence_specs ?? []) {
    let e = null;
    if (spec.status) e = statusEvidence(spec, ctx);
    else if (spec.recurrence) e = recurrenceEvidence(spec, ctx);
    else if (spec.farm) e = farmEvidence(spec, ctx);
    else if (spec.path) e = pathEvidence(spec, ctx);
    if (e) out.push(e);
  }
  return out;
}

/** Fill "{name}" placeholders from action.vars (name → path in ctx). Missing → "unavailable". */
export function fillTemplate(template, vars, ctx) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (_, name) => fmt(getPath(ctx, vars?.[name] ?? name)));
}

/** Use the first template whose placeholders all have values; else the last one, filled. */
export function pickTemplate(action, ctx, key = 'why_template', strict = false) {
  const raw = action[key];
  if (raw === undefined || raw === null) return null;
  const list = Array.isArray(raw) ? raw : [raw];
  for (const t of list) {
    const names = [...String(t ?? '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    if (names.every((n) => !isMissing(getPath(ctx, action.vars?.[n] ?? n)))) return fillTemplate(t, action.vars, ctx);
  }
  if (strict) return null;
  // No template fully resolves: fill the last one and drop every sentence that would say "unavailable".
  const kept = splitSentences(fillTemplate(list.at(-1), action.vars, ctx)).filter((x) => !/unavailable/i.test(x));
  return kept.length ? kept.join(' ') : null;
}

const splitSentences = (t) => String(t).match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g)?.map((x) => x.trim()).filter(Boolean) ?? [];
const wordCount = (t) => String(t).trim().split(/\s+/).filter(Boolean).length;

/** One plain sentence for the Simple view (PLAN.md §11): under 25 words, never "unavailable". */
export function shortText(action, ctx) {
  // Try each template on its own: it must resolve fully and stay under 25 words.
  const list = Array.isArray(action.short_template) ? action.short_template : action.short_template ? [action.short_template] : [];
  for (const one of list) {
    const t = pickTemplate({ ...action, short_template: one }, ctx, 'short_template', true);
    if (t && !/unavailable/i.test(t) && wordCount(t) < 25) return t;
  }
  return action.short_fallback ?? action.title;
}

function whenText(action, timing) {
  const span = monthsLabel(action.months);
  if (timing === 1) return `Now (${span})`;
  if (timing === 0.6) return `Coming up (${span})`;
  return action.category === 'planning' ? `Plan for ${span}` : `Later in the year (${span})`;
}

function buildCard(action, ctx, priorities, month, trig) {
  const { score, score_parts } = scoreAction(action, ctx, priorities, month);
  const evidence = buildEvidence(action, ctx);
  const why = [pickTemplate(action, ctx) ?? action.title, ...evidence.slice(0, 2).map((e) => e.text)];
  const expert = action.expert_check?.includes('K-State Research and Extension') ? action.expert_check : `${action.expert_check ?? ''} ${EXPERT_LINE}`.trim();
  return {
    id: action.id,
    title: action.title,
    short: shortText(action, ctx),
    factor: action.factor,
    factor_name: FACTOR_NAMES[action.factor] ?? action.factor,
    category: action.category,
    status: trig.fired ? 'triggered' : 'watch',
    reason: trig.fired ? trig.met : trig.unmet,
    missing_inputs: trig.missing,
    score,
    score_parts,
    why,
    evidence,
    benefits: action.benefits ?? [],
    risks: action.risks ?? [],
    gaps: action.gaps ?? [],
    expert_check: expert,
    when: whenText(action, score_parts.timing),
    source_ids: action.source_ids ?? [],
  };
}

/** Pick up to n cards with at most `maxPerFactor` per factor (Infinity disables the rule). */
export function pickDiverse(cards, n = 3, maxPerFactor = 2) {
  const picked = [];
  const count = {};
  for (const c of cards) {
    if (picked.length >= n) break;
    if ((count[c.factor] ?? 0) >= maxPerFactor) continue;
    picked.push(c);
    count[c.factor] = (count[c.factor] ?? 0) + 1;
  }
  return picked;
}

const byScore = (x, y) => y.score - x.score || x.id.localeCompare(y.id);

/**
 * Main entry point. See the module header for the output shape.
 * focus: null | 'water' | 'temperature' | 'soil_moisture' | 'crop_condition'.
 */
export function recommend({ analysis, farm, field_id, field = null, crops, actions, rotationsFit = null, focus = null, today = new Date() }) {
  const ctx = deriveContext({ analysis, farm, field_id, field, crops, actions, rotationsFit: rotationsFit ?? analysis?.rotation_fit, today });
  ctx._synthetic = farm?.synthetic === true;
  const month = ctx.derived.month;
  const priorities = farm?.priorities ?? DEFAULT_PRIORITIES;
  const list = actions?.actions ?? [];
  if (focus && !FACTORS.includes(focus)) throw new Error(`Unknown focus: ${focus}`);

  const cards = list.map((act) => buildCard(act, ctx, priorities, month, evalTrigger(act.trigger, ctx)));
  const pool = focus ? cards.filter((c) => c.factor === focus) : cards;
  const triggered = pool.filter((c) => c.status === 'triggered').sort(byScore);
  const watch = pool.filter((c) => c.status === 'watch').sort(byScore);
  const maxPer = focus ? Infinity : 2;

  let top3 = pickDiverse(triggered, 3, maxPer);
  if (top3.length < 3) {
    const usedIds = new Set(top3.map((c) => c.id));
    const counts = {};
    for (const c of top3) counts[c.factor] = (counts[c.factor] ?? 0) + 1;
    // Fill with "watch" items, keeping the diversity rule, then relaxing it if still short.
    for (const pass of [maxPer, Infinity]) {
      for (const c of watch) {
        if (top3.length >= 3) break;
        if (usedIds.has(c.id) || (counts[c.factor] ?? 0) >= pass) continue;
        top3.push(c);
        usedIds.add(c.id);
        counts[c.factor] = (counts[c.factor] ?? 0) + 1;
      }
    }
  }

  const rotations = buildRotationCards({ ctx, actions, rotationsFit: rotationsFit ?? analysis?.rotation_fit });
  const rotation_table = rotationTable({ rotations });
  const all = [...cards].sort((x, y) => (x.status === y.status ? byScore(x, y) : x.status === 'triggered' ? -1 : 1));
  return {
    top3,
    all,
    rotations,
    rotation_table,
    focus,
    generated_at: today.toISOString(),
    method: 'score = severity × priority × evidence × timing (rule-based, shown on every card; not a machine-learning model)',
    context: {
      field_id,
      current_rotation: ctx.derived.current_rotation_spec,
      live_through: ctx.derived.live_through,
      synthetic_farm: ctx._synthetic,
      derived: Object.fromEntries(Object.entries(ctx.derived).filter(([k]) => !['current_rotation_spec', 'current_rotation'].includes(k))),
    },
    expert_check: EXPERT_LINE,
  };
}
