// Self-contained build for the Supabase dashboard editor (all shared code is inside this file).
// S5c-2 (subscriptions): after a subscription payment is paid, the reusable card is saved (RPC subscription_store_authorization). Failure to save is only logged; the answer to Paystack never changes.
// Stage 7C-3 adds ONE branch: Paystack transfer.success / transfer.failed / transfer.reversed for Local Tasker payouts (references starting st-lp-). Gift cards, job payments (ST-) and withdrawals (wd-) are unchanged.
// Donations (Local Taskers): ONE more branch. charge.success with metadata.kind "donation" and a reference starting DN- is verified, recorded in public.donations and receipted by email. Nothing else is changed.
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
function shell(title, preheader, inner, support, foot = "StreetTasker gift cards never expire.") {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body style="margin:0;padding:0;background:${C.band}"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.band}">${esc(preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.band}"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px"><tr><td style="padding:0 4px 16px;font-family:${FONT};font-size:22px;font-weight:800;color:${C.green}">StreetTasker</td></tr><tr><td style="background:${C.white};border-radius:24px;padding:32px 28px;font-family:${FONT};font-size:15px;line-height:1.6;color:${C.muted}">${inner}</td></tr><tr><td style="padding:20px 8px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.muted};text-align:center">Questions? Reply to this email or write to <a href="mailto:${esc(support)}" style="color:${C.mintText}">${esc(support)}</a>.<br>${esc(foot)}</td></tr></table></td></tr></table></body></html>`;
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
function deliveryNote(order, card) {
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
  if (card.send_on) {
    return { sentence: `We cannot message phone numbers automatically yet. On ${longDate(card.send_on)} we will email you a reminder with the card, ready to forward to ${card.recipient_name}.`, forward: false };
  }
  return { sentence: `We cannot message phone numbers automatically yet, so the card is below. Send it to ${card.recipient_name} on WhatsApp or by text.`, forward: true };
}
function receiptEmail(order, card, siteUrl, support) {
  const note = deliveryNote(order, card);
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
    const mail = receiptEmail(order, card, deps.siteUrl, deps.supportEmail);
    await deps.sendEmail({ to: order.buyer_email, ...mail, idempotencyKey: `gc-receipt-${order.id}` });
    await deps.db.markReceiptSent(order.id);
    if (!card.delivered_at && !card.send_on && deliveryNote(order, card).forward) {
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
  if (dueNow && card.delivery === "digital" && contactKind(card.recipient_contact) === "email") {
    await deliverCard(deps, card.id);
  }
}

// _shared/paystack.ts
var API = "https://api.paystack.co";
async function verifyTransaction(fetchFn, secret, reference) {
  const res = await fetchFn(`${API}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret}` }
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.status || !json?.data) {
    throw new Error(`paystack_verify_failed:${res.status}:${json?.message ?? ""}`);
  }
  return json.data;
}
async function verifySignature(secret, rawBody, signatureHex) {
  if (!signatureHex || !/^[0-9a-f]{128}$/i.test(signatureHex)) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["verify"]);
  const sig = new Uint8Array(signatureHex.match(/../g).map((h) => parseInt(h, 16)));
  return crypto.subtle.verify("HMAC", key, sig, enc.encode(rawBody));
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

// local-payout events (Stage 7C-3): Paystack transfer.* events for Local Tasker payouts. Only references we made ("st-lp-" + 32 hex, optional -rN) are handled here.
// Every other transfer event is ignored exactly as before (withdrawals have their own references and are not touched).
var LP_REF_RE = /^st-lp-[0-9a-f]{32}(-r[0-9]{1,3})?$/;
var LP_EVENTS = ["transfer.success", "transfer.failed", "transfer.reversed"];
var TRF_CODE_RE = /^TRF_[A-Za-z0-9]{4,40}$/;
async function handleLocalPayoutEvent(deps, event) {
  const d = event.data ?? {};
  const reference = typeof d.reference === "string" ? d.reference : "";
  if (!LP_EVENTS.includes(event.event) || !LP_REF_RE.test(reference)) return null;
  try {
    const res = await deps.db.localPayoutEvent({
      reference,
      event: event.event,
      transferCode: typeof d.transfer_code === "string" && TRF_CODE_RE.test(d.transfer_code) ? d.transfer_code : null,
      amountKobo: Number.isSafeInteger(d.amount) ? d.amount : null,
      currency: typeof d.currency === "string" ? d.currency.slice(0, 8) : null
    });
    console.log("local payout event", event.event, reference, res?.matched ? (res?.changed ? "applied" : "no change") : "no match");
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("local payout event failed", event.event, reference, err instanceof Error ? err.message : err);
    return new Response("error", { status: 500 });
  }
}

// _shared/donations.ts (NEW: Local Taskers donations, references "DN-" + 20 characters)
var DONATION_REF_RE = /^DN-[A-Z2-9]{20}$/;
function lagosDateTime(d) {
  return d.toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }) + " (Lagos time)";
}
function donationReceiptEmail(d, support) {
  const subject = `Thank you for your donation (${naira(d.amount)})`;
  const row = (k, v) => `<tr><td style="padding:6px 0;font-family:${FONT};font-size:14px;color:${C.muted}">${k}</td><td align="right" style="padding:6px 0;font-family:${FONT};font-size:14px;font-weight:600;color:${C.ink}">${v}</td></tr>`;
  const when = lagosDateTime(d.paid_at ? new Date(d.paid_at) : new Date());
  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;border-top:1px solid ${C.rule};border-bottom:1px solid ${C.rule}">` + row("Donation to", "Local Taskers") + row("Amount received", naira(d.amount)) + row("Date", esc(when)) + row("Paid by", "Card or bank via Paystack") + row("Reference", `<span style="font-family:'Courier New',Courier,monospace;font-size:12px">${esc(d.reference)}</span>`) + `</table>`;
  const who = d.donor_name ? firstName(d.donor_name) : "there";
  const html = shell(
    subject,
    `We received your ${naira(d.amount)} donation. Thank you.`,
    h1("Thank you for your donation") + p(`Hi ${esc(who)}, we have received your donation to support Local Taskers. It helps skilled people who are not yet online get onto StreetTasker, with a coordinator beside them.`) + table + p(`Please keep this email as your record. If you need anything else for your own accounts, reply to this email and tell us.`),
    support,
    "StreetTasker is run by Street Taskers Ventures."
  );
  const text = [
    "Thank you for your donation",
    "",
    `Hi ${who}, we have received your donation to support Local Taskers.`,
    "",
    `Amount received: ${naira(d.amount)}`,
    `Date: ${when}`,
    `Reference: ${d.reference}`,
    "",
    "Please keep this email as your record. Reply to it if you need anything else.",
    `Questions? Write to ${support}`
  ].join("\n");
  return { subject, html, text };
}
function donationAdminEmail(d, support) {
  const subject = `Donation received: ${naira(d.amount)} (${d.reference})`;
  const html = shell(
    subject,
    `${naira(d.amount)} donation confirmed by Paystack.`,
    h1("Donation received") + p(`${esc(naira(d.amount))} was paid and confirmed by Paystack.`) + p(`Donor: ${esc(d.donor_name || "(no name given)")} &lt;${esc(d.donor_email)}&gt;<br>Reference: ${esc(d.reference)}<br>Receipt to donor: ${d.receipt_sent_at ? "sent" : "being sent"}`) + p("It is recorded in the donations table. Check it against your Paystack settlement when the money reaches your bank."),
    support,
    "Internal notice."
  );
  const text = `Donation received: ${naira(d.amount)}\nDonor: ${d.donor_name || "(no name given)"} <${d.donor_email}>\nReference: ${d.reference}\nRecorded in the donations table.`;
  return { subject, html, text };
}
async function fulfilDonation(deps, reference) {
  let d = await deps.db.getDonation(reference);
  if (!d) {
    console.error("donation webhook: unknown reference", reference);
    return;
  }
  if (d.status !== "paid") {
    const tx = await verifyTransaction(deps.fetchFn, deps.paystackSecret, reference);
    if (tx.status !== "success") return;
    if (tx.currency !== "NGN" || tx.amount !== d.amount * 100) {
      await deps.db.flagDonation(reference, `amount_mismatch: expected ${d.amount * 100} NGN kobo, Paystack says ${tx.amount} ${tx.currency}`);
      console.error("donation amount mismatch", reference, tx.amount, tx.currency);
      return;
    }
    await deps.db.markDonationPaid(reference, tx.amount, tx.channel ?? null);
    d = await deps.db.getDonation(reference);
  }
  if (!deps.sendDonationEmail) {
    console.warn("RESEND_API_KEY is not set: donation recorded, no emails sent.", reference);
    return;
  }
  let failed = null;
  try {
    const mine = await deps.db.claimDonationReceipt(reference);
    if (mine) {
      await deps.sendDonationEmail({ to: mine.donor_email, ...donationReceiptEmail(mine, deps.donationReplyTo), idempotencyKey: `dn-receipt-${mine.id}` });
      await deps.db.markDonationReceiptSent(reference);
    }
  } catch (err) {
    failed = err;
    console.error("donation receipt failed", reference, errMsg(err));
  }
  try {
    const fresh = await deps.db.getDonation(reference);
    const mineAdmin = await deps.db.claimDonationAdminNotice(reference);
    if (mineAdmin) {
      await deps.sendDonationEmail({ to: deps.donationNotifyTo, ...donationAdminEmail(fresh ?? mineAdmin, deps.donationReplyTo), idempotencyKey: `dn-admin-${mineAdmin.id}` });
      await deps.db.markDonationAdminNotified(reference);
    }
  } catch (err) {
    failed = failed ?? err;
    console.error("donation admin notice failed", reference, errMsg(err));
  }
  if (failed) throw failed;
}

// _shared/handlers.ts
async function handleWebhook(req, deps) {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const raw = await req.text();
  const valid = await verifySignature(deps.paystackSecret, raw, req.headers.get("x-paystack-signature"));
  if (!valid) return new Response("Invalid signature", { status: 401 });
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (typeof event.event === "string" && event.event.startsWith("transfer.")) {
    const handled = await handleLocalPayoutEvent(deps, event);
    if (handled) return handled;
  }
  const reference = event.data?.reference ?? "";
  if (event.event === "charge.success" && event.data?.metadata?.kind === "donation" && DONATION_REF_RE.test(reference)) {
    try {
      await fulfilDonation(deps, reference);
      return new Response("ok", { status: 200 });
    } catch (err) {
      console.error("webhook donation failed", reference, err instanceof Error ? err.message : err);
      return new Response("error", { status: 500 });
    }
  }
  const isGiftCard = event.data?.metadata?.kind === "gift_card" && REFERENCE_RE.test(reference);
  if (event.event === "charge.success" && !isGiftCard && deps.payments && JOB_REFERENCE_RE.test(reference)) {
    return handleJobPayment(deps, reference);
  }
  if (TRANSFER_EVENTS.includes(event.event) && deps.withdrawals && WITHDRAWAL_REFERENCE_RE.test(reference)) {
    return handleTransferEvent(deps, event, reference);
  }
  if (event.event !== "charge.success" || !isGiftCard) return new Response("ignored", { status: 200 });
  try {
    await verifyAndFulfil(deps, reference);
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("webhook fulfil failed", reference, err instanceof Error ? err.message : err);
    return new Response("error", { status: 500 });
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
    },
    async getDonation(reference) {
      const { data, error } = await client.from("donations").select("*").eq("reference", reference).maybeSingle();
      if (error) throw new Error(error.message);
      return data ?? null;
    },
    async markDonationPaid(reference, paidKobo, channel) {
      const { error } = await client.from("donations").update({ status: "paid", paid_kobo: paidKobo, channel, paid_at: new Date().toISOString() }).eq("reference", reference).in("status", ["pending", "failed"]);
      if (error) throw new Error(error.message);
    },
    async flagDonation(reference, reason) {
      const { error } = await client.from("donations").update({ status: "flagged", flag_reason: reason.slice(0, 300) }).eq("reference", reference).neq("status", "paid");
      if (error) throw new Error(error.message);
    },
    async claimDonationReceipt(reference) {
      const stale = new Date(Date.now() - 5 * 60 * 1e3).toISOString();
      const { data, error } = await client.from("donations").update({ receipt_claimed_at: new Date().toISOString() }).eq("reference", reference).eq("status", "paid").is("receipt_sent_at", null).or(`receipt_claimed_at.is.null,receipt_claimed_at.lt.${stale}`).select("*").maybeSingle();
      if (error) throw new Error(error.message);
      return data ?? null;
    },
    async markDonationReceiptSent(reference) {
      const { error } = await client.from("donations").update({ receipt_sent_at: new Date().toISOString() }).eq("reference", reference);
      if (error) throw new Error(error.message);
    },
    async claimDonationAdminNotice(reference) {
      const stale = new Date(Date.now() - 5 * 60 * 1e3).toISOString();
      const { data, error } = await client.from("donations").update({ admin_claimed_at: new Date().toISOString() }).eq("reference", reference).eq("status", "paid").is("admin_notified_at", null).or(`admin_claimed_at.is.null,admin_claimed_at.lt.${stale}`).select("*").maybeSingle();
      if (error) throw new Error(error.message);
      return data ?? null;
    },
    async markDonationAdminNotified(reference) {
      const { error } = await client.from("donations").update({ admin_notified_at: new Date().toISOString() }).eq("reference", reference);
      if (error) throw new Error(error.message);
    },
    async localPayoutEvent(e) {
      const { data, error } = await client.rpc("local_payout_apply_event", {
        p_reference: e.reference,
        p_event: e.event,
        p_transfer_code: e.transferCode,
        p_amount_kobo: e.amountKobo,
        p_currency: e.currency,
        p_reason: null
      });
      if (error) throw new Error(error.message);
      return data;
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
  deps.payments = createPaymentsDb(url, serviceKey);
  deps.withdrawals = createWithdrawalsDb(url, serviceKey);
  deps.donationReplyTo = Deno.env.get("DONATION_REPLY_TO") ?? "contact@streettasker.com";
  deps.donationNotifyTo = Deno.env.get("DONATION_NOTIFY_TO") ?? "contact@streettasker.com";
  if (resendKey) {
    deps.sendDonationEmail = createResendSender(fetch, {
      apiKey: resendKey,
      from: Deno.env.get("DONATION_EMAIL_FROM") ?? "StreetTasker <gifts@contact.streettasker.com>",
      replyTo: deps.donationReplyTo
    });
    deps.sendEmail = createResendSender(fetch, {
      apiKey: resendKey,
      from: Deno.env.get("GIFT_EMAIL_FROM") ?? DEFAULT_FROM,
      replyTo: supportEmail
    });
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

// _shared/job-payments.ts (W4a: NEW. Job payments and wallet top-ups, references "ST-" + 32 hex)
var JOB_REFERENCE_RE = /^ST-[0-9a-f]{32}$/;
function createPaymentsDb(url, serviceRoleKey) {
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return {
    async getIntentStatus(reference) {
      const { data, error } = await client.from("payment_intents").select("status").eq("reference", reference).maybeSingle();
      if (error) throw new Error("db_error: " + String(error.message).slice(0, 200));
      return data ? String(data.status) : null;
    },
    async finalize(reference, paidKobo, currency) {
      const { data, error } = await client.rpc("payment_finalize", {
        p_reference: reference,
        p_paid_kobo: paidKobo,
        p_currency: currency
      });
      if (error) throw new Error("db_error: " + String(error.message).slice(0, 200));
      return data;
    },
    // S5c-2: what the payment was for (read only)
    async getIntentPurpose(reference) {
      const { data, error } = await client.from("payment_intents").select("purpose").eq("reference", reference).maybeSingle();
      if (error) throw new Error("db_error: " + String(error.message).slice(0, 200));
      return data ? String(data.purpose) : null;
    },
    // S5c-2: save the reusable card of a PAID subscription payment (server only RPC; it answers no card data)
    async storeAuthorization(reference, authorization, customerEmail) {
      const { data, error } = await client.rpc("subscription_store_authorization", {
        p_reference: reference,
        p_authorization: authorization,
        p_customer_email: customerEmail
      });
      if (error) throw new Error("db_error: " + String(error.message).slice(0, 200));
      return data;
    }
  };
}
// S5c-2: only the fields renewal needs leave this function (never the account holder's name or the card bin)
var AUTH_FIELDS = ["authorization_code", "last4", "exp_month", "exp_year", "brand", "bank", "signature", "channel", "reusable"];
function pickAuthorization(tx) {
  const a = tx && typeof tx.authorization === "object" && tx.authorization !== null && !Array.isArray(tx.authorization) ? tx.authorization : null;
  if (!a) return null;
  const out = {};
  for (const k of AUTH_FIELDS) if (a[k] !== void 0) out[k] = a[k];
  return out;
}
// Only a fixed word or a Paystack status is logged: a database error text could echo what was sent.
function cardFailReason(err) {
  const m = err instanceof Error ? err.message : "";
  return /^paystack_verify_failed:[0-9]{3}/.test(m) ? m.slice(0, 26) : "failed";
}
// Never throws and never logs the card: a failure here must not change the answer to Paystack.
async function saveSubscriptionCard(deps, reference, tx) {
  try {
    if (!deps.payments || typeof deps.payments.storeAuthorization !== "function") return;
    const email = tx && typeof tx.customer?.email === "string" ? tx.customer.email : null;
    const res = await deps.payments.storeAuthorization(reference, pickAuthorization(tx), email);
    const reason = res && typeof res.reason === "string" && /^[a-z_]{1,40}$/.test(res.reason) ? res.reason : "";
    console.log("webhook: subscription card", res && res.stored === true ? "stored" : "not stored", reason, reference);
  } catch (err) {
    console.error("webhook: subscription card could not be saved", reference, cardFailReason(err));
  }
}
// The payment may already be paid (the browser check can finalise it first): look up its purpose, confirm with Paystack, then save the card.
async function saveSubscriptionCardIfPaid(deps, reference) {
  try {
    if (!deps.payments || typeof deps.payments.storeAuthorization !== "function" || typeof deps.payments.getIntentPurpose !== "function") return;
    if (await deps.payments.getIntentPurpose(reference) !== "subscription") return;
    const tx = await verifyTransaction(deps.fetchFn, deps.paystackSecret, reference);
    if (tx.status !== "success" || tx.reference !== reference) return;
    await saveSubscriptionCard(deps, reference, tx);
  } catch (err) {
    console.error("webhook: subscription card could not be saved", reference, cardFailReason(err));
  }
}
function safeReason(err) {
  const m = err instanceof Error ? err.message : "";
  if (m.startsWith("paystack_verify_failed:")) return m.split(":").slice(0, 2).join(":");
  if (m.startsWith("db_error: ") || m === "payment_finalize_bad_answer" || m === "withdrawal_bad_answer") return m;
  return err instanceof Error ? err.name : "unknown";
}
async function handleJobPayment(deps, reference) {
  try {
    const status = await deps.payments.getIntentStatus(reference);
    if (status === null) {
      console.warn("webhook: unknown job payment reference", reference);
      return new Response("ignored", { status: 200 });
    }
    if (status === "paid") {
      await saveSubscriptionCardIfPaid(deps, reference);
      return new Response("ok", { status: 200 });
    }
    const tx = await verifyTransaction(deps.fetchFn, deps.paystackSecret, reference);
    if (tx.status !== "success" || tx.reference !== reference) {
      console.warn("webhook: Paystack does not confirm this job payment", reference, String(tx.status));
      return new Response("ignored", { status: 200 });
    }
    const result = await deps.payments.finalize(reference, tx.amount, tx.currency);
    if (result && result.ok === true) {
      if (result.purpose === "subscription") await saveSubscriptionCard(deps, reference, tx);
      return new Response("ok", { status: 200 });
    }
    if (result && result.ok === false) {
      console.error("webhook: payment needs review", reference);
      return new Response("needs review", { status: 200 });
    }
    throw new Error("payment_finalize_bad_answer");
  } catch (err) {
    console.error("webhook job payment failed", reference, safeReason(err));
    return new Response("error", { status: 500 });
  }
}

// _shared/transfers.ts (W4b: NEW. Payout results from Paystack, withdrawal references "wd-" + 32 hex)
var TRANSFER_EVENTS = ["transfer.success", "transfer.failed", "transfer.reversed"];
var WITHDRAWAL_REFERENCE_RE = /^wd-[0-9a-f]{32}$/;
var NO_REASON = "Paystack did not give a reason";
function createWithdrawalsDb(url, serviceRoleKey) {
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const fail = (error) => new Error("db_error: " + String(error.message).slice(0, 200));
  return {
    async getStatus(reference) {
      const { data, error } = await client.from("withdrawals").select("status").eq("reference", reference).maybeSingle();
      if (error) throw fail(error);
      return data ? String(data.status) : null;
    },
    async succeed(reference, transferCode) {
      const { data, error } = await client.rpc("withdrawal_succeed", { p_reference: reference, p_transfer_code: transferCode });
      if (error) throw fail(error);
      return data;
    },
    async fail(reference, status, reason) {
      const { data, error } = await client.rpc("withdrawal_fail", { p_reference: reference, p_status: status, p_reason: reason });
      if (error) throw fail(error);
      return data;
    }
  };
}
async function verifyTransfer(fetchFn, secret, reference) {
  const res = await fetchFn(`${API}/transfer/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret}` }
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.status || !json?.data) {
    throw new Error(`paystack_verify_failed:${res.status}`);
  }
  return json.data;
}
function failureReason(...sources) {
  for (const d of sources) {
    for (const v of [d?.gateway_response, d?.failures]) {
      if (typeof v === "string" && v.trim()) return v.trim().slice(0, 300);
      if (v && typeof v === "object" && Object.keys(v).length > 0) {
        try {
          return JSON.stringify(v).slice(0, 300);
        } catch {
        }
      }
    }
  }
  return NO_REASON;
}
async function handleTransferEvent(deps, event, reference) {
  try {
    const current = await deps.withdrawals.getStatus(reference);
    if (current === null) {
      console.warn("webhook: unknown withdrawal reference", reference);
      return new Response("ignored", { status: 200 });
    }
    const wantsSuccess = event.event === "transfer.success";
    if (wantsSuccess && current === "success") return new Response("ok", { status: 200 });
    if (!wantsSuccess && (current === "failed" || current === "reversed")) return new Response("ok", { status: 200 });
    const tx = await verifyTransfer(deps.fetchFn, deps.paystackSecret, reference);
    const real = String(tx.status ?? "").toLowerCase();
    if (tx.reference !== void 0 && tx.reference !== reference) {
      console.warn("webhook: Paystack answered for a different transfer", reference);
      return new Response("ignored", { status: 200 });
    }
    let result;
    if (wantsSuccess) {
      if (real !== "success") {
        console.warn("webhook: Paystack does not confirm this payout as success", reference, real);
        return new Response("ignored", { status: 200 });
      }
      const code = String(tx.transfer_code ?? event.data?.transfer_code ?? "");
      result = await deps.withdrawals.succeed(reference, code);
    } else {
      if (real !== "failed" && real !== "reversed") {
        console.warn("webhook: Paystack does not confirm this payout as failed", reference, real);
        return new Response("ignored", { status: 200 });
      }
      result = await deps.withdrawals.fail(reference, real, failureReason(tx, event.data));
    }
    if (result && result.ok === true) return new Response("ok", { status: 200 });
    if (result && result.refused === true) {
      console.error("webhook: ANOMALY, payout result refused by the database, check Paystack by hand", reference, event.event);
      return new Response("needs review", { status: 200 });
    }
    if (result && result.ok === false && result.found === false) return new Response("ignored", { status: 200 });
    throw new Error("withdrawal_bad_answer");
  } catch (err) {
    console.error("webhook transfer failed", reference, safeReason(err));
    return new Response("error", { status: 500 });
  }
}

// paystack-webhook/index.ts
Deno.serve((req) => handleWebhook(req, realDeps()));
