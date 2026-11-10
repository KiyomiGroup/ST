/* ============================================================
   StreetTasker — coordinator-tasker-bookings.js (Stage T3)
   The Bookings tab on coordinator-tasker.html: this Local Tasker's bookings, in the same groups as coordinator-bookings.html
   (Needs action / Waiting / Problems / Closed), search across all groups, each card opens coordinator-booking.html?id=.
   Read-only. Uses the list the page frame already read (window.STCoTasker.bookings()), so no extra call.
   Loads the first time the tab is opened. Renders with textContent only (names are user-entered data).
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo, B = window.STCoBk;
  var taskerId = new URLSearchParams(window.location.search).get('id');
  var rows = [], tab = 'action', tabChosen = false, query = '';
  var ready = false, opened = false, started = false, seq = 0;

  function $(id) { return document.getElementById(id); }
  function counts() {
    var c = { action: 0, waiting: 0, problem: 0, closed: 0 };
    rows.forEach(function (r) { c[r._next.tab] += 1; });
    return c;
  }

  function buildTabs() {
    var wrap = $('coTbTabs'); wrap.textContent = '';
    var c = counts();
    B.TABS.forEach(function (t) {
      var b = C.el('button', 'co-filter' + (t.id === tab ? ' is-active' : ''), t.label + ' (' + c[t.id] + ')');
      b.type = 'button'; b.setAttribute('aria-pressed', t.id === tab ? 'true' : 'false');
      b.addEventListener('click', function () { tab = t.id; tabChosen = true; buildTabs(); render(); });
      wrap.appendChild(b);
    });
  }

  function haystack(r) { return [r.title, r.customer_name, B.ref(r.booking_id)].join(' ').toLowerCase(); }

  function card(r) {
    var li = C.el('li', 'co-bk-item'), a = C.el('a', 'co-bk-link');
    a.href = 'coordinator-booking.html?id=' + encodeURIComponent(r.booking_id);
    a.setAttribute('aria-label', (r.title || 'Booking') + ', ' + B.ltLabel(r.lt_status));
    var top = C.el('div', 'co-bk-top');
    top.appendChild(C.el('span', 'co-bk-ref', B.ref(r.booking_id)));
    top.appendChild(C.el('span', 'co-status co-status--other', r.frozen ? 'Problem reported' : B.ltLabel(r.lt_status)));
    a.appendChild(top);
    a.appendChild(C.el('h2', 'co-bk-title', r.title || 'Booking'));
    var meta = [];
    if (r.customer_name) meta.push('Customer: ' + r.customer_name);
    if (B.whenText(r)) meta.push(B.whenText(r));
    if (B.naira(r.amount)) meta.push(B.naira(r.amount));
    if (meta.length) a.appendChild(C.el('p', 'co-bk-meta', meta.join(' \u00B7 ')));
    a.appendChild(C.el('p', 'co-bk-next' + (r._next.tab === 'action' ? ' is-action' : ''), r._next.text));
    li.appendChild(a);
    return li;
  }

  function render() {
    var list = $('coTbList'), empty = $('coTbEmpty'), nomatch = $('coTbNoMatch'), tools = $('coTbToolbar');
    list.textContent = ''; empty.hidden = true; nomatch.hidden = true;
    if (!rows.length) { list.hidden = true; tools.hidden = true; empty.hidden = false; return; }
    tools.hidden = false;
    var q = query.trim().toLowerCase();
    var shown = rows.filter(function (r) { return q ? haystack(r).indexOf(q) > -1 : r._next.tab === tab; });   /* a search looks across every group */
    shown.forEach(function (r) { list.appendChild(card(r)); });
    list.hidden = !shown.length;
    if (!shown.length) {
      nomatch.hidden = false;
      $('coTbNoMatchTitle').textContent = q ? 'No match' : 'Nothing here';
      $('coTbNoMatchText').textContent = q ? 'None of these bookings match that search.' : 'No bookings in this group right now.';
    }
  }

  function summary() {
    var c = counts();
    $('coTbSummary').textContent = c.action
      ? c.action + (c.action === 1 ? ' booking needs' : ' bookings need') + ' your action.'
      : 'Nothing needs your action right now.';
  }

  async function load(again) {
    var mark = ++seq;
    $('coTbLoading').hidden = false; $('coTbList').hidden = true; $('coTbToolbar').hidden = true;
    $('coTbEmpty').hidden = true; $('coTbNoMatch').hidden = true; $('coTbError').hidden = true;
    var all = await window.STCoTasker.bookings(again);
    if (mark !== seq) return;
    $('coTbLoading').hidden = true;
    if (!all) { $('coTbError').hidden = false; return; }
    rows = all.filter(function (r) { return r && r.tasker_user_id === taskerId; }).map(function (r) { r._next = B.nextAction(r); return r; });
    if (!tabChosen) {
      var c = counts();
      tab = c.action ? 'action' : (c.waiting ? 'waiting' : (c.problem ? 'problem' : (c.closed ? 'closed' : 'action')));
    }
    buildTabs(); summary(); render();
  }

  function maybeStart() {
    if (started || !ready || !opened || !C.isUuid(taskerId) || !window.STCoTasker) return;
    started = true; load(false);
  }

  document.addEventListener('coordinator:ready', function () { ready = true; maybeStart(); });
  document.addEventListener('coordinator-tasker:tab', function (e) { if (e.detail && e.detail.tab === 'bookings') { opened = true; maybeStart(); } });
  document.addEventListener('DOMContentLoaded', function () {
    $('coTbRetry').addEventListener('click', function () { if (started) load(true); });
    $('coTbSearch').addEventListener('input', function () { query = this.value; if (started) render(); });
  });
})();
