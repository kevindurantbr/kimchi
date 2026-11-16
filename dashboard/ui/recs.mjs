// Right panel: top 3 actions (P4 recommend output), rotation comparison, what-if builder.
import { esc, finite, num, factorName, fmtVal } from './util.mjs';
import { factorIcon } from './icons.mjs';
import { makeChart } from './charts.mjs';
import { rotationTable } from '../lib/recommend.mjs';

const list = (k, items) => items?.length ? `<div class="k">${k}</div><ul>${items.map(i => typeof i === 'string' ? `<li>${esc(fmtVal(i))}</li>`
  : `<li>${esc(fmtVal(i.text ?? JSON.stringify(i)))}${i.source_ids?.length ? ' ' + i.source_ids.map(s => `<span class="src">${esc(s)}</span>`).join(' ') : ''}</li>`).join('')}</ul>` : '';
const txt = i => (i == null ? '' : typeof i === 'string' ? i : (i.text ?? ''));
/** One plain sentence for the Simple view: P4's card.short, else the first reason. Never "undefined". */
const shortOf = c => c.short || txt(c.why?.[0]) || txt(c.reason) || '';
const srcChips = ids => (ids ?? []).map(s => `<span class="src">${esc(s)}</span>`).join(' ');

// Status colours and factor icons shared with the map (PLAN.md §13). The word is always shown next to the colour.
const STATUS_COLOUR = { Good: '#2e9e5b', Normal: '#7a9a86', Watch: '#e0a100', Concern: '#d64545', 'No new data': '#8a8a8a' };


/** Collapsed action cards: icon + factor + problem + bold result; click or Enter expands chart + text. */
export function renderActions(el, rec, { focus }) {
  if (!rec) { el.innerHTML = '<p class="state">Recommendations unavailable.</p>'; return; }
  const cards = rec.top3 ?? [];
  if (!cards.length) {
    el.innerHTML = `<p class="state">${focus ? `No ${esc(factorName(focus).toLowerCase())} actions are triggered for this field right now.` : 'No actions are triggered for this field right now.'}</p>`;
    return;
  }
  el.innerHTML = cards.map((c, i) => {
    const sp = c.score_parts ?? {};
    const watch = c.status === 'watch';
    const word = c.status_word ?? (watch ? 'Normal' : 'Watch');
    const col = STATUS_COLOUR[word] ?? STATUS_COLOUR.Normal;
    const chart = c.chart;
    const hasChart = chart && !chart.unavailable && chart.labels?.length;
    const toRot = c.chart_kind === 'rotations' || /^W4_/.test(c.id ?? '');
    return `<article class="act" style="padding:0">
      <button type="button" class="act-head" id="acth-${i}" aria-expanded="false" aria-controls="actb-${i}"
        style="display:flex;gap:10px;align-items:center;width:100%;background:none;border:0;padding:10px 11px;color:inherit;font:inherit;text-align:left;cursor:pointer">
        <span class="act-icon">${factorIcon(c.factor, 'aicon') || '•'}</span>
        <span style="flex:1;min-width:0">
          <span class="meta" style="display:block">${i + 1} · ${esc(factorName(c.factor ?? ''))} · <span style="color:${col};font-weight:700">${esc(word)}</span>${watch ? ' · watch only' : ''}</span>
          <span style="display:block;font-size:13.5px;margin-top:2px">${esc(c.headline ?? c.title)}</span>
          ${c.result ? `<b style="display:block;font-size:16px;margin-top:2px">${esc(fmtVal(c.result))}</b>` : ''}
        </span>
        <span class="chev" aria-hidden="true" style="font-size:13px;color:var(--muted)">▸</span>
      </button>
      <div id="actb-${i}" role="region" aria-labelledby="acth-${i}" hidden style="padding:0 11px 10px">
        ${hasChart
          ? `<div style="position:relative;height:160px;margin-top:4px"><canvas id="actc-${i}" role="img" aria-label="${esc(chart.title)}"></canvas></div>
             <p class="fine" style="margin:2px 0 0">${esc(chart.title)}${chart.note ? ` · ${esc(chart.note)}` : ''}</p>`
          : `<p class="state">Chart unavailable: ${esc(chart?.reason ?? 'no data')}</p>`}
        <p class="short">${esc(fmtVal(shortOf(c)))}</p>
        ${toRot ? `<p><a href="#rotations" class="cmp-link">Compare rotations ↓</a></p>` : ''}
        ${watch ? `<p class="watch">${esc(Array.isArray(c.reason) ? c.reason.join('; ') : (c.reason ?? 'Not triggered; shown because fewer than 3 actions are active.'))}</p>` : ''}
        <div data-min-level="2"><div class="k">${esc(c.title)}</div>${list('Why', c.why)}${list('Benefits', c.benefits)}${list('Risks', c.risks)}${list('Information gaps', c.gaps)}</div>
        <div data-min-level="3">
          <div class="scorebar"><span class="trk" role="img" aria-label="Score ${num(c.score, 2)} of 1"><i style="width:${finite(c.score) ? Math.min(100, c.score * 100) : 0}%"></i></span><span class="num">${num(c.score, 2)}</span></div>
          <table class="parts"><tbody>
            <tr><td>Severity</td><td class="num">${num(sp.severity, 2)}</td></tr><tr><td>× Your priority</td><td class="num">${num(sp.priority, 2)}</td></tr>
            <tr><td>× Evidence strength${sp.evidence_level ? ` (${esc(sp.evidence_level)})` : ''}</td><td class="num">${num(sp.evidence, 2)}</td></tr><tr><td>× Timing${c.when ? ` · ${esc(c.when)}` : ''}</td><td class="num">${num(sp.timing, 2)}</td></tr>
            <tr><td><b>= Score</b></td><td class="num"><b>${num(c.score, 2)}</b></td></tr></tbody></table>
          ${c.evidence?.length ? `<div class="k">Evidence</div>${c.evidence.map(e => `<div class="ev"><span>${esc(fmtVal(e.text))}</span>${e.kind ? `<span class="kind">${esc(e.kind.replace('_', ' '))}</span>` : ''}${srcChips(e.source_ids)}</div>`).join('')}` : ''}
          ${c.source_ids?.length ? `<div class="k">Sources</div><div>${srcChips(c.source_ids)}</div>` : ''}
        </div>
        <div class="expert">${esc(c.expert_check ?? 'Check with your agronomist / K-State Extension before acting.')}</div>
      </div>
    </article>`;
  }).join('');
  const drawn = new Set();
  el.querySelectorAll('.act-head').forEach((btn, i) => btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    btn.querySelector('.chev').textContent = open ? '▾' : '▸';
    const body = document.getElementById(`actb-${i}`);
    body.hidden = !open;
    if (open && !drawn.has(i)) { drawn.add(i); drawCardChart(document.getElementById(`actc-${i}`), cards[i].chart); }
  }));
  el.querySelectorAll('.cmp-link').forEach(a => a.addEventListener('click', ev => {
    ev.preventDefault();
    const t = document.getElementById('rotations');
    t?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    t?.querySelector('table, h3, p')?.setAttribute('tabindex', '-1');
    t?.querySelector('table, h3, p')?.focus({ preventScroll: true });
  }));
}

/** Bar chart for an expanded card. Bars above the normal line are amber; the current rotation is highlighted. */
function drawCardChart(canvas, ch) {
  if (!canvas || !ch || ch.unavailable) return;
  const above = STATUS_COLOUR.Watch, base = STATUS_COLOUR.Normal;
  const palette = ['#2c7fb8', '#7a9a86', '#b07aa1', '#9c755f'];
  const datasets = (ch.series ?? []).map((s, k) => {
    const single = ch.series.length === 1;
    const colour = single
      ? s.data.map(v => (ch.normal && finite(v) && v > ch.normal.value ? above : base))
      : (s.current ? '#e0a100' : palette[k % palette.length]);
    return { type: 'bar', label: s.label, data: s.data, backgroundColor: colour, borderWidth: 0 };
  });
  if (ch.normal) datasets.push({ type: 'line', label: ch.normal.label, data: ch.labels.map(() => ch.normal.value), borderColor: '#d64545', borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 });
  const chart = makeChart(canvas, { type: 'bar', yTitle: ch.unit, data: { labels: ch.labels, datasets }, options: { scales: { x: { ticks: ch.labels.length > 12 ? { maxTicksLimit: 8 } : { autoSkip: false, maxTicksLimit: 12 } } } } });
  if (!chart) canvas.parentElement.outerHTML = '<p class="state">Chart unavailable: the chart library did not load.</p>';
}

const METRICS = [
  ['shortfall_years', 'Years short of water', 'years'],
  ['median_irrigation_need_mm', 'Median irrigation need', 'mm'],
  ['peak_capacity_short_years', 'Years well cannot keep up', 'years'],
  ['sensitive_heat_years', 'Heat in sensitive window', 'years'],
  ['low_cover_months_per_year', 'Low green cover', 'mo/yr'],
];
/** "x of N" -> x/N for bar length; numbers pass through. */
const toNum = v => { if (finite(v)) return v; const m = /^(\d+)\s*of\s*(\d+)/.exec(String(v ?? '')); return m ? +m[1] / +m[2] : null; };

/** Simple view: one table, current + alternatives (PLAN.md section 11), from P4's rotationTable(). */
function comparisonTable(rots) {
  let t;
  try { t = rotationTable({ rotations: rots }); } catch (e) { console.error(e); return ''; }
  const row = k => t.rows.find(r => r.key === k);
  const water = row('short_on_water'), heat = row('heat_at_pollination'), cover = row('low_green_cover_months');
  const ben = row('main_benefit'), risk = row('main_risk'), unk = row('unknown');
  const cell = v => esc(String(v ?? 'not computed').replace(/ seasons$/, '').replace(/^about /, ''));
  return `<table class="rotcmp"><thead><tr><th scope="col">Rotation</th><th scope="col">Short on water</th><th scope="col">${esc(heat.key && t.heat_definition === 'above_normal' ? 'Above-normal heat at pollination' : 'Hot day at pollination')}</th><th scope="col">Months with no crop</th></tr></thead><tbody>
    ${t.columns.map((c, j) => `<tr><th scope="row">${esc(c.role === 'current' ? c.name.replace(/ \(now\)$/, '') : c.name)}${c.role === 'current' ? ' <span class="tag cur">Current</span>' : ''}</th>
        <td class="num">${cell(water.cells[j])}</td><td class="num">${cell(heat.cells[j])}</td><td class="num">${cell(cover.cells[j])}</td></tr>
        <tr><td colspan="4" class="fine"><b>Benefit:</b> ${esc(ben.cells[j])} <b>Risk:</b> ${esc(risk.cells[j])} <b>We don't know:</b> ${esc(unk.cells[j])}</td></tr>`).join('')}
  </tbody></table><p class="fine">${t.notes.map(esc).join(' ')}</p>`;
}

export function renderRotations(el, rots) {
  if (!rots?.length) { el.innerHTML = '<p class="state">Rotation comparison unavailable.</p>'; return; }
  const max = Object.fromEntries(METRICS.map(([k]) => [k, Math.max(...rots.map(r => toNum(r.metrics?.[k]) ?? 0), 1e-9)]));
  el.innerHTML = comparisonTable(rots) + rots.map(r => { const cur = r.is_current ?? r.role === 'current'; return `<article class="rot" data-min-level="2">
    <h3>${esc(r.name ?? r.rotation_id)} ${cur ? `<span class="tag cur">Current${r.confirmed === false ? ' · unconfirmed' : ''}</span>` : '<span class="tag">Alternative</span>'}${r.evidence_status ? `<span class="tag">${esc(String(r.evidence_status).replace(/_/g, ' '))}</span>` : ''}</h3>
    <div class="seq">${esc((r.sequence ?? []).map(s => String(s).replace('_', ' ')).join(' → ') || 'sequence not known')}</div>
    ${r.why_suggested ? `<p class="cap">${esc(r.why_suggested)}</p>` : ''}
    ${r.metrics ? metricRows(r.metrics, max) : `<div class="unavail">Fit metrics need the analysis engine (P2 rotationFit); not shown until then.</div>`}
    ${r.comparison_to_current?.length ? `<ul class="cap">${r.comparison_to_current.map(t => `<li>${esc(fmtVal(t))}</li>`).join('')}</ul>` : ''}
    <details><summary>Benefits, risks, gaps and evidence</summary>${r.note ? `<p class="cap">${esc(r.note)}</p>` : ''}${list('Benefits', r.benefits)}${list('Risks', r.risks)}${list('Information gaps', r.gaps)}${list('Prerequisites', r.prerequisites)}${list('Residue', r.residue)}
      ${r.evidence?.length ? `<div class="k">Evidence</div>${r.evidence.map(e => `<div class="ev"><span>${esc(fmtVal(e.text))}</span>${srcChips(e.source_ids)}</div>`).join('')}` : ''}</details>
    <div class="expert">${esc(r.expert_check ?? 'Check with your agronomist / K-State Extension before acting.')}</div>
  </article>`; }).join('');
}

function metricRows(m, max) {
  if (!m) return '<div class="unavail">Fit metrics unavailable</div>';
  return METRICS.map(([k, lab, unit]) => {
    const v = m[k], n = toNum(v);
    return `<div class="mrow"><span>${lab}</span><span class="trk"><i style="width:${n == null ? 0 : (n / max[k]) * 100}%"></i></span><span class="num">${v == null ? 'unavailable' : finite(v) ? `${num(v, unit === 'mo/yr' ? 1 : 0)} ${unit}` : esc(v)}</span></div>`;
  }).join('');
}

/** What-if: build any sequence from the crop library, set the allocation, and compute fit via P2's rotationFit. */
export function renderWhatIf(el, { crops, allocation, onRun }) {
  const lib = (crops?.crops ?? []).filter(c => c.id);
  let seq = ['corn', 'winter_wheat', 'sorghum'].filter(id => lib.some(c => c.id === id));
  let alloc = finite(allocation) ? allocation : 280;
  const name = id => lib.find(c => c.id === id)?.name ?? id;
  const draw = () => {
    el.innerHTML = `<div class="wi-seq" aria-label="Sequence">${seq.length ? seq.map((id, i) => `${i ? '<span aria-hidden="true">→</span>' : ''}<span class="wi-crop">${esc(name(id))}<button type="button" data-rm="${i}" aria-label="Remove ${esc(name(id))}">✕</button></span>`).join('') : '<span class="fine">Add at least one crop.</span>'}</div>
      <div class="wi-row"><label>Add crop<select id="wi-add">${lib.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label><button type="button" class="btn" id="wi-addbtn">Add</button></div>
      <div class="wi-row"><label>Water allocation: <span class="num" id="wi-alloc-v">${alloc} mm/yr</span><input type="range" id="wi-alloc" min="100" max="600" step="10" value="${alloc}" aria-label="Annual water allocation in mm"></label></div>
      <div id="wi-out"></div>`;
    el.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { seq.splice(+b.dataset.rm, 1); draw(); }));
    el.querySelector('#wi-addbtn').addEventListener('click', () => { if (seq.length < 6) seq.push(el.querySelector('#wi-add').value); draw(); });
    const r = el.querySelector('#wi-alloc');
    // Each run is a full rotationFit (~0.3 s): update the label at once, compute when the slider rests.
    let t = null;
    r.addEventListener('input', () => { alloc = +r.value; el.querySelector('#wi-alloc-v').textContent = `${alloc} mm/yr`; clearTimeout(t); t = setTimeout(run, 250); });
    run();
  };
  let runId = 0;
  const run = async () => {
    const out = el.querySelector('#wi-out'), my = ++runId;
    if (!out) return;
    if (!seq.length) { out.innerHTML = ''; return; }
    out.innerHTML = '<p class="state" role="status">Computing your sequence over the same weather years…</p>';
    const fit = await onRun({ id: 'whatif', name: 'Your sequence', sequence: [...seq] }, alloc);
    if (my !== runId || !out.isConnected) return; // a newer request replaced this one
    if (!fit) { out.innerHTML = '<p class="state">What-if metrics need the analysis engine (P2 rotationFit) and the NASA POWER history file. They will appear here when both are connected. No estimate is shown until then.</p>'; return; }
    const max = Object.fromEntries(METRICS.map(([k]) => [k, Math.max(toNum(fit.metrics?.[k]) ?? 0, 1e-9)]));
    out.innerHTML = `<article class="rot"><h3>Your sequence <span class="tag">What-if</span></h3><div class="seq">${esc(seq.map(name).join(' → '))}</div>${metricRows(fit.metrics, max)}
      ${(fit.notes ?? []).length ? `<p class="cap">${fit.notes.map(esc).join(' ')}</p>` : ''}</article>`;
  };
  draw();
}
