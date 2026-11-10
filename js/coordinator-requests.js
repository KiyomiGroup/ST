/* ============================================================
   StreetTasker — coordinator-requests.js (Stage C2)
   "Active Requests" panel on coordinator-dashboard.html.
   Real data only: one call, rpc local_booking_list (the database decides which
   bookings this coordinator may see). Read-only: every card links to the booking page.
   Each card holds two layouts (tablet and up, phone); CSS shows one. Fields the list does not return (location, hours, skill) are not shown.
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

  var ICON_CHECK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';
  var ICON_CAL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';

  /* One sentence for the phone card, built from real fields only. The customer name is bold. */
  function sentence(r) {
    var p = C.el('p', 'co-req-sentence');
    var who = r.customer_name, title = r.title || 'Booking';
    function add(text) { p.appendChild(document.createTextNode(text)); }
    function bold(text) { p.appendChild(C.el('strong', null, text)); }
    if (r._kind === 'new') { add('New booking request'); if (who) { add(' from '); bold(who); } add(' for ' + title + '.'); }
    else if (r._kind === 'quote') { add('Quote for ' + title); if (who) { add(' from '); bold(who); } add('.'); }
    else if (r._kind === 'active') { add('Active job'); if (who) { add(' for '); bold(who); } add(': ' + title + '.'); }
    else { add('Problem reported'); if (who) { add(' by '); bold(who); } add(': ' + title + '.'); }
    return p;
  }

  function cta(r, k, withAmount, withIcon, mint) {
    var amt = B.naira(r.amount);
    var a = C.el('a', 'btn ' + (mint && r._kind !== 'issue' ? 'btn-mint' : 'btn-primary'));
    if (withIcon) { var ic = C.el('span', 'co-req-btn-icon'); ic.innerHTML = ICON_CHECK; a.appendChild(ic); }   /* fixed icon markup, no user data */
    a.appendChild(document.createTextNode(k.cta + (withAmount && amt ? ' (' + amt + ')' : '')));
    a.href = 'coordinator-booking.html?id=' + encodeURIComponent(r.booking_id);
    a.setAttribute('aria-label', k.cta + ': ' + (r.title || 'Booking'));
    return a;
  }

  /* Wide screens (tablet and up): chip + time, amount, title, customer / assigned, ref and date, one button. */
  function deskCard(r, k) {
    var box = C.el('div', 'co-req-desk');
    var top = C.el('div', 'co-req-top');
    var left = C.el('div', 'co-req-tags');
    left.appendChild(C.el('span', k.cls, k.chip));
    var when = ago(r.created_at);
    if (when) left.appendChild(C.el('span', 'co-req-when', '\u2022 ' + when));
    top.appendChild(left);
    var amt = B.naira(r.amount);
    if (amt) top.appendChild(C.el('span', 'co-req-amount', amt));
    box.appendChild(top);

    box.appendChild(C.el('h3', 'co-req-title', r.title || 'Booking'));
    if (r.customer_name || r.tasker_name) {
      var meta = C.el('p', 'co-req-meta');
      if (r.customer_name) { meta.appendChild(document.createTextNode('Customer: ')); meta.appendChild(C.el('strong', null, r.customer_name)); }
      if (r.customer_name && r.tasker_name) meta.appendChild(document.createTextNode(' \u2022 '));
      if (r.tasker_name) { meta.appendChild(document.createTextNode('Assigned: ')); meta.appendChild(C.el('strong', 'co-req-assigned', r.tasker_name)); }
      box.appendChild(meta);
    }

    var foot = C.el('div', 'co-req-foot');
    var sub = C.el('p', 'co-req-sub');
    var ic = C.el('span', 'co-req-sub-icon'); ic.innerHTML = ICON_CAL; sub.appendChild(ic);   /* fixed icon markup */
    var parts = [B.ref(r.booking_id)];
    if (B.whenText(r)) parts.push(B.whenText(r));
    sub.appendChild(document.createTextNode(parts.join(' \u2022 ')));
    foot.appendChild(sub);
    foot.appendChild(cta(r, k, false, false, false));
    box.appendChild(foot);
    return box;
  }

  /* Phones: Local Tasker avatar and name, amount, one sentence, one full-width button with the amount in it. */
  function phoneCard(r, k) {
    var box = C.el('div', 'co-req-phone');
    var head = C.el('div', 'co-req-phead');
    head.appendChild(C.el('span', 'co-tasker-avatar co-req-avatar', C.initialsOf(r.tasker_name, 'LT')));
    var who = C.el('div', 'co-req-pwho');
    who.appendChild(C.el('p', 'co-req-pname', r.tasker_name || 'Local Tasker'));
    var sub = [k.chip]; var when = ago(r.created_at); if (when) sub.push(when);
    who.appendChild(C.el('p', 'co-req-psub', sub.join(' \u2022 ')));
    head.appendChild(who);
    var amt = B.naira(r.amount);
    if (amt) head.appendChild(C.el('span', 'co-req-amount', amt));
    box.appendChild(head);
    box.appendChild(sentence(r));
    var btn = cta(r, k, true, true, true); btn.className += ' btn-full co-req-pbtn';
    box.appendChild(btn);
    return box;
  }

  function card(r) {
    var k = KIND[r._kind];
    var li = C.el('li', 'co-req-item' + (r._kind === 'issue' ? ' is-issue' : ''));
    li.appendChild(deskCard(r, k));
    li.appendChild(phoneCard(r, k));
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
