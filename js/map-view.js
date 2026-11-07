/* ============================================================
   STREETTASKER — map-view.js   (shared map: Find Taskers now, Find Tasks next)
   One small wrapper around Leaflet + OpenStreetMap tiles. Leaflet is loaded only the first time a map is opened,
   so the list view costs nothing extra. No API key. No data is read or written here: the page gives it pins.

   window.STMap:
     STMap.show(el, items, opts)  draw (or redraw) the pins in el. Returns a Promise.
        item = { id, lat, lon, title, sub, meta, href, linkLabel, approx }
        opts = { fit: true }   fit the view to the pins (default true)
     STMap.refresh()             call after the map's container was hidden and is shown again (fixes grey tiles)
     STMap.destroy()
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

  function refresh() { if (S.map) setTimeout(function () { S.map.invalidateSize(); }, 0); }
  function destroy() { if (S.map) { S.map.remove(); S.map = null; S.group = null; S.el = null; } }

  window.STMap = { show: show, refresh: refresh, destroy: destroy };
})();
