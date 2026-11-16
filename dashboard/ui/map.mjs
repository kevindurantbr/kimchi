// Leaflet map: imagery basemap, field outlines, region grid cells, NDVI pixels, drawing and a cursor readout.
// Leaflet and Leaflet.draw are loaded as globals (L) from pinned CDN URLs in index.html.
import { centroid, esc } from './util.mjs';
import { factorIcon } from './icons.mjs';

export function createMap(el, { onCursor, onFieldClick, onDrawn }) {
  const map = L.map(el, { zoomControl: true, attributionControl: true, preferCanvas: false, worldCopyJump: false })
    .setView([39.40, -100.68], 13);

  const imagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: 'Imagery: Esri, Maxar, Earthstar Geographics',
  }).addTo(map);
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
  });
  L.control.layers({ 'Satellite imagery': imagery, 'OpenStreetMap': osm }, null, { position: 'topright', collapsed: true }).addTo(map);
  L.control.scale({ imperial: true, metric: true, position: 'bottomright' }).addTo(map);

  map.createPane('grid'); map.getPane('grid').style.zIndex = 380;
  map.createPane('ndvi'); map.getPane('ndvi').style.zIndex = 390;
  map.createPane('fields'); map.getPane('fields').style.zIndex = 420;

  const gridLayer = L.layerGroup().addTo(map);
  const ndviLayer = L.layerGroup().addTo(map);
  const fieldLayer = L.featureGroup().addTo(map);
  const drawn = new L.FeatureGroup().addTo(map);
  let reticle = null;

  // Hover badges: each field owns one row of four factor badges, folded away until the pointer is on the field
  // (or on the badges). Touch screens have no hover, so there the selected field's row stays open.
  const badgeRows = new Map();   // field id -> .fbadges element
  const noHover = window.matchMedia?.('(hover: none)').matches ?? false;
  let hoverId = null, closeTimer = null, selectedField = null;
  const setOpen = (id, on) => badgeRows.get(id)?.classList.toggle('open', on);
  function openBadges(id) {
    clearTimeout(closeTimer);
    if (hoverId && hoverId !== id && !(noHover && hoverId === selectedField)) setOpen(hoverId, false);
    hoverId = id; setOpen(id, true);
  }
  function closeBadges(id) {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { if (hoverId === id) { hoverId = null; if (!(noHover && id === selectedField)) setOpen(id, false); } }, 220);
  }
  function syncSelectedBadges() {
    for (const [id, el] of badgeRows) el.classList.toggle('open', id === hoverId || (noHover && id === selectedField));
  }

  map.on('mousemove', e => onCursor?.(e.latlng));
  map.on('mouseout', () => onCursor?.(null));

  // Drawing (Leaflet.draw): polygon only. Triggered from the "Draw field" button.
  // Leaflet.draw 1.0.4 with Leaflet >= 1.8 on browsers that report touch support handles each click twice
  // and never adds a vertex. Disabling its separate touch handler lets the normal mouse/pointer path work
  // (verified in this app: vertices are added and the polygon closes).
  if (L.Draw?.Polyline) L.Draw.Polyline.prototype._onTouch = L.Util.falseFn;
  let drawer = null;
  map.on(L.Draw.Event.CREATED, e => {
    const gj = e.layer.toGeoJSON();
    onDrawn?.(gj.geometry);
  });
  function startDraw() {
    drawer?.disable();
    drawer = new L.Draw.Polygon(map, { shapeOptions: { color: '#e4ff3a', weight: 2 }, showArea: true, metric: true, allowIntersection: false });
    drawer.enable();
  }

  function setFields(features, selectedId, styleFor) {
    fieldLayer.clearLayers();
    selectedField = selectedId;
    for (const f of features) {
      const id = f.properties.field_id, sel = id === selectedId;
      const lyr = L.geoJSON(f, {
        pane: 'fields',
        style: () => { const st = styleFor(f); return { ...st, weight: sel ? 3.5 : 2, color: st.color ?? (sel ? '#e4ff3a' : '#e8eef1'), dashArray: f.properties.boundary_status === 'approximate' ? '6 4' : null }; },
      });
      lyr.on('click', () => onFieldClick?.(id));
      lyr.on('mouseover', () => openBadges(id));
      lyr.on('mouseout', () => closeBadges(id));
      lyr.bindTooltip(esc(f.properties.label_short ?? id.toUpperCase()), { permanent: true, direction: 'center', className: 'fld-tip' });
      lyr.addTo(fieldLayer);
    }
    syncSelectedBadges();
    const s = features.find(f => f.properties.field_id === selectedId);
    reticle?.remove(); reticle = null;
    if (s) {
      const [lon, lat] = centroid(s.geometry);
      reticle = L.marker([lat, lon], { interactive: false, keyboard: false, icon: L.divIcon({ className: 'reticle', iconSize: [64, 64], iconAnchor: [32, 32],
        html: '<svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke="#e4ff3a" stroke-width="1.5"><circle cx="32" cy="32" r="10"/><path d="M32 0v18M32 46v18M0 32h18M46 32h18"/></g></svg>' }) }).addTo(map);
    }
  }

  function setGrid(cells, colorFor, tipFor) {
    gridLayer.clearLayers();
    if (!cells) return;
    for (const c of cells) {
      const fill = colorFor(c);
      const poly = L.polygon(c.polygon.map(([lon, lat]) => [lat, lon]), {
        pane: 'grid', color: '#08090a', weight: 1, fillColor: fill ?? '#000', fillOpacity: fill ? .62 : .15,
        dashArray: fill ? null : '3 3',
      });
      poly.bindTooltip(() => tipFor(c), { sticky: true, className: 'val-tip' });
      poly.addTo(gridLayer);
    }
  }

  function setNdvi(fieldNdvi, idx, colorFor) {
    ndviLayer.clearLayers();
    if (!fieldNdvi) return;
    const vals = fieldNdvi.pixels?.[idx] ?? [];
    fieldNdvi.pixel_polygons.forEach((poly, i) => {
      const v = vals[i], fill = colorFor(v);
      L.polygon(poly.map(([lon, lat]) => [lat, lon]), {
        pane: 'ndvi', weight: .5, color: '#08090a', fillColor: fill ?? '#000', fillOpacity: fill ? .78 : .2,
      }).bindTooltip(() => `NDVI ${v == null ? 'unavailable (bad QA)' : v.toFixed(2)}`, { sticky: true, className: 'val-tip' }).addTo(ndviLayer);
    });
  }

  function fitTo(feature, region) {
    if (region) { map.fitBounds(region, { padding: [20, 20] }); return; }
    // Not animated: a banner resize (invalidateSize) during the zoom animation would cancel it and leave the old view.
    // Keep the field in the clear band between the top HUD (plus room for its badge row) and the bottom legend and caption.
    const b = L.geoJSON(feature).getBounds(), pad = overlayPadding();
    const tight = pad.room != null && pad.room < 220;
    map.fitBounds(b.pad(feature ? (tight ? 0.5 : 2.2) : 0.2), { maxZoom: 15, animate: false, ...pad.opts });
  }
  /** Space the map overlays take at the top and bottom of the map, as fitBounds padding. */
  function overlayPadding() {
    const wrap = el.closest('.mapwrap'), m = el.getBoundingClientRect();
    if (!wrap || !m.height) return {};
    let top = 0, bottom = 0;
    for (const o of wrap.querySelectorAll('.hud-tl')) { const r = o.getBoundingClientRect(); if (r.height) top = Math.max(top, r.bottom - m.top); }
    for (const o of wrap.querySelectorAll('.legend, .sl-caption')) { const r = o.getBoundingClientRect(); if (r.height) bottom = Math.max(bottom, m.bottom - r.top); }
    top += 48; // the badge row sits above the field's north edge
    const room = m.height - top - bottom;
    if (room < 60) return {};
    return { room, opts: { paddingTopLeft: [0, top], paddingBottomRight: [0, bottom] } };
  }
  function fitAll() { if (fieldLayer.getLayers().length) map.fitBounds(fieldLayer.getBounds().pad(.35)); }

  /** Status badges above each field: [{ feature, items: [{ factor, level, headline, name, word }] }], one item per factor.
      Folded until the field is hovered (or, on touch screens, selected); then they roll out one by one, left to right,
      each coloured by its status. They live in their own layer above the map's overlays (not in a Leaflet pane), so the
      HUD notes and legends never cover them; each row follows its field as the map pans and zooms. */
  const badgeHost = document.createElement('div');
  badgeHost.className = 'badge-layer';
  el.after(badgeHost);
  const anchors = new Map();   // field id -> LatLng of the field's top centre
  function placeBadges() {
    for (const [id, row] of badgeRows) {
      const ll = anchors.get(id); if (!ll) continue;
      const pt = map.latLngToContainerPoint(ll);
      row.parentElement.style.transform = `translate(${Math.round(pt.x)}px, ${Math.round(pt.y)}px)`;
    }
  }
  map.on('move zoom resize viewreset', placeBadges);
  map.on('zoomstart', () => badgeHost.classList.add('zooming'));
  map.on('zoomend', () => { placeBadges(); badgeHost.classList.remove('zooming'); });

  function setBadges(rows) {
    badgeHost.replaceChildren(); badgeRows.clear(); anchors.clear();
    for (const { feature, items } of rows ?? []) {
      if (!items?.length) continue;
      const id = feature.properties.field_id;
      const b = L.geoJSON(feature).getBounds();
      anchors.set(id, L.latLng(b.getNorth(), (b.getWest() + b.getEast()) / 2));
      const anchor = document.createElement('div');
      anchor.className = 'fbadge-anchor';
      anchor.innerHTML = `<div class="fbadges">${items.map((i, k) => `<span class="fbadge lv-${esc(i.level)}" style="--i:${k}" role="img" aria-label="${esc(`${i.name}: ${i.word}, ${i.headline}`)}">${factorIcon(i.factor, 'bicon')}</span>`).join('')}`
        + `<div class="btip" role="tooltip">${items.map(i => `<div><span class="bdot lv-${esc(i.level)}"></span><b>${esc(i.name)}</b> ${esc(i.word)} · ${esc(i.headline)}</div>`).join('')}</div></div>`;
      const row = anchor.firstElementChild;
      row.addEventListener('mouseenter', () => openBadges(id));
      row.addEventListener('mouseleave', () => closeBadges(id));
      badgeHost.append(anchor);
      badgeRows.set(id, row);
    }
    placeBadges();
    syncSelectedBadges();
  }

  const stopDraw = () => { drawer?.disable(); drawer = null; };
  return { map, setFields, setGrid, setNdvi, setBadges, fitTo, fitAll, startDraw, stopDraw, invalidate: () => map.invalidateSize() };
}
