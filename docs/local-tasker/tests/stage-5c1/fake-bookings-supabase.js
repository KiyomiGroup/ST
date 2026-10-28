/* Test double for the Supabase UMD global on the coordinator BOOKING pages (stages 5B and 5C-1 (identical to the 5C-2 copy; the quote calls are simply unused)). Scenario: window.__SC.
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
      if (name === 'local_booking_confirmations') {
        if (F.conf) return { data: null, error: { message: 'boom' } };
        var d2 = (SC.detail || {})[args.p_booking];
        if (!d2) return { data: null, error: { code: 'P0001', hint: 'not_found', message: 'Booking not found.' } };
        var c = (SC.conf || {})[args.p_booking] || {};
        return { data: { booking_id: args.p_booking, lt_status: d2.lt_status, tasker_name: 'Baba Alabi', tasker_phone: SC.phone === undefined ? '+234 801 111 2222' : SC.phone,
                         current: c.current || null, attempts: c.attempts || [] }, error: null };
      }
      if (name === 'local_booking_record_confirmation') {
        window.__saved = (window.__saved || []).concat([args]);
        if (F.record) return { data: null, error: F.record };
        var det = SC.detail[args.p_booking]; SC.conf = SC.conf || {}; var cc = SC.conf[args.p_booking] = SC.conf[args.p_booking] || { attempts: [] };
        cc.attempts = [{ outcome: args.p_outcome, called_name: args.p_called_name, called_at: args.p_called_at, proposed_price: args.p_price, superseded: false, created_at: args.p_called_at }].concat(cc.attempts);
        if (args.p_outcome === 'confirmed') {
          det.lt_status = 'tasker_confirmed';
          cc.current = { outcome: 'confirmed', called_name: args.p_called_name, called_number: args.p_called_number, number_matches_profile: true, called_at: args.p_called_at, available: true, can_do: true,
            proposed_price: args.p_price, duration_text: args.p_duration, transport_amount: args.p_transport, materials_amount: args.p_materials, materials_notes: args.p_materials_notes,
            limitations: args.p_limitations, agreed_notes: args.p_notes, second_check_status: args.p_second_check ? 'requested' : 'off', second_check_note: null };
        } else if (args.p_outcome === 'declined') {
          det.lt_status = 'tasker_declined';
          cc.current = { outcome: 'declined', called_name: args.p_called_name, called_number: args.p_called_number, called_at: args.p_called_at, limitations: args.p_limitations, agreed_notes: args.p_notes, second_check_status: 'off' };
        } else { det.lt_status = 'awaiting_tasker_confirmation'; }
        return { data: { confirmation_id: 'x', outcome: args.p_outcome, lt_status: det.lt_status }, error: null };
      }
      if (name === 'local_booking_quote') {
        if (F.quote) return { data: null, error: { message: 'boom' } };
        var q = (SC.quote || {})[args.p_booking];
        if (!q) return { data: { booking_id: args.p_booking, lt_status: (SC.detail[args.p_booking] || {}).lt_status, confirmed: null, current: null, history: [] }, error: null };
        return { data: { booking_id: args.p_booking, lt_status: SC.detail[args.p_booking].lt_status, confirmed: q.confirmed || null, current: q.current || null, history: q.history || [] }, error: null };
      }
      if (name === 'local_booking_send_quote') {
        window.__sent = (window.__sent || []).concat([args]);
        if (F.send) return { data: null, error: F.send };
        var qq = SC.quote[args.p_booking], fee = Number(qq.confirmed.service_fee);
        var lines = [{ sort: 1, key: 'service_fee', label: 'Service fee (the Local Tasker’s price)', amount: fee, payment_kind: 'full_payment' }];
        if (args.p_transport > 0) lines.push({ sort: 2, key: 'transport', label: 'Transport', amount: args.p_transport, payment_kind: 'transport' });
        if (args.p_materials > 0) lines.push({ sort: 3, key: 'materials', label: 'Materials', amount: args.p_materials, payment_kind: 'materials' });
        if (args.p_other > 0) lines.push({ sort: 4, key: 'other', label: args.p_other_label, amount: args.p_other, payment_kind: 'additional_cost' });
        var tot = lines.reduce(function (a, l) { return a + l.amount; }, 0);
        var ver = (qq.history || []).length + 1;
        qq.history = [{ version: ver, total: tot, superseded: false, created_at: '2026-10-28T09:00:00Z' }].concat((qq.history || []).map(function (h) { return Object.assign({}, h, { superseded: true }); }));
        qq.current = { version: ver, service_fee: fee, transport_amount: args.p_transport, materials_amount: args.p_materials, other_amount: args.p_other, other_label: args.p_other_label, total: tot, created_at: '2026-10-28T09:00:00Z', lines: lines };
        SC.detail[args.p_booking].lt_status = 'quote_sent';
        return { data: { quote_id: 'q', version: ver, total: tot, lt_status: 'quote_sent' }, error: null };
      }
      if (name === 'local_booking_step') {
        if (F.step) return { data: null, error: F.step };
        var d3 = SC.detail[args.p_booking]; d3.lt_status = args.p_to;
        if (SC.conf && SC.conf[args.p_booking]) SC.conf[args.p_booking].current = null;
        return { data: { lt_status: args.p_to, changed: true }, error: null };
      }
      return { data: null, error: { message: 'unknown rpc ' + name } };
    },
    channel: function () { return { on: function () { return this; }, subscribe: function () { return this; } }; },
    removeChannel: function () {}
  };
  window.supabase = { createClient: function () { return client; } };
})();
