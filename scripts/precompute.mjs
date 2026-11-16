#!/usr/bin/env node
// Kimchi precompute: writes the static data files the dashboard reads.
//
//   node scripts/precompute.mjs site      → dashboard/data/site_history.json
//   node scripts/precompute.mjs fields    → dashboard/data/demo_fields.geojson
//   node scripts/precompute.mjs ndvi      → dashboard/data/fields_ndvi.json
//   node scripts/precompute.mjs grid      → dashboard/data/region_grid.json
//   node scripts/precompute.mjs sources   → dashboard/data/sources.json
//   node scripts/precompute.mjs all
//
// Options: --ndvi-start=YYYY-MM-DD (default 2001-01-01), --end=YYYY-MM-DD (default today, UTC),
//          --ndvi-source=auto|ornl|pc (default auto)
// Node 18+, no npm dependencies. See scripts/README.md.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  fetchPowerDaily, fetchModisNdvi, fieldMeanSeries, polygonAreaHa, polygonCenter,
  pointInPolygon, powerSiteId, lastValidDate, ndviFromRaw, modisPixelPolygons, modisPixelCenters,
} from '../dashboard/lib/sources.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'dashboard', 'data');
const RESEARCH = path.join(ROOT, 'research', 'deliverables', 'fields-soils');

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : dflt;
};
const TODAY = opt('end', new Date().toISOString().slice(0, 10));

// Demo site: centre of fld01. All three demo fields fall in POWER cell (39.5, -100.625).
const DEMO_SITE = { lat: 39.39758, lon: -100.67829 };
const DEMO_SITE_ID = powerSiteId(DEMO_SITE.lat, DEMO_SITE.lon);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
function writeJson(file, obj, { pretty = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const txt = pretty ? JSON.stringify(obj, null, 1) : JSON.stringify(obj);
  fs.writeFileSync(file, txt + '\n');
  const mb = (Buffer.byteLength(txt) / 1e6).toFixed(2);
  console.log(`wrote ${path.relative(ROOT, file)} (${mb} MB)`);
  return Number(mb);
}
const r2 = (x, d = 2) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

async function withRetry(fn, label, retries = 1) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (err) {
      if (i >= retries) throw err;
      console.warn(`  ${label}: ${err.message} — retrying in 3 s`);
      await sleep(3000);
    }
  }
}

/** Drop trailing days on which every parameter is null (POWER lag). */
function trimTrailing(daily) {
  const keys = Object.keys(daily).filter((k) => k !== 'date');
  let n = daily.date.length;
  while (n > 0 && keys.every((k) => daily[k][n - 1] === null)) n--;
  const out = {};
  for (const k of Object.keys(daily)) out[k] = daily[k].slice(0, n);
  return out;
}

// ---------------------------------------------------------------------------
// site
// ---------------------------------------------------------------------------
async function site() {
  console.log(`site: POWER daily ${DEMO_SITE_ID} 1981-01-01..${TODAY}`);
  const p = await withRetry(() => fetchPowerDaily({ ...DEMO_SITE, start: '1981-01-01', end: TODAY, timeoutMs: 120000 }), 'POWER');
  const daily = trimTrailing(p.daily);
  const last_valid = {};
  for (const k of Object.keys(daily)) if (k !== 'date') last_valid[k] = lastValidDate(daily, k);
  const out = {
    generated_at: new Date().toISOString(),
    source_ids: ['NASA_POWER_DAILY'],
    notes: [
      'Null = missing (POWER fill value -999 or not yet available). Never 0.',
      'POWER is ~0.5° x 0.625° (about 50 km) reanalysis-based data: regional context, not a field measurement.',
      'allsky_sw_dwn (daily solar radiation) starts in 1984; 1981–1983 values are null.',
      'gwetroot / gwettop are model-based (MERRA-2 / GEOS) soil wetness, 0–1, not satellite measurements.',
      'POWER lags ~3 days (radiation longer); trailing days with every value missing are trimmed.',
    ],
    sites: [{
      site_id: DEMO_SITE_ID,
      lat: DEMO_SITE.lat,
      lon: DEMO_SITE.lon,
      power_cell: { lat_center: 39.5, lon_center: -100.625, cell_size_deg: [0.625, 0.5] },
      field_ids: ['fld01', 'fld02', 'fld03'],
      start: daily.date[0],
      end: daily.date[daily.date.length - 1],
      elevation_m: p.elevation_m,
      last_valid,
      units: p.units,
      api_version: p.api_version,
      power_sources: p.sources,
      retrieved_at: p.retrieved_at,
      request_url: p.request_url,
      daily,
    }],
  };
  const mb = writeJson(path.join(DATA, 'site_history.json'), out);
  if (mb > 8) console.warn('site_history.json > 8 MB: consider rounding to 2 decimals');
  console.log(`  ${daily.date.length} days ${out.sites[0].start}..${out.sites[0].end}; last valid:`, last_valid);
}

// ---------------------------------------------------------------------------
// fields
// ---------------------------------------------------------------------------
const CROP_ID = { Corn: 'corn', Sorghum: 'sorghum', 'Winter Wheat': 'winter_wheat', Fallow: 'fallow',
  'Fallow/Idle Cropland': 'fallow' };

function fields() {
  const fc = readJson(path.join(RESEARCH, 'fields.geojson'));
  const obs = readJson(path.join(RESEARCH, 'field_observations.json'));
  const features = fc.features.filter((f) => ['fld01', 'fld02', 'fld03'].includes(f.properties.field_id)).map((f) => {
    const id = f.properties.field_id;
    const soils = obs.soils.filter((s) => s.field_id === id);
    const aws = (bottom) => soils.find((s) => s.property === 'available_water_storage' && s.depth_bottom_cm === bottom);
    const drn = soils.find((s) => s.property === 'drainage_class_dominant_condition');
    const hyd = soils.find((s) => s.property === 'hydrologic_group_dominant_condition');
    const years = [...new Set(obs.crop_history.filter((c) => c.field_id === id).map((c) => c.year))].sort();
    const crop_history = years.map((year) => {
      const rows = obs.crop_history.filter((c) => c.field_id === id && c.year === year && !/^Other/.test(c.crop));
      rows.sort((a, b) => b.crop_fraction - a.crop_fraction);
      const top = rows[0];
      return { year, crop: CROP_ID[top.crop] ?? top.crop.toLowerCase().replace(/\W+/g, '_'),
        cdl_class: top.crop, crop_fraction: top.crop_fraction };
    });
    const { lat, lon } = polygonCenter(f.geometry);
    return {
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        ...f.properties,
        name: { fld01: 'North pivot', fld02: 'South pivot', fld03: 'West pivot' }[id],
        area_ha: r2(polygonAreaHa(f.geometry), 2),
        center: { lat: r2(lat, 5), lon: r2(lon, 5) },
        site_id: DEMO_SITE_ID,
        soil: {
          aws_0_150_cm: aws(150)?.value ?? null,
          aws_0_100_cm: aws(100)?.value ?? null,
          aws_0_50_cm: aws(50)?.value ?? null,
          aws_0_25_cm: aws(25)?.value ?? null,
          aws_unit: 'cm of water',
          aws_coverage: aws(150)?.coverage_fraction ?? null,
          drainage: drn?.value ?? null,
          drainage_share: drn?.coverage_fraction ?? null,
          hydgrp: hyd?.value ?? null,
          hydgrp_share: hyd?.coverage_fraction ?? null,
          method: aws(150)?.aggregation_method ?? null,
          source_ids: ['USDA_SSURGO_SDA'],
        },
        crop_history,
        crop_history_source_ids: ['USDA_CDL'],
        boundary_status: 'approximate',
        history_status: 'satellite_inferred_needs_farmer_confirmation',
      },
    };
  });
  const out = {
    type: 'FeatureCollection',
    generated_at: new Date().toISOString(),
    source_ids: ['USDA_CDL', 'USDA_SSURGO_SDA', 'NASA_POWER_DAILY'],
    notes: [
      'Boundaries are approximate pivot circles centred on PLSS quarter sections (research/deliverables/fields-soils). Not surveyed fields or parcels.',
      'crop_history is the dominant USDA CDL class per year (satellite-inferred); the farmer must confirm it.',
      'soil values are SSURGO estimates of water-holding capacity, not current soil moisture.',
    ],
    features,
  };
  writeJson(path.join(DATA, 'demo_fields.geojson'), out);
  for (const f of features) {
    console.log(`  ${f.properties.field_id} ${f.properties.area_ha} ha  ${f.properties.crop_history.map((c) => `${c.year}:${c.crop}`).join(' ')}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// grid: annual indicators per POWER cell
// ---------------------------------------------------------------------------
const GRID = { bbox: [-102.0, 38.5, -99.0, 40.5], dlon: 0.625, dlat: 0.5 };
const GRID_YEARS = [1981, 2025];

/** Extraterrestrial radiation Ra (MJ m-2 day-1), FAO-56 eq. 21. */
function extraterrestrialRa(latDeg, doy) {
  const phi = (latDeg * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365);
  const delta = 0.409 * Math.sin((2 * Math.PI * doy) / 365 - 1.39);
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta))));
  return ((24 * 60) / Math.PI) * 0.082 * dr
    * (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws));
}

/** Hargreaves ET0 (mm/day), FAO-56 eq. 52; Ra converted to mm/day with 0.408. */
function hargreavesEt0(tmax, tmin, latDeg, doy) {
  if (tmax === null || tmin === null) return null;
  const tmean = (tmax + tmin) / 2;
  return 0.0023 * (tmean + 17.8) * Math.sqrt(Math.max(0, tmax - tmin)) * 0.408 * extraterrestrialRa(latDeg, doy);
}

function doyOf(iso) {
  const y = Number(iso.slice(0, 4));
  return Math.round((Date.UTC(y, Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) - Date.UTC(y, 0, 1)) / 86400000) + 1;
}

/** Annual indicators for one cell from POWER daily arrays. Null if any needed day is missing. */
function annualIndicators(daily, lat, years) {
  const byYear = new Map(years.map((y) => [y, []]));
  daily.date.forEach((d, i) => { const y = Number(d.slice(0, 4)); if (byYear.has(y)) byYear.get(y).push(i); });
  const res = { season_precip_mm: [], season_deficit_mm: [], hot_days_35c: [], gdd_may_sep: [], gwetroot_jul: [] };
  for (const y of years) {
    const idx = byYear.get(y);
    const month = (i) => Number(daily.date[i].slice(5, 7));
    const mayS = idx.filter((i) => month(i) >= 5 && month(i) <= 9);
    const jja = idx.filter((i) => month(i) >= 6 && month(i) <= 8);
    const jul = idx.filter((i) => month(i) === 7);
    const full = (arr, expected) => arr.length === expected;
    const tx = daily.t2m_max;
    const tn = daily.t2m_min;
    const pr = daily.prectotcorr;

    // May–Sep rain (153 days)
    const precipOk = full(mayS, 153) && mayS.every((i) => pr[i] !== null);
    const precip = precipOk ? mayS.reduce((s, i) => s + pr[i], 0) : null;
    res.season_precip_mm.push(r2(precip, 1));

    // Deficit: rain − Σ ET0 × Kc(1.0)
    const tempOk = full(mayS, 153) && mayS.every((i) => tx[i] !== null && tn[i] !== null);
    const et0 = tempOk ? mayS.reduce((s, i) => s + hargreavesEt0(tx[i], tn[i], lat, doyOf(daily.date[i])), 0) : null;
    res.season_deficit_mm.push(precipOk && tempOk ? r2(precip - et0 * 1.0, 1) : null);

    // Hot days ≥ 35 °C, Jun–Aug (92 days)
    res.hot_days_35c.push(full(jja, 92) && jja.every((i) => tx[i] !== null)
      ? jja.filter((i) => tx[i] >= 35).length : null);

    // GDD 10/30 °C, May–Sep
    res.gdd_may_sep.push(tempOk ? r2(mayS.reduce((s, i) => s
      + Math.max(0, (Math.min(tx[i], 30) + Math.max(tn[i], 10)) / 2 - 10), 0), 0) : null);

    // July mean root-zone wetness (31 days)
    const g = daily.gwetroot;
    res.gwetroot_jul.push(full(jul, 31) && jul.every((i) => g[i] !== null)
      ? r2(jul.reduce((s, i) => s + g[i], 0) / 31, 3) : null);
  }
  return res;
}

function gridCells() {
  const [x0, y0, x1, y1] = GRID.bbox;
  const cells = [];
  const eps = 1e-9;
  for (let lat = Math.ceil(y0 / GRID.dlat - eps) * GRID.dlat; lat <= y1 + eps; lat += GRID.dlat) {
    for (let lon = Math.ceil(x0 / GRID.dlon - eps) * GRID.dlon; lon <= x1 + eps; lon += GRID.dlon) {
      const la = r2(lat, 3);
      const lo = r2(lon, 4);
      const hx = GRID.dlon / 2;
      const hy = GRID.dlat / 2;
      cells.push({
        cell_id: `c_${la.toFixed(2)}_${lo.toFixed(3)}`,
        lat: la, lon: lo,
        polygon: [[lo - hx, la - hy], [lo + hx, la - hy], [lo + hx, la + hy], [lo - hx, la + hy], [lo - hx, la - hy]]
          .map(([a, b]) => [r2(a, 4), r2(b, 4)]),
      });
    }
  }
  return cells;
}

async function grid() {
  const cells = gridCells();
  const years = [];
  for (let y = GRID_YEARS[0]; y <= GRID_YEARS[1]; y++) years.push(y);
  console.log(`grid: ${cells.length} POWER cells x ${years.length} years`);
  const params = ['T2M_MAX', 'T2M_MIN', 'PRECTOTCORR', 'GWETROOT'];
  const outCells = [];
  let retrievedAt = null;
  let apiVersion = null;
  for (const [k, c] of cells.entries()) {
    try {
      const p = await withRetry(() => fetchPowerDaily({ lat: c.lat, lon: c.lon, start: `${years[0]}-01-01`,
        end: `${years[years.length - 1]}-12-31`, params, timeoutMs: 120000 }), c.cell_id);
      retrievedAt = p.retrieved_at;
      apiVersion = p.api_version;
      outCells.push({ ...c, values: annualIndicators(p.daily, c.lat, years) });
      console.log(`  [${k + 1}/${cells.length}] ${c.cell_id} ok`);
    } catch (err) {
      console.warn(`  [${k + 1}/${cells.length}] ${c.cell_id} FAILED: ${err.message}`);
      outCells.push({ ...c, values: null, error: err.message });
    }
    await sleep(1000);
  }
  const out = {
    generated_at: new Date().toISOString(),
    source_ids: ['NASA_POWER_DAILY', 'FAO56'],
    bbox: GRID.bbox,
    cell_size_deg: [GRID.dlon, GRID.dlat],
    grid_note: 'Cells are the native POWER/MERRA-2 meteorology grid (centres on multiples of 0.625° lon, 0.5° lat), verified Nov 15 2026 by probing cell edges. All cells whose centre lies in bbox are included, so the outer row/column extends past bbox by half a cell.',
    years,
    et0_method: 'Hargreaves (FAO-56 eq. 52) with Ra from latitude and day of year (eq. 21); Kc = 1.0, so season_deficit_mm = May–Sep rain minus reference ET0. Hargreaves is used for every year because daily solar radiation is missing before 1984.',
    kc: 1.0,
    missing_rule: 'An indicator is null if any day it needs is missing. Never 0.',
    api_version: apiVersion,
    retrieved_at: retrievedAt,
    indicators: {
      season_precip_mm: { unit: 'mm', label: 'May–Sep rain' },
      season_deficit_mm: { unit: 'mm', label: 'May–Sep rain minus reference crop demand (Hargreaves ET₀ × 1.0)' },
      hot_days_35c: { unit: 'days', label: 'Days ≥ 35 °C (Jun–Aug)' },
      gdd_may_sep: { unit: '°C·day', label: 'Growing degree days May–Sep (10/30 °C)' },
      gwetroot_jul: { unit: '0–1', label: 'July root-zone wetness (model-based)' },
    },
    demo_cell_id: cells.find((c) => Math.abs(c.lat - 39.5) < 1e-6 && Math.abs(c.lon + 100.625) < 1e-6)?.cell_id ?? null,
    cells: outCells,
  };
  writeJson(path.join(DATA, 'region_grid.json'), out);
}

// ---------------------------------------------------------------------------
// ndvi
//   --ndvi-source=ornl  ORNL DAAC MODIS Web Service (fetchModisNdvi; the plan's default)
//   --ndvi-source=pc    the same NASA MOD13Q1 v061 files, read as Cloud-Optimized
//                       GeoTIFFs from Microsoft Planetary Computer (no login; Node only)
//   --ndvi-source=auto  (default) ORNL, and Planetary Computer if ORNL is unreachable
// ---------------------------------------------------------------------------
const NDVI_WIN = 4; // ±4 pixels → 9 × 9 window, like ORNL kmAboveBelow=1/kmLeftRight=1
const MODIS_R = 6371007.181;

/** Minimal tiled-GeoTIFF reader: header + tiles via HTTP range requests (deflate / none). */
async function rangeGet(url, from, to, label) {
  for (let attempt = 0; ; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 90000);
      const res = await fetch(url, { headers: { Range: `bytes=${from}-${to}` }, signal: ctrl.signal });
      clearTimeout(t);
      if (res.status !== 206 && res.status !== 200) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt >= 3) throw new Error(`MODIS (Planetary Computer) unavailable: ${label}: ${err.message}`);
      await sleep(2000 * (attempt + 1));
    }
  }
}

function parseTiffHeader(b) {
  const le = b.toString('latin1', 0, 2) === 'II';
  const u16 = (o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const f64 = (o) => (le ? b.readDoubleLE(o) : b.readDoubleBE(o));
  if (u16(2) !== 42) throw new Error('not a classic TIFF');
  const ifd = u32(4);
  const n = u16(ifd);
  const size = { 1: 1, 2: 1, 3: 2, 4: 4, 6: 1, 8: 2, 9: 4, 12: 8, 16: 8 };
  const tags = {};
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    const tag = u16(e); const typ = u16(e + 2); const cnt = u32(e + 4);
    const bytes = size[typ] * cnt;
    const at = bytes <= 4 ? e + 8 : u32(e + 8);
    if (at + bytes > b.length) { tags[tag] = { outOfRange: at + bytes }; continue; }
    const read = (k) => (typ === 3 ? u16(at + 2 * k) : typ === 4 ? u32(at + 4 * k) : typ === 12 ? f64(at + 8 * k)
      : typ === 1 || typ === 6 ? b[at + k] : null);
    tags[tag] = typ === 2 ? b.toString('latin1', at, at + cnt) : Array.from({ length: cnt }, (_, k) => read(k));
  }
  const need = [256, 257, 258, 259, 322, 323, 324, 325, 33550, 33922];
  for (const t of need) if (!tags[t] || tags[t].outOfRange) throw new Error(`TIFF tag ${t} not in header range`);
  return {
    le, width: tags[256][0], height: tags[257][0], bits: tags[258][0], compression: tags[259][0],
    predictor: tags[317]?.[0] ?? 1, sampleFormat: tags[339]?.[0] ?? 1,
    tileW: tags[322][0], tileH: tags[323][0], offsets: tags[324], counts: tags[325],
    pixelX: tags[33550][0], pixelY: tags[33550][1], x0: tags[33922][3], y0: tags[33922][4],
    nodata: typeof tags[42113] === 'string' ? Number(tags[42113].replace(/\0/g, '')) : null,
  };
}

async function readCogWindow(url, row0, col0, nrows, ncols, label, hdrCache, tileCache = new Map()) {
  let h = hdrCache.get(url);
  if (!h) { h = parseTiffHeader(await rangeGet(url, 0, 65535, label)); hdrCache.set(url, h); }
  if (h.predictor !== 1) throw new Error(`unsupported TIFF predictor ${h.predictor}`);
  const tilesAcross = Math.ceil(h.width / h.tileW);
  const out = new Array(nrows * ncols).fill(null);
  const bpp = h.bits / 8;
  const tiles = new Map();
  for (let r = row0; r < row0 + nrows; r++) for (let c = col0; c < col0 + ncols; c++) {
    tiles.set(`${Math.floor(r / h.tileH)},${Math.floor(c / h.tileW)}`, null);
  }
  for (const key of tiles.keys()) {
    const [tr, tc] = key.split(',').map(Number);
    const idx = tr * tilesAcross + tc;
    const ck = `${url.split('?')[0]}#${idx}`;
    if (!tileCache.has(ck)) {
      const off = h.offsets[idx]; const cnt = h.counts[idx];
      let raw = cnt ? await rangeGet(url, off, off + cnt - 1, label) : null;
      if (raw && h.compression === 8) raw = zlib.inflateSync(raw);
      else if (raw && h.compression !== 1) throw new Error(`unsupported TIFF compression ${h.compression}`);
      tileCache.set(ck, raw);
    }
    tiles.set(key, tileCache.get(ck));
  }
  for (let r = 0; r < nrows; r++) for (let c = 0; c < ncols; c++) {
    const R = row0 + r; const C = col0 + c;
    const t = tiles.get(`${Math.floor(R / h.tileH)},${Math.floor(C / h.tileW)}`);
    if (!t) continue;
    const o = ((R % h.tileH) * h.tileW + (C % h.tileW)) * bpp;
    let v;
    if (bpp === 2) v = h.sampleFormat === 2 ? (h.le ? t.readInt16LE(o) : t.readInt16BE(o)) : (h.le ? t.readUInt16LE(o) : t.readUInt16BE(o));
    else v = h.sampleFormat === 2 ? t.readInt8(o) : t.readUInt8(o);
    out[r * ncols + c] = h.nodata !== null && v === h.nodata && bpp === 1 ? null : v;
  }
  return { header: h, values: out };
}

async function pcToken() {
  const res = await fetch('https://planetarycomputer.microsoft.com/api/sas/v1/token/modiseuwest/modis-061-cogs');
  if (!res.ok) throw new Error(`MODIS (Planetary Computer) unavailable: SAS token HTTP ${res.status}`);
  const j = await res.json();
  return { token: j.token, expiry: Date.parse(j['msft:expiry']) };
}

async function pcItems(lat, lon, start, end) {
  const items = [];
  let body = { collections: ['modis-13Q1-061'], intersects: { type: 'Point', coordinates: [lon, lat] },
    datetime: `${start}T00:00:00Z/${end}T23:59:59Z`, limit: 500 };
  let url = 'https://planetarycomputer.microsoft.com/api/stac/v1/search';
  for (let page = 0; page < 50; page++) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`MODIS (Planetary Computer) unavailable: STAC HTTP ${res.status}`);
    const j = await res.json();
    items.push(...j.features);
    const next = (j.links || []).find((l) => l.rel === 'next');
    if (!next) break;
    url = next.href; body = next.body || body;
  }
  // Terra MOD13Q1 only (ORNL's MOD13Q1); keep the latest processing per composite date + tile.
  const byKey = new Map();
  for (const it of items) {
    const m = /^MOD13Q1\.A(\d{7})\.(h\d\dv\d\d)\.061\.(\d{13})$/.exec(it.id);
    if (!m) continue;
    const key = `${m[1]}.${m[2]}`;
    if (!byKey.has(key) || byKey.get(key).proc < m[3]) byKey.set(key, { modis: `A${m[1]}`, tile: m[2], proc: m[3], item: it });
  }
  const startA = toModisDateLocal(start);
  return [...byKey.values()].filter((x) => x.modis >= startA).sort((a, b) => a.modis.localeCompare(b.modis));
}

function toModisDateLocal(iso) {
  const y = Number(iso.slice(0, 4));
  const doy = Math.round((Date.UTC(y, Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) - Date.UTC(y, 0, 1)) / 86400000) + 1;
  return `A${y}${String(doy).padStart(3, '0')}`;
}

function modisToIso(a) {
  const y = Number(a.slice(1, 5)); const d = Number(a.slice(5));
  return new Date(Date.UTC(y, 0, d)).toISOString().slice(0, 10);
}

/** NDVI 9×9 windows for several nearby points from Planetary Computer COGs. */
async function fetchNdviPlanetary(points, start, end) {
  const items = await pcItems(points[0].lat, points[0].lon, start, end);
  if (!items.length) throw new Error('MODIS (Planetary Computer) unavailable: no MOD13Q1 items found');
  const tiles = new Set(items.map((i) => i.tile));
  if (tiles.size > 1) console.warn(`  note: composites span tiles ${[...tiles].join(', ')}`);
  console.log(`  Planetary Computer: ${items.length} MOD13Q1 composites ${items[0].modis}..${items.at(-1).modis}`);
  let sas = await pcToken();
  const hdr = new Map();
  const res = points.map((p) => ({ ...p, grid: null, dates: [], modis_dates: [], pixels: [], tiles: new Set() }));
  let done = 0;
  const queue = items.slice();
  const worker = async () => {
    for (let it = queue.shift(); it; it = queue.shift()) {
      if (Date.now() > sas.expiry - 5 * 60000) sas = await pcToken();
      const href = (band) => `${it.item.assets[band].href}?${sas.token}`;
      // Grid for this file: compute each point's window, read NDVI + reliability for all points.
      const ndviUrl = href('250m_16_days_NDVI');
      const relUrl = href('250m_16_days_pixel_reliability');
      const label = `${it.modis} ${it.tile}`;
      let h = hdr.get(ndviUrl.split('?')[0]);
      if (!h) { h = parseTiffHeader(await rangeGet(ndviUrl, 0, 65535, label)); hdr.set(ndviUrl.split('?')[0], h); }
      const tileCache = new Map(); // tiles shared by nearby fields within this composite
      const cache = new Map([[ndviUrl, h]]);
      for (const p of res) {
        const latR = (p.lat * Math.PI) / 180;
        const x = MODIS_R * ((p.lon * Math.PI) / 180) * Math.cos(latR);
        const y = MODIS_R * latR;
        const col = Math.floor((x - h.x0) / h.pixelX); const row = Math.floor((h.y0 - y) / h.pixelY);
        const r0 = row - NDVI_WIN; const c0 = col - NDVI_WIN; const n = 2 * NDVI_WIN + 1;
        if (r0 < 0 || c0 < 0 || r0 + n > h.height || c0 + n > h.width) throw new Error(`window crosses tile edge for ${p.field_id}`);
        const nd = await readCogWindow(ndviUrl, r0, c0, n, n, label, cache, tileCache);
        let rel = null;
        try { rel = (await readCogWindow(relUrl, r0, c0, n, n, label, cache, tileCache)).values; } catch (err) { console.warn(`  ${label} reliability: ${err.message}`); }
        const grid = { xllcorner: h.x0 + c0 * h.pixelX, yllcorner: h.y0 - (r0 + n) * h.pixelY, cellsize: h.pixelX, nrows: n, ncols: n };
        p.grid = p.grid || grid;
        if (Math.abs(p.grid.xllcorner - grid.xllcorner) > 1 || Math.abs(p.grid.yllcorner - grid.yllcorner) > 1) {
          throw new Error(`pixel grid moved for ${p.field_id} at ${it.modis}`);
        }
        p.tiles.add(it.tile);
        p.rows = p.rows || new Map();
        p.rows.set(it.modis, { values: nd.values.map((v, k) => ndviFromRaw(v, rel ? rel[k] : undefined)), rel: Boolean(rel) });
      }
      done++;
      if (done % 10 === 0 || done === items.length) process.stdout.write(`\r  ${done}/${items.length} composites   `);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  process.stdout.write('\n');
  return res.map((p) => {
    const keys = [...p.rows.keys()].sort();
    const grid = p.grid;
    return {
      field_id: p.field_id, lat: p.lat, lon: p.lon, ...grid,
      pixel_size_m: Math.round(grid.cellsize * 100) / 100,
      pixel_polygons: modisPixelPolygons(grid),
      pixel_centers: modisPixelCenters(grid).map((c) => c.map((v) => Math.round(v * 1e6) / 1e6)),
      dates: keys.map(modisToIso), modis_dates: keys, pixels: keys.map((k) => p.rows.get(k).values),
      reliability_applied: keys.every((k) => p.rows.get(k).rel),
      modis_tiles: [...p.tiles],
      retrieved_at: new Date().toISOString(),
      source_ids: ['MODIS_MOD13Q1_PC'],
    };
  });
}

function ndviFieldRecord(f, n, sourceNote) {
  return {
    field_id: f.properties.field_id,
    request: { lat: n.lat, lon: n.lon, window: '9 x 9 pixels centred on the field-centre pixel' },
    source: sourceNote,
    pixel_size_m: n.pixel_size_m, nrows: n.nrows, ncols: n.ncols,
    xllcorner: n.xllcorner, yllcorner: n.yllcorner, cellsize: n.cellsize,
    pixel_polygons: n.pixel_polygons,
    pixel_centers: n.pixel_centers,
    pixels_in_field: n.pixel_centers.map((c, k) => (pointInPolygon(c, f.geometry) ? k : -1)).filter((k) => k >= 0),
    dates: n.dates,
    modis_dates: n.modis_dates,
    field_mean: fieldMeanSeries(n, f.geometry),
    pixels: n.pixels,
    reliability_applied: n.reliability_applied,
    retrieved_at: n.retrieved_at,
  };
}

/** Every MOD13Q1 composite start (A2001001, A2001017, ...) from `start` up to `end`. */
function expectedComposites(start, end) {
  const out = [];
  const lo = toModisDateLocal(start);
  for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) {
    for (let doy = 1; doy <= 353; doy += 16) {
      const a = `A${y}${String(doy).padStart(3, '0')}`;
      if (a >= lo && modisToIso(a) <= end) out.push(a);
    }
  }
  return out;
}

/** Group missing composites into runs that are consecutive in the expected sequence. */
function missingRuns(expected, have) {
  const runs = [];
  let cur = null;
  expected.forEach((a, i) => {
    if (have.has(a)) { cur = null; return; }
    if (cur && cur.lastIdx === i - 1) { cur.dates.push(a); cur.lastIdx = i; } else { cur = { dates: [a], lastIdx: i }; runs.push(cur); }
  });
  return runs.map((r) => r.dates);
}

/**
 * --fill-gaps: keep every existing composite unchanged and add only the missing
 * ones from --ndvi-source (ornl or pc). Records the source of every composite
 * in fields[].composite_sources (aligned with dates).
 */
async function fillNdviGaps(fc, mode) {
  const outFile = path.join(DATA, 'fields_ndvi.json');
  if (!fs.existsSync(outFile)) throw new Error('--fill-gaps needs an existing fields_ndvi.json');
  if (mode !== 'ornl' && mode !== 'pc') throw new Error('--fill-gaps needs --ndvi-source=ornl or --ndvi-source=pc');
  const srcId = mode === 'ornl' ? 'MODIS_MOD13Q1_ORNL' : 'MODIS_MOD13Q1_PC';
  const file = readJson(outFile);
  const start = opt('ndvi-start', '2001-01-01');
  const expected = expectedComposites(start, TODAY);
  const log = { ran_at: new Date().toISOString(), source_id: srcId, filled: {}, still_missing: {}, errors: [] };

  for (const rec of file.fields) {
    const f = fc.features.find((x) => x.properties.field_id === rec.field_id);
    // Composites from the original run carry the file-level source.
    if (!rec.composite_sources) rec.composite_sources = rec.dates.map(() => file.source_ids[0]);
    const have = new Set(rec.modis_dates);
    const runs = missingRuns(expected, have);
    console.log(`ndvi fill: ${rec.field_id} ${runs.flat().length} missing in ${runs.length} runs: ${runs.map((r) => r.length > 1 ? `${r[0]}..${r.at(-1)}` : r[0]).join(', ') || 'none'}`);
    const got = new Map(); // modis_date → {values, rel}
    for (const run of runs) {
      const s = modisToIso(run[0]);
      const e = modisToIso(run.at(-1));
      try {
        let n;
        if (mode === 'ornl') {
          n = await fetchModisNdvi({ lat: rec.request.lat, lon: rec.request.lon, startDate: s, endDate: e,
            kmAboveBelow: 1, kmLeftRight: 1, timeoutMs: 90000 });
        } else {
          [n] = await fetchNdviPlanetary([{ field_id: rec.field_id, lat: rec.request.lat, lon: rec.request.lon }], s, e);
        }
        // Put the new pixels on the file's 9 × 9 grid. A window offset by whole pixels is realigned
        // (cells outside the new window become null); anything else is refused.
        const cs = rec.cellsize;
        const dc = (rec.xllcorner - n.xllcorner) / cs;
        const dr = ((n.yllcorner + n.nrows * cs) - (rec.yllcorner + rec.nrows * cs)) / cs;
        if (Math.abs(n.cellsize - cs) > 0.01 || Math.abs(dc - Math.round(dc)) > 0.01 || Math.abs(dr - Math.round(dr)) > 0.01) {
          throw new Error(`grid mismatch: got ${n.nrows}x${n.ncols} cell ${n.cellsize} at (${n.xllcorner}, ${n.yllcorner}), file has ${rec.nrows}x${rec.ncols} cell ${cs} at (${rec.xllcorner}, ${rec.yllcorner})`);
        }
        const DC = Math.round(dc); const DR = Math.round(dr);
        if (DC || DR || n.nrows !== rec.nrows || n.ncols !== rec.ncols) {
          console.warn(`  ${rec.field_id}: realigning ${n.nrows}x${n.ncols} window by ${DR} rows, ${DC} cols`);
        }
        const realign = (vals) => {
          const out = [];
          for (let r = 0; r < rec.nrows; r++) for (let c = 0; c < rec.ncols; c++) {
            const R = r + DR; const C = c + DC;
            out.push(R >= 0 && R < n.nrows && C >= 0 && C < n.ncols ? vals[R * n.ncols + C] : null);
          }
          return out;
        };
        n.modis_dates.forEach((a, i) => { if (run.includes(a)) got.set(a, { values: realign(n.pixels[i]), rel: n.reliability_applied }); });
      } catch (err) {
        console.warn(`  ${rec.field_id} ${run[0]}..${run.at(-1)}: ${err.message}`);
        log.errors.push({ field_id: rec.field_id, run: [run[0], run.at(-1)], error: err.message });
      }
    }
    // Merge in date order without touching existing composites.
    const rows = rec.modis_dates.map((a, i) => ({ a, date: rec.dates[i], px: rec.pixels[i], mean: rec.field_mean[i], src: rec.composite_sources[i] }));
    for (const [a, g] of got) {
      if (have.has(a)) continue;
      const mean = fieldMeanSeries({ pixel_centers: rec.pixel_centers, pixels: [g.values] }, f.geometry)[0];
      rows.push({ a, date: modisToIso(a), px: g.values, mean, src: srcId });
      if (!g.rel) rec.reliability_applied = false;
    }
    rows.sort((x, y) => x.a.localeCompare(y.a));
    rec.modis_dates = rows.map((r) => r.a);
    rec.dates = rows.map((r) => r.date);
    rec.pixels = rows.map((r) => r.px);
    rec.field_mean = rows.map((r) => r.mean);
    rec.composite_sources = rows.map((r) => r.src);
    log.filled[rec.field_id] = [...got.keys()].sort();
    log.still_missing[rec.field_id] = expected.filter((a) => !rec.modis_dates.includes(a));
    console.log(`  ${rec.field_id}: filled ${got.size}; still missing ${log.still_missing[rec.field_id].join(' ') || 'none'}`);
  }
  file.source_ids = [...new Set(file.fields.flatMap((r) => r.composite_sources))];
  file.generated_at = new Date().toISOString();
  file.notes = file.notes.filter((t) => !t.startsWith('composite_sources'));
  file.notes.push('composite_sources[i] is the source id of dates[i] (MODIS_MOD13Q1_PC = Planetary Computer COGs, MODIS_MOD13Q1_ORNL = ORNL DAAC web service). Both are NASA MOD13Q1 v061.');
  file.gap_fills = [...(file.gap_fills || []), log];
  writeJson(outFile, file);
  return true;
}

async function ndvi() {
  const fc = fs.existsSync(path.join(DATA, 'demo_fields.geojson'))
    ? readJson(path.join(DATA, 'demo_fields.geojson')) : fields();
  const start = opt('ndvi-start', '2001-01-01');
  const mode = opt('ndvi-source', 'auto');
  if (args.includes('--fill-gaps')) return fillNdviGaps(fc, mode);
  const outFile = path.join(DATA, 'fields_ndvi.json');
  const outFields = [];
  const failures = [];
  const sourceIds = new Set();
  let useOrnl = mode === 'ornl' || mode === 'auto';
  for (const f of fc.features) {
    if (!useOrnl) break;
    const id = f.properties.field_id;
    const { lat, lon } = polygonCenter(f.geometry);
    console.log(`ndvi: ${id} ORNL MOD13Q1 ${start}..${TODAY} at ${lat.toFixed(5)}, ${lon.toFixed(5)}`);
    try {
      const n = await fetchModisNdvi({
        lat: r2(lat, 5), lon: r2(lon, 5), startDate: start, endDate: TODAY, kmAboveBelow: 1, kmLeftRight: 1,
        timeoutMs: 90000,
        onProgress: ({ band, done, total }) => process.stdout.write(`\r  ${band} ${done}/${total}   `),
      });
      process.stdout.write('\n');
      outFields.push(ndviFieldRecord(f, n, 'ORNL DAAC MODIS Web Service, MOD13Q1 v061, kmAboveBelow=1, kmLeftRight=1'));
      sourceIds.add('MODIS_MOD13Q1_ORNL');
    } catch (err) {
      process.stdout.write('\n');
      console.warn(`  ${id} ORNL FAILED: ${err.message}`);
      failures.push({ field_id: id, source: 'MODIS_MOD13Q1_ORNL', error: err.message });
      if (mode === 'auto') { useOrnl = false; outFields.length = 0; }
    }
  }
  if (mode === 'pc' || (mode === 'auto' && !useOrnl)) {
    console.log(`ndvi: Planetary Computer COGs for ${fc.features.length} fields ${start}..${TODAY}`);
    const pts = fc.features.map((f) => {
      const { lat, lon } = polygonCenter(f.geometry);
      return { field_id: f.properties.field_id, lat: r2(lat, 5), lon: r2(lon, 5) };
    });
    try {
      const res = await fetchNdviPlanetary(pts, start, TODAY);
      for (const n of res) {
        const f = fc.features.find((x) => x.properties.field_id === n.field_id);
        outFields.push(ndviFieldRecord(f, n, 'NASA MOD13Q1 v061 Cloud-Optimized GeoTIFFs on Microsoft Planetary Computer (collection modis-13Q1-061), 9 x 9 pixel window'));
      }
      sourceIds.add('MODIS_MOD13Q1_PC');
    } catch (err) {
      console.warn(`  Planetary Computer FAILED: ${err.message}`);
      failures.push({ field_id: '*', source: 'MODIS_MOD13Q1_PC', error: err.message });
    }
  }
  if (!outFields.length) {
    console.error('ndvi: no field succeeded; fields_ndvi.json not written.');
    return false;
  }
  writeJson(outFile, {
    generated_at: new Date().toISOString(),
    source_ids: [...sourceIds],
    product: 'MODIS Terra MOD13Q1 collection 061, 250 m 16-day composite NDVI (NASA LP DAAC)',
    notes: [
      'NDVI = raw x 0.0001. Null = fill (-3000), out of range (-0.2..1), or pixel_reliability not 0 (good) / 1 (marginal).',
      'dates are composite start dates (16-day composites).',
      'pixel_polygons and pixels are row-major from the upper-left (north-west) pixel.',
      'field_mean = mean of valid pixels whose centre lies inside the field polygon (pixels_in_field indexes).',
      'NDVI shows greenness, not its cause.',
    ],
    failures,
    fields: outFields,
  });
  return true;
}

// ---------------------------------------------------------------------------
// sources: dashboard/data/sources.json
// ---------------------------------------------------------------------------
function sourcesFile() {
  const agro = readJson(path.join(ROOT, 'research', 'deliverables', 'agronomy', 'agronomy.json'));
  const obs = readJson(path.join(RESEARCH, 'field_observations.json'));
  const cdl = obs.sources.find((x) => x.source_id === 'T2_CDL');
  const ssurgo = obs.sources.find((x) => x.source_id === 'T2_SSURGO');
  const core = [
    { id: 'NASA_POWER_DAILY', name: 'NASA POWER Daily API, Agroclimatology (AG) community',
      provider: 'NASA Langley Research Center, Prediction Of Worldwide Energy Resources (POWER)',
      url: 'https://power.larc.nasa.gov/api/temporal/daily/point',
      resolution: 'Meteorology ~0.5° lat × 0.625° lon (MERRA-2 / GEOS-IT grid, about 50 km); solar ~1° (CERES / FLASHFlux)',
      period: '1981-01-01 to present (daily solar radiation from 1984)',
      latency: '~3 days for meteorology, longer for solar radiation (checked 2026-11-15: T2M through 2026-11-12, ALLSKY through 2026-11-10)',
      license_or_terms: 'Free, no key. NASA data policy; cite "These data were obtained from the NASA Langley Research Center POWER Project funded through the NASA Earth Science Directorate Applied Science Program."',
      notes: 'Parameters T2M_MAX, T2M_MIN, PRECTOTCORR, RH2M, WS2M, ALLSKY_SFC_SW_DWN, GWETROOT, GWETTOP. Fill -999 → null. Reanalysis-based: regional context, not a field measurement. GWETROOT/GWETTOP are model-based soil wetness. CORS allowed (browser calls work). API v2.10.3 on 2026-11-15.' },
    { id: 'MODIS_MOD13Q1_ORNL', name: 'MODIS Terra MOD13Q1 v061 Vegetation Indices (NDVI), via the ORNL DAAC MODIS Web Service',
      provider: 'NASA LP DAAC (product, Didan 2021, doi:10.5067/MODIS/MOD13Q1.061); ORNL DAAC (subset service)',
      url: 'https://modis.ornl.gov/rst/api/v1/',
      resolution: '250 m (231.66 m sinusoidal pixels), 16-day composites',
      period: '2000-02-18 to present', latency: 'About 2–4 weeks after the composite period',
      license_or_terms: 'Free, no key. NASA EOSDIS data use policy; cite the product DOI and the ORNL DAAC MODIS Web Service.',
      notes: 'Band 250m_16_days_NDVI × 0.0001; -3000 fill → null; pixel_reliability 0/1 kept. Could not be reached from the cloud build environment on 2026-11-15 (upstream connection failure); MODIS_MOD13Q1_PC was used instead for fields_ndvi.json.' },
    { id: 'MODIS_MOD13Q1_PC', name: 'MODIS Terra MOD13Q1 v061 NDVI Cloud-Optimized GeoTIFFs on Microsoft Planetary Computer (collection modis-13Q1-061)',
      provider: 'NASA LP DAAC (product, doi:10.5067/MODIS/MOD13Q1.061); Microsoft Planetary Computer (hosting)',
      url: 'https://planetarycomputer.microsoft.com/dataset/modis-13Q1-061',
      resolution: '250 m (231.66 m sinusoidal pixels), 16-day composites',
      period: '2000 to present (catalogue has gaps, e.g. no Terra composites Jul–Nov 2025 on 2026-11-15)',
      latency: 'Mirror of LP DAAC; additional lag of weeks',
      license_or_terms: 'Free; anonymous SAS token from the Planetary Computer API. NASA EOSDIS data policy for the product.',
      notes: 'Same NASA product and band math as MODIS_MOD13Q1_ORNL. Read by scripts/precompute.mjs (Node only) with HTTP range requests; a 9 × 9 pixel window centred on the field-centre pixel.' },
    { id: 'USDA_SSURGO_SDA', name: 'USDA NRCS SSURGO soil survey via Soil Data Access (SDA)',
      provider: 'USDA Natural Resources Conservation Service',
      url: 'https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest',
      resolution: 'Soil map units at 1:12,000–1:24,000 survey scale',
      period: 'Current live database (queried 2026-11-14 for demo fields; live for drawn fields)',
      latency: 'Updated annually (October refresh)', license_or_terms: 'Public domain (US Government work), no key; CORS allowed.',
      notes: `${ssurgo?.method ?? ''} muaggatt.aws0150wta (cm), drclassdcd, hydgrpdcd. Water-holding capacity estimate, not current soil moisture.` },
    { id: 'USDA_CDL', name: cdl?.title ?? 'USDA NASS Cropland Data Layer',
      provider: 'USDA National Agricultural Statistics Service (CropScape, George Mason University CSISS)',
      url: cdl?.url ?? 'https://nassgeodata.gmu.edu/CropScape/',
      resolution: '30 m', period: '2021–2025 used (CDL is annual, 2008+ nationwide)',
      latency: 'Released early in the following year', license_or_terms: 'Public domain (USDA NASS), no key.',
      notes: `${cdl?.method ?? ''} ${cdl?.limitations ?? ''} Dominant class per year used as crop_history; the farmer must confirm. Research record: T2_CDL, retrieved ${cdl?.retrieved_date ?? 'n/a'}.` },
    { id: 'FAO56', name: 'Allen, Pereira, Raes & Smith (1998). Crop evapotranspiration: guidelines for computing crop water requirements. FAO Irrigation and Drainage Paper 56',
      provider: 'Food and Agriculture Organization of the United Nations', url: 'https://www.fao.org/4/x0490e/x0490e00.htm',
      resolution: 'Method reference', period: null, latency: null, license_or_terms: 'FAO copyright; method citation',
      notes: 'Penman-Monteith reference ET (eq. 6), Hargreaves (eq. 52), extraterrestrial radiation (eq. 21), crop coefficients and depletion fraction p.' },
    { id: 'SD6_LEMA_CONTEXT', name: 'Sheridan 6 Local Enhanced Management Area: boundary and order of designation',
      provider: 'Kansas Biological Survey (boundary); Kansas Department of Agriculture, Division of Water Resources (order)',
      url: 'https://gmd4.org/New/Sheridan%206%20LEMA%20Order%20of%20Designation.pdf', resolution: 'PLSS sections', period: '2018–2027 orders',
      latency: null, license_or_terms: 'Public documents', notes: 'Research records T2_SD6_BOUNDARY and T2_SD6_ORDER. Allocation in demo_farm.json is illustrative only.' },
  ];
  const t1 = agro.sources.filter((x) => /^T1_/.test(x.source_id)).map((x) => ({
    id: x.source_id, name: x.title, provider: 'See title (copied from research/deliverables/agronomy/agronomy.json)',
    url: x.url, resolution: null, period: x.publication_year ? String(x.publication_year) : null, latency: null,
    license_or_terms: 'Publication; cite as listed', notes: [x.locator, x.applicability_limit].filter(Boolean).join(' | '),
    evidence_notes: x.evidence_notes ?? null, kind: 'agronomy_source',
  }));
  const t2 = obs.sources.map((x) => ({
    id: x.source_id, name: x.title, provider: 'See title (copied from research/deliverables/fields-soils/field_observations.json)',
    url: x.url, resolution: null, period: x.product_version ?? null, latency: null, license_or_terms: null,
    notes: [x.method, x.limitations, `retrieved ${x.retrieved_date}`].filter(Boolean).join(' | '), kind: 'field_source',
  }));
  const rules = agro.rules.map((r) => ({
    id: r.rule_id, name: `Agronomy rule ${r.rule_id}: ${r.condition_description}`, provider: 'Kimchi research team (agronomy.json)',
    url: 'research/deliverables/agronomy/agronomy.json', resolution: null, period: null, latency: null,
    license_or_terms: 'Project rule', notes: `${r.effect}: ${r.rationale} Based on ${r.source_ids.join(', ')}. ${r.validation_status ?? ''}`.trim(),
    kind: 'agronomy_rule', based_on: r.source_ids,
  }));
  // KSU sources that P4 cites in crops.json extra_sources (copied so every id resolves here).
  const ksu = [
    { id: 'KSU_CORN_GDD_LATEPLANT', name: 'Late planting of corn: how location and hybrid maturity affect probability of success (K-State Agronomy eUpdate)',
      url: 'https://eupdate.agronomy.ksu.edu/article/late-planting-of-corn-how-location-and-hybrid-maturity-affect-probability-of-success-634-1' },
    { id: 'KSU_SORGHUM_GDD', name: 'Sorghum Growth and Development, MF3234 (K-State Research and Extension)', url: 'https://bookstore.ksre.ksu.edu/pubs/MF3234.pdf' },
    { id: 'KSU_WHEAT_HEAT', name: 'Effects of High Temperatures on Wheat (K-State Agronomy eUpdate)', url: 'https://eupdate.agronomy.ksu.edu/article/effects-of-high-temperatures-on-wheat-494' },
  ].map((x) => ({ ...x, provider: 'Kansas State University Research and Extension', resolution: null, period: null, latency: null,
    license_or_terms: 'Extension publication', notes: 'Copied from dashboard/data/crops.json extra_sources (P4); see that file for the values used.', kind: 'agronomy_source' }));
  const deferred = [
    ['OpenET', 'Field-scale (30 m) actual ET would replace our ET₀ × Kc estimate, but the API needs a free account and key; the adapter exists in research/deliverables/weather-water/. Next step.'],
    ['NASA MODIS MOD16A2GF ET', '500 m 8-day actual ET for fld01–fld03 (2021–2025) was retrieved from ORNL in research PR #8 but is not wired into the dashboard tonight. Next step.'],
    ['GRACE-FO', 'Groundwater/total water storage at ~300 km and monthly: regional aquifer context only, cannot resolve a field or the SD-6 LEMA.'],
    ['SMAP', 'Satellite soil moisture (9–36 km) needs an Earthdata login for downloads; POWER GWETROOT covers the factor tonight (model-based).'],
    ['GPM IMERG', '~10 km precipitation, finer than POWER, but needs Earthdata login and gridded HDF5/NetCDF processing; POWER PRECTOTCORR is used.'],
    ['ECOSTRESS', '70 m ET and surface temperature, but irregular overpass times and gaps make a field time series unreliable; needs Earthdata login.'],
    ['PRISM', '4 km US climate, better than POWER for rain; no simple CORS JSON point API, so it needs a server-side download; next step.'],
    ['NLDAS', '~12 km hourly forcing and land-surface soil moisture; needs Earthdata login and NetCDF processing.'],
    ['NAIP', 'Aerial imagery only used for a one-off visual check of pivot outlines (research/deliverables/fields-soils); a basemap at most.'],
    ['SRTM', 'Elevation/slope is nearly flat at the demo fields; not needed for the four factors tonight.'],
    ['USGS NWIS', 'Groundwater-level wells exist near SD-6, but linking a well record to a field needs local review; next step for aquifer context.'],
    ['USDA AMS Market News', 'Prices would support an income view, but we make no profit predictions tonight (guardrail 8).'],
    ['USDA NASS QuickStats', 'County yields could benchmark farmer records; needs an API key and is not needed for the four factors tonight.'],
    ['FAO GAEZ', 'Global ~9 km crop suitability: too coarse and not specific to irrigated western Kansas.'],
    ['CoCoRaHS', 'Volunteer rain gauges are point data with gaps; a good later check on POWER rainfall.'],
    ['NLCD', 'Land cover every 2–3 years at 30 m; CDL already gives annual crop type.'],
    ['LANDFIRE', 'Wildland fuel and vegetation layers; not relevant to irrigated cropland decisions.'],
    ['GEDI', 'Lidar canopy structure in sparse footprints; not useful for annual crops at field scale.'],
    ['Sentinel-2', '10 m NDVI would be sharper than MODIS 250 m, but it is not a NASA product, has only 2015+, and needs cloud masking and tiling work; HLS is the stretch goal.'],
    ['ERA5', 'ECMWF reanalysis similar to POWER (31 km); not NASA and needs a Copernicus account; POWER covers the same need.'],
  ].map(([name, why]) => ({ name, why }));
  const out = {
    generated_at: new Date().toISOString(),
    source_ids: [],
    notes: 'Every source_id used in dashboard/data/*.json should resolve to an entry in "sources". "deferred" lists resources from the team Resources tab not used tonight.',
    sources: [...core, ...t2, ...ksu, ...t1, ...rules],
    deferred,
  };
  writeJson(path.join(DATA, 'sources.json'), out, { pretty: true });
  console.log(`  ${out.sources.length} sources (${core.length} data, ${t2.length} field, ${ksu.length + t1.length} agronomy, ${rules.length} rules), ${deferred.length} deferred`);
}

// ---------------------------------------------------------------------------
const cmds = { site, fields, grid, ndvi, sources: sourcesFile };
const cmd = args.find((a) => !a.startsWith('--')) || 'help';
if (cmd === 'all') {
  await site();
  fields();
  sourcesFile();
  await grid();
  await ndvi();
} else if (cmds[cmd]) {
  await cmds[cmd]();
} else {
  console.log('usage: node scripts/precompute.mjs <site|fields|ndvi|grid|sources|all> [--end=YYYY-MM-DD] [--ndvi-start=YYYY-MM-DD]');
  process.exit(cmd === 'help' ? 0 : 1);
}
