// Pure, dependency-free calculations. See ANALYSIS.md for contracts and limits.
const finite = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const DAY = 86400000;
const months = Array.from({ length: 12 }, (_, i) => i + 1);
const stamp = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s ? Date.parse(s + 'T00:00:00Z') : NaN;
const iso = t => new Date(t).toISOString().slice(0, 10);
const yearOf = s => Number(s.slice(0, 4));
const sum = a => Array.isArray(a) && a.length && a.every(finite) ? a.reduce((s, v) => s + v, 0) : null;
const mean = a => { const s = sum(a); return s === null ? null : s / a.length; };
const pick = (d, indices) => Object.fromEntries(Object.entries(d ?? {}).map(([k, v]) => [k, Array.isArray(v) ? indices.map(i => v[i] ?? null) : v]));
const between = (d, start, end) => pick(d, (d?.date ?? []).flatMap((s, i) => s >= start && s <= end ? [i] : []));
const daysBetween = (start, end) => Math.round((stamp(end) - stamp(start)) / DAY);
const dateRange = (start, end) => {
  const n = daysBetween(start, end);
  return Number.isFinite(n) && n >= 0 ? Array.from({ length: n + 1 }, (_, i) => iso(stamp(start) + i * DAY)) : [];
};

/** UTC day of year, 1–366; invalid or missing dates return null. */
export function doy(dateStr) {
  const t = stamp(dateStr);
  return Number.isFinite(t) ? Math.floor((t - Date.UTC(yearOf(dateStr), 0, 1)) / DAY) + 1 : null;
}

/** Inclusive calendar slice; year is the planting year when the season crosses January. */
export function seasonSlice(daily, fromMMDD, toMMDD, year) {
  if (!daily || !fromMMDD || !toMMDD || !finite(year)) return null;
  return between(daily, `${year}-${fromMMDD}`, `${year + (toMMDD < fromMMDD ? 1 : 0)}-${toMMDD}`);
}

/** Group aligned daily arrays by calendar year without mutating input. */
export function groupByYear(daily) {
  if (!daily) return null;
  const groups = {};
  (daily.date ?? []).forEach((s, i) => { if (s) (groups[yearOf(s)] ??= []).push(i); });
  return Object.fromEntries(Object.entries(groups).map(([y, indices]) => [y, pick(daily, indices)]));
}

/** Daily growing degree days (°C·day), with both temperatures clamped to base/cap. */
export function gddDaily(tmax, tmin, base = 10, cap = 30) {
  if (![tmax, tmin, base, cap].every(finite) || cap < base) return null;
  return (clamp(tmax, base, cap) + clamp(tmin, base, cap)) / 2 - base;
}

/** Aligned cumulative °C·days since planting; a missing day invalidates later totals. */
export function cumulativeGdd(daily, plantDate, base = 10, cap = 30) {
  if (!daily || !plantDate) return null;
  let total = 0, previous = null;
  return (daily.date ?? []).map((s, i) => {
    if (s < plantDate) return null;
    const v = gddDaily(daily.t2m_max?.[i], daily.t2m_min?.[i], base, cap);
    if ((previous === null && s !== plantDate) || (previous && daysBetween(previous, s) !== 1)) total = null;
    previous = s;
    total = total === null || v === null ? null : total + v;
    return total;
  });
}

/** Number of days at or above the threshold (°C); incomplete samples return null. */
export function hotDays(tmaxArr, threshold = 35) {
  return finite(threshold) && Array.isArray(tmaxArr) ? sum(tmaxArr.map(v => finite(v) ? Number(v >= threshold) : null)) : null;
}

/** Sum of daily maximum temperature excess (°C·days); a heat proxy, not a yield model. */
export function heatDegreeDays(tmaxArr, threshold = 30) {
  return finite(threshold) && Array.isArray(tmaxArr) ? sum(tmaxArr.map(v => finite(v) ? Math.max(0, v - threshold) : null)) : null;
}

const vapour = t => 0.6108 * Math.exp(17.27 * t / (t + 237.3));
function radiation(lat, day) {
  if (![lat, day].every(finite) || Math.abs(lat) > 90 || day < 1 || day > 366) return null;
  const phi = lat * Math.PI / 180;
  const dr = 1 + 0.033 * Math.cos(2 * Math.PI * day / 365);
  const delta = 0.409 * Math.sin(2 * Math.PI * day / 365 - 1.39);
  const ws = Math.acos(clamp(-Math.tan(phi) * Math.tan(delta), -1, 1));
  return Math.max(0, 24 * 60 / Math.PI * 0.0820 * dr * (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws)));
}

/** FAO-56 daily grass reference ET₀ (mm/day). RH %, wind at 2 m in m/s, Rs MJ/m²/day. */
export function et0PenmanMonteith(input) {
  if (!input) return null;
  const {tmax, tmin, rh, ws2, rs_mj, lat, doy: day, elev_m = 850} = input;
  if (![tmax,tmin,rh,ws2,rs_mj,lat,day,elev_m].every(finite) || tmax < tmin || tmin <= -237.3 || rh < 0 || rh > 100 || ws2 < 0 || rs_mj < 0) return null;
  const ra = radiation(lat, day);
  const rso = ra === null ? null : (0.75 + 2e-5 * elev_m) * ra;
  if (!finite(rso) || rso <= 0) return null;
  const t = (tmax + tmin) / 2;
  const es = (vapour(tmax) + vapour(tmin)) / 2, ea = es * rh / 100;
  const delta = 4098 * vapour(t) / (t + 237.3) ** 2;
  const pressure = 101.3 * ((293 - 0.0065 * elev_m) / 293) ** 5.26;
  const gamma = 0.000665 * pressure;
  const rnl = 4.903e-9 * ((tmax + 273.16) ** 4 + (tmin + 273.16) ** 4) / 2 * (0.34 - 0.14 * Math.sqrt(ea)) * (1.35 * clamp(rs_mj / rso, 0.3, 1) - 0.35);
  const rn = 0.77 * rs_mj - rnl;
  const value = (0.408 * delta * rn + gamma * 900 / (t + 273) * ws2 * (es - ea)) / (delta + gamma * (1 + 0.34 * ws2));
  return finite(value) ? Math.max(0, value) : null;
}

/** FAO-56 eq. 52 ET₀ (mm/day), including Ra's 0.408 MJ-to-mm conversion. */
export function et0Hargreaves(input) {
  if (!input) return null;
  const {tmax, tmin, lat, doy: day} = input;
  const ra = radiation(lat, day);
  if (![tmax,tmin,ra].every(finite) || tmax < tmin) return null;
  return Math.max(0, 0.0023 * ((tmax + tmin) / 2 + 17.8) * Math.sqrt(tmax - tmin) * ra * 0.408);
}

/** Aligned ET₀ and method labels. Missing humidity/wind/radiation falls back to Hargreaves. */
export function et0(daily, lat) {
  if (!daily) return {values:[],method_per_day:[]};
  const unit = daily.units?.allsky_sw_dwn ?? daily.parameters?.ALLSKY_SFC_SW_DWN?.units ?? 'MJ/m^2/day';
  const multiplier = /kwh|kw-hr/i.test(unit) ? 3.6 : /^MJ/i.test(unit) ? 1 : null;
  const method_per_day = [];
  const values = (daily.date ?? []).map((s, i) => {
    const input = {tmax:daily.t2m_max?.[i],tmin:daily.t2m_min?.[i],rh:daily.rh2m?.[i],ws2:daily.ws2m?.[i],rs_mj:finite(daily.allsky_sw_dwn?.[i]) && multiplier !== null ? daily.allsky_sw_dwn[i] * multiplier : null,lat,doy:doy(s),elev_m:daily.elev_m === undefined ? 850 : daily.elev_m};
    let v = et0PenmanMonteith(input), method = 'penman_monteith';
    if (v === null) { v = et0Hargreaves(input); method = 'hargreaves'; }
    method_per_day.push(v === null ? null : method);
    return v;
  });
  return {values, method_per_day};
}

/** FAO single crop coefficient by elapsed calendar days; zero outside its stage schedule. */
export function kcCurve(crop, plantDate, dates) {
  if (!Array.isArray(dates)) return null;
  const k = crop?.kc, lengths = k?.stage_days;
  if (!k || ![k.ini,k.mid,k.end].every(finite) || !Array.isArray(lengths) || lengths.length !== 4 || !lengths.every(v => finite(v) && v >= 0) || !Number.isFinite(stamp(plantDate))) return dates.map(() => null);
  const [ini, dev, mid, end] = lengths, total = ini + dev + mid + end;
  return dates.map(s => {
    const day = daysBetween(plantDate, s);
    if (!finite(day)) return null;
    if (day < 0 || day >= total) return 0;
    if (day < ini) return k.ini;
    if (day < ini + dev) return k.ini + (k.mid - k.ini) * (day - ini) / dev;
    if (day < ini + dev + mid) return k.mid;
    return k.mid + (k.end - k.mid) * (day - ini - dev - mid) / end;
  });
}

/** Elementwise estimated crop demand ET₀ × Kc in mm/day; null never becomes zero. */
export function cropDemand(etValues, kc) {
  if (!Array.isArray(etValues) || !Array.isArray(kc)) return null;
  return etValues.map((v,i) => finite(v) && finite(kc[i]) ? v * kc[i] : null);
}

/** Season supply minus demand (mm). Any missing component invalidates its total. */
export function seasonWaterBalance(daily, etValues, kc, irrigationMm = 0) {
  const rain_mm = sum(daily?.prectotcorr), demand_mm = sum(cropDemand(etValues,kc));
  const irrigation_mm = Array.isArray(irrigationMm) ? sum(irrigationMm) : finite(irrigationMm) ? irrigationMm : null;
  return {rain_mm, irrigation_mm, demand_mm, balance_mm:[rain_mm,irrigation_mm,demand_mm].every(finite) ? rain_mm + irrigation_mm - demand_mm : null};
}

/** Simplified FAO-56 depletion bucket (mm), initially at field capacity; RAW = p × TAW. */
export function rootZoneBucket(input = {}) {
  const {dates = [],rain,demand,irrigation,taw_mm,p} = input ?? {};
  const valid = finite(taw_mm) && taw_mm > 0 && finite(p) && p >= 0 && p <= 1;
  let dr = valid ? 0 : null, count = 0, first = null;
  const depletion_mm = dates.map((s,i) => {
    const r = rain?.[i], d = demand?.[i], irr = irrigation?.[i];
    if (dr === null || ![r,d,irr].every(v => finite(v) && v >= 0) || (i > 0 && daysBetween(dates[i-1],s) !== 1)) { dr = null; return null; }
    dr = clamp(dr + d - r - irr, 0, taw_mm);
    if (dr > p * taw_mm) { count++; first ??= s; }
    return dr;
  });
  return {depletion_mm,stress_days:dates.length && depletion_mm.every(finite) ? count : null,first_stress_date:first,taw_mm:valid ? taw_mm : null,raw_mm:valid ? p*taw_mm : null,method:'simplified: no runoff, no capillary rise'};
}

/** Continuous gross well capacity (mm/day), US gallons/minute and field hectares. */
export function wellCapacityMmDay(gpm, area_ha) {
  return finite(gpm) && gpm >= 0 && finite(area_ha) && area_ha > 0 ? gpm * 1440 * 3.785 / (area_ha * 10000) : null;
}

function rolling(values, window) {
  if (!Array.isArray(values) || !Number.isInteger(window) || window < 1) return [];
  return values.slice(window - 1).map((_,i) => mean(values.slice(i,i+window)));
}

/** Maximum complete rolling mean demand (mm/day); incomplete windows are excluded. */
export function peakDemand(demand, window = 7) {
  const valid = rolling(demand,window).filter(finite);
  return valid.length ? Math.max(...valid) : null;
}

/** Gross well-capacity comparison; unknown capacity is not a passing result. */
export function capacityCheck(peakDemandMmDay, wellMmDay) {
  if (![peakDemandMmDay,wellMmDay].every(v=>finite(v)&&v>=0)) return {shortfall_mm_day:null,ok:null,text:'Capacity comparison unavailable'};
  const shortfall_mm_day = Math.max(0,peakDemandMmDay-wellMmDay);
  return {shortfall_mm_day,ok:shortfall_mm_day===0,text:shortfall_mm_day > 0 ? `Peak demand exceeds well capacity by ${shortfall_mm_day.toFixed(2)} mm/day` : 'Gross well capacity meets the estimated peak demand'};
}

const clean = a => Array.isArray(a) ? a.filter(finite) : [];
function quantile(sample, p) {
  const sorted = clean(sample).sort((a,b)=>a-b);
  if (!sorted.length) return null;
  const pos = (sorted.length-1)*p, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo]+(sorted[hi]-sorted[lo])*(pos-lo);
}
const median = sample => quantile(sample,0.5);
function distribution(sample) {
  const n = clean(sample).length;
  return {n,...Object.fromEntries([10,25,50,75,90].map(p=>[`p${p}`,n >= 10 ? quantile(sample,p/100) : null]))};
}

/** Empirical Weibull percentile 100·rank/(n+1), midranks for ties; at least 10 values. */
export function percentileRank(value, sample) {
  const values = clean(sample).sort((a,b)=>a-b), n = values.length;
  if (!finite(value) || n < 10) return null;
  const less = values.filter(v=>v<value).length, equal = values.filter(v=>v===value).length;
  if (equal) return 100*(less+(equal+1)/2)/(n+1);
  if (!less) return 0;
  if (less===n) return 100;
  return 100*(less+(value-values[less-1])/(values[less]-values[less-1]))/(n+1);
}

/** Percentile status with adverse-tail severity, source IDs and an explicit unknown state. */
export function status(value, sample, options = {}) {
  const {adverseWhen='low',unit='',label='Lower',source_ids=[]} = options ?? {};
  const percentile = percentileRank(value,sample);
  const result = {value:finite(value)?value:null,unit,normal_median:median(sample),percentile,direction:'normal',severity:null,label:'Unavailable: need a value and at least 10 historical observations',source_ids:[...source_ids]};
  if (percentile===null) { result.direction=null; return result; }
  const adverse = adverseWhen==='low' ? percentile < 25 : percentile > 75;
  const favourable = adverseWhen==='low' ? percentile > 75 : percentile < 25;
  return {...result,direction:adverse?'adverse':favourable?'favourable':'normal',severity:adverse?clamp((Math.abs(percentile-50)-25)/25,0,1):0,label:`${label} than ${Math.round(adverseWhen==='low'?100-percentile:percentile)}% of years for this date`};
}

const calendarDay = s => doy(`2000-${s.slice(5)}`);
/** Baseline p10/p25/p50/p75/p90 arrays, indexed by canonical leap-year day or month minus one. */
export function climatology(daily, field, {baseline=[1991,2020],window='doy',smooth=15} = {}) {
  const size = window==='month'?12:366, bins = Array.from({length:size},()=>[]);
  (daily?.date ?? []).forEach((s,i) => {
    const v = daily[field]?.[i], y = yearOf(s);
    if (y < baseline[0] || y > baseline[1] || !finite(v)) return;
    const key = window==='month' ? Number(s.slice(5,7))-1 : calendarDay(s)-1;
    bins[key]?.push(v);
  });
  const summaries = bins.map((values,i) => {
    if (window==='month') return distribution(values);
    const pool = [];
    for (let offset=-Math.min(182,Math.max(0,smooth));offset<=Math.min(182,Math.max(0,smooth));offset++) pool.push(...bins[(i+offset+366)%366]);
    return distribution(pool);
  });
  return {window,baseline,...Object.fromEntries(['n','p10','p25','p50','p75','p90'].map(k=>[k,summaries.map(s=>s[k])]))};
}

function annualPairs(values, years) {
  const groups = new Map();
  (values ?? []).forEach((v,i)=> { if (finite(v) && finite(years?.[i])) { const y=years[i]; if (!groups.has(y)) groups.set(y,[]); groups.get(y).push(v); } });
  return [...groups].sort((a,b)=>a[0]-b[0]).map(([year,v])=>({year,value:mean(v)}));
}

/** Recurrence among valid annual observations; duplicates are averaged per year. */
export function recurrence(annualValues, years, predicate) {
  const pairs = annualPairs(annualValues,years), matching = pairs.filter(p=>predicate(p.value)).map(p=>p.year);
  return {count:matching.length,n:pairs.length,years_matching:matching,text:`${matching.length} of ${pairs.length} years`};
}

// Abramowitz–Stegun normal tail approximation; two-sided p, continuity correction below.
function twoSidedP(z) {
  const x=Math.abs(z), t=1/(1+0.2316419*x);
  return clamp(2*Math.exp(-x*x/2)/Math.sqrt(2*Math.PI)*(0.319381530*t-0.356563782*t*t+1.781477937*t**3-1.821255978*t**4+1.330274429*t**5),0,1);
}

/** Two-sided Mann–Kendall test with tie correction; input order is chronological. */
export function mannKendall(values) {
  const v=clean(values), n=v.length;
  if(n<2) return {S:null,z:null,p:null,trend:'no clear trend'};
  let S=0; const ties=new Map();
  for(let i=0;i<n;i++){ ties.set(v[i],(ties.get(v[i])??0)+1); for(let j=i+1;j<n;j++) S+=Math.sign(v[j]-v[i]); }
  const correction=[...ties.values()].reduce((s,t)=>s+t*(t-1)*(2*t+5),0);
  const variance=(n*(n-1)*(2*n+5)-correction)/18;
  const z=variance===0||S===0?0:(S-Math.sign(S))/Math.sqrt(variance), p=z===0?1:twoSidedP(z);
  return {S,z,p,trend:p<0.05?(S>0?'increasing':'decreasing'):'no clear trend'};
}

/** Median pairwise annual slope, expressed per decade; equal-year pairs are collapsed. */
export function senSlope(values, years) {
  const pairs=annualPairs(values,years), slopes=[];
  for(let i=0;i<pairs.length;i++) for(let j=i+1;j<pairs.length;j++) slopes.push(10*(pairs[j].value-pairs[i].value)/(pairs[j].year-pairs[i].year));
  return median(slopes);
}

/** Show trend only for at least 30 distinct years with numeric observations. */
export function trend(values, years) {
  const pairs=annualPairs(values,years);
  if(pairs.length<30) return {shown:false,reason:'need ≥ 30 years'};
  return {shown:true,n:pairs.length,...mannKendall(pairs.map(p=>p.value)),slope_per_decade:senSlope(pairs.map(p=>p.value),pairs.map(p=>p.year))};
}

function complete(d,start,end,fields=[]) {
  const dates=d?.date??[];
  return dates.length===dateRange(start,end).length && dates[0]===start && dates.at(-1)===end && dates.every((s,i)=>i===0||daysBetween(dates[i-1],s)===1) && fields.every(k=>Array.isArray(d[k])&&d[k].length===dates.length&&d[k].every(finite));
}

/** Last frost before July 1 and first frost after July 1; missing half-years are unknown. */
export function frostDates(daily, year, threshold=0) {
  if (!daily || !finite(year) || !finite(threshold)) return {last_spring:null,first_fall:null,frost_free_days:null};
  const spring=between(daily,`${year}-01-01`,`${year}-06-30`), fall=between(daily,`${year}-07-02`,`${year}-12-31`);
  const frost=d=>d.date.filter((_,i)=>d.t2m_min[i]<=threshold);
  const last_spring=complete(spring,`${year}-01-01`,`${year}-06-30`,['t2m_min'])?frost(spring).at(-1)??null:null;
  const first_fall=complete(fall,`${year}-07-02`,`${year}-12-31`,['t2m_min'])?frost(fall)[0]??null:null;
  return {last_spring,first_fall,frost_free_days:last_spring&&first_fall?daysBetween(last_spring,first_fall)-1:null};
}

const monthBounds=(y,m)=>[`${y}-${String(m).padStart(2,'0')}-01`,iso(Date.UTC(y,m,0))];
function monthGroups(daily) {
  const groups=new Map();
  (daily?.date??[]).forEach((s,i)=>{const key=s.slice(0,7);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);});
  return [...groups].map(([key,indices])=>({year:Number(key.slice(0,4)),month:Number(key.slice(5)),daily:pick(daily,indices),indices}));
}

/** Monthly share of complete years whose metric is >= threshold (or satisfies a predicate). */
export function monthlyRecurrence(daily, metricFn, threshold) {
  const groups=monthGroups(daily);
  return months.map(month=>{
    const entries=groups.filter(g=>g.month===month).map(g=>({year:g.year,value:complete(g.daily,...monthBounds(g.year,month))?metricFn(g.daily):null}));
    const r=recurrence(entries.map(e=>e.value),entries.map(e=>e.year),typeof threshold==='function'?threshold:v=>finite(threshold)&&v>=threshold);
    return {month,...r,share:r.n?r.count/r.n:null};
  });
}

const composite = s => Math.floor((doy(s)-1)/16);
function ndviSample(fieldNdvi,date) {
  return (fieldNdvi?.dates??[]).flatMap((s,i)=>yearOf(s)>=2001&&yearOf(s)<=2025&&yearOf(s)!==yearOf(date)&&composite(s)===composite(date)&&finite(fieldNdvi.field_mean?.[i])?[fieldNdvi.field_mean[i]]:[]);
}

/** NDVI status for the current 16-day composite versus 2001–2025, excluding target year. */
export function ndviStatus(fieldNdvi, date) {
  const index = (fieldNdvi?.dates??[]).findIndex(s=>s<=date&&yearOf(s)===yearOf(date)&&composite(s)===composite(date));
  return status(index<0?null:fieldNdvi.field_mean?.[index],date?ndviSample(fieldNdvi,date):[],{adverseWhen:'low',unit:'NDVI',label:'Less green',source_ids:['MODIS_MOD13Q1_ORNL']});
}

/** Per-year/month observed mean NDVI below threshold; missing months stay null. */
export function greenCoverCalendar(fieldNdvi, threshold=0.3) {
  const groups=monthGroups({date:fieldNdvi?.dates??[],ndvi:fieldNdvi?.field_mean??[]});
  const years=[...new Set(groups.map(g=>g.year))].sort((a,b)=>a-b);
  return {label:'low green cover',years,months:[...months],low_cover:years.map(y=>months.map(m=>{
    const g=groups.find(g=>g.year===y&&g.month===m), v=mean(g?.daily.ndvi);
    return v===null||!finite(threshold)?null:v<threshold;
  }))};
}

/** Co-occurrence scouting clue, never proof of cause. Missing evidence has its own code. */
export function causeCheck({ndviStatus,soilStatus,heatStatus,waterStatus} = {}) {
  const known=s=>s&&s.direction!==null&&finite(s.severity), adverse=s=>known(s)&&s.direction==='adverse';
  if(!known(ndviStatus)) return {code:'unavailable',text:'Greenness evidence is unavailable'};
  if(!adverse(ndviStatus)) return {code:'none',text:'Greenness is not in the adverse historical tail'};
  if(adverse(waterStatus)||adverse(soilStatus)) return {code:'water',text:'Low greenness coincides with adverse water or soil conditions; this is a scouting clue, not proof of cause.'};
  if(adverse(heatStatus)) return {code:'heat',text:'Low greenness coincides with heat; this is a scouting clue, not proof of cause.'};
  if(![soilStatus,waterStatus,heatStatus].every(known)) return {code:'unavailable',text:'Weather evidence is incomplete; the cause of low greenness is unknown'};
  return {code:'not_weather',text:"Weather doesn't explain this; scout for pests, nutrients, hail, or equipment issues"};
}

/** Monthly 0–3 stressor count against 1991–2020 monthly distributions; incomplete cells are null. */
export function compoundCalendar(daily, etValues, {years} = {}) {
  const groups=monthGroups({...daily,et_values:Array.isArray(etValues)?etValues:etValues?.values??[]}).map(g=>{
    const full=complete(g.daily,...monthBounds(g.year,g.month));
    const hot=full?hotDays(g.daily.t2m_max):null, wet=full?mean(g.daily.gwetroot):null;
    const rain=full?sum(g.daily.prectotcorr):null, demand=full?sum(g.daily.et_values):null;
    return {...g,hot,wet,deficit:finite(rain)&&finite(demand)?rain-demand:null};
  });
  const normals=months.map(m=>{const g=groups.filter(g=>g.month===m&&g.year>=1991&&g.year<=2020);return {soil:distribution(g.map(g=>g.wet)).p25,water:distribution(g.map(g=>g.deficit)).p25};});
  years=years??[...new Set(groups.map(g=>g.year))].sort((a,b)=>a-b);
  const detail=years.map(y=>months.map(m=>{
    const g=groups.find(g=>g.year===y&&g.month===m), n=normals[m-1];
    const hot=finite(g?.hot)?g.hot>=3:null, dry_soil=finite(g?.wet)&&finite(n.soil)?g.wet<n.soil:null, water_deficit=finite(g?.deficit)&&finite(n.water)?g.deficit<n.water:null;
    return {year:y,month:m,hot,dry_soil,water_deficit};
  }));
  return {years,months:[...months],counts:detail.map(row=>row.map(d=>[d.hot,d.dry_soil,d.water_deficit].some(v=>v===null)?null:Number(d.hot)+Number(d.dry_soil)+Number(d.water_deficit))),detail};
}

const POWER=['NASA_POWER_DAILY'], WATER=['NASA_POWER_DAILY','FAO56'];
function stageWindow(daily,crop,plantDate,upper=crop?.sensitive_window?.gdd_to) {
  const w=crop?.sensitive_window;
  const empty={name:w?.name??null,start:null,end:null,hot_days:null,heat_degree_days:null,complete:false,progress:null};
  if(!plantDate||![w?.gdd_from,w?.gdd_to,upper,crop?.gdd_base_c,crop?.gdd_cap_c,crop?.heat_threshold_c].every(finite)||w.gdd_to<w.gdd_from) return empty;
  const py=yearOf(plantDate), harvest=crop.season?.harvest??'12-31', end=`${py+(harvest<plantDate.slice(5)?1:0)}-${harvest}`;
  const d=between(daily,plantDate,end), gd=cumulativeGdd(d,plantDate,crop.gdd_base_c,crop.gdd_cap_c)??[];
  const endIndex=gd.findIndex(v=>finite(v)&&v>=upper);
  const last=endIndex>=0?endIndex:gd.length-1;
  if(last<0||!finite(gd[last])) return empty;
  const indices=gd.flatMap((v,i)=>i<=last&&finite(v)&&v>=w.gdd_from&&v<=upper?[i]:[]);
  if(!indices.length) return {...empty,progress:gd[last]};
  const tx=indices.map(i=>d.t2m_max[i]);
  return {name:w.name,start:d.date[indices[0]],end:endIndex>=0?d.date[indices.at(-1)]:null,hot_days:hotDays(tx,crop.heat_threshold_c),heat_degree_days:heatDegreeDays(tx),complete:endIndex>=0,progress:Math.min(gd[last],upper)};
}

/** Heat within crop GDD window versus 1991–2020 at equivalent GDD progress. */
export function stageHeat(daily,crop,plantDate,year) {
  const current=stageWindow(daily,crop,plantDate), historical=[];
  if(finite(current.progress)&&current.start) for(let y=1991;y<=2020;y++) {
    if(y===year)continue;
    const pd=`${y-(year-yearOf(plantDate))}-${plantDate.slice(5)}`;
    const h=stageWindow(daily,crop,pd,current.progress);
    if(h.complete)historical.push({year:y,...h});
  }
  return {...current,status:status(current.hot_days,historical.map(h=>h.hot_days),{adverseWhen:'high',unit:'days',label:'More hot days',source_ids:POWER}),normal_heat_degree_days:median(historical.map(h=>h.heat_degree_days)),historical};
}

function spearman(points,key) {
  const pairs=points.filter(p=>finite(p[key])&&finite(p.yield));
  if(new Set(pairs.map(p=>p.year)).size<5) return null;
  const rank=v=>v.map(x=>v.filter(t=>t<x).length+(v.filter(t=>t===x).length+1)/2);
  const x=rank(pairs.map(p=>p[key])),y=rank(pairs.map(p=>p.yield)), mx=mean(x),my=mean(y);
  const cov=x.reduce((s,v,i)=>s+(v-mx)*(y[i]-my),0), vx=sum(x.map(v=>(v-mx)**2)),vy=sum(y.map(v=>(v-my)**2));
  return vx>0&&vy>0?cov/Math.sqrt(vx*vy):null;
}

/** Match farmer season yields to weather indicators; Spearman associations are pattern, not proof. */
export function farmSensitivity(records,annualIndicators) {
  const indicators=Array.isArray(annualIndicators)?annualIndicators:[];
  const points=(records??[]).filter(r=>finite(r.yield)&&(r.period??'season')==='season').flatMap(r=>{
    const indicator=indicators.find(v=>v.year===r.year);
    return indicator?[{year:r.year,crop:r.crop??null,yield:r.yield,yield_unit:r.yield_unit??null,hot_days:indicator.hot_days??null,season_deficit_mm:indicator.season_deficit_mm??null}]:[];
  });
  const note='pattern, not proof';
  if(new Set(points.map(p=>p.year)).size<5) return {pattern:'too few years to judge',points,note};
  const comparable=new Set(points.map(p=>`${p.crop}|${p.yield_unit}`)).size===1&&points.every(p=>p.crop&&p.yield_unit)&&new Set(points.map(p=>p.year)).size===points.length;
  return {pattern:comparable?'association only':'incomparable crops, yield units, or duplicate years',points,rho:{hot_days:comparable?spearman(points,'hot_days'):null,season_deficit_mm:comparable?spearman(points,'season_deficit_mm'):null},note};
}
