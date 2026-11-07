/* ============================================================
   STREETTASKER — tasks-map.js   (Find Tasks: List / Map toggle)
   Shows the same filtered tasks the list shows, as pins on a map (js/map-view.js).
   Tasks store only a location text (no coordinates), so every pin is an approximate area:
     the centre of the task's area (STMap.areaPoint -> homepage_place_point) plus a small fixed offset per task.
   A long address ("12 Admiralty Way, Lekki Phase 1, Lagos") is tried whole, then without its leading parts
   ("Lekki Phase 1, Lagos", "Lagos"), so the pin never goes finer than an area. Remote tasks have no place, so no pin.
   Nothing is written. Hooks: find-tasks.html calls STTasksMap.refresh(list) in renderTasks(); the toggle is in find-tasks.html.
   ============================================================ */
(function () {
  'use strict';

  var S = { active: false, list: [], run: 0, memo: {} };

  function $(id) { return document.getElementById(id); }
  function naira(n) { return '₦' + Number(n || 0).toLocaleString('en-NG'); }
  function isRemote(t) { return String(t.work_mode || t.task_type || '').toLowerCase() === 'remote' || String(t.task_type || '').toLowerCase() === 'remote'; }

  /* full text first, then drop leading comma parts; at most three tries per task */
  function candidates(loc) {
    var parts = String(loc || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean), out = [];
    for (var i = 0; i < parts.length && out.length < 3; i++) out.push(parts.slice(i).join(', '));
    return out;
  }

  async function pointFor(loc) {
    var k = String(loc || '').trim().toLowerCase();
    if (!k) return null;
    if (k in S.memo) return S.memo[k];
    var cs = candidates(loc), pt = null;
    for (var i = 0; i < cs.length && !pt; i++) pt = await window.STMap.areaPoint(cs[i]);
    S.memo[k] = pt;
    return pt;
  }

  function areaNote(r) { note(r.on ? 'Showing ' + r.shown + ' of ' + r.total + ' in this area. Tap "Show all" to see every task again.' : ''); }

  /* "Show in list" on a pin: back to the list, scrolled to that task's card */
  function pick(item) {
    setMode(false);
    var el = document.querySelector('.st-card--task[data-task-id="' + String(item.pickId).replace(/["\\]/g, '') + '"]');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('stmap-picked'); void el.offsetWidth; el.classList.add('stmap-picked');
  }

  function note(text) { var n = $('tasksMapNote'); if (n) { n.textContent = text || ''; n.hidden = !text; } }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  async function paint() {
    var run = ++S.run, host = $('tasksMap');
    if (!S.active || !host) return;
    var list = S.list || [];
    if (!list.length) { try { await window.STMap.show(host, [], {}); } catch (e) { /* note below */ } if (run === S.run) note('No tasks match your filters.'); return; }
    note('Finding tasks on the map…');

    var remote = 0, places = {};
    list.forEach(function (t) { if (isRemote(t)) remote++; else if (t.location) places[String(t.location).trim()] = 1; });
    var names = Object.keys(places), pts = {};
    for (var i = 0; i < names.length; i += 4) {                      /* four lookups at a time */
      await Promise.all(names.slice(i, i + 4).map(async function (n) { pts[n] = await pointFor(n); }));
      if (run !== S.run) return;
    }

    var items = [], missing = 0;
    list.forEach(function (t) {
      if (isRemote(t)) return;
      var p = t.location ? pts[String(t.location).trim()] : null;
      if (!p) { missing++; return; }
      var id = String(t.id), d = window.STMap.nudge(id);
      var cat = t.category ? (window.STCat ? window.STCat.label(t.category) : t.category) : '';
      var pay = Number(t.budget) > 0 ? naira(t.budget) : 'No budget set';
      items.push({ id: id, pickId: id, lat: p.lat + d.dLat, lon: p.lon + d.dLon, approx: true, title: t.title || 'Untitled task', sub: cat,
        meta: [t.location, pay, t.urgency === 'immediate' ? 'Urgent' : ''].filter(Boolean).join(' · '),
        href: 'task-details.html?id=' + encodeURIComponent(id), linkLabel: 'View task' });
    });
    try { await window.STMap.show(host, items, { onPick: pick, onArea: areaNote }); }
    catch (e) { if (run === S.run) note((e && e.message) || 'The map could not be loaded.'); return; }
    if (run !== S.run) return;

    var bits = [];
    if (missing) bits.push(plural(missing, 'task') + ' could not be placed on the map');
    if (remote) bits.push(plural(remote, 'remote task') + ' ' + (remote === 1 ? 'has' : 'have') + ' no location');
    note(!items.length ? 'We could not place these tasks on the map. Use the list view.' : (bits.length ? bits.join('; ') + '. They are in the list view.' : ''));
  }

  function setMode(map) {
    S.active = !!map;
    var wrap = $('tasksMapWrap'), grid = $('tasksGrid'), empty = $('tasksEmpty');
    if (wrap) wrap.hidden = !map;
    if (grid) grid.hidden = !!map;
    if (empty && map) empty.style.display = 'none';
    ['tasksViewList', 'tasksViewMap'].forEach(function (id) {
      var b = $(id); if (b) b.setAttribute('aria-pressed', (id === 'tasksViewMap') === !!map ? 'true' : 'false');
    });
    if (map) { paint().then(function () { window.STMap.refresh(); }); }
    else if (typeof window.renderTasks === 'function') window.renderTasks();   /* restores the empty message if needed */
  }

  function init() {
    var l = $('tasksViewList'), m = $('tasksViewMap');
    if (l) l.addEventListener('click', function () { setMode(false); });
    if (m) m.addEventListener('click', function () { setMode(true); });
  }

  window.STTasksMap = {
    active: function () { return S.active; },
    /* called by renderTasks() in find-tasks.html: the filtered list in full */
    refresh: function (list) { S.list = list || []; if (S.active) paint(); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
