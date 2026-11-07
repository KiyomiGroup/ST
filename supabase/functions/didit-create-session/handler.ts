// Didit create-session handler (stage V2c). Pure logic with injected dependencies (testable without Deno).
// index.ts wires it to Deno.serve / Deno.env / fetch. Deploy with "Verify JWT" ON.
//
// Request  (POST JSON, Authorization: Bearer <user access token>):
//   { mode: "self" | "proxy", local_tasker_user_id?: uuid (proxy only), request_id?: string (<=100, reuse on retry) }
// Response 200 { ok: true, url, status, reused }   (ONLY these; never the session token, ids or Didit data)
//          4xx/5xx { ok: false, error: <code>, message }
//
// WHO is verified is decided in SQL (idv_start_attempt) from the signed-in caller: the browser can neither
// name the subject in self mode nor pick vendor_data. Consent is checked in SQL before anything is sent to Didit.
// Never logged: tokens, API keys, session token, session id, user ids, Didit response bodies.

export interface Deps {
  env: (name: string) => string | undefined;
  fetch: typeof fetch;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIDIT_API = "https://verification.didit.me";
const DIDIT_TIMEOUT_MS = 8000;
const DEFAULT_ORIGINS = ["https://streettasker.com", "https://www.streettasker.com"];
const DEFAULT_SITE = "https://streettasker.com";

// SQL hints (RAISE ... HINT) -> HTTP status and a message safe to show.
const HINTS: Record<string, [number, string]> = {
  not_signed_in: [401, "Please sign in first."],
  not_active_coordinator: [403, "Only an active coordinator can do this."],
  not_assigned: [403, "This Local Tasker is not assigned to you."],
  not_for_local_tasker: [403, "A Local Tasker cannot verify themselves."],
  consent_required: [409, "Consent is required before verification can start."],
  already_verified: [409, "This person is already verified."],
  too_many_attempts: [429, "Too many attempts. Please try again later."],
  bad_input: [400, "Invalid request."],
};

function cors(req: Request, deps: Deps): Record<string, string> {
  const extra = (deps.env("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const list = [...DEFAULT_ORIGINS, ...extra];
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": list.includes(origin) ? origin : DEFAULT_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function reply(req: Request, deps: Deps, status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req, deps), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
const fail = (req: Request, deps: Deps, status: number, error: string, message: string) =>
  reply(req, deps, status, { ok: false, error, message });
const TRY_LATER = "We could not start verification right now. Please try again in a few minutes.";

// Only ever hand the browser a Didit address over https.
export function isDiditUrl(u: unknown): u is string {
  if (typeof u !== "string") return false;
  try {
    const x = new URL(u);
    return x.protocol === "https:" && (x.hostname === "didit.me" || x.hostname.endsWith(".didit.me"));
  } catch { return false; }
}

// Calls a SQL function through PostgREST as the server. Returns parsed JSON or { error: hint }.
async function rpc(deps: Deps, base: string, key: string, name: string, args: Record<string, unknown>):
  Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; hint: string | null; status: number }> {
  let res: Response;
  try {
    res = await deps.fetch(`${base}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
  } catch { return { ok: false, hint: null, status: 0 }; }
  let data: unknown = null;
  try { data = await res.json(); } catch { /* keep null */ }
  if (!res.ok) {
    const hint = data && typeof data === "object" && typeof (data as Record<string, unknown>).hint === "string"
      ? (data as Record<string, string>).hint : null;
    return { ok: false, hint, status: res.status };
  }
  return { ok: true, data: (data && typeof data === "object" ? data : {}) as Record<string, unknown> };
}

export async function handleCreateSession(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req, deps) });
  if (req.method !== "POST") return fail(req, deps, 405, "method_not_allowed", "Use POST.");

  const apiKey = deps.env("DIDIT_API_KEY");
  const workflowId = deps.env("DIDIT_WORKFLOW_ID");
  const customerWorkflowId = deps.env("DIDIT_WORKFLOW_ID_CUSTOMER") || null; // added at stage V6
  const didEnv = deps.env("DIDIT_ENV");
  const supaRaw = deps.env("SUPABASE_URL");
  const serviceKey = deps.env("SUPABASE_SERVICE_ROLE_KEY");
  if (!apiKey || !workflowId || !supaRaw || !serviceKey || (didEnv !== "sandbox" && didEnv !== "live")) {
    console.error("didit-create-session: server is not configured");
    return fail(req, deps, 500, "server_misconfigured", "Server is not configured.");
  }
  const supa = supaRaw.replace(/\/+$/, "");
  const site = (deps.env("SITE_URL") || DEFAULT_SITE).replace(/\/+$/, "");

  // 1. Who is calling (from the access token, never from the body).
  const authz = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(authz);
  if (!m) return fail(req, deps, 401, "not_signed_in", "Please sign in first.");
  let callerId: string | null = null;
  try {
    const r = await deps.fetch(`${supa}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: `Bearer ${m[1]}` } });
    if (r.ok) {
      const u = await r.json();
      if (u && typeof u.id === "string" && UUID_RE.test(u.id)) callerId = u.id;
    }
  } catch { /* handled below */ }
  if (!callerId) return fail(req, deps, 401, "not_signed_in", "Please sign in first.");

  // 2. Input. Anything else in the body (user_id, vendor_data, ...) is ignored.
  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("x");
    body = parsed as Record<string, unknown>;
  } catch { return fail(req, deps, 400, "bad_input", "Invalid request."); }
  const mode = body.mode;
  if (mode !== "self" && mode !== "proxy") return fail(req, deps, 400, "bad_input", "Invalid request.");
  let target: string | null = null;
  if (mode === "proxy") {
    const t = body.local_tasker_user_id;
    if (typeof t !== "string" || !UUID_RE.test(t)) return fail(req, deps, 400, "bad_input", "Invalid request.");
    target = t;
  }
  const reqId = body.request_id;
  if (reqId !== undefined && reqId !== null && (typeof reqId !== "string" || reqId.length === 0 || reqId.length > 100)) {
    return fail(req, deps, 400, "bad_input", "Invalid request.");
  }

  // 3. Start (or reuse) the attempt. SQL decides the subject, checks consent, cap and already-verified.
  const start = await rpc(deps, supa, serviceKey, "idv_start_attempt", {
    p_caller: callerId, p_mode: mode, p_target: target, p_environment: didEnv,
    p_request_id: typeof reqId === "string" ? reqId : null,
  });
  if (!start.ok) {
    const h = start.hint && HINTS[start.hint];
    if (h) return fail(req, deps, h[0], start.hint as string, h[1]);
    console.error(`didit-create-session: start failed (${start.status})`);
    return fail(req, deps, 500, "server_error", TRY_LATER);
  }
  const verificationId = start.data.verification_id;
  const subjectUser = start.data.user_id;
  const kind = start.data.subject_kind;
  if (typeof verificationId !== "string" || typeof subjectUser !== "string" || typeof kind !== "string") {
    console.error("didit-create-session: unexpected start result");
    return fail(req, deps, 500, "server_error", TRY_LATER);
  }

  // 4. Which workflow. Customers have their own (stage V6); until it is configured they cannot start.
  //    Coordinators use the same main workflow as taskers (owner's choice, Stage E-1).
  const wf = kind === "customer" ? customerWorkflowId : workflowId;
  if (!wf) return fail(req, deps, 503, "not_available", "Verification is not available for this account type yet.");

  // 5. Create the Didit session. Didit returns the same unfinished session for the same vendor_data (idempotent).
  let session: Record<string, unknown>;
  try {
    const r = await deps.fetch(`${DIDIT_API}/v3/session/`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        workflow_id: wf,
        vendor_data: subjectUser,                 // our id of the person being verified, set by SQL, never the browser
        // a redirect is NOT proof; the page must read the server status. A coordinator comes back to their own page
        // (coordinator accounts are separate and are turned away from verify.html).
        callback: kind === "coordinator" ? `${site}/coordinator-identity.html` : `${site}/verify.html`,
        metadata: { verification_id: verificationId },
      }),
      signal: AbortSignal.timeout(DIDIT_TIMEOUT_MS),
    });
    if (!r.ok) {
      // Didit answers 403 for a bad key: that is OUR configuration problem, the user only hears "try later".
      console.error(`didit-create-session: Didit refused (${r.status})`);
      return fail(req, deps, 502, "provider_unavailable", TRY_LATER);
    }
    const j = await r.json();
    if (!j || typeof j !== "object") throw new Error("x");
    session = j as Record<string, unknown>;
  } catch {
    console.error("didit-create-session: Didit call failed");
    return fail(req, deps, 502, "provider_unavailable", TRY_LATER);
  }
  const sessionId = session.session_id;
  const url = session.url;
  if (typeof sessionId !== "string" || sessionId === "" || !isDiditUrl(url)) {
    console.error("didit-create-session: unexpected Didit reply");
    return fail(req, deps, 502, "provider_unavailable", TRY_LATER);
  }

  // 6. Remember the session BEFORE the person can use it, so the webhook can find the attempt.
  const attach = await rpc(deps, supa, serviceKey, "idv_attach_session", {
    p_verification_id: verificationId, p_session_id: sessionId, p_workflow_id: wf,
  });
  if (!attach.ok) {
    console.error(`didit-create-session: attach failed (${attach.hint ?? attach.status})`);
    return fail(req, deps, 500, "server_error", TRY_LATER);
  }

  return reply(req, deps, 200, { ok: true, url, status: String(start.data.status ?? "NOT_STARTED"), reused: start.data.reused === true });
}
