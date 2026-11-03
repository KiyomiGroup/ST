// Stage 7F tests for supabase/functions/process-withdrawal/index.ts: who counts as a wallet owner.
// Run from the repo root (Node 22.6+):
//   node --experimental-strip-types --test docs/local-tasker/tests/stage-7f/process-withdrawal-coordinator.test.ts
// No network, no Supabase, no Deno. The "database" is a FAKE that copies the contract of public.is_wallet_owner
// (true for a tasker or an ACTIVE coordinator, false for anyone else). It is NOT the real SQL. Developer / AI only.
import { test } from "node:test";
import assert from "node:assert/strict";

(globalThis as any).__ST_TEST__ = true;
const mod = await import("../../7f/process-withdrawal.index.ts");
const { handle, createState, walletOwnerLookup } = mod;

const SECRET = "sk_test_SUPERSECRETKEY123";
const ORIGIN = "https://streettasker.com";
const TASKER = "11111111-1111-4111-8111-111111111111";
const COORD = "22222222-2222-4222-8222-222222222222";       // active coordinator
const OFF = "33333333-3333-4333-8333-333333333333";         // coordinator switched off
const CUST = "44444444-4444-4444-8444-444444444444";        // customer
const NUM = "0123456789";

// a fake supabase client for walletOwnerLookup: records every call
function fakeClient(o: { rpc?: (name: string, args: any) => any; taskers?: Set<string>; noFrom?: boolean; fromError?: boolean } = {}) {
  const calls: any[] = [];
  const c: any = {
    calls,
    rpc: async (name: string, args: any) => { calls.push({ rpc: name, args }); return o.rpc ? o.rpc(name, args) : { data: null, error: null }; },
  };
  if (!o.noFrom) {
    c.from = (t: string) => {
      calls.push({ from: t });
      let uid: string | null = null;
      const chain: any = {
        select: () => chain, limit: () => chain,
        eq: (_c: string, v: string) => { uid = v; return chain; },
        then: (res: any, rej: any) => Promise.resolve(o.fromError ? { data: null, error: { message: "raw" } } : { data: (o.taskers?.has(uid!) ? [{ id: 1 }] : []), error: null }).then(res, rej),
      };
      return chain;
    };
  }
  return c;
}
// the contract of public.is_wallet_owner
const owners = (id: string) => id === TASKER || id === COORD;
const contractRpc = (name: string, a: any) => name === "is_wallet_owner" ? { data: owners(a.p_user), error: null } : { data: null, error: { code: "42883", message: "x" } };

// ---------- walletOwnerLookup ----------
test("a tasker and an ACTIVE coordinator are wallet owners; a switched-off coordinator, a customer and nobody are not", async () => {
  const c = fakeClient({ rpc: contractRpc });
  assert.equal(await walletOwnerLookup(c, TASKER), true);
  assert.equal(await walletOwnerLookup(c, COORD), true);
  assert.equal(await walletOwnerLookup(c, OFF), false);
  assert.equal(await walletOwnerLookup(c, CUST), false);
  assert.equal(await walletOwnerLookup(c, ""), false);
});
test("it asks the DATABASE helper by name with exactly one argument, and never reads the taskers table itself", async () => {
  const c = fakeClient({ rpc: contractRpc });
  await walletOwnerLookup(c, COORD);
  assert.deepEqual(c.calls, [{ rpc: "is_wallet_owner", args: { p_user: COORD } }]);
});
test("only the exact answer true lets anyone in (null, 'true', 1, an object and undefined are all refused)", async () => {
  for (const v of [null, undefined, "true", 1, "t", {}, [true], false]) {
    const c = fakeClient({ rpc: () => ({ data: v, error: null }) });
    assert.equal(await walletOwnerLookup(c, COORD), false, "answer " + JSON.stringify(v));
  }
});
test("any other database error is a generic failure: no raw text, and no fallback to the taskers table", async () => {
  for (const code of ["XX000", "PGRST301", "42501", "", undefined]) {
    const c = fakeClient({ rpc: () => ({ data: null, error: { code, message: "relation secret_table " + SECRET } }), taskers: new Set([COORD]) });
    await assert.rejects(() => walletOwnerLookup(c, COORD), (e: any) => e.message === "tasker_lookup_failed" && !String(e.message).includes(SECRET));
    assert.ok(!c.calls.some((x: any) => x.from), "must not fall back for code " + code);
  }
});
test("helper missing (42883 or PGRST202): fall back to the OLD taskers lookup so deploying early cannot lock real taskers out", async () => {
  for (const code of ["42883", "PGRST202"]) {
    const missing = () => ({ data: null, error: { code, message: "no function" } });
    const t = fakeClient({ rpc: missing, taskers: new Set([TASKER]) });
    assert.equal(await walletOwnerLookup(t, TASKER), true);                 // a tasker still works
    assert.deepEqual(t.calls.map((x: any) => x.from).filter(Boolean), ["taskers"]);
    const co = fakeClient({ rpc: missing, taskers: new Set([TASKER]) });
    assert.equal(await walletOwnerLookup(co, COORD), false);                // a coordinator is refused until the SQL is run
  }
});
test("fallback problems stay generic: a failing taskers read throws; no `from` at all throws", async () => {
  const missing = () => ({ data: null, error: { code: "42883", message: "no function" } });
  await assert.rejects(() => walletOwnerLookup(fakeClient({ rpc: missing, fromError: true }), TASKER), (e: any) => e.message === "tasker_lookup_failed");
  await assert.rejects(() => walletOwnerLookup(fakeClient({ rpc: missing, noFrom: true }), TASKER), (e: any) => e.message === "tasker_lookup_failed");
});

// ---------- through the real handler ----------
function makeDeps(client: any, who: string) {
  const f: any = { resolves: 0, adds: [] as any[] };
  const fetchFn = async (url: string) => {
    const u = new URL(url);
    if (u.pathname === "/bank") return { status: 200, json: async () => ({ status: true, data: [{ name: "Bank 101", code: "101", active: true, is_deleted: false, type: "nuban" }], meta: { next: null } }) };
    if (u.pathname === "/bank/resolve") { f.resolves++; return { status: 200, json: async () => ({ status: true, data: { account_number: NUM, account_name: " ADA  OBI ", bank_id: 9 } }) }; }
    return { status: 404, json: async () => ({}) };
  };
  const deps: any = {
    siteUrl: ORIGIN, paystackSecret: SECRET, fetchFn, now: () => 1_700_000_000_000,
    getUser: async (t: string) => (t === "good" ? { id: who } : null),
    isTasker: (id: string) => walletOwnerLookup(client, id),               // the same wiring the real deps use
    db: {
      rpc: async (name: string, args: any) => {
        if (name === "bank_account_add") {
          if (!owners(args.p_user)) return { data: null, error: { code: "WA001", message: "Only taskers can save bank accounts." } };
          f.adds.push(args);
          return { data: { id: "55555555-5555-4555-8555-555555555555", bank_name: args.p_bank_name, account_name: args.p_account_name, account_last4: args.p_account_number.slice(-4), is_default: true, already_saved: false }, error: null };
        }
        return { data: null, error: { code: "XX", message: "unexpected " + name } };
      },
      getTransferTarget: async () => null,
    },
    state: createState(),
  };
  return { deps, f };
}
async function run(deps: any, body: any) {
  const res = await handle(new Request("https://x/", { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, authorization: "Bearer good" }, body: JSON.stringify(body) }), deps);
  const text = await res.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
}
const ADD = { action: "account_add", bank_code: "101", account_number: NUM };
const RESOLVE = { action: "resolve", bank_code: "101", account_number: NUM };

test("an ACTIVE coordinator can look up a name and save a bank account (the resolved name is what is saved)", async () => {
  const { deps, f } = makeDeps(fakeClient({ rpc: contractRpc }), COORD);
  const r1 = await run(deps, RESOLVE); assert.equal(r1.status, 200);
  const r2 = await run(deps, ADD); assert.equal(r2.status, 200);
  assert.equal(r2.json.account_name, "ADA OBI"); assert.equal(r2.json.last4, "6789");
  assert.deepEqual(f.adds[0], { p_user: COORD, p_bank_code: "101", p_bank_name: "Bank 101", p_account_number: NUM, p_account_name: "ADA OBI" });
  assert.ok(!r2.text.includes(NUM));
});
test("a switched-off coordinator and a customer are refused (403 not_tasker) BEFORE any Paystack lookup is spent", async () => {
  for (const who of [OFF, CUST]) {
    const { deps, f } = makeDeps(fakeClient({ rpc: contractRpc }), who);
    for (const body of [RESOLVE, ADD]) {
      const r = await run(deps, body);
      assert.equal(r.status, 403); assert.equal(r.json.code, "not_tasker");
    }
    assert.equal(f.resolves, 0); assert.equal(f.adds.length, 0);
  }
});
test("a tasker still works exactly as before", async () => {
  const { deps, f } = makeDeps(fakeClient({ rpc: contractRpc }), TASKER);
  assert.equal((await run(deps, ADD)).status, 200); assert.equal(f.adds.length, 1);
});
test("if the ownership check itself fails, the user gets a generic error and no Paystack lookup is spent", async () => {
  const { deps, f } = makeDeps(fakeClient({ rpc: () => ({ data: null, error: { code: "XX000", message: "boom " + SECRET } }) }), COORD);
  const r = await run(deps, ADD);
  assert.ok(r.status >= 500 && !r.text.includes(SECRET) && !r.text.includes("boom"));
  assert.equal(f.resolves, 0);
});

// ---------- wiring (the tests above inject fakes; this checks the real wiring in the file itself) ----------
import { readFileSync } from "node:fs";
test("the real isTasker is wired to walletOwnerLookup, and the taskers table is read in exactly ONE place (the fallback)", () => {
  const src = readFileSync(new URL("../../7f/process-withdrawal.index.ts", import.meta.url), "utf8");
  const real = src.slice(src.indexOf("async isTasker(userId)"));
  assert.ok(/async isTasker\(userId\) \{\s*return await walletOwnerLookup\(client, userId\);\s*\}/.test(real), "real isTasker must call walletOwnerLookup(client, userId)");
  assert.equal((src.match(/from\("taskers"\)/g) || []).length, 1, "only the fallback may read taskers");
  assert.ok(src.indexOf('from("taskers")') < src.indexOf("async isTasker(userId)"), "that one read is inside walletOwnerLookup, not in the real deps");
});
