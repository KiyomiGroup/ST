/* ============================================================
   STREETTASKER — messages-dock.js   (Job Room, docked "what do I do now?" panel)
   ONE panel, always visible right above the message box (not hidden in the top bar), that
   walks the normal job in order:

     Tasker   from the start: a box to propose a price
              customer paid: notice to ask for the customer's location and time
              customer paid: the release-code box ("ask the customer for it once the job is done")
     Customer the tasker's price: Accept / Decline, then Pay
              customer paid: the release code, with the note to give it only after the job is done
              customer paid: a Share location button (one tap, sends the pin in the chat)

   Public API (window.JRDock), called by messages-flow.js on every refresh:
     JRDock.update(v, p)   v = job state, p = plan (both from messages-flow.js)  ->  true when the dock is showing
   This file never writes money or status itself. It only shows the right box and calls the server functions
   that already exist (price_propose, JRMoney.pay, ST.payments.submitCompletionCode, JRThread.shareLocation).
   No inline styles, no raw colours: classes live in css/messages.css.
   ============================================================ */
'use strict';

(function () {

  var S = { sig: '', priceOpen: false, thread: '', busy: false };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function naira(n) { return window.JRMoney ? window.JRMoney.naira(n) : '₦' + Number(n || 0).toLocaleString(); }
  function toast(m, t) { if (window.JRThread && window.JRThread.toast) window.JRThread.toast(m, t); }

  /* "Got it" on the location notice is remembered per chat in this browser (nothing is saved on the server) */
  function noticeKey(v) { return 'st.dock.loc.' + (v.thread && v.thread.id); }
  function noticeDone(v) { try { return window.localStorage.getItem(noticeKey(v)) === '1'; } catch (_e) { return false; } }
  function noticeDismiss(v) { try { window.localStorage.setItem(noticeKey(v), '1'); } catch (_e) { /* private mode: it just shows again */ } }

  function card(tone, title, text) {
    var c = el('section', 'jr-dock-card' + (tone ? ' jr-dock-card--' + tone : ''));
    c.appendChild(el('div', 'jr-dock-title', title));
    if (text) c.appendChild(el('div', 'jr-dock-text', text));
    return c;
  }
  function actions(card_) { var r = el('div', 'jr-dock-actions'); card_.appendChild(r); return r; }
  function flowBtn(def, primary) { return window.JRFlow.button(def, primary ? 'jr-flow-btn--primary' : ''); }
  function plainBtn(label, primary, fn) {
    var b = el('button', 'jr-flow-btn' + (primary ? ' jr-flow-btn--primary' : ''), label); b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  }

  /* ── tasker: propose a price ─────────────────────────────── */
  function priceCard(v, intro) {
    var c = card('', 'Propose your price', intro || 'Set one price for the whole job. The customer accepts it, then pays. Transport, materials and extra costs are asked for separately.');
    var row = el('div', 'jr-dock-form');
    var amount = el('input', 'jr-dock-input');
    amount.type = 'number'; amount.inputMode = 'numeric'; amount.min = '0'; amount.step = '100'; amount.placeholder = 'Price in ₦, e.g. 15000';
    amount.setAttribute('aria-label', 'Proposed price in naira');
    var send = el('button', 'jr-flow-btn jr-flow-btn--primary', 'Send price'); send.type = 'button';
    row.appendChild(amount); row.appendChild(send);
    c.appendChild(row);
    var note = el('input', 'jr-dock-input jr-dock-input--text');
    note.type = 'text'; note.maxLength = 300; note.placeholder = 'What the price covers (optional)';
    note.setAttribute('aria-label', 'What the price covers (optional)');
    c.appendChild(note);
    var err = el('div', 'jr-wp-error'); err.hidden = true; err.setAttribute('role', 'alert');
    c.appendChild(err);
    if (S.priceOpen && v.sm.base > 0) {
      var cancel = plainBtn('Keep the current price', false, function () { S.priceOpen = false; window.JRFlow.repaint(); });
      actions(c).appendChild(cancel);
    }

    function fail(m) { err.textContent = m; err.hidden = false; }
    send.addEventListener('click', async function () {
      err.hidden = true;
      var J = window.JRMoney, a = Math.round(Number(amount.value) || 0), text = note.value.trim();
      if (!a || (J && a < J.MIN_AMOUNT)) return fail('Enter a price of at least ' + naira(J ? J.MIN_AMOUNT : 100) + '.');
      if (J && a > J.MAX_AMOUNT) return fail('That amount is too large. Check for a typing mistake.');
      if (text && window.JRThread.hasContactInfo(text)) {
        var cur = window.JRRoom && window.JRRoom.current();
        if (typeof window.handleContactViolation === 'function' && cur && cur.user) window.handleContactViolation(cur.user.id);
        return fail('Please remove phone numbers, emails or other contact details. They are not allowed on StreetTasker.');
      }
      send.disabled = true; send.textContent = 'Sending…';
      try {
        var r = await window.supabase.rpc('price_propose', { p_thread: v.thread.id, p_amount: a, p_note: text || null });
        if (r.error) throw r.error;
        S.priceOpen = false;
        if (window.JRThread.reload) { try { await window.JRThread.reload(); } catch (_e) {} }
        if (window.JRRoom) window.JRRoom.refresh();
        window.JRFlow.repaint();
      } catch (e) {
        fail((e && e.message) || 'Could not send the price. Please try again.');
        send.disabled = false; send.textContent = 'Send price';
      }
    });
    return c;
  }

  /* ── paid: code + location ───────────────────────────────── */
  function customerPaid(host, v, p) {
    var loc = card('', window.JRThread.locationShared() ? 'Location shared' : 'Tell the tasker where and when',
      window.JRThread.locationShared()
        ? 'The tasker has your location. Use the chat to agree the time.'
        : 'Share your location so the tasker can find you, then agree the time to come in the chat.');
    var la = actions(loc);
    var share = plainBtn(window.JRThread.locationShared() ? 'Share location again' : 'Share location', !window.JRThread.locationShared(), function () {
      if (S.busy) return;
      S.busy = true; share.disabled = true; share.textContent = 'Getting your location…';
      Promise.resolve(window.JRThread.shareLocation()).catch(function () {})
        .then(function () { S.busy = false; window.JRFlow.repaint(); });
    });
    la.appendChild(share);
    host.appendChild(loc);

    var code = card('code', 'Your release code', 'The payment of ' + naira(v.sm.paid) + ' is held safely. Only give this code to the tasker AFTER the job is done and you are happy with it.');
    code.appendChild(window.JRFlow.codeNode(v.bookingId));
    host.appendChild(code);
  }

  function taskerPaid(host, v, p) {
    if (!window.JRThread.locationShared() && !noticeDone(v)) {
      var n = card('notice', 'The customer has paid', 'Now ask the customer for the job location and the time you should come. You can say so in the chat. They have a Share location button.');
      var na = actions(n);
      na.appendChild(plainBtn('Ask in the chat', true, function () {
        Promise.resolve(window.JRThread.send('I have seen your payment. Please share your location and tell me what time you want me to come.'));
      }));
      na.appendChild(plainBtn('Got it', false, function () { noticeDismiss(v); window.JRFlow.repaint(); }));
      host.appendChild(n);
    } else if (window.JRThread.locationShared()) {
      host.appendChild(card('', 'Location received', 'The customer shared their location in the chat. Agree the time with them there.'));
    }
    var c = el('section', 'jr-dock-card jr-dock-card--code');
    if (window.JRWork && window.JRWork.codeEntry) window.JRWork.codeEntry(c, v);
    host.appendChild(c);
  }

  /* ── build ───────────────────────────────────────────────── */
  function build(host, v, p) {
    var customer = v.role === 'customer';

    if (v.status === 'awaiting_confirmation') {
      if (customer) {
        var rc = card('notice', p ? p.title : 'Work submitted', 'The tasker says the job is done. Check the work. When you are happy, get your release code.');
        actions(rc).appendChild(plainBtn('Review work', true, function () { window.JRFlow.openBar(); }));
        host.appendChild(rc);
      } else {
        var tc = el('section', 'jr-dock-card jr-dock-card--code');
        if (window.JRWork && window.JRWork.codeEntry) window.JRWork.codeEntry(tc, v);
        host.appendChild(tc);
      }
      return true;
    }

    if (v.paid) {
      if (customer) customerPaid(host, v, p); else taskerPaid(host, v, p);
      return true;
    }

    if (v.processing) { host.appendChild(card('', 'Confirming payment', 'This can take a moment. You do not need to pay again.')); return true; }

    var d = v.decision;
    if (d && d.kind === 'price_proposal') {
      var dc = card('', customer ? 'Price proposed: ' + naira(d.amount) : 'Waiting for the customer', d.mine
        ? 'You proposed ' + naira(d.amount) + '. They can accept or decline.'
        : 'The tasker proposed ' + naira(d.amount) + (d.note ? '. ' + d.note : '.') + ' Accept it, then pay.');
      if (!d.mine) {
        var da = actions(dc);
        da.appendChild(flowBtn({ label: 'Accept ' + naira(d.amount), decide: { id: d.id, accept: true } }, true));
        da.appendChild(flowBtn({ label: 'Decline', decide: { id: d.id, accept: false } }, false));
      }
      host.appendChild(dc);
      return true;
    }

    if (v.waiting) {
      var amt = Number(v.waiting.amount) || 0;
      if (customer) {
        var pc = card('', 'Pay ' + naira(amt), 'This is the price for the job. It is held safely until the work is done. Want a different price? Say so in the chat.');
        actions(pc).appendChild(flowBtn({ label: 'Pay ' + naira(amt), pay: v.waiting.id }, true));
        host.appendChild(pc);
      } else if (S.priceOpen) {
        host.appendChild(priceCard(v, 'The customer has not paid yet. A new price cancels the old payment request.'));
      } else {
        var wc = card('', 'Waiting for the customer to pay ' + naira(amt), 'You will be told as soon as it is paid.');
        actions(wc).appendChild(plainBtn('Change price', false, function () { S.priceOpen = true; window.JRFlow.repaint(); }));
        host.appendChild(wc);
      }
      return true;
    }

    if (v.sm.base > 0) {
      if (customer) { host.appendChild(card('', 'Price: ' + naira(v.sm.base), 'Waiting for the tasker to confirm this price and send the payment request.')); return true; }
      if (S.priceOpen) { host.appendChild(priceCard(v)); return true; }
      var ac = card('', 'Customer price: ' + naira(v.sm.base), 'Agree and the customer is asked to pay straight away, or suggest another price.');
      var aa = actions(ac);
      aa.appendChild(flowBtn({ label: 'Agree ' + naira(v.sm.base) + ' and request payment', agree: v.sm.base }, true));
      aa.appendChild(plainBtn('Change price', false, function () { S.priceOpen = true; window.JRFlow.repaint(); }));
      host.appendChild(ac);
      return true;
    }

    /* nothing agreed yet */
    if (customer) {
      if (p && p.title) { host.appendChild(card('', p.title, p.text)); return true; }
      return false;
    }
    host.appendChild(priceCard(v));
    return true;
  }

  function update(v, p) {
    var host = $('jrDock');
    if (!host) return false;
    if (!v || !window.JRFlow || !window.JRThread) { host.hidden = true; host.textContent = ''; S.sig = ''; return false; }
    var th = v.thread && v.thread.id;
    if (th !== S.thread) { S.thread = th; S.priceOpen = false; S.sig = ''; }

    var closed = (p && p.closed) || v.status === 'cancelled' || v.status === 'completed' || v.status === 'disputed' || window.JRThread.isClosed();
    if (closed) { host.hidden = true; host.textContent = ''; S.sig = ''; return false; }

    /* only redraw when something that changes the dock changed, so a typed price is never wiped by a refresh */
    var d = v.decision;
    var sig = [th, v.role, v.status, v.paid, v.processing, d ? d.id + d.mine : '', v.waiting ? v.waiting.id + v.waiting.status : '',
               v.sm.base, v.sm.paid, S.priceOpen, S.busy, window.JRThread.locationShared(), v.thread && noticeDone(v)].join('|');
    if (sig === S.sig && !host.hidden) return true;
    S.sig = sig;

    host.textContent = '';
    var shown = build(host, v, p);
    host.hidden = !shown;
    return shown;
  }

  window.JRDock = { update: update };
})();
