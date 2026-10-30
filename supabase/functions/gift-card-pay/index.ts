// Self-contained build for the Supabase dashboard editor.
// Pays a booking with the customer's gift cards, and with Paystack for whatever is left.
//   { action: "quote",  bookingId }                    -> how much can the cards cover?
//   { action: "pay",    bookingId }                    -> reserve card money; finish at once if it covers everything
//   { action: "finish", holdId }                       -> after Paystack: verify the payment, take the card money, confirm the booking
//   { action: "cancel", holdId }                       -> Paystack window closed: give the reservation back
// The same four actions also work for a Job Room payment request: send { requestId } instead of { bookingId }
// (main service payments only: payment, full_payment, remaining_payment). Needs 20261019120000_gift_cards_chat_payments.sql.
import { createClient } from "npm:@supabase/supabase-js@2";

const SITE = (Deno.env.get("SITE_URL") ?? "https://streettasker.com").replace(/\/+$/, "");
const PAYSTACK_SECRET = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
// Stage 7A: the fee rate is no longer a constant here. It comes from the database function platform_fee_rate_for_tasker(),
// the same single answer the Job Room path uses: 0 for a Local Tasker, otherwise platform_fee_rate() (0.12 today).
// Needs stage-7a-core.sql in the project BEFORE this function is deployed.
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

function cors(req: Request): Record<string, string> {
  const o = req.headers.get("origin") ?? "";
  const ok = o === SITE || o === SITE.replace("://", "://www.") || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
  return {
    "Access-Control-Allow-Origin": ok ? o : SITE,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin",
  };
}
const reply = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" } });

const rand = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
const sixDigits = () => String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));

class Fail extends Error { constructor(public status: number, public code: string, msg: string) { super(msg); } }

/** The booking, its price and its category: all read here, never taken from the browser */
async function loadBooking(bookingId: string, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) throw new Fail(400, "bad_booking", "Invalid booking.");
  const { data: bk, error } = await db.from("bookings")
    .select("id,customer_id,tasker_id,task_id,service_id,amount,payment_status").eq("id", bookingId).maybeSingle();
  if (error) { console.error("booking lookup failed:", error.message); throw new Fail(500, "lookup_failed", "We couldn\u2019t load this booking."); }
  if (!bk) throw new Fail(404, "no_booking", "Booking not found.");
  if (bk.customer_id !== userId) throw new Fail(403, "not_yours", "This isn\u2019t your booking.");
  if (bk.payment_status === "paid") throw new Fail(409, "already_paid", "This booking is already paid.");

  let price = Number(bk.amount) || 0;
  let category: string | null = null;
  if (bk.task_id) {
    const { data: t } = await db.from("tasks").select("category,budget").eq("id", bk.task_id).maybeSingle();
    category = t?.category ?? null;
    if (!price) price = Number(t?.budget) || 0;
  }
  if (bk.service_id) {
    const { data: s } = await db.from("services").select("category,price").eq("id", bk.service_id).maybeSingle();
    category = category ?? s?.category ?? null;
    if (!price) price = Number(s?.price) || 0;
  }
  price = Math.round(price);
  if (price <= 0) throw new Fail(422, "no_price", "This booking has no price yet.");

  // Stage 7A: asked BEFORE any gift card money is reserved or taken, so a failure here moves no money
  const { data: rate, error: rateErr } = await db.rpc("platform_fee_rate_for_tasker", { p_tasker: bk.tasker_id });
  const feeRate = Number(rate);
  if (rateErr || rate === null || rate === undefined || !Number.isFinite(feeRate) || feeRate < 0 || feeRate >= 1) {
    console.error("fee rate lookup failed:", rateErr?.message ?? String(rate));
    throw new Fail(500, "lookup_failed", "We couldn\u2019t load this booking.");
  }
  return { bk, price, category: category ?? "other", feeRate };
}

/** Same records the browser writes for a normal Paystack booking payment */
async function confirmBooking(bk: { id: string; tasker_id: string | null }, userId: string, price: number, ref: string, feeRate: number) {
  const fee = Math.round(price * feeRate), taskerAmount = price - fee, now = new Date().toISOString();
  const code = sixDigits();

  const row = { booking_id: bk.id, customer_id: userId, amount: price, platform_fee: fee, tasker_amount: taskerAmount, status: "paid", paid_at: now };
  let ins = await db.from("payments").insert({ ...row, payment_reference: ref }).select("id").single();
  if (ins.error && /payment_reference/.test(ins.error.message)) ins = await db.from("payments").insert({ ...row, reference: ref }).select("id").single();
  if (ins.error || !ins.data) throw new Error("payments: " + (ins.error?.message ?? "no row"));
  const paymentId = ins.data.id;

  const up = await db.from("bookings").update({ payment_status: "paid", completion_code: code, code_attempts: 0, amount: price, status: "confirmed" }).eq("id", bk.id);
  if (up.error) throw new Error("bookings: " + up.error.message);

  if (bk.tasker_id) {
    const esc = await db.from("escrow_payments").insert({
      booking_id: bk.id, payment_id: paymentId, customer_id: userId, tasker_id: bk.tasker_id,
      amount: price, tasker_amount: taskerAmount, platform_fee: fee, reference: ref, status: "held", paid_at: now,
    });
    if (esc.error) throw new Error("escrow_payments: " + esc.error.message);
    const fmt = (n: number) => "\u20A6" + n.toLocaleString("en-NG");
    await db.from("notifications").insert({
      user_id: bk.tasker_id, type: "payment_received", title: "\uD83D\uDCB0 Payment received! " + fmt(price),
      message: "A customer has paid " + fmt(price) + " for your service. Your earning (" + fmt(taskerAmount) + (fee > 0 ? " after " + Math.round(feeRate * 100) + "% fee" : ", no fee") + ") is held in escrow. Complete the job and have the customer confirm to release it.",
      data: { booking_id: bk.id, payment_id: paymentId }, is_read: false,
    });
  }
}

async function paystackPaid(ref: string, kobo: number): Promise<boolean> {
  const r = await fetch("https://api.paystack.co/transaction/verify/" + encodeURIComponent(ref), { headers: { Authorization: "Bearer " + PAYSTACK_SECRET } });
  const j = await r.json().catch(() => null);
  return !!(j?.status && j.data?.status === "success" && String(j.data.currency).toUpperCase() === "NGN" && Number(j.data.amount) === kobo);
}

/** Take the card money, then confirm the booking; if confirming fails, put the card money back */
async function captureAndConfirm(holdId: string, userId: string, bk: { id: string; tasker_id: string | null }, price: number, ref: string, feeRate: number) {
  const cap = await db.rpc("gift_hold_capture", { p_hold: holdId, p_user: userId });
  if (cap.error) {
    console.error("capture failed:", cap.error.message);
    throw new Fail(409, "gift_unavailable", "Your gift card balance changed. Please try again.");
  }
  try { await confirmBooking(bk, userId, price, ref, feeRate); }
  catch (e) {
    console.error("confirm failed after capture, reversing:", e instanceof Error ? e.message : e);
    await db.rpc("gift_hold_reverse", { p_hold: holdId, p_user: userId });
    throw new Fail(500, "confirm_failed", "We couldn\u2019t finish the booking, and your gift cards were not charged. Please try again.");
  }
}

/** Job Room payment requests: the database checks what is owed; this only moves the money in the right order */
const isUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
function dbFail(e: { code?: string; message?: string }, fallback: Fail): Fail {
  const m = e.message ?? "";
  if (m.includes("no_gift_balance")) return new Fail(409, "no_gift_balance", "You have no gift card balance that can pay for this.");
  if (m.includes("not_eligible")) return new Fail(409, "not_eligible", "Gift cards can\u2019t be used for this payment.");
  if (m.includes("price_changed")) return new Fail(409, "price_changed", "The amount changed. Please start again.");
  if (m.includes("gift_unavailable")) return new Fail(409, "gift_unavailable", "Your gift card balance changed. Please try again.");
  if (m.includes("hold_invalid") || m.includes("intent_not_open")) return new Fail(409, "hold_invalid", "This payment session has ended. Please start again.");
  if (e.code === "P0001" && m && m.length < 200) return new Fail(409, "not_payable", m);   // a message written for the customer
  console.error("request gift payment failed:", m);
  return fallback;
}

/** Take the card money and confirm the request in one database transaction (all or nothing) */
async function settleRequest(holdId: string, userId: string) {
  const { data, error } = await db.rpc("gift_request_settle", { p_hold: holdId, p_user: userId });
  if (error) throw dbFail(error, new Fail(500, "confirm_failed", "We couldn\u2019t finish this payment, and your gift cards were not charged. Please try again."));
  return data as { amount?: number; first_payment?: boolean; booking_id?: string; gift_amount?: number };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return reply(req, { error: "Method not allowed." }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = bearer ? await db.auth.getUser(bearer) : { data: null };
    const userId = u?.user?.id;
    if (!userId) return reply(req, { error: "Please log in to continue.", code: "login_required" }, 401);

    // ── Job Room payment request (main service payments only) ──
    if (body.requestId !== undefined && (body.action === "quote" || body.action === "pay")) {
      const requestId = String(body.requestId ?? "");
      if (!isUuid(requestId)) throw new Fail(400, "bad_request", "Invalid payment request.");

      if (body.action === "quote") {
        const { data: info, error } = await db.rpc("gift_request_info", { p_user: userId, p_request: requestId });
        if (error) { console.error("request info failed:", error.message); throw new Fail(500, "lookup_failed", "We couldn\u2019t check your gift cards."); }
        if (!info?.eligible) return reply(req, { price: Number(info?.amount) || 0, giftAmount: 0, remainder: Number(info?.amount) || 0 });
        const { data: avail } = await db.rpc("gift_available", { p_user: userId, p_category: info.category });
        const cover = Math.min(Number(avail) || 0, info.amount);
        return reply(req, { price: info.amount, giftAmount: cover, remainder: info.amount - cover });
      }

      const reference = "GP-" + rand(18);
      const { data: h, error } = await db.rpc("gift_request_pay_start", { p_user: userId, p_request: requestId, p_reference: reference });
      if (error) throw dbFail(error, new Fail(500, "hold_failed", "We couldn\u2019t reserve your gift cards."));
      if (h.amount >= h.price) {
        const r = await settleRequest(h.hold_id, userId);
        return reply(req, { done: true, giftAmount: h.price, remainder: 0, amount: r.amount ?? h.price, firstPayment: !!r.first_payment, bookingId: r.booking_id });
      }
      return reply(req, { done: false, holdId: h.hold_id, giftAmount: h.amount, remainder: h.price - h.amount, reference });
    }

    if (body.action === "quote") {
      const { price, category } = await loadBooking(String(body.bookingId ?? ""), userId);
      const { data } = await db.rpc("gift_available", { p_user: userId, p_category: category });
      const cover = Math.min(Number(data) || 0, price);
      return reply(req, { price, giftAmount: cover, remainder: price - cover });
    }

    if (body.action === "pay") {
      const { bk, price, category, feeRate } = await loadBooking(String(body.bookingId ?? ""), userId);
      const reference = "GP-" + rand(18);
      const { data: h, error } = await db.rpc("gift_hold_create", { p_user: userId, p_booking: bk.id, p_category: category, p_price: price, p_reference: reference });
      if (error) { console.error("hold failed:", error.message); throw new Fail(500, "hold_failed", "We couldn\u2019t reserve your gift cards."); }
      if (!h?.hold_id) throw new Fail(409, "no_gift_balance", "You have no gift card balance that can pay for this booking.");
      if (h.amount >= price) {
        await captureAndConfirm(h.hold_id, userId, bk, price, reference, feeRate);
        return reply(req, { done: true, giftAmount: price, remainder: 0 });
      }
      return reply(req, { done: false, holdId: h.hold_id, giftAmount: h.amount, remainder: price - h.amount, reference });
    }

    if (body.action === "finish" || body.action === "cancel") {
      const { data: hold } = await db.from("gift_card_holds").select("*").eq("id", String(body.holdId ?? "")).eq("user_id", userId).maybeSingle();
      // a Job Room request that was already completed (the browser asked twice): report it as done
      if (hold && hold.request_id && hold.status === "captured" && body.action === "finish") {
        return reply(req, { done: true, giftAmount: hold.amount, remainder: hold.price - hold.amount, amount: hold.price });
      }
      if (!hold || hold.status !== "held") throw new Fail(409, "hold_invalid", "This payment session has ended. Please start again.");
      if (body.action === "cancel") {
        await db.rpc("gift_hold_release", { p_hold: hold.id, p_user: userId });
        return reply(req, { released: true });
      }
      if (hold.request_id) {
        const remainderR = hold.price - hold.amount;
        if (!(await paystackPaid(hold.reference, remainderR * 100))) throw new Fail(402, "not_paid", "We couldn\u2019t confirm your card payment yet.");
        try {
          const r = await settleRequest(hold.id, userId);
          return reply(req, { done: true, giftAmount: hold.amount, remainder: remainderR, amount: r.amount ?? hold.price, firstPayment: !!r.first_payment, bookingId: r.booking_id });
        } catch (_e) {
          // Paystack already took the rest, so say so plainly and give the reference to quote
          throw new Fail(500, "paid_needs_support", "Your card payment went through, but we couldn\u2019t finish this payment. Please email kiyomigroups@gmail.com and quote " + hold.reference + ". Your gift cards were not charged.");
        }
      }
      const { bk, price, feeRate } = await loadBooking(hold.booking_id, userId);
      if (price !== hold.price) {
        await db.rpc("gift_hold_release", { p_hold: hold.id, p_user: userId });
        throw new Fail(409, "price_changed", "The booking price changed. Please start again.");
      }
      const remainder = price - hold.amount;
      if (!(await paystackPaid(hold.reference, remainder * 100))) throw new Fail(402, "not_paid", "We couldn\u2019t confirm your card payment yet.");
      try { await captureAndConfirm(hold.id, userId, bk, price, hold.reference, feeRate); }
      catch (e) {
        // Paystack already took the rest, so say so plainly and give the reference to quote
        throw new Fail(500, "paid_needs_support", "Your card payment went through, but we couldn\u2019t finish the booking. Please email kiyomigroups@gmail.com and quote " + hold.reference + ". Your gift cards were not charged.");
      }
      return reply(req, { done: true, giftAmount: hold.amount, remainder });
    }

    return reply(req, { error: "Unknown action." }, 400);
  } catch (e) {
    if (e instanceof Fail) return reply(req, { error: e.message, code: e.code }, e.status);
    console.error("gift-card-pay error:", e instanceof Error ? e.message : e);
    return reply(req, { error: "Something went wrong on our side. Please try again." }, 500);
  }
});
