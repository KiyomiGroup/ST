> STATUS (2026-10-30): V1c-2 is DONE (see didit-V1c2.md). This file is kept for its facts only; the next stage is named in HANDOFF-README.md.

# START HERE for stage V1c-2 (start and read functions). V1c-1 (consent) is DONE: see didit-V1c1.md

Copy-paste prompt for the next AI:
> Read `HANDOFF-README.md`, then `docs/verification/handoffs/didit-01-stage-breakdown.md`, then `didit-V1b2.md`, `didit-V1b1.md` and this file. Do stage **V1c-2** only (V1c-1, consent, is already done: use `idv_has_consent`, `idv_consent_version` and the consent tables as they are). Follow the session protocol (section 2) and run the size gate (section 3) first; split if needed and tell the owner before writing code. Finish with the stage note, the updated README, the zip required by rule 11, and stop.

## Facts carried over
- Tables: `identity_verifications` (one open attempt per user per environment; `request_id` retry key unique per `created_by`), `identity_verification_events`. Browser roles have no access to either; read through functions only.
- Status changes happen ONLY in `idv_apply_event`; V1c may insert a NEW attempt row (NOT_STARTED/IN_PROGRESS) and may set PENDING (server marks "returned from Didit, waiting"). It must never set VERIFIED or write the verified flags.
- (DONE in V1c-1, kept for context) Consent: `local_tasker_consents.purpose` CHECK had 6 values and no `identity_verification`; rows are insert-only (guard trigger); its FK needs a `local_tasker_profiles` row, so regular taskers and customers cannot use it. V1c must extend the purpose list for Local Taskers AND give self mode (regular taskers, customers) its own consent record. Block 2 of `results/v1b2-block2-constraints.csv` holds the real constraint text.
- Reuse: `coordinator_manages_tasker(auth.uid(), tasker)`, `is_active_coordinator()`, `local_tasker_audit(...)`, `_notify(...)`.
- Decisions: D-V4 customers verify too (subject_kind `customer`), D-V6 default. See `DECISIONS.md`.
- Owner rules: SQL editor and dashboard deploys only; never claim a test passed or SQL applied unless it did; no secrets in chat or package.
- Scratch testing: PostgreSQL 16 may need `apt-get install -y postgresql` (works as root here); initdb as user `postgres`, socket dir, `v1a-scratch-setup.sql`, then `v1b2-scratch-standins.sql` for the stand-in tables.

## Exit check (from the stage table)
A user reads only their own row; a coordinator reads only assigned Local Taskers; a consent row is required before start; no scores or images are returned.
