// Run: node --experimental-strip-types --test tests/coordinator-apply.test.mjs  (from the repo root; Deno is not needed, fetch is stubbed)
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const env = { RESEND_API_KEY: "rk", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "sk" };
let handler;
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
await import(pathToFileURL(path.resolve("supabase/functions/coordinator-apply/index.ts")).href);

const good = () => ({
  full_name: "Ada Obi", email: "Ada@Example.com", phone: "0801 234 5678", whatsapp: "", age_range: "25 to 34", occupation: "Trader",
  state: "Lagos", city: "Ikeja", areas: "Computer Village", years_in_area: "4 to 10 years", trades: ["Tailoring and fashion"],
  tasker_count: 20, area_sqm: 50000, how_you_know: "Market association", can_meet_taskers: true, can_explain: true,
  explain_text: "A skilled person without a smartphone", experience: "Sold", hours: "5 to 10 hours", languages: "English",
  smartphone: "Yes", has_id: "Yes", why: "To help", consent: true,
});
function run(body, { dup = false, storeStatus = 201, resendOk = true } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/rest/v1/coordinator_applications") && (!init.method || init.method === "GET"))
      return new Response(JSON.stringify(dup ? [{ id: "old" }] : []), { status: 200 });
    if (String(url).includes("/rest/v1/coordinator_applications"))
      return storeStatus === 201 ? new Response(JSON.stringify([{ id: "11111111-2222-3333-4444-555555555555" }]), { status: 201 }) : new Response("boom", { status: storeStatus });
    if (String(url).includes("resend")) return new Response("{}", { status: resendOk ? 200 : 500 });
    throw new Error("unexpected " + url);
  };
  const req = new Request("https://x/functions/v1/coordinator-apply", { method: "POST", headers: { origin: "https://streettasker.com" }, body: JSON.stringify(body) });
  return handler(req).then(async (r) => ({ status: r.status, out: await r.json(), calls }));
}
const inserts = (c) => c.filter((x) => x.init.method === "POST" && x.url.includes("/rest/v1/"));
const mails = (c) => c.filter((x) => x.url.includes("resend"));

test("stores the application with the S2 columns and emails the admin with the approve SQL", async () => {
  const { status, out, calls } = await run(good());
  assert.equal(status, 200); assert.equal(out.ok, true);
  const row = JSON.parse(inserts(calls)[0].init.body);
  assert.equal(row.email, "ada@example.com"); assert.equal(row.tasker_count, 20); assert.equal(row.area_sqm, 50000);
  assert.equal(row.can_meet_taskers, true); assert.equal(row.can_explain, true); assert.equal(row.explain_text, "A skilled person without a smartphone");
  assert.equal(row.whatsapp, null); assert.equal(row.answers.occupation, "Trader"); assert.deepEqual(row.answers.trades, ["Tailoring and fashion"]); assert.equal(row.answers.consent, true);
  assert.equal(inserts(calls)[0].init.headers.Authorization, "Bearer sk");
  const m = JSON.parse(mails(calls)[0].init.body);
  assert.match(m.text, /select admin_approve_coordinator_application\('11111111-2222-3333-4444-555555555555'\);/);
  assert.match(m.html, /admin_reject_coordinator_application/); assert.match(m.text, /Area they would cover \(square metres\): 50000/);
  assert.equal(m.reply_to, "ada@example.com");
});
test("accepts numbers sent as digit strings", async () => {
  const b = good(); b.tasker_count = "12"; b.area_sqm = "800";
  const { status, calls } = await run(b); assert.equal(status, 200);
  assert.equal(JSON.parse(inserts(calls)[0].init.body).tasker_count, 12);
});
test("a waiting application with the same email is not stored or emailed again", async () => {
  const { status, out, calls } = await run(good(), { dup: true });
  assert.equal(status, 200); assert.equal(out.duplicate, true); assert.equal(inserts(calls).length, 0); assert.equal(mails(calls).length, 0);
});
for (const [name, mut, code] of [
  ["tasker_count 0", (b) => { b.tasker_count = 0; }, "bad_tasker_count"],
  ["tasker_count text", (b) => { b.tasker_count = "1 to 5"; }, "bad_tasker_count"],
  ["tasker_count decimal", (b) => { b.tasker_count = 2.5; }, "bad_tasker_count"],
  ["area negative", (b) => { b.area_sqm = -5; }, "bad_area"],
  ["area too big", (b) => { b.area_sqm = 100000001; }, "bad_area"],
  ["can_meet missing", (b) => { delete b.can_meet_taskers; }, "missing_field"],
  ["can_explain as text", (b) => { b.can_explain = "Yes"; }, "missing_field"],
  ["explain text empty when can_explain", (b) => { b.explain_text = "  "; }, "missing_field"],
  ["under 18", (b) => { b.age_range = "Under 18"; }, "underage"],
  ["bad email", (b) => { b.email = "nope"; }, "bad_email"],
  ["no consent", (b) => { b.consent = false; }, "consent_required"],
  ["no trades", (b) => { b.trades = []; }, "missing_field"],
]) test("rejects: " + name, async () => {
  const b = good(); mut(b); const { status, out, calls } = await run(b);
  assert.equal(status, 400); assert.equal(out.error, code); assert.equal(inserts(calls).length, 0); assert.equal(mails(calls).length, 0);
});
test("explanation is optional when can_explain is false", async () => {
  const b = good(); b.can_explain = false; b.explain_text = ""; const { status, calls } = await run(b);
  assert.equal(status, 200); assert.equal(JSON.parse(inserts(calls)[0].init.body).explain_text, null);
});
test("store failure: error to the applicant, no email", async () => {
  const { status, out, calls } = await run(good(), { storeStatus: 500 });
  assert.equal(status, 500); assert.equal(out.error, "store_failed"); assert.equal(mails(calls).length, 0);
});
test("email failure after storing still succeeds", async () => {
  const { status, out } = await run(good(), { resendOk: false }); assert.equal(status, 200); assert.equal(out.ok, true);
});
test("html in answers is escaped in the email", async () => {
  const b = good(); b.why = "<script>alert(1)</script>"; const { calls } = await run(b);
  const m = JSON.parse(mails(calls)[0].init.body); assert.ok(!m.html.includes("<script>")); assert.ok(m.html.includes("&lt;script&gt;"));
});
