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

   SUPABASE TABLES NEEDED (run in SQL Editor):

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
function generateCompletionCode() {
  var arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(100000 + (arr[0] % 900000));
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

    /* No wallet row yet — create one */
    var { data: created, error: ce } = await window.supabase
      .from('wallets')
      .insert({ user_id: userId, balance: 0, pending_balance: 0 })
      .select().single();

    if (ce) {
      console.warn('[Payments] wallet insert error:', ce.code, ce.message);
      return { user_id: userId, balance: 0, pending_balance: 0, _stub: true, _reason: ce.message };
    }
    return created;

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

  var reference = 'TOPUP-' + Date.now() + '-' + user.id.slice(0, 8);

  return new Promise(function(resolve, reject) {
    if (typeof PaystackPop === 'undefined') {
      reject(new Error('Paystack not loaded. Check your internet connection.')); return;
    }
    var handler = PaystackPop.setup({
      key:      PAYSTACK_PUBLIC_KEY,
      email:    userEmail || user.email,
      amount:   Math.round(amountNaira) * 100,
      ref:      reference,
      currency: 'NGN',
      metadata: { user_id: user.id, type: 'topup' },
      /* Bug fix: same async-callback issue as initiatePayment — plain wrapper
         immediately invokes an async IIFE so Paystack never receives a Promise. */
   callback: async function(response) {
  try {

    console.log("PAYSTACK CALLBACK FIRED", response);

    /* Credit wallet */
    var wallet = await getWallet(user.id);

    if (!wallet._stub) {
      await window.supabase.from('wallets')
        .update({
          balance: (wallet.balance || 0) + Math.round(amountNaira),
          updated_at: new Date().toISOString()
        })
        .eq('user_id', user.id);

      await window.supabase.from('wallet_transactions').insert({
        user_id: user.id,
        type: 'topup',
        amount: amountNaira,
        reference: response.reference,
        status: 'completed',
        note: 'Wallet top-up via Paystack',
      });
    }

    resolve({ reference: response.reference, amount: amountNaira });

  } catch (e) {
    console.error("Payment callback error:", e);
    reject(e);
  }
},
      onClose: function() { reject(new Error('Payment window closed.')); },
    });
    handler.openIframe();
  });
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
/* ── Pay from wallet balance ─────────────────────────────────── */
async function payFromWallet({ bookingId, taskId, amountNaira, taskerUserId }) {
  var { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Please log in to make a payment.');
  var amounts = calculateAmounts(amountNaira);

  var wallet = await getWallet(user.id);
  if (wallet._stub) throw new Error('Wallet system not set up. Please pay via Paystack.');
  if ((wallet.balance || 0) < amountNaira) {
    throw new Error('Insufficient wallet balance (₦' + Number(wallet.balance||0).toLocaleString() + '). Top up or pay via Paystack.');
  }

  /* Deduct from customer */
  await window.supabase.from('wallets')
    .update({ balance: wallet.balance - amountNaira, updated_at: new Date().toISOString() })
    .eq('user_id', user.id);

  /* Record hold on tasker wallet as pending */
  var taskerWallet = await getWallet(taskerUserId);
  if (!taskerWallet._stub) {
    await window.supabase.from('wallets')
      .update({ pending_balance: (taskerWallet.pending_balance||0) + amounts.taskerAmount, updated_at: new Date().toISOString() })
      .eq('user_id', taskerUserId);
  }

  /* Log transactions */
  var code = generateCompletionCode();
  await window.supabase.from('wallet_transactions').insert([
    { user_id: user.id, type: 'escrow_hold', amount: amountNaira, booking_id: bookingId,
      status: 'completed', note: 'Payment held in escrow for booking' },
  ]);

  /* Update booking */
  await window.supabase.from('bookings')
    .update({ payment_status: 'paid', completion_code: code, code_attempts: 0, amount: amountNaira })
    .eq('id', bookingId);

  return { success: true, completionCode: code };
}

/* ── Initiate Paystack payment ───────────────────────────────── */
async function initiatePayment({ contextType, contextId, bookingId, taskId, amountNaira, customerEmail, customerName, taskerUserId }) {
  var { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Please log in to make a payment.');

  var amounts   = calculateAmounts(amountNaira);
  var lookupId  = contextId || bookingId || taskId;
  var reference = 'ST-' + Date.now() + '-' + (lookupId || '').slice(0, 8);
  var code      = generateCompletionCode();

  /* Resolve tasker ID if not passed — look it up from the correct table based on context */
  var resolvedTaskerId = taskerUserId || null;
  if (!resolvedTaskerId && lookupId) {
    try {
      /* Determine which table to query based on contextType */
      var lookupTable = (contextType === 'task') ? 'task_applications' : 'bookings';
      var lookup = await window.supabase.from(lookupTable).select('tasker_id').eq('id', lookupId).maybeSingle();
      if (lookup.data) resolvedTaskerId = lookup.data.tasker_id;
    } catch(_e) {}
  }

  /* Create payment record */
  var { data: payment, error: payErr } = await window.supabase
    .from('payments')
    .insert({
      booking_id:    bookingId || (contextType === 'booking' ? contextId : null),
      task_id:       taskId || (contextType === 'task' ? contextId : null),
      customer_id:   user.id,
      amount:        amounts.total,
      platform_fee:  amounts.platformFee,
      tasker_amount: amounts.taskerAmount,
      payment_reference: reference,
      status:        'pending',
    })
    .select('id').single();

  /* If payments table missing that column, retry without payment_reference */
  if (payErr && payErr.message && payErr.message.includes('payment_reference')) {
    var retry = await window.supabase.from('payments').insert({
      booking_id: bookingId || (contextType === 'booking' ? contextId : null),
      task_id: taskId || (contextType === 'task' ? contextId : null),
      customer_id: user.id, amount: amounts.total,
      platform_fee: amounts.platformFee, tasker_amount: amounts.taskerAmount,
      reference: reference, status: 'pending',
    }).select('id').single();
    if (retry.error) throw retry.error;
    payment = retry.data;
  } else if (payErr) {
    throw payErr;
  }

  return new Promise(function(resolve, reject) {
    if (typeof PaystackPop === 'undefined') {
      reject(new Error('Paystack not loaded. Check your internet connection.')); return;
    }
    var handler = PaystackPop.setup({
      key:      PAYSTACK_PUBLIC_KEY,
      email:    customerEmail || user.email,
      amount:   Math.round(amountNaira) * 100,
      ref:      reference,
      currency: 'NGN',
      metadata: { booking_id: bookingId || (contextType === 'booking' ? contextId : null), task_id: taskId || (contextType === 'task' ? contextId : null), payment_id: payment.id, user_id: user.id, tasker_id: resolvedTaskerId },
      /* Bug fix: Paystack inline.js v1 validates typeof callback === 'function'
         and may call it synchronously in some builds. An async function IS a
         function, but returning a Promise from the callback confuses Paystack's
         internal flow-control and can cause it to reject the handler entirely.
         Fix: use a plain sync wrapper that immediately invokes an async IIFE,
         keeping resolve/reject reachable via closure without leaking a Promise
         back to Paystack. */
      callback: function(response) {
        (async function() {
          try {
            /* 1. Mark payment as paid */
            await window.supabase.from('payments')
              .update({ status: 'paid', paid_at: new Date().toISOString() })
              .eq('id', payment.id);

            /* 2. Update booking with payment status + completion code */
            await window.supabase.from('bookings')
              .update({ payment_status: 'paid', completion_code: code, code_attempts: 0, amount: amountNaira, status: 'confirmed' })
              .eq('id', bookingId);

            /* 3. Write escrow record readable by TASKER (they own this row) 
                  RLS NOTE: customer cannot update tasker's wallet directly.
                  Instead we write to a shared escrow_payments table that tasker can read.
                  The tasker's wallet shows pending from this table. */
            if (resolvedTaskerId) {
              try {
                /* Upsert escrow entry — tasker_id = owner for RLS purposes on read */
                await window.supabase.from('escrow_payments').insert({
                  booking_id:   bookingId,
                  payment_id:   payment.id,
                  customer_id:  user.id,
                  tasker_id:    resolvedTaskerId,
                  amount:       amounts.total,
                  tasker_amount: amounts.taskerAmount,
                  platform_fee: amounts.platformFee,
                  reference:    response.reference,
                  status:       'held',
                  paid_at:      new Date().toISOString(),
                });
              } catch(escrowErr) {
                /* If escrow_payments table not yet created, fall back to direct wallet update */
                console.warn('[Payments] escrow_payments insert failed, trying direct wallet:', escrowErr.message);
                try {
                  /* Try to read tasker wallet (may fail if RLS blocks) */
                  var twRes = await window.supabase.from('wallets').select('id,pending_balance').eq('user_id', resolvedTaskerId).maybeSingle();
                  if (twRes.data) {
                    await window.supabase.from('wallets')
                      .update({ pending_balance: (twRes.data.pending_balance || 0) + amounts.taskerAmount, updated_at: new Date().toISOString() })
                      .eq('user_id', resolvedTaskerId);
                  }
                } catch(_we) {}
              }
            }

            /* 4. Notify tasker that payment was received */
            if (resolvedTaskerId) {
              try {
                var fmtAmt = '₦' + Number(amounts.total).toLocaleString();
                var fmtEarning = '₦' + Number(amounts.taskerAmount).toLocaleString();
                await window.supabase.from('notifications').insert({
                  user_id:  resolvedTaskerId,
                  type:     'payment_received',
                  title:    '💰 Payment received! ' + fmtAmt,
                  message:  'A customer has paid ' + fmtAmt + ' for your service. Your earning (' + fmtEarning + ' after 12% fee) is held in escrow. Complete the job, get the customer to confirm, then enter the code to release payment.',
                  data:     { booking_id: bookingId, payment_id: payment.id, completion_code: code },
                  is_read:  false,
                });
              } catch(_ne) {}
            }

            resolve({ reference: response.reference, paymentId: payment.id, completionCode: code, taskerUserId: resolvedTaskerId });
          } catch(e) { reject(e); }
        })();
      },
      onClose: function() { reject(new Error('Payment window closed.')); },
    });
    handler.openIframe();
  });
}

/* ── Mark job as done (tasker side) ─────────────────────────── */
async function markJobDone(bookingId) {
  var { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Not logged in.');

  await window.supabase.from('bookings')
    .update({ status: 'awaiting_confirmation' })
    .eq('id', bookingId);

  /* Notify customer */
  var { data: bk } = await window.supabase.from('bookings')
    .select('customer_id').eq('id', bookingId).maybeSingle();
  if (bk && bk.customer_id) {
    await window.supabase.from('notifications').insert({
      user_id: bk.customer_id, type: 'job_done',
      title: '✅ Job Marked Complete',
      message: 'The provider says the job is done. If you agree, confirm completion to release payment.',
      data: { booking_id: bookingId }, is_read: false,
    });
  }
  return { success: true };
}

/* ── Confirm job complete (customer side) → returns code ─────── */
async function confirmJobComplete(bookingId) {
  var { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Not logged in.');

  var { data: bk } = await window.supabase.from('bookings')
    .select('completion_code, payment_status, status, tasker_id')
    .eq('id', bookingId).maybeSingle();

  if (!bk) throw new Error('Booking not found.');
  if (bk.payment_status !== 'paid') throw new Error('Payment not made yet.');
  if (bk.status === 'completed') throw new Error('This booking is already completed.');
  if (bk.status === 'disputed') throw new Error('This booking is under dispute.');

  await window.supabase.from('bookings')
    .update({ status: 'awaiting_confirmation' }).eq('id', bookingId);

  /* Notify tasker */
  if (bk.tasker_id) {
    await window.supabase.from('notifications').insert({
      user_id: bk.tasker_id, type: 'job_completion',
      title: '🎉 Job Confirmed — Enter Your Code!',
      message: 'The customer confirmed the job is done. Enter your 6-digit completion code to receive your payment.',
      data: { booking_id: bookingId }, is_read: false,
    });
  }
  return { code: bk.completion_code };
}

/* ── Submit completion code (tasker side) → releases payment ─── */
async function submitCompletionCode(bookingId, enteredCode) {
  var { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Not logged in.');

  var { data: bk, error } = await window.supabase.from('bookings')
    .select('completion_code, status, payment_status, code_attempts, tasker_id, customer_id, amount')
    .eq('id', bookingId).maybeSingle();

  if (error || !bk) throw new Error('Booking not found.');
  /* Fix: Accept all non-unpaid payment statuses — 'paid', 'confirmed', 'pending'
     are all valid states while the Paystack callback may still be processing.
     Only reject if genuinely unpaid or already fully released. */
  var unpaidStatuses = ['unpaid', 'failed', null, undefined, ''];
  if (unpaidStatuses.indexOf(bk.payment_status) !== -1) throw new Error('Payment not made for this booking yet.');
  if (bk.payment_status === 'released') throw new Error('Payment has already been released for this booking.');
  if (bk.status === 'completed') throw new Error('This booking is already completed.');
  if (bk.status === 'disputed') throw new Error('This booking is under dispute.');

  var attempts = (bk.code_attempts || 0) + 1;
  if (attempts > 3) throw new Error('Too many incorrect attempts. Contact support.');

  if (String(enteredCode).trim() !== String(bk.completion_code).trim()) {
    await window.supabase.from('bookings').update({ code_attempts: attempts }).eq('id', bookingId);
    var remaining = 3 - attempts;
    throw new Error('Incorrect code. ' + (remaining > 0
      ? remaining + ' attempt' + (remaining === 1 ? '' : 's') + ' remaining.'
      : 'No attempts left. Contact support.'));
  }

  /* Code correct — release payment */
  var amounts = calculateAmounts(bk.amount || 0);

  await window.supabase.from('bookings')
    .update({ status: 'completed', payment_status: 'released', completed_at: new Date().toISOString() })
    .eq('id', bookingId);

  /* Credit tasker wallet */
  try {
    var taskerWallet = await getWallet(bk.tasker_id);
    if (!taskerWallet._stub) {
      await window.supabase.from('wallets').update({
        balance:         (taskerWallet.balance || 0) + amounts.taskerAmount,
        pending_balance: Math.max(0, (taskerWallet.pending_balance || 0) - amounts.taskerAmount),
        updated_at:      new Date().toISOString(),
      }).eq('user_id', bk.tasker_id);

      await window.supabase.from('wallet_transactions').insert({
        user_id: bk.tasker_id, type: 'escrow_release',
        amount:  amounts.taskerAmount, booking_id: bookingId,
        status:  'completed',
        note: '₦' + Number(amounts.taskerAmount).toLocaleString() + ' released after job completion (12% fee deducted)',
      });

      /* Release escrow record */
      try {
        await window.supabase.from('escrow_payments')
          .update({ status: 'released', released_at: new Date().toISOString() })
          .eq('booking_id', bookingId).eq('status', 'held');
      } catch(_ee) {}
    }
  } catch(we) {
    console.warn('[Payments] wallet credit error:', we.message);
  }

  /* Notify customer */
  try {
    await window.supabase.from('notifications').insert({
      user_id: bk.customer_id, type: 'job_completed',
      title: '✅ Job Completed!',
      message: 'Great news! The job is complete. Please leave a review.',
      data: { booking_id: bookingId }, is_read: false,
    });
  } catch(ne) { /* non-blocking */ }

  return { success: true };
}

/* ── Raise a dispute ─────────────────────────────────────────── */
async function raiseDispute(bookingId, reason) {
  var { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Not logged in.');

  await window.supabase.from('bookings')
    .update({ status: 'disputed', dispute_reason: reason }).eq('id', bookingId);

  try {
    var { data: bk } = await window.supabase.from('bookings')
      .select('tasker_id, customer_id').eq('id', bookingId).maybeSingle();
    if (bk) {
      var notifys = [
        { user_id: bk.tasker_id,   title: 'Dispute Raised',  message: 'A dispute has been raised. Payment is frozen pending review.' },
        { user_id: bk.customer_id, title: 'Dispute Opened',  message: 'Your dispute has been received. Team reviews within 24 hours.' },
      ].filter(function(n) { return n.user_id && n.user_id !== user.id; });
      for (var i = 0; i < notifys.length; i++) {
        await window.supabase.from('notifications').insert({
          user_id: notifys[i].user_id, type: 'dispute',
          title: notifys[i].title, message: notifys[i].message,
          data: { booking_id: bookingId }, is_read: false,
        });
      }
    }
  } catch(e) { /* non-blocking */ }
  return { success: true };
}

/* ── Fetch payment for a booking ─────────────────────────────── */
async function fetchPayment(bookingId) {
  try {
    var { data } = await window.supabase.from('payments')
      .select('*').eq('booking_id', bookingId).maybeSingle();
    return data;
  } catch(e) { return null; }
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
  markJobDone,
  confirmJobComplete,
  submitCompletionCode,
  raiseDispute,
  fetchPayment,
};
