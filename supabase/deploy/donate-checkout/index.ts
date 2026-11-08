// Self-contained build for the Supabase dashboard editor. Function name: donate-checkout
// Public (no login). Starts a Paystack card payment for a donation and records it as "pending".
// The money is confirmed and the receipt is sent by paystack-webhook, never by this function.
// Secrets used (all already set for the gift cards): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PAYSTACK_SECRET_KEY, SITE_URL (optional)
import { createClient } from "npm:@supabase/supabase-js@2";

const MIN_AMOUNT = 500;
const MAX_AMOUNT = 5_000_000;
const MAX_PER_IP_PER_HOUR = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, max);
}
function newReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let out = "";
  for (const b of bytes) out += REF_ALPHABET[b % 32];
  return "DN-" + out;
}
function allowedOrigin(req: Request, siteUrl: string): string {
  const origin = req.headers.get("origin") ?? "";
  const site = new URL(siteUrl).origin;
  const www = site.replace("://", "://www.");
  if (origin === site || origin === www) return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return site;
}
function cors(req: Request, siteUrl: string) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(req, siteUrl),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}
function reply(req: Request, siteUrl: string, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req, siteUrl), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  const siteUrl = (Deno.env.get("SITE_URL") ?? "https://streettasker.com").replace(/\/+$/, "");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req, siteUrl) });
  if (req.method !== "POST") return reply(req, siteUrl, { error: "Method not allowed." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!url || !serviceKey || !secret) {
    console.error("donate-checkout: missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or PAYSTACK_SECRET_KEY");
    return reply(req, siteUrl, { error: "Donations are not available right now. Please try again later." }, 500);
  }

  let body: any = null;
  try { body = await req.json(); } catch { /* handled below */ }
  if (!body || typeof body !== "object") return reply(req, siteUrl, { error: "Invalid request." }, 400);

  const amount = body.amount;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < MIN_AMOUNT) {
    return reply(req, siteUrl, { error: `Please enter a whole amount of \u20A6${MIN_AMOUNT.toLocaleString("en-NG")} or more.`, field: "amount" }, 422);
  }
  if (amount > MAX_AMOUNT) {
    return reply(req, siteUrl, { error: `For gifts above \u20A6${MAX_AMOUNT.toLocaleString("en-NG")}, please email contact@streettasker.com.`, field: "amount" }, 422);
  }
  const email = cleanText(body.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return reply(req, siteUrl, { error: "Enter an email address so we can send your receipt.", field: "email" }, 422);
  }
  const name = cleanText(body.name, 80) || null;

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const ip = ((req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "").trim().slice(0, 64)) || null;
  if (ip) {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await db.from("donations").select("id", { count: "exact", head: true }).eq("client_ip", ip).gte("created_at", since);
    if ((count ?? 0) >= MAX_PER_IP_PER_HOUR) return reply(req, siteUrl, { error: "Too many attempts. Please try again in a little while." }, 429);
  }

  const reference = newReference();
  const { error: insErr } = await db.from("donations").insert({ reference, source: "paystack", amount, donor_name: name, donor_email: email, client_ip: ip });
  if (insErr) {
    console.error("donate-checkout insert failed", insErr.message);
    return reply(req, siteUrl, { error: "We couldn\u2019t start the payment. Please try again." }, 502);
  }

  try {
    const res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        amount: amount * 100, // always computed here from the validated naira amount
        currency: "NGN",
        reference,
        callback_url: `${siteUrl}/local-taskers.html?donation=thanks#donate`,
        metadata: { kind: "donation", cancel_action: `${siteUrl}/local-taskers.html#donate` },
      }),
    });
    const j = await res.json().catch(() => null);
    const authUrl = j?.data?.authorization_url;
    if (!res.ok || !j?.status || typeof authUrl !== "string" || !authUrl.startsWith("https://checkout.paystack.com/")) {
      throw new Error(`paystack_initialize_failed:${res.status}:${j?.message ?? ""}`);
    }
    return reply(req, siteUrl, { authorization_url: authUrl, reference });
  } catch (err) {
    console.error("donate-checkout failed", reference, err instanceof Error ? err.message : err);
    await db.from("donations").update({ status: "failed" }).eq("reference", reference).eq("status", "pending");
    return reply(req, siteUrl, { error: "We couldn\u2019t start the payment. Please try again." }, 502);
  }
});
