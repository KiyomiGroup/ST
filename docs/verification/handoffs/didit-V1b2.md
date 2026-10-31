# Didit stage V1b-2: side effects of a status change

## Done
`idv_apply_effects(row, old_status)` (the no-op hook from V1b-1) now does the real work. `idv_apply_event` calls it only when the status actually changed, in the same transaction. No Didit account, Edge Function or real Supabase was used.

- **Entering VERIFIED:** sets `users.is_verified/verified_at`; for `tasker_regular` and `tasker_local` also `taskers.is_verified`, `taskers.verified`, `taskers.verified_at` (every taskers row of the user; `taskers.user_id` is text); for `tasker_local` also `local_tasker_profiles.verification_method = 'didit'`, `verified_at = now()`, `verified_by = null`. Customers: `users` only. Then one audit row (`idv.verified`) and a notification.
- **Leaving VERIFIED** (Kyc Expired, Resubmitted): clears the same fields (profile: method and verified_at), writes `idv.unverified`, notifies. A flag is kept if the same user still has another VERIFIED attempt that supports it (users flags: any other VERIFIED row; taskers and profile: another VERIFIED tasker row).
- **Becoming FAILED or REVIEW_REQUIRED** (added after the first version, at the owner's request): a notification only. No flags, no audit row (the event ledger records the change). FAILED: "Your identity verification could not be completed ... Open the verification page to see what to do next." REVIEW_REQUIRED: "Your identity verification is being reviewed ... needs a manual review ... You will be told when there is an update." Local Taskers: same wording about "a tasker you manage", sent to their active coordinator. No reason, score or detail in any text.
- **Every other change** (IN_PROGRESS, RESUBMIT_REQUESTED, EXPIRED, ABANDONED, ...): nothing at all.
- `users.first_name/last_name/dob` are never touched.

## Files
- `sql/verification/v1b2-idv-apply-effects.sql`: the hook plus a private helper `idv_notify_subject` (who gets told). `create or replace`, safe to run twice, keeps server-only grants.
- `sql/verification/v1b2-rollback.sql`: puts the no-op back and drops the helper. It does NOT undo flags, audit rows or notifications already written.
- `sql/verification/v1b2-scratch-standins.sql`: SCRATCH ONLY. Minimal versions of `users`, `taskers`, `local_tasker_profiles`, `notifications`, `coordinators`, `coordinator_assignments`, `support_staff`, `local_tasker_audit_log` (with the append-only trigger), `auth.uid()`, a pass-through `local_tasker_scrub` (real source never seen), and the REAL source text of `_notify` and `local_tasker_audit`. These are stand-ins, not your real tables.
- `sql/verification/v1b2-tests.sql`: SCRATCH ONLY, fresh database.

## Audit and notification as built
- Audit: `local_tasker_audit('idv.verified' | 'idv.unverified', 'identity_verification', verification id, {"status": old}, {"status": new}, null)`. From the webhook there is no login, so the role is `system`. If the audit insert fails it raises and the whole event is undone (tested).
- Notification: `_notify(..., 'identity_verification', title, message, {"url": "/verify.html"})`. Regular taskers and customers: the user. Local Taskers: every ACTIVE coordinator with an un-ended assignment (normally one); none -> no notification, audit still written. No names, phone, scores or media in any text. Wording makes no claim beyond "verification was completed / is no longer active".
- `_notify` swallows every error, so a failed notification can never undo the event and nothing reports it (tested: no error escapes). Each notification row is also emailed by your existing pipeline, so a status change = at most one email per recipient.

## Exit check (PostgreSQL 16.15, fresh databases)
1. `v1b2-tests.sql`: **81 passed, 0 failed** (re-run 3 times, stable). Covers: VERIFIED for regular tasker (two taskers rows), customer, local tasker (profile fields, coordinator-only notification, ended assignment, non-active coordinator, no coordinator, missing taskers/users rows); Kyc Expired and Resubmitted clear everything for all three kinds; 3 kinds x 8 start statuses x 9 Didit statuses = 216 non-VERIFIED transitions change no flag or audit row, and send exactly one notification each time a row enters FAILED or REVIEW_REQUIRED and none otherwise; wording and recipients for FAILED / In Review (customer, regular tasker, local tasker with and without coordinator); a repeat of REVIEW_REQUIRED sends nothing more; Approved with failed liveness -> REVIEW_REQUIRED sets nothing but sends the "being reviewed" notice; Declined after VERIFIED ignored; duplicate, repeat, stale, wrong environment, unknown status, unknown session write nothing; failing audit rolls back everything and the same event applies after the fix; failing notification does not escape; other-VERIFIED-attempt guard; no personal data in any text; re-run, V1b-1 re-run, rollback and re-apply; anon and authenticated cannot run the hook.
2. `v1b1-tests.sql` run with V1b-2 applied: **170 passed, 0 failed** (it installs its own logger hook, so it does not exercise the real hook; the real hook is covered by item 1).
3. Mutation check: four deliberate breakages of the hook (wrong clear value, wrong audit action, hook not skipping no-change, coordinator status check removed) were each caught by the tests.
4. **Not run on your real Supabase.** Scratch Postgres is not Supabase; stand-ins are not your real tables.

## Open issues
- **Sandbox vs live:** sandbox rows set flags too. Never point a PRODUCTION project at the Didit sandbox (V2e must state `DIDIT_ENV=live` there).
- `service_role` can call the hook directly (Supabase default grants); it is the trusted server, but only `idv_apply_event` should call it.
- `local_tasker_scrub` source was not seen; we pass only `{"status": ...}`, so it should not matter.
- A row that goes review -> resubmitted -> review again notifies twice (once per entry); a repeat of the same status does not.
- Rows that went VERIFIED before this stage (none yet, nothing run on real data) would not have had flags set; flags are written only on a status change.

## Next
V1c (start and read functions: consent for self mode and for Local Taskers, `identity_verification` consent purpose, create-attempt and read-own-status functions). Needs nothing more from the owner. Owner, when ready: run `v1a-tables.sql`, `v1b1-idv-apply-core.sql`, then `v1b2-idv-apply-effects.sql` in the Supabase SQL editor (additive; the last one replaces only the no-op hook).
