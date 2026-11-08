// Edge Function: local-tasker-create  (Stage 2D-2)
// An ACTIVE coordinator creates a Local Tasker: a locked, non-login placeholder identity in Auth
// plus the users / taskers / private profile / assignment / consent / audit rows, all or nothing.
//
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the Edge runtime.
// Optional secret ALLOWED_ORIGINS (comma separated) adds origins for local testing.
// Deploy with "Verify JWT" ON. The service role key never leaves this function.
//
// Request  (POST, JSON, Authorization: Bearer <coordinator access token>):
//   { request_id: uuid (client generates ONE per form, reuses it on retry),
//     public_name, full_name, phone, areas_served?, skills?: string[], availability_notes?,
//     consent: { confirmed: true, method: "in_person"|"phone"|"written", evidence_ref?, details? } }
// Response: 201 { ok, created: true, tasker_user_id } | 200 { ok, created: false, tasker_user_id } (retry)
//           4xx/5xx { ok: false, error: <code>, message }
import { createClient } from "npm:@supabase/supabase-js@2";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHONE_RE = /^\+?[0-9][0-9 ()-]{6,19}$/;
const BAN_DURATION = "876000h"; // about 100 years
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
const fail = (req: Request, status: number, error: string, message: string) =>
  json(req, status, { ok: false, error, message });

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// SQL hints (RAISE ... HINT) mapped to HTTP statuses.
const HINT_STATUS: Record<string, number> = {
  not_active_coordinator: 403, coordinator_cap: 409, request_mismatch: 409, identity_in_use: 409,
  bad_input: 400, consent_required: 400, identity_not_locked: 500,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return fail(req, 405, "method_not_allowed", "Use POST.");

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return fail(req, 500, "server_misconfigured", "Server is not configured.");
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // 1. Who is calling? Verify the access token with Auth. Never trust a user id from the body.
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return fail(req, 401, "unauthenticated", "Sign in first.");
  const { data: au, error: auErr } = await admin.auth.getUser(token);
  if (auErr || !au?.user?.id) return fail(req, 401, "unauthenticated", "Sign in first.");
  const coordinator = au.user.id;

  // 2. Must be an ACTIVE coordinator (database check, not users.role and not JWT metadata).
  const { data: isCoord, error: coErr } = await admin.rpc("is_active_coordinator", { p_user: coordinator });
  if (coErr) { console.error("is_active_coordinator failed", coErr.code, coErr.message); return fail(req, 500, "server_error", "Could not check coordinator status."); }
  if (isCoord !== true) return fail(req, 403, "not_active_coordinator", "Only an active coordinator can create a Local Tasker.");

  // 3. Validate input.
  let raw = "";
  try { raw = await req.text(); } catch { return fail(req, 400, "bad_input", "Could not read the request."); }
  if (raw.length > 16_000) return fail(req, 413, "too_large", "Request too large.");
  let body: any;
  try { body = JSON.parse(raw); } catch { return fail(req, 400, "bad_input", "Body must be JSON."); }

  const requestId = str(body?.request_id, 40).toLowerCase();
  const publicName = str(body?.public_name, 80);
  const fullName = str(body?.full_name, 120);
  const phone = str(body?.phone, 20);
  const areas = str(body?.areas_served, 300);
  const notes = str(body?.availability_notes, 500);
  const skills = Array.isArray(body?.skills)
    ? body.skills.map((s: unknown) => str(s, 60)).filter(Boolean).slice(0, 20) : [];
  const consent = body?.consent ?? {};
  if (!UUID_RE.test(requestId)) return fail(req, 400, "bad_input", "request_id must be a UUID.");
  if (publicName.length < 2 || fullName.length < 2) return fail(req, 400, "bad_input", "Names must be at least 2 characters.");
  if (!PHONE_RE.test(phone)) return fail(req, 400, "bad_input", "Enter a valid phone number.");
  if (consent.confirmed !== true) return fail(req, 400, "consent_required", "Confirm that the Local Tasker agreed.");
  if (!["in_person", "phone", "written"].includes(consent.method)) return fail(req, 400, "consent_required", "Choose how consent was given.");

  const rpcArgs = {
    p_coordinator: coordinator, p_request: requestId, p_public_name: publicName, p_full_name: fullName,
    p_phone: phone, p_areas_served: areas || null, p_skills: skills, p_availability_notes: notes || null,
    p_consent_method: consent.method, p_consent_evidence_ref: str(consent.evidence_ref, 500) || null,
    p_consent_details: str(consent.details, 1000) || null,
  };

  // 4. Idempotency: a retry with the same request_id returns the same Local Tasker.
  const found = async () => {
    const { data, error } = await admin.rpc("local_tasker_find_request", { p_request: requestId });
    if (error) throw new Error("find_request: " + error.message);
    return data as { request_exists: boolean; coordinator_id: string | null; tasker_user_id: string | null;
                     identity_user_id: string | null; identity_has_profile: boolean };
  };
  let f;
  try { f = await found(); } catch (e) { console.error(String(e)); return fail(req, 500, "server_error", "Lookup failed."); }
  if (f.request_exists) {
    if (f.coordinator_id !== coordinator) return fail(req, 409, "request_mismatch", "This request id was already used.");
    return json(req, 200, { ok: true, created: false, tasker_user_id: f.tasker_user_id });
  }
  if (f.identity_has_profile) return fail(req, 409, "identity_in_use", "This request id was already used.");

  // 5. Locked placeholder identity: no password, non-deliverable email, banned ~100 years, email
  //    pre-confirmed so it is not a pending signup. No role in user_metadata (auth.js trusts it).
  //    Re-use one made by an earlier attempt that crashed before the database step.
  let identityId = f.identity_user_id;
  let madeHere = false;
  if (!identityId) {
    const { data: cu, error: cuErr } = await admin.auth.admin.createUser({
      email: `lt-${requestId}@local-tasker.invalid`,
      email_confirm: true,
      ban_duration: BAN_DURATION,
      app_metadata: { local_tasker: true },
      user_metadata: { local_tasker: true },
    });
    if (cuErr || !cu?.user?.id) {
      // two simultaneous submits: the other one created it first
      try { f = await found(); } catch { /* fall through */ }
      if (!f?.identity_user_id) { console.error("createUser failed", cuErr?.message); return fail(req, 500, "identity_failed", "Could not create the identity."); }
      identityId = f.identity_user_id;
    } else { identityId = cu.user.id; madeHere = true; }
  }

  // 5b. Make sure the ban is really set (some Auth versions ignore ban_duration on create), then verify.
  const { error: banErr } = await admin.auth.admin.updateUserById(identityId, { ban_duration: BAN_DURATION });
  const { data: chk } = await admin.auth.admin.getUserById(identityId);
  const banned = chk?.user?.banned_until ? new Date(chk.user.banned_until).toISOString() : null;
  console.log("placeholder", requestId, "ban_update_error=", banErr?.message ?? null, "banned_until=", banned);

  // 6. Database step (one transaction). On failure remove an identity nobody references.
  const { data: res, error: dbErr } = await admin.rpc("create_local_tasker", { ...rpcArgs, p_tasker_user: identityId });
  if (dbErr) {
    const hint = (dbErr as any).hint as string | undefined;
    // Log the REAL database message (the hint alone can be generic, e.g. "You might need to add explicit type casts").
    console.error("create_local_tasker failed", requestId, "code=", dbErr.code ?? "", "message=", dbErr.message ?? "", "hint=", hint ?? "", "details=", (dbErr as any).details ?? "");
    try {
      const again = await found();
      if (!again.request_exists && !again.identity_has_profile && again.identity_user_id) {
        await admin.auth.admin.deleteUser(again.identity_user_id);
      }
    } catch (e) { console.error("cleanup failed", String(e)); }
    const known = hint && HINT_STATUS[hint] ? hint : null;
    if (known) return fail(req, HINT_STATUS[known], known, dbErr.message);
    // An unexpected database error: say so with a fixed code, and pass the real message back in `detail`
    // (the caller is a verified, active coordinator) so the cause can be read on screen and reported.
    return json(req, 500, {
      ok: false, error: "db_error", message: "Could not create the Local Tasker.",
      detail: `${dbErr.code ?? ""} ${dbErr.message ?? ""}`.trim().slice(0, 300),
    });
  }
  const r = res as { created: boolean; tasker_user_id: string };
  return json(req, r.created ? 201 : 200, { ok: true, created: r.created, tasker_user_id: r.tasker_user_id, identity_new: madeHere });
});
