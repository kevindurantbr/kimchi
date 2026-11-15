// Port of prototype/compare.py compare(): the same inputs give the same states, reasons and
// validation messages (parity: fixtures/scenario_parity.json). There is no "eligible" state:
// a candidate stays conditional because other farm inputs are unknown, and only a confirmed,
// evidenced conflict excludes the supplied schedule. Priority picks questions, never a ranking.
// The farmer's baseline is UI state only: compare() has no baseline input and it never
// changes a candidate state. Nothing here is stored or sent anywhere.
import {priorities} from './model.mjs';

export const PRIORITY_RULES = Object.fromEntries(Object.entries(priorities).map(([k, p]) => [k, p.rules]));
export const STATES = {conditional: 'conditional', excluded: 'excluded_for_supplied_schedule'};
export const RULES = {calendar: 'T1_R06_CONFIRMED_CALENDAR_FAILURE', plantback: 'T1_R09_CONFIRMED_PLANTBACK_CONFLICT'};

const check = (ok, message) => { if (!ok) throw new Error(message); };
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const optional = (v, ok) => v === undefined || ok(v);

// Python date.fromisoformat, restricted to the YYYY-MM-DD form the interface sends.
export function isoDate(value, name) {
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null;
  check(d && value.slice(0, 4) !== '0000' && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value, `${name} must be an ISO date (YYYY-MM-DD)`);
  return value;
}

export function compare(bundle, fieldId = 'fld01', priority = 'water', scenario = null) {
  check(Object.hasOwn(PRIORITY_RULES, priority), 'Unknown priority');
  const matches = bundle.fields.filter(f => f.field_id === fieldId);
  check(matches.length === 1, 'Unknown field_id');
  scenario = scenario ?? {};
  check(isObject(scenario), 'scenario must be an object');
  check(Object.keys(scenario).every(k => k === 'synthetic' || k === 'constraints'), 'Unknown scenario field');
  check(optional(scenario.synthetic, v => typeof v === 'boolean'), 'synthetic must be boolean');
  const constraints = scenario.constraints === undefined ? [] : scenario.constraints;
  check(Array.isArray(constraints), 'constraints must be a list');
  const known = new Set(bundle.candidates.map(c => c.candidate_id));
  for (const item of constraints) {
    check(isObject(item), 'constraint must be an object');
    check(known.has(item.candidate_id), 'Unknown candidate in constraint');
    check(item.kind === 'calendar' || item.kind === 'plantback', 'Unknown constraint kind');
    check(optional(item.confirmed, v => typeof v === 'boolean'), 'confirmed must be boolean');
    check(optional(item.evidence, v => typeof v === 'string'), 'evidence must be text');
  }
  const candidates = bundle.candidates.map(candidate => {
    const c = {...structuredClone(candidate), status: STATES.conditional, exclusion_reasons: [], unresolved_constraints: [],
      numeric_outputs: {yield: null, profit: null, pumping_savings: null},
      numeric_status: 'No validated field response model; trial averages are not predictions'};
    for (const item of constraints) {
      if (item.candidate_id !== c.candidate_id) continue;
      if (item.confirmed !== true || !(item.evidence ?? '').trim()) { c.unresolved_constraints.push(item); continue; }
      let conflict, rule;
      if (item.kind === 'calendar') {
        const ready = isoDate(item.earliest_sowing_date, 'earliest_sowing_date');
        const end = isoDate(item.validated_window_end, 'validated_window_end');
        conflict = ready > end && item.no_feasible_adjustment === true;
        rule = RULES.calendar;
      } else {
        conflict = item.conflict === true;
        rule = RULES.plantback;
      }
      if (conflict) {
        c.status = STATES.excluded;
        c.exclusion_reasons.push({rule_id: rule, supplied_evidence: item});
      }
    }
    return c;
  });
  return {field: matches[0], priority,
    scenario_status: scenario.synthetic ? 'synthetic demonstration' : 'supplied inputs; not independently verified',
    priority_explanation: 'Display focus only; no performance ranking or winner is computed',
    questions_first: PRIORITY_RULES[priority].flatMap(id => bundle.rules.filter(r => r.rule_id === id)),
    regional_weather: bundle.regional_weather, candidates, sources: bundle.sources, winner: null};
}

// Outcome of one supplied constraint for display: excluded, unresolved, or checked without exclusion.
export function constraintOutcome(result, item) {
  const c = result.candidates.find(x => x.candidate_id === item.candidate_id);
  if (c.exclusion_reasons.some(r => r.supplied_evidence === item)) return 'excluded';
  return c.unresolved_constraints.includes(item) ? 'unresolved' : 'no_exclusion';
}

// UI-only baseline. Confirmed only when the history is confirmed (or corrected with a note)
// and an intended continuation is chosen (or described). It is never written to the bundle.
export function baselineStatus(input = {}, candidateIds = []) {
  const text = v => typeof v === 'string' ? v.trim() : '';
  const missing = [];
  if (input.history === 'corrected' && !text(input.correction)) missing.push('Describe what actually grew');
  else if (input.history !== 'confirmed' && input.history !== 'corrected') missing.push('Confirm or correct the crop history');
  const next = input.continuation;
  if (next === 'other' && !text(input.other)) missing.push('Describe the intended continuation');
  else if (next !== 'other' && !candidateIds.includes(next)) missing.push('Choose the intended continuation');
  return {confirmed: missing.length === 0, missing,
    continuation: missing.length === 0 ? next : null};
}
