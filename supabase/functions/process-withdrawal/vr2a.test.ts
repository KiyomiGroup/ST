// Run: node --experimental-strip-types --test pw.test.ts
import test from "node:test";
import assert from "node:assert/strict";
(globalThis as any).__ST_TEST__ = true;
const { handle, createState } = await import("./index.ts");
function mk(rpcImpl: (n: string, a: any) => any) {
  const calls: string[] = [];
  const deps: any = {
    siteUrl: "https://streettasker.com", paystackSecret: "sk_test_x", now: () => 1e12,
    fetchFn: async () => { throw new Error("no network in this test"); },
    getUser: async () => ({ id: "11111111-1111-4111-8111-111111111111" }), isTasker: async () => true,
    db: { rpc: async (n: string, a: any) => { calls.push(n); return rpcImpl(n, a); }, getTransferTarget: async () => null }, state: createState(),
  };
  return { deps, calls };
}
const post = (body: any) => new Request("https://f.example/pw", { method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" }, body: JSON.stringify(body) });
const W = { action: "withdraw", amount: 5000, bank_account_id: "22222222-2222-4222-8222-222222222222" };
const err = (code: string, message = "") => ({ data: null, error: { code, message } });

test("withdraw: VR001 -> 403 verification_required, SQL text shown, nothing else called", async () => {
  const { deps, calls } = mk((n) => err("VR001", "Verify your identity to withdraw. Your first withdrawal needs a quick ID check."));
  const r = await handle(post(W), deps); const j = await r.json();
  assert.equal(r.status, 403); assert.equal(j.code, "verification_required"); assert.match(j.error, /Verify your identity/);
  assert.deepEqual(calls, ["withdrawal_create"]);
});
test("withdraw: VR002 -> 422 name_mismatch", async () => {
  const { deps } = mk(() => err("VR002", "The name on this bank account does not match your verified name."));
  const r = await handle(post(W), deps); const j = await r.json();
  assert.equal(r.status, 422); assert.equal(j.code, "name_mismatch");
});
test("withdraw: WD011 clearing -> 422 still_clearing with the database text", async () => {
  const { deps } = mk(() => err("WD011", "Part of your balance is still clearing. More becomes available from Mon 01 Jan."));
  const r = await handle(post(W), deps); const j = await r.json();
  assert.equal(r.status, 422); assert.equal(j.code, "still_clearing"); assert.match(j.error, /still clearing/);
});
test("withdraw: unknown database error is still generic (no raw text)", async () => {
  const { deps } = mk(() => err("XX000", "secret internal detail 12345678901"));
  const r = await handle(post(W), deps); const j = await r.json();
  assert.equal(r.status, 500); assert.ok(!JSON.stringify(j).includes("secret"));
});
test("withdraw: existing WD006 still works", async () => {
  const { deps } = mk(() => err("WD006", "Your available balance is not enough for this withdrawal."));
  const j = await (await handle(post(W), deps)).json(); assert.equal(j.code, "low_balance");
});

// account_add: needs the bank list and a Paystack name lookup, so the fetch stub answers both
function addDeps(nameCheck: any) {
  const { deps, calls } = mk((n, a) => {
    if (n === "bank_account_add") return { data: { id: "33333333-3333-4333-8333-333333333333", bank_name: "GTB", account_name: "CHINEDU OKAFOR", account_last4: "6789", is_default: true, already_saved: false }, error: null };
    if (n === "idv_name_check") return nameCheck(a);
    throw new Error("unexpected " + n);
  });
  deps.fetchFn = async (url: string) => {
    if (url.includes("/bank?")) return { status: 200, json: async () => ({ status: true, data: [{ name: "GTB", code: "058", type: "nuban" }], meta: {} }) };
    if (url.includes("/bank/resolve")) return { status: 200, json: async () => ({ status: true, data: { account_name: "CHINEDU OKAFOR" } }) };
    throw new Error("unexpected " + url);
  };
  return { deps, calls };
}
const ADD = { action: "account_add", bank_code: "058", account_number: "0123456789" };
test("account_add: name_match true / false / null", async () => {
  for (const [res, want] of [[{ has_name: true, matches: true }, true], [{ has_name: true, matches: false }, false], [{ has_name: false, matches: false }, null]] as const) {
    const { deps, calls } = addDeps(() => ({ data: res, error: null }));
    const r = await handle(post(ADD), deps); const j = await r.json();
    assert.equal(r.status, 200); assert.equal(j.name_match, want);
    assert.ok(calls.includes("idv_name_check"));
  }
});
test("account_add: a failing name check never fails the save", async () => {
  const { deps } = addDeps(() => ({ data: null, error: { code: "42883", message: "function does not exist" } }));
  const r = await handle(post(ADD), deps); const j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.name_match, null); assert.equal(j.last4, "6789");
});
test("account_add: the name check is given the SAVED name, never a browser name", async () => {
  let seen: any = null;
  const { deps } = addDeps((a: any) => { seen = a; return { data: { has_name: true, matches: true }, error: null }; });
  await handle(post({ ...ADD }), deps);
  assert.deepEqual(seen, { p_user: "11111111-1111-4111-8111-111111111111", p_bank_name: "CHINEDU OKAFOR" });
  const bad = await handle(post({ ...ADD, account_name: "ANYONE" }), addDeps(() => ({ data: null, error: null })).deps);
  assert.equal(bad.status, 400);
});
