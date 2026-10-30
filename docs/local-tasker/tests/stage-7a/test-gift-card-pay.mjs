// Stage 7A: runs the REAL gift-card-pay source against an in-memory fake database and a stubbed Paystack. No network, no Supabase.
// Usage: node --experimental-transform-types test-gift-card-pay.mjs <repo-root>
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { pathToFileURL } from "node:url";
const root = process.argv[2] || "."; const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gcp7a-"));
const src = fs.readFileSync(path.join(root, "supabase/functions/gift-card-pay/index.ts"), "utf8").replace('"npm:@supabase/supabase-js@2"', '"./fake-supabase.mjs"');
fs.writeFileSync(path.join(dir, "gcp.ts"), src); fs.writeFileSync(path.join(dir, "fake-supabase.mjs"), "export const createClient = () => globalThis.__db;\n");

const USER = "11111111-1111-4111-8111-111111111111", TASKER = "22222222-2222-4222-8222-222222222222", BK = "33333333-3333-4333-8333-333333333333";
let rec, scn, handler;
function makeDb() {
  const res = (st) => {
    if (st.op === "select") {
      if (st.t === "bookings") return { data: { id: BK, customer_id: USER, tasker_id: scn.noTasker ? null : TASKER, task_id: null, service_id: null, amount: scn.price, payment_status: "unpaid" }, error: null };
      if (st.t === "gift_card_holds") return { data: scn.hold ?? null, error: null };
      return { data: null, error: null };
    }
    if (st.op === "insert" && st.t === "payments") return { data: { id: "pay1" }, error: null };
    return { data: null, error: null };
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    rpc: async (name, args) => {
      rec.push({ op: "rpc", t: name, payload: args });
      if (name === "platform_fee_rate_for_booking") return scn.rateErr ? { data: null, error: { message: "function does not exist" } } : { data: scn.rate, error: null };
      if (name === "gift_available") return { data: 5000, error: null };
      if (name === "gift_hold_create") return { data: { hold_id: "h1", amount: scn.holdAmount ?? scn.price }, error: null };
      return { data: null, error: null };
    },
    from(t) {
      const st = { t, op: "select", payload: null };
      const b = { select() { return b; }, eq() { return b; },
        insert(p) { st.op = "insert"; st.payload = p; rec.push(st); return b; }, update(p) { st.op = "update"; st.payload = p; rec.push(st); return b; },
        maybeSingle() { return Promise.resolve(res(st)); }, single() { return Promise.resolve(res(st)); }, then(f, r) { return Promise.resolve(res(st)).then(f, r); } };
      return b;
    },
  };
}
globalThis.__db = makeDb();
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "k", PAYSTACK_SECRET_KEY: "sk_test_x" })[k] }, serve: (h) => { handler = h; } };
await import(pathToFileURL(path.join(dir, "gcp.ts")).href);

async function call(body) {
  const r = await handler(new Request("http://x/", { method: "POST", headers: { authorization: "Bearer t", origin: "https://streettasker.com", "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: r.status, json: await r.json() };
}
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log("PASS: " + m); } else { fail++; console.log("FAIL: " + m); } };
const rows = (t, op) => rec.filter((x) => x.t === t && x.op === op).map((x) => x.payload);

// A. regular tasker, gift cards cover everything
scn = { price: 15000, rate: 0.12 }; rec = [];
let r = await call({ action: "pay", bookingId: BK });
let pay = rows("payments", "insert")[0], esc = rows("escrow_payments", "insert")[0], note = rows("notifications", "insert")[0];
ok(r.status === 200 && r.json.done === true, "regular: done");
ok(pay.platform_fee === 1800 && pay.tasker_amount === 13200 && pay.amount === 15000, "regular N15,000: payments row fee 1800, tasker 13200");
ok(esc.platform_fee === 1800 && esc.tasker_amount === 13200, "regular: escrow row fee 1800, tasker 13200");
ok(/after 12% fee/.test(note.message), "regular: notification still says 'after 12% fee'");
ok(rec.find((x) => x.t === "platform_fee_rate_for_booking").payload.p_booking === BK, "the BOOKING id is what is asked about (the database resolves the tasker)");

// B. Local Tasker
scn = { price: 15000, rate: 0 }; rec = [];
r = await call({ action: "pay", bookingId: BK });
pay = rows("payments", "insert")[0]; esc = rows("escrow_payments", "insert")[0]; note = rows("notifications", "insert")[0];
ok(r.status === 200 && r.json.done === true, "local: done");
ok(pay.platform_fee === 0 && pay.tasker_amount === 15000, "local N15,000: payments row fee 0, tasker nets 15000");
ok(esc.platform_fee === 0 && esc.tasker_amount === 15000 && esc.amount === 15000, "local: escrow row fee 0, tasker 15000 (customer charge unchanged: 15000)");
ok(!/12%/.test(note.message) && /no fee/.test(note.message), "local: notification does not mention 12%");
scn = { price: 18500, rate: 0 }; rec = []; await call({ action: "pay", bookingId: BK });
ok(rows("escrow_payments", "insert")[0].tasker_amount === 18500, "local N18,500: tasker nets 18500");
scn = { price: 18500, rate: 0.12 }; rec = []; await call({ action: "pay", bookingId: BK });
ok(rows("escrow_payments", "insert")[0].platform_fee === 2220 && rows("escrow_payments", "insert")[0].tasker_amount === 16280, "regular N18,500: fee 2220, tasker 16280");

// C. the rate cannot be read: nothing moves
for (const [label, s] of [["database error", { price: 15000, rateErr: true }], ["null answer", { price: 15000, rate: null }], ["nonsense answer", { price: 15000, rate: 1.5 }], ["negative answer", { price: 15000, rate: -0.1 }]]) {
  scn = s; rec = []; r = await call({ action: "pay", bookingId: BK });
  ok(r.status === 500 && r.json.code === "lookup_failed" && !rec.some((x) => x.t === "gift_hold_create") && !rows("escrow_payments", "insert").length && !rows("payments", "insert").length,
     "rate " + label + ": refused with 500, no hold reserved, nothing written");
}

// D. Paystack remainder path ("finish"): fee still comes from the database
globalThis.fetch = async () => ({ json: async () => ({ status: true, data: { status: "success", currency: "NGN", amount: 10000 * 100 } }) });
scn = { price: 15000, rate: 0, hold: { id: "h1", user_id: USER, status: "held", booking_id: BK, price: 15000, amount: 5000, reference: "GP-TEST" } }; rec = [];
r = await call({ action: "finish", holdId: "h1" });
ok(r.status === 200 && r.json.done === true && rows("escrow_payments", "insert")[0].platform_fee === 0 && rows("escrow_payments", "insert")[0].tasker_amount === 15000, "finish (cards N5,000 + Paystack N10,000), local: fee 0, tasker 15000");
scn.rate = 0.12; rec = []; r = await call({ action: "finish", holdId: "h1" });
ok(r.status === 200 && rows("escrow_payments", "insert")[0].platform_fee === 1800, "finish, regular: fee 1800");
scn.rateErr = true; rec = []; r = await call({ action: "finish", holdId: "h1" });
ok(r.status === 500 && r.json.code === "lookup_failed" && !rows("escrow_payments", "insert").length, "finish with an unreadable rate: stops BEFORE Paystack is checked or card money is taken");

// E. unchanged behaviour
scn = { price: 15000, rate: 0.12, noTasker: true }; rec = []; r = await call({ action: "quote", bookingId: BK });
ok(r.status === 200 && r.json.price === 15000 && r.json.giftAmount === 5000 && r.json.remainder === 10000, "quote action unchanged (price 15000, cards 5000, rest 10000)");

console.log(fail ? "RESULT: " + fail + " FAILED, " + pass + " passed" : "RESULT: ALL " + pass + " PASS"); process.exit(fail ? 1 : 0);
