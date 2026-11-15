import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {coordinateFrom, powerURL, dailyFromPower, monthlyRows, mergeLive, lastValidDay, fetchLiveWeather,
  LIVE_SOURCE_ID, REVIEWED_SOURCE_ID} from './live_weather.mjs';
import {weatherForYear, weatherSummary, validateBundle} from './model.mjs';

const bundle = JSON.parse(readFileSync(new URL('../prototype/demo_bundle.json', import.meta.url)));
const PARAMS = ['PRECTOTCORR', 'T2M', 'T2M_MIN', 'T2M_MAX'];

// POWER-shaped response. 2025 is rebuilt from the reviewed monthly rows (all rain on day 1,
// the monthly mean every day) so the overlap check has an exact answer. 2026 is synthetic.
function fakePower({start = '2025-01-01', end = '2026-11-15', lastValid = '2026-11-12', tweak = null} = {}) {
  const reviewed = new Map(bundle.regional_weather.rows.map(r => [r.month, r]));
  const parameter = Object.fromEntries(PARAMS.map(p => [p, {}]));
  for (let d = new Date(start + 'T00:00:00Z'); d <= new Date(end + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10), key = iso.replaceAll('-', ''), r = reviewed.get(iso.slice(0, 7));
    const valid = iso <= lastValid;
    const rain = r ? (iso.endsWith('-01') ? r.precipitation_mm : 0) : 1.5;
    const temp = r ? r.mean_temperature_c : 10;
    parameter.PRECTOTCORR[key] = valid ? rain : -999;
    parameter.T2M[key] = valid ? temp : -999;
    parameter.T2M_MIN[key] = valid ? temp - 5 : -999;
    parameter.T2M_MAX[key] = valid ? temp + 5 : -999;
  }
  if (tweak) tweak(parameter);
  return {header: {fill_value: -999, api: {name: 'POWER Daily API', version: 'v2.10.3'}, sources: ['MERRA2', 'GEOSIT', 'POWER']},
    properties: {parameter}};
}

test('coordinate and request come from the reviewed POWER source', () => {
  const coord = coordinateFrom(bundle.sources.find(s => s.source_id === REVIEWED_SOURCE_ID));
  assert.deepEqual(coord, {lon: -100.64, lat: 39.36});
  const url = new URL(powerURL(coord, '2025-01-01', '2026-11-15'));
  assert.equal(url.searchParams.get('parameters'), PARAMS.join(','));
  assert.equal(url.searchParams.get('start'), '20250101');
  assert.equal(url.searchParams.get('end'), '20261115');
  assert.equal(coordinateFrom({request_without_secrets: 'not a url'}), null);
});

test('fill values become null and malformed responses are refused', () => {
  const days = dailyFromPower(fakePower());
  assert.equal(days.get('2026-11-14').PRECTOTCORR, null);
  assert.equal(days.get('2026-11-12').T2M, 10);
  assert.equal(lastValidDay(days), '2026-11-12');
  assert.throws(() => dailyFromPower({properties: {parameter: {T2M: {}}}}));
});

test('live 2025 rebuilt from daily values matches the reviewed rows exactly', () => {
  const live = monthlyRows(dailyFromPower(fakePower()), '2025-01-01', '2026-11-15');
  const merged = mergeLive(bundle.regional_weather.rows, live);
  assert.equal(merged.compared, 12);
  assert.deepEqual(merged.differing, []);
  assert.equal(merged.lastReviewed, '2025-12');
  for (const r of live.filter(r => r.month.startsWith('2025-'))) {
    const reviewed = bundle.regional_weather.rows.find(x => x.month === r.month);
    assert.equal(r.precipitation_mm, reviewed.precipitation_mm);
    assert.equal(r.mean_temperature_c, reviewed.mean_temperature_c);
  }
});

test('reviewed rows stay authoritative; only later months are added and labelled live', () => {
  const live = monthlyRows(dailyFromPower(fakePower({tweak: p => { p.PRECTOTCORR['20250315'] = 9.99; }})), '2025-01-01', '2026-11-15');
  const merged = mergeLive(bundle.regional_weather.rows, live);
  assert.deepEqual(merged.differing, ['2025-03']);
  assert.equal(merged.rows.find(r => r.month === '2025-03'), bundle.regional_weather.rows.find(r => r.month === '2025-03'));
  assert.equal(merged.added.length, 11);
  assert.equal(merged.added[0], '2026-01');
  assert.ok(merged.rows.filter(r => r.month >= '2026-01').every(r => r.live && r.source_ids[0] === LIVE_SOURCE_ID));
});

test('a partial current month withholds its rain total and the year has no annual summary', () => {
  const live = monthlyRows(dailyFromPower(fakePower()), '2025-01-01', '2026-11-15');
  const nov = live.find(r => r.month === '2026-11');
  assert.equal(nov.quality, 'partial');
  assert.equal(nov.days_expected, 15);
  assert.equal(nov.days_observed, 12);
  assert.equal(nov.precipitation_mm, null);
  assert.equal(nov.mean_temperature_c, 10);
  assert.equal(live.find(r => r.month === '2026-10').precipitation_mm, 46.5);
  const merged = {...bundle, regional_weather: {...bundle.regional_weather, rows: mergeLive(bundle.regional_weather.rows, live).rows}};
  assert.equal(weatherSummary(weatherForYear(merged, '2026'), 'rain'), null);
  assert.ok(weatherSummary(weatherForYear(merged, '2025'), 'rain') > 0);
});

test('a dry month is zero, not missing', () => {
  const days = dailyFromPower(fakePower({tweak: p => { for (const k of Object.keys(p.PRECTOTCORR)) if (k.startsWith('202602')) p.PRECTOTCORR[k] = 0; }}));
  const feb = monthlyRows(days, '2026-02-01', '2026-02-28')[0];
  assert.equal(feb.precipitation_mm, 0);
  assert.equal(feb.quality, 'complete');
});

test('fetchLiveWeather requests from the last reviewed year to today and records an unreviewed source', async () => {
  let requested;
  const fetchImpl = async url => { requested = url; return {ok: true, status: 200, json: async () => fakePower()}; };
  const before = JSON.stringify(bundle);
  const live = await fetchLiveWeather(bundle, {fetchImpl, today: new Date(2026, 10, 15)});
  assert.equal(new URL(requested).searchParams.get('start'), '20250101');
  assert.equal(new URL(requested).searchParams.get('end'), '20261115');
  assert.equal(live.throughDay, '2026-11-12');
  assert.equal(live.source.source_id, LIVE_SOURCE_ID);
  assert.match(live.source.limitations, /not reviewed/);
  assert.equal(JSON.stringify(bundle), before, 'the reviewed bundle object is not modified');
  validateBundle(bundle);
  await assert.rejects(fetchLiveWeather(bundle, {fetchImpl: async () => ({ok: false, status: 503})}), /503/);
  await assert.rejects(fetchLiveWeather(bundle, {fetchImpl: async () => { throw new Error('offline'); }}), /offline/);
});
