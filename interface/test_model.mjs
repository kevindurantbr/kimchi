import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {selectField,weatherForYear,weatherSummary,storageAt,cropHistory,validateBundle,safeURL,priorities} from './model.mjs';
const bundle=JSON.parse(readFileSync(new URL('../prototype/demo_bundle.json',import.meta.url)));
test('all three histories stay field-specific, with unconfirmed baselines',()=>{
  validateBundle(bundle);
  assert.deepEqual(cropHistory(selectField(bundle,'fld01')).map(h=>h.crop),Array(5).fill('Corn'));
  assert.equal(cropHistory(selectField(bundle,'fld02'))[2].crop,'Sorghum');
  assert.equal(selectField(bundle,'fld03').baseline,null);
  assert.throws(()=>selectField(bundle,'test01'));
});
test('soil values retain units, depth and incomplete coverage; missing is not zero',()=>{
  const field=selectField(bundle,'fld01');
  assert.equal(storageAt(field,150).value,30.78);
  assert.equal(storageAt(field,150).coverage_fraction,.928);
  assert.equal(storageAt(field,150).unit,'cm water');
  assert.equal(storageAt(field,25).value,5.19);
  assert.equal(storageAt(field,999),null);
});
test('weather is shared regional context; missing or partial months suppress annual summaries',()=>{
  const rows=weatherForYear(bundle,'2025');
  assert.equal(rows.length,12);
  assert.ok(weatherSummary(rows,'rain')>0);
  const partial=structuredClone(rows);partial[0].quality='partial';
  assert.equal(weatherSummary(partial,'rain'),null);
  const missing=structuredClone(rows);missing[0].precipitation_mm=null;
  assert.equal(weatherSummary(missing,'rain'),null);
  assert.equal(weatherSummary(weatherForYear(bundle,'2030'),'rain'),null);
  const zero=structuredClone(rows);zero.forEach(r=>r.precipitation_mm=0);
  assert.equal(weatherSummary(zero,'rain'),0);
});
test('priority rules resolve without altering candidate order, suitability or numerical claims',()=>{
  const before=JSON.stringify(bundle.candidates);
  for(const p of Object.values(priorities)) for(const id of p.rules) assert.ok(bundle.rules.some(r=>r.rule_id===id));
  assert.equal(JSON.stringify(bundle.candidates),before);
  assert.ok(bundle.candidates.every(c=>c.field_suitability===null));
});
test('new evidence states require explicit interface review',()=>{
  const changed=structuredClone(bundle);changed.fields[0].et.status='estimated';
  assert.throws(()=>validateBundle(changed));
  changed.fields[0].et=structuredClone(bundle.fields[0].et);changed.fields[0].baseline='corn';
  assert.throws(()=>validateBundle(changed));
});
test('source links cannot execute scripts or reinterpret repository paths as web URLs',()=>{
  assert.equal(safeURL('javascript:alert(1)'),null);
  assert.equal(safeURL('scripts/extract_fields.py'),null);
  assert.equal(safeURL('https://www.nasa.gov'),'https://www.nasa.gov/');
});
