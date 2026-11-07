// Run: node --experimental-strip-types --test handler.test.ts   (Node 22; not run on Deno)
// All secrets, ids and URLs are made up. No network: fetch is a stub.
import test from "node:test";
import assert from "node:assert/strict";
import { handleCreateSession, isDiditUrl } from "./handler.ts";

const API_KEY = "test-didit-api-key-456";
const SRV_KEY = "test-service-role-key-789";
const WF = "wf-main-111";
const WF_CUST = "wf-customer-222";
const USER_TOKEN = "user-access-token-abc";
const CALLER = "11111111-1111-4111-8111-111111111111";
const SUBJECT = "22222222-2222-4222-8222-222222222222";
const TARGET = "33333333-3333-4333-8333-333333333333";
const VID = "44444444-4444-4444-8444-444444444444";
const SESSION_TOKEN = "SESSION-TOKEN-SECRET";
const ENV: Record<string, string> = {
  DIDIT_API_KEY: API_KEY, DIDIT_WORKFLOW_ID: WF, DIDIT_ENV: "sandbox",
  SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SRV_KEY,
};

interface Call { url: string; init: RequestInit }
interface Opts {
  env?: Record<string, string | undefined>;
  authStatus?: number; authBody?: unknown; authThrows?: boolean;
  start?: Record<string, unknown>; startErr?: { status: number; body: unknown }; startThrows?: boolean;
  didit?: unknown; diditStatus?: number; diditThrows?: boolean; diditText?: string;
  attachErr?: { status: number; body: unknown }; attachThrows?: boolean;
}
function setup(o: Opts = {}) {
  const calls: Call[] = [];
  const startOk = { verification_id: VID, user_id: SUBJECT, subject_kind: "tasker_regular", status: "NOT_STARTED", provider_session_id: null, reused: false };
  const f = (async (url: string, init: RequestInit = {}) => {
    const u = String(url); calls.push({ url: u, init });
    if (u.endsWith("/auth/v1/user")) {
      if (o.authThrows) throw new Error("boom");
      return new Response(JSON.stringify(o.authBody ?? { id: CALLER }), { status: o.authStatus ?? 200 });
    }
    if (u.endsWith("/rpc/idv_start_attempt")) {
      if (o.startThrows) throw new Error("boom");
      if (o.startErr) return new Response(JSON.stringify(o.startErr.body), { status: o.startErr.status });
      return new Response(JSON.stringify({ ...startOk, ...(o.start ?? {}) }), { status: 200 });
    }
    if (u.endsWith("/rpc/idv_attach_session")) {
      if (o.attachThrows) throw new Error("boom");
      if (o.attachErr) return new Response(JSON.stringify(o.attachErr.body), { status: o.attachErr.status });
      return new Response(JSON.stringify({ attached: true, status: "NOT_STARTED" }), { status: 200 });
    }
    if (u === "https://verification.didit.me/v3/session/") {
      if (o.diditThrows) throw new Error("boom");
      if (o.diditText !== undefined) return new Response(o.diditText, { status: o.diditStatus ?? 201 });
      return new Response(JSON.stringify(o.didit ?? { session_id: "sess-1", session_token: SESSION_TOKEN, url: "https://verify.didit.me/session/abc", status: "Not Started" }), { status: o.diditStatus ?? 201 });
    }
    throw new Error("unexpected url " + u);
  }) as unknown as typeof fetch;
  const env = { ...ENV, ...(o.env ?? {}) };
  return { calls, deps: { env: (n: string) => env[n], fetch: f } };
}
function req(body: unknown, o: { method?: string; auth?: string | null; origin?: string; raw?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const auth = o.auth === undefined ? `Bearer ${USER_TOKEN}` : o.auth;
  if (auth !== null) headers.authorization = auth;
  if (o.origin) headers.origin = o.origin;
  const method = o.method ?? "POST";
  return new Request("https://f.example/didit-create-session", { method, headers, body: method === "POST" ? (o.raw ?? JSON.stringify(body)) : undefined });
}
const find = (calls: Call[], suffix: string) => calls.filter((c) => c.url.endsWith(suffix) || c.url === suffix);
const bodyOf = (c: Call) => JSON.parse(String(c.init.body));
const SELF = { mode: "self" };

test("OPTIONS -> 204 with CORS for the site; unknown origin falls back to the site origin", async () => {
  const { calls, deps } = setup();
  const r = await handleCreateSession(req(null, { method: "OPTIONS", origin: "https://www.streettasker.com" }), deps);
  assert.equal(r.status, 204); assert.equal(r.headers.get("access-control-allow-origin"), "https://www.streettasker.com");
  const r2 = await handleCreateSession(req(SELF, { origin: "https://evil.example" }), setup().deps);
  assert.equal(r2.headers.get("access-control-allow-origin"), "https://streettasker.com");
  assert.equal(calls.length, 0);
});

test("non-POST -> 405", async () => {
  const { calls, deps } = setup();
  assert.equal((await handleCreateSession(req(null, { method: "GET" }), deps)).status, 405); assert.equal(calls.length, 0);
});

test("missing configuration -> 500, nothing called (each setting; bad DIDIT_ENV)", async () => {
  for (const k of ["DIDIT_API_KEY", "DIDIT_WORKFLOW_ID", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DIDIT_ENV"]) {
    const { calls, deps } = setup({ env: { [k]: undefined } });
    assert.equal((await handleCreateSession(req(SELF), deps)).status, 500, k); assert.equal(calls.length, 0, k);
  }
  assert.equal((await handleCreateSession(req(SELF), setup({ env: { DIDIT_ENV: "prod" } }).deps)).status, 500);
});

test("no / malformed Authorization header -> 401, nothing called", async () => {
  for (const a of [null, "", "Bearer", "Basic abc", "Bearer a b"]) {
    const { calls, deps } = setup();
    assert.equal((await handleCreateSession(req(SELF, { auth: a }), deps)).status, 401, String(a)); assert.equal(calls.length, 0);
  }
});

test("invalid token (auth lookup 401, junk id, network error) -> 401, no start, no Didit call", async () => {
  for (const o of [{ authStatus: 401 }, { authBody: { id: "not-a-uuid" } }, { authBody: {} }, { authThrows: true }]) {
    const { calls, deps } = setup(o);
    assert.equal((await handleCreateSession(req(SELF), deps)).status, 401, JSON.stringify(o));
    assert.equal(find(calls, "/rpc/idv_start_attempt").length, 0); assert.equal(find(calls, "https://verification.didit.me/v3/session/").length, 0);
  }
});

test("the user token is sent to Supabase auth only, never to Didit or SQL", async () => {
  const { calls, deps } = setup();
  await handleCreateSession(req(SELF), deps);
  for (const c of calls) {
    const h = JSON.stringify(c.init.headers ?? {}) + String(c.init.body ?? "");
    if (c.url.endsWith("/auth/v1/user")) assert.ok(h.includes(USER_TOKEN)); else assert.ok(!h.includes(USER_TOKEN), c.url);
  }
});

test("bad input -> 400 before any start (not JSON, array, bad mode, proxy without/with bad target, bad request_id)", async () => {
  const cases: Array<[unknown, string?]> = [
    [null, "not json"], [[1], undefined], [{}, undefined], [{ mode: "admin" }, undefined], [{ mode: "proxy" }, undefined],
    [{ mode: "proxy", local_tasker_user_id: "nope" }, undefined], [{ mode: "proxy", local_tasker_user_id: 5 }, undefined],
    [{ mode: "self", request_id: "" }, undefined], [{ mode: "self", request_id: 5 }, undefined], [{ mode: "self", request_id: "x".repeat(101) }, undefined],
  ];
  for (const [b, raw] of cases) {
    const { calls, deps } = setup();
    const r = await handleCreateSession(req(b, { raw }), deps);
    assert.equal(r.status, 400, JSON.stringify(b)); assert.equal(find(calls, "/rpc/idv_start_attempt").length, 0);
  }
});

test("self mode: SQL gets the caller from the TOKEN and no target; user_id / vendor_data in the body are ignored", async () => {
  const { calls, deps } = setup();
  const r = await handleCreateSession(req({ mode: "self", user_id: "99999999-9999-4999-8999-999999999999", vendor_data: "evil", local_tasker_user_id: TARGET }), deps);
  assert.equal(r.status, 200);
  const s = bodyOf(find(calls, "/rpc/idv_start_attempt")[0]);
  assert.equal(s.p_caller, CALLER); assert.equal(s.p_mode, "self"); assert.equal(s.p_target, null); assert.equal(s.p_environment, "sandbox");
  const txt = calls.map((c) => String(c.init.body ?? "")).join("|");
  assert.ok(!txt.includes("evil") && !txt.includes("99999999-9999"));
});

test("proxy mode: coordinator id from the token, target from the body, passed to SQL", async () => {
  const { calls, deps } = setup({ start: { user_id: TARGET, subject_kind: "tasker_local" } });
  const r = await handleCreateSession(req({ mode: "proxy", local_tasker_user_id: TARGET, request_id: "req-1" }), deps);
  assert.equal(r.status, 200);
  const s = bodyOf(find(calls, "/rpc/idv_start_attempt")[0]);
  assert.deepEqual([s.p_caller, s.p_mode, s.p_target, s.p_request_id], [CALLER, "proxy", TARGET, "req-1"]);
  assert.equal(bodyOf(find(calls, "https://verification.didit.me/v3/session/")[0]).vendor_data, TARGET);
});

test("Didit request: key header, workflow, vendor_data = SQL subject, callback, metadata verification id; no personal data", async () => {
  const { calls, deps } = setup();
  await handleCreateSession(req(SELF), deps);
  const d = find(calls, "https://verification.didit.me/v3/session/")[0];
  assert.equal((d.init.headers as Record<string, string>)["x-api-key"], API_KEY);
  assert.deepEqual(bodyOf(d), { workflow_id: WF, vendor_data: SUBJECT, callback: "https://streettasker.com/verify.html", metadata: { verification_id: VID } });
});

test("callback follows SITE_URL (trailing slash trimmed)", async () => {
  const { calls, deps } = setup({ env: { SITE_URL: "https://staging.example.com/" } });
  await handleCreateSession(req(SELF), deps);
  assert.equal(bodyOf(find(calls, "https://verification.didit.me/v3/session/")[0]).callback, "https://staging.example.com/verify.html");
});

test("success: only url, status, reused are returned; never the session token, session id or ids", async () => {
  const { deps } = setup();
  const r = await handleCreateSession(req(SELF), deps);
  const txt = await r.text(); const j = JSON.parse(txt);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(j).sort(), ["ok", "reused", "status", "url"]);
  assert.equal(j.url, "https://verify.didit.me/session/abc"); assert.equal(j.status, "NOT_STARTED"); assert.equal(j.reused, false);
  for (const s of [SESSION_TOKEN, "sess-1", VID, SUBJECT, API_KEY, SRV_KEY]) assert.ok(!txt.includes(s), s);
});

test("order: auth -> start -> Didit -> attach; attach carries the session id and workflow", async () => {
  const { calls, deps } = setup();
  await handleCreateSession(req(SELF), deps);
  const order = calls.map((c) => c.url.replace("https://proj.supabase.co", "").replace("https://verification.didit.me", ""));
  assert.deepEqual(order, ["/auth/v1/user", "/rest/v1/rpc/idv_start_attempt", "/v3/session/", "/rest/v1/rpc/idv_attach_session"]);
  assert.deepEqual(bodyOf(find(calls, "/rpc/idv_attach_session")[0]), { p_verification_id: VID, p_session_id: "sess-1", p_workflow_id: WF });
});

test("reused attempt: reused true is passed on", async () => {
  const r = await handleCreateSession(req(SELF), setup({ start: { reused: true, status: "IN_PROGRESS", provider_session_id: "sess-1" } }).deps);
  const j = await r.json(); assert.equal(j.reused, true); assert.equal(j.status, "IN_PROGRESS");
});

test("SQL refusals map to the right status and code, Didit is never called", async () => {
  const table: Array<[string, number]> = [["not_signed_in", 401], ["not_active_coordinator", 403], ["not_assigned", 403], ["not_for_local_tasker", 403],
    ["consent_required", 409], ["already_verified", 409], ["too_many_attempts", 429], ["bad_input", 400]];
  for (const [hint, status] of table) {
    const { calls, deps } = setup({ startErr: { status: 400, body: { code: "P0001", message: "x", hint } } });
    const r = await handleCreateSession(req(SELF), deps);
    assert.equal(r.status, status, hint); assert.equal((await r.json()).error, hint);
    assert.equal(find(calls, "https://verification.didit.me/v3/session/").length, 0, hint);
  }
});

test("unknown SQL error, SQL down, or a strange start result -> 500 generic, Didit not called", async () => {
  for (const o of [{ startErr: { status: 400, body: { hint: "something_new", message: "secret detail" } } }, { startErr: { status: 500, body: {} } }, { startThrows: true }, { start: { verification_id: 5 } }]) {
    const { calls, deps } = setup(o as Opts);
    const r = await handleCreateSession(req(SELF), deps); const txt = await r.text();
    assert.equal(r.status, 500, JSON.stringify(o)); assert.ok(!txt.includes("secret detail"));
    assert.equal(find(calls, "https://verification.didit.me/v3/session/").length, 0);
  }
});

test("customers: no customer workflow yet -> 503 and Didit not called; with one configured it is used", async () => {
  const a = setup({ start: { subject_kind: "customer" } });
  const r = await handleCreateSession(req(SELF), a.deps);
  assert.equal(r.status, 503); assert.equal(find(a.calls, "https://verification.didit.me/v3/session/").length, 0);
  const b = setup({ start: { subject_kind: "customer" }, env: { DIDIT_WORKFLOW_ID_CUSTOMER: WF_CUST } });
  assert.equal((await handleCreateSession(req(SELF), b.deps)).status, 200);
  assert.equal(bodyOf(find(b.calls, "https://verification.didit.me/v3/session/")[0]).workflow_id, WF_CUST);
});

test("Local Tasker and regular tasker use the main workflow even when a customer one exists", async () => {
  for (const kind of ["tasker_local", "tasker_regular"]) {
    const { calls, deps } = setup({ start: { subject_kind: kind }, env: { DIDIT_WORKFLOW_ID_CUSTOMER: WF_CUST } });
    await handleCreateSession(req(SELF), deps);
    assert.equal(bodyOf(find(calls, "https://verification.didit.me/v3/session/")[0]).workflow_id, WF, kind);
  }
});

test("coordinator: same main workflow as taskers (even with a customer one configured) and the callback is the coordinator page", async () => {
  const { calls, deps } = setup({ env: { DIDIT_WORKFLOW_ID_CUSTOMER: WF_CUST }, start: { subject_kind: "coordinator" } });
  const r = await handleCreateSession(req(SELF), deps);
  assert.equal(r.status, 200);
  const d = find(calls, "https://verification.didit.me/v3/session/");
  assert.equal(d.length, 1);
  assert.deepEqual(bodyOf(d[0]), { workflow_id: WF, vendor_data: SUBJECT, callback: "https://streettasker.com/coordinator-identity.html", metadata: { verification_id: VID } });
  assert.equal(bodyOf(find(calls, "/rpc/idv_attach_session")[0]).p_workflow_id, WF);
});

test("coordinator callback follows SITE_URL; every other kind still comes back to verify.html", async () => {
  const a = setup({ env: { SITE_URL: "https://staging.example.com/" }, start: { subject_kind: "coordinator" } });
  await handleCreateSession(req(SELF), a.deps);
  assert.equal(bodyOf(find(a.calls, "https://verification.didit.me/v3/session/")[0]).callback, "https://staging.example.com/coordinator-identity.html");
  for (const kind of ["tasker_regular", "tasker_local", "customer"]) {
    const b = setup({ env: { DIDIT_WORKFLOW_ID_CUSTOMER: WF_CUST }, start: { subject_kind: kind } });
    await handleCreateSession(req(SELF), b.deps);
    assert.equal(bodyOf(find(b.calls, "https://verification.didit.me/v3/session/")[0]).callback, "https://streettasker.com/verify.html", kind);
  }
});

test("Didit 403 (bad key), 500, network error, timeout-style throw, bad JSON -> 502 generic 'try later', nothing about configuration", async () => {
  for (const o of [{ diditStatus: 403 }, { diditStatus: 500 }, { diditThrows: true }, { diditText: "not json" }, { diditText: "null" }]) {
    const { calls, deps } = setup(o);
    const r = await handleCreateSession(req(SELF), deps); const txt = (await r.text()).toLowerCase();
    assert.equal(r.status, 502, JSON.stringify(o));
    assert.ok(!txt.includes("config") && !txt.includes("key") && !txt.includes("403"), txt);
    assert.equal(find(calls, "/rpc/idv_attach_session").length, 0);
  }
});

test("Didit reply without session_id, without url, or with a non-Didit / non-https url -> 502, url not returned, nothing attached", async () => {
  const bad = [{ url: "https://verify.didit.me/x" }, { session_id: "s" }, { session_id: "s", url: "http://verify.didit.me/x" },
    { session_id: "s", url: "https://evil.example/x" }, { session_id: "s", url: "https://verify.didit.me.evil.example/x" },
    { session_id: "s", url: "javascript:alert(1)" }, { session_id: "", url: "https://verify.didit.me/x" }];
  for (const didit of bad) {
    const { calls, deps } = setup({ didit });
    const r = await handleCreateSession(req(SELF), deps);
    assert.equal(r.status, 502, JSON.stringify(didit)); assert.equal(find(calls, "/rpc/idv_attach_session").length, 0);
  }
  assert.ok(isDiditUrl("https://verify.didit.me/a") && isDiditUrl("https://didit.me/a") && !isDiditUrl("https://notdidit.me/a") && !isDiditUrl(5));
});

test("attach fails (different session already set, SQL down) -> 500 and the url is NOT given out", async () => {
  for (const o of [{ attachErr: { status: 400, body: { hint: "session_already_set" } } }, { attachErr: { status: 500, body: {} } }, { attachThrows: true }]) {
    const r = await handleCreateSession(req(SELF), setup(o).deps); const txt = await r.text();
    assert.equal(r.status, 500, JSON.stringify(o)); assert.ok(!txt.includes("didit.me"));
  }
});

test("nothing secret is ever logged (all failure paths)", async () => {
  const logs: string[] = [];
  const orig = { e: console.error, l: console.log, w: console.warn, i: console.info };
  console.error = console.log = console.warn = console.info = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  try {
    for (const o of [{}, { diditStatus: 403 }, { diditThrows: true }, { attachErr: { status: 500, body: {} } }, { startErr: { status: 500, body: { message: "x" } } },
      { env: { DIDIT_API_KEY: undefined } }, { start: { subject_kind: "customer" } }] as Opts[]) {
      await handleCreateSession(req({ mode: "proxy", local_tasker_user_id: TARGET }), setup(o).deps);
    }
  } finally { console.error = orig.e; console.log = orig.l; console.warn = orig.w; console.info = orig.i; }
  const all = logs.join("\n");
  for (const s of [API_KEY, SRV_KEY, USER_TOKEN, SESSION_TOKEN, "sess-1", CALLER, SUBJECT, TARGET, VID]) assert.ok(!all.includes(s), `log contains ${s}`);
});
