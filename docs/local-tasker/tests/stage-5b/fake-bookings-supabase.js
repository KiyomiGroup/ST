/* Test double for the Supabase UMD global on the coordinator BOOKING pages (stage 5B). Scenario: window.__SC.
   list: [rows as local_booking_list returns]; detail: { <booking id>: {...as local_booking_detail returns} }
   fail: { list, detail } -> that call returns a server error.  Every rpc call is recorded in window.__rpc. */
(function () {
  var SC = window.__SC || {}; window.__rpc = []; window.__tables = [];
  var session = { user: { id: 'u1', email: 'chidi@example.com' } };
  var client = {
    auth: {
      getSession: async function () { return { data: { session: session }, error: null }; },
      signOut: async function () { return { error: null }; },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; }
    },
    from: function (t) {
      window.__tables.push(t);
      var b = { select: function () { return b; }, eq: function () { return b; },
        maybeSingle: async function () { return { data: { display_name: 'Chidi Okafor', status: 'active' }, error: null }; },
        then: function (res, rej) { return Promise.resolve({ data: [], error: null }).then(res, rej); } };
      return b;
    },
    rpc: async function (name, args) {
      window.__rpc.push(name + ':' + JSON.stringify(args));
      var F = SC.fail || {};
      if (name === 'is_active_coordinator') return { data: true, error: null };
      if (name === 'is_coordinator') return { data: true, error: null };
      if (name === 'local_booking_list') {
        if (F.list) return { data: null, error: { message: 'boom' } };
        return { data: SC.list || [], error: null };
      }
      if (name === 'local_booking_detail') {
        if (F.detail) return { data: null, error: { message: 'boom' } };
        var d = (SC.detail || {})[args.p_booking];
        if (!d) return { data: null, error: { code: 'P0001', hint: 'not_found', message: 'Booking not found.' } };
        return { data: d, error: null };
      }
      return { data: null, error: { message: 'unknown rpc ' + name } };
    },
    channel: function () { return { on: function () { return this; }, subscribe: function () { return this; } }; },
    removeChannel: function () {}
  };
  window.supabase = { createClient: function () { return client; } };
})();
