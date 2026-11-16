// Kimchi dashboard orchestrator (P3). State, data loading and wiring between the map, panels and dialogs.
import { $, esc, FACTORS, factorName, finite, num, fmtDate, centroid, ramp, rampCSS, sevClass, cssVar } from './ui/util.mjs';
import { loadAll, dataStatus, runRecommend, fetchLive, fetchSoil, lastDataDate, startEngineWorker, runAnalysisAsync, runRotationFitAsync, engineInWorker } from './ui/integrate.mjs';
import { createMap } from './ui/map.mjs';
import { createSlider } from './ui/slider.mjs';
import { renderCards, renderDetail } from './ui/panels.mjs';
import { renderActions, renderRotations, renderWhatIf } from './ui/recs.mjs';

const state = { field: 'fld01', factor: 'water', view: 'field', focus: '', gridMode: 'percentile', live: null, liveError: null, analysis: null, rec: null };
let ctx, farm, map, slider;

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
  const key = analysisKey(field.properties.field_id);
  if (!cache.analysis.has(key)) cache.analysis.set(key, runAnalysisAsync(ctx, { field, farmField: ff, liveDaily: state.live?.daily ?? null }));
  return cache.analysis.get(key);
}
function cachedFit(rotation, field, ff, f) {
  const key = `${field.properties.field_id}|${farmVersion}|${liveVersion}|${rotation.id}|${(rotation.sequence ?? []).join('>')}|${f?.constraints?.annual_allocation_mm}`;
  if (!cache.fit.has(key)) cache.fit.set(key, runRotationFitAsync(ctx, { rotation, field, farmField: ff, farm: f }));
  return cache.fit.get(key);
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
  wireChrome();
  try { ctx = await loadAll(); }
  catch (e) { console.error(e); fatal(`Could not load the dashboard data: ${e.message}. Reload the page; if this keeps happening, the data files are missing from the deployment.`); return; }

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
  prewarm();
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
  $('cards').innerHTML = `<p class="state err">${esc(msg)}</p>`;
  $('actions').innerHTML = $('rotations').innerHTML = '';
}

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
  const done = recompute();
  if (fit || state.view === 'field') map.fitTo(fieldById(id));
  if (fieldById(id).properties.user) loadUserFieldData(id);
  return done;
}

/* ---------- compute + render ---------- */
async function recompute() {
  const token = ++computeToken, fid = state.field;
  const field = fieldById(fid), ff = farmField(fid);
  if (!cache.analysis.has(analysisKey(fid))) showComputing(`Computing ${fid.toUpperCase()} from 45 years of NASA POWER data…`);
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
  const fieldColour = f => {
    if (state.view === 'region' || state.factor === 'crop_condition') return { fillOpacity: 0.05, fillColor: '#000' };
    // Weather factors: colour by severity of this field's status. Same regional cell for all demo fields.
    const st = (f.properties.field_id === state.field || a.sample) ? a.factors?.[state.factor]?.status : null;
    const c = st ? sevClass(st.severity) : null;
    return { fillColor: c == null ? '#000' : [cssVar('--sev0'), cssVar('--acc'), cssVar('--alert')][c], fillOpacity: c == null ? 0.05 : 0.38 };
  };
  map.setFields(features(), state.field, fieldColour);

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
      slider.setDomain([]);
      $('map-title').textContent = `FIELD VIEW · ${state.field.toUpperCase()} · ${factorName(state.factor).toUpperCase()}`;
      $('map-note').textContent = 'Weather data covers about 50 km; this colour is regional, not a field measurement. Dashed outline: approximate boundary.';
      $('legend').innerHTML = `<div class="ttl">Field colour = severity</div><div class="ends" style="margin-top:6px;gap:8px;justify-content:flex-start"><span style="color:var(--sev0)">■ normal</span><span style="color:var(--acc)">■ watch</span><span style="color:var(--alert)">■ high</span></div>`;
    }
  }
}

function drawTime(i) {
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

async function loadUserFieldData(id) {
  const f = fieldById(id), [lon, lat] = centroid(f.geometry);
  showBanner('Pulling NASA POWER and USDA soil data for your field…');
  try {
    const [live, soil] = await Promise.all([fetchLive(ctx, { lat, lon }), fetchSoil(ctx, f.geometry).catch(() => null)]);
    f.properties.soil = soil ?? f.properties.soil;
    const last = lastNonNull(live.daily.date, live.daily.t2m_max);
    showBanner(`${f.properties.label}: live NASA POWER through ${fmtDate(last)} loaded${soil ? ', USDA soil loaded' : ', soil data not available yet'}.${ctx.libAnalysis?.analyzeField ? '' : ' Factor analysis for drawn fields needs the analysis engine (not connected yet); panels show the sample.'} Crop condition is unavailable for new fields tonight.`);
  } catch (e) { showBanner(`Could not load live data for this field: ${e.message}`); }
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
