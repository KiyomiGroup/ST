/* Test double for Stage 7F (copied from the Stage 7I double; adds the wallets table). Original header follows.
   Extra scenario key: wallet = a number | 'none' (no wallet row) | 'error' | 'junk' (unreadable balance) | 'negative'. Every wallets read is recorded in window.__walletReads.

   Test double for Stage 7I. Replaces the Supabase UMD global, window.fetch for the payment Edge Functions, and PaystackPop.
   It proves PAGE and payments.js logic only. The "server" below is a stand-in written for the test: it raises the tier
   ONLY when a verify call succeeds, which is the rule the real database enforces. It is NOT the real server.
   Scenario from window.__SC:
     tier, active, history[], planError, histError, noNext (top tier), badNext (next.tier = tier+2)
     paystack: 'pay' | 'close'
     initFail: {status, error}
     verify: 'ok' | 'pending' | 'review' | 'failed' | 'okStale' | 'hold'   ('hold' waits for window.__release())
*/
(function () {
  function sc() { return window.__SC || {}; }
  var S = null;
  function st() {
    if (!S) { S = { tier: sc().tier || 1, active: sc().active == null ? 4 : sc().active, history: (sc().history || []).slice() }; }
    return S;
  }
  function terms(t) { return { tier: t, capacity: t <= 3 ? 10 * t : 5 * t + 15, price_kobo: 50000 * (t - 1) * 100 }; }
  window.__calls = []; window.__initBodies = []; window.__verifyBodies = []; window.__psOpts = [];
  window.__fakeState = function () { return JSON.parse(JSON.stringify(st())); };
  var session = { user: { id: 'co-1', email: 'amaka@example.com' }, access_token: 'fake-token' };

  function chain(res) {
    var o = { select: function () { return o; }, eq: function () { return o; }, in: function () { return o; }, is: function () { return o; }, limit: function () { return o; }, order: function () { return o; },
      maybeSingle: async function () { return res; }, then: function (a, b) { return Promise.resolve(res).then(a, b); } };
    return o;
  }
  function planNow() {
    var s = st(), t = terms(s.tier), n = terms(s.tier + 1);
    var next = sc().noNext ? null : { tier: sc().badNext ? s.tier + 2 : n.tier, capacity: n.capacity, price_kobo: n.price_kobo };
    return { tier: s.tier, capacity: t.capacity, active_count: s.active, places_left: Math.max(t.capacity - s.active, 0), over_capacity: s.active > t.capacity, next: next };
  }
  window.supabase = { createClient: function () { return {
    auth: {
      getSession: async function () { return { data: { session: session }, error: null }; },
      getUser: async function () { return { data: { user: session.user }, error: null }; },
      signOut: async function () { return { error: null }; },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; }
    },
    from: function (t) {
      window.__calls.push('from:' + t);
      if (t === 'coordinators') return chain({ data: { display_name: 'Amaka Eze', status: 'active' }, error: null });
      if (t === 'coordinator_assignments') { var a = []; for (var i = 0; i < st().active; i++) a.push({ tasker_user_id: '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'), assigned_at: '2026-10-01T10:00:00Z' }); return chain({ data: a, error: null }); }
      if (t === 'wallets') {
        var w = sc().wallet;
        var rec = { table: t, filters: [], selected: null };
        (window.__walletReads = window.__walletReads || []).push(rec);
        var o = { select: function (c) { rec.selected = c; return o; }, eq: function (k, v) { rec.filters.push([k, v]); return o; },
                  maybeSingle: async function () {
                    if (w === 'error') return { data: null, error: { message: 'boom' } };
                    if (w === 'none') return { data: null, error: null };
                    if (w === 'junk') return { data: { balance: 'abc' }, error: null };
                    if (w === 'negative') return { data: { balance: -5 }, error: null };
                    return { data: { balance: w == null ? 0 : w }, error: null };
                  } };
        return o;
      }
      return chain({ data: [], error: null });
    },
    rpc: async function (n) {
      window.__calls.push('rpc:' + n);
      if (n === 'is_active_coordinator') return { data: true, error: null };
      if (n === 'my_coordinator_plan') { if (sc().planError && !window.__planFixed) return { data: null, error: { message: 'boom' } }; return { data: planNow(), error: null }; }
      if (n === 'my_coordinator_upgrades') { if (sc().histError) return { data: null, error: { message: 'boom' } }; return { data: st().history.slice().reverse(), error: null }; }
      return { data: null, error: null };
    }
  }; } };

  /* Paystack pop-up */
  window.PaystackPop = { setup: function (o) { window.__psOpts.push({ key: o.key, amount: o.amount, ref: o.ref, currency: o.currency, email: o.email }); return { openIframe: function () {
    setTimeout(function () { if (sc().paystack === 'close') o.onClose(); else o.callback({ reference: o.ref }); }, 5);
  } }; } };

  /* Speed up the 2 second retry wait in payments.js */
  var realST = window.setTimeout; window.setTimeout = function (f, d) { return realST(f, d === 2000 ? 1 : d); };

  /* Edge Functions */
  var realFetch = window.fetch.bind(window);
  function reply(status, body) { return new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } }); }
  var pendingRef = null;
  window.fetch = async function (url, opts) {
    url = String(url);
    if (url.indexOf('/functions/v1/payment-init') > -1) {
      var b = JSON.parse(opts.body || '{}'); window.__initBodies.push(b);
      if (b.purpose !== 'tier_upgrade') return reply(400, { error: 'Unknown payment type.' });
      if (sc().initFail) return reply(sc().initFail.status || 400, { error: sc().initFail.error });
      var s = st(), n = terms(s.tier + 1);
      pendingRef = 'ST-' + 'ab12cd34'.repeat(4);
      return reply(200, { reference: pendingRef, amount: n.price_kobo / 100, amountKobo: n.price_kobo, email: session.user.email, purpose: 'tier_upgrade', tier: n.tier, capacity: n.capacity });
    }
    if (url.indexOf('/functions/v1/payment-verify') > -1) {
      var v = JSON.parse(opts.body || '{}'); window.__verifyBodies.push(v);
      var mode = sc().verify || 'ok';
      if (mode === 'hold') await new Promise(function (r) { window.__release = r; });
      if (mode === 'pending') return reply(202, { ok: false, pending: true, error: 'Payment not confirmed yet.' });
      if (mode === 'review') return reply(409, { ok: false, needs_review: true, error: 'This payment needs a manual review.' });
      if (mode === 'failed') return reply(402, { ok: false, error: 'The payment failed. You have not been charged.' });
      var s2 = st(), n2 = terms(s2.tier + 1);
      if (mode !== 'okStale') {
        s2.history.push({ from_tier: s2.tier, to_tier: n2.tier, capacity: n2.capacity, amount_kobo: n2.price_kobo, payment_reference: v.reference, created_at: '2026-11-02T10:00:00Z' });
        s2.tier = n2.tier;
      }
      return reply(200, { ok: true, tier: n2.tier, capacity: n2.capacity });
    }
    return realFetch(url, opts);
  };
})();
