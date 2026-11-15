import test from 'node:test';
import assert from 'node:assert/strict';
import * as a from './analysis.mjs';

test('NDVI compares the same 16-day period and labels low greenness without claiming bare soil', () => {
  const ndvi={dates:[...Array.from({length:25},(_,i)=>`${2001+i}-07-12`),'2026-07-12'],field_mean:[...Array(25).fill(0.7),0.2]};
  const s=a.ndviStatus(ndvi,'2026-07-15');
  assert.equal(s.value,0.2);
  assert.equal(s.normal_median,0.7);
  assert.equal(s.direction,'adverse');
  assert.equal(a.ndviStatus(ndvi,'2026-08-20').value,null);
  const c=a.greenCoverCalendar(ndvi);
  assert.equal(c.label,'low green cover');
  assert.equal(c.low_cover.at(-1)[6],true);
  assert.equal(c.low_cover.at(-1)[7],null);
});

test('frost boundaries require complete half-years and monthly recurrence excludes missing months', () => {
  const dates = Array.from({length:365},(_,i)=>new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10));
  const temps = dates.map(s=>s==='2025-04-20'||s==='2025-10-10'?-1:10);
  const f=a.frostDates(daily(dates,{t2m_min:temps}),2025);
  assert.equal(f.last_spring,'2025-04-20');
  assert.equal(f.first_fall,'2025-10-10');
  assert.equal(f.frost_free_days,172);
  temps[0]=null;
  assert.equal(a.frostDates(daily(dates,{t2m_min:temps}),2025).last_spring,null);
  const r=a.monthlyRecurrence(daily(dates,{prectotcorr:dates.map(()=>1)}),d=>d.prectotcorr.reduce((s,v)=>s+v,0),30);
  assert.equal(r[0].text,'1 of 1 years');
  assert.equal(r[1].count,0);
});

test('trend requires 30 distinct observed years and detects a monotonic decade slope', () => {
  const values = Array.from({length:30},(_,i)=>i), years = values.map(i=>1991+i);
  const t = a.trend(values,years);
  assert.equal(t.shown,true);
  assert.equal(t.trend,'increasing');
  assert.ok(t.p<0.05);
  assert.equal(t.slope_per_decade,10);
  assert.equal(a.mannKendall([1,null,2,3]).S,3);
  assert.equal(a.mannKendall(Array(30).fill(2)).p,1);
  assert.equal(a.trend(values.slice(1),years.slice(1)).reason,'need ≥ 30 years');
  assert.equal(a.trend(values,Array(30).fill(2000)).shown,false);
  assert.deepEqual(a.recurrence([0,null,2],[2000,2001,2002],v=>v>1),{count:1,n:2,years_matching:[2002],text:'1 of 2 years'});
});

test('climatology aligns month-days across leap years and excludes outside-baseline data', () => {
  const dates = Array.from({length:30},(_,i)=>`${1991+i}-03-01`);
  const d = daily([...dates,'2026-03-01'],{gwetroot:[...Array(30).fill(0.5),0]});
  const c = a.climatology(d,'gwetroot',{baseline:[1991,2020],window:'doy',smooth:0});
  assert.equal(c.p50[60],0.5); // canonical leap-year March 1
  assert.equal(c.p50[59],null);
  assert.equal(a.climatology(d,'gwetroot',{window:'month'}).p50[2],0.5);
});

test('Weibull ranks give zero severity at quartile boundaries and only penalize the adverse tail', () => {
  const sample = Array.from({length:99},(_,i)=>i+1);
  for (const value of [25,50,75]) {
    assert.equal(a.percentileRank(value,sample),value);
    assert.equal(a.status(value,sample,{adverseWhen:'low',unit:'mm',label:'Drier'}).severity,0);
  }
  const dry = a.status(10,sample,{adverseWhen:'low',unit:'mm',label:'Drier'});
  near(dry.severity,0.6);
  assert.match(dry.label,/90%/);
  assert.equal(a.status(90,sample,{adverseWhen:'low'}).severity,0);
  assert.equal(a.percentileRank(1,[1,2,null]),null);
  assert.equal(a.status(null,sample).severity,null);
  assert.equal(a.percentileRank(5,Array(20).fill(5)),50);
});

test('well capacity is compared to a complete seven-day peak, not an isolated daily maximum', () => {
  near(a.wellCapacityMmDay(600,50.2),6.5,0.02);
  assert.equal(a.wellCapacityMmDay(600,0),null);
  assert.equal(a.wellCapacityMmDay(null,50),null);
  const peak = a.peakDemand([20,1,1,1,1,1,1,8]);
  near(peak,26/7);
  assert.equal(a.peakDemand([null,1,1,1,1,1,1]),null);
  assert.equal(a.capacityCheck(8,6).shortfall_mm_day,2);
  assert.equal(a.capacityCheck(5,6).ok,true);
  assert.equal(a.capacityCheck(8,null).ok,null);
});

test('root-zone depletion is bounded and cannot recover certainty after a missing day', () => {
  const input = {dates:['2026-05-01','2026-05-02','2026-05-03'], rain:[0,0,500],demand:[60,90,0],irrigation:[0,0,0],taw_mm:100,p:0.55};
  const b = a.rootZoneBucket(input);
  assert.deepEqual(b.depletion_mm,[60,100,0]);
  assert.equal(b.stress_days,2);
  assert.equal(b.first_stress_date,'2026-05-01');
  assert.deepEqual(a.rootZoneBucket({...input,rain:[null,0,500]}).depletion_mm,[null,null,null]);
  assert.equal(a.rootZoneBucket({...input,rain:[null,0,500]}).stress_days,null);
});

test('crop demand follows stage interpolation and keeps a missing rain day unknown', () => {
  const crop = {kc:{ini:0.3,mid:1.2,end:0.6,stage_days:[2,2,2,2]}};
  const dates = Array.from({length:9},(_,i)=>`2026-05-${String(i+1).padStart(2,'0')}`);
  const kc = a.kcCurve(crop,'2026-05-01',dates);
  assert.deepEqual(kc,[0.3,0.3,0.3,0.75,1.2,1.2,1.2,0.8999999999999999,0]);
  assert.deepEqual(a.cropDemand([10,null], [0.3,1.2]), [3,null]);
  const b = a.seasonWaterBalance({date:dates.slice(0,2),prectotcorr:[null,2]},[10,10],[1,1],5);
  assert.equal(b.rain_mm,null);
  assert.equal(b.balance_mm,null);
  assert.equal(b.demand_mm,20);
});

const daily = (date, extra = {}) => ({ date, ...extra });
test('ET switches methods per day and converts explicit kWh radiation units', () => {
  const d = daily(['2026-07-06','2026-07-07','2026-07-08'], {t2m_max:[21.5,25,null],t2m_min:[12.3,15,15],rh2m:[70,null,70],ws2m:[2,2,2],allsky_sw_dwn:[22,22,22]});
  const r = a.et0(d,50.8);
  assert.deepEqual(r.method_per_day, ['penman_monteith','hargreaves',null]);
  near(a.et0({...d,allsky_sw_dwn:[22/3.6,22/3.6,22/3.6],units:{allsky_sw_dwn:'kW-hr/m^2/day'}},50.8).values[0],r.values[0]);
  near(a.et0Hargreaves({tmax:21.5,tmin:12.3,lat:50.8,doy:187}), 0.0023*34.7*Math.sqrt(9.2)*41.09*0.408, 0.01);
  assert.equal(r.values[2], null);
});
const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);

test('Penman–Monteith reproduces FAO-56 Brussels Example 18', () => {
  // Example ea=1.409 kPa, es≈1.997 kPa expressed as equivalent mean RH.
  const v = a.et0PenmanMonteith({tmax:21.5,tmin:12.3,rh:100*1.409/1.997,ws2:2.078,rs_mj:22.07,lat:50.8,doy:187,elev_m:100});
  near(v, 3.88, 0.04);
  assert.equal(a.et0PenmanMonteith({tmax:null}), null);
});

test('season helpers preserve aligned nulls, leap days and autumn-to-next-summer seasons', () => {
  const d = daily(['2024-02-29','2024-10-01','2025-01-01','2025-06-30','2025-10-01'], {prectotcorr:[1, null, 3, 4, 5]});
  assert.equal(a.doy('2024-03-01'), 61);
  assert.equal(a.doy(null), null);
  assert.deepEqual(a.seasonSlice(d, '10-01', '06-30', 2024).prectotcorr, [null,3,4]);
  assert.deepEqual(a.groupByYear(d)[2025].prectotcorr, [3,4,5]);
  assert.deepEqual(a.cumulativeGdd(daily(['2026-04-24','2026-04-25','2026-04-26','2026-04-27'], {t2m_max:[25,30,null,30],t2m_min:[10,10,10,10]}), '2026-04-25'), [null,10,null,null]);
  assert.equal(a.hotDays([34,35,36]), 2);
  assert.equal(a.hotDays([null,35]), null);
  assert.equal(a.heatDegreeDays([29,32,35]), 7);
  assert.equal(a.heatDegreeDays([null]), null);
});

test('GDD clamps both temperatures and preserves missing observations', () => {
  assert.equal(a.gddDaily(40, 5), 10);
  assert.equal(a.gddDaily(5, -5), 0);
  assert.equal(a.gddDaily(40, 35), 20);
  assert.equal(a.gddDaily(null, 15), null);
  assert.equal(a.gddDaily(20, null), null);
});
