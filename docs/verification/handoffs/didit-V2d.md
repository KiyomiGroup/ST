# Didit stage V2d: sync Edge Function

## Done
`didit-sync` answers "what is my status?": it reads the Didit session decision and applies it through `idv_apply_event` (the same single place the webhook uses). Covers a delayed or lost webhook and the return from Didit's callback. Tested on Node with stubbed fetch only; no Didit account, key, Deno or real Supabase was used. No SQL changed.

Flow as built (`handler.ts`, wired by `index.ts`; deploy with Verify JWT ON):
1. POST `{mode: "self"|"proxy", local_tasker_user_id? (proxy only), returned?: boolean}` with the user's access token. Caller id comes from the token. Any other body field (user id, session id, status) is ignored.
2. **Permission is decided by existing SQL running as the signed-in user** (user token + anon key through PostgREST): self -> `idv_my_status()`, proxy -> `idv_local_status(tasker)`. A user reaches only their own row; a coordinator only an assigned Local Tasker. Refusals: not_signed_in 401, not_active_coordinator / not_assigned 403, bad_input 400, anything else generic 500. Didit is not called after a refusal.
3. If there is no open attempt, no Didit session yet, or the attempt is closed (VERIFIED, FAILED, EXPIRED, ABANDONED): answer from our own data, Didit not called.
4. Otherwise the session id is read from `identity_verifications` with the service key (newest row, this environment). The browser never supplies a session id.
5. `GET /v3/session/{id}/decision/` with `x-api-key` (8 s timeout). Status = `status` (or `decision.status`). Missing or odd reply, any Didit error or timeout -> 502 "try again in a few minutes" (no mention of keys).
6. `idv_apply_event` with a fresh event id per sync (`sync|<uuid>`), `webhook_type = sync`, event time = the moment BEFORE the Didit read (so a webhook that happens later still wins). On `Approved` the decision flags come from `decision.ts` (reused from `didit-webhook`), exactly as the webhook does. SQL `retry` or any database failure -> 500.
7. If the attempt is already PENDING and Didit still says Not Started / In Progress / Awaiting User, nothing is applied (a refresh must not move PENDING back).
8. `returned: true` and the result is still NOT_STARTED or IN_PROGRESS -> `idv_mark_pending` (server decides; failure is logged and not fatal).
9. Response: `{ok, status, verified, needs_review, changed}` only. No scores, ids, session or Didit data. Nothing secret is logged (tested on 10 paths).

## Files
`supabase/functions/didit-sync/index.ts`, `handler.ts`, `handler.test.ts`. Imports `../didit-webhook/decision.ts`.

## Exit check (Node v22: `node --experimental-strip-types --test handler.test.ts`)
- **26 passed, 0 failed.** Covers CORS, methods, each missing setting (incl. anon key), bad or missing token, bad input (10 cases), self and proxy permission calls (user token, anon key, body ids ignored), 4 SQL refusals plus unknown errors, no-open / no-session / closed shortcuts, attempt read failures, exact Didit request and no user token to Didit, Approved flags, failed liveness flag, nested status, unique event ids, 11 Didit failure shapes, database and retry failures, PENDING rules (returned true/false, VERIFIED, In Review, already PENDING), stale/duplicate answers, and no secret in logs.
- Mutation check: 12 deliberate breakages (subject from body, permission check skipped, open-attempt shortcut removed, user token sent to Didit, Didit failure ignored, decision always "fetched", PENDING skip removed, mark-pending always, retry answered 200, session id logged, fixed event id, closed attempt synced) were each caught.
- V2a (12), V2b (29), V2c (22) still pass.
- **Not run on Deno, not deployed, never called the real Didit or your Supabase.**

## Open issues / UNVERIFIED
- **The decision endpoint returning a session `status`** (top level or under `decision`) is NOT confirmed in `DIDIT-API-FACTS.md`. If it does not, every sync returns 502 until the first sandbox run shows the real shape (then switch to `GET /v3/session/{id}/` or similar). Safe failure: nothing changes.
- Needs the Edge runtime secret `SUPABASE_ANON_KEY` (provided automatically by Supabase; V2e must confirm in the dashboard).
- Each sync costs one Didit API read and there is no per-user rate limit yet. The page (V3b) should call it only on return from Didit and on a manual "check again", not on a timer.
- Clock skew between Didit and our server could make a sync event look older than a webhook; the result is a harmless "stale", the webhook state stands.
- A person's `Kyc Expired` after VERIFIED is not discovered by sync (closed attempts are not re-read); the webhook covers it.
- Same dashboard-deploy caveat as V2b/V2c: shared and cross-function imports (`../_shared`, `../didit-webhook/decision.ts`) are settled in V2e.

## Next
Default: V2e (deploy runbook `docs/verification/DEPLOY-FUNCTIONS.md`; needs the owner's sandbox API key, workflow id and webhook secret, and must also settle the import question and the test-accounts-only warning). Other unblocked stages: V1g (customer warning applies), V1d (needs owner OK), V3a (needs D-V8 wording). Nothing to change or delete on GitHub or Supabase for this stage; do not deploy yet.
