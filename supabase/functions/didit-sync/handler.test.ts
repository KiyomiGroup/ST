// Run: node --experimental-strip-types --test handler.test.ts   (Node 22; not run on Deno)
// All secrets, ids and URLs are made up. No network: fetch is a stub.
import test from "node:test";
import assert from "node:assert/strict";
import { handleSync } from "./handler.ts";

const API_KEY = "test-didit-api-key-456";
const SRV_KEY = "test-service-role-key-789";
const ANON_KEY = "test-anon-key-321";
const USER_TOKEN = "user-access-token-abc";
const CALLER = "11111111-1111-4111-8111-111111111111";
const TARGET = "33333333-3333-4333-8333-333333333333";
const OTHER = "55555555-5555-4555-8555-555555555555";
const VID = "44444444-4444-4444-8444-444444444444";
const SESSION = "didit-session-xyz";
const ENV: Record<string, string> = {
  DIDIT_API_KEY: API_KEY, DIDIT_ENV: "sandbox", SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_ANON_KEY: ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: SRV_KEY,
};
const GOOD_DECISION = {
  status: "Approved",
  id_verifications: [{ status: "Approved", issuing_state: "GBR" }],
  liveness_checks: [{ status: "Approved", score: 91 }],
  face_matches: [{ status: "Approved", score: 88 }],
};

interface Call { url: string; init: RequestInit }
interface Opts {
  env?: Record<string, string | undefined>;
  authStatus?: number; authBody?: unknown; authThrows?: boolean;
  perm?: Record<string, unknown>; permErr?: { status: number; body: unknown }; permThrows?: boolean;
  row?: unknown; rowStatus?: number; rowThrows?: boolean;
  didit?: unknown; diditStatus?: number; diditThrows?: boolean; diditText?: string;
  apply?: Record<string, unknown>; applyErr?: { status: number; body: unknown }; applyThrows?: boolean;
  pending?: Record<string, unknown>; pendingErr?: { status: number; body: unknown };
  nameErr?: { status: number; body: unknown };
}
function setup(o: Opts = {}) {
  const calls: Call[] = [];
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s });
  const permOk = { status: "IN_PROGRESS", has_attempt: true, has_open_attempt: true, verified: false };
  const rowOk = [{ id: VID, provider_session_id: SESSION, status: "IN_PROGRESS" }];
  const f = (async (url: string, init: RequestInit = {}) => {
    const u = String(url); calls.push({ url: u, init });
    if (u.endsWith("/auth/v1/user")) {
      if (o.authThrows) throw new Error("boom");
      return json(o.authBody ?? { id: CALLER }, o.authStatus ?? 200);
    }
    if (u.endsWith("/rpc/idv_my_status") || u.endsWith("/rpc/idv_local_status")) {
      if (o.permThrows) throw new Error("boom");
      if (o.permErr) return json(o.permErr.body, o.permErr.status);
      return json({ ...permOk, ...(o.perm ?? {}) });
    }
    if (u.includes("/rest/v1/identity_verifications?")) {
      if (o.rowThrows) throw new Error("boom");
      return json(o.row ?? rowOk, o.rowStatus ?? 200);
    }
    if (u.startsWith("https://verification.didit.me/v3/session/")) {
      if (o.diditThrows) throw new Error("boom");
      if (o.diditText !== undefined) return new Response(o.diditText, { status: o.diditStatus ?? 200 });
      return json(o.didit ?? { status: "In Progress" }, o.diditStatus ?? 200);
    }
    if (u.endsWith("/rpc/idv_apply_event")) {
      if (o.applyThrows) throw new Error("boom");
      if (o.applyErr) return json(o.applyErr.body, o.applyErr.status);
      return json({ outcome: "applied", changed: true, status: "VERIFIED", ...(o.apply ?? {}) });
    }
    if (u.endsWith("/rpc/idv_store_name")) {
      if (o.nameErr) return json(o.nameErr.body, o.nameErr.status);
      return json({ stored: true, words: 3 });
    }
    if (u.endsWith("/rpc/idv_mark_pending")) {
      if (o.pendingErr) return json(o.pendingErr.body, o.pendingErr.status);
      return json({ changed: true, status: "PENDING", ...(o.pending ?? {}) });
    }
    throw new Error("unexpected url " + u);
  }) as unknown as typeof fetch;
  const env = { ...ENV, ...(o.env ?? {}) };
  return { calls, deps: { env: (n: string) => env[n], fetch: f, now: () => Date.parse("2026-10-30T12:00:00Z") } };
}
function req(body: unknown, o: { method?: string; auth?: string | null; origin?: string; raw?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const auth = o.auth === undefined ? `Bearer ${USER_TOKEN}` : o.auth;
  if (auth !== null) headers.authorization = auth;
  if (o.origin) headers.origin = o.origin;
  const method = o.method ?? "POST";
  return new Request("https://f.example/didit-sync", { method, headers, body: method === "POST" ? (o.raw ?? JSON.stringify(body)) : undefined });
}
const find = (calls: Call[], suffix: string) => calls.filter((c) => c.url.endsWith(suffix));
const bodyOf = (c: Call) => JSON.parse(String(c.init.body));
const hdr = (c: Call, n: string) => (c.init.headers as Record<string, string>)[n];
const diditCalls = (calls: Call[]) => calls.filter((c) => c.url.startsWith("https://verification.didit.me"));
const SELF = { mode: "self" };
const PROXY = { mode: "proxy", local_tasker_user_id: TARGET };

async function captureLogs(fn: () => Promise<unknown>): Promise<string> {
  const lines: string[] = []; const orig = console.error; const o2 = console.log; const w = console.warn;
  console.error = console.log = console.warn = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try { await fn(); } finally { console.error = orig; console.log = o2; console.warn = w; }
  return lines.join("\n");
}

test("OPTIONS -> 204 with CORS; unknown origin falls back; non-POST -> 405", async () => {
  const { calls, deps } = setup();
  const r = await handleSync(req(null, { method: "OPTIONS", origin: "https://www.streettasker.com" }), deps);
  assert.equal(r.status, 204); assert.equal(r.headers.get("access-control-allow-origin"), "https://www.streettasker.com");
  const r2 = await handleSync(req(SELF, { origin: "https://evil.example" }), setup().deps);
  assert.equal(r2.headers.get("access-control-allow-origin"), "https://streettasker.com");
  assert.equal((await handleSync(req(null, { method: "GET" }), deps)).status, 405);
  assert.equal(calls.length, 0);
});

for (const name of ["DIDIT_API_KEY", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "DIDIT_ENV"]) {
  test(`missing ${name} -> 500, nothing called`, async () => {
    const { calls, deps } = setup({ env: { [name]: undefined } });
    const r = await handleSync(req(SELF), deps);
    assert.equal(r.status, 500); assert.equal(calls.length, 0);
  });
}
test("DIDIT_ENV other than sandbox/live -> 500", async () => {
  const { calls, deps } = setup({ env: { DIDIT_ENV: "prod" } });
  assert.equal((await handleSync(req(SELF), deps)).status, 500); assert.equal(calls.length, 0);
});

test("missing, malformed or rejected token -> 401, nothing else called", async () => {
  for (const o of [{ auth: null }, { auth: "Basic abc" }, { auth: "Bearer" }]) {
    const { calls, deps } = setup();
    assert.equal((await handleSync(req(SELF, o), deps)).status, 401); assert.equal(calls.length, 0);
  }
  for (const s of [{ authStatus: 401 }, { authBody: { id: "not-a-uuid" } }, { authBody: {} }, { authThrows: true }]) {
    const { calls, deps } = setup(s);
    assert.equal((await handleSync(req(SELF), deps)).status, 401);
    assert.equal(calls.length, 1);
  }
});

test("bad input -> 400 and nothing past the token check", async () => {
  const bad: unknown[] = [null, [], "x", {}, { mode: "other" }, { mode: "proxy" }, { mode: "proxy", local_tasker_user_id: "nope" },
    { mode: "proxy", local_tasker_user_id: 5 }, { mode: "self", returned: "yes" }, { mode: "self", returned: 1 }];
  for (const b of bad) {
    const { calls, deps } = setup();
    const r = await handleSync(req(b), deps);
    assert.equal(r.status, 400, JSON.stringify(b)); assert.equal(calls.length, 1);
  }
  const { deps } = setup();
  assert.equal((await handleSync(req(null, { raw: "{not json" }), deps)).status, 400);
});

test("self mode: permission read runs as the user with the anon key; body ids are ignored", async () => {
  const { calls, deps } = setup();
  const r = await handleSync(req({ mode: "self", user_id: OTHER, local_tasker_user_id: OTHER, vendor_data: OTHER, session_id: "evil", status: "Approved" }), deps);
  assert.equal(r.status, 200);
  const perm = find(calls, "/rpc/idv_my_status");
  assert.equal(perm.length, 1); assert.deepEqual(bodyOf(perm[0]), {});
  assert.equal(hdr(perm[0], "Authorization"), `Bearer ${USER_TOKEN}`); assert.equal(hdr(perm[0], "apikey"), ANON_KEY);
  const row = calls.find((c) => c.url.includes("identity_verifications?"))!;
  assert.ok(row.url.includes(`user_id=eq.${CALLER}`) && !row.url.includes(OTHER));
  assert.ok(row.url.includes("environment=eq.sandbox"));
  assert.equal(hdr(row, "Authorization"), `Bearer ${SRV_KEY}`);
  assert.ok(diditCalls(calls)[0].url.includes(SESSION) && !diditCalls(calls)[0].url.includes("evil"));
  assert.ok(!bodyOf(find(calls, "/rpc/idv_apply_event")[0]).p_event_id.includes(OTHER));
});

test("proxy mode: idv_local_status with the target as the user; row read for the target", async () => {
  const { calls, deps } = setup();
  assert.equal((await handleSync(req(PROXY), deps)).status, 200);
  const perm = find(calls, "/rpc/idv_local_status");
  assert.deepEqual(bodyOf(perm[0]), { p_tasker: TARGET }); assert.equal(hdr(perm[0], "Authorization"), `Bearer ${USER_TOKEN}`);
  assert.equal(find(calls, "/rpc/idv_my_status").length, 0);
  assert.ok(calls.find((c) => c.url.includes("identity_verifications?"))!.url.includes(`user_id=eq.${TARGET}`));
});

test("SQL refusals map to codes; Didit is not called", async () => {
  const cases: [string, number][] = [["not_signed_in", 401], ["not_active_coordinator", 403], ["not_assigned", 403], ["bad_input", 400]];
  for (const [hint, code] of cases) {
    const { calls, deps } = setup({ permErr: { status: 400, body: { hint, message: "secret detail" } } });
    const r = await handleSync(req(PROXY), deps); const j = await r.json();
    assert.equal(r.status, code); assert.equal(j.error, hint); assert.ok(!JSON.stringify(j).includes("secret detail"));
    assert.equal(diditCalls(calls).length, 0); assert.equal(find(calls, "/rpc/idv_apply_event").length, 0);
  }
  for (const o of [{ permErr: { status: 500, body: { hint: "weird" } } }, { permErr: { status: 500, body: null } }, { permThrows: true }]) {
    const { calls, deps } = setup(o);
    const r = await handleSync(req(SELF), deps);
    assert.equal(r.status, 500); assert.equal(diditCalls(calls).length, 0);
  }
});

test("nothing open, no session yet, or a closed attempt: answer from our data, Didit not called", async () => {
  let s = setup({ perm: { has_open_attempt: false, status: "VERIFIED", verified: true } });
  let j = await (await handleSync(req(SELF), s.deps)).json();
  assert.deepEqual(j, { ok: true, status: "VERIFIED", verified: true, needs_review: false, changed: false });
  assert.equal(diditCalls(s.calls).length, 0); assert.equal(s.calls.filter((c) => c.url.includes("identity_verifications?")).length, 0);
  s = setup({ row: [{ id: VID, provider_session_id: null, status: "NOT_STARTED" }], perm: { status: "NOT_STARTED" } });
  j = await (await handleSync(req(SELF), s.deps)).json();
  assert.equal(j.status, "NOT_STARTED"); assert.equal(diditCalls(s.calls).length, 0);
  s = setup({ row: [{ id: VID, provider_session_id: SESSION, status: "FAILED" }] });
  j = await (await handleSync(req(SELF), s.deps)).json();
  assert.equal(j.status, "FAILED"); assert.equal(diditCalls(s.calls).length, 0);
  s = setup({ row: [] }); assert.equal((await handleSync(req(SELF), s.deps)).status, 200); assert.equal(diditCalls(s.calls).length, 0);
});

test("attempt read failure -> 500, Didit not called", async () => {
  for (const o of [{ rowStatus: 500 }, { rowThrows: true }]) {
    const { calls, deps } = setup(o);
    assert.equal((await handleSync(req(SELF), deps)).status, 500); assert.equal(diditCalls(calls).length, 0);
  }
});

test("Didit request: GET decision with the API key; the user token never goes to Didit", async () => {
  const { calls, deps } = setup();
  await handleSync(req(SELF), deps);
  const d = diditCalls(calls); assert.equal(d.length, 1);
  assert.equal(d[0].url, `https://verification.didit.me/v3/session/${SESSION}/decision/`);
  assert.equal(d[0].init.method, "GET"); assert.equal(hdr(d[0], "x-api-key"), API_KEY);
  assert.ok(!JSON.stringify(d[0].init.headers).includes(USER_TOKEN));
});

test("Approved: flags from the decision go to idv_apply_event; response has only the summary keys", async () => {
  const { calls, deps } = setup({ didit: GOOD_DECISION, apply: { status: "VERIFIED", changed: true } });
  const r = await handleSync(req(SELF), deps); const j = await r.json();
  assert.deepEqual(j, { ok: true, status: "VERIFIED", verified: true, needs_review: false, changed: true });
  const a = bodyOf(find(calls, "/rpc/idv_apply_event")[0]);
  assert.equal(a.p_session_id, SESSION); assert.equal(a.p_webhook_type, "sync"); assert.equal(a.p_provider_status, "Approved");
  assert.equal(a.p_environment, "sandbox"); assert.equal(a.p_decision_fetched, true);
  assert.equal(a.p_liveness_ok, true); assert.equal(a.p_face_match_ok, true); assert.equal(a.p_nigerian_doc, false);
  assert.equal(a.p_event_created_at, "2026-10-30T12:00:00.000Z");
  assert.equal(hdr(find(calls, "/rpc/idv_apply_event")[0], "Authorization"), `Bearer ${SRV_KEY}`);
  assert.ok(!JSON.stringify(j).includes("91") && !JSON.stringify(j).includes(SESSION));
});

test("Approved with a failed liveness node is sent as not ok (SQL then chooses review)", async () => {
  const bad = { ...GOOD_DECISION, liveness_checks: [{ status: "Declined" }] };
  const { calls, deps } = setup({ didit: bad, apply: { status: "REVIEW_REQUIRED" } });
  const j = await (await handleSync(req(SELF), deps)).json();
  assert.equal(bodyOf(find(calls, "/rpc/idv_apply_event")[0]).p_liveness_ok, false);
  assert.equal(j.status, "REVIEW_REQUIRED"); assert.equal(j.needs_review, true); assert.equal(j.verified, false);
});

test("status read from decision.status too; non-Approved sends no flags", async () => {
  const { calls, deps } = setup({ didit: { decision: { status: "Declined" } }, apply: { status: "FAILED" } });
  const j = await (await handleSync(req(SELF), deps)).json();
  const a = bodyOf(find(calls, "/rpc/idv_apply_event")[0]);
  assert.equal(a.p_provider_status, "Declined"); assert.equal(a.p_decision_fetched, false); assert.equal(a.p_liveness_ok, null);
  assert.equal(j.status, "FAILED");
});

test("each sync is its own event id; payload hash is a hash, not the session id", async () => {
  const s1 = setup(), s2 = setup();
  await handleSync(req(SELF), s1.deps); await handleSync(req(SELF), s2.deps);
  const a = bodyOf(find(s1.calls, "/rpc/idv_apply_event")[0]), b = bodyOf(find(s2.calls, "/rpc/idv_apply_event")[0]);
  assert.notEqual(a.p_event_id, b.p_event_id); assert.match(a.p_event_id, /^sync\|/);
  assert.match(a.p_payload_hash, /^[0-9a-f]{64}$/);
});

test("Didit failures -> 502 generic, no apply, no key or config text", async () => {
  const cases: Opts[] = [{ diditStatus: 403, didit: { detail: "bad key" } }, { diditStatus: 401 }, { diditStatus: 404 }, { diditStatus: 500 },
    { diditThrows: true }, { diditText: "<html>" }, { didit: {} }, { didit: { status: "" } }, { didit: { status: 5 } },
    { didit: { status: "x".repeat(80) } }, { diditText: "null" }];
  for (const o of cases) {
    const { calls, deps } = setup(o);
    const r = await handleSync(req(SELF), deps); const t = await r.text();
    assert.equal(r.status, 502, JSON.stringify(o)); assert.equal(find(calls, "/rpc/idv_apply_event").length, 0);
    assert.ok(!/key|403|401|workflow|didit/i.test(JSON.parse(t).message), t);
  }
});

test("database failures and SQL retry answers -> 500", async () => {
  for (const o of [{ applyErr: { status: 500, body: { hint: "x" } } }, { applyThrows: true },
    { apply: { retry: true, reason: "unknown_session" } }, { apply: { retry: true, reason: "decision_not_fetched" } }]) {
    const r = await handleSync(req(SELF), setup(o).deps);
    assert.equal(r.status, 500, JSON.stringify(o));
  }
});

test("returned:true with no final answer -> PENDING via idv_mark_pending; otherwise never called", async () => {
  let s = setup({ apply: { status: "IN_PROGRESS", changed: false } });
  let j = await (await handleSync(req({ mode: "self", returned: true }), s.deps)).json();
  assert.equal(j.status, "PENDING"); assert.equal(j.changed, true);
  assert.deepEqual(bodyOf(find(s.calls, "/rpc/idv_mark_pending")[0]), { p_verification_id: VID });
  assert.equal(hdr(find(s.calls, "/rpc/idv_mark_pending")[0], "Authorization"), `Bearer ${SRV_KEY}`);
  s = setup({ apply: { status: "IN_PROGRESS", changed: false } });
  j = await (await handleSync(req({ mode: "self", returned: false }), s.deps)).json();
  assert.equal(j.status, "IN_PROGRESS"); assert.equal(find(s.calls, "/rpc/idv_mark_pending").length, 0);
  s = setup({ didit: GOOD_DECISION, apply: { status: "VERIFIED" } });
  j = await (await handleSync(req({ mode: "self", returned: true }), s.deps)).json();
  assert.equal(j.status, "VERIFIED"); assert.equal(find(s.calls, "/rpc/idv_mark_pending").length, 0);
  s = setup({ didit: { status: "In Review" }, apply: { status: "REVIEW_REQUIRED" } });
  await handleSync(req({ mode: "self", returned: true }), s.deps); assert.equal(find(s.calls, "/rpc/idv_mark_pending").length, 0);
});

test("mark-pending failure is not fatal and leaves the status", async () => {
  const s = setup({ apply: { status: "IN_PROGRESS", changed: false }, pendingErr: { status: 500, body: { hint: "boom" } } });
  const r = await handleSync(req({ mode: "self", returned: true }), s.deps); const j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.status, "IN_PROGRESS");
});

test("already PENDING and Didit still waiting: no event applied (a refresh must not undo PENDING)", async () => {
  for (const st of ["Not Started", "In Progress", "Awaiting User"]) {
    const s = setup({ row: [{ id: VID, provider_session_id: SESSION, status: "PENDING" }], didit: { status: st }, perm: { status: "PENDING" } });
    const j = await (await handleSync(req(SELF), s.deps)).json();
    assert.equal(j.status, "PENDING"); assert.equal(j.changed, false); assert.equal(find(s.calls, "/rpc/idv_apply_event").length, 0);
  }
  const s = setup({ row: [{ id: VID, provider_session_id: SESSION, status: "PENDING" }], didit: { status: "Declined" }, apply: { status: "FAILED" } });
  assert.equal((await (await handleSync(req(SELF), s.deps)).json()).status, "FAILED");
});

test("duplicate / stale answers from SQL are returned as the current status", async () => {
  const s = setup({ apply: { outcome: "stale", changed: false, status: "REVIEW_REQUIRED" } });
  const j = await (await handleSync(req(SELF), s.deps)).json();
  assert.equal(j.status, "REVIEW_REQUIRED"); assert.equal(j.changed, false);
  const s2 = setup({ apply: { outcome: "duplicate", changed: false, status: undefined } });
  assert.equal((await (await handleSync(req(SELF), s2.deps)).json()).status, "IN_PROGRESS");
});

test("nothing secret is ever logged, on any path", async () => {
  const secrets = [API_KEY, SRV_KEY, ANON_KEY, USER_TOKEN, SESSION, CALLER, TARGET, VID];
  const runs: Opts[] = [{}, { diditStatus: 403 }, { diditThrows: true }, { didit: {} }, { applyErr: { status: 500, body: { message: SESSION } } },
    { applyThrows: true }, { apply: { retry: true, reason: "x" } }, { permErr: { status: 500, body: null } }, { rowStatus: 500 },
    { pendingErr: { status: 500, body: null }, apply: { status: "IN_PROGRESS" } }];
  for (const o of runs) {
    const s = setup(o);
    const out = await captureLogs(() => handleSync(req({ mode: "proxy", local_tasker_user_id: TARGET, returned: true }), s.deps));
    for (const x of secrets) assert.ok(!out.includes(x), `leak of ${x} in: ${out}`);
  }
});

// ---- VR1: verified legal name ----
const NAMED = { ...GOOD_DECISION, id_verifications: [{ status: "Approved", issuing_state: "NGA", full_name: "Chinedu Emmanuel Okafor", date_of_birth: "1990-01-01", document_number: "A1234567" }] };
const nameCalls = (calls: Call[]) => calls.filter((c) => c.url.endsWith("/rpc/idv_store_name"));

test("VR1 sync: VERIFIED with a name -> idv_store_name gets the session and the name only", async () => {
  const { calls, deps } = setup({ didit: NAMED });
  const r = await handleSync(req({ mode: "self" }), deps);
  assert.equal(r.status, 200);
  const n = nameCalls(calls); assert.equal(n.length, 1);
  assert.deepEqual(JSON.parse(String(n[0].init.body)), { p_session_id: SESSION, p_full_name: "Chinedu Emmanuel Okafor" });
  assert.ok(!JSON.stringify(await r.clone().json()).includes("Okafor"), "response must not carry the name");
});

test("VR1 sync: no name in the decision, or not VERIFIED, or non-Approved -> no name call", async () => {
  const a = setup({ didit: GOOD_DECISION }); await handleSync(req({ mode: "self" }), a.deps); assert.equal(nameCalls(a.calls).length, 0);
  const b = setup({ didit: NAMED, apply: { status: "REVIEW_REQUIRED" } }); await handleSync(req({ mode: "self" }), b.deps); assert.equal(nameCalls(b.calls).length, 0);
  const c = setup({ didit: { status: "In Progress" } }); await handleSync(req({ mode: "self" }), c.deps); assert.equal(nameCalls(c.calls).length, 0);
});

test("VR1 sync: a failed name store is not fatal and the name is never logged", async () => {
  const logs: string[] = []; const orig = console.error; console.error = (...a: unknown[]) => { logs.push(a.join(" ")); };
  try {
    const { deps } = setup({ didit: NAMED, nameErr: { status: 500, body: { message: "Chinedu Emmanuel Okafor" } } });
    const r = await handleSync(req({ mode: "self" }), deps);
    assert.equal(r.status, 200);
  } finally { console.error = orig; }
  assert.ok(logs.length > 0);
  assert.ok(!logs.join("\n").includes("Okafor"));
});
