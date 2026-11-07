/* ============================================================
   StreetTasker — coordinator-dock.js   (coordinator chat, docked "what do I do now?" panel)
   The same idea as the Job Room dock (js/messages-dock.js), for the coordinator who speaks for a Local Tasker.
   One panel, always visible right above the message box, that follows the job in order:

     Start                phone the Local Tasker and record their answer          > opens that form
     Local Tasker yes     send the price (the quote) to the customer               > opens the quote form
     Quote sent / approved  waiting notices
     Customer has paid    the release-code box: "ask the customer for the code once the job is done"

   Data: only S.detail (local_booking_detail) and the open conversation, both already loaded by coordinator-chat.js, plus the
   database function that already powers the Release the payment card:
     local_booking_code_state(p_booking)            { state, remaining }
     local_booking_submit_code(p_booking, p_code)   the ONE release path. A wrong code comes back as a result, not an error.
   This file never touches money tables. The typed code is cleared after every send and is never stored.
   Everything from the database is set with textContent. No inline styles; classes live in css/messages.css.
   Public API (window.STCoDock): update()  - called by coordinator-chat.js whenever the bars are redrawn.
   ============================================================ */
'use strict';

(function () {
  var S = { sig: '', code: null, codeFor: '', loading: false, busy: false };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { return window.STCo.el(tag, cls, text); }
  function chat() { return window.STCoChat; }

  function card(tone, title, text) {
    var c = el('section', 'jr-dock-card' + (tone ? ' jr-dock-card--' + tone : ''));
    c.appendChild(el('div', 'jr-dock-title', title));
    if (text) c.appendChild(el('div', 'jr-dock-text', text));
    return c;
  }
  function actions(c) { var r = el('div', 'jr-dock-actions'); c.appendChild(r); return r; }
  function btn(label, primary, fn) {
    var b = el('button', 'jr-flow-btn' + (primary ? ' jr-flow-btn--primary' : ''), label); b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  }
  function open(pane) { if (chat()) chat().openActions(pane); }

  /* ── release code state (read only) ──────────────────────── */
  function loadCode(d) {
    if (S.loading) return;
    S.loading = true;
    window.supabase.rpc('local_booking_code_state', { p_booking: d.booking_id }).then(function (r) {
      S.code = r.error ? { state: 'unavailable' } : (r.data || { state: 'unavailable' });
      S.codeFor = d.booking_id;
    }).catch(function () { S.code = { state: 'unavailable' }; S.codeFor = d.booking_id; })
      .then(function () { S.loading = false; S.sig = ''; update(); });
  }

  var CODE_TEXT = {
    locked: 'This booking is locked because three wrong codes were entered. Contact StreetTasker support.',
    frozen: 'A problem report is open, so the payment can’t be released now.',
    consent_revoked: 'This Local Tasker has withdrawn their consent. Contact StreetTasker support.'
  };
  var REASON_TEXT = {
    not_paid: 'Payment has not been made for this booking yet.',
    already_released: 'The payment has already been released.',
    already_completed: 'This booking is already completed.',
    frozen: 'A problem report is open on this booking, so the payment can’t be released now.',
    locked: 'Too many incorrect codes. Contact StreetTasker support.',
    consent_revoked: 'This Local Tasker has withdrawn consent. Contact StreetTasker support.'
  };

  function codeCard(d) {
    var st = S.codeFor === d.booking_id && S.code ? S.code.state : '';
    var c = card('code', 'Enter the release code', '');
    if (!st) { loadCode(d); c.appendChild(el('div', 'jr-dock-text', 'Checking…')); return c; }
    if (st === 'unavailable') {
      c.appendChild(el('div', 'jr-dock-text', 'When the job is done, ask the customer for their release code and enter it in the Release the payment form.'));
      actions(c).appendChild(btn('Release the payment', true, function () { open('coRl'); }));
      return c;
    }
    if (st !== 'ready') {
      c.appendChild(el('div', 'jr-dock-text', CODE_TEXT[st] || 'Nothing to enter right now.'));
      return c;
    }
    c.appendChild(el('div', 'jr-dock-text', 'When the job is done and the customer is happy, ask them for their 6-digit release code and enter it here. This releases the payment to the Local Tasker.'));
    var form = el('div', 'jr-wp-form');
    var input = el('input', 'jr-code-input');
    input.type = 'text'; input.inputMode = 'numeric'; input.maxLength = 6; input.autocomplete = 'one-time-code';
    input.placeholder = '000000'; input.setAttribute('aria-label', '6-digit release code');
    input.addEventListener('input', function () { var v = input.value.replace(/[^0-9]/g, '').slice(0, 6); if (v !== input.value) input.value = v; });
    var go = el('button', 'jr-wp-btn jr-wp-btn--primary', 'Release payment'); go.type = 'button';
    var err = el('div', 'jr-wp-error'); err.hidden = true; err.setAttribute('role', 'alert');
    function fail(m) { err.textContent = m; err.hidden = false; }
    go.addEventListener('click', async function () {
      err.hidden = true;
      var code = input.value.replace(/\s+/g, '');
      if (!/^[0-9]{6}$/.test(code)) { fail('Enter the 6 digits of the code. Nothing was sent.'); return; }   /* a typo never uses up an attempt */
      go.disabled = true; go.textContent = 'Checking…';
      var res = null, e = null;
      try { res = await window.supabase.rpc('local_booking_submit_code', { p_booking: d.booking_id, p_code: code }); if (res.error) e = res.error; }
      catch (ex) { e = ex || { message: 'network' }; }
      code = null; input.value = '';                      /* the typed code never stays on the page */
      go.disabled = false; go.textContent = 'Release payment';
      if (e) {
        S.codeFor = ''; S.sig = '';
        fail('We couldn’t confirm that. Check the Release the payment form for the real state before you try again. Nothing was entered twice.');
        return;
      }
      var out = res.data || {};
      if (out.ok === true) { S.codeFor = ''; if (chat()) { chat().toast('Payment released.', false); chat().reloadDetail(); } return; }
      if (out.reason === 'wrong_code') {
        var left = typeof out.remaining === 'number' ? out.remaining : 0;
        S.code = { state: left > 0 ? 'ready' : 'locked', remaining: left }; S.codeFor = d.booking_id;
        fail(left <= 0 ? 'Incorrect code. No attempts are left. Contact StreetTasker support.' : 'Incorrect code. ' + left + (left === 1 ? ' attempt left.' : ' attempts left.'));
        if (left <= 0) { S.sig = ''; update(); }
        return;
      }
      S.codeFor = ''; S.sig = '';
      fail(REASON_TEXT[out.reason] || 'The payment could not be released. Nothing was changed.');
    });
    form.appendChild(input); form.appendChild(go);
    c.appendChild(form); c.appendChild(err);
    var left = S.code && typeof S.code.remaining === 'number' ? S.code.remaining : 3;
    if (left < 3) c.appendChild(el('div', 'jr-dock-text', left === 1 ? 'Last attempt. Check the digits with the customer before you try again.' : left + ' attempts left.'));
    return c;
  }

  /* ── build ───────────────────────────────────────────────── */
  function build(host, d) {
    var paid = d.payment_status === 'paid';

    if (paid) {
      host.appendChild(codeCard(d));
      return true;
    }

    switch (d.lt_status) {
      case 'assigned':
      case 'awaiting_tasker_confirmation': {
        var a = card('', 'Contact the Local Tasker', 'Phone them and ask whether they can do this job, and at what price. Then record their answer.');
        actions(a).appendChild(btn('Record their answer', true, function () { open('coCf'); }));
        host.appendChild(a); return true;
      }
      case 'tasker_confirmed':
      case 'quote_declined': {
        var q = card('', d.lt_status === 'quote_declined' ? 'The customer declined the quote' : 'Send the price to the customer',
          d.lt_status === 'quote_declined' ? 'Revise the price or check with the Local Tasker, then send the quote again.' : 'List what the customer is paying for. They approve the quote, then pay.');
        actions(q).appendChild(btn(d.lt_status === 'quote_declined' ? 'Revise the quote' : 'Send the quote', true, function () { open('coQt'); }));
        host.appendChild(q); return true;
      }
      case 'tasker_declined':
        host.appendChild(card('', 'The Local Tasker declined', 'Let the customer know in the chat and agree what happens next.')); return true;
      case 'quote_sent': {
        var s = card('', 'Quote sent', 'Waiting for the customer to approve it.');
        actions(s).appendChild(btn('Change the quote', false, function () { open('coQt'); }));
        host.appendChild(s); return true;
      }
      case 'quote_approved':
        host.appendChild(card('', 'Waiting for the customer to pay', 'You will see it here as soon as it is paid. Payments are handled by StreetTasker.')); return true;
      default: return false;
    }
  }

  function update() {
    var host = $('ccDock');
    if (!host) return;
    var c = chat(), st = c && c.state(), d = st && st.detail;
    var can = !!(c && c.canWrite() && d && d.booking_id && d.booking_id === st.activeId);
    if (!can || (!d.open && d.booking_status !== 'disputed') || d.frozen || d.booking_status === 'disputed') { host.hidden = true; host.textContent = ''; S.sig = ''; return; }

    var sig = [d.booking_id, d.lt_status, d.payment_status, d.open, S.codeFor === d.booking_id && S.code ? S.code.state + S.code.remaining : ''].join('|');
    if (sig === S.sig && !host.hidden) return;
    S.sig = sig;
    host.textContent = '';
    host.hidden = !build(host, d);
  }

  window.STCoDock = { update: update };
})();
