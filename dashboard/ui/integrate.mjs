// Integration layer: loads P1/P2/P4 modules and data files when they exist in dashboard/lib and dashboard/data,
// and falls back to the SAMPLE fixtures in ui/_fixtures until they land. Every fallback is recorded in `status`
// so the UI can say exactly what is sample data. Nothing here invents values.

const status = {};           // key -> { real: bool, detail }
export const dataStatus = () => status;
const mark = (key, real, detail) => { status[key] = { real, detail }; };

async function tryImport(path) {
  try { return await import(path); } catch (e) {
    if (!/Failed to fetch|Importing a module script failed|404|error loading/i.test(String(e))) console.warn('Module failed to load', path, e);
    return null;
  }
}
async function fetchJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}
async function jsonWithFallback(key, real, sample, label) {
  try { const d = await fetchJSON(real); mark(key, !d?.fixture, d?.fixture ? `${label}: fixture file` : label); return d; }
  catch { const d = await fetchJSON(sample); mark(key, false, `${label}: sample (ui/_fixtures)`); return d; }
}

export async function loadAll() {
  const [libSources, libAnalysis, libRecommend, libReport, libFarm] = await Promise.all([
    tryImport('../lib/sources.mjs'), tryImport('../lib/analysis.mjs'), tryImport('../lib/recommend.mjs'),
    tryImport('../lib/report.mjs'), tryImport('../lib/farmStore.mjs'),
  ]);
  const farmStore = libFarm ?? await import('./_fixtures/farmStore.mjs');
  mark('farmStore', !!libFarm, libFarm ? 'P1 farmStore.mjs' : 'Temporary P3 store (same API) until P1 lands');

  const [fields, grid, ndvi, crops, actions, sources] = await Promise.all([
    jsonWithFallback('fields', 'data/demo_fields.geojson', 'ui/_fixtures/demo_fields.geojson', 'Demo fields'),
    jsonWithFallback('grid', 'data/region_grid.json', 'ui/_fixtures/region_grid.json', 'Region grid'),
    jsonWithFallback('ndvi', 'data/fields_ndvi.json', 'ui/_fixtures/fields_ndvi.json', 'MODIS NDVI pixels'),
    jsonWithFallback('crops', 'data/crops.json', 'ui/_fixtures/crops.json', 'Crop library'),
    fetchJSON('data/actions.json').then(d => (mark('actions', true, 'Action library'), d)).catch(() => (mark('actions', false, 'Action library not pushed yet'), null)),
    jsonWithFallback('sources', 'data/sources.json', 'ui/_fixtures/sources.json', 'Source list'),
  ]);
  // Fields from the research package carry "approximate" and the CDL history; keep that status visible.
  if (status.fields && !status.fields.real && fields?.note?.includes('research/deliverables')) {
    status.fields.detail = 'Demo fields: real outlines, soils and crop history copied from research/deliverables (P1 copy pending)';
    status.fields.real = true;
  }

  let site = null;
  if (libAnalysis?.analyzeField) {
    try { site = await fetchJSON('data/site_history.json'); mark('history', true, 'NASA POWER daily history 1981 to now'); }
    catch { mark('history', false, 'site_history.json not pushed yet'); }
  } else mark('history', false, libAnalysis ? 'Not loaded: waiting for P2 analyzeField' : 'Not loaded: waiting for P2 analysis engine');

  // Sample fallbacks are fetched only when the real engine cannot run (saves two requests on the live site).
  const needAnalysisFixture = !(libAnalysis?.analyzeField && site);
  const needRecFixture = !(libRecommend?.recommend && actions) || needAnalysisFixture;
  const [analysisFixture, recFixture] = await Promise.all([
    needAnalysisFixture ? fetchJSON('lib/fixtures/analysis_sample.json').catch(() => fetchJSON('ui/_fixtures/analysis_sample.json')) : null,
    needRecFixture ? fetchJSON('ui/_fixtures/recommend_sample.json') : null,
  ]);

  return { libSources, libAnalysis, libRecommend, libReport, farmStore, fields, grid, ndvi, crops, actions, sources, site, analysisFixture, recFixture };
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

/** Run P2's analyzeField if the engine and history exist; otherwise return the fixture, flagged. */
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
      mark('analysis', true, `P2 analyzeField (${Math.round(performance.now() - t0)} ms)`);
      return a;
    } catch (e) { console.error(e); mark('analysis', false, `analyzeField failed: ${e.message}. Showing sample.`); }
  } else {
    const which = ctx.analysisFixture?.generated_from ? 'P2 fixture' : 'P3 sample';
    mark('analysis', false, !ctx.libAnalysis ? `P2 engine not pushed yet: ${which} (fld01, synthetic numbers)`
      : !ctx.libAnalysis.analyzeField ? `P2 engine has no analyzeField yet: ${which} (fld01, synthetic numbers)`
      : `Engine ready, NASA POWER history file missing: ${which}`);
  }
  return { ...ctx.analysisFixture, sample: true };
}

/** Rotation fit for any sequence. Returns null when P2's rotationFit is not available (never a made-up metric). */
export function runRotationFit(ctx, { rotation, field, farmField, farm }) {
  if (!(ctx.libAnalysis?.rotationFit && ctx.site)) return null;
  const site = ctx.site.sites?.find(s => s.site_id === field.properties.site_id) ?? ctx.site.sites?.[0];
  try { return ctx.libAnalysis.rotationFit({ rotation, crops: ctx.crops, daily: site.daily, soil: field.properties.soil, farmField, farm }); }
  catch (e) { console.error(e); return null; }
}

/** Run P4's recommend if available; else the sample, flagged. */
export function runRecommend(ctx, { analysis, farm, field_id, field, focus, rotationsFit }) {
  if (ctx.libRecommend?.recommend && ctx.actions) {
    try {
      const r = ctx.libRecommend.recommend({ analysis, farm, field_id, field, crops: ctx.crops, actions: ctx.actions, rotationsFit, focus: focus || null, today: new Date() });
      mark('recommend', !analysis.sample, analysis.sample ? 'P4 recommend, run on SAMPLE analysis: cards follow the real rules but cite sample values' : 'P4 recommend');
      return analysis.sample ? { ...r, sample: true } : r;
    } catch (e) { console.error(e); mark('recommend', false, `recommend failed: ${e.message}. Showing sample.`); }
  } else mark('recommend', false, ctx.libRecommend ? 'Action library missing: sample cards' : 'P4 recommend not pushed yet: sample cards');
  const s = ctx.recFixture;
  if (!s) return { top3: [], all: [], rotations: [], error: status.recommend?.detail };
  if (!focus) return { ...s, sample: true };
  const f = s.all.filter(c => c.factor === focus);
  return { ...s, sample: true, top3: f.length ? f.slice(0, 3) : [], focusEmpty: !f.length };
}

/** Live POWER for this year at a point. P1's fetchPowerDaily if present, else a direct call (same endpoint). */
export async function fetchLive(ctx, { lat, lon }) {
  const today = new Date(), start = `${today.getUTCFullYear()}0101`;
  const end = today.toISOString().slice(0, 10).replace(/-/g, '');
  if (ctx.libSources?.fetchPowerDaily) return ctx.libSources.fetchPowerDaily({ lat, lon, start, end });
  const { fetchPowerDaily } = await import('./_fixtures/power.mjs');
  return fetchPowerDaily({ lat, lon, start, end });
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
