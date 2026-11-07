// Run: node --experimental-strip-types --test tests/coordinator-guide.test.mjs  (from the repo root; Deno is not needed, fetch is stubbed)
// NOTE: the PDF used here is read from the repo's downloads/ folder if it still exists, otherwise a small fake PDF is used.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const env = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "sk" };
let handler;
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
await import(pathToFileURL(path.resolve("supabase/functions/coordinator-guide/index.ts")).href);

const pdfPath = path.resolve("downloads/local-tasker-coordinator-guide.pdf");
const PDF = fs.existsSync(pdfPath) ? new Uint8Array(fs.readFileSync(pdfPath)) : new Uint8Array([...Buffer.from("%PDF-1.4\n"), ...new Uint8Array(2000).fill(65)]);
const B64 = Buffer.from(PDF).toString("base64");
const TOKEN = "a".repeat(64);

function run({ method = "POST", body = { token: TOKEN }, raw, origin = "https://streettasker.com", rpc = { ok: true, content_type: "application/pdf", filename: "StreetTasker-Local-Tasker-Coordinator-Guide.pdf", b64: B64 }, rpcStatus = 200, rpcThrows = false } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (rpcThrows) throw new Error("network down");
    return new Response(typeof rpc === "string" ? rpc : JSON.stringify(rpc), { status: rpcStatus });
  };
  const req = new Request("https://x/functions/v1/coordinator-guide", { method, headers: { origin }, body: method === "POST" ? (raw ?? JSON.stringify(body)) : undefined });
  return handler(req).then((res) => ({ res, calls }));
}

test("valid link: returns the exact PDF bytes with download headers, token goes only to the RPC with the service key", async () => {
  const { res, calls } = await run();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.match(res.headers.get("content-disposition"), /^attachment; filename="StreetTasker-Local-Tasker-Coordinator-Guide\.pdf"$/);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("access-control-allow-origin"), "https://streettasker.com");
  const got = new Uint8Array(await res.arrayBuffer());
  assert.equal(got.length, PDF.length); assert.ok(Buffer.from(got).equals(Buffer.from(PDF)));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://x.supabase.co/rest/v1/rpc/coordinator_guide_for_token");
  assert.equal(calls[0].init.headers.Authorization, "Bearer sk"); assert.equal(calls[0].init.headers.apikey, "sk");
  assert.deepEqual(JSON.parse(calls[0].init.body), { p_token: TOKEN });
});
test("token is trimmed and lower-cased", async () => {
  const { res, calls } = await run({ body: { token: "  " + TOKEN.toUpperCase() + " " } });
  assert.equal(res.status, 200); assert.deepEqual(JSON.parse(calls[0].init.body), { p_token: TOKEN });
});
for (const [name, token] of [["missing", undefined], ["empty", ""], ["too short", "abc"], ["63 chars", "a".repeat(63)], ["65 chars", "a".repeat(65)], ["non-hex", "g".repeat(64)], ["a number", 12345], ["an object", { x: 1 }], ["sql-ish", "' or 1=1 --" + "a".repeat(60)]]) {
  test("bad token (" + name + "): 404 and the database is never called", async () => {
    const { res, calls } = await run({ body: { token } });
    assert.equal(res.status, 404); assert.deepEqual(await res.json(), { ok: false, error: "invalid_token" }); assert.equal(calls.length, 0);
  });
}
test("link not valid in the database (wrong, expired or not approved): 404, no PDF bytes", async () => {
  const { res } = await run({ rpc: { ok: false, error: "invalid_token" } });
  assert.equal(res.status, 404); assert.equal(res.headers.get("content-type"), "application/json"); assert.deepEqual(await res.json(), { ok: false, error: "invalid_token" });
});
test("guide not loaded yet: 503 guide_not_ready", async () => {
  const { res } = await run({ rpc: { ok: false, error: "guide_not_ready" } });
  assert.equal(res.status, 503); assert.equal((await res.json()).error, "guide_not_ready");
});
test("database error: 502 and nothing leaks", async () => {
  const { res } = await run({ rpc: "boom secret detail", rpcStatus: 500 });
  assert.equal(res.status, 502); const t = await res.text(); assert.ok(!t.includes("secret"));
});
test("network failure to the database: 502", async () => {
  const { res } = await run({ rpcThrows: true }); assert.equal(res.status, 502);
});
test("stored file that is not a PDF is refused", async () => {
  const bad = Buffer.from("<html>" + "x".repeat(2000)).toString("base64");
  const { res } = await run({ rpc: { ok: true, filename: "x.pdf", b64: bad } });
  assert.equal(res.status, 500); assert.equal((await res.json()).error, "guide_corrupt");
});
test("stored text that is not base64 is refused", async () => {
  const { res } = await run({ rpc: { ok: true, filename: "x.pdf", b64: "!!!not base64!!!" } }); assert.equal(res.status, 500);
});
test("a strange file name from the database is replaced by a safe one", async () => {
  const { res } = await run({ rpc: { ok: true, filename: 'a"; evil=1', b64: B64 } });
  assert.equal(res.headers.get("content-disposition"), 'attachment; filename="coordinator-guide.pdf"');
});
test("GET is refused", async () => { const { res, calls } = await run({ method: "GET" }); assert.equal(res.status, 405); assert.equal(calls.length, 0); });
test("OPTIONS answers the browser check", async () => {
  const { res } = await run({ method: "OPTIONS" }); assert.equal(res.status, 204); assert.match(res.headers.get("access-control-allow-methods"), /POST/);
});
test("invalid JSON and oversized bodies: 400", async () => {
  assert.equal((await run({ raw: "{nope" })).res.status, 400);
  assert.equal((await run({ raw: JSON.stringify({ token: TOKEN, pad: "x".repeat(3000) }) })).res.status, 400);
});
test("an unknown website origin is not echoed back", async () => {
  const { res } = await run({ origin: "https://evil.example" }); assert.equal(res.headers.get("access-control-allow-origin"), "https://streettasker.com");
});
test("missing server settings: 500, no database call", async () => {
  const keep = env.SUPABASE_SERVICE_ROLE_KEY; delete env.SUPABASE_SERVICE_ROLE_KEY;
  try { const { res, calls } = await run(); assert.equal(res.status, 500); assert.equal(calls.length, 0); } finally { env.SUPABASE_SERVICE_ROLE_KEY = keep; }
});
