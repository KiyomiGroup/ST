/* ============================================================
   StreetTasker — coordinator-tasker-shell.js (Stage T1)
   The frame around ONE Local Tasker on coordinator-tasker.html?id=<tasker user id>[&tab=<tab>]:
     - the tabs (Overview, Bookings, Messages, Earnings, Profile & Services)
     - the "My Local Taskers" sidebar (desktop) and the tasker switcher (phones and tablets)
     - the header extras (area, "Managing", public page link, identity check chip)
     - the Bookings and Messages counts, and the unread badges in the sidebar

   It never writes anything. It reads only what the coordinator may already read:
     coordinator_assignments, local_tasker_profiles   own active assignments and their profiles
     rpc local_booking_list, rpc coordinator_chat_list the same two calls the overview uses
     rpc idv_local_status                              the same identity answer the Verification card shows
   If a count or the identity chip cannot be read it stays hidden: never a made-up number.
   The profile itself (name, services, photos, payout ...) is still painted by js/coordinator-tasker.js.
   Renders with textContent only (names are user-entered data).
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo;
  var el = C.el;
  var params = new URLSearchParams(window.location.search);
  var taskerId = params.get('id');
  var rows = [];            /* the coordinator's active Local Taskers: { id, name, skills, areas, status } */
  var unreadBy = {};        /* tasker id -> unread messages in conversations the coordinator handles */
  var filterText = '';
  var rosterFailed = false; /* so a later redraw (unread badges) never replaces the error message */

  function $(id) { return document.getElementById(id); }

  /* ── Tabs ─────────────────────────────────────────────────── */
  function tabButtons() { return Array.prototype.slice.call(document.querySelectorAll('#coTabs [role="tab"]')); }
  function enabledTabs() { return tabButtons().filter(function (b) { return !b.disabled; }); }
  function currentTab() {
    var on = tabButtons().filter(function (b) { return b.getAttribute('aria-selected') === 'true'; })[0];
    return on ? on.getAttribute('data-tab') : '';
  }

  /* On a phone the tab bar scrolls sideways: keep the open tab in view. Moves the bar only, never the page. */
  function keepInView(btn) {
    var bar = $('coTabs');
    if (!btn || !bar || bar.scrollWidth <= bar.clientWidth) return;
    bar.scrollLeft = Math.max(0, btn.offsetLeft - (bar.clientWidth - btn.offsetWidth) / 2);
  }

  function selectTab(btn, opts) {
    opts = opts || {};
    tabButtons().forEach(function (b) {
      var on = b === btn;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      var panel = $(b.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
    });
    var crumb = $('coCrumbTab'); if (crumb) crumb.textContent = btn.getAttribute('data-label') || btn.textContent;
    if (opts.focus) btn.focus();
    keepInView(btn);
    /* Stage T2: tab panels load their own data the first time they are opened */
    document.dispatchEvent(new CustomEvent('coordinator-tasker:tab', { detail: { tab: btn.getAttribute('data-tab') } }));
    if (opts.remember) {
      /* keep ?id=... and any other flags; only the tab changes, so a refresh or a shared link opens the same tab */
      try {
        var u = new URL(window.location.href);
        u.searchParams.set('tab', btn.getAttribute('data-tab'));
        window.history.replaceState(null, '', u.pathname + u.search + u.hash);
      } catch (e) { /* the address bar is a convenience */ }
    }
  }

  function initTabs() {
    var list = $('coTabs'); if (!list) return;
    var on = enabledTabs();
    if (!on.length) return;
    var want = params.get('tab');
    var start = on.filter(function (b) { return b.getAttribute('data-tab') === want; })[0]
      || on.filter(function (b) { return b.getAttribute('data-tab') === list.getAttribute('data-default'); })[0]
      || on[0];
    selectTab(start);
    /* the header card is hidden until the profile has loaded, so the bar can only be measured once it is shown */
    var card = $('coDetail');
    if (card && window.MutationObserver) {
      new MutationObserver(function () { if (!card.hidden) keepInView(enabledTabs().filter(function (b) { return b.getAttribute('aria-selected') === 'true'; })[0]); })
        .observe(card, { attributes: true, attributeFilter: ['hidden'] });
    }
    list.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[role="tab"]') : null;
      if (b && !b.disabled) selectTab(b, { remember: true });
    });
    list.addEventListener('keydown', function (e) {
      var tabs = enabledTabs(), i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      var n = -1;
      if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = tabs.length - 1;
      if (n < 0) return;
      e.preventDefault();
      selectTab(tabs[n], { focus: true, remember: true });
    });
  }

  /* ── Sidebar and switcher ─────────────────────────────────── */
  function dotClass(status) { return 'co-side-dot co-side-dot--' + (status === 'published' || status === 'inactive' ? status : 'draft'); }

  function drawSidebar() {
    var ul = $('coSideTaskers'), empty = $('coSideEmpty');
    if (!ul) return;
    ul.textContent = '';
    var term = filterText.trim().toLowerCase();
    var pub = rows.filter(function (r) { return r.status === 'published'; });   /* the side panel lists published Local Taskers only (rows stays complete for the header and switcher) */
    var shown = pub.filter(function (r) { return !term || (r.name + ' ' + r.skills).toLowerCase().indexOf(term) > -1; });
    shown.forEach(function (r) {
      var li = el('li');
      var isCur = r.id === taskerId;
      var a = el('a', 'co-side-trow' + (isCur ? ' is-current' : ''));
      var q = new URLSearchParams(); q.set('id', r.id);
      var tab = currentTab(); if (tab) q.set('tab', tab);
      a.href = 'coordinator-tasker.html?' + q.toString();
      var n = unreadBy[r.id] || 0;
      a.setAttribute('aria-label', r.name + ', ' + C.statusLabel(r.status) + (n > 0 ? ', ' + n + ' new messages' : ''));
      if (isCur) a.setAttribute('aria-current', 'page');
      var dot = el('span', dotClass(r.status)); dot.setAttribute('aria-hidden', 'true'); a.appendChild(dot);
      var t = el('span', 'co-side-ttext');
      t.appendChild(el('span', 'co-side-tname', r.name));
      t.appendChild(el('span', 'co-side-tsub', r.skills || C.statusLabel(r.status)));
      a.appendChild(t);
      if (n > 0) a.appendChild(el('span', 'co-side-new', (n > 98 ? '99+' : n) + ' new'));
      li.appendChild(a); ul.appendChild(li);
    });
    if (empty) {
      empty.hidden = !!shown.length;
      if (rosterFailed) { empty.hidden = false; empty.textContent = 'We couldn\u2019t load your Local Taskers just now.'; }
      else empty.textContent = pub.length ? 'No Local Taskers match that filter.' : (rows.length ? 'No published Local Taskers yet.' : 'No Local Taskers assigned to you yet.');
    }
  }

  function drawSwitcher() {
    var wrap = $('coSwitchWrap'), sel = $('coTaskerSwitch');
    if (!wrap || !sel) return;
    sel.textContent = '';
    rows.forEach(function (r) {
      var o = el('option', null, r.name); o.value = r.id; if (r.id === taskerId) o.selected = true;
      sel.appendChild(o);
    });
    wrap.hidden = rows.length < 2;
  }

  function wireSwitcher() {
    var sel = $('coTaskerSwitch'); if (!sel) return;
    sel.addEventListener('change', function () {
      if (!C.isUuid(sel.value)) return;
      var q = new URLSearchParams(); q.set('id', sel.value);
      var tab = currentTab(); if (tab) q.set('tab', tab);
      window.location.href = 'coordinator-tasker.html?' + q.toString();
    });
    var f = $('coSideFilter');
    if (f) f.addEventListener('input', function () { filterText = this.value; drawSidebar(); });
  }

  /* ── Header extras (from the roster, so they never wait for the profile) ── */
  function paintHeader(p) {
    if (!p) return;
    var m = $('coManaging'); if (m) { m.textContent = 'Managing ' + p.name; m.hidden = false; }
    var crumb = $('coCrumbName'); if (crumb) crumb.textContent = p.name;
    var area = $('coDetailArea');
    if (area) {   /* first place on its own, the rest in a second span (phones show only the first) */
      var parts = String(p.areas || '').split(/[,;\n]/).map(function (x) { return x.trim(); }).filter(Boolean);
      area.textContent = ''; area.title = parts.join(', ');
      if (parts.length) { area.appendChild(el('span', 'co-th-first', parts[0])); if (parts.length > 1) area.appendChild(el('span', 'co-th-rest', ', ' + parts.slice(1).join(', '))); }
      area.hidden = !parts.length;
    }
    var pub = $('coPublicLink');
    if (pub) {
      pub.hidden = p.status !== 'published';
      pub.href = 'tasker-profile.html?id=' + encodeURIComponent(p.id);
    }
  }

  /* ── The roster: assignments, then their profiles (same reads as the overview) ── */
  async function loadRoster(detail) {
    var sb = window.supabase;
    try {
      var asg = await sb.from('coordinator_assignments').select('tasker_user_id, assigned_at')
        .eq('coordinator_id', detail.userId).is('ended_at', null).order('assigned_at', { ascending: true });
      if (asg.error) throw asg.error;
      var ids = (asg.data || []).map(function (a) { return a.tasker_user_id; });
      var byId = {};
      if (ids.length) {
        var pr = await sb.from('local_tasker_profiles').select('tasker_user_id, full_name, areas_served, skills, status').in('tasker_user_id', ids);
        if (pr.error) throw pr.error;
        (pr.data || []).forEach(function (p) { byId[p.tasker_user_id] = p; });
      }
      rows = ids.map(function (id) {
        var p = byId[id] || {};
        return {
          id: id, name: p.full_name || 'Local Tasker', status: p.status || 'unknown',
          skills: Array.isArray(p.skills) ? p.skills.filter(Boolean).join(', ') : '',
          areas: p.areas_served || ''
        };
      });
      drawSidebar(); drawSwitcher();
      paintHeader(rows.filter(function (r) { return r.id === taskerId; })[0]);
      var cap = $('coSideCap'), plan = await C.plan();
      if (cap && plan) { cap.textContent = ids.length + '/' + plan.capacity; cap.hidden = false; }
    } catch (e) {
      console.error('[coordinator tasker roster]', e);
      rosterFailed = true; drawSidebar();
    }
  }

  /* ── Counts: open bookings for this Local Tasker, unread messages per Local Tasker ── */
  function isOpenForMe(r) {
    return (r.open === true && r.lt_status !== 'needs_reassignment') || r.frozen === true || r.booking_status === 'disputed';
  }
  function setCount(id, n) {
    var b = $(id); if (!b) return;
    b.hidden = !(n > 0);
    if (n > 0) b.textContent = n > 98 ? '99+' : String(n);
  }

  /* The two lists are read once and shared with the tab panels (window.STCoTasker), so a tab never repeats a call the frame already made.
     Pass true to read again (the Try again buttons). A list that cannot be read resolves to null, never to a guess. */
  var listCache = {};
  function safe(p) { return Promise.resolve(p).then(function (r) { return r && !r.error && Array.isArray(r.data) ? r.data : null; }, function () { return null; }); }
  function readList(key, rpcName, args, again) {
    if (again || !listCache[key]) listCache[key] = safe(window.supabase.rpc(rpcName, args));
    return listCache[key];
  }
  window.STCoTasker = {
    id: taskerId,
    bookings: function (again) { return readList('bookings', 'local_booking_list', { p_limit: 200 }, again); },
    chats: function (again) { return readList('chats', 'coordinator_chat_list', { p_limit: 100 }, again); },
    isOpenForMe: isOpenForMe
  };

  async function loadCounts() {
    var out = await Promise.all([window.STCoTasker.bookings(), window.STCoTasker.chats()]);
    var bookings = out[0], chats = out[1];
    var taskerOf = {};
    if (bookings) {
      bookings.forEach(function (r) { taskerOf[r.booking_id] = r.tasker_user_id; });
      setCount('coCountBookings', bookings.filter(function (r) { return r.tasker_user_id === taskerId && isOpenForMe(r); }).length);
    }
    if (chats) {
      var total = 0;
      unreadBy = {};
      chats.forEach(function (r) {
        if (!r || r.access !== 'coordinator' || !(r.unread > 0)) return;
        total += r.unread;
        var t = taskerOf[r.booking_id];
        if (t) unreadBy[t] = (unreadBy[t] || 0) + r.unread;
      });
      var side = $('coSideUnread');
      if (side) { side.hidden = !(total > 0); if (total > 0) { side.textContent = total > 98 ? '99+' : String(total); side.setAttribute('aria-label', total + ' unread messages'); } }
      if (bookings) setCount('coCountMessages', unreadBy[taskerId] || 0);
      drawSidebar();
    }
  }

  /* ── Identity chip: the SERVER's answer, display only ─────── */
  async function loadVerifyChip() {
    var chip = $('coVerifyChip');
    if (!chip || !C.isUuid(taskerId) || typeof C.verifyView !== 'function') return;
    try {
      var res = await window.supabase.rpc('idv_local_status', { p_tasker: taskerId });
      if (res.error || !res.data || typeof res.data !== 'object') throw (res.error || new Error('unexpected reply'));
      var v = C.verifyView(res.data, taskerId);
      chip.className = 'co-vstatus co-vstatus--' + v.tone;
      chip.textContent = v.label === 'Verified' ? 'Identity verified' : 'Identity: ' + v.label;
      chip.hidden = false;
    } catch (e) {
      console.error('[coordinator tasker identity chip]', e && e.code);   /* no chip is the safe answer */
    }
  }

  document.addEventListener('coordinator:ready', function (e) {
    loadRoster(e.detail);
    if (C.isUuid(taskerId)) { loadCounts(); loadVerifyChip(); }
  });
  document.addEventListener('DOMContentLoaded', function () { initTabs(); wireSwitcher(); });
})();
