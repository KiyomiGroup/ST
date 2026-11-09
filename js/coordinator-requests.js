/* ============================================================
   StreetTasker — coordinator-requests.js (Stage C2)
   "Active Requests" panel on coordinator-dashboard.html.
   Real data only: one call, rpc local_booking_list (the database decides which
   bookings this coordinator may see). Read-only: every card links to the booking page.
   Uses STCoBk (coordinator-bookings-common.js) for labels, amounts and refs.
   Renders with textContent only (names are user-entered data).
   Runs on `coordinator:ready` (after the route guard passed).
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo, B = window.STCoBk;
  var MAX_SHOWN = 5;
  var TABS = [
    { id: 'all', label: 'All' },
    { id: 'new', label: 'New' },
    { id: 'quote', label: 'Quotes' },
    { id: 'active', label: 'Active' },
    { id: 'issue', label: 'Issues' }
  ];
  var KIND = {
    new:    { chip: 'New booking',   cls: 'co-status co-status--published', cta: 'Review booking' },
    quote:  { chip: 'Quote',         cls: 'co-status co-req-chip--quote',   cta: 'Manage quote' },
    active: { chip: 'Active job',    cls: 'co-status',                      cta: 'Open job' },
    issue:  { chip: 'Problem reported', cls: 'co-status co-status--inactive', cta: 'View problem' }
  };

  var rows = [], tab = 'all', last = null;
  function $(id) { return document.getElementById(id); }

  /* Which group a booking belongs to. Closed bookings are not "active requests". */
  function kindOf(r) {
    if (r.frozen || r.booking_status === 'disputed') return 'issue';
    if (!r.open) return null;
    switch (r.lt_status) {
      case 'quote_approved': return 'active';
      case 'tasker_confirmed': case 'quote_sent': case 'quote_declined': return 'quote';
      case 'needs_reassignment': return null;   /* no coordinator yet: not this coordinator's request */
      default: return 'new';
    }
  }

  function ago(iso) {
    var t = new Date(iso).getTime();
    if (!iso || isNaN(t)) return '';
    var m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (m < 1) return 'Received just now';
    if (m < 60) return 'Received ' + m + 'm ago';
    var h = Math.round(m / 60);
    if (h < 24) return 'Received ' + h + 'h ago';
    var d = Math.round(h / 24);
    return 'Received ' + d + (d === 1 ? ' day ago' : ' days ago');
  }

  function counts() {
    var c = { all: 0, new: 0, quote: 0, active: 0, issue: 0 };
    rows.forEach(function (r) { c.all += 1; c[r._kind] += 1; });
    return c;
  }

  function buildTabs() {
    var wrap = $('coReqTabs'); wrap.textContent = '';
    var c = counts();
    TABS.forEach(function (t) {
      var b = C.el('button', 'co-req-tab' + (t.id === tab ? ' is-active' : '') + (t.id === 'issue' && c.issue ? ' is-alert' : ''), t.label + ' (' + c[t.id] + ')');
      b.type = 'button'; b.setAttribute('aria-pressed', t.id === tab ? 'true' : 'false');
      b.addEventListener('click', function () { tab = t.id; buildTabs(); render(); });
      wrap.appendChild(b);
    });
    wrap.hidden = false;
  }

  function card(r) {
    var k = KIND[r._kind];
    var li = C.el('li', 'co-req-item' + (r._kind === 'issue' ? ' is-issue' : ''));
    var top = C.el('div', 'co-req-top');
    var left = C.el('div', 'co-req-tags');
    left.appendChild(C.el('span', k.cls, k.chip));
    var when = ago(r.created_at);
    if (when) left.appendChild(C.el('span', 'co-req-when', when));
    top.appendChild(left);
    var amt = B.naira(r.amount);
    if (amt) top.appendChild(C.el('span', 'co-req-amount', amt));
    li.appendChild(top);

    li.appendChild(C.el('h3', 'co-req-title', r.title || 'Booking'));
    var meta = [];
    if (r.customer_name) meta.push('Customer: ' + r.customer_name);
    if (r.tasker_name) meta.push('Local Tasker: ' + r.tasker_name);
    if (meta.length) li.appendChild(C.el('p', 'co-req-meta', meta.join(' · ')));

    var foot = C.el('div', 'co-req-foot');
    var sub = [B.ref(r.booking_id)];
    if (B.whenText(r)) sub.push(B.whenText(r));
    foot.appendChild(C.el('p', 'co-req-sub', sub.join(' · ')));
    var a = C.el('a', 'btn btn-sm ' + (r._kind === 'issue' ? 'btn-primary' : 'btn-mint'), k.cta);
    a.href = 'coordinator-booking.html?id=' + encodeURIComponent(r.booking_id);
    a.setAttribute('aria-label', k.cta + ': ' + (r.title || 'Booking'));
    foot.appendChild(a);
    li.appendChild(foot);
    return li;
  }

  function render() {
    var list = $('coReqList'), empty = $('coReqEmpty');
    list.textContent = '';
    var shown = rows.filter(function (r) { return tab === 'all' || r._kind === tab; });
    var more = shown.length - MAX_SHOWN;
    shown.slice(0, MAX_SHOWN).forEach(function (r) { list.appendChild(card(r)); });
    list.hidden = !shown.length;
    empty.hidden = !!shown.length;
    if (!shown.length) {
      var none = !rows.length;
      $('coReqEmptyTitle').textContent = none ? 'No open requests' : 'Nothing in this group';
      $('coReqEmptyText').textContent = none
        ? 'When customers book your Local Taskers, their requests will be listed here.'
        : 'No open requests in this group right now.';
    } else if (more > 0) {
      var li = C.el('li', 'co-req-more');
      var a = C.el('a', 'co-fact-link', more + ' more in Bookings \u2192'); a.href = 'coordinator-bookings.html';
      li.appendChild(a); list.appendChild(li);
    }
  }

  function heroOrders() {
    var el = $('coHeroOrders'); if (!el) return;
    var n = rows.length;
    el.textContent = n ? ' ' + n + (n === 1 ? ' open booking' : ' open bookings') + ' right now.' : '';
  }

  async function load() {
    $('coReqLoading').hidden = false; $('coReqError').hidden = true;
    $('coReqList').hidden = true; $('coReqEmpty').hidden = true; $('coReqTabs').hidden = true;
    try {
      var res = await window.supabase.rpc('local_booking_list', { p_limit: 200 });
      if (res.error) throw res.error;
      rows = [];
      (Array.isArray(res.data) ? res.data : []).forEach(function (r) {
        var k = kindOf(r);
        if (k) { r._kind = k; rows.push(r); }
      });
      $('coReqLoading').hidden = true;
      buildTabs(); render(); heroOrders();
    } catch (e) {
      console.error('[coordinator requests]', e);
      $('coReqLoading').hidden = true; $('coReqError').hidden = false;
    }
  }

  document.addEventListener('coordinator:ready', function (e) { last = e.detail; load(); });
  document.addEventListener('DOMContentLoaded', function () {
    var retry = $('coReqRetry');
    if (retry) retry.addEventListener('click', function () { if (last) load(); });
  });
})();
