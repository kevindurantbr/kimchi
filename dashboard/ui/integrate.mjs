// Integration layer: loads the P1/P2/P4 modules and data files. There is NO sample fallback on the live site:
// when a real file or module fails to load, that part gets no data and an entry in `ctx.loadErrors`
// ({ ok: false, part, file, label, message, error }), so the UI can show an error card instead of numbers.
// `status` records only what loaded (all real), so the old SAMPLE DATA chip stays hidden. Nothing here invents values.
// (The app no longer imports ui/_fixtures/.)

const status = {};           // key -> { real: true, detail } for each part that loaded (failures go to loadErrors)
export const dataStatus = () => status;
const mark = (key, detail) => { status[key] = { real: true, detail }; };

/** Every load failure, in order. The same array is returned as `ctx.loadErrors`, so later failures show up too.
 *  Entry: { ok: false, part, file, label, what, message, error }. app.js renders
 *  "Couldn't load <what>. <message>. Showing nothing rather than estimates." */
const loadErrors = [];
export const getLoadErrors = () => loadErrors;
function fail(part, file, label, e) {
  const error = String(e?.message ?? e);
  const what = `${label} (${file.split('/').pop()})`;
  const entry = { ok: false, part, file, label, what, message: /fetch|network|load/i.test(error) ? 'The request failed' : error, error };
  const i = loadErrors.findIndex(x => x.part === part);
  if (i >= 0) loadErrors[i] = entry; else loadErrors.push(entry);
  delete status[part];
  console.error(`[kimchi] Couldn't load ${what}: ${error}`);
  return entry;
}
function clearError(part) { const i = loadErrors.findIndex(x => x.part === part); if (i >= 0) loadErrors.splice(i, 1); }
/** One plain sentence for a failed part, e.g. "Couldn't load NASA history (site_history.json). Showing nothing rather than estimates." */
const sentence = e => `Couldn't load ${e.what}. Showing nothing rather than estimates.`;
const errorFor = (part, fallbackWhat) => sentence(loadErrors.find(x => x.part === part) ?? { what: fallbackWhat });

async function tryImport(part, path, label) {
  try { return await import(path); } catch (e) { fail(part, path.replace('../', ''), label, e); return null; }
}
async function fetchJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}
/** A real data file, or null plus a load error. Never a sample. */
async function loadJSON(part, url, label) {
  try { const d = await fetchJSON(url); clearError(part); mark(part, label); return d; }
  catch (e) { fail(part, url, label, e); return null; }
}

export async function loadAll() {
  const [libSources, libAnalysis, libRecommend, libReport, libFarm] = await Promise.all([
    tryImport('lib_sources', '../lib/sources.mjs', 'the NASA/USDA data fetchers'),
    tryImport('lib_analysis', '../lib/analysis.mjs', 'the analysis engine'),
    tryImport('lib_recommend', '../lib/recommend.mjs', 'the recommendation engine'),
    tryImport('lib_report', '../lib/report.mjs', 'the season report'),
    tryImport('farmStore', '../lib/farmStore.mjs', 'the farm-records store'),
  ]);
  if (libFarm) mark('farmStore', 'P1 farmStore.mjs');

  const [fields, grid, ndvi, crops, actions, sources, site] = await Promise.all([
    loadJSON('fields', 'data/demo_fields.geojson', 'the demo fields'),
    loadJSON('grid', 'data/region_grid.json', 'the NASA POWER region grid'),
    loadJSON('ndvi', 'data/fields_ndvi.json', 'MODIS NDVI'),
    loadJSON('crops', 'data/crops.json', 'the crop library'),
    loadJSON('actions', 'data/actions.json', 'the action library'),
    loadJSON('sources', 'data/sources.json', 'the source list'),
    loadJSON('history', 'data/site_history.json', 'NASA history'),
  ]);
  if (site) mark('history', 'NASA POWER daily history 1981 to now');

  // Without the field outlines or a place to keep farm records the app cannot draw anything: stop with a clear
  // message (app.js shows it as a full-page error) instead of rendering an empty or made-up screen.
  const fatal = (part, what) => new Error(`Couldn't load ${loadErrors.find(x => x.part === part)?.what ?? what}`);
  if (!fields?.features) throw fatal('fields', 'the demo fields (demo_fields.geojson)');
  if (!libFarm) throw fatal('farmStore', 'the farm-records store (farmStore.mjs)');

  return { libSources, libAnalysis, libRecommend, libReport, farmStore: libFarm, fields, grid, ndvi, crops, actions, sources, site,
    analysisFixture: null, recFixture: null, loadErrors };
}

/* ---------- engine worker (keeps the page responsive while P2's engine runs) ---------- */
// A small pool (up to 3 workers) so the 3-4 rotation fits for a field run in parallel.
let pool = [], workerReady = null, seq = 0;
const pending = new Map();
function call(op, args, w) {
  w ??= pool.reduce((a, b) => (b.busy < a.busy ? b : a));
  return new Promise((res, rej) => {
    const id = ++seq; w.busy++;
    pending.set(id, { res: v => { w.busy--; res(v); }, rej: e => { w.busy--; rej(e); } });
    w.worker.postMessage({ id, op, args });
  });
}
/** Start the workers when the real engine and history exist. Resolves true when they can take jobs. */
export function startEngineWorker(ctx) {
  if (!(ctx.libAnalysis?.analyzeField && ctx.site) || typeof Worker === 'undefined') return (workerReady = Promise.resolve(false));
  const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
  for (let i = 0; i < n; i++) {
    try {
      const worker = new Worker(new URL('./engine.worker.mjs', import.meta.url), { type: 'module' });
      const w = { worker, busy: 0 };
      worker.onmessage = ({ data }) => { const p = pending.get(data.id); if (!p) return; pending.delete(data.id); data.ok ? p.res(data.result) : p.rej(new Error(data.error)); };
      worker.onerror = e => { console.warn('Engine worker failed; running in the page instead.', e.message); pool = pool.filter(x => x !== w); };
      pool.push(w);
    } catch { /* no module workers: run in the page */ }
  }
  if (!pool.length) return (workerReady = Promise.resolve(false));
  workerReady = Promise.all(pool.map(w => call('init', { cropsData: ctx.crops }, w).then(r => !!r?.ok).catch(() => false)))
    .then(oks => { pool = pool.filter((w, i) => oks[i]); return pool.length > 0; });
  return workerReady;
}
const useWorker = async () => !!(workerReady && await workerReady && pool.length);
export const engineInWorker = useWorker;

/** Async analysis: in the worker when possible, else in the page (same result). */
export async function runAnalysisAsync(ctx, args) {
  if (await useWorker()) {
    const { field, farmField, liveDaily } = args, fid = field.properties.field_id;
    const today = lastDataDate(liveDaily) ?? lastDataDate(ctx.site.sites?.[0]?.daily);
    try {
      const t0 = performance.now();
      const a = await call('analyze', { liveDaily, ndvi: ctx.ndvi?.fields?.find(f => f.field_id === fid) ?? null, soil: field.properties.soil, farmField, today });
      clearError('analysis');
      mark('analysis', `P2 analyzeField in a background worker (${Math.round(performance.now() - t0)} ms)`);
      return a;
    } catch (e) { console.error(e); }
  }
  return runAnalysis(ctx, args);
}
export async function runRotationFitAsync(ctx, { rotation, field, farmField, farm }) {
  if (await useWorker()) {
    try { return await call('fit', { rotation, soil: field.properties.soil, farmField, farm }); } catch (e) { console.error(e); return null; }
  }
  return runRotationFit(ctx, { rotation, field, farmField, farm });
}

/** Last date whose max temperature and rain are both present. */
export function lastDataDate(daily) {
  if (!daily?.date) return null;
  for (let i = daily.date.length - 1; i >= 0; i--) if (daily.t2m_max?.[i] != null && daily.prectotcorr?.[i] != null) return daily.date[i];
  return null;
}

/** An analysis-shaped object with no values, for when the engine or NASA history is missing. Never sample numbers. */
function unavailableAnalysis(reason) {
  return { unavailable: true, error: reason, factors: {}, interactions: {}, rotation_fit: [],
    data_quality: { live_through: null, missing_days: null, notes: [reason] } };
}

/** Run P2's analyzeField if the engine and history exist; otherwise an empty result plus a load error. */
export function runAnalysis(ctx, { field, farmField, liveDaily }) {
  const fid = field.properties.field_id;
  const fieldNdvi = ctx.ndvi?.fields?.find(f => f.field_id === fid) ?? null;
  if (ctx.libAnalysis?.analyzeField && ctx.site) {
    const site = ctx.site.sites?.find(s => s.site_id === field.properties.site_id) ?? ctx.site.sites?.[0];
    try {
      const t0 = performance.now();
      // "Today" for the analysis is the last date with data. POWER lags about 3 days, and the newest
      // dates come back empty, so the calendar date would give every factor a null value.
      const today = lastDataDate(liveDaily) ?? lastDataDate(site.daily);
      const a = ctx.libAnalysis.analyzeField({ daily: site.daily, liveDaily, ndvi: fieldNdvi, soil: field.properties.soil, farmField, crops: ctx.crops, today, site });
      clearError('analysis');
      mark('analysis', `P2 analyzeField (${Math.round(performance.now() - t0)} ms)`);
      return a;
    } catch (e) { console.error(e); return unavailableAnalysis(sentence(fail('analysis', 'lib/analysis.mjs', 'the factor analysis', e))); }
  }
  const reason = !ctx.site ? errorFor('history', 'NASA history (site_history.json)')
    : errorFor('lib_analysis', 'the analysis engine (analysis.mjs)');
  return unavailableAnalysis(reason);
}

/** Rotation fit for any sequence. Returns null when P2's rotationFit is not available (never a made-up metric). */
export function runRotationFit(ctx, { rotation, field, farmField, farm }) {
  if (!(ctx.libAnalysis?.rotationFit && ctx.site)) return null;
  const site = ctx.site.sites?.find(s => s.site_id === field.properties.site_id) ?? ctx.site.sites?.[0];
  try { return ctx.libAnalysis.rotationFit({ rotation, crops: ctx.crops, daily: site.daily, soil: field.properties.soil, farmField, farm }); }
  catch (e) { console.error(e); return null; }
}

/** Run P4's recommend if available; otherwise no cards plus the reason. Never sample cards. */
export function runRecommend(ctx, { analysis, farm, field_id, field, focus, rotationsFit }) {
  const none = error => ({ top3: [], all: [], rotations: [], error });
  if (analysis?.unavailable) return none(analysis.error);
  if (ctx.libRecommend?.recommend && ctx.actions) {
    try {
      const r = ctx.libRecommend.recommend({ analysis, farm, field_id, field, crops: ctx.crops, actions: ctx.actions, rotationsFit, focus: focus || null, today: new Date() });
      clearError('recommend');
      mark('recommend', 'P4 recommend');
      return r;
    } catch (e) { console.error(e); return none(sentence(fail('recommend', 'lib/recommend.mjs', 'the recommendations', e))); }
  }
  return none(!ctx.actions ? errorFor('actions', 'the action library (actions.json)')
    : errorFor('lib_recommend', 'the recommendation engine (recommend.mjs)'));
}

/** Live POWER for this year at a point, through P1's fetchPowerDaily. Throws with the reason if it isn't loaded. */
export async function fetchLive(ctx, { lat, lon }) {
  const today = new Date(), start = `${today.getUTCFullYear()}0101`;
  const end = today.toISOString().slice(0, 10).replace(/-/g, '');
  if (!ctx.libSources?.fetchPowerDaily) throw new Error(errorFor('lib_sources', 'the live NASA POWER fetcher (sources.mjs)'));
  return ctx.libSources.fetchPowerDaily({ lat, lon, start, end });
}

export async function fetchSoil(ctx, geometry) {
  if (ctx.libSources?.fetchSoilForPolygon) return ctx.libSources.fetchSoilForPolygon(geometry);
  return null;
}

/** P4's buildReport, or a plain fallback built from the same inputs. */
export async function buildReport(ctx, args) {
  if (ctx.libReport?.buildReport) return ctx.libReport.buildReport(args);
  const { buildReport } = await import('./report.mjs');
  return buildReport(args);
}

/* ---------- new fields: pull their own NASA/USDA data (round 4) ---------- */
// A field the farmer draws or types gets the same inputs as the demo fields: NASA POWER daily 1981 -> today at
// the field centroid (~1.8 s, ~2.2 MB) and USDA SSURGO soil for the polygon, in parallel. The result has the
// same shape as site_history.sites[0], so P2's analyzeField runs on it unchanged. Nothing is invented: a part
// that fails is null and listed in `errors` (shown as the round-3 red cards).

export const NDVI_NEW_FIELD_REASON = 'Crop greenness for new fields needs a server-side download (next step). ORNL answers browser calls, but a 2001-to-now NDVI history is about 1,200 requests per field.';
const FIELD_CACHE_PREFIX = 'kimchi.fielddata.';
const memCache = new Map();

function trimTrailing(daily) {
  const keys = Object.keys(daily).filter(k => k !== 'date');
  let n = daily.date.length;
  while (n > 0 && keys.every(k => daily[k][n - 1] === null)) n--;
  const out = {};
  for (const k of Object.keys(daily)) out[k] = daily[k].slice(0, n);
  return out;
}

// IndexedDB first (no 5 MB localStorage limit), then localStorage, then memory only.
function idb() {
  return new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') return rej(new Error('no IndexedDB'));
    const r = indexedDB.open('kimchi', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('fielddata');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function cachePut(key, value) {
  try {
    const db = await idb();
    await new Promise((res, rej) => { const tx = db.transaction('fielddata', 'readwrite'); tx.objectStore('fielddata').put(value, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    return 'indexeddb';
  } catch { /* fall through */ }
  try { localStorage.setItem(key, JSON.stringify(value)); return 'localstorage'; } catch { /* quota or blocked */ }
  return null;
}
async function cacheGet(key) {
  try {
    const db = await idb();
    const v = await new Promise((res, rej) => { const r = db.transaction('fielddata').objectStore('fielddata').get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    if (v) return v;
  } catch { /* fall through */ }
  try { const s = localStorage.getItem(key); if (s) return JSON.parse(s); } catch { /* ignore */ }
  return null;
}

/** The last pulled data for a field (memory, then IndexedDB, then localStorage), or null. Use it on reload, then refresh. */
export async function loadCachedFieldData(field_id) {
  const key = FIELD_CACHE_PREFIX + field_id;
  if (memCache.has(key)) return memCache.get(key);
  const v = await cacheGet(key);
  if (v) memCache.set(key, v);
  return v;
}

/**
 * Pull NASA POWER 1981 -> today and USDA soil for a farmer's field.
 * @param {object} geometry GeoJSON Polygon/MultiPolygon (or Feature)
 * @param {{field_id?: string, today?: Date, force?: boolean}} [opts]
 * @returns {Promise<{field_id, site, soil, ndvi: null, ndvi_reason, retrieved_at, cached, cache, errors: Array}>}
 */
export async function pullFieldData(geometry, { field_id = null, today = new Date(), force = false } = {}) {
  // Cache first (reload is instant); `force: true` (the Refresh button) always pulls again.
  if (field_id && !force) { const c = await loadCachedFieldData(field_id); if (c?.site) return { ...c, from_cache: true }; }
  const errors = [];
  const lib = await import('../lib/sources.mjs').catch(e => { errors.push({ ok: false, part: 'lib_sources', file: 'lib/sources.mjs', what: 'the NASA/USDA data fetchers (sources.mjs)', message: 'The request failed', error: String(e?.message ?? e) }); return null; });
  const retrieved_at = new Date().toISOString();
  if (!lib) return { field_id, site: null, soil: null, ndvi: null, ndvi_reason: NDVI_NEW_FIELD_REASON, retrieved_at, cached: false, cache: null, errors };

  const { lat, lon } = lib.polygonCenter(geometry);
  const end = today.toISOString().slice(0, 10).replace(/-/g, '');
  const [power, soil] = await Promise.allSettled([
    lib.fetchPowerDaily({ lat: +lat.toFixed(5), lon: +lon.toFixed(5), start: '19810101', end, timeoutMs: 90000 }),
    lib.fetchSoilForPolygon(geometry),
  ]);

  let site = null;
  if (power.status === 'fulfilled') {
    const p = power.value, daily = trimTrailing(p.daily);
    const last_valid = {};
    for (const k of Object.keys(daily)) if (k !== 'date') last_valid[k] = lib.lastValidDate(daily, k);
    site = { site_id: p.site_id, lat: p.lat, lon: p.lon, field_ids: field_id ? [field_id] : [],
      start: daily.date[0] ?? null, end: daily.date[daily.date.length - 1] ?? null, elevation_m: p.elevation_m,
      last_valid, units: p.units, api_version: p.api_version, power_sources: p.sources,
      retrieved_at: p.retrieved_at, request_url: p.request_url, source_ids: p.source_ids, daily };
  } else {
    errors.push({ ok: false, part: 'field_power', file: 'NASA POWER API', what: 'NASA POWER history for this field', message: 'The request failed', error: String(power.reason?.message ?? power.reason) });
  }
  let soilOut = null;
  if (soil.status === 'fulfilled' && soil.value) soilOut = soil.value;
  else errors.push({ ok: false, part: 'field_soil', file: 'USDA Soil Data Access', what: 'USDA soil data for this field', message: soil.status === 'rejected' ? 'The request failed' : 'No soil map units returned', error: String(soil.reason?.message ?? soil.reason ?? 'empty result') });

  const out = { field_id, site, soil: soilOut, ndvi: null, ndvi_reason: NDVI_NEW_FIELD_REASON, retrieved_at, cached: false, cache: null, errors };
  if (field_id && site) {
    const key = FIELD_CACHE_PREFIX + field_id;
    memCache.set(key, out);
    const where = await cachePut(key, { ...out, cached: true });
    out.cached = !!where; out.cache = where;
  }
  return out;
}
