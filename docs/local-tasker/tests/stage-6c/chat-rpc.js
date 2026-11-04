/* Adds the Stage 6B chat functions to the Stage 5D-3c-1 test double. Scenario extras: SC.chat = { rows, threads }, SC.reduction, SC.codes. Every call is recorded in window.__rpc. */
(function () {
  var orig = window.supabase.createClient;
  window.supabase.createClient = function () {
    var client = orig.apply(this, arguments), base = client.rpc;
    var SC = window.__SC || {}; window.__chat = [];
    client.channel = function () { var c = { on: function () { return c; }, subscribe: function () { return c; } }; return c; };
    client.rpc = async function (name, args) {
      var CH = SC.chat || { rows: [], threads: {} };
      if (name === 'coordinator_chat_list') { window.__rpc.push(name + ':' + JSON.stringify(args)); return { data: CH.rows, error: null }; }
      if (name === 'coordinator_chat_thread') {
        window.__rpc.push(name + ':' + JSON.stringify(args));
        var t = CH.threads[args.p_booking]; if (!t) return { data: null, error: { hint: 'not_found', message: 'nope' } };
        return { data: t, error: null };
      }
      if (name === 'coordinator_chat_mark_read') { window.__rpc.push(name); return { data: true, error: null }; }
      if (name === 'local_booking_reduction') {
        window.__rpc.push(name + ':' + JSON.stringify(args));
        return { data: (SC.reduction || {})[args.p_booking] || { can_request: false, blocked: 'not_paid', items: [] }, error: null };
      }
      if (name === 'local_booking_code_state') {
        window.__rpc.push(name + ':' + JSON.stringify(args));
        return { data: (SC.codes || {})[args.p_booking] || { can_submit: false, blocked: 'not_ready', attempts_left: 3, released: false }, error: null };
      }
      return base.apply(client, arguments);
    };
    return client;
  };
})();
