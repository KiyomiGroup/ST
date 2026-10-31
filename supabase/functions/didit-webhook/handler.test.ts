// Run: node --experimental-strip-types --test handler.test.ts   (Node 22; also intended for `deno test`, not run on Deno)
// All secrets, keys and URLs are made up. No network: fetch is a stub.
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import { handleWebhook, toIso } from "./handler.ts";
import { extractDecisionFlags } from "./decision.ts";

const SECRET = "test-webhook-secret-123";
const API_KEY = "test-didit-api-key-456";
const SRV_KEY = "test-service-role-key-789";
const NOW_MS = 1_800_000_000_000;
const TS = String(Math.floor(NOW_MS / 1000));

const sortDeep = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sortDeep)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortDeep((v as Record<string, unknown>)[k])]))
  : v;
const sign = (payload: unknown, secret = SECRET) => createHmac("sha256", secret).update(JSON.stringify(sortDeep(payload))).digest("hex");

const ENV: Record<string, string> = {
  DIDIT_WEBHOOK_SECRET: SECRET, DIDIT_API_KEY: API_KEY, DIDIT_ENV: "sandbox",
  SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SRV_KEY,
};

interface Call { url: string; init: RequestInit }
function setup(opts: { env?: Record<string, string | undefined>; decision?: unknown; decisionStatus?: number; decisionThrows?: boolean;
                       rpc?: unknown; rpcStatus?: number; rpcThrows?: boolean } = {}) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/decision/")) {
      if (opts.decisionThrows) throw new Error("boom");
      return new Response(JSON.stringify(opts.decision ?? {}), { status: opts.decisionStatus ?? 200 });
    }
    if (opts.rpcThrows) throw new Error("boom");
    return new Response(JSON.stringify(opts.rpc ?? { outcome: "applied", changed: true }), { status: opts.rpcStatus ?? 200 });
  }) as unknown as typeof fetch;
  const env = { ...ENV, ...(opts.env ?? {}) };
  return { calls, deps: { env: (n: string) => env[n], fetch: f, now: () => NOW_MS } };
}
function req(payload: unknown, o: { method?: string; sig?: string | null; ts?: string | null; raw?: string } = {}) {
  const raw = o.raw ?? JSON.stringify(payload);
  const headers: Record<string, string> = { "content-type": "application/json" };
  const sig = o.sig === undefined ? sign(payload) : o.sig;
  if (sig !== null) headers["x-signature-v2"] = sig;
  const ts = o.ts === undefined ? TS : o.ts;
  if (ts !== null) headers["x-timestamp"] = ts;
  return new Request("https://f.example/didit-webhook", { method: o.method ?? "POST", headers, body: (o.method ?? "POST") === "POST" ? raw : undefined });
}
const evt = (over: Record<string, unknown> = {}) => ({
  event_id: "evt-1", webhook_type: "status.updated", session_id: "sess-1", status: "In Progress", environment: "sandbox",
  created_at: "2026-10-30T10:00:00Z", timestamp: 1, vendor_data: "user-uuid", ...over });
const rpcBody = (c: Call) => JSON.parse(String(c.init.body));
const rpcCalls = (calls: Call[]) => calls.filter((c) => c.url.includes("/rest/v1/rpc/"));
const decCalls = (calls: Call[]) => calls.filter((c) => c.url.includes("/decision/"));

const GOOD_DECISION = {
  id_verifications: [{ status: "Approved", issuing_state: "NGA" }],
  liveness_checks: [{ status: "Approved", score: 97 }],
  face_matches: [{ status: "Approved", score: 91 }],
  database_validations: [{ status: "Approved", issuing_state: "NGA", match_type: "full_match" }],
};

test("non-POST -> 405, nothing called", async () => {
  const { calls, deps } = setup();
  const r = await handleWebhook(req(evt(), { method: "GET" }), deps);
  assert.equal(r.status, 405); assert.equal(calls.length, 0);
});

test("missing configuration -> 500 and nothing called (each setting)", async () => {
  for (const k of ["DIDIT_WEBHOOK_SECRET", "DIDIT_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DIDIT_ENV"]) {
    const { calls, deps } = setup({ env: { [k]: undefined } });
    const r = await handleWebhook(req(evt()), deps);
    assert.equal(r.status, 500, k); assert.equal(calls.length, 0, k);
  }
  const { deps } = setup({ env: { DIDIT_ENV: "prod" } });
  assert.equal((await handleWebhook(req(evt()), deps)).status, 500);
});

test("bad signature -> 401, no database or Didit call", async () => {
  const { calls, deps } = setup();
  assert.equal((await handleWebhook(req(evt(), { sig: sign(evt(), "wrong-secret") }), deps)).status, 401);
  assert.equal((await handleWebhook(req(evt(), { sig: null }), deps)).status, 401);
  assert.equal((await handleWebhook(req(evt(), { ts: null }), deps)).status, 401);
  assert.equal(calls.length, 0);
});

test("tampered body -> 401", async () => {
  const { calls, deps } = setup();
  const good = evt();
  const r = await handleWebhook(req(good, { sig: sign(good), raw: JSON.stringify({ ...good, status: "Approved" }) }), deps);
  assert.equal(r.status, 401); assert.equal(calls.length, 0);
});

test("stale timestamp -> 401", async () => {
  const { calls, deps } = setup();
  const r = await handleWebhook(req(evt(), { ts: String(Math.floor(NOW_MS / 1000) - 301) }), deps);
  assert.equal(r.status, 401); assert.equal(calls.length, 0);
});

test("signed but not JSON -> 400 (never retried), nothing called", async () => {
  const { calls, deps } = setup();
  const raw = "not json";
  const r = await handleWebhook(req({}, { raw, sig: createHmac("sha256", SECRET).update(raw).digest("hex") }), deps);
  assert.equal(r.status, 400); assert.equal(calls.length, 0);
});

test("other event types and data.updated are acknowledged and ignored", async () => {
  for (const t of ["data.updated", "transaction.created", "user.status.updated", "business.status.updated"]) {
    const { calls, deps } = setup();
    const r = await handleWebhook(req(evt({ webhook_type: t })), deps);
    assert.equal(r.status, 200, t); assert.equal(calls.length, 0, t);
    assert.equal((await r.json()).outcome, "ignored_type");
  }
});

test("missing session_id or status -> 400", async () => {
  for (const o of [{ session_id: undefined }, { status: undefined }, { session_id: "" }]) {
    const { calls, deps } = setup();
    assert.equal((await handleWebhook(req(evt(o)), deps)).status, 400); assert.equal(calls.length, 0);
  }
});

test("wrong environment is ignored with 200 (sandbox event on a live function and the reverse), nothing called", async () => {
  const a = setup({ env: { DIDIT_ENV: "live" } });
  const r = await handleWebhook(req(evt({ environment: "sandbox" })), a.deps);
  assert.equal(r.status, 200); assert.equal((await r.json()).outcome, "ignored_environment"); assert.equal(a.calls.length, 0);
  const b = setup();
  assert.equal((await handleWebhook(req(evt({ environment: "live", status: "Approved" })), b.deps)).status, 200); assert.equal(b.calls.length, 0);
  const c = setup();
  assert.equal((await handleWebhook(req(evt({ environment: undefined })), c.deps)).status, 200); assert.equal(c.calls.length, 0);
});

test("a normal status event calls idv_apply_event once with the right arguments, no decision fetch", async () => {
  const { calls, deps } = setup();
  const e = evt();
  const r = await handleWebhook(req(e), deps);
  assert.equal(r.status, 200); assert.equal(decCalls(calls).length, 0);
  const rc = rpcCalls(calls); assert.equal(rc.length, 1);
  assert.equal(rc[0].url, "https://proj.supabase.co/rest/v1/rpc/idv_apply_event");
  const h = rc[0].init.headers as Record<string, string>;
  assert.equal(h.apikey, SRV_KEY); assert.equal(h.Authorization, `Bearer ${SRV_KEY}`);
  const b = rpcBody(rc[0]);
  assert.equal(b.p_event_id, "evt-1"); assert.equal(b.p_session_id, "sess-1"); assert.equal(b.p_webhook_type, "status.updated");
  assert.equal(b.p_provider_status, "In Progress"); assert.equal(b.p_environment, "sandbox");
  assert.equal(b.p_event_created_at, "2026-10-30T10:00:00.000Z");
  assert.equal(b.p_decision_fetched, false); assert.equal(b.p_liveness_ok, null); assert.equal(b.p_nigerian_doc, false);
  assert.equal(b.p_payload_hash, createHash("sha256").update(JSON.stringify(e)).digest("hex"));
});

test("the browser-style user id (vendor_data / metadata) is never sent to SQL", async () => {
  const { calls, deps } = setup();
  await handleWebhook(req(evt({ vendor_data: "someone-else", metadata: { user_id: "x" } })), deps);
  const txt = String(rpcCalls(calls)[0].init.body);
  assert.ok(!txt.includes("someone-else") && !txt.includes("user_id"));
});

test("Approved: decision is re-fetched with the API key, then applied with decision_fetched true and the flags", async () => {
  const { calls, deps } = setup({ decision: GOOD_DECISION });
  const r = await handleWebhook(req(evt({ status: "Approved" })), deps);
  assert.equal(r.status, 200);
  const dc = decCalls(calls); assert.equal(dc.length, 1);
  assert.equal(dc[0].url, "https://verification.didit.me/v3/session/sess-1/decision/");
  assert.equal((dc[0].init.headers as Record<string, string>)["x-api-key"], API_KEY);
  assert.ok(calls.indexOf(dc[0]) < calls.indexOf(rpcCalls(calls)[0]), "decision fetched BEFORE the database call");
  const b = rpcBody(rpcCalls(calls)[0]);
  assert.equal(b.p_decision_fetched, true); assert.equal(b.p_liveness_ok, true); assert.equal(b.p_face_match_ok, true);
  assert.equal(b.p_document_ok, true); assert.equal(b.p_nin_database_match, "full_match"); assert.equal(b.p_nigerian_doc, true);
});

test("Approved: no scores or media from the decision reach SQL", async () => {
  const { calls, deps } = setup({ decision: { ...GOOD_DECISION, liveness_checks: [{ status: "Approved", score: 97, video_url: "https://x/v.mp4" }] } });
  await handleWebhook(req(evt({ status: "Approved" })), deps);
  const txt = String(rpcCalls(calls)[0].init.body);
  assert.ok(!txt.includes("97") || txt.includes("p_payload_hash")); // 97 may only appear inside the hash
  assert.ok(!txt.includes("video_url") && !txt.includes("score"));
});

test("Approved with failed liveness / partial NIN: flags say so (SQL then sends it to review)", async () => {
  const a = setup({ decision: { ...GOOD_DECISION, liveness_checks: [{ status: "Declined" }] } });
  await handleWebhook(req(evt({ status: "Approved" })), a.deps);
  assert.equal(rpcBody(rpcCalls(a.calls)[0]).p_liveness_ok, false);
  const b = setup({ decision: { ...GOOD_DECISION, database_validations: [{ status: "In Review", issuing_state: "NGA", match_type: "partial_match" }] } });
  await handleWebhook(req(evt({ status: "Approved" })), b.deps);
  assert.equal(rpcBody(rpcCalls(b.calls)[0]).p_nin_database_match, "partial_match");
});

test("Approved: decision fetch fails (HTTP error, network error, timeout) -> 500, database NOT called", async () => {
  for (const o of [{ decisionStatus: 500 }, { decisionStatus: 403 }, { decisionThrows: true }]) {
    const { calls, deps } = setup(o);
    const r = await handleWebhook(req(evt({ status: "Approved" })), deps);
    assert.equal(r.status, 500, JSON.stringify(o)); assert.equal(rpcCalls(calls).length, 0);
  }
});

test("duplicate event_id: SQL says duplicate -> 200, outcome duplicate", async () => {
  const { deps } = setup({ rpc: { outcome: "duplicate", changed: false } });
  const r = await handleWebhook(req(evt()), deps);
  assert.equal(r.status, 200); assert.equal((await r.json()).outcome, "duplicate");
});

test("stale / ignored_transition / rejected unknown_status are 2xx (retrying cannot help)", async () => {
  for (const out of ["stale", "ignored_transition", "ignored_environment", "rejected"]) {
    const { deps } = setup({ rpc: { outcome: out, changed: false } });
    assert.equal((await handleWebhook(req(evt()), deps)).status, 200, out);
  }
});

test("database failure (HTTP 500, 401, network) -> 500 so Didit retries", async () => {
  for (const o of [{ rpcStatus: 500 }, { rpcStatus: 401 }, { rpcThrows: true }]) {
    const { deps } = setup(o);
    assert.equal((await handleWebhook(req(evt()), deps)).status, 500, JSON.stringify(o));
  }
});

test("SQL asks for a retry (unknown session / decision not fetched) -> 500", async () => {
  for (const reason of ["unknown_session", "decision_not_fetched"]) {
    const { deps } = setup({ rpc: { outcome: "rejected", reason, retry: true, changed: false } });
    assert.equal((await handleWebhook(req(evt()), deps)).status, 500, reason);
  }
});

test("event_id missing -> fallback key session|status|webhook_type", async () => {
  const { calls, deps } = setup();
  const e = evt(); delete (e as Record<string, unknown>).event_id;
  await handleWebhook(req(e), deps);
  assert.equal(rpcBody(rpcCalls(calls)[0]).p_event_id, "sess-1|In Progress|status.updated");
});

test("created_at conversions", () => {
  assert.equal(toIso("2026-10-30T10:00:00Z"), "2026-10-30T10:00:00.000Z");
  assert.equal(toIso(1_800_000_000), "2027-01-15T08:00:00.000Z");
  assert.equal(toIso(1_800_000_000_000), "2027-01-15T08:00:00.000Z");
  assert.equal(toIso("1800000000"), "2027-01-15T08:00:00.000Z");
  assert.equal(toIso("garbage"), null); assert.equal(toIso(null), null); assert.equal(toIso(undefined), null); assert.equal(toIso(""), null);
});

test("nothing secret is ever logged (success, bad signature, decision failure, database failure)", async () => {
  const logs: string[] = [];
  const orig = { e: console.error, l: console.log, w: console.warn, i: console.info };
  console.error = console.log = console.warn = console.info = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  try {
    await handleWebhook(req(evt()), setup().deps);
    await handleWebhook(req(evt(), { sig: "00" }), setup().deps);
    await handleWebhook(req(evt({ status: "Approved", session_token: "TOKEN-XYZ" })), setup({ decisionStatus: 500 }).deps);
    await handleWebhook(req(evt()), setup({ rpcStatus: 500 }).deps);
    await handleWebhook(req(evt()), setup({ env: { DIDIT_API_KEY: undefined } }).deps);
  } finally { console.error = orig.e; console.log = orig.l; console.warn = orig.w; console.info = orig.i; }
  const all = logs.join("\n");
  for (const s of [SECRET, API_KEY, SRV_KEY, "TOKEN-XYZ", "sess-1", "evt-1", "user-uuid"]) assert.ok(!all.includes(s), `log contains ${s}`);
});

test("oversized body -> 413", async () => {
  const { calls, deps } = setup();
  const big = JSON.stringify(evt({ pad: "x".repeat(1_000_100) }));
  const r = await handleWebhook(req({}, { raw: big, sig: "00" }), deps);
  assert.equal(r.status, 413); assert.equal(calls.length, 0);
});

// ---- decision.ts ----
test("decision flags: all approved, Nigerian document, full_match", () => {
  assert.deepEqual(extractDecisionFlags(GOOD_DECISION), { liveness_ok: true, face_match_ok: true, document_ok: true, nin_database_match: "full_match", nigerian_doc: true });
});
test("decision flags: decision may be nested under 'decision'", () => {
  assert.equal(extractDecisionFlags({ decision: GOOD_DECISION }).liveness_ok, true);
});
test("decision flags: missing or empty arrays are NOT ok; no NIN check = not_run; non-Nigerian doc", () => {
  const f = extractDecisionFlags({ id_verifications: [{ status: "Approved", issuing_state: "GHA" }] });
  assert.deepEqual(f, { liveness_ok: false, face_match_ok: false, document_ok: true, nin_database_match: "not_run", nigerian_doc: false });
  assert.deepEqual(extractDecisionFlags({}), { liveness_ok: false, face_match_ok: false, document_ok: false, nin_database_match: "not_run", nigerian_doc: false });
  for (const junk of [null, undefined, "x", 5, [], { liveness_checks: "no" }]) assert.equal(extractDecisionFlags(junk).liveness_ok, false);
});
test("decision flags: one non-approved node among several makes the flag false", () => {
  assert.equal(extractDecisionFlags({ liveness_checks: [{ status: "Approved" }, { status: "In Review" }] }).liveness_ok, false);
  assert.equal(extractDecisionFlags({ face_matches: [{ status: "Approved" }, { status: "Declined" }] }).face_match_ok, false);
  assert.equal(extractDecisionFlags({ liveness_checks: [{ status: "Not Finished" }] }).liveness_ok, false);
});
test("decision flags: worst NIN result wins (a no_match is never hidden by a full_match)", () => {
  const mk = (...r: Array<[string, string]>) => extractDecisionFlags({ database_validations: r.map(([status, match_type]) => ({ status, issuing_state: "NGA", match_type })) }).nin_database_match;
  assert.equal(mk(["Approved", "full_match"], ["Declined", "no_match"]), "no_match");
  assert.equal(mk(["Approved", "full_match"], ["In Review", "partial_match"]), "partial_match");
  assert.equal(mk(["Approved", "full_match"]), "full_match");
  assert.equal(mk(["Declined", "full_match"]), "partial_match");   // a full_match on a non-approved check is not trusted
  assert.equal(mk(["Approved", "unexpected"]), "partial_match");   // unknown match type is not trusted
});
test("decision flags: non-Nigeria database validation is ignored", () => {
  assert.equal(extractDecisionFlags({ database_validations: [{ status: "Approved", issuing_state: "GHA", match_type: "full_match" }] }).nin_database_match, "not_run");
});
