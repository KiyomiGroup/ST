// DEPLOY BUNDLE for didit-webhook: generated, do not edit. Source files are in supabase/functions/.
// ===== _shared/didit-signature.ts =====
// Didit webhook signature check (X-Signature-V2). Stage V2a.
// Source of the algorithm: docs/verification/DIDIT-API-FACTS.md, "Webhook".
//
// Uses only Web APIs (crypto.subtle, TextEncoder) so it runs in Supabase Edge
// Functions (Deno) and in Node 20+. No imports, no secrets in this file.
//
// Steps (one signature only, V2):
//  1. parse the JSON body
//  2. reject if |now - X-Timestamp| > 300 seconds
//  3. shortenFloats (whole-number floats become integers), sortKeys (recursive,
//     arrays keep order), JSON.stringify with Unicode left unescaped
//  4. HMAC-SHA256(secret, canonical_json) as hex, compared in constant time
//
// NOTE: JSON.parse already turns 5.0 into 5, so shortenFloats is satisfied by
// parsing. It is still written out below so the behaviour is explicit and
// tested (and covers floats like 1e3 that parse to whole numbers).

export const MAX_SKEW_SECONDS = 300;

export type SignatureFailure =
  | "missing_secret"
  | "missing_signature"
  | "missing_timestamp"
  | "bad_timestamp"
  | "stale_timestamp"
  | "invalid_json"
  | "bad_signature";

export type SignatureResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: SignatureFailure };

/** Whole-number floats become integers; recurses through objects and arrays. */
export function shortenFloats(value: unknown): unknown {
  if (typeof value === "number") {
    return Number.isFinite(value) && Number.isInteger(value) ? Math.trunc(value) : value;
  }
  if (Array.isArray(value)) return value.map(shortenFloats);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = shortenFloats(v);
    }
    return out;
  }
  return value;
}

/** Recursive lexicographic key sort; arrays keep their order. */
export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = sortKeys(src[k]);
    return out;
  }
  return value;
}

/** The exact string that is signed. JSON.stringify leaves Unicode unescaped. */
export function canonicalJson(payload: unknown): string {
  return JSON.stringify(sortKeys(shortenFloats(payload)));
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

/** Constant-time string compare (length is not secret: both are 64 hex chars). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export interface VerifyInput {
  /** The raw request body text, exactly as received. */
  rawBody: string;
  /** Value of the X-Signature-V2 header (hex), or null if absent. */
  signatureHeader: string | null;
  /** Value of the X-Timestamp header (unix seconds), or null if absent. */
  timestampHeader: string | null;
  /** DIDIT_WEBHOOK_SECRET for the matching environment. */
  secret: string | undefined | null;
  /** Injected clock for tests; defaults to the real time. */
  nowSeconds?: number;
}

/**
 * Verifies a Didit webhook. Returns the parsed payload only when the signature
 * is valid and the timestamp is fresh. The caller maps any failure to HTTP 401
 * and must not reveal which check failed to the sender.
 */
export async function verifyDiditSignature(input: VerifyInput): Promise<SignatureResult> {
  if (!input.secret) return { ok: false, reason: "missing_secret" };

  const sig = (input.signatureHeader ?? "").trim().toLowerCase();
  if (!sig) return { ok: false, reason: "missing_signature" };

  const tsRaw = (input.timestampHeader ?? "").trim();
  if (!tsRaw) return { ok: false, reason: "missing_timestamp" };
  if (!/^\d+$/.test(tsRaw)) return { ok: false, reason: "bad_timestamp" };
  const ts = Number(tsRaw);

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_SKEW_SECONDS) return { ok: false, reason: "stale_timestamp" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.rawBody);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "invalid_json" };
  }

  const expected = await hmacSha256Hex(input.secret, canonicalJson(parsed));
  if (!timingSafeEqualStr(expected, sig)) return { ok: false, reason: "bad_signature" };

  return { ok: true, payload: parsed as Record<string, unknown> };
}

// ===== didit-webhook/decision.ts =====
// Reads a Didit decision (GET /v3/session/{id}/decision/) and reduces it to the booleans
// idv_apply_event needs. Pure: no network, no logging. extractDecisionFlags returns NO scores, media or personal data.
// extractLegalName (VR1) is the ONE exception: it returns the verified name string, which the caller passes straight to
// the SQL function idv_store_name (that keeps only normalised word tokens). Never log its result.
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

// VR1: the person's legal name from the ID document. Field names (full_name, or first_name + last_name) are UNVERIFIED
// against a real Didit sandbox response; confirm before relying on it. Returns null when there is no usable name.
// Only APPROVED documents count. If several documents disagree, null (we never guess which name is right).
const clean = (v: unknown): string => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");

export function extractLegalName(raw: unknown): string | null {
  const root = (typeof raw === "object" && raw !== null ? raw : {}) as Item;
  const decision = (typeof root.decision === "object" && root.decision !== null ? root.decision : root) as Item;
  const names = new Set<string>();
  for (const d of items(decision, "id_verifications")) {
    if (d.status !== "Approved") continue;
    let n = clean(d.full_name);
    if (!n) n = [clean(d.first_name), clean(d.last_name)].filter(Boolean).join(" ");
    if (n && n.length <= 200) names.add(n.toLowerCase());
  }
  if (names.size !== 1) return null;
  for (const d of items(decision, "id_verifications")) {
    if (d.status !== "Approved") continue;
    const n = clean(d.full_name) || [clean(d.first_name), clean(d.last_name)].filter(Boolean).join(" ");
    if (n) return n;
  }
  return null;
}

// ===== didit-webhook/handler.ts =====
// Didit webhook handler (stage V2b). Pure logic with injected dependencies so it can be tested without Deno
// or the network. index.ts wires it to Deno.serve, Deno.env and fetch.
//
// Flow: POST only -> verify X-Signature-V2 (401 if bad or stale) -> only status.updated is applied ->
// wrong environment is ignored -> on "Approved" re-fetch the decision from Didit -> call the SQL function
// idv_apply_event (the ONLY place a status changes) -> 2xx. A database failure, a failed decision fetch or a
// "retry" answer from SQL returns 500 so Didit sends the event again (5xx is retried, 4xx never is).
//
// Never logged: the body, signature, API key, webhook secret, session token, scores or personal data.


export interface Deps {
  env: (name: string) => string | undefined;
  fetch: typeof fetch;
  now?: () => number; // ms, tests only
}

const MAX_BODY_BYTES = 1_000_000;
const DIDIT_API = "https://verification.didit.me";
const DECISION_TIMEOUT_MS = 3000;

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Didit's created_at: ISO string or unix seconds (UNVERIFIED which). Anything else -> null (SQL uses now()).
export function toIso(v: unknown): string | null {
  let ms: number;
  if (typeof v === "number" && Number.isFinite(v)) ms = v < 1e12 ? v * 1000 : v;
  else if (typeof v === "string" && v.trim() !== "") {
    ms = /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v) * (Number(v) < 1e12 ? 1000 : 1) : Date.parse(v);
  } else return null;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

const str = (v: unknown, max = 200): string | null =>
  typeof v === "string" && v.trim() !== "" && v.length <= max ? v : null;

export async function handleWebhook(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== "POST") return reply(405, { ok: false, error: "method_not_allowed" });

  const secret = deps.env("DIDIT_WEBHOOK_SECRET");
  const apiKey = deps.env("DIDIT_API_KEY");
  const didEnv = deps.env("DIDIT_ENV");
  const supaUrl = deps.env("SUPABASE_URL");
  const serviceKey = deps.env("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !apiKey || !supaUrl || !serviceKey || (didEnv !== "sandbox" && didEnv !== "live")) {
    console.error("didit-webhook: server is not configured");
    return reply(500, { ok: false, error: "server_misconfigured" });
  }

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return reply(413, { ok: false, error: "too_large" });
  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) return reply(413, { ok: false, error: "too_large" });

  const sig = await verifyDiditSignature({
    rawBody,
    signatureHeader: req.headers.get("x-signature-v2"),
    timestampHeader: req.headers.get("x-timestamp"),
    secret,
    nowSeconds: deps.now ? Math.floor(deps.now() / 1000) : undefined,
  });
  if (!sig.ok) {
    if (sig.reason === "invalid_json") return reply(400, { ok: false, error: "bad_request" });
    console.error(`didit-webhook: rejected (${sig.reason})`);
    return reply(401, { ok: false, error: "unauthorized" });
  }
  const p = sig.payload as Record<string, unknown>;

  // Only status changes are applied. Everything else is acknowledged and ignored (V2d sync covers data).
  const webhookType = str(p.webhook_type, 60);
  if (webhookType !== "status.updated") return reply(200, { ok: true, outcome: "ignored_type" });

  const sessionId = str(p.session_id);
  const status = str(p.status, 60);
  if (!sessionId || !status) return reply(400, { ok: false, error: "bad_request" });

  // A sandbox event must never touch a live project and the reverse.
  const eventEnv = str(p.environment, 20);
  if (eventEnv !== didEnv) return reply(200, { ok: true, outcome: "ignored_environment" });

  const eventId = str(p.event_id) ?? `${sessionId}|${status}|${webhookType}`;
  const payloadHash = await sha256Hex(rawBody);

  // Approved is only trusted after the decision is re-fetched from Didit with our API key.
  let flags: ReturnType<typeof extractDecisionFlags> | null = null;
  let legalName: string | null = null; // VR1: handed only to idv_store_name, never logged
  if (status === "Approved") {
    try {
      const res = await deps.fetch(`${DIDIT_API}/v3/session/${encodeURIComponent(sessionId)}/decision/`, {
        method: "GET",
        headers: { "x-api-key": apiKey, "Accept": "application/json" },
        signal: AbortSignal.timeout(DECISION_TIMEOUT_MS),
      });
      if (!res.ok) {
        console.error(`didit-webhook: decision fetch failed (${res.status})`);
        return reply(500, { ok: false, error: "decision_unavailable" });
      }
      const decisionJson = await res.json();
      flags = extractDecisionFlags(decisionJson);
      legalName = extractLegalName(decisionJson);
    } catch {
      console.error("didit-webhook: decision fetch failed (network)");
      return reply(500, { ok: false, error: "decision_unavailable" });
    }
  }

  let result: Record<string, unknown>;
  try {
    const res = await deps.fetch(`${supaUrl.replace(/\/+$/, "")}/rest/v1/rpc/idv_apply_event`, {
      method: "POST",
      headers: {
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_event_id: eventId,
        p_session_id: sessionId,
        p_webhook_type: webhookType,
        p_provider_status: status,
        p_environment: eventEnv,
        p_event_created_at: toIso(p.created_at),
        p_payload_hash: payloadHash,
        p_decision_fetched: flags !== null,
        p_liveness_ok: flags?.liveness_ok ?? null,
        p_face_match_ok: flags?.face_match_ok ?? null,
        p_document_ok: flags?.document_ok ?? null,
        p_nin_database_match: flags?.nin_database_match ?? null,
        p_nigerian_doc: flags?.nigerian_doc ?? false,
        p_reason_codes: null,
      }),
    });
    if (!res.ok) {
      console.error(`didit-webhook: database call failed (${res.status})`);
      return reply(500, { ok: false, error: "database_error" });
    }
    result = await res.json();
  } catch {
    console.error("didit-webhook: database call failed (network)");
    return reply(500, { ok: false, error: "database_error" });
  }

  // SQL asks for a retry when the session is not known yet (webhook beat our own write) or the decision was missing.
  if (result.retry === true) {
    console.error(`didit-webhook: retry requested (${String(result.reason)})`);
    return reply(500, { ok: false, error: "retry" });
  }

  // VR1: keep the verified name (word tokens only, made by SQL) so a bank account name can be matched later.
  // Not fatal: if it fails the person is simply asked to verify again at their first withdrawal. Nothing is logged but the code.
  if (legalName !== null) {
    try {
      const res = await deps.fetch(`${supaUrl.replace(/\/+$/, "")}/rest/v1/rpc/idv_store_name`, {
        method: "POST",
        headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_session_id: sessionId, p_full_name: legalName }),
      });
      if (!res.ok) console.error(`didit-webhook: name store failed (${res.status})`);
    } catch {
      console.error("didit-webhook: name store failed (network)");
    }
  }
  return reply(200, { ok: true, outcome: String(result.outcome ?? "applied") });
}

// ===== entry =====
Deno.serve((req: Request) =>
  handleWebhook(req, { env: (n: string) => Deno.env.get(n), fetch })
);
