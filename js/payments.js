/* ============================================================
   STREET TASKER — payments.js
   Wallet + Escrow payment system with Paystack integration.

   WALLET FLOW:
   - Customers: top up wallet via Paystack → balance stays on site
   - When booking: pay from wallet OR pay fresh via Paystack
   - Service Providers: receive earnings into wallet after job completion
   - Both users: withdraw to bank account (account number + bank code)
   - Admin: 12% platform fee recorded

   ESCROW FLOW:
   1. Customer pays (wallet or Paystack) → funds held in escrow
   2. Service provider marks job as done
   3. Customer confirms → 6-digit code generated
   4. Provider enters code → earnings credited to provider wallet
   5. Either party withdraws wallet balance to bank anytime

   *** HARDENED (step 6a) ***
   The browser NEVER changes money any more. Wallets, escrow, payment status and
   completion codes are changed only by the server:
     - Paystack payments: Edge Functions payment-init -> (Paystack pop-up) -> payment-verify
       (+ paystack-webhook as a safety net). The server decides the amount and checks
       with Paystack before anything is marked paid.
     - Wallet payments, mark done, confirm, code entry, disputes: database functions
       (rpc) in sql/messaging-step6a.sql.
   See PAYMENTS-HARDENING.md. The table SQL below is the OLD set-up and is kept only
   for history: do NOT re-create those policies (they let users edit their own wallet).

   SUPABASE TABLES (OLD set-up, superseded by sql/messaging-step6a.sql):

   CREATE TABLE IF NOT EXISTS wallets (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id uuid UNIQUE REFERENCES auth.users(id),
     balance numeric DEFAULT 0,
     pending_balance numeric DEFAULT 0,
     updated_at timestamptz DEFAULT now()
   );
   CREATE TABLE IF NOT EXISTS wallet_transactions (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id uuid REFERENCES auth.users(id),
     type text,
     amount numeric,
     reference text,
     booking_id uuid,
     status text DEFAULT 'completed',
     note text,
     created_at timestamptz DEFAULT now()
   );
   ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
   ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "own_wallet" ON wallets USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
   CREATE POLICY "own_txns_read" ON wallet_transactions FOR SELECT USING (auth.uid() = user_id);
   CREATE POLICY "own_txns_write" ON wallet_transactions FOR INSERT WITH CHECK (auth.uid() = user_id);
   ============================================================ */
'use strict';

/* TESTING: swap to pk_test_... and your test secret key while testing
   LIVE:    pk_live_cd782742c439571c4b3773383f7cda0c36166c62 */
const PAYSTACK_PUBLIC_KEY = 'pk_test_84c8ce3a6ce36d6db3b15de1dc2e569424d4ca98';
const PLATFORM_COMMISSION = 0.12;

/* ── Commission calculator ───────────────────────────────────── */
function calculateAmounts(totalNaira) {
  var fee    = Math.round(totalNaira * PLATFORM_COMMISSION);
  var payout = totalNaira - fee;
  return { total: totalNaira, platformFee: fee, taskerAmount: payout };
}

/* ── Secure 6-digit completion code ─────────────────────────── */
/* ── Server calls ────────────────────────────────────────────
   Edge Functions need the logged-in user's token. The same apikey/Authorization
   pattern the gift-card functions use. */
async function _callFn(name, body) {
  var sess = await window.supabase.auth.getSession();
  var token = sess && sess.data && sess.data.session && sess.data.session.access_token;
  if (!token) throw new Error('Session expired. Please log in again.');
  var res = await fetch(SUPABASE_URL + '/functions/v1/' + name, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token },
    body: JSON.stringify(body || {}),
  });
  var data = null;
  try { data = await res.json(); } catch (_e) {}
  return { status: res.status, ok: res.ok, data: data || {} };
}

/* Run a database function as the logged-in user; our own errors are readable */
async function _rpc(name, args) {
  var r = await window.supabase.rpc(name, args || {});
  if (r.error) throw new Error(r.error.message || 'Something went wrong. Please try again.');
  return r.data;
}

/* Open the Paystack pop-up with the reference + amount the SERVER gave us.
   Resolves with Paystack's reference when the customer completes it. */
function _openPaystack(init, email, meta) {
  return new Promise(function(resolve, reject) {
    if (typeof PaystackPop === 'undefined') {
      reject(new Error('Paystack not loaded. Check your internet connection.')); return;
    }
    var done = false;
    var handler = PaystackPop.setup({
      key:      PAYSTACK_PUBLIC_KEY,
      email:    email || init.email,
      amount:   init.amountKobo,
      ref:      init.reference,
      currency: 'NGN',
      metadata: meta || {},
      /* Paystack v1 rejects async callbacks: plain function here */
      callback: function(response) { done = true; resolve(response.reference || init.reference); },
      onClose:  function() { if (!done) reject(new Error('Payment window closed.')); },
    });
    handler.openIframe();
  });
}

/* Ask the server to confirm the payment with Paystack. Paystack can take a moment
   to report a successful charge, so wait and retry briefly before giving up. */
async function _verifyPayment(reference) {
  var last = null;
  for (var attempt = 0; attempt < 6; attempt++) {
    var r = await _callFn('payment-verify', { reference: reference });
    if (r.ok && r.data && r.data.ok) return r.data;
    last = r;
    if (r.status !== 202) break;                       /* 202 = not confirmed yet: wait and retry */
    await new Promise(function(res){ setTimeout(res, 2000); });
  }
  var msg = (last && last.data && last.data.error) || 'We could not confirm your payment yet.';
  if (last && last.status === 202) {
    msg = 'Your payment is being confirmed. If you were charged, it will show here shortly. You do not need to pay again.';
  }
  throw new Error(msg);
}

/* ══════════════════════════════════════════════════════════════
   WALLET FUNCTIONS
══════════════════════════════════════════════════════════════ */

/* ── Check if wallet tables exist ───────────────────────────── */
async function _walletsExist() {
  try {
    var { error } = await window.supabase
      .from('wallets').select('id').limit(1);
    /* If table missing, error.code = '42P01' or message contains 'relation' */
    if (error && (error.code === '42P01' || (error.message && error.message.includes('relation')))) {
      return false;
    }
    return true;
  } catch(e) {
    return false;
  }
}

/* ── Get or create wallet ────────────────────────────────────── */
async function getWallet(userId) {
  try {
    /* First check the table exists to give a clear error */
    var { data, error } = await window.supabase
      .from('wallets').select('*').eq('user_id', userId).maybeSingle();

    /* Table doesn't exist */
    if (error && (error.code === '42P01' || (error.message && error.message.includes('relation')))) {
      console.warn('[Payments] wallets table not found. Run SQL setup in Supabase.');
      return { user_id: userId, balance: 0, pending_balance: 0, _stub: true, _reason: 'table_missing' };
    }

    /* Any other error (RLS, network, etc.) */
    if (error && error.code !== 'PGRST116') {
      console.warn('[Payments] getWallet error:', error.code, error.message);
      return { user_id: userId, balance: 0, pending_balance: 0, _stub: true, _reason: error.message };
    }

    /* Wallet exists — augment pending_balance from escrow_payments if available */
    if (data) {
      try {
        var escrowRes = await window.supabase.from('escrow_payments')
          .select('tasker_amount')
          .eq('tasker_id', userId)
          .eq('status', 'held');
        if (!escrowRes.error && escrowRes.data && escrowRes.data.length > 0) {
          var escrowPending = escrowRes.data.reduce(function(s, r){ return s + (r.tasker_amount || 0); }, 0);
          /* Use the higher of the two values (wallet.pending_balance may already reflect some) */
          if (escrowPending > (data.pending_balance || 0)) {
            data.pending_balance = escrowPending;
          }
        }
      } catch(_ee) { /* escrow_payments table may not exist yet — that's OK */ }
      return data;
    }

    /* No wallet row yet — ask the server to create the user's own wallet */
    var { data: { user: me } } = await window.supabase.auth.getUser();
    if (me && me.id === userId) {
      try {
        await window.supabase.rpc('ensure_my_wallet');
        var again = await window.supabase.from('wallets').select('*').eq('user_id', userId).maybeSingle();
        if (again.data) return again.data;
      } catch (_w) {}
    }
    return { user_id: userId, balance: 0, pending_balance: 0, _stub: true, _reason: 'no_wallet' };

  } catch(e) {
    console.warn('[Payments] getWallet exception:', e.message);
    return { user_id: userId, balance: 0, pending_balance: 0, _stub: true, _reason: e.message };
  }
}

/* ── Fetch wallet transaction history ───────────────────────── */
async function fetchWalletTransactions(userId, limit) {
  try {
    var { data, error } = await window.supabase
      .from('wallet_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit || 20);

    /* Table missing — not a fatal error, just return empty */
    if (error && (error.code === '42P01' || (error.message && error.message.includes('relation')))) {
      return [];
    }
    if (error) {
      console.warn('[Payments] fetchWalletTransactions error:', error.message);
      return [];
    }
    return data || [];
  } catch(e) {
    console.warn('[Payments] fetchWalletTransactions exception:', e.message);
    return [];
  }
}

/* ── Top up wallet via Paystack ──────────────────────────────── */
async function topUpWallet(amountNaira, userEmail) {
  var { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Please log in first.');
  if (!amountNaira || amountNaira < 100) throw new Error('Minimum top-up is ₦100.');

  var init = await _callFn('payment-init', { purpose: 'topup', amount: Math.round(amountNaira) });
  if (!init.ok) throw new Error(init.data.error || 'Could not start the top-up.');

  var reference = await _openPaystack(init.data, userEmail || user.email, { type: 'topup' });
  /* The wallet is credited by the server only after Paystack confirms the payment */
  await _verifyPayment(reference);
  return { reference: reference, amount: Math.round(amountNaira) };
}

/* ── Withdraw from wallet to bank — calls Edge Function ─────── */
async function withdrawFromWallet(amountNaira, bankCode, accountNumber, accountName) {
  var { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Please log in first.');

  var wallet = await getWallet(user.id);
  if (wallet._stub) throw new Error('Wallet system not set up. Contact support.');
  if ((wallet.balance || 0) < amountNaira) {
    throw new Error('Insufficient balance (₦' + Number(wallet.balance||0).toLocaleString() + ' available).');
  }
  if (!accountNumber || accountNumber.length !== 10) throw new Error('Account number must be exactly 10 digits.');
  if (!bankCode) throw new Error('Please enter your bank name.');
  if (!accountName) throw new Error('Please enter the account name.');

 /* Call the Supabase Edge Function — this is where the real bank transfer happens */

const { data: { session } } = await window.supabase.auth.getSession();

if (!session || !session.access_token) {
  throw new Error('Session expired. Please log in again.');
}

const token = session.access_token;

var edgeFnUrl = 'https://ftoiqbacutnbjnztguts.supabase.co/functions/v1/process-withdrawal';

var res = await fetch(edgeFnUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token,
  },
  body: JSON.stringify({
    amount: Math.round(amountNaira),
    bank_name: bankCode,
    account_number: accountNumber,
    account_name: accountName,
  }),
});

var data = await res.json();

if (!res.ok || !data.success) {
  throw new Error(data.error || 'Withdrawal failed. Please try again.');
}

return {
  success: true,
  newBalance: data.new_balance,
  message: data.message
};
}
/* ── Pay from wallet balance ─────────────────────────────────
   The server checks the balance, takes the money and holds it in escrow.
   amountNaira / taskerUserId are ignored: the server knows the price and the tasker. */
async function payFromWallet({ bookingId, requestId }) {
  var { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Please log in to make a payment.');
  var r = await _rpc('pay_with_wallet', requestId ? { p_request: requestId } : { p_booking: bookingId });
  return { success: true, firstPayment: !!(r && r.first_payment), amount: r && r.amount, bookingId: r && r.booking_id };
}

/* ── Initiate Paystack payment ───────────────────────────────
   Pass requestId (a payment request from Messages) or bookingId (a booking with a price).
   The amount the customer is charged is decided by the server; amountNaira is only
   kept so older callers keep working and is NEVER used to charge. */
async function initiatePayment({ requestId, bookingId, contextType, contextId, customerEmail }) {
  var { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Please log in to make a payment.');

  var body = requestId
    ? { purpose: 'request', requestId: requestId }
    : { purpose: 'booking', bookingId: bookingId || (contextType === 'booking' ? contextId : null) };
  if (body.purpose === 'booking' && !body.bookingId) {
    throw new Error('No booking found for this payment.');
  }

  var init = await _callFn('payment-init', body);
  if (!init.ok) throw new Error(init.data.error || 'Could not start the payment.');

  var reference = await _openPaystack(init.data, customerEmail || user.email,
    { user_id: user.id, booking_id: init.data.bookingId, request_id: init.data.requestId });
  var res = await _verifyPayment(reference);

  return {
    reference: reference, amount: res.amount, bookingId: res.booking_id,
    firstPayment: !!res.first_payment, topUp: !!res.top_up,
    platformFee: res.platform_fee, taskerAmount: res.tasker_amount,
  };
}

/* ── The customer's completion code (only the customer can read it) ─ */
async function getCompletionCode(bookingId) {
  return await _rpc('get_completion_code', { p_booking: bookingId });
}

/* ── Mark job as done (tasker side) ─────────────────────────── */
async function markJobDone(bookingId, note) {
  var { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Not logged in.');
  await _rpc('job_mark_done', note ? { p_booking: bookingId, p_note: note } : { p_booking: bookingId });
  return { success: true };
}

/* ── Customer sends completed work back (step 7) ─────────────── */
async function requestJobChanges(bookingId, note) {
  var { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Not logged in.');
  await _rpc('job_request_changes', { p_booking: bookingId, p_note: note });
  return { success: true };
}

/* ── On-site progress (tasker): on_my_way | arrived | start | pause | resume (step 7) ─ */
async function jobProgress(bookingId, action, note) {
  var { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Not logged in.');
  var args = { p_booking: bookingId, p_action: action };
  if (note) args.p_note = note;
  var r = await _rpc('job_progress', args);
  return { success: true, stage: r && r.stage };
}

/* ── Confirm job complete (customer side) → returns code ─────── */
async function confirmJobComplete(bookingId) {
  var { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Not logged in.');
  var r = await _rpc('job_confirm_complete', { p_booking: bookingId });
  return { code: r && r.code };
}

/* ── Submit completion code (tasker side) → releases payment ───
   The code is checked on the server. The tasker never has it in their browser. */
async function submitCompletionCode(bookingId, enteredCode) {
  var { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Not logged in.');
  var r = await _rpc('job_submit_code', { p_booking: bookingId, p_code: String(enteredCode || '').trim() });
  if (!r || !r.ok) throw new Error((r && r.error) || 'Could not release the payment.');
  return { success: true };
}

/* ── Raise a dispute ─────────────────────────────────────────── */
async function raiseDispute(bookingId, reason) {
  var { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Not logged in.');
  await _rpc('job_raise_dispute', { p_booking: bookingId, p_reason: reason });
  return { success: true };
}

/* ── Fetch payment for a booking ─────────────────────────────── */
async function fetchPayment(bookingId) {
  try {
    /* limit(1): a booking can now have several payments (top-ups) */
    var { data } = await window.supabase.from('payments')
      .select('*').eq('booking_id', bookingId).limit(1).maybeSingle();
    return data;
  } catch(e) { return null; }
}

/* ── Gift cards ──────────────────────────────────────────────────
   Gift money is taken by the gift-card-pay Edge Function, never by this browser code.
   The server works out the price and which cards may be used, then confirms the booking itself. */
function giftCall(action, payload) {
  return window.supabase.auth.getSession().then(function (r) {
    var token = r.data && r.data.session && r.data.session.access_token;
    if (!token) throw new Error('Please log in to continue.');
    return fetch(SUPABASE_URL + '/functions/v1/gift-card-pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token },
      body: JSON.stringify(Object.assign({ action: action }, payload))
    });
  }).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (d) {
      if (!res.ok) { var e = new Error(d.error || 'Gift card payment failed.'); e.code = d.code; throw e; }
      return d;
    });
  });
}

/* How much of this booking, or of this chat payment request, the customer's gift cards can cover
   (null if none or on any error).  getGiftQuote(bookingId)  or  getGiftQuote({ requestId }) */
function getGiftQuote(target) {
  var payload = (target && typeof target === 'object') ? { requestId: target.requestId } : { bookingId: target };
  return giftCall('quote', payload).catch(function () { return null; });
}

/* Pay a booking (opts.bookingId) or a chat payment request (opts.requestId) with gift cards,
   and Paystack for whatever the cards cannot cover */
async function payWithGiftCards(opts) {
  var d = await giftCall('pay', opts.requestId ? { requestId: opts.requestId } : { bookingId: opts.bookingId });
  if (d.done) return d;

  if (typeof PaystackPop === 'undefined') {
    giftCall('cancel', { holdId: d.holdId }).catch(function () {});
    throw new Error('Paystack not loaded. Check your internet connection.');
  }
  var u = await window.supabase.auth.getUser();
  var email = opts.customerEmail || (u.data.user && u.data.user.email);

  return new Promise(function (resolve, reject) {
    var paid = false;
    function finish(triesLeft) {
      giftCall('finish', { holdId: d.holdId }).then(resolve, function (err) {
        if (err.code === 'not_paid' && triesLeft > 0) setTimeout(function () { finish(triesLeft - 1); }, 2000);
        else reject(err);
      });
    }
    PaystackPop.setup({
      key: PAYSTACK_PUBLIC_KEY, email: email, amount: d.remainder * 100, ref: d.reference, currency: 'NGN',
      metadata: { booking_id: opts.bookingId, request_id: opts.requestId, gift_hold_id: d.holdId },
      callback: function () { paid = true; finish(3); },
      onClose: function () {
        if (paid) return;
        giftCall('cancel', { holdId: d.holdId }).catch(function () {});
        reject(new Error('Payment window closed. Click pay again to retry.'));
      }
    }).openIframe();
  });
}

/* ── Expose globally ─────────────────────────────────────────── */
window.ST = window.ST || {};
window.ST.payments = {
  calculateAmounts,
  getWallet,
  fetchWalletTransactions,
  topUpWallet,
  withdrawFromWallet,
  payFromWallet,
  initiatePayment,
  getGiftQuote,
  payWithGiftCards,
  markJobDone,
  confirmJobComplete,
  submitCompletionCode,
  raiseDispute,
  getCompletionCode,
  requestJobChanges,
  jobProgress,
  fetchPayment,
};
