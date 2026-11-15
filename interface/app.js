import {names,cropNames,priorities,finite,fieldName,selectField,weatherForYear,weatherSummary,storageAt,cropHistory,safeURL,validateBundle} from './model.mjs';
import {fetchLiveWeather,LIVE_SOURCE_ID} from './live_weather.mjs';

const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const number=(value,digits=1)=>finite(value)?value.toLocaleString('en-US',{maximumFractionDigits:digits,minimumFractionDigits:digits}):'Unavailable';
const percent=value=>finite(value)?`${number(value*100)}%`:'Unknown coverage';
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const state={field:'fld01',year:'2025',metric:'rain',depth:150,priority:'water',yearTouched:false};
let bundle;
function sourceButton(ids,label='Evidence & limits') {
  return `<button class="source-link" data-sources="${esc(ids.join(','))}">${esc(label)} <span aria-hidden="true">↗</span></button>`;
}
function chooseField(id,fromMap=false) {
  selectField(bundle,id);
  state.field=id;
  $('field-select').value=id;
  renderField();renderSoil();
  if(fromMap) document.getElementById(`map-${id}`).focus();
}
function renderField() {
  const field=selectField(bundle,state.field),props=field.feature.properties;
  $('field-title').textContent=fieldName(field.field_id);
  $('field-map').innerHTML=mapSVG();
  $('field-meta').innerHTML=`<div class="field-meta"><p class="location">${esc(props.label.replace(' (approx. pivot circle)',''))}</p><div class="field-facts"><div><strong>${number(props.area_ha)} ha</strong>Approximate area</div><div><strong>Likely irrigated</strong>Not confirmed</div></div><p class="fine-print">Historical SD-6 boundary inclusion checked; current designation and water-right participation remain unverified.</p>${sourceButton(props.source_ids,'Boundary evidence & limitations')}</div>`;
  const history=cropHistory(field);
  $('crop-history').innerHTML=`<div class="history-grid">${history.map(h=>`<div><p class="history-year">${h.year}</p><div class="history-crop ${h.crop.toLowerCase().includes('wheat')?'wheat':h.crop.toLowerCase().includes('sorghum')?'sorghum':''}"><strong>${esc(h.crop)}</strong><span>${percent(h.dominant?.crop_fraction)}</span></div></div>`).join('')}</div>${history.some(h=>h.dominant?.confirmation_needed)?'<p class="history-ambiguity">Additional classification ambiguity flagged in this field’s history.</p>':''}<details class="weather-table"><summary>View class fractions & coverage</summary><table><caption>Shares of valid classified pixels. Valid coverage is separate.</caption><thead><tr><th scope="col">Year</th><th scope="col">Crop / share</th><th scope="col">Valid coverage</th></tr></thead><tbody>${history.map(h=>`<tr><td>${h.year}</td><td>${h.classes.map(c=>`${esc(c.crop)}: ${percent(c.crop_fraction)}`).join('<br>')}</td><td>${percent(h.dominant?.valid_coverage_fraction)}</td></tr>`).join('')}</tbody></table></details>`;
}
function mapSVG() {
  const points=bundle.fields.flatMap(f=>f.feature.geometry.coordinates.flat());
  const xvals=points.map(p=>p[0]),yvals=points.map(p=>p[1]);
  const west=Math.min(...xvals)-.005,east=Math.max(...xvals)+.005,south=Math.min(...yvals)-.004,north=Math.max(...yvals)+.004;
  const correction=Math.cos((north+south)/2*Math.PI/180),scale=Math.min(510/((east-west)*correction),345/(north-south));
  const x=lon=>300+(lon-(west+east)/2)*correction*scale;
  const y=lat=>225-(lat-(north+south)/2)*scale;
  const grid=Array.from({length:6},(_,i)=>{const lat=south+(north-south)*i/5;return `<line class="map-grid" x1="30" x2="570" y1="${y(lat)}" y2="${y(lat)}"/><text class="map-coordinate" x="14" y="${y(lat)-5}">${lat.toFixed(3)}°N</text>`;}).join('')+Array.from({length:6},(_,i)=>{const lon=west+(east-west)*i/5;return `<line class="map-grid" x1="${x(lon)}" x2="${x(lon)}" y1="40" y2="410"/><text class="map-coordinate" x="${x(lon)}" y="426" text-anchor="middle">${Math.abs(lon).toFixed(3)}°W</text>`;}).join('');
  const fields=bundle.fields.map(f=>{
    const rings=f.feature.geometry.coordinates;
    const ring=rings[0].slice(0,-1),cx=ring.reduce((s,p)=>s+x(p[0]),0)/ring.length,cy=ring.reduce((s,p)=>s+y(p[1]),0)/ring.length;
    const d=rings.map(r=>r.map((p,i)=>`${i?'L':'M'}${x(p[0]).toFixed(2)},${y(p[1]).toFixed(2)}`).join(' ')+'Z').join(' ');
    return `<g id="map-${f.field_id}" class="map-field" data-field="${f.field_id}" role="button" tabindex="0" aria-pressed="${f.field_id===state.field}" aria-label="Select ${fieldName(f.field_id)}, approximate boundary"><title>${fieldName(f.field_id)} · approximate boundary · ${number(f.feature.properties.area_ha)} ha</title><path class="field-shape" fill-rule="evenodd" d="${d}"/><text class="map-label" x="${cx}" y="${cy+4}" text-anchor="middle">${fieldName(f.field_id)}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 600 460" role="group" aria-label="Selectable map of three approximate field boundaries in western Kansas"><rect width="600" height="460" fill="#e8eedf"/>${grid}<text class="map-note" x="20" y="23">FIELD OVERVIEW · SELECT A BOUNDARY</text><path d="M568 27v22m0-22-4 8m4-8 4 8" class="map-scale" fill="none"/><text class="map-north" x="568" y="18" text-anchor="middle">N</text>${fields}<text class="map-note" x="20" y="449">GeoJSON outlines · local geographic view · no imagery basemap</text></svg>`;
}
function renderWeather() {
  const rows=weatherForYear(bundle,state.year),rain=state.metric==='rain',key=rain?'precipitation_mm':'mean_temperature_c',unit=rain?'mm':'°C';
  const annual=weatherSummary(rows,state.metric);
  const values=rows.map(r=>r?.[key]).filter(finite);
  const min=rain?0:Math.min(0,...values)-2,max=rain?Math.max(20,...values)*1.15:Math.max(10,...values)+2;
  const top=18,bottom=132,y=v=>bottom-(v-min)/(max-min)*(bottom-top),zero=y(0);
  const ticks=Array.from({length:3},(_,i)=>min+(max-min)*i/2);
  const grid=ticks.map(v=>`<line class="chart-grid" x1="25" x2="276" y1="${y(v)}" y2="${y(v)}"/><text class="chart-label" x="20" y="${y(v)+3}" text-anchor="end">${Math.round(v)}</text>`).join('');
  const bars=rows.map((r,i)=>{const val=r?.[key],x=29+i*20.3;const missing=!finite(val);return `<g><title>${months[i]} ${state.year}: ${missing?'unavailable':`${number(val,2)} ${unit}`} · ${esc(r?.quality??'missing')}${r?.live?' · live, provisional':''}</title>${missing?`<text class="chart-empty" x="${x+6}" y="${zero-5}" text-anchor="middle">×</text>`:`<rect x="${x}" y="${Math.min(y(val),zero)}" width="12" height="${Math.max(0.7,Math.abs(y(val)-zero))}" rx="2" fill="${rain?'#77989a':'#ba9563'}" ${r.quality!=='complete'?'opacity=".45"':''}/>`}<text class="chart-label" x="${x+6}" y="150" text-anchor="middle">${months[i][0]}</text></g>`;}).join('');
  $('weather-content').innerHTML=`<div class="weather-number">${number(annual)}${finite(annual)?`<span>${unit}</span>`:''}</div><p class="metric-caption">${finite(annual)?`${state.year} ${rain?'total precipitation':'mean daily temperature'}`:'Annual summary unavailable · incomplete coverage'}</p><svg class="weather-chart" viewBox="0 0 286 160" role="img" aria-label="${state.year} monthly ${rain?'precipitation in millimetres':'mean temperature in degrees Celsius'}. Exact values and quality are in the table below.">${grid}${bars}</svg>${rows.some(r=>!r||r.quality!=='complete'||!finite(r[key]))?'<p class="fine-print coverage-warning">× = unavailable. Faded bars indicate partial data. Missing values are never treated as zero.</p>':''}<details class="weather-table"><summary>View monthly values & quality</summary><table><caption>${state.year} · ${rain?'Precipitation (mm)':'Mean temperature (°C)'}</caption><thead><tr><th scope="col">Month</th><th scope="col">Value</th><th scope="col">Quality</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${months[i]}</td><td>${number(r?.[key],2)}</td><td>${esc(r?.quality??'missing')}${r?.live?' · live':''}<br>${r?`${r.days_observed}/${r.days_expected} days`:'—'}</td></tr>`).join('')}</tbody></table></details>`;
}
function renderSoil() {
  const field=selectField(bundle,state.field),row=storageAt(field,state.depth),coverage=row?.coverage_fraction;
  const categories=[['hydrologic_group_dominant_condition','Hydrologic group'],['drainage_class_dominant_condition','Drainage class']].map(([key,label])=>{
    const r=field.soils.find(s=>s.property===key);return `<div class="soil-category"><span>${label}</span><strong>${esc(r?.value??'Unavailable')}<small>${percent(r?.coverage_fraction)} of field in this category</small></strong></div>`;
  }).join('');
  $('soil-content').innerHTML=`<label class="depth-control">Depth from surface<select id="soil-depth" aria-label="Soil profile depth">${[25,50,100,150].map(d=>`<option value="${d}" ${state.depth===d?'selected':''}>0–${d} cm</option>`).join('')}</select></label><div class="storage-value">${number(row?.value,2)}${finite(row?.value)?'<span>cm water</span>':''}</div><div class="coverage-track" role="img" aria-label="${percent(coverage)} valid soil coverage"><span style="width:${finite(coverage)?Math.max(0,Math.min(100,coverage*100)):0}%"></span></div><div class="coverage-caption"><span>${percent(coverage)} valid coverage</span><span>${finite(coverage)&&coverage<1?`${number((1-coverage)*100)}% missing`:''}</span></div>${finite(coverage)&&coverage<1?'<p class="fine-print coverage-warning">Average over covered soil only. The uncovered area is not assigned zero storage.</p>':''}${categories}`;
}
const dateLabel=window=>`${months[Number(window.start_month_day.slice(0,2))-1]} ${Number(window.start_month_day.slice(3))}–${months[Number(window.end_month_day.slice(0,2))-1]} ${Number(window.end_month_day.slice(3))} · year ${window.relative_calendar_year}`;
function findings(items) {return items.map(item=>`<div class="evidence-item"><p>${esc(item.finding)}</p>${sourceButton(item.source_ids)}</div>`).join('');}
function renderCandidates() {
  $('rotation-cards').innerHTML=bundle.candidates.map((c,i)=>`<article class="rotation-card" data-candidate="${c.candidate_id}"><div class="rotation-top"><span class="rotation-number">SEQUENCE ${String(i+1).padStart(2,'0')}</span><span class="badge amber">Suitability unknown</span></div><h3>${esc(names[c.candidate_id]??c.candidate_id)}</h3><div class="rotation-sequence">${c.sequence.map((phase,j)=>`${j?'<b aria-hidden="true">→</b>':''}<div class="phase ${phase.crop}"><span>HARVEST YEAR ${phase.relative_harvest_year}</span><strong>${esc(cropNames[phase.crop]??phase.crop)}</strong></div>`).join('')}</div><p class="tradeoff-kicker">A TRADEOFF TO CONSIDER</p><p class="tradeoff">${esc(c.risks[0].finding)}</p>${sourceButton(c.risks[0].source_ids,'Why this matters')}<details class="rotation-details"><summary>Explore evidence & calendar</summary><div class="expanded-evidence"><p><strong>Regional evidence:</strong> ${esc(c.status_meaning)}</p><p><strong>Comparison status:</strong> conditional on missing farm inputs. No field is approved by this prototype.</p><h4>Potential benefits</h4>${findings(c.benefits)}<h4>Risks & constraints</h4>${findings(c.risks)}<h4>Two-year reference calendar</h4><p>Illustrative regional / historical windows, not locally validated deadlines. Whole-field alternation; not concurrent phase-split acreage.</p>${c.sequence.map(phase=>`<div class="calendar-phase"><strong>${esc(cropNames[phase.crop])} · harvest year ${phase.relative_harvest_year}</strong><div class="calendar-row"><span>Sow</span><span>${dateLabel(phase.sowing_window)}</span></div><div class="calendar-row"><span>Harvest</span><span>${dateLabel(phase.harvest_window)}</span></div><small>${esc(phase.calendar_basis)}</small></div>`).join('')}<h4>Calendar handoffs</h4>${findings(c.gaps_and_calendar_conflicts)}<h4>Residue & soil implications</h4>${findings(c.residue_implications)}<h4>Plant-back compatibility</h4>${findings([c.herbicide_carryover])}<h4>What still needs an answer</h4><ul>${c.unknowns.map(t=>`<li>${esc(t)}</li>`).join('')}</ul><h4>Market & equipment prerequisites</h4><ul>${c.market_equipment_prerequisites.map(t=>`<li>${esc(t)}</li>`).join('')}</ul><h4>How far the evidence transfers</h4><p>${esc(c.treatment_basis)}</p>${sourceButton(c.source_ids,'All sources for this sequence')}</div></details></article>`).join('');
}
function renderPriority() {
  const p=priorities[state.priority];$('focus-title').textContent=p.title;
  $('focus-questions').innerHTML=p.rules.map(id=>bundle.rules.find(r=>r.rule_id===id)).filter(Boolean).map(r=>`<details class="focus-question"><summary>${esc(r.condition_description)}</summary><p>${esc(r.rationale)}</p><ul>${r.input_needed.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><p>${esc(r.validation_status)}</p>${sourceButton(r.source_ids)}</details>`).join('');
  document.querySelectorAll('[data-priority]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.priority===state.priority)));
}
function showSources(ids) {
  const sources=ids?bundle.sources.filter(s=>ids.includes(s.source_id)):bundle.sources;
  const labels={applicability_limit:'Applicability limits',evidence_notes:'Evidence notes',spatial_support:'Spatial support',request_without_secrets:'Request / access record',retrieved_date:'Retrieved',product_version:'Product / version'};
  $('source-list').innerHTML=sources.map(s=>`<article class="source-record"><span class="source-id">${esc(s.source_id)}</span><h3>${esc(s.title)}</h3><dl>${Object.entries(s).filter(([key])=>!['source_id','title','url'].includes(key)).map(([key,val])=>`<dt>${esc(labels[key]??key.replaceAll('_',' '))}</dt><dd>${esc(val===null?'Not recorded':typeof val==='object'?JSON.stringify(val):val)}</dd>`).join('')}</dl>${safeURL(s.url)?`<a href="${esc(safeURL(s.url))}" target="_blank" rel="noopener noreferrer">Open original source ↗</a>`:`<p class="fine-print">Repository reference: ${esc(s.url)}</p>`}</article>`).join('');
  if(!$('source-dialog').open) $('source-dialog').showModal();
}
document.addEventListener('click',event=>{
  if(!bundle)return;
  const source=event.target.closest('[data-sources]');if(source){showSources(source.dataset.sources.split(','));return;}
  const field=event.target.closest('[data-field]');if(field){chooseField(field.dataset.field,true);return;}
  const priority=event.target.closest('[data-priority]');if(priority){state.priority=priority.dataset.priority;renderPriority();return;}
  const metric=event.target.closest('[data-metric]');if(metric){state.metric=metric.dataset.metric;document.querySelectorAll('[data-metric]').forEach(b=>b.setAttribute('aria-pressed',String(b===metric)));renderWeather();}
});
document.addEventListener('keydown',event=>{
  const field=event.target.closest('[data-field]');
  if(field&&['Enter',' '].includes(event.key)){event.preventDefault();chooseField(field.dataset.field,true);}
});
$('field-select').addEventListener('change',event=>chooseField(event.target.value));
$('weather-year').addEventListener('change',event=>{state.year=event.target.value;state.yearTouched=true;renderWeather();});
$('soil-content').addEventListener('change',event=>{if(event.target.id==='soil-depth'){state.depth=Number(event.target.value);renderSoil();$('soil-depth').focus();}});
$('all-sources').addEventListener('click',()=>{if(bundle)showSources();});
$('close-sources').addEventListener('click',()=>$('source-dialog').close());
$('source-dialog').addEventListener('click',event=>{if(event.target===$('source-dialog')){const r=$('source-dialog').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('source-dialog').close();}});
function populateYears() {
  const years=[...new Set(bundle.regional_weather.rows.map(r=>r.month.slice(0,4)))].sort().reverse();
  $('weather-year').innerHTML=years.map(y=>`<option value="${esc(y)}">${esc(y)}</option>`).join('');
  $('weather-year').value=years.includes(state.year)?state.year:years[0];state.year=$('weather-year').value;
}
const reviewedRange=rows=>{const m=rows.filter(r=>!r.live).map(r=>r.month).sort();return `${m[0]?.slice(0,4)}–${m.at(-1)?.slice(0,4)}`;};
const dayLabel=iso=>`${months[Number(iso.slice(5,7))-1]} ${Number(iso.slice(8))}, ${iso.slice(0,4)}`;
// Live weather extends the reviewed series after it renders; failure leaves the reviewed snapshot in place.
async function refreshLiveWeather() {
  const target=bundle;
  $('weather-live').innerHTML='<span class="badge neutral">Checking NASA POWER for newer months…</span>';
  try {
    const live=await fetchLiveWeather(target);
    if(bundle!==target)return;
    bundle.regional_weather.rows=live.rows;
    bundle.sources=[...bundle.sources.filter(s=>s.source_id!==LIVE_SOURCE_ID),live.source];
    if(!state.yearTouched&&live.added.length)state.year=live.added.at(-1).slice(0,4);
    populateYears();renderWeather();
    const fetched=new Date(live.fetchedAt).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'});
    const check=live.compared?(live.differing.length?` ${live.differing.length} of ${live.compared} overlapping months differ from the reviewed snapshot, so the reviewed values are shown for them.`:` The ${live.compared} overlapping months match the reviewed snapshot.`):'';
    $('weather-live').innerHTML=`<span class="badge amber">Live · provisional</span> NASA POWER fetched ${esc(fetched)}. ${live.added.length?`Months after ${esc(live.lastReviewed)} are live and unreviewed${live.throughDay?`, with data through ${esc(dayLabel(live.throughDay))}`:''}.`:'No months newer than the reviewed snapshot yet.'}${esc(check)} ${sourceButton([LIVE_SOURCE_ID],'Live request & limits')}`;
  }catch(error){
    if(bundle!==target)return;
    $('weather-live').innerHTML=`<span class="badge neutral">Live update unavailable</span> Showing the reviewed ${esc(reviewedRange(bundle.regional_weather.rows))} snapshot only.`;
    console.warn('Live weather unavailable:',error.message);
  }
}
async function load() {
  $('load-state').textContent='Loading reviewed field evidence…';
  try {
    const response=await fetch('./demo_bundle.json');if(!response.ok)throw new Error('Data request failed');
    bundle=validateBundle(await response.json());
    $('field-select').innerHTML=bundle.fields.map(f=>`<option value="${f.field_id}">${fieldName(f.field_id)}</option>`).join('');
    populateYears();renderField();renderWeather();renderSoil();renderPriority();renderCandidates();
    $('load-state').hidden=true;$('workspace').hidden=false;
    refreshLiveWeather();
  }catch(error){bundle=null;$('workspace').hidden=true;$('load-state').innerHTML='The reviewed evidence could not be loaded. No substitute values are shown.<button id="retry">Try again</button>';$('retry').addEventListener('click',load);console.error('Evidence unavailable:',error.message);}
}
load();
