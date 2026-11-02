/* ============================================================
   StreetTasker — coordinator-plan.js (Stage 7I)
   Plan and upgrade page (coordinator-plan.html).

   What this page does:
     - READS the coordinator's plan from the server (rpc my_coordinator_plan) and the upgrade history
       (rpc my_coordinator_upgrades). Every number on screen comes from those answers.
     - STARTS an upgrade payment through ST.payments.upgradeCoordinatorTier(), which sends only the purpose
       "tier_upgrade" to the payment-init Edge Function. The amount, the tier and the reference are decided by the server.
     - After any attempt it READS THE PLAN AGAIN and shows that. It never sets a tier, never computes a price,
       and never offers a button for any tier except the one the server says is next.

   Runs on the `coordinator:ready` event from js/coordinator.js (after the route guard passed).
   Text is written with textContent only.
   ============================================================ */
'use strict';

(function () {
  var C = window.STCo;
  var el = C.el;

  function $(id) { return document.getElementById(id); }

  var state = {
    plan: null,          /* last plan the server gave us */
    busy: false,         /* an upgrade attempt is in progress */
    locked: false,       /* an attempt ended in an unclear state: no new payment until the page is reloaded */
    ready: false
  };

  /* ── Formatting ────────────────────────────────────────── */
  function naira(kobo) {
    var n = Number(kobo) / 100;
    if (!isFinite(n)) return '—';
    var whole = Math.abs(n % 1) < 1e-9;
    return '\u20A6' + n.toLocaleString('en-NG', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  }
  function places(n) { return n + (n === 1 ? ' place' : ' places'); }
  function setText(id, text) { var n = $(id); if (n) n.textContent = text; }
  function show(id, on) { var n = $(id); if (n) n.hidden = !on; }

  /* ── Reading from the server ───────────────────────────── */
  function validPlan(d) {
    return !!d && typeof d === 'object' &&
      Number.isInteger(d.tier) && d.tier >= 1 &&
      Number.isInteger(d.capacity) && Number.isInteger(d.active_count) && Number.isInteger(d.places_left);
  }
  async function readPlan() {
    /* Not STCo.plan(): that one is cached for the life of the page, and after a payment we need a fresh answer. */
    var res = await window.supabase.rpc('my_coordinator_plan');
    if (res.error || !validPlan(res.data)) throw (res.error || new Error('plan unreadable'));
    return res.data;
  }
  async function readHistory() {
    var res = await window.supabase.rpc('my_coordinator_upgrades');
    if (res.error || !Array.isArray(res.data)) throw (res.error || new Error('history unreadable'));
    return res.data;
  }

  /* The ONLY step the page will ever offer: the one directly above the current tier, with a real price. */
  function nextStep(plan) {
    var n = plan && plan.next;
    if (!n || typeof n !== 'object') return null;
    if (!Number.isInteger(n.tier) || n.tier !== plan.tier + 1) return null;
    if (!Number.isInteger(n.capacity) || n.capacity <= plan.capacity) return null;
    if (!Number.isInteger(n.price_kobo) || n.price_kobo <= 0) return null;
    return n;
  }

  /* ── Painting ──────────────────────────────────────────── */
  function paintDashes() {
    setText('coPlTier', '—'); setText('coPlTierNote', 'Plan not loaded');
    setText('coPlUsed', '—'); setText('coPlUsedNote', 'Active Local Taskers');
    setText('coPlLeft', '—');
    setText('coPlNextPrice', '—'); setText('coPlNextNote', 'One step at a time');
  }

  function paint(plan) {
    state.plan = plan;
    var next = nextStep(plan);
    var atTop = plan.next == null;

    setText('coPlTier', 'Tier ' + plan.tier);
    setText('coPlTierNote', places(plan.capacity) + ' allowed');
    setText('coPlUsed', String(plan.active_count));
    setText('coPlUsedNote', 'of ' + plan.capacity + ' allowed');
    setText('coPlLeft', String(plan.places_left));
    if (next) { setText('coPlNextPrice', naira(next.price_kobo)); setText('coPlNextNote', 'Tier ' + next.tier + ' \u00B7 ' + places(next.capacity)); }
    else if (atTop) { setText('coPlNextPrice', '—'); setText('coPlNextNote', 'You\u2019re on the highest plan'); }
    else { setText('coPlNextPrice', '—'); setText('coPlNextNote', 'Not available right now'); }

    /* Your places card */
    setText('coPlUsageLead', plan.active_count + ' of ' + plan.capacity + ' places are in use on Tier ' + plan.tier + '.');
    setText('coPlFactActive', String(plan.active_count));
    setText('coPlFactCap', String(plan.capacity));
    setText('coPlFactLeft', String(plan.places_left));
    var pct = plan.capacity > 0 ? Math.min(100, Math.round((plan.active_count / plan.capacity) * 100)) : 0;
    var meter = $('coPlMeter');
    if (meter) {
      meter.style.setProperty('--co-meter', pct + '%');          /* a runtime value: the only inline style on the page */
      meter.classList.toggle('is-full', plan.places_left <= 0);
      meter.setAttribute('aria-label', plan.active_count + ' of ' + plan.capacity + ' places used');
    }
    show('coPlOver', plan.over_capacity === true);

    /* Next step card */
    show('coPlNextBody', !!next);
    show('coPlTopBody', atTop);
    var cardTitle = $('coPlNextTitle');
    if (next) {
      if (cardTitle) cardTitle.textContent = 'Next step: Tier ' + next.tier;
      setText('coPlPrice', naira(next.price_kobo));
      setText('coPlNextLead', 'Tier ' + next.tier + ' allows ' + next.capacity + ' active Local Taskers, ' + (next.capacity - plan.capacity) + ' more than you have now.');
      setText('coPlUpgradeBtn', 'Upgrade to Tier ' + next.tier);
      setText('coPlConfirmText', 'Pay ' + naira(next.price_kobo) + ' now to move from Tier ' + plan.tier + ' to Tier ' + next.tier + '? You\u2019ll be taken to Paystack to pay. The upgrade is permanent and the payment is not refunded.');
      setText('coPlPayBtn', 'Pay ' + naira(next.price_kobo));
    } else if (atTop) {
      if (cardTitle) cardTitle.textContent = 'Your plan';
    } else {
      /* A next step exists but its numbers do not look right: offer nothing rather than guess. */
      if (cardTitle) cardTitle.textContent = 'Next step';
      show('coPlTopBody', false);
    }
    syncButtons();
  }

  function syncButtons() {
    var next = state.plan && nextStep(state.plan);
    var locked = state.busy || state.locked || !next;
    var up = $('coPlUpgradeBtn'), pay = $('coPlPayBtn'), cancel = $('coPlCancelBtn');
    if (up) up.disabled = locked;
    if (pay) pay.disabled = locked;
    if (cancel) cancel.disabled = state.busy;
    if (!next || state.locked) closeConfirm();
  }

  function openConfirm() {
    if (state.busy || state.locked) return;
    show('coPlActions', false);
    show('coPlConfirm', true);
    var pay = $('coPlPayBtn'); if (pay) pay.focus();
  }
  function closeConfirm() {
    show('coPlConfirm', false);
    show('coPlActions', true);
  }

  /* ── Upgrade history ───────────────────────────────────── */
  function historyRow(u) {
    var li = el('li', 'co-bk-event');
    li.appendChild(el('span', 'co-bk-event-text', 'Tier ' + u.from_tier + ' \u2192 Tier ' + u.to_tier));
    var bits = [naira(u.amount_kobo)];
    if (Number.isInteger(u.capacity)) bits.push(places(u.capacity));
    var when = C.formatDate(u.created_at);
    if (when) bits.push(when);
    li.appendChild(el('span', 'co-bk-event-note', bits.join(' \u00B7 ')));
    if (u.payment_reference) li.appendChild(el('span', 'co-pl-ref', 'Payment reference: ' + u.payment_reference));
    return li;
  }
  async function loadHistory() {
    show('coPlHistLoading', true); show('coPlHistList', false); show('coPlHistEmpty', false); show('coPlHistError', false);
    try {
      var rows = await readHistory();
      show('coPlHistLoading', false);
      if (!rows.length) { show('coPlHistEmpty', true); return; }
      var list = $('coPlHistList');
      list.textContent = '';
      rows.forEach(function (u) { list.appendChild(historyRow(u)); });
      list.hidden = false;
    } catch (e) {
      console.error('[coordinator plan history]', e);
      show('coPlHistLoading', false);
      show('coPlHistError', true);
    }
  }

  /* ── Messages ──────────────────────────────────────────── */
  function say(text, opts) {
    opts = opts || {};
    var box = $('coPlStatus');
    if (!box) return;
    box.classList.toggle('co-banner--info', opts.tone === 'info');
    setText('coPlStatusText', text);
    var ref = $('coPlStatusRef');
    if (ref) { ref.textContent = opts.reference ? 'Payment reference: ' + opts.reference : ''; ref.hidden = !opts.reference; }
    box.hidden = false;
    if (opts.focus) box.focus();
  }
  function clearSay() { show('coPlStatus', false); }

  /* ── Loading the page ──────────────────────────────────── */
  async function loadAll() {
    show('coPlError', false); show('coPlLoading', true); show('coPlGrid', false);
    try {
      var plan = await readPlan();
      paint(plan);
      show('coPlLoading', false);
      show('coPlGrid', true);
      state.ready = true;
    } catch (e) {
      console.error('[coordinator plan]', e);
      state.plan = null;
      paintDashes();
      show('coPlLoading', false);
      show('coPlOver', false);
      show('coPlError', true);
      syncButtons();
      return;
    }
    loadHistory();
  }

  /* ── The upgrade ───────────────────────────────────────── */
  async function refreshAfterAttempt() {
    /* Read the plan and history again. Whatever the server says now is what we show. Returns the new plan or null. */
    var fresh = null;
    try { fresh = await readPlan(); paint(fresh); } catch (e) { console.error('[coordinator plan refresh]', e); }
    loadHistory();
    return fresh;
  }

  async function pay() {
    if (state.busy || state.locked) return;
    var before = state.plan;
    var next = before && nextStep(before);
    if (!next) return;

    state.busy = true; clearSay(); syncButtons();
    var payBtn = $('coPlPayBtn'); if (payBtn) payBtn.textContent = 'Opening Paystack\u2026';

    var result = null, failure = null;
    try {
      result = await window.ST.payments.upgradeCoordinatorTier();
    } catch (e) {
      failure = e || new Error('unknown');
    }

    if (!failure) say('Payment received. Confirming your new plan\u2026', { tone: 'info' });
    var fresh = await refreshAfterAttempt();
    var raised = !!(fresh && before && fresh.tier > before.tier);

    if (!failure) {
      if (raised) {
        say('Upgrade complete. You\u2019re now on Tier ' + fresh.tier + ' and can have up to ' + fresh.capacity + ' active Local Taskers.',
          { tone: 'info', reference: result && result.reference, focus: true });
      } else {
        /* Paystack confirmed, but the plan we just read has not risen. Do not let the person pay again from this page. */
        state.locked = true;
        say('Your payment was confirmed, but your new plan isn\u2019t showing yet. Please reload this page in a minute. Do not pay again.',
          { reference: result && result.reference, focus: true });
      }
    } else if (raised) {
      /* The attempt reported a problem but the server has raised the tier (for example the confirmation answer was lost). Trust the server. */
      say('Upgrade complete. You\u2019re now on Tier ' + fresh.tier + ' and can have up to ' + fresh.capacity + ' active Local Taskers.',
        { tone: 'info', reference: failure.reference, focus: true });
    } else {
      switch (failure.code) {
        case 'init':
          say(failure.message || 'We couldn\u2019t start the upgrade. Nothing was charged.', { focus: true });
          break;
        case 'closed':
          say('The payment window was closed before it finished. If you were charged, your plan will update shortly and you don\u2019t need to pay again.',
            { tone: 'info', reference: failure.reference, focus: true });
          break;
        case 'pending':
          state.locked = true;
          say('Your payment is still being confirmed. If you were charged, do not pay again. Reload this page in a few minutes to see your plan.',
            { reference: failure.reference, focus: true });
          break;
        case 'review':
          state.locked = true;
          say('We received your payment but couldn\u2019t apply the upgrade automatically. Please contact StreetTasker support and give them this reference. Do not pay again.',
            { reference: failure.reference, focus: true });
          break;
        default:
          say(failure.message || 'We couldn\u2019t confirm your payment.', { reference: failure.reference, focus: true });
      }
    }

    state.busy = false;
    var pb = $('coPlPayBtn');
    if (pb && state.plan && nextStep(state.plan)) pb.textContent = 'Pay ' + naira(nextStep(state.plan).price_kobo);
    syncButtons();
    if (!state.locked && state.plan && nextStep(state.plan)) closeConfirm();
  }

  /* ── Wiring ────────────────────────────────────────────── */
  document.addEventListener('coordinator:ready', function () { loadAll(); });
  document.addEventListener('DOMContentLoaded', function () {
    var up = $('coPlUpgradeBtn'); if (up) up.addEventListener('click', openConfirm);
    var cancel = $('coPlCancelBtn'); if (cancel) cancel.addEventListener('click', closeConfirm);
    var p = $('coPlPayBtn'); if (p) p.addEventListener('click', pay);
    var retry = $('coPlRetry'); if (retry) retry.addEventListener('click', loadAll);
    var hr = $('coPlHistRetry'); if (hr) hr.addEventListener('click', loadHistory);
  });
})();
