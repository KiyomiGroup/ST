// Self-contained build for the Supabase dashboard editor (all shared code is inside this file).
import { createClient } from "npm:@supabase/supabase-js@2";

// _shared/gift.ts
var REFERENCE_RE = /^GC-[A-Z2-9]{20}$/;
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var PHONE_RE = /^\+?[\d\s-]{10,16}$/;
function isEmail(s) {
  return s.length <= 254 && EMAIL_RE.test(s);
}
function isPhone(s) {
  return PHONE_RE.test(s) && s.replace(/\D/g, "").length >= 10;
}
function contactKind(contact) {
  if (!contact) return "none";
  if (isEmail(contact)) return "email";
  if (isPhone(contact)) return "phone";
  return "none";
}
function lagosToday(now) {
  return new Date(now.getTime() + 60 * 60 * 1e3).toISOString().slice(0, 10);
}
function toPublicCard(card) {
  return {
    code: card.code,
    amount: card.amount,
    theme: card.theme,
    category: card.category ?? null,
    recipientName: card.recipient_name,
    senderName: card.sender_name,
    message: card.message,
    delivery: card.delivery,
    recipientContactKind: contactKind(card.recipient_contact),
    sendOn: card.send_on
  };
}

// _shared/email-templates.ts
var THEME_LABELS = {
  cleaning: "Cleaning & Home",
  birthday: "Happy Birthday",
  housewarming: "Housewarming",
  thanks: "Thank You",
  congrats: "Congratulations",
  general: "General Voucher"
};
var C = {
  deep: "#004F31",
  green: "#116C47",
  mint: "#9EF1C2",
  mintText: "#18704B",
  ink: "#1A1C1B",
  muted: "#3F4942",
  band: "#F4F4F1",
  rule: "#E8E8E6",
  white: "#FFFFFF"
};
var FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function naira(n) {
  return "\u20A6" + Math.round(n).toLocaleString("en-NG");
}
function themeLabel(theme) {
  return THEME_LABELS[theme] ?? "Gift Card";
}
function longDate(iso) {
  const d = /* @__PURE__ */ new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
function firstName(name) {
  return name.trim().split(/\s+/)[0] || name;
}
function redeemUrl(siteUrl, code) {
  return `${siteUrl}/redeem.html?code=${encodeURIComponent(code)}`;
}
function successUrl(siteUrl, reference) {
  return `${siteUrl}/gift-card-success.html?reference=${encodeURIComponent(reference)}`;
}
function whatsappShareUrl(card, siteUrl) {
  const text = `${card.sender_name} sent you a StreetTasker gift card worth ${naira(card.amount)}!
Your code: ${card.code}
Redeem it here: ${redeemUrl(siteUrl, card.code)}`;
  return "https://wa.me/?text=" + encodeURIComponent(text);
}
function button(url, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px"><tr><td style="border-radius:999px;background:${C.green}"><a href="${esc(url)}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;font-weight:700;color:${C.white};text-decoration:none;border-radius:999px">${esc(label)}</a></td></tr></table>`;
}
function cardBlock(card) {
  const msg = card.message ? `<tr><td style="padding:0 24px 20px;font-family:${FONT};font-size:14px;line-height:1.5;font-style:italic;color:${C.mint}">&ldquo;${esc(card.message).replace(/\n/g, "<br>")}&rdquo;</td></tr>` : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.green};border-radius:20px"><tr><td style="padding:24px 24px 4px;font-family:${FONT};font-size:20px;font-weight:700;color:${C.white}">StreetTasker<span style="float:right;font-size:12px;font-weight:600;color:${C.mint}">${esc(themeLabel(card.theme))}</span></td></tr><tr><td style="padding:16px 24px 0;font-family:${FONT};font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#82D8A8">Gift voucher for</td></tr><tr><td style="padding:2px 24px 12px;font-family:${FONT};font-size:22px;font-weight:700;color:${C.white}">${esc(card.recipient_name)}</td></tr>` + msg + `<tr><td style="padding:0 24px 4px;font-family:${FONT};font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#82D8A8">Value</td></tr><tr><td style="padding:0 24px 16px;font-family:${FONT};font-size:34px;font-weight:800;color:${C.white}">${naira(card.amount)}</td></tr><tr><td style="padding:0 24px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.deep};border-radius:12px"><tr><td style="padding:14px 16px;font-family:${FONT};font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#82D8A8">Your code</td><td align="right" style="padding:14px 16px;font-family:'Courier New',Courier,monospace;font-size:15px;font-weight:700;letter-spacing:0;white-space:nowrap;color:${C.mint}">${esc(card.code)}</td></tr></table></td></tr><tr><td style="padding:0 24px 22px;font-family:${FONT};font-size:12px;color:#82D8A8">From ${esc(card.sender_name)}</td></tr></table>`;
}
function shell(title, preheader, inner, support) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body style="margin:0;padding:0;background:${C.band}"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.band}">${esc(preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.band}"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px"><tr><td style="padding:0 4px 16px;font-family:${FONT};font-size:22px;font-weight:800;color:${C.green}">StreetTasker</td></tr><tr><td style="background:${C.white};border-radius:24px;padding:32px 28px;font-family:${FONT};font-size:15px;line-height:1.6;color:${C.muted}">${inner}</td></tr><tr><td style="padding:20px 8px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.muted};text-align:center">Questions? Reply to this email or write to <a href="mailto:${esc(support)}" style="color:${C.mintText}">${esc(support)}</a>.<br>StreetTasker gift cards never expire.</td></tr></table></td></tr></table></body></html>`;
}
function h1(text) {
  return `<h1 style="margin:0 0 12px;font-family:${FONT};font-size:24px;line-height:1.25;color:${C.ink}">${esc(text)}</h1>`;
}
function p(html) {
  return `<p style="margin:0 0 14px">${html}</p>`;
}
function steps() {
  const row = (n, t) => `<tr><td valign="top" style="padding:0 12px 10px 0;font-family:${FONT};font-weight:800;color:${C.mintText}">${n}</td><td style="padding:0 0 10px;font-family:${FONT};font-size:14px;color:${C.muted}">${t}</td></tr>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0">` + row("1", "Open the link and log in or sign up to StreetTasker.") + row("2", "Enter your code. The money is added to your gift card balance.") + row("3", "Book any task and use the balance at checkout.") + `</table>`;
}
function recipientEmail(card, siteUrl, support) {
  const url = redeemUrl(siteUrl, card.code);
  const who = firstName(card.recipient_name);
  const subject = `${card.sender_name} sent you a ${naira(card.amount)} StreetTasker gift card`.slice(0, 150);
  const html = shell(
    subject,
    `A gift of free time, from ${card.sender_name}.`,
    h1(`${who}, you have a gift!`) + p(`${esc(card.sender_name)} sent you a StreetTasker gift card. Use it for cleaning, repairs, moving, errands and more from trusted local taskers.`) + cardBlock(card) + button(url, "Redeem your gift card") + p(`<span style="font-size:13px">Or copy this link: <a href="${esc(url)}" style="color:${C.mintText};word-break:break-all">${esc(url)}</a></span>`) + steps(),
    support
  );
  const text = [
    `${who}, you have a gift!`,
    "",
    `${card.sender_name} sent you a StreetTasker gift card worth ${naira(card.amount)}.`,
    card.message ? `
"${card.message}"
` : "",
    `Your code: ${card.code}`,
    `Redeem it here: ${url}`,
    "",
    "It never expires. Log in or sign up, enter your code, then use the balance on any task.",
    `Questions? Write to ${support}`
  ].join("\n");
  return { subject, html, text };
}
function deliveryNote(order, card, messaging = false) {
  const kind = contactKind(card.recipient_contact);
  if (order.delivery === "pdf") {
    return { sentence: "You chose the printable PDF, so nothing is sent automatically. Your card is below: print it or share it yourself.", forward: true };
  }
  if (kind === "email" && card.send_on) {
    return { sentence: `We will email the gift to ${card.recipient_contact} on ${longDate(card.send_on)}.`, forward: false };
  }
  if (kind === "email") {
    return { sentence: `We have emailed the gift to ${card.recipient_contact}.`, forward: false };
  }
  if (kind === "phone" && messaging) {
    return card.send_on ? { sentence: `We will message the gift to ${card.recipient_contact} on ${longDate(card.send_on)}.`, forward: false } : { sentence: `We are messaging the gift to ${card.recipient_contact} now.`, forward: false };
  }
  if (card.send_on) {
    return { sentence: `We cannot message phone numbers automatically yet. On ${longDate(card.send_on)} we will email you a reminder with the card, ready to forward to ${card.recipient_name}.`, forward: false };
  }
  return { sentence: `We cannot message phone numbers automatically yet, so the card is below. Send it to ${card.recipient_name} on WhatsApp or by text.`, forward: true };
}
function receiptEmail(order, card, siteUrl, support, messaging = false) {
  const note = deliveryNote(order, card, messaging);
  const subject = `Your StreetTasker gift card receipt (${naira(card.amount)})`;
  const row = (k, v) => `<tr><td style="padding:6px 0;font-family:${FONT};font-size:14px;color:${C.muted}">${k}</td><td align="right" style="padding:6px 0;font-family:${FONT};font-size:14px;font-weight:600;color:${C.ink}">${v}</td></tr>`;
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;border-top:1px solid ${C.rule};border-bottom:1px solid ${C.rule}">` + row("Gift card for", esc(card.recipient_name)) + row("Gift card value", naira(card.amount)) + row("Fees", `<span style="color:${C.green}">${naira(0)}</span>`) + row("Total paid", naira(card.amount)) + row("Reference", `<span style="font-family:'Courier New',Courier,monospace;font-size:12px">${esc(order.reference)}</span>`) + `</table>`;
  let inner = h1("Thank you, your gift card is ready") + p(`Hi ${esc(firstName(card.sender_name))}, we received your payment. ${esc(note.sentence)}`) + table;
  if (note.forward) {
    inner += p("Here is the card to pass on:") + cardBlock(card) + button(whatsappShareUrl(card, siteUrl), "Share on WhatsApp") + p(`<span style="font-size:13px">You can also view and print it any time: <a href="${esc(successUrl(siteUrl, order.reference))}" style="color:${C.mintText}">open your gift card</a>.</span>`);
  } else {
    inner += button(successUrl(siteUrl, order.reference), "View your gift card");
  }
  const html = shell(subject, `Payment received: ${naira(card.amount)} gift card for ${card.recipient_name}.`, inner, support);
  const text = [
    `Thank you, your gift card is ready`,
    "",
    `Hi ${firstName(card.sender_name)}, we received your payment. ${note.sentence}`,
    "",
    `Gift card for: ${card.recipient_name}`,
    `Value: ${naira(card.amount)}`,
    `Total paid: ${naira(card.amount)}`,
    `Reference: ${order.reference}`,
    note.forward ? `
Your code: ${card.code}
Share on WhatsApp: ${whatsappShareUrl(card, siteUrl)}` : "",
    `
View your gift card: ${successUrl(siteUrl, order.reference)}`,
    `Questions? Write to ${support}`
  ].join("\n");
  return { subject, html, text };
}
function forwardReminderEmail(order, card, siteUrl, support) {
  const subject = `Today is the day: send ${card.recipient_name} their gift card`.slice(0, 150);
  const html = shell(
    subject,
    `Forward the card to ${card.recipient_name} today.`,
    h1(`Time to send the gift`) + p(`Hi ${esc(firstName(card.sender_name))}, you scheduled this gift for today. We cannot message phone numbers automatically yet, so please send it to ${esc(card.recipient_name)} yourself.`) + cardBlock(card) + button(whatsappShareUrl(card, siteUrl), "Share on WhatsApp"),
    support
  );
  const text = [
    "Time to send the gift",
    "",
    `Hi ${firstName(card.sender_name)}, you scheduled this gift for today. Please send it to ${card.recipient_name} yourself.`,
    `Code: ${card.code}`,
    `Share on WhatsApp: ${whatsappShareUrl(card, siteUrl)}`,
    `Questions? Write to ${support}`
  ].join("\n");
  return { subject, html, text };
}

// _shared/deliver.ts
var MAX_ATTEMPTS = 5;
function errMsg(err) {
  return err instanceof Error ? err.message : String(err);
}
async function sendReceipt(deps, orderId) {
  if (!deps.sendEmail) return "skipped";
  let order = null;
  try {
    order = await deps.db.claimReceipt(orderId);
    if (!order) return "skipped";
    const card = await deps.db.getCardByOrderId(orderId);
    if (!card) throw new Error("card_missing");
    const mail = receiptEmail(order, card, deps.siteUrl, deps.supportEmail, !!deps.sendMessage);
    await deps.sendEmail({ to: order.buyer_email, ...mail, idempotencyKey: `gc-receipt-${order.id}` });
    await deps.db.markReceiptSent(order.id);
    if (!card.delivered_at && !card.send_on && deliveryNote(order, card, !!deps.sendMessage).forward) {
      await deps.db.markDelivered(card.id, "buyer_copy");
    }
    return "sent";
  } catch (err) {
    console.error("receipt failed", orderId, errMsg(err));
    return "failed";
  }
}
async function deliverCard(deps, cardId) {
  if (!deps.sendEmail) return "skipped";
  let card = null;
  try {
    card = await deps.db.claimDelivery(cardId);
    if (!card) return "skipped";
    const order = await deps.db.getOrderById(card.order_id);
    if (!order) throw new Error("order_missing");
    if (contactKind(card.recipient_contact) === "email") {
      const mail = recipientEmail(card, deps.siteUrl, deps.supportEmail);
      await deps.sendEmail({ to: card.recipient_contact, ...mail, idempotencyKey: `gc-deliver-${card.id}` });
      await deps.db.markDelivered(card.id, "email");
    } else if (deps.sendMessage && contactKind(card.recipient_contact) === "phone") {
      try {
        const via = await deps.sendMessage({
          to: card.recipient_contact,
          recipientName: card.recipient_name,
          senderName: card.sender_name,
          amount: card.amount,
          redeemUrl: `${deps.siteUrl}/redeem.html?code=${encodeURIComponent(card.code)}`
        });
        await deps.db.markDelivered(card.id, via);
      } catch (err) {
        if ((card.delivery_attempts ?? 0) < MAX_ATTEMPTS) throw err;
        console.error("message failed for good, falling back to the buyer", card.id, errMsg(err));
        const mail = forwardReminderEmail(order, card, deps.siteUrl, deps.supportEmail);
        await deps.sendEmail({ to: order.buyer_email, ...mail, idempotencyKey: `gc-forward-${card.id}` });
        await deps.db.markDelivered(card.id, "buyer_forward");
      }
    } else {
      const mail = forwardReminderEmail(order, card, deps.siteUrl, deps.supportEmail);
      await deps.sendEmail({ to: order.buyer_email, ...mail, idempotencyKey: `gc-forward-${card.id}` });
      await deps.db.markDelivered(card.id, "buyer_forward");
    }
    return "sent";
  } catch (err) {
    console.error("delivery failed", cardId, errMsg(err));
    if (card) await deps.db.recordDeliveryError(card.id, errMsg(err));
    return "failed";
  }
}
async function onCardIssued(deps, card, order) {
  await sendReceipt(deps, order.id);
  const today = lagosToday(deps.now());
  const dueNow = !card.send_on || card.send_on <= today;
  const kind = contactKind(card.recipient_contact);
  if (dueNow && card.delivery === "digital" && (kind === "email" || kind === "phone" && deps.sendMessage)) {
    await deliverCard(deps, card.id);
  }
}

// _shared/paystack.ts
var API = "https://api.paystack.co";
async function verifyTransaction(fetchFn, secret, reference) {
  const res = await fetchFn(`${API}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret}` }
  });
  const json2 = await res.json().catch(() => null);
  if (!res.ok || !json2?.status || !json2?.data) {
    throw new Error(`paystack_verify_failed:${res.status}:${json2?.message ?? ""}`);
  }
  return json2.data;
}

// _shared/fulfil.ts
async function verifyAndFulfil(deps, reference) {
  const order = await deps.db.getOrder(reference);
  if (!order) return { status: "not_found" };
  if (order.status === "paid") {
    const card2 = await deps.db.getCardByOrderId(order.id);
    if (card2) return { status: "paid", card: card2, created: false };
  }
  const tx = await verifyTransaction(deps.fetchFn, deps.paystackSecret, reference);
  if (tx.status !== "success") {
    return { status: tx.status === "failed" || tx.status === "reversed" || tx.status === "abandoned" ? "failed" : "pending" };
  }
  const { created, card } = await deps.db.fulfilOrder(reference, tx.amount, tx.currency);
  if (created && deps.onIssued) {
    try {
      await deps.onIssued(card, order);
    } catch (err) {
      console.error("onIssued failed", reference, err instanceof Error ? err.message : err);
    }
  }
  return { status: "paid", card, created };
}

// _shared/handlers.ts
function allowedOrigin(req, siteUrl) {
  const origin = req.headers.get("origin") ?? "";
  const site = new URL(siteUrl).origin;
  const www = site.replace("://", "://www.");
  if (origin === site || origin === www) return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return site;
}
function corsHeaders(req, siteUrl) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(req, siteUrl),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin"
  };
}
function json(req, deps, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req, deps.siteUrl), "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
function preflight(req, deps) {
  return new Response(null, { status: 204, headers: corsHeaders(req, deps.siteUrl) });
}
async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
async function handleVerify(req, deps) {
  if (req.method === "OPTIONS") return preflight(req, deps);
  if (req.method !== "POST") return json(req, deps, { error: "Method not allowed." }, 405);
  const body = await readJson(req);
  const reference = String(body?.reference ?? body?.trxref ?? "").trim();
  if (!REFERENCE_RE.test(reference)) return json(req, deps, { error: "Invalid reference." }, 400);
  try {
    const result = await verifyAndFulfil(deps, reference);
    if (result.status === "not_found") return json(req, deps, { status: "not_found" }, 404);
    if (result.status !== "paid") return json(req, deps, { status: result.status });
    return json(req, deps, { status: "paid", card: toPublicCard(result.card) });
  } catch (err) {
    console.error("verify failed", reference, err instanceof Error ? err.message : err);
    return json(req, deps, { error: "We couldn\u2019t confirm your payment yet. Please refresh in a moment." }, 502);
  }
}

// _shared/db.ts
function createDb(url, serviceRoleKey) {
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return {
    async getUserFromToken(token) {
      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user) return null;
      return { id: data.user.id, email: data.user.email ?? null };
    },
    async countRecentOrdersByIp(ip, sinceIso) {
      const { count, error } = await client.from("gift_card_orders").select("id", { count: "exact", head: true }).eq("client_ip", ip).gte("created_at", sinceIso);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
    async insertOrder(order) {
      const { data, error } = await client.from("gift_card_orders").insert(order).select("id").single();
      if (error || !data) throw new Error(error?.message ?? "insert_failed");
      return { id: data.id };
    },
    async markOrderFailed(reference) {
      await client.from("gift_card_orders").update({ status: "failed" }).eq("reference", reference).eq("status", "pending");
    },
    async getOrder(reference) {
      const { data, error } = await client.from("gift_card_orders").select("id, reference, status, buyer_user_id, buyer_email, amount").eq("reference", reference).maybeSingle();
      if (error) throw new Error(error.message);
      return data ?? null;
    },
    async getCardByOrderId(orderId) {
      const { data, error } = await client.from("gift_cards").select("*").eq("order_id", orderId).maybeSingle();
      if (error) throw new Error(error.message);
      return data ?? null;
    },
    async fulfilOrder(reference, paidKobo, currency) {
      const { data, error } = await client.rpc("fulfil_gift_card_order", {
        p_reference: reference,
        p_paid_kobo: paidKobo,
        p_currency: currency
      });
      if (error) throw new Error(error.message);
      return data;
    },
    async getOrderById(orderId) {
      const { data, error } = await client.from("gift_card_orders").select("*").eq("id", orderId).maybeSingle();
      if (error) throw new Error(error.message);
      return data ?? null;
    },
    async claimReceipt(orderId) {
      const { data, error } = await client.rpc("claim_gift_card_receipt", { p_order_id: orderId });
      if (error) throw new Error(error.message);
      return data ?? null;
    },
    async markReceiptSent(orderId) {
      const { error } = await client.rpc("mark_gift_card_receipt_sent", { p_order_id: orderId });
      if (error) throw new Error(error.message);
    },
    async listUnreceiptedOrders(limit) {
      const { data, error } = await client.rpc("list_unreceipted_gift_orders", { p_limit: limit });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    async claimDelivery(cardId) {
      const { data, error } = await client.rpc("claim_gift_card_delivery", { p_card_id: cardId });
      if (error) throw new Error(error.message);
      return data ?? null;
    },
    async markDelivered(cardId, via) {
      const { error } = await client.rpc("mark_gift_card_delivered", { p_card_id: cardId, p_via: via });
      if (error) throw new Error(error.message);
    },
    async recordDeliveryError(cardId, message) {
      const { error } = await client.rpc("record_gift_card_delivery_error", { p_card_id: cardId, p_error: message });
      if (error) console.error("could not record delivery error", cardId, error.message);
    },
    async listDueCards(todayLagos, scheduledOk, limit) {
      const { data, error } = await client.rpc("list_due_gift_cards", { p_today: todayLagos, p_scheduled_ok: scheduledOk, p_limit: limit });
      if (error) throw new Error(error.message);
      return data ?? [];
    }
  };
}

// _shared/email.ts
function createResendSender(fetchFn, cfg) {
  return async (msg) => {
    const res = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": msg.idempotencyKey.slice(0, 256)
      },
      body: JSON.stringify({
        from: cfg.from,
        to: [msg.to],
        reply_to: cfg.replyTo,
        subject: msg.subject,
        html: msg.html,
        text: msg.text
      })
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = String((await res.json())?.message ?? "").slice(0, 200);
      } catch {
      }
      throw new Error(`resend_${res.status}${detail ? ": " + detail : ""}`);
    }
  };
}

// _shared/messaging.ts
function toE164(raw) {
  let d = String(raw ?? "").replace(/[^\d+]/g, "");
  const plus = d.startsWith("+");
  d = d.replace(/\D/g, "");
  if (!plus && d.startsWith("00")) d = d.slice(2);
  else if (!plus && d.startsWith("0") && d.length === 11) d = "234" + d.slice(1);
  else if (!plus && d.length === 10 && /^[789]/.test(d)) d = "234" + d;
  return d.length >= 11 && d.length <= 15 ? d : null;
}
function gsm(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9 .,!?'\-:/@()+&%\n]/g, "").replace(/\s+/g, " ").trim();
}
var firstName2 = (n) => gsm(n).split(" ")[0] || "there";
function smsText(m) {
  const amount = "NGN " + Math.round(m.amount).toLocaleString("en-US");
  return `Hi ${firstName2(m.recipientName)}, ${gsm(m.senderName) || "Someone"} sent you a StreetTasker gift card worth ${amount}! Redeem it here: ${m.redeemUrl}`;
}
async function sendSms(fetchFn, cfg, to, m) {
  const res = await fetchFn(cfg.baseUrl.replace(/\/+$/, "") + "/api/sms/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: cfg.apiKey, to, from: cfg.senderId, sms: smsText(m), type: "plain", channel: cfg.channel })
  });
  let body = {};
  try {
    body = await res.json();
  } catch {
  }
  if (!res.ok || body.code && body.code !== "ok") {
    throw new Error(`termii_${res.status}: ${String(body.message ?? "").slice(0, 160)}`);
  }
}
async function sendWhatsApp(fetchFn, cfg, to, m) {
  const text = (v) => ({ type: "text", text: v });
  const res = await fetchFn(`https://graph.facebook.com/v21.0/${encodeURIComponent(cfg.phoneNumberId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      // Template body: "Hi {{1}}, {{2}} sent you a StreetTasker gift card worth {{3}}! Redeem it here: {{4}}"
      template: { name: cfg.template, language: { code: cfg.language }, components: [{ type: "body", parameters: [
        text(m.recipientName.split(" ")[0] || "there"),
        text(m.senderName),
        text("\u20A6" + Math.round(m.amount).toLocaleString("en-NG")),
        text(m.redeemUrl)
      ] }] }
    })
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = String((await res.json())?.error?.message ?? "").slice(0, 160);
    } catch {
    }
    throw new Error(`whatsapp_${res.status}${detail ? ": " + detail : ""}`);
  }
}
function createMessenger(fetchFn, cfg) {
  if (!cfg.termii && !cfg.whatsapp) return null;
  return async (m) => {
    const to = toE164(m.to);
    if (!to) throw new Error("bad_phone_number");
    const errors = [];
    if (cfg.whatsapp) {
      try {
        await sendWhatsApp(fetchFn, cfg.whatsapp, to, m);
        return "whatsapp";
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    if (cfg.termii) {
      try {
        await sendSms(fetchFn, cfg.termii, to, m);
        return "sms";
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    throw new Error(errors.join(" | "));
  };
}

// _shared/runtime.ts
var DEFAULT_FROM = "StreetTasker Gifts <gifts@contact.streettasker.com>";
var DEFAULT_SUPPORT = "kiyomigroups@gmail.com";
function realDeps() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const paystackSecret = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!url || !serviceKey || !paystackSecret) throw new Error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or PAYSTACK_SECRET_KEY");
  const supportEmail = Deno.env.get("GIFT_SUPPORT_EMAIL") ?? DEFAULT_SUPPORT;
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const deps = {
    db: createDb(url, serviceKey),
    paystackSecret,
    siteUrl: (Deno.env.get("SITE_URL") ?? "https://streettasker.com").replace(/\/+$/, ""),
    fetchFn: fetch,
    now: () => /* @__PURE__ */ new Date(),
    supportEmail,
    cronSecret: Deno.env.get("CRON_SECRET") || void 0
  };
  if (resendKey) {
    deps.sendEmail = createResendSender(fetch, {
      apiKey: resendKey,
      from: Deno.env.get("GIFT_EMAIL_FROM") ?? DEFAULT_FROM,
      replyTo: supportEmail
    });
    const env = (k) => Deno.env.get(k) || void 0;
    const termiiKey = env("TERMII_API_KEY"), termiiSender = env("TERMII_SENDER_ID");
    const waToken = env("WHATSAPP_TOKEN"), waPhone = env("WHATSAPP_PHONE_NUMBER_ID"), waTemplate = env("WHATSAPP_TEMPLATE_NAME");
    deps.sendMessage = createMessenger(fetch, {
      termii: termiiKey && termiiSender ? { apiKey: termiiKey, senderId: termiiSender, baseUrl: env("TERMII_BASE_URL") ?? "https://api.ng.termii.com", channel: env("TERMII_CHANNEL") === "generic" ? "generic" : "dnd" } : void 0,
      whatsapp: waToken && waPhone && waTemplate ? { token: waToken, phoneNumberId: waPhone, template: waTemplate, language: env("WHATSAPP_TEMPLATE_LANG") ?? "en" } : void 0
    }) ?? void 0;
    deps.onIssued = (card, order) => {
      const work = onCardIssued(deps, card, order);
      const rt = globalThis.EdgeRuntime;
      if (rt?.waitUntil) {
        rt.waitUntil(work);
        return Promise.resolve();
      }
      return work;
    };
  } else {
    console.warn("RESEND_API_KEY is not set: gift cards are issued but no emails are sent.");
  }
  return deps;
}

// verify-gift-card-payment/index.ts
Deno.serve((req) => handleVerify(req, realDeps()));
