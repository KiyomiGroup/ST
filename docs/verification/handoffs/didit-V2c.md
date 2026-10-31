# Didit stage V2c: create-session Edge Function

## Done
`didit-create-session` starts (or resumes) a verification and returns the Didit link. Tested on Node with stubbed fetch only; no Didit account, key, Deno or real Supabase was used.

Flow as built (`handler.ts`, wired by `index.ts`; deploy with Verify JWT ON):
1. POST `{mode: "self"|"proxy", local_tasker_user_id? (proxy only), request_id?}` with the user's access token. The caller id comes from the token (Supabase `/auth/v1/user`), never from the body; `user_id`, `vendor_data` and any other body field is ignored; in self mode no target is sent to SQL.
2. `idv_start_attempt` (V1c-2) decides the subject, checks consent, the already-verified rule and the 5-per-24h cap. Its refusals become: not_signed_in 401, not_active_coordinator / not_assigned / not_for_local_tasker 403, consent_required / already_verified 409, too_many_attempts 429, bad_input 400; anything unknown -> generic 500. Didit is not called after a refusal.
3. Workflow: regular and Local Taskers use `DIDIT_WORKFLOW_ID`; customers use `DIDIT_WORKFLOW_ID_CUSTOMER` (stage V6). Until that secret exists a customer gets 503 "not available yet".
4. `POST /v3/session/` with `x-api-key`: `workflow_id`, `vendor_data` = the subject id returned by SQL, `callback` = `SITE_URL/verify.html` (default https://streettasker.com), `metadata.verification_id`. No name, phone, email or document data is sent. Didit returns the same unfinished session for the same `vendor_data`, so resume works through the same call.
5. The returned `url` is only accepted if it is https on `didit.me` or a subdomain. Then `idv_attach_session` stores the session id BEFORE the link is returned, so the webhook can find the attempt. If attaching fails the link is NOT returned (500; a retry reuses the same session).
6. Response: `{ok, url, status, reused}` only. Never the session token, session id, verification id or user ids. Didit 403 / 5xx / timeout / odd reply -> 502 "try again in a few minutes" (no mention of keys or configuration).
Nothing secret is logged (tested on every failure path).

## Files
`supabase/functions/didit-create-session/index.ts`, `handler.ts`, `handler.test.ts`.

## Exit check (Node v22: `node --experimental-strip-types --test handler.test.ts`)
- **22 passed, 0 failed.** Covers CORS, methods, each missing setting, bad or missing token, token never forwarded, bad input (10 cases), self and proxy mode arguments, body user id ignored, exact Didit request, SITE_URL, response keys, call order, reuse, all 8 SQL refusals, unknown SQL errors, customer workflow rules, five Didit failure kinds, 7 bad Didit replies (non-https, lookalike host, javascript:), attach failures, and log contents.
- Mutation check: 12 deliberate breakages (caller from body, vendor_data from body, target in self mode, attach failure ignored, any URL accepted, config leak in the 403 message, customer fallback to the main workflow, session token returned, API key logged, no auth check, consent_required answered 200, user token forwarded to Didit) were each caught.
- V2a (12) and V2b (29) tests still pass. No SQL changed.
- **Not run on Deno, not deployed, never called the real Didit or your Supabase.**

## Open issues
- **Customers cannot verify until V6.** If V1g (re-verification gate) blocks existing customers before V6 exists, they would be locked out with no way to verify. V1g must not gate customers until V6 is done, or V6 must come first.
- The Didit `callback` is a plain redirect to `verify.html`; Local Taskers verify on their own device in proxy mode, so V3c decides what the coordinator sees afterwards.
- Reuse relies on Didit returning the same unfinished session for the same `vendor_data` (per `DIDIT-API-FACTS.md`, unconfirmed). If Didit ever returns a different session id, attach refuses it (500) and the person is stuck until V2d sync / support; first sandbox run will show.
- Same dashboard-deploy caveat as V2b: the shared import question is settled in V2e.

## Next
Default: V2d (sync: the person or their coordinator asks "what is my status", read from Didit and applied through `idv_apply_event`; also uses `idv_mark_pending`). Needs nothing from the owner. Nothing to change or delete on GitHub or Supabase for this stage; do not deploy yet (secrets and runbook come in V2e).
