// Right panel: top 3 actions (P4 recommend output), rotation comparison, what-if builder.
import { esc, finite, num, factorName } from './util.mjs';

const list = (k, items) => items?.length ? `<div class="k">${k}</div><ul>${items.map(i => `<li>${esc(typeof i === 'string' ? i : i.text ?? JSON.stringify(i))}</li>`).join('')}</ul>` : '';
const srcChips = ids => (ids ?? []).map(s => `<span class="src">${esc(s)}</span>`).join(' ');

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
    return `<article class="act bracket ${i === 0 ? 'on' : ''}">
      <div class="act-top"><span class="rank">${i + 1}</span><div><h3>${esc(c.title)}</h3>
        <div class="meta">${esc(factorName(c.factor ?? ''))} · ${esc((c.category ?? '').replace('_', '-'))}${c.when ? ` · ${esc(c.when)}` : ''}${watch ? ' · watch only' : ''}</div></div></div>
      ${watch ? `<p class="watch">${esc(c.reason ?? 'Not triggered; shown because the focus has fewer than 3 active actions.')}</p>` : ''}
      <div class="scorebar"><span class="trk" role="img" aria-label="Score ${num(c.score, 2)} of 1"><i style="width:${finite(c.score) ? Math.min(100, c.score * 100) : 0}%"></i></span><span class="num">${num(c.score, 2)}</span></div>
      <details><summary>Why this score</summary><table class="parts"><tbody>
        <tr><td>Severity</td><td class="num">${num(sp.severity, 2)}</td></tr><tr><td>× Your priority</td><td class="num">${num(sp.priority, 2)}</td></tr>
        <tr><td>× Evidence strength</td><td class="num">${num(sp.evidence, 2)}</td></tr><tr><td>× Timing</td><td class="num">${num(sp.timing, 2)}</td></tr>
        <tr><td><b>= Score</b></td><td class="num"><b>${num(c.score, 2)}</b></td></tr></tbody></table></details>
      ${list('Why', c.why)}
      ${c.evidence?.length ? `<div class="k">Evidence</div>${c.evidence.map(e => `<div class="ev"><span>${esc(e.text)}</span>${e.value != null ? `<span class="v">${esc(e.value)}</span>` : ''}${e.kind ? `<span class="kind">${esc(e.kind.replace('_', ' '))}</span>` : ''}${srcChips(e.source_ids)}</div>`).join('')}` : ''}
      <details><summary>Benefits, risks and information gaps</summary>${list('Benefits', c.benefits)}${list('Risks', c.risks)}${list('Information gaps', c.gaps)}</details>
      <div class="expert">${esc(c.expert_check ?? 'Check with your agronomist / K-State Extension before acting.')}</div>
    </article>`;
  }).join('');
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

export function renderRotations(el, rots) {
  if (!rots?.length) { el.innerHTML = '<p class="state">Rotation comparison unavailable.</p>'; return; }
  const max = Object.fromEntries(METRICS.map(([k]) => [k, Math.max(...rots.map(r => toNum(r.metrics?.[k]) ?? 0), 1e-9)]));
  el.innerHTML = rots.map(r => `<article class="rot">
    <h3>${esc(r.name ?? r.rotation_id)} ${r.is_current ? '<span class="tag cur">Current</span>' : '<span class="tag">Alternative</span>'}</h3>
    <div class="seq">${esc((r.sequence ?? []).join(' → '))}</div>
    ${metricRows(r.metrics, max)}
    <details><summary>Benefits, risks, gaps and evidence</summary>${list('Benefits', r.benefits)}${list('Risks', r.risks)}${list('Information gaps', r.gaps)}
      ${r.evidence?.length ? `<div class="k">Evidence</div>${r.evidence.map(e => `<div class="ev"><span>${esc(e.text)}</span>${srcChips(e.source_ids)}</div>`).join('')}` : ''}</details>
    <div class="expert">${esc(r.expert_check ?? 'Check with your agronomist / K-State Extension before acting.')}</div>
  </article>`).join('');
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
    r.addEventListener('input', () => { alloc = +r.value; el.querySelector('#wi-alloc-v').textContent = `${alloc} mm/yr`; run(); });
    run();
  };
  const run = () => {
    const out = el.querySelector('#wi-out');
    if (!seq.length) { out.innerHTML = ''; return; }
    const fit = onRun({ id: 'whatif', name: 'Your sequence', sequence: seq }, alloc);
    if (!fit) { out.innerHTML = '<p class="state">What-if metrics need the analysis engine (P2 rotationFit) and the NASA POWER history file. They will appear here when both are connected. No estimate is shown until then.</p>'; return; }
    const max = Object.fromEntries(METRICS.map(([k]) => [k, Math.max(toNum(fit.metrics?.[k]) ?? 0, 1e-9)]));
    out.innerHTML = `<article class="rot"><h3>Your sequence <span class="tag">What-if</span></h3><div class="seq">${esc(seq.map(name).join(' → '))}</div>${metricRows(fit.metrics, max)}
      ${(fit.notes ?? []).length ? `<p class="cap">${fit.notes.map(esc).join(' ')}</p>` : ''}</article>`;
  };
  draw();
}
