// Edge Function: coordinator-apply
// Public form from coordinator-apply.html. Validates the answers and emails them to the admin through Resend.
// Deploy with "Verify JWT" OFF is not required: the page sends the project anon key, so JWT verification can stay ON.
//
// Secrets:
//   RESEND_API_KEY                      (required, already used by the gift card emails)
//   COORDINATOR_APPLICATIONS_TO         (optional, default admin@streettasker.com)
//   COORDINATOR_EMAIL_FROM              (optional, default "StreetTasker <gifts@contact.streettasker.com>"; use any sender on your verified Resend domain)
//   ALLOWED_ORIGINS                     (optional, comma separated extra origins for testing)
const DEFAULT_ORIGINS = ["https://streettasker.com", "https://www.streettasker.com"];
const DEFAULT_TO = "admin@streettasker.com";
const DEFAULT_FROM = "StreetTasker <gifts@contact.streettasker.com>";
const PHONE_RE = /^\+?[0-9][0-9 ()-]{6,19}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function allowedOrigin(req: Request): string {
  const extra = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const list = [...DEFAULT_ORIGINS, ...extra];
  const origin = req.headers.get("origin") ?? "";
  return list.includes(origin) ? origin : DEFAULT_ORIGINS[0];
}
function cors(req: Request) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(req),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function json(req: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
const fail = (req: Request, status: number, error: string, message: string) => json(req, status, { ok: false, error, message });
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const FIELDS: Array<[string, string, number, boolean]> = [
  // [key, label, max length, required]
  ["full_name", "Full name", 120, true], ["email", "Email", 160, true], ["phone", "Phone", 24, true],
  ["whatsapp", "WhatsApp", 24, false], ["age_range", "Age range", 40, true], ["occupation", "Current occupation", 160, true],
  ["state", "State", 80, true], ["city", "City or town", 80, true], ["areas", "Areas they could cover", 600, true],
  ["years_in_area", "Time in the area", 40, true], ["tasker_count", "Taskers they could bring in 30 days", 40, true],
  ["how_you_know", "How they know these people", 800, true], ["experience", "Leadership or sales experience", 1000, true],
  ["hours", "Hours per week", 40, true], ["languages", "Languages", 160, true], ["smartphone", "Smartphone and internet", 20, true],
  ["has_id", "Has valid government ID", 10, true], ["why", "Why they want to be a coordinator", 1200, true],
  ["heard", "How they heard about us", 60, false], ["social", "Social profile or website", 200, false],
  ["ref_name", "Reference name", 120, false], ["ref_phone", "Reference phone", 24, false], ["notes", "Other notes", 1000, false],
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return fail(req, 405, "method_not_allowed", "Use POST.");

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return fail(req, 500, "server_misconfigured", "Applications are not available right now. Please try again later.");

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail(req, 400, "bad_json", "Invalid request."); }

  const v: Record<string, string> = {};
  for (const [key, label, max, required] of FIELDS) {
    v[key] = str(body[key], max);
    if (required && !v[key]) return fail(req, 400, "missing_field", `${label} is required.`);
  }
  const trades = Array.isArray(body.trades) ? body.trades.map((t) => str(t, 60)).filter(Boolean).slice(0, 12) : [];
  if (!trades.length) return fail(req, 400, "missing_field", "Please choose at least one skill or trade.");
  if (!EMAIL_RE.test(v.email)) return fail(req, 400, "bad_email", "Please enter a valid email address.");
  if (!PHONE_RE.test(v.phone) || (v.whatsapp && !PHONE_RE.test(v.whatsapp))) return fail(req, 400, "bad_phone", "Please enter a valid phone number.");
  if (v.age_range === "Under 18") return fail(req, 400, "underage", "Coordinators must be 18 or older.");
  if (body.consent !== true) return fail(req, 400, "consent_required", "Consent is required.");

  const rows: Array<[string, string]> = [];
  for (const [key, label] of FIELDS) {
    if (key === "tasker_count") rows.push(["Skills or trades they know people in", trades.join(", ")]);
    if (v[key]) rows.push([label, v[key]]);
  }
  const html = `<h2>New coordinator application</h2><p>From ${esc(v.full_name)} (${esc(v.city)}, ${esc(v.state)}). Reply to this email to reach the applicant.</p>` +
    `<table cellpadding="8" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">` +
    rows.map(([k, val]) => `<tr><td style="border:1px solid #ddd;font-weight:bold;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="border:1px solid #ddd;white-space:pre-wrap">${esc(val)}</td></tr>`).join("") +
    `</table>`;
  const text = `New coordinator application\n\n` + rows.map(([k, val]) => `${k}: ${val}`).join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({
      from: Deno.env.get("COORDINATOR_EMAIL_FROM") ?? DEFAULT_FROM,
      to: [Deno.env.get("COORDINATOR_APPLICATIONS_TO") ?? DEFAULT_TO],
      reply_to: v.email,
      subject: `Coordinator application: ${v.full_name} (${v.city}, ${v.state})`,
      html, text,
    }),
  });
  if (!res.ok) {
    console.error("resend failed", res.status, (await res.text()).slice(0, 200));
    return fail(req, 502, "email_failed", "We could not send your application. Please try again.");
  }
  return json(req, 200, { ok: true });
});
