// Shared status levels, colours, icons and headlines (PLAN.md section 13 colour table).
// Uses P2's analysis.badges when present; otherwise derives the same fields from each status, never inventing values.
import { finite, FACTORS } from './util.mjs';

export const LEVEL_COLOR = { good: '#2e9e5b', normal: '#7a9a86', watch: '#e0a100', concern: '#d64545', nodata: '#8a8f93' };
export const ICON = { water: '💧', temperature: '🌡', soil_moisture: '🟫', crop_condition: '🌱' };
const RANK = { nodata: -1, good: 0, normal: 1, watch: 2, concern: 3 };

/** Status word: P2's status.plain.word, else derived from direction and severity. */
export function wordOf(st) {
  if (st?.plain?.word) return st.plain.word;
  if (!st || !finite(st.value) || !finite(st.percentile)) return 'No new data';
  if (st.direction === 'favourable') return 'Good';
  if (Math.abs(st.percentile - 50) <= 25) return 'Normal';
  return st.severity <= 0.5 ? 'Watch' : 'Concern';
}
export const levelOfWord = w => ({ Good: 'good', Normal: 'normal', Watch: 'watch', Concern: 'concern' }[w] ?? 'nodata');

const inches = mm => (Math.abs(mm) / 25.4).toFixed(1);
/** Headline number a farmer should focus on, in plain units. */
function headlineFor(id, st) {
  const v = st?.value;
  if (!finite(v)) return 'No new data';
  if (id === 'water') return v < 0 ? `${Math.round(-v)} mm short (${inches(v)} in)` : `${Math.round(v)} mm to spare (${inches(v)} in)`;
  if (id === 'temperature') return `${Math.round(v)} hot days`;
  if (id === 'soil_moisture') return `${Math.round(v * 100)}% wet`;
  if (id === 'crop_condition') return `Greenness ${v.toFixed(2)}`;
  return String(v);
}

/** One badge per factor: { factor, word, level, icon, headline, detail }. */
export function badgesOf(analysis) {
  const fromP2 = Array.isArray(analysis?.badges) ? analysis.badges : [];
  return FACTORS.map(f => {
    const b = fromP2.find(x => x?.factor === f.id), st = analysis?.factors?.[f.id]?.status;
    const word = b?.word ?? wordOf(st);
    return {
      factor: f.id, name: f.name, word,
      level: b?.level && b.level in RANK ? b.level : levelOfWord(word),
      icon: b?.icon ?? ICON[f.id],
      headline: b?.headline ?? headlineFor(f.id, st),
      detail: b?.detail ?? st?.plain?.sentence ?? '',
    };
  });
}
/** Worst level among a field's factors (no-data never counts as good or bad). */
export function worstLevel(badges) {
  return badges.reduce((w, b) => (RANK[b.level] > RANK[w] ? b.level : w), 'nodata');
}
