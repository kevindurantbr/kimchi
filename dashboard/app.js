// Kimchi dashboard orchestrator (P3). State, data loading and wiring between the map, panels and dialogs.
import { $, esc, FACTORS, factorName, finite, num, fmtDate, centroid, ramp, rampCSS, sevClass, cssVar } from './ui/util.mjs';
import { loadAll, dataStatus, runRecommend, fetchLive, fetchSoil, lastDataDate, startEngineWorker, runAnalysisAsync, runRotationFitAsync, engineInWorker } from './ui/integrate.mjs';
import { createMap } from './ui/map.mjs';
import { createSlider } from './ui/slider.mjs';
import { renderCards, renderDetail } from './ui/panels.mjs';
import { renderActions, renderRotations, renderWhatIf } from './ui/recs.mjs';
import * as integ from './ui/integrate.mjs'; // namespace import: P1's pullFieldData may not exist yet
import { badgesOf, worstLevel, LEVEL_COLOR } from './ui/status.mjs';

const state = { field: 'fld01', factor: 'water', view: 'field', focus: '', gridMode: 'percentile', live: null, liveError: null, analysis: null, rec: null };
let ctx, farm, map, slider;
// Fields the farmer adds: pulled NASA POWER history (1981 to now) + soil, per field id. analyses: resolved results, for map badges.
const fieldData = new Map(), analyses = new Map();

// Speed: the analysis engine takes 0.5-2 s per field and rotationFit 0.2-1.2 s per rotation on 45 years of
// daily data. It runs in a background worker (ui/engine.worker.mjs) so the map and controls stay responsive,
// and results (promises) are cached per field, farm version and live-data version, so switching tabs,
// fields back and forth, focus chips or the theme does not recompute them.
let farmVersion = 0, liveVersion = 0, computeToken = 0;
const cache = { analysis: new Map(), fit: new Map() };
// Yield so the browser can paint. requestAnimationFrame never fires in a hidden tab (link opened in the
// background), so a timer resolves it too; otherwise the app would wait until the tab is shown.
const nextPaint = () => new Promise(r => { let done = false; const go = () => { if (!done) { done = true; setTimeout(r, 0); } }; requestAnimationFrame(go); setTimeout(go, 60); });
const analysisKey = id => `${id}|${farmVersion}|${liveVersion}`;
function cachedAnalysis(field, ff) {
  const id = field.properties.field_id, fd = fieldData.get(id);
  const key = analysisKey(id) + (fd ? `|${fd.retrieved_at}` : '');
  if (!cache.analysis.has(key)) {
    const p = fd?.site ? analyzePulled(field, ff, fd) : runAnalysisAsync(ctx, { field, farmField: ff, liveDaily: state.live?.daily ?? null });
    cache.analysis.set(key, p.then(a => { if (a && !a.sample) { analyses.set(id, a); drawBadges(); } return a; }));
  }
  return cache.analysis.get(key);
}
function cachedFit(rotation, field, ff, f) {
  const id = field.properties.field_id, fd = fieldData.get(id);
  const key = `${id}|${farmVersion}|${liveVersion}|${fd?.retrieved_at ?? ''}|${rotation.id}|${(rotation.sequence ?? []).join('>')}|${f?.constraints?.annual_allocation_mm}`;
  if (!cache.fit.has(key)) cache.fit.set(key, fd?.site ? fitPulled(rotation, ff, f, fd) : runRotationFitAsync(ctx, { rotation, field, farmField: ff, farm: f }));
  return cache.fit.get(key);
}
/** P2's engine on a pulled site (a field the farmer added). Runs in the page after a paint, about 0.6 s. */
async function analyzePulled(field, ff, fd) {
  await nextPaint();
  return ctx.libAnalysis.analyzeField({ daily: fd.site.daily, site: fd.site, ndvi: fd.ndvi ?? null, soil: fd.soil ?? field.properties.soil ?? null,
    farmField: ff, crops: ctx.crops, today: lastDataDate(fd.site.daily) ?? undefined });
}
async function fitPulled(rotation, ff, f, fd) {
  await nextPaint();
  try { return ctx.libAnalysis.rotationFit({ rotation, crops: ctx.crops, daily: { ...fd.site.daily, lat: fd.site.lat }, soil: fd.soil, farmField: ff, farm: f }); }
  catch (e) { console.error(e); return null; }
}
function showComputing(what) {
  $('cards').innerHTML = `<p class="state" role="status">${esc(what)}</p>`;
  $('detail').innerHTML = '';
  $('actions').innerHTML = '<p class="state">Scoring actions…</p>';
  $('rotations').innerHTML = '<p class="state">Comparing rotations over the same weather years…</p>';
  $('whatif').innerHTML = '';
}

/* ---------- boot ---------- */
async function boot() {
  tickClock(); setInterval(tickClock, 30000);
  wireLevel();
  if (typeof L === 'undefined') { fatal("The map library couldn't load. Check your connection and reload."); return; }
  wireChrome();
  try { ctx = await loadAll(); }
  catch (e) { console.error(e); fatal(`Couldn't load the dashboard data (${e.message}). Showing nothing rather than estimates.`); return; }

  farm = ctx.farmStore.loadFarm() ?? await ctx.farmStore.loadDemoFarm().then(f => (ctx.farmStore.saveFarm(f), f)).catch(() => null);
  mergeUserFields();

  map = createMap($('map'), {
    onCursor: ll => { $('cursor-readout').textContent = ll ? `LAT ${ll.lat.toFixed(5)}  LON ${ll.lng.toFixed(5)}` : 'LAT --.-----  LON ---.-----'; },
    onFieldClick: id => selectField(id),
    onDrawn: geometry => nameAndAddField(geometry),
  });
  slider = createSlider({ onChange: i => drawTime(i) });

  fillFieldSelect();
  // Paint the map and field outlines first, so imagery loads while the engine starts in its worker.
  map.setFields(features(), state.field, () => ({ fillColor: '#000', fillOpacity: 0.05 }));
  map.fitTo(fieldById(state.field));
  startEngineWorker(ctx);
  await nextPaint();
  loadLive();
  await selectField(state.field, { fit: false });
  updateSampleChip();
  await prewarm();
  drawBadges();
}

/** After the first field is ready, compute the other demo fields in the background workers, so switching
 *  fields during the demo is instant. Only with workers: in the page thread this would freeze the UI. */
async function prewarm() {
  if (!(await engineInWorker())) return;
  for (const f of features()) {
    const id = f.properties.field_id;
    if (id === state.field || f.properties.user) continue;
    const ff = farmField(id);
    await cachedAnalysis(f, ff).catch(() => null);
    if (ctx.libRecommend?.rotationsToEvaluate) {
      const list = ctx.libRecommend.rotationsToEvaluate({ farm, field_id: id, field: f, actions: ctx.actions });
      await Promise.all(list.map(r => cachedFit(r, f, ff, farm))).catch(() => null);
    }
  }
}

function tickClock() {
  const d = new Date();
  $('utc-clock').textContent = `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

function fatal(msg) {
  const card = `<div class="errcard" role="alert"><b>Error.</b> ${esc(msg)} <button type="button" class="btn" data-retry>Retry</button></div>`;
  $('cards').innerHTML = card; $('actions').innerHTML = card; $('rotations').innerHTML = '';
  document.querySelectorAll('[data-retry]').forEach(b => b.addEventListener('click', () => location.reload()));
  const chip = $('live-chip'); if (/CHECKING|FETCHING/.test(chip.textContent)) { chip.className = 'chip down'; chip.textContent = 'NOT STARTED'; }
}

/** Data files that failed to load, as red cards in the panel they affect (QA review section 3). */
function loadErrorCards() {
  const list = [...(ctx?.loadErrors ?? []).map(e => (typeof e === 'string' ? { what: e } : e)), ...(fieldData.get(state.field)?.errors ?? [])];
  const st = dataStatus();
  if (!fieldById(state.field)?.properties.user && ctx?.libAnalysis?.analyzeField && st.history && !st.history.real) list.push({ what: 'NASA history (site_history.json)' });
  if (st.actions && !st.actions.real) list.push({ what: 'the action library (actions.json)' });
  if (!list.length) return '';
  return list.map(e => `<div class="errcard" role="alert"><b>Couldn't load ${esc(e.what ?? e.file ?? 'a data file')}.</b> ${esc(e.message ? e.message + '. ' : '')}Showing nothing rather than estimates. <button type="button" class="btn" data-retry>Retry</button></div>`).join('');
}

/* ---------- detail level: Simple / Moderate / Complete (PLAN.md section 11) ---------- */
function setLevel(n) {
  document.body.classList.remove('level-1', 'level-2', 'level-3');
  document.body.classList.add(`level-${n}`);
  document.querySelectorAll('[data-level]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.level === String(n))));
  try { localStorage.setItem('kimchi.level', String(n)); } catch {}
  // Simple hides the factor tabs and Region view; go back to field view so the map matches the tiles.
  if (n === 1 && state.view === 'region') document.querySelector('[data-view="field"]')?.click();
  setTimeout(() => map?.invalidate(), 50);
}
function wireLevel() {
  const cur = (document.body.className.match(/level-([123])/) ?? [])[1] ?? '1';
  setLevel(+cur);
  document.querySelectorAll('[data-level]').forEach(b => b.addEventListener('click', () => setLevel(+b.dataset.level)));
}
let reported = false;
const reportError = msg => { if (reported) return; reported = true; showBanner(`Something went wrong: ${msg}. Reload the page; your farm records are kept in this browser.`); $('banner').classList.add('err'); };
window.addEventListener('error', e => { if (e.message && !/ResizeObserver/.test(e.message)) reportError(e.message); });
window.addEventListener('unhandledrejection', e => reportError(String(e.reason?.message ?? e.reason ?? 'unknown error')));

/* ---------- fields ---------- */
const features = () => ctx.fields.features;
const fieldById = id => features().find(f => f.properties.field_id === id);
const farmField = id => farm?.fields?.find(f => f.field_id === id) ?? null;

function mergeUserFields() {
  // Fields the farmer drew live only in their farm record; add them to the map list.
  for (const f of farm?.fields ?? []) {
    if (fieldById(f.field_id) || !f.geometry) continue;
    ctx.fields.features.push({ type: 'Feature', geometry: f.geometry, properties: { field_id: f.field_id, label: f.name, label_short: f.name.slice(0, 18).toUpperCase(), area_ha: f.area_ha, boundary_status: 'drawn by farmer', soil: f.soil ?? null, user: true } });
  }
}

function fillFieldSelect() {
  $('field-select').innerHTML = features().map(f => {
    const p = f.properties, ff = farmField(p.field_id);
    const name = ff?.name ? `${ff.name} (${p.field_id.toUpperCase()})` : p.field_id.toUpperCase();
    return `<option value="${esc(p.field_id)}">${esc(name)}${p.user ? ' · drawn' : ''}</option>`;
  }).join('');
  $('field-select').value = state.field;
}

async function selectField(id, { fit = false } = {}) {
  if (!fieldById(id)) return;
  state.field = id; $('field-select').value = id;
  updateRefreshUI();
  if (/: pulled NASA POWER /.test($('banner').textContent) && !fieldById(id).properties.user) showBanner('');
  if (fit || state.view === 'field') map.fitTo(fieldById(id));
  if (fieldById(id).properties.user && !fieldData.has(id)) {
    showComputing(`Pulling 45 years of NASA weather and USDA soil for ${fieldById(id).properties.label}… (about 2 s)`);
    await pullField(id);
    if (state.field !== id) return;
    if (fit || state.view === 'field') map.fitTo(fieldById(id));
  }
  return recompute();
}

/* ---------- compute + render ---------- */
async function recompute() {
  const token = ++computeToken, fid = state.field;
  const field = fieldById(fid), ff = farmField(fid);
  if (!cache.analysis.has(analysisKey(fid))) showComputing(`Computing ${fid.toUpperCase()} from 45 years of NASA POWER data…`);
  if (field.properties.user && !fieldData.get(fid)?.site) {
    state.analysis = null;
    $('cards').innerHTML = loadErrorCards() || '<p class="state">No weather history could be pulled for this field, so nothing is shown rather than estimates.</p>';
    $('cards').querySelectorAll('[data-retry]').forEach(b => b.addEventListener('click', () => refreshField()));
    $('detail').innerHTML = ''; $('actions').innerHTML = '<p class="state">Actions need the field analysis.</p>'; $('rotations').innerHTML = ''; $('whatif').innerHTML = '';
    return;
  }
  const analysis = await cachedAnalysis(field, ff);
  if (token !== computeToken) return; // the user picked another field meanwhile
  state.analysis = analysis;
  renderFactor();                     // factor cards first; rotations follow
  let rotationsFit = analysis.rotation_fit?.length ? analysis.rotation_fit : null;
  // With the real engine: evaluate the rotations P4 asks for (current + candidates) with P2's rotationFit.
  if (!rotationsFit && !analysis.sample && ctx.libRecommend?.rotationsToEvaluate) {
    const list = ctx.libRecommend.rotationsToEvaluate({ farm, field_id: fid, field, actions: ctx.actions });
    const fits = (await Promise.all(list.map(rotation => cachedFit(rotation, field, ff, farm)))).filter(Boolean);
    if (token !== computeToken) return;
    if (fits.length) rotationsFit = fits;
  }
  state.rotationsFit = rotationsFit;
  state.rec = runRecommend(ctx, { analysis, farm, field_id: fid, field, focus: state.focus, rotationsFit });
  render();
  // The what-if panel runs its own rotationFit; draw it after the main panels have painted.
  nextPaint().then(() => { if (token === computeToken) renderWhatIfPanel(); });
}

/** Left panel and map only (what changes with the factor tab). */
function renderFactor() {
  const a = state.analysis;
  if (!a) { drawMapLayers(); return; } // still computing
  $('left-meta').textContent = a.sample ? 'SAMPLE · FLD01' : (state.field.toUpperCase());
  renderCards($('cards'), a, state.factor, f => setFactor(f));
  const errs = loadErrorCards();
  if (errs) { $('cards').insertAdjacentHTML('afterbegin', errs); $('cards').querySelectorAll('[data-retry]').forEach(b => b.addEventListener('click', () => location.reload())); }
  renderDetail($('detail'), state.factor, a, ctx);
  drawMapLayers();
}

function render() {
  renderFactor();
  if (!state.analysis) return;
  renderActions($('actions'), state.rec, { focus: state.focus });
  renderRotations($('rotations'), state.rec?.rotations ?? state.analysis.rotation_fit);
  updateSampleChip();
}

function renderWhatIfPanel() {
  renderWhatIf($('whatif'), { crops: ctx.crops, allocation: farm?.constraints?.annual_allocation_mm, onRun: (rotation, alloc) => {
    const f = farm ? structuredClone(farm) : null; if (f) f.constraints = { ...(f.constraints ?? {}), annual_allocation_mm: alloc };
    return cachedFit(rotation, fieldById(state.field), farmField(state.field), f);
  } });
}

function setFactor(f) {
  state.factor = f;
  document.querySelectorAll('.tabs [role="tab"]').forEach(t => t.setAttribute('aria-selected', String(t.dataset.factor === f)));
  renderFactor();
}

/* ---------- map layers + time slider ---------- */
const REGION_IND = { water: ['season_deficit_mm', 'drywet', false], temperature: ['hot_days_35c', 'heat', false], soil_moisture: ['gwetroot_jul', 'drywet', false] };

function drawMapLayers() {
  const a = state.analysis ?? { factors: {} };
  const outline = f => { const a2 = analyses.get(f.properties.field_id); if (!a2 || state.view === 'region') return {}; const w = worstLevel(badgesOf(a2)); return w === 'nodata' ? {} : { color: LEVEL_COLOR[w] }; };
  const fieldColour = f => ({ ...fieldFill(f), ...outline(f) });
  const fieldFill = f => {
    if (state.view === 'region' || state.factor === 'crop_condition') return { fillOpacity: 0.05, fillColor: '#000' };
    // Weather factors: colour by severity of this field's status. Same regional cell for all demo fields.
    const st = (f.properties.field_id === state.field || a.sample) ? a.factors?.[state.factor]?.status : null;
    const c = st ? sevClass(st.severity) : null;
    return { fillColor: c == null ? '#000' : [cssVar('--sev0'), cssVar('--watch'), cssVar('--alert')][c], fillOpacity: c == null ? 0.05 : 0.38 };
  };
  map.setFields(features(), state.field, fieldColour);
  drawBadges();

  if (state.view === 'region') {
    map.setNdvi(null);
    const ind = REGION_IND[state.factor];
    if (!ind) {
      map.setGrid(null);
      $('map-title').textContent = 'REGION VIEW · CROP CONDITION';
      $('map-note').textContent = 'Crop condition is a field-scale satellite measure; it is not available in region view. Switch to Field view.';
      $('legend').innerHTML = ''; slider.setDomain([]); return;
    }
    const years = ctx.grid.years.map(String);
    slider.setDomain(years, years.length - 1);
  } else {
    map.setGrid(null);
    if (state.factor === 'crop_condition') {
      const nd = ctx.ndvi?.fields?.find(f => f.field_id === state.field);
      if (nd) slider.setDomain(nd.dates, nd.dates.length - 1);
      else { map.setNdvi(null); slider.setDomain([]); $('map-note').textContent = 'Crop condition (NDVI) is unavailable for this field.'; $('legend').innerHTML = ''; }
      $('map-title').textContent = `FIELD VIEW · ${state.field.toUpperCase()} · MODIS NDVI`;
    } else {
      map.setNdvi(null);
      $('map-title').textContent = `FIELD VIEW · ${state.field.toUpperCase()} · ${factorName(state.factor).toUpperCase()}`;
      $('map-note').textContent = 'Weather data covers about 50 km; this colour is regional, not a field measurement. Dashed outline: approximate boundary.';
      const ann = annualFor(state.factor);
      if (ann) {
        // P2's analysis.annual: one frame per year, same crop calendar as this season.
        slider.setDomain(ann.years.map(String), ann.years.length - 1);
        return;
      }
      slider.setDomain([]);
      $('legend').innerHTML = `<div class="ttl">Field colour = severity</div><div class="ends" style="margin-top:6px;gap:8px;justify-content:flex-start"><span style="color:var(--sev0)">■ normal</span><span style="color:var(--watch)">■ watch</span><span style="color:var(--alert)">■ high</span></div>`;
      noHistoryHint();
    }
  }
}

/* ---------- field-view history (analysis.annual) ---------- */
const ANNUAL = { water: ['water_deficit_mm', 'drywet', true, 'Shortfall vs crop demand', 'mm'], temperature: ['hot_days', 'heat', false, 'Hot days in season', 'days'], soil_moisture: ['gwetroot_jul', 'drywet', false, 'July root-zone wetness', '0–1'] };
function annualFor(factor) {
  const a = state.analysis?.annual, spec = ANNUAL[factor];
  if (!a?.years?.length || !spec || !Array.isArray(a[spec[0]]) || !a[spec[0]].some(finite)) return null;
  return { ...a, values: a[spec[0]], spec };
}
/** The slider must never look dead without a reason: offer the views that can play history. */
function noHistoryHint() {
  const cap = $('sl-caption');
  cap.innerHTML = `<button type="button" id="hint-region">No year-by-year history for this field yet. Press <b>Region view</b> or <b>Crop condition</b> to play history.</button>`;
  $('hint-region').addEventListener('click', () => { if (state.factor === 'crop_condition' || !REGION_IND[state.factor]) setFactor('crop_condition'); else document.querySelector('[data-view="region"]').click(); });
}
function drawAnnual(i) {
  const ann = annualFor(state.factor); if (!ann) return;
  const [key, rampName, highIsDry, title, unit] = ann.spec, v = ann.values[i];
  const base = ann.years.map((y, k) => (y >= 1991 && y <= 2020 ? ann.values[k] : null)).filter(finite);
  const p = finite(v) && base.length >= 10 ? (base.filter(x => x <= v).length / (base.length + 1)) : null;
  const t = p == null ? null : rampName === 'heat' ? p : highIsDry ? 1 - p : p;
  const col = t == null ? null : ramp(rampName, t);
  map.setFields(features(), state.field, f => { const a2 = analyses.get(f.properties.field_id), w = a2 ? worstLevel(badgesOf(a2)) : 'nodata';
    return { ...(f.properties.field_id === state.field && col ? { fillColor: col, fillOpacity: 0.55 } : { fillColor: '#000', fillOpacity: 0.05 }), ...(w === 'nodata' ? {} : { color: LEVEL_COLOR[w] }) }; });
  $('sl-caption').innerHTML = `<span>${esc(ann.caption?.[i] ?? `${ann.years[i]}: ${finite(v) ? `${num(v, key === 'gwetroot_jul' ? 2 : 0)} ${unit}` : 'unavailable'}`)}</span>`;
  $('map-title').textContent = `FIELD VIEW · ${state.field.toUpperCase()} · ${factorName(state.factor).toUpperCase()} · ${ann.years[i]}`;
  $('legend').innerHTML = `<div class="ttl">${esc(title)}, ${ann.years[i]} vs 1991–2020</div><div class="ramp" style="background:${rampCSS(rampName)}"></div>
    <div class="ends"><span>${rampName === 'heat' ? 'fewer' : 'drier'}</span><span>${rampName === 'heat' ? 'more hot days →' : '→ wetter'}</span></div>
    <div class="fine" data-min-level="2" style="margin-top:4px">${finite(v) ? `${num(v, key === 'gwetroot_jul' ? 2 : 0)} ${esc(unit)}${p == null ? '' : ` · p${Math.round(p * 100)}`}` : 'unavailable'}</div>`;
}

function drawTime(i) {
  if (!(state.view === 'field' && annualFor(state.factor) && state.factor !== 'crop_condition')) $('sl-caption').innerHTML = '';
  if (state.view === 'field' && state.factor !== 'crop_condition') { drawAnnual(i); return; }
  if (state.view === 'region') {
    const [key, rampName] = REGION_IND[state.factor] ?? [];
    if (!key) return;
    const g = ctx.grid, meta = g.indicators[key], yi = i;
    const baseIdx = g.years.map((y, k) => (y >= 1991 && y <= 2020 ? k : -1)).filter(k => k >= 0);
    const pctOf = (cell, v) => { const s = baseIdx.map(k => cell.values[key]?.[k]).filter(finite); if (!finite(v) || s.length < 10) return null; return (s.filter(x => x <= v).length / (s.length + 1)) * 100; };
    const allVals = g.cells.flatMap(c => c.values[key] ?? []).filter(finite), lo = Math.min(...allVals), hi = Math.max(...allVals);
    const higherIsWet = key !== 'hot_days_35c'; // for drywet ramps: high value = wetter = blue end
    const colorFor = c => {
      const v = c.values[key]?.[yi];
      const t = state.gridMode === 'percentile' ? (pctOf(c, v) ?? NaN) / 100 : (v - lo) / (hi - lo || 1);
      return finite(t) ? ramp(rampName, higherIsWet || rampName === 'heat' ? t : 1 - t) : null;
    };
    map.setGrid(g.cells, colorFor, c => { const v = c.values[key]?.[yi], p = pctOf(c, v);
      return `${esc(meta.label)}<br><b>${g.years[yi]}</b>: ${finite(v) ? `${num(v, key === 'gwetroot_jul' ? 2 : 0)} ${esc(meta.unit)}` : 'unavailable'}<br>${p == null ? 'percentile unavailable' : `p${Math.round(p)} vs 1991–2020 in this cell`}`; });
    $('map-title').textContent = `REGION VIEW · ${esc(meta.label).toUpperCase()} · ${g.years[yi]}`;
    $('map-note').textContent = `NASA POWER cells (~50 km). Colour: ${state.gridMode === 'percentile' ? 'percentile vs 1991–2020 for each cell' : 'raw value'}.${ctx.grid.fixture ? ' SAMPLE grid values.' : ''}`;
    $('legend').innerHTML = `<div class="ttl">${esc(meta.label)}</div><div class="ramp" style="background:${rampCSS(rampName)}"></div>
      <div class="ends"><span>${state.gridMode === 'percentile' ? 'p0' : num(lo, 0)}</span><span>${rampName === 'heat' ? 'hotter →' : 'drier ← → wetter'}</span><span>${state.gridMode === 'percentile' ? 'p100' : num(hi, 0)}</span></div>
      <div class="seg" role="group" aria-label="Grid colouring" style="margin-top:6px;pointer-events:auto"><button type="button" data-gm="percentile" aria-pressed="${state.gridMode === 'percentile'}">Percentile</button><button type="button" data-gm="raw" aria-pressed="${state.gridMode === 'raw'}">Raw</button></div>`;
    $('legend').querySelectorAll('[data-gm]').forEach(b => b.addEventListener('click', () => { state.gridMode = b.dataset.gm; drawTime(slider.index()); }));
  } else if (state.factor === 'crop_condition') {
    const nd = ctx.ndvi?.fields?.find(f => f.field_id === state.field); if (!nd) return;
    map.setNdvi(nd, i, v => (finite(v) ? ramp('ndvi', (v + 0.1) / 1.0) : null));
    // The source copy has missing composites (for example Jun 26 to Nov 17, 2025). Say so; never fill them.
    const gapDays = i > 0 ? (Date.parse(nd.dates[i]) - Date.parse(nd.dates[i - 1])) / 864e5 : 0;
    const gap = gapDays > 20 ? ` Composites between ${fmtDate(nd.dates[i - 1])} and ${fmtDate(nd.dates[i])} are missing from the source; not filled.` : '';
    $('map-note').textContent = `MODIS 250 m pixels, 16-day composite starting ${fmtDate(nd.dates[i])}. Greenness, not cause.${gap}${ctx.ndvi.fixture ? ' SAMPLE pixel values.' : ''}`;
    $('legend').innerHTML = `<div class="ttl">NDVI (greenness)</div><div class="ramp" style="background:${rampCSS('ndvi')}"></div><div class="ends"><span>-0.1 bare</span><span>0.9 dense green</span></div>`;
  }
}

/* ---------- live data ---------- */
async function loadLive() {
  const chip = $('live-chip');
  const f = fieldById(state.field), [lon, lat] = centroid(f.geometry);
  chip.className = 'chip'; chip.textContent = 'LIVE POWER · FETCHING';
  try {
    state.live = await fetchLive(ctx, { lat, lon });
    const d = state.live.daily, last = lastNonNull(d.date, d.t2m_max);
    chip.className = 'chip live'; chip.textContent = `LIVE NASA POWER THROUGH ${last ? fmtDate(last).toUpperCase() : 'UNKNOWN'} (~3-DAY DELAY)`;
    // Recompute only when the live feed adds days the precomputed history does not have.
    const histLast = lastDataDate(ctx.site?.sites?.[0]?.daily), liveLast = lastDataDate(d);
    if (!state.analysis?.sample && liveLast && (!histLast || liveLast > histLast)) { liveVersion++; recompute(); }
  } catch (e) {
    state.liveError = e.message; chip.className = 'chip down'; chip.textContent = 'LIVE POWER UNAVAILABLE';
    const through = state.analysis?.data_quality?.live_through;
    showBanner(`Live data unavailable, showing data through ${through ? fmtDate(through) : 'the last precomputed date'}. (${e.message})`);
  }
}
const lastNonNull = (dates, vals) => { for (let i = dates.length - 1; i >= 0; i--) if (vals[i] != null) return dates[i]; return null; };
function showBanner(msg) { const b = $('banner'); b.textContent = msg; b.hidden = !msg; requestAnimationFrame(() => map?.invalidate()); }

/* ---------- draw a field ---------- */
function nameAndAddField(geometry) {
  const dlg = $('dlg-name'), input = $('name-input');
  showBanner('');
  input.value = ''; dlg.returnValue = '';
  dlg.showModal(); input.focus();
  dlg.addEventListener('close', () => {
    if (dlg.returnValue === 'ok' && input.value.trim()) saveNewField(input.value.trim(), geometry);
  }, { once: true });
}

/** Store a farmer-entered field (drawn or typed) and select it. */
function saveNewField(name, geometry) {
  if (!farm) farm = { schema: 'kimchi.farm.1', farm_name: 'My farm', synthetic: false, priorities: { water: .4, soil: .3, income: .3 }, constraints: {}, fields: [] };
  // P1's store returns a new farm (immutable); the temporary stand-in returns the field. Handle both.
  const before = new Set(farm.fields.map(f => f.field_id));
  const res = ctx.farmStore.addField(farm, { name, geometry });
  if (res?.fields) farm = res;
  const ff = farm.fields.find(f => !before.has(f.field_id)) ?? res;
  farmVersion++;
  ctx.farmStore.saveFarm(farm);
  ctx.fields.features.push({ type: 'Feature', geometry, properties: { field_id: ff.field_id, label: ff.name, label_short: ff.name.slice(0, 18).toUpperCase(), area_ha: ff.area_ha, boundary_status: 'drawn by farmer', soil: null, user: true } });
  fillFieldSelect();
  selectField(ff.field_id, { fit: true });
}

/** Keyboard path: corners as "lat, lon" lines, or a GeoJSON Polygon / Feature. Returns a closed Polygon or throws. */
export function parseCorners(text) {
  const t = text.trim();
  if (!t) throw new Error('Enter at least 3 corners.');
  let ring;
  if (t.startsWith('{')) {
    let g; try { g = JSON.parse(t); } catch { throw new Error('That looks like JSON but could not be read.'); }
    g = g.type === 'FeatureCollection' ? g.features?.[0]?.geometry : g.type === 'Feature' ? g.geometry : g;
    if (g?.type !== 'Polygon' || !Array.isArray(g.coordinates?.[0])) throw new Error('GeoJSON must be a Polygon (or a Feature with a Polygon).');
    ring = g.coordinates[0].map(([lon, lat]) => [Number(lon), Number(lat)]);
  } else {
    ring = t.split(/[\n;]+/).map(s => s.trim()).filter(Boolean).map((line, i) => {
      const n = line.split(/[\s,]+/).filter(Boolean).map(Number);
      if (n.length !== 2 || n.some(v => !Number.isFinite(v))) throw new Error(`Line ${i + 1}: write "latitude, longitude", for example 39.3990, -100.6810.`);
      return [n[1], n[0]];
    });
  }
  for (const [lon, lat] of ring) if (lat < -90 || lat > 90 || lon < -180 || lon > 180) throw new Error(`Out of range: ${lat}, ${lon}. Latitude comes first.`);
  const first = ring[0], last = ring.at(-1);
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
  if (ring.length < 4) throw new Error('A field needs at least 3 different corners.');
  return { type: 'Polygon', coordinates: [ring] };
}

function openCoordsDialog() {
  map.stopDraw(); showBanner('');
  const dlg = $('dlg-coords'), form = $('coords-form'), msg = $('coords-msg');
  form.reset(); msg.textContent = ''; msg.className = 'fine';
  dlg.showModal(); $('coords-name').focus();
  form.onsubmit = e => {
    e.preventDefault();
    const name = $('coords-name').value.trim();
    if (!name) { msg.textContent = 'Enter a field name.'; msg.className = 'state err'; $('coords-name').focus(); return; }
    try {
      const geometry = parseCorners($('coords-input').value);
      dlg.close(); saveNewField(name, geometry);
    } catch (err) { msg.textContent = err.message; msg.className = 'state err'; $('coords-input').focus(); }
  };
}

/* ---------- fields the farmer adds: pull their own data ---------- */
/** P1's pullFieldData when it exists (with its cache); otherwise the same pull here, kept in memory. */
async function pullLocal(geometry) {
  const end = new Date().toISOString().slice(0, 10).replace(/-/g, ''), [lon, lat] = centroid(geometry), errors = [];
  if (!ctx.libSources?.fetchPowerDaily) return { site: null, soil: null, ndvi: null, retrieved_at: new Date().toISOString(), errors: [{ what: 'NASA POWER history', message: 'the data module is missing' }] };
  const [p, s] = await Promise.allSettled([ctx.libSources.fetchPowerDaily({ lat, lon, start: '19810101', end }), fetchSoil(ctx, geometry)]);
  if (p.status === 'rejected') errors.push({ what: 'NASA POWER history for this field', message: p.reason?.message });
  if (s.status === 'rejected' || !s.value) errors.push({ what: 'USDA soil for this field', message: s.reason?.message ?? 'no soil map unit found' });
  return { site: p.value ?? null, soil: s.value ?? null, ndvi: null, retrieved_at: new Date().toISOString(), errors };
}
async function pullField(id, { force = false } = {}) {
  const f = fieldById(id);
  let fd;
  try { fd = integ.pullFieldData ? await integ.pullFieldData(f.geometry, { field_id: id, force }) : await pullLocal(f.geometry); }
  catch (e) { fd = { site: null, soil: null, errors: [{ what: 'data for this field', message: e.message }], retrieved_at: new Date().toISOString() }; }
  fd.errors = (fd.errors ?? []).map(e => (typeof e === 'string' ? { what: e } : e));
  if (fd.soil) f.properties.soil = fd.soil;
  fieldData.set(id, fd);
  updateRefreshUI();
  const name = f.properties.label;
  if (fd.site) showBanner(`${name}: pulled NASA POWER ${fmtDate(fd.site.daily.date[0])} to ${fmtDate(lastDataDate(fd.site.daily))}${fd.soil ? ' and USDA soil' : ''}. Crop greenness for new fields needs a server-side download (next step).`);
  return fd;
}
function updateRefreshUI() {
  const user = !!fieldById(state.field)?.properties.user, fd = fieldData.get(state.field);
  $('btn-refresh').hidden = !user;
  $('pulled-at').hidden = !user || !fd;
  if (fd?.retrieved_at) { const d = new Date(fd.retrieved_at); $('pulled-at').textContent = `Data pulled ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}`; }
}

async function refreshField() {
  const id = state.field; if (!fieldById(id)?.properties.user) return;
  $('btn-refresh').disabled = true;
  showComputing(`Pulling 45 years of NASA weather and USDA soil for ${fieldById(id).properties.label}… (about 2 s)`);
  try { await pullField(id, { force: true }); } finally { $('btn-refresh').disabled = false; }
  if (state.field === id) recompute();
}

/* ---------- map status badges (one icon per factor at watch or concern) ---------- */
function drawBadges() {
  if (!map) return;
  const show = state.view === 'field';
  const rows = show ? features().map(f => ({ feature: f, items: analyses.has(f.properties.field_id) ? badgesOf(analyses.get(f.properties.field_id)).filter(b => b.level === 'watch' || b.level === 'concern') : [] })) : [];
  map.setBadges(rows);
  $('badge-legend').hidden = !rows.some(r => r.items.length);
}

/* ---------- sample/data status ---------- */
function updateSampleChip() {
  const st = dataStatus(), sample = Object.entries(st).filter(([, v]) => !v.real);
  const chip = $('sample-chip');
  chip.hidden = !sample.length;
  chip.textContent = `SAMPLE DATA · ${sample.length} OF ${Object.keys(st).length} SOURCES`;
  $('sample-body').innerHTML = `<p class="fine">Parts marked sample use synthetic placeholder values in the agreed data shapes. They switch to real data automatically when each teammate's file is pushed.</p>
    <table class="rtable"><thead><tr><th>Part</th><th>Status</th><th>Detail</th></tr></thead><tbody>${Object.entries(st).map(([k, v]) => `<tr><td>${esc(k)}</td><td><span class="sev ${v.real ? 'sev-0' : 'sev-1'}">${v.real ? 'real' : 'sample'}</span></td><td style="white-space:normal">${esc(v.detail)}</td></tr>`).join('')}</tbody></table>`;
}

/* ---------- chrome wiring ---------- */
function wireChrome() {
  $('field-select').addEventListener('change', e => selectField(e.target.value, { fit: true }));
  document.querySelectorAll('.tabs [role="tab"]').forEach(t => {
    t.addEventListener('click', () => setFactor(t.dataset.factor));
    t.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const tabs = [...document.querySelectorAll('.tabs [role="tab"]')], i = tabs.indexOf(t) + (e.key === 'ArrowRight' ? 1 : -1);
      const n = tabs[(i + tabs.length) % tabs.length]; n.focus(); setFactor(n.dataset.factor);
    });
  });
  document.querySelectorAll('.seg [data-view]').forEach(b => b.addEventListener('click', () => {
    state.view = b.dataset.view;
    document.querySelectorAll('.seg [data-view]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    if (state.view === 'region') map.fitTo(null, [[ctx.grid.bbox[1], ctx.grid.bbox[0]], [ctx.grid.bbox[3], ctx.grid.bbox[2]]]); else map.fitTo(fieldById(state.field));
    drawMapLayers();
  }));
  document.querySelectorAll('.chips [data-focus]').forEach(b => b.addEventListener('click', () => {
    state.focus = b.dataset.focus;
    document.querySelectorAll('.chips [data-focus]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    if (!state.analysis) return; // still computing; the focus is applied when results arrive
    state.rec = runRecommend(ctx, { analysis: state.analysis, farm, field_id: state.field, field: fieldById(state.field), focus: state.focus, rotationsFit: state.rotationsFit });
    renderActions($('actions'), state.rec, { focus: state.focus });
  }));
  const togglePanel = (btn, cls) => { const on = document.body.classList.toggle(cls); $(btn).setAttribute('aria-pressed', String(!on)); setTimeout(() => map.invalidate(), 50); };
  $('btn-left').addEventListener('click', () => togglePanel('btn-left', 'hide-left'));
  $('btn-right').addEventListener('click', () => togglePanel('btn-right', 'hide-right'));
  $('btn-theme').addEventListener('click', () => {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t; try { localStorage.setItem('kimchi.theme', t); } catch {}
    render();
  });
  $('btn-draw').addEventListener('click', () => {
    if (state.view !== 'field') document.querySelector('[data-view="field"]').click();
    map.startDraw();
    showBanner('Click on the map to place the corners of your field. Click the first point to finish. Press Escape to cancel.');
    // Keyboard path (drawing needs a pointer): type the corners instead.
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', id: 'btn-coords', textContent: 'Enter coordinates instead' });
    b.addEventListener('click', openCoordsDialog);
    $('banner').append(b); b.focus();
  });
  $('btn-records').addEventListener('click', async () => { const m = await import('./ui/farmForm.mjs'); m.openRecords({ ctx, getFarm: () => farm, setFarm: f => { farm = f; farmVersion++; ctx.farmStore.saveFarm(farm); mergeUserFields(); fillFieldSelect(); recompute(); }, fieldId: state.field, analysis: state.analysis }); });
  $('btn-report').addEventListener('click', async () => { if (!state.analysis || !state.rec) { showBanner('The season report is ready as soon as the field analysis finishes computing.'); return; } const m = await import('./ui/report.mjs'); m.openReport({ ctx, analysis: state.analysis, rec: state.rec, farm, field: fieldById(state.field), farmField: farmField(state.field) }); });
  $('btn-print').addEventListener('click', () => window.print());
  $('btn-refresh').addEventListener('click', () => refreshField());
  $('sample-chip').addEventListener('click', () => $('dlg-sample').showModal());
  document.querySelectorAll('.dlg-close').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));
  document.querySelectorAll('.sheet-tabs [data-sheet]').forEach(b => b.addEventListener('click', () => {
    document.body.dataset.sheet = b.dataset.sheet;
    document.querySelectorAll('.sheet-tabs [data-sheet]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    setTimeout(() => map?.invalidate(), 50);
  }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('banner').textContent.startsWith('Click on the map')) showBanner(''); });
  window.addEventListener('resize', () => map?.invalidate());
}

boot();
