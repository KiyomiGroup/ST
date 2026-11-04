/* Test double for the Supabase UMD global on the coordinator BOOKING pages (stages 5B, 5C-1, 5C-2, 5D-2, 5D-3a, 5D-3b). Scenario: window.__SC.
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
      if (name === 'local_booking_milestones') {
        if (F.ms) return { data: null, error: { message: 'boom' } };
        var dm = (SC.detail || {})[args.p_booking];
        if (!dm) return { data: null, error: { code: 'P0001', hint: 'not_found', message: 'Booking not found.' } };
        SC.ms = SC.ms || {}; var items = SC.ms[args.p_booking] = SC.ms[args.p_booking] || [];
        var ORDER = ['address_confirmed', 'arrived', 'started', 'finished'];
        var nxt = ORDER.filter(function (k) { return !items.some(function (i) { return i.kind === k; }); })[0] || null;
        var blocked = dm.lt_status !== 'quote_approved' ? 'not_approved' : !nxt ? 'all_recorded' : (nxt === 'started' && !SC.paid) ? 'payment_needed' : null;
        return { data: { booking_id: args.p_booking, lt_status: dm.lt_status, items: items, next_kind: nxt, can_record: blocked === null, blocked_reason: blocked }, error: null };
      }
      if (name === 'local_booking_record_milestone') {
        window.__ms = (window.__ms || []).concat([args]);
        if (F.msRecord) { var fr = Array.isArray(F.msRecord) ? F.msRecord.shift() : F.msRecord; if (fr) return { data: null, error: fr }; }
        SC.ms = SC.ms || {}; var it = SC.ms[args.p_booking] = SC.ms[args.p_booking] || [];
        it.push({ kind: args.p_kind, happened_at: args.p_happened_at, recorded_at: args.p_happened_at, note: args.p_note });
        return { data: { kind: args.p_kind, happened_at: args.p_happened_at, changed: true, duplicate: false }, error: null };
      }
      if (name === 'local_booking_exceptions') {
        if (F.ex) return { data: null, error: { message: 'boom' } };
        var de = (SC.detail || {})[args.p_booking];
        if (!de) return { data: null, error: { code: 'P0001', hint: 'not_found', message: 'Booking not found.' } };
        SC.exs = SC.exs || {}; var xi = SC.exs[args.p_booking] = SC.exs[args.p_booking] || [];
        var nU = xi.filter(function (i) { return i.kind === 'customer_unreachable'; }).length, standing = xi.some(function (i) { return i.kind === 'tasker_no_show'; });
        var arrived = (SC.ms && SC.ms[args.p_booking] || []).some(function (i) { return i.kind === 'arrived'; }) || !!SC.arrived;
        var okStep = de.lt_status === 'quote_sent' || de.lt_status === 'quote_approved';
        var uB = !okStep ? 'wrong_step' : nU >= 5 ? 'limit_reached' : null;
        var nB = de.lt_status !== 'quote_approved' ? 'wrong_step' : arrived ? 'already_arrived' : standing ? 'already_recorded' : null;
        return { data: { booking_id: args.p_booking, lt_status: de.lt_status, items: xi, can_unreachable: uB === null, unreachable_blocked: uB, can_no_show: nB === null, no_show_blocked: nB, no_show_standing: standing, can_go_back: !arrived }, error: null };
      }
      if (name === 'local_booking_record_exception') {
        window.__ex = (window.__ex || []).concat([args]);
        if (F.exRecord) { var fx = Array.isArray(F.exRecord) ? F.exRecord.shift() : F.exRecord; if (fx) return { data: null, error: fx }; }
        SC.exs = SC.exs || {}; var xl = SC.exs[args.p_booking] = SC.exs[args.p_booking] || [];
        xl.push({ kind: args.p_kind, happened_at: args.p_happened_at, recorded_at: args.p_happened_at, note: args.p_note });
        return { data: { kind: args.p_kind, happened_at: args.p_happened_at, changed: true, duplicate: false }, error: null };
      }
      if (name === 'local_booking_closeout') {
        if (F.co) return { data: null, error: { message: 'boom' } };
        var dc = (SC.detail || {})[args.p_booking];
        if (!dc) return { data: null, error: { code: 'P0001', hint: 'not_found', message: 'Booking not found.' } };
        SC.co = SC.co || {}; var c0 = SC.co[args.p_booking] = SC.co[args.p_booking] || { can_cancel: true, cancel_blocked: null, can_report: true, report_blocked: null, cancellation: null, problems: [] };
        return { data: Object.assign({ booking_id: args.p_booking, lt_status: dc.lt_status, booking_status: dc.booking_status }, c0), error: null };
      }
      if (name === 'local_booking_cancel') {
        window.__cancel = (window.__cancel || []).concat([args]);
        if (F.cancel) { var fc = Array.isArray(F.cancel) ? F.cancel.shift() : F.cancel; if (fc) return { data: null, error: fc }; }
        var cc = SC.co[args.p_booking];
        cc.cancellation = { reason: args.p_reason, note: args.p_note, at: '2026-10-29T09:00:00Z' }; cc.can_cancel = false; cc.cancel_blocked = 'booking_closed'; cc.can_report = false; cc.report_blocked = 'booking_closed';
        SC.detail[args.p_booking].booking_status = 'cancelled'; SC.detail[args.p_booking].open = false;
        return { data: { cancelled: true, changed: true, duplicate: false, requests_cancelled: 2 }, error: null };
      }
      if (name === 'local_booking_open_problem') {
        window.__report = (window.__report || []).concat([args]);
        if (F.report) { var fr2 = Array.isArray(F.report) ? F.report.shift() : F.report; if (fr2) return { data: null, error: fr2 }; }
        var cr = SC.co[args.p_booking];
        cr.problems = [{ dispute_id: '55555555-5555-4555-8555-555555555555', category: args.p_category, status: 'open', opened_at: '2026-10-29T09:00:00Z', can_withdraw: true }].concat(cr.problems);
        cr.can_cancel = false; cr.cancel_blocked = 'dispute_open'; cr.can_report = false; cr.report_blocked = 'dispute_open';
        return { data: { dispute_id: '55555555-5555-4555-8555-555555555555', changed: true, duplicate: false }, error: null };
      }
      if (name === 'local_booking_withdraw_problem') {
        window.__withdraw = (window.__withdraw || []).concat([args]);
        if (F.withdraw) return { data: null, error: F.withdraw };
        var cw = SC.co[args.p_booking];
        cw.problems = cw.problems.map(function (p) { return p.dispute_id === args.p_dispute ? Object.assign({}, p, { status: 'withdrawn', can_withdraw: false }) : p; });
        cw.can_cancel = true; cw.cancel_blocked = null; cw.can_report = true; cw.report_blocked = null;
        return { data: { withdrawn: true, changed: true }, error: null };
      }

      if (name === 'local_booking_extras') {
        if (F.ex) return { data: null, error: { message: 'boom' } };
        var de = (SC.detail || {})[args.p_booking];
        if (!de) return { data: null, error: { code: 'P0001', hint: 'not_found', message: 'Booking not found.' } };
        SC.ex = SC.ex || {}; var e0 = SC.ex[args.p_booking] = SC.ex[args.p_booking] || { can_request: true, blocked: null, room: 30000, items: [] };
        return { data: e0, error: null };
      }
      if (name === 'local_booking_request_extra') {
        window.__extra = (window.__extra || []).concat([args]);
        if (F.extra) { var fx = Array.isArray(F.extra) ? F.extra.shift() : F.extra; if (fx) return { data: null, error: fx }; }
        var ee = SC.ex[args.p_booking];
        ee.items = [{ id: '66666666-6666-4666-8666-666666666666', kind: args.p_kind, amount: args.p_amount, title: args.p_title, status: 'pending', created_at: '2026-10-29T09:00:00Z', can_cancel: true }].concat(ee.items);
        ee.can_request = false; ee.blocked = 'one_waiting'; ee.room = ee.room - args.p_amount;
        return { data: { requested: true, changed: true, duplicate: false, payment_request_id: '77777777-7777-4777-8777-777777777777' }, error: null };
      }
      if (name === 'local_booking_cancel_extra') {
        window.__unextra = (window.__unextra || []).concat([args]);
        var ew = SC.ex[args.p_booking];
        ew.items = ew.items.map(function (x) { return x.id === args.p_extra ? Object.assign({}, x, { status: 'cancelled', can_cancel: false }) : x; });
        ew.can_request = true; ew.blocked = null; ew.room = 30000;
        return { data: { cancelled: true, changed: true }, error: null };
      }
      return { data: null, error: { message: 'unknown rpc ' + name } };
    },
    channel: function () { return { on: function () { return this; }, subscribe: function () { return this; } }; },
    removeChannel: function () {}
  };
  window.supabase = { createClient: function () { return client; } };
})();
