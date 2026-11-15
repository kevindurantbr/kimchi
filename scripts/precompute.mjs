#!/usr/bin/env node
// Kimchi precompute: writes the static data files the dashboard reads.
//
//   node scripts/precompute.mjs site      → dashboard/data/site_history.json
//   node scripts/precompute.mjs fields    → dashboard/data/demo_fields.geojson
//   node scripts/precompute.mjs ndvi      → dashboard/data/fields_ndvi.json
//   node scripts/precompute.mjs grid      → dashboard/data/region_grid.json
//   node scripts/precompute.mjs all
//
// Options: --ndvi-start=YYYY-MM-DD (default 2001-01-01), --end=YYYY-MM-DD (default today, UTC)
// Node 18+, no npm dependencies. See scripts/README.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchPowerDaily, fetchModisNdvi, fieldMeanSeries, polygonAreaHa, polygonCenter,
  pointInPolygon, powerSiteId, lastValidDate,
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
// ---------------------------------------------------------------------------
async function ndvi() {
  const fc = fs.existsSync(path.join(DATA, 'demo_fields.geojson'))
    ? readJson(path.join(DATA, 'demo_fields.geojson')) : fields();
  const start = opt('ndvi-start', '2001-01-01');
  const outFile = path.join(DATA, 'fields_ndvi.json');
  const prev = fs.existsSync(outFile) ? readJson(outFile) : null;
  const outFields = [];
  const failures = [];
  for (const f of fc.features) {
    const id = f.properties.field_id;
    const { lat, lon } = polygonCenter(f.geometry);
    console.log(`ndvi: ${id} MOD13Q1 ${start}..${TODAY} at ${lat.toFixed(5)}, ${lon.toFixed(5)}`);
    try {
      const n = await fetchModisNdvi({
        lat: r2(lat, 5), lon: r2(lon, 5), startDate: start, endDate: TODAY, kmAboveBelow: 1, kmLeftRight: 1,
        timeoutMs: 90000,
        onProgress: ({ band, done, total }) => process.stdout.write(`\r  ${band} ${done}/${total}   `),
      });
      process.stdout.write('\n');
      outFields.push({
        field_id: id,
        request: { lat: r2(lat, 5), lon: r2(lon, 5), kmAboveBelow: 1, kmLeftRight: 1 },
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
      });
    } catch (err) {
      process.stdout.write('\n');
      console.warn(`  ${id} FAILED: ${err.message}`);
      failures.push({ field_id: id, error: err.message });
      const old = prev?.fields?.find((x) => x.field_id === id);
      if (old) { console.warn(`  keeping previous ${id} data from ${old.retrieved_at}`); outFields.push(old); }
    }
  }
  if (!outFields.length) {
    console.error('ndvi: no field succeeded; fields_ndvi.json not written. Run from a machine that can reach modis.ornl.gov.');
    return false;
  }
  writeJson(outFile, {
    generated_at: new Date().toISOString(),
    source_ids: ['MODIS_MOD13Q1_ORNL'],
    notes: [
      'NDVI = raw x 0.0001. Null = fill (-3000), out of range (-0.2..1), or pixel_reliability not 0 (good) / 1 (marginal).',
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
const cmds = { site, fields, grid, ndvi };
const cmd = args.find((a) => !a.startsWith('--')) || 'help';
if (cmd === 'all') {
  await site();
  fields();
  await grid();
  await ndvi();
} else if (cmds[cmd]) {
  await cmds[cmd]();
} else {
  console.log('usage: node scripts/precompute.mjs <site|fields|ndvi|grid|all> [--end=YYYY-MM-DD] [--ndvi-start=YYYY-MM-DD]');
  process.exit(cmd === 'help' ? 0 : 1);
}
