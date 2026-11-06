/* ============================================================
   STREETTASKER — review-prompt.js   (stage M7)
   The "Leave a review" dialog, shared by every page that can ask for one.
   It only calls review_state(p_booking) and submit_review(p_booking, p_rating, p_comment) (Reviews stage 2). The database decides
   who may review (the customer or the tasker of that booking), and only after the job is completed AND the payment is released.
   Local Tasker reviews of a customer are written by the coordinator (stage M6), never from here.
   Classes: css/review-prompt.css (.rv-*). No inline styles. Everything from the database is set with textContent.

   STReview.open({ bookingId, onDone })       open the dialog for one booking
   STReview.button(bookingId, cls)            HTML for a "Leave a review" button (cls = the page's own button classes)
   STReview.decorate(root)                    after a page draws its cards: buttons for jobs already reviewed turn into a "Reviewed" tag,
                                              buttons that cannot review (not a party, not completed) are removed
   STReview.promptFromUrl()                   opens the dialog when the address has ?review=<booking id> (the notification link)
   Any element with data-act="review" data-id="<booking id>" opens the dialog when clicked (document-level handler).
   ============================================================ */
(function () {
  'use strict';

  var COMMENT_MAX = 1000;
  var dlg = null, els = null, ctx = null, rating = 0, busy = false;
  var stateCache = {};

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function isUuid(s) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || '')); }
  function missing(err) { return !!err && (err.code === 'PGRST202' || err.code === '42883' || /could not find the function|does not exist/i.test(String(err.message || ''))); }

  async function getState(bookingId) {
    var res = await window.supabase.rpc('review_state', { p_booking: String(bookingId) });
    if (res.error) throw res.error;
    return res.data || {};
  }

  /* ── dialog ─────────────────────────────────────────────── */
  function build() {
    dlg = el('dialog', 'rv-dialog');
    dlg.setAttribute('aria-labelledby', 'rvTitle');
    var body = el('div', 'rv-body');
    var title = el('h2', 'rv-title', 'Leave a review'); title.id = 'rvTitle';
    var lead = el('p', 'rv-text');
    var msg = el('p', 'rv-text'); msg.setAttribute('role', 'status'); msg.hidden = true;

    var form = el('form', 'rv-form'); form.noValidate = true;
    var set = el('fieldset', 'rv-stars');
    set.appendChild(el('legend', 'rv-label', 'Your rating'));
    var row = el('div', 'rv-star-row');
    var stars = [];
    for (var i = 1; i <= 5; i++) {
      var lab = el('label', 'rv-star');
      var inp = el('input', 'rv-sr'); inp.type = 'radio'; inp.name = 'rvRate'; inp.value = String(i);
      inp.setAttribute('aria-label', i + (i === 1 ? ' star' : ' stars'));
      lab.appendChild(inp); lab.appendChild(el('span', 'rv-glyph', '\u2605'));
      row.appendChild(lab); stars.push({ lab: lab, inp: inp });
    }
    set.appendChild(row);
    set.appendChild(el('p', 'rv-hint', '1 is poor, 5 is excellent.'));
    var field = el('label', 'rv-field');
    field.appendChild(el('span', 'rv-label', 'Comment (optional)'));
    var comment = el('textarea', 'rv-input'); comment.rows = 4; comment.maxLength = COMMENT_MAX;
    field.appendChild(comment);
    var count = el('span', 'rv-hint', '0 / ' + COMMENT_MAX);
    var err = el('p', 'rv-error'); err.setAttribute('role', 'alert'); err.hidden = true;
    var note = el('p', 'rv-hint', 'Your review shows on their profile straight away. It can\u2019t be edited or removed afterwards.');
    var actions = el('div', 'rv-actions');
    var later = el('button', 'rv-btn', 'Not now'); later.type = 'button';
    var send = el('button', 'rv-btn rv-btn-primary', 'Submit review'); send.type = 'submit';
    actions.appendChild(later); actions.appendChild(send);
    [set, field, count, err, note, actions].forEach(function (n) { form.appendChild(n); });

    var close = el('div', 'rv-actions'); var done = el('button', 'rv-btn rv-btn-primary', 'Close'); done.type = 'button';
    close.appendChild(done); close.hidden = true;

    [title, lead, msg, form, close].forEach(function (n) { body.appendChild(n); });
    dlg.appendChild(body); document.body.appendChild(dlg);
    els = { title: title, lead: lead, msg: msg, form: form, stars: stars, set: set, comment: comment, count: count, err: err, send: send, later: later, close: close, done: done };

    dlg.addEventListener('click', function (e) { if (e.target === dlg && !busy) dlg.close(); });
    later.addEventListener('click', function () { dlg.close(); });
    done.addEventListener('click', function () { dlg.close(); });
    comment.addEventListener('input', function () { count.textContent = comment.value.length + ' / ' + COMMENT_MAX; });
    stars.forEach(function (s) {
      s.inp.addEventListener('change', function () { rating = parseInt(s.inp.value, 10); paintStars(); els.err.hidden = true; });
    });
    form.addEventListener('submit', submit);
  }

  function paintStars() {
    els.stars.forEach(function (s, i) { s.lab.classList.toggle('is-on', i < rating); });
  }

  function showMessage(text, showClose) {
    els.form.hidden = true;
    els.msg.textContent = text; els.msg.hidden = false;
    els.close.hidden = !showClose;
  }

  async function submit(e) {
    e.preventDefault();
    if (busy || !ctx) return;
    if (!(rating >= 1 && rating <= 5)) { els.err.textContent = 'Choose a rating from 1 to 5 stars.'; els.err.hidden = false; return; }
    var text = els.comment.value.trim();
    busy = true; els.err.hidden = true; els.send.disabled = true; els.later.disabled = true; els.send.textContent = 'Sending\u2026';
    var out = null, error = null;
    try {
      var res = await window.supabase.rpc('submit_review', { p_booking: String(ctx.bookingId), p_rating: rating, p_comment: text || null });
      if (res.error) error = res.error; else out = res.data || {};
    } catch (ex) { error = ex || { message: 'network' }; }
    busy = false; els.send.disabled = false; els.later.disabled = false; els.send.textContent = 'Submit review';

    if (error) {
      /* we can't tell whether the call arrived: ask the database instead of guessing */
      try {
        var st = await getState(ctx.bookingId);
        if (st.reason === 'already_reviewed') { delete stateCache[ctx.bookingId]; showMessage('Your review has been saved. Thank you.', true); finish(); return; }
      } catch (_e) { /* fall through */ }
      els.err.textContent = missing(error) ? 'Reviews are not available yet. Please try again later.' : 'We couldn\u2019t confirm that. Check your connection and try again. Nothing was saved twice.';
      els.err.hidden = false; return;
    }
    if (out.ok === true) { delete stateCache[ctx.bookingId]; showMessage('Thank you. Your review has been saved.', true); finish(); return; }
    /* a refusal: show the database's own sentence */
    els.err.textContent = out.error || 'Your review could not be saved.'; els.err.hidden = false;
  }

  function finish() {
    var cb = ctx && ctx.onDone; var id = ctx && ctx.bookingId;
    if (cb) { try { cb(id); } catch (_e) { /* the page's own callback must never break the dialog */ } }
    decorate(document);
  }

  async function open(opts) {
    opts = opts || {};
    if (!isUuid(opts.bookingId)) return;
    if (!dlg) build();
    ctx = { bookingId: String(opts.bookingId), onDone: opts.onDone };
    rating = 0; paintStars();
    els.stars.forEach(function (s) { s.inp.checked = false; });
    els.comment.value = ''; els.count.textContent = '0 / ' + COMMENT_MAX; els.err.hidden = true;
    els.msg.hidden = true; els.close.hidden = true; els.form.hidden = true;
    els.title.textContent = 'Leave a review'; els.lead.textContent = 'Checking\u2026';
    if (!dlg.open) dlg.showModal();

    var st;
    try { st = await getState(ctx.bookingId); }
    catch (err) {
      els.lead.textContent = '';
      showMessage(missing(err) ? 'Reviews are not available yet. Please try again later.' : 'We couldn\u2019t load this review. Please try again.', true);
      return;
    }
    els.lead.textContent = '';
    if (st.ok === false) { showMessage(st.error || 'Please sign in to leave a review.', true); return; }
    if (st.reason === 'already_reviewed') { showMessage('You have already reviewed this job. Thank you.', true); return; }
    if (st.can_review !== true) {
      showMessage(st.reason === 'not_completed' ? 'You can leave a review once the job is completed and the payment is released.' : 'This job can\u2019t be reviewed by you.', true);
      return;
    }
    els.title.textContent = st.reviewee_name ? 'How was ' + st.reviewee_name + '?' : 'Leave a review';
    els.lead.textContent = st.reviewee_role === 'customer' ? 'Tell other taskers what this customer was like to work with.' : 'Tell other customers what this tasker was like to work with.';
    els.form.hidden = false;
    var first = els.stars[0].inp; if (first && first.focus) first.focus();
  }

  /* ── buttons on cards ───────────────────────────────────── */
  function button(bookingId, cls) {
    var b = el('button', cls || 'rv-btn', 'Leave a review');
    b.type = 'button'; b.setAttribute('data-act', 'review'); b.setAttribute('data-id', String(bookingId));
    return b.outerHTML;
  }

  async function decorate(root) {
    var nodes = (root || document).querySelectorAll('[data-act="review"][data-id]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i], id = n.getAttribute('data-id');
      if (!isUuid(id) || n.getAttribute('data-rv') === 'done') continue;
      var st = stateCache[id];
      if (!st) {
        try { st = await getState(id); stateCache[id] = st; }
        catch (err) { if (missing(err)) n.hidden = true; continue; }   /* any other failure: leave the button, the dialog will say what is true */
      }
      if (!n.isConnected) continue;
      if (st.ok === false || (st.can_review === false && st.reason !== 'already_reviewed')) { n.hidden = true; continue; }
      if (st.reason === 'already_reviewed') {
        var tag = el('span', 'rv-tag', 'Reviewed \u2713'); n.parentNode.replaceChild(tag, n);
      } else { n.setAttribute('data-rv', 'done'); }
    }
  }

  function promptFromUrl() {
    try {
      var p = new URLSearchParams(window.location.search), id = p.get('review');
      if (!isUuid(id)) return;
      p.delete('review');
      var q = p.toString();
      window.history.replaceState(null, '', window.location.pathname + (q ? '?' + q : '') + window.location.hash);
      open({ bookingId: id });
    } catch (_e) { /* a bad address must never break the page */ }
  }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-act="review"][data-id]') : null;
    if (!t) return;
    e.preventDefault();
    open({ bookingId: t.getAttribute('data-id') });
  });

  window.STReview = { open: open, button: button, decorate: decorate, promptFromUrl: promptFromUrl };
})();
