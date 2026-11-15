// Live NASA POWER weather, fetched in the browser each time the page opens.
// The reviewed snapshot stays authoritative for its months. Live rows only extend the
// series past the snapshot, and they are labelled as unreviewed, provisional data.
// Monthly rules match research/deliverables/weather-water/weather.json:
// precipitation is a total only when every expected day is valid (otherwise null),
// mean temperature averages valid days, and missing values are never zero.

export const LIVE_SOURCE_ID = 'T3_NASA_POWER_LIVE';
export const REVIEWED_SOURCE_ID = 'T3_NASA_POWER_DAILY';
const PARAMS = ['PRECTOTCORR', 'T2M', 'T2M_MIN', 'T2M_MAX'];
const ENDPOINT = 'https://power.larc.nasa.gov/api/temporal/daily/point';

const pad = n => String(n).padStart(2, '0');
export const localISODate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function coordinateFrom(source) {
  try {
    const q = new URL(source.request_without_secrets).searchParams;
    const lon = Number(q.get('longitude')), lat = Number(q.get('latitude'));
    if (Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90) return {lon, lat};
  } catch { /* fall through */ }
  return null;
}

export function powerURL({lon, lat}, start, end) {
  const q = new URLSearchParams({parameters: PARAMS.join(','), community: 'AG', longitude: String(lon),
    latitude: String(lat), start: start.replaceAll('-', ''), end: end.replaceAll('-', ''), format: 'JSON'});
  return `${ENDPOINT}?${q.toString().replaceAll('%2C', ',')}`;
}

// Map of ISO date -> {PRECTOTCORR, T2M, T2M_MIN, T2M_MAX}; fill values become null.
export function dailyFromPower(doc) {
  const p = doc?.properties?.parameter, fill = doc?.header?.fill_value ?? -999;
  if (!p || PARAMS.some(k => !p[k] || typeof p[k] !== 'object')) throw new Error('Unexpected POWER response');
  const days = new Map();
  for (const k of PARAMS) {
    for (const [key, v] of Object.entries(p[k])) {
      if (!/^\d{8}$/.test(key)) throw new Error('Unexpected POWER date key');
      const iso = `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6)}`;
      if (!days.has(iso)) days.set(iso, {});
      days.get(iso)[k] = typeof v === 'number' && Number.isFinite(v) && v !== fill ? v : null;
    }
  }
  return days;
}

const hundredths = v => Math.round(v * 100);
const halfAway = x => Math.sign(x) * Math.round(Math.abs(x)); // ties away from zero, as in weather.json

export function monthlyRows(days, start, end, sourceId = LIVE_SOURCE_ID) {
  const rows = [];
  let y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7));
  const ey = Number(end.slice(0, 4)), em = Number(end.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) {
    const month = `${y}-${pad(m)}`, last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    let expected = 0, both = 0, pN = 0, pSum = 0, tN = 0, tSum = 0;
    for (let d = 1; d <= last; d++) {
      const iso = `${month}-${pad(d)}`;
      if (iso < start || iso > end) continue;
      expected++;
      const r = days.get(iso) ?? {};
      const p = r.PRECTOTCORR ?? null, t = r.T2M ?? null;
      if (p !== null) { pN++; pSum += hundredths(p); }
      if (t !== null) { tN++; tSum += hundredths(t); }
      if (p !== null && t !== null) both++;
    }
    rows.push({region_id: 'regional_sample', month,
      precipitation_mm: pN === expected ? pSum / 100 : null,
      mean_temperature_c: tN ? halfAway(tSum / tN) / 100 : null,
      days_observed: both, days_expected: expected, source_ids: [sourceId],
      quality: both === expected ? 'complete' : both > 0 ? 'partial' : 'missing', live: true});
    m++; if (m === 13) { y++; m = 1; }
  }
  return rows;
}

const same = (a, b) => (a === null && b === null) ||
  (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 0.005);

// Reviewed rows are kept unchanged; live rows are appended only after the reviewed snapshot.
export function mergeLive(reviewedRows, liveRows) {
  const reviewed = new Map(reviewedRows.map(r => [r.month, r]));
  const lastReviewed = reviewedRows.map(r => r.month).sort().at(-1);
  const added = liveRows.filter(r => r.month > lastReviewed);
  const overlap = liveRows.filter(r => reviewed.has(r.month));
  const differing = overlap.filter(r => !['precipitation_mm', 'mean_temperature_c']
    .every(k => same(reviewed.get(r.month)[k], r[k]))).map(r => r.month);
  return {rows: [...reviewedRows, ...added], added: added.map(r => r.month), compared: overlap.length,
    differing, lastReviewed};
}

export function lastValidDay(days) {
  return [...days.entries()].filter(([, r]) => r.PRECTOTCORR !== null && r.T2M !== null)
    .map(([d]) => d).sort().at(-1) ?? null;
}

export async function fetchLiveWeather(bundle, {fetchImpl = globalThis.fetch, today = new Date(), timeoutMs = 20000} = {}) {
  const reviewedSource = bundle.sources.find(s => s.source_id === REVIEWED_SOURCE_ID);
  const coord = reviewedSource && coordinateFrom(reviewedSource);
  if (!coord) throw new Error('No reviewed POWER coordinate in the bundle');
  const rows = bundle.regional_weather.rows;
  const lastReviewed = rows.map(r => r.month).sort().at(-1);
  // Re-fetch the last reviewed year as an overlap check, then everything up to today.
  const start = `${lastReviewed.slice(0, 4)}-01-01`, end = localISODate(today);
  const url = powerURL(coord, start, end);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {signal: controller.signal});
    if (!response.ok) throw new Error(`POWER HTTP ${response.status}`);
    const doc = await response.json();
    const days = dailyFromPower(doc);
    const merged = mergeLive(rows, monthlyRows(days, start, end));
    const fetchedAt = new Date().toISOString();
    const api = doc.header?.api ?? {};
    return {...merged, fetchedAt, throughDay: lastValidDay(days), source: {
      source_id: LIVE_SOURCE_ID,
      title: 'NASA POWER Daily API, fetched live when this page opened',
      url: reviewedSource.url,
      request_without_secrets: url,
      product_version: `${api.name ?? 'POWER Daily API'} ${api.version ?? ''}; header.sources=${(doc.header?.sources ?? []).join(',')}`,
      retrieved_date: fetchedAt,
      spatial_support: reviewedSource.spatial_support,
      limitations: 'Fetched in this browser when the page opened; not reviewed by the team. Reviewed snapshot values stay authoritative for their months; live rows only add later months. Recent NASA POWER days come from near-real-time products, are provisional and can be revised, and the latest few days are often not available yet. A month with missing days is partial: its precipitation total is unavailable, never zero. One regional grid cell, not field weather or a forecast.'}};
  } finally {
    clearTimeout(timer);
  }
}
