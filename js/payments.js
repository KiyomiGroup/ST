/* ============================================================
   STREET TASKER — payments.js
   Wallet + Escrow payment system with Paystack integration.

   WALLET FLOW:
   - Customers: top up wallet via Paystack → balance stays on site
   - When booking: pay from wallet OR pay fresh via Paystack
   - Service Providers: receive earnings into wallet after job completion
   - Both users: withdraw to bank account (account number + bank code)
   - Admin: 12% platform fee goes to admin Paystack subaccount

   ESCROW FLOW:
   1. Customer pays (wallet or Paystack) → funds held in escrow
   2. Service provider marks job as done (dashboard or chat)
   3. Customer confirms → 6-digit code generated
   4. Provider enters code → earnings credited to provider wallet
   5. Either party withdraws wallet balance to bank anytime

   SUPABASE TABLES NEEDED (SQL editor):
   CREATE TABLE wallets (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id uuid UNIQUE REFERENCES auth.users(id),
     balance numeric DEFAULT 0,
     pending_balance numeric DEFAULT 0,
     updated_at timestamptz DEFAULT now()
   );
   CREATE TABLE wallet_transactions (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id uuid REFERENCES auth.users(id),
     type text, -- topup | earning | withdrawal | escrow_hold | escrow_release
     amount numeric,
     reference text,
     booking_id uuid,
     status text DEFAULT 'completed',
     note text,
     created_at timestamptz DEFAULT now()
   );
   ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
   ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "users manage own wallet" ON wallets USING (auth.uid() = user_id);
   CREATE POLICY "users view own txns" ON wallet_transactions USING (auth.uid() = user_id);
   -- Service role bypass needed for cross-user wallet updates (use Supabase Edge Function in prod)
   ============================================================ */
'use strict';

const PAYSTACK_PUBLIC_KEY = 'pk_live_cd782742c439571c4b3773383f7cda0c36166c62';
const PLATFORM_COMMISSION = 0.12;

/* ── Commission calculator ───────────────────────────────────── */
function calculateAmounts(totalNaira) {
  var fee    = Math.round(totalNaira * PLATFORM_COMMISSION);
  var payout = totalNaira - fee;
  return { total: totalNaira, platformFee: fee, taskerAmount: payout };
}

/* ── Generate a secure 6-digit completion code ───────────────── */
function generateCompletionCode() {
  var arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(100000 + (arr[0] % 900000));
}

/* ══════════════════════════════════════════════════════════════
   WALLET FUNCTIONS
══════════════════════════════════════════════════════════════ */

/* ── Get or create wallet for current user ───────────────────── */
async function getWallet(userId) {
  try {
    var { data, error } = await window.supabase
      .from('wallets').select('*').eq('user_id', userId).maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    if (!data) {
      var { data: created, error: ce } = await window.supabase
        .from('wallets').insert({ user_id: userId, balance: 0, pending_balance: 0 })
        .select().single();
      if (ce) {
        console.warn('Wallets table not yet created:', ce.message);
        return { user_id: userId, balance: 0, pending_balance: 0, _stub: true };
      }
      return created;
    }
    return data;
  } catch(e) {
    console.warn('getWallet error:', e.message);
    return { user_id: userId, balance: 0, pending_balance: 0, _stub: true };
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
    var settled = false;
    var handler = PaystackPop.setup({
      key: PAYSTACK_PUBLIC_KEY, email: userEmail || user.email,
      amount: Math.round(amountNaira) * 100, currency: 'NGN', reference: reference,
      metadata: { custom_fields: [
        { display_name: 'Platform', variable_name: 'platform', value: 'StreetTasker' },
        { display_name: 'Type', variable_name: 'type', value: 'wallet_topup' },
      ]},
      callback: async function(response) {
        if (settled) return; settled = true;
        try {
          var wallet = await getWallet(user.id);
          if (!wallet._stub) {
            await window.supabase.from('wallets')
              .update({ balance: (wallet.balance || 0) + Math.round(amountNaira), updated_at: new Date().toISOString() })
              .eq('user_id', user.id);
            window.supabase.from('wallet_transactions').insert({
              user_id: user.id, type: 'topup', amount: Math.round(amountNaira),
              reference: response.reference, status: 'completed', note: 'Wallet top-up via Paystack',
            }).catch(function(){});
          }
          resolve({ reference: response.reference, amount: amountNaira });
        } catch(e) { reject(e); }
      },
      onClose: function() { if (settled) return; settled = true; reject(new Error('Top-up cancelled.')); },
    });
    handler.openIframe();
  });
}

/* ── Withdraw from wallet to bank ───────────────────────────── */
async function withdrawFromWallet(amountNaira, bankCode, accountNumber, accountName) {
  var { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Not logged in.');
  var wallet = await getWallet(user.id);
  if (wallet._stub) throw new Error('Wallet system not yet set up. Please contact support.');
  if ((wallet.balance || 0) < amountNaira) throw new Error('Insufficient wallet balance.');
  if (amountNaira < 500) throw new Error('Minimum withdrawal is ₦500.');

  var newBalance = (wallet.balance || 0) - Math.round(amountNaira);
  await window.supabase.from('wallets')
    .update({ balance: newBalance, updated_at: new Date().toISOString() })
    .eq('user_id', user.id);

  await window.supabase.from('wallet_transactions').insert({
    user_id: user.id, type: 'withdrawal', amount: Math.round(amountNaira), status: 'pending',
    note: 'Withdrawal to ' + accountName + ' — ' + bankCode + ' ' + accountNumber,
    reference: 'WD-' + Date.now() + '-' + user.id.slice(0, 6),
  }).catch(function(){});

  /* TODO: POST to Supabase Edge Function → Paystack Transfer API in production */
  return { success: true, newBalance: newBalance };
}

/* ── Fetch wallet transaction history ───────────────────────── */
async function fetchWalletTransactions(userId, limit) {
  var { data } = await window.supabase.from('wallet_transactions')
    .select('*').eq('user_id', userId)
    .order('created_at', { ascending: false }).limit(limit || 20);
  return data || [];
}

/* ══════════════════════════════════════════════════════════════
   PAYMENT FUNCTIONS
══════════════════════════════════════════════════════════════ */

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

  /* Deduct from customer wallet */
  await window.supabase.from('wallets')
    .update({ balance: (wallet.balance||0) - Math.round(amountNaira), updated_at: new Date().toISOString() })
    .eq('user_id', user.id);

  /* Add to provider pending_balance */
  if (taskerUserId) {
    try {
      var tWallet = await getWallet(taskerUserId);
      if (!tWallet._stub) {
        await window.supabase.from('wallets')
          .update({ pending_balance: (tWallet.pending_balance||0) + amounts.taskerAmount, updated_at: new Date().toISOString() })
          .eq('user_id', taskerUserId);
      }
    } catch(e) {}
  }

  var reference = 'ST-W-' + Date.now() + '-' + bookingId.slice(0, 8);
  var code = generateCompletionCode();

  /* Create payment record */
  await window.supabase.from('payments').insert({
    booking_id: bookingId, task_id: taskId||null, customer_id: user.id,
    amount: amounts.total, platform_fee: amounts.platformFee, tasker_amount: amounts.taskerAmount,
    status: 'paid', reference: reference, paid_at: new Date().toISOString(),
  }).catch(async function() {
    await window.supabase.from('payments')
      .update({ status: 'paid', paid_at: new Date().toISOString(), reference: reference })
      .eq('booking_id', bookingId).eq('status', 'pending');
  });

  await window.supabase.from('bookings')
    .update({ payment_status: 'paid', status: 'in_progress', completion_code: code, payment_ref: reference })
    .eq('id', bookingId);

  /* Log transaction */
  window.supabase.from('wallet_transactions').insert({
    user_id: user.id, type: 'escrow_hold', amount: amounts.total,
    reference: reference, booking_id: bookingId, status: 'completed', note: 'Payment held in escrow',
  }).catch(function(){});

  /* Notify tasker */
  try {
    var { data: bk } = await window.supabase.from('bookings').select('tasker_id').eq('id', bookingId).maybeSingle();
    if (bk && bk.tasker_id) {
      await window.supabase.from('notifications').insert({
        user_id: bk.tasker_id, type: 'payment_received',
        title: 'Payment Received! 💰',
        message: 'Customer paid from their wallet. Get started, then mark the job as done when complete.',
        data: { booking_id: bookingId }, is_read: false,
      });
    }
  } catch(e) {}

  return { reference, code, source: 'wallet' };
}

/* ── Initiate Paystack payment ───────────────────────────────── */
async function initiatePayment({ bookingId, taskId, amountNaira, customerEmail, customerName, taskerUserId }) {
  var { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Please log in to make a payment.');
  var amounts = calculateAmounts(amountNaira);

  var payment;
  var { data: existing } = await window.supabase.from('payments')
    .select('*').eq('booking_id', bookingId).eq('status', 'pending').maybeSingle();

  var reference = 'ST-' + Date.now() + '-' + bookingId.slice(0, 8);
  if (existing) {
    await window.supabase.from('payments')
      .update({ reference: reference, amount: amounts.total, platform_fee: amounts.platformFee, tasker_amount: amounts.taskerAmount })
      .eq('id', existing.id);
    payment = Object.assign({}, existing, { reference: reference });
  } else {
    var { data: created, error: payErr } = await window.supabase.from('payments')
      .insert({ booking_id: bookingId, task_id: taskId||null, customer_id: user.id,
        amount: amounts.total, platform_fee: amounts.platformFee, tasker_amount: amounts.taskerAmount,
        status: 'pending', reference: reference })
      .select().single();
    if (payErr) throw payErr;
    payment = created;
  }

  return new Promise(function(resolve, reject) {
    if (typeof PaystackPop === 'undefined') {
      reject(new Error('Paystack not loaded.')); return;
    }
    var settled = false;
    var handler = PaystackPop.setup({
      key: PAYSTACK_PUBLIC_KEY, email: customerEmail || user.email,
      amount: amounts.total * 100, currency: 'NGN', reference: reference,
      metadata: { custom_fields: [
        { display_name: 'Platform', variable_name: 'platform', value: 'StreetTasker' },
        { display_name: 'Booking ID', variable_name: 'booking_id', value: bookingId },
      ]},
      callback: function(response) {
        if (settled) return; settled = true;
        _onPaystackSuccess(response.reference, payment.id, bookingId, amounts, taskerUserId)
          .then(function(result) { resolve({ reference: response.reference, paymentId: payment.id, code: result.code, source: 'paystack' }); })
          .catch(function(e) { reject(e); });
      },
      onClose: function() {
        if (settled) return; settled = true;
        reject(new Error('Payment window closed. Click pay again to retry.'));
      },
    });
    handler.openIframe();
  });
}

/* ── Called after Paystack confirms payment ──────────────────── */
async function _onPaystackSuccess(reference, paymentId, bookingId, amounts, taskerUserId) {
  var code = generateCompletionCode();

  await window.supabase.from('payments')
    .update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', paymentId);

  await window.supabase.from('bookings')
    .update({ payment_status: 'paid', status: 'in_progress', completion_code: code, payment_ref: reference })
    .eq('id', bookingId);

  /* Add to provider pending_balance */
  if (taskerUserId && amounts) {
    try {
      var tWallet = await getWallet(taskerUserId);
      if (!tWallet._stub) {
        await window.supabase.from('wallets')
          .update({ pending_balance: (tWallet.pending_balance||0) + amounts.taskerAmount, updated_at: new Date().toISOString() })
          .eq('user_id', taskerUserId);
      }
    } catch(e) {}
  }

  /* Mark payment_request paid */
  try {
    var { data: bkThread } = await window.supabase.from('message_threads')
      .select('id').or('context_id.eq.' + bookingId).maybeSingle();
    if (bkThread) {
      await window.supabase.from('payment_requests')
        .update({ status: 'paid' }).eq('thread_id', bkThread.id).in('status', ['pending', 'accepted']);
    }
  } catch(_e) {}

  /* Notify tasker */
  try {
    var { data: bk } = await window.supabase.from('bookings')
      .select('tasker_id').eq('id', bookingId).maybeSingle();
    if (bk && bk.tasker_id) {
      await window.supabase.from('notifications').insert({
        user_id: bk.tasker_id, type: 'payment_received',
        title: 'Payment Received! 💰',
        message: 'The customer has paid. Get started, then mark the job as done when complete.',
        data: { booking_id: bookingId, reference: reference }, is_read: false,
      });
    }
  } catch(e) {}

  return { code };
}

/* ── Service provider marks job as done ──────────────────────── */
async function markJobDone(bookingId) {
  var { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Not logged in.');

  var { data: bk } = await window.supabase.from('bookings')
    .select('status, payment_status, customer_id, tasker_id')
    .eq('id', bookingId).maybeSingle();

  if (!bk) throw new Error('Booking not found.');
  if (bk.payment_status !== 'paid') throw new Error('Customer has not paid yet.');
  if (bk.status === 'completed') throw new Error('This job is already completed.');
  if (String(bk.tasker_id) !== String(user.id)) throw new Error('Only the service provider can mark this job as done.');

  await window.supabase.from('bookings').update({ status: 'provider_done' }).eq('id', bookingId);

  try {
    await window.supabase.from('notifications').insert({
      user_id: bk.customer_id, type: 'job_marked_done',
      title: 'Job Marked Complete ✅',
      message: 'Your service provider has marked the job as done. Please confirm in your Bookings tab to release payment.',
      data: { booking_id: bookingId }, is_read: false,
    });
  } catch(e) {}

  return { success: true };
}

/* ── Customer confirms job done → reveal code ────────────────── */
async function confirmJobComplete(bookingId) {
  var { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Not logged in.');

  var { data: bk } = await window.supabase.from('bookings')
    .select('completion_code, payment_status, tasker_id')
    .eq('id', bookingId).eq('customer_id', user.id).maybeSingle();

  if (!bk) throw new Error('Booking not found.');
  if (bk.payment_status !== 'paid') throw new Error('Payment not made yet.');

  await window.supabase.from('bookings').update({ status: 'awaiting_code' }).eq('id', bookingId);

  try {
    await window.supabase.from('notifications').insert({
      user_id: bk.tasker_id, type: 'job_confirmed',
      title: 'Job Confirmed — Claim Your Payment! 🎉',
      message: 'Customer confirmed the job is done. Enter your completion code in Bookings to receive payment.',
      data: { booking_id: bookingId }, is_read: false,
    });
  } catch(e) {}

  return { code: bk.completion_code };
}

/* ── Tasker submits completion code → releases earnings to wallet */
async function submitCompletionCode(bookingId, enteredCode) {
  var { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Not logged in.');

  var { data: bk } = await window.supabase.from('bookings')
    .select('completion_code, status, payment_status, code_attempts, tasker_id, customer_id')
    .eq('id', bookingId).maybeSingle();

  if (!bk) throw new Error('Booking not found.');
  if (bk.payment_status !== 'paid') throw new Error('Payment not made for this booking.');
  if (bk.status === 'completed') throw new Error('This booking is already completed.');
  if (bk.status === 'disputed')  throw new Error('This booking is under dispute.');

  var attempts = (bk.code_attempts || 0) + 1;
  if (attempts > 3) throw new Error('Too many incorrect attempts. Contact support.');

  if (enteredCode.trim() !== String(bk.completion_code).trim()) {
    await window.supabase.from('bookings').update({ code_attempts: attempts }).eq('id', bookingId);
    var remaining = 3 - attempts;
    throw new Error('Incorrect code. ' + (remaining > 0 ? remaining + ' attempt' + (remaining===1?'':'s') + ' remaining.' : 'No attempts left. Contact support.'));
  }

  /* Mark completed */
  await window.supabase.from('bookings')
    .update({ status: 'completed', payment_status: 'released', completed_at: new Date().toISOString() })
    .eq('id', bookingId);
  await window.supabase.from('payments')
    .update({ status: 'released', released_at: new Date().toISOString() }).eq('booking_id', bookingId);

  /* Release pending_balance → balance for provider */
  try {
    var { data: payRec } = await window.supabase.from('payments')
      .select('tasker_amount').eq('booking_id', bookingId).maybeSingle();
    var earn = payRec ? (payRec.tasker_amount || 0) : 0;
    var tWallet = await getWallet(bk.tasker_id);
    if (!tWallet._stub) {
      await window.supabase.from('wallets').update({
        balance: (tWallet.balance||0) + earn,
        pending_balance: Math.max(0, (tWallet.pending_balance||0) - earn),
        updated_at: new Date().toISOString(),
      }).eq('user_id', bk.tasker_id);
      window.supabase.from('wallet_transactions').insert({
        user_id: bk.tasker_id, type: 'earning', amount: earn,
        booking_id: bookingId, status: 'completed', note: 'Payment released for completed job',
      }).catch(function(){});
    }
  } catch(e) { console.warn('Wallet release error:', e.message); }

  /* Notify customer */
  try {
    await window.supabase.from('notifications').insert({
      user_id: bk.customer_id, type: 'job_completed',
      title: 'Job Completed! ⭐',
      message: 'The job is complete and payment has been released. Please leave a review.',
      data: { booking_id: bookingId }, is_read: false,
    });
  } catch(e) {}

  return { success: true };
}

/* ── Raise a dispute ─────────────────────────────────────────── */
async function raiseDispute(bookingId, reason) {
  var { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Not logged in.');

  await window.supabase.from('bookings')
    .update({ status: 'disputed', dispute_reason: reason }).eq('id', bookingId);
  await window.supabase.from('payments')
    .update({ status: 'disputed' }).eq('booking_id', bookingId);

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
  } catch(e) {}
  return { success: true };
}

/* ── Fetch payment for a booking ─────────────────────────────── */
async function fetchPayment(bookingId) {
  var { data } = await window.supabase.from('payments')
    .select('*').eq('booking_id', bookingId).maybeSingle();
  return data;
}

/* ── Expose globally ─────────────────────────────────────────── */
window.ST = window.ST || {};
window.ST.payments = {
  calculateAmounts, getWallet, topUpWallet, withdrawFromWallet,
  fetchWalletTransactions, payFromWallet, initiatePayment,
  markJobDone, confirmJobComplete, submitCompletionCode,
  raiseDispute, fetchPayment,
};
