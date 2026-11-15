// Kimchi farm store: the farmer's private records, kept ONLY in this browser
// (localStorage key "kimchi.farm.v1") with JSON export/import. No server, no
// accounts; farmer data never goes to GitHub.
//
// If localStorage is unavailable (private windows, blocked storage) the store
// falls back to memory and sets farm.storage = "memory" so the UI can warn.
//
// Schema: PLAN.md §7.2 ("kimchi.farm.1"). Owner: P1.

import { polygonAreaHa } from './sources.mjs';

export const STORAGE_KEY = 'kimchi.farm.v1';
export const SCHEMA = 'kimchi.farm.1';
export const PERIODS = ['season', 'Q1', 'Q2', 'Q3', 'Q4'];

let memoryFarm = null; // in-memory fallback
let lastStorageMode = 'localStorage';

function storage() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const probe = '__kimchi_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

/** "localStorage" or "memory": where saveFarm last put the data. */
export function storageMode() {
  return lastStorageMode;
}

const clone = (x) => (x === null || x === undefined ? x : JSON.parse(JSON.stringify(x)));

/** Strip runtime-only keys before saving/exporting. */
function serializable(farm) {
  const f = clone(farm);
  delete f.storage;
  return f;
}

/**
 * Load the saved farm, or null if none is saved.
 * The returned object carries storage: "localStorage" | "memory".
 */
export function loadFarm() {
  const ls = storage();
  if (ls) {
    try {
      const txt = ls.getItem(STORAGE_KEY);
      lastStorageMode = 'localStorage';
      if (!txt) return memoryFarm ? { ...clone(memoryFarm), storage: 'memory' } : null;
      const farm = JSON.parse(txt);
      return { ...farm, storage: 'localStorage' };
    } catch {
      // fall through to memory
    }
  }
  lastStorageMode = 'memory';
  return memoryFarm ? { ...clone(memoryFarm), storage: 'memory' } : null;
}

/** Save the farm. Returns the farm with storage set to where it was saved. */
export function saveFarm(farm) {
  const data = serializable(farm);
  data.updated_at = new Date().toISOString();
  const ls = storage();
  if (ls) {
    try {
      ls.setItem(STORAGE_KEY, JSON.stringify(data));
      lastStorageMode = 'localStorage';
      memoryFarm = null;
      return { ...data, storage: 'localStorage' };
    } catch {
      // quota exceeded or blocked → memory
    }
  }
  memoryFarm = clone(data);
  lastStorageMode = 'memory';
  return { ...data, storage: 'memory' };
}

/** Remove the saved farm from this browser. */
export function clearFarm() {
  memoryFarm = null;
  const ls = storage();
  if (ls) {
    try { ls.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }
}

/**
 * Fetch the bundled synthetic demo farm.
 * @param {string} [url] defaults to data/demo_farm.json relative to this module.
 */
export async function loadDemoFarm(url) {
  const href = url || new URL('../data/demo_farm.json', import.meta.url).href;
  let farm;
  if (href.startsWith('file:')) {
    // Node: fetch() cannot read file: URLs
    const fs = await import('node:fs');
    farm = JSON.parse(fs.readFileSync(new URL(href), 'utf8'));
  } else {
    const res = await fetch(href);
    if (!res.ok) throw new Error(`Demo farm unavailable: HTTP ${res.status}`);
    farm = await res.json();
  }
  return { ...farm, storage: storageMode() };
}

/** Suggested export filename, e.g. kimchi-farm-2026-11-15.json */
export function exportFilename(date = new Date()) {
  return `kimchi-farm-${date.toISOString().slice(0, 10)}.json`;
}

/**
 * Export the farm as a pretty-printed JSON Blob. The Blob has a `filename`
 * property (kimchi-farm-YYYY-MM-DD.json) for the download link.
 */
export function exportFarm(farm) {
  const blob = new Blob([JSON.stringify(serializable(farm), null, 2) + '\n'], { type: 'application/json' });
  try { Object.defineProperty(blob, 'filename', { value: exportFilename(), enumerable: true }); } catch { /* ignore */ }
  return blob;
}

/** Browser helper: trigger a download of exportFarm(farm). */
export function downloadFarm(farm) {
  const blob = exportFarm(farm);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = blob.filename || exportFilename();
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

/**
 * Read and validate an exported farm file (File, Blob, or JSON string).
 * Rejects with an Error listing the problems if the schema does not validate.
 */
export async function importFarm(file) {
  let text;
  if (typeof file === 'string') text = file;
  else if (file && typeof file.text === 'function') text = await file.text();
  else throw new Error('importFarm: expected a File, Blob or JSON string');
  let obj;
  try { obj = JSON.parse(text); } catch (err) { throw new Error(`Not a JSON file: ${err.message}`); }
  const v = validateFarm(obj);
  if (!v.ok) throw new Error(`Farm file is not valid:\n- ${v.errors.join('\n- ')}`);
  delete obj.storage;
  return obj;
}

/** A new, empty farm (not synthetic). */
export function newFarm(name = 'My farm') {
  return {
    schema: SCHEMA,
    farm_name: name,
    synthetic: false,
    priorities: { water: 0.4, soil: 0.3, income: 0.3 },
    constraints: { annual_allocation_mm: null, equipment: [], markets: [] },
    fields: [],
  };
}

function findField(farm, field_id) {
  const f = (farm.fields || []).find((x) => x.field_id === field_id);
  if (!f) throw new Error(`No field ${field_id} in this farm`);
  return f;
}

/**
 * Insert or replace a record (matched on year + period). Returns a NEW farm;
 * call saveFarm() to persist.
 */
export function upsertRecord(farm, field_id, record) {
  const next = clone(serializable(farm));
  const f = findField(next, field_id);
  const rec = { period: 'season', ...clone(record) };
  rec.year = Number(rec.year);
  f.records = f.records || [];
  const i = f.records.findIndex((r) => r.year === rec.year && (r.period || 'season') === rec.period);
  if (i >= 0) f.records[i] = { ...f.records[i], ...rec };
  else f.records.push(rec);
  f.records.sort((a, b) => a.year - b.year || PERIODS.indexOf(a.period) - PERIODS.indexOf(b.period));
  return { ...next, storage: farm.storage };
}

/** Delete a record by year (+ period, default "season"). Returns a NEW farm. */
export function deleteRecord(farm, field_id, year, period = 'season') {
  const next = clone(serializable(farm));
  const f = findField(next, field_id);
  f.records = (f.records || []).filter((r) => !(r.year === Number(year) && (r.period || 'season') === period));
  return { ...next, storage: farm.storage };
}

/**
 * Add a farmer-drawn field. geometry: GeoJSON Polygon/MultiPolygon (WGS84).
 * area_ha is computed on a sphere. Returns a NEW farm; the new field is last.
 */
export function addField(farm, { name, geometry, field_id, well_capacity_gpm = null }) {
  const next = clone(serializable(farm || newFarm()));
  next.fields = next.fields || [];
  let id = field_id;
  if (!id) {
    let k = next.fields.length + 1;
    do { id = `user${String(k).padStart(2, '0')}`; k++; } while (next.fields.some((f) => f.field_id === id));
  }
  if (next.fields.some((f) => f.field_id === id)) throw new Error(`Field id ${id} already exists`);
  const area = polygonAreaHa(geometry);
  next.fields.push({
    field_id: id,
    name: name || `Field ${next.fields.length + 1}`,
    geometry: clone(geometry),
    area_ha: area === null ? null : Math.round(area * 100) / 100,
    well_capacity_gpm,
    boundary_status: 'farmer_drawn',
    records: [],
  });
  return { ...next, storage: farm?.storage };
}

/** Remove a field. Returns a NEW farm. */
export function removeField(farm, field_id) {
  const next = clone(serializable(farm));
  next.fields = (next.fields || []).filter((f) => f.field_id !== field_id);
  return { ...next, storage: farm.storage };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const numOrNull = (v) => v === null || v === undefined || isNum(v);
const isoDate = (v) => v === null || v === undefined || v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Validate a farm object against kimchi.farm.1. Returns {ok, errors[]}. */
export function validateFarm(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, errors: ['Not a JSON object'] };
  if (obj.schema !== SCHEMA) errors.push(`schema must be "${SCHEMA}" (got ${JSON.stringify(obj.schema)})`);
  if (typeof obj.farm_name !== 'string') errors.push('farm_name must be a string');
  if (obj.synthetic !== undefined && typeof obj.synthetic !== 'boolean') errors.push('synthetic must be true/false');
  if (obj.priorities !== undefined) {
    const p = obj.priorities;
    const keys = ['water', 'soil', 'income'];
    if (!p || typeof p !== 'object') errors.push('priorities must be an object');
    else {
      for (const k of keys) if (!isNum(p[k]) || p[k] < 0 || p[k] > 1) errors.push(`priorities.${k} must be a number 0–1`);
      const sum = keys.reduce((s, k) => s + (isNum(p[k]) ? p[k] : 0), 0);
      if (keys.every((k) => isNum(p[k])) && Math.abs(sum - 1) > 0.02) errors.push(`priorities must sum to 1 (got ${sum.toFixed(2)})`);
    }
  }
  if (obj.constraints !== undefined) {
    const c = obj.constraints;
    if (!c || typeof c !== 'object') errors.push('constraints must be an object');
    else {
      if (!numOrNull(c.annual_allocation_mm)) errors.push('constraints.annual_allocation_mm must be a number or null');
      for (const k of ['equipment', 'markets']) if (c[k] !== undefined && !Array.isArray(c[k])) errors.push(`constraints.${k} must be an array`);
    }
  }
  if (!Array.isArray(obj.fields)) errors.push('fields must be an array');
  else {
    const ids = new Set();
    obj.fields.forEach((f, i) => {
      const at = `fields[${i}]`;
      if (!f || typeof f !== 'object') { errors.push(`${at} must be an object`); return; }
      if (typeof f.field_id !== 'string' || !f.field_id) errors.push(`${at}.field_id is required`);
      else if (ids.has(f.field_id)) errors.push(`${at}.field_id "${f.field_id}" is duplicated`);
      else ids.add(f.field_id);
      if (f.geometry !== undefined && f.geometry !== null
        && !(f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')) {
        errors.push(`${at}.geometry must be a GeoJSON Polygon or MultiPolygon`);
      }
      if (!numOrNull(f.area_ha)) errors.push(`${at}.area_ha must be a number or null`);
      if (!numOrNull(f.well_capacity_gpm)) errors.push(`${at}.well_capacity_gpm must be a number or null`);
      if (f.records !== undefined && !Array.isArray(f.records)) { errors.push(`${at}.records must be an array`); return; }
      const seen = new Set();
      (f.records || []).forEach((r, j) => {
        const rt = `${at}.records[${j}]`;
        if (!r || typeof r !== 'object') { errors.push(`${rt} must be an object`); return; }
        if (!Number.isInteger(r.year) || r.year < 1900 || r.year > 2100) errors.push(`${rt}.year must be an integer year`);
        const period = r.period ?? 'season';
        if (!PERIODS.includes(period)) errors.push(`${rt}.period must be one of ${PERIODS.join(', ')}`);
        const key = `${r.year}|${period}`;
        if (seen.has(key)) errors.push(`${rt} duplicates year ${r.year} ${period}`);
        seen.add(key);
        if (r.crop !== undefined && r.crop !== null && typeof r.crop !== 'string') errors.push(`${rt}.crop must be a string`);
        for (const k of ['irrigation_mm', 'nitrogen_kg_ha', 'yield']) {
          if (!numOrNull(r[k])) errors.push(`${rt}.${k} must be a number or null`);
          else if (isNum(r[k]) && r[k] < 0) errors.push(`${rt}.${k} must not be negative`);
        }
        for (const k of ['planting_date', 'harvest_date']) if (!isoDate(r[k])) errors.push(`${rt}.${k} must be YYYY-MM-DD`);
      });
    });
  }
  return { ok: errors.length === 0, errors };
}
