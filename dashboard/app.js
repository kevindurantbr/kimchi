// Kimchi dashboard orchestrator (P3). State, data loading and wiring between the map, panels and dialogs.
import { $, esc, FACTORS, factorName, finite, num, fmtDate, centroid, ramp, rampCSS, sevClass, cssVar } from './ui/util.mjs';
import { loadAll, dataStatus, runAnalysis, runRecommend, runRotationFit, fetchLive, fetchSoil } from './ui/integrate.mjs';
import { createMap } from './ui/map.mjs';
import { createSlider } from './ui/slider.mjs';
import { renderCards, renderDetail } from './ui/panels.mjs';
import { renderActions, renderRotations, renderWhatIf } from './ui/recs.mjs';

const state = { field: 'fld01', factor: 'water', view: 'field', focus: '', gridMode: 'percentile', live: null, liveError: null, analysis: null, rec: null };
let ctx, farm, map, slider;

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
  await selectField(state.field, { fit: true });
  updateSampleChip();
  loadLive();
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
  recompute();
  if (fit || state.view === 'field') map.fitTo(fieldById(id));
  if (fieldById(id).properties.user) loadUserFieldData(id);
}

/* ---------- compute + render ---------- */
function recompute() {
  const field = fieldById(state.field), ff = farmField(state.field);
  state.analysis = runAnalysis(ctx, { field, farmField: ff, liveDaily: state.live?.daily ?? null });
  let rotationsFit = state.analysis.rotation_fit?.length ? state.analysis.rotation_fit : null;
  // With the real engine: evaluate the rotations P4 asks for (current + candidates) with P2's rotationFit.
  if (!rotationsFit && !state.analysis.sample && ctx.libRecommend?.rotationsToEvaluate) {
    const list = ctx.libRecommend.rotationsToEvaluate({ farm, field_id: state.field, field, actions: ctx.actions });
    const fits = list.map(rotation => runRotationFit(ctx, { rotation, field, farmField: ff, farm })).filter(Boolean);
    if (fits.length) rotationsFit = fits;
  }
  state.rotationsFit = rotationsFit;
  state.rec = runRecommend(ctx, { analysis: state.analysis, farm, field_id: state.field, field, focus: state.focus, rotationsFit });
  render();
}

function render() {
  const a = state.analysis;
  $('left-meta').textContent = a.sample ? 'SAMPLE · FLD01' : (state.field.toUpperCase());
  renderCards($('cards'), a, state.factor, f => setFactor(f));
  renderDetail($('detail'), state.factor, a, ctx);
  renderActions($('actions'), state.rec, { focus: state.focus });
  renderRotations($('rotations'), state.rec?.rotations ?? a.rotation_fit);
  renderWhatIf($('whatif'), { crops: ctx.crops, allocation: farm?.constraints?.annual_allocation_mm, onRun: (rotation, alloc) => {
    const f = farm ? structuredClone(farm) : null; if (f) f.constraints = { ...(f.constraints ?? {}), annual_allocation_mm: alloc };
    return runRotationFit(ctx, { rotation, field: fieldById(state.field), farmField: farmField(state.field), farm: f });
  } });
  drawMapLayers();
  updateSampleChip();
}

function setFactor(f) {
  state.factor = f;
  document.querySelectorAll('.tabs [role="tab"]').forEach(t => t.setAttribute('aria-selected', String(t.dataset.factor === f)));
  render();
}

/* ---------- map layers + time slider ---------- */
const REGION_IND = { water: ['season_deficit_mm', 'drywet', false], temperature: ['hot_days_35c', 'heat', false], soil_moisture: ['gwetroot_jul', 'drywet', false] };

function drawMapLayers() {
  const a = state.analysis;
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
    $('map-note').textContent = `MODIS 250 m pixels, 16-day composite starting ${fmtDate(nd.dates[i])}. Greenness, not cause.${ctx.ndvi.fixture ? ' SAMPLE pixel values.' : ''}`;
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
    if (!state.analysis?.sample) recompute();
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
  dlg.addEventListener('close', async () => {
    if (dlg.returnValue !== 'ok' || !input.value.trim()) return;
    if (!farm) farm = { schema: 'kimchi.farm.1', farm_name: 'My farm', synthetic: false, priorities: { water: .4, soil: .3, income: .3 }, constraints: {}, fields: [] };
    // P1's store returns a new farm (immutable); the temporary stand-in returns the field. Handle both.
    const before = new Set(farm.fields.map(f => f.field_id));
    const res = ctx.farmStore.addField(farm, { name: input.value.trim(), geometry });
    if (res?.fields) farm = res;
    const ff = farm.fields.find(f => !before.has(f.field_id)) ?? res;
    ctx.farmStore.saveFarm(farm);
    ctx.fields.features.push({ type: 'Feature', geometry, properties: { field_id: ff.field_id, label: ff.name, label_short: ff.name.slice(0, 18).toUpperCase(), area_ha: ff.area_ha, boundary_status: 'drawn by farmer', soil: null, user: true } });
    fillFieldSelect();
    selectField(ff.field_id, { fit: true });
  }, { once: true });
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
  $('btn-draw').addEventListener('click', () => { if (state.view !== 'field') document.querySelector('[data-view="field"]').click(); map.startDraw(); showBanner('Click on the map to place the corners of your field. Click the first point to finish. Press Escape to cancel.'); });
  $('btn-records').addEventListener('click', async () => { const m = await import('./ui/farmForm.mjs'); m.openRecords({ ctx, getFarm: () => farm, setFarm: f => { farm = f; ctx.farmStore.saveFarm(farm); mergeUserFields(); fillFieldSelect(); recompute(); }, fieldId: state.field, analysis: state.analysis }); });
  $('btn-report').addEventListener('click', async () => { const m = await import('./ui/report.mjs'); m.openReport({ ctx, analysis: state.analysis, rec: state.rec, farm, field: fieldById(state.field), farmField: farmField(state.field) }); });
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
