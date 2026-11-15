// node --test dashboard/lib/recommend.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  getPath, evalCondition, evalTrigger, timingFactor, priorityFactor, scoreAction, pickDiverse,
  parseXofN, inferCurrentRotation, rotationsToEvaluate, recommend, fillTemplate, EXPERT_LINE,
} from './recommend.mjs';
import { buildReport, reportToMarkdown } from './report.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const crops = JSON.parse(readFileSync(here('../data/crops.json'), 'utf8'));
const actions = JSON.parse(readFileSync(here('../data/actions.json'), 'utf8'));

// A hand-made analysis in the shape of PLAN.md §7.3 / P2's analyzeField (fld01, mid-July 2026).
function status(value, unit, pct, severity, label, direction = 'adverse', src = ['NASA_POWER_DAILY']) {
  return { value, unit, normal_median: null, percentile: pct, direction, severity, label, source_ids: src };
}
function sampleAnalysis(over = {}) {
  const a = {
    fixture: true,
    factors: {
      water: {
        status: { ...status(-212, 'mm', 16, 0.36, 'Season deficit drier than 84% of seasons since 1991'), normal_median: -120 },
        recurrence: { count: 14, n: 35, text: '14 of 35 years', label: 'Seasons with a deficit worse than 150 mm' },
        bucket: { stress_days: 9, first_stress_date: '2026-07-03', note: 'simplified: no runoff, no capillary rise' },
        capacity: null,
        source_ids: ['NASA_POWER_DAILY', 'FAO56'],
      },
      temperature: {
        status: { ...status(9, 'days', 88, 0.52, 'Hot days ≥ 35 °C so far: more than 88% of years'), normal_median: 4 },
        gdd: { to_date: 760, normal_p50: 720, stage_now: 'approaching silking' },
        frost: { last_spring: '2026-04-18', first_fall: null, normal_last_spring: '04-21', normal_first_fall: '10-12' },
        recurrence: { count: 11, n: 45, text: '11 of 45 years', label: 'Summers with 9+ hot days' },
        source_ids: ['NASA_POWER_DAILY'],
      },
      soil_moisture: {
        status: status(0.31, '0–1', 12, 0.52, 'Root zone drier than 88% of mid-July dates'),
        recurrence: { count: 12, n: 45, text: '12 of 45 years', label: 'Julys this dry' },
        source_ids: ['NASA_POWER_DAILY'],
      },
      crop_condition: {
        status: status(0.62, 'NDVI', 20, 0.2, 'Greenness 9% below normal for early July', 'adverse', ['MODIS_MOD13Q1_ORNL']),
        green_cover_calendar: { threshold: 0.3, mean_low_months_per_year: 6.2 },
        source_ids: ['MODIS_MOD13Q1_ORNL'],
      },
    },
    interactions: {
      compound_calendar: { years: [2024, 2025, 2026], months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        counts: [[0, 0, 0, 0, 0, 1, 2, 2, 1, 0, 0, 0], [0, 0, 0, 0, 1, 1, 3, 2, 0, 0, 0, 0], [0, 0, 0, 0, 0, 1, 2, null, null, null, null, null]] },
      cause_check: { code: 'water', text: 'Low greenness with dry soil: likely water stress' },
      capacity: { peak_mm_day: 8.1, well_mm_day: 6.5, shortfall_mm_day: 1.6, ok: false, text: 'Peak 7-day demand 8.1 mm/day vs well 6.5 mm/day' },
      stage_heat: { hot_days: 4, normal_median: 1, recurrence: { count: 13, n: 35, text: '13 of 35 years' } },
    },
    data_quality: { live_through: '2026-07-12', missing_days_this_year: 3, notes: ['Last 3 days of POWER are missing (normal lag)'] },
  };
  return deepMerge(a, over);
}
function deepMerge(a, b) {
  if (b === null || typeof b !== 'object' || Array.isArray(b)) return b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a?.[k] ? deepMerge(a[k], v) : v;
  return out;
}
const rotationsFit = [
  { rotation_id: 'corn_corn', metrics: { shortfall_years: '14 of 35', median_shortfall_mm: 62, median_irrigation_need_mm: 340, peak_capacity_short_years: '18 of 35', sensitive_heat_years: '13 of 35', frost_risk_years: '1 of 35', low_cover_months_per_year: 6.5 }, notes: ['Whole-field sequence; phase splits not modelled'] },
  { rotation_id: 'corn_sorghum', metrics: { shortfall_years: '10 of 35', median_shortfall_mm: 48, median_irrigation_need_mm: 300, peak_capacity_short_years: '12 of 35', sensitive_heat_years: '11 of 35', frost_risk_years: '3 of 35', low_cover_months_per_year: 6.8 }, notes: [] },
  { rotation_id: 'corn_wheat', metrics: { shortfall_years: '6 of 35', median_shortfall_mm: 40, median_irrigation_need_mm: 260, peak_capacity_short_years: '9 of 35', sensitive_heat_years: '7 of 35', frost_risk_years: '1 of 35', low_cover_months_per_year: 3.9 }, notes: [] },
];
function farm(over = {}) {
  return {
    schema: 'kimchi.farm.1', farm_name: 'Demo farm (synthetic)', synthetic: true,
    priorities: { water: 0.5, soil: 0.3, income: 0.2 },
    constraints: { annual_allocation_mm: 280 },
    fields: [{ field_id: 'fld01', name: 'North pivot', area_ha: 50.2, well_capacity_gpm: 600,
      records: [2021, 2022, 2023, 2024, 2025].map((y) => ({ year: y, period: 'season', crop: 'corn', planting_date: `${y}-04-28`, irrigation_mm: 300 + y - 2021, yield: 200, yield_unit: 'bu/ac' })) }],
    ...over,
  };
}
const JULY = new Date('2026-07-15T12:00:00');
const NOV = new Date('2026-11-15T12:00:00');

// ───────── evaluator ─────────
test('getPath reads nested paths and returns undefined for missing steps', () => {
  assert.equal(getPath({ a: { b: [5, 6] } }, 'a.b.1'), 6);
  assert.equal(getPath({ a: null }, 'a.b'), undefined);
  assert.equal(getPath({}, 'constructor'), undefined);
});

test('evalCondition supports every operator', () => {
  const ctx = { x: 3, s: 'water' };
  for (const [op, v, want] of [['>', 2, true], ['>=', 3, true], ['<', 3, false], ['<=', 3, true], ['==', 3, true], ['!=', 3, false]]) {
    assert.equal(evalCondition({ path: 'x', op, value: v }, ctx).ok, want, op);
  }
  assert.equal(evalCondition({ path: 's', op: 'in', value: ['water', 'heat'] }, ctx).ok, true);
  assert.equal(evalCondition({ path: 's', op: 'in', value: ['heat'] }, ctx).ok, false);
  assert.throws(() => evalCondition({ path: 'x', op: 'eval', value: 1 }, ctx));
});

test('a missing value never triggers, even for "<" (null is not 0)', () => {
  const r = evalCondition({ path: 'x', op: '<', value: 25 }, { x: null });
  assert.equal(r.ok, false);
  assert.equal(r.missing, true);
  assert.equal(evalCondition({ path: 'y', op: '!=', value: 1 }, {}).ok, false);
});

test('evalTrigger handles all/any and nesting', () => {
  const ctx = { a: 1, b: 2 };
  assert.equal(evalTrigger({ all: [{ path: 'a', op: '==', value: 1 }, { path: 'b', op: '>', value: 5 }] }, ctx).fired, false);
  assert.equal(evalTrigger({ any: [{ path: 'a', op: '==', value: 1 }, { path: 'b', op: '>', value: 5 }] }, ctx).fired, true);
  assert.equal(evalTrigger({ all: [{ any: [{ path: 'zz', op: '>', value: 0 }, { path: 'b', op: '==', value: 2 }] }] }, ctx).fired, true);
  assert.equal(evalTrigger({ all: [] }, ctx).fired, false);
});

test('every action in actions.json has a valid trigger, evidence level, sources and expert check', () => {
  assert.ok(actions.actions.length >= 12);
  const ids = new Set();
  for (const a of actions.actions) {
    assert.ok(!ids.has(a.id), `duplicate ${a.id}`);
    ids.add(a.id);
    assert.ok(['water', 'temperature', 'soil_moisture', 'crop_condition'].includes(a.factor));
    assert.ok(['A', 'B', 'C'].includes(a.evidence_level));
    assert.ok(a.source_ids.length > 0 && a.expert_check && a.gaps.length && a.risks.length);
    evalTrigger(a.trigger, {}); // must not throw
    assert.doesNotMatch(JSON.stringify(a), /\b(will increase yield|guarantee|saves? \d+)/i);
  }
});

// ───────── score maths ─────────
test('timing factor: in month 1.0, within 3 months 0.6, otherwise 0.3 (wraps the year)', () => {
  assert.equal(timingFactor([6, 7], 7), 1);
  assert.equal(timingFactor([6, 7], 4), 0.6);
  assert.equal(timingFactor([6, 7], 1), 0.3);
  assert.equal(timingFactor([1, 2], 11), 0.6);
});

test('priority factor sums tags and never drops below 0.2', () => {
  assert.equal(priorityFactor(['water', 'income'], { water: 0.5, soil: 0.3, income: 0.2 }), 0.7);
  assert.equal(priorityFactor(['soil'], { water: 0.9, soil: 0.0, income: 0.1 }), 0.2);
});

test('score = severity × priority × evidence × timing, keeping every part', () => {
  const act = { severity_path: 's', priority_tags: ['water'], evidence_level: 'B', months: [7] };
  const r = scoreAction(act, { s: 0.8 }, { water: 0.5 }, 7);
  assert.equal(r.score, Math.round(0.8 * 0.5 * 0.7 * 1 * 1000) / 1000);
  assert.deepEqual([r.score_parts.severity, r.score_parts.priority, r.score_parts.evidence, r.score_parts.timing], [0.8, 0.5, 0.7, 1]);
  const missing = scoreAction(act, { s: null }, { water: 0.5 }, 7);
  assert.equal(missing.score_parts.severity, 0.5);
});

// ───────── top 3 ─────────
test('recommend returns top 3 with score breakdown, real-value evidence and the expert line', () => {
  const r = recommend({ analysis: sampleAnalysis(), farm: farm(), field_id: 'fld01', crops, actions, rotationsFit, today: JULY });
  assert.equal(r.top3.length, 3);
  for (const c of r.top3) {
    assert.ok(c.score_parts && 'severity' in c.score_parts && 'timing' in c.score_parts);
    assert.ok(c.expert_check.includes('K-State Research and Extension'));
    assert.ok(c.why.length >= 1 && !c.why[0].includes('{'));
  }
  const scores = r.top3.filter((c) => c.status === 'triggered').map((c) => c.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  const w1 = r.all.find((c) => c.id === 'W1_irrigation_timing');
  assert.equal(w1.status, 'triggered');
  assert.ok(w1.evidence.some((e) => /9/.test(e.text) && e.kind === 'live'));
  assert.ok(w1.evidence.some((e) => e.kind === 'farm_record' && /synthetic/.test(e.text)));
  const w4 = r.all.find((c) => c.id === 'W4_compare_rotations');
  assert.equal(w4.status, 'triggered');
  assert.ok(w4.why[0].includes('14 of 35'));
});

test('factor-diversity rule: at most 2 cards from one factor without focus', () => {
  const cards = [
    { id: 'a', factor: 'water', score: 0.9 }, { id: 'b', factor: 'water', score: 0.8 },
    { id: 'c', factor: 'water', score: 0.7 }, { id: 'd', factor: 'soil_moisture', score: 0.1 },
  ];
  assert.deepEqual(pickDiverse(cards, 3, 2).map((c) => c.id), ['a', 'b', 'd']);
  const r = recommend({ analysis: sampleAnalysis(), farm: farm(), field_id: 'fld01', crops, actions, rotationsFit, today: JULY });
  const counts = {};
  for (const c of r.top3) counts[c.factor] = (counts[c.factor] ?? 0) + 1;
  assert.ok(Object.values(counts).every((n) => n <= 2), JSON.stringify(counts));
});

test('focus filters to one factor and lifts the diversity cap', () => {
  const r = recommend({ analysis: sampleAnalysis(), farm: farm(), field_id: 'fld01', crops, actions, rotationsFit, focus: 'water', today: JULY });
  assert.equal(r.top3.length, 3);
  assert.ok(r.top3.every((c) => c.factor === 'water'));
  assert.ok(r.top3.filter((c) => c.status === 'triggered').length >= 3);
  assert.throws(() => recommend({ analysis: sampleAnalysis(), farm: farm(), field_id: 'fld01', crops, actions, focus: 'yield' }));
});

test('"watch" fallback fills focus results when fewer than 3 actions trigger', () => {
  const calm = sampleAnalysis({ interactions: { cause_check: { code: 'none', text: 'Greenness normal' } } });
  const r = recommend({ analysis: calm, farm: farm(), field_id: 'fld01', crops, actions, rotationsFit, focus: 'crop_condition', today: JULY });
  assert.equal(r.top3.length, 3);
  const watch = r.top3.filter((c) => c.status === 'watch');
  assert.ok(watch.length >= 2);
  for (const w of watch) assert.ok(w.reason.length > 0, 'watch items explain why they did not trigger');
  // triggered items always come before watch items
  const firstWatch = r.top3.findIndex((c) => c.status === 'watch');
  assert.ok(r.top3.slice(firstWatch).every((c) => c.status === 'watch'));
});

test('empty analysis: nothing triggers from missing data, and the result is still well-formed', () => {
  const r = recommend({ analysis: {}, farm: null, field_id: 'fldX', crops, actions, today: NOV });
  assert.equal(r.top3.length, 3);
  assert.ok(r.all.every((c) => c.status === 'watch'));
  assert.ok(r.rotations.length >= 3);
});

test('template filling never leaves braces and marks missing values', () => {
  assert.equal(fillTemplate('p={a}', { a: 'p' }, { p: 212.44 }), 'p=212.4');
  assert.equal(fillTemplate('x={a} y={b}', { a: 'p.a', b: 'p.b' }, { p: { a: 1.234 } }), 'x=1.23 y=unavailable');
});

// ───────── rotations ─────────
test('parseXofN reads strings and objects', () => {
  assert.deepEqual(parseXofN('14 of 35').count, 14);
  assert.equal(parseXofN({ count: 1, n: 4 }).share, 0.25);
  assert.equal(parseXofN(null), null);
  assert.equal(parseXofN('n/a'), null);
});

test('current rotation from farm records → continuous corn, plus 2 alternatives, no winner', () => {
  const r = recommend({ analysis: sampleAnalysis(), farm: farm(), field_id: 'fld01', crops, actions, rotationsFit, today: JULY });
  assert.equal(r.rotations.length, 3);
  assert.equal(r.rotations[0].role, 'current');
  assert.equal(r.rotations[0].id, 'corn_corn');
  assert.deepEqual(r.rotations.slice(1).map((c) => c.id), ['corn_sorghum', 'corn_wheat']);
  for (const c of r.rotations) {
    assert.ok(c.benefits.length && c.risks.length && c.gaps.length && c.why_suggested);
    assert.ok(!('winner' in c) && !('rank' in c) && !('best' in c));
    assert.doesNotMatch(JSON.stringify(c), /\b(best|optimal|winner)\b/i);
  }
  const wheat = r.rotations.find((c) => c.id === 'corn_wheat');
  assert.match(wheat.why_suggested, /14 of 35/);
  assert.ok(wheat.comparison_to_current.some((t) => t.includes('6 of 35') && t.includes('14 of 35')));
});

test('current rotation unknown → "please confirm" card plus all 3 candidates', () => {
  const noRecs = farm({ fields: [{ field_id: 'fld09', records: [] }] });
  const cur = inferCurrentRotation({ farm: noRecs, field_id: 'fld09', field: null });
  assert.equal(cur.id, 'current_unknown');
  assert.match(cur.name, /please confirm/i);
  const r = recommend({ analysis: sampleAnalysis(), farm: noRecs, field_id: 'fld09', crops, actions, rotationsFit, today: NOV });
  assert.equal(r.rotations[0].id, 'current_unknown');
  assert.deepEqual(r.rotations.slice(1).map((c) => c.id), ['corn_corn', 'corn_sorghum', 'corn_wheat']);
});

test('satellite crop history is used when there are no records, flagged as unconfirmed', () => {
  const field = { properties: { crop_history: [
    { year: 2021, crop: 'Corn' }, { year: 2022, crop: 'Winter Wheat' }, { year: 2023, crop: 'Winter Wheat' },
    { year: 2024, crop: 'Corn' }, { year: 2025, crop: 'Winter Wheat' }] } };
  const cur = inferCurrentRotation({ farm: null, field_id: 'fld03', field });
  assert.equal(cur.id, 'corn_wheat');
  assert.equal(cur.confirmed, false);
  assert.match(cur.note, /not a strict/);
  const mixed = { properties: { crop_history: [
    { year: 2021, crop: 'Corn' }, { year: 2022, crop: 'Corn' }, { year: 2023, crop: 'Sorghum' },
    { year: 2024, crop: 'Sorghum' }, { year: 2025, crop: 'Winter Wheat' }] } };
  const c2 = inferCurrentRotation({ farm: null, field_id: 'fld02', field: mixed });
  assert.equal(c2.id, 'current_custom');
  const toFit = rotationsToEvaluate({ farm: null, field_id: 'fld02', field: mixed, actions });
  assert.equal(toFit[0].id, 'current_custom');
  assert.equal(toFit.length, 4);
});

test('wheat-after-corn rotations raise the wheat handoff action', () => {
  const f = farm({ fields: [{ field_id: 'fld03', records: [
    { year: 2024, period: 'season', crop: 'corn' }, { year: 2025, period: 'season', crop: 'winter_wheat' }] }] });
  const r = recommend({ analysis: sampleAnalysis(), farm: f, field_id: 'fld03', crops, actions, rotationsFit, today: new Date('2026-08-20T12:00:00') });
  const t3 = r.all.find((c) => c.id === 'T3_wheat_handoff');
  assert.equal(t3.status, 'triggered');
  assert.match(t3.why[0], /Sep 25/);
  assert.equal(r.rotations[0].id, 'corn_wheat');
});

// ───────── report ─────────
test('season report has the 8 sections, ends with the expert line and prints as text', () => {
  const analysis = sampleAnalysis();
  const recs = recommend({ analysis, farm: farm(), field_id: 'fld01', crops, actions, rotationsFit, today: JULY });
  const rep = buildReport({ analysis, recs, farm: farm(), field: { field_id: 'fld01', name: 'North pivot' }, period: { year: 2026, period: 'season' } });
  assert.equal(rep.sections.length, 8);
  assert.match(rep.title, /North pivot/);
  assert.equal(rep.sections[7].items[0].text, EXPERT_LINE);
  const danger = rep.sections[1].items.map((i) => i.text).join(' ');
  assert.match(danger, /Temperature/);
  assert.doesNotMatch(danger, /Crop condition/); // severity 0.2 < 0.5
  const md = reportToMarkdown(rep);
  assert.match(md, /## Top 3 recommended actions/);
  assert.match(md, /synthetic/i);
  assert.doesNotMatch(md, /undefined|\[object Object\]/);
});
