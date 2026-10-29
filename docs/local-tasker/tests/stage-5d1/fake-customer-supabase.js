/* Test double for the Supabase UMD global on the CUSTOMER bookings page (stage 5D-1). Scenario: window.__SC.
   bookings: [rows of public.bookings for the signed-in customer]; quotes: [rows as local_booking_customer_quotes returns]
   fail: { quotes: true, decide: {hint, message} | [ {hint, message}, ... one per call ] }
   decideApply: false -> a successful decide changes nothing in the scenario (to prove the page re-reads).
   Every rpc is recorded in window.__rpc (name:args); every table read in window.__tables. There are NO write methods on tables. */
(function () {
  var SC = window.__SC || {}; window.__rpc = []; window.__tables = []; window.__decide = [];
  var session = { user: { id: 'u1', email: 'ada@example.com', user_metadata: { role: 'customer', name: 'Ada' } } };
  function builder(table) {
    var rows = ((SC.tables || {})[table] || []).slice(); var single = false;
    var b = {
      select: function () { return b; }, order: function () { return b; }, limit: function () { return b; }, range: function () { return b; },
      eq: function (c, v) { rows = rows.filter(function (r) { return String(r[c]) === String(v); }); return b; },
      in: function (c, vs) { rows = rows.filter(function (r) { return vs.map(String).indexOf(String(r[c])) !== -1; }); return b; },
      neq: function () { return b; }, gte: function () { return b; }, or: function () { return b; }, is: function () { return b; },
      maybeSingle: function () { single = true; return b; }, single: function () { single = true; return b; },
      then: function (res, rej) { return Promise.resolve({ data: single ? (rows[0] || null) : rows, error: null }).then(res, rej); }
    };
    return b;
  }
  var calls = 0;
  var client = {
    auth: {
      getSession: async function () { return { data: { session: session }, error: null }; },
      getUser: async function () { return { data: { user: session.user }, error: null }; },
      signOut: async function () { return { error: null }; },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; }
    },
    from: function (t) { window.__tables.push(t); return builder(t); },
    rpc: async function (name, args) {
      window.__rpc.push(name + ':' + JSON.stringify(args));
      var F = SC.fail || {};
      if (name === 'local_booking_customer_quotes') {
        if (F.quotes) return { data: null, error: { message: 'FATAL relation boom' } };
        return { data: JSON.parse(JSON.stringify(SC.quotes || [])), error: null };
      }
      if (name === 'local_booking_decide_quote') {
        window.__decide.push(args);
        var f = Array.isArray(F.decide) ? F.decide[calls] : F.decide; calls++;
        if (f) { if (f.apply) f.apply(SC); return { data: null, error: { code: 'P0001', hint: f.hint, message: f.message } }; }
        var q = (SC.quotes || []).filter(function (x) { return x.booking_id === args.p_booking; })[0];
        if (q && SC.decideApply !== false) {
          if (args.p_decision === 'approved') {
            q.lt_status = 'quote_approved'; q.decision = { decision: 'approved', reason: null, at: '2026-10-28T10:00:00Z' };
            q.payments = q.quote.lines.map(function (l) { return { key: l.key, amount: l.amount, status: 'pending' }; });
          } else { q.lt_status = 'quote_declined'; q.decision = { decision: 'declined', reason: args.p_reason, at: '2026-10-28T10:00:00Z' }; }
        }
        return { data: { decision: args.p_decision, changed: true }, error: null };
      }
      return { data: null, error: { message: 'unknown rpc ' + name } };
    },
    storage: { from: function () { return { getPublicUrl: function () { return { data: { publicUrl: '' } }; } }; } },
    channel: function () { return { on: function () { return this; }, subscribe: function () { return this; } }; },
    removeChannel: function () {}
  };
  window.supabase = { createClient: function () { return client; } };
})();
