// DEPLOY BUNDLE for didit-sync: generated, do not edit. Source files are in supabase/functions/.
// ===== didit-webhook/decision.ts =====
// Reads a Didit decision (GET /v3/session/{id}/decision/) and reduces it to the booleans
// idv_apply_event needs. Pure: no network, no logging. Returns NO scores, media or personal data.
// Field names follow DIDIT-API-FACTS.md. Anything missing counts as "not shown to be OK" (false / null),
// so a surprise in Didit's reply can only push a person to review, never to VERIFIED.

export interface DecisionFlags {
  liveness_ok: boolean;
  face_match_ok: boolean;
  document_ok: boolean;
  nin_database_match: "full_match" | "partial_match" | "no_match" | "not_run";
  nigerian_doc: boolean;
}

type Item = Record<string, unknown>;

function items(decision: Item, key: string): Item[] {
  const v = decision[key];
  return Array.isArray(v) ? v.filter((x): x is Item => typeof x === "object" && x !== null) : [];
}

// At least one item, and every item Approved.
function allApproved(list: Item[]): boolean {
  return list.length > 0 && list.every((i) => i.status === "Approved");
}

const isNga = (v: unknown) => typeof v === "string" && v.toUpperCase() === "NGA";

export function extractDecisionFlags(raw: unknown): DecisionFlags {
  // Didit may return the decision at the top level or under "decision".
  const root = (typeof raw === "object" && raw !== null ? raw : {}) as Item;
  const decision = (typeof root.decision === "object" && root.decision !== null ? root.decision : root) as Item;

  const docs = items(decision, "id_verifications");
  const nigerian = docs.some((d) => isNga(d.issuing_state) || isNga(d.issuing_country));

  const ngaChecks = items(decision, "database_validations").filter((d) => isNga(d.issuing_state));
  let nin: DecisionFlags["nin_database_match"] = "not_run";
  if (ngaChecks.length > 0) {
    // The worst result wins: a single no_match or partial_match is never overridden by a full_match.
    const m = ngaChecks.map((d) => (d.status === "Approved" ? d.match_type : d.match_type === "no_match" ? "no_match" : "partial_match"));
    nin = m.includes("no_match") ? "no_match"
      : m.every((x) => x === "full_match") ? "full_match"
      : "partial_match";
  }

  return {
    liveness_ok: allApproved(items(decision, "liveness_checks")),
    face_match_ok: allApproved(items(decision, "face_matches")),
    document_ok: allApproved(docs),
    nin_database_match: nin,
    nigerian_doc: nigerian,
  };
}

// ===== didit-sync/handler.ts =====
// Didit sync handler (stage V2d). Pure logic with injected dependencies (testable without Deno).
// index.ts wires it to Deno.serve / Deno.env / fetch. Deploy with "Verify JWT" ON.
//
// "What is my status?": the person (or their coordinator) asks; the server reads the Didit session decision and
// applies it through idv_apply_event, the same single place the webhook uses. Covers a delayed or lost webhook and
// the return from Didit's callback redirect.
//
// Request  (POST JSON, Authorization: Bearer <user access token>):
//   { mode: "self" | "proxy", local_tasker_user_id?: uuid (proxy only), returned?: boolean }
//   returned = true means "the person has just come back from Didit": if Didit still has no final answer the
//   attempt becomes PENDING (idv_mark_pending). The page never sets a status itself.
// Response 200 { ok: true, status, verified, needs_review, changed }  (ONLY these; no scores, ids or Didit data)
//          4xx/5xx { ok: false, error: <code>, message }
//
// WHO may sync WHOM is decided by SQL running as the signed-in user (idv_my_status / idv_local_status): a user
// reads only their own row, a coordinator only an assigned Local Tasker. The browser never names a Didit session;
// the session id comes from our own table. Didit's reply is never trusted for identity: only for status.
// Never logged: tokens, API keys, session ids, user ids, Didit response bodies.

export interface Deps {
  env: (name: string) => string | undefined;
  fetch: typeof fetch;
  now?: () => number; // ms, tests only
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIDIT_API = "https://verification.didit.me";
const DIDIT_TIMEOUT_MS = 8000;
const DEFAULT_ORIGINS = ["https://streettasker.com", "https://www.streettasker.com"];
const CLOSED = ["VERIFIED", "FAILED", "EXPIRED", "ABANDONED"];
const IN_FLIGHT_DIDIT = ["Not Started", "In Progress", "Awaiting User"];

const HINTS: Record<string, [number, string]> = {
  not_signed_in: [401, "Please sign in first."],
  not_active_coordinator: [403, "Only an active coordinator can do this."],
  not_assigned: [403, "This Local Tasker is not assigned to you."],
  bad_input: [400, "Invalid request."],
};
const TRY_LATER = "We could not check verification right now. Please try again in a few minutes.";

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

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

type RpcResult = { ok: true; data: Record<string, unknown> } | { ok: false; hint: string | null; status: number };

// Calls a SQL function through PostgREST. `bearer` is the service key (server functions) or the user's token
// (read functions that use auth.uid()); `apikey` is the matching project key.
async function rpc(deps: Deps, base: string, apikey: string, bearer: string, name: string,
  args: Record<string, unknown>): Promise<RpcResult> {
  let res: Response;
  try {
    res = await deps.fetch(`${base}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey, Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
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

const summary = (status: string, changed: boolean) => ({
  ok: true, status, verified: status === "VERIFIED", needs_review: status === "REVIEW_REQUIRED", changed,
});

export async function handleSync(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req, deps) });
  if (req.method !== "POST") return fail(req, deps, 405, "method_not_allowed", "Use POST.");

  const apiKey = deps.env("DIDIT_API_KEY");
  const didEnv = deps.env("DIDIT_ENV");
  const supaRaw = deps.env("SUPABASE_URL");
  const anonKey = deps.env("SUPABASE_ANON_KEY");
  const serviceKey = deps.env("SUPABASE_SERVICE_ROLE_KEY");
  if (!apiKey || !supaRaw || !anonKey || !serviceKey || (didEnv !== "sandbox" && didEnv !== "live")) {
    console.error("didit-sync: server is not configured");
    return fail(req, deps, 500, "server_misconfigured", "Server is not configured.");
  }
  const supa = supaRaw.replace(/\/+$/, "");
  const now = deps.now ?? Date.now;

  // 1. Who is calling (from the access token, never from the body).
  const authz = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(authz);
  if (!m) return fail(req, deps, 401, "not_signed_in", "Please sign in first.");
  const userToken = m[1];
  let callerId: string | null = null;
  try {
    const r = await deps.fetch(`${supa}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: `Bearer ${userToken}` } });
    if (r.ok) {
      const u = await r.json();
      if (u && typeof u.id === "string" && UUID_RE.test(u.id)) callerId = u.id;
    }
  } catch { /* handled below */ }
  if (!callerId) return fail(req, deps, 401, "not_signed_in", "Please sign in first.");

  // 2. Input. Anything else in the body (user_id, session id, status, ...) is ignored.
  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("x");
    body = parsed as Record<string, unknown>;
  } catch { return fail(req, deps, 400, "bad_input", "Invalid request."); }
  const mode = body.mode;
  if (mode !== "self" && mode !== "proxy") return fail(req, deps, 400, "bad_input", "Invalid request.");
  let subject = callerId;
  if (mode === "proxy") {
    const t = body.local_tasker_user_id;
    if (typeof t !== "string" || !UUID_RE.test(t)) return fail(req, deps, 400, "bad_input", "Invalid request.");
    subject = t;
  }
  const returned = body.returned;
  if (returned !== undefined && returned !== null && typeof returned !== "boolean") {
    return fail(req, deps, 400, "bad_input", "Invalid request.");
  }

  // 3. May this caller look at this person? SQL answers, running as the signed-in user.
  const allowed = mode === "self"
    ? await rpc(deps, supa, anonKey, userToken, "idv_my_status", {})
    : await rpc(deps, supa, anonKey, userToken, "idv_local_status", { p_tasker: subject });
  if (!allowed.ok) {
    const h = allowed.hint && HINTS[allowed.hint];
    if (h) return fail(req, deps, h[0], allowed.hint as string, h[1]);
    console.error(`didit-sync: permission read failed (${allowed.status})`);
    return fail(req, deps, 500, "server_error", TRY_LATER);
  }
  const shownStatus = typeof allowed.data.status === "string" ? allowed.data.status : "NOT_STARTED";
  if (allowed.data.has_open_attempt !== true) {
    return reply(req, deps, 200, summary(shownStatus, false)); // nothing open: nothing to ask Didit
  }

  // 4. Our newest attempt for this person in this environment (server only; gives the Didit session id).
  let row: { id: string; provider_session_id: string | null; status: string } | null = null;
  try {
    const q = `${supa}/rest/v1/identity_verifications?select=id,provider_session_id,status` +
      `&user_id=eq.${subject}&environment=eq.${didEnv}&order=created_at.desc&limit=1`;
    const r = await deps.fetch(q, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: "application/json" } });
    if (!r.ok) throw new Error("x");
    const j = await r.json();
    if (Array.isArray(j) && j.length > 0 && j[0] && typeof j[0].id === "string" && typeof j[0].status === "string") {
      row = { id: j[0].id, provider_session_id: typeof j[0].provider_session_id === "string" ? j[0].provider_session_id : null, status: j[0].status };
    }
  } catch {
    console.error("didit-sync: attempt read failed");
    return fail(req, deps, 500, "server_error", TRY_LATER);
  }
  if (!row || !row.provider_session_id || CLOSED.includes(row.status)) {
    return reply(req, deps, 200, summary(row?.status ?? shownStatus, false)); // no Didit session to read yet
  }
  const sessionId = row.provider_session_id;

  // 5. Read the Didit decision. The time is taken BEFORE the read so a webhook that happens after it still wins.
  const readAt = now();
  let raw: unknown;
  try {
    const r = await deps.fetch(`${DIDIT_API}/v3/session/${encodeURIComponent(sessionId)}/decision/`, {
      method: "GET",
      headers: { "x-api-key": apiKey, "Accept": "application/json" },
      signal: AbortSignal.timeout(DIDIT_TIMEOUT_MS),
    });
    if (!r.ok) {
      console.error(`didit-sync: Didit refused (${r.status})`); // 403/401 = our key; the person only hears "try later"
      return fail(req, deps, 502, "provider_unavailable", TRY_LATER);
    }
    raw = await r.json();
  } catch {
    console.error("didit-sync: Didit call failed");
    return fail(req, deps, 502, "provider_unavailable", TRY_LATER);
  }
  const root = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const inner = (root.decision && typeof root.decision === "object" ? root.decision : {}) as Record<string, unknown>;
  const cand = typeof root.status === "string" ? root.status : inner.status;
  const providerStatus = typeof cand === "string" && cand.trim() !== "" && cand.length <= 60 ? cand : null;
  if (!providerStatus) {
    console.error("didit-sync: unexpected Didit reply");
    return fail(req, deps, 502, "provider_unavailable", TRY_LATER);
  }

  // 6. Apply it through the one place a status changes. Still waiting at Didit but already PENDING here: no change
  // (otherwise a plain refresh would move PENDING back to IN_PROGRESS).
  let status = row.status;
  let changed = false;
  const skip = row.status === "PENDING" && IN_FLIGHT_DIDIT.includes(providerStatus);
  if (!skip) {
    const flags = providerStatus === "Approved" ? extractDecisionFlags(raw) : null;
    const applied = await rpc(deps, supa, serviceKey, serviceKey, "idv_apply_event", {
      p_event_id: `sync|${crypto.randomUUID()}`,      // every sync is its own event; applying the same status twice is a no-op in SQL
      p_session_id: sessionId,
      p_webhook_type: "sync",
      p_provider_status: providerStatus,
      p_environment: didEnv,
      p_event_created_at: new Date(readAt).toISOString(),
      p_payload_hash: await sha256Hex(`${sessionId}|${providerStatus}`),
      p_decision_fetched: flags !== null,
      p_liveness_ok: flags?.liveness_ok ?? null,
      p_face_match_ok: flags?.face_match_ok ?? null,
      p_document_ok: flags?.document_ok ?? null,
      p_nin_database_match: flags?.nin_database_match ?? null,
      p_nigerian_doc: flags?.nigerian_doc ?? false,
      p_reason_codes: null,
    });
    if (!applied.ok) {
      console.error(`didit-sync: database call failed (${applied.hint ?? applied.status})`);
      return fail(req, deps, 500, "server_error", TRY_LATER);
    }
    if (applied.data.retry === true) {
      console.error(`didit-sync: retry requested (${String(applied.data.reason)})`);
      return fail(req, deps, 500, "server_error", TRY_LATER);
    }
    if (typeof applied.data.status === "string") status = applied.data.status;
    changed = applied.data.changed === true;
  }

  // 7. Came back from Didit and there is still no final answer: show PENDING (server decision, never the page's).
  if (returned === true && (status === "NOT_STARTED" || status === "IN_PROGRESS")) {
    const p = await rpc(deps, supa, serviceKey, serviceKey, "idv_mark_pending", { p_verification_id: row.id });
    if (p.ok && p.data.changed === true) { status = "PENDING"; changed = true; }
    else if (!p.ok) console.error(`didit-sync: mark pending failed (${p.hint ?? p.status})`); // not fatal: the status above stands
  }

  return reply(req, deps, 200, summary(status, changed));
}

// ===== entry =====
Deno.serve((req: Request) =>
  handleSync(req, { env: (n: string) => Deno.env.get(n), fetch })
);
