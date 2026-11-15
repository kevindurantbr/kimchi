// Small shared helpers for the UI modules. No data logic lives here.

export const FACTORS = [
  { id: 'water', name: 'Water balance', code: 'F-01' },
  { id: 'temperature', name: 'Temperature', code: 'F-02' },
  { id: 'soil_moisture', name: 'Soil moisture', code: 'F-03' },
  { id: 'crop_condition', name: 'Crop condition', code: 'F-04' },
];
export const factorName = id => FACTORS.find(f => f.id === id)?.name ?? id;

export const $ = id => document.getElementById(id);
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const finite = v => typeof v === 'number' && Number.isFinite(v);
export const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** Format a number, or the word "unavailable" for null/missing (never 0). */
export function num(v, digits = 0) {
  return finite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : 'unavailable';
}
export const pct = v => (finite(v) ? `p${Math.round(v)}` : 'p—');

/** Severity 0..1 to a 3-step class. Text always accompanies the colour. */
export function sevClass(s) {
  if (!finite(s) || s < 0.25) return 0;
  return s < 0.6 ? 1 : 2;
}
export const sevText = s => (finite(s) ? ['Normal range', 'Watch', 'High'][sevClass(s)] : 'Unavailable');

/** Only http(s) links are rendered. */
export function safeURL(u) {
  try { const x = new URL(u, location.href); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; }
}

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function fmtDate(iso) {
  if (!iso) return 'unavailable';
  if (/^\d{2}-\d{2}$/.test(iso)) { // "MM-DD" normals have no year
    const d = new Date(`2001-${iso}T00:00:00`);
    return isNaN(d) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  return isNaN(d) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function download(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Polygon centroid (vertex mean is enough for small field polygons). */
export function centroid(geometry) {
  const ring = geometry.type === 'MultiPolygon' ? geometry.coordinates[0][0] : geometry.coordinates[0];
  const pts = ring.slice(0, -1);
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

/** Colour ramps for data (separate from the UI palette). Returns an rgb() string for t in 0..1. */
const RAMPS = {
  // brown (dry) to blue (wet): water and soil moisture
  drywet: ['#8c510a', '#bf812d', '#dfc27d', '#c7e0de', '#5ab4ac', '#01665e'],
  // sequential heat
  heat: ['#fff3c4', '#fdd17a', '#fca24f', '#f0663a', '#c8331f', '#7f1610'],
  // NDVI greenness
  ndvi: ['#7a5a32', '#b39b5a', '#d9d27a', '#9bc45a', '#4f9a3c', '#1d5e2a'],
};
export function ramp(name, t) {
  const stops = RAMPS[name]; if (!finite(t)) return null;
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  const a = hex(stops[i]), b = hex(stops[i + 1]);
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`;
}
export const rampCSS = name => `linear-gradient(90deg, ${RAMPS[name].join(',')})`;
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
