# Didit stage V1c-1: consent

V1c was split (size gate) into V1c-1 (this) and V1c-2 (start and read functions); the split is recorded in `didit-01-stage-breakdown.md`.

## Done
Consent for biometric identity checks, before Didit is ever called. No Didit account, Edge Function or real Supabase was used.

- **Local Taskers (no login):** the purpose `identity_verification` is added to the existing check on `local_tasker_consents` (the only change to an existing object). The coordinator records it with `idv_record_local_consent(tasker, method, evidence_ref, details)`; method is in_person, phone or written, as before. Only an ACTIVE coordinator with an un-ended assignment to that tasker can do it. A live consent is reused instead of duplicated.
- **Regular taskers and customers:** new table `identity_verification_consents` (insert-only, guard trigger like the Local Tasker one, partial unique index = one live consent per person per text version). `idv_give_consent(version)` and `idv_withdraw_consent(reason)` act only on `auth.uid()`.
- **Consent text version:** `idv_consent_version()` returns `v1`. The page (V3a) must send exactly that version; changing the function to `v2` makes every old consent stop counting and refuses the old text. The consent wording itself is NOT written here (D-V8 still open).
- **Server check:** `idv_has_consent(user, subject_kind)` (service_role only) is what `didit-create-session` (V2c) calls before creating a Didit session.
- Every consent given or withdrawn writes an audit row through `local_tasker_audit` (no free text, no personal data). If the audit write fails the consent is not recorded.
- The table has RLS on and no policy; `anon` and `authenticated` hold no table privileges.

## Files
- `sql/verification/v1c1-consent.sql`: all of the above. Safe to run twice.
- `sql/verification/v1c1-rollback.sql`: drops the functions and guard, restores the six-value purpose list as NOT VALID (existing rows kept, new `identity_verification` rows refused). KEEPS the self-consent table and its rows (a commented line drops it; irreversible).
- `sql/verification/v1c1-scratch-standins.sql`: SCRATCH ONLY. `local_tasker_consents` with its real columns, constraints and guard trigger text, plus the real `is_active_coordinator(uuid)` and `coordinator_manages_tasker(uuid, uuid)` source.
- `sql/verification/v1c1-tests.sql`: SCRATCH ONLY.

## Exit check (PostgreSQL 16.15, fresh databases; stand-ins, not your real tables)
- `v1c1-tests.sql`: **68 passed, 0 failed.** Covers: the 7-value purpose list and an unknown purpose refused; self consent (anon refused, no user id refused, wrong/null version refused, created, repeat reuses the live id even with a withdrawn row in history, audit row, browser roles cannot select/insert/update/delete the table, a Local Tasker identity refused); withdraw (own only, audit, second withdraw does nothing, too-long reason, not signed in, new row after re-consent, guard trigger: no edit, no change after withdrawal, no delete); Local Tasker consent (not signed in, not a coordinator, suspended coordinator, unassigned coordinator, ended assignment, no assignment, unknown id, null id, bad/null method, too-long evidence and details, nothing stored by any refusal, created with trimmed text, audit row, reuse, new consent after withdrawal, another purpose does not count); `idv_has_consent` for all subject kinds, unknown kind, null user, only service_role may run it; version bump; audit failure -> no consent stored (both paths); re-run, rollback (rows kept, new rows refused) and re-apply.
- Mutation check: five deliberate breakages (assignment check removed, version check removed, withdrawn consent still counting, live-id lookup without the withdrawn filter, active-coordinator check removed) were each caught.
- Regression with V1c-1 applied: `v1b2-tests.sql` 81/81, `v1b1-tests.sql` 170/170.
- **Not run on your real Supabase.** Scratch Postgres is not Supabase.

## Open issues
- `service_role` keeps Supabase's default EXECUTE on the browser functions, but with no user id they refuse it.
- Withdrawing consent does not remove or change any verification (retention D-V7 is open). No function withdraws a Local Tasker's consent yet.
- The consent wording and the claim list wait for D-V8 / V3a.
- Rollback leaves `identity_verification` consent rows in `local_tasker_consents` (the table is insert-only by design).

## Next
V1c-2 (start and read functions). Needs nothing from the owner. Read: this note, `didit-V1b2.md`, `didit-00` section 4 (functions), the V1c-2 row of the breakdown. Owner, when ready: run `v1c1-consent.sql` after the three earlier files (additive except the one purpose-list check on `local_tasker_consents`).
