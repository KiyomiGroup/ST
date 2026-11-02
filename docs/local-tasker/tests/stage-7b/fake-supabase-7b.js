/* Test double for the Supabase UMD global, Stage 7B payout page only. Scenario in window.__SC. NOT Supabase. */
(function () {
  function sc() { return window.__SC || {}; }
  var session = null;
  try { var s = localStorage.getItem('fake_session'); if (s) session = JSON.parse(s); } catch (e) {}
  window.__fnCalls = []; window.__rpcCalls = []; window.__writes = [];
  var saved = null;
  window.supabase = { createClient: function () { return {
    auth: {
      getSession: async function () { return { data: { session: session }, error: null }; },
      signOut: async function () { return { error: null }; },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; }
    },
    functions: { invoke: async function (name, opts) {
      var body = opts && opts.body; window.__fnCalls.push({ name: name, body: JSON.parse(JSON.stringify(body)) });
      var cfg = (sc().fn || {})[body.action] || { mode: 'ok' };
      if (cfg.delay) await new Promise(function (r) { setTimeout(r, cfg.delay); });
      if (cfg.mode === 'network') return { data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send' } };
      if (cfg.mode === 'error') return { data: null, error: { name: 'FunctionsHttpError', message: 'non-2xx', context: { status: cfg.status || 400, json: async function () { return { ok: false, error: cfg.code, message: cfg.message || 'x' }; } } } };
      if (body.action === 'banks') return { data: { ok: true, banks: sc().banks || [{ name: 'Guaranty Trust Bank', code: '058' }, { name: 'Zenith Bank', code: '057' }] }, error: null };
      if (body.action === 'resolve') return { data: cfg.matched === false ? { ok: true, matched: false } : { ok: true, matched: true, account_name: sc().resolvedName || 'BABA ALABI ADEBAYO' }, error: null };
      if (body.action === 'save') {
        saved = { has_account: true, bank_name: 'Guaranty Trust Bank', account_mask: '******' + String(body.account_number).slice(-4), account_name: sc().resolvedName || 'BABA ALABI ADEBAYO', verified_at: '2026-10-30T10:00:00Z', consent_method: body.consent.method, consent_recorded_at: '2026-10-30T10:00:00Z' };
        return { data: { ok: true, changed: true, bank_name: 'Guaranty Trust Bank', account_mask: saved.account_mask }, error: null };
      }
      return { data: { unexpected: true }, error: null };
    } },
    rpc: async function (n, a) {
      window.__rpcCalls.push({ name: n, args: a });
      if (n === 'is_active_coordinator') return { data: sc().role === 'active', error: null };
      if (n === 'is_coordinator') return { data: true, error: null };
      if (n === 'local_payout_account') {
        if (sc().payoutError) return { data: null, error: { code: 'XX000', message: 'boom' } };
        return { data: saved || sc().payout || { has_account: false }, error: null };
      }
      return { data: null, error: { message: 'unknown rpc ' + n } };
    },
    from: function (t) {
      var q = { filters: {} };
      var c = { select: function () { return c; }, eq: function (k, v) { q.filters[k] = v; return c; },
        maybeSingle: async function () {
          if (t === 'local_tasker_profiles') {
            var ok = (sc().assignments || []).indexOf(q.filters.tasker_user_id) > -1;
            return { data: ok ? (sc().profile || null) : null, error: null };
          }
          return { data: null, error: null };
        } };
      ['insert', 'update', 'upsert', 'delete'].forEach(function (m) { c[m] = function () { window.__writes.push(t + '.' + m); return c; }; });
      return c;
    }
  }; } };
})();
