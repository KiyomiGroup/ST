/* ============================================================
   STREET TASKER — payments.js  (Sprint 4)
   Escrow payment system with Paystack integration.

   FLOW:
   1. Customer pays full amount → held in escrow
   2. Tasker completes job offline
   3. Customer confirms → completion code generated
   4. Tasker enters code → payout released (minus 12% commission)

   Future: Replace PAYSTACK_PUBLIC_KEY with live key before launch.
   Future: Webhook endpoint on Supabase Edge Function verifies
           payment server-side before updating DB status.
   ============================================================ */
'use strict';

const PAYSTACK_PUBLIC_KEY = 'pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; /* Replace with live key */
const PLATFORM_COMMISSION = 0.12; /* 12% commission */

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

/* ── Initiate Paystack payment ───────────────────────────────── */
async function initiatePayment({ bookingId, taskId, amountNaira, customerEmail, customerName }) {
  var { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Please log in to make a payment.');

  var amounts   = calculateAmounts(amountNaira);
  var reference = 'ST-' + Date.now() + '-' + bookingId.slice(0, 8);

  /* Save payment record to DB before redirecting */
  var { data: payment, error: payErr } = await window.supabase
    .from('payments')
    .insert({
      booking_id:    bookingId,
      task_id:       taskId || null,
      customer_id:   user.id,
      amount:        amounts.total,
      platform_fee:  amounts.platformFee,
      tasker_amount: amounts.taskerAmount,
      status:        'pending',
      reference:     reference,
    })
    .select()
    .single();

  if (payErr) throw payErr;

  /* Launch Paystack popup */
  return new Promise(function(resolve, reject) {
    if (typeof PaystackPop === 'undefined') {
      reject(new Error('Paystack not loaded. Check your internet connection.'));
      return;
    }
    var handler = PaystackPop.setup({
      key:       PAYSTACK_PUBLIC_KEY,
      email:     customerEmail || user.email,
      amount:    amounts.total * 100, /* Paystack uses kobo */
      currency:  'NGN',
      reference: reference,
      metadata: {
        custom_fields: [
          { display_name: 'Platform', variable_name: 'platform', value: 'StreetTasker' },
          { display_name: 'Booking ID', variable_name: 'booking_id', value: bookingId },
        ]
      },
      callback: async function(response) {
        try {
          /* Verify payment was successful and update DB */
          await onPaymentSuccess(response.reference, payment.id, bookingId);
          resolve({ reference: response.reference, paymentId: payment.id });
        } catch(e) {
          reject(e);
        }
      },
      onClose: function() {
        /* Payment popup closed without completing */
        reject(new Error('Payment cancelled.'));
      },
    });
    handler.openIframe();
  });
}

/* ── Called after Paystack confirms payment ──────────────────── */
async function onPaymentSuccess(reference, paymentId, bookingId) {
  /* In production: verify server-side via Supabase Edge Function
     that calls https://api.paystack.co/transaction/verify/:reference
     before trusting the client.
     For Sprint 4 launch: we trust the Paystack callback and update DB immediately. */

  var code = generateCompletionCode();

  /* Update payment record */
  await window.supabase.from('payments')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', paymentId);

  /* Update booking status to paid + store completion code */
  await window.supabase.from('bookings')
    .update({
      payment_status:  'paid',
      status:          'in_progress',
      completion_code: code,
      payment_ref:     reference,
    })
    .eq('id', bookingId);

  /* Notify the tasker */
  try {
    var { data: bk } = await window.supabase.from('bookings')
      .select('tasker_id, tasks(title)').eq('id', bookingId).maybeSingle();
    if (bk && bk.tasker_id) {
      await window.supabase.from('notifications').insert({
        user_id: bk.tasker_id,
        type:    'payment_received',
        title:   'Payment Received!',
        message: 'The customer has paid for the job. Get started!',
        data:    { booking_id: bookingId, reference: reference },
        is_read: false,
      });
    }
  } catch(e) { /* non-blocking */ }

  return { code };
}

/* ── Customer confirms job done → reveal code ────────────────── */
async function confirmJobComplete(bookingId) {
  var { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Not logged in.');

  /* Fetch completion code */
  var { data: bk } = await window.supabase.from('bookings')
    .select('completion_code, payment_status, tasker_id')
    .eq('id', bookingId)
    .eq('customer_id', user.id)
    .maybeSingle();

  if (!bk) throw new Error('Booking not found.');
  if (bk.payment_status !== 'paid') throw new Error('Payment not made yet.');

  /* Update booking status */
  await window.supabase.from('bookings')
    .update({ status: 'awaiting_code' })
    .eq('id', bookingId);

  /* Notify tasker to enter code */
  try {
    await window.supabase.from('notifications').insert({
      user_id: bk.tasker_id,
      type:    'job_confirmed',
      title:   'Job Marked Complete!',
      message: 'Customer has confirmed the job. Enter your completion code to receive payment.',
      data:    { booking_id: bookingId },
      is_read: false,
    });
  } catch(e) { /* non-blocking */ }

  return { code: bk.completion_code };
}

/* ── Tasker submits completion code → triggers payout ────────── */
async function submitCompletionCode(bookingId, enteredCode) {
  var { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Not logged in.');

  var { data: bk } = await window.supabase.from('bookings')
    .select('completion_code, status, payment_status, code_attempts, tasker_id, customer_id')
    .eq('id', bookingId)
    .maybeSingle();

  if (!bk) throw new Error('Booking not found.');
  if (bk.payment_status !== 'paid') throw new Error('Payment not made for this booking.');
  if (bk.status === 'completed') throw new Error('This booking is already completed.');
  if (bk.status === 'disputed') throw new Error('This booking is under dispute.');

  /* Check attempt limit (max 3) */
  var attempts = (bk.code_attempts || 0) + 1;
  if (attempts > 3) throw new Error('Too many incorrect attempts. Contact support.');

  if (enteredCode.trim() !== String(bk.completion_code).trim()) {
    await window.supabase.from('bookings')
      .update({ code_attempts: attempts })
      .eq('id', bookingId);
    var remaining = 3 - attempts;
    throw new Error('Incorrect code. ' + (remaining > 0 ? remaining + ' attempt' + (remaining===1?'':'s') + ' remaining.' : 'No attempts left. Contact support.'));
  }

  /* Code correct → mark completed + trigger payout */
  await window.supabase.from('bookings')
    .update({ status: 'completed', payment_status: 'released', completed_at: new Date().toISOString() })
    .eq('id', bookingId);

  /* Update payment record */
  await window.supabase.from('payments')
    .update({ status: 'released', released_at: new Date().toISOString() })
    .eq('booking_id', bookingId);

  /* Notify customer */
  try {
    await window.supabase.from('notifications').insert({
      user_id: bk.customer_id,
      type:    'job_completed',
      title:   'Job Completed!',
      message: 'Great news! The job is complete. Please leave a review.',
      data:    { booking_id: bookingId },
      is_read: false,
    });
  } catch(e) { /* non-blocking */ }

  /* Future Sprint: Trigger actual bank transfer via Paystack Transfer API:
     POST https://api.paystack.co/transfer
     This requires a Supabase Edge Function with the secret key.
     For Sprint 4 launch: release is recorded in DB, manual payout until Edge Function is live. */

  return { success: true };
}

/* ── Raise a dispute ─────────────────────────────────────────── */
async function raiseDispute(bookingId, reason) {
  var { data: { user } } = await window.supabase.auth.getUser();
  if (!user) throw new Error('Not logged in.');

  await window.supabase.from('bookings')
    .update({ status: 'disputed', dispute_reason: reason })
    .eq('id', bookingId);

  await window.supabase.from('payments')
    .update({ status: 'disputed' })
    .eq('booking_id', bookingId);

  /* Notify both parties + flag for admin */
  try {
    var { data: bk } = await window.supabase.from('bookings')
      .select('tasker_id, customer_id').eq('id', bookingId).maybeSingle();
    if (bk) {
      var notifys = [
        { user_id: bk.tasker_id,   title: 'Dispute Raised', message: 'A dispute has been raised on booking ' + bookingId.slice(0,8) + '. Payment is frozen pending review.' },
        { user_id: bk.customer_id, title: 'Dispute Opened',  message: 'Your dispute has been received. Our team will review within 24 hours. Payment is frozen.' },
      ].filter(function(n) { return n.user_id && n.user_id !== user.id; });
      for (var i = 0; i < notifys.length; i++) {
        await window.supabase.from('notifications').insert({
          user_id: notifys[i].user_id, type: 'dispute',
          title:   notifys[i].title, message: notifys[i].message,
          data:    { booking_id: bookingId }, is_read: false,
        });
      }
    }
  } catch(e) { /* non-blocking */ }

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
  calculateAmounts,
  initiatePayment,
  confirmJobComplete,
  submitCompletionCode,
  raiseDispute,
  fetchPayment,
};
