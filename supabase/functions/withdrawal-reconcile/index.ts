// StreetTasker: Supabase Edge Function `withdrawal-reconcile`  (stage W5)
// ONE self-contained file: paste it into the Supabase dashboard (Edge Functions > withdrawal-reconcile > Via Editor).
// NOT deployed until stage W7b. JWT verification must be OFF for this function; the secret header is the protection.
//
// What it does: finds withdrawals still `pending` / `processing` after N minutes (default 15), asks Paystack
// GET /transfer/verify/:reference for each, and applies the real result with the same SQL functions the webhook uses
// (withdrawal_succeed / withdrawal_fail, both safe to repeat; a refund happens once).
//
// Call: POST with header "x-cron-secret: <the CRON_SECRET secret>". Optional JSON body: {"minutes": 15, "dry_run": false}.
//   dry_run:true looks and reports but changes nothing.
// Answer: { ok, checked, counts: {...}, results: [{reference, outcome}] }. Never an account number.
//
// Secrets: PAYSTACK_SECRET_KEY (TEST key until W7b), CRON_SECRET (existing). SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY are provided.
type Json = Record<string, any>;
export type Row = { reference: string; status: string; paystack_transfer_code: string | null; age_minutes?: number };
export type Deps = {
  cronSecret: string | undefined;
  paystackSecret: string;
  fetchFn: (url: string, init?: any) => Promise<Response>;
  db: {
    stuckList(minutes: number): Promise<Row[]>;
    succeed(reference: string, transferCode: string): Promise<any>;
    fail(reference: string, status: string, reason: string): Promise<any>;
  };
};

const API = "https://api.paystack.co";
const REF_RE = /^wd-[0-9a-f]{32}$/;
const DEFAULT_MINUTES = 15;
const MAX_PER_RUN = 50;
const NO_REASON = "Paystack did not give a reason";

// ---------- small helpers ----------
function reply(status: number, body: Json): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
// Compare two secrets without stopping at the first different character.
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
// Only a short, safe reason ever reaches the logs (never raw exception text: it could hold a key).
function safeReason(err: unknown): string {
  const m = err instanceof Error ? err.message : "";
  if (m.startsWith("db_error: ") || m.startsWith("paystack_verify_failed:") || m === "bad_answer") return m.slice(0, 200);
  return err instanceof Error ? err.name : "unknown";
}
function failureReason(d: any): string {
  for (const v of [d?.gateway_response, d?.failures]) {
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 300);
    if (v && typeof v === "object" && Object.keys(v).length > 0) {
      try { return JSON.stringify(v).slice(0, 300); } catch { /* fall through */ }
    }
  }
  return NO_REASON;
}

// GET /transfer/verify/:reference. Returns {kind:"found", data} | {kind:"not_found"} ; throws for anything unclear.
async function verifyTransfer(deps: Deps, reference: string): Promise<{ kind: "found"; data: Json } | { kind: "not_found" }> {
  const res = await deps.fetchFn(`${API}/transfer/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${deps.paystackSecret}` },
  });
  const json: any = await res.json().catch(() => null);
  if (res.ok && json?.status && json?.data) return { kind: "found", data: json.data };
  // Fact 20 (PAYSTACK-FACTS.md): the exact "not created" answer is UNVERIFIED, so ONLY an HTTP 404 or a message
  // saying "not found" counts as "Paystack never created this transfer". Anything else is "unknown".
  const msg = String(json?.message ?? "");
  if (res.status === 404 || /not\s*found/i.test(msg)) return { kind: "not_found" };
  throw new Error(`paystack_verify_failed:${res.status}`);
}

type Outcome =
  | "paid" | "failed_refunded" | "reversed_refunded" | "never_created_refunded"
  | "already_settled" | "still_pending" | "unknown_left" | "anomaly" | "would_pay" | "would_refund" | "error";

// Decide and apply for ONE row. Never throws.
async function reconcileOne(deps: Deps, row: Row, dryRun: boolean): Promise<Outcome> {
  const ref = row.reference;
  try {
    const v = await verifyTransfer(deps, ref);
    let call: (() => Promise<any>) | null = null;
    let outcome: Outcome;
    let dry: Outcome;

    if (v.kind === "not_found") {
      // Paystack has no such transfer. If we ALREADY hold Paystack's transfer code, Paystack did create it once:
      // a "not found" now is contradictory, so we do not refund; a person must look.
      if (row.paystack_transfer_code) {
        console.error("reconcile: ANOMALY, Paystack has no transfer but we hold its code, check by hand", ref);
        return "anomaly";
      }
      call = () => deps.db.fail(ref, "failed", "Paystack never created this transfer");
      outcome = "never_created_refunded"; dry = "would_refund";
    } else {
      const d = v.data;
      if (d.reference !== undefined && d.reference !== ref) {
        console.warn("reconcile: Paystack answered for a different transfer", ref);
        return "unknown_left";
      }
      const s = String(d.status ?? "").toLowerCase();
      if (s === "success") {
        call = () => deps.db.succeed(ref, String(d.transfer_code ?? row.paystack_transfer_code ?? ""));
        outcome = "paid"; dry = "would_pay";
      } else if (s === "failed") {
        call = () => deps.db.fail(ref, "failed", failureReason(d)); outcome = "failed_refunded"; dry = "would_refund";
      } else if (s === "reversed") {
        call = () => deps.db.fail(ref, "reversed", failureReason(d)); outcome = "reversed_refunded"; dry = "would_refund";
      } else if (s === "abandoned" || s === "blocked" || s === "rejected") {
        // Final "will never be paid" states (PAYSTACK-FACTS fact 12): refund as a failure.
        call = () => deps.db.fail(ref, "failed", `Paystack status: ${s}`); outcome = "failed_refunded"; dry = "would_refund";
      } else if (s === "pending") {
        return "still_pending";
      } else {
        // otp, received, empty or any unknown word: not final or not understood. Leave it, report it.
        console.warn("reconcile: leaving this one, Paystack status is", ref, s || "(empty)");
        return "unknown_left";
      }
    }
    if (dryRun) return dry;
    const r = await call!();
    if (r && r.refused === true) {
      console.error("reconcile: ANOMALY, the database refused this result, check Paystack by hand", ref);
      return "anomaly";
    }
    if (r && r.ok === true) return r.applied === false ? "already_settled" : outcome;
    if (r && r.ok === false && r.found === false) return "unknown_left";
    throw new Error("bad_answer");
  } catch (err) {
    console.error("reconcile: could not settle", ref, safeReason(err));
    return "error";
  }
}

// ---------- request handler ----------
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });
  // No CRON_SECRET configured means the door stays shut (never open by accident).
  if (!deps.cronSecret) {
    console.error("reconcile: CRON_SECRET is not set, refusing every call");
    return reply(500, { ok: false, error: "not configured" });
  }
  const sent = req.headers.get("x-cron-secret") ?? "";
  if (!sent || !sameSecret(sent, deps.cronSecret)) return reply(401, { ok: false, error: "unauthorized" });

  let body: Json = {};
  const raw = await req.text();
  if (raw.trim()) {
    try { body = JSON.parse(raw); } catch { return reply(400, { ok: false, error: "bad json" }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply(400, { ok: false, error: "bad body" });
  }
  const allowed = new Set(["minutes", "dry_run"]);
  if (Object.keys(body).some((k) => !allowed.has(k))) return reply(400, { ok: false, error: "unknown field" });
  let minutes = DEFAULT_MINUTES;
  if (body.minutes !== undefined) {
    if (typeof body.minutes !== "number" || !Number.isInteger(body.minutes) || body.minutes < 5 || body.minutes > 1440) {
      return reply(400, { ok: false, error: "minutes must be a whole number from 5 to 1440" });
    }
    minutes = body.minutes;
  }
  if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") return reply(400, { ok: false, error: "dry_run must be true or false" });
  const dryRun = body.dry_run === true;

  let rows: Row[];
  try {
    rows = await deps.db.stuckList(minutes);
  } catch (err) {
    console.error("reconcile: could not list stuck withdrawals", safeReason(err));
    return reply(500, { ok: false, error: "could not list" });
  }
  const todo = rows.filter((r) => r && REF_RE.test(String(r.reference))).slice(0, MAX_PER_RUN);

  const results: { reference: string; outcome: Outcome }[] = [];
  const counts: Record<string, number> = {};
  for (const row of todo) {
    const outcome = await reconcileOne(deps, row, dryRun);
    results.push({ reference: row.reference, outcome });
    counts[outcome] = (counts[outcome] ?? 0) + 1;
  }
  const more = rows.length > todo.length;
  return reply(200, { ok: true, dry_run: dryRun, minutes, checked: todo.length, more_waiting: more, counts, results });
}

// ---------- real dependencies ----------
async function realDeps(): Promise<Deps> {
  const D = (globalThis as any).Deno;
  const url = D.env.get("SUPABASE_URL"), key = D.env.get("SUPABASE_SERVICE_ROLE_KEY"), ps = D.env.get("PAYSTACK_SECRET_KEY");
  if (!url || !key || !ps) throw new Error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or PAYSTACK_SECRET_KEY");
  const { createClient } = await import("npm:@supabase/supabase-js@2");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const dbErr = (e: { message?: string }) => new Error("db_error: " + String(e.message ?? "").slice(0, 200));
  return {
    cronSecret: D.env.get("CRON_SECRET") || undefined,
    paystackSecret: ps,
    fetchFn: fetch,
    db: {
      async stuckList(minutes) {
        const { data, error } = await client.rpc("withdrawal_stuck_list", { p_minutes: minutes });
        if (error) throw dbErr(error);
        return (data ?? []) as Row[];
      },
      async succeed(reference, transferCode) {
        const { data, error } = await client.rpc("withdrawal_succeed", { p_reference: reference, p_transfer_code: transferCode });
        if (error) throw dbErr(error);
        return data;
      },
      async fail(reference, status, reason) {
        const { data, error } = await client.rpc("withdrawal_fail", { p_reference: reference, p_status: status, p_reason: reason });
        if (error) throw dbErr(error);
        return data;
      },
    },
  };
}

const _D = (globalThis as any).Deno;
if (_D && typeof _D.serve === "function" && !(globalThis as any).__ST_TEST__) {
  _D.serve(async (req: Request) => {
    try {
      return await handle(req, await realDeps());
    } catch (err) {
      console.error("reconcile: setup failed", safeReason(err));
      return reply(500, { ok: false, error: "not configured" });
    }
  });
}
export { realDeps };
