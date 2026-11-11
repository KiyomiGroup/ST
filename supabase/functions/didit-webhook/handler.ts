// Didit webhook handler (stage V2b). Pure logic with injected dependencies so it can be tested without Deno
// or the network. index.ts wires it to Deno.serve, Deno.env and fetch.
//
// Flow: POST only -> verify X-Signature-V2 (401 if bad or stale) -> only status.updated is applied ->
// wrong environment is ignored -> on "Approved" re-fetch the decision from Didit -> call the SQL function
// idv_apply_event (the ONLY place a status changes) -> 2xx. A database failure, a failed decision fetch or a
// "retry" answer from SQL returns 500 so Didit sends the event again (5xx is retried, 4xx never is).
//
// Never logged: the body, signature, API key, webhook secret, session token, scores or personal data.
import { verifyDiditSignature } from "../_shared/didit-signature.ts";
import { extractDecisionFlags, extractLegalName } from "./decision.ts";

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
