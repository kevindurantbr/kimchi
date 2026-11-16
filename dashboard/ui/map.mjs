// Leaflet map: imagery basemap, field outlines, region grid cells, NDVI pixels, drawing and a cursor readout.
// Leaflet and Leaflet.draw are loaded as globals (L) from pinned CDN URLs in index.html.
import { centroid, esc } from './util.mjs';

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
  const badgeLayer = L.layerGroup().addTo(map);
  let reticle = null;

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
    for (const f of features) {
      const id = f.properties.field_id, sel = id === selectedId;
      const lyr = L.geoJSON(f, {
        pane: 'fields',
        style: () => { const st = styleFor(f); return { ...st, weight: sel ? 3.5 : 2, color: st.color ?? (sel ? '#e4ff3a' : '#e8eef1'), dashArray: f.properties.boundary_status === 'approximate' ? '6 4' : null }; },
      });
      lyr.on('click', () => onFieldClick?.(id));
      lyr.bindTooltip(esc(f.properties.label_short ?? id.toUpperCase()), { permanent: true, direction: 'center', className: 'fld-tip' });
      lyr.addTo(fieldLayer);
    }
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
    const b = L.geoJSON(feature).getBounds(); map.fitBounds(b.pad(feature ? 2.2 : 0.2), { maxZoom: 15, animate: false });
  }
  function fitAll() { if (fieldLayer.getLayers().length) map.fitBounds(fieldLayer.getBounds().pad(.35)); }

  /** Status badges above each field: [{ feature, items: [{ icon, level, headline, name, word }] }]. Only watch/concern items are passed in. */
  function setBadges(rows) {
    badgeLayer.clearLayers();
    for (const { feature, items } of rows ?? []) {
      if (!items?.length) continue;
      const b = L.geoJSON(feature).getBounds(), lat = b.getNorth(), lon = (b.getWest() + b.getEast()) / 2;
      const html = `<div class="fbadges">${items.map(i => `<span class="fbadge lv-${i.level}" tabindex="0" title="${esc(`${i.name}: ${i.word}. ${i.headline}`)}" aria-label="${esc(`${i.name}: ${i.word}, ${i.headline}`)}">${i.icon}</span>`).join('')}</div>`;
      L.marker([lat, lon], { keyboard: false, icon: L.divIcon({ className: 'fbadge-wrap', html, iconSize: [items.length * 30, 28], iconAnchor: [items.length * 15, 34] }) })
        .bindTooltip(items.map(i => `${esc(i.icon)} <b>${esc(i.word)}</b> · ${esc(i.headline)}`).join('<br>'), { direction: 'top', className: 'val-tip' })
        .addTo(badgeLayer);
    }
  }

  const stopDraw = () => { drawer?.disable(); drawer = null; };
  return { map, setFields, setGrid, setNdvi, setBadges, fitTo, fitAll, startDraw, stopDraw, invalidate: () => map.invalidateSize() };
}
