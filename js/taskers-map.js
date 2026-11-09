/* ============================================================
   STREETTASKER — taskers-map.js   (Find Taskers: List / Map toggle)
   Shows the same filtered taskers the list shows, as pins on a map (js/map-view.js).
   Where a tasker's pin comes from, in order:
     1. taskers.business_lat / business_lon (public columns), rounded to 3 decimals (about 100 m), so a home address is never shown exactly
     2. the centre of the tasker's area, from the database function homepage_place_point (the same one the Home page uses), plus a small
        fixed offset per person so taskers in one area do not sit on top of each other. These pins say "Approximate area".
   Area lookups and offsets come from js/map-view.js (STMap.areaPoint / STMap.nudge); they are remembered in this browser so each area is asked for once.
   "Search this area" also asks the database for taskers whose business point is inside the view but who are not in the loaded list (fetchArea).
   Only taskers with business_lat / business_lon can be found that way: area-only taskers have no point to search by.
   Nothing is written.
   Hooks: taskers.js calls STTaskersMap.refresh(list) at the end of render(); the toggle buttons are in find-taskers.html.
   ============================================================ */
(function () {
  'use strict';

  var S = { active: false, list: [], run: 0, exact: {}, exactFor: '' };

  function $(id) { return document.getElementById(id); }
  function naira(n) { return '\u20A6' + Number(n || 0).toLocaleString('en-NG'); }

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

  function areaNote(r) {
    note(r.on ? 'Showing ' + r.shown + ' of ' + r.total + ' in this area' + (r.extra ? ' (' + r.extra + ' more, not in the list). ' : '. ') + 'Tap "Show all" to see every tasker again.' : '');
  }

  /* "Show in list" on a pin: back to the list, on the page that holds this tasker's card, scrolled to it */
  function pick(item) {
    setMode(false);
    var all = typeof window.filtered === 'function' ? window.filtered() : S.list;
    var idx = all.findIndex(function (s) { return String(s.id) === String(item.pickId); });
    var size = typeof PAGE_SIZE === 'number' ? PAGE_SIZE : 8;
    if (idx >= size && typeof window.render === 'function') window.render(Math.floor(idx / size) + 1);
    var el = document.getElementById('svc-' + String(item.pickId).replace(/[^\w-]/g, ''));
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('stmap-picked'); void el.offsetWidth; el.classList.add('stmap-picked');
  }

  function note(text) { var n = $('taskersMapNote'); if (n) { n.textContent = text || ''; n.hidden = !text; } }

  function toItem(s, lat, lon, approx) {
    var bits = [];
    if (s.price > 0) bits.push('From ' + naira(s.price));
    if (s.rating > 0) bits.push('\u2605 ' + Number(s.rating).toFixed(1));
    return { id: String(s.user_id), pickId: s.id, lat: lat, lon: lon, approx: approx, title: s.provider_name || 'Tasker', sub: s.service_name || '',
      meta: [s.location, bits.join(' \u00B7 ')].filter(Boolean).join(' \u00B7 '), href: 'tasker-profile.html?id=' + encodeURIComponent(String(s.user_id)), linkLabel: 'View profile' };
  }

  /* "Search this area": taskers with a business point inside the view that the page has not loaded (it loads the newest 100 listings).
     Their listings are filtered with the page's own filters (filterList in taskers.js). Pins only: they are not in the list view. */
  async function fetchArea(b) {
    var sb = window.supabase;
    var r = await sb.from('taskers').select('user_id, business_lat, business_lon')
      .gte('business_lat', b.south).lte('business_lat', b.north).gte('business_lon', b.west).lte('business_lon', b.east).limit(100);
    var pts = {}, ids = [];
    (r.data || []).forEach(function (t) {
      var la = Number(t.business_lat), lo = Number(t.business_lon);
      if (t.user_id && t.business_lat != null && t.business_lon != null && isFinite(la) && isFinite(lo)) { pts[String(t.user_id)] = { lat: Math.round(la * 1000) / 1000, lon: Math.round(lo * 1000) / 1000 }; ids.push(String(t.user_id)); }
    });
    if (!ids.length) return [];
    var loaded = {}; people(S.list).forEach(function (s) { loaded[String(s.user_id)] = 1; });
    ids = ids.filter(function (id) { return !loaded[id]; });
    if (!ids.length) return [];
    var sv = await sb.from('services').select('id, service_name, category, price, rate_unit, location, description, user_id, available, created_at').in('user_id', ids).eq('available', true).limit(200);
    var un = await sb.from('users').select('id, name, business_name').in('id', ids);
    var names = {}; (un.data || []).forEach(function (u) { names[String(u.id)] = u.business_name || u.name; });
    var svRows = (window.ST && window.ST.db && window.ST.db.hideUnpublishedLocal) ? await window.ST.db.hideUnpublishedLocal(sv.data || [], 'user_id') : (sv.data || []);   /* HP2 */
    var rows = svRows.map(function (s) {
      return { id: String(s.id), user_id: String(s.user_id), provider_name: names[String(s.user_id)] || 'Provider', service_name: s.service_name || 'Service',
        category: s.category || 'other', location: s.location || '', price: parseFloat(s.price) || 0, rating: 0, reviews: 0, description: s.description || '',
        specialties: s.service_name ? [s.service_name] : [], availability_status: null, verified: false, created_at: s.created_at };
    });
    if (typeof window.filterList === 'function') rows = window.filterList(rows);
    return people(rows).map(function (s) { var p = pts[String(s.user_id)]; return toItem(s, p.lat, p.lon, false); });
  }

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
      await Promise.all(names.slice(i, i + 4).map(async function (n) { pts[n] = await window.STMap.areaPoint(n); }));
      if (run !== S.run) return;
    }

    var items = [], missing = 0;
    ppl.forEach(function (s) {
      var id = String(s.user_id), ex = S.exact[id], lat, lon, approx = false;
      if (ex) { lat = ex.lat; lon = ex.lon; }
      else {
        var p = pts[s.location];
        if (!p) { missing++; return; }
        var d = window.STMap.nudge(id); lat = p.lat + d.dLat; lon = p.lon + d.dLon; approx = true;
      }
      items.push(toItem(s, lat, lon, approx));
    });
    try { await window.STMap.show(host, items, { onPick: pick, onArea: areaNote, fetchArea: fetchArea }); }
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
