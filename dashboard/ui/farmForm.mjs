// "My farm records" dialog: one-record form (PLAN.md 7.2), field and farm settings, records table, trends,
// export/import/demo. Data stays in this browser through P1's farmStore (or the temporary stand-in).
import { $, esc, finite, num, download } from './util.mjs';
import { makeChart, destroyCharts, theme } from './charts.mjs';

const IN_TO_MM = 25.4, LBAC_TO_KGHA = 1.121;
let tab = 'records', editKey = null;

export function openRecords({ ctx, getFarm, setFarm, fieldId, analysis }) {
  const dlg = $('dlg-records');
  let fid = fieldId;
  const draw = () => {
    destroyCharts('fr-');
    const farm = getFarm();
    if (!farm) { $('records-body').innerHTML = `<p class="state">No farm saved in this browser yet.</p><div class="form-actions"><button type="button" class="btn primary" id="fr-demo">Load demo farm (synthetic)</button><button type="button" class="btn" id="fr-import-btn">Import JSON</button><input type="file" accept="application/json,.json" id="fr-import" hidden></div>`; wireIO(); return; }
    if (!farm.fields.some(f => f.field_id === fid)) fid = farm.fields[0]?.field_id;
    const ff = farm.fields.find(f => f.field_id === fid);
    const memory = (ctx.farmStore.storage ?? 'localStorage') === 'memory';
    $('records-body').innerHTML = `
      <div class="privacy">${memory ? '<b>Not saved: private window.</b> Records last until you close this tab. Export to keep a copy.' : '<b>Stored only in this browser.</b> Nothing is sent to a server or to GitHub. Export to keep a copy.'}
        ${farm.synthetic ? ' This is the <b>synthetic demo farm</b>: invented values for demonstration.' : ''}</div>
      <div class="wi-row"><label>Field<select id="fr-field">${farm.fields.map(f => `<option value="${esc(f.field_id)}" ${f.field_id === fid ? 'selected' : ''}>${esc(f.name)} (${esc(f.field_id)})</option>`).join('')}</select></label>
        <div class="form-actions" style="margin:0"><button type="button" class="btn" id="fr-export">Export JSON</button><button type="button" class="btn" id="fr-import-btn">Import JSON</button><input type="file" accept="application/json,.json" id="fr-import" hidden><button type="button" class="btn" id="fr-demo">Load demo farm</button></div></div>
      <div class="dtabs" role="tablist">${[['records', 'Season records'], ['settings', 'Field & farm settings'], ['trends', 'Trends']].map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`).join('')}</div>
      <div id="fr-pane"></div>`;
    $('fr-field').addEventListener('change', e => { fid = e.target.value; editKey = null; draw(); });
    document.querySelectorAll('#records-body [data-tab]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; draw(); }));
    wireIO();
    if (tab === 'records') paneRecords(farm, ff); else if (tab === 'settings') paneSettings(farm, ff); else paneTrends(ff, analysis);
  };

  function wireIO() {
    $('fr-import-btn')?.addEventListener('click', () => $('fr-import').click());
    $('fr-export')?.addEventListener('click', () => {
      const blob = ctx.farmStore.exportFarm(getFarm());
      blob.text().then(t => download(`kimchi-farm-${new Date().toISOString().slice(0, 10)}.json`, t, 'application/json'));
    });
    $('fr-import')?.addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      try { setFarm(await ctx.farmStore.importFarm(file)); draw(); } catch (err) { alert(`Import failed: ${err.message}`); }
    });
    $('fr-demo')?.addEventListener('click', async () => {
      if (getFarm() && !getFarm().synthetic && !confirm('Replace your farm in this browser with the synthetic demo farm? Export first if you want to keep it.')) return;
      setFarm(await ctx.farmStore.loadDemoFarm()); draw();
    });
  }

  function paneRecords(farm, ff) {
    const recs = ff?.records ?? [];
    const cur = editKey ? recs.find(r => `${r.year}|${r.period}` === editKey) : null;
    const crops = (ctx.crops?.crops ?? []).filter(c => c.id !== 'fallow');
    $('fr-pane').innerHTML = `
      <form id="fr-form" class="form-grid" novalidate>
        <label>Year<input name="year" type="number" min="1980" max="2100" required value="${esc(cur?.year ?? new Date().getFullYear())}"></label>
        <label>Period<select name="period">${['season', 'Q1', 'Q2', 'Q3', 'Q4'].map(p => `<option ${cur?.period === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
        <label>Crop<select name="crop">${crops.map(c => `<option value="${esc(c.id)}" ${cur?.crop === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label>Planting date<input name="planting_date" type="date" value="${esc(cur?.planting_date ?? '')}"></label>
        <label>Harvest date<input name="harvest_date" type="date" value="${esc(cur?.harvest_date ?? '')}"></label>
        <label>Irrigation applied<span class="unit"><input name="irrigation" type="number" min="0" step="any" value="${esc(cur?.irrigation_mm ?? '')}"><select name="irr_unit" aria-label="Irrigation unit"><option value="mm">mm</option><option value="in">in</option></select></span></label>
        <label>Nitrogen<span class="unit"><input name="nitrogen" type="number" min="0" step="any" value="${esc(cur?.nitrogen_kg_ha ?? '')}"><select name="n_unit" aria-label="Nitrogen unit"><option value="kgha">kg/ha</option><option value="lbac">lb/ac</option></select></span></label>
        <label>Yield<span class="unit"><input name="yield" type="number" min="0" step="any" value="${esc(cur?.yield ?? '')}"><select name="yield_unit" aria-label="Yield unit">${['bu/ac', 't/ha'].map(u => `<option ${cur?.yield_unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select></span></label>
        <label style="grid-column:1/-1">Notes<input name="notes" maxlength="300" value="${esc(cur?.notes ?? '')}"></label>
        <p id="fr-msg" class="fine" role="status" style="grid-column:1/-1"></p>
        <div class="form-actions" style="grid-column:1/-1">${cur ? '<button type="button" class="btn" id="fr-cancel">Cancel edit</button>' : ''}<button type="submit" class="btn primary">${cur ? 'Update record' : 'Save record'}</button></div>
      </form>
      <div class="tablewrap"><table class="rtable"><thead><tr><th>Year</th><th>Period</th><th>Crop</th><th>Planted</th><th>Harvested</th><th>Irrigation mm</th><th>N kg/ha</th><th>Yield</th><th>Notes</th><th></th></tr></thead><tbody>
        ${recs.length ? recs.map(r => `<tr><td class="num">${r.year}</td><td>${esc(r.period)}</td><td>${esc(r.crop)}</td><td class="num">${esc(r.planting_date ?? '')}</td><td class="num">${esc(r.harvest_date ?? '')}</td>
          <td class="num">${num(r.irrigation_mm)}</td><td class="num">${num(r.nitrogen_kg_ha)}</td><td class="num">${num(r.yield)} ${esc(r.yield_unit ?? '')}</td><td>${esc(r.notes ?? '')}</td>
          <td><button type="button" class="btn" data-edit="${r.year}|${esc(r.period)}">Edit</button> <button type="button" class="btn" data-del="${r.year}|${esc(r.period)}">Delete</button></td></tr>`).join('')
        : '<tr><td colspan="10" class="fine">No records for this field yet. Add your first season above.</td></tr>'}</tbody></table></div>`;
    $('fr-cancel')?.addEventListener('click', () => { editKey = null; draw(); });
    $('fr-pane').querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => { editKey = b.dataset.edit; draw(); }));
    $('fr-pane').querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
      const [y, p] = b.dataset.del.split('|');
      if (!confirm(`Delete the ${p} ${y} record?`)) return;
      const f = getFarm();
      if (ctx.farmStore.deleteRecord) ctx.farmStore.deleteRecord(f, ff.field_id, +y, p); else ff.records = ff.records.filter(r => !(r.year === +y && r.period === p));
      setFarm(f); draw();
    }));
    $('fr-form').addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(e.target), n = k => (fd.get(k) === '' ? null : Number(fd.get(k)));
      const year = n('year'), msg = $('fr-msg');
      if (!finite(year) || year < 1980 || year > 2100) { msg.textContent = 'Enter a year between 1980 and 2100.'; msg.className = 'state err'; return; }
      const irr = n('irrigation'), nit = n('nitrogen'), yld = n('yield');
      if ([irr, nit, yld].some(v => v != null && (!finite(v) || v < 0))) { msg.textContent = 'Irrigation, nitrogen and yield must be zero or more, or left blank.'; msg.className = 'state err'; return; }
      const rec = { year, period: fd.get('period'), crop: fd.get('crop'), planting_date: fd.get('planting_date') || null, harvest_date: fd.get('harvest_date') || null,
        irrigation_mm: irr == null ? null : +(fd.get('irr_unit') === 'in' ? irr * IN_TO_MM : irr).toFixed(1),
        nitrogen_kg_ha: nit == null ? null : +(fd.get('n_unit') === 'lbac' ? nit * LBAC_TO_KGHA : nit).toFixed(1),
        yield: yld, yield_unit: fd.get('yield_unit'), notes: fd.get('notes') || '' };
      const f = getFarm();
      if (editKey) { const [y, p] = editKey.split('|'); if (+y !== rec.year || p !== rec.period) ctx.farmStore.deleteRecord?.(f, ff.field_id, +y, p); }
      ctx.farmStore.upsertRecord(f, ff.field_id, rec); editKey = null; setFarm(f); draw();
      $('fr-msg').textContent = `Saved ${rec.period} ${rec.year}. Analysis and recommendations were re-run.`;
    });
  }

  function paneSettings(farm, ff) {
    const pr = farm.priorities ?? { water: .34, soil: .33, income: .33 }, cn = farm.constraints ?? {};
    const eq = ['pivot', 'no-till drill', 'grain drill', 'row planter', 'combine with header for sorghum'], mk = ['corn', 'sorghum', 'wheat'];
    $('fr-pane').innerHTML = `<form id="fs-form"><div class="grid2">
      <fieldset class="dsec" style="border:0"><h3>Field: ${esc(ff.name)}</h3>
        <label class="form-row">Field name<input name="name" maxlength="60" value="${esc(ff.name)}"></label>
        <label class="form-row">Well capacity (gpm)<input name="gpm" type="number" min="0" step="any" value="${esc(ff.well_capacity_gpm ?? '')}"></label>
        <p class="cap">Area ${num(ff.area_ha, 1)} ha. Used to convert well capacity to mm/day.</p></fieldset>
      <fieldset class="dsec" style="border:0"><h3>Farm priorities (normalised to sum to 1)</h3>
        ${['water', 'soil', 'income'].map(k => `<label class="form-row">${{ water: 'Save water', soil: 'Protect soil', income: 'Income' }[k]}: <span class="num" id="pv-${k}">${num(pr[k], 2)}</span><input type="range" name="p_${k}" min="0" max="100" value="${Math.round((pr[k] ?? 0) * 100)}" aria-label="${k} priority"></label>`).join('')}
        <label class="form-row">Annual water allocation (mm)<input name="alloc" type="number" min="0" step="any" value="${esc(cn.annual_allocation_mm ?? '')}"></label></fieldset></div>
      <div class="grid2"><fieldset class="dsec" style="border:0"><h3>Equipment</h3>${eq.map(e => `<label class="ev"><input type="checkbox" name="eq" value="${esc(e)}" ${(cn.equipment ?? []).includes(e) ? 'checked' : ''}> ${esc(e)}</label>`).join('')}</fieldset>
        <fieldset class="dsec" style="border:0"><h3>Markets you can sell to</h3>${mk.map(m => `<label class="ev"><input type="checkbox" name="mk" value="${m}" ${(cn.markets ?? []).includes(m) ? 'checked' : ''}> ${m}</label>`).join('')}</fieldset></div>
      <p id="fs-msg" class="fine" role="status"></p><div class="form-actions"><button type="submit" class="btn primary">Save settings</button></div></form>`;
    const form = $('fs-form');
    const norm = () => { const v = ['water', 'soil', 'income'].map(k => +form[`p_${k}`].value), s = v.reduce((a, b) => a + b, 0) || 1; return v.map(x => x / s); };
    form.addEventListener('input', () => { norm().forEach((v, i) => { $(`pv-${['water', 'soil', 'income'][i]}`).textContent = v.toFixed(2); }); });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const f = getFarm(), fld = f.fields.find(x => x.field_id === ff.field_id), fd = new FormData(form);
      fld.name = (fd.get('name') || fld.name).trim();
      fld.well_capacity_gpm = fd.get('gpm') === '' ? null : +fd.get('gpm');
      const [w, s, i] = norm(); f.priorities = { water: +w.toFixed(2), soil: +s.toFixed(2), income: +(1 - +w.toFixed(2) - +s.toFixed(2)).toFixed(2) };
      f.constraints = { ...(f.constraints ?? {}), annual_allocation_mm: fd.get('alloc') === '' ? null : +fd.get('alloc'), equipment: fd.getAll('eq'), markets: fd.getAll('mk') };
      setFarm(f); draw(); $('fs-msg').textContent = 'Settings saved. Analysis and recommendations were re-run.';
    });
  }

  function paneTrends(ff, analysis) {
    const recs = (ff?.records ?? []).filter(r => r.period === 'season').sort((a, b) => a.year - b.year);
    const fs = analysis?.interactions?.farm_sensitivity;
    $('fr-pane').innerHTML = recs.length ? `<div class="grid2">
        <div><h3 class="dsec">Yield over the years</h3><div class="chartbox"><canvas id="fr-yield" role="img" aria-label="Yield by year"></canvas></div></div>
        <div><h3 class="dsec">Irrigation and nitrogen</h3><div class="chartbox"><canvas id="fr-inputs" role="img" aria-label="Irrigation and nitrogen by year"></canvas></div></div></div>
      <div class="dsec"><h3>Your yields vs hot days</h3>${fs?.points?.length ? `<div class="chartbox"><canvas id="fr-sens" role="img" aria-label="Yield against hot days for your own years"></canvas></div>
        <p class="cap"><b>${esc(fs.points.length)} years: pattern, not proof.</b> ${esc(fs.pattern ?? '')}${finite(fs.rho) ? ` (Spearman ρ = ${fs.rho.toFixed(2)})` : ''}. ${analysis?.sample ? 'SAMPLE analysis: points are synthetic.' : ''}</p>` : '<div class="unavail">Needs at least a few seasons of records and the analysis engine.</div>'}</div>`
      : '<p class="state">No season records for this field yet. Add some in Season records to see trends.</p>';
    if (!recs.length) return;
    const t = theme(), yrs = recs.map(r => r.year);
    makeChart($('fr-yield'), { type: 'bar', yTitle: recs[0].yield_unit ?? '', data: { labels: yrs, datasets: [{ label: 'Yield', data: recs.map(r => r.yield), backgroundColor: t.acc }] } });
    makeChart($('fr-inputs'), { data: { labels: yrs, datasets: [{ label: 'Irrigation (mm)', data: recs.map(r => r.irrigation_mm), borderColor: '#2c7fb8', pointRadius: 3 }, { label: 'Nitrogen (kg/ha)', data: recs.map(r => r.nitrogen_kg_ha), borderColor: t.muted, pointRadius: 3 }] } });
    if (fs?.points?.length) makeChart($('fr-sens'), { type: 'scatter', yTitle: 'yield', options: { scales: { x: { type: 'linear', title: { display: true, text: 'hot days ≥ 35 °C (season)', color: t.muted } } } },
      data: { datasets: [{ label: 'Your seasons', data: fs.points.map(p => ({ x: p.hot_days, y: p.yield })), backgroundColor: t.acc, pointRadius: 5 }] } });
  }

  draw();
  if (!dlg.open) dlg.showModal();
}
