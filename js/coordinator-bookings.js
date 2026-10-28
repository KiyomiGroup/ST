/* ============================================================
   StreetTasker — coordinator-bookings.js (Stage 5B)
   Booking list for the coordinator, in tabs by next action. Read-only: one call,
   rpc local_booking_list (the database decides which bookings the coordinator
   may see). No buttons that change anything. Runs on `coordinator:ready`.
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo, B = window.STCoBk;
  function $(id) { return document.getElementById(id); }

  var rows = [];
  var tab = 'action';
  var query = '';
  var last = null;
  var tabChosen = false;

  function counts() {
    var c = { action: 0, waiting: 0, problem: 0, closed: 0 };
    rows.forEach(function (r) { c[r._next.tab] += 1; });
    return c;
  }

  function buildTabs() {
    var wrap = $('coBkTabs'); wrap.textContent = '';
    var c = counts();
    B.TABS.forEach(function (t) {
      var b = C.el('button', 'co-filter' + (t.id === tab ? ' is-active' : ''), t.label + ' (' + c[t.id] + ')');
      b.type = 'button'; b.setAttribute('data-co-tab', t.id); b.setAttribute('aria-pressed', t.id === tab ? 'true' : 'false');
      b.addEventListener('click', function () { tab = t.id; tabChosen = true; buildTabs(); render(); });
      wrap.appendChild(b);
    });
  }

  function haystack(r) {
    return [r.title, r.customer_name, r.tasker_name, B.ref(r.booking_id)].join(' ').toLowerCase();
  }

  function card(r) {
    var li = C.el('li', 'co-bk-item');
    var a = C.el('a', 'co-bk-link');
    a.href = 'coordinator-booking.html?id=' + encodeURIComponent(r.booking_id);
    a.setAttribute('aria-label', (r.title || 'Booking') + ', ' + B.ltLabel(r.lt_status));

    var top = C.el('div', 'co-bk-top');
    top.appendChild(C.el('span', 'co-bk-ref', B.ref(r.booking_id)));
    top.appendChild(C.el('span', 'co-status co-status--other', r.frozen ? 'Problem reported' : B.ltLabel(r.lt_status)));
    a.appendChild(top);
    a.appendChild(C.el('h2', 'co-bk-title', r.title || 'Booking'));

    var meta = [];
    if (r.tasker_name) meta.push('Local Tasker: ' + r.tasker_name);
    if (r.customer_name) meta.push('Customer: ' + r.customer_name);
    if (B.whenText(r)) meta.push(B.whenText(r));
    if (B.naira(r.amount)) meta.push(B.naira(r.amount));
    a.appendChild(C.el('p', 'co-bk-meta', meta.join(' · ')));
    a.appendChild(C.el('p', 'co-bk-next' + (r._next.tab === 'action' ? ' is-action' : ''), r._next.text));
    li.appendChild(a);
    return li;
  }

  function render() {
    var list = $('coBkList'), empty = $('coBkEmpty'), nomatch = $('coBkNoMatch'), tools = $('coBkToolbar');
    list.textContent = '';
    empty.hidden = true; nomatch.hidden = true;
    if (!rows.length) { list.hidden = true; tools.hidden = true; empty.hidden = false; return; }
    tools.hidden = false;
    var q = query.trim().toLowerCase();
    var shown = rows.filter(function (r) {
      if (q) return haystack(r).indexOf(q) > -1;   /* a search looks across every tab */
      return r._next.tab === tab;
    });
    shown.forEach(function (r) { list.appendChild(card(r)); });
    list.hidden = !shown.length;
    if (!shown.length) {
      nomatch.hidden = false;
      $('coBkNoMatchTitle').textContent = q ? 'No match' : 'Nothing here';
      $('coBkNoMatchText').textContent = q ? 'None of your bookings match that search.' : 'No bookings in this group right now.';
    }
  }

  function summary() {
    var c = counts();
    $('coBkSummary').textContent = c.action
      ? c.action + (c.action === 1 ? ' booking needs' : ' bookings need') + ' your action.'
      : 'Nothing needs your action right now.';
  }

  async function load() {
    $('coBkLoading').hidden = false; $('coBkList').hidden = true; $('coBkToolbar').hidden = true;
    $('coBkEmpty').hidden = true; $('coBkNoMatch').hidden = true; $('coBkError').hidden = true;
    try {
      var res = await window.supabase.rpc('local_booking_list', { p_limit: 200 });
      if (res.error) throw res.error;
      rows = (Array.isArray(res.data) ? res.data : []).map(function (r) { r._next = B.nextAction(r); return r; });
      $('coBkLoading').hidden = true;
      if (!tabChosen) {
        var c = counts();
        tab = c.action ? 'action' : (c.waiting ? 'waiting' : (c.problem ? 'problem' : (c.closed ? 'closed' : 'action')));
      }
      buildTabs(); summary(); render();
    } catch (e) {
      console.error('[coordinator bookings]', e);
      $('coBkLoading').hidden = true; $('coBkError').hidden = false;
    }
  }

  document.addEventListener('coordinator:ready', function (e) { last = e.detail; load(); });
  document.addEventListener('DOMContentLoaded', function () {
    $('coBkRetry').addEventListener('click', function () { if (last) load(); });
    $('coBkSearch').addEventListener('input', function () { query = this.value; render(); });
  });
})();
