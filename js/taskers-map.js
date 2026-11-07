/* ============================================================
   STREETTASKER — taskers-map.js   (Find Taskers: List / Map toggle)
   Shows the same filtered taskers the list shows, as pins on a map (js/map-view.js).
   Where a tasker's pin comes from, in order:
     1. taskers.business_lat / business_lon (public columns), rounded to 3 decimals (about 100 m), so a home address is never shown exactly
     2. the centre of the tasker's area, from the database function homepage_place_point (the same one the Home page uses), plus a small
        fixed offset per person so taskers in one area do not sit on top of each other. These pins say "Approximate area".
   Nothing is written. Looked-up area points are remembered in this browser (localStorage) so each area is asked for once.
   Hooks: taskers.js calls STTaskersMap.refresh(list) at the end of render(); the toggle buttons are in find-taskers.html.
   ============================================================ */
(function () {
  'use strict';

  var CACHE_KEY = 'st.map.areaPoints.v1';
  var S = { active: false, list: [], run: 0, exact: {}, exactFor: '', areas: loadAreas() };

  function $(id) { return document.getElementById(id); }
  function loadAreas() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function saveAreas() { try { localStorage.setItem(CACHE_KEY, JSON.stringify(S.areas)); } catch (e) { /* private mode: asked again next time */ } }
  function naira(n) { return '\u20A6' + Number(n || 0).toLocaleString('en-NG'); }

  /* one stable offset per person, about +-350 m, so area pins spread out the same way every visit */
  function nudge(id) {
    var h = 0, s = String(id);
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    var a = (h % 360) * Math.PI / 180, r = 0.0008 + ((h >> 8) % 100) / 100 * 0.0022;
    return { dLat: Math.sin(a) * r, dLon: Math.cos(a) * r };
  }

  /* one pin per person, even if they have several listings */
  function people(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (s) {
      var id = String(s.user_id || '');
      if (!id || id === 'demo' || seen[id]) return;
      seen[id] = 1; out.push(s);
    });
    return out;
  }

  async function loadExact(ids) {
    var key = ids.join(',');
    if (key === S.exactFor) return;
    S.exact = {}; S.exactFor = key;
    try {
      for (var i = 0; i < ids.length; i += 100) {
        var r = await window.supabase.from('taskers').select('user_id, business_lat, business_lon').in('user_id', ids.slice(i, i + 100));
        (r.data || []).forEach(function (t) {
          var la = Number(t.business_lat), lo = Number(t.business_lon);
          if (t.business_lat != null && t.business_lon != null && isFinite(la) && isFinite(lo)) S.exact[String(t.user_id)] = { lat: Math.round(la * 1000) / 1000, lon: Math.round(lo * 1000) / 1000 };
        });
      }
    } catch (e) { /* no exact points: area centres are used */ }
  }

  async function areaPoint(place) {
    var k = String(place || '').trim().toLowerCase();
    if (!k) return null;
    if (k in S.areas) return S.areas[k];            /* null is remembered too: an unknown place is not asked again */
    try {
      var r = await window.supabase.rpc('homepage_place_point', { p_place: place });
      var row = Array.isArray(r.data) ? r.data[0] : null;
      var pt = (row && row.lat != null && row.lon != null && isFinite(Number(row.lat)) && isFinite(Number(row.lon))) ? { lat: Number(row.lat), lon: Number(row.lon) } : null;
      if (!r.error) { S.areas[k] = pt; saveAreas(); }
      return pt;
    } catch (e) { return null; }
  }

  function note(text) { var n = $('taskersMapNote'); if (n) { n.textContent = text || ''; n.hidden = !text; } }

  async function paint() {
    var run = ++S.run;
    var host = $('taskersMap');
    if (!S.active || !host) return;
    var ppl = people(S.list);
    if (!ppl.length) { await window.STMap.show(host, [], {}); if (run === S.run) note('No taskers match your filters.'); return; }
    note('Finding taskers on the map…');

    await loadExact(ppl.map(function (s) { return String(s.user_id); }));
    if (run !== S.run) return;

    var places = {}; ppl.forEach(function (s) { if (!S.exact[String(s.user_id)] && s.location) places[s.location] = 1; });
    var names = Object.keys(places), pts = {};
    for (var i = 0; i < names.length; i += 4) {                      /* four lookups at a time */
      await Promise.all(names.slice(i, i + 4).map(async function (n) { pts[n] = await areaPoint(n); }));
      if (run !== S.run) return;
    }

    var items = [], missing = 0;
    ppl.forEach(function (s) {
      var id = String(s.user_id), ex = S.exact[id], lat, lon, approx = false;
      if (ex) { lat = ex.lat; lon = ex.lon; }
      else {
        var p = pts[s.location];
        if (!p) { missing++; return; }
        var d = nudge(id); lat = p.lat + d.dLat; lon = p.lon + d.dLon; approx = true;
      }
      var bits = [];
      if (s.price > 0) bits.push('From ' + naira(s.price));
      if (s.rating > 0) bits.push('\u2605 ' + Number(s.rating).toFixed(1));
      items.push({ id: id, lat: lat, lon: lon, approx: approx, title: s.provider_name || 'Tasker', sub: s.service_name || '',
        meta: [s.location, bits.join(' \u00B7 ')].filter(Boolean).join(' \u00B7 '), href: 'tasker-profile.html?id=' + encodeURIComponent(id), linkLabel: 'View profile' });
    });
    try { await window.STMap.show(host, items, {}); }
    catch (e) { if (run === S.run) note((e && e.message) || 'The map could not be loaded.'); return; }
    if (run !== S.run) return;
    note(!items.length ? 'We could not place these taskers on the map yet. Use the list view.'
      : (missing ? missing + ' tasker' + (missing === 1 ? '' : 's') + ' could not be placed on the map. They are in the list view.' : ''));
  }

  function setMode(map) {
    S.active = !!map;
    var wrap = $('taskersMapWrap'), grid = $('taskersGrid'), more = $('loadMoreWrap'), empty = $('taskerEmpty');
    if (wrap) wrap.hidden = !map;
    if (grid) grid.hidden = !!map;
    if (more && map) more.style.display = 'none';
    if (empty && map) empty.style.display = 'none';
    ['taskersViewList', 'taskersViewMap'].forEach(function (id) {
      var b = $(id); if (b) b.setAttribute('aria-pressed', (id === 'taskersViewMap') === !!map ? 'true' : 'false');
    });
    if (map) { paint().then(function () { window.STMap.refresh(); }); }
    else if (typeof window.render === 'function') window.render(1);   /* put the list's Load More button back */
  }

  function init() {
    var l = $('taskersViewList'), m = $('taskersViewMap');
    if (l) l.addEventListener('click', function () { setMode(false); });
    if (m) m.addEventListener('click', function () { setMode(true); });
  }

  window.STTaskersMap = {
    /* called by taskers.js after every render(): the filtered list in full (not just the first page) */
    refresh: function (list) { S.list = list || []; if (S.active) paint(); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
