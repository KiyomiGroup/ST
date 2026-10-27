# Local Tasker: implementation status

Update this file at the end of every stage. Status values: Not started, In progress, Blocked, Written (not applied), Applied on staging, Verified, Done.

| Stage | Title | Size | Needs reference screen | Status | Handoff / notes |
|---|---|---|---|---|---|
| 1A | Repo and schema audit | S (read-only, no code) | No | Done | handoffs/stage-01a.md; audit complete, classification answered: ADD new tables |
| 1B | Money, escrow, chat, and Edge Function audit | S (read-only, no code) | No | Done | handoffs/stage-01b.md; money, release, webhook and 12% audited from source |
| 1C | Architecture plan and owner decisions | S (documents only) | No | Done | handoffs/stage-01c.md; DECISIONS.md and implementation-plan.md written |
| 2A | Coordinator role, Local Tasker flag, assignments, 10-cap | M (SQL only) | No | Applied (owner ran it; reported correct) | handoffs/stage-02a.md |
| 2B | Audit log, consent records, and security helper functions | M (SQL only) | No | Applied (owner ran it; reported correct) | handoffs/stage-02b.md |
| 2C | RLS for existing tables and the public marketplace view | M (SQL only, high care) | No | Applied (owner ran `stage-2c-rls.sql`; reported successful) | handoffs/stage-02c.md; the AI did not observe the output |
| 2D | Local Tasker account creation (no-login identity) and coordinator creation function | M (SQL plus one Edge Function) | No | Verified live on 2026-10-26 through the 4A-2 form (owner's BLOCK 2 output). Sign-in refusal itself not attempted (owner declined curl); locked by the ban | handoffs/stage-02d.md; handoffs/stage-04a-2.md section 11 |
| 3A | Coordinator sign-in, route guard, dashboard shell | M | Yes | Written (not yet used against real Supabase); browser-tested with a MOCKED Supabase only | handoffs/stage-03a.md; no SQL; owner check in section 8 of the handoff |
| 3B | Coordinator overview (real data) | S | Yes | Written (not yet used against real Supabase); browser-tested with a MOCKED Supabase only | handoffs/stage-03b.md; no SQL; booking metrics wait for 5A/5B (coordinators have no booking access yet) |
| 4A-1 | My Local Taskers: read-only list and profile | M | Yes (owner: follow the design system) | Written (not yet used against real Supabase); browser-tested with a MOCKED Supabase only | handoffs/stage-04a-1.md; no SQL |
| 4A-2 | My Local Taskers: add form (first real Edge Function call) with consent, and consent record on the profile | M | Yes (owner: follow the design system) | First real create SUCCEEDED (owner ran the form, 2026-10-26); other paths browser-tested with a MOCKED Supabase only (143 checks) | handoffs/stage-04a-2.md; no new SQL; owner check in section 7 |
| 4A-3 | My Local Taskers: audited edit (new SQL function + edit form) | M | Yes (owner: follow the design system) | Written (not yet run in the real project); SQL tested on a SCRATCH Postgres (24 PASS), browser-tested with a MOCKED Supabase (185 checks) | handoffs/stage-04a-3.md; owner steps in section 7 (SQL editor + deploy only) |
| 4B-1 | Service listings and agreed rates (SQL function + service form + profile card) | M | Yes (owner: follow the design system) | Written (not yet run in the real project); SQL tested on a SCRATCH Postgres (34 PASS), browser-tested with a MOCKED Supabase (232 checks) | handoffs/stage-04b-1.md; owner steps in section 7 (SQL editor + deploy only) |
| 4B-2 | Portfolio photos (private bucket, photos table, 3 SQL functions, photos page, profile card) | M | Yes (owner: follow the design system) | Written (not yet run in the real project); SQL tested on a SCRATCH Postgres (56 PASS, schema reconstructed), browser-tested with a MOCKED Supabase (307 checks) | handoffs/stage-04b-2.md; owner steps in section 7 (SQL editor + deploy only) |
| 4C | Preview, publish, Local Tasker badge, marketplace, application block | M | Yes | Not started | |
| 5A | Booking assignment and Local Tasker booking state machine (SQL) | L (SQL only), split if needed | No | Not started | |
| 5B | Coordinator booking list and booking detail | M | Yes | Not started | |
| 5C | Tasker confirmation recording and quote breakdown | L, split if needed | Yes | Not started | |
| 5D | Customer quote approval, milestones, exceptions | L, split if needed | Yes | Not started | |
| 6A | Booking-specific coordinator thread (SQL and customer side) | M | Yes | Not started | |
| 6B | Coordinator chat and internal notes | M | Yes | Not started | |
| 7A | Local Tasker commission exemption | M | No | Not started | |
| 7B | Verified payout destination (bank details) | M | Yes | Not started | |
| 7C | Release to direct payout, webhook, idempotency, failures | L, split if needed | No | Not started | |
| 7D | Coordinator payments and records view | S | Yes | Not started | |
| 8A | Admin: coordinator approval, assignment, reassignment, deactivation | M | Yes | Not started | |
| 8B | Admin: audit viewer, disputes, payment issue handling | M | Yes | Not started | |
| 9A | Security and RLS test pack | M (SQL and checklist) | No | Not started | |
| 9B | End-to-end and regression testing, defect fixes | M | No | Not started | |
| 10 | Final handoff and deployment readiness | S (documents) | No | Not started | |

## Blockers
- None. Next: owner runs handoffs/stage-04a-3.md section 7, handoffs/stage-04b-1.md section 7 and handoffs/stage-04b-2.md section 7, then 4C (preview, publish, badge, marketplace).
- Carry-forward for 9A: the placeholder Auth users have a stored password hash (`has_password: true`, unknown to everyone). Login is blocked by the ~100-year ban, and nobody tried to sign in. Optional hardening: blank `encrypted_password` inside `create_local_tasker` and for existing placeholders.

## Decisions pending
Only defaults the owner may overrule: O3 (verification record location), customer-contact visibility, D13 (coordinator must be active to receive Local Taskers). See `DECISIONS.md`.

## Last session
Update 2026-10-27 (Stage 4B-2): private bucket `local-tasker-photos`, table `local_tasker_photos`, functions `add/update/remove_local_tasker_photo` (authority inside, audited, soft removal, max 8, `photos` agreement recorded first time), storage policies for the managing coordinator only, photos page (pictures shrunk and re-saved as JPEG in the browser, signed links) and a Photos card on the profile. SQL: 56 PASS on a scratch Postgres rebuilt from stand-ins because the exported schema was not in the zips; browser: 307 checks pass with a MOCKED Supabase; nothing run in the real project. Customer visibility and the `taskers` sync are left to 4C. Console and curl steps stay removed (standing instruction 14). Earlier notes follow.

Update 2026-10-27 (Stage 4B-1): new SQL function `save_local_tasker_service` (RPC, authority checked inside, audited, services paused never deleted, max 5, records the `publish_info` agreement the first time) with rollback and tests; service add/edit page and a "Services and agreed rates" card on the profile. SQL: 34 PASS on a scratch Postgres (not Supabase); browser: 232 checks pass with a MOCKED Supabase; nothing run in the real project. The `taskers` sync is deliberately left to 4C. Photos (4B-2) next. Console and curl steps stay removed (standing instruction 14). Earlier notes follow.

Update 2026-10-26 (Stage 4A-3): new SQL function `update_local_tasker_profile` (RPC, authority checked inside from `auth.uid()`, audited with field names only, no-op saves write nothing; cannot touch status/assignment/consent/verification) plus rollback and tests; edit page `coordinator-tasker-edit.html` and an Edit button on the profile. SQL: 24 PASS on a scratch Postgres (not Supabase); browser: 177 checks pass with a MOCKED Supabase; nothing run in the real project. Unverified: coordinator read of `users.name` for a draft person, and supabase-js exposing the error `hint`. Edit page then restyled to the owner's reference, and the same hero/card style applied to the list, add and profile pages (hero, assisted-mode notice, live customer-view preview, completeness checklist; invented stats/publish/photos not built). Console and curl steps stay removed (standing instruction 14). Earlier notes follow.

Update 2026-10-26 (Stage 4A-2): built the Add a Local Tasker form (retry-safe request id, error code shown on screen, cap handling) calling the 2D Edge Function, and an \"Agreement on record\" card on the profile. 143 browser checks pass with a MOCKED Supabase; nothing run against the real project. Edit split off as 4A-3 (needs new SQL). Console and curl steps stay removed (standing instruction 14). Earlier notes follow.

Update 2026-10-26 (Stage 4A-1): built My Local Taskers list (search, status filter) and read-only profile page, real data under RLS; nav link live; Overview cards link to profiles. 68 browser checks pass with a MOCKED Supabase; nothing run against the real project. Create/edit (4A-2) is blocked on three inputs listed in handoffs/stage-04a-1.md section 8. Earlier notes follow.

Update 2026-10-26 (Stage 3B): Overview now reads real data (own active assignments, profiles of managed taskers): tiles, cards, loading/empty/error states. Booking metrics deliberately absent (no coordinator booking access until Stage 5). Fixed the coordinator sign-in message: a normal or unverified account is told it is not a coordinator and pointed to login/sign up. 47 browser checks pass with a MOCKED Supabase; nothing run against the real project. Next: owner signs in once (stage-03b.md section 8), then Stage 4A. Earlier notes follow.

Update 2026-10-26 (Stage 3A): built `coordinator-login.html`, `coordinator-dashboard.html` (shell, no real data), `components/coordinator-nav.html`, `js/coordinator.js` (route guard), `js/coordinator-login.js`, `css/coordinator.css`, `--co-*` tokens. No SQL: the guard uses the existing `is_active_coordinator()`, `is_coordinator()` and the `lt_coordinators_read` policy (confirmed from the owner's introspect export). 28 browser checks pass with a mocked Supabase; the real sign-in has not been run. Next: owner signs in once (handoff section 8), then Stage 3B. Previous session notes follow.

Update 2026-10-26: owner ran the fixed 2D SQL and deployed the fixed Edge Function; owner declined console/curl steps, so the live Edge test moves to 4A. Stage 2D written: server-only SQL `create_local_tasker` (one transaction: private profile draft, `users` + `taskers` rows without phone/whatsapp, active assignment with the 10-cap, consent, 2 audit rows, idempotency ledger), refuses any identity that could log in; Edge Function `local-tasker-create` (active-coordinator check, creates a locked placeholder Auth user: no password, `@local-tasker.invalid`, banned about 100 years). SQL tests pass on a scratch Postgres built from the owner's exported schema (NOT Supabase); nothing run in Supabase, Edge Function not deployed, no-login proof not run. Next: owner runs section 16 of the handoff; then Stage 3A (needs a reference screen). Standing owner instructions are at the top of `handoffs/stage-02d.md`.
