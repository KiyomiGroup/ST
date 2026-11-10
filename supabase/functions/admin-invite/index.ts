// Edge Function: admin-invite  (Stage A5e)
// Sends the invite for an APPROVED "invite a new admin" request. Two Super Admins are involved: one asked, a different one
// approved on the Pending approvals page; now the person who asked sends it from the Admin team page.
//
// What it does, in order (the browser sends ONLY the approval id; the email and roles come from the approved request):
//   1. Who is calling? Verify the access token with Auth. Never trust a user id from the body.
//   2. admin_invite_precheck(approval)  as the caller: approved, not expired, requested by the caller, not used, email still new.
//   3. Create the login in Auth and send the invite email (service-role key, never leaves this function).
//   4. admin_invite_finish(approval, login)  as the caller: uses the approval ONCE and makes the admin row, roles and
//      (Super Admin) support_staff row in one transaction.
// If step 4 fails after step 3, a login with NO admin access remains (harmless); the message says so and the approval is not used.
//
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by the Edge runtime.
// Optional secret ALLOWED_ORIGINS (comma separated) adds origins for local testing.
// Deploy with "Verify JWT" ON. In Supabase Auth, URL Configuration, the Redirect URLs list must contain
//   https://streettasker.com/admin/accept-invite.html  (and the www address if used).
//
// RESEND mode (body { user_id }): emails a fresh "choose a password" link to an admin who was invited but has not set a password yet.
//   admin_invite_resend_check (as the caller) -> Auth resetPasswordForEmail with the accept page as the landing -> admin_invite_resend_record.
//   It grants nothing (the admin row already exists), so no new approval; the database allows 3 per person per 24 hours.
//
// Request  (POST, JSON, Authorization: Bearer <admin access token>):  { approval_id: uuid }  or  { user_id: uuid }
// Response: 200 { ok: true, email, email_sent: boolean, existing_login: boolean }  (resend: { ok, email, email_sent: true, resent: true })
//           4xx/5xx { ok: false, error: <code>, message }
import { createClient } from "npm:@supabase/supabase-js@2";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_ORIGINS = ["https://streettasker.com", "https://www.streettasker.com"];

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

export async function handleInvite(req: Request, deps: { env: (n: string) => string | undefined; createClient: (url: string, key: string, opts?: any) => any }): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return fail(req, 405, "method_not_allowed", "Use POST.");

  const url = deps.env("SUPABASE_URL");
  const anonKey = deps.env("SUPABASE_ANON_KEY");
  const serviceKey = deps.env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return fail(req, 500, "server_misconfigured", "Server is not configured.");
  const service = deps.createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // 1. Who is calling?
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return fail(req, 401, "unauthenticated", "Sign in first.");
  const { data: au, error: auErr } = await service.auth.getUser(token);
  if (auErr || !au?.user?.id) return fail(req, 401, "unauthenticated", "Sign in first.");

  // Input: only the approval id.
  let raw = "";
  try { raw = await req.text(); } catch { return fail(req, 400, "bad_input", "Could not read the request."); }
  if (raw.length > 2_000) return fail(req, 413, "too_large", "Request too large.");
  let body: any;
  try { body = JSON.parse(raw); } catch { return fail(req, 400, "bad_input", "Body must be JSON."); }
  const resendUser = typeof body?.user_id === "string" ? body.user_id.trim() : "";
  const approvalId = typeof body?.approval_id === "string" ? body.approval_id.trim() : "";
  if (resendUser) {
    if (!UUID_RE.test(resendUser)) return fail(req, 400, "bad_input", "Say which admin to send the invitation to.");
  } else if (!UUID_RE.test(approvalId)) return fail(req, 400, "bad_input", "Say which approved invite to send.");

  // The database sees the CALLER (their token), so its own permission and requester checks apply.
  const asCaller = deps.createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // RESEND: a fresh link for an invited admin who has not chosen a password yet.
  if (resendUser) {
    const chk = await asCaller.rpc("admin_invite_resend_check", { p_user: resendUser });
    if (chk.error) {
      console.error("admin_invite_resend_check failed", chk.error.code, chk.error.message);
      return fail(req, chk.error.code === "42501" ? 403 : 500, "server_error", "Could not check this admin. Nothing was done.");
    }
    if (!chk.data?.ok) return fail(req, 409, "not_allowed", String(chk.data?.error ?? "An invitation cannot be sent again to this person."));
    const anon = deps.createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const sent = await anon.auth.resetPasswordForEmail(chk.data.email, { redirectTo: `${allowedOrigin(req)}/admin/accept-invite.html` });
    if (sent.error) {
      console.error("resetPasswordForEmail failed", sent.error.status, sent.error.message);
      const limited = sent.error.status === 429;
      return fail(req, limited ? 429 : 502, "send_failed", limited ? "Too many emails were sent recently. Wait a few minutes and try again." : "The email could not be sent. Try again later.");
    }
    const rec = await asCaller.rpc("admin_invite_resend_record", { p_user: resendUser });
    if (rec.error || !rec.data?.ok) console.error("admin_invite_resend_record failed", rec.error?.code, rec.error?.message ?? rec.data?.error);
    return json(req, 200, { ok: true, email: chk.data.email, email_sent: true, resent: true });
  }

  // 2. Is this approval good to send?
  const pre = await asCaller.rpc("admin_invite_precheck", { p_approval: approvalId });
  if (pre.error) {
    console.error("admin_invite_precheck failed", pre.error.code, pre.error.message);
    return fail(req, pre.error.code === "42501" ? 403 : 500, "server_error", "Could not check the approval. Nothing was done.");
  }
  if (!pre.data?.ok) return fail(req, 409, "not_allowed", String(pre.data?.error ?? "This invite cannot be sent."));
  const email: string = pre.data.email;

  // 3. Create the login and send the invite email (or reuse a login that exists but has no site account).
  const lookup = await service.rpc("admin_invite_auth_lookup", { p_email: email });
  if (lookup.error || !lookup.data) {
    console.error("admin_invite_auth_lookup failed", lookup.error?.code, lookup.error?.message);
    return fail(req, 500, "server_error", "Could not look up the email. Nothing was done.");
  }
  if (lookup.data.is_admin || lookup.data.site_account) return fail(req, 409, "not_allowed", "This email already has an account. Use a separate email for admin work.");

  let loginId: string | null = lookup.data.exists ? lookup.data.user_id : null;
  let emailSent = false;
  const existingLogin = !!lookup.data.exists;
  const redirectTo = `${allowedOrigin(req)}/admin/accept-invite.html`;
  if (!existingLogin) {
    const inv = await service.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (inv.error || !inv.data?.user?.id) {
      console.error("inviteUserByEmail failed", inv.error?.status, inv.error?.message);
      return fail(req, 502, "invite_failed", "The invite email could not be sent. Nothing was changed. Check the email address and try again later.");
    }
    loginId = inv.data.user.id;
    emailSent = true;
  }

  // 4. Use the approval once and make the admin.
  const fin = await asCaller.rpc("admin_invite_finish", { p_approval: approvalId, p_user: loginId });
  if (fin.error || !fin.data?.ok) {
    if (fin.error) console.error("admin_invite_finish failed", fin.error.code, fin.error.message);
    const why = fin.error ? "The server could not finish the invite." : String(fin.data?.error ?? "The invite could not be finished.");
    return fail(req, 409, "finish_failed", why + (emailSent ? " An email was sent, but that login has no admin access. Ask again if needed." : " Nothing was changed."));
  }
  return json(req, 200, { ok: true, email, email_sent: emailSent, existing_login: existingLogin });
}

Deno.serve((req: Request) => handleInvite(req, { env: (n: string) => Deno.env.get(n), createClient }));
