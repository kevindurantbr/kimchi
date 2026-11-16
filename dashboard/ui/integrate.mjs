// Integration layer: loads the P1/P2/P4 modules and data files. There is NO sample fallback on the live site:
// when a real file or module fails to load, that part gets no data and an entry in `ctx.loadErrors`
// ({ ok: false, part, file, label, message, error }), so the UI can show an error card instead of numbers.
// `status` still records what loaded, for the data-status table. Nothing here invents values.
// (The app no longer imports ui/_fixtures/.)

const status = {};           // key -> { real: bool, detail, error?: true }
export const dataStatus = () => status;
const mark = (key, real, detail, error = false) => { status[key] = error ? { real, detail, error: true } : { real, detail }; };

/** Every load failure, in order. The same array is returned as `ctx.loadErrors`, so later failures show up too. */
const loadErrors = [];
export const getLoadErrors = () => loadErrors;
function fail(part, file, label, e) {
  const error = String(e?.message ?? e);
  const message = `Couldn't load ${label} (${file.split('/').pop()}). Showing nothing rather than estimates.`;
  const entry = { ok: false, part, file, label, message, error };
  const i = loadErrors.findIndex(x => x.part === part);
  if (i >= 0) loadErrors[i] = entry; else loadErrors.push(entry);
  mark(part, false, message, true);
  console.error(`[kimchi] ${message}`, error);
  return entry;
}
function clearError(part) { const i = loadErrors.findIndex(x => x.part === part); if (i >= 0) loadErrors.splice(i, 1); }
const errorFor = (part, fallback) => loadErrors.find(x => x.part === part)?.message ?? fallback;

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
  try { const d = await fetchJSON(url); clearError(part); mark(part, true, label); return d; }
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
  if (libFarm) mark('farmStore', true, 'P1 farmStore.mjs');

  const [fields, grid, ndvi, crops, actions, sources, site] = await Promise.all([
    loadJSON('fields', 'data/demo_fields.geojson', 'the demo fields'),
    loadJSON('grid', 'data/region_grid.json', 'the NASA POWER region grid'),
    loadJSON('ndvi', 'data/fields_ndvi.json', 'MODIS NDVI'),
    loadJSON('crops', 'data/crops.json', 'the crop library'),
    loadJSON('actions', 'data/actions.json', 'the action library'),
    loadJSON('sources', 'data/sources.json', 'the source list'),
    loadJSON('history', 'data/site_history.json', 'NASA history'),
  ]);
  if (site) mark('history', true, 'NASA POWER daily history 1981 to now');

  // Without the field outlines or a place to keep farm records the app cannot draw anything: stop with a clear
  // message (app.js shows it as a full-page error) instead of rendering an empty or made-up screen.
  const fatal = (part, fallback) => new Error(errorFor(part, fallback).replace(/\. Showing nothing rather than estimates\.$/, ''));
  if (!fields?.features) throw fatal('fields', "Couldn't load the demo fields (demo_fields.geojson)");
  if (!libFarm) throw fatal('farmStore', "Couldn't load the farm-records store (farmStore.mjs)");

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
      mark('analysis', true, `P2 analyzeField in a background worker (${Math.round(performance.now() - t0)} ms)`);
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
      mark('analysis', true, `P2 analyzeField (${Math.round(performance.now() - t0)} ms)`);
      return a;
    } catch (e) { console.error(e); return unavailableAnalysis(fail('analysis', 'lib/analysis.mjs', 'the factor analysis', e).message); }
  }
  const reason = !ctx.site ? errorFor('history', "Couldn't load NASA history (site_history.json). Showing nothing rather than estimates.")
    : errorFor('lib_analysis', "Couldn't load the analysis engine (analysis.mjs). Showing nothing rather than estimates.");
  mark('analysis', false, reason, true);
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
  if (analysis?.unavailable) { mark('recommend', false, `No recommendations: ${analysis.error}`, true); return none(analysis.error); }
  if (ctx.libRecommend?.recommend && ctx.actions) {
    try {
      const r = ctx.libRecommend.recommend({ analysis, farm, field_id, field, crops: ctx.crops, actions: ctx.actions, rotationsFit, focus: focus || null, today: new Date() });
      clearError('recommend');
      mark('recommend', true, 'P4 recommend');
      return r;
    } catch (e) { console.error(e); return none(fail('recommend', 'lib/recommend.mjs', 'the recommendations', e).message); }
  }
  const reason = !ctx.actions ? errorFor('actions', "Couldn't load the action library (actions.json). Showing nothing rather than estimates.")
    : errorFor('lib_recommend', "Couldn't load the recommendation engine (recommend.mjs). Showing nothing rather than estimates.");
  mark('recommend', false, reason, true);
  return none(reason);
}

/** Live POWER for this year at a point, through P1's fetchPowerDaily. Throws with the reason if it isn't loaded. */
export async function fetchLive(ctx, { lat, lon }) {
  const today = new Date(), start = `${today.getUTCFullYear()}0101`;
  const end = today.toISOString().slice(0, 10).replace(/-/g, '');
  if (!ctx.libSources?.fetchPowerDaily) throw new Error(errorFor('lib_sources', "Couldn't load the live NASA POWER fetcher (sources.mjs)."));
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
