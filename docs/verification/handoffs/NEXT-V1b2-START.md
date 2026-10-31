# START HERE for stage V1b-2 (side effects of a status change)

Copy-paste prompt for the next AI:
> Read `HANDOFF-README.md`, then `docs/verification/handoffs/didit-01-stage-breakdown.md`, then this file and `didit-V1b1.md`. Do stage **V1b-2** only. Follow the session protocol (section 2) and run the size gate (section 3) first. Finish with the stage note, the updated README, the zip required by rule 11, and stop.

## Where things stand
V2a, V1a and V1b-1 are written and tested on a scratch Postgres 16 only. Nothing has been run on the owner's Supabase and nothing against Didit. Owner answers and findings: `docs/verification/DECISIONS.md` (read all of it).

## The stage in two sentences
Replace the no-op hook `public.idv_apply_effects(p_row public.identity_verifications, p_old_status text)` (created by V1b-1, called only when a status actually changed, inside the same transaction) with the real side effects. On VERIFIED: set the verified flags. On leaving VERIFIED (Kyc Expired or Resubmitted): clear them. Write an audit row and a notification row. Nothing for any other status.

## Must-know facts (from the introspect results in `sql/verification/results/`)
- `users.id` is uuid; `users.is_verified boolean`, `users.verified_at timestamptz`. `users` has first_name, last_name, dob (the OLD flow copied these from the typed form: the new flow must NOT fill them from anything unless the owner decides; default: leave untouched).
- `taskers.user_id` is TEXT (cast: `user_id = p_row.user_id::text`). `taskers` has TWO flags: `is_verified` and `verified`, plus `verified_at`. Set and clear ALL THREE together. Other code may read either flag.
- `local_tasker_profiles(tasker_user_id uuid pk, verification_method text, verified_at timestamptz, verified_by uuid, verification_notes text)`. For `subject_kind = 'tasker_local'`: on VERIFIED set `verification_method = 'didit'`, `verified_at = now()`, leave `verified_by` null (no human verified it); on un-verify clear method and verified_at. The table has an `updated_at` trigger only. Do not touch other columns.
- Audit helper (VERIFIED from the real source, `results/v1b2-block1-functions.csv`): `local_tasker_audit(p_action, p_entity, p_entity_id, p_before, p_after, p_actor)` is SECURITY DEFINER and writes to `local_tasker_audit_log(actor_id, actor_role, action, entity, entity_id, before_data, after_data)`. Actor is `auth.uid()`, else `p_actor`; neither -> role 'system' (the webhook case: pass null). Both data arguments go through `local_tasker_scrub()` (source NOT seen: assume it strips personal fields, but pass none). The `entity` is free text, so use it for ALL subject kinds: action `idv.verified` / `idv.unverified`, entity `identity_verification`, entity_id = the verification id, before/after = `{"status": ...}` only. If its insert fails it RAISES, which rolls back the whole event (wanted). The log is append-only.
- Notification helper (VERIFIED): `_notify(p_user, p_type, p_title, p_msg, p_data)` is SECURITY DEFINER, inserts into `notifications` and SWALLOWS every error (`exception when others then null`). So a failed notification can never roll back the event and nothing reports it: say so in the stage note. The browser-side `can_notify` rules do not apply to it. Every new notification row is emailed (DECISIONS Q4), so: one per real change, wording that stands alone, `p_data = {"url": "/verify.html"}`. Local Taskers can never sign in and have a fake `.invalid` auth email, so notify their active COORDINATOR instead: `coordinator_assignments` (columns `coordinator_id`, `tasker_user_id`, `ended_at` null = active) joined to `coordinators` with `status = 'active'` (see source of `coordinator_manages_tasker`). No active coordinator -> no notification, still audit.
- Consents (for V1c, not this stage): `local_tasker_consents.purpose` is a CHECK list of 6 values without `identity_verification`; rows are insert-only (a guard trigger allows only the revoke fields to change); its foreign key needs a `local_tasker_profiles` row, so REGULAR taskers and customers cannot use that table. V1c must add the purpose for Local Taskers AND give self mode its own consent record.
- Wording rules: no claim StreetTasker cannot prove (didit-00 F5). Say "Your identity verification was completed" not "bank-grade" etc. Never write personal data, scores or Didit media into audit or notification.
- Flags must be written ONLY here. Do not touch browser-side grants or policies (that is V1d).

## Writes
- `sql/verification/v1b2-idv-apply-effects.sql` (+ `v1b2-rollback.sql` that puts the no-op back) and `v1b2-tests.sql` (scratch only).

## Exit check (run on scratch Postgres, as before)
1. VERIFIED sets `users.is_verified/verified_at`, and for taskers all three `taskers` columns, and for local taskers the `local_tasker_profiles` fields.
2. Kyc Expired and Resubmitted-from-VERIFIED clear all of them.
3. Every other change (IN_PROGRESS, REVIEW_REQUIRED, FAILED, ...) sets and clears nothing.
4. One audit row and at most one notification per real change; none for stale, duplicate, refresh or ignored events.
5. A failing AUDIT write rolls back the whole event (status unchanged, no ledger row). A failing notification does NOT (by design of `_notify`): test only that no error escapes.
6. V1b-1 tests (`v1b1-tests.sql`) still pass. NOTE: that file installs its own logging hook; re-check that it still works against the real hook (adjust the test, not the rules).
7. Scratch Postgres has none of the real tables or helpers: create minimal stand-ins with the REAL names, columns and signatures from `results/block1-columns.csv`, `v1b2-block1-functions.csv` and `v1b2-block3-coordinators-columns.csv` (`users`, `taskers`, `local_tasker_profiles`, `notifications`, `coordinators`, `coordinator_assignments`, `local_tasker_audit_log`, `local_tasker_scrub`, `_notify`, `local_tasker_audit`). Say in the stage note that they are stand-ins.

## Needs from the owner
Nothing more. Introspect blocks 1 to 4 of `v1b2-introspect.sql` are in `sql/verification/results/` (`v1b2-block1..4`). Not seen and not needed here: the source of `local_tasker_scrub`, and the trigger text on `local_tasker_audit_log`.

## Not in this stage
Browser permissions (V1d), start/read functions (V1c), old-user gate and the re-verification emails (V1g), Edge Functions (V2).

## Owner standing rules
SQL editor and dashboard deploys only; no console, curl or terminal steps for the owner. Never claim a test passed or SQL applied unless it really happened. No secrets in chat or in the package: the owner has pasted a credential-like string into chat once; it was deliberately NOT recorded. Secrets go into Supabase secrets at V2e. The owner chose NOT to change the existing email webhook secret; do not raise it again unless the package starts storing it.
