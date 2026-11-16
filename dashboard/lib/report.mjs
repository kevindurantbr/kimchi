// AI disclosure: written with an AI coding assistant (Claude Code); the team is responsible for reviewing it (Space Apps AI rules).
// Kimchi season / quarter report. Owner: P4. Pure functions, browser + Node 18+.
//
//   buildReport({ analysis, recs, farm, field, period }) → { title, period, sections: [{ heading, items }] }
//   reportToMarkdown(report) → printable text
//
// Each item is { text, detail?, sub?: [text], severity?, factor?, source_ids? }. P3 renders and prints it.

import { FACTORS, FACTOR_NAMES, EXPERT_LINE, parseXofN } from './recommend.mjs';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const sevWord = (s) => (!isNum(s) ? 'not rated' : s >= 0.75 ? 'high' : s >= 0.5 ? 'elevated' : s > 0 ? 'mild' : 'normal');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const WHERE = {
  water: 'Estimated for this field from the NASA POWER weather cell (~50 km) and SSURGO soil storage',
  temperature: 'NASA POWER weather cell (~50 km) covering this field: regional, not a field sensor',
  soil_moisture: 'NASA POWER root-zone wetness (model-based, MERRA-2) for the ~50 km cell',
  crop_condition: 'MODIS 250 m NDVI pixels inside the field outline',
};

export const STANDARD_LIMITS = [
  'NASA POWER weather is about 50 km per cell: regional context, not a measurement in your field.',
  'Root-zone wetness from POWER is model-based (MERRA-2 reanalysis), not a satellite or probe measurement.',
  'Crop water demand is estimated as reference ET × crop coefficient (FAO-56). It is not metered pumping and not OpenET.',
  'NDVI shows greenness, not cause. "Low green cover" is not the same as bare soil: dead residue looks similar.',
  'Trends are shown only with at least 30 years of data; recurrence is stated as "X of N years".',
  'Top-3 ranking applies to actions, with the score shown. Rotations get fit indicators, never a "best" label.',
  'No yield, profit or water-saving predictions are made. Your own yields are shown only as your records.',
  'Missing data is shown as "unavailable", never as zero.',
];

function periodLabel(period) {
  if (!period) return 'This season';
  if (typeof period === 'string') return period;
  const p = period.period ?? 'season';
  return p === 'season' ? `${period.year} season` : `${p} ${period.year}`;
}

function recordInPeriod(r, period) {
  if (!period || typeof period === 'string') return true;
  if (r.year !== period.year) return false;
  const p = period.period ?? 'season';
  return p === 'season' ? true : r.period === p;
}

function fmtNum(v, unit) {
  if (!isNum(v)) return 'unavailable';
  const s = Number.isInteger(v) ? String(v) : String(Math.abs(v) < 10 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10);
  return unit ? `${s} ${unit}` : s;
}

function compoundSummary(cc) {
  if (!cc?.counts?.length) return null;
  const sums = Array(12).fill(0);
  const ns = Array(12).fill(0);
  for (const row of cc.counts) {
    (row ?? []).forEach((v, i) => { if (isNum(v)) { sums[i] += v; ns[i] += 1; } });
  }
  const means = sums.map((s, i) => (ns[i] ? s / ns[i] : null));
  const ranked = means.map((m, i) => [m, i]).filter(([m]) => isNum(m) && m > 0).sort((a, b) => b[0] - a[0]);
  if (!ranked.length) return 'Heat, dry soil and water deficit rarely occur together in this record.';
  const top = ranked.slice(0, 2).map(([m, i]) => `${MONTHS[i]} (average ${m.toFixed(1)} of 3 stressors)`);
  return `Stressors pile up most in ${top.join(' and ')} across ${cc.counts.length} years.`;
}

/** Build the report object. Every input may be partial; missing parts become "unavailable" lines. */
export function buildReport({ analysis, recs, farm, field, period }) {
  const a = analysis ?? {};
  const f = a.factors ?? {};
  const fieldId = field?.field_id ?? field?.properties?.field_id ?? recs?.context?.field_id ?? null;
  const farmField = farm?.fields?.find((x) => x.field_id === fieldId) ?? null;
  const fieldName = field?.name ?? field?.properties?.name ?? farmField?.name ?? fieldId ?? 'Field';
  const label = periodLabel(period);
  const synthetic = farm?.synthetic === true;

  // 1. At a glance
  const glance = FACTORS.map((k) => {
    const s = f[k]?.status;
    return {
      factor: k,
      severity: isNum(s?.severity) ? s.severity : null,
      text: `${FACTOR_NAMES[k]}: ${s?.label ?? 'unavailable'}`,
      detail: s ? `Severity ${fmtNum(s.severity)} (${sevWord(s.severity)})${isNum(s.percentile) ? `, percentile ${Math.round(s.percentile)}` : ''}` : 'No data for this period',
      source_ids: s?.source_ids ?? [],
    };
  });

  // 2. What is in danger
  const danger = FACTORS.filter((k) => isNum(f[k]?.status?.severity) && f[k].status.severity >= 0.5).map((k) => ({
    factor: k,
    severity: f[k].status.severity,
    text: `${FACTOR_NAMES[k]}: ${f[k].status.label ?? ''} (severity ${fmtNum(f[k].status.severity)}, ${sevWord(f[k].status.severity)})`,
    detail: `Where: ${WHERE[k]}.`,
  }));
  const cc = a.interactions?.cause_check;
  if (cc?.code && cc.code !== 'none' && cc.text) danger.push({ factor: 'crop_condition', text: `Cause check: ${cc.text}`, detail: 'Greenness shows a problem; weather data suggests the likely cause. It is not a diagnosis.' });
  const cap = a.interactions?.capacity;
  if (cap?.ok === false) danger.push({ factor: 'water', text: `Well capacity: ${cap.text ?? 'peak demand exceeds well output'}`, detail: 'Peak 7-day demand vs the well capacity in your records.' });
  if (!danger.length) danger.push({ text: 'No factor is at an elevated level (severity ≥ 0.5) this period.' });

  // 3. How often this happens
  const often = [];
  for (const k of FACTORS) {
    const r = f[k]?.recurrence;
    const p = parseXofN(r) ?? parseXofN(r?.text);
    if (p) often.push({ factor: k, text: `${FACTOR_NAMES[k]}: ${r?.label ? r.label + ' — ' : ''}${p.text}` });
  }
  const sh = a.interactions?.stage_heat;
  const shp = parseXofN(sh?.recurrence) ?? parseXofN(sh?.years_above_normal);
  if (shp) often.push({ factor: 'temperature', text: `Above-normal heat in the crop's sensitive window: ${shp.text}` });
  const comp = compoundSummary(a.interactions?.compound_calendar);
  if (comp) often.push({ text: comp });
  const lowCover = recs?.context?.derived?.low_cover_months;
  if (isNum(lowCover)) often.push({ factor: 'crop_condition', text: `Low green cover (NDVI < 0.3): about ${fmtNum(lowCover)} months a year on this field. Not the same as bare soil.` });
  if (!often.length) often.push({ text: 'Recurrence unavailable for this period.' });

  // 4. Top 3 actions
  const top = (recs?.top3 ?? []).map((c, i) => ({
    factor: c.factor,
    text: `${i + 1}. ${c.title}${c.status === 'watch' ? ' (watch: not triggered now)' : ''}`,
    detail: c.why?.[0] ?? '',
    sub: [
      ...(c.evidence ?? []).slice(0, 3).map((e) => `Evidence: ${e.text}`),
      `Score ${c.score} = severity ${c.score_parts.severity} × priority ${c.score_parts.priority} × evidence ${c.score_parts.evidence} (${c.score_parts.evidence_level}) × timing ${c.score_parts.timing}`,
      ...(c.risks ?? []).slice(0, 1).map((t) => `Risk: ${t}`),
      ...(c.gaps ?? []).slice(0, 1).map((t) => `Gap: ${t}`),
      `When: ${c.when}`,
      c.expert_check,
    ],
    source_ids: c.source_ids,
  }));
  if (!top.length) top.push({ text: 'No recommendations computed.' });

  // 5. Rotation outlook
  const rot = (recs?.rotations ?? []).map((r) => ({
    text: `${r.role === 'current' ? 'Current' : 'Alternative'}: ${r.name}${r.evidence_status ? ` [${r.evidence_status.replace('_', ' ')}]` : ''}`,
    detail: r.why_suggested,
    sub: [
      ...(r.metrics_text ?? []),
      ...(r.comparison_to_current ?? []),
      ...(r.benefits ?? []).slice(0, 1).map((b) => `Benefit: ${b.text}`),
      ...(r.risks ?? []).slice(0, 1).map((b) => `Risk: ${b.text}`),
      ...(r.gaps ?? []).slice(0, 1).map((b) => `Gap: ${b.text}`),
    ],
    source_ids: r.source_ids,
  }));
  if (rot.length) rot.push({ text: 'Rotations are listed in a fixed order. There is no "best" rotation: the comparison shows fit indicators and evidence for you and your advisor to weigh.' });

  // 6. Your records this period
  const recItems = (farmField?.records ?? []).filter((r) => recordInPeriod(r, period)).map((r) => ({
    text: `${r.year} ${r.period ?? 'season'}: ${r.crop ?? 'crop not entered'}`,
    detail: [
      r.planting_date ? `planted ${r.planting_date}` : null,
      r.harvest_date ? `harvested ${r.harvest_date}` : null,
      isNum(r.irrigation_mm) ? `irrigation ${r.irrigation_mm} mm` : null,
      isNum(r.nitrogen_kg_ha) ? `nitrogen ${r.nitrogen_kg_ha} kg/ha` : null,
      isNum(r.yield) ? `yield ${r.yield} ${r.yield_unit ?? ''}`.trim() : null,
      r.notes ? `notes: ${r.notes}` : null,
    ].filter(Boolean).join('; ') || 'no details entered',
  }));
  if (!recItems.length) recItems.push({ text: 'No records entered for this period. Add them in My farm records.' });
  if (synthetic) recItems.unshift({ text: 'These are SYNTHETIC demo records, not a real farm.' });
  recItems.push({ text: 'Your farm records are stored only in this browser. Export to keep a copy.' });

  // 7. Data used and limits
  const dq = a.data_quality ?? {};
  const limits = [
    { text: `Weather live through: ${dq.live_through ?? 'unavailable'}${isNum(dq.missing_days_this_year) ? ` (${dq.missing_days_this_year} missing days this year)` : ''}` },
    { text: 'Data: NASA POWER daily (weather, root-zone wetness), NASA MODIS MOD13Q1 NDVI (ORNL DAAC), USDA SSURGO soil water storage, USDA CDL crop history, FAO-56 methods, K-State Research and Extension trials and guidance.' },
    ...(dq.notes ?? []).map((t) => ({ text: t })),
    ...STANDARD_LIMITS.map((t) => ({ text: t })),
  ];
  if (a.fixture) limits.unshift({ text: 'This report was built from a FIXTURE analysis (sample numbers), not live data.' });

  return {
    title: `Kimchi report: ${fieldName}, ${label}`,
    period: label,
    field_id: fieldId,
    synthetic,
    generated_at: (recs?.generated_at ?? new Date().toISOString()),
    sections: [
      { heading: 'This period at a glance', items: glance },
      { heading: 'What is in danger', items: danger },
      { heading: 'How often this happens', items: often },
      { heading: 'Top 3 recommended actions', items: top },
      { heading: 'Rotation outlook', items: rot.length ? rot : [{ text: 'Rotation comparison unavailable.' }] },
      { heading: 'Your records this period', items: recItems },
      { heading: 'Data used and limits', items: limits },
      { heading: 'Before you act', items: [{ text: EXPERT_LINE }] },
    ],
  };
}

/** Plain Markdown version of the report, for printing, download or copy-paste. */
export function reportToMarkdown(report) {
  const lines = [`# ${report.title}`, '', `Generated ${report.generated_at}${report.synthetic ? ' · demo farm (synthetic)' : ''}`, ''];
  for (const s of report.sections) {
    lines.push(`## ${s.heading}`, '');
    for (const it of s.items) {
      lines.push(`- ${it.text}`);
      if (it.detail) lines.push(`  ${it.detail}`);
      for (const sub of it.sub ?? []) if (sub) lines.push(`  - ${sub}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
