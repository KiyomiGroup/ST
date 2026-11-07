/* ============================================================
   STREETTASKER — map-view.js   (shared map: Find Taskers and Find Tasks)
   One small wrapper around Leaflet + OpenStreetMap tiles. Leaflet is loaded only the first time a map is opened,
   so the list view costs nothing extra. No API key. No data is read or written here: the page gives it pins.

   window.STMap:
     STMap.show(el, items, opts)  draw (or redraw) the pins in el. Returns a Promise.
        item = { id, lat, lon, title, sub, meta, href, linkLabel, approx }
        item.pickId = optional id passed back to opts.onPick (a "Show in list" button is added to the popup when onPick is given)
        opts = { fit: true,                       fit the view to the pins (default true)
                 onPick(item),                    "Show in list" tapped in a popup
                 fetchArea(bounds) -> Promise of items   optional: "Search this area" also asks the page for pins in the view that are not
                                                  loaded yet. bounds = { south, west, north, east }. Those pins are dropped again on "Show all".
                 onArea({ shown, total, extra, on }) }   "Search this area" / "Show all" used: pins in view, pins known, how many came from fetchArea
     Pins close together are grouped into numbered clusters (Leaflet.markercluster, loaded with Leaflet).
     Two buttons sit on the map: "Near me" (asks the browser for the position, centres on it, draws a blue dot) and "Search this area"
     (appears after the person moves the map; keeps only the pins in view; becomes "Show all").
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
  var CLUSTER_JS  = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.js';
  var CLUSTER_CSS = ['https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.min.css',
                     'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.Default.min.css'];
  /* Tile provider. Default: OpenStreetMap's public server (light use only). To switch provider, set this BEFORE map-view.js loads:
       window.ST_MAP_CONFIG = { tiles: 'https://…/{z}/{x}/{y}.png?key=…', attribution: '© …', maxZoom: 19 };
     Keep the provider's required attribution text. */
  var CFG    = window.ST_MAP_CONFIG || {};
  var TILES  = CFG.tiles || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var ATTRIB = CFG.attribution || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  var LAGOS  = [6.5244, 3.3792];

  var S = { lib: null, map: null, el: null, group: null, items: [], opts: {}, areaOn: false, busy: false, areaBtn: null, meDot: null, sheet: null, extra: [], areaRun: 0 };

  function loadLeaflet() {
    if (window.L && window.L.map) return Promise.resolve(window.L);
    if (S.lib) return S.lib;
    S.lib = new Promise(function (resolve, reject) {
      var css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = LEAFLET_CSS;
      document.head.appendChild(css);
      CLUSTER_CSS.forEach(function (h) { var c = document.createElement('link'); c.rel = 'stylesheet'; c.href = h; document.head.appendChild(c); });
      var js = document.createElement('script');
      js.src = LEAFLET_JS; js.async = true;
      js.onload = function () {
        /* clusters are a nicety: if that file fails, pins are still drawn one by one */
        var cj = document.createElement('script');
        cj.src = CLUSTER_JS; cj.async = true;
        cj.onload = cj.onerror = function () { resolve(window.L); };
        document.head.appendChild(cj);
      };
      js.onerror = function () { S.lib = null; reject(new Error('The map could not be loaded. Check your connection and try again.')); };
      document.head.appendChild(js);
    });
    return S.lib;
  }

  function line(cls, text) { var d = document.createElement('div'); d.className = cls; d.textContent = text; return d; }

  function popup(item, opts) {
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
    if (opts && typeof opts.onPick === 'function' && item.pickId != null) {   /* only pins that are in the list can be shown there */
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'stmap-pop-pick'; b.textContent = 'Show in list';
      b.addEventListener('click', function () { opts.onPick(item); });
      box.appendChild(b);
    }
    return box;
  }

  var tileMsg = null;
  function showTileMsg() {
    if (tileMsg || !S.el) return;
    tileMsg = document.createElement('div');
    tileMsg.className = 'stmap-tilemsg'; tileMsg.setAttribute('role', 'status');
    tileMsg.textContent = 'The map picture is not loading, but the pins are still here. Check your connection or use the list view.';
    S.el.appendChild(tileMsg);
  }
  function hideTileMsg() { if (tileMsg) { tileMsg.remove(); tileMsg = null; } }

  /* ---- phones: a card at the bottom of the map instead of a popup (a popup is small and hard to tap there) ---- */
  function isPhone() { return !!(window.matchMedia && window.matchMedia('(max-width: 768px)').matches); }

  function closeSheet() { if (S.sheet) { S.sheet.remove(); S.sheet = null; } }

  function openSheet(L, item) {
    closeSheet();
    var sheet = document.createElement('div');
    sheet.className = 'stmap-sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', item.title || 'Details');
    var x = document.createElement('button');
    x.type = 'button'; x.className = 'stmap-sheet-close'; x.setAttribute('aria-label', 'Close'); x.textContent = '\u00D7';
    x.addEventListener('click', closeSheet);
    sheet.appendChild(x); sheet.appendChild(popup(item, S.opts));
    S.el.appendChild(sheet);
    if (L.DomEvent) { L.DomEvent.disableClickPropagation(sheet); if (L.DomEvent.disableScrollPropagation) L.DomEvent.disableScrollPropagation(sheet); }
    S.sheet = sheet;
    var first = sheet.querySelector('a, button.stmap-pop-pick'); if (first && first.focus) first.focus({ preventScroll: true });
  }

  function button(cls, text, onClick) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.textContent = text;
    b.addEventListener('click', function (e) { e.stopPropagation(); onClick(); });
    return b;
  }

  /* a move the page made itself (fit to pins, near me) must not offer "Search this area" */
  function programmatic() { S.busy = true; setTimeout(function () { S.busy = false; }, 800); }

  function inView(it, map) { return map.getBounds().contains([it.lat, it.lon]); }

  function control(L, map) {
    var Ctl = L.Control.extend({
      options: { position: 'topright' },
      onAdd: function () {
        var box = L.DomUtil.create('div', 'stmap-ctl');
        L.DomEvent.disableClickPropagation(box);
        var me = button('stmap-ctl-btn', 'Near me', function () { nearMe(L, map, me); });
        S.areaBtn = button('stmap-ctl-btn stmap-ctl-area', 'Search this area', function () { toggleArea(L, map); });
        S.areaBtn.hidden = true;
        box.appendChild(me); box.appendChild(S.areaBtn);
        return box;
      }
    });
    new Ctl().addTo(map);
  }

  function nearMe(L, map, btn) {
    if (!navigator.geolocation) { btn.textContent = 'Location not available'; return; }
    btn.disabled = true; btn.textContent = 'Locating\u2026';
    navigator.geolocation.getCurrentPosition(function (pos) {
      btn.disabled = false; btn.textContent = 'Near me';
      var ll = [pos.coords.latitude, pos.coords.longitude];
      if (S.meDot) S.meDot.remove();
      S.meDot = L.circleMarker(ll, { radius: 8, weight: 3, color: '#fff', fillColor: '#2563eb', fillOpacity: 1 }).addTo(map);
      S.meDot.bindTooltip('You are here');
      programmatic(); map.setView(ll, 14);
    }, function (err) {
      btn.disabled = false;
      btn.textContent = err && err.code === 1 ? 'Allow location to use this' : 'Could not find you';
      setTimeout(function () { btn.textContent = 'Near me'; }, 3500);
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  }

  function report() {
    if (typeof S.opts.onArea === 'function') S.opts.onArea({ shown: S.shown, total: S.items.length + S.extra.length, extra: S.extra.length, on: S.areaOn });
  }

  function toggleArea(L, map) {
    var btn = S.areaBtn;
    if (S.areaOn) {                                   /* "Show all": back to the page's own pins */
      S.areaOn = false; S.extra = []; S.areaRun++;
      draw(L, S.items, false);
      btn.hidden = true; btn.textContent = 'Search this area';
      report();
      return;
    }
    S.areaOn = true;
    var run = ++S.areaRun, bb = map.getBounds();
    var bounds = { south: bb.getSouth(), west: bb.getWest(), north: bb.getNorth(), east: bb.getEast() };
    btn.disabled = true; btn.textContent = 'Searching\u2026';
    var ask = typeof S.opts.fetchArea === 'function' ? Promise.resolve().then(function () { return S.opts.fetchArea(bounds); }) : Promise.resolve([]);
    ask.catch(function () { return []; }).then(function (extra) {
      if (run !== S.areaRun) return;                  /* the pins were replaced (a filter changed) while we waited */
      var have = {}; S.items.forEach(function (i) { have[String(i.id)] = 1; });
      S.extra = (extra || []).map(norm).filter(function (e) { return isFinite(e.lat) && isFinite(e.lon) && !have[String(e.id)] && (have[String(e.id)] = 1); });
      draw(L, S.items.concat(S.extra), true);
      btn.disabled = false; btn.textContent = 'Show all';
      report();
    });
  }

  function norm(it) {
    return { id: it.id, pickId: it.pickId, lat: Number(it.lat), lon: Number(it.lon), title: it.title, sub: it.sub, meta: it.meta, href: it.href, linkLabel: it.linkLabel, approx: it.approx };
  }

  /* draw the pins (all, or only those in view) */
  function draw(L, items, keepView) {
    S.group.clearLayers(); closeSheet();
    var map = S.map, pts = [], n = 0;
    items.forEach(function (it) {
      if (!isFinite(it.lat) || !isFinite(it.lon)) return;
      if (S.areaOn && keepView && !inView(it, map)) return;
      var icon = L.divIcon({ className: 'stmap-pin' + (it.approx ? ' is-approx' : ''), html: '<span></span>', iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -12] });
      var m = L.marker([it.lat, it.lon], { icon: icon, title: it.title || '', keyboard: true });
      if (isPhone()) m.on('click', (function (item) { return function () { openSheet(L, item); }; })(it));
      else m.bindPopup(popup(it, S.opts), { maxWidth: 240 });
      m.addTo(S.group);
      pts.push([it.lat, it.lon]); n++;
    });
    S.shown = n;
    return pts;
  }

  function ensureMap(L, el) {
    if (S.map && S.el === el) return S.map;
    if (S.map) { S.map.remove(); S.map = null; }
    S.el = el;
    S.map = L.map(el, { center: LAGOS, zoom: 11, zoomControl: true, scrollWheelZoom: false, attributionControl: true });
    var tl = L.tileLayer(TILES, { maxZoom: CFG.maxZoom || 19, attribution: ATTRIB }).addTo(S.map);
    /* tiles that never arrive (blocked, offline, key refused): say so instead of leaving a blank grey box */
    var bad = 0, good = 0;
    tl.on('tileload', function () { good++; hideTileMsg(); });
    tl.on('tileerror', function () { bad++; if (bad >= 4 && !good) showTileMsg(); });
    S.group = (L.markerClusterGroup ? L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 48, spiderfyOnMaxZoom: true }) : L.layerGroup()).addTo(S.map);
    control(L, S.map);
    S.map.on('click', closeSheet);
    S.el.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });
    S.map.on('moveend', function () {
      if (S.busy) return;
      if (S.areaBtn && !S.areaOn && S.items.length) S.areaBtn.hidden = false;      /* the person moved the map */
    });
    /* ctrl/two-finger zoom only after the person clicks the map, so the page can still scroll past it */
    S.map.once('focus', function () { S.map.scrollWheelZoom.enable(); });
    return S.map;
  }

  function show(el, items, opts) {
    opts = opts || {};
    return loadLeaflet().then(function (L) {
      var map = ensureMap(L, el);
      S.items = (items || []).map(norm);
      S.opts = opts; S.areaOn = false; S.extra = []; S.areaRun++;              /* new pins (filters changed): back to showing all of them */
      if (S.areaBtn) { S.areaBtn.hidden = true; S.areaBtn.disabled = false; S.areaBtn.textContent = 'Search this area'; }
      var pts = draw(L, S.items, false);
      map.invalidateSize();
      if (opts.fit !== false) {
        programmatic();
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
  function destroy() { if (S.map) { S.map.remove(); S.map = null; S.group = null; S.el = null; S.areaBtn = null; S.meDot = null; S.sheet = null; S.extra = []; hideTileMsg(); } }

  window.STMap = { show: show, refresh: refresh, destroy: destroy, nudge: nudge, areaPoint: areaPoint };
})();
