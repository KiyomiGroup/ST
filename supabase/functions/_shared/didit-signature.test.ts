// Tests for didit-signature.ts. Stage V2a.
// All secrets and payloads are made up. The expected signatures are computed
// with node:crypto from HAND-WRITTEN canonical strings, not with the module
// under test, so the module is checked against an independent reference.
// Runs on Deno (`deno test`) and Node 22 (`node --test`).
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { canonicalJson, verifyDiditSignature } from "./didit-signature.ts";

const SECRET = "test-secret-not-real";
const NOW = 1_800_000_000;

const ref = (canonical: string, secret = SECRET) =>
  createHmac("sha256", secret).update(canonical, "utf8").digest("hex");

const check = (over: Partial<Parameters<typeof verifyDiditSignature>[0]>) =>
  verifyDiditSignature({
    rawBody: "{}",
    signatureHeader: null,
    timestampHeader: String(NOW),
    secret: SECRET,
    nowSeconds: NOW,
    ...over,
  });

test("valid signature passes and returns the payload", async () => {
  const body = '{"status":"Approved","session_id":"abc"}';
  const sig = ref('{"session_id":"abc","status":"Approved"}');
  const r = await check({ rawBody: body, signatureHeader: sig });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.payload.status, "Approved");
});

test("uppercase hex and surrounding spaces in the header are accepted", async () => {
  const sig = ref('{"a":1}');
  const r = await check({ rawBody: '{"a":1}', signatureHeader: ` ${sig.toUpperCase()} ` });
  assert.equal(r.ok, true);
});

test("wrong secret fails", async () => {
  const sig = ref('{"a":1}', "some-other-secret");
  const r = await check({ rawBody: '{"a":1}', signatureHeader: sig });
  assert.deepEqual(r, { ok: false, reason: "bad_signature" });
});

test("tampered body fails", async () => {
  const sig = ref('{"status":"Declined"}');
  const r = await check({ rawBody: '{"status":"Approved"}', signatureHeader: sig });
  assert.deepEqual(r, { ok: false, reason: "bad_signature" });
});

test("truncated or garbage signature fails", async () => {
  const sig = ref('{"a":1}');
  assert.deepEqual(
    await check({ rawBody: '{"a":1}', signatureHeader: sig.slice(0, 32) }),
    { ok: false, reason: "bad_signature" },
  );
  assert.deepEqual(
    await check({ rawBody: '{"a":1}', signatureHeader: "not-hex" }),
    { ok: false, reason: "bad_signature" },
  );
});

test("timestamp 301 s old or 301 s ahead is rejected; 300 s is accepted", async () => {
  const sig = ref('{"a":1}');
  const body = '{"a":1}';
  assert.deepEqual(
    await check({ rawBody: body, signatureHeader: sig, timestampHeader: String(NOW - 301) }),
    { ok: false, reason: "stale_timestamp" },
  );
  assert.deepEqual(
    await check({ rawBody: body, signatureHeader: sig, timestampHeader: String(NOW + 301) }),
    { ok: false, reason: "stale_timestamp" },
  );
  assert.equal(
    (await check({ rawBody: body, signatureHeader: sig, timestampHeader: String(NOW - 300) })).ok,
    true,
  );
});

test("missing or malformed headers and secret are rejected", async () => {
  const sig = ref('{"a":1}');
  const body = '{"a":1}';
  assert.deepEqual(await check({ rawBody: body, signatureHeader: null }), {
    ok: false,
    reason: "missing_signature",
  });
  assert.deepEqual(await check({ rawBody: body, signatureHeader: sig, timestampHeader: null }), {
    ok: false,
    reason: "missing_timestamp",
  });
  assert.deepEqual(await check({ rawBody: body, signatureHeader: sig, timestampHeader: "12.5" }), {
    ok: false,
    reason: "bad_timestamp",
  });
  assert.deepEqual(await check({ rawBody: body, signatureHeader: sig, timestampHeader: "abc" }), {
    ok: false,
    reason: "bad_timestamp",
  });
  assert.deepEqual(await check({ rawBody: body, signatureHeader: sig, secret: undefined }), {
    ok: false,
    reason: "missing_secret",
  });
  assert.deepEqual(await check({ rawBody: body, signatureHeader: sig, secret: "" }), {
    ok: false,
    reason: "missing_secret",
  });
});

test("invalid JSON, and JSON that is not an object, are rejected", async () => {
  for (const raw of ["not json", "[1,2]", "null", '"text"', "42", ""]) {
    const r = await check({ rawBody: raw, signatureHeader: ref(raw) });
    assert.deepEqual(r, { ok: false, reason: "invalid_json" }, `body: ${raw}`);
  }
});

test("whole-number floats are shortened: body 5.0 is signed as 5", async () => {
  const body = '{"score":5.0,"ratio":0.5,"big":1e3}';
  const canonical = '{"big":1000,"ratio":0.5,"score":5}';
  assert.equal(canonicalJson(JSON.parse(body)), canonical);
  assert.equal((await check({ rawBody: body, signatureHeader: ref(canonical) })).ok, true);
  // signing the un-shortened text must NOT match
  assert.equal(
    (await check({ rawBody: body, signatureHeader: ref('{"big":1e3,"ratio":0.5,"score":5.0}') })).ok,
    false,
  );
});

test("nested keys are sorted recursively; array order is kept", async () => {
  const body = '{"z":1,"a":{"y":[{"b":2,"a":1},3],"x":null},"m":[3,1,2]}';
  const canonical = '{"a":{"x":null,"y":[{"a":1,"b":2},3]},"m":[3,1,2],"z":1}';
  assert.equal((await check({ rawBody: body, signatureHeader: ref(canonical) })).ok, true);
  // array reordered in the signature must fail
  const wrong = '{"a":{"x":null,"y":[{"a":1,"b":2},3]},"m":[1,2,3],"z":1}';
  assert.equal((await check({ rawBody: body, signatureHeader: ref(wrong) })).ok, false);
});

test("Unicode is signed unescaped, even if the body arrived escaped", async () => {
  const canonical = '{"name":"Adéyẹmí 😀"}';
  const escapedBody = '{"name":"Ad\\u00e9y\\u1eb9m\\u00ed \\ud83d\\ude00"}';
  const rawBody = '{"name":"Adéyẹmí 😀"}';
  const sig = ref(canonical);
  assert.equal((await check({ rawBody, signatureHeader: sig })).ok, true);
  assert.equal((await check({ rawBody: escapedBody, signatureHeader: sig })).ok, true);
});

test("key order and whitespace in the raw body do not matter", async () => {
  const sig = ref('{"a":1,"b":2}');
  assert.equal((await check({ rawBody: '{ "b": 2,\n "a": 1 }', signatureHeader: sig })).ok, true);
});
