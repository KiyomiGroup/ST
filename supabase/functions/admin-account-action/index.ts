// Edge Function: admin-account-action  (Stage A7)
// Suspends or restores a CUSTOMER login. Suspend = block the login in Supabase Auth (a "ban") AND record it; restore = lift the ban AND record it.
// It never deletes or hides anything: bookings, disputes, reviews and refunds are not touched.
//
// Order (the browser sends only { user_id, action, reason }):
//   1. Who is calling? Verify the access token with Auth.
//   2. admin_customer_account_check  (as the caller): permission customers.suspend, a real customer, not an admin / coordinator / Tasker /
//      yourself, state fits the action, reason 10 to 300 characters.
//   3. Auth ban (suspend) or unban (restore), with the service-role key (kept on the server).
//   4. admin_customer_account_record (as the caller): writes admin_account_flags and the audit row.
//   If step 4 fails, step 3 is undone (best effort) and the person is told. Nothing is half-done silently.
// Limits: a ban stops new sign-ins and token refreshes. A session that is already open can keep working until its access token expires
// (Supabase default: up to 1 hour). Deploy with "Verify JWT" ON. Secrets SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are supplied by the platform.
import { createClient } from "npm:@supabase/supabase-js@2";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_ORIGINS = ["https://streettasker.com", "https://www.streettasker.com"];
const BAN = "876000h"; // about 100 years; lifted with "none"

function allowedOrigin(req: Request): string {
  const extra = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get("origin") ?? "";
  return [...DEFAULT_ORIGINS, ...extra].includes(origin) ? origin : DEFAULT_ORIGINS[0];
}
function cors(req: Request) {
  return { "Access-Control-Allow-Origin": allowedOrigin(req), "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
           "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
}
function json(req: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
const fail = (req: Request, status: number, error: string, message: string) => json(req, status, { ok: false, error, message });

export async function handleAction(req: Request, deps: { env: (n: string) => string | undefined; createClient: (url: string, key: string, opts?: any) => any }): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return fail(req, 405, "method_not_allowed", "Use POST.");
  const url = deps.env("SUPABASE_URL"), anonKey = deps.env("SUPABASE_ANON_KEY"), serviceKey = deps.env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return fail(req, 500, "server_misconfigured", "Server is not configured.");
  const service = deps.createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return fail(req, 401, "unauthenticated", "Sign in first.");
  const { data: au, error: auErr } = await service.auth.getUser(token);
  if (auErr || !au?.user?.id) return fail(req, 401, "unauthenticated", "Sign in first.");

  let raw = "";
  try { raw = await req.text(); } catch { return fail(req, 400, "bad_input", "Could not read the request."); }
  if (raw.length > 3_000) return fail(req, 413, "too_large", "Request too large.");
  let body: any;
  try { body = JSON.parse(raw); } catch { return fail(req, 400, "bad_input", "Body must be JSON."); }
  const userId = typeof body?.user_id === "string" ? body.user_id.trim() : "";
  const action = body?.action === "suspend" || body?.action === "restore" ? body.action : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!UUID_RE.test(userId)) return fail(req, 400, "bad_input", "Say which customer.");
  if (!action) return fail(req, 400, "bad_input", "The action must be suspend or restore.");
  if (reason.length < 10 || reason.length > 300) return fail(req, 400, "bad_input", "Write a reason of at least 10 characters (300 at most).");

  const asCaller = deps.createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });

  const chk = await asCaller.rpc("admin_customer_account_check", { p_id: userId, p_action: action, p_reason: reason });
  if (chk.error) {
    console.error("admin_customer_account_check failed", chk.error.code, chk.error.message);
    return fail(req, chk.error.code === "42501" ? 403 : 500, "server_error", "Could not check this customer. Nothing was done.");
  }
  if (!chk.data?.ok) return fail(req, 409, "not_allowed", String(chk.data?.error ?? "This cannot be done."));

  const ban = await service.auth.admin.updateUserById(userId, { ban_duration: action === "suspend" ? BAN : "none" });
  if (ban.error) {
    console.error("updateUserById failed", ban.error.status, ban.error.message);
    return fail(req, 502, "auth_failed", "The login could not be " + (action === "suspend" ? "blocked" : "unblocked") + ". Nothing was changed.");
  }

  const rec = await asCaller.rpc("admin_customer_account_record", { p_id: userId, p_action: action, p_reason: reason });
  if (rec.error || !rec.data?.ok) {
    if (rec.error) console.error("admin_customer_account_record failed", rec.error.code, rec.error.message);
    const undo = await service.auth.admin.updateUserById(userId, { ban_duration: action === "suspend" ? "none" : BAN });
    if (undo.error) console.error("UNDO FAILED: login state differs from the record for", userId, undo.error.message);
    const why = rec.error ? "The server could not record it." : String(rec.data?.error ?? "It could not be recorded.");
    return fail(req, 409, "record_failed", why + (undo.error ? " The login block could not be undone: check this customer in Supabase Authentication, Users." : " Nothing was changed."));
  }
  return json(req, 200, { ok: true, action, user_id: userId });
}

Deno.serve((req: Request) => handleAction(req, { env: (n: string) => Deno.env.get(n), createClient }));
