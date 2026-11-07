// Edge Function: coordinator-apply
// Public form from coordinator-apply.html (v2, S3). Validates the answers, STORES the application in
// public.coordinator_applications (service role) and emails the admin through Resend, with the exact SQL line to approve.
// Deploy with "Verify JWT" OFF is not required: the page sends the project anon key, so JWT verification can stay ON.
//
// Secrets:
//   RESEND_API_KEY                      (required, already used by the gift card emails)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (provided automatically by Supabase to every Edge Function; nothing to set)
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
  ["years_in_area", "Time in the area", 40, true],
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
  const wholeNumber = (x: unknown, min: number, max: number): number | null => {
    const n = typeof x === "number" ? x : typeof x === "string" && /^\d+$/.test(x.trim()) ? Number(x.trim()) : NaN;
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
  };
  const taskerCount = wholeNumber(body.tasker_count, 1, 10000);
  if (taskerCount === null) return fail(req, 400, "bad_tasker_count", "Please enter how many Local Taskers you can bring, from 1 to 10,000.");
  const areaSqm = wholeNumber(body.area_sqm, 1, 100000000);
  if (areaSqm === null) return fail(req, 400, "bad_area", "Please enter the area you would cover in square metres, as a whole number.");
  if (typeof body.can_meet_taskers !== "boolean") return fail(req, 400, "missing_field", "Please say whether you can meet Local Taskers in person.");
  if (typeof body.can_explain !== "boolean") return fail(req, 400, "missing_field", "Please say whether you can explain what a Local Tasker is.");
  const canMeet = body.can_meet_taskers, canExplain = body.can_explain;
  const explainText = str(body.explain_text, 800);
  if (canExplain && !explainText) return fail(req, 400, "missing_field", "Please write in your own words what a Local Tasker is.");
  v.email = v.email.toLowerCase();
  if (!EMAIL_RE.test(v.email)) return fail(req, 400, "bad_email", "Please enter a valid email address.");
  if (!PHONE_RE.test(v.phone) || (v.whatsapp && !PHONE_RE.test(v.whatsapp))) return fail(req, 400, "bad_phone", "Please enter a valid phone number.");
  if (v.age_range === "Under 18") return fail(req, 400, "underage", "Coordinators must be 18 or older.");
  if (body.consent !== true) return fail(req, 400, "consent_required", "Consent is required.");

  // ---- store (service role; the table has no access for anon or signed-in users) ----
  const supaUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supaUrl || !serviceKey) return fail(req, 500, "server_misconfigured", "Applications are not available right now. Please try again later.");
  const rest = `${supaUrl}/rest/v1/coordinator_applications`;
  const sbHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  // Same email with an application still waiting: do not store or email a second one.
  try {
    const dup = await fetch(`${rest}?select=id&status=eq.new&email=eq.${encodeURIComponent(v.email)}&limit=1`, { headers: sbHeaders });
    if (dup.ok) {
      const found = await dup.json();
      if (Array.isArray(found) && found.length) return json(req, 200, { ok: true, duplicate: true });
    }
  } catch (e) { console.error("duplicate check failed", String(e).slice(0, 200)); }

  const answers: Record<string, unknown> = { trades, consent: true, consent_at: new Date().toISOString() };
  for (const key of ["age_range", "occupation", "areas", "years_in_area", "how_you_know", "experience", "hours", "languages", "smartphone", "has_id", "why", "heard", "social", "ref_name", "ref_phone", "notes"]) {
    if (v[key]) answers[key] = v[key];
  }
  const ins = await fetch(rest, {
    method: "POST",
    headers: { ...sbHeaders, Prefer: "return=representation" },
    body: JSON.stringify({
      full_name: v.full_name, email: v.email, phone: v.phone, whatsapp: v.whatsapp || null,
      state: v.state, city: v.city, tasker_count: taskerCount, area_sqm: areaSqm,
      can_meet_taskers: canMeet, can_explain: canExplain, explain_text: explainText || null, answers,
    }),
  });
  if (!ins.ok) {
    console.error("store failed", ins.status, (await ins.text()).slice(0, 300));
    return fail(req, 500, "store_failed", "We could not save your application. Please try again.");
  }
  const saved = await ins.json();
  const appId = Array.isArray(saved) && saved[0]?.id ? String(saved[0].id) : "";

  // ---- email the admin (the application is already stored, so an email problem does not fail the form) ----
  const yn = (b: boolean) => (b ? "Yes" : "No");
  const rows: Array<[string, string]> = [];
  for (const [key, label] of FIELDS) {
    if (key === "years_in_area") rows.push([label, v[key]]);
    else if (v[key]) rows.push([label, v[key]]);
    if (key === "years_in_area") {
      rows.push(["Skills or trades they know people in", trades.join(", ")]);
      rows.push(["Local Taskers they can bring in their area", String(taskerCount)]);
      rows.push(["Area they would cover (square metres)", String(areaSqm)]);
      rows.push(["Can meet Local Taskers in person", yn(canMeet)]);
      rows.push(["Can explain what a Local Tasker is", yn(canExplain)]);
      if (explainText) rows.push(["Their explanation of a Local Tasker", explainText]);
    }
  }
  const approveSql = appId ? `select admin_approve_coordinator_application('${appId}');` : "";
  const rejectSql = appId ? `select admin_reject_coordinator_application('${appId}', 'reason here');` : "";
  const html = `<h2>New coordinator application</h2><p>From ${esc(v.full_name)} (${esc(v.city)}, ${esc(v.state)}). Reply to this email to reach the applicant.</p>` +
    `<table cellpadding="8" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">` +
    rows.map(([k, val]) => `<tr><td style="border:1px solid #ddd;font-weight:bold;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="border:1px solid #ddd;white-space:pre-wrap">${esc(val)}</td></tr>`).join("") +
    `</table>` +
    (appId ? `<h3>To accept</h3><p>Run this in the Supabase SQL editor. It returns the test link; paste it into your email to the applicant.</p><pre style="background:#f4f4f4;padding:10px">${esc(approveSql)}</pre>` +
      `<h3>To decline</h3><pre style="background:#f4f4f4;padding:10px">${esc(rejectSql)}</pre>` : "");
  const text = `New coordinator application\n\n` + rows.map(([k, val]) => `${k}: ${val}`).join("\n") +
    (appId ? `\n\nTo accept (Supabase SQL editor, returns the test link to email them):\n${approveSql}\n\nTo decline:\n${rejectSql}\n` : "");

  try {
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
    if (!res.ok) console.error("resend failed (application", appId, "is stored)", res.status, (await res.text()).slice(0, 200));
  } catch (e) { console.error("resend error (application", appId, "is stored)", String(e).slice(0, 200)); }
  return json(req, 200, { ok: true });
});
