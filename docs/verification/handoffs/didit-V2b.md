# Didit stage V2b: webhook Edge Function

## Done
`didit-webhook` receives Didit's status events and hands them to `idv_apply_event` (the only place a status changes). No Didit account, key, Deno or real Supabase was used; everything is tested on Node with a stubbed `fetch`.

Rules as built:
- POST only (405). Missing configuration (`DIDIT_WEBHOOK_SECRET`, `DIDIT_API_KEY`, `DIDIT_ENV` = sandbox or live, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) -> 500, nothing called. Body over 1 MB -> 413.
- Signature checked with the V2a module: bad, missing or stale (over 300 s) -> **401**; signed but not JSON -> 400 (Didit never retries 4xx).
- Only `webhook_type = status.updated` is applied. `data.updated` and every other type are acknowledged (200) and ignored (decision of this stage; V2d sync covers data).
- `environment` must equal `DIDIT_ENV`, otherwise 200 and nothing is stored or called.
- Idempotency key = Didit `event_id` (fallback `session_id|status|webhook_type`); the SQL ledger dedupes. The user is found by the Didit session id only; `vendor_data` and `metadata` are never sent to SQL.
- **Approved**: the decision is re-fetched (`GET /v3/session/{id}/decision/`, `x-api-key`, 3 s timeout) BEFORE the database call. `decision.ts` reduces it to booleans only (liveness, face match, document, Nigerian document, worst NIN result); a missing or odd field means "not ok", so it can only lead to review. No scores, images or personal data are sent on or logged. A failed fetch -> **500** and the database is not called.
- `idv_apply_event` is called through PostgREST with the service role key (server only). HTTP failure or network failure -> **500** (Didit retries). SQL answering `retry: true` (unknown session, decision not fetched) -> **500**. Outcomes duplicate / stale / ignored_* / rejected -> 200.
- Logging: only short reason lines (status codes, reason names). Tested: no secret, API key, service key, session token, session id, event id or user id ever appears in a log.

## Files
`supabase/functions/didit-webhook/index.ts` (Deno.serve wiring only), `handler.ts` (logic, injected dependencies), `decision.ts` (decision to booleans), `handler.test.ts`.

## Exit check (Node v22, `node --experimental-strip-types --test handler.test.ts`)
- **29 passed, 0 failed**: methods, each missing setting, bad / missing / tampered / stale signature, non-JSON, ignored event types, missing fields, wrong environment (3 cases), arguments sent to SQL, vendor_data not forwarded, Approved fetch order and headers, no scores or media forwarded, failed-liveness and partial-NIN flags, three decision-fetch failures, duplicate and stale outcomes, three database failures, both SQL retry reasons, event_id fallback, created_at conversions, no-secret logging, oversize body, and 7 decision-extraction cases.
- Mutation check: 9 deliberate breakages (environment check, decision fetch skipped, decision failure ignored, retry answered 200, database failure answered 200, other types applied, secret logged, bad signature still processed) were each caught.
- V2a signature tests still 12/12. SQL tests untouched (no SQL changed).
- **Not run on Deno, not deployed, never sent a real Didit webhook, never called the real PostgREST.**

## Open issues / UNVERIFIED
- `created_at` format from Didit (ISO or unix seconds) is handled both ways but unconfirmed; a bad value becomes "now" in SQL.
- Decision field names (`issuing_state`, `match_type`, `status` per node) follow `DIDIT-API-FACTS.md` and are unconfirmed; the first sandbox Approved event is the real test. If a name is wrong, the person goes to REVIEW (safe), not VERIFIED.
- `document_ok` is stored but `idv_decide_approved` does not use it (D-V3 as built).
- The function imports `../_shared/didit-signature.ts`. Whether the Supabase DASHBOARD editor accepts that shared import is unconfirmed; V2e (deploy runbook) must settle it (owner uses dashboard deploys only).
- A webhook arriving before `idv_attach_session` stores the session gets 500 and Didit retries twice (about 1 and 4 minutes); V2d sync is the backstop.
- Deploy with Verify JWT OFF (the signature is the authentication). Owner does NOT deploy yet: secrets and runbook come in V2e.

## Next
Default: V2c (create session; uses `idv_start_attempt` / `idv_attach_session` from `didit-V1c2.md`). Needs nothing from the owner. Owner, when ready: run the SQL files in README order (still pending). Nothing to change or delete on GitHub or Supabase for this stage.
