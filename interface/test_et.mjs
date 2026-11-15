import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {validateBundle} from './model.mjs';
import {etView} from './et_view.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const demo = JSON.parse(readFileSync(new URL('../prototype/demo_bundle.json', import.meta.url)));
// SYNTHETIC adapter output (fake HTTP responses) bundled in memory by compare.py itself, so the
// display contract is checked against what compare.py emits. Never real ET.
const synthetic = JSON.parse(execFileSync('python3', ['-c', 'import sys; sys.path.insert(0, "prototype"); import compare; ' +
  'print(compare.dumps(compare.build_bundle(et_path="prototype/fixtures/et_synthetic.json", allow_synthetic_et=True)))'], {cwd: root}));
const field = (b, id) => b.fields.find(f => f.field_id === id);
const accept = b => validateBundle(b, {allowSynthetic: true});
const rejects = (name, mutate) => test(`rejected: ${name}`, () => {
  const b = structuredClone(synthetic);
  mutate(b, field(b, 'fld02').et);
  assert.throws(() => accept(b), /ET evidence rejected/);
});

test('unavailable ET passes and keeps the reviewed panel', () => {
  validateBundle(demo);
  for (const f of demo.fields) {
    assert.deepEqual(f.et, {status: 'unavailable', rows: [], source_ids: ['T3_OPENET_ENSEMBLE_MONTHLY']});
    assert.equal(etView(demo, f), null);
  }
});

test('available ET from compare.py validates and formats; null stays "No value", never 0', () => {
  accept(synthetic);
  const v = etView(synthetic, field(synthetic, 'fld02'));
  assert.equal(v.units, 'mm');
  assert.equal(v.coverage, '5 of 6 months');
  assert.equal(v.period, '2021-01-01 to 2021-06-30');
  assert.match(v.sourceLabel, /OpenET Ensemble monthly actual ET/);
  assert.deepEqual(v.sourceIds, ['T3_OPENET_ENSEMBLE_MONTHLY', 'T3_OPENET_ENSEMBLE_MAD_RANGE']);
  assert.match(v.rangeLabel, /MAD range/);
  assert.deepEqual(v.rows.map(r => r.value), ['21.00 mm', '22.00 mm', 'No value', '24.00 mm', '25.00 mm', '26.00 mm']);
  assert.deepEqual([v.rows[0].range, v.rows[2].range, v.rows[2].quality], ['20.00 mm – 22.00 mm', 'No value', 'missing']);
  assert.equal(etView(synthetic, field(synthetic, 'fld01')).coverage, '6 of 6 months');
});

test('a field without ET or without a range stays unavailable for that part only', () => {
  const b = structuredClone(synthetic);
  field(b, 'fld03').et = structuredClone(demo.fields[2].et);
  field(b, 'fld01').et.uncertainty = {status: 'unavailable', rows: []};
  accept(b);
  assert.equal(etView(b, field(b, 'fld03')), null);
  const v = etView(b, field(b, 'fld01'));
  assert.equal(v.rangeLabel, null);
  assert.ok(v.rows.every(r => r.range === null));
});

test('rejected: SYNTHETIC source in a display (non-test) bundle', () => {
  assert.throws(() => validateBundle(synthetic), /synthetic/);
});
rejects('wrong units', (b, et) => { et.units = 'in'; });
rejects('negative et_mm', (b, et) => { et.rows[0].et_mm = -1; });
rejects('NaN et_mm', (b, et) => { et.rows[0].et_mm = NaN; });
rejects('string et_mm', (b, et) => { et.rows[0].et_mm = '21'; });
rejects('quality mismatch: null reported', (b, et) => { et.rows[0].et_mm = null; });
rejects('quality mismatch: value marked missing', (b, et) => { et.rows[2].et_mm = 0; });
rejects('unknown row source_id', (b, et) => { et.rows[0].source_ids = ['T3_OPENET_UNKNOWN']; });
rejects('unknown field source_id', (b, et) => { et.source_ids = ['T3_OPENET_UNKNOWN']; });
rejects('coverage count mismatch', (b, et) => { et.coverage.months_with_values = 6; });
rejects('coverage expected mismatch', (b, et) => { et.coverage.months_expected = 12; });
rejects('period does not match rows', (b, et) => { et.period.end = '2021-05-31'; });
rejects('duplicate month', (b, et) => { et.rows.splice(1, 0, structuredClone(et.rows[0])); });
rejects('test geometry', (b, et) => { et.rows[0].geometry_status = 'test'; });
rejects('row from another field', (b, et) => { et.rows[0].field_id = 'fld01'; });
rejects('unknown status', (b, et) => { et.status = 'estimated'; });
rejects('extra field', (b, et) => { et.pumping_mm = 1; });
rejects('MAD range inverted', (b, et) => { et.uncertainty.rows[0].et_mad_min_mm = 99; });
