# Didit stage V1b-1: status transition core

## Done
`idv_apply_event(...)` is now the single place a verification's status can change. It writes the event ledger, applies the rules, and calls a side-effects hook. No Didit account, Edge Function or real Supabase was used.

## Files
- `sql/verification/v1b1-idv-apply-core.sql`: `idv_map_status`, `idv_is_terminal`, `idv_decide_approved`, `idv_finish_event`, `idv_apply_event`, and a no-op hook `idv_apply_effects(row, old_status)`. Also widens the ledger `outcome` check by one value, `ignored_transition`. Safe to run twice; it never overwrites a hook that V1b-2 has replaced. Needs `v1a-tables.sql` first.
- `sql/verification/v1b1-rollback.sql`: drops the functions and restores the V1a outcome list (relabels `ignored_transition` rows as `rejected`).
- `sql/verification/v1b1-tests.sql`: SCRATCH ONLY, fresh database. Expected values for the 90-case matrix came from a separate Python model.

## Rules as built (full text at the top of the SQL file)
- Didit status map as in didit-00. `Approved` becomes VERIFIED only if the caller says the decision was re-fetched AND liveness ok AND face match ok AND (Nigerian document: NIMC `full_match`). Otherwise REVIEW_REQUIRED. A database mismatch never auto-fails; a person reviews it.
- Duplicate `event_id`: no change. Older event: `stale`. Wrong environment: `ignored_environment`.
- Terminal = VERIFIED, FAILED, EXPIRED, ABANDONED. Left only by Resubmitted, by Kyc Expired (only from VERIFIED or EXPIRED), or a repeat of its own status. Otherwise `ignored_transition`.
- `unknown_session` and `decision_not_fetched` remove the ledger row and return `retry: true`, so the Edge Function should return 5xx for them and Didit's retry works.
- Ignored and stale events do NOT advance the "latest event" clock.
- Side effects run only when the status actually changed, inside the same transaction. If they fail, the whole event is undone.

## Exit check (scratch Postgres 16, fresh database)
- `v1b1-tests.sql`: **170 passed, 0 failed.** Covers: every Didit status mapped (and unknown/case-variant strings refused); approval rule matrix; all 90 combinations of current status x Didit status, each also checking the hook fires exactly when the status changes; stale, equal and newer timestamps; duplicate event id with different content; unknown session then retry; environment mismatch both ways; unknown status; terminal exits and `completed_at`; check fields stored, never wiped by nulls; a failing hook rolls back the whole event; anon and authenticated refused on every function; service_role allowed; re-running the migration keeps a replaced hook.
- Apply twice, rollback twice, re-apply: ok. V1a's own 51 tests still pass with this stage applied.
- Two test mistakes of mine were found and fixed along the way (an assumption about ignored events and a timestamp-ordering query); the SQL itself did not change.
- **Not run on your real Supabase.** Scratch Postgres is not Supabase.

## Open issues
- A reviewer who declines in the Didit console and later approves is ignored (person must start a new session). Say if you want that allowed.
- PENDING is never set by this function; it is for V1c/V2d (server marks "returned from Didit, waiting").
- The Edge Function (V2b) must pass: `p_decision_fetched`, the check results read from the decision (`liveness_ok`, `face_match_ok`, `nin_database_match`), `p_nigerian_doc`, and Didit's `created_at` as `p_event_created_at`. A missing `created_at` falls back to now(), which weakens the stale check.

## Next
V1b-2 (side effects: flags on `users`, `taskers` including the second `verified` column, `local_tasker_profiles`; audit via `local_tasker_audit`; notification via `_notify`). Needs nothing more from the owner. Read the list in the stage breakdown; `block5`/`block6` CSVs already hold the function signatures.
Owner: you may run `v1b1-idv-apply-core.sql` on staging after `v1a-tables.sql`. Nothing else is needed from you yet.
