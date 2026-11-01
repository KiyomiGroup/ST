/* ============================================================
   STREETTASKER — bank-reminder.js
   "Add your bank account" reminder for taskers (withdrawals, CR-1, stage W6f).

   A page adds ONE hidden mount where the reminder should sit:
     <div data-bank-reminder="profile" hidden></div>   tasker profile page
     <div data-bank-reminder="booked" hidden></div>    tasker bookings page
   plus css/bank-reminder.css and this file. Nothing else.

   The reminder is a standard .st-notice (styles.css) with two buttons:
     "Add bank account"  -> wallet.html#bank-details (js/wallet-data.js opens the sheet)
     "Not now"           -> hides it for this browser session (sessionStorage, one key per kind)

   It shows ONLY when all of these are true (checked in this order, stops at the first "no"):
     1. not dismissed in this session
     2. someone is signed in and ST.auth.getUserRole() says 'tasker'
     3. kind "booked" only: the tasker has at least one booking that is not pending or cancelled
     4. the tasker has NO live saved bank account (withdrawal_bank_accounts, removed_at is null)
   Any error or unclear answer means "do not show": a reminder must never nag on a guess. That
   also means nothing shows before the W2a table exists in the database.

   The read is the same safe one as ST.payments.listBankAccounts: RLS returns only the signed-in
   user's own rows and the select names the one column `id` (never the number or recipient code).
   No money, escrow, payment or wallet code is used or changed here.
   Exposes window.ST.bankReminder.refresh() (re-checks every mount on the page).
   ============================================================ */
(function () {
  'use strict';

  var LINK = 'wallet.html#bank-details';
  var OFF_PREFIX = 'st_bank_reminder_off_';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  var COPY = {
    profile: {
      tone: 'info',
      title: 'Add a bank account to get paid',
      body: 'Save the account you want your earnings sent to. It takes about a minute, and you can finish your profile first.'
    },
    booked: {
      tone: 'warning',
      title: 'You have a booking. Add your bank account',
      body: 'Earnings from finished jobs go to your wallet. To withdraw them to your bank, save your bank account first.'
    }
  };

  var memOff = {}; /* used when sessionStorage is blocked: the dismissal then lasts until the page reloads */

  /* ── dismissal (this browser session only) ───────────────── */
  function isOff(kind) {
    if (memOff[kind]) return true;
    try { return sessionStorage.getItem(OFF_PREFIX + kind) === '1'; } catch (e) { return false; }
  }
  function setOff(kind) {
    memOff[kind] = true;
    try { sessionStorage.setItem(OFF_PREFIX + kind, '1'); } catch (e) { /* blocked: memOff still hides it on this page */ }
  }

  /* ── the checks (true only on a clear answer) ────────────── */
  async function hasBooking(sb, uid) {
    var r = await sb.from('bookings').select('id').eq('tasker_id', uid).not('status', 'in', '(pending,cancelled)').limit(1);
    return !r.error && Array.isArray(r.data) && r.data.length > 0;
  }
  async function hasNoAccount(sb) {
    var r = await sb.from('withdrawal_bank_accounts').select('id').is('removed_at', null).limit(1);
    return !r.error && Array.isArray(r.data) && r.data.length === 0;
  }
  async function shouldShow(kind) {
    var sb = window.supabase;
    if (!sb || !sb.auth || typeof sb.from !== 'function') return false;
    var s = await sb.auth.getSession();
    var user = s && s.data && s.data.session && s.data.session.user;
    if (!user) return false;
    var auth = window.ST && window.ST.auth;
    if (!auth || typeof auth.getUserRole !== 'function') return false;
    if ((await auth.getUserRole(user)) !== 'tasker') return false;
    if (kind === 'booked' && !(await hasBooking(sb, user.id))) return false;
    return hasNoAccount(sb);
  }

  /* ── building the notice (DOM calls only, fixed text) ────── */
  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }
  function walletIcon() {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    ['M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5', 'M16 13h2'].forEach(function (d) {
      var p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    el.hidden = true;
  }

  /* The next control after the reminder, so keyboard focus is not lost when the reminder is removed */
  function nextFocusable(from) {
    var all = document.querySelectorAll(FOCUSABLE);
    for (var i = 0; i < all.length; i++) {
      var n = all[i];
      if (from.contains(n)) continue;
      if (!(from.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      if (!n.getClientRects().length) continue;
      return n;
    }
    return null;
  }

  function dismiss(el, kind, section) {
    var next = nextFocusable(section);
    setOff(kind);
    clear(el);
    if (next) next.focus();
  }

  function render(el, kind, copy) {
    if (el.firstChild) { el.hidden = false; return; } /* already showing */
    var section = h('section', 'st-notice st-bank-reminder st-notice--' + copy.tone);
    section.setAttribute('aria-label', 'Bank account reminder');

    var icon = h('span', 'st-notice-icon');
    icon.appendChild(walletIcon());

    var main = h('div', 'st-notice-main');
    var head = h('div', 'st-notice-head');
    head.appendChild(h('p', 'st-notice-title', copy.title));
    var actions = h('div', 'st-notice-actions');
    var go = h('a', 'btn btn-tone btn-sm', 'Add bank account');
    go.setAttribute('href', LINK);
    var later = h('button', 'btn btn-outline btn-sm', 'Not now');
    later.setAttribute('type', 'button'); /* never "submit": the profile page wraps its form around nearby controls */
    later.addEventListener('click', function () { dismiss(el, kind, section); });
    actions.appendChild(go);
    actions.appendChild(later);

    main.appendChild(head);
    main.appendChild(h('p', 'st-notice-body', copy.body));
    main.appendChild(actions);
    section.appendChild(icon);
    section.appendChild(main);
    el.appendChild(section);
    el.hidden = false;
  }

  /* ── one mount: decide, then show or clear ───────────────── */
  function sync(el) {
    var kind = el.getAttribute('data-bank-reminder');
    var copy = COPY[kind];
    if (!copy) return Promise.resolve();
    var run = el._bankReminderRun = (el._bankReminderRun || 0) + 1;
    if (isOff(kind)) { clear(el); return Promise.resolve(); }
    return shouldShow(kind).then(function (show) {
      if (run !== el._bankReminderRun) return; /* a newer check started: ignore this answer */
      if (show && !isOff(kind)) render(el, kind, copy); else clear(el);
    }, function () {
      if (run === el._bankReminderRun) clear(el);
    });
  }

  function refresh() {
    var mounts = document.querySelectorAll('[data-bank-reminder]');
    var all = [];
    for (var i = 0; i < mounts.length; i++) all.push(sync(mounts[i]));
    return Promise.all(all);
  }

  window.ST = window.ST || {};
  window.ST.bankReminder = { refresh: refresh };

  /* Back / forward from the wallet page can restore this page from memory: re-check, because an account may have been saved */
  window.addEventListener('pageshow', function (e) { if (e.persisted) refresh(); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh); else refresh();
})();
