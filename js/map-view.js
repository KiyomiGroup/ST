/* ============================================================
   STREETTASKER — map-view.js   (shared map: Find Taskers and Find Tasks)
   One small wrapper around Leaflet + OpenStreetMap tiles. Leaflet is loaded only the first time a map is opened,
   so the list view costs nothing extra. No API key. No data is read or written here: the page gives it pins.

   window.STMap:
     STMap.show(el, items, opts)  draw (or redraw) the pins in el. Returns a Promise.
        item = { id, lat, lon, title, sub, meta, href, linkLabel, approx }
        opts = { fit: true }   fit the view to the pins (default true)
     STMap.refresh()             call after the map's container was hidden and is shown again (fixes grey tiles)
     STMap.destroy()
     STMap.nudge(id)             a stable offset (about 100-350 m) per id, so pins from one area do not sit on top of each other
     STMap.areaPoint(place)      Promise of {lat, lon} or null: the centre of a named area (RPC homepage_place_point), remembered in this browser
   Popups are built with textContent (never innerHTML), so names and text from the database cannot inject markup.
   ============================================================ */
(function () {
  'use strict';

  var LEAFLET_JS  = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
  var LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
  var TILES  = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var LAGOS  = [6.5244, 3.3792];

  var S = { lib: null, map: null, el: null, group: null };

  function loadLeaflet() {
    if (window.L && window.L.map) return Promise.resolve(window.L);
    if (S.lib) return S.lib;
    S.lib = new Promise(function (resolve, reject) {
      var css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = LEAFLET_CSS;
      document.head.appendChild(css);
      var js = document.createElement('script');
      js.src = LEAFLET_JS; js.async = true;
      js.onload = function () { resolve(window.L); };
      js.onerror = function () { S.lib = null; reject(new Error('The map could not be loaded. Check your connection and try again.')); };
      document.head.appendChild(js);
    });
    return S.lib;
  }

  function line(cls, text) { var d = document.createElement('div'); d.className = cls; d.textContent = text; return d; }

  function popup(item) {
    var box = document.createElement('div');
    box.className = 'stmap-pop';
    box.appendChild(line('stmap-pop-title', item.title || ''));
    if (item.sub)  box.appendChild(line('stmap-pop-sub', item.sub));
    if (item.meta) box.appendChild(line('stmap-pop-meta', item.meta));
    if (item.approx) box.appendChild(line('stmap-pop-approx', 'Approximate area'));
    if (item.href) {
      var a = document.createElement('a');
      a.className = 'stmap-pop-link'; a.href = item.href; a.textContent = item.linkLabel || 'View';
      box.appendChild(a);
    }
    return box;
  }

  function ensureMap(L, el) {
    if (S.map && S.el === el) return S.map;
    if (S.map) { S.map.remove(); S.map = null; }
    S.el = el;
    S.map = L.map(el, { center: LAGOS, zoom: 11, zoomControl: true, scrollWheelZoom: false, attributionControl: true });
    L.tileLayer(TILES, { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(S.map);
    S.group = L.layerGroup().addTo(S.map);
    /* ctrl/two-finger zoom only after the person clicks the map, so the page can still scroll past it */
    S.map.once('focus', function () { S.map.scrollWheelZoom.enable(); });
    return S.map;
  }

  function show(el, items, opts) {
    opts = opts || {};
    return loadLeaflet().then(function (L) {
      var map = ensureMap(L, el);
      S.group.clearLayers();
      var pts = [];
      (items || []).forEach(function (it) {
        var lat = Number(it.lat), lon = Number(it.lon);
        if (!isFinite(lat) || !isFinite(lon)) return;
        var icon = L.divIcon({ className: 'stmap-pin' + (it.approx ? ' is-approx' : ''), html: '<span></span>', iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -12] });
        L.marker([lat, lon], { icon: icon, title: it.title || '', keyboard: true }).bindPopup(popup(it), { maxWidth: 240 }).addTo(S.group);
        pts.push([lat, lon]);
      });
      map.invalidateSize();
      if (opts.fit !== false) {
        if (pts.length > 1) map.fitBounds(pts, { padding: [32, 32], maxZoom: 15 });
        else if (pts.length === 1) map.setView(pts[0], 14);
        else map.setView(LAGOS, 11);
      }
      return pts.length;
    });
  }

  /* ---- area points (shared by Find Taskers and Find Tasks; same cache key as taskers-map.js) ---- */
  var CACHE_KEY = 'st.map.areaPoints.v1';
  var areas = (function () { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch (e) { return {}; } })();

  function nudge(id) {
    var h = 0, s = String(id);
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    var a = (h % 360) * Math.PI / 180, r = 0.0008 + ((h >> 8) % 100) / 100 * 0.0022;
    return { dLat: Math.sin(a) * r, dLon: Math.cos(a) * r };
  }

  async function areaPoint(place) {
    var k = String(place || '').trim().toLowerCase();
    if (!k) return null;
    if (k in areas) return areas[k];                 /* null is remembered too: an unknown place is not asked again */
    try {
      var r = await window.supabase.rpc('homepage_place_point', { p_place: place });
      var row = Array.isArray(r.data) ? r.data[0] : null;
      var pt = (row && row.lat != null && row.lon != null && isFinite(Number(row.lat)) && isFinite(Number(row.lon))) ? { lat: Number(row.lat), lon: Number(row.lon) } : null;
      if (!r.error) { areas[k] = pt; try { localStorage.setItem(CACHE_KEY, JSON.stringify(areas)); } catch (e) { /* private mode */ } }
      return pt;
    } catch (e) { return null; }
  }

  function refresh() { if (S.map) setTimeout(function () { S.map.invalidateSize(); }, 0); }
  function destroy() { if (S.map) { S.map.remove(); S.map = null; S.group = null; S.el = null; } }

  window.STMap = { show: show, refresh: refresh, destroy: destroy, nudge: nudge, areaPoint: areaPoint };
})();
