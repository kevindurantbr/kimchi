// Kimchi data layer: live fetchers for NASA POWER, USDA Soil Data Access and
// MODIS NDVI (ORNL DAAC). Plain ES module, no dependencies; runs in the
// browser and in Node 18+ (global fetch / AbortController).
//
// Rule: missing values are null, never 0, and nothing is ever invented. If a
// service fails, the function throws an Error whose message starts with
// "<SERVICE> unavailable: ...".
//
// Owner: P1 (data backend). See PLAN.md §7.1.

// ---------------------------------------------------------------------------
// Source registry (mirrors dashboard/data/sources.json; keep in sync)
// ---------------------------------------------------------------------------

export const SOURCES = {
  NASA_POWER_DAILY: {
    id: 'NASA_POWER_DAILY',
    name: 'NASA POWER Daily API (Agroclimatology community)',
    provider: 'NASA Langley Research Center, POWER project',
    url: 'https://power.larc.nasa.gov/api/temporal/daily/point',
  },
  MODIS_MOD13Q1_ORNL: {
    id: 'MODIS_MOD13Q1_ORNL',
    name: 'MODIS Terra MOD13Q1 v061 NDVI, 250 m, 16-day (ORNL DAAC MODIS Web Service)',
    provider: 'NASA LP DAAC (product), ORNL DAAC (subset service)',
    url: 'https://modis.ornl.gov/rst/api/v1/',
  },
  USDA_SSURGO_SDA: {
    id: 'USDA_SSURGO_SDA',
    name: 'USDA NRCS SSURGO via Soil Data Access',
    provider: 'USDA Natural Resources Conservation Service',
    url: 'https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest',
  },
  USDA_CDL: {
    id: 'USDA_CDL',
    name: 'USDA NASS Cropland Data Layer 2021–2025',
    provider: 'USDA National Agricultural Statistics Service',
    url: 'https://nassgeodata.gmu.edu/CropScape/',
  },
  FAO56: {
    id: 'FAO56',
    name: 'FAO Irrigation and Drainage Paper 56: Crop evapotranspiration',
    provider: 'Food and Agriculture Organization of the United Nations',
    url: 'https://www.fao.org/4/x0490e/x0490e00.htm',
  },
};

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

const EARTH_RADIUS_M = 6378137; // WGS84 semi-major axis, used for areas
const MODIS_SIN_R = 6371007.181; // MODIS sinusoidal sphere radius
const D2R = Math.PI / 180;

async function fetchWithTimeout(url, options = {}, timeoutMs = 45000, service = 'Service') {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, { ...options, signal: ctrl ? ctrl.signal : undefined });
    if (!res.ok) {
      let body = '';
      try { body = (await res.text()).slice(0, 300); } catch { /* ignore */ }
      throw new Error(`${service} unavailable: HTTP ${res.status} ${res.statusText || ''} ${body}`.trim());
    }
    return res;
  } catch (err) {
    if (err && String(err.message || '').startsWith(`${service} unavailable`)) throw err;
    const reason = err && err.name === 'AbortError'
      ? `timed out after ${Math.round(timeoutMs / 1000)} s`
      : (err && (err.cause?.message || err.message)) || String(err);
    throw new Error(`${service} unavailable: ${reason}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 'YYYY-MM-DD' | Date → 'YYYYMMDD' */
export function toPowerDate(d) {
  if (d instanceof Date) return d.toISOString().slice(0, 10).replace(/-/g, '');
  const s = String(d).replace(/-/g, '');
  if (!/^\d{8}$/.test(s)) throw new Error(`Bad date: ${d}`);
  return s;
}

/** 'YYYYMMDD' → 'YYYY-MM-DD' */
function isoFromCompact(s) {
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** Signed area (m²) of one [lon,lat] ring on a sphere (Chamberlain & Duquette 2007). */
function ringAreaM2(ring) {
  const n = ring.length;
  if (n < 3) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[(i + 1) % n];
    total += (lon2 - lon1) * D2R * (2 + Math.sin(lat1 * D2R) + Math.sin(lat2 * D2R));
  }
  return (total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2;
}

/**
 * Area of a GeoJSON Polygon / MultiPolygon geometry (or Feature) in hectares,
 * on a sphere; holes are subtracted. No library needed.
 */
export function polygonAreaHa(geom) {
  const g = geom && geom.type === 'Feature' ? geom.geometry : geom;
  if (!g) return null;
  const polys = g.type === 'Polygon' ? [g.coordinates]
    : g.type === 'MultiPolygon' ? g.coordinates : null;
  if (!polys) return null;
  let m2 = 0;
  for (const rings of polys) {
    rings.forEach((ring, i) => {
      const a = Math.abs(ringAreaM2(ring));
      m2 += i === 0 ? a : -a;
    });
  }
  return m2 / 10000;
}

/** Ray-casting point-in-polygon for a GeoJSON Polygon/MultiPolygon. pt = [lon,lat]. */
export function pointInPolygon(pt, geom) {
  const g = geom && geom.type === 'Feature' ? geom.geometry : geom;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const inRing = (ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  };
  return polys.some((rings) => inRing(rings[0]) && !rings.slice(1).some(inRing));
}

/** Area-weighted centroid-ish point: mean of the outer-ring vertices (fine for compact fields). */
export function polygonCenter(geom) {
  const g = geom && geom.type === 'Feature' ? geom.geometry : geom;
  const ring = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0];
  const pts = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1) : ring;
  const lon = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return { lat, lon };
}

// ---------------------------------------------------------------------------
// 1. NASA POWER daily
// ---------------------------------------------------------------------------

export const POWER_PARAMS = [
  'T2M_MAX', 'T2M_MIN', 'PRECTOTCORR', 'RH2M', 'WS2M', 'ALLSKY_SFC_SW_DWN', 'GWETROOT', 'GWETTOP',
];

/** POWER parameter → output key (lowercase; ALLSKY_SFC_SW_DWN is shortened). */
export function powerKey(param) {
  return param === 'ALLSKY_SFC_SW_DWN' ? 'allsky_sw_dwn' : param.toLowerCase();
}

export const POWER_UNITS = {
  t2m_max: '°C', t2m_min: '°C', prectotcorr: 'mm/day', rh2m: '%', ws2m: 'm/s',
  allsky_sw_dwn: 'MJ/m²/day', gwetroot: '0–1', gwettop: '0–1',
};

/** Stable id for a POWER request location, e.g. "power_39.40_-100.68". */
export function powerSiteId(lat, lon) {
  return `power_${Number(lat).toFixed(2)}_${Number(lon).toFixed(2)}`;
}

/**
 * Fetch NASA POWER daily point data.
 * @param {{lat:number, lon:number, start:string|Date, end:string|Date, params?:string[], timeoutMs?:number}} o
 *   start/end as 'YYYY-MM-DD', 'YYYYMMDD' or Date.
 * @returns {Promise<{site_id, lat, lon, start, end, daily:{date:string[], [k:string]:(number|null)[]}, units, retrieved_at, api_version, sources, request_url}>}
 *   Fill values (-999 or header.fill_value) become null. POWER lags ~3 days
 *   (radiation longer), so trailing days are null; they are kept, not trimmed.
 */
export async function fetchPowerDaily({ lat, lon, start, end, params = POWER_PARAMS, timeoutMs = 45000 }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('fetchPowerDaily: lat/lon required');
  const s = toPowerDate(start);
  const e = toPowerDate(end);
  const url = 'https://power.larc.nasa.gov/api/temporal/daily/point'
    + `?parameters=${params.join(',')}&community=AG`
    + `&longitude=${lon}&latitude=${lat}&start=${s}&end=${e}&format=JSON`;
  const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, timeoutMs, 'POWER');
  let json;
  try { json = await res.json(); } catch (err) { throw new Error(`POWER unavailable: bad JSON (${err.message})`); }
  const p = json && json.properties && json.properties.parameter;
  if (!p) {
    const msg = (json && (json.messages || json.errors || json.message)) || 'no properties.parameter';
    throw new Error(`POWER unavailable: ${JSON.stringify(msg).slice(0, 300)}`);
  }
  const fill = json.header && Number.isFinite(json.header.fill_value) ? json.header.fill_value : -999;
  // Union of dates over all parameters, sorted (they should be identical).
  const dateSet = new Set();
  for (const k of Object.keys(p)) for (const d of Object.keys(p[k])) dateSet.add(d);
  const compact = [...dateSet].sort();
  const daily = { date: compact.map(isoFromCompact) };
  for (const param of params) {
    const series = p[param] || {};
    daily[powerKey(param)] = compact.map((d) => {
      const v = series[d];
      if (v === undefined || v === null) return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n === fill || n <= -999) return null;
      return n;
    });
  }
  const units = {};
  for (const param of params) units[powerKey(param)] = json.parameters?.[param]?.units ?? POWER_UNITS[powerKey(param)] ?? null;
  const elev = json.geometry?.coordinates?.[2];
  return {
    site_id: powerSiteId(lat, lon),
    lat: Number(lat),
    lon: Number(lon),
    start: daily.date[0] ?? isoFromCompact(s),
    end: daily.date[daily.date.length - 1] ?? isoFromCompact(e),
    elevation_m: Number.isFinite(elev) ? elev : null,
    daily,
    units,
    retrieved_at: new Date().toISOString(),
    api_version: json.header?.api?.version ?? null,
    sources: json.header?.sources ?? null,
    request_url: url,
    source_ids: ['NASA_POWER_DAILY'],
  };
}

/** Last date (ISO) on which `key` has a non-null value, or null. */
export function lastValidDate(daily, key) {
  const arr = daily[key];
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] !== null) return daily.date[i];
  return null;
}

// ---------------------------------------------------------------------------
// 2. USDA SSURGO soil for a drawn polygon (Soil Data Access)
// ---------------------------------------------------------------------------

const SDA_URL = 'https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest';

function geomToWkt(geom) {
  const g = geom && geom.type === 'Feature' ? geom.geometry : geom;
  const ringTxt = (ring) => {
    const r = ring.slice();
    const a = r[0];
    const b = r[r.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) r.push(a);
    return '(' + r.map((p) => `${(+p[0]).toFixed(7)} ${(+p[1]).toFixed(7)}`).join(', ') + ')';
  };
  if (g.type === 'Polygon') return `POLYGON(${g.coordinates.map(ringTxt).join(', ')})`;
  if (g.type === 'MultiPolygon') {
    return `MULTIPOLYGON(${g.coordinates.map((rings) => '(' + rings.map(ringTxt).join(', ') + ')').join(', ')})`;
  }
  throw new Error('fetchSoilForPolygon: geometry must be a GeoJSON Polygon or MultiPolygon');
}

/** Parse the POLYGON / MULTIPOLYGON / GEOMETRYCOLLECTION WKT that SQL Server returns; area in m². */
function wktAreaM2(wkt) {
  if (!wkt) return 0;
  let total = 0;
  // Find every polygon body "((...),(...))" and sum outer minus holes.
  const polyRe = /\(\s*(\([^()]*\)(?:\s*,\s*\([^()]*\))*)\s*\)/g;
  let m;
  while ((m = polyRe.exec(wkt)) !== null) {
    const rings = m[1].match(/\([^()]*\)/g) || [];
    rings.forEach((rt, i) => {
      const ring = rt.slice(1, -1).split(',').map((pair) => pair.trim().split(/\s+/).map(Number));
      const a = Math.abs(ringAreaM2(ring));
      total += i === 0 ? a : -a;
    });
  }
  return total;
}

async function sdaQuery(query, timeoutMs) {
  const res = await fetchWithTimeout(SDA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, format: 'JSON+COLUMNNAME' }),
  }, timeoutMs, 'SDA');
  const text = await res.text();
  if (!text.trim()) return []; // SDA returns an empty body when there are no rows
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`SDA unavailable: ${text.slice(0, 300)}`); }
  const table = json.Table || [];
  if (!table.length) return [];
  const [cols, ...rows] = table;
  return rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
}

function dominant(entries) {
  // entries: [{value, area}] → {value, share} by area over entries with a non-null value
  const byVal = new Map();
  let tot = 0;
  for (const { value, area } of entries) {
    if (value === null || value === undefined || value === '') continue;
    byVal.set(value, (byVal.get(value) || 0) + area);
    tot += area;
  }
  let best = null;
  let bestA = -1;
  for (const [v, a] of byVal) if (a > bestA) { best = v; bestA = a; }
  return { value: best, share: tot > 0 && best !== null ? bestA / tot : null, covered_area: tot };
}

const round = (x, d = 3) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

/**
 * SSURGO soil summary for a farmer-drawn field.
 * @param {object} geojsonPolygon GeoJSON Polygon/MultiPolygon geometry or Feature (WGS84).
 * @returns {Promise<{aws_0_150_cm, aws_coverage, drainage, drainage_share, hydgrp, hydgrp_share,
 *   mukeys, map_units, method, field_area_ha, retrieved_at, source_ids}>}
 *   aws_0_150_cm: available water storage 0–150 cm (cm of water), area-weighted over map
 *   units clipped to the field. aws_coverage: share of the field area with a non-null value.
 */
export async function fetchSoilForPolygon(geojsonPolygon, { timeoutMs = 45000 } = {}) {
  const wkt = geomToWkt(geojsonPolygon);
  const fieldAreaM2 = polygonAreaHa(geojsonPolygon) * 10000;
  let rows;
  let method;
  try {
    // Preferred: clip each SSURGO map-unit polygon to the field and weight by clipped area.
    rows = await sdaQuery(`~DeclareGeometry(@aoi)~
SELECT @aoi = geometry::STGeomFromText('${wkt}', 4326).MakeValid();
SELECT P.mukey, P.mupolygongeo.STIntersection(@aoi).STAsText() AS wkt_clip,
  M.muname, M.aws0150wta, M.drclassdcd, M.hydgrpdcd
FROM mupolygon AS P INNER JOIN muaggatt AS M ON M.mukey = P.mukey
WHERE P.mupolygongeo.STIntersects(@aoi) = 1`, timeoutMs);
    for (const r of rows) r.area_m2 = wktAreaM2(r.wkt_clip);
    method = 'area_weighted: SSURGO mupolygon clipped to the field (SDA STIntersection), clipped areas computed on a sphere; muaggatt.aws0150wta (component-weighted) area-weighted; drainage and hydrologic group = dominant-condition class covering the largest clipped area';
  } catch (err) {
    if (!String(err.message).startsWith('SDA unavailable: HTTP')) throw err;
    // Fallback: mukeys only, simple mean (SDA built-in function).
    const keys = await sdaQuery(`SELECT mukey FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('${wkt}')`, timeoutMs);
    const list = keys.map((k) => `'${String(k.mukey).replace(/[^0-9]/g, '')}'`).join(',');
    rows = list ? await sdaQuery(`SELECT mukey, muname, aws0150wta, drclassdcd, hydgrpdcd FROM muaggatt WHERE mukey IN (${list})`, timeoutMs) : [];
    for (const r of rows) r.area_m2 = 1;
    method = 'simple_mean: unweighted mean over intersecting map units (area weighting failed)';
  }

  // Aggregate by mukey (a field can touch several polygons of the same unit).
  const byKey = new Map();
  for (const r of rows) {
    const k = String(r.mukey);
    const cur = byKey.get(k) || { mukey: k, muname: r.muname ?? null, area_m2: 0,
      aws0150wta: r.aws0150wta === null || r.aws0150wta === '' ? null : Number(r.aws0150wta),
      drclassdcd: r.drclassdcd || null, hydgrpdcd: r.hydgrpdcd || null };
    cur.area_m2 += r.area_m2;
    byKey.set(k, cur);
  }
  const units = [...byKey.values()].filter((u) => u.area_m2 > 0);
  const totalArea = method.startsWith('area_weighted') ? fieldAreaM2 : units.reduce((s, u) => s + u.area_m2, 0);
  let wsum = 0;
  let aSum = 0;
  for (const u of units) {
    if (u.aws0150wta === null || !Number.isFinite(u.aws0150wta)) continue;
    wsum += u.aws0150wta * u.area_m2;
    aSum += u.area_m2;
  }
  const drn = dominant(units.map((u) => ({ value: u.drclassdcd, area: u.area_m2 })));
  const hyd = dominant(units.map((u) => ({ value: u.hydgrpdcd, area: u.area_m2 })));
  return {
    aws_0_150_cm: aSum > 0 ? round(wsum / aSum, 2) : null,
    aws_coverage: totalArea > 0 ? round(Math.min(1, aSum / totalArea), 3) : null,
    drainage: drn.value,
    drainage_share: totalArea > 0 && drn.value !== null ? round(Math.min(1, (drn.share * drn.covered_area) / totalArea), 3) : null,
    hydgrp: hyd.value,
    hydgrp_share: totalArea > 0 && hyd.value !== null ? round(Math.min(1, (hyd.share * hyd.covered_area) / totalArea), 3) : null,
    mukeys: units.map((u) => u.mukey),
    map_units: units.map((u) => ({
      mukey: u.mukey, muname: u.muname, area_share: totalArea > 0 ? round(u.area_m2 / totalArea, 3) : null,
      aws_0_150_cm: u.aws0150wta, drainage: u.drclassdcd, hydgrp: u.hydgrpdcd,
    })),
    method,
    field_area_ha: round(fieldAreaM2 / 10000, 2),
    retrieved_at: new Date().toISOString(),
    source_ids: ['USDA_SSURGO_SDA'],
  };
}

// ---------------------------------------------------------------------------
// 3. MODIS MOD13Q1 NDVI (ORNL DAAC MODIS Web Service)
// ---------------------------------------------------------------------------

const ORNL = 'https://modis.ornl.gov/rst/api/v1';

/** 'YYYY-MM-DD' | Date → 'AYYYYDDD' (MODIS date) */
export function toModisDate(d) {
  const dt = d instanceof Date ? d : new Date(`${String(d).slice(0, 10)}T00:00:00Z`);
  const y = dt.getUTCFullYear();
  const doy = Math.floor((Date.UTC(y, dt.getUTCMonth(), dt.getUTCDate()) - Date.UTC(y, 0, 1)) / 86400000) + 1;
  return `A${y}${String(doy).padStart(3, '0')}`;
}

/** MODIS sinusoidal (x, y metres) → [lon, lat] degrees. */
export function sinusoidalToLonLat(x, y) {
  const latR = y / MODIS_SIN_R;
  const lonR = x / (MODIS_SIN_R * Math.cos(latR));
  return [lonR / D2R, latR / D2R];
}

/**
 * Pixel polygons ([lon,lat] closed rings, row-major from the upper-left pixel)
 * for an ORNL subset grid.
 */
export function modisPixelPolygons({ xllcorner, yllcorner, cellsize, nrows, ncols }) {
  const xll = Number(xllcorner);
  const yll = Number(yllcorner);
  const cs = Number(cellsize);
  const polys = [];
  for (let r = 0; r < nrows; r++) {
    const yTop = yll + (nrows - r) * cs;
    const yBot = yTop - cs;
    for (let c = 0; c < ncols; c++) {
      const xL = xll + c * cs;
      const xR = xL + cs;
      const ring = [[xL, yTop], [xR, yTop], [xR, yBot], [xL, yBot], [xL, yTop]]
        .map(([x, y]) => sinusoidalToLonLat(x, y).map((v) => round(v, 6)));
      polys.push(ring);
    }
  }
  return polys;
}

/** Pixel centres ([lon,lat]) in the same row-major order. */
export function modisPixelCenters({ xllcorner, yllcorner, cellsize, nrows, ncols }) {
  const xll = Number(xllcorner);
  const yll = Number(yllcorner);
  const cs = Number(cellsize);
  const out = [];
  for (let r = 0; r < nrows; r++) {
    for (let c = 0; c < ncols; c++) {
      out.push(sinusoidalToLonLat(xll + (c + 0.5) * cs, yll + (nrows - r - 0.5) * cs));
    }
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ornlJson(url, timeoutMs, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, timeoutMs, 'MODIS');
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr;
}

/**
 * MOD13Q1 NDVI subset around a point, scaled to 0–1 with bad values as null.
 * Loops over the composite dates in chunks of 10 (the service limit).
 * @param {{lat, lon, startDate, endDate, kmAboveBelow?, kmLeftRight?, useReliability?, timeoutMs?, onProgress?}} o
 * @returns {Promise<{lat, lon, xllcorner, yllcorner, cellsize, nrows, ncols, pixel_size_m,
 *   pixel_polygons, pixel_centers, dates, modis_dates, pixels, reliability_applied, retrieved_at, source_ids}>}
 *   pixels[i] is the row-major array for dates[i].
 */
export async function fetchModisNdvi({
  lat, lon, startDate, endDate, kmAboveBelow = 1, kmLeftRight = 1,
  useReliability = true, timeoutMs = 45000, onProgress = null, chunk = 10,
}) {
  const product = 'MOD13Q1';
  const datesJson = await ornlJson(`${ORNL}/${product}/dates?latitude=${lat}&longitude=${lon}`, timeoutMs);
  const lo = toModisDate(startDate);
  const hi = toModisDate(endDate);
  const all = (datesJson.dates || []).filter((d) => d.modis_date >= lo && d.modis_date <= hi);
  if (!all.length) throw new Error(`MODIS unavailable: no ${product} composites between ${lo} and ${hi}`);

  const bands = ['250m_16_days_NDVI'];
  if (useReliability) bands.push('250m_16_days_pixel_reliability');
  const got = { };
  let grid = null;
  let reliabilityApplied = useReliability;
  for (const band of bands) {
    got[band] = new Map();
    for (let i = 0; i < all.length; i += chunk) {
      const part = all.slice(i, i + chunk);
      const url = `${ORNL}/${product}/subset?latitude=${lat}&longitude=${lon}&band=${band}`
        + `&startDate=${part[0].modis_date}&endDate=${part[part.length - 1].modis_date}`
        + `&kmAboveBelow=${kmAboveBelow}&kmLeftRight=${kmLeftRight}`;
      let j;
      try {
        j = await ornlJson(url, timeoutMs);
      } catch (err) {
        if (band !== bands[0]) { reliabilityApplied = false; break; } // reliability is optional
        throw err;
      }
      if (!grid) {
        grid = { xllcorner: Number(j.xllcorner), yllcorner: Number(j.yllcorner), cellsize: Number(j.cellsize),
          nrows: Number(j.nrows), ncols: Number(j.ncols) };
      }
      for (const s of j.subset || []) got[band].set(s.modis_date, s.data);
      if (onProgress) onProgress({ band, done: Math.min(i + chunk, all.length), total: all.length });
    }
  }
  const ndviBand = got['250m_16_days_NDVI'];
  const relBand = reliabilityApplied ? got['250m_16_days_pixel_reliability'] : null;
  const dates = [];
  const modisDates = [];
  const pixels = [];
  for (const d of all) {
    const raw = ndviBand.get(d.modis_date);
    if (!raw) continue;
    const rel = relBand ? relBand.get(d.modis_date) : null;
    dates.push(d.calendar_date);
    modisDates.push(d.modis_date);
    pixels.push(raw.map((v, k) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n === -3000) return null;
      const ndvi = n * 0.0001;
      if (ndvi < -0.2 || ndvi > 1) return null;
      if (rel) {
        const q = Number(rel[k]);
        if (q !== 0 && q !== 1) return null; // 0 good, 1 marginal; 2 snow/ice, 3 cloudy, -1 fill
      }
      return round(ndvi, 4);
    }));
  }
  return {
    lat, lon, ...grid,
    pixel_size_m: grid ? round(grid.cellsize, 2) : null,
    pixel_polygons: grid ? modisPixelPolygons(grid) : [],
    pixel_centers: grid ? modisPixelCenters(grid).map((p) => p.map((v) => round(v, 6))) : [],
    dates, modis_dates: modisDates, pixels,
    reliability_applied: Boolean(relBand),
    retrieved_at: new Date().toISOString(),
    source_ids: ['MODIS_MOD13Q1_ORNL'],
  };
}

/** Mean of pixels whose centre is inside `fieldGeom`, per date (null if none valid). */
export function fieldMeanSeries(ndvi, fieldGeom) {
  const inside = ndvi.pixel_centers.map((c) => pointInPolygon(c, fieldGeom));
  return ndvi.pixels.map((row) => {
    let s = 0;
    let n = 0;
    row.forEach((v, k) => { if (inside[k] && v !== null) { s += v; n++; } });
    return n ? round(s / n, 4) : null;
  });
}
