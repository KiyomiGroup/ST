# Didit stage V1a: tables and RLS

## Done
Two new tables, additive only. No existing table, function or policy is touched.

## Files
- `sql/verification/v1a-tables.sql`: `identity_verifications` and `identity_verification_events`, one-open-row index, request-id index, `updated_at` trigger. RLS on, no policies, every privilege revoked from `anon` and `authenticated`, access for `service_role` only. Safe to run twice.
- `sql/verification/v1a-rollback.sql`: drops both tables and the trigger function (deletes their rows).
- `sql/verification/v1a-scratch-setup.sql`, `v1a-tests.sql`: SCRATCH POSTGRES ONLY, never for Supabase.
- Also recorded: `docs/verification/DECISIONS.md` (your answers and what the introspect results showed) and the seven result CSVs in `sql/verification/results/`.

## Exit check (run on scratch Postgres 16 with `anon`, `authenticated`, `service_role` roles and Supabase-style default grants)
- Apply twice, roll back twice, re-apply: **all succeeded**.
- `v1a-tests.sql` on a fresh database: **51 passed, 0 failed.** This includes: RLS on, zero policies; anon and authenticated refused SELECT, INSERT, UPDATE and DELETE on both tables; a second open row for the same user and environment refused; each closed status frees the slot and each open status blocks it; bad status, kind, environment, provider and NIN-match values refused; duplicate session id, request id and event id refused; `updated_at` moves on update.
- The test file is meant for a fresh database; re-running it on the same one fails on its own leftover rows.
- **Not run on your real Supabase project.** Scratch Postgres is not Supabase: the roles and default grants are my reconstruction. Run in staging first and confirm the tables show RLS enabled.

## Choices to know about
- Added `subject_kind` (`tasker_regular`, `tasker_local`, `customer`) instead of the handoff's two-value `tasker_category`, because customers now verify too (D-V4).
- No foreign key to `users`, so account deletion is never blocked while retention (D-V7) is undecided.
- "Closed" statuses for the one-open-row rule are VERIFIED, FAILED, EXPIRED, ABANDONED. V1b-1 may change this list; if so, the index is recreated.

## Open issues
See `DECISIONS.md` Q1 to Q5 (meaning of "disabled", the test-account email typo `gmai.com`, who counts as old users, how emails are sent). None block V1b.

## Next
V1b-1 (status transition rules). Needs nothing more from you.
You can run `v1a-tables.sql` in the Supabase SQL editor on staging whenever you like; nothing else depends on it being run yet.
