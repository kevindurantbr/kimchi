// ET display contract (OpenET or NASA MODIS): accepts exactly what prototype/compare.py validate_et emits.
// Display only: ET is never converted to pumping, irrigation or a water saving.
const QUALITIES = ['reported', 'area_weighted_from_parts', 'missing'];
const PROVIDERS = {T3_OPENET: 'OpenET (30 m field-boundary mean)', T3_MODIS: 'NASA MODIS (500 m satellite pixel at field centre)'};
const provider = id => Object.entries(PROVIDERS).find(([prefix]) => id.startsWith(prefix))?.[1];
const shape = (o, keys) => o !== null && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).sort().join() === keys;
const depth = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const fail = message => {throw new Error(`ET evidence rejected: ${message}`);};
const isoDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const union = rows => [...new Set(rows.flatMap(r => r.source_ids))].sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const mm = v => `${v.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} mm`;

function monthsBetween(start, end) {
  const out = [];
  let [y, m] = [Number(start.slice(0, 4)), Number(start.slice(5, 7))];
  const last = end.slice(0, 7);
  for (let ym = start.slice(0, 7); ym <= last; ym = `${y}-${String(m).padStart(2, '0')}`) {
    out.push(ym);
    if (++m > 12) {m = 1; y += 1;}
  }
  return out;
}

function checkRows(rows, keys, fieldId, boundary, sources, allowed) {
  if (!Array.isArray(rows) || !rows.length) fail('rows missing');
  let previous = '';
  for (const r of rows) {
    if (!shape(r, keys)) fail('unexpected row fields');
    if (r.field_id !== fieldId) fail('row joins another field');
    if (r.geometry_status !== boundary || boundary === 'test') fail('geometry status does not match the field boundary');
    if (!allowed.includes(r.month) || r.month <= previous) fail(`month outside period or out of order: ${r.month}`);
    previous = r.month;
    if (!Array.isArray(r.source_ids) || !r.source_ids.length || !r.source_ids.every(id => typeof id === 'string' && provider(id) && sources.has(id))) fail('unresolved ET source');
  }
}

export function validateET(bundle, {allowSynthetic = false} = {}) {
  const sources = new Map(bundle.sources.map(s => [s.source_id, s]));
  // compare.py refuses SYNTHETIC ET; the bundle schema has no synthetic flag, so the display refuses it too.
  if (!allowSynthetic && bundle.sources.some(s => JSON.stringify(s).toUpperCase().includes('SYNTHETIC'))) fail('synthetic source in a display bundle');
  for (const field of bundle.fields) {
    const et = field.et, boundary = field.feature?.properties?.boundary_status;
    if (et?.status === 'unavailable') {
      if (!shape(et, 'rows,source_ids,status') || !Array.isArray(et.rows) || et.rows.length || !Array.isArray(et.source_ids) || !et.source_ids.every(id => sources.has(id))) fail('unexpected unavailable state');
      continue;
    }
    if (et?.status !== 'available' || !shape(et, 'coverage,interpretation,interval,period,rows,source_ids,status,uncertainty,units')) fail('unknown ET state');
    if (et.units !== 'mm' || et.interval !== 'monthly' || typeof et.interpretation !== 'string') fail('units must be monthly mm');
    if (!shape(et.period, 'end,start') || !isoDay(et.period.start) || !isoDay(et.period.end) || et.period.start > et.period.end) fail('period not recorded');
    const months = monthsBetween(et.period.start, et.period.end);
    checkRows(et.rows, 'et_mm,field_id,geometry_status,month,quality,source_ids', field.field_id, boundary, sources, months);
    for (const r of et.rows) {
      if (r.et_mm !== null && !depth(r.et_mm)) fail(`invalid et_mm: ${r.et_mm}`);
      if (!QUALITIES.includes(r.quality) || (r.et_mm === null) !== (r.quality === 'missing')) fail('quality does not match value');
    }
    if (et.source_ids.length !== 1 || !same(et.source_ids, union(et.rows))) fail('field source_ids do not match rows');
    const have = new Set(et.rows.filter(r => r.et_mm !== null).map(r => r.month));
    const c = et.coverage;
    if (!shape(c, 'months_expected,months_missing,months_with_values') || c.months_expected !== months.length || c.months_with_values !== have.size || !same(c.months_missing, months.filter(m => !have.has(m)))) fail('coverage does not match rows and period');
    const u = et.uncertainty;
    if (u?.status === 'unavailable' && shape(u, 'rows,status') && same(u.rows, [])) continue;
    if (u?.status !== 'available' || !shape(u, 'kind,rows,source_ids,status,units') || u.units !== 'mm' || typeof u.kind !== 'string') fail('unknown uncertainty state');
    checkRows(u.rows, 'et_mad_max_mm,et_mad_min_mm,field_id,geometry_status,month,source_ids', field.field_id, boundary, sources, et.rows.map(r => r.month));
    for (const r of u.rows) {
      if (![r.et_mad_min_mm, r.et_mad_max_mm].every(v => v === null || depth(v))) fail('invalid MAD range value');
      if (r.et_mad_min_mm !== null && r.et_mad_max_mm !== null && r.et_mad_min_mm > r.et_mad_max_mm) fail('MAD range minimum exceeds maximum');
    }
    if (!same(u.source_ids, union(u.rows))) fail('uncertainty source_ids do not match rows');
  }
  return bundle;
}

// Display rows for a validated field; null keeps the reviewed "Data unavailable" panel.
export function etView(bundle, field) {
  const et = field.et;
  if (et.status !== 'available') return null;
  const ranges = et.uncertainty.status === 'available' ? new Map(et.uncertainty.rows.map(r => [r.month, r])) : null;
  return {
    provider: provider(et.source_ids[0]), units: et.units, period: `${et.period.start} to ${et.period.end}`, interpretation: et.interpretation,
    coverage: `${et.coverage.months_with_values} of ${et.coverage.months_expected} months`,
    sourceIds: et.source_ids.concat(ranges ? et.uncertainty.source_ids : []),
    sourceLabel: et.source_ids.map(id => bundle.sources.find(s => s.source_id === id)?.title ?? id).join('; '),
    rangeLabel: ranges ? et.uncertainty.kind : null,
    rows: et.rows.map(r => {
      const m = ranges?.get(r.month);
      return {month: r.month, value: r.et_mm === null ? 'No value' : mm(r.et_mm), quality: r.quality,
        range: !ranges ? null : m && m.et_mad_min_mm !== null && m.et_mad_max_mm !== null ? `${mm(m.et_mad_min_mm)} – ${mm(m.et_mad_max_mm)}` : 'No value'};
    }),
  };
}
