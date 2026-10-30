// Stage 7A: the "Provider receives" figure on customer-bookings.js. Loads only loadFeeRates() and payout() from the real file.
// Usage: node test-customer-bookings-fee.mjs <repo-root>
import fs from "node:fs"; import path from "node:path"; import vm from "node:vm";
const src = fs.readFileSync(path.join(process.argv[2] || ".", "js/customer-bookings.js"), "utf8");
const a = src.indexOf("async function loadFeeRates"), b = src.indexOf("/* ── Data");
if (a < 0 || b < 0 || b < a) { console.log("FAIL: could not find the functions"); process.exit(1); }
let rpcResult, rpcCalls;
const ctx = { FEE_RATE: 0.12, window: { ST: { payments: { calculateAmounts: (n) => ({ platformFee: Math.round(n * 0.12), taskerAmount: n - Math.round(n * 0.12) }) } },
  supabase: { rpc: async (n, args) => { rpcCalls.push([n, args]); if (rpcResult instanceof Error) throw rpcResult; return rpcResult; } } } };
vm.createContext(ctx); vm.runInContext(src.slice(a, b) + "\nthis.payout = payout; this.loadFeeRates = loadFeeRates;", ctx);
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "PASS: " : "FAIL: ") + m); };
const LT = "aaaaaaaa-0000-4000-8000-000000000001", RG = "aaaaaaaa-0000-4000-8000-000000000002";
ok(JSON.stringify(ctx.payout(15000)) === '{"fee":1800,"net":13200}', "no rate known (old behaviour): N15,000 -> fee 1800, provider receives 13200");
ok(JSON.stringify(ctx.payout(15000, 0.12)) === '{"fee":1800,"net":13200}', "regular provider (rate 0.12): provider receives 13200");
ok(JSON.stringify(ctx.payout(15000, 0)) === '{"fee":0,"net":15000}', "Local Tasker (rate 0): fee 0, provider receives 15000");
ok(JSON.stringify(ctx.payout(18500, 0)) === '{"fee":0,"net":18500}' && JSON.stringify(ctx.payout(18500, 0.12)) === '{"fee":2220,"net":16280}', "N18,500: Local 18500, regular 16280");
ok(JSON.stringify(ctx.payout(15000, NaN)) === '{"fee":1800,"net":13200}' && JSON.stringify(ctx.payout(15000, 1.5)) === '{"fee":1800,"net":13200}' && JSON.stringify(ctx.payout(15000, "0")) === '{"fee":1800,"net":13200}' && JSON.stringify(ctx.payout(15000, undefined)) === '{"fee":1800,"net":13200}',
   "a bad rate (NaN, 1.5, text, missing) falls back to the normal rate instead of showing a wrong figure");
rpcCalls = []; rpcResult = { data: [{ tasker_id: LT, fee_rate: 0 }, { tasker_id: RG, fee_rate: 0.12 }], error: null };
let m = await ctx.loadFeeRates([LT, RG]);
ok(m[LT] === 0 && m[RG] === 0.12 && rpcCalls[0][0] === "booking_fee_rates" && rpcCalls[0][1].p_tasker_ids.length === 2, "reads the rate per provider from booking_fee_rates");
rpcResult = { data: [{ tasker_id: LT, fee_rate: null }], error: null }; m = await ctx.loadFeeRates([LT]);
ok(!(LT in m), "a null rate is ignored (it must never turn into 0%)");
rpcResult = { data: null, error: { message: "function does not exist" } }; m = await ctx.loadFeeRates([LT]);
ok(Object.keys(m).length === 0, "function missing / error: empty map, page keeps working with the normal rate");
rpcResult = new Error("network"); m = await ctx.loadFeeRates([LT]);
ok(Object.keys(m).length === 0, "network failure: empty map, no exception");
rpcCalls = []; m = await ctx.loadFeeRates([]);
ok(Object.keys(m).length === 0 && rpcCalls.length === 0, "no providers: no call is made");
console.log(fail ? "RESULT: " + fail + " FAILED, " + pass + " passed" : "RESULT: ALL " + pass + " PASS"); process.exit(fail ? 1 : 0);
