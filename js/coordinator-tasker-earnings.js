/* ============================================================
   StreetTasker — coordinator-tasker-earnings.js (Stage T5)
   The Earnings tab on coordinator-tasker.html: what this Local Tasker has been paid, what is on the way, and YOUR commission on
   each job. Read-only. Data: rpc local_tasker_earnings (sql/coordinator-flow/t5-tasker-earnings.sql). Job title and customer
   come from the booking list the page frame already read (window.STCoTasker.bookings); if that list cannot be read the rows
   still show, with the booking reference only.
   Loads the first time the tab is opened. Renders with textContent only. If the earnings cannot be read: an error with
   Try again, never "no earnings yet".
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo, B = window.STCoBk;
  var taskerId = new URLSearchParams(window.location.search).get('id');
  var rows = [], totals = null, info = {}, filter = 'all';
  var ready = false, opened = false, started = false, seq = 0;

  var FILTERS = [
    { id: 'all', label: 'All', test: function () { return true; } },
    { id: 'paid', label: 'Paid out', test: function (r) { return r.phase === 'paid'; } },
    { id: 'way', label: 'On the way', test: function (r) { return r.phase === 'waiting' || r.phase === 'due' || r.phase === 'processing'; } },
    { id: 'attn', label: 'Needs attention', test: function (r) { return r.phase === 'review' || r.phase === 'failed'; } }
  ];

  function $(id) { return document.getElementById(id); }
  function money(n) { return B.naira(n) || '\u20A60'; }

  function phaseLabel(r) {
    return ({ waiting: 'Payout on the way', due: 'Payout on the way', processing: 'Payout on the way', paid: 'Paid out',
      review: 'Needs attention', failed: 'Payout failed', reversed: 'Reversed' })[r.phase] || 'Payout';
  }
  function phaseNote(r) {
    if (r.phase === 'paid') return r.paid_at ? 'Paid to the Local Tasker on ' + B.dateTime(r.paid_at) + '.' : 'Paid to the Local Tasker.';
    if (r.phase === 'waiting') return r.release_after ? 'The payout is sent after ' + B.dateTime(r.release_after) + '.' : 'The payout is waiting for its 24 hours to pass.';
    if (r.phase === 'due' || r.phase === 'processing') return 'The payout is being sent now.';
    if (r.phase === 'review') return r.status_reason === 'no_verified_account' ? 'No verified payout account yet, so the payout is on hold.' : 'This payout is on hold.';
    if (r.phase === 'failed') return 'This payout did not go through.';
    if (r.phase === 'reversed') return 'This payout was reversed.';
    return '';
  }
  function commText(r) {
    if (r.comm_phase === 'credited') return money(r.comm_amount) + ' (in your wallet)';
    if (r.comm_phase === 'pending') return money(r.comm_amount) + ' (on the way)';
    return '\u2014';
  }

  function setTile(key, value, note) {
    var v = document.querySelector('[data-er="' + key + '"]'), n = document.querySelector('[data-er="' + key + '-note"]');
    if (v) v.textContent = value;
    if (n && note != null) n.textContent = note;
  }

  function tiles() {
    var t = totals || {};
    setTile('paid', money(t.paid), 'Sent to the Local Tasker');
    setTile('way', money(t.on_the_way), 'Waiting out the 24 hours or being sent');
    setTile('comm', money(t.comm_credited), 'Added to your wallet');
    setTile('commway', money(t.comm_pending), 'Added 24 hours after the release code');
  }

  function buildFilters() {
    var wrap = $('coTeTabs'); wrap.textContent = '';
    FILTERS.forEach(function (f) {
      var n = rows.filter(f.test).length;
      var b = C.el('button', 'co-filter' + (f.id === filter ? ' is-active' : ''), f.label + ' (' + n + ')');
      b.type = 'button'; b.setAttribute('aria-pressed', f.id === filter ? 'true' : 'false');
      b.addEventListener('click', function () { filter = f.id; buildFilters(); render(); });
      wrap.appendChild(b);
    });
  }

  function amount(label, value) {
    var d = C.el('div', 'co-er-amt');
    d.appendChild(C.el('dt', 'co-er-amt-label', label));
    d.appendChild(C.el('dd', 'co-er-amt-value', value));
    return d;
  }

  function card(r) {
    var li = C.el('li', 'co-bk-item'), a = C.el('a', 'co-bk-link');
    a.href = 'coordinator-booking.html?id=' + encodeURIComponent(r.booking_id);
    var j = info[r.booking_id] || {};
    a.setAttribute('aria-label', (j.title || 'Booking') + ', ' + phaseLabel(r));
    var top = C.el('div', 'co-bk-top');
    top.appendChild(C.el('span', 'co-bk-ref', B.ref(r.booking_id)));
    top.appendChild(C.el('span', 'co-status ' + (r.phase === 'paid' ? 'co-status--published' : (r.phase === 'review' || r.phase === 'failed' || r.phase === 'reversed') ? 'co-status--inactive' : 'co-status--other'), phaseLabel(r)));
    a.appendChild(top);
    a.appendChild(C.el('h2', 'co-bk-title', j.title || 'Booking'));
    if (j.customer_name) a.appendChild(C.el('p', 'co-bk-meta', 'Customer: ' + j.customer_name));
    var dl = C.el('dl', 'co-er-amounts');
    dl.appendChild(amount('Job value', money(r.base_amount)));
    dl.appendChild(amount('Fees taken', money(r.fee_total)));
    dl.appendChild(amount('Local Tasker gets', money(r.net_amount)));
    dl.appendChild(amount('Your commission', commText(r)));
    a.appendChild(dl);
    var note = phaseNote(r); if (note) a.appendChild(C.el('p', 'co-bk-next', note));
    li.appendChild(a);
    return li;
  }

  function render() {
    var list = $('coTeList'), empty = $('coTeEmpty'), nomatch = $('coTeNoMatch'), tools = $('coTeToolbar');
    list.textContent = ''; empty.hidden = true; nomatch.hidden = true;
    if (!rows.length) { list.hidden = true; tools.hidden = true; empty.hidden = false; return; }
    tools.hidden = false;
    var f = FILTERS.filter(function (x) { return x.id === filter; })[0];
    var shown = rows.filter(f.test);
    shown.forEach(function (r) { list.appendChild(card(r)); });
    list.hidden = !shown.length; nomatch.hidden = !!shown.length;
  }

  function summary() {
    var t = totals || {};
    var capped = Number(t.count) > rows.length;
    $('coTeSummary').textContent = rows.length
      ? 'Payouts and your commission on this Local Tasker\u2019s released jobs.' + (capped ? ' Showing the newest ' + rows.length + ' of ' + t.count + '; the totals above count all of them.' : '')
      : 'Payouts and your commission on this Local Tasker\u2019s released jobs.';
    var att = $('coTeAttn');
    if (Number(t.needs_attention) > 0) { att.textContent = money(t.needs_attention) + ' of payouts needs attention. Open the job to see why.'; att.hidden = false; }
    else att.hidden = true;
  }

  async function load() {
    var mark = ++seq;
    $('coTeLoading').hidden = false; $('coTeList').hidden = true; $('coTeToolbar').hidden = true;
    $('coTeEmpty').hidden = true; $('coTeNoMatch').hidden = true; $('coTeError').hidden = true; $('coTeAttn').hidden = true;
    var res, bookings;
    try {
      var out = await Promise.all([
        window.supabase.rpc('local_tasker_earnings', { p_tasker: taskerId, p_limit: 200 }),
        window.STCoTasker.bookings(true)
      ]);
      res = out[0]; bookings = out[1];
    } catch (e) { res = { error: e }; }
    if (mark !== seq) return;
    $('coTeLoading').hidden = true;
    if (!res || res.error || !res.data || !Array.isArray(res.data.rows)) { $('coTeError').hidden = false; return; }
    rows = res.data.rows; totals = res.data.totals || {};
    info = {};
    (bookings || []).forEach(function (b) { if (b && b.booking_id) info[b.booking_id] = { title: b.title, customer_name: b.customer_name }; });
    tiles(); summary(); buildFilters(); render();
  }

  function maybeStart() {
    if (started || !ready || !opened || !C.isUuid(taskerId) || !window.STCoTasker) return;
    started = true; load();
  }

  document.addEventListener('coordinator:ready', function () { ready = true; maybeStart(); });
  document.addEventListener('coordinator-tasker:tab', function (e) { if (e.detail && e.detail.tab === 'earnings') { opened = true; maybeStart(); } });
  document.addEventListener('DOMContentLoaded', function () {
    $('coTeRetry').addEventListener('click', function () { if (started) load(); });
  });
})();
