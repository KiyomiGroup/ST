// >>> STAGE 7F VERSION. This is the W3c `process-withdrawal` (as supplied in ST-Withdrawals_W7a-final-changed-files) with ONE change:
// >>> the "may this person use the wallet" check now asks the database helper is_wallet_owner (tasker or ACTIVE coordinator).
// >>> Deploy THIS file instead of the W7a one at stage W7b, AFTER stage-7f-core.sql has been run. It does NOT replace the repo's old live file by itself.
// StreetTasker: Supabase Edge Function `process-withdrawal`  (stages W3a + W3b + W3c)
// ONE self-contained file: paste it into the Supabase dashboard (Edge Functions > process-withdrawal > Via Editor).
// NOT deployed until stage W7b.
//
// Actions (POST, JSON body {"action": ...}, header "Authorization: Bearer <the user's login token>"):
//   banks     -> { banks: [{ name, code }] }           the Paystack bank list (server side, cached about an hour)
//   resolve   -> { account_name, bank_name, bank_code } the name Paystack has on file for a bank + 10-digit number
//   withdraw  -> { status: "processing", reference, amount, fee, net_amount, ... }   body { action, amount, bank_account_id }
//                (debits the wallet in SQL, then asks Paystack to send amount minus fee; refunds at once if Paystack says no)
//   account_add     { bank_code, account_number } -> { id, bank_name, account_name, last4, is_default, already_saved }
//                   (the name is looked up again HERE and the resolved name is what gets saved)
//   account_remove  { id } -> { id, removed, already_removed, new_default_id }
//   account_default { id } -> { id, is_default: true, changed }
//
// Secrets (Supabase dashboard > Edge Functions > Secrets): PAYSTACK_SECRET_KEY (TEST key until W7b).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase. Optional: SITE_URL (default https://streettasker.com).
//
// Safety rules in this file: the secret key never leaves the server; account numbers are never logged and never
// returned; users only ever see the plain messages written below, never raw error text.

// ---------- types (erased at run time) ----------
type Bank = { name: string; code: string };
type Json = Record<string, unknown>;
export type Deps = {
  siteUrl: string;
  paystackSecret: string;
  fetchFn: (url: string, init?: any) => Promise<any>;
  now: () => number;                                              // milliseconds
  getUser: (token: string) => Promise<{ id: string } | null>;     // verifies the login token
  isTasker: (userId: string) => Promise<boolean>;                // true for a tasker or an ACTIVE coordinator (Stage 7F)
  db: Db;                                                         // service-role database access (W3b)
  state: State;
  timeoutMs?: number;                                             // tests only; default PAYSTACK_TIMEOUT_MS
};
export type DbResult = { data: any; error: { code?: string; message?: string } | null };
export type Db = {
  rpc: (name: string, args: Json) => Promise<DbResult>;           // the SQL functions of W2b / W2c / W2d
  // the destination snapshot of one withdrawal plus the saved account's recipient code; null when not found; throws on a read error
  getTransferTarget: (userId: string, reference: string, bankAccountId: string) =>
    Promise<{ account_number: string; account_name: string; bank_code: string; recipient_code: string | null } | null>;
};
export type State = {
  banks: { list: Bank[]; at: number } | null;
  banksInFlight: Promise<Bank[]> | null;
  resolveHits: Map<string, number[]>;                             // userId -> timestamps of recent lookups
  resolveCache: Map<string, { name: string; at: number }>;        // userId|bank|number -> name
  withdrawing: Set<string>;                                       // users with a withdrawal running right now (double-tap guard)
};

// ---------- settings ----------
const API = "https://api.paystack.co";
const BANKS_FRESH_MS = 60 * 60 * 1000;          // reuse the bank list for 1 hour
const BANKS_STALE_OK_MS = 24 * 60 * 60 * 1000;  // if Paystack is down, an older list is still fine for 24 hours
const BANKS_MAX_PAGES = 10;                     // 10 x 100 banks; Nigeria has a little over 100 (Paystack fact 21)
const PAYSTACK_TIMEOUT_MS = 10_000;
const RESOLVE_MAX_PER_WINDOW = 10;              // per user, per isolate (best effort: isolates restart)
const RESOLVE_WINDOW_MS = 10 * 60 * 1000;
const RESOLVE_CACHE_MS = 10 * 60 * 1000;        // a repeated lookup of the same account by the same user costs no Paystack call
const RESOLVE_CACHE_MAX = 500;
const MAX_BODY_BYTES = 4096;
const MAX_AMOUNT_NAIRA = 1_000_000_000;         // sanity cap before the database applies the real limits
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFERENCE_RE = /^wd-[0-9a-f]{32}$/;
const RECIPIENT_RE = /^[0-9A-Za-z_-]{1,64}$/;
const TRANSFER_CODE_RE = /^[0-9A-Za-z_-]{1,64}$/;

const BANK_CODE_RE = /^[0-9A-Za-z_-]{1,20}$/;   // same rule as the database column
const ACCOUNT_RE = /^[0-9]{10}$/;

export function createState(): State {
  return { banks: null, banksInFlight: null, resolveHits: new Map(), resolveCache: new Map(), withdrawing: new Set() };
}

// ---------- plain messages (the ONLY text a user can ever see) ----------
const MSG = {
  signin:     "Please sign in again.",
  method:     "That request is not allowed.",
  badBody:    "We could not read that request. Please try again.",
  unknown:    "That request is not available.",
  notTasker:  "Only taskers can save bank accounts.",
  bankPick:   "Choose a bank from the list.",
  acctDigits: "Enter a valid 10-digit account number.",
  notFound:   "We could not find that account. Check the bank and the account number and try again.",
  noName:     "We could not confirm the account name. Please check the details and try again.",
  busy:       "The bank lookup is not available right now. Please try again in a moment.",
  banksDown:  "We could not load the bank list. Please try again in a moment.",
  tooMany:    "You have checked too many accounts. Please wait a few minutes and try again.",
  pickAccount: "Choose one of your saved bank accounts.",
  badAmount:  "Enter a whole naira amount greater than zero.",
  inProgress: "You already have a withdrawal in progress. Please wait until it finishes.",
  startFail:  "We could not start your withdrawal. Please try again.",
  notSent:    "We could not send your withdrawal. Your money is back in your wallet.",
  refundLater: "We could not finish your withdrawal. Your money is safe and is being checked. Please do not try again for a few minutes.",
  processing: "Your withdrawal is being processed. We will tell you when it is done.",
  generic:    "Something went wrong. Please try again.",
};

// ---------- small helpers ----------
function allowedOrigin(req: Request, siteUrl: string): string {
  const origin = req.headers.get("origin") ?? "";
  const site = new URL(siteUrl).origin;
  const www = site.replace("://", "://www.");
  if (origin === site || origin === www) return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return site;
}
function cors(req: Request, deps: Deps): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(req, deps.siteUrl),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}
function reply(req: Request, deps: Deps, body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req, deps), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function fail(req: Request, deps: Deps, status: number, code: string, error: string): Response {
  return reply(req, deps, { error, code }, status);
}
// Server log lines: never an account number, never a key. Any run of 6 or more digits is masked.
function safeLog(what: string, detail?: unknown): void {
  let d = "";
  try { d = detail instanceof Error ? detail.message : typeof detail === "string" ? detail : detail === undefined ? "" : JSON.stringify(detail); } catch { d = ""; }
  d = d.replace(/[0-9]{6,}/g, "#").replace(/(sk|pk)_(test|live)_[A-Za-z0-9]+/g, "[key]").slice(0, 300);
  console.error("process-withdrawal:", what, d);
}
async function readJson(req: Request): Promise<Json | null> {
  try {
    const len = Number(req.headers.get("content-length") ?? "0");
    if (len > MAX_BODY_BYTES) return null;
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return null;
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
  } catch { return null; }
}
function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m ? m[1] : null;
}

// One call to Paystack with a time limit. Returns { status, json } and never throws for HTTP errors; throws only on
// network failure / timeout (the caller turns that into the plain "busy" message).
async function paystackGet(deps: Deps, path: string): Promise<{ status: number; json: any }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? PAYSTACK_TIMEOUT_MS);
  try {
    const res = await deps.fetchFn(API + path, {
      method: "GET",
      headers: { Authorization: `Bearer ${deps.paystackSecret}` },
      signal: ctl.signal,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

// POST with a JSON body, same time limit. Throws on network failure / timeout (the caller decides what that means).
async function paystackPost(deps: Deps, path: string, payload: Json): Promise<{ status: number; json: any }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? PAYSTACK_TIMEOUT_MS);
  try {
    const res = await deps.fetchFn(API + path, {
      method: "POST",
      headers: { Authorization: `Bearer ${deps.paystackSecret}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctl.signal,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- action: banks ----------
async function fetchAllBanks(deps: Deps): Promise<Bank[]> {
  const out = new Map<string, Bank>();
  let cursor = "";
  const seenCursors = new Set<string>();
  for (let page = 0; page < BANKS_MAX_PAGES; page++) {
    const qs = "country=nigeria&use_cursor=true&perPage=100" + (cursor ? "&next=" + encodeURIComponent(cursor) : "");
    const { status, json } = await paystackGet(deps, "/bank?" + qs);
    if (status !== 200 || !json || json.status !== true || !Array.isArray(json.data)) {
      throw new Error(`bank_list_failed:${status}`);
    }
    for (const b of json.data) {
      if (!b || b.active === false || b.is_deleted === true) continue;
      if (b.type !== undefined && b.type !== null && b.type !== "nuban") continue;
      const code = typeof b.code === "string" ? b.code.trim() : "";
      const name = typeof b.name === "string" ? b.name.trim() : "";
      if (!BANK_CODE_RE.test(code) || !name || name.length > 200) continue;
      if (!out.has(code)) out.set(code, { name, code });
    }
    const next = json.meta && typeof json.meta.next === "string" ? json.meta.next : "";
    if (!next || seenCursors.has(next)) break;
    seenCursors.add(next);
    cursor = next;
  }
  if (out.size === 0) throw new Error("bank_list_empty");
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
}

// Returns the bank list, from memory when fresh. If Paystack fails, an older list (up to 24 hours) is used; else throws.
async function getBanks(deps: Deps): Promise<Bank[]> {
  const st = deps.state, now = deps.now();
  if (st.banks && now - st.banks.at < BANKS_FRESH_MS) return st.banks.list;
  if (!st.banksInFlight) {
    st.banksInFlight = (async () => {
      try {
        const list = await fetchAllBanks(deps);
        st.banks = { list, at: deps.now() };
        return list;
      } finally {
        st.banksInFlight = null;
      }
    })();
  }
  try {
    return await st.banksInFlight;
  } catch (err) {
    if (st.banks && now - st.banks.at < BANKS_STALE_OK_MS) {
      safeLog("bank list refresh failed, using the older list", err as Error);
      return st.banks.list;
    }
    throw err;
  }
}

async function actionBanks(req: Request, deps: Deps): Promise<Response> {
  try {
    const banks = await getBanks(deps);
    return reply(req, deps, { banks });
  } catch (err) {
    safeLog("banks failed", err as Error);
    return fail(req, deps, 502, "banks_unavailable", MSG.banksDown);
  }
}

// ---------- action: resolve ----------
function takeResolveSlot(deps: Deps, userId: string): boolean {
  const now = deps.now();
  const hits = (deps.state.resolveHits.get(userId) ?? []).filter((t) => now - t < RESOLVE_WINDOW_MS);
  if (hits.length >= RESOLVE_MAX_PER_WINDOW) { deps.state.resolveHits.set(userId, hits); return false; }
  hits.push(now);
  deps.state.resolveHits.set(userId, hits);
  if (deps.state.resolveHits.size > 5000) {                 // keep memory bounded
    for (const [k, v] of deps.state.resolveHits) if (!v.some((t) => now - t < RESOLVE_WINDOW_MS)) deps.state.resolveHits.delete(k);
  }
  return true;
}

async function actionResolve(req: Request, deps: Deps, userId: string, body: Json): Promise<Response> {
  const bankCode = typeof body.bank_code === "string" ? body.bank_code.trim() : "";
  const number = typeof body.account_number === "string" ? body.account_number.trim() : "";
  const r = await lookupAccountName(req, deps, userId, bankCode, number);
  if (r instanceof Response) return r;
  return reply(req, deps, { account_name: r.name, bank_name: r.bank.name, bank_code: r.bank.code });
}

// The one place that asks Paystack for an account name (used by `resolve` and by `account_add`).
// Returns the name and the bank, or a ready-made error Response.
async function lookupAccountName(req: Request, deps: Deps, userId: string, bankCode: string, number: string): Promise<{ name: string; bank: Bank } | Response> {
  if (!BANK_CODE_RE.test(bankCode)) return fail(req, deps, 400, "bad_bank", MSG.bankPick);
  if (!ACCOUNT_RE.test(number)) return fail(req, deps, 400, "bad_account_number", MSG.acctDigits);

  // the bank code must be one we got from Paystack's own list
  let banks: Bank[];
  try { banks = await getBanks(deps); }
  catch (err) { safeLog("banks failed (during resolve)", err as Error); return fail(req, deps, 502, "banks_unavailable", MSG.banksDown); }
  const bank = banks.find((b) => b.code === bankCode);
  if (!bank) return fail(req, deps, 400, "bad_bank", MSG.bankPick);

  // the same user checking the same account again: answer from memory, no Paystack call, no allowance used
  const key = `${userId}|${bankCode}|${number}`;
  const cached = deps.state.resolveCache.get(key);
  if (cached && deps.now() - cached.at < RESOLVE_CACHE_MS) {
    return { name: cached.name, bank };
  }

  if (!takeResolveSlot(deps, userId)) return fail(req, deps, 429, "too_many", MSG.tooMany);

  let res: { status: number; json: any };
  try {
    res = await paystackGet(deps, `/bank/resolve?account_number=${encodeURIComponent(number)}&bank_code=${encodeURIComponent(bankCode)}`);
  } catch (err) {
    safeLog("resolve network failure", err as Error);
    return fail(req, deps, 502, "lookup_unavailable", MSG.busy);
  }
  const { status, json } = res;
  if (status === 200 && json && json.status === true && json.data) {
    const name = typeof json.data.account_name === "string" ? json.data.account_name.replace(/\s+/g, " ").trim() : "";
    if (!name || name.length > 200) return fail(req, deps, 422, "no_name", MSG.noName);
    if (deps.state.resolveCache.size >= RESOLVE_CACHE_MAX) deps.state.resolveCache.clear();
    deps.state.resolveCache.set(key, { name, at: deps.now() });
    return { name, bank };
  }
  // Paystack answers 422 (or 400/404) when the bank and number do not match an account: that is the user's mistake.
  if (status === 422 || status === 404 || status === 400) {
    // test-mode daily limit text, or any "limit" wording, is NOT the user's mistake (UNVERIFIED fact 23)
    const text = String(json?.message ?? "").toLowerCase();
    if (text.includes("limit") || text.includes("too many")) {
      safeLog("resolve limited by Paystack", { status });
      return fail(req, deps, 502, "lookup_unavailable", MSG.busy);
    }
    return fail(req, deps, 422, "account_not_found", MSG.notFound);
  }
  // 401 / 403 (wrong or missing key), 429, 5xx, anything else: our side or Paystack's. Log the status only.
  safeLog("resolve failed", { status });
  return fail(req, deps, 502, "lookup_unavailable", MSG.busy);
}

// ---------- action: withdraw ----------
// The database messages that are safe to show (W2b contract: WD001 to WD009 only; WD010 and anything else is generic).
const WD_MAP: Record<string, { http: number; code: string; fallback: string }> = {
  WD001: { http: 403, code: "not_tasker",          fallback: "Only taskers can withdraw money." },
  WD002: { http: 400, code: "bad_amount",          fallback: MSG.badAmount },
  WD003: { http: 400, code: "below_min",           fallback: "The amount is below the minimum withdrawal." },
  WD004: { http: 400, code: "above_max",           fallback: "The amount is above the most you can withdraw at once." },
  WD005: { http: 422, code: "daily_limit",         fallback: "This would go over the daily withdrawal limit. Please try again later." },
  WD006: { http: 422, code: "low_balance",         fallback: "Your available balance is not enough for this withdrawal." },
  WD007: { http: 409, code: "in_progress",         fallback: MSG.inProgress },
  WD008: { http: 422, code: "account_unavailable", fallback: "That bank account is not available. Choose another or add a bank account." },
  WD009: { http: 422, code: "account_cooldown",    fallback: "This bank account was added recently. For your safety you can withdraw to it a little later." },
};
function dbRefusal(err: { code?: string; message?: string }): { http: number; code: string; text: string } | null {
  const code = typeof err.code === "string" ? err.code : "";
  const m = WD_MAP[code];
  if (!m) return null;
  const msg = typeof err.message === "string" ? err.message.replace(/\s+/g, " ").trim() : "";
  // the text is written by our own SQL and never holds an account number; still refuse anything odd
  const text = msg && msg.length <= 300 && !/[0-9]{8,}/.test(msg) ? msg : m.fallback;
  return { http: m.http, code: m.code, text };
}

function parseAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isSafeInteger(v) && v > 0 && v <= MAX_AMOUNT_NAIRA ? v : null;
  if (typeof v === "string" && /^[0-9]{1,10}$/.test(v)) { const n = Number(v); return n > 0 && n <= MAX_AMOUNT_NAIRA ? n : null; }
  return null;
}
// reasons stored with a failed withdrawal: short, no long digit runs, no keys
function cleanReason(s: unknown): string {
  return String(s ?? "").replace(/\s+/g, " ").replace(/[0-9]{6,}/g, "#").replace(/(sk|pk)_(test|live)_[A-Za-z0-9]+/g, "[key]").trim().slice(0, 150);
}

// Each helper below answers true / false and never throws: a broken database call must not hide what Paystack said.
async function dbMarkProcessing(deps: Deps, reference: string, transferCode: string, recipientCode: string): Promise<boolean> {
  try {
    const { data, error } = await deps.db.rpc("withdrawal_mark_processing", {
      p_reference: reference, p_transfer_code: transferCode, p_recipient_code: recipientCode,
    });
    if (error || !data || data.ok !== true) { safeLog("mark_processing did not apply", { ref: reference, code: error?.code, reason: data?.reason }); return false; }
    return true;
  } catch (err) { safeLog("mark_processing threw", err as Error); return false; }
}
async function dbRefund(deps: Deps, reference: string, status: "failed" | "reversed", reason: string): Promise<boolean> {
  try {
    const { data, error } = await deps.db.rpc("withdrawal_fail", { p_reference: reference, p_status: status, p_reason: cleanReason(reason) });
    if (error || !data || data.ok !== true) { safeLog("REFUND DID NOT APPLY: check this withdrawal by hand", { ref: reference, code: error?.code, reason: data?.reason }); return false; }
    return true;
  } catch (err) { safeLog("REFUND THREW: check this withdrawal by hand", err as Error); return false; }
}

async function actionWithdraw(req: Request, deps: Deps, userId: string, body: Json): Promise<Response> {
  // 1. the request: exactly these three fields. No account number, no name, no user id, no transaction id.
  for (const k of Object.keys(body)) {
    if (k !== "action" && k !== "amount" && k !== "bank_account_id") return fail(req, deps, 400, "bad_request", MSG.badBody);
  }
  const amount = parseAmount(body.amount);
  if (amount === null) return fail(req, deps, 400, "bad_amount", MSG.badAmount);
  const accountId = typeof body.bank_account_id === "string" ? body.bank_account_id.trim().toLowerCase() : "";
  if (!UUID_RE.test(accountId)) return fail(req, deps, 400, "bad_account", MSG.pickAccount);

  // 2. one withdrawal at a time per person (double tap). The database enforces the same across copies of this function (WD007).
  if (deps.state.withdrawing.has(userId)) return fail(req, deps, 409, "in_progress", MSG.inProgress);
  deps.state.withdrawing.add(userId);
  try {
    // 3. debit the wallet and write the withdrawal, all inside SQL
    let created: any;
    try {
      const { data, error } = await deps.db.rpc("withdrawal_create", { p_user: userId, p_amount: amount, p_bank_account_id: accountId });
      if (error) {
        const known = dbRefusal(error);
        if (known) return fail(req, deps, known.http, known.code, known.text);
        safeLog("withdrawal_create failed", { code: error.code, message: error.message });
        return fail(req, deps, 500, "start_failed", MSG.startFail);
      }
      created = data;
    } catch (err) {
      // We do not know whether the database finished. If it did, a pending row exists and the stuck-withdrawal check (W5) settles it.
      safeLog("withdrawal_create threw", err as Error);
      return fail(req, deps, 502, "start_failed", MSG.startFail);
    }
    const reference = created && typeof created.reference === "string" ? created.reference : "";
    const net = Number(created?.net_amount);
    if (!REFERENCE_RE.test(reference) || !Number.isFinite(net) || net <= 0 || !Number.isInteger(Math.round(net * 100))) {
      safeLog("withdrawal_create gave an unexpected answer (money may be debited with no usable reference)", { hasRef: !!reference });
      return fail(req, deps, 500, "start_failed", MSG.startFail);
    }
    const kobo = Math.round(net * 100);
    const done = {
      status: "processing",
      reference,
      amount: Number(created.amount),
      fee: Number(created.fee),
      net_amount: net,
      bank_name: String(created.bank_name ?? ""),
      account_last4: String(created.account_last4 ?? ""),
      balance_after: Number(created.balance_after),
      message: MSG.processing,
    };

    // From here the money is debited. Every exit below is exactly one of:
    //   (a) Paystack never made a transfer  -> refund now (withdrawal_fail)
    //   (b) Paystack accepted                -> withdrawal_mark_processing
    //   (c) we do not know                   -> leave it (processing); the webhook / reconcile decides. NEVER refund on (c).
    const sentFail = async (status: "failed" | "reversed", reason: string, transferCode = "", recipientCode = ""): Promise<Response> => {
      if (transferCode) await dbMarkProcessing(deps, reference, transferCode, recipientCode);   // keep the code for the owner / webhook
      const ok = await dbRefund(deps, reference, status, reason);
      return ok ? fail(req, deps, 422, "not_sent", MSG.notSent) : fail(req, deps, 500, "refund_pending", MSG.refundLater);
    };

    // 4. where is the money going (read from our own tables, never from the request)
    let target: Awaited<ReturnType<Db["getTransferTarget"]>> = null;
    try { target = await deps.db.getTransferTarget(userId, reference, accountId); }
    catch (err) { safeLog("could not read the payout destination", err as Error); }
    if (!target || !/^[0-9]{10}$/.test(target.account_number) || !BANK_CODE_RE.test(target.bank_code) || !target.account_name) {
      return await sentFail("failed", "Could not read the saved bank account (nothing was sent to Paystack)");
    }

    // 5. the Paystack recipient: reuse the saved one, or create it once from the saved, verified name
    let recipient = typeof target.recipient_code === "string" ? target.recipient_code.trim() : "";
    if (recipient && !RECIPIENT_RE.test(recipient)) recipient = "";
    if (!recipient) {
      let r: { status: number; json: any };
      try {
        r = await paystackPost(deps, "/transferrecipient", {
          type: "nuban", name: target.account_name, account_number: target.account_number, bank_code: target.bank_code, currency: "NGN",
        });
      } catch (err) {
        // creating a recipient cannot move money, so a failure here is always safe to refund
        safeLog("recipient create network failure", err as Error);
        return await sentFail("failed", "Paystack did not answer when setting up the recipient (nothing was sent)");
      }
      const code = r.json && r.json.data && typeof r.json.data.recipient_code === "string" ? r.json.data.recipient_code.trim() : "";
      if (!((r.status === 200 || r.status === 201) && r.json && r.json.status === true && RECIPIENT_RE.test(code))) {
        safeLog("recipient create refused", { status: r.status, message: cleanReason(r.json?.message) });
        return await sentFail("failed", `Paystack would not create the recipient (HTTP ${r.status}): ${cleanReason(r.json?.message)}`);
      }
      recipient = code;
      try {
        // the database keeps the FIRST code it was given; use the one it returns (W2d contract)
        const { data, error } = await deps.db.rpc("bank_account_set_recipient", { p_user: userId, p_id: accountId, p_recipient_code: code });
        if (error) safeLog("could not store the recipient code", { code: error.code });
        else if (data && typeof data.recipient_code === "string" && RECIPIENT_RE.test(data.recipient_code)) recipient = data.recipient_code;
      } catch (err) { safeLog("could not store the recipient code", err as Error); }
    }

    // 6. the transfer itself. Paystack is sent amount MINUS the fee, in kobo, with OUR reference.
    let t: { status: number; json: any };
    try {
      t = await paystackPost(deps, "/transfer", { source: "balance", amount: kobo, recipient, reference, reason: "StreetTasker withdrawal" });
    } catch (err) {
      // timeout or network failure: the transfer may or may not exist. Do NOT refund. Mark it as attempted and let the webhook decide.
      safeLog("transfer call did not finish (left processing, NOT refunded)", err as Error);
      await dbMarkProcessing(deps, reference, "", recipient);
      return reply(req, deps, done);
    }
    const j = t.json;
    // 5xx, 408, 409, an unreadable body: unknown (Paystack may have made the transfer)
    if (t.status >= 500 || t.status === 408 || t.status === 409 || !j || typeof j !== "object") {
      safeLog("transfer answer unclear (left processing, NOT refunded)", { status: t.status });
      await dbMarkProcessing(deps, reference, "", recipient);
      return reply(req, deps, done);
    }
    // any other HTTP error, or status:false = Paystack refused: no transfer exists
    if (t.status >= 400 || j.status !== true) {
      safeLog("transfer refused by Paystack", { status: t.status, message: cleanReason(j.message) });
      return await sentFail("failed", `Paystack refused the transfer (HTTP ${t.status}): ${cleanReason(j.message)}`);
    }
    const tStatus = j.data && typeof j.data.status === "string" ? j.data.status.toLowerCase() : "";
    const tCode = j.data && typeof j.data.transfer_code === "string" && TRANSFER_CODE_RE.test(j.data.transfer_code) ? j.data.transfer_code : "";

    if (tStatus === "pending" || tStatus === "success") {
      await dbMarkProcessing(deps, reference, tCode, recipient);     // even if this fails the transfer is real: webhook / reconcile settle it
      return reply(req, deps, done);
    }
    if (tStatus === "otp") {
      safeLog("PAYSTACK TRANSFER OTP IS SWITCHED ON: turn off 'Confirm transfers before sending' in the Paystack dashboard. The money was refunded.");
      return await sentFail("failed", "Paystack asked for an OTP (transfer approval is switched on)", tCode, recipient);
    }
    if (["abandoned", "blocked", "rejected", "failed", "reversed"].includes(tStatus)) {
      return await sentFail(tStatus === "reversed" ? "reversed" : "failed", `Paystack returned status ${tStatus}`, tCode, recipient);
    }
    // received, or any status we do not know: unknown, never refund
    safeLog("transfer status not recognised (left processing, NOT refunded)", { status: tStatus.slice(0, 30) });
    await dbMarkProcessing(deps, reference, tCode, recipient);
    return reply(req, deps, done);
  } finally {
    deps.state.withdrawing.delete(userId);
  }
}

// ---------- actions: account_add / account_remove / account_default (CR-1) ----------
// Database refusals of the W2d functions: WA001 to WA007. Only the texts of WA001, WA003, WA004, WA005, WA006 are shown;
// WA002 and WA007 mean a bug in this file, so they become the generic message.
const WA_MAP: Record<string, { http: number; code: string; fallback: string }> = {
  WA001: { http: 403, code: "not_tasker",          fallback: MSG.notTasker },
  WA003: { http: 400, code: "bad_input",           fallback: MSG.noName },
  WA004: { http: 422, code: "max_accounts",        fallback: "You can save up to 3 bank accounts. Remove one before adding another." },
  WA005: { http: 422, code: "account_unavailable", fallback: "That bank account is not available." },
  WA006: { http: 409, code: "account_in_use",      fallback: "This bank account is being used for a withdrawal in progress. You can remove it when that withdrawal finishes." },
};
function accountRefusal(err: { code?: string; message?: string }): { http: number; code: string; text: string } | null {
  const m = WA_MAP[typeof err.code === "string" ? err.code : ""];
  if (!m) return null;
  const msg = typeof err.message === "string" ? err.message.replace(/\s+/g, " ").trim() : "";
  return { http: m.http, code: m.code, text: msg && msg.length <= 300 && !/[0-9]{8,}/.test(msg) ? msg : m.fallback };
}
// calls one of the W2d functions; answers { data } or a ready Response (never raw error text)
async function accountRpc(req: Request, deps: Deps, name: string, args: Json): Promise<{ data: any } | Response> {
  try {
    const { data, error } = await deps.db.rpc(name, args);
    if (error) {
      const known = accountRefusal(error);
      if (known) return fail(req, deps, known.http, known.code, known.text);
      safeLog(name + " failed", { code: error.code, message: error.message });
      return fail(req, deps, 500, "account_failed", MSG.generic);
    }
    if (!data || typeof data !== "object") { safeLog(name + " gave an unexpected answer"); return fail(req, deps, 500, "account_failed", MSG.generic); }
    return { data };
  } catch (err) {
    safeLog(name + " threw", err as Error);
    return fail(req, deps, 502, "account_failed", MSG.generic);
  }
}
function onlyKeys(body: Json, allowed: string[]): boolean {
  return Object.keys(body).every((k) => k === "action" || allowed.includes(k));
}

async function actionAccountAdd(req: Request, deps: Deps, userId: string, body: Json): Promise<Response> {
  if (!onlyKeys(body, ["bank_code", "account_number"])) return fail(req, deps, 400, "bad_request", MSG.badBody);   // never an account NAME from the browser
  // looking names up spends our Paystack allowance, so a non-wallet-owner is stopped first (the database checks again, WA001)
  if (!(await deps.isTasker(userId))) return fail(req, deps, 403, "not_tasker", MSG.notTasker);
  const bankCode = typeof body.bank_code === "string" ? body.bank_code.trim() : "";
  const number = typeof body.account_number === "string" ? body.account_number.trim() : "";
  // the name is looked up HERE; the browser's earlier answer is never trusted
  const looked = await lookupAccountName(req, deps, userId, bankCode, number);
  if (looked instanceof Response) return looked;
  const r = await accountRpc(req, deps, "bank_account_add", {
    p_user: userId, p_bank_code: looked.bank.code, p_bank_name: looked.bank.name, p_account_number: number, p_account_name: looked.name,
  });
  if (r instanceof Response) return r;
  const d = r.data;
  if (typeof d.id !== "string" || !UUID_RE.test(d.id)) { safeLog("bank_account_add gave no id"); return fail(req, deps, 500, "account_failed", MSG.generic); }
  return reply(req, deps, {
    id: d.id,
    bank_name: String(d.bank_name ?? looked.bank.name),
    account_name: String(d.account_name ?? looked.name),
    last4: String(d.account_last4 ?? number.slice(-4)),
    is_default: d.is_default === true,
    already_saved: d.already_saved === true,
  });
}

async function actionAccountById(req: Request, deps: Deps, userId: string, body: Json, rpcName: string): Promise<Response> {
  if (!onlyKeys(body, ["id"])) return fail(req, deps, 400, "bad_request", MSG.badBody);
  const id = typeof body.id === "string" ? body.id.trim().toLowerCase() : "";
  if (!UUID_RE.test(id)) return fail(req, deps, 400, "bad_account", MSG.pickAccount);
  const r = await accountRpc(req, deps, rpcName, { p_user: userId, p_id: id });
  if (r instanceof Response) return r;
  const d = r.data;
  if (rpcName === "bank_account_remove") {
    return reply(req, deps, {
      id,
      removed: d.removed === true,
      already_removed: d.already_removed === true,
      new_default_id: typeof d.new_default_id === "string" && UUID_RE.test(d.new_default_id) ? d.new_default_id : null,
    });
  }
  return reply(req, deps, { id, is_default: true, changed: d.changed === true });
}

// ---------- the request handler ----------
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req, deps) });
  if (req.method !== "POST") return fail(req, deps, 405, "method", MSG.method);

  try {
    // 1. who is asking (a valid login token is required for every action)
    const token = bearer(req);
    if (!token) return fail(req, deps, 401, "signin", MSG.signin);
    const user = await deps.getUser(token).catch(() => null);
    if (!user || !user.id) return fail(req, deps, 401, "signin", MSG.signin);

    // 2. what do they want
    const body = await readJson(req);
    if (!body) return fail(req, deps, 400, "bad_request", MSG.badBody);
    const action = typeof body.action === "string" ? body.action : "";

    if (action === "banks") return await actionBanks(req, deps);

    if (action === "resolve") {
      // looking up names is for wallet owners (a tasker or an active coordinator) saving a payout account only (CR-1 rule 4); it also protects our Paystack allowance
      if (!(await deps.isTasker(user.id))) return fail(req, deps, 403, "not_tasker", MSG.notTasker);
      return await actionResolve(req, deps, user.id, body);
    }

    if (action === "account_add") return await actionAccountAdd(req, deps, user.id, body);
    if (action === "account_remove") return await actionAccountById(req, deps, user.id, body, "bank_account_remove");
    if (action === "account_default") return await actionAccountById(req, deps, user.id, body, "bank_account_set_default");

    if (action === "withdraw") return await actionWithdraw(req, deps, user.id, body);   // the database checks the user is a tasker or an active coordinator (WD001)

    return fail(req, deps, 400, "unknown_action", MSG.unknown);
  } catch (err) {
    safeLog("unexpected error", err as Error);
    return fail(req, deps, 500, "server", MSG.generic);
  }
}

// ---------- who may use the wallet (Stage 7F) ----------
// A tasker OR an ACTIVE coordinator. The database function public.is_wallet_owner decides (it also protects a
// coordinator who has been switched off); this file never creates a taskers row.
// Fails closed: only the exact answer `true` lets anyone in; any error is a generic failure, never raw text.
// ONE exception, so that deploying this file before the 7F SQL cannot lock real taskers out: if the database says the
// helper does not exist yet (42883 or PostgREST PGRST202), fall back to the old taskers-only lookup. A coordinator
// is then simply refused until the SQL has been run.
type WalletClient = {
  rpc: (name: string, args: Json) => Promise<{ data: any; error: any }>;
  from?: (table: string) => any;
};
export async function walletOwnerLookup(client: WalletClient, userId: string): Promise<boolean> {
  const { data, error } = await client.rpc("is_wallet_owner", { p_user: userId });
  if (!error) return data === true;
  const code = error && typeof error.code === "string" ? error.code : "";
  if ((code === "42883" || code === "PGRST202") && typeof client.from === "function") {
    const r = await client.from("taskers").select("id").eq("user_id", userId).limit(1);
    if (r.error) throw new Error("tasker_lookup_failed");
    return Array.isArray(r.data) && r.data.length > 0;
  }
  throw new Error("tasker_lookup_failed");
}

// ---------- real wiring (only used on Supabase; tests pass their own deps) ----------
let _real: Deps | null = null;
async function realDeps(): Promise<Deps> {
  if (_real) return _real;
  const D = (globalThis as any).Deno;
  const url = D.env.get("SUPABASE_URL");
  const serviceKey = D.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const paystackSecret = D.env.get("PAYSTACK_SECRET_KEY");
  if (!url || !serviceKey || !paystackSecret) {
    throw new Error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or PAYSTACK_SECRET_KEY");
  }
  const { createClient } = await import("npm:@supabase/supabase-js@2");
  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  _real = {
    siteUrl: (D.env.get("SITE_URL") ?? "https://streettasker.com").replace(/\/+$/, ""),
    paystackSecret,
    fetchFn: (u, init) => fetch(u, init),
    now: () => Date.now(),
    async getUser(token) {
      const { data, error } = await client.auth.getUser(token);
      if (error || !data?.user) return null;
      return { id: data.user.id };
    },
    // Stage 7F: the name `isTasker` is kept so the W3 tests still fit, but it now means "tasker or active coordinator"
    async isTasker(userId) {
      return await walletOwnerLookup(client, userId);
    },
    db: {
      rpc: async (name, args) => {
        const { data, error } = await client.rpc(name, args);
        return { data, error: error ? { code: error.code, message: error.message } : null };
      },
      async getTransferTarget(userId, reference, bankAccountId) {
        const w = await client.from("withdrawals").select("account_number, account_name, bank_code")
          .eq("reference", reference).eq("user_id", userId).maybeSingle();
        if (w.error) throw new Error("withdrawal_lookup_failed");
        if (!w.data) return null;
        const a = await client.from("withdrawal_bank_accounts").select("recipient_code")
          .eq("id", bankAccountId).eq("user_id", userId).maybeSingle();
        if (a.error) throw new Error("account_lookup_failed");
        return {
          account_number: String(w.data.account_number ?? ""),
          account_name: String(w.data.account_name ?? ""),
          bank_code: String(w.data.bank_code ?? ""),
          recipient_code: a.data && typeof a.data.recipient_code === "string" ? a.data.recipient_code : null,
        };
      },
    },
    state: createState(),
  };
  return _real;
}

const _D = (globalThis as any).Deno;
if (_D && typeof _D.serve === "function" && !(globalThis as any).__ST_TEST__) {
  _D.serve(async (req: Request) => {
    try {
      return await handle(req, await realDeps());
    } catch (err) {
      // setup problem (for example a missing secret): log it, tell the user nothing technical
      safeLog("setup failed", err as Error);
      return new Response(JSON.stringify({ error: MSG.generic, code: "server" }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
      });
    }
  });
}
