// Kimchi factor icons, drawn for this app on a 24 px grid: 1.6 px round strokes in currentColor plus one
// duotone fill (fill-opacity .3) for the part that carries the meaning. Used on the factor cards, the action
// cards, the map's hover badges and the badge legend, so one factor always has one picture.
//   water           a drop with its water line: the balance between rain and crop use
//   temperature     a thermometer with heat shimmer: extremes plus accumulated heat
//   soil_moisture   a soil profile: surface, the root-zone water, the deeper layer
//   crop_condition  a sprout on the ground line under a signal arc: greenness seen from space

const DUO = 'fill="currentColor" fill-opacity=".3" stroke="none"';
const SOLID = 'fill="currentColor" stroke="none"';

const PATHS = {
  water: `
    <path ${DUO} d="M6.1 14.2q2.95-1.9 5.9 0t5.9 0A6.5 6.5 0 0 1 6.1 14.2Z"/>
    <path d="M12 3.2S5.5 10.4 5.5 14.6a6.5 6.5 0 0 0 13 0C18.5 10.4 12 3.2 12 3.2Z"/>
    <path d="M6.1 14.2q2.95-1.9 5.9 0t5.9 0"/>`,
  temperature: `
    <circle ${SOLID} cx="9.5" cy="16.6" r="2.1"/>
    <path d="M7.5 4.5a2 2 0 0 1 4 0v8.6a4 4 0 1 1-4 0Z"/>
    <path d="M9.5 9v7"/>
    <path d="M16 4.5c1.2 1.2-1.2 2.3 0 3.5s-1.2 2.3 0 3.5"/>
    <path d="M19.8 4.5c1.2 1.2-1.2 2.3 0 3.5s-1.2 2.3 0 3.5"/>`,
  soil_moisture: `
    <path ${DUO} d="M12 8.6s-2.4 2.6-2.4 4.2a2.4 2.4 0 0 0 4.8 0c0-1.6-2.4-4.2-2.4-4.2Z"/>
    <path d="M3 5c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0"/>
    <path d="M12 8.6s-2.4 2.6-2.4 4.2a2.4 2.4 0 0 0 4.8 0c0-1.6-2.4-4.2-2.4-4.2Z"/>
    <path d="M3 17h18"/>
    <circle ${SOLID} cx="6" cy="20" r="1"/><circle ${SOLID} cx="10.5" cy="20.4" r=".8"/>
    <circle ${SOLID} cx="15" cy="19.9" r="1"/><circle ${SOLID} cx="19" cy="20.4" r=".8"/>`,
  crop_condition: `
    <path ${DUO} d="M12 13.2c0-4 2.9-6.6 7-6.6 0 4-2.9 6.6-7 6.6Z"/>
    <path d="M12 21v-9"/>
    <path d="M12 13.2c0-4 2.9-6.6 7-6.6 0 4-2.9 6.6-7 6.6Z"/>
    <path d="M12 16.2c0-3.1-2.3-5.2-5.6-5.2 0 3.1 2.3 5.2 5.6 5.2Z"/>
    <path d="M7 21h10"/>
    <path d="M5.4 8.6a3.1 3.1 0 0 1 3.1-3.1"/>
    <path d="M2.6 8.6a5.9 5.9 0 0 1 5.9-5.9"/>`,
};

/** Inline SVG for a factor. cls sets the size and colour from CSS; title adds an accessible name. */
export function factorIcon(id, cls = 'ficon', title = '') {
  const body = PATHS[id];
  if (!body) return '';
  const a11y = title ? `role="img" aria-label="${title.replace(/"/g, '&quot;')}"` : 'aria-hidden="true"';
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${body}</svg>`;
}

export const FACTOR_IDS = Object.keys(PATHS);
