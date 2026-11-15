// Quick live check of the data layer: node scripts/smoke.mjs
import fs from 'node:fs';
import { fetchPowerDaily, fetchSoilForPolygon, fetchModisNdvi, lastValidDate, polygonAreaHa } from '../dashboard/lib/sources.mjs';

const root = new URL('..', import.meta.url);
const fields = JSON.parse(fs.readFileSync(new URL('research/deliverables/fields-soils/fields.geojson', root), 'utf8'));
const fld01 = fields.features.find((f) => f.properties.field_id === 'fld01');
let failed = 0;

const end = new Date();
const start = new Date(end.getTime() - 6 * 86400000);
try {
  const p = await fetchPowerDaily({ lat: 39.39758, lon: -100.67829, start, end });
  console.log(`POWER ok  site=${p.site_id} api=${p.api_version} days=${p.daily.date.length} ${p.start}..${p.end}`);
  for (const k of Object.keys(p.daily).filter((k) => k !== 'date')) {
    console.log(`  ${k.padEnd(14)} ${JSON.stringify(p.daily[k])}  last valid ${lastValidDate(p.daily, k)}`);
  }
} catch (e) { failed++; console.log('POWER FAIL', e.message); }

try {
  const s = await fetchSoilForPolygon(fld01.geometry);
  console.log(`SDA ok    fld01 area=${polygonAreaHa(fld01.geometry).toFixed(2)} ha aws_0_150=${s.aws_0_150_cm} cm coverage=${s.aws_coverage} drainage=${s.drainage} (${s.drainage_share}) hydgrp=${s.hydgrp} (${s.hydgrp_share}) mukeys=${s.mukeys.join(',')}`);
  console.log(`  method: ${s.method.split(':')[0]}  (research value: 30.78 cm, coverage 0.928, Well drained 0.928, C 0.744)`);
} catch (e) { failed++; console.log('SDA FAIL', e.message); }

if (process.argv.includes('--ndvi')) {
  try {
    const n = await fetchModisNdvi({ lat: 39.39758, lon: -100.67829, startDate: '2025-06-01', endDate: '2025-08-31' });
    console.log(`MODIS ok  ${n.nrows}x${n.ncols} px=${n.pixel_size_m} m dates=${n.dates.join(',')} reliability=${n.reliability_applied}`);
    console.log(`  centre pixel: ${n.pixels.map((r) => r[Math.floor(r.length / 2)]).join(', ')}`);
  } catch (e) { failed++; console.log('MODIS FAIL', e.message); }
} else {
  console.log('MODIS skipped (pass --ndvi to test the ORNL service)');
}
process.exit(failed ? 1 : 0);
