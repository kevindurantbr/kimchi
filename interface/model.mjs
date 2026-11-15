// Pure presentation transforms. No prediction or recommendation model.
export const names = {corn_corn:'Continuous corn',corn_sorghum:'Corn → grain sorghum',corn_wheat:'Corn → winter wheat'};
export const cropNames = {corn:'Corn',grain_sorghum:'Grain sorghum',winter_wheat:'Winter wheat'};
export const priorities = {
  water:{title:'Start with water delivery',rules:['T1_R02_ANNUAL_VS_PEAK','T1_R03_ET_NOT_PUMPING','T1_R05_WHEAT_HANDOFF']},
  soil:{title:'Start with residue and recharge',rules:['T1_R12_RESIDUE_AND_RECHARGE','T1_R10_NO_FAMILY_OR_N_CREDIT']},
  operations:{title:'Start with what you can execute',rules:['T1_R05_WHEAT_HANDOFF','T1_R13_MARKET_AND_EQUIPMENT','T1_R08_HERBICIDE_UNKNOWN']}
};
export const finite = value => typeof value === 'number' && Number.isFinite(value);
export function fieldName(id) {return `Field ${id.replace('fld','')}`;}
export function selectField(bundle,id) {
  const field = bundle.fields.find(f=>f.field_id===id);
  if (!field) throw new Error('Unknown field');
  return field;
}
export function weatherForYear(bundle,year) {
  const rows = bundle.regional_weather.rows.filter(r=>r.month.startsWith(`${year}-`));
  return Array.from({length:12},(_,i)=>rows.find(r=>r.month===`${year}-${String(i+1).padStart(2,'0')}`) ?? null);
}
export function weatherSummary(rows,metric) {
  const key = metric==='rain'?'precipitation_mm':'mean_temperature_c';
  const complete = rows.length===12 && rows.every(r=>r && r.quality==='complete' && r.days_observed===r.days_expected && finite(r[key]));
  if (!complete) return null;
  if (metric==='rain') return rows.reduce((sum,r)=>sum+r[key],0);
  return rows.reduce((sum,r)=>sum+r[key]*r.days_observed,0)/rows.reduce((sum,r)=>sum+r.days_observed,0);
}
export function storageAt(field,depth) {
  return field.soils.find(r=>r.property==='available_water_storage' && r.depth_top_cm===0 && r.depth_bottom_cm===Number(depth)) ?? null;
}
export function cropHistory(field) {
  return field.history.map(h=>({year:h.year,crop:h.dominant_crop,
    dominant:h.classes.find(c=>c.crop===h.dominant_crop)??null,classes:h.classes}));
}
export function safeURL(value) {
  try {const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:null;}catch{return null;}
}
export function validateBundle(b) {
  if(b.schema_version!=='kimchi.demo.1'||!Array.isArray(b.fields)||b.fields.length!==3||!Array.isArray(b.candidates)||b.candidates.length!==3||!Array.isArray(b.sources)||!Array.isArray(b.rules)||!Array.isArray(b.regional_weather?.rows)) throw new Error('Unexpected research bundle');
  // This first interface is read-only and has no workflow for validating new results.
  if(b.fields.some(f=>f.baseline!==null||f.et?.status!=='unavailable'||f.et.rows.length||f.feature?.properties.boundary_status!=='approximate')||b.candidates.some(c=>c.field_suitability!==null)) throw new Error('Evidence states have changed; review the interface before displaying this bundle');
  return b;
}
