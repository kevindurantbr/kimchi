// TEMPORARY stand-in for P1's fetchPowerDaily (same endpoint and output shape). Delete when lib/sources.mjs lands.
// Real NASA POWER data; -999 and the header fill value become null, never 0.
const PARAMS = ['T2M_MAX', 'T2M_MIN', 'PRECTOTCORR', 'RH2M', 'WS2M', 'ALLSKY_SFC_SW_DWN', 'GWETROOT', 'GWETTOP'];
const RENAME = { ALLSKY_SFC_SW_DWN: 'allsky_sw_dwn' };

export async function fetchPowerDaily({ lat, lon, start, end, params = PARAMS }) {
  const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=${params.join(',')}&community=AG&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}&start=${start}&end=${end}&format=JSON`;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 45000);
  let j;
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    j = await r.json();
  } catch (e) { throw new Error('POWER unavailable: ' + (e.name === 'AbortError' ? 'timeout after 45 s' : e.message)); }
  finally { clearTimeout(t); }
  const fill = j.header?.fill_value ?? -999, p = j.properties?.parameter ?? {};
  const keys = Object.keys(p[params[0]] ?? {}).sort();
  const daily = { date: keys.map(k => `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`) };
  for (const name of params) {
    const out = (RENAME[name] ?? name.toLowerCase());
    daily[out] = keys.map(k => { const v = p[name]?.[k]; return v == null || v === fill || v === -999 ? null : v; });
  }
  return { site_id: `power_${lat.toFixed(2)}_${lon.toFixed(2)}`, lat, lon, start, end, daily, retrieved_at: new Date().toISOString(), api_version: j.header?.api?.version ?? null };
}
