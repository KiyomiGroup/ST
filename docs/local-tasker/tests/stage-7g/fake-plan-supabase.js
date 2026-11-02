/* Test double for the Supabase UMD global (Stage 7G). Scenario from window.__SC: { plan: {...}|'error', assignments: n }. Proves PAGE logic only. */
(function () {
  function sc() { return window.__SC || {}; }
  window.__calls = [];
  var session = { user: { id: 'co-1', email: 'amaka@example.com' } };
  function chain(res) {
    var o = { select: function () { return o; }, eq: function () { return o; }, in: function () { return o; }, is: function () { return o; }, limit: function () { return o; }, order: function () { return o; },
      maybeSingle: async function () { return res; }, then: function (a, b) { return Promise.resolve(res).then(a, b); } };
    return o;
  }
  window.supabase = { createClient: function () { return {
    auth: { getSession: async function () { return { data: { session: session }, error: null }; }, signOut: async function () { return { error: null }; },
            onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; } },
    from: function (t) {
      window.__calls.push('from:' + t);
      if (t === 'coordinators') return chain({ data: { display_name: 'Amaka Eze', status: 'active' }, error: null });
      if (t === 'coordinator_assignments') { var a = []; for (var i = 0; i < (sc().assignments || 0); i++) a.push({ tasker_user_id: '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'), assigned_at: '2026-10-0' + ((i % 9) + 1) + 'T10:00:00Z' }); return chain({ data: a, error: null }); }
      return chain({ data: [], error: null });
    },
    rpc: async function (n, args) {
      window.__calls.push('rpc:' + n);
      if (n === 'is_active_coordinator') return { data: true, error: null };
      if (n === 'my_coordinator_plan') { var p = sc().plan; if (p === 'error') return { data: null, error: { message: 'boom' } }; return { data: p, error: null }; }
      return { data: null, error: null };
    },
    functions: { invoke: async function () { return { data: null, error: { message: 'not used' } }; } }
  }; } };
})();
