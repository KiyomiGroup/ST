# Didit stage V1c-2: start and read functions

## Done
The functions the Edge Functions and the pages call to start an attempt and read a status. SQL only; no Didit account, Edge Function or real Supabase was used.

**Server only (service_role):**
- `idv_start_attempt(caller, mode, target, environment, request_id)`: decides WHO is verified on the server. `self` = the caller (a Local Tasker identity is refused; kind is `tasker_regular` if a `taskers` row exists, else `customer`). `proxy` = an ACTIVE coordinator with an un-ended assignment to the target Local Tasker. Refuses without a live consent (`consent_required`, also for a retried request id), refuses a person who already has a VERIFIED attempt in that environment (`already_verified`), returns a retried request or an open attempt instead of making another (`reused: true`, with the Didit session id if one is attached), otherwise inserts ONE row in NOT_STARTED and writes an audit row `idv.attempt_created` (kind and mode only). Cap: 5 new attempts per person per environment per 24 hours (`too_many_attempts`); Didit charges per session. The browser never names the subject in self mode (a target sent in self mode is ignored).
- `idv_attach_session(verification_id, session_id, workflow_id)`: stores the Didit session id once Didit created it; never changes status; same id again is a no-op; a different id or a closed attempt is refused.
- `idv_mark_pending(verification_id)`: NOT_STARTED or IN_PROGRESS (with a session attached) -> PENDING, nothing else.

**Signed-in readers (authenticated):** `idv_my_status()` (own row only), `idv_local_status(tasker)` (one assigned Local Tasker), `idv_local_status_list()` (all of the calling coordinator's un-ended assignments, for V4a). They return status, has_attempt, has_open_attempt, verified, needs_review (= REVIEW_REQUIRED), consent_given and dates (my_status also subject_kind and consent_version). They NEVER return scores, liveness / face / document / NIN results, reason codes, session id, workflow id or media (tested by exact key list and text search).
Private helper `idv_subject_kind(user)`. Nothing here can set VERIFIED or touch the verified flags; status changes stay in `idv_apply_event` (tested).

## Files
`sql/verification/v1c2-idv-start-read.sql` (new functions only, safe to run twice), `v1c2-rollback.sql` (drops the seven functions; keeps attempt rows), `v1c2-tests.sql` (SCRATCH ONLY). No stand-in file needed (V1c-1's are reused).

## Exit check (PostgreSQL 16, fresh databases; stand-ins, not your real tables)
- `v1c2-tests.sql`: **108 passed, 0 failed**, re-run 3 times, stable. Covers grants (anon/authenticated cannot run server functions or touch the tables), input checks, consent required (self, proxy, withdrawn, retried request), reuse and retry, proxy refusals (non-coordinator, suspended, other coordinator's tasker, ended assignment, null/unknown), attach and pending rules, VERIFIED/Kyc Expired/FAILED behaviour, the 24 h cap per environment, own-row-only reads, exact output keys, list scoping, audit failure undoing a start, re-run, rollback and re-apply.
- Mutation check: 8 deliberate breakages (consent check, assignment check, already-verified check, cap, pending any-status, score leak, read any user, list ignoring ended assignments) were all caught; the last needed both of its guards removed (the assignment helper also checks `ended_at`).
- Regression with V1c-2 applied: V1b-1 170/170, V1b-2 81/81, V1c-1 68/68.
- **Not run on your real Supabase.** Scratch Postgres is not Supabase; `users`, `taskers` and coordinator tables are stand-ins.

## Open issues
- `taskers.user_id` is text; kind detection uses `user_id = uid::text` (as V1b-2). A person who is both a tasker and a customer verifies as `tasker_regular`.
- The cap of 5 per 24 hours is my addition (not in the plan); change `v_n >= 5` in `idv_start_attempt` if you want another number.
- `idv_my_status` takes the newest attempt in any environment; a PRODUCTION project must never hold sandbox rows (see V1b-2 open issue).
- `idv_mark_pending` changes status outside `idv_apply_event` (allowed by the plan; PENDING has no side effects).

## Next
See HANDOFF-README. Owner, when ready: run `v1c2-idv-start-read.sql` in the Supabase SQL editor AFTER `v1c1-consent.sql` (additive: new functions only). Nothing to change or delete on GitHub or Supabase for this stage.
