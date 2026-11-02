// Edge Function: local-payout-account  (Stage 7B)
// An ACTIVE coordinator registers or changes the verified payout destination of a Local Tasker they manage.
// This function only VERIFIES (bank list, account-name resolve, transfer recipient). It NEVER moves money.
//
// Secrets: PAYSTACK_SECRET_KEY (a sk_test_ key; a sk_live_ key is REFUSED unless PAYOUT_LIVE_APPROVED=yes),
//          SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (provided by the Edge runtime),
//          optional ALLOWED_ORIGINS (comma separated, extra origins for local testing).
// Deploy with "Verify JWT" ON. Keys never leave this function. The account number is never stored, never logged,
// never put in an audit row and never returned: after this call only the last four digits exist anywhere.
//
// POST JSON, Authorization: Bearer <coordinator access token>. { action: "banks" | "resolve" | "save", ... }
//   banks   {}                                                  -> { ok, banks: [{ name, code }] }
//   resolve { tasker_id, bank_code, account_number }            -> { ok, matched: true, account_name }  (name shown ONLY when it matches)
//                                                                  { ok, matched: false }                 (never reveals whose account it is)
//   save    { tasker_id, bank_code, account_number,
//             consent: { authorized: true, ownership: true, method: "in_person"|"phone"|"written", evidence_ref?, details? } }
//                                                               -> { ok, changed, bank_name, account_mask }
// Errors: { ok: false, error: <code>, message }
// Paystack endpoints used (from Paystack's public docs; the bank-list paging is UNVERIFIED against a live response):
//   GET /bank?country=nigeria&currency=NGN&use_cursor=true&perPage=100   GET /bank/resolve?account_number=&bank_code=
//   POST /transferrecipient { type: "nuban", name, account_number, bank_code, currency: "NGN" }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_ORIGINS = ["https://streettasker.com", "https://www.streettasker.com"];
const PAYSTACK = "https://api.paystack.co";
const METHODS = ["in_person", "phone", "written"];
const BANK_TTL_MS = 10 * 60 * 1000;

export interface Deps {
  paystackKey: string;
  liveApproved: boolean;
  extraOrigins: string[];
  /** verify the access token with Auth; returns the user id or null */
  userIdFromToken(token: string): Promise<string | null>;
  /** call a Postgres function with the service role */
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: any; error: { code?: string; message: string; hint?: string } | null }>;
  fetchImpl: typeof fetch;
  now(): number;
}

let bankCache: { at: number; banks: { name: string; code: string }[] } | null = null;
export function _resetCache() { bankCache = null; }

function cors(req: Request, deps: Deps) {
  const list = [...DEFAULT_ORIGINS, ...deps.extraOrigins];
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": list.includes(origin) ? origin : DEFAULT_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function reply(req: Request, deps: Deps, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req, deps), "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
const fail = (req: Request, deps: Deps, status: number, error: string, message: string) => reply(req, deps, status, { ok: false, error, message });

const HINT_STATUS: Record<string, number> = { not_found: 404, rate_limited: 429, name_mismatch: 422, consent_required: 400, bad_input: 400 };
function dbFail(req: Request, deps: Deps, e: { code?: string; message: string; hint?: string }) {
  const hint = e.hint ?? "";
  if (HINT_STATUS[hint]) return fail(req, deps, HINT_STATUS[hint], hint, e.message);
  console.error("[local-payout-account] database error", e.code); // never the message: it may echo input
  return fail(req, deps, 500, "server_error", "Something went wrong. Nothing was saved.");
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function paystack(deps: Deps, path: string, init?: RequestInit): Promise<{ http: number; json: any } | null> {
  try {
    const r = await deps.fetchImpl(PAYSTACK + path, {
      ...init, headers: { Authorization: `Bearer ${deps.paystackKey}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    let j: any = null; try { j = await r.json(); } catch { /* not json */ }
    return { http: r.status, json: j };
  } catch { return null; }
}

async function loadBanks(deps: Deps): Promise<{ name: string; code: string }[] | null> {
  if (bankCache && deps.now() - bankCache.at < BANK_TTL_MS) return bankCache.banks;
  const all: { name: string; code: string }[] = [];
  let next = "";
  for (let page = 0; page < 6; page++) {
    const r = await paystack(deps, `/bank?country=nigeria&currency=NGN&use_cursor=true&perPage=100${next ? "&next=" + encodeURIComponent(next) : ""}`);
    if (!r || r.http !== 200 || !r.json?.status || !Array.isArray(r.json.data)) return null;
    for (const b of r.json.data) if (b && b.active !== false && typeof b.name === "string" && /^[0-9]{3,6}$/.test(String(b.code ?? ""))) all.push({ name: b.name, code: String(b.code) });
    next = r.json.meta?.next ?? "";
    if (!next) break;
  }
  const seen = new Set<string>(); const banks = all.filter((b) => !seen.has(b.code) && seen.add(b.code)).sort((a, b) => a.name.localeCompare(b.name));
  if (!banks.length) return null;
  bankCache = { at: deps.now(), banks };
  return banks;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req, deps) });
  if (req.method !== "POST") return fail(req, deps, 405, "method_not_allowed", "Use POST.");

  // Safety rule O1: test mode only until the owner approves live payouts.
  if (!deps.paystackKey) return fail(req, deps, 500, "server_misconfigured", "Server is not configured.");
  if (deps.paystackKey.startsWith("sk_live_") && !deps.liveApproved) return fail(req, deps, 503, "live_not_approved", "Live payouts are not approved yet. Use a Paystack test key.");

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return fail(req, deps, 401, "unauthenticated", "Sign in first.");
  const uid = await deps.userIdFromToken(token);
  if (!uid) return fail(req, deps, 401, "unauthenticated", "Sign in first.");
  const ac = await deps.rpc("is_active_coordinator", { p_user: uid });
  if (ac.error) { console.error("[local-payout-account] coordinator check failed", ac.error.code); return fail(req, deps, 500, "server_error", "Could not check coordinator status."); }
  if (ac.data !== true) return fail(req, deps, 403, "not_active_coordinator", "Only an active coordinator can do this.");

  let raw = ""; try { raw = await req.text(); } catch { return fail(req, deps, 400, "bad_input", "Could not read the request."); }
  if (raw.length > 8_000) return fail(req, deps, 413, "too_large", "Request too large.");
  let body: any; try { body = JSON.parse(raw); } catch { return fail(req, deps, 400, "bad_input", "Body must be JSON."); }
  const action = str(body?.action, 12);

  if (action === "banks") {
    const banks = await loadBanks(deps);
    if (!banks) return fail(req, deps, 502, "paystack_unavailable", "Could not load the bank list. Try again in a moment.");
    return reply(req, deps, 200, { ok: true, banks });
  }
  if (action !== "resolve" && action !== "save") return fail(req, deps, 400, "bad_input", "Unknown action.");

  const taskerId = str(body?.tasker_id, 40).toLowerCase();
  const bankCode = str(body?.bank_code, 6);
  const acct = str(body?.account_number, 10);
  if (!UUID_RE.test(taskerId)) return fail(req, deps, 400, "bad_input", "Missing Local Tasker.");
  if (!/^[0-9]{3,6}$/.test(bankCode)) return fail(req, deps, 400, "bad_input", "Choose a bank.");
  if (!/^[0-9]{10}$/.test(acct)) return fail(req, deps, 400, "bad_input", "The account number must be exactly 10 digits.");

  let consent: any = null;
  if (action === "save") {
    consent = body?.consent ?? {};
    if (consent.authorized !== true || consent.ownership !== true) return fail(req, deps, 400, "consent_required", "Tick both confirmations first.");
    if (!METHODS.includes(consent.method)) return fail(req, deps, 400, "consent_required", "Choose how the Local Tasker agreed.");
  }

  // Authority + throttle, in the database. Every lookup counts, success or not.
  const begin = await deps.rpc("local_payout_begin", { p_coordinator: uid, p_tasker: taskerId, p_kind: action });
  if (begin.error) return dbFail(req, deps, begin.error);
  if (begin.data?.registered_name_ok !== true) return fail(req, deps, 422, "registered_name_incomplete", "Record the Local Tasker's full legal name (at least two names) on their profile first.");

  // The bank is asked HERE, every time. A name sent by the browser is never used.
  const banks = await loadBanks(deps);
  if (!banks) return fail(req, deps, 502, "paystack_unavailable", "Could not reach the bank list. Nothing was saved.");
  const bank = banks.find((b) => b.code === bankCode);
  if (!bank) return fail(req, deps, 400, "bad_input", "That bank is not on the list.");

  const res = await paystack(deps, `/bank/resolve?account_number=${acct}&bank_code=${bankCode}`);
  if (!res || res.http >= 500 || res.http === 401 || res.http === 403 || res.http === 429) {
    console.error("[local-payout-account] resolve unavailable, http", res?.http ?? "none");
    return fail(req, deps, 502, "paystack_unavailable", "The bank check is not available right now. Nothing was saved. Try again later.");
  }
  const resolved = String(res.json?.data?.account_name ?? "").trim();
  if (!res.json?.status || !resolved) return fail(req, deps, 422, "account_not_found", "We couldn't verify that account. Check the bank and the number.");

  const m = await deps.rpc("local_payout_check_name", { p_tasker: taskerId, p_resolved: resolved });
  if (m.error) return dbFail(req, deps, m.error);
  const matched = m.data === true;

  if (action === "resolve") {
    return matched ? reply(req, deps, 200, { ok: true, matched: true, account_name: resolved }) : reply(req, deps, 200, { ok: true, matched: false });
  }
  if (!matched) return fail(req, deps, 422, "name_mismatch", "The account name from the bank does not match the Local Tasker's registered name. Nothing was saved.");

  const rec = await paystack(deps, "/transferrecipient", {
    method: "POST", body: JSON.stringify({ type: "nuban", name: resolved, account_number: acct, bank_code: bankCode, currency: "NGN" }),
  });
  const code = String(rec?.json?.data?.recipient_code ?? "");
  if (!rec || rec.http >= 500 || !rec.json?.status || !/^RCP_[A-Za-z0-9]{6,40}$/.test(code)) {
    console.error("[local-payout-account] recipient failed, http", rec?.http ?? "none");
    return fail(req, deps, 502, "recipient_failed", "Could not register the account with the payment provider. Nothing was saved.");
  }
  const echoed = String(rec.json.data?.details?.account_number ?? "");
  if (echoed && echoed.replace(/\D/g, "").slice(-4) !== acct.slice(-4)) {
    console.error("[local-payout-account] recipient account mismatch");
    return fail(req, deps, 502, "recipient_failed", "The payment provider returned a different account. Nothing was saved.");
  }

  const saved = await deps.rpc("local_payout_save", {
    p_coordinator: uid, p_tasker: taskerId, p_bank_code: bankCode, p_bank_name: bank.name, p_last4: acct.slice(-4),
    p_resolved_name: resolved, p_recipient_code: code, p_consent_method: consent.method,
    p_consent_evidence: str(consent.evidence_ref, 500) || null, p_consent_details: str(consent.details, 1000) || null,
  });
  if (saved.error) return dbFail(req, deps, saved.error);
  return reply(req, deps, 200, { ok: true, changed: saved.data?.changed === true, bank_name: bank.name, account_mask: "******" + acct.slice(-4) });
}

// Runtime wiring (skipped when the file is imported by a test).
if (typeof (globalThis as any).Deno !== "undefined" && typeof (globalThis as any).Deno.serve === "function") {
  const D = (globalThis as any).Deno;
  const { createClient } = await import("npm:@supabase/supabase-js@2");
  const url = D.env.get("SUPABASE_URL"), key = D.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const deps: Deps = {
    paystackKey: D.env.get("PAYSTACK_SECRET_KEY") ?? "",
    liveApproved: D.env.get("PAYOUT_LIVE_APPROVED") === "yes",
    extraOrigins: (D.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s: string) => s.trim()).filter(Boolean),
    userIdFromToken: async (t) => { const { data, error } = await admin.auth.getUser(t); return error ? null : (data?.user?.id ?? null); },
    rpc: async (name, args) => { const { data, error } = await admin.rpc(name, args); return { data, error: error as any }; },
    fetchImpl: fetch, now: () => Date.now(),
  };
  D.serve((req: Request) => handle(req, deps));
}
