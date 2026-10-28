/* ============================================================
   StreetTasker — coordinator-bookings-common.js (Stage 5B)
   Pure helpers for the coordinator booking list and detail: labels, the tab a
   booking belongs in, and the ONE next required action. No data access.
   Input is a row from rpc local_booking_list / local_booking_detail.
   ============================================================ */
'use strict';

(function () {
  var LT_LABEL = {
    needs_reassignment: 'Needs a coordinator',
    assigned: 'New booking',
    awaiting_tasker_confirmation: 'Waiting for the Local Tasker',
    tasker_confirmed: 'Local Tasker confirmed',
    tasker_declined: 'Local Tasker declined',
    quote_sent: 'Quote sent',
    quote_approved: 'Quote approved',
    quote_declined: 'Quote declined'
  };
  var BOOKING_LABEL = {
    pending: 'Requested', confirmed: 'Confirmed', awaiting_confirmation: 'Awaiting customer confirmation',
    completed: 'Completed', cancelled: 'Cancelled', rejected: 'Rejected', declined: 'Declined', disputed: 'Problem reported'
  };
  var PAY_LABEL = { unpaid: 'Not paid yet', pending: 'Payment pending', paid: 'Paid and held safely', released: 'Paid out', refunded: 'Refunded' };
  var TABS = [
    { id: 'action', label: 'Needs action' },
    { id: 'waiting', label: 'Waiting' },
    { id: 'problem', label: 'Problems' },
    { id: 'closed', label: 'Closed' }
  ];
  var EVENT_LABEL = {
    assigned: 'Booking assigned to you',
    needs_reassignment: 'No coordinator available; waiting for an administrator',
    reassigned: 'Booking moved to a coordinator',
    status_changed: 'Step recorded',
    confirmation_recorded: 'Local Tasker’s answer recorded',
    confirmation_superseded: 'An earlier answer is no longer current',
    second_check_passed: 'Administrator call-back: passed',
    second_check_failed: 'Administrator call-back: failed'
  };

  function sentence(s) { var t = String(s || '').replace(/_/g, ' '); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; }
  function ltLabel(s) { return LT_LABEL[s] || sentence(s) || 'Unknown'; }
  function bookingLabel(s) { return BOOKING_LABEL[s] || sentence(s) || 'Unknown'; }
  function payLabel(s) { return PAY_LABEL[s] || (s ? sentence(s) : 'Not paid yet'); }
  function isUnpaid(p) { return !p || p === 'unpaid' || p === 'pending'; }

  /* Returns { tab, text }. tab is one of action | waiting | problem | closed. */
  function nextAction(r) {
    if (!r.open && r.booking_status !== 'disputed') {
      return { tab: 'closed', text: 'This booking is ' + bookingLabel(r.booking_status).toLowerCase() + '. Nothing more to do.' };
    }
    if (r.frozen || r.booking_status === 'disputed') {
      return { tab: 'problem', text: 'A problem report is open. A StreetTasker administrator is handling it. Nothing needed from you.' };
    }
    switch (r.lt_status) {
      case 'needs_reassignment': return { tab: 'waiting', text: 'Waiting for an administrator to give this Local Tasker a coordinator.' };
      case 'assigned': return { tab: 'action', text: 'Contact the Local Tasker and ask whether they can do this job.' };
      case 'awaiting_tasker_confirmation': return { tab: 'action', text: 'Record the Local Tasker’s answer once you have it.' };
      case 'tasker_confirmed': return { tab: 'action', text: 'Prepare the itemised quote for the customer.' };
      case 'tasker_declined': return { tab: 'action', text: 'The Local Tasker declined. Let the customer know and agree what happens next.' };
      case 'quote_sent': return { tab: 'waiting', text: 'Waiting for the customer to approve the quote.' };
      case 'quote_declined': return { tab: 'action', text: 'The customer declined the quote. Revise it or check with the Local Tasker.' };
      case 'quote_approved':
        return isUnpaid(r.payment_status)
          ? { tab: 'waiting', text: 'Waiting for the customer to pay. Payments are handled by StreetTasker.' }
          : { tab: 'waiting', text: 'The job is under way. Nothing needed from you now.' };
      default: return { tab: 'waiting', text: 'No action needed right now.' };
    }
  }

  function naira(n) {
    var v = Number(n);
    if (n == null || n === '' || !isFinite(v)) return '';
    return '₦' + v.toLocaleString('en-NG', { maximumFractionDigits: 2 });
  }
  function whenText(r) {
    return r.scheduled_time ? String(r.scheduled_time) : '';
  }
  function dateTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function eventText(e) {
    if (e.kind === 'status_changed') {
      return (e.from_status ? ltLabel(e.from_status) + ' → ' : '') + ltLabel(e.to_status);
    }
    return EVENT_LABEL[e.kind] || sentence(e.kind);
  }
  function ref(id) { return '#' + String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase(); }

  window.STCoBk = {
    TABS: TABS, ltLabel: ltLabel, bookingLabel: bookingLabel, payLabel: payLabel, nextAction: nextAction,
    naira: naira, whenText: whenText, dateTime: dateTime, eventText: eventText, ref: ref
  };
})();
