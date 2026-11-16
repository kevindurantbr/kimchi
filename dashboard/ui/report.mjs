// Season report: renders P4's buildReport output; a plain fallback builder is used until P4's report.mjs lands.
import { $, esc, FACTORS, num, sevText, fmtDate } from './util.mjs';
import { buildReport as viaIntegration } from './integrate.mjs';

/** Fallback with the same output shape as P4's buildReport: { title, period, sections: [{ heading, items }] }. */
export function buildReport({ analysis, recs, farm, field, period }) {
  const fid = field?.properties?.field_id ?? '';
  const ff = farm?.fields?.find(f => f.field_id === fid);
  const st = id => analysis?.factors?.[id]?.status;
  const danger = FACTORS.filter(f => (st(f.id)?.severity ?? 0) >= 0.5);
  return {
    title: `Season report: ${ff?.name ?? fid.toUpperCase()}`,
    period,
    sections: [
      { heading: 'This period at a glance', items: FACTORS.map(f => `${f.name}: ${st(f.id)?.label ?? 'unavailable'} (${sevText(st(f.id)?.severity)})`) },
      { heading: 'What is in danger', items: danger.length ? danger.map(f => `${f.name}: severity ${num(st(f.id).severity, 2)}, percentile p${Math.round(st(f.id).percentile)}`) : ['No factor is at high severity.'] },
      { heading: 'How often this happens', items: FACTORS.map(f => `${f.name}: ${analysis?.factors?.[f.id]?.recurrence?.text ?? 'unavailable'}`) },
      { heading: 'Top 3 recommended actions', items: (recs?.top3 ?? []).map((c, i) => `${i + 1}. ${c.title} (score ${num(c.score, 2)}). ${(c.evidence ?? []).map(e => `${e.text}: ${e.value ?? ''}`).join('; ')}`) },
      { heading: 'Rotation outlook', items: (recs?.rotations ?? []).map(r => `${r.name}${r.is_current ? ' (current)' : ''}: water shortfall ${r.metrics?.shortfall_years ?? 'unavailable'}, median irrigation need ${num(r.metrics?.median_irrigation_need_mm)} mm`) },
      { heading: 'Your records this period', items: (ff?.records ?? []).slice(-3).map(r => `${r.period} ${r.year}: ${r.crop}, irrigation ${num(r.irrigation_mm)} mm, nitrogen ${num(r.nitrogen_kg_ha)} kg/ha, yield ${num(r.yield)} ${r.yield_unit ?? ''}`) },
      { heading: 'Data used and limits', items: ['NASA POWER daily weather (about 50 km cells, regional, ~3-day delay).', 'MODIS NDVI 250 m (greenness, not cause).', 'USDA SSURGO soil storage and CDL crop history (satellite-inferred; confirm with the farmer).', 'Crop water demand is ET₀ × Kc, not metered pumping.', `Data through ${fmtDate(analysis?.data_quality?.live_through)}.`, ...(analysis?.sample ? ['THIS REPORT USES SAMPLE ANALYSIS VALUES (engine not connected).'] : [])] },
      { heading: 'Before acting', items: ['Review with your agronomist or K-State Research and Extension before acting.'] },
    ],
  };
}

export async function openReport({ ctx, analysis, rec, farm, field }) {
  const body = $('report-body');
  body.innerHTML = '<p class="state">Building report…</p>';
  $('dlg-report').showModal();
  try {
    const period = `Season ${new Date().getFullYear()}`;
    const r = await viaIntegration(ctx, { analysis, recs: rec, farm, field, period });
    body.innerHTML = `<p class="fine">${esc(r.title)} · ${esc(r.period ?? period)} · generated ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))} UTC${farm?.synthetic ? ' · synthetic demo farm' : ''}</p>
      ${(r.sections ?? []).map(s => `<section class="rep-sec"><h3>${esc(s.heading)}</h3><ul>${(s.items ?? []).map(i => `<li>${esc(typeof i === 'string' ? i : i.text ?? JSON.stringify(i))}</li>`).join('') || '<li>None recorded.</li>'}</ul></section>`).join('')}`;
  } catch (e) { body.innerHTML = `<p class="state err">Could not build the report: ${esc(e.message)}</p>`; }
}
