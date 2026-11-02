/* Test double for the Supabase UMD global, Stage 7C-1c. It is the 5D-3b double (base-fake.js, concatenated before this file by the runner)
   plus two functions that behave like local_booking_code_state and local_booking_submit_code.
   Scenario window.__SC.rel = { <booking id>: { state, remaining, code } }. The REAL code lives only here, never on the page.
   Recorded: window.__state (calls), window.__submit (calls). Failures: SC.fail.state, SC.fail.submit ('throw' | 'error' | 'hint:<x>'). */
(function () {
  var created = window.supabase.createClient;
  window.supabase.createClient = function () {
    var client = created.apply(this, arguments), base = client.rpc, SC = window.__SC || {};
    window.__state = []; window.__submit = [];
    client.rpc = async function (name, args) {
      var F = SC.fail || {}, R = (SC.rel || {})[args && args.p_booking];
      if (name === 'local_booking_code_state') {
        window.__state.push(args);
        if (F.state) return { data: null, error: { message: 'boom' } };
        if (!R) return { data: null, error: { code: 'P0001', hint: 'not_found', message: 'Booking not found.' } };
        return { data: { state: R.state, remaining: R.remaining }, error: null };
      }
      if (name === 'local_booking_submit_code') {
        window.__submit.push(args);
        if (F.submit === 'throw') throw new Error('network down');
        if (F.submit === 'error') return { data: null, error: { message: 'server' } };
        if (F.submit && String(F.submit).indexOf('hint:') === 0) return { data: null, error: { code: 'P0001', hint: F.submit.slice(5), message: 'Booking not found.' } };
        if (!R) return { data: null, error: { code: 'P0001', hint: 'not_found', message: 'Booking not found.' } };
        if (R.state === 'locked') return { data: { ok: false, reason: 'locked', remaining: 0, error: 'x' }, error: null };
        if (R.state === 'frozen') return { data: { ok: false, reason: 'frozen', error: 'x' }, error: null };
        if (R.state === 'not_paid') return { data: { ok: false, reason: 'not_paid', error: 'x' }, error: null };
        if (R.state === 'released') return { data: { ok: false, reason: 'already_released', error: 'x' }, error: null };
        if (String(args.p_code).trim() !== R.code) {
          R.attempts = (R.attempts || 0) + 1; R.remaining = Math.max(0, 3 - R.attempts - (3 - (R.start || 3)));
          if (R.remaining <= 0) R.state = 'locked';
          return { data: { ok: false, reason: 'wrong_code', remaining: R.remaining, error: 'Incorrect code.' }, error: null };
        }
        R.state = 'released'; R.remaining = 0;
        if (SC.detail && SC.detail[args.p_booking]) { SC.detail[args.p_booking].booking_status = 'completed'; SC.detail[args.p_booking].payment_status = 'released'; SC.detail[args.p_booking].open = false; }
        return { data: { ok: true }, error: null };
      }
      return base.call(client, name, args);
    };
    return client;
  };
})();
