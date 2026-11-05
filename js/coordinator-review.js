/* ============================================================
   StreetTasker — coordinator-review.js (Stage M6)
   The "Review the customer" card on the coordinator booking page. A Local Tasker cannot sign in, so the coordinator who
   manages the booking leaves the Local Tasker's review of the customer FOR them, once the job is completed and the payment released.
   Reads:  rpc coordinator_review_state(p_booking)                      { can_review, reason, reviewee_name, rating, comment, by_you }
   Writes: rpc coordinator_submit_review(p_booking, p_rating, p_comment) the ONE write path (the database re-checks everything)
   Never touches money, payouts or wallets. Everything from the database is set with textContent.
   Mounted by coordinator-booking.js: STCoReview.mount(detail, { reload }).
   ============================================================ */
'use strict';

(function () {
  var ctx = null, data = null, busy = false;
  function $(id) { return document.getElementById(id); }

  function showError(msg) { $('coRvErrorText').textContent = msg; $('coRvError').hidden = false; }
  function clearMessages() {
    $('coRvError').hidden = true;
    var e = $('coRvRatingErr'); e.textContent = ''; e.hidden = true;
    $('coRvComment').removeAttribute('aria-invalid');
  }
  function stars(n) { return n + (n === 1 ? ' star' : ' stars'); }

  function render() {
    var card = $('coRv');
    var can = data && data.can_review === true;
    var done = data && data.reason === 'already_reviewed';
    /* nothing to do (not completed yet, not a Local Tasker booking): the card stays out of the way */
    if (!can && !done) { card.hidden = true; return; }
    card.hidden = false;

    $('coRvForm').hidden = !can;
    $('coRvSubmit').disabled = busy;
    $('coRvComment').disabled = busy;
    var lead = '';
    if (can) {
      lead = 'The Local Tasker can’t sign in, so you leave their review for them. Ask how the customer' + (data.reviewee_name ? ' (' + data.reviewee_name + ')' : '') +
             ' was to work with, then record it honestly. It shows on the customer’s profile as a review from the Local Tasker. It can’t be changed afterwards.';
    }
    $('coRvLead').textContent = lead; $('coRvLead').hidden = !lead;
    $('coRvDone').hidden = !done;
    $('coRvDoneText').textContent = done
      ? 'Review recorded: ' + stars(Number(data.rating) || 0) + (data.by_you ? ' (you submitted it).' : '.') + (data.comment ? ' “' + data.comment + '”' : '')
      : '';
    $('coRvFoot').hidden = done;
  }

  async function load() {
    var res = await window.supabase.rpc('coordinator_review_state', { p_booking: ctx.detail.booking_id });
    if (res.error) throw res.error;
    data = res.data;
  }

  /* After anything unexpected, ask the database what is true now and show that (never guess). */
  async function refresh() {
    try { await load(); render(); return true; } catch (e) { return false; }
  }

  function chosenRating() {
    var r = document.querySelector('input[name="coRvRate"]:checked');
    return r ? parseInt(r.value, 10) : 0;
  }

  async function submit(e) {
    e.preventDefault();
    if (busy || !data || data.can_review !== true) return;
    clearMessages();
    var rating = chosenRating();
    if (!(rating >= 1 && rating <= 5)) {
      var fe = $('coRvRatingErr'); fe.textContent = 'Choose a rating from 1 to 5 stars. Nothing was sent.'; fe.hidden = false;
      return;
    }
    var comment = $('coRvComment').value.trim();
    if (comment.length > 1000) {
      showError('Please keep the review under 1000 characters.');
      $('coRvComment').setAttribute('aria-invalid', 'true'); return;
    }
    busy = true; render();
    var res = null, err = null;
    try {
      res = await window.supabase.rpc('coordinator_submit_review', { p_booking: ctx.detail.booking_id, p_rating: rating, p_comment: comment || null });
      if (res.error) err = res.error;
    } catch (ex) { err = ex || { message: 'network' }; }
    busy = false;

    if (err) {
      if (err.hint === 'not_found' || /not available/i.test(err.message || '')) {
        data = null; $('coRv').hidden = false; $('coRvForm').hidden = true;
        showError('This booking is no longer yours, or it can’t be found.'); return;
      }
      /* We can't tell whether the call arrived. Ask the database instead of guessing. */
      var ok = await refresh();
      showError(ok ? 'We couldn’t confirm that. The card now shows the real state, so check it before you try again. Nothing was recorded twice.'
                   : 'We couldn’t reach StreetTasker. Check your connection and reload the page before you try again.');
      if (!ok) render();
      return;
    }
    var out = res.data || {};
    if (out.ok === true) {
      $('coRvComment').value = '';
      await refresh();
      if (!data || data.reason !== 'already_reviewed') { data = { can_review: false, reason: 'already_reviewed', rating: rating, comment: comment || null, by_you: true }; render(); }
      return;
    }
    /* a refusal: show the database's own sentence, then the true state */
    await refresh();
    showError(out.error || 'The review could not be saved. Nothing was changed.');
  }

  async function mount(detail, opts) {
    ctx = { detail: detail, reload: (opts && opts.reload) || function () {} };
    data = null;
    if (!detail || !detail.booking_id) { $('coRv').hidden = true; return; }
    $('coRvError').hidden = true;
    try { await load(); render(); }
    catch (err) {
      /* the database function isn't installed yet (site updated before the SQL), or this is not a booking the person coordinates: stay out of the way */
      if (err && (err.code === 'PGRST202' || err.code === '42883' || err.hint === 'not_found')) { data = null; $('coRv').hidden = true; return; }
      /* any other failed read must never offer the form: say so and stop */
      data = null; $('coRv').hidden = false; $('coRvForm').hidden = true; $('coRvDone').hidden = true;
      $('coRvLead').textContent = ''; $('coRvLead').hidden = true;
      showError('We couldn’t load the review card. Reload the page to try again.');
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var f = $('coRvForm');
    if (f) f.addEventListener('submit', submit);
    var rates = document.querySelectorAll('input[name="coRvRate"]');
    for (var i = 0; i < rates.length; i++) rates[i].addEventListener('change', function () { var e = $('coRvRatingErr'); e.hidden = true; e.textContent = ''; });
  });
  window.STCoReview = { mount: mount };
})();
