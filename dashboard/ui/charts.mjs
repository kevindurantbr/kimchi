// Chart.js wrappers themed from the CSS variables. MOTION dial 1: no chart animation.
import { cssVar, fmtDate, fmtVal } from './util.mjs';

const live = new Map();

export function destroyCharts(prefix = '') {
  for (const [id, c] of live) if (id.startsWith(prefix)) { c.destroy(); live.delete(id); }
}

function theme() {
  return { ink: cssVar('--ink'), muted: cssVar('--muted'), line: cssVar('--line'), acc: cssVar('--acc'), alert: cssVar('--alert'), raised: cssVar('--raised'), mono: cssVar('--font-mono') };
}

export function makeChart(canvas, config) {
  if (!canvas || typeof Chart === 'undefined') return null;
  live.get(canvas.id)?.destroy();
  const t = theme();
  const base = {
    animation: false, responsive: true, maintainAspectRatio: false, normalized: true,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom', labels: { color: t.muted, boxWidth: 10, boxHeight: 10, font: { family: t.mono, size: 10.5 }, filter: i => !i.text.startsWith('_') } },
      tooltip: { backgroundColor: t.raised, titleColor: t.ink, bodyColor: t.ink, borderColor: t.line, borderWidth: 1, titleFont: { family: t.mono }, bodyFont: { family: t.mono },
                 filter: i => !i.dataset.label.startsWith('_'),
                 callbacks: { label: i => `${i.dataset.label}: ${fmtVal(i.parsed.y)}` } },
    },
    scales: {
      x: { ticks: { color: t.muted, font: { family: t.mono, size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 }, grid: { color: t.line, drawTicks: false }, border: { color: t.line } },
      y: { ticks: { color: t.muted, font: { family: t.mono, size: 10 }, maxTicksLimit: 5 }, grid: { color: t.line, drawTicks: false }, border: { color: t.line },
           title: { display: !!config.yTitle, text: config.yTitle, color: t.muted, font: { family: t.mono, size: 10 } } },
    },
  };
  const opts = merge(base, config.options ?? {});
  const chart = new Chart(canvas, { type: config.type ?? 'line', data: config.data, options: opts });
  live.set(canvas.id, chart);
  return chart;
}

function merge(a, b) {
  for (const k of Object.keys(b)) a[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] ? merge({ ...a[k] }, b[k]) : b[k];
  return a;
}

/** Short date tick labels for ISO date category axes. */
export const dateTicks = () => ({ x: { ticks: { callback(v) { const d = this.getLabelForValue(v); return d ? fmtDate(d).replace(/, \d{4}$/, '') : ''; } } } });

/** Line chart with a p25–p75 normal band, a median line and the observed lines. */
export function bandChart(canvas, { labels, lo, hi, mid, lines, yTitle, bandLabel = 'Normal range (p25–p75)' }) {
  const t = theme();
  const ds = [];
  if (lo && hi) {
    ds.push({ label: '_lo', data: lo, borderWidth: 0, pointRadius: 0, fill: false, spanGaps: false });
    ds.push({ label: bandLabel, data: hi, borderWidth: 0, pointRadius: 0, backgroundColor: hexA(t.muted, .22), fill: '-1', spanGaps: false });
  }
  if (mid) ds.push({ label: 'Normal median', data: mid, borderColor: t.muted, borderDash: [4, 3], borderWidth: 1.2, pointRadius: 0, spanGaps: false });
  for (const l of lines) ds.push({ pointRadius: 0, borderWidth: 2, spanGaps: false, tension: .15, ...l });
  return makeChart(canvas, { data: { labels, datasets: ds }, yTitle, options: { scales: dateTicks(labels) } });
}

export function hexA(color, a) {
  const m = color.match(/^#([0-9a-f]{6})$/i);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
export { theme };
