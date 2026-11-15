// Left panel: the four factor cards and the charts for the selected factor (PLAN.md section 5 and the P3 brief, step 3).
import { FACTORS, esc, finite, num, pct, sevClass, sevText, fmtDate, safeURL, download, cssVar, ramp } from './util.mjs';
import { makeChart, bandChart, destroyCharts, theme, hexA } from './charts.mjs';

const ICONS = { // drawn for this app: drop, thermometer, soil layers, leaf
  water: '<path d="M9 2C9 2 4 8 4 11.2A5 5 0 0 0 14 11.2C14 8 9 2 9 2Z"/>',
  temperature: '<path d="M7.5 3a1.5 1.5 0 0 1 3 0v7.6a3.5 3.5 0 1 1-3 0Z"/><path d="M9 7v6"/>',
  soil_moisture: '<path d="M2 6h14M2 10h14M2 14h14"/><path d="M5 6v8M11 10v4"/>',
  crop_condition: '<path d="M9 16V8"/><path d="M9 9C9 5 12 3 15 3C15 6 13 9 9 9Z"/><path d="M9 11C9 8 6 6 3 6C3 9 5 11 9 11Z"/>',
};
const icon = id => `<svg class="ficon" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${ICONS[id]}</svg>`;

export function renderCards(el, analysis, selected, onSelect) {
  el.innerHTML = FACTORS.map(f => {
    const st = analysis?.factors?.[f.id]?.status;
    const rec = analysis?.factors?.[f.id]?.recurrence;
    const has = st && finite(st.value);
    const sc = sevClass(st?.severity);
    const p = finite(st?.percentile) ? Math.max(0, Math.min(100, st.percentile)) : null;
    return `<button type="button" class="fcard bracket ${selected === f.id ? 'on' : ''}" data-factor="${f.id}" aria-pressed="${selected === f.id}">
      <div class="fcard-top">${icon(f.id)}<h3>${esc(f.name)}</h3><span class="code">${f.code}</span></div>
      ${has ? `<div class="val">${esc(num(st.value, Math.abs(st.value) < 10 && st.unit !== 'days' ? 2 : 0))}<small>${esc(st.unit ?? '')}</small></div>
        <div class="label">${esc(st.label ?? '')}</div>
        <div class="pbar" role="img" aria-label="Percentile ${p == null ? 'unavailable' : Math.round(p)} versus 1991 to 2020; ${esc(sevText(st.severity))}">
          <span class="b90"></span><span class="b75"></span><span class="med"></span>${p == null ? '' : `<span class="dot" style="left:${p}%;background:${sc === 2 ? 'var(--alert)' : sc === 1 ? 'var(--acc)' : 'var(--sev0)'}"></span>`}
        </div>
        <div class="pbar-scale"><span>p0</span><span>p25</span><span>p50 normal</span><span>p75</span><span>p100</span></div>
        <div class="rec"><span class="sev sev-${sc}">${esc(sevText(st.severity))}</span> ${esc(pct(st.percentile))} · ${rec?.text ? `Since 1991: ${esc(rec.text)}` : 'recurrence unavailable'}</div>`
      : `<div class="unavail">Status unavailable for this field</div>`}
    </button>`;
  }).join('');
  el.querySelectorAll('.fcard').forEach(b => b.addEventListener('click', () => onSelect(b.dataset.factor)));
}

/* ---------- factor detail ---------- */
export function renderDetail(el, factorId, analysis, ctx) {
  destroyCharts('ch-');
  const f = analysis?.factors?.[factorId];
  if (!f) { el.innerHTML = '<p class="state">No analysis available for this factor.</p>'; return; }
  const parts = [];
  const sec = (code, title, body) => `<section class="dsec"><h3><span class="code">${code}</span>${title}</h3>${body}</section>`;

  if (factorId === 'water') {
    parts.push(sec('W-1', 'Supply vs demand this season', `<div class="chartbox tall"><canvas id="ch-supply" role="img" aria-label="Cumulative rain plus irrigation versus crop demand"></canvas></div>
      <p class="cap">Crop demand is estimated ET₀ × Kc, not metered pumping or OpenET.</p>`));
    parts.push(sec('W-2', 'Root-zone bucket', f.bucket ? `<div class="chartbox"><canvas id="ch-bucket" role="img" aria-label="Root-zone depletion with the stress threshold"></canvas></div>
      <p class="cap">Stress days: <span class="num">${num(f.bucket.stress_days)}</span>${f.bucket.first_stress_date ? ` · first on ${esc(fmtDate(f.bucket.first_stress_date))}` : ''}. ${esc(f.bucket.note ?? f.bucket.method ?? '')}</p>` : '<div class="unavail">Bucket unavailable</div>'));
    const cap = f.capacity ?? analysis.interactions?.capacity;
    parts.push(sec('W-3', 'Well capacity vs peak demand', cap ? gauge(cap) : '<div class="unavail">Add well capacity (gpm) in My farm records to compare.</div>'));
  }
  if (factorId === 'temperature') {
    parts.push(sec('T-1', 'Growing degree days vs normal', f.series?.gdd_cum ? `<div class="chartbox"><canvas id="ch-gdd" role="img" aria-label="Cumulative growing degree days versus normal"></canvas></div>
      <p class="cap">GDD base 10 °C, cap 30 °C. ${f.gdd ? `To date <span class="num">${num(f.gdd.to_date)}</span> °C·day (normal ${num(f.gdd.normal_p50)}); stage: ${esc(f.gdd.stage_now ?? 'unavailable')}.` : ''}</p>`
      : '<div class="unavail">GDD series unavailable</div>'));
    const sh = f.stage_heat ?? analysis.interactions?.stage_heat;
    parts.push(sec('T-2', 'Heat during the sensitive window', sh ? heatStrip(sh) : '<div class="unavail">Stage-aligned heat unavailable</div>'));
    parts.push(sec('T-3', 'Frost dates', f.frost ? frost(f.frost) : '<div class="unavail">Frost dates unavailable</div>'));
  }
  if (factorId === 'soil_moisture') {
    parts.push(sec('M-1', 'Root-zone wetness vs normal', `<div class="chartbox"><canvas id="ch-gwet" role="img" aria-label="Root-zone wetness versus the normal range"></canvas></div>
      <p class="cap">NASA POWER GWETROOT is model-based (MERRA-2 reanalysis), 0 = dry to 1 = saturated. Not a satellite or probe measurement.</p>`));
    parts.push(sec('M-2', 'In which months does a dry root zone repeat?', f.monthly_recurrence ? `<div class="chartbox"><canvas id="ch-mrec" role="img" aria-label="Share of years with a dry root zone, by month"></canvas></div>
      <p class="cap">${esc(f.monthly_recurrence.text ?? 'Share of years with root zone below the 25th percentile')}.</p>` : '<div class="unavail">Monthly recurrence unavailable</div>'));
  }
  if (factorId === 'crop_condition') {
    parts.push(sec('C-1', 'Field greenness (NDVI) vs normal', `<div class="chartbox"><canvas id="ch-ndvi" role="img" aria-label="Field mean NDVI versus the normal range"></canvas></div>
      <p class="cap">MODIS 250 m, 16-day composites. Greenness, not cause.</p>`));
    parts.push(sec('C-2', 'Low-green-cover calendar', f.green_cover_calendar ? coverCal(f.green_cover_calendar) : '<div class="unavail">Calendar unavailable</div>'));
    const cc = analysis.interactions?.cause_check;
    parts.push(sec('C-3', 'Cause check', cc ? `<p><span class="sev ${cc.code === 'none' ? 'sev-0' : cc.code === 'not_weather' ? 'sev-2' : 'sev-1'}">${esc({ water: 'Likely water', heat: 'Likely heat', not_weather: 'Not explained by weather: scout', none: 'No greenness drop' }[cc.code] ?? cc.code)}</span></p><p class="cap">${esc(cc.text)}</p>` : '<div class="unavail">Cause check unavailable</div>'));
  }

  // Trend, shown only when the engine says so (at least 30 years).
  const tr = f.trend;
  parts.push(sec('X-1', 'Getting worse or better?', tr?.shown
    ? `${tr.values && tr.years ? '<div class="chartbox"><canvas id="ch-trend" role="img" aria-label="Annual values with trend"></canvas></div>' : ''}<p class="cap">${finite(tr.n) ? `${tr.n} years. ` : ''}Mann-Kendall: <b>${esc(tr.trend)}</b>${finite(tr.p) ? ` (${tr.p < 0.01 ? 'p < 0.01' : `p = ${tr.p.toFixed(2)}`})` : ''}. Sen's slope ${finite(tr.slope_per_decade) ? `${tr.slope_per_decade > 0 ? '+' : ''}${num(tr.slope_per_decade, 1)} ${esc(tr.unit ?? '')} per decade` : 'unavailable'}.</p>`
    : `<p class="trend-off">Trend not shown: ${esc(tr?.reason ?? 'not computed')}.</p>`));

  // Compound stress calendar (all tabs, collapsible)
  const cal = analysis.interactions?.compound_calendar;
  parts.push(`<details class="adv"><summary>How factors combine: compound-stress calendar</summary>${cal ? compound(cal) : '<div class="unavail">Unavailable</div>'}</details>`);

  // Advanced: exact values, data quality, sources, formulas, CSV
  parts.push(advanced(factorId, f, analysis, ctx));
  el.innerHTML = parts.join('');
  drawCharts(factorId, f, analysis);
  el.querySelector('#csv-btn')?.addEventListener('click', () => csv(factorId, f));
}

function drawCharts(id, f, analysis) {
  const t = theme(), s = f.series ?? {};
  if (id === 'water' && s.dates) {
    bandChart(document.getElementById('ch-supply'), { labels: s.dates, lo: s.normal_p25, hi: s.normal_p75, mid: s.normal_p50, bandLabel: 'Normal rain p25–p75', yTitle: 'mm (cumulative)', lines: [
      { label: 'Rain', data: s.rain_cum, borderColor: '#5ab4ac', backgroundColor: hexA('#5ab4ac', .25), fill: 'origin', stack: 's' },
      { label: 'Rain + irrigation', data: s.rain_cum?.map((v, i) => (v == null || s.irrigation_cum?.[i] == null ? null : v + s.irrigation_cum[i])), borderColor: '#2c7fb8', borderDash: [], fill: false },
      { label: 'Crop demand', data: s.demand_cum, borderColor: t.acc, borderWidth: 2.5 },
    ] });
    const b = f.bucket, bDates = b?.dates ?? (b?.depletion_mm?.length === s.dates?.length ? s.dates : null);
    if (b?.depletion_mm && bDates) makeChart(document.getElementById('ch-bucket'), { yTitle: 'mm depleted', options: { scales: { ...ticksOnly(), y: { reverse: false, suggestedMax: b.taw_mm } } }, data: { labels: bDates, datasets: [
      { label: 'Depletion', data: b.depletion_mm, borderColor: '#bf812d', backgroundColor: hexA('#bf812d', .2), fill: 'origin', pointRadius: 0, borderWidth: 2 },
      { label: 'Stress starts (RAW)', data: bDates.map(() => b.raw_mm), borderColor: t.alert, borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5 },
      { label: 'Total available water', data: bDates.map(() => b.taw_mm), borderColor: t.muted, borderDash: [2, 3], pointRadius: 0, borderWidth: 1 },
    ] } });
  }
  if (id === 'temperature' && s.gdd_cum) bandChart(document.getElementById('ch-gdd'), { labels: s.dates, lo: s.normal_p25, hi: s.normal_p75, mid: s.normal_p50, yTitle: '°C·day', lines: [{ label: 'This season', data: s.gdd_cum, borderColor: t.acc }] });
  if (id === 'soil_moisture' && s.gwetroot) {
    bandChart(document.getElementById('ch-gwet'), { labels: s.dates, lo: s.p25, hi: s.p75, mid: s.p50, yTitle: '0–1 wetness', lines: [{ label: 'This year', data: s.gwetroot, borderColor: '#2c7fb8' }] });
    const mr = f.monthly_recurrence;
    if (mr) makeChart(document.getElementById('ch-mrec'), { type: 'bar', yTitle: 'share of years', options: { scales: { y: { min: 0, max: 1 } } }, data: { labels: mr.months.map(m => 'JFMAMJJASOND'[m - 1]), datasets: [{ label: 'Years with dry root zone', data: mr.share, backgroundColor: mr.share.map(v => ramp('drywet', 1 - Math.min(1, v * 1.6))), borderWidth: 0 }] } });
  }
  if (id === 'crop_condition' && s.field_mean) bandChart(document.getElementById('ch-ndvi'), { labels: s.dates, lo: s.p25, hi: s.p75, mid: s.p50, yTitle: 'NDVI', lines: [{ label: 'Field mean', data: s.field_mean, borderColor: '#4f9a3c', pointRadius: 2 }] });
  const tr = f.trend;
  if (tr?.shown && tr.values && tr.years) {
    const sl = finite(tr.slope_per_decade) ? tr.slope_per_decade / 10 : null;
    const vals = tr.values.filter(finite), mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    const midYear = (tr.years[0] + tr.years.at(-1)) / 2;
    makeChart(document.getElementById('ch-trend'), { yTitle: tr.unit, data: { labels: tr.years, datasets: [
      { label: 'Annual value', data: tr.values, borderColor: t.muted, pointRadius: 1.5, borderWidth: 1, spanGaps: false },
      ...(sl == null ? [] : [{ label: "Sen's slope (through the mean)", data: tr.years.map(y => mean + sl * (y - midYear)), borderColor: t.acc, pointRadius: 0, borderWidth: 2 }]),
    ] } });
  }
}
const ticksOnly = () => ({ x: { ticks: { callback(v) { const d = this.getLabelForValue(v); return d ? fmtDate(d).replace(/, \d{4}$/, '') : ''; } } } });

function gauge(c) {
  if (!finite(c.peak_demand_mm_day) && !finite(c.well_mm_day)) {
    return `<p class="cap"><span class="sev ${c.ok === false ? 'sev-2' : 'sev-0'}">${c.ok === false ? 'Shortfall' : c.ok ? 'Keeps up' : 'Unknown'}</span> ${c.text ? esc(c.text) : finite(c.shortfall_mm_day) ? `Shortfall <span class="num">${num(c.shortfall_mm_day, 2)}</span> mm/day` : ''}</p>`;
  }
  const max = Math.max(c.peak_demand_mm_day ?? 0, c.well_mm_day ?? 0, 1) * 1.15;
  const row = (lab, v, cls) => `<div class="gauge-row"><span>${lab}</span><span class="gauge-bar"><i class="${cls}" style="width:${finite(v) ? (v / max) * 100 : 0}%"></i></span><span class="num">${num(v, 1)} mm/d</span></div>`;
  return `<div class="gauge">${row('Peak 7-day demand', c.peak_demand_mm_day, 'acc')}${row('Well capacity', c.well_mm_day, '')}</div>
    <p class="cap"><span class="sev ${c.ok === false ? 'sev-2' : 'sev-0'}">${c.ok === false ? 'Shortfall' : c.ok ? 'Keeps up' : 'Unknown'}</span> ${esc(c.text ?? '')}</p>`;
}

function heatStrip(raw) {
  // Accept both shapes: { window: {name,start,end}, hot_dates, ... } and P2's { name, start, end, hot_days, complete, status }.
  const win = raw.window ?? (raw.start ? { name: raw.name, start: raw.start, end: raw.end } : null);
  const yr = (win?.start ?? raw.season_start ?? '').slice(0, 4);
  const sh = { ...raw, window: win,
    season_start: raw.season_start ?? (yr ? `${yr}-04-25` : null),
    season_end: raw.season_end ?? (yr ? `${yr}-10-05` : null),
    hot_days_in_window: raw.hot_days_in_window ?? raw.hot_days,
    normal_hot_days_in_window: raw.normal_hot_days_in_window ?? raw.status?.normal_median };
  if (win && !win.end) win.endLabel = raw.complete === false ? 'in progress' : null;
  const s = Date.parse(sh.season_start), e = Date.parse(sh.season_end);
  if (!finite(s) || !finite(e) || e <= s) return '<div class="unavail">Season dates unavailable</div>';
  const x = d => ((Date.parse(d) - s) / (e - s)) * 100;
  const ws = sh.window?.start ? Math.max(0, x(sh.window.start)) : null;
  const we = sh.window?.end ? Math.min(100, x(sh.window.end)) : (ws != null ? Math.min(100, x(new Date().toISOString().slice(0, 10))) : null);
  const hot = (sh.hot_dates ?? []).filter(d => x(d) >= 0 && x(d) <= 100).map(d => `<span class="hot" style="left:${x(d)}%" title="${esc(fmtDate(d))}"></span>`).join('');
  const months = []; const d0 = new Date(s); d0.setDate(1);
  for (let d = new Date(d0); d.getTime() <= e; d.setMonth(d.getMonth() + 1)) if (d.getTime() >= s) months.push(`<span class="m" style="left:${x(d.toISOString().slice(0, 10))}%">${d.toLocaleString('en-US', { month: 'short' })}</span>`);
  return `<div class="strip-tl" role="img" aria-label="${sh.hot_days_in_window ?? 'unknown'} hot days inside the ${esc(sh.window?.name ?? 'sensitive')} window">
      ${ws != null ? `<span class="win" style="left:${ws}%;width:${we - ws}%"></span>` : ''}${hot}${months.join('')}</div>
    <p class="cap" style="margin-top:20px">Shaded: ${esc(sh.window?.name ?? 'sensitive window')} (${esc(fmtDate(sh.window?.start))} to ${esc(sh.window?.end ? fmtDate(sh.window.end) : sh.window?.endLabel ?? 'unavailable')}).${sh.hot_dates ? ' Red ticks: days ≥ 35 °C.' : ''} Hot days in window: <span class="num">${num(sh.hot_days_in_window)}</span> (normal ${num(sh.normal_hot_days_in_window)})${finite(sh.heat_degree_days) ? `; heat above 30 °C: <span class="num">${num(sh.heat_degree_days)}</span> °C·day` : ''}.</p>`;
}

function frost(fr) {
  const row = (lab, d, n, r) => `<tr><th scope="row">${lab}</th><td class="num">${esc(fmtDate(d))}</td><td class="num">${esc(fmtDate(n))}</td><td class="num">${r ? `${esc(fmtDate(r[0]).replace(/, \d{4}$/, ''))} to ${esc(fmtDate(r[1]).replace(/, \d{4}$/, ''))}` : 'unavailable'}</td></tr>`;
  return `<div class="tablewrap"><table class="rtable"><thead><tr><th></th><th>This year</th><th>Normal</th><th>Normal range</th></tr></thead><tbody>
    ${row('Last spring frost', fr.last_spring, fr.normal_last_spring, fr.normal_range_spring)}${row('First fall frost', fr.first_fall, fr.normal_first_fall, fr.normal_range_fall)}</tbody></table></div>`;
}

function coverCal(c) {
  return `<div class="heatwrap"><table class="heat" aria-label="Months with low green cover by year"><thead><tr><th></th>${c.months.map(m => `<th scope="col">${'JFMAMJJASOND'[m - 1]}</th>`).join('')}</tr></thead><tbody>
    ${c.years.map((y, i) => `<tr><th scope="row">${y}</th>${c.months.map((m, j) => { const v = (c.low ?? c.low_cover)?.[i]?.[j]; return `<td style="background:${v == null ? 'transparent' : v ? '#b39b5a' : '#2f6b34'}" title="${y}-${m}: ${v == null ? 'unavailable' : v ? 'low green cover' : 'green'}"></td>`; }).join('')}</tr>`).join('')}
    </tbody></table></div><p class="cap">Tan: ${esc(c.label ?? 'low green cover')} (NDVI below ${c.threshold ?? 0.3}). Green: crop cover. Residue and bare soil look the same to NDVI.</p>`;
}

function compound(c) {
  const col = n => n == null ? 'transparent' : ['#26343c', '#e6a33a', '#e8622f', '#a6201a'][Math.min(3, n)];
  return `<div class="heatwrap"><table class="heat" aria-label="Number of stressors active per month and year"><thead><tr><th></th>${c.months.map(m => `<th scope="col">${'JFMAMJJASOND'[m - 1]}</th>`).join('')}</tr></thead><tbody>
    ${c.years.map((y, i) => `<tr><th scope="row">${y}</th>${c.counts[i].map((n, j) => `<td style="background:${col(n)}" title="${y}-${c.months[j]}: ${n ?? 'unavailable'} stressors"></td>`).join('')}</tr>`).slice().reverse().join('')}
    </tbody></table></div><p class="cap">Colour = stressors active that month: 0 dark, 1 amber, 2 orange, 3 red. Stressors: hot (≥3 days ≥35 °C), dry root zone (below p25), water deficit (below p25). ${typeof c.detail === 'string' ? esc(c.detail) : ''}</p>`;
}

function advanced(id, f, analysis, ctx) {
  const st = f.status ?? {};
  const rows = [['Value', `${num(st.value, 2)} ${st.unit ?? ''}`], ['Normal median (1991–2020)', `${num(st.normal_median, 2)} ${st.unit ?? ''}`], ['Percentile', pct(st.percentile)], ['Direction', st.direction ?? 'unavailable'],
    ['Severity (0–1)', num(st.severity, 2)], ['Recurrence', f.recurrence?.text ?? 'unavailable']];
  const dq = analysis.data_quality ?? {};
  const srcIds = [...new Set([...(st.source_ids ?? []), ...(f.source_ids ?? [])])];
  const all = ctx.sources?.sources ?? ctx.sources ?? [];
  const src = srcIds.map(sid => { const s = Array.isArray(all) ? all.find(x => x.id === sid) : null; const u = s && safeURL(s.url);
    return `<li><span class="src">${esc(sid)}</span> ${s ? (u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a>` : esc(s.name)) : 'details pending in sources.json'}${s?.resolution ? ` · ${esc(s.resolution)}` : ''}</li>`; }).join('');
  return `<details class="adv"><summary>Advanced ▸ exact values, data quality, sources</summary>
    <table><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>
    <table><tbody><tr><th scope="row">Live data through</th><td>${esc(fmtDate(dq.live_through))}</td></tr><tr><th scope="row">Missing days this year</th><td>${esc(num(dq.missing_days_this_year ?? dq.missing_days))}</td></tr>
      <tr><th scope="row">ET₀ method</th><td>${esc(dq.et0_method_share ? Object.entries(dq.et0_method_share).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ') : 'unavailable')}</td></tr>
      ${(dq.notes ?? []).map(n => `<tr><th scope="row">Note</th><td>${esc(n)}</td></tr>`).join('')}</tbody></table>
    <p class="cap">Formulas: <a href="https://github.com/kevindurantbr/kimchi/blob/main/dashboard/lib/ANALYSIS.md" target="_blank" rel="noopener noreferrer">dashboard/lib/ANALYSIS.md</a></p>
    <ul class="srclist">${src || '<li>No sources listed for this factor.</li>'}</ul>
    <button type="button" class="btn" id="csv-btn">Download CSV of this factor's series</button></details>`;
}

function csv(id, f) {
  const s = f.series ?? {};
  const cols = Object.keys(s).filter(k => Array.isArray(s[k]) && s[k].length === (s.dates?.length ?? -1));
  if (!cols.length) { alert('No series to export for this factor.'); return; }
  const lines = [cols.join(','), ...s.dates.map((_, i) => cols.map(c => s[c][i] ?? '').join(','))];
  download(`kimchi-${id}-series.csv`, lines.join('\n'), 'text/csv');
}
