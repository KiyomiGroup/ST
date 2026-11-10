/* ============================================================
   StreetTasker — coordinator-tasker-card.js
   One booking card, used by the Local Tasker page in two places: the Bookings tab (coordinator-tasker-bookings.js)
   and "Open bookings" on the Overview tab (coordinator-tasker-overview.js).
   Reading order, top to bottom: what state it is in, how much it is worth, what the job is, who it is for,
   when, what to do next, one button.
   Real fields only (rpc local_booking_list): title, customer name, amount, scheduled time, payment status, created time, next step.
   Location, scope and customer photos are not in that list, so they are not shown (the phone card shows the customer's initials).
   Two layouts in one item (tablet and up, phone); CSS shows one. Renders with textContent only (names are user-entered data).
   Needs: coordinator-common.js (STCo) and coordinator-bookings-common.js (STCoBk), loaded first.
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo, B = window.STCoBk;

  function svg(inner, size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }
  var ICON = {   /* fixed icon markup, no user data */
    cal:   '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    next:  '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    job:   '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>',
    lock:  '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'
  };
  function icon(cls, name, size) { var s = C.el('span', cls); s.innerHTML = svg(ICON[name], size || 18); return s; }

  function ago(iso) {
    var t = new Date(iso).getTime();
    if (!iso || isNaN(t)) return '';
    var m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (m < 1) return 'Requested just now';
    if (m < 60) return 'Requested ' + m + ' min ago';
    var h = Math.round(m / 60);
    if (h < 24) return 'Requested ' + h + (h === 1 ? ' hr ago' : ' hrs ago');
    var d = Math.round(h / 24);
    return 'Requested ' + d + (d === 1 ? ' day ago' : ' days ago');
  }

  function facts(r, next) {
    var issue = r.frozen === true || r.booking_status === 'disputed';
    var paid = r.payment_status === 'paid' || r.payment_status === 'released';
    return {
      issue: issue,
      paid: paid,
      status: issue ? 'Problem reported' : (r.open === false ? B.bookingLabel(r.booking_status) : B.ltLabel(r.lt_status)),
      pay: B.payLabel(r.payment_status),
      amount: B.naira(r.amount),
      when: B.whenText(r),
      title: r.title || 'Booking',
      who: r.customer_name || '',
      act: next.tab === 'action',
      cta: next.tab === 'action' ? 'Open and act' : (issue ? 'View problem' : 'Open booking')
    };
  }

  function button(r, f, full) {
    var a = C.el('a', 'btn co-tc-btn ' + (f.act || f.issue ? 'btn-primary' : 'btn-mint') + (full ? ' btn-full' : ''));
    if (full) a.appendChild(icon('co-tc-btn-icon', 'next', 18));
    a.appendChild(document.createTextNode(f.cta));
    a.href = 'coordinator-booking.html?id=' + encodeURIComponent(r.booking_id);
    a.setAttribute('aria-label', f.cta + ': ' + f.title);
    return a;
  }

  /* Tablet and up: state chips and price on top, then job, customer, a strip with date and next step, then a footer with the button. */
  function desk(r, next, f) {
    var box = C.el('div', 'co-tc-desk');
    var top = C.el('div', 'co-tc-top'), tags = C.el('div', 'co-tc-tags');
    tags.appendChild(C.el('span', 'co-tc-chip' + (f.issue ? ' is-issue' : ''), f.status));
    var pay = C.el('span', 'co-tc-pay' + (f.paid ? ' is-paid' : '')); pay.appendChild(C.el('span', 'co-tc-dot')); pay.appendChild(document.createTextNode(f.pay));
    tags.appendChild(pay);
    top.appendChild(tags);
    if (f.amount) { var pr = C.el('div', 'co-tc-price'); pr.appendChild(C.el('span', 'co-tc-amount', f.amount)); pr.appendChild(C.el('span', 'co-tc-cap', 'Booking price')); top.appendChild(pr); }
    box.appendChild(top);

    box.appendChild(C.el('h3', 'co-tc-title', f.title));
    var meta = C.el('p', 'co-tc-meta');
    if (f.who) { meta.appendChild(document.createTextNode('Customer: ')); meta.appendChild(C.el('strong', null, f.who)); meta.appendChild(document.createTextNode(' \u2022 ')); }
    meta.appendChild(document.createTextNode(B.ref(r.booking_id)));
    box.appendChild(meta);

    var strip = C.el('div', 'co-tc-strip');
    var s1 = C.el('span', 'co-tc-chunk'); s1.appendChild(icon('co-tc-ico', 'cal', 16)); s1.appendChild(document.createTextNode('Schedule: ')); s1.appendChild(C.el('strong', null, f.when || 'Not set yet')); strip.appendChild(s1);
    var s2 = C.el('span', 'co-tc-chunk'); s2.appendChild(icon('co-tc-ico', 'next', 16)); s2.appendChild(document.createTextNode('Next: ')); s2.appendChild(C.el('strong', f.act ? 'is-action' : null, next.text)); strip.appendChild(s2);
    box.appendChild(strip);

    var foot = C.el('div', 'co-tc-foot');
    foot.appendChild(C.el('p', 'co-tc-ago', ago(r.created_at)));
    foot.appendChild(button(r, f, false));
    box.appendChild(foot);
    return box;
  }

  /* Phones: customer initials, name and reference, price and payment, a strip with job and time, the next step, one full-width button. */
  function phone(r, next, f) {
    var box = C.el('div', 'co-tc-phone');
    var head = C.el('div', 'co-tc-phead');
    head.appendChild(C.el('span', 'co-tasker-avatar co-tc-avatar', C.initialsOf(f.who, 'CU')));
    var who = C.el('div', 'co-tc-pwho');
    who.appendChild(C.el('p', 'co-tc-pname', f.who || 'Customer'));
    who.appendChild(C.el('p', 'co-tc-psub', B.ref(r.booking_id)));   /* the state is in the next-step line below */
    head.appendChild(who);
    var right = C.el('div', 'co-tc-pright');
    if (f.amount) right.appendChild(C.el('span', 'co-tc-amount', f.amount));
    var pay = C.el('span', 'co-tc-ppay' + (f.paid ? ' is-paid' : ''));
    if (f.paid) pay.appendChild(icon('co-tc-ico', 'lock', 16));
    pay.appendChild(document.createTextNode(f.pay));
    right.appendChild(pay);
    head.appendChild(right);
    box.appendChild(head);

    var strip = C.el('div', 'co-tc-strip');
    var s1 = C.el('span', 'co-tc-chunk co-tc-chunk--job'); s1.appendChild(icon('co-tc-ico', 'job', 18)); s1.appendChild(C.el('strong', null, f.title)); strip.appendChild(s1);
    var s2 = C.el('span', 'co-tc-chunk'); s2.appendChild(icon('co-tc-ico', 'clock', 18)); s2.appendChild(document.createTextNode(f.when || 'Date not set')); strip.appendChild(s2);
    box.appendChild(strip);
    box.appendChild(C.el('p', 'co-tc-next' + (f.act ? ' is-action' : ''), next.text));
    box.appendChild(button(r, f, true));
    return box;
  }

  /* r: a row from local_booking_list; next: B.nextAction(r). Returns an <li>. */
  function build(r, next) {
    var f = facts(r, next);
    var li = C.el('li', 'co-tc' + (f.issue ? ' is-issue' : ''));
    li.appendChild(desk(r, next, f));
    li.appendChild(phone(r, next, f));
    return li;
  }

  window.STCoTCard = { build: build };
})();
