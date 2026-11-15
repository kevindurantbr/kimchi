// TEMPORARY stand-in for P1's dashboard/lib/farmStore.mjs (PLAN.md 7.2 API). Delete when P1's module lands;
// integrate.mjs prefers lib/farmStore.mjs automatically. Farm data stays in this browser (localStorage).
const KEY = 'kimchi.farm.v1';
export let storage = 'localStorage';
let memory = null;

function canStore() {
  try { localStorage.setItem('kimchi.test', '1'); localStorage.removeItem('kimchi.test'); return true; } catch { return false; }
}
export function loadFarm() {
  if (!canStore()) { storage = 'memory'; return memory; }
  try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}
export function saveFarm(farm) {
  if (!canStore()) { storage = 'memory'; memory = farm; return farm; }
  localStorage.setItem(KEY, JSON.stringify(farm)); return farm;
}
export async function loadDemoFarm() {
  const r = await fetch('data/demo_farm.json').catch(() => null);
  if (r?.ok) return r.json();
  return (await fetch('ui/_fixtures/demo_farm.json')).json();
}
export function exportFarm(farm) {
  return new Blob([JSON.stringify(farm, null, 2)], { type: 'application/json' });
}
export async function importFarm(file) {
  const farm = JSON.parse(await file.text());
  if (farm?.schema !== 'kimchi.farm.1' || !Array.isArray(farm.fields)) throw new Error('Not a Kimchi farm file (schema kimchi.farm.1)');
  return farm;
}
export function upsertRecord(farm, field_id, record) {
  const f = farm.fields.find(x => x.field_id === field_id); if (!f) throw new Error('Unknown field ' + field_id);
  f.records ??= [];
  const i = f.records.findIndex(r => r.year === record.year && r.period === record.period);
  if (i >= 0) f.records[i] = record; else f.records.push(record);
  f.records.sort((a, b) => a.year - b.year || String(a.period).localeCompare(String(b.period)));
  return farm;
}
export function deleteRecord(farm, field_id, year, period) {
  const f = farm.fields.find(x => x.field_id === field_id); if (!f) return farm;
  f.records = (f.records ?? []).filter(r => !(r.year === year && r.period === period));
  return farm;
}
export function addField(farm, { name, geometry }) {
  const field_id = 'usr_' + Date.now().toString(36);
  const field = { field_id, name, geometry, area_ha: areaHa(geometry), well_capacity_gpm: null, records: [] };
  farm.fields.push(field);
  return field;
}
/** Spherical polygon area (ha), no library. */
function areaHa(geometry) {
  const R = 6378137, ring = geometry.coordinates[0]; let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [l1, p1] = ring[i].map(v => v * Math.PI / 180), [l2, p2] = ring[i + 1].map(v => v * Math.PI / 180);
    s += (l2 - l1) * (2 + Math.sin(p1) + Math.sin(p2));
  }
  return Math.round(Math.abs(s * R * R / 2) / 1e3) / 10;
}
