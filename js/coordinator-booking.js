/* ============================================================
   StreetTasker — coordinator-booking.js (Stage 5B, 5C-1, 5C-2)
   One booking, read-only. One call: rpc local_booking_detail(booking id from ?id=).
   A booking that is not the signed-in coordinator's comes back as "not_found"
   from the database and is shown as "Booking not found" (same for a bad id).
   Never shows a release code (the function does not return one). Runs on `coordinator:ready`.
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo, B = window.STCoBk;
  function $(id) { return document.getElementById(id); }
  var last = null;

  function fact(dl, label, value, opts) {
    var dt = C.el('dt', 'co-fact-label', label);
    var dd = C.el('dd', 'co-fact-value');
    var has = value != null && String(value).trim() !== '';
    if (has && opts && opts.tel) {
      var tel = String(value).replace(/[^0-9+]/g, '');
      var a = C.el('a', 'co-fact-link', String(value)); a.href = 'tel:' + tel; dd.appendChild(a);
    } else if (has && opts && opts.href) {
      var l = C.el('a', 'co-fact-link', String(value)); l.href = opts.href; dd.appendChild(l);
    } else {
      dd.textContent = has ? String(value) : ((opts && opts.empty) || 'Not provided');
      if (!has) dd.className += ' is-empty';
    }
    dl.appendChild(dt); dl.appendChild(dd);
  }

  function show(which) {
    $('coBdLoading').hidden = which !== 'loading';
    $('coBdError').hidden = which !== 'error';
    $('coBdMissing').hidden = which !== 'missing';
    $('coBd').hidden = which !== 'ok';
  }

  function render(d) {
    var task = d.task || {}, svc = d.service || {};
    var title = task.title || svc.service_name || (d.notes ? String(d.notes).slice(0, 60) : '') || 'Booking';
    var next = B.nextAction(d);

    $('coBdRef').textContent = 'Booking ' + B.ref(d.booking_id);
    $('coBdTitle').textContent = title;
    $('coBdSub').textContent = 'Created ' + B.dateTime(d.created_at);
    var st = $('coBdStatus'); st.textContent = '';
    st.appendChild(C.el('span', 'co-status co-status--other', d.frozen ? 'Problem reported' : B.ltLabel(d.lt_status)));
    $('coBdNext').textContent = next.text;
    $('coBdNext').className = 'co-bk-next' + (next.tab === 'action' ? ' is-action' : '');
    $('coBdNextNote').textContent = (window.STCoConfirm && window.STCoConfirm.noteFor(d)) || '';

    var job = $('coBdJob'); job.textContent = '';
    fact(job, 'Job', title);
    fact(job, 'Details', task.description || d.notes, { empty: 'No details given' });
    fact(job, 'Place', task.location || svc.location);
    fact(job, 'Category', task.category || svc.category);
    fact(job, 'When', B.whenText(d), { empty: 'Not set yet' });
    fact(job, 'Booking status', B.bookingLabel(d.booking_status));

    var cu = $('coBdCust'); cu.textContent = '';
    fact(cu, 'Name', d.customer_name);
    fact(cu, 'Phone', d.customer_phone, { tel: true, empty: d.open ? 'Not on file' : 'Hidden once a booking is closed' });
    $('coBdCustNote').textContent = 'Only for the bookings you coordinate. Customer contact details are shown while a booking is open.';

    var ta = $('coBdTasker'); ta.textContent = '';
    fact(ta, 'Name', d.tasker_name);
    if (C.isUuid(d.tasker_user_id)) fact(ta, 'Profile', 'Open profile', { href: 'coordinator-tasker.html?id=' + encodeURIComponent(d.tasker_user_id) });
    fact(ta, 'Step', B.ltLabel(d.lt_status));

    var pay = $('coBdPay'); pay.textContent = '';
    fact(pay, 'Status', B.payLabel(d.payment_status));
    fact(pay, 'Amount', B.naira(d.amount), { empty: 'Not set yet' });

    var h = $('coBdHist'); h.textContent = '';
    var ev = Array.isArray(d.events) ? d.events : [];
    $('coBdHistEmpty').hidden = !!ev.length;
    ev.forEach(function (e) {
      var li = C.el('li', 'co-bk-event');
      li.appendChild(C.el('span', 'co-bk-event-text', B.eventText(e)));
      li.appendChild(C.el('span', 'co-consent-meta', B.dateTime(e.created_at) + (e.actor_role ? ' · ' + e.actor_role : '')));
      if (e.note) li.appendChild(C.el('span', 'co-bk-event-note', e.note));
      h.appendChild(li);
    });
    if (window.STCoConfirm) window.STCoConfirm.mount(d, { reload: function () { return load(); } });
    if (window.STCoQuote) window.STCoQuote.mount(d, { reload: function () { return load(); } });
    if (window.STCoMilestones) window.STCoMilestones.mount(d, { reload: function () { return load(); } });
    show('ok');
    document.title = 'Booking ' + B.ref(d.booking_id) + ' — StreetTasker Coordinator';
  }

  async function load() {
    var id = new URLSearchParams(window.location.search).get('id');
    if (!C.isUuid(id)) { show('missing'); return; }
    show('loading');
    try {
      var res = await window.supabase.rpc('local_booking_detail', { p_booking: id });
      if (res.error) {
        if (res.error.hint === 'not_found' || /not found/i.test(res.error.message || '')) { show('missing'); return; }
        throw res.error;
      }
      if (!res.data) { show('missing'); return; }
      render(res.data);
    } catch (e) {
      console.error('[coordinator booking]', e);
      show('error');
    }
  }

  document.addEventListener('coordinator:ready', function (e) { last = e.detail; load(); });
  document.addEventListener('DOMContentLoaded', function () {
    $('coBdRetry').addEventListener('click', function () { if (last) load(); });
  });
})();
