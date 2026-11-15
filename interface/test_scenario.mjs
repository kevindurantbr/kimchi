import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {compare, constraintOutcome, baselineStatus, isoDate, PRIORITY_RULES, STATES} from './scenario.mjs';
import {validateBundle} from './model.mjs';

const bundle = JSON.parse(readFileSync(new URL('../prototype/demo_bundle.json', import.meta.url)));
const parity = JSON.parse(readFileSync(new URL('./fixtures/scenario_parity.json', import.meta.url)));
const ids = bundle.candidates.map(c => c.candidate_id);
const project = r => {
  // Fields that compare.py never varies are checked once against fixture "constants".
  const {priority_explanation, numeric_outputs, numeric_status} = parity.constants;
  assert.equal(r.priority_explanation, priority_explanation);
  for (const c of r.candidates) assert.deepEqual([c.numeric_outputs, c.numeric_status], [numeric_outputs, numeric_status]);
  return {field_id: r.field.field_id, field_baseline: r.field.baseline, scenario_status: r.scenario_status,
    questions_first: r.questions_first.map(q => q.rule_id), winner: r.winner,
    candidates: r.candidates.map(c => Object.fromEntries(['candidate_id', 'status', 'exclusion_reasons', 'unresolved_constraints'].map(k => [k, c[k]])))};
};

test('priority question lists match prototype/compare.py', () => {
  assert.deepEqual(PRIORITY_RULES, parity.priorities);
});

for (const c of parity.cases) {
  test(`parity with compare.py (synthetic): ${c.name}`, () => {
    const run = () => compare(bundle, c.field_id, c.priority, structuredClone(c.scenario));
    if (c.error) {
      assert.throws(run, c.error.message === null ? Error : {message: c.error.message});
      return;
    }
    const result = run();
    assert.deepEqual(project(result), c.expected);
    // Everything else on each candidate is the reviewed research, unchanged.
    result.candidates.forEach((cand, i) => {
      const {status, exclusion_reasons, unresolved_constraints, numeric_outputs, numeric_status, ...rest} = cand;
      assert.deepEqual(rest, bundle.candidates[i]);
    });
  });
}

test('a confirmed baseline stays in UI state and never changes candidate states or the bundle', () => {
  const scenario = parity.cases.find(c => c.name === 'confirmed_baseline_is_ui_only');
  const baseline = baselineStatus({history: 'confirmed', continuation: 'corn_corn'}, ids);
  assert.equal(baseline.confirmed, true);
  assert.equal(baseline.continuation, 'corn_corn');
  assert.deepEqual(project(compare(bundle, 'fld01', 'water', scenario.scenario)), scenario.expected);
  assert.throws(() => compare(bundle, 'fld01', 'water', {baseline: baseline.continuation}), /Unknown scenario field/);
  assert.ok(bundle.fields.every(f => f.baseline === null));
  validateBundle(bundle);
});

test('baseline needs both a checked history and an intended continuation', () => {
  assert.deepEqual(baselineStatus({}, ids).missing, ['Confirm or correct the crop history', 'Choose the intended continuation']);
  assert.equal(baselineStatus({history: 'corrected', correction: '  ', continuation: 'corn_wheat'}, ids).confirmed, false);
  assert.equal(baselineStatus({history: 'corrected', correction: '2023 was sorghum', continuation: 'corn_wheat'}, ids).confirmed, true);
  assert.equal(baselineStatus({history: 'confirmed', continuation: 'other'}, ids).confirmed, false);
  assert.equal(baselineStatus({history: 'confirmed', continuation: 'other', other: 'Corn → soybean'}, ids).continuation, 'other');
  assert.equal(baselineStatus({history: 'confirmed', continuation: 'corn_typo'}, ids).confirmed, false);
});

test('each supplied constraint reports excluded, unresolved or checked without exclusion', () => {
  const late = {candidate_id: 'corn_wheat', kind: 'calendar', confirmed: true, evidence: 'SYNTHETIC',
    earliest_sowing_date: '2027-10-15', validated_window_end: '2027-10-01', no_feasible_adjustment: true};
  const unconfirmed = {...late, confirmed: false}, adjustable = {...late, no_feasible_adjustment: false};
  const result = compare(bundle, 'fld01', 'water', {constraints: [late, unconfirmed, adjustable]});
  assert.deepEqual([late, unconfirmed, adjustable].map(item => constraintOutcome(result, item)), ['excluded', 'unresolved', 'no_exclusion']);
  assert.equal(result.candidates.find(c => c.candidate_id === 'corn_wheat').status, STATES.excluded);
  assert.equal(result.winner, null);
  assert.ok(result.candidates.every(c => Object.values(c.numeric_outputs).every(v => v === null)));
  assert.ok(result.candidates.every(c => Object.values(STATES).includes(c.status)), 'no eligible or ranked state');
});

test('dates follow the ISO calendar', () => {
  assert.equal(isoDate('2028-02-29', 'd'), '2028-02-29');
  for (const bad of ['2027-02-29', '2027-1-05', '0000-01-01', '', null, 20271015]) assert.throws(() => isoDate(bad, 'd'));
});

test('the interface keeps entries in page memory only', () => {
  for (const file of ['app.js', 'scenario.mjs']) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.sendBeacon/, file);
  }
});
